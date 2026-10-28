'use strict';
// The part that talks to VS Code. All the thinking is done in ./lib; this file
// just passes VS Code's questions on and hands the answers back.

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { loadFolder, guessDialect, snippetPreview } = require('./lib/dialect');
const { Project } = require('./lib/project');
const { parseLine, statements } = require('./lib/parser');
const F = require('./lib/features');
const X = require('./lib/explain');
const A = require('./lib/analysis');
const B = require('./lib/build');
const S = require('./lib/skool');
const SP = require('./lib/panel');
const RT = require('./lib/regtrack');
const PH = require('./lib/panel-html');
const SPR = require('./lib/sprites');
const SH = require('./lib/sprite-html');
const SND = require('./lib/sound');
const SNDH = require('./lib/sound-html');
const DEC = require('./lib/decoders');
const CF = require('./lib/caseformat');
const LU = require('./lib/lineup');
const X99 = require('./lib/xas99');
const BA = require('./lib/basicasm');
const LST = require('./lib/listing');
const DBG = require('./lib/debug');
const MAME = require('./lib/mame');
const U99 = require('./lib/utils99');
const T = require('./lib/tools');

const LANG = 'retroasm';
const BASIC_LANG = 'bbcbasic';        // BBC BASIC listings: only the [ ] parts are read, as BBC assembly
const NOTES_FILE = 'asm-notes.json';
const HELP_SCHEME = 'retroasm-help';

let dialects = new Map();        // id -> dialect
let builtInIds = new Set();
const project = new Project();
const openDocs = new Set();      // keys of files open in the editor (their text wins over the disk)
const scannedDirs = new Set();
const notesCache = new Map();
const helpPages = new Map();
let cyclesOn = false;
let status, diagnostics, buildDiagnostics, output, extensionPath, addressDecoration, extContext;
let addressesOn = false;
let building = false;
const lensChanged = new vscode.EventEmitter();
const tokensChanged = new vscode.EventEmitter();
const hintsChanged = new vscode.EventEmitter();
const helpChanged = new vscode.EventEmitter();
let checkTimer = null;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const cfg = () => vscode.workspace.getConfiguration('retroAsm');
const keyOf = (doc) => (doc.uri.scheme === 'file' ? doc.uri.fsPath : doc.uri.toString());
const uriOf = (key) => (path.isAbsolute(key) ? vscode.Uri.file(key) : vscode.Uri.parse(key));
const isOurs = (doc) => !!doc && doc.languageId === LANG;
const isBasic = (doc) => !!doc && doc.languageId === BASIC_LANG;
const basicFiles = new Set();     // files read as BBC BASIC (the model holds only their [ ] parts)
// In a folder the user hasn't said they trust, tooltips and links still work, but nothing is run
// and chip files from the project folder aren't loaded.
const trusted = () => vscode.workspace.isTrusted !== false;
const md = (text) => { const m = new vscode.MarkdownString(text); m.supportHtml = false; return m; };

function knownExtensions() {
  const exts = new Set();
  for (const D of dialects.values()) for (const e of D.fileExtensions) exts.add(e);
  for (const e of Object.keys(cfg().get('dialectByExtension') || {})) exts.add(e.toLowerCase());
  for (const doc of vscode.workspace.textDocuments) if (isOurs(doc) && doc.uri.scheme === 'file') exts.add(path.extname(doc.uri.fsPath).toLowerCase());
  exts.delete('');
  return exts;
}

const guessed = new Map();   // file -> chip id, for endings more than one chip uses (.asm)
const picked = new Map();    // file with no extension (a new, unsaved one) -> chip id the user chose with Switch chip

function dialectForPath(file, text) {
  const ext = path.extname(file).toLowerCase();
  if (basicFiles.has(file) || ext === '.bas') return dialects.get('bbc') || null;
  if (!ext && picked.has(file) && dialects.has(picked.get(file))) return dialects.get(picked.get(file));
  const map = cfg().get('dialectByExtension') || {};
  for (const k of Object.keys(map)) if (k.toLowerCase() === ext && dialects.has(map[k])) return dialects.get(map[k]);
  const claim = [...dialects.values()].filter(D => D.fileExtensions.includes(ext));
  if (claim.length === 1) return claim[0];
  if (claim.length > 1) {
    // .asm could be 6502 or Z80: look at the instructions in the file, once, and stick with the answer
    const had = guessed.get(file);
    if (had && dialects.has(had) && claim.includes(dialects.get(had))) return dialects.get(had);
    // a file pulled in by another one is written for the same chip
    for (const [f, m] of project.models) {
      if (f !== file && claim.includes(m.D) && m.includes.some(inc => !inc.binary && project.resolveInclude(f, inc.name).toLowerCase() === file.toLowerCase())) { guessed.set(file, m.D.id); return m.D; }
    }
    if (text === undefined) { const m = project.get(file); if (m) text = m.text; else { try { text = fs.readFileSync(file, 'utf8').slice(0, 200000); } catch (e) { text = ''; } } }
    // an empty file has nothing to look at: use the chip whose usual ending this is (.6502 -> BBC)
    if (!text || !text.trim()) return claim.find(D => D.fileExtensions[0] === ext) || claim[0];
    const D = guessDialect(text, claim);
    if (text && text.trim()) guessed.set(file, D.id);
    return D;
  }
  return dialects.get(cfg().get('defaultDialect')) || dialects.values().next().value;
}

function dialectFolders() {
  const out = [];
  for (let f of cfg().get('dialectFolders') || []) {
    if (!f) continue;
    if (f.startsWith('~')) f = path.join(os.homedir(), f.slice(1));
    if (path.isAbsolute(f)) out.push(f);
    else if (!trusted()) continue;      // chip files inside the project wait until the folder is trusted
    else for (const w of vscode.workspace.workspaceFolders || []) if (w.uri.scheme === 'file') out.push(path.join(w.uri.fsPath, f));
  }
  return out;
}

function loadDialects() {
  const next = new Map();
  builtInIds = new Set();
  const problems = [];
  const built = loadFolder(path.join(extensionPath, 'dialects'));
  for (const D of built.dialects) { next.set(D.id, D); builtInIds.add(D.id); }
  problems.push(...built.errors);
  for (const folder of dialectFolders()) {
    const mine = loadFolder(folder);
    for (const D of mine.dialects) { next.set(D.id, D); builtInIds.delete(D.id); }
    problems.push(...mine.errors);
  }
  dialects = next;
  if (problems.length) {
    output.appendLine('Problems loading chip files:');
    for (const p of problems) output.appendLine('  ' + p);
    vscode.window.showWarningMessage(`Retro ASM: ${problems.length} chip file(s) could not be read. See the "Retro ASM" output panel.`);
  }
}

// ---------------------------------------------------------------------------
// keeping the index up to date
// ---------------------------------------------------------------------------
function loadDiskFile(file) {
  if (openDocs.has(file)) return;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { project.remove(file); return; }
  if (text.length > 4 * 1024 * 1024) return;
  if (!dialects.size) return;
  setFile(file, text);
}

/** Put a file in the index. A BBC BASIC listing goes in with only its [ ] parts (the rest is blanked). */
function setFile(file, text) {
  if (basicFiles.has(file) || path.extname(file).toLowerCase() === '.bas') {
    const D = dialectForPath(file, text);
    if (!D) { project.remove(file); return null; }
    const model = project.set(file, BA.mask(text).text, D);
    model.noAddresses = true;             // where the code lands is only known when BASIC runs
    return model;
  }
  return project.set(file, text, dialectForPath(file, text));
}

/** Read in the other source files around this one: same folder, and anything it COPYs. */
function loadNeighbours(file, depth) {
  if (!path.isAbsolute(file) || (depth || 0) > 8) return;
  const dir = path.dirname(file);
  if (!scannedDirs.has(dir)) {
    scannedDirs.add(dir);
    const exts = knownExtensions();
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { /* ignore */ }
    for (const n of names) {
      const full = path.join(dir, n);
      if (exts.has(path.extname(n).toLowerCase()) && !project.get(full)) loadDiskFile(full);
    }
  }
  const model = project.get(file);
  if (!model) return;
  for (const inc of model.includes) {
    if (inc.binary) continue;
    const target = project.resolveInclude(file, inc.name);
    if (!project.get(target) && fs.existsSync(target)) { loadDiskFile(target); loadNeighbours(target, (depth || 0) + 1); }
  }
}

function syncDoc(doc) {
  if (isBasic(doc) && dialects.size) {
    const key = keyOf(doc);
    basicFiles.add(key);
    openDocs.add(key);
    return setFile(key, doc.getText());
  }
  if (!isOurs(doc) || !dialects.size) return null;
  const key = keyOf(doc);
  openDocs.add(key);
  const model = setFile(key, doc.getText());
  loadNeighbours(key);
  return model;
}

function reindexAll() {
  const files = [...project.models.keys()];
  scannedDirs.clear();
  for (const f of files) project.remove(f);
  for (const doc of vscode.workspace.textDocuments) syncDoc(doc);
  for (const f of files) if (!project.get(f) && path.isAbsolute(f)) loadDiskFile(f);
  refreshEverything();
}

function refreshEverything() {
  tokensChanged.fire();
  lensChanged.fire();
  scheduleAddresses();
  scheduleChecks();
  updateStatus();
  refreshPanels();
}

async function scanWorkspace() {
  const exts = [...knownExtensions()].map(e => e.replace(/^\./, ''));
  if (!exts.length || !(vscode.workspace.workspaceFolders || []).length) return;
  const glob = exts.length === 1 ? `**/*.${exts[0]}` : `**/*.{${exts.join(',')}}`;
  try {
    const found = await vscode.workspace.findFiles(glob, '**/node_modules/**', 3000);
    for (const uri of found) if (uri.scheme === 'file' && !project.get(uri.fsPath)) loadDiskFile(uri.fsPath);
    refreshEverything();
  } catch (e) { output.appendLine('Workspace scan failed: ' + e.message); }
}

// ---------------------------------------------------------------------------
// notes file (asm-notes.json)
// ---------------------------------------------------------------------------
function notesFor(file) {
  if (!path.isAbsolute(file)) return {};
  let dir = path.dirname(file);
  if (notesCache.has(dir)) return notesCache.get(dir);
  let found = {};
  let d = dir;
  for (let i = 0; i < 6; i++) {
    const p = path.join(d, NOTES_FILE);
    if (fs.existsSync(p)) {
      try { found = JSON.parse(fs.readFileSync(p, 'utf8')); }
      catch (e) { output.appendLine(`${p}: ${e.message}`); found = {}; }
      break;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  notesCache.set(dir, found);
  return found;
}

// ---------------------------------------------------------------------------
// the original game (a SkoolKit .skool file), for "(Spectrum $A420)" in comments
// ---------------------------------------------------------------------------
const skoolPaths = new Map();    // source folder -> .skool path (or null)
const skoolIndexes = new Map();  // .skool path -> { mtime, index }

function forgetSkool() { skoolPaths.clear(); skoolIndexes.clear(); }

function skoolSetting() {
  let s = String(cfg().get('original.skoolFile') || '').trim();
  if (s.startsWith('~')) s = path.join(os.homedir(), s.slice(1));
  return s;
}

/** The .skool file for a source file, read and indexed: { file, index } or null. */
function skoolFor(file) {
  if (!path.isAbsolute(file)) return null;
  const setting = skoolSetting();
  const dir = path.dirname(file);
  let p;
  if (skoolPaths.has(dir)) p = skoolPaths.get(dir);
  else {
    const w = vscode.workspace.getWorkspaceFolder ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file)) : null;
    const base = w && w.uri.scheme === 'file' ? w.uri.fsPath : ((vscode.workspace.workspaceFolders || []).find(x => x.uri.scheme === 'file') || { uri: { fsPath: dir } }).uri.fsPath;
    p = S.findSkool(file, setting, base);
    skoolPaths.set(dir, p);
  }
  if (!p) return null;
  let st;
  try { st = fs.statSync(p); } catch (e) { return null; }
  let c = skoolIndexes.get(p);
  if (!c || c.mtime !== st.mtimeMs) {
    try { c = { mtime: st.mtimeMs, file: p, index: S.parseSkool(fs.readFileSync(p, 'utf8')) }; }
    catch (e) { output.appendLine(`${p}: ${e.message}`); return null; }
    skoolIndexes.set(p, c);
  }
  return c;
}

/** "$A420" addresses in the comment on one line that the .skool file knows about. */
function originalRefs(model, line, skool) {
  const pl = model.lines[line];
  if (!pl || !pl.comment || !skool) return [];
  const out = [];
  for (const r of S.findRefsInText(pl.comment.text)) {
    const hit = S.lookup(skool.index, r.addr);
    if (hit) out.push({ addr: r.addr, start: r.start + pl.comment.start, end: r.end + pl.comment.start, hit });
  }
  return out;
}

function originalRefAt(doc, pos) {
  const model = project.get(keyOf(doc));
  if (!model || doc.uri.scheme !== 'file') return null;
  const pl = model.lines[pos.line];
  if (!pl || !pl.comment || pos.character < pl.comment.start) return null;
  const skool = skoolFor(keyOf(doc));
  if (!skool) return null;
  const ref = originalRefs(model, pos.line, skool).find(r => pos.character >= r.start && pos.character <= r.end);
  return ref ? Object.assign({ skool }, ref) : null;
}

const openOriginalUri = (addr, file) => vscode.Uri.parse('command:retroAsm.openOriginal?' + encodeURIComponent(JSON.stringify([addr, file])));

