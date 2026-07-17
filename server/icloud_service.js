'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function readJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function safeSection(value) {
  const s = String(value || '');
  if (!/^(photos|videos|drive|contacts|calendar|devices|reminders)$/.test(s)) throw new Error('invalid section');
  return s;
}
function safeJobId(value) {
  const s = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(s)) throw new Error('invalid jobId');
  return s;
}
function maskAppleId(value) {
  const s = String(value || '');
  const at = s.indexOf('@');
  if (at < 0) return s ? `${s.slice(0, 2)}***` : '';
  return `${s.slice(0, Math.min(2, at))}***${s.slice(at)}`;
}
function nowIso() { return new Date().toISOString(); }

function createICloudService({ app, checkAuth, DATA_DIR, broadcast }) {
  const root = path.join(DATA_DIR, 'icloud');
  const runtimeDir = path.join(root, 'runtime');
  const metaDir = path.join(root, 'meta');
  const downloadsDir = path.join(root, 'downloads');
  const stateFile = path.join(root, 'state.json');
  const jobs = new Map();
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });

  function defaultState() {
    return {
      configured: false,
      account: '',
      status: 'idle',
      lastAuthAt: null,
      lastSyncAt: null,
      activeJobId: null,
      totals: { photos: 0, videos: 0, drive: 0, contacts: 0, calendar: 0, devices: 0, reminders: 0 },
      sections: {
        photos: { label: 'Foto', count: 0 },
        videos: { label: 'Video', count: 0 },
        drive: { label: 'iCloud Drive', count: 0 },
        contacts: { label: 'Contatti', count: 0 },
        calendar: { label: 'Calendario', count: 0 },
        devices: { label: 'Dispositivi', count: 0 },
        reminders: { label: 'Promemoria', count: 0 }
      },
      note: 'iCloud connector pronto. Le credenziali Apple ID non vengono salvate dal server.'
    };
  }
  function loadState() { return { ...defaultState(), ...readJSON(stateFile, {}) }; }
  function saveState(patch) {
    const current = loadState();
    const next = { ...current, ...patch };
    writeJSON(stateFile, next);
    return next;
  }
  function appendJobLog(jobId, line) {
    const id = safeJobId(jobId);
    const file = path.join(root, 'jobs', `${id}.log`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `[${nowIso()}] ${String(line).replace(/[\r\n]+/g, ' ').slice(0, 2000)}\n`);
  }
  function getJob(jobId) {
    const id = safeJobId(jobId);
    return jobs.get(id) || readJSON(path.join(root, 'jobs', `${id}.json`), null);
  }
  function saveJob(job) {
    jobs.set(job.id, job);
    writeJSON(path.join(root, 'jobs', `${job.id}.json`), job);
    saveState({ status: job.status, activeJobId: job.id });
    broadcast('icloud_update', { jobId: job.id, status: job.status, action: job.action });
  }
  function recomputeTotals() {
    const totals = {};
    const sections = loadState().sections || defaultState().sections;
    for (const section of Object.keys(defaultState().sections)) {
      const data = readJSON(path.join(metaDir, `${section}.json`), []);
      totals[section] = Array.isArray(data) ? data.length : 0;
      sections[section] = { ...(sections[section] || {}), count: totals[section] };
    }
    saveState({ totals, sections });
    return totals;
  }
  function spawnConnector(action, payload) {
    const jobId = crypto.randomUUID();
    const job = { id: jobId, action, status: 'running', startedAt: Date.now(), finishedAt: null, exitCode: null };
    saveJob(job);
    appendJobLog(jobId, `${action} started`);

    const env = {
      ...process.env,
      ICLOUD_DATA_DIR: root,
      ICLOUD_META_DIR: metaDir,
      ICLOUD_DOWNLOADS_DIR: downloadsDir,
      ICLOUD_ACTION: action,
      ICLOUD_APPLE_ID: payload.appleId || '',
      ICLOUD_PASSWORD: payload.password || '',
      ICLOUD_SECTIONS: (payload.sections || []).join(','),
      ICLOUD_RECENT: String(payload.recent || 250)
    };
    const pythonBin = fs.existsSync(path.join(__dirname, '.venv', 'bin', 'python'))
      ? path.join(__dirname, '.venv', 'bin', 'python')
      : 'python3';
    const child = spawn(pythonBin, [path.join(__dirname, 'scripts', 'icloud_connector.py')], {
      cwd: __dirname,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(line => appendJobLog(jobId, line)));
    child.stderr.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(line => appendJobLog(jobId, `ERR ${line}`)));
    child.on('error', err => {
      job.status = 'error'; job.error = err.message; job.finishedAt = Date.now(); saveJob(job); appendJobLog(jobId, `spawn error: ${err.message}`);
    });
    child.on('close', code => {
      const next = { ...job, exitCode: code, finishedAt: Date.now(), status: code === 0 ? 'done' : (code === 20 ? 'needs_2fa' : code === 21 ? 'needs_setup' : 'error') };
      if (next.status === 'done') {
        next.totals = recomputeTotals();
        const patch = action === 'auth'
          ? { configured: true, account: maskAppleId(payload.appleId), status: 'idle', lastAuthAt: Date.now(), activeJobId: null }
          : { status: 'idle', lastSyncAt: Date.now(), activeJobId: null };
        saveState(patch);
      } else {
        saveState({ status: next.status, activeJobId: next.id, account: payload.appleId ? maskAppleId(payload.appleId) : loadState().account });
      }
      saveJob(next);
      appendJobLog(jobId, `${action} finished with code ${code}`);
    });
    return job;
  }

  app.get('/api/icloud/status', checkAuth, (req, res) => {
    const state = loadState();
    res.json({ ...state, totals: recomputeTotals() });
  });

  app.get('/api/icloud/items', checkAuth, (req, res) => {
    const section = safeSection(req.query.section || 'photos');
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10)));
    const items = readJSON(path.join(metaDir, `${section}.json`), []);
    const sorted = Array.isArray(items) ? [...items].sort((a, b) => (b.ts || b.date || 0) - (a.ts || a.date || 0)) : [];
    const start = (page - 1) * limit;
    res.json({ section, total: sorted.length, items: sorted.slice(start, start + limit) });
  });

  app.post('/api/icloud/login', checkAuth, (req, res) => {
    const { appleId, password, recent } = req.body || {};
    if (!appleId || !password) return res.status(400).json({ ok: false, error: 'appleId and password required' });
    const job = spawnConnector('auth', { appleId, password, recent });
    res.json({ ok: true, jobId: job.id, message: 'iCloud auth job started' });
  });

  app.post('/api/icloud/sync', checkAuth, (req, res) => {
    const sections = Array.isArray(req.body?.sections) && req.body.sections.length ? req.body.sections.map(safeSection) : Object.keys(defaultState().sections);
    const { appleId, password, recent } = req.body || {};
    const job = spawnConnector('sync', { appleId, password, sections, recent });
    res.json({ ok: true, jobId: job.id, sections });
  });

  app.post('/api/icloud/2fa', checkAuth, (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (!/^\d{4,8}$/.test(code)) return res.status(400).json({ ok: false, error: 'invalid code' });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, '2fa_code.txt'), code);
    const state = loadState();
    if (state.activeJobId) appendJobLog(state.activeJobId, '2FA code submitted from dashboard');
    res.json({ ok: true });
  });

  app.get('/api/icloud/job/:jobId', checkAuth, (req, res) => {
    const id = safeJobId(req.params.jobId);
    const job = getJob(id);
    if (!job) return res.status(404).json({ ok: false, error: 'job not found' });
    const logFile = path.join(root, 'jobs', `${id}.log`);
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-200).join('\n') : '';
    res.json({ ...job, log });
  });

  app.get('/api/icloud/logs', checkAuth, (req, res) => {
    const dir = path.join(root, 'jobs');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.log')).sort().slice(-5) : [];
    const chunks = files.map(f => `--- ${f} ---\n${fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).slice(-80).join('\n')}`);
    res.json({ logs: chunks.join('\n') });
  });

  app.get('/api/icloud/file', checkAuth, (req, res) => {
    const section = safeSection(req.query.section || 'drive');
    const name = path.basename(String(req.query.name || ''));
    if (!name) return res.status(400).json({ error: 'name required' });
    const file = path.join(downloadsDir, section, name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
    res.sendFile(file);
  });
}

module.exports = { createICloudService };
