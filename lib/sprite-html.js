'use strict';
// The picture editor's web page. It loads nothing from outside (the page's security rules
// forbid it). The extension sends it the picture ('state'); it sends back each finished stroke
// as a whole new picture ('paint'), and the extension writes the numbers into the source.

const SP = require('./sprites');

const STYLE = `
:root { color-scheme: light dark; --screen: #15151b; --line: #2a2a35; --line8: #4a4a5c; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 14px 18px 24px; line-height: 1.45; }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 12px; }
h1 { font-size: 1.35em; font-weight: 600; margin: 0; font-family: var(--vscode-editor-font-family); }
.muted { color: var(--vscode-descriptionForeground); }
.small { font-size: .92em; }
.layout { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; }
.col { display: flex; flex-direction: column; gap: 10px; }
canvas.grid { align-self: flex-start; background: var(--screen); border-radius: 6px; cursor: crosshair; touch-action: none; box-shadow: 0 0 0 1px var(--vscode-widget-border, #0000); }
canvas.grid.locked { cursor: not-allowed; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .45; cursor: default; }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
.swatch { width: 28px; height: 28px; padding: 0; border-radius: 5px; border: 2px solid transparent; background-clip: padding-box; position: relative; }
.swatch.on { border-color: var(--vscode-focusBorder); }
.swatch span { position: absolute; right: 2px; bottom: 0; font-size: 9px; color: #fff; text-shadow: 0 0 2px #000, 0 0 2px #000; }
.colourName { min-height: 1.4em; }
.frames { display: flex; flex-wrap: wrap; gap: 6px; }
.frames canvas { align-self: flex-start; background: var(--screen); border-radius: 3px; cursor: pointer; border: 2px solid transparent; }
.frames canvas.on { border-color: var(--vscode-focusBorder); }
table { border-collapse: collapse; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); }
th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 2px 14px 4px 0; font-family: var(--vscode-font-family); font-size: .9em; }
td { padding: 1px 14px 1px 0; white-space: pre; }
td.hex { color: var(--vscode-textLink-foreground); }
tr.hot td { background: var(--vscode-editor-lineHighlightBackground, #8882); }
.panel { background: var(--vscode-textCodeBlock-background); border-radius: 6px; padding: 10px 12px; }
.note { border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700); padding: 6px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 0 4px 4px 0; }
.note.error { border-left-color: var(--vscode-editorError-foreground, #f14c4c); }
.preview { display: flex; gap: 12px; align-items: flex-end; }
.preview canvas { background: var(--screen); image-rendering: pixelated; border-radius: 3px; }
kbd { font-family: var(--vscode-editor-font-family); font-size: .9em; border: 1px solid var(--vscode-widget-border, #8886); border-radius: 3px; padding: 0 4px; }
.hidden { display: none !important; }
`;

