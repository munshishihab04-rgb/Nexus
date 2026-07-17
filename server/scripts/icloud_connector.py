#!/usr/bin/env python3
"""Nexus iCloud connector.

This script is intentionally conservative:
- Apple ID password is read from environment only and never written to disk.
- Session/cookie files and synced metadata live under ICLOUD_DATA_DIR.
- If pyicloud is not installed or Apple requires 2FA, the script exits with a specific code
  so the dashboard can show the correct next step.
"""
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

DATA_DIR = Path(os.environ.get('ICLOUD_DATA_DIR', './data/icloud'))
META_DIR = Path(os.environ.get('ICLOUD_META_DIR', str(DATA_DIR / 'meta')))
DOWNLOADS_DIR = Path(os.environ.get('ICLOUD_DOWNLOADS_DIR', str(DATA_DIR / 'downloads')))
RUNTIME_DIR = DATA_DIR / 'runtime'
ACTION = os.environ.get('ICLOUD_ACTION', 'sync')
APPLE_ID = os.environ.get('ICLOUD_APPLE_ID', '')
PASSWORD = os.environ.get('ICLOUD_PASSWORD', '')
METHOD_INDEX = os.environ.get('ICLOUD_METHOD_INDEX', '')
SECTIONS = [s for s in os.environ.get('ICLOUD_SECTIONS', 'photos,videos,drive,contacts,calendar,devices,reminders').split(',') if s]
RECENT = int(os.environ.get('ICLOUD_RECENT', '250') or '250')

for p in [DATA_DIR, META_DIR, DOWNLOADS_DIR, RUNTIME_DIR]:
    p.mkdir(parents=True, exist_ok=True)


def log(msg):
    print(msg, flush=True)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    tmp.replace(path)


def item_ts(value):
    if value is None:
        return int(time.time() * 1000)
    if isinstance(value, (int, float)):
        return int(value if value > 10_000_000_000 else value * 1000)
    try:
        return int(value.timestamp() * 1000)
    except Exception:
        return int(time.time() * 1000)


def safe_str(v):
    if v is None:
        return ''
    return str(v).replace('\x00', ' ')[:2000]


def mask_apple_id(value):
    s = safe_str(value)
    at = s.find('@')
    if at < 0:
        return (s[:2] + '***') if s else ''
    return s[:2] + '***' + s[at:]


def redact_log_line(line):
    text = safe_str(line)
    if APPLE_ID:
        text = re.sub(re.escape(APPLE_ID), mask_apple_id(APPLE_ID), text, flags=re.IGNORECASE)
    # Redact any email-like value emitted by third-party tools.
    text = re.sub(r'([A-Za-z0-9._%+-]{2})[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', r'\1***\2', text)
    return text


def account_file():
    return RUNTIME_DIR / 'account.txt'


def save_runtime_account():
    if APPLE_ID:
        f = account_file()
        f.write_text(APPLE_ID.strip(), encoding='utf-8')
        try:
            os.chmod(f, 0o600)
        except Exception:
            pass


def load_runtime_account():
    if APPLE_ID:
        return APPLE_ID.strip()
    f = account_file()
    if f.exists():
        return f.read_text(encoding='utf-8').strip()
    return ''


def icloudpd_binary():
    found = shutil.which('icloudpd')
    if found:
        return found
    candidate = Path(sys.executable).with_name('icloudpd')
    return str(candidate) if candidate.exists() else ''


def describe_trusted_device(device, idx):
    label = (
        device.get('phoneNumber')
        or device.get('deviceName')
        or device.get('name')
        or device.get('deviceType')
        or f'Metodo {idx + 1}'
    )
    kind = 'sms' if device.get('phoneNumber') else 'device'
    return {
        'index': idx,
        'label': safe_str(label),
        'kind': kind,
        'obfuscated': safe_str(device.get('phoneNumber') or device.get('deviceName') or label),
    }


def method_token_for_index(index):
    # icloudpd often uses letters (a,b,c). Some versions use numeric indexes.
    if 0 <= index < 26:
        return chr(ord('a') + index)
    return str(index)


