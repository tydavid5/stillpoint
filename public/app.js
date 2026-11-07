// Stillpoint page logic. No framework. All signals come over WebSocket from server.js.
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

let ws = null;
let source = 'unknown';
let sessionActive = false;
let sessionStartAt = 0;
let sessionSamples = [];
let talkingSeconds = 0;
let motionSeconds = 0;
let lastSignalAt = 0;
let breathTrace = 0.5;
let pulseGlow = 0;
let happyAvg = [];
let gardenGrowth = 0;
let talkingOn = false;
let fireflies = [];
for (let i = 0; i < 24; i++) fireflies.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() });

const garden = $('garden');
const gtx = garden.getContext('2d');
const preview = $('preview');
const ptx = preview.getContext('2d');

function connect() {
  ws = new WebSocket('ws://' + location.host);
  ws.onopen = () => {};
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'hello') onHello(msg);
      if (msg.type === 'signals') onSignals(msg);
      if (msg.type === 'status') $('statusHint').textContent = msg.hint || ('Camera: ' + msg.code);
      if (msg.type === 'motion') onMotion(msg.value);
      if (msg.type === 'error') $('statusHint').textContent = 'Error: ' + (msg.message || msg.code);
      if (msg.type === 'processing') $('statusHint').textContent = 'Camera status: ' + msg.status;
    } else {
      ev.data.arrayBuffer().then((buf) => drawPreview(new Uint8Array(buf)));
    }
  };
  ws.onclose = () => { setTimeout(connect, 2000); };
}

function onHello(msg) {
  source = msg.source || 'unknown';
  const isDemo = source === 'fake';
  $('demoBanner').hidden = !isDemo;
  $('demoControls').hidden = !isDemo;
  $('modeNote').textContent = isDemo
    ? 'Demo mode: the server has no API key, so this page shows simulated signals. Start live mode on a machine with a key to use the real camera.'
    : 'Live mode: source is ' + source + '. The camera starts only when you press Start.';
}

function onMotion(value) {
  $('motionValue').textContent = String(value == null ? 0 : value);
  if (sessionActive && value > 0.3) motionSeconds += 0.2;
}

function drawPreview(bytes) {
  if (bytes.length < 4) return;
  const w = bytes[0] | (bytes[1] << 8);
  const h = bytes[2] | (bytes[3] << 8);
  const rgb = bytes.slice(4);
  if (rgb.length < w * h * 3) return;
  const img = ptx.createImageData(w, h);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    img.data[j] = rgb[i]; img.data[j + 1] = rgb[i + 1]; img.data[j + 2] = rgb[i + 2]; img.data[j + 3] = 255;
  }
  preview.width = w; preview.height = h;
  ptx.putImageData(img, 0, 0);
}

function onSignals(m) {
  lastSignalAt = Date.now();
  if (typeof m.breathTrace === 'number') breathTrace = clamp(m.breathTrace, 0, 1);
  if (typeof m.pulse === 'number') pulseGlow = clamp((m.pulse - 50) / 60, 0, 1);
  $('pulseValue').textContent = m.pulse == null ? '--' : String(m.pulse);
  $('pulseConf').textContent = String(m.pulseConfidence || 0);
  $('breathValue').textContent = m.breath == null ? '--' : String(m.breath);
  $('breathConf').textContent = String(m.breathConfidence || 0);
  if (m.hrv) {
    $('hrvRmssd').textContent = String(m.hrv.rmssd) + ' ms';
    $('hrvSdnn').textContent = String(m.hrv.sdnn) + ' ms';
    $('hrvStress').textContent = String(m.hrv.baevsky);
    $('hrvConf').textContent = String(m.hrv.confidence);
  } else {
    $('hrvRmssd').textContent = 'Waiting until 60s';
    $('hrvSdnn').textContent = 'Waiting until 60s';
    $('hrvStress').textContent = 'Waiting until 60s';
    $('hrvConf').textContent = '0';
  }
  $('topExpr').textContent = m.topExpression || '--';
  $('blinkInd').textContent = m.blink ? 'Yes' : 'No';
  $('talkingInd').textContent = m.talking ? 'Yes' : 'No';
  if (m.expr && typeof m.expr.happy === 'number') happyAvg.push(m.expr.happy);
  if (sessionActive) {
    const t = (Date.now() - sessionStartAt) / 1000;
    sessionSamples.push({ t, breath: m.breath, pulse: m.pulse, stress: m.hrv ? m.hrv.baevsky : null });
    if (m.talking) talkingSeconds += 0.2;
    gardenGrowth = clamp(t / 60, 0, 1);
    updateTimer(t);
    if (t >= 60) endSession();
  }
}

function updateTimer(t) {
  const left = Math.max(0, 60 - Math.floor(t));
  $('timerText').textContent = left + ' seconds left';
  $('progressBar').style.width = clamp((t / 60) * 100, 0, 100) + '%';
}

