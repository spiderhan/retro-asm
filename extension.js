'use strict';
// The part that talks to VS Code. All the thinking is done in ./lib; this file
// just passes VS Code's questions on and hands the answers back.

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { loadFolder, guessDialect } = require('./lib/dialect');
const { Project } = require('./lib/project');
const { parseLine, statements } = require('./lib/parser');
const F = require('./lib/features');
const X = require('./lib/explain');
const A = require('./lib/analysis');
const B = require('./lib/build');
const S = require('./lib/skool');
const SP = require('./lib/panel');
const PH = require('./lib/panel-html');

const LANG = 'retroasm';
const NOTES_FILE = 'asm-notes.json';
const HELP_SCHEME = 'retroasm-help';

let dialects = new Map();        // id -> dialect
let builtInIds = new Set();
const project = new Project();
const openDocs = new Set();      // keys of files open in the editor (their text wins over the disk)
const scannedDirs = new Set();
const notesCache = new Map();
const helpPages = new Map();
let status, diagnostics, buildDiagnostics, output, extensionPath, addressDecoration, extContext;
let addressesOn = false;
let building = false;
const lensChanged = new vscode.EventEmitter();
const tokensChanged = new vscode.EventEmitter();
const helpChanged = new vscode.EventEmitter();
let checkTimer = null;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const cfg = () => vscode.workspace.getConfiguration('retroAsm');
const keyOf = (doc) => (doc.uri.scheme === 'file' ? doc.uri.fsPath : doc.uri.toString());
const uriOf = (key) => (path.isAbsolute(key) ? vscode.Uri.file(key) : vscode.Uri.parse(key));
const isOurs = (doc) => !!doc && doc.languageId === LANG;
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

function dialectForPath(file, text) {
  const ext = path.extname(file).toLowerCase();
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
  project.set(file, text, dialectForPath(file, text));
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
  if (!isOurs(doc) || !dialects.size) return null;
  const key = keyOf(doc);
  openDocs.add(key);
  const model = project.set(key, doc.getText(), dialectForPath(key, doc.getText()));
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
function snippetItems(D, before, pos) {
  const m = /^(\s*)([a-z][a-z0-9]*)$/.exec(before);
  if (!m || !D.snippets || !D.snippets.length) return [];
  if (!m[1] && m[2].length < 2) return [];           // in the label column, wait for a second letter
  const out = [];
  for (const s of D.snippets) {
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
    const snips = snippetItems(D, before, pos);
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
    if (!cfg().get('routineSummaries') || !modelFor(doc)) return [];
    const out = [];
    for (const item of F.lenses(project, keyOf(doc))) {
      const range = new vscode.Range(item.line, item.start, item.line, item.end);
      for (const part of item.parts) {
        if (part.refs && part.refs.length) {
          const locs = part.refs.map(r => new vscode.Location(uriOf(r.file), new vscode.Range(r.line, r.start, r.line, r.end)));
          out.push(new vscode.CodeLens(range, { title: part.text, tooltip: 'Show where', command: 'editor.action.showReferences', arguments: [doc.uri, new vscode.Position(item.line, item.start), locs] }));
        } else out.push(new vscode.CodeLens(range, { title: part.text, command: '' }));
      }
    }
    return out;
  }
};

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
    vscode.window.showErrorMessage('Retro ASM: ' + planned.error, 'Open settings').then((pick) => { if (pick) vscode.commands.executeCommand('workbench.action.openSettings', 'retroAsm.build'); });
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
      vscode.window.showErrorMessage(errors ? `Build failed: ${errors} error${errors === 1 ? '' : 's'}. They are underlined in the code and listed in the Problems panel.` : 'Build failed. See the "Retro ASM" output panel for what the build said.');
      return false;
    }
    vscode.window.setStatusBarMessage(`$(check) Built ${B.tiName(root)}${warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}`, 6000);
    if (!andRun) return true;
    const runner = B.findRunner(root, settings, undefined, chip);
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
  if (!ext) { vscode.window.showInformationMessage('This file has no extension, so the choice can\'t be remembered. Save it with one first.'); return; }
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