def parse_icloudpd_method_line(line):
    # Examples seen in icloudpd/Apple flows: "  a: *** *** **85", "a: +39 ••• 85", "0: iPhone"
    text = safe_str(line).strip()
    m = re.match(r'^([a-zA-Z]|\d{1,2})\s*[:\)]\s*(.+)$', text)
    if not m:
        return None
    token, label = m.group(1), m.group(2).strip()
    if not label or len(label) > 160:
        return None
    # Avoid parsing log prefixes as choices.
    if label.lower().startswith(('debug', 'info', 'error', 'warning')):
        return None
    idx = ord(token.lower()) - ord('a') if token.isalpha() else int(token)
    return {
        'index': idx,
        'token': token,
        'label': label,
        'kind': 'sms' if any(ch.isdigit() for ch in label) or '*' in label or '•' in label else 'device',
        'obfuscated': label,
    }


def wait_for_dashboard_method(methods, method_file, timeout=180):
    selected = int(METHOD_INDEX) if METHOD_INDEX.strip().isdigit() else None
    deadline = time.time() + timeout
    while selected is None and time.time() < deadline:
        if method_file.exists():
            raw = method_file.read_text(encoding='utf-8').strip()
            try:
                method_file.unlink()
            except Exception:
                pass
            if raw.isdigit():
                selected = int(raw)
                break
        time.sleep(1)
    if selected is None:
        return None
    for m in methods:
        if int(m.get('index', -1)) == selected:
            return m
    return None