function drawGarden() {
  const W = garden.width, H = garden.height;
  const t = Date.now() / 1000;
  const sky = gtx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#bfe3ff');
  sky.addColorStop(0.6, '#fffbf2');
  sky.addColorStop(1, '#d9f2d9');
  gtx.fillStyle = sky; gtx.fillRect(0, 0, W, H);
  const happy = happyAvg.length ? avg(happyAvg.slice(-20)) / 100 : 0.3;
  const sunX = 760, sunY = 90, sunR = 42 + happy * 30;
  gtx.fillStyle = '#f2b33d';
  gtx.beginPath(); gtx.arc(sunX, sunY, sunR, 0, Math.PI * 2); gtx.fill();
  gtx.fillStyle = '#fff3c4';
  gtx.beginPath(); gtx.arc(sunX, sunY, sunR * 0.6, 0, Math.PI * 2); gtx.fill();
  // Ground
  gtx.fillStyle = '#7ec850'; gtx.fillRect(0, H - 90, W, 90);
  // Plants, height follows garden growth
  for (let i = 0; i < 7; i++) {
    const x = 70 + i * 120;
    const hgt = 20 + gardenGrowth * 130 * (0.7 + 0.3 * Math.sin(i + 1));
    gtx.strokeStyle = '#2e9e5b'; gtx.lineWidth = 6;
    gtx.beginPath(); gtx.moveTo(x, H - 90); gtx.lineTo(x, H - 90 - hgt); gtx.stroke();
    gtx.fillStyle = i % 2 ? '#f97316' : '#2563eb';
    gtx.beginPath(); gtx.arc(x, H - 90 - hgt, 16 + gardenGrowth * 8, 0, Math.PI * 2); gtx.fill();
  }
  // Breathing orb, centre, grows with the live chest trace
  const orbR = 46 + breathTrace * 55 + Math.sin(t * 2) * 3;
  const glow = gtx.createRadialGradient(450, 260, 10, 450, 260, orbR + 50);
  glow.addColorStop(0, 'rgba(37,99,235,0.55)');
  glow.addColorStop(1, 'rgba(37,99,235,0)');
  gtx.fillStyle = glow; gtx.beginPath(); gtx.arc(450, 260, orbR + 50, 0, Math.PI * 2); gtx.fill();
  gtx.fillStyle = '#2563eb';
  gtx.beginPath(); gtx.arc(450, 260, orbR, 0, Math.PI * 2); gtx.fill();
  gtx.fillStyle = '#fff';
  gtx.font = '20px system-ui, sans-serif'; gtx.textAlign = 'center';
  gtx.fillText('breathe with the orb', 450, 260);
  gtx.font = '14px system-ui, sans-serif';
  gtx.fillText('in as it grows, out as it shrinks', 450, 284);
  // Pulse glow ring
  gtx.strokeStyle = 'rgba(249,115,22,' + (0.4 + pulseGlow * 0.5) + ')';
  gtx.lineWidth = 4 + pulseGlow * 6;
  gtx.beginPath(); gtx.arc(450, 260, orbR + 14, 0, Math.PI * 2); gtx.stroke();
  // Fireflies
  gtx.fillStyle = '#f2b33d';
  for (const f of fireflies) {
    const x = (f.x * W + Math.sin(t * f.s + f.x * 10) * 12) % W;
    const y = (f.y * (H - 120) + Math.cos(t * f.s) * 10 + 40) % (H - 100);
    gtx.beginPath(); gtx.arc(x, y, 3, 0, Math.PI * 2); gtx.fill();
  }
  gtx.fillStyle = '#111';
  gtx.font = '16px system-ui, sans-serif'; gtx.textAlign = 'left';
  gtx.fillText('Garden grown: ' + Math.round(gardenGrowth * 100) + '%', 20, 30);
  requestAnimationFrame(drawGarden);
}

function startSession() {
  if (!ws || ws.readyState !== 1) { $('statusHint').textContent = 'Not connected yet. Wait a moment and try again.'; return; }
  sessionActive = true;
  sessionStartAt = Date.now();
  sessionSamples = [];
  happyAvg = [];
  talkingSeconds = 0;
  motionSeconds = 0;
  gardenGrowth = 0;
  $('resultsScreen').hidden = true;
  $('statusHint').textContent = 'Session running. Sit still, breathe slow, do not talk.';
  ws.send(JSON.stringify({ type: 'start' }));
}

function stopSession() {
  sessionActive = false;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'stop' }));
  $('statusHint').textContent = 'Stopped. Press Start to try again.';
  $('timerText').textContent = '60 seconds left';
  $('progressBar').style.width = '0%';
}