function originalHover(ref, file) {
  const { hit, skool } = ref;
  const e = hit.entry;
  const name = path.basename(skool.file);
  let head = `**Original code at ${S.hex4(ref.addr)}**`;
  if (e.label) head += ` \u2014 \`${String(e.label).replace(/[^\w.$]/g, '')}\``;
  if (e.title) head += `\n\n${X.esc(e.title)}`;
  if (!hit.exact) head += `\n\n${S.hex4(ref.addr)} is part of the line at ${S.hex4(hit.at)}.`;
  else if (e.addr !== ref.addr) head += `\n\nPart of the entry that starts at ${S.hex4(e.addr)}.`;
  const lines = S.previewLines(skool.index, hit.line, 8).map(l => l.replace(/```/g, "'''"));
  const code = '```\n' + lines.join('\n') + '\n```';
  const open = `[Open beside the code](${openOriginalUri(ref.addr, file).toString()}) \u00B7 ${X.esc(name)}, line ${hit.line + 1}`;
  return [head, code, open];
}

async function cmdOpenOriginal(addr, sourceFile) {
  const ed = vscode.window.activeTextEditor;
  if (!sourceFile && ed && ed.document.uri.scheme === 'file') sourceFile = ed.document.uri.fsPath;
  if (!sourceFile) { const w = (vscode.workspace.workspaceFolders || [])[0]; if (w && w.uri.scheme === 'file') sourceFile = path.join(w.uri.fsPath, 'x.a99'); }
  if (!sourceFile) { vscode.window.showInformationMessage('Open a source file first.'); return false; }
  let skool = skoolFor(sourceFile);
  if (!skool) {
    const pick = await vscode.window.showWarningMessage('Retro ASM: no .skool file of the original game was found near this source. Choose one?', 'Choose file...', 'Open settings');
    if (pick === 'Open settings') { vscode.commands.executeCommand('workbench.action.openSettings', 'retroAsm.original.skoolFile'); return false; }
    if (pick !== 'Choose file...') return false;
    const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'SkoolKit disassembly': ['skool'] }, openLabel: 'Use this file' });
    if (!chosen || !chosen.length) return false;
    const target = (vscode.workspace.workspaceFolders || []).length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await cfg().update('original.skoolFile', chosen[0].fsPath, target);
    forgetSkool();
    skool = skoolFor(sourceFile);
    if (!skool) return false;
  }
  if (addr === undefined || addr === null || addr === '') {
    const typed = await vscode.window.showInputBox({ prompt: `Address in ${path.basename(skool.file)} (hex, for example A420 or $A420)`, validateInput: (v) => (/^\s*(\$|0x|#|>)?[0-9a-f]{1,4}\s*$/i.test(v) ? null : 'A hex address such as A420') });
    if (!typed) return false;
    addr = typed;
  }
  if (typeof addr === 'string') addr = parseInt(addr.trim().replace(/^(\$|0x|#|>)/i, ''), 16);
  const hit = S.lookup(skool.index, addr);
  if (!hit) { vscode.window.showInformationMessage(`${S.hex4(addr)} is not in ${path.basename(skool.file)} (it covers ${S.hex4(skool.index.min)} to ${S.hex4(skool.index.max)}).`); return false; }
  const range = new vscode.Range(hit.line, 0, hit.line, (skool.index.lines[hit.line] || '').length);
  // reuse the editor already showing the file, so clicking address after address keeps one pane
  const shown = vscode.window.visibleTextEditors.find(x => x.document && x.document.uri.scheme === 'file' && x.document.uri.fsPath === skool.file);
  const doc = shown ? shown.document : await vscode.workspace.openTextDocument(vscode.Uri.file(skool.file));
  const opened = await vscode.window.showTextDocument(doc, { viewColumn: shown && shown.viewColumn ? shown.viewColumn : vscode.ViewColumn.Beside, preserveFocus: true, preview: false, selection: range });
  if (opened && opened.revealRange) opened.revealRange(range, vscode.TextEditorRevealType ? vscode.TextEditorRevealType.InCenter : undefined);
  return { file: skool.file, line: hit.line };
}

// ---------------------------------------------------------------------------
// checks (wavy underlines)
// ---------------------------------------------------------------------------
function scheduleChecks() {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(runChecks, 350);
}

function runChecks() {
  checkTimer = null;
  const on = cfg().get('checks');
  const seen = new Set();
  for (const doc of vscode.workspace.textDocuments) {
    if (!isOurs(doc)) continue;
    seen.add(doc.uri.toString());
    if (!on || !project.get(keyOf(doc))) { diagnostics.delete(doc.uri); continue; }
    const list = F.check(project, keyOf(doc)).map(c => {
      const d = new vscode.Diagnostic(new vscode.Range(c.line, c.start, c.line, c.end), c.message, c.severity === 'info' ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning);
      d.source = 'Retro ASM';
      if (c.fix) d.code = c.fix;
      return d;
    });
    diagnostics.set(doc.uri, list);
  }
  diagnostics.forEach((uri) => { if (!seen.has(uri.toString())) diagnostics.delete(uri); });
}

// ---------------------------------------------------------------------------
// status bar
// ---------------------------------------------------------------------------
function updateStatus() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document) || !dialects.size) { status.hide(); return; }
  const D = dialectForPath(keyOf(ed.document));
  let text = `$(circuit-board) ${D.short}`;
  let tip = `Retro ASM is reading this file as ${D.name}. Click to switch chip.`;
  try {
    const size = project.get(keyOf(ed.document)) ? A.programSize(project, keyOf(ed.document)) : null;
    if (size && size.used > 0) {
      const k = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + 'K' : n + ' bytes');
      text += size.room ? ` \u00B7 ${k(size.used)} of ${k(size.room)}` : ` \u00B7 ${k(size.used)}`;
      tip += `\n\nThe program is ${size.used.toLocaleString()} bytes, from ${X.hex(size.start, D, 4)} to ${X.hex(size.end - 1, D, 4)}.`;
      if (size.room) tip += ` That area (${size.regionText}) has room for ${size.room.toLocaleString()} bytes, so ${(size.room - size.used).toLocaleString()} are free.`;
      if (size.reloc && D.sizing && D.sizing.loadNote) tip += `\n\n${D.sizing.loadNote}. Change "retroAsm.loadAddress" in the settings if yours loads somewhere else.`;
      if (size.approx) tip += '\n\nSome lines could not be measured, so treat these numbers as rough.';
    }
  } catch (e) { /* size is a nicety */ }
  status.text = text;
  status.tooltip = tip;
  status.show();
}

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------
function modelFor(doc) { return syncDoc(doc); }

const hoverProvider = {
  provideHover(doc, pos) {
    if (!modelFor(doc)) return null;
    const file = keyOf(doc);
    const ref = originalRefAt(doc, pos);
    if (ref) {
      const parts = originalHover(ref, file).map(md);
      parts[parts.length - 1].isTrusted = { enabledCommands: ['retroAsm.openOriginal'] };
      return new vscode.Hover(parts, new vscode.Range(pos.line, ref.start, pos.line, ref.end));
    }
    if (!cfg().get('hoverInComments')) {
      const tok = project.get(file).tokenAt(pos.line, pos.character);
      if (tok && tok.where === 'comment') return null;
    }
    const h = F.hoverAt(project, file, pos.line, pos.character, { pictures: cfg().get('pictures') });
    if (!h) return null;
    return new vscode.Hover(h.parts.map(md), new vscode.Range(pos.line, h.start, pos.line, h.end));
  }
};

function locationOf(def) {
  return new vscode.Location(uriOf(def.file), new vscode.Range(def.line, def.start, def.line, def.end));
}

const definitionProvider = {
  provideDefinition(doc, pos) {
    if (!modelFor(doc)) return null;
    const file = keyOf(doc);
    const inc = F.includeAt(project, file, pos.line, pos.character);
    if (inc) return fs.existsSync(inc.target) ? new vscode.Location(vscode.Uri.file(inc.target), new vscode.Position(0, 0)) : null;
    const ref = originalRefAt(doc, pos);
    if (ref) return [new vscode.Location(vscode.Uri.file(ref.skool.file), new vscode.Range(ref.hit.line, 0, ref.hit.line, 0))];
    const sym = F.symbolAt(project, file, pos.line, pos.character);
    if (!sym) return null;
    if (sym.where === 'comment' && !cfg().get('hoverInComments')) return null;
    let defs = project.findDefs(file, sym.name);
    if (!defs.length) defs = project.findDefsAnywhere(sym.name);
    return defs.map(locationOf);
  }
};

const referenceProvider = {
  provideReferences(doc, pos, context) {
    if (!modelFor(doc)) return null;
    const file = keyOf(doc);
    const sym = F.symbolAt(project, file, pos.line, pos.character);
    if (!sym) return null;
    const out = project.findRefs(file, sym.name).map(r => new vscode.Location(uriOf(r.file), new vscode.Range(r.line, r.start, r.line, r.end)));
    if (context.includeDeclaration) out.push(...project.findDefs(file, sym.name).map(locationOf));
    return out;
  }
};

const highlightProvider = {
  provideDocumentHighlights(doc, pos) {
    if (!modelFor(doc)) return null;
    const file = keyOf(doc);
    const sym = F.symbolAt(project, file, pos.line, pos.character);
    if (!sym) return null;
    const out = [];
    for (const d of project.findDefs(file, sym.name)) if (d.file === file) out.push(new vscode.DocumentHighlight(new vscode.Range(d.line, d.start, d.line, d.end), vscode.DocumentHighlightKind.Write));
    for (const r of project.findRefs(file, sym.name)) if (r.file === file) out.push(new vscode.DocumentHighlight(new vscode.Range(r.line, r.start, r.line, r.end), vscode.DocumentHighlightKind.Read));
    return out;
  }
};

const KIND = {
  routine: vscode.SymbolKind.Function,
  label: vscode.SymbolKind.Field,
  const: vscode.SymbolKind.Constant,
  data: vscode.SymbolKind.Variable,
  macro: vscode.SymbolKind.Method
};

const symbolProvider = {
  provideDocumentSymbols(doc) {
    if (!modelFor(doc)) return [];
    const make = (n) => {
      const endLen = doc.lineAt(Math.min(n.endLine, doc.lineCount - 1)).text.length;
      const s = new vscode.DocumentSymbol(n.name || '?', n.detail || '', KIND[n.kind] || vscode.SymbolKind.Field,
        new vscode.Range(n.line, 0, Math.min(n.endLine, doc.lineCount - 1), endLen),
        new vscode.Range(n.line, n.start, n.line, n.end));
      s.children = n.children.map(make);
      return s;
    };
    return F.buildOutline(project, keyOf(doc)).map(make);
  }
};

const workspaceSymbolProvider = {
  provideWorkspaceSymbols(query) {
    const q = query.toLowerCase();
    const fits = (name) => {
      if (!q) return true;
      const n = name.toLowerCase();
      let i = 0;
      for (const c of n) if (c === q[i]) i++;
      return i === q.length;
    };
    const out = [];
    for (const m of project.models.values()) {
      for (const d of m.defList) {
        if (d.kind === 'extern' || !fits(d.name)) continue;
        const kind = d.kind === 'equ' ? vscode.SymbolKind.Constant : d.kind === 'data' ? vscode.SymbolKind.Variable : vscode.SymbolKind.Function;
        out.push(new vscode.SymbolInformation(d.name, kind, path.basename(d.file), locationOf(d)));
        if (out.length >= 800) return out;
      }
    }
    return out;
  }
};

const renameProvider = {
  prepareRename(doc, pos) {
    if (!modelFor(doc)) throw new Error('Nothing to rename here.');
    const file = keyOf(doc);
    const sym = F.symbolAt(project, file, pos.line, pos.character);
    if (!sym || sym.where === 'comment') throw new Error('Put the cursor on a label to rename it.');
    const defs = project.findDefs(file, sym.name);
    if (!defs.length) throw new Error(`${sym.name} isn't defined in this program, so it can't be renamed.`);
    if (defs.every(d => d.kind === 'extern')) throw new Error(`${sym.name} is defined outside this program.`);
    return { range: new vscode.Range(pos.line, sym.start, pos.line, sym.end), placeholder: sym.text || sym.name };
  },
  provideRenameEdits(doc, pos, newName) {
    if (!modelFor(doc)) return null;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) throw new Error('A label must start with a letter and use only letters, digits and _.');
    const file = keyOf(doc);
    const sym = F.symbolAt(project, file, pos.line, pos.character);
    if (!sym) return null;
    const model = project.get(file);
    if (model.D.isMnemonic(newName) || model.D.isRegister(newName)) throw new Error(`${newName} is already the name of an instruction or register.`);
    if (project.findDefs(file, newName).length && project.key(file, newName) !== project.key(file, sym.name)) throw new Error(`There is already a label called ${newName}.`);
    const edit = new vscode.WorkspaceEdit();
    for (const d of project.findDefs(file, sym.name)) edit.replace(uriOf(d.file), new vscode.Range(d.line, d.start, d.line, d.end), newName);
    for (const r of project.findRefs(file, sym.name)) edit.replace(uriOf(r.file), new vscode.Range(r.line, r.start, r.line, r.end), newName);
    // REF / DEF lines that name it are in the lists above already (DEF as a use, REF as a definition)
    return edit;
  }
};

const foldingProvider = {
  provideFoldingRanges(doc) {
    if (!modelFor(doc)) return [];
    return F.foldingRanges(project, keyOf(doc)).map(r => new vscode.FoldingRange(r.start, r.end, r.kind === 'comment' ? vscode.FoldingRangeKind.Comment : vscode.FoldingRangeKind.Region));
  }
};

const linkProvider = {
  provideDocumentLinks(doc) {
    const model = modelFor(doc);
    if (!model) return [];
    const file = keyOf(doc);
    const out = [];
    for (const inc of model.includes) {
      const target = project.resolveInclude(file, inc.name);
      if (!fs.existsSync(target)) continue;
      const link = new vscode.DocumentLink(new vscode.Range(inc.line, inc.start, inc.line, inc.end), vscode.Uri.file(target));
      link.tooltip = 'Open ' + inc.name;
      out.push(link);
    }
    // addresses in the original game, named in comments
    const skool = doc.uri.scheme === 'file' ? skoolFor(file) : null;
    if (skool) {
      const name = path.basename(skool.file);
      for (let ln = 0; ln < model.lines.length; ln++) {
        for (const r of originalRefs(model, ln, skool)) {
          const link = new vscode.DocumentLink(new vscode.Range(ln, r.start, ln, r.end), openOriginalUri(r.addr, file));
          link.tooltip = `Open ${name} at ${S.hex4(r.addr)}`;
          out.push(link);
        }
      }
    }
    return out;
  }
};

const legend = new vscode.SemanticTokensLegend(F.TOKEN_TYPES, F.TOKEN_MODS);
const semanticProvider = {
  onDidChangeSemanticTokens: tokensChanged.event,
  provideDocumentSemanticTokens(doc) {
    const b = new vscode.SemanticTokensBuilder(legend);
    if (!modelFor(doc)) return b.build();
    for (const t of F.semanticTokens(project, keyOf(doc))) {
      if (t.length > 0) b.push(new vscode.Range(t.line, t.start, t.line, t.start + t.length), t.type, t.mods);
    }
    return b.build();
  }
};

/**
 * Starter code from the chip file ("snippets"), offered while a lower-case word that starts one of
 * their names is the only thing on the line. Picking one replaces the whole line, so the labels in
 * it land in the first column. Lower case only, so typing a label such as LOOP doesn't offer them.
 */
function snippetItems(D, before, pos, file) {
  const m = /^(\s*)([a-z][a-z0-9]*)$/.exec(before);
  if (!m) return [];
  if (!m[1] && m[2].length < 2) return [];           // in the label column, wait for a second letter
  const out = spriteItems(D, m, pos, file);
  for (const s of D.snippets || []) {
    if (!s.key.startsWith(m[2])) continue;
    const item = new vscode.CompletionItem(s.key, vscode.CompletionItemKind.Snippet);
    item.detail = s.name + ' (starter code)';
    item.documentation = md((s.about ? s.about + '\n\n' : '') + '```\n' + s.preview + '\n```');
    item.insertText = new vscode.SnippetString(s.text);
    item.range = new vscode.Range(pos.line, 0, pos.line, pos.character);
    item.filterText = m[1] + s.key;
    item.sortText = '~' + s.key;                          // after the instructions
    out.push(item);
  }
  return out;
}

/** A free label for a new picture: SPR1, SPR2 ... on the TI, sprite1, sprite2 ... elsewhere. */
function freeSpriteName(D, file) {
  const base = D.id === 'tms9900' ? 'SPR' : 'sprite';
  let n = 1;
  while (project.findDefs(file, base + n).length) n++;
  return base + n;
}

/**
 * Typing "sprite" alone on a line offers an empty picture of each of the chip's shapes
 * ("sprite 8x8", "sprite 16x16" ...), ready marked with @sprite and named with a free label.
 * Typing a size straight after it ("sprite24x16") offers that size too. "sprite ..." runs
 * New picture here, for other sizes and animation frames.
 */
function spriteItems(D, m, pos, file) {
  const word = m[2];
  if (!file || !('sprite'.startsWith(word) || word.startsWith('sprite'))) return [];
  const specs = SPR.shapeList(D).map(s => s.spec);
  const sized = /^sprite(\d+x\d+)$/.exec(word);
  if (sized && !specs.includes(sized[1]) && !SPR.shapeFor(D, sized[1]).error) specs.push(sized[1]);
  const range = new vscode.Range(pos.line, 0, pos.line, pos.character);
  const name = freeSpriteName(D, file);
  const out = [];
  specs.forEach((spec, i) => {
    const shape = SPR.shapeFor(D, spec);
    if (shape.error) return;
    const text = SPR.blankSnippet(D, shape, name);
    const item = new vscode.CompletionItem('sprite ' + spec, vscode.CompletionItemKind.Snippet);
    const known = SPR.shapeList(D).find(s => s.spec === spec);
    item.detail = (known ? known.name : `${spec} picture`) + ` (empty, ${shape.frameBytes} bytes)`;
    item.documentation = md('An empty picture, marked so **Edit picture** opens it. Tab moves past the name.\n\n```\n' + snippetPreview(text) + '\n```');
    item.insertText = new vscode.SnippetString(text);
    item.range = range;
    item.filterText = m[1] + 'sprite' + spec;
    item.sortText = '~sprite' + String(i).padStart(2, '0');
    out.push(item);
  });
  const more = new vscode.CompletionItem('sprite ...', vscode.CompletionItemKind.Snippet);
  more.detail = 'Another size, or several frames (New picture here)';
  more.insertText = '';
  more.range = range;
  more.filterText = m[1] + 'sprite';
  more.sortText = '~sprite99';
  more.command = { command: 'retroAsm.newSprite', title: 'New picture here' };
  out.push(more);
  return out;
}

/** Retro ASM: Insert starter code. Pick one of the chip's snippets and put it at the cursor's line. */
async function cmdInsertSnippet() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document)) { vscode.window.showInformationMessage('Open an assembly file first, then insert starter code.'); return false; }
  const model = modelFor(ed.document);
  const D = model && model.D;
  if (!D || !D.snippets || !D.snippets.length) { vscode.window.showInformationMessage(`There is no starter code for ${D ? D.name : 'this chip'} yet.`); return false; }
  const pick = await vscode.window.showQuickPick(D.snippets.map(s => ({ label: s.key, description: s.name, detail: s.about, s })), { placeHolder: 'Which starter code?' });
  if (!pick) return false;
  const line = ed.selection.start.line;
  const text = ed.document.lineAt(line).text;
  // a blank line is replaced; otherwise the code goes on new lines below this one
  if (!text.trim()) return ed.insertSnippet(new vscode.SnippetString(pick.s.text), new vscode.Range(line, 0, line, text.length));
  return ed.insertSnippet(new vscode.SnippetString('\n' + pick.s.text), new vscode.Position(line, text.length));
}

const completionProvider = {
  provideCompletionItems(doc, pos) {
    const model = modelFor(doc);
    if (!model) return [];
    const D = model.D;
    const file = keyOf(doc);
    const before = doc.lineAt(pos.line).text.slice(0, pos.character);
    if (!before.length) return [];
    const whole = parseLine(before, D);
    if (whole.comment && pos.character > whole.comment.start) return [];       // typing a comment
    // "LDA #1:ST": with several statements on a line, the one being typed is the last
    const afterColon = D.syntax.colonStatements && /:\s*$/.test(whole.comment ? before.slice(0, whole.comment.start) : before);
    const pl = afterColon ? { label: null, mnem: null, operands: [], comment: null } : whole.parts ? whole.parts[whole.parts.length - 1] : whole;
    if (whole.comment && !whole.operands.length && !whole.mnem && !whole.label && !whole.parts) return [];   // a comment line
    if (pl.comment && pos.character > pl.comment.start) return [];               // typing a comment
    const endsInSpace = /\s$/.test(before);
    const inLabelColumn = !pl.mnem && !/\s/.test(before) && D.syntax.col0IsAlwaysLabel;
    const snips = snippetItems(D, before, pos, file);
    if (inLabelColumn) return snips;
    const typingMnemonic = (!pl.mnem && endsInSpace) || (pl.mnem && !endsInSpace && pl.operands.length === 0 && pos.character <= pl.mnem.end) || (!pl.mnem && !pl.label);
    const out = [];
    // past the end of the operands (and not straight after a comma): that is comment space
    if (!typingMnemonic && pl.operands.length && endsInSpace && !/,\s*$/.test(before)) return [];

    if (typingMnemonic) {
      const typed = pl.mnem ? pl.mnem.text : '';
      const lower = typed.length > 0 && typed === typed.toLowerCase() && typed !== typed.toUpperCase();
      const pad = D.syntax.mnemonicPad || 0;
      const add = (info, kind, isDir) => {
        const item = new vscode.CompletionItem(info.key, kind);
        item.detail = info.name + (isDir ? ' (to the assembler)' : '');
        item.documentation = md((info.syntax ? '```\n' + info.syntax + '\n```\n\n' : '') + info.summary + (info.more ? '\n\n' + info.more : ''));
        const range = D.operandRange(info.key);
        let text = lower ? info.key.toLowerCase() : info.key;
        if (range && range[1] > 0) text = pad ? text.padEnd(pad) : text + ' ';
        item.insertText = text;
        item.filterText = info.key;
        out.push(item);
      };
      for (const i of D.instructions.values()) add(i, vscode.CompletionItemKind.Keyword, false);
      for (const d of D.directives.values()) add(d, vscode.CompletionItemKind.Struct, true);
      return out.concat(snips);
    }
    if (snips.length) return snips;      // a lone word on the line: it can only be starter code

    // operands: labels and registers
    const seen = new Set();
    const ctx = F.makeCtx(project, file);
    for (const d of project.allDefs(file)) {
      if (seen.has(d.upper)) continue;
      seen.add(d.upper);
      const kind = d.kind === 'equ' ? vscode.CompletionItemKind.Constant : d.kind === 'data' ? vscode.CompletionItemKind.Variable : d.kind === 'extern' ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Function;
      const item = new vscode.CompletionItem(d.name, kind);
      const m = project.get(d.file);
      if (d.kind === 'equ') { const v = project.value(file, d.name); item.detail = v === null ? (d.expr || '') : `= ${X.hex(v, D, v > 0xFF || v < 0 ? 4 : 2)}  ${m ? m.trailingComment(d.line) : ''}`; }
      else if (m) item.detail = d.kind === 'data' ? m.trailingComment(d.line) : F.firstDocLine(m, d);
      item.sortText = (d.file === file ? '1' : '2') + d.name;
      out.push(item);
    }
    for (const r of D.registers.list) {
      const item = new vscode.CompletionItem(r, vscode.CompletionItemKind.Value);
      const note = ctx.regNote(r, pos.line);
      item.detail = note ? note : 'register';
      item.sortText = '0' + String(D.registers.list.indexOf(r)).padStart(3, '0');
      out.push(item);
    }
    return out;
  }
};

const lensProvider = {
  onDidChangeCodeLenses: lensChanged.event,
  provideCodeLenses(doc) {
    if (!modelFor(doc)) return [];
    const out = [];
    const file = keyOf(doc);
    if (cfg().get('routineSummaries')) {
      for (const item of F.lenses(project, file)) {
        const range = new vscode.Range(item.line, item.start, item.line, item.end);
        for (const part of item.parts) {
          if (part.refs && part.refs.length) {
            const locs = part.refs.map(r => new vscode.Location(uriOf(r.file), new vscode.Range(r.line, r.start, r.line, r.end)));
            out.push(new vscode.CodeLens(range, { title: part.text, tooltip: 'Show where', command: 'editor.action.showReferences', arguments: [doc.uri, new vscode.Position(item.line, item.start), locs] }));
          } else out.push(new vscode.CodeLens(range, { title: part.text, command: '' }));
        }
      }
    }
    if (cfg().get('pictureLinks') !== false) {
      try { out.push(...pictureLenses(doc, file)); }
      catch (e) { output.appendLine(`Picture links: ${e.stack || e.message}`); }
    }
    if (cfg().get('soundLinks') !== false) {
      try { out.push(...soundLenses(doc, file)); }
      catch (e) { output.appendLine(`Sound links: ${e.stack || e.message}`); }
    }
    return out;
  }
};

// ---------------------------------------------------------------------------
// the picture editor: BYTE / DATA lines drawn as a grid you can click on
// ---------------------------------------------------------------------------
/** "Edit picture" links above blocks marked with @sprite, and "Edit as a picture?" above ones that look like pictures. */
function pictureLenses(doc, file) {
  const model = project.get(file);
  if (!model || doc.lineCount > 30000) return [];
  const out = [];
  const marked = SPR.markedBlocks(project, file, A.dataBlock);
  const done = new Set();
  const endsAt = new Map();   // last line of a picture block -> its @sprite shape, so a block right below it can borrow the shape
  for (const m of marked) {
    done.add(m.line);
    const blk = A.dataBlock(project, file, m.line);
    const pic = blk ? SPR.pictureOf(project, file, blk, m.spec) : { error: 'no data found' };
    const range = new vscode.Range(m.line, 0, m.line, 0);
    const args = [doc.uri.toString(), m.line];
    if (pic.error) { out.push(new vscode.CodeLens(range, { title: '$(warning) Picture: ' + pic.error, command: 'retroAsm.editSprite', arguments: args })); continue; }
    const n = pic.frames.length;
    endsAt.set(blk.endLine, m.spec);
    out.push(new vscode.CodeLens(range, { title: `$(paintcan) Edit picture`, tooltip: 'Open the picture editor for these lines', command: 'retroAsm.editSprite', arguments: args }));
    out.push(new vscode.CodeLens(range, { title: `${pic.shape.name}${n > 1 ? `, ${n} pictures` : ''}${pic.editable ? '' : ' (look only)'}`, command: '' }));
  }
  if (cfg().get('pictures') === 'never') return out;
  // blocks that look like pictures by their name or comments, but have no @sprite yet
  let skipTo = -1;
  for (let ln = 0; ln < model.lines.length; ln++) {
    if (ln <= skipTo) continue;
    const pl = model.lines[ln];
    if (!pl.mnem) continue;
    const d = model.D.directive(pl.mnem.upper);
    if (!d || d.kind !== 'data' || !(d.unit === 1 || d.unit === 2)) continue;
    // only the start of a block, and only if its name or comment hints at a picture (working a block out costs time)
    const prev = ln > 0 ? model.lines[ln - 1] : null;
    if (!pl.label && prev && prev.mnem) continue;
    const top = !pl.label && prev && prev.label ? ln - 1 : ln;          // a label on its own line just above
    const name = model.lines[top].label && model.lines[top].label.name;
    // a block right below a picture (only blank or comment lines between) is probably another picture of the same shape
    let above = null;
    if (model.lines[top].label && !done.has(top)) {
      let k = top - 1;
      while (k >= 0 && !model.lines[k].mnem && !model.lines[k].label) k--;
      if (k >= 0 && endsAt.has(k)) above = endsAt.get(k);
    }
    const hinted = A.pictureHint(name, model.docAbove(top).join(' ') + ' ' + model.trailingComment(top) + ' ' + model.trailingComment(ln));
    if (!hinted && !above) continue;
    const blk = A.dataBlock(project, file, ln);
    if (!blk) continue;
    skipTo = blk.endLine;
    if (done.has(blk.labelLine)) continue;
    const range = new vscode.Range(blk.labelLine, 0, blk.labelLine, 0);
    if (!hinted && above && SPR.frameCount(blk.bytes.length, SPR.shapeFor(model.D, above)) > 0) {
      endsAt.set(blk.endLine, above);   // so a third picture below can borrow it too
      out.push(new vscode.CodeLens(range, { title: '$(paintcan) Edit picture (same shape as above)?', tooltip: `Adds a "@sprite ${above}" line above these bytes, then opens the picture editor`, command: 'retroAsm.editSprite', arguments: [doc.uri.toString(), blk.labelLine, above] }));
      continue;
    }
    if (!hinted || !A.looksLikePicture(blk)) continue;
    out.push(new vscode.CodeLens(range, { title: '$(paintcan) Edit as a picture?', tooltip: 'Choose a shape for these bytes and open the picture editor', command: 'retroAsm.editSprite', arguments: [doc.uri.toString(), blk.labelLine] }));
  }
  return out;
}

let sprite = null;          // { panel, uri, label, line, spec, frame, key }
let spriteTimer = null;

function docFor(uri) {
  const u = typeof uri === 'string' ? uri : uri && uri.toString();
  return vscode.workspace.textDocuments.find(d => d.uri.toString() === u) || null;
}

/** Ask for a shape. `length` (the block's size in bytes) puts the ones that fit first. */
async function pickShape(D, length) {
  const list = SPR.shapeList(D);
  const fits = (s) => length && SPR.frameCount(length, SPR.shapeFor(D, s.spec)) > 0;
  const items = list.map(s => {
    const n = length ? SPR.frameCount(length, SPR.shapeFor(D, s.spec)) : 0;
    return { label: s.name, description: `@sprite ${s.spec}  ·  ${s.frameBytes} bytes${n > 1 ? `  ·  ${n} pictures here` : ''}`, detail: s.about, spec: s.spec, fit: fits(s) };
  });
  if (length) items.sort((a, b) => (b.fit ? 1 : 0) - (a.fit ? 1 : 0));
  items.push({ label: 'Another size...', description: 'such as 16x8 or 24x16', spec: null });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: length ? `What shape are these ${length} bytes? (${D.short})` : `What shape of picture? (${D.short})`, matchOnDescription: true });
  if (!pick) return null;
  if (pick.spec) return pick.spec;
  const typed = await vscode.window.showInputBox({ prompt: 'Width x height in pixels', value: '16x8', validateInput: (v) => { const s = SPR.shapeFor(D, v); return s.error || null; } });
  return typed ? typed.trim() : null;
}

/** Retro ASM: Edit these bytes as a picture. From a link (uri, line) or the cursor. */
async function cmdEditSprite(uri, line, knownSpec) {
  let doc = uri ? docFor(uri) : null;
  if (!doc) { const ed = vscode.window.activeTextEditor; if (!ed || !isOurs(ed.document)) { vscode.window.showInformationMessage('Open an assembly file and put the cursor on BYTE or DATA lines to edit them as a picture.'); return false; } doc = ed.document; line = (ed.selection.active || ed.selection.start).line; }
  const model = modelFor(doc);
  if (!model) return false;
  const file = keyOf(doc);
  let blk = A.dataBlock(project, file, Number(line) || 0);
  if (!blk) {
    // on the @sprite comment itself: use the block below it
    const m = SPR.markedBlocks(project, file, A.dataBlock).find(b => b.marker === Number(line));
    if (m) blk = A.dataBlock(project, file, m.line);
  }
  if (!blk) {
    const pick = await vscode.window.showInformationMessage('There are no BYTE or DATA lines here to draw. Make a new, empty picture here instead?', 'New picture', 'Cancel');
    if (pick === 'New picture') return cmdNewSprite();
    return false;
  }
  let mark = SPR.markerFor(model, blk.labelLine, blk.firstLine);
  let at = blk.labelLine;
  if (!mark) {
    const spec = knownSpec || await pickShape(model.D, blk.bytes.length);
    if (!spec) return false;
    // remember the choice in the code, so the link and the tooltip know it too
    const we = new vscode.WorkspaceEdit();
    const indent = model.D.syntax.col0Comment.length ? '' : /^\s*/.exec(doc.lineAt(blk.labelLine).text)[0];
    we.insert(doc.uri, new vscode.Position(blk.labelLine, 0), indent + SPR.markerLine(model.D, spec) + '\n');
    if (!await vscode.workspace.applyEdit(we)) return false;
    modelFor(doc);
    at = blk.labelLine + 1;
  }
  openSprite(doc, at, blk.label);
  return true;
}

/** Retro ASM: New picture here. Puts a marked, empty picture at the cursor and opens it. */
async function cmdNewSprite() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document)) { vscode.window.showInformationMessage('Open an assembly file first, and put the cursor where the picture should go.'); return false; }
  const doc = ed.document;
  const model = modelFor(doc);
  if (!model) return false;
  const D = model.D, file = keyOf(doc);
  const spec = await pickShape(D, 0);
  if (!spec) return false;
  const shape = SPR.shapeFor(D, spec);
  if (shape.error) { vscode.window.showWarningMessage(shape.error); return false; }
  const name = await vscode.window.showInputBox({ prompt: 'A name (label) for the picture', value: freeSpriteName(D, file),
    validateInput: (v) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? 'Letters, digits and _ only, starting with a letter' : project.findDefs(file, v).length ? `${v} is already used` : null });
  if (!name) return false;
  const count = await vscode.window.showInputBox({ prompt: 'How many pictures (for animation frames)?', value: '1', validateInput: (v) => /^([1-9]|[1-5][0-9]|6[0-4])$/.test(v.trim()) ? null : 'A number from 1 to 64' });
  if (!count) return false;
  const lines = SPR.newSpriteLines(D, name, shape, parseInt(count, 10));
  const line = (ed.selection.active || ed.selection.start).line;
  const we = new vscode.WorkspaceEdit();
  we.insert(doc.uri, new vscode.Position(line, 0), lines.join('\n') + '\n');
  if (!await vscode.workspace.applyEdit(we)) return false;
  modelFor(doc);
  openSprite(doc, line + 1, name);
  return true;
}

function openSprite(doc, line, label) {
  if (!sprite) {
    const panel = vscode.window.createWebviewPanel('retroAsm.sprite', 'Picture', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    sprite = { panel };
    panel.webview.onDidReceiveMessage(onSpriteMessage);
    panel.onDidDispose(() => { if (sprite && sprite.panel === panel) sprite = null; });
    panel.webview.html = SH.page(nonce(), panel.webview.cspSource);
  } else sprite.panel.reveal(vscode.ViewColumn.Beside, true);
  Object.assign(sprite, { uri: doc.uri.toString(), label: label || null, line, frame: 0 });
  sendSprite();
}

/** Find the picture again (lines may have moved since it was opened). */
function locateSprite() {
  if (!sprite) return null;
  const doc = docFor(sprite.uri);
  if (!doc) return { error: 'The file holding this picture has been closed.' };
  const model = modelFor(doc);
  if (!model) return { error: 'The file holding this picture is not open as assembly any more.' };
  const file = keyOf(doc);
  let line = sprite.line;
  if (sprite.label) {
    let best = -1;
    model.lines.forEach((pl, i) => { if (pl.label && pl.label.name === sprite.label && (best < 0 || Math.abs(i - sprite.line) < Math.abs(best - sprite.line))) best = i; });
    if (best < 0) return { doc, error: `${sprite.label} can't be found in the file any more.` };
    line = best;
  }
  sprite.line = line;
  const blk = A.dataBlock(project, file, line);
  if (!blk) return { doc, error: `There are no BYTE or DATA lines at ${sprite.label || 'line ' + (line + 1)} any more.` };
  const mark = SPR.markerFor(model, blk.labelLine, blk.firstLine);
  if (mark) sprite.spec = mark.spec;
  const pic = SPR.pictureOf(project, file, blk, sprite.spec || '');
  return Object.assign({ doc, file, model }, pic);
}

function sendSprite() {
  if (!sprite || !sprite.panel) return;
  const at = locateSprite();
  const name = sprite.label || `line ${sprite.line + 1}`;
  sprite.panel.title = `Picture: ${name}`;
  const where = at && at.doc ? `${path.basename(at.doc.uri.fsPath || at.doc.uri.path)}, line ${sprite.line + 1}` : '';
  const msg = { type: 'state', key: sprite.uri + '|' + name, title: name, where, frame: sprite.frame || 0 };
  if (!at || at.error) msg.error = at ? at.error : 'Nothing to show.';
  else {
    const sh = at.shape;
    Object.assign(msg, {
      shape: { name: sh.name, about: sh.about || '', width: sh.width, height: sh.height, pixelWidth: sh.pixelWidth, perByte: sh.perByte, pixelBits: sh.pixelBits, bitsPerPixel: sh.bitsPerPixel, colourCount: sh.colourCount, colours: sh.colours, colourNames: sh.colourNames, order: sh.order, orderText: sh.orderText, blockHeight: sh.blockHeight, bytesPerRow: sh.bytesPerRow, frameBytes: sh.frameBytes, stride: sh.stride },
      frames: at.frames, spare: at.spare, editable: at.editable, why: at.why, hexPrefix: at.model.D.syntax.hexDisplay || '$'
    });
  }
  sprite.panel.webview.postMessage(msg);
  return msg;
}

function scheduleSprite() {
  if (!sprite) return;
  if (spriteTimer) clearTimeout(spriteTimer);
  spriteTimer = setTimeout(() => { spriteTimer = null; sendSprite(); }, 40);
}

async function onSpriteMessage(m) {
  if (!m || !sprite) return;
  if (m.type === 'ready') { sendSprite(); return; }
  if (m.type === 'frame') { sprite.frame = Number(m.index) || 0; return; }
  if (m.type === 'goto') {
    const doc = docFor(sprite.uri);
    if (!doc) return;
    const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    if (ed) { const p = new vscode.Position(sprite.line, 0); ed.selection = new vscode.Selection(p, p); ed.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenterIfOutsideViewport); }
    return;
  }
  if (m.type === 'paint') return paintSprite(Number(m.frame) || 0, m.pixels);
}

