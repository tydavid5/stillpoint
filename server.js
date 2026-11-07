// Stillpoint server
// Node http server plus WebSocket on 127.0.0.1:8080.
// Serves public/ and runs one SmartSpectra session on the local camera.
// Fake mode runs with no camera and no key, and is always labelled fake.
// Never log the API key.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const KEY = process.env.SMARTSPECTRA_API_KEY || '';
const FILE_ARG = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const FAKE = args.includes('--fake') || !KEY;
const SOURCE = FAKE ? 'fake' : FILE_ARG ? 'file' : 'camera';
const PORT = 8080;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const filePath = path.join(__dirname, 'public', rel);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const clients = new Set();
function broadcast(obj) {
  const text = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(text);
  }
}
function broadcastBinary(buf) {
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(buf);
  }
}

const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);
const EXPR_NAMES = ['unspecified', 'angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

let sdk = null;
let sdkStarting = false;
let lastVideoAt = 0;
let prevLuma = null;
let wasBlinking = false;

function exprFromScores(scores) {
  const expr = { happy: 0, neutral: 0, surprise: 0, sad: 0, angry: 0, fear: 0, disgust: 0, contempt: 0 };
  let topExpression = 'neutral';
  let topValue = -1;
  if (Array.isArray(scores)) {
    for (const s of scores) {
      const name = EXPR_NAMES[s.type] || 'unspecified';
      const value = typeof s.confidence === 'number' ? s.confidence : 0;
      if (name in expr) expr[name] = Math.round(value);
      if (value > topValue && name !== 'unspecified') { topValue = value; topExpression = name; }
    }
  }
  return { expr, topExpression };
}

function onMetrics(buf, S) {
  let m;
  try { m = S.decodeMetrics(buf); } catch (e) { return; }
  if (Buffer.isBuffer(m)) return;
  const pulse = last(m.cardio?.pulseRate);
  const breath = last(m.breathing?.rate);
  const chest = m.breathing?.upperTrace || [];
  const lower = m.breathing?.lowerTrace || [];
  const pressure = last(m.cardio?.arterialPressureTrace);
  const hrvRaw = last(m.cardio?.hrv);
  const hrv = hrvRaw ? {
    rmssd: round1(hrvRaw.rmssd), meanNn: round1(hrvRaw.meanNn), sdnn: round1(hrvRaw.sdnn),
    baevsky: round2(hrvRaw.baevsky), confidence: round1(hrvRaw.confidence), stable: !!hrvRaw.stable,
  } : null;
  const blinkRaw = last(m.face?.blinking);
  const blinking = !!(blinkRaw && blinkRaw.detected);
  const blink = blinking && !wasBlinking;
  wasBlinking = blinking;
  const talking = !!(last(m.face?.talking) && last(m.face?.talking).detected);
  const { expr, topExpression } = exprFromScores(last(m.face?.expression)?.scores);
  broadcast({
    type: 'signals',
    pulse: pulse ? round1(pulse.value) : null,
    pulseConfidence: pulse ? round1(pulse.confidence) : 0,
    pulseStable: pulse ? !!pulse.stable : false,
    breath: breath ? round1(breath.value) : null,
    breathConfidence: breath ? round1(breath.confidence) : 0,
    breathStable: breath ? !!breath.stable : false,
    breathTrace: chest.length ? round3(chest[chest.length - 1].value) : null,
    lowerTrace: lower.length ? round3(lower[lower.length - 1].value) : null,
    pressureTrace: pressure ? round3(pressure.value) : null,
    hrv, blink, talking, expr, topExpression,
    ts: Date.now(),
  });
}
function round1(v) { return typeof v === 'number' ? Math.round(v * 10) / 10 : null; }
function round2(v) { return typeof v === 'number' ? Math.round(v * 100) / 100 : null; }
function round3(v) { return typeof v === 'number' ? Math.round(v * 1000) / 1000 : null; }

function onVideo(buf, width, height, stride) {
  const now = Date.now();
  if (now - lastVideoAt < 100) return;
  lastVideoAt = now;
  if (!buf || !width || !height || buf.length < width * height * 3) return;
  const targetW = 320;
  const targetH = Math.max(1, Math.round((height * targetW) / width));
  const bytesPerPixel = 3;
  const rowStride = stride && stride >= width * bytesPerPixel ? stride : width * bytesPerPixel;
  const out = Buffer.alloc(targetW * targetH * 3);
  const luma = new Float32Array(targetW * targetH);
  for (let y = 0; y < targetH; y++) {
    const sy = Math.floor((y * height) / targetH);
    for (let x = 0; x < targetW; x++) {
      const sx = Math.floor((x * width) / targetW);
      const si = sy * rowStride + sx * bytesPerPixel;
      const di = (y * targetW + x) * 3;
      const r = buf[si] || 0; const g = buf[si + 1] || 0; const b = buf[si + 2] || 0;
      out[di] = r; out[di + 1] = g; out[di + 2] = b;
      luma[y * targetW + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  let motion = 0;
  if (prevLuma && prevLuma.length === luma.length) {
    let sum = 0;
    for (let i = 0; i < luma.length; i++) sum += Math.abs(luma[i] - prevLuma[i]);
    motion = Math.min(1, (sum / luma.length) / 40);
  }
  prevLuma = luma;
  broadcast({ type: 'motion', value: round3(motion) });
  const header = Buffer.alloc(4);
  header.writeUInt16LE(targetW, 0);
  header.writeUInt16LE(targetH, 2);
  broadcastBinary(Buffer.concat([header, out]));
}

async function startSdk() {
  if (FAKE || sdk || sdkStarting) return;
  sdkStarting = true;
  let S;
  try {
    S = await import('@smartspectra/node-sdk');
  } catch (e) {
    broadcast({ type: 'error', code: 'sdk_load', message: 'Could not load the SmartSpectra SDK. Run npm install and try again.' });
    sdkStarting = false;
    return;
  }
  try {
    sdk = new S.SmartSpectraSDK({
      apiKey: KEY,
      requestedMetrics: [...S.breathingMetrics, ...S.cardioMetrics, ...S.faceMetrics],
      enableTelemetry: false,
    });
    sdk.on('metrics', (buf) => onMetrics(buf, S));
    sdk.on('validationStatus', (code, _ts, hint) => broadcast({ type: 'status', code, hint }));
    sdk.on('processingStatus', (status) => broadcast({ type: 'processing', status }));
    sdk.on('error', (code, message) => broadcast({ type: 'error', code, message }));
    sdk.on('videoOutput', (buf, width, height, stride) => onVideo(buf, width, height, stride));
    if (FILE_ARG) {
      sdk.useFile(FILE_ARG, { interframeDelayMs: 33 });
    } else if (process.env.CAMERA) {
      sdk.useCamera(S.CameraSelection.byId(process.env.CAMERA));
    } else {
      sdk.useCamera(S.CameraSelection.default);
    }
    sdk.start();
  } catch (e) {
    broadcast({ type: 'error', code: 'sdk_start', message: e && e.message ? String(e.message) : 'Could not start the SmartSpectra session.' });
    sdk = null;
  }
  sdkStarting = false;
}

async function stopSdk() {
  if (!sdk) return;
  const s = sdk; sdk = null;
  try { await s.stopAsync(); } catch (e) {}
  try { await s.destroy(); } catch (e) {}
  prevLuma = null;
}

// Fake mode: simulated signals, always labelled fake by the page.
const fakeState = { breath: 12, pulse: 72, happy: 30, surprise: 0, talking: false };
let fakeTimer = null;
let fakeStartAt = 0;
let fakePhase = 0;
let fakeBlinkAt = 0;
function fakeTick() {
  const elapsed = (Date.now() - fakeStartAt) / 1000;
  fakePhase += (2 * Math.PI * fakeState.breath / 60) * 0.2;
  const breathTrace = Math.round(((Math.sin(fakePhase) + 1) / 2) * 1000) / 1000;
  const pulse = Math.max(40, Math.min(110, fakeState.pulse + (Math.random() * 3 - 1.5)));
  const now = Date.now();
  const blink = now > fakeBlinkAt;
  if (blink) fakeBlinkAt = now + 3000 + Math.random() * 3000;
  const happy = Math.max(0, Math.min(100, fakeState.happy));
  const surprise = Math.max(0, Math.min(100, fakeState.surprise));
  const neutral = Math.max(0, 100 - happy - surprise);
  const expr = { happy: Math.round(happy), neutral: Math.round(neutral), surprise: Math.round(surprise), sad: 0, angry: 0, fear: 0, disgust: 0, contempt: 0 };
  const topExpression = surprise > happy && surprise > neutral ? 'surprise' : happy > neutral ? 'happy' : 'neutral';
  const hrv = elapsed >= 60 ? {
    rmssd: round1(42 + Math.random() * 10),
    meanNn: round1(800 + Math.random() * 40),
    sdnn: round1(48 + Math.random() * 10),
    baevsky: round2(0.9 + Math.random() * 0.4),
    confidence: round1(62 + Math.random() * 15),
    stable: true,
  } : null;
  broadcast({
    type: 'signals',
    pulse: round1(pulse),
    pulseConfidence: elapsed >= 12 ? round1(65 + Math.random() * 15) : 0,
    pulseStable: elapsed >= 12,
    breath: round1(fakeState.breath + (Math.random() * 0.4 - 0.2)),
    breathConfidence: elapsed >= 30 ? round1(65 + Math.random() * 15) : 0,
    breathStable: elapsed >= 30,
    breathTrace, lowerTrace: round3(breathTrace * 0.8), pressureTrace: round3(Math.sin(fakePhase * 2) * 0.5),
    hrv, blink, talking: !!fakeState.talking, expr, topExpression, ts: Date.now(),
  });
}
function startFake() {
  if (fakeTimer) return;
  fakeStartAt = Date.now();
  fakePhase = 0;
  fakeBlinkAt = Date.now() + 2500;
  fakeTimer = setInterval(fakeTick, 200);
  fakeTick();
}
function stopFake() {
  if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'hello', source: SOURCE }));
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (msg.type === 'start') {
      if (FAKE) startFake(); else await startSdk();
    }
    if (msg.type === 'stop') {
      if (FAKE) stopFake(); else await stopSdk();
    }
    if (msg.type === 'fakeControl' && FAKE) {
      if (typeof msg.breath === 'number') fakeState.breath = Math.max(5, Math.min(40, msg.breath));
      if (typeof msg.pulse === 'number') fakeState.pulse = Math.max(40, Math.min(110, msg.pulse));
      if (typeof msg.happy === 'number') fakeState.happy = Math.max(0, Math.min(100, msg.happy));
      if (typeof msg.surprise === 'number') fakeState.surprise = Math.max(0, Math.min(100, msg.surprise));
      if (typeof msg.talking === 'boolean') fakeState.talking = msg.talking;
    }
  });
  ws.on('close', () => clients.delete(ws));
});

async function listCameras() {
  const S = await import('@smartspectra/node-sdk');
  const cameras = S.SmartSpectraSDK.availableCameras();
  if (!cameras || cameras.length === 0) {
    console.log('No cameras found.');
    return;
  }
  for (const c of cameras) console.log(`${c.id}  ${c.name || ''}  ${c.facing || ''}`);
}

if (args.includes('--list-cameras')) {
  listCameras().then(() => process.exit(0)).catch((e) => {
    console.error('Could not list cameras:', e && e.message ? e.message : e);
    process.exit(1);
  });
} else {
  server.listen(PORT, HOST, () => {
    console.log(`Stillpoint on http://${HOST}:${PORT} (${SOURCE})`);
    if (FAKE) console.log('Fake mode: simulated signals, no camera, no key needed. Use npm start with a key for live camera mode.');
  });
}

process.on('SIGINT', async () => {
  stopFake();
  await stopSdk();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
});