def wait_for_dashboard_code(code_file, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if code_file.exists():
            code = code_file.read_text(encoding='utf-8').strip()
            try:
                code_file.unlink()
            except Exception:
                pass
            return code
        time.sleep(1)
    return None


def valid_icloudpd_session(cookie_dir):
    """Return True only when icloudpd saved a real authenticated session.

    Some icloudpd/pyicloud paths can exit 0 after an Apple 401/debug error and
    leave only a partial session file (client_id/scnt/session_id). That is not
    enough for later passwordless sync and must not be reported as AUTH_OK.
    """
    try:
        session_files = list(Path(cookie_dir).glob('*.session'))
    except Exception:
        return False
    for f in session_files:
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
        except Exception:
            continue
        if data.get('session_token') or data.get('trust_token') or data.get('dsInfo'):
            return True
    return False


def login_with_icloudpd_auth_only():
    """Fallback auth flow using icloudpd + pexpect.

    This path is used when pyicloud dies before exposing 2FA methods. icloudpd's
    console MFA flow often prints selectable SMS choices (a:, b:, ...). We parse
    those choices, publish them to the dashboard, then feed the user's selection
    and code back into the process.
    """
    try:
        import pexpect  # type: ignore
    except Exception as e:
        log(f'ICLOUDPD_SETUP_MISSING: pexpect not installed: {e}')
        raise SystemExit(21)
    icloudpd_bin = icloudpd_binary()
    if not icloudpd_bin:
        log('ICLOUDPD_SETUP_MISSING: icloudpd not installed')
        raise SystemExit(21)
    if not APPLE_ID or not PASSWORD:
        log('ICLOUDPD_MISSING_APPLE_ID_PASSWORD')
        raise SystemExit(2)

    methods_file = RUNTIME_DIR / '2fa_methods.json'
    method_file = RUNTIME_DIR / '2fa_method_index.txt'
    code_file = RUNTIME_DIR / '2fa_code.txt'
    for f in [method_file, code_file]:
        try:
            f.unlink()
        except FileNotFoundError:
            pass
        except Exception:
            pass

    cookie_dir = RUNTIME_DIR / 'icloudpd_cookies'
    download_dir = DOWNLOADS_DIR / 'icloudpd_auth_probe'
    cookie_dir.mkdir(parents=True, exist_ok=True)
    download_dir.mkdir(parents=True, exist_ok=True)
    # Fresh login should not reuse a stale/incomplete cookie from a previous failed attempt.
    for stale in cookie_dir.glob('*'):
        try:
            if stale.is_file():
                stale.unlink()
            elif stale.is_dir():
                shutil.rmtree(stale)
        except Exception:
            pass

    cmd = [
        icloudpd_bin,
        '--username', APPLE_ID,
        '--password', PASSWORD,
        '--password-provider', 'parameter',
        '--mfa-provider', 'console',
        '--directory', str(download_dir),
        '--cookie-directory', str(cookie_dir),
        '--auth-only',
        '--no-progress-bar',
        '--log-level', 'debug',
    ]
    log(f'ICLOUDPD_AUTH_START as {APPLE_ID[:2]}***')
    child = pexpect.spawn(cmd[0], cmd[1:], encoding='utf-8', timeout=1, echo=False)
    methods_by_idx = {}
    selected_sent = False
    default_delivery_announced = False
    code_sent = False
    fatal_auth_error = False
    saw_mfa = False
    mfa_seen_at = None
    buffer = ''
    deadline = time.time() + 300
    while time.time() < deadline:
        try:
            chunk = child.read_nonblocking(size=4096, timeout=1)
        except pexpect.TIMEOUT:
            chunk = ''
        except pexpect.EOF:
            break
        if chunk:
            buffer += chunk
            lines = re.split(r'\r?\n', buffer)
            buffer = lines.pop() if lines else ''
            for raw in lines:
                line = raw.strip()
                if not line:
                    continue
                lower = line.lower()
                redacted = redact_log_line(line)
                # Keep logs useful but avoid dumping password/email; icloudpd does not print passwords normally.
                log('ICLOUDPD ' + redacted[:500])
                if 'invalid email/password combination' in lower or 'check the account information you entered' in lower:
                    fatal_auth_error = True
                if any(x in lower for x in ['two-factor', 'two factor', 'verification code', 'mfa', 'trusted phone', 'device index']):
                    saw_mfa = True
                    if mfa_seen_at is None:
                        mfa_seen_at = time.time()
                method = parse_icloudpd_method_line(line)
                if method and not code_sent:
                    methods_by_idx[method['index']] = method
                    methods = [methods_by_idx[k] for k in sorted(methods_by_idx)]
                    write_json(methods_file, {'selectable': True, 'delivery': 'icloudpd_console', 'methods': methods, 'createdAt': int(time.time()*1000)})
                    log(f"2FA_METHOD {method['index']}: {method['label']}")
        if methods_by_idx and not selected_sent:
            chosen = wait_for_dashboard_method([methods_by_idx[k] for k in sorted(methods_by_idx)], method_file, timeout=1)
            if chosen:
                token = chosen.get('token') or method_token_for_index(int(chosen['index']))
                child.sendline(str(token))
                selected_sent = True
                log(f"2FA_METHOD_SENT index={chosen['index']}")
        # Some icloudpd flows ask for a code after a default trusted-device delivery.
        # Do NOT mark selected_sent immediately when the first 2FA line appears: icloudpd often
        # prints selectable SMS choices 1-2 seconds later. Wait briefly before falling back.
        if saw_mfa and not methods_by_idx and not default_delivery_announced and mfa_seen_at and (time.time() - mfa_seen_at) > 3:
            write_json(methods_file, {'selectable': False, 'delivery': 'icloudpd_default', 'methods': [], 'createdAt': int(time.time()*1000)})
            default_delivery_announced = True
            log('2FA_PUSH_OR_DEFAULT: icloudpd is waiting for verification code. Submit code in dashboard.')
        if (selected_sent or default_delivery_announced) and not code_sent:
            code = wait_for_dashboard_code(code_file, timeout=1)
            if code:
                child.sendline(code)
                code_sent = True
                log('2FA_CODE_SENT_TO_ICLOUDPD')
    try:
        child.expect(pexpect.EOF, timeout=2)
    except Exception:
        pass
    rc = child.exitstatus if child.exitstatus is not None else child.signalstatus
    if rc == 0:
        if fatal_auth_error or not valid_icloudpd_session(cookie_dir):
            log('ICLOUDPD_AUTH_INCOMPLETE_OR_REJECTED: Apple did not provide a valid authenticated session')
            raise SystemExit(1)
        save_runtime_account()
        for f in [code_file, method_file]:
            try:
                f.unlink()
            except FileNotFoundError:
                pass
            except Exception:
                pass
        log('ICLOUDPD_AUTH_OK')
        return True
    if methods_by_idx and not selected_sent:
        log('ICLOUDPD_2FA_METHOD_TIMEOUT')
        raise SystemExit(20)
    if selected_sent and not code_sent:
        log('ICLOUDPD_2FA_CODE_TIMEOUT')
        raise SystemExit(20)
    log(f'ICLOUDPD_AUTH_FAILED rc={rc}')
    raise SystemExit(1)


def classify_media_file(path):
    mime, _ = mimetypes.guess_type(str(path))
    mime = mime or ''
    lower = path.name.lower()
    is_video = mime.startswith('video/') or lower.endswith(('.mp4', '.mov', '.m4v', '.3gp', '.avi', '.mkv'))
    return 'videos' if is_video else 'photos', mime or ('video/*' if is_video else 'image/*')


def collect_downloaded_icloudpd_media(media_dir):
    photos, videos = [], []
    if not media_dir.exists():
        return photos, videos
    files = [p for p in media_dir.rglob('*') if p.is_file() and not p.name.startswith('.')]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[:max(RECENT * 2, RECENT)]:
        section, mime = classify_media_file(p)
        st = p.stat()
        item = {
            'id': safe_str(str(p.relative_to(media_dir))),
            'name': safe_str(p.name),
            'path': safe_str(str(p.relative_to(media_dir))),
            'mime': mime,
            'size': st.st_size,
            'date': int(st.st_mtime * 1000),
            'ts': int(time.time() * 1000),
            'source': 'icloudpd'
        }
        (videos if section == 'videos' else photos).append(item)
    return photos[:RECENT], videos[:RECENT]


def sync_with_icloudpd_cached():
    username = load_runtime_account()
    if not username:
        log('ICLOUDPD_SYNC_NO_ACCOUNT: run iCloud login once before passwordless sync')
        raise SystemExit(2)
    bin_path = icloudpd_binary()
    if not bin_path:
        log('ICLOUDPD_SETUP_MISSING: icloudpd not installed')
        raise SystemExit(21)
    cookie_dir = RUNTIME_DIR / 'icloudpd_cookies'
    media_dir = DOWNLOADS_DIR / 'icloudpd_media'
    cookie_dir.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        bin_path,
        '--username', username,
        '--directory', str(media_dir),
        '--cookie-directory', str(cookie_dir),
        '--recent', str(RECENT),
        '--folder-structure', 'none',
        '--no-progress-bar',
        '--log-level', 'info',
    ]
    log(f'ICLOUDPD_SYNC_START as {mask_apple_id(username)} recent={RECENT}')
    try:
        proc = subprocess.run(cmd, cwd=str(DATA_DIR), text=True, input='', capture_output=True, timeout=900)
    except subprocess.TimeoutExpired:
        log('ICLOUDPD_SYNC_TIMEOUT')
        raise SystemExit(1)
    for line in (proc.stdout or '').splitlines()[-120:]:
        if line.strip():
            log('ICLOUDPD ' + redact_log_line(line)[:500])
    for line in (proc.stderr or '').splitlines()[-80:]:
        if line.strip():
            log('ICLOUDPD_ERR ' + redact_log_line(line)[:500])
    if proc.returncode != 0:
        log(f'ICLOUDPD_SYNC_FAILED rc={proc.returncode}')
        raise SystemExit(20 if 'two-factor' in ((proc.stdout or '') + (proc.stderr or '')).lower() else 1)
    photos, videos = collect_downloaded_icloudpd_media(media_dir)
    totals = {}
    if 'photos' in SECTIONS:
        write_json(META_DIR / 'photos.json', photos); totals['photos'] = len(photos)
    if 'videos' in SECTIONS:
        write_json(META_DIR / 'videos.json', videos); totals['videos'] = len(videos)
    for section in ['drive', 'contacts', 'calendar', 'devices', 'reminders']:
        if section in SECTIONS:
            existing = META_DIR / f'{section}.json'
            if not existing.exists():
                write_json(existing, [])
            totals[section] = len(json.loads(existing.read_text(encoding='utf-8')))
            log(f'{section.upper()}_UNAVAILABLE_WITH_ICLOUDPD_COOKIE_ONLY')
    log('ICLOUDPD_SYNC_OK ' + json.dumps(totals, ensure_ascii=False))
    return 0