/** Store one edited picture in the source, changing only the numbers that differ. */
async function paintSprite(frame, pixels) {
  const at = locateSprite();
  if (!at || at.error || !at.shape) { sendSprite(); return false; }
  if (!at.editable) { vscode.window.showWarningMessage(`This picture can only be looked at: ${at.why}.`); sendSprite(); return false; }
  const sh = at.shape;
  if (!Array.isArray(pixels) || pixels.length !== sh.width * sh.height || frame < 0 || frame >= at.frames.length) { sendSprite(); return false; }
  const clean = pixels.map(v => Math.max(0, Math.min(sh.colourCount - 1, Number(v) | 0)));
  const bytes = at.blk.bytes.slice();
  SPR.encode(clean, sh).forEach((b, i) => { bytes[frame * sh.stride + i] = b; });
  const edits = SPR.editsFor(project, at.file, at.blk, bytes);
  if (!edits.length) return true;
  const we = new vscode.WorkspaceEdit();
  for (const e of edits) we.replace(at.doc.uri, new vscode.Range(e.line, e.start, e.line, e.end), e.text);
  const okay = await vscode.workspace.applyEdit(we);
  if (!okay) sendSprite();
  return okay;
}

// ---------------------------------------------------------------------------
// the sound player: BYTE / DATA lines played through the sound chip
// ---------------------------------------------------------------------------
/** "Play sound" links above blocks marked with @sound, and "Play as a sound?" above ones that read as a sound list and are named like one. */
function soundLenses(doc, file) {
  const model = project.get(file);
  if (!model || !SND.settings(model.D) || doc.lineCount > 30000) return [];
  const out = [];
  const done = new Set();
  for (const m of SND.markedBlocks(project, file, A.dataBlock)) {
    done.add(m.line);
    const blk = A.dataBlock(project, file, m.line);
    const info = blk ? SND.analyse(blk.bytes) : { error: 'no data found' };
    const range = new vscode.Range(m.line, 0, m.line, 0);
    const args = [doc.uri.toString(), m.line];
    if (info.error) { out.push(new vscode.CodeLens(range, { title: '$(warning) Sound: ' + info.error, command: 'retroAsm.playSound', arguments: args })); continue; }
    out.push(new vscode.CodeLens(range, { title: '$(play) Play sound', tooltip: 'Open the sound player for these lines', command: 'retroAsm.playSound', arguments: args }));
    out.push(new vscode.CodeLens(range, { title: `${info.steps.length} ${info.steps.length === 1 ? 'step' : 'steps'}, ${info.seconds.toFixed(2)} s`, command: '' }));
  }
  let skipTo = -1;
  for (let ln = 0; ln < model.lines.length; ln++) {
    if (ln <= skipTo) continue;
    const pl = model.lines[ln];
    if (!pl.mnem) continue;
    const d = model.D.directive(pl.mnem.upper);
    if (!d || d.kind !== 'data' || !(d.unit === 1 || d.unit === 2)) continue;
    const prev = ln > 0 ? model.lines[ln - 1] : null;
    if (!pl.label && prev && prev.mnem) continue;
    const top = !pl.label && prev && prev.label ? ln - 1 : ln;
    const name = model.lines[top].label && model.lines[top].label.name;
    if (!SND.soundHint(name, model.docAbove(top).join(' ') + ' ' + model.trailingComment(top) + ' ' + model.trailingComment(ln))) continue;
    const blk = A.dataBlock(project, file, ln);
    if (!blk) continue;
    skipTo = blk.endLine;
    if (done.has(blk.labelLine) || !SND.looksLikeSound(blk)) continue;
    out.push(new vscode.CodeLens(new vscode.Range(blk.labelLine, 0, blk.labelLine, 0), { title: '$(play) Play as a sound?', tooltip: 'These bytes read as a sound list. Open the sound player (nothing in your code is changed)', command: 'retroAsm.playSound', arguments: [doc.uri.toString(), blk.labelLine] }));
  }
  return out;
}

