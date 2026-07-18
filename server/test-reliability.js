#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
assert(source.includes("app.get('/api/token', (req, res) => res.status(404)"), 'token endpoint must return 404');
assert(source.includes("app.post('/api/commands/:deviceId/:commandId/ack'"), 'command ACK route missing');
assert(source.includes("reliabilityProtocol"), 'protocol negotiation missing');
assert(source.includes("ackedAt"), 'ACK persistence missing');
assert(source.includes('renameSync'), 'atomic JSON persistence missing');
assert(source.includes("app.get('/api/token', (req, res) => res.status(404)"), 'token endpoint must return 404');
console.log('server reliability source checks passed');