const panels = {
  line: new WebPanel('This line', lineHtml),
  map: new WebPanel('Memory map', mapHtml),
  project: new TreePanel(projectNodes),
  hardware: new TreePanel(hardwareNodes)
};

function refreshPanels() {
  if (panelTimer) clearTimeout(panelTimer);
  panelTimer = setTimeout(() => { panelTimer = null; panels.line.refresh(); panels.map.refresh(); panels.project.refresh(); panels.hardware.refresh(); }, 300);
}
function refreshLinePanel() {
  if (lineTimer) clearTimeout(lineTimer);
  lineTimer = setTimeout(() => { lineTimer = null; panels.line.refresh(); }, 120);
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
  const L = vscode.languages;
  context.subscriptions.push(
    output, diagnostics, buildDiagnostics, addressDecoration, status, tokensChanged, helpChanged, lensChanged,
    L.registerCodeLensProvider(sel, lensProvider),
    vscode.commands.registerCommand('retroAsm.build', () => cmdBuild(false)),
    vscode.commands.registerCommand('retroAsm.buildAndRun', () => cmdBuild(true)),
    vscode.commands.registerCommand('retroAsm.toggleAddresses', cmdToggleAddresses),
    vscode.window.onDidChangeVisibleTextEditors(() => scheduleAddresses()),
    L.registerHoverProvider(sel, hoverProvider),
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
    vscode.workspace.registerTextDocumentContentProvider(HELP_SCHEME, {
      onDidChange: helpChanged.event,
      provideTextDocumentContent: (uri) => helpPages.get(uri.toString()) || ''
    }),
    vscode.commands.registerCommand('retroAsm.explainSelection', cmdExplain),
    vscode.commands.registerCommand('retroAsm.showReference', cmdReference),
    vscode.commands.registerCommand('retroAsm.switchDialect', cmdSwitch),
    vscode.commands.registerCommand('retroAsm.insertSnippet', cmdInsertSnippet),
    vscode.commands.registerCommand('retroAsm.createNotesFile', cmdNotes),
    vscode.commands.registerCommand('retroAsm.newDialect', cmdNewDialect),
    vscode.commands.registerCommand('retroAsm.reloadDialects', cmdReload),
    vscode.commands.registerCommand('retroAsm.openOriginal', cmdOpenOriginal),

    vscode.workspace.onDidOpenTextDocument((doc) => { if (syncDoc(doc)) refreshEverything(); }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!syncDoc(e.document)) return;
      tokensChanged.fire(); lensChanged.fire(); scheduleChecks(); scheduleAddresses(); updateStatus(); refreshPanels();
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
    vscode.window.registerTreeDataProvider('retroAsm.hardware', panels.hardware),
    vscode.commands.registerCommand('retroAsm.panel.goto', panelGoto),
    vscode.commands.registerCommand('retroAsm.panel.showOutput', () => output.show(true)),
    vscode.commands.registerCommand('retroAsm.panel.focusMap', () => vscode.commands.executeCommand('retroAsm.memoryMap.focus')),
    vscode.commands.registerCommand('retroAsm.panel.refresh', () => { panels.line.refresh(true); panels.map.refresh(true); panels.project.refresh(); panels.hardware.refresh(); }),
    vscode.commands.registerCommand('retroAsm.showPanel', () => vscode.commands.executeCommand('workbench.view.extension.retroAsm')),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('retroAsm')) return;
      if (e.affectsConfiguration('retroAsm.showAddresses')) addressesOn = !!cfg().get('showAddresses');
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
  return { panelNow: () => { const f = panelTarget(); return { file: f, line: panelLine, thisLine: lineHtml(f), memoryMap: mapHtml(f), project: projectNodes(f), hardware: hardwareNodes(f) }; } };
}

function deactivate() { if (checkTimer) clearTimeout(checkTimer); if (panelTimer) clearTimeout(panelTimer); if (lineTimer) clearTimeout(lineTimer); }

module.exports = { activate, deactivate };