let sound = null;          // { panel, uri, label, line }

/** Retro ASM: Play this sound. From a link (uri, line) or the cursor. */
async function cmdPlaySound(uri, line) {
  let doc = uri ? docFor(uri) : null;
  if (!doc) { const ed = vscode.window.activeTextEditor; if (!ed || !isOurs(ed.document)) { vscode.window.showInformationMessage('Open an assembly file and put the cursor on BYTE or DATA lines to play them as a sound.'); return false; } doc = ed.document; line = (ed.selection.active || ed.selection.start).line; }
  const model = modelFor(doc);
  if (!model) return false;
  if (!SND.settings(model.D)) { vscode.window.showInformationMessage(`The sound player does not know the ${model.D.short} sound chip yet. It plays TI-99/4A sound lists.`); return false; }
  const file = keyOf(doc);
  let blk = A.dataBlock(project, file, Number(line) || 0);
  if (!blk) {
    const m = SND.markedBlocks(project, file, A.dataBlock).find(b => b.marker === Number(line));
    if (m) blk = A.dataBlock(project, file, m.line);
  }
  if (!blk) { vscode.window.showInformationMessage('There are no BYTE or DATA lines here to play.'); return false; }
  openSound(doc, blk.labelLine, blk.label);
  return true;
}

function openSound(doc, line, label) {
  if (!sound) {
    const panel = vscode.window.createWebviewPanel('retroAsm.sound', 'Sound', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    sound = { panel };
    panel.webview.onDidReceiveMessage(onSoundMessage);
    panel.onDidDispose(() => { if (sound && sound.panel === panel) sound = null; });
    panel.webview.html = SNDH.page(nonce(), panel.webview.cspSource);
  } else sound.panel.reveal(vscode.ViewColumn.Beside, true);
  Object.assign(sound, { uri: doc.uri.toString(), label: label || null, line });
  sendSound();
}

function sendSound() {
  if (!sound || !sound.panel) return;
  const name = sound.label || `line ${sound.line + 1}`;
  sound.panel.title = `Sound: ${name}`;
  const msg = { type: 'state', key: sound.uri + '|' + name, title: name, where: '' };
  const doc = docFor(sound.uri);
  const model = doc ? modelFor(doc) : null;
  if (!doc) msg.error = 'The file holding this sound has been closed.';
  else if (!model) msg.error = 'The file holding this sound is not open as assembly any more.';
  else {
    const file = keyOf(doc);
    let line = sound.line;
    if (sound.label) {      // lines may have moved: find the label again, the nearest one if there are several
      let best = -1;
      model.lines.forEach((pl, i) => { if (pl.label && pl.label.name === sound.label && (best < 0 || Math.abs(i - sound.line) < Math.abs(best - sound.line))) best = i; });
      if (best < 0) msg.error = `${sound.label} can't be found in the file any more.`;
      else line = best;
    }
    sound.line = line;
    msg.where = `${path.basename(doc.uri.fsPath || doc.uri.path)}, line ${line + 1}`;
    const blk = msg.error ? null : A.dataBlock(project, file, line);
    if (!msg.error && !blk) msg.error = `There are no BYTE or DATA lines at ${sound.label || 'line ' + (line + 1)} any more.`;
    if (blk) {
      const info = SND.analyse(blk.bytes);
      if (info.error) msg.error = info.error;
      else {
        Object.assign(msg, {
          steps: info.steps.map(s => ({ bytes: s.bytes, ticks: s.ticks, items: s.bytes.map(b => ({ hex: '>' + b.toString(16).toUpperCase().padStart(2, '0'), text: DEC.sn76489(b) })) })),
          ticks: info.ticks, seconds: info.seconds, ended: info.ended, spare: info.spare
        });
      }
    }
  }
  sound.panel.webview.postMessage(msg);
  return msg;
}

let soundTimer = null;
function scheduleSound() {
  if (!sound) return;
  if (soundTimer) clearTimeout(soundTimer);
  soundTimer = setTimeout(() => { soundTimer = null; sendSound(); }, 40);
}

async function onSoundMessage(m) {
  if (!m || !sound) return;
  if (m.type === 'ready') { sendSound(); return; }
  if (m.type === 'goto') {
    const doc = docFor(sound.uri);
    if (!doc) return;
    const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    if (ed) { const p = new vscode.Position(sound.line, 0); ed.selection = new vscode.Selection(p, p); ed.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenterIfOutsideViewport); }
  }
}

