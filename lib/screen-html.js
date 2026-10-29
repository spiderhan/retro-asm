'use strict';
// The screen preview's web page. It loads nothing from outside (the page's security rules
// forbid it). The extension works the picture out (lib/screen.js) and sends it as colour numbers
// ('state'); the page only paints those numbers with the video chip's sixteen colours.

const SCR = require('./screen');

const STYLE = `
:root { color-scheme: light dark; --screen: #15151b; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 14px 18px 24px; line-height: 1.45; }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 12px; }
h1 { font-size: 1.35em; font-weight: 600; margin: 0; font-family: var(--vscode-editor-font-family); }
h3 { margin: 18px 0 6px; }
.muted { color: var(--vscode-descriptionForeground); }
.small { font-size: .92em; }
.row { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin: 10px 0; }
button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
canvas { display: block; background: var(--screen); border-radius: 4px; image-rendering: pixelated; width: 100%; max-width: 768px; aspect-ratio: 4 / 3; box-shadow: 0 0 0 1px var(--vscode-widget-border, #8884); }
table { border-collapse: collapse; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); }
th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 2px 14px 4px 0; font-family: var(--vscode-font-family); font-size: .9em; }
td { padding: 1px 14px 1px 0; vertical-align: top; }
td.hex { color: var(--vscode-textLink-foreground); white-space: pre; }
td.bad { color: var(--vscode-editorWarning-foreground, #cca700); }
a { color: var(--vscode-textLink-foreground); cursor: pointer; }
.panel { background: var(--vscode-textCodeBlock-background); border-radius: 6px; padding: 10px 12px; max-width: 70em; overflow-x: auto; }
.note { border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700); padding: 6px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 0 4px 4px 0; margin: 8px 0; max-width: 70em; }
.note.error { border-left-color: var(--vscode-editorError-foreground, #f14c4c); }
.hidden { display: none !important; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const W = ${SCR.WIDTH}, H = ${SCR.HEIGHT};
let S = null;
function unpack(b64) { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
function hexOf(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
function paint() {
  const cv = $('cv'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  const idx = unpack($('sprites').checked && S.withSprites ? S.withSprites : S.pixels), pal = S.palette.map(hexOf);
  for (let i = 0; i < idx.length; i++) { const c = pal[idx[i]] || pal[1]; img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
}
function add(parent, tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; parent.appendChild(e); return e; }
function render() {
  if (!S) return;
  $('title').textContent = S.title; $('where').textContent = S.where || '';
  $('about').textContent = S.about || '';
  const err = $('problem'); err.classList.toggle('hidden', !S.error); err.textContent = S.error || '';
  $('shown').classList.toggle('hidden', !!S.error);
  if (S.error) return;
  $('spritesBox').classList.toggle('hidden', !S.hasSprites);
  $('spriteCount').textContent = S.hasSprites ? '(' + S.spriteCount + ' drawn)' : '';
  paint();
  const notes = $('notes'); notes.innerHTML = '';
  (S.notes || []).forEach(n => add(notes, 'div', n, 'note'));
  $('backdrop').textContent = 'Backdrop colour (seen where a square is see-through): ' + S.backdrop;
  const rows = $('rows'); rows.innerHTML = '';
  (S.tables || []).forEach(t => {
    const tr = add(rows, 'tr');
    add(tr, 'td', t.what);
    const l = add(tr, 'td', t.label); if (t.line >= 0) { l.className = 'hex'; }
    add(tr, 'td', t.at, 'hex');
    add(tr, 'td', t.size, t.ok ? '' : 'bad');
  });
}
$('sprites').onchange = paint;
$('goto').onclick = () => vscode.postMessage({ type: 'goto' });
window.addEventListener('message', (e) => { if (e.data && e.data.type === 'state') { S = e.data; render(); } });
vscode.postMessage({ type: 'ready' });
`;

const BODY = `
<header>
  <h1 id="title">Screen</h1><span class="muted" id="where"></span>
  <a id="goto" class="small">Go to the code</a>
</header>
<div id="about" class="muted"></div>
<div id="problem" class="note error hidden"></div>
<div id="shown">
  <div class="row" id="spritesBox">
    <label><input type="checkbox" id="sprites" checked> show sprites</label><span class="muted small" id="spriteCount"></span>
  </div>
  <canvas id="cv" width="256" height="192" aria-label="The screen drawn from the tables in the code"></canvas>
  <div class="muted small" id="backdrop"></div>
  <div id="notes"></div>
  <h3 class="muted small">What is where</h3>
  <div class="panel">
    <table><thead><tr><th>Table</th><th>Label</th><th>Goes to video memory at</th><th>Size</th></tr></thead><tbody id="rows"></tbody></table>
  </div>
</div>`;

function page(nonce, cspSource) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${cspSource || ''} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screen</title>
<style>${STYLE}</style></head><body>${BODY}<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

module.exports = { page, SCRIPT };
