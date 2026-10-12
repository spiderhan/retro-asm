'use strict';
// The two side-panel sections drawn as small web pages: "This line" and "Memory map".
// They load nothing from outside (the page's security rules forbid it) and only send
// "go to this line" or "run this Retro ASM command" messages back to the extension.

const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The little bit of Markdown the chip files use: **bold**, *italic*, `code` and \-escapes. Escaped first, so it is safe. */
function mdLite(s) {
  let t = esc(s);
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!|&;<>])/g, '$1').replace(/\\(&[a-z]+;|&#39;)/g, '$1');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[^*\w])\*([^*]+)\*(?!\w)/g, '$1<i>$2</i>');
  return t;
}

const n = (v) => Number(v).toLocaleString('en-GB');
const bytes = (v) => (v === 1 ? '1 byte' : `${n(v)} bytes`);
const kb = (v) => (v >= 1024 ? `${(v / 1024).toFixed(v % 1024 ? 1 : 0)}K` : bytes(v));
const goAttr = (file, line) => `data-goto="${esc(JSON.stringify([file, line]))}" tabindex="0" role="link"`;
const cmdButton = (id, text, title) => `<button data-cmd="${esc(id)}" title="${esc(title || '')}">${esc(text)}</button>`;

const STYLE = `
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: transparent; padding: 4px 12px 12px; margin: 0; line-height: 1.45; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); margin: 14px 0 4px; font-weight: 600; }
h2:first-child { margin-top: 6px; }
code, .code { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); }
.code { display: block; background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 3px; white-space: pre-wrap; word-break: break-word; }
.comment { color: var(--vscode-descriptionForeground); font-style: italic; margin-top: 3px; }
.sentence { font-size: 1.08em; margin: 8px 0 2px; }
.muted { color: var(--vscode-descriptionForeground); }
.small { font-size: .92em; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 4px 0; }
dt { color: var(--vscode-descriptionForeground); }
dd { margin: 0; }
a, [data-goto] { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
[data-goto]:hover, [data-goto]:focus { text-decoration: underline; outline: none; }
.chip { display: inline-block; font-size: 10px; padding: 0 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); vertical-align: 1px; }
.buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
button { font-family: inherit; font-size: 12px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 4px 9px; border-radius: 2px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.empty { color: var(--vscode-descriptionForeground); padding: 10px 0; }
/* memory map */
.bar { position: relative; height: 22px; border-radius: 3px; overflow: hidden; background: var(--vscode-editorWidget-background, rgba(128,128,128,.15)); border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); margin: 6px 0 2px; }
.seg { position: absolute; top: 0; bottom: 0; border-right: 1px solid var(--vscode-editor-background, transparent); opacity: .55; }
.seg.a { background: rgba(128,128,128,.28); } .seg.b { background: rgba(128,128,128,.12); }
.prog { position: absolute; top: 3px; bottom: 3px; min-width: 3px; background: var(--vscode-charts-green, #3fb950); border-radius: 2px; }
.hw { position: absolute; bottom: 0; width: 2px; height: 7px; background: var(--vscode-charts-orange, #d18616); }
.scale { display: flex; justify-content: space-between; font-family: var(--vscode-editor-font-family); font-size: 10px; color: var(--vscode-descriptionForeground); }
.legend { display: flex; gap: 12px; font-size: 11px; color: var(--vscode-descriptionForeground); margin: 4px 0 2px; }
.key { display: inline-block; width: 9px; height: 9px; border-radius: 2px; vertical-align: -1px; margin-right: 4px; }
.room { height: 6px; border-radius: 3px; background: rgba(128,128,128,.2); overflow: hidden; margin: 4px 0; }
.room > div { height: 100%; background: var(--vscode-charts-green, #3fb950); }
table { border-collapse: collapse; width: 100%; }
td { padding: 3px 4px; vertical-align: top; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.2)); }
td.addr { font-family: var(--vscode-editor-font-family); white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; width: 1%; }
tr.mine td { background: rgba(63,185,80,.10); }
.tag { font-size: 10px; white-space: nowrap; }
.tag.p { color: var(--vscode-charts-green, #3fb950); } .tag.h { color: var(--vscode-charts-orange, #d18616); }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m && m.type === 'body' && typeof m.html === 'string') document.getElementById('m').innerHTML = m.html;
});
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) { vscode.postMessage({ type: 'goto', at: JSON.parse(g.dataset.goto) }); return; }
  const c = e.target.closest('[data-cmd]');
  if (c) vscode.postMessage({ type: 'command', id: c.dataset.cmd });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const g = e.target.closest && e.target.closest('[data-goto]');
  if (g) vscode.postMessage({ type: 'goto', at: JSON.parse(g.dataset.goto) });
});
`;

function page(body, nonce, cspSource) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource || ''} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${STYLE}</style></head><body>${body}<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

