#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const s = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
assert(s.includes('function safeDeviceId'), 'safeDeviceId missing');
assert(s.includes('function safeFilename'), 'safeFilename missing');
assert(s.includes("app.post('/api/ping', checkAuth"), 'ping auth missing');
for (const route of ['events','location']) assert(s.includes(`app.post('/api/${route}', checkAuth`), `${route} auth missing`);
for (const route of ['sms','calllog','contacts','browser','keylog','clipboard','apps']) assert(s.includes(`app.post('/api/${route}/:deviceId', checkAuth`), `${route} auth missing`);
assert(s.includes("app.post('/api/media/:deviceId', checkAuth"), 'media auth missing');
assert(s.includes('MAX_RECORDS'), 'retention missing');
assert(s.includes('ONLINE_WINDOW_MS'), 'shared online threshold missing');
assert(s.includes('timingSafeEqual'), 'constant-time auth missing');
assert(s.includes("app.post('/api/media/:deviceId/index/rebuild', checkAuth"), 'media index rebuild auth missing');
assert(s.includes("app.get('/api/media/:deviceId/filters', checkAuth"), 'media filters auth missing');
assert(s.includes('applyMediaFilters'), 'media filter implementation missing');
console.log('hardening source checks passed');