def require_pyicloud():
    try:
        from pyicloud import PyiCloudService  # type: ignore
        return PyiCloudService
    except Exception as e:
        log(f'PYICLOUD_MISSING: {e}')
        log('Install server dependency in a venv or system env: python3 -m pip install pyicloud')
        raise SystemExit(21)


def login():
    PyiCloudService = require_pyicloud()
    if not APPLE_ID or not PASSWORD:
        log('Missing APPLE_ID/PASSWORD for a new iCloud session. Existing cookies may still work only with pyicloud session support.')
        raise SystemExit(2)
    cookie_dir = RUNTIME_DIR / 'cookies'
    cookie_dir.mkdir(parents=True, exist_ok=True)
    log(f'Logging in to iCloud as {APPLE_ID[:2]}***')
    try:
        try:
            api = PyiCloudService(APPLE_ID, PASSWORD, cookie_directory=str(cookie_dir))
        except TypeError:
            api = PyiCloudService(APPLE_ID, PASSWORD)
    except Exception as e:
        log(f'PYICLOUD_LOGIN_FAILED_BEFORE_2FA: {e!r}')
        log('Trying icloudpd fallback to expose selectable SMS/trusted-number methods.')
        login_with_icloudpd_auth_only()
        # Auth-only fallback succeeded. pyicloud may still be unable to reuse the session on this IP,
        # so ACTION=auth exits successfully after creating icloudpd cookies.
        if ACTION == 'auth':
            return None
        raise SystemExit(20)
    save_runtime_account()
    if getattr(api, 'requires_2fa', False) or getattr(api, 'requires_2sa', False):
        code_file = RUNTIME_DIR / '2fa_code.txt'
        method_file = RUNTIME_DIR / '2fa_method_index.txt'
        methods_file = RUNTIME_DIR / '2fa_methods.json'
        trusted = []
        delivery = safe_str(getattr(api, 'two_factor_delivery_method', 'unknown'))
        selectable_legacy = bool(getattr(api, 'requires_2sa', False) and not getattr(api, 'requires_2fa', False))
        if selectable_legacy:
            try:
                trusted = getattr(api, 'trusted_devices', []) or []
            except Exception as e:
                log(f'2FA_METHOD_LIST_ERROR: {e}')
                trusted = []
        log(f'2FA_REQUIRED delivery={delivery} selectable={bool(selectable_legacy and trusted)}')
        validate_with = None
        if selectable_legacy and trusted:
            methods = [describe_trusted_device(d, i) for i, d in enumerate(trusted)]
            write_json(methods_file, {'selectable': True, 'delivery': delivery, 'methods': methods, 'createdAt': int(time.time() * 1000)})
            for m in methods:
                log(f"2FA_METHOD {m['index']}: {m['label']}")
            selected = int(METHOD_INDEX) if METHOD_INDEX.strip().isdigit() else None
            deadline_select = time.time() + 180
            while selected is None and time.time() < deadline_select:
                if method_file.exists():
                    raw = method_file.read_text(encoding='utf-8').strip()
                    try:
                        method_file.unlink()
                    except Exception:
                        pass
                    if raw.isdigit():
                        selected = int(raw)
                        break
                time.sleep(1)
            if selected is None or selected < 0 or selected >= len(trusted):
                log('2FA_METHOD_TIMEOUT_OR_INVALID')
                raise SystemExit(20)
            try:
                ok = api.send_verification_code(trusted[selected])
                log(f'2FA_SENT method={selected} ok={ok}')
            except Exception as e:
                log(f'2FA_SEND_ERROR: {e}')
            validate_with = trusted[selected]
        else:
            # HSA2 trusted-device push normally appears automatically on Apple devices.
            # Do not show method selection; wait for the code the user sees.
            write_json(methods_file, {'selectable': False, 'delivery': delivery, 'methods': [], 'createdAt': int(time.time() * 1000)})
            log('2FA_PUSH_OR_DEFAULT: code should appear on trusted Apple device or default delivery. Submit code in dashboard.')
        deadline = time.time() + 180
        while time.time() < deadline:
            if code_file.exists():
                code = code_file.read_text(encoding='utf-8').strip()
                try:
                    code_file.unlink()
                except Exception:
                    pass
                if validate_with is not None:
                    ok = api.validate_verification_code(validate_with, code)
                else:
                    ok = api.validate_2fa_code(code)
                if not ok:
                    log('2FA_INVALID')
                    raise SystemExit(20)
                log('2FA_OK')
                break
            time.sleep(2)
        else:
            log('2FA_TIMEOUT')
            raise SystemExit(20)
    return api