const EMPTY = '<div class="empty">Open an assembly file (.a99, .asm, .z80 ...) to see its details here.</div>';

// ---------------------------------------------------------------------------
function thisLineHtml(d) {
  if (!d) return EMPTY;
  const o = [];
  o.push(`<h2>${esc(d.fileName)} · line ${d.line + 1}</h2>`);
  if (d.kind === 'blank') {
    o.push('<div class="empty">A blank line. Put the cursor on a line of code to see what it does.</div>');
    return o.join('');
  }
  if (d.code) o.push(`<span class="code">${esc(d.code)}</span>`);
  if (d.comment) o.push(`<div class="comment">${esc(d.comment)}</div>`);
  if (d.kind === 'comment') o.push('<div class="empty">A comment: a note for people, ignored by the assembler.</div>');
  if (d.sentence) o.push(`<div class="sentence">${mdLite(d.sentence)}</div>`);
  if (d.kind === 'unknown') o.push(`<div class="empty">"${esc(d.mnem)}" isn't an instruction this chip knows. Check the spelling.</div>`);
  if (d.kind === 'macro') o.push(`<div class="muted">${esc(d.mnem)} is one of your macros.</div>`);

  const rows = [];
  if (d.address) rows.push(['Address', `<code>${esc(d.address)}</code>${d.size ? ` · ${bytes(d.size)}` : ''}${d.approx ? ' <span class="muted">(rough)</span>' : ''}`]);
  if (d.kind === 'instruction') {
    if (d.reads) rows.push(['Reads', `<code>${esc(d.reads)}</code>`]);
    if (d.changes) rows.push(['Changes', `<code>${esc(d.changes)}</code>`]);
  }
  if (d.label) rows.push(['Label', `<code>${esc(d.label.name)}</code> · ${d.label.uses ? `used ${d.label.uses === 1 ? 'once' : d.label.uses + ' times'}` : 'not used anywhere yet'}`]);
  if (rows.length) o.push('<dl>' + rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('') + '</dl>');

  if (d.kind === 'instruction' || d.kind === 'directive') {
    o.push(`<h2>${esc(d.mnem)}${d.name ? ` — ${esc(d.name)}` : ''}${d.group ? ` <span class="chip">${esc(d.group)}</span>` : ''}</h2>`);
    if (d.summary) o.push(`<div>${mdLite(d.summary)}</div>`);
    if (d.syntax) o.push(`<div class="small muted" style="margin-top:4px">Written: <code>${esc(d.syntax)}</code></div>`);
    if (d.flags) o.push(`<div class="small" style="margin-top:4px"><span class="muted">Flags:</span> ${mdLite(d.flags)}</div>`);
    if (d.more) o.push(`<div class="small" style="margin-top:4px">${mdLite(d.more)}</div>`);
  }
  if (d.kind === 'data') o.push('<div class="muted">This is data that follows an instruction, not an instruction itself.</div>');

  if (d.routine) {
    const r = d.routine;
    o.push(`<h2>Inside routine</h2>`);
    const rr = [['Name', `<span ${goAttr(r.file, r.line)}>${esc(r.name)}</span>`]];
    if (r.address) rr.push(['Where', `<code>${esc(r.address)}</code> · ${bytes(r.size)}`]);
    rr.push(['Called', r.calledFrom ? `from ${r.calledFrom} place${r.calledFrom === 1 ? '' : 's'}` : (r.usedFrom ? `not called, but named in ${r.usedFrom} place${r.usedFrom === 1 ? '' : 's'}` : 'not called by name')]);
    if (r.changes) rr.push(['Changes', `<code>${esc(r.changes)}</code>`]);
    o.push('<dl>' + rr.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('') + '</dl>');
  }
  o.push('<div class="buttons">' + cmdButton('retroAsm.explainSelection', 'Explain the whole routine', 'Every line of this routine in plain English') + cmdButton('retroAsm.showReference', 'Cheat sheet', 'All the instructions for this chip') + '</div>');
  return o.join('');
}