function endSession() {
  sessionActive = false;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'stop' }));
  const base = sessionSamples.filter((s) => s.t <= 10);
  const end = sessionSamples.filter((s) => s.t >= 50);
  const baseBreath = avg(base.map((s) => s.breath).filter((v) => v != null));
  const endBreath = avg(end.map((s) => s.breath).filter((v) => v != null));
  const basePulse = avg(base.map((s) => s.pulse).filter((v) => v != null));
  const endPulse = avg(end.map((s) => s.pulse).filter((v) => v != null));
  const baseStress = avg(base.map((s) => s.stress).filter((v) => v != null));
  const endStress = avg(end.map((s) => s.stress).filter((v) => v != null));
  const avgSmile = happyAvg.length ? avg(happyAvg) : 0;
  const breathChange = baseBreath && endBreath ? (baseBreath - endBreath) / baseBreath : 0;
  const pulseChange = basePulse && endPulse ? (basePulse - endPulse) / basePulse : 0;
  const stressChange = baseStress && endStress ? (baseStress - endStress) / baseStress : null;
  const breathPts = clamp(20 + breathChange * 100, 0, 40);
  const pulsePts = clamp(15 + pulseChange * 100, 0, 30);
  const stressPts = stressChange == null ? 10 : clamp(10 + stressChange * 50, 0, 20);
  const smilePts = clamp(avgSmile / 10, 0, 10);
  const penalty = clamp((talkingSeconds + motionSeconds) * 0.5, 0, 10);
  const score = Math.round(clamp(breathPts + pulsePts + stressPts + smilePts - penalty, 0, 100));
  $('scoreValue').textContent = String(score);
  $('scoreWords').textContent = score >= 75 ? 'A strong reset. Your breathing and pulse settled, and the garden grew.' : score >= 55 ? 'A steady reset. You slowed a little, and the garden grew part way.' : 'A gentle start. Try again, slower and stiller, and watch the garden grow further.';
  $('startBreath').textContent = baseBreath == null ? '--' : baseBreath.toFixed(1) + ' breaths per minute';
  $('endBreath').textContent = endBreath == null ? '--' : endBreath.toFixed(1) + ' breaths per minute';
  $('startPulse').textContent = basePulse == null ? '--' : basePulse.toFixed(1) + ' BPM';
  $('endPulse').textContent = endPulse == null ? '--' : endPulse.toFixed(1) + ' BPM';
  $('startStress').textContent = baseStress == null ? 'Not ready yet' : baseStress.toFixed(2);
  $('endStress').textContent = endStress == null ? 'Not ready yet' : endStress.toFixed(2);
  $('avgSmile').textContent = avgSmile.toFixed(0);
  $('gardenGrown').textContent = String(Math.round(gardenGrowth * 100));
  $('resultsScreen').hidden = false;
  $('resultsScreen').scrollIntoView();
  window._lastResult = { date: new Date().toISOString(), score, startBreath: baseBreath, endBreath, startPulse: basePulse, endPulse, startStress: baseStress, endStress, avgSmile, gardenGrown: gardenGrowth };
}

function sendFakeControl() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    type: 'fakeControl',
    breath: Number($('breathSlider').value),
    pulse: Number($('pulseSlider').value),
    happy: Number($('smileSlider').value),
    talking: talkingOn,
  }));
}

$('startLiveBtn').addEventListener('click', () => { $('consentScreen').hidden = true; $('mainScreen').hidden = false; });
$('startDemoBtn').addEventListener('click', () => { $('consentScreen').hidden = true; $('mainScreen').hidden = false; });
$('startBtn').addEventListener('click', startSession);
$('stopBtn').addEventListener('click', stopSession);
$('againBtn').addEventListener('click', () => { $('resultsScreen').hidden = true; startSession(); });
$('saveBtn').addEventListener('click', () => {
  if (!window._lastResult) return;
  const saved = JSON.parse(localStorage.getItem('stillpoint-sessions') || '[]');
  saved.push(window._lastResult);
  localStorage.setItem('stillpoint-sessions', JSON.stringify(saved));
  $('saveNote').textContent = 'Saved in this browser only, numbers only, no video. ' + saved.length + ' saved session(s).';
  renderSaved();
});
$('deleteBtn').addEventListener('click', () => {
  localStorage.removeItem('stillpoint-sessions');
  $('saveNote').textContent = 'Saved summaries deleted.';
  renderSaved();
});
function renderSaved() {
  const saved = JSON.parse(localStorage.getItem('stillpoint-sessions') || '[]');
  $('savedList').innerHTML = saved.length ? '<h3>Saved summaries</h3>' + saved.map((s) => '<p>' + s.date.slice(0, 10) + ': score ' + s.score + ', breathing ' + (s.startBreath ? s.startBreath.toFixed(1) : '--') + ' to ' + (s.endBreath ? s.endBreath.toFixed(1) : '--') + '</p>').join('') : '';
}
$('breathSlider').addEventListener('input', () => { $('breathSliderVal').textContent = $('breathSlider').value; sendFakeControl(); });
$('pulseSlider').addEventListener('input', () => { $('pulseSliderVal').textContent = $('pulseSlider').value; sendFakeControl(); });
$('smileSlider').addEventListener('input', () => { $('smileSliderVal').textContent = $('smileSlider').value; sendFakeControl(); });
$('surpriseBtn').addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'fakeControl', surprise: 90, happy: 10 }));
  setTimeout(sendFakeControl, 3000);
});
$('neutralBtn').addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'fakeControl', surprise: 0, happy: 10 }));
  setTimeout(sendFakeControl, 1000);
});
$('talkingBtn').addEventListener('click', () => {
  talkingOn = !talkingOn;
  $('talkingBtn').textContent = 'Talking: ' + (talkingOn ? 'on' : 'off');
  sendFakeControl();
});

renderSaved();
connect();
drawGarden();