// ---------------------------------------------------------------------------
// addresses down the left of the code
// ---------------------------------------------------------------------------
let addressTimer = null;
function scheduleAddresses() {
  if (addressTimer) clearTimeout(addressTimer);
  addressTimer = setTimeout(paintAddresses, 200);
}

function paintAddresses() {
  addressTimer = null;
  if (!addressDecoration) return;
  for (const ed of vscode.window.visibleTextEditors) {
    if (!isOurs(ed.document)) continue;
    const file = keyOf(ed.document);
    const model = project.get(file);
    if (!addressesOn || !model || !model.D.sizing || ed.document.lineCount > 30000) { ed.setDecorations(addressDecoration, []); continue; }
    const D = model.D;
    const blank = '\u00A0\u00A0\u00A0\u00A0';
    const marks = [];
    for (let ln = 0; ln < ed.document.lineCount && ln < model.lines.length; ln++) {
      const pl = model.lines[ln];
      const info = pl.mnem || pl.label ? project.lineInfo(file, ln) : null;
      const dir = pl.mnem ? D.directive(pl.mnem.upper) : null;
      const show = info && !info.approx && !(dir && dir.kind === 'equ') && (info.size > 0 || (pl.label && !pl.mnem));
      const text = show ? info.addr.toString(16).toUpperCase().padStart(4, '0') : blank;
      marks.push({ range: new vscode.Range(ln, 0, ln, 0), renderOptions: { before: { contentText: text } } });
    }
    ed.setDecorations(addressDecoration, marks);
  }
}

function cmdToggleAddresses() {
  const ed = vscode.window.activeTextEditor;
  if (ed && isOurs(ed.document)) {
    const model = modelFor(ed.document);
    if (model && !model.D.sizing) { vscode.window.showInformationMessage(`Addresses can't be worked out for ${model.D.short} yet: its chip file has no "sizing" section.`); return; }
  }
  addressesOn = !addressesOn;
  paintAddresses();
  vscode.window.setStatusBarMessage(addressesOn ? 'Retro ASM: addresses shown' : 'Retro ASM: addresses hidden', 3000);
}

// ---------------------------------------------------------------------------
// "14 cycles" beside each instruction line
// ---------------------------------------------------------------------------
const cycleHintsProvider = {
  onDidChangeInlayHints: hintsChanged.event,
  provideInlayHints(doc, range) {
    if (!cyclesOn || !isOurs(doc) || doc.lineCount > 30000) return [];
    const file = keyOf(doc);
    if (!project.get(file)) return [];
    return F.cycleHints(project, file, range.start.line, range.end.line).map((h) => {
      const hint = new vscode.InlayHint(new vscode.Position(h.line, doc.lineAt(h.line).text.length), h.label);
      hint.paddingLeft = true;
      hint.tooltip = h.tooltip;
      return hint;
    });
  }
};

function cmdToggleCycles() {
  const ed = vscode.window.activeTextEditor;
  if (ed && isOurs(ed.document)) {
    const model = modelFor(ed.document);
    if (model && !model.D.timing) { vscode.window.showInformationMessage(`Cycle counts aren't known for ${model.D.short} yet: its chip file has no "timing" section.`); return; }
  }
  cyclesOn = !cyclesOn;
  hintsChanged.fire();
  vscode.window.setStatusBarMessage(cyclesOn ? 'Retro ASM: cycle counts shown' : 'Retro ASM: cycle counts hidden', 3000);
}

// One-click fix for the "only one space before the comment" warning.
const quickFixProvider = {
  provideCodeActions(doc, range, context) {
    const out = [];
    for (const d of context.diagnostics || []) {
      if (d.source !== 'Retro ASM' || d.code !== 'oneSpaceComment') continue;
      const act = new vscode.CodeAction('Put two spaces before the comment', vscode.CodeActionKind.QuickFix);
      act.diagnostics = [d];
      act.isPreferred = true;
      act.edit = new vscode.WorkspaceEdit();
      act.edit.insert(doc.uri, d.range.start, ' ');
      out.push(act);
    }
    return out;
  }
};

// ---------------------------------------------------------------------------
// build and run
// ---------------------------------------------------------------------------
function buildSettings(rootFile) {
  const c = cfg();
  const w = vscode.workspace.getWorkspaceFolder ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(rootFile)) : null;
  return {
    command: c.get('build.command') || '',
    runCommand: c.get('build.runCommand') || '',
    xas99Path: c.get('build.xas99Path') || '',
    python: c.get('build.python') || '',
    toolPaths: c.get('toolPaths') || {},
    toolsFolder: c.get('toolsFolder') || '',
    home: os.homedir(),
    workspaceFolder: w && w.uri.scheme === 'file' ? w.uri.fsPath : path.dirname(rootFile)
  };
}

/** Did this setting come from the project's own settings (.vscode/settings.json), not the user's? */
function fromProjectSettings(key) {
  const c = cfg();
  const i = c.inspect ? c.inspect(key) : null;
  if (!i) return false;
  return [i.workspaceValue, i.workspaceFolderValue, i.workspaceLanguageValue, i.workspaceFolderLanguageValue].some(v => v !== undefined && v !== '');
}

/**
 * Ask before running a command that comes from the project (a build.bat, an xas99 or emulator
 * found in its folders, or a command in its settings). The answer is remembered for this
 * folder, so you are asked again only if the command changes. Can be switched off in your
 * user settings (retroAsm.build.askFirst), never by a project.
 */
async function okToRun(command, what) {
  const c = cfg();
  const i = c.inspect ? c.inspect('build.askFirst') : null;
  if (i && i.globalValue === false) return true;
  const KEY = 'retroAsm.allowedCommands';
  const store = extContext && extContext.workspaceState;
  const allowed = (store && store.get(KEY)) || [];
  if (allowed.includes(command)) return true;
  const pick = await vscode.window.showWarningMessage(
    `This project wants to run ${what}. Allow it?`,
    { modal: true, detail: `${command}\n\nOnly allow this if you trust where the project came from. You won't be asked again unless the command changes.` },
    'Allow', 'Allow this time only');
  if (pick === 'Allow') { if (store) await store.update(KEY, allowed.filter(x => x !== command).concat(command).slice(-50)); return true; }
  return pick === 'Allow this time only';
}

// ---------------------------------------------------------------------------
// tools: what is installed, and where to get what is not
// ---------------------------------------------------------------------------
function toolContextFor(file) {
  const settings = buildSettings(file || path.join(os.homedir(), 'x'));
  return B.toolContext(settings, file ? path.dirname(file) : null);
}

const ROLE_TEXT = { assembler: 'the assembler', runtime: 'needed to run it', emulator: 'the emulator', debugger: 'for stepping through your program' };

/** Every chip with something to find: the one you are working on first. */
function toolChips() {
  const ed = vscode.window.activeTextEditor;
  const current = ed && isOurs(ed.document) && ed.document.uri.scheme === 'file' ? dialectForPath(keyOf(ed.document)) : null;
  const all = [...dialects.values()].filter(D => D.build && (D.build.tool || D.build.run));
  return current ? [current, ...all.filter(D => D !== current)].filter(D => all.includes(D)) : all;
}

async function cmdCheckTools() {
  toolCache.clear();
  const ed = vscode.window.activeTextEditor;
  const file = ed && isOurs(ed.document) && ed.document.uri.scheme === 'file' ? keyOf(ed.document) : null;
  for (let round = 0; round < 20; round++) {
    const ctx = toolContextFor(file);
    const items = [{ label: '$(folder) Tools folder', description: ctx.toolsFolder, detail: 'Unpack a download here and it is found by itself, whatever the folder is called. Click to open it.', folder: true }];
    const reports = new Map();
    for (const D of toolChips()) {
      const rep = B.reportTools(D, ctx);
      if (!rep.length) continue;
      reports.set(D.id, rep);
      items.push({ label: D.name, kind: vscode.QuickPickItemKind ? vscode.QuickPickItemKind.Separator : undefined });
      for (const r of rep) items.push({
        label: `${r.found ? '$(check)' : '$(warning)'} ${r.name}`,
        description: r.found ? r.found.file : 'not found',
        detail: r.found ? `${ROLE_TEXT[r.role]} · found in ${r.found.from}` : `${ROLE_TEXT[r.role]}${r.why ? ' (' + r.why + ')' : ''}. ${r.get}`,
        tool: r
      });
    }
    const pick = await vscode.window.showQuickPick(items.filter(i => i.label), { placeHolder: 'The programs each computer needs. Pick one to point to it, or to see where to get it.', matchOnDescription: true, matchOnDetail: true });
    if (!pick) return;
    if (pick.folder) {
      try { fs.mkdirSync(ctx.toolsFolder, { recursive: true }); } catch (e) { /* shown below if it matters */ }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(ctx.toolsFolder));
      return;
    }
    const r = pick.tool;
    const actions = [
      { label: '$(folder-opened) Choose the file on this computer...', detail: r.found ? 'Use a different copy.' : `Pick ${r.spec.find[0]} (or whatever it is called on your computer).`, act: 'choose' },
      ...(r.url ? [{ label: '$(link-external) Open the download page', detail: r.url, act: 'open' }] : []),
      ...(r.found ? [{ label: '$(copy) Copy the path', detail: r.found.file, act: 'copy' }] : []),
      { label: '$(arrow-left) Back', act: 'back' }
    ];
    const a = await vscode.window.showQuickPick(actions, { placeHolder: `${r.name}: ${r.found ? 'found' : 'not found'}` });
    if (!a || a.act === 'back') continue;
    if (a.act === 'open') { await vscode.env.openExternal(vscode.Uri.parse(r.url)); return; }
    if (a.act === 'copy') { await vscode.env.clipboard.writeText(r.found.file); vscode.window.setStatusBarMessage('Retro ASM: path copied', 3000); continue; }
    if (a.act === 'choose') {
      const got = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, openLabel: 'Use this', title: `Choose ${r.name}` });
      if (!got || !got.length) continue;
      const chosen = got[0].fsPath;
      const paths = Object.assign({}, cfg().get('toolPaths') || {}, { [r.id]: chosen });
      await cfg().update('toolPaths', paths, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`${r.name} will be run from ${chosen}.`);
      toolCache.clear();
      refreshPanels();
    }
  }
}

/** BeebAsm: the name in quotes on the program's first SAVE line ("SAVE \"Game\", start, end"), or ''. */
function saveNameOf(root) {
  for (const f of project.unit(root)) {
    const m = project.get(f);
    for (const pl of m.lines) for (const st of statements(pl)) {
      if (!st.mnem || st.mnem.upper !== 'SAVE' || !st.operands[0]) continue;
      const q = /^\s*"([^"]{1,12})"\s*$/.exec(st.operands[0].text);
      if (q && st.operands.length >= 3) return q[1];
    }
  }
  return '';
}

async function cmdBuild(andRun) {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document) || ed.document.uri.scheme !== 'file') { vscode.window.showInformationMessage('Open (and save) an assembly file first.'); return false; }
  if (building) { vscode.window.setStatusBarMessage('Retro ASM: a build is already running', 3000); return false; }
  if (!trusted()) {
    vscode.window.showWarningMessage('Retro ASM: build and run are switched off because this folder isn\'t trusted. Tooltips and links still work. If you trust it, use "Manage Workspace Trust" to change that.', 'Manage Workspace Trust').then((pick) => { if (pick) vscode.commands.executeCommand('workbench.trust.manage'); });
    return false;
  }
  modelFor(ed.document);
  const root = project.rootOf(keyOf(ed.document));
  const settings = buildSettings(root);
  const chip = project.get(root) ? project.get(root).D : dialectForPath(root);
  const planned = B.plan(root, settings, undefined, chip, { saveName: saveNameOf(root) });
  if (planned.error) {
    // don't wait for the message to be answered: the command finishes now, the button still works
    const setupButton = planned.setup ? 'Set up tools' : null;
    vscode.window.showErrorMessage('Retro ASM: ' + planned.error, ...(setupButton ? [setupButton] : []), 'Open settings').then((pick) => {
      if (pick === 'Open settings') vscode.commands.executeCommand('workbench.action.openSettings', 'retroAsm.build');
      else if (pick) vscode.commands.executeCommand('retroAsm.checkTools');
    });
    return false;
  }
  const buildFromProject = planned.fromProject
    || (planned.how.startsWith('your build command') && fromProjectSettings('build.command'))
    || (planned.how === 'xas99' && (fromProjectSettings('build.xas99Path') || fromProjectSettings('build.python')));
  if (buildFromProject && !(await okToRun(planned.command, planned.how === 'xas99' ? 'the assembler' : planned.how.startsWith('your') ? 'the build command in its settings' : planned.how))) {
    vscode.window.setStatusBarMessage('Retro ASM: build cancelled', 4000);
    return false;
  }
  building = true;
  try {
    // save everything first, so the assembler sees what is on screen
    for (const doc of vscode.workspace.textDocuments) if (isOurs(doc) && doc.isDirty) await doc.save();
    output.appendLine('');
    output.appendLine(`--- Build (${planned.how}) ${new Date().toLocaleTimeString()} ---`);
    output.appendLine(`> ${planned.command}`);
    if (planned.note) output.appendLine(planned.note);
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Retro ASM: building...' }, () => B.run(planned, (t) => output.append(t)));
    buildDiagnostics.clear();
    const byFile = new Map();
    for (const p of result.problems) {
      const file = project.get(p.file) ? p.file : project.resolveInclude(root, path.basename(p.file));
      const model = project.get(file);
      const line = p.line < 0 ? 0 : p.line;
      let start = 0, end = 1;
      if (model && model.rawLines[line] !== undefined) {
        const raw = model.rawLines[line];
        start = raw.length - raw.trimStart().length;
        end = Math.max(start + 1, raw.trimEnd().length);
        const pl = model.lines[line];
        if (p.line >= 0 && pl && pl.comment && pl.comment.start > start) end = Math.max(start + 1, raw.slice(0, pl.comment.start).trimEnd().length);
      }
      const d = new vscode.Diagnostic(new vscode.Range(line, start, line, end), p.message + (p.line < 0 ? ' (about the whole program)' : ''), p.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      d.source = 'assembler';
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(d);
    }
    for (const [file, list] of byFile) buildDiagnostics.set(vscode.Uri.file(file), list);
    const errors = result.problems.filter(p => p.severity !== 'warning').length;
    const warnings = result.problems.length - errors;
    const failed = errors > 0 || result.code !== 0 || /BUILD FAILED/i.test(result.text);
    lastBuild = { when: new Date(), ok: !failed, errors, warnings, file: root };
    refreshPanels();
    if (failed) {
      output.show(true);
      if (errors) vscode.commands.executeCommand('workbench.actions.view.problems');
      // with nothing to underline, say what the build said, rather than only pointing at the output panel
      const tail = result.text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^BUILD FAILED/i.test(l)).slice(-3).join(' / ').slice(0, 300);
      vscode.window.showErrorMessage(errors ? `Build failed: ${errors} error${errors === 1 ? '' : 's'}. They are underlined in the code and listed in the Problems panel.` : `Build failed${tail ? ': ' + tail : '.'} (The full text is in the "Retro ASM" output panel.)`);
      return false;
    }
    vscode.window.setStatusBarMessage(`$(check) Built ${B.tiName(root)}${warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}`, 6000);
    if (!andRun) return true;
    const runner = B.findRunner(root, settings, undefined, chip);
    if (runner && runner.missingOutput) {
      vscode.window.showInformationMessage(`Built, but ${path.basename(runner.missingOutput)} was not made, so there is nothing to start. ${/\.sna$/i.test(runner.missingOutput) ? 'Add a SAVESNA line to the code (for example SAVESNA "' + path.basename(runner.missingOutput) + '",start).' : /\.prg$/i.test(runner.missingOutput) ? 'KickAssembler names the program after the source file unless the code says otherwise.' : 'Check the output panel to see what the assembler made.'}`);
      return true;
    }
    if (runner && runner.missingTool) {
      vscode.window.showInformationMessage('Built. ' + runner.message, 'Set up tools').then((pick) => { if (pick) vscode.commands.executeCommand('retroAsm.checkTools'); });
      return true;
    }
    if (!runner) {
      vscode.window.showInformationMessage('Built. To start your emulator from here, set "retroAsm.build.runCommand" to its path.', 'Open settings').then((pick) => { if (pick) vscode.commands.executeCommand('workbench.action.openSettings', 'retroAsm.build.runCommand'); });
      return true;
    }
    if ((runner.fromProject || fromProjectSettings('build.runCommand')) && !(await okToRun(runner.command, 'the emulator ' + runner.exe))) {
      vscode.window.setStatusBarMessage('Retro ASM: built, but the emulator was not started', 4000);
      return true;
    }
    if (await B.isRunning(runner.exe)) { vscode.window.showInformationMessage(`Built. ${runner.exe} is already open, so load the program again there.`); return 'already running'; }
    output.appendLine(`> ${runner.command}`);
    B.start(runner);
    return 'started';
  } finally { building = false; }
}