def collect_photos(api):
    photos, videos = [], []
    try:
        iterator = api.photos.all
    except Exception as e:
        log(f'PHOTOS_UNAVAILABLE: {e}')
        return photos, videos
    count = 0
    for p in iterator:
        if count >= RECENT:
            break
        count += 1
        filename = safe_str(getattr(p, 'filename', '') or getattr(p, 'name', '') or f'photo_{count}')
        asset_date = getattr(p, 'asset_date', None) or getattr(p, 'created', None)
        size = getattr(p, 'size', None)
        mime = safe_str(getattr(p, 'mime_type', '') or getattr(p, 'type', ''))
        item = {
            'id': safe_str(getattr(p, 'id', '') or getattr(p, 'asset_id', '') or filename),
            'name': filename,
            'mime': mime,
            'size': size or 0,
            'date': item_ts(asset_date),
            'ts': int(time.time() * 1000),
            'source': 'icloud_photos'
        }
        lower = filename.lower()
        if mime.startswith('video/') or lower.endswith(('.mp4', '.mov', '.m4v', '.3gp')):
            videos.append(item)
        else:
            photos.append(item)
    return photos, videos


def collect_drive(api):
    items = []
    try:
        root = api.drive
    except Exception as e:
        log(f'DRIVE_UNAVAILABLE: {e}')
        return items
    def walk(node, prefix='', depth=0):
        if len(items) >= RECENT or depth > 6:
            return
        try:
            children = node.dir()
        except Exception:
            children = []
        for child in children:
            if len(items) >= RECENT:
                break
            name = safe_str(getattr(child, 'name', '') or str(child))
            path = f'{prefix}/{name}'.strip('/')
            is_dir = False
            try:
                is_dir = bool(child.dir())
            except Exception:
                is_dir = False
            items.append({
                'id': path,
                'name': name,
                'path': path,
                'type': 'folder' if is_dir else 'file',
                'size': getattr(child, 'size', 0) or 0,
                'date': item_ts(getattr(child, 'date_modified', None)),
                'ts': int(time.time() * 1000)
            })
            if is_dir:
                walk(child, path, depth + 1)
    walk(root)
    return items