// Runs inside the page. encode() and byteIndex() are the same code the extension uses.
const SCRIPT = `
const vscode = acquireVsCodeApi();
${SP.byteIndex.toString()}
${SP.encode.toString()}
const $ = (id) => document.getElementById(id);
let S = null;              // the state from the extension
let frame = 0, colour = 1, drawing = null, cell = 16;
const undo = [], redo = [];

function px() { return S.frames[frame]; }
function hex(b) { return S.hexPrefix + b.toString(16).toUpperCase().padStart(2, '0'); }
function cssOf(c) { return c.split('/'); }

function paintCell(g, c, x, y, w, h) {
  const parts = cssOf(c);
  if (/^#[0-9a-f]{8}$/i.test(parts[0]) && parts[0].slice(7) === '00') return;   // see-through: leave the screen showing
  g.fillStyle = parts[0];
  if (parts.length < 2) { g.fillRect(x, y, w, h); return; }
  // a flashing colour: half of each
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x, y + h); g.closePath(); g.fill();
  g.fillStyle = parts[1]; g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); g.fill();
}

function drawPicture(cv, pixels, size, lines) {
  const sh = S.shape, pw = size * sh.pixelWidth;
  cv.width = sh.width * pw; cv.height = sh.height * size;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < sh.height; y++) for (let x = 0; x < sh.width; x++) paintCell(g, sh.colours[pixels[y * sh.width + x]] || '#f0f', x * pw, y * size, pw, size);
  if (!lines) return;
  const css = getComputedStyle(document.documentElement);
  for (let x = 1; x < sh.width; x++) { g.fillStyle = css.getPropertyValue(x % sh.perByte === 0 ? '--line8' : '--line'); g.fillRect(x * pw, 0, 1, cv.height); }
  const band = sh.order === 'rows' ? 8 : sh.blockHeight;
  for (let y = 1; y < sh.height; y++) { g.fillStyle = css.getPropertyValue(y % band === 0 ? '--line8' : '--line'); g.fillRect(0, y * size, cv.width, 1); }
}

function render() {
  if (!S) return;
  $('title').textContent = S.title;
  $('where').textContent = S.where;
  $('problem').classList.toggle('hidden', !S.error);
  $('problem').textContent = S.error || '';
  $('editor').classList.toggle('hidden', !!S.error);
  $('locked').classList.toggle('hidden', !!S.error || S.editable);
  $('locked').textContent = S.editable ? '' : 'Look only: ' + S.why + '. Change it to a plain number to edit the picture here.';
  if (S.error) return;
  const sh = S.shape;
  frame = Math.min(frame, S.frames.length - 1);
  $('shape').textContent = sh.name;
  // the big grid
  const room = Math.min(window.innerWidth - 60, 560);
  cell = Math.max(6, Math.min(40, Math.floor(room / (sh.width * sh.pixelWidth)), Math.floor(520 / sh.height)));
  drawPicture($('grid'), px(), cell, true);
  $('grid').classList.toggle('locked', !S.editable);
  $('howto').classList.toggle('hidden', !S.editable);
  // real size
  drawPicture($('p1'), px(), 1, false); drawPicture($('p2'), px(), 2, false); drawPicture($('p4'), px(), 4, false);
  // colours
  const pal = $('palette'); pal.innerHTML = '';
  sh.colours.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'swatch' + (i === colour ? ' on' : ''); b.title = sh.colourNames[i] || ('colour ' + i);
    const parts = cssOf(c);
    b.style.background = parts[0].slice(7) === '00' && parts[0].length === 9 ? 'var(--screen)' : parts.length > 1 ? 'linear-gradient(135deg,' + parts[0] + ' 50%,' + parts[1] + ' 50%)' : parts[0];
    if (i < 10) { const s = document.createElement('span'); s.textContent = i; b.appendChild(s); }
    b.onclick = () => { colour = i; render(); };
    pal.appendChild(b);
  });
  $('colourName').textContent = 'Drawing with: ' + (sh.colourNames[colour] || colour);
  // frames
  $('frameBox').classList.toggle('hidden', S.frames.length < 2);
  $('frameText').textContent = 'Picture ' + (frame + 1) + ' of ' + S.frames.length;
  const fr = $('frames'); fr.innerHTML = '';
  S.frames.forEach((p, i) => { const c = document.createElement('canvas'); drawPicture(c, p, Math.max(1, Math.floor(48 / Math.max(sh.width * sh.pixelWidth, sh.height))), false); if (i === frame) c.className = 'on'; c.title = 'Picture ' + (i + 1); c.onclick = () => { frame = i; vscode.postMessage({ type: 'frame', index: i }); render(); }; fr.appendChild(c); });
  $('prev').disabled = frame === 0; $('next').disabled = frame >= S.frames.length - 1;
  // the bytes, row by row
  const bytes = encode(px(), sh);
  const base = frame * sh.stride;
  const rows = [];
  for (let y = 0; y < sh.height; y++) {
    const cells = px().slice(y * sh.width, (y + 1) * sh.width);
    const bits = sh.bitsPerPixel === 1 ? cells.join('') : cells.map(v => v.toString(2).padStart(sh.bitsPerPixel, '0')).join(' ');
    const idx = []; for (let bx = 0; bx < sh.bytesPerRow; bx++) idx.push(byteIndex(sh, y, bx));
    rows.push('<tr><td>' + (y + 1) + '</td><td>' + bits + '</td><td class="hex">' + idx.map(i => hex(bytes[i])).join(' ') + '</td><td class="muted">' + idx.map(i => '#' + (base + i + 1)).join(' ') + '</td></tr>');
  }
  $('rows').innerHTML = rows.join('');
  $('bitsHead').textContent = sh.bitsPerPixel === 1 ? 'Pixels (1 = on)' : 'Pixels (' + sh.bitsPerPixel + ' bits each)';
  $('order').textContent = 'Kept in the file ' + sh.orderText + '. ' + (sh.about || '');
  $('spare').textContent = !S.spare ? '' : S.spare === 1 ? 'The 1 byte after the last picture is left as it is.' : 'The ' + S.spare + ' bytes after the last picture are left as they are.';
  $('undo').disabled = !undo.length || !S.editable; $('redo').disabled = !redo.length || !S.editable;
  for (const id of ['clear', 'invert', 'flipH', 'flipV', 'left', 'right', 'up', 'down']) $(id).disabled = !S.editable;
}

function send(pixels, keepRedo) {
  undo.push({ frame, pixels: px().slice() });
  if (undo.length > 200) undo.shift();
  if (!keepRedo) redo.length = 0;
  S.frames[frame] = pixels;
  vscode.postMessage({ type: 'paint', frame, pixels: pixels.slice() });
  render();
}

function change(fn) {
  if (!S || !S.editable) return;
  const sh = S.shape, p = px(), out = new Array(p.length).fill(0);
  for (let y = 0; y < sh.height; y++) for (let x = 0; x < sh.width; x++) out[y * sh.width + x] = fn(x, y, p, sh);
  send(out);
}
const at = (p, sh, x, y) => (x < 0 || y < 0 || x >= sh.width || y >= sh.height ? 0 : p[y * sh.width + x]);
const tools = {
  clear: () => change(() => 0),
  invert: () => change((x, y, p, sh) => (S.shape.colourCount - 1) - p[y * sh.width + x]),
  flipH: () => change((x, y, p, sh) => p[y * sh.width + (sh.width - 1 - x)]),
  flipV: () => change((x, y, p, sh) => p[(sh.height - 1 - y) * sh.width + x]),
  left: () => change((x, y, p, sh) => at(p, sh, x + 1, y)),
  right: () => change((x, y, p, sh) => at(p, sh, x - 1, y)),
  up: () => change((x, y, p, sh) => at(p, sh, x, y + 1)),
  down: () => change((x, y, p, sh) => at(p, sh, x, y - 1))
};
for (const k of Object.keys(tools)) $(k).onclick = tools[k];

function doUndo(from, to) {
  if (!S || !S.editable || !from.length) return;
  const u = from.pop();
  to.push({ frame: u.frame, pixels: S.frames[u.frame].slice() });
  frame = u.frame; S.frames[frame] = u.pixels;
  vscode.postMessage({ type: 'paint', frame, pixels: u.pixels });
  render();
}
$('undo').onclick = () => doUndo(undo, redo);
$('redo').onclick = () => doUndo(redo, undo);
$('prev').onclick = () => { if (frame > 0) { frame--; vscode.postMessage({ type: 'frame', index: frame }); render(); } };
$('next').onclick = () => { if (S && frame < S.frames.length - 1) { frame++; vscode.postMessage({ type: 'frame', index: frame }); render(); } };
$('show').onclick = () => vscode.postMessage({ type: 'goto' });

// drawing with the mouse (or a pen or finger)
function cellAt(e) {
  // worked out from the size it is shown at, so it is right even if the page is zoomed or stretched
  const r = $('grid').getBoundingClientRect(), sh = S.shape;
  const x = Math.floor((e.clientX - r.left) / r.width * sh.width), y = Math.floor((e.clientY - r.top) / r.height * sh.height);
  return x >= 0 && y >= 0 && x < sh.width && y < sh.height ? y * sh.width + x : -1;
}
const grid = $('grid');
grid.addEventListener('contextmenu', (e) => e.preventDefault());
grid.addEventListener('pointerdown', (e) => {
  if (!S || S.error || !S.editable) return;
  const i = cellAt(e); if (i < 0) return;
  grid.setPointerCapture(e.pointerId);
  // right button rubs out; clicking a pixel that is already this colour rubs it out too
  const value = e.button === 2 || px()[i] === colour ? 0 : colour;
  drawing = { before: px().slice(), value, last: i };
  px()[i] = value; render();
});
grid.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const i = cellAt(e); if (i < 0 || i === drawing.last) return;
  // fill in every pixel between this point and the last one, so a quick stroke leaves no gaps
  const w = S.shape.width;
  let x0 = drawing.last % w, y0 = Math.floor(drawing.last / w);
  const x1 = i % w, y1 = Math.floor(i / w);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px()[y0 * w + x0] = drawing.value;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  drawing.last = i; render();
});
const endStroke = () => {
  if (!drawing) return;
  const d = drawing; drawing = null;
  const now = px().slice();
  if (now.join() === d.before.join()) return;
  S.frames[frame] = d.before;
  send(now);
};
grid.addEventListener('pointerup', endStroke);
grid.addEventListener('pointercancel', endStroke);

window.addEventListener('keydown', (e) => {
  if (!S) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(undo, redo); return; }
  if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); doUndo(redo, undo); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[0-9]$/.test(k) && S.shape && +k < S.shape.colourCount) { colour = +k; render(); }
  else if (k === '[') $('prev').click();
  else if (k === ']') $('next').click();
});
window.addEventListener('resize', render);
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type !== 'state') return;
  if (drawing) { setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: m })), 60); return; }
  const first = !S || S.key !== m.key;
  S = m;
  if (first) { frame = m.frame || 0; undo.length = 0; redo.length = 0; colour = S.shape ? Math.min(colour, S.shape.colourCount - 1) || 1 : 1; }
  render();
});
vscode.postMessage({ type: 'ready' });
`;