// ---------------------------------------------------------------------------
// debugging (TI-99/4A, in MAME)
// ---------------------------------------------------------------------------
const DEBUG_TYPE = 'retroasm-ti99';
let debugLaunches = 0;   // each launch gets its own port, so a MAME that is slow to close can't block the next one

/** Assemble for a listing, find MAME, start it with the program loaded. Handed to the debugger. */
async function debugPrepare(args) {
  if (!trusted()) throw new Error('Debugging is switched off because this folder isn\'t trusted. Use "Manage Workspace Trust" if you trust it.');
  const ed = vscode.window.activeTextEditor;
  let file = args.program;
  if (!file && ed && isOurs(ed.document) && ed.document.uri.scheme === 'file') file = keyOf(ed.document);
  if (!file) throw new Error('Open the assembly file you want to debug first.');
  for (const doc of vscode.workspace.textDocuments) if (isOurs(doc) && doc.isDirty) await doc.save();
  const root = project.rootOf(file);
  modelFor(await vscode.workspace.openTextDocument(vscode.Uri.file(root)));
  const chip = project.get(root) ? project.get(root).D : dialectForPath(root);
  const settings = buildSettings(root);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-asm-debug-'));
  const lp = B.listingPlan(root, settings, undefined, chip, folder);
  if (lp.error) throw new Error(lp.error);
  if (lp.fromProject && !(await okToRun(lp.command, 'the assembler'))) throw new Error('Cancelled: the assembler was not allowed to run.');
  output.appendLine('');
  output.appendLine(`--- Debug build ${new Date().toLocaleTimeString()} ---`);
  output.appendLine(`> ${lp.command}`);
  const result = await B.run(lp, (t) => output.append(t));
  const errors = result.problems.filter(p => p.severity !== 'warning');
  if (errors.length || result.code !== 0 || !fs.existsSync(lp.lst)) {
    output.show(true);
    throw new Error(errors.length ? `The program has ${errors.length} error${errors.length === 1 ? '' : 's'}; fix them first (first one: ${errors[0].message}).` : 'The assembler did not finish. The "Retro ASM" output panel has what it said.');
  }
  const parsed = LST.parseListing(fs.readFileSync(lp.lst, 'utf8'), root);
  const notes = [];
  const sup = U99.supply(parsed, LST.segmentsOf);
  if (sup.error) throw new Error(sup.error);
  if (sup.added.length) notes.push(`Your program says REF ${sup.added.join(', ')}. The debugger added its own versions of those routines after your program and pointed your calls at them.`);
  for (const n of sup.missing) notes.push(`Your program says REF ${n}, which the debugger can't supply${/^(GPLLNK|XMLLNK|DSRLNK|LOADER|NUMASG|NUMREF|STRASG|STRREF|ERR|UTLTAB|ASSGNV|CFI|CIF|CNS|CSN|FADD|FSUB|FMUL|FDIV|FCOMP|SADD|SSUB|SMUL|SDIV|SCOMP|VDPADR|VPUSH|VPOP|VSBW|VMBW|VSBR|VMBR|VWTR)$/i.test(n) ? ' (it belongs to the Editor/Assembler cartridge, which is not loaded here)' : ''}. A call to it will jump to address 0 and restart the TI. Only VSBW, VMBW, VSBR, VMBR, VWTR and KSCAN are supplied.`);
  const userEntry = parsed.entry === null ? parsed.segments[0].start : parsed.entry;
  const stub = U99.startup(parsed, LST.segmentsOf, userEntry);
  if (stub !== null) notes.push('The screen is set up first (white text on light blue, as when Classic99 starts a program), then your program starts.');
  const problem = LST.checkImage(parsed);
  if (problem) throw new Error(problem);
  return { parsed, blocks: LST.blocksOf(parsed), root, folder, chip, notes, startAt: stub === null ? userEntry : stub, runUntil: stub === null ? undefined : userEntry };
}

async function debugLaunchMame(info) {
  const ctx = toolContextFor(info.root);
  const spec = info.chip && info.chip.build && info.chip.build.debug;
  const found = spec ? T.locate(spec, ctx) : null;
  if (!found) {
    const pick = await vscode.window.showErrorMessage('Retro ASM: MAME wasn\'t found. ' + (spec ? spec.get : ''), 'Set up tools');
    if (pick) vscode.commands.executeCommand('retroAsm.checkTools');
    throw new Error(spec ? T.missingMessage(spec, ctx) : 'There is no debugger for this chip yet.');
  }
  if (found.fromProject && !(await okToRun(found.file, 'MAME'))) throw new Error('Cancelled: MAME was not allowed to run.');
  const setRoms = (cfg().get('debug.romFolder') || '').trim();
  const rompath = setRoms || path.join(path.dirname(found.file), 'roms');
  if (!fs.existsSync(path.join(rompath, 'ti99_4a.zip')) && !fs.existsSync(path.join(rompath, 'ti99_4a'))) {
    throw new Error(`MAME needs the TI-99/4A system ROMs: put ti99_4a.zip in ${rompath} (or set "retroAsm.debug.romFolder" to the folder that has it).`);
  }
  return MAME.startMame({ mamePath: found.file, rompath, blocks: info.blocks, entry: info.startAt, folder: info.folder, port: MAME.DEFAULT_PORT + (debugLaunches++ % 50) });
}

async function startDebugging() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document) || ed.document.uri.scheme !== 'file') { vscode.window.showInformationMessage('Open (and save) a TI-99/4A assembly file first.'); return; }
  const folder = vscode.workspace.getWorkspaceFolder(ed.document.uri);
  // a second start while one is open would leave two MAME windows: close the first
  const open = vscode.debug.activeDebugSession;
  if (open && open.type === DEBUG_TYPE) { await vscode.debug.stopDebugging(open); await new Promise(r => setTimeout(r, 1500)); }
  return vscode.debug.startDebugging(folder, { type: DEBUG_TYPE, request: 'launch', name: 'Debug TI-99/4A program in MAME', program: keyOf(ed.document), stopOnEntry: true });
}

const debugConfigProvider = {
  resolveDebugConfiguration(folder, config) {
    if (!config.type && !config.request && !config.name) {
      config.type = DEBUG_TYPE; config.request = 'launch'; config.name = 'Debug TI-99/4A program in MAME'; config.stopOnEntry = true;
    }
    if (!config.program) {
      const ed = vscode.window.activeTextEditor;
      if (ed && isOurs(ed.document) && ed.document.uri.scheme === 'file') config.program = keyOf(ed.document);
    }
    return config;
  }
};

const debugAdapterFactory = {
  createDebugAdapterDescriptor() {
    const session = new DBG.DebugSession({ prepare: debugPrepare, launchMame: debugLaunchMame });
    const sent = new vscode.EventEmitter();
    session.on('message', (m) => sent.fire(m));
    return new vscode.DebugAdapterInlineImplementation({
      onDidSendMessage: sent.event,
      handleMessage: (m) => { session.handleMessage(m); },
      dispose: () => { session.close().catch(() => {}); sent.dispose(); }
    });
  }
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
async function showHelp(title, markdown) {
  const uri = vscode.Uri.from({ scheme: HELP_SCHEME, path: '/' + title.replace(/[\\/:*?"<>|#]/g, ' ') + '.md' });
  helpPages.set(uri.toString(), markdown);
  helpChanged.fire(uri);
  try { await vscode.commands.executeCommand('markdown.showPreviewToSide', uri); }
  catch (e) {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }
}

async function cmdExplain() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !modelFor(ed.document)) { vscode.window.showInformationMessage('Open an assembly file first.'); return; }
  const file = keyOf(ed.document);
  let from = ed.selection.start.line, to = ed.selection.end.line;
  if (ed.selection.isEmpty) {
    // no selection: explain the whole routine the cursor is in
    const node = F.buildOutline(project, file).filter(n => n.kind === 'routine').find(n => from >= n.line && from <= n.endLine);
    if (node) { from = node.line; to = node.endLine; }
  } else if (ed.selection.end.character === 0 && to > from) to--;
  await showHelp('Plain English', F.explainLines(project, file, from, to));
}

async function cmdReference() {
  // the code may be beside a help page that has the focus: use the code's chip then, rather than asking
  const ed = [vscode.window.activeTextEditor, ...vscode.window.visibleTextEditors].find(e => e && isOurs(e.document));
  let D = ed ? dialectForPath(keyOf(ed.document)) : null;
  if (!D) D = await pickDialect('Which chip?');
  if (!D) return;
  await showHelp(`${D.short} cheat sheet`, X.referenceSheet(D));
}

async function pickDialect(placeHolder) {
  const items = [...dialects.values()].map(D => ({ label: D.name, description: D.id + (builtInIds.has(D.id) ? '  (built in)' : '  (yours: ' + path.basename(D.source) + ')'), D }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder });
  return pick ? pick.D : null;
}

async function cmdSwitch() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document)) { vscode.window.showInformationMessage('Open an assembly file first, then switch chip.'); return; }
  const ext = path.extname(keyOf(ed.document)).toLowerCase();
  const D = await pickDialect(`Read ${ext || 'this kind of'} files as which chip?`);
  if (!D) return;
  if (!ext) {
    // nothing to remember it by after the file is saved, but use it for this file now
    picked.set(keyOf(ed.document), D.id);
    reindexAll();
    vscode.window.showInformationMessage(`This file is now read as ${D.name}. It has no extension yet, so save it with one (such as ${D.fileExtensions[0] || '.asm'}) to keep the choice.`);
    return;
  }
  const map = Object.assign({}, cfg().get('dialectByExtension') || {});
  map[ext] = D.id;
  const target = (vscode.workspace.workspaceFolders || []).length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await cfg().update('dialectByExtension', map, target);
  reindexAll();
  vscode.window.showInformationMessage(`${ext} files are now read as ${D.name}.`);
}

function baseFolder() {
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.uri.scheme === 'file') return path.dirname(ed.document.uri.fsPath);
  const w = (vscode.workspace.workspaceFolders || [])[0];
  return w && w.uri.scheme === 'file' ? w.uri.fsPath : null;
}

async function cmdNotes() {
  const dir = baseFolder();
  if (!dir) { vscode.window.showInformationMessage('Open a folder or a saved file first.'); return; }
  // use an existing notes file further up, if there is one
  let target = path.join(dir, NOTES_FILE);
  let d = dir;
  for (let i = 0; i < 6; i++) {
    const p = path.join(d, NOTES_FILE);
    if (fs.existsSync(p)) { target = p; break; }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  if (!fs.existsSync(target)) fs.writeFileSync(target, fs.readFileSync(path.join(extensionPath, 'templates', NOTES_FILE), 'utf8'));
  notesCache.clear();
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
}

async function cmdNewDialect() {
  const w = (vscode.workspace.workspaceFolders || [])[0];
  if (!w || w.uri.scheme !== 'file') { vscode.window.showInformationMessage('Open your project folder first; the new chip file is saved inside it.'); return; }
  const id = await vscode.window.showInputBox({ prompt: 'Short id for the new chip (letters and digits, e.g. 6502)', validateInput: (v) => (/^[a-z0-9_-]+$/i.test(v) ? null : 'Letters, digits, - and _ only') });
  if (!id) return;
  const folders = cfg().get('dialectFolders') || ['asm-dialects'];
  const rel = folders.find(f => f && !path.isAbsolute(f) && !f.startsWith('~')) || 'asm-dialects';
  const dir = path.join(w.uri.fsPath, rel);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, id.toLowerCase() + '.json');
  if (!fs.existsSync(target)) {
    const tpl = fs.readFileSync(path.join(extensionPath, 'templates', 'new-dialect.json'), 'utf8').replace(/__ID__/g, id.toLowerCase()).replace(/__NAME__/g, id.toUpperCase());
    fs.writeFileSync(target, tpl);
  }
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
  loadDialects();
  reindexAll();
  vscode.window.showInformationMessage(`Created ${rel}/${path.basename(target)}. Fill it in and save: it reloads by itself. Then use "Switch chip" on a source file.`);
}

function cmdReload() {
  loadDialects();
  notesCache.clear();
  reindexAll();
  vscode.window.showInformationMessage(`Retro ASM: ${dialects.size} chip file(s) loaded: ${[...dialects.values()].map(d => d.short).join(', ')}.`);
}

// ---------------------------------------------------------------------------
// the side panel (the chip icon on the left-hand bar)
// Worked out from your code and the chip files only: nothing is sent anywhere, no AI.
// ---------------------------------------------------------------------------
let lastBuild = null;          // { when, ok, errors, warnings, file }
let panelFile = null;          // the assembly file the panel is about (stays put while you click in the panel)
let panelLine = 0;
let panelCol = 0;               // the cursor's column: on a line with several statements, says which one
let panelTimer = null, lineTimer = null;
const PANEL_COMMANDS = new Set(['retroAsm.explainSelection', 'retroAsm.showReference', 'retroAsm.toggleAddresses', 'retroAsm.build', 'retroAsm.buildAndRun', 'retroAsm.switchDialect']);
const nonce = () => crypto.randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]/g, '');