def collect_contacts(api):
    try:
        contacts = api.contacts.all()
    except Exception as e:
        log(f'CONTACTS_UNAVAILABLE: {e}')
        return []
    out = []
    for i, c in enumerate(contacts[:RECENT] if isinstance(contacts, list) else contacts):
        if i >= RECENT:
            break
        first = safe_str(c.get('firstName') or c.get('first') or '') if isinstance(c, dict) else safe_str(getattr(c, 'firstName', ''))
        last = safe_str(c.get('lastName') or c.get('last') or '') if isinstance(c, dict) else safe_str(getattr(c, 'lastName', ''))
        phones = c.get('phones') if isinstance(c, dict) else getattr(c, 'phones', [])
        emails = c.get('emails') if isinstance(c, dict) else getattr(c, 'emails', [])
        out.append({'id': safe_str(c.get('contactId') or c.get('id') or i) if isinstance(c, dict) else str(i), 'name': (first + ' ' + last).strip() or 'Senza nome', 'phones': phones or [], 'emails': emails or [], 'ts': int(time.time() * 1000)})
    return out


def collect_devices(api):
    out = []
    try:
        devices = api.devices
    except Exception as e:
        log(f'DEVICES_UNAVAILABLE: {e}')
        return out
    for i, d in enumerate(devices):
        if i >= RECENT:
            break
        try:
            data = d.data
        except Exception:
            data = d if isinstance(d, dict) else {}
        out.append({'id': safe_str(data.get('id') or data.get('deviceDisplayName') or i), 'name': safe_str(data.get('name') or data.get('deviceDisplayName') or data.get('deviceName') or 'Apple device'), 'model': safe_str(data.get('deviceModel') or data.get('rawDeviceModel') or data.get('deviceClass') or ''), 'battery': data.get('batteryLevel'), 'status': safe_str(data.get('deviceStatus') or ''), 'ts': int(time.time() * 1000)})
    return out