const BODY = `
<header>
  <h1 id="title">Picture</h1>
  <span id="shape" class="muted"></span>
  <span id="where" class="muted small"></span>
  <button id="show" title="Show these lines in the code">Show in code</button>
</header>
<div id="problem" class="note error hidden"></div>
<div id="editor" class="layout">
  <div class="col">
    <canvas id="grid" class="grid"></canvas>
    <div class="row">
      <button id="undo" title="Undo (Ctrl+Z)">Undo</button><button id="redo" title="Redo (Ctrl+Y)">Redo</button>
      <button id="clear">Clear</button><button id="invert">Invert</button>
      <button id="flipH" title="Mirror left to right">Flip &#8596;</button><button id="flipV" title="Turn upside down">Flip &#8597;</button>
      <button id="left" title="Move everything one pixel left">&#8592;</button><button id="right" title="Move everything one pixel right">&#8594;</button><button id="up" title="Move everything one pixel up">&#8593;</button><button id="down" title="Move everything one pixel down">&#8595;</button>
    </div>
    <div class="row" id="palette"></div>
    <div id="colourName" class="muted small colourName"></div>
    <div id="locked" class="note hidden"></div>
    <div id="frameBox" class="col">
      <div class="row"><button id="prev" title="Previous picture ([)">&#9664;</button><span id="frameText"></span><button id="next" title="Next picture (])">&#9654;</button></div>
      <div id="frames" class="frames"></div>
    </div>
    <div id="howto" class="muted small">Click or drag to draw. Click a pixel that is already that colour, or use the right button, to rub out. <kbd>0</kbd>-<kbd>9</kbd> pick a colour.</div>
  </div>
  <div class="col">
    <div class="preview"><canvas id="p1"></canvas><canvas id="p2"></canvas><canvas id="p4"></canvas><span class="muted small">real size, x2, x4</span></div>
    <div class="panel">
      <table><thead><tr><th>Row</th><th id="bitsHead">Pixels</th><th>Bytes</th><th>Byte no.</th></tr></thead><tbody id="rows"></tbody></table>
    </div>
    <div id="order" class="muted small" style="max-width: 46em"></div>
    <div id="spare" class="muted small"></div>
  </div>
</div>`;

function page(nonce, cspSource) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${cspSource || ''} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Picture</title>
<style>${STYLE}</style></head><body>${BODY}<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

module.exports = { page, SCRIPT };
