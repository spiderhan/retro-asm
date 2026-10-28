'use strict';
// The sound player's web page. It loads nothing from outside (the page's security rules
// forbid it). The extension sends it the sound's steps ('state'); the page works out the
// sound itself with the same code the tests use (lib/sound.js) and plays it.

const SND = require('./sound');

const STYLE = `
:root { color-scheme: light dark; --screen: #15151b; --line: #2a2a35; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 14px 18px 24px; line-height: 1.45; }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 12px; }
h1 { font-size: 1.35em; font-weight: 600; margin: 0; font-family: var(--vscode-editor-font-family); }
.muted { color: var(--vscode-descriptionForeground); }
.small { font-size: .92em; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .45; cursor: default; }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
canvas { display: block; width: 100%; max-width: 900px; background: var(--screen); border-radius: 6px; }
.key { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: .92em; margin-top: 6px; }
.key i { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin-right: 6px; }
table { border-collapse: collapse; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); }
th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 2px 14px 4px 0; font-family: var(--vscode-font-family); font-size: .9em; }
td { padding: 1px 14px 1px 0; vertical-align: top; }
td.hex { color: var(--vscode-textLink-foreground); white-space: pre; }
tr.hot td { background: var(--vscode-editor-lineHighlightBackground, #8882); }
.panel { background: var(--vscode-textCodeBlock-background); border-radius: 6px; padding: 10px 12px; max-width: 70em; overflow-x: auto; }
.note { border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700); padding: 6px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 0 4px 4px 0; margin: 8px 0; }
.note.error { border-left-color: var(--vscode-editorError-foreground, #f14c4c); }
.hidden { display: none !important; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
${SND.chipFrames.toString()}
${SND.renderFrames.toString()}
const $ = (id) => document.getElementById(id);
let S = null, frames = [], ac = null, src = null, t0 = 0, raf = 0, loop = false;
const COL = ['#f5c542', '#4fd1c5', '#c56cf0', '#e5533d'];
const NAME = ['Voice 1', 'Voice 2', 'Voice 3', 'Noise'];
const CLOCK = 111860.8, LO = 100, HI = 8000;

function stop() {
  if (src) { try { src.onended = null; src.stop(); } catch (e) {} src = null; }
  cancelAnimationFrame(raf); raf = 0;
  $('play').textContent = 'Play'; $('stop').disabled = true;
  draw(null);
}
function play() {
  if (!frames.length) return;
  stop();
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  ac.resume();
  const data = renderFrames(frames, 44100), buf = ac.createBuffer(1, data.length, 44100);
  buf.copyToChannel(data, 0);
  src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
  const mine = src;
  src.onended = () => { if (src === mine) { src = null; if (loop) play(); else stop(); } };
  src.start(); t0 = ac.currentTime;
  $('play').textContent = 'Play again'; $('stop').disabled = false;
  const step = () => { if (src !== mine) return; draw(Math.min(frames.length, (ac.currentTime - t0) * 60)); raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
}

function draw(head) {
  const cv = $('cv'), dpr = window.devicePixelRatio || 1, W = Math.max(300, Math.min(900, cv.parentNode.clientWidth)), H = 300;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#15151b'; g.fillRect(0, 0, W, H);
  g.font = '11px monospace'; g.textBaseline = 'middle';
  const L = 44, R = W - 10, PT = 8, PH = 170, LT = PT + PH + 18, LH = 90, n = Math.max(1, frames.length);
  const x = (i) => L + (R - L) * i / n;
  const yHz = (hz) => PT + PH * (1 - Math.log(Math.max(LO, Math.min(HI, hz)) / LO) / Math.log(HI / LO));
  const yAtt = (a) => LT + LH * a / 15;
  g.strokeStyle = '#2a2a35'; g.fillStyle = '#8d93b3'; g.lineWidth = 1;
  for (const hz of [125, 250, 500, 1000, 2000, 4000]) { const y = yHz(hz); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.fillText(hz >= 1000 ? hz / 1000 + 'k' : String(hz), 6, y); }
  for (const a of [0, 15]) { const y = yAtt(a); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.fillText(a ? 'off' : 'loud', 6, y); }
  for (let s = 0; s <= n; s += 30) { g.fillText((s / 60) + 's', x(s) - 8, H - 12); }
  g.lineWidth = 2.5;
  for (let c = 0; c < 4; c++) {
    g.strokeStyle = COL[c];
    // pitch: only while the voice can be heard (tones only)
    if (c < 3) {
      g.beginPath(); let pen = false;
      frames.forEach((f, i) => {
        if (f.att[c] >= 15) { pen = false; return; }
        const y = yHz(CLOCK / (f.per[c] || 1024));
        if (!pen) { g.moveTo(x(i), y); pen = true; } else g.lineTo(x(i), y);
        g.lineTo(x(i + 1), y);
      });
      g.stroke();
    }
    // loudness
    g.globalAlpha = 0.85; g.beginPath();
    frames.forEach((f, i) => { const y = yAtt(f.att[c]) + c * 1.5; if (!i) g.moveTo(x(i), y); else g.lineTo(x(i), y); g.lineTo(x(i + 1), y); });
    g.stroke(); g.globalAlpha = 1;
  }
  if (head != null) { g.fillStyle = '#fff'; g.fillRect(x(head), PT, 2, LT + LH - PT); }
}

function render() {
  if (!S) return;
  stop();
  $('title').textContent = S.title;
  $('where').textContent = S.where;
  $('problem').classList.toggle('hidden', !S.error);
  $('problem').textContent = S.error || '';
  $('player').classList.toggle('hidden', !!S.error);
  if (S.error) return;
  const r = chipFrames(S.steps);
  frames = r.frames;
  $('info').textContent = S.steps.length + (S.steps.length === 1 ? ' step, ' : ' steps, ') + (S.ticks / 60).toFixed(2) + ' seconds.';
  const notes = [];
  if (r.truncated) notes.push('This sound is longer than a minute, so only the first minute is played.');
  if (!S.ended) notes.push('The list has no ending: a count of 0 after the last step. The player plays what is there.');
  if (S.spare) notes.push(S.spare + (S.spare === 1 ? ' byte comes' : ' bytes come') + ' after the ending and ' + (S.spare === 1 ? 'is' : 'are') + ' not played.');
  $('notes').innerHTML = ''; notes.forEach((t) => { const d = document.createElement('div'); d.className = 'note'; d.textContent = t; $('notes').appendChild(d); });
  const rows = [];
  S.steps.slice(0, 300).forEach((st, i) => {
    rows.push('<tr><td>' + (i + 1) + '</td><td class="hex">' + st.items.map((b) => b.hex).join(' ') + '</td><td>' + st.ticks + ' (' + (st.ticks / 60).toFixed(2) + ' s)</td><td>' + st.items.map((b) => b.text).join('<br>') + '</td></tr>');
  });
  if (S.steps.length > 300) rows.push('<tr><td colspan="4" class="muted">... and ' + (S.steps.length - 300) + ' more steps (all of them are played)</td></tr>');
  $('rows').innerHTML = rows.join('');
  draw(null);
}

$('play').onclick = play;
$('stop').onclick = stop;
$('loop').onchange = () => { loop = $('loop').checked; };
$('show').onclick = () => vscode.postMessage({ type: 'goto' });
window.addEventListener('resize', () => { if (S && !S.error && !src) draw(null); });
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type !== 'state') return;
  const same = S && S.key === m.key && JSON.stringify(S.steps) === JSON.stringify(m.steps);
  S = m;
  if (!same) render(); else { $('title').textContent = S.title; $('where').textContent = S.where; }
});
vscode.postMessage({ type: 'ready' });
`;