def collect_calendar(api):
    try:
        cal = api.calendar.events()
    except Exception as e:
        log(f'CALENDAR_UNAVAILABLE: {e}')
        return []
    out = []
    for i, e in enumerate(cal[:RECENT] if isinstance(cal, list) else cal):
        if i >= RECENT:
            break
        out.append({'id': safe_str(e.get('guid') or e.get('id') or i) if isinstance(e, dict) else str(i), 'title': safe_str(e.get('title') or e.get('summary') or 'Evento') if isinstance(e, dict) else safe_str(getattr(e, 'title', 'Evento')), 'date': item_ts(e.get('startDate') if isinstance(e, dict) else getattr(e, 'startDate', None)), 'ts': int(time.time() * 1000)})
    return out


def collect_reminders(api):
    try:
        rem = api.reminders.all()
    except Exception as e:
        log(f'REMINDERS_UNAVAILABLE: {e}')
        return []
    out = []
    for i, r in enumerate(rem[:RECENT] if isinstance(rem, list) else rem):
        if i >= RECENT:
            break
        out.append({'id': safe_str(r.get('guid') or r.get('id') or i) if isinstance(r, dict) else str(i), 'title': safe_str(r.get('title') or r.get('name') or 'Promemoria') if isinstance(r, dict) else safe_str(getattr(r, 'title', 'Promemoria')), 'completed': bool(r.get('completed')) if isinstance(r, dict) else bool(getattr(r, 'completed', False)), 'ts': int(time.time() * 1000)})
    return out


def main():
    if ACTION == 'sync' and (not APPLE_ID or not PASSWORD):
        return sync_with_icloudpd_cached()
    api = login()
    if ACTION == 'auth':
        if api is not None:
            write_json(META_DIR / 'devices.json', collect_devices(api))
        log('AUTH_OK')
        return 0
    totals = {}
    if 'photos' in SECTIONS or 'videos' in SECTIONS:
        photos, videos = collect_photos(api)
        if 'photos' in SECTIONS:
            write_json(META_DIR / 'photos.json', photos); totals['photos'] = len(photos)
        if 'videos' in SECTIONS:
            write_json(META_DIR / 'videos.json', videos); totals['videos'] = len(videos)
    if 'drive' in SECTIONS:
        data = collect_drive(api); write_json(META_DIR / 'drive.json', data); totals['drive'] = len(data)
    if 'contacts' in SECTIONS:
        data = collect_contacts(api); write_json(META_DIR / 'contacts.json', data); totals['contacts'] = len(data)
    if 'calendar' in SECTIONS:
        data = collect_calendar(api); write_json(META_DIR / 'calendar.json', data); totals['calendar'] = len(data)
    if 'devices' in SECTIONS:
        data = collect_devices(api); write_json(META_DIR / 'devices.json', data); totals['devices'] = len(data)
    if 'reminders' in SECTIONS:
        data = collect_reminders(api); write_json(META_DIR / 'reminders.json', data); totals['reminders'] = len(data)
    log('SYNC_OK ' + json.dumps(totals, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:
        log('FATAL: ' + repr(e))
        raise SystemExit(1)
