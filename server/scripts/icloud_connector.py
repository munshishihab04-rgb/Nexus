#!/usr/bin/env python3
"""Nexus iCloud connector.

This script is intentionally conservative:
- Apple ID password is read from environment only and never written to disk.
- Session/cookie files and synced metadata live under ICLOUD_DATA_DIR.
- If pyicloud is not installed or Apple requires 2FA, the script exits with a specific code
  so the dashboard can show the correct next step.
"""
import json
import os
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
        api = PyiCloudService(APPLE_ID, PASSWORD, cookie_directory=str(cookie_dir))
    except TypeError:
        api = PyiCloudService(APPLE_ID, PASSWORD)
    if getattr(api, 'requires_2fa', False):
        code_file = RUNTIME_DIR / '2fa_code.txt'
        trusted = getattr(api, 'trusted_devices', []) or []
        log('2FA_REQUIRED')
        for i, d in enumerate(trusted):
            label = d.get('phoneNumber') or d.get('deviceName') or d.get('name') or str(d)
            log(f'2FA_DEVICE {i}: {label}')
        if trusted:
            try:
                api.send_verification_code(trusted[0])
                log('2FA_SENT to first trusted method. Submit code in dashboard.')
            except Exception as e:
                log(f'2FA_SEND_ERROR: {e}')
        deadline = time.time() + 180
        while time.time() < deadline:
            if code_file.exists():
                code = code_file.read_text(encoding='utf-8').strip()
                try:
                    code_file.unlink()
                except Exception:
                    pass
                if trusted:
                    ok = api.validate_verification_code(trusted[0], code)
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
    api = login()
    if ACTION == 'auth':
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