const BODY = `
<header>
  <h1 id="title">Sound</h1>
  <span id="info" class="muted"></span>
  <span id="where" class="muted small"></span>
  <button id="show" title="Show these lines in the code">Show in code</button>
</header>
<div id="problem" class="note error hidden"></div>
<div id="player">
  <div class="row">
    <button id="play" class="primary" title="Play the sound">Play</button>
    <button id="stop" disabled>Stop</button>
    <label><input type="checkbox" id="loop"> repeat</label>
  </div>
  <div id="notes"></div>
  <canvas id="cv" aria-label="Pitch of each voice at the top, loudness of each voice below"></canvas>
  <div class="key">
    <span><i style="background:#f5c542"></i>voice 1</span><span><i style="background:#4fd1c5"></i>voice 2</span>
    <span><i style="background:#c56cf0"></i>voice 3</span><span><i style="background:#e5533d"></i>noise</span>
    <span class="muted">Top: pitch of each tone voice, drawn only while it can be heard. Bottom: how loud each voice is (higher up is louder). Time runs left to right.</span>
  </div>
  <h3 class="muted small">The steps</h3>
  <div class="panel">
    <table><thead><tr><th>Step</th><th>Sent to the sound chip</th><th>Then wait (60ths)</th><th>What it does</th></tr></thead><tbody id="rows"></tbody></table>
  </div>
</div>`;

function page(nonce, cspSource) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${cspSource || ''} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sound</title>
<style>${STYLE}</style></head><body>${BODY}<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

module.exports = { page, SCRIPT };