// ---------------------------------------------------------------------------
function memoryMapHtml(d) {
  if (!d) return EMPTY;
  const o = [];
  const total = 0x10000;
  const pct = (v) => `${(Math.max(0, Math.min(total, v)) / total * 100).toFixed(3)}%`;
  o.push(`<h2>${esc(d.chip)}</h2>`);
  if (d.program) {
    const p = d.program;
    o.push(`<div>Your program: <b>${bytes(p.used)}</b>, from <code>${esc(p.startHex)}</code> to <code>${esc(p.endHex)}</code>${p.approx ? ' <span class="muted">(rough: some lines could not be measured)</span>' : ''}.</div>`);
    if (p.room) {
      const used = Math.min(100, p.used / p.room * 100);
      o.push(`<div class="room" title="${used.toFixed(1)}% used"><div style="width:${used.toFixed(2)}%"></div></div>`);
      o.push(`<div class="small muted"><b>${kb(p.free)}</b> still free, out of ${kb(p.room)} in ${esc(p.regionText)}.</div>`);
    }
    if (p.loadNote) o.push(`<div class="small muted" style="margin-top:4px">${mdLite(p.loadNote)}.</div>`);
  } else if (!d.sizing) o.push(`<div class="empty">Sizes can't be worked out for ${esc(d.short)} yet: its chip file has no "sizing" section.</div>`);
  else o.push('<div class="empty">No code that takes up memory yet.</div>');

  if (d.regions.length) {
    o.push('<h2>The whole memory (64K)</h2>');
    let bar = '<div class="bar">';
    d.regions.forEach((r, i) => { bar += `<div class="seg ${i % 2 ? 'b' : 'a'}" style="left:${pct(r.from)};width:${pct(r.to + 1 - r.from)}" title="${esc(r.fromHex + '–' + r.toHex + ': ' + r.text)}"></div>`; });
    if (d.program) bar += `<div class="prog" style="left:${pct(d.program.start)};width:${pct(d.program.end - d.program.start)}" title="Your program"></div>`;
    for (const v of d.hardware || []) bar += `<div class="hw" style="left:${pct(v)}"></div>`;
    bar += '</div>';
    o.push(bar);
    o.push(`<div class="scale"><span>${esc(d.regions[0].fromHex)}</span><span>${esc(d.regions[d.regions.length - 1].toHex)}</span></div>`);
    o.push('<div class="legend"><span><span class="key" style="background:var(--vscode-charts-green,#3fb950)"></span>your program</span><span><span class="key" style="background:var(--vscode-charts-orange,#d18616)"></span>hardware your code uses</span></div>');
    o.push('<table>');
    for (const r of d.regions) {
      const tags = [];
      if (r.program) tags.push(`<span class="tag p">your program: ${bytes(r.program.bytes)}</span>`);
      if (r.uses) tags.push(`<span class="tag h">${r.uses} address${r.uses === 1 ? '' : 'es'} used</span>`);
      o.push(`<tr class="${r.program ? 'mine' : ''}"><td class="addr">${esc(r.fromHex)}<br>${esc(r.toHex)}</td><td>${esc(r.text)} <span class="muted small">(${kb(r.bytes)})</span>${tags.length ? '<br>' + tags.join(' · ') : ''}</td></tr>`);
    }
    o.push('</table>');
  }
  if (d.files && d.files.length > 1) {
    o.push('<h2>Where each file sits</h2><table>');
    for (const f of d.files) o.push(`<tr><td class="addr">${esc(f.startHex)}</td><td><span ${goAttr(f.file, 0)}>${esc(f.name)}</span> <span class="muted small">${bytes(f.bytes)}${f.approx ? ', rough' : ''}</span></td></tr>`);
    o.push('</table>');
  }
  o.push('<div class="buttons">' + cmdButton('retroAsm.toggleAddresses', 'Show addresses beside the code') + '</div>');
  return o.join('');
}

module.exports = { esc, mdLite, page, thisLineHtml, memoryMapHtml };