function panelTarget() {
  const ed = vscode.window.activeTextEditor;
  if (ed && isOurs(ed.document)) { panelFile = keyOf(ed.document); const at = ed.selection.active || ed.selection.start; panelLine = at.line; panelCol = at.character; modelFor(ed.document); }
  if (panelFile && !project.get(panelFile)) panelFile = null;
  return panelFile;
}

class WebPanel {
  constructor(id, render) { this.id = id; this.render = render; this.view = null; this.last = ''; }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage(onPanelMessage);
    view.onDidChangeVisibility(() => { if (view.visible) this.refresh(true); });
    view.onDidDispose(() => { if (this.view === view) this.view = null; });
    this.refresh(true);
  }
  body() {
    try { return this.render(panelTarget()); }
    catch (e) { output.appendLine(`Side panel (${this.id}): ${e.stack || e.message}`); return `<div class="empty">This couldn't be worked out for this file (${PH.esc(e.message)}).</div>`; }
  }
  refresh(full) {
    if (!this.view || this.view.visible === false) return;
    const body = this.body();
    if (!full && body === this.last) return;
    this.last = body;
    // the first time, the whole page; after that just the contents, so the scroll position stays
    if (full) this.view.webview.html = PH.page(`<main id="m">${body}</main>`, nonce(), this.view.webview.cspSource);
    else this.view.webview.postMessage({ type: 'body', html: body });
  }
}

class TreePanel {
  constructor(build) { this.build = build; this.changed = new vscode.EventEmitter(); this.onDidChangeTreeData = this.changed.event; this.roots = []; this.view = null; }
  refresh() { this.changed.fire(); }
  getChildren(node) {
    if (node) return node.children || [];
    try { this.roots = this.build(panelTarget()) || []; }
    catch (e) { output.appendLine('Side panel: ' + (e.stack || e.message)); this.roots = [{ label: 'This couldn\'t be worked out for this file', description: e.message, icon: 'error' }]; }
    return this.roots;
  }
  getTreeItem(node) {
    const kids = node.children && node.children.length;
    const t = new vscode.TreeItem(node.label, kids ? (node.open ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None);
    if (node.description) t.description = node.description;
    if (node.tooltip) t.tooltip = node.tooltip;
    if (node.icon) t.iconPath = new vscode.ThemeIcon(node.icon, node.colour ? new vscode.ThemeColor(node.colour) : undefined);
    if (node.goto) t.command = { title: 'Go there', command: 'retroAsm.panel.goto', arguments: [node.goto.file, node.goto.line] };
    else if (node.command) t.command = { title: node.label, command: node.command, arguments: node.args || [] };
    return t;
  }
}

function lineHtml(file) { return file ? PH.thisLineHtml(SP.thisLine(project, file, panelLine, panelCol)) : PH.thisLineHtml(null); }
function mapHtml(file) {
  if (!file) return PH.memoryMapHtml(null);
  const hw = SP.hardwareUse(project, file);
  const d = SP.memoryMap(project, file, hw);
  d.hardware = hw.groups.filter(g => !g.name.startsWith('Ports')).flatMap(g => g.items.filter(i => i.known).map(i => i.value));
  return PH.memoryMapHtml(d);
}

const toolCache = new Map();   // chip id -> { when, value }, so the panel doesn't search the disk every time it redraws
function toolsStatus(file) {
  const m = project.get(file);
  if (!m || !m.D.build || !(m.D.build.tool || m.D.build.run) || !trusted()) return null;
  const hit = toolCache.get(m.D.id);
  if (hit && Date.now() - hit.when < 30000) return hit.value;
  const rep = B.reportTools(m.D, toolContextFor(file));
  const value = { missing: rep.filter(r => !r.found), names: rep.map(r => r.name) };
  toolCache.set(m.D.id, { when: Date.now(), value });
  return value;
}

function projectNodes(file) {
  if (!file) return [];
  const s = SP.projectSummary(project, file);
  const out = [];
  out.push({ label: s.chip, icon: 'circuit-board', tooltip: 'The chip this file is read as. Click to switch.', command: 'retroAsm.switchDialect' });
  if (s.size) out.push({ label: `${s.size.used.toLocaleString()} bytes`, description: s.size.room ? `${((s.size.room - s.size.used) / 1024).toFixed(1)}K still free · ${s.size.startHex}–${s.size.endHex}` : `${s.size.startHex}–${s.size.endHex}`, icon: 'database', tooltip: 'How much memory the program takes up.' + (s.size.approx ? ' Rough: some lines could not be measured.' : ''), command: 'retroAsm.panel.focusMap' });
  out.push({ label: s.files.length === 1 ? 'File' : `Files (${s.files.length})`, icon: 'files', open: true, children: s.files.map(f => ({ label: f.name, description: `${f.lines.toLocaleString()} lines${f.main ? ' · main file' : ''}`, icon: f.main ? 'file-code' : 'file', tooltip: f.file, goto: { file: f.file, line: 0 } })) });
  out.push(s.warnings || s.notes
    ? { label: `${s.warnings} warning${s.warnings === 1 ? '' : 's'}${s.notes ? `, ${s.notes} note${s.notes === 1 ? '' : 's'}` : ''}`, icon: 'warning', colour: 'problemsWarningIcon.foreground', tooltip: 'Click to see them in the Problems panel.', command: 'workbench.actions.view.problems' }
    : { label: 'No warnings', icon: 'pass', colour: 'testing.iconPassed', tooltip: 'The checks found nothing to worry about.' });
  if (lastBuild && project.unit(file).includes(lastBuild.file)) {
    const t = lastBuild.when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    out.push(lastBuild.ok
      ? { label: `Built at ${t}`, description: lastBuild.warnings ? `${lastBuild.warnings} warning${lastBuild.warnings === 1 ? '' : 's'}` : 'no problems', icon: 'check', colour: 'testing.iconPassed', tooltip: 'Click to see what the assembler said.', command: 'retroAsm.panel.showOutput' }
      : { label: `Build failed at ${t}`, description: lastBuild.errors ? `${lastBuild.errors} error${lastBuild.errors === 1 ? '' : 's'}` : '', icon: 'error', colour: 'testing.iconFailed', tooltip: 'Click to see what the assembler said.', command: 'retroAsm.panel.showOutput' });
  } else if (trusted()) out.push({ label: 'Not built yet', description: 'click to build', icon: 'tools', tooltip: 'Build this program (Ctrl+Alt+B).', command: 'retroAsm.build' });
  { const t = toolsStatus(file);
    if (t) out.push(t.missing.length
      ? { label: `Missing: ${t.missing.map(r => r.name).join(', ')}`, icon: 'cloud-download', colour: 'problemsWarningIcon.foreground', tooltip: 'Programs this computer needs to build and run. Click to see where to get them.', command: 'retroAsm.checkTools' }
      : { label: 'Tools found', description: t.names.join(', '), icon: 'pass', colour: 'testing.iconPassed', tooltip: 'Everything needed to build and run this computer\'s code is in place. Click to see where each one is.', command: 'retroAsm.checkTools' }); }
  if (s.routines.length) {
    out.push({ label: `Routines (${s.routineCount})`, description: 'biggest first', icon: 'symbol-method', children: s.routines.map(r => ({ label: r.name, description: r.bytes !== null ? `${r.bytes.toLocaleString()} bytes` : `${r.lines} lines`, icon: 'symbol-method', goto: { file: r.file, line: r.line } })) });
  }
  if (s.unused.length) {
    const what = { code: 'label', label: 'label', data: 'data', equ: 'name for a number' };
    out.push({ label: `Never used (${s.unused.length})`, icon: 'circle-slash', tooltip: 'Names that no other line uses. Often fine (the start of the program, or something not finished), but worth a look: it may be a spelling slip, or spare code taking up memory.', children: s.unused.slice(0, 100).map(u => ({ label: u.name, description: `${what[u.kind] || u.kind} · ${path.basename(u.file)} line ${u.line + 1}`, icon: 'symbol-constant', goto: { file: u.file, line: u.line } })) });
  }

  return out;
}

function hardwareNodes(file) {
  if (!file) return [];
  const hw = SP.hardwareUse(project, file);
  if (!hw.groups.length) return [{ label: 'No known hardware addresses in this program', icon: 'info', tooltip: 'Screen, sound, keyboard and ROM addresses the chip file knows about will show here when your code uses them.' }];
  const item = (it) => ({
    label: it.title,
    description: [it.title === it.hex ? it.note : it.hex, it.tag, it.alsoCalled ? `your name: ${it.alsoCalled}` : '', `${it.uses.length} use${it.uses.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
    tooltip: [it.title + (it.title === it.hex ? '' : ` (${it.hex})`), it.note].filter(Boolean).join('\n\n'),
    icon: 'symbol-field',
    children: it.uses.map(u => ({ label: `${path.basename(u.file)} line ${u.line + 1}`, description: u.code, icon: 'arrow-small-right', goto: { file: u.file, line: u.line } }))
  });
  // the chip's known addresses (screen, sound, ROM ...), by area of memory
  const out = hw.groups.map(g => ({ label: g.name.charAt(0).toUpperCase() + g.name.slice(1), icon: g.name.startsWith('Ports') ? 'plug' : 'chip', open: true, children: g.items.filter(it => it.known !== false).map(item) })).filter(g => g.children.length);
  // other fixed addresses your code names (its variables outside the program, and so on): folded away
  const other = hw.groups.flatMap(g => g.items.filter(it => it.known === false).map(it => Object.assign({}, it, { tag: g.name })));
  if (other.length) out.push({ label: `Other fixed addresses (${other.length})`, icon: 'symbol-variable', tooltip: 'Addresses outside the program that your code uses, often its own variables in RAM. The chip file has nothing to say about them.', children: other.map(item) });
  return out;
}

/** The "Registers" section: what each register holds just before the cursor's line. */
function registerNodes(file) {
  if (!file) return [];
  const r = RT.registersAt(project, file, panelLine);
  if (!r) return [{ label: 'No registers to show for this chip', icon: 'info' }];
  const out = [];
  const where = (line) => ({ file, line });
  out.push({
    label: r.routine ? `Just before line ${r.line + 1}, in ${r.routine.name}` : `Just before line ${r.line + 1}`, icon: 'symbol-method', open: false,
    tooltip: 'These are worked out by reading the routine from its top down to the line your cursor is on. It is a good guess from reading the code, not from running it. A register marked "unsure" could have been changed by a jump.',
    goto: r.routine ? where(r.routine.line) : undefined
  });
  if (r.call) {
    const c = r.call;
    if (!c.found) out.push({ label: `Calling ${c.name}`, description: 'not in your code, so what it needs is not known', icon: 'call-outgoing', open: true });
    else {
      const kids = [];
      if (!c.needs.length) kids.push({ label: 'Needs nothing set up first', icon: 'pass' });
      for (const n of c.needs) kids.push({
        label: `${n.reg} needs a value`, icon: n.missing ? 'warning' : n.unsure ? 'question' : 'pass', colour: n.missing ? 'problemsWarningIcon.foreground' : undefined,
        description: [n.doc, n.missing ? 'nothing has been put in it here' : `now: ${n.now}${n.unsure ? ' (unsure)' : ''}`].filter(Boolean).join(' · '),
        tooltip: n.missing ? `Nothing in ${c.name}'s caller has set ${n.reg} before this line. If it is set before you get here, ignore this.` : undefined
      });
      if (c.changes) kids.push({ label: `Changes ${c.changes}`, icon: 'edit', tooltip: `Whatever is in these is lost when ${c.name} runs. Save it first if you still need it.` });
      for (const x of c.returns || []) kids.push({ label: `Gives back ${x.reg}`, description: x.doc, icon: 'sign-out' });
      out.push({ label: `Calling ${c.name}`, icon: 'call-outgoing', open: true, children: kids });
    }
  }
  const icon = { value: 'symbol-numeric', copy: 'arrow-both', changed: 'edit', call: 'call-outgoing' };
  const regs = r.rows.map(x => ({
    label: x.reg, icon: x.unsure ? 'question' : icon[x.kind] || 'circle-small',
    description: [x.text, x.unsure ? `(unsure: a jump lands at ${x.unsure})` : '', x.doc ? `· ${x.doc}` : ''].filter(Boolean).join(' '),
    tooltip: `${x.code ? `Line ${x.line + 1}: ${x.code}` : ''}${x.doc ? `\n\nYour comment says: ${x.doc}` : ''}`.trim() || undefined,
    goto: where(x.line)
  }));
  out.push(regs.length ? { label: 'Registers', icon: 'chip', open: true, children: regs } : { label: 'Registers', description: 'nothing has been put in a register yet', icon: 'chip' });
  if (r.memory.length) out.push({ label: 'Memory set so far', icon: 'database', open: true, children: r.memory.map(m => ({ label: m.name, description: m.text, icon: 'symbol-field', tooltip: `Line ${m.line + 1}: ${m.code}`, goto: where(m.line) })) });
  if (r.needs.length) out.push({ label: 'This routine expects', description: r.needs.map(n => n.reg).join(', '), icon: 'sign-in', tooltip: 'Registers it reads before setting them itself: the caller has to fill these in.', children: r.needs.map(n => ({ label: n.reg, description: n.doc || 'from the caller', icon: 'circle-small' })) });
  if (r.returns.length) out.push({ label: 'This routine gives back', icon: 'sign-out', children: r.returns.map(n => ({ label: n.reg, description: n.doc, icon: 'circle-small' })) });
  if (r.unknownCalls.length) out.push({ label: 'Calls outside your code', description: r.unknownCalls.map(u => u.name).join(', '), icon: 'info', tooltip: 'These routines are not in your files, so what they change in the registers is not known.' });
  return out;
}

const panels = {
  line: new WebPanel('This line', lineHtml),
  registers: new TreePanel(registerNodes),
  map: new WebPanel('Memory map', mapHtml),
  project: new TreePanel(projectNodes),
  hardware: new TreePanel(hardwareNodes)
};

function refreshPanels() {
  if (panelTimer) clearTimeout(panelTimer);
  panelTimer = setTimeout(() => { panelTimer = null; panels.line.refresh(); panels.registers.refresh(); panels.map.refresh(); panels.project.refresh(); panels.hardware.refresh(); }, 300);
}
function refreshLinePanel() {
  if (lineTimer) clearTimeout(lineTimer);
  lineTimer = setTimeout(() => { lineTimer = null; panels.line.refresh(); panels.registers.refresh(); }, 120);
}

async function panelGoto(file, line) {
  if (typeof file !== 'string' || !project.get(file)) return false;     // only files of the program
  const ln = Math.max(0, Number(line) || 0);
  const doc = await vscode.workspace.openTextDocument(uriOf(file));
  const ed = await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.One });
  if (ed && vscode.Selection) {
    ed.selection = new vscode.Selection(ln, 0, ln, 0);
    ed.revealRange(new vscode.Range(ln, 0, ln, 0), vscode.TextEditorRevealType ? vscode.TextEditorRevealType.InCenterIfOutsideViewport : undefined);
  }
  return true;
}

function onPanelMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'goto' && Array.isArray(msg.at)) panelGoto(msg.at[0], msg.at[1]);
  else if (msg.type === 'command' && PANEL_COMMANDS.has(msg.id)) vscode.commands.executeCommand(msg.id);
}

// ---------------------------------------------------------------------------
// letter case: instructions, directives, registers and labels (as the chip file says)
// ---------------------------------------------------------------------------
/** The changes for a file, or for the lines of a selection. */
function caseFor(doc, range) {
  if (!isOurs(doc) || !dialects.size) return { edits: [], skipped: [] };
  const text = doc.getText();
  const D = dialectForPath(keyOf(doc), text);
  const opts = {};
  if (range) {
    opts.fromLine = range.start.line;
    // a selection that ends at the start of a line doesn't include that line
    opts.toLine = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
  }
  const r = CF.caseEdits(text, D, opts);
  return { edits: r.edits.map(e => vscode.TextEdit.replace(new vscode.Range(e.line, e.start, e.line, e.end), e.text)), skipped: r.skippedLabels };
}

const caseFormatter = {
  provideDocumentFormattingEdits: (doc) => caseFor(doc, null).edits,
  provideDocumentRangeFormattingEdits: (doc, range) => caseFor(doc, range).edits
};

// Only when you press Save yourself: auto-save must not change a line while you are still typing on it
function onWillSave(e) {
  const doc = e.document;
  if (!isOurs(doc) || e.reason !== vscode.TextDocumentSaveReason.Manual) return;
  if (cfg().get('formatCaseOnSave') === false) return;
  const { edits, skipped } = caseFor(doc, null);
  if (skipped.length) output.appendLine(`Case change: left these labels as they were, because changing them would make two labels the same: ${skipped.join(', ')}`);
  e.waitUntil(Promise.resolve(edits));
}

async function cmdChangeCase() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document)) return;
  const sel = ed.selection;
  const { edits, skipped } = caseFor(ed.document, sel && !sel.isEmpty ? sel : null);
  if (edits.length) await ed.edit((b) => { for (const e of edits) b.replace(e.range, e.newText); });
  else vscode.window.setStatusBarMessage('Retro ASM: the letter case is already right', 3000);
  if (skipped.length) vscode.window.showWarningMessage(`Retro ASM: left these labels as they were, because changing their case would make two labels the same: ${skipped.join(', ')}`);
}

// ---------------------------------------------------------------------------
// line up the columns, and convert a TI-99/4A file to xas99 style
// ---------------------------------------------------------------------------
/** The changes that line the code up, for a file or for the lines of a selection. */
function lineUpFor(doc, range) {
  if (!isOurs(doc) || !dialects.size) return { edits: [] };
  const text = doc.getText();
  const D = dialectForPath(keyOf(doc), text);
  const mine = cfg().get('lineUpColumns');
  const opts = { columns: mine && typeof mine === 'object' ? mine[D.id] : undefined };
  if (range) {
    opts.fromLine = range.start.line;
    opts.toLine = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
  }
  try {
    const r = LU.lineUpEdits(text, D, opts);
    return { edits: r.edits.map(e => vscode.TextEdit.replace(new vscode.Range(e.line, e.start, e.line, e.end), e.text)) };
  } catch (e) {
    return { edits: [], error: `the retroAsm.lineUpColumns setting for ${D.name} can't be used: ${e.message}` };
  }
}

async function cmdLineUp() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document)) return;
  const sel = ed.selection;
  const r = lineUpFor(ed.document, sel && !sel.isEmpty ? sel : null);
  if (r.error) { vscode.window.showWarningMessage(`Retro ASM: ${r.error}`); return; }
  if (r.edits.length) await ed.edit((b) => { for (const e of r.edits) b.replace(e.range, e.newText); });
  else vscode.window.setStatusBarMessage('Retro ASM: the code is already lined up', 3000);
}

async function cmdConvertXas99() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isOurs(ed.document)) return;
  const text = ed.document.getText();
  const D = dialectForPath(keyOf(ed.document), text);
  const r = X99.xas99Edits(text, D);
  if (!r.applies) { vscode.window.showInformationMessage(`Retro ASM: this changes TI-99/4A files to the way xas99 wants them. This file is read as ${D.name}, so nothing was changed.`); return; }
  if (!r.edits.length) { vscode.window.setStatusBarMessage('Retro ASM: the file is already in xas99 style', 3000); return; }
  await ed.edit((b) => { for (const e of r.edits) b.replace(new vscode.Range(e.line, e.start, e.line, e.end), e.text); });
  const bits = [];
  if (r.comments) bits.push(`${r.comments} comment${r.comments === 1 ? '' : 's'} given two spaces`);
  if (r.commas) bits.push(`${r.commas} space${r.commas === 1 ? '' : 's'} next to a comma taken out`);
  vscode.window.setStatusBarMessage(`Retro ASM: ${bits.join(', ')}`, 5000);
}

// ---------------------------------------------------------------------------
// start up
// ---------------------------------------------------------------------------
function activate(context) {
  extensionPath = context.extensionPath;
  extContext = context;
  output = vscode.window.createOutputChannel('Retro ASM');
  diagnostics = vscode.languages.createDiagnosticCollection('retroasm');
  buildDiagnostics = vscode.languages.createDiagnosticCollection('retroasm-build');
  addressDecoration = vscode.window.createTextEditorDecorationType({ before: { color: new vscode.ThemeColor('editorLineNumber.foreground'), margin: '0 1.2em 0 0' } });
  addressesOn = !!cfg().get('showAddresses');
  cyclesOn = !!cfg().get('showCycles');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'retroAsm.switchDialect';
  project.notes = notesFor;
  project.loadAddress = () => {
    const raw = String(cfg().get('loadAddress') || '').trim().replace(/^(0x|[>$#])/i, '');
    return /^[0-9A-Fa-f]{1,4}$/.test(raw) ? parseInt(raw, 16) : null;
  };
  project.fileSize = (p) => { try { return fs.statSync(p).size; } catch (e) { return null; } };
  loadDialects();

  const sel = { language: LANG };
  const basicSel = { language: BASIC_LANG };
  const L = vscode.languages;
  context.subscriptions.push(
    output, diagnostics, buildDiagnostics, addressDecoration, status, tokensChanged, hintsChanged, helpChanged, lensChanged,
    L.registerCodeLensProvider(sel, lensProvider),
    L.registerInlayHintsProvider(sel, cycleHintsProvider),
    L.registerCodeActionsProvider(sel, quickFixProvider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.commands.registerCommand('retroAsm.toggleCycles', cmdToggleCycles),
    vscode.commands.registerCommand('retroAsm.build', () => cmdBuild(false)),
    vscode.commands.registerCommand('retroAsm.buildAndRun', () => cmdBuild(true)),
    vscode.commands.registerCommand('retroAsm.checkTools', cmdCheckTools),
    vscode.commands.registerCommand('retroAsm.debug', startDebugging),
    vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, debugConfigProvider),
    vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, debugAdapterFactory),
    vscode.commands.registerCommand('retroAsm.toggleAddresses', cmdToggleAddresses),
    vscode.window.onDidChangeVisibleTextEditors(() => scheduleAddresses()),
    L.registerHoverProvider(sel, hoverProvider),
    // BBC BASIC listings (.bas): only the [ ] parts are read, so these few helps work there too
    L.registerHoverProvider(basicSel, hoverProvider),
    L.registerDefinitionProvider(basicSel, definitionProvider),
    L.registerReferenceProvider(basicSel, referenceProvider),
    L.registerDocumentHighlightProvider(basicSel, highlightProvider),
    L.registerDocumentSymbolProvider(basicSel, symbolProvider, { label: 'Retro ASM' }),
    L.registerDocumentSemanticTokensProvider(basicSel, semanticProvider, legend),
    L.registerDefinitionProvider(sel, definitionProvider),
    L.registerReferenceProvider(sel, referenceProvider),
    L.registerDocumentHighlightProvider(sel, highlightProvider),
    L.registerDocumentSymbolProvider(sel, symbolProvider, { label: 'Retro ASM' }),
    L.registerWorkspaceSymbolProvider(workspaceSymbolProvider),
    L.registerRenameProvider(sel, renameProvider),
    L.registerFoldingRangeProvider(sel, foldingProvider),
    L.registerDocumentLinkProvider(sel, linkProvider),
    L.registerDocumentSemanticTokensProvider(sel, semanticProvider, legend),
    L.registerCompletionItemProvider(sel, completionProvider, '@', ','),
    L.registerDocumentFormattingEditProvider(sel, caseFormatter),
    L.registerDocumentRangeFormattingEditProvider(sel, caseFormatter),
    vscode.workspace.onWillSaveTextDocument(onWillSave),
    vscode.workspace.registerTextDocumentContentProvider(HELP_SCHEME, {
      onDidChange: helpChanged.event,
      provideTextDocumentContent: (uri) => helpPages.get(uri.toString()) || ''
    }),
    vscode.commands.registerCommand('retroAsm.explainSelection', cmdExplain),
    vscode.commands.registerCommand('retroAsm.showReference', cmdReference),
    vscode.commands.registerCommand('retroAsm.switchDialect', cmdSwitch),
    vscode.commands.registerCommand('retroAsm.insertSnippet', cmdInsertSnippet),
    vscode.commands.registerCommand('retroAsm.changeCase', cmdChangeCase),
    vscode.commands.registerCommand('retroAsm.lineUp', cmdLineUp),
    vscode.commands.registerCommand('retroAsm.convertToXas99', cmdConvertXas99),
    vscode.commands.registerCommand('retroAsm.createNotesFile', cmdNotes),
    vscode.commands.registerCommand('retroAsm.newDialect', cmdNewDialect),
    vscode.commands.registerCommand('retroAsm.reloadDialects', cmdReload),
    vscode.commands.registerCommand('retroAsm.openOriginal', cmdOpenOriginal),
    vscode.commands.registerCommand('retroAsm.editSprite', cmdEditSprite),
    vscode.commands.registerCommand('retroAsm.newSprite', cmdNewSprite),
    vscode.commands.registerCommand('retroAsm.playSound', cmdPlaySound),

    vscode.workspace.onDidOpenTextDocument((doc) => { if (syncDoc(doc)) refreshEverything(); }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!syncDoc(e.document)) return;
      tokensChanged.fire(); lensChanged.fire(); hintsChanged.fire(); scheduleChecks(); scheduleAddresses(); updateStatus(); refreshPanels();
      if (sprite && e.document.uri.toString() === sprite.uri) scheduleSprite();
      if (sound && e.document.uri.toString() === sound.uri) scheduleSound();
      if (e.contentChanges.length) buildDiagnostics.delete(e.document.uri);   // the assembler's notes go stale once the file is edited
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = keyOf(doc);
      if (!openDocs.delete(key)) return;
      diagnostics.delete(doc.uri);
      if (path.isAbsolute(key) && fs.existsSync(key)) loadDiskFile(key); else project.remove(key);
      refreshEverything();
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== 'file') return;
      const p = doc.uri.fsPath;
      if (path.basename(p) === NOTES_FILE) { notesCache.clear(); refreshEverything(); return; }
      if (p.toLowerCase().endsWith('.json') && dialectFolders().some(f => path.dirname(p) === f)) { loadDialects(); reindexAll(); }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => { updateStatus(); refreshPanels(); }),
    vscode.window.onDidChangeTextEditorSelection((e) => { if (isOurs(e.textEditor.document)) refreshLinePanel(); }),
    vscode.window.registerWebviewViewProvider('retroAsm.thisLine', panels.line),
    vscode.window.registerWebviewViewProvider('retroAsm.memoryMap', panels.map),
    vscode.window.registerTreeDataProvider('retroAsm.project', panels.project),
    vscode.window.registerTreeDataProvider('retroAsm.registers', panels.registers),
    vscode.window.registerTreeDataProvider('retroAsm.hardware', panels.hardware),
    vscode.commands.registerCommand('retroAsm.panel.goto', panelGoto),
    vscode.commands.registerCommand('retroAsm.panel.showOutput', () => output.show(true)),
    vscode.commands.registerCommand('retroAsm.panel.focusMap', () => vscode.commands.executeCommand('retroAsm.memoryMap.focus')),
    vscode.commands.registerCommand('retroAsm.panel.refresh', () => { panels.line.refresh(true); panels.registers.refresh(); panels.map.refresh(true); panels.project.refresh(); panels.hardware.refresh(); }),
    vscode.commands.registerCommand('retroAsm.showPanel', () => vscode.commands.executeCommand('workbench.view.extension.retroAsm')),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('retroAsm')) return;
      if (e.affectsConfiguration('retroAsm.showAddresses')) addressesOn = !!cfg().get('showAddresses');
      if (e.affectsConfiguration('retroAsm.showCycles')) { cyclesOn = !!cfg().get('showCycles'); hintsChanged.fire(); }
      if (e.affectsConfiguration('retroAsm.original')) forgetSkool();
      project._touch();
      if (e.affectsConfiguration('retroAsm.dialectFolders')) loadDialects();
      reindexAll();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { loadDialects(); reindexAll(); scanWorkspace(); })
  );
  // once the folder is trusted, its own chip files can be loaded
  if (vscode.workspace.onDidGrantWorkspaceTrust) context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { loadDialects(); reindexAll(); }));

  // files changed outside the editor (for example by a build script)
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const onDisk = (uri) => {
    if (uri.scheme !== 'file') return;
    const p = uri.fsPath;
    if (path.basename(p) === NOTES_FILE) { notesCache.clear(); refreshEverything(); return; }
    if (p.toLowerCase().endsWith('.skool')) { forgetSkool(); return; }
    if (!knownExtensions().has(path.extname(p).toLowerCase())) return;
    if (openDocs.has(p)) return;
    loadDiskFile(p);
    refreshEverything();
  };
  watcher.onDidChange(onDisk);
  watcher.onDidCreate(onDisk);
  watcher.onDidDelete((uri) => {
    if (uri.scheme !== 'file') return;
    if (path.basename(uri.fsPath) === NOTES_FILE) notesCache.clear();
    if (uri.fsPath.toLowerCase().endsWith('.skool')) forgetSkool();
    if (!openDocs.has(uri.fsPath)) project.remove(uri.fsPath);
    refreshEverything();
  });
  context.subscriptions.push(watcher);

  for (const doc of vscode.workspace.textDocuments) syncDoc(doc);
  refreshEverything();
  scanWorkspace();
  // for the tests: what the side panel would show for the file it is following
  return { soundNow: () => sendSound(), spriteNow: () => sendSprite(), spriteMessage: (m) => onSpriteMessage(m), panelNow: () => { const f = panelTarget(); return { file: f, line: panelLine, thisLine: lineHtml(f), registers: registerNodes(f), memoryMap: mapHtml(f), project: projectNodes(f), hardware: hardwareNodes(f) }; } };
}

function deactivate() { if (spriteTimer) clearTimeout(spriteTimer); if (checkTimer) clearTimeout(checkTimer); if (panelTimer) clearTimeout(panelTimer); if (lineTimer) clearTimeout(lineTimer); }

module.exports = { activate, deactivate };
