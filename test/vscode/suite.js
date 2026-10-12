// The checks that run inside real VS Code. Started by run.js; see there for how to run it.
// Everything here goes through VS Code itself (its hover, go-to-definition, outline ... commands),
// so it tests the extension the way the editor really uses it.
'use strict';
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const info = JSON.parse(process.env.RETROASM_TEST_INFO || '{}');
const lines = [];
let fails = 0, skips = 0;
const log = (s) => { lines.push(s); console.log(s); };
const ok = (name, cond, extra) => { if (cond) log('ok    ' + name); else { fails++; log('FAIL  ' + name + (extra === undefined ? '' : '  ' + short(extra))); } };
const skip = (name, why) => { skips++; log('skip  ' + name + ' (' + why + ')'); };
const short = (x) => { let s; try { s = typeof x === 'string' ? x : JSON.stringify(x); } catch (e) { s = String(x); } return s && s.length > 400 ? s.slice(0, 400) + '...' : s; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, step) {
  const end = Date.now() + (ms || 10000);
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch (e) { /* not yet */ } await sleep(step || 150); }
  return v;
}
const ws = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
async function open(rel, column) {
  const doc = await vscode.workspace.openTextDocument(path.join(ws(), rel));
  const ed = await vscode.window.showTextDocument(doc, { viewColumn: column || vscode.ViewColumn.One, preview: false });
  return { doc, ed };
}
function posOf(doc, needle, sub) {
  const ls = doc.getText().split(/\r?\n/);
  const l = ls.findIndex(x => x.includes(needle));
  if (l < 0) throw new Error('test text not found: ' + needle);
  return new vscode.Position(l, ls[l].indexOf(sub || needle) + 1);
}
const hoverText = (hs) => (hs || []).map(h => h.contents.map(c => (typeof c === 'string' ? c : c.value)).join('\n')).join('\n');
const target = (x) => ({ uri: x.targetUri || x.uri, line: (x.targetSelectionRange || x.targetRange || x.range).start.line });
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const tabLabels = () => vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.label));

async function run() {
  log(`Retro Assembly Helper inside ${vscode.env.appName} ${vscode.version} on ${process.platform}`);
  try { await checks(); }
  catch (e) { fails++; log('FAIL  the checks stopped early: ' + (e && e.stack || e)); }
  log(fails ? `\n${fails} FAILED, ${skips} skipped` : `\nall passed${skips ? `, ${skips} skipped` : ''}`);
  try { fs.writeFileSync(info.results, lines.join('\n') + '\n'); } catch (e) { /* the console has it too */ }
  if (fails) throw new Error(`${fails} check(s) failed`);
}

async function checks() {
  // ---- starting up ----------------------------------------------------------------
  const ext = vscode.extensions.getExtension('hanmade.retro-asm');
  ok('the extension is installed', !!ext);
  const { doc: game, ed: gameEd } = await open('game.a99');
  ok('a .a99 file is read as Retro Assembly', game.languageId === 'retroasm', game.languageId);
  ok('the extension starts when a .a99 file opens', await waitFor(() => ext && ext.isActive, 15000), ext && ext.isActive);
  const z = await vscode.workspace.openTextDocument(path.join(ws(), 'z.z80'));
  ok('a .z80 file is read as Retro Assembly too', z.languageId === 'retroasm', z.languageId);
  const all = await vscode.commands.getCommands(true);
  ok('all its commands are there', ['retroAsm.build', 'retroAsm.buildAndRun', 'retroAsm.toggleAddresses', 'retroAsm.explainSelection', 'retroAsm.showReference', 'retroAsm.switchDialect', 'retroAsm.createNotesFile', 'retroAsm.newDialect', 'retroAsm.reloadDialects', 'retroAsm.openOriginal'].every(c => all.includes(c)));
  // ---- the side panel (0.6) ----
  ok('the side-panel commands are there', ['retroAsm.showPanel', 'retroAsm.panel.refresh', 'retroAsm.panel.goto'].every(c => all.includes(c)));
  const panelPkg = ext.packageJSON;
  ok('the side panel has its icon on the left-hand bar', panelPkg.icon === 'images/icon.png' && panelPkg.contributes.viewsContainers.activitybar.some(v => v.id === 'retroAsm' && v.icon === 'images/activity.svg') && fs.existsSync(path.join(ext.extensionPath, 'images', 'icon.png')) && fs.existsSync(path.join(ext.extensionPath, 'images', 'activity.svg')));
  try { await vscode.commands.executeCommand('retroAsm.showPanel'); await sleep(800); ok('the side panel opens', true); }
  catch (e) { ok('the side panel opens', false, e.message); }
  await vscode.window.showTextDocument(game, { viewColumn: vscode.ViewColumn.One, preview: false });
  gameEd.selection = new vscode.Selection(posOf(game, 'BL   @SET_VIDEO'), posOf(game, 'BL   @SET_VIDEO'));
  const pnow = ext.exports && ext.exports.panelNow ? await waitFor(() => { const x = ext.exports.panelNow(); return /SET_VIDEO/.test(x.thisLine) && x; }, 5000) : null;
  ok('the side panel follows the cursor', pnow && /Call the routine SET_VIDEO/.test(pnow.thisLine), pnow && pnow.thisLine);
  ok('the side panel shows the memory map and hardware', pnow && /Your program/.test(pnow.memoryMap) && pnow.hardware.some(g => /video chip/i.test(g.label)), pnow && pnow.hardware.map(g => g.label));

  // ---- tooltips ---------------------------------------------------------------------
  let h = await vscode.commands.executeCommand('vscode.executeHoverProvider', game.uri, posOf(game, 'MOVB *R1+,@VDPWD', 'MOVB'));
  ok('tooltip on an instruction says what the line does', /This line/.test(hoverText(h)) && /Move byte/.test(hoverText(h)), hoverText(h));
  h = await vscode.commands.executeCommand('vscode.executeHoverProvider', game.uri, posOf(game, 'LI   R1,ZONE_LIST', 'ZONE_LIST'));
  ok('tooltip on a label from the COPY file', /ZONE_LIST|ZONE\\_LIST/.test(hoverText(h)) && /data\.a99/.test(hoverText(h)), hoverText(h));
  h = await vscode.commands.executeCommand('vscode.executeHoverProvider', game.uri, posOf(game, 'LI   R1,>8000', '>8000'));
  ok('tooltip on a number', /32768/.test(hoverText(h)), hoverText(h));
  h = await vscode.commands.executeCommand('vscode.executeHoverProvider', game.uri, posOf(game, 'MPY  R5,R1', 'R5'));
  ok('tooltip on a register shows its @reg note', /Rover Y/.test(hoverText(h)), hoverText(h));

  // ---- jumping around ---------------------------------------------------------------
  let d = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', game.uri, posOf(game, 'BL   @SET_VIDEO', 'SET_VIDEO'));
  ok('go to definition (F12)', d && d.length === 1 && target(d[0]).line === 74, d && d.map(target));
  d = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', game.uri, posOf(game, 'LI   R1,ZONE_LIST', 'ZONE_LIST'));
  ok('go to definition in another file', d && d.length === 1 && /data\.a99$/.test(target(d[0]).uri.fsPath), d && d.map(x => target(x).uri.fsPath));
  d = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', game.uri, posOf(game, 'falls through into MENU', 'MENU'));
  ok('go to definition from a name in a comment', d && d.length === 1 && target(d[0]).line === 37, d && d.map(target));
  const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', game.uri, posOf(game, 'ONE_BYTE    BYTE', 'ONE_BYTE'));
  ok('find all uses (Shift+F12)', refs && refs.length === 4, refs && refs.length);
  const ren = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', game.uri, posOf(game, 'JNE  MN_FILL', 'MN_FILL'), 'MENU_FILL');
  ok('rename (F2) finds both places', ren && ren.entries().reduce((n, e) => n + e[1].length, 0) === 2, ren && ren.entries().length);
  const syms = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', game.uri);
  const menu = syms && syms.find(s => s.name === 'MENU');
  ok('the outline lists routines with their loops inside', menu && menu.children && menu.children.length === 1 && menu.children[0].name === 'MN_FILL' && syms.length > 10, syms && syms.map(s => s.name));
  const wsyms = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'setvid');
  ok('search labels in every file (Ctrl+T)', wsyms && wsyms.some(s => s.name === 'SET_VIDEO'), wsyms && wsyms.map(s => s.name));
  let folds = null;
  try { folds = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', game.uri); } catch (e) { folds = /not found/.test(e.message) ? 'missing' : e; }
  if (folds === 'missing') skip('folding arrows', 'this VS Code is too old to ask for them');
  else ok('folding arrows', folds && folds.length >= 4, folds && (folds.length || String(folds)));
  const links = await vscode.commands.executeCommand('vscode.executeLinkProvider', game.uri);
  const fileLinks = (links || []).filter(l => l.target && l.target.scheme === 'file');
  ok('Ctrl+click on the COPY line opens the file', fileLinks.length === 1 && /data\.a99$/.test(fileLinks[0].target.fsPath), (links || []).map(l => l.target && l.target.toString()));

  // ---- colours, suggestions -----------------------------------------------------------
  const legend = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', game.uri);
  const toks = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', game.uri);
  ok('colours (semantic tokens)', legend && legend.tokenTypes.includes('register') && toks && toks.data.length > 500, toks && toks.data.length);
  const untitled = await vscode.workspace.openTextDocument({ language: 'retroasm', content: '; scratch\n       MO' });
  const comp = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', untitled.uri, new vscode.Position(1, 9));
  ok('suggestions while typing (in a new unsaved file too)', comp && comp.items.some(i => (i.label.label || i.label) === 'MOVB'), comp && comp.items.length);

  // ---- summary lines and warnings ------------------------------------------------------
  const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', game.uri, 100);
  const titles = (lenses || []).map(l => l.command && l.command.title).filter(Boolean);
  ok('summary lines above routines', titles.some(t => /Called from 1 place/.test(t)) && titles.some(t => /bytes/.test(t)) && titles.some(t => /Changes R0/.test(t)), titles.slice(0, 8));
  const diags = await waitFor(() => { const l = vscode.languages.getDiagnostics(game.uri).filter(x => x.source === 'Retro ASM'); return l.length >= 4 ? l : null; }, 10000);
  const at = (line, rx) => (diags || []).some(x => x.range.start.line === line && rx.test(x.message));
  ok('warnings: a misspelt instruction', at(66, /MOVX/), (diags || []).map(x => [x.range.start.line + 1, x.message]));
  ok('warnings: the wrong number of operands', at(67, /takes 2 operands/));
  ok('warnings: a label that does not exist', at(65, /NOWHERE/));
  ok('warnings: a helper used without REF', at(68, /REF VSBW/));
  const clean = vscode.languages.getDiagnostics(vscode.Uri.file(path.join(ws(), 'paddle.a99')));
  ok('no warnings on a file without mistakes', clean.filter(x => x.source === 'Retro ASM').length === 0, clean.map(x => x.message));

  // ---- commands that open pages ---------------------------------------------------------
  gameEd.selection = new vscode.Selection(41, 0, 41, 0);
  await vscode.commands.executeCommand('retroAsm.explainSelection');
  ok('explain a routine in plain English', await waitFor(() => tabLabels().some(l => /Plain English/.test(l)), 8000), tabLabels());
  await vscode.commands.executeCommand('retroAsm.showReference');
  ok('cheat sheet', await waitFor(() => tabLabels().some(l => /cheat sheet/.test(l)), 8000), tabLabels());
  await vscode.window.showTextDocument(game, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('retroAsm.toggleAddresses');
  await vscode.commands.executeCommand('retroAsm.toggleAddresses');
  ok('show and hide addresses (no errors)', true);
  await vscode.commands.executeCommand('workbench.action.closeOtherEditors');

  // ---- the original game (.skool) ----------------------------------------------------------
  const origLinks = (links || []).filter(l => l.target && l.target.scheme === 'command');
  ok('addresses of the original in comments are links', origLinks.length === 2 && origLinks.every(l => l.target.path === 'retroAsm.openOriginal'), origLinks.map(l => l.target.toString()));
  h = await vscode.commands.executeCommand('vscode.executeHoverProvider', game.uri, posOf(game, 'original $8044', '$8044'));
  ok('tooltip shows the original code at that address', /Menu/.test(hoverText(h)) && /ld hl,\$4000/.test(hoverText(h)) && /orig\.skool, line 26/.test(hoverText(h)), hoverText(h));
  d = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', game.uri, posOf(game, 'original $8044', '$8044'));
  ok('F12 on an original address opens the .skool file there', d && d.length === 1 && /orig\.skool$/.test(target(d[0]).uri.fsPath) && target(d[0]).line === 25, d && d.map(target));
  // do what a Ctrl+click on the link does: run its command with its arguments
  if (origLinks.length) {
    const args = JSON.parse(origLinks[1].target.query);
    ok('the link carries the address and this file', args[0] === 0x8044 && same(args[1], game.uri.fsPath), args);
    await vscode.window.showTextDocument(game, vscode.ViewColumn.One);
    await vscode.commands.executeCommand(origLinks[1].target.path, ...args);
    const side = await waitFor(() => vscode.window.visibleTextEditors.find(e => /orig\.skool$/.test(e.document.uri.fsPath)), 5000);
    ok('the .skool file opens beside the code', side && side.viewColumn !== vscode.ViewColumn.One, side && side.viewColumn);
    ok('... at the right line', side && side.selection.active.line === 25, side && side.selection.active.line);
    ok('... and the cursor stays in the code', vscode.window.activeTextEditor && /game\.a99$/.test(vscode.window.activeTextEditor.document.uri.fsPath), vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath);
    await vscode.commands.executeCommand('retroAsm.openOriginal', 0x8016, game.uri.fsPath);
    const editors = vscode.window.visibleTextEditors.filter(e => /orig\.skool$/.test(e.document.uri.fsPath));
    ok('a second address reuses the same side pane', editors.length === 1 && editors[0].selection.active.line === 21, editors.map(e => [e.viewColumn, e.selection.active.line]));
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const pkg = ext && ext.packageJSON;
  const cap = pkg && pkg.capabilities && pkg.capabilities.untrustedWorkspaces;
  ok('in untrusted folders it runs with build switched off (not off completely)', cap && cap.supported === 'limited' && cap.restrictedConfigurations.includes('retroAsm.build.command'), cap);

  // ---- 6502 (Commodore 64, KickAssembler) ------------------------------------------------------
  const { doc: c64 } = await open('c64demo.asm');
  ok('a .asm file (associated in the settings) is read as Retro Assembly', c64.languageId === 'retroasm', c64.languageId);
  const h6 = await waitFor(async () => hoverText(await vscode.commands.executeCommand('vscode.executeHoverProvider', c64.uri, posOf(c64, 'lda (ptr),y', 'lda'))), 8000);
  ok('6502 tooltip explains a zero-page pointer', /Y places past the address stored at ptr/.test(h6 || ''), h6);
  const d6 = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', c64.uri, posOf(c64, 'dec frame', 'frame'));
  ok('6502: go to a label in an #import file', d6 && d6.length === 1 && /c64data\.asm$/.test(target(d6[0]).uri.fsPath), d6 && d6.map(target));
  await sleep(1500);
  const w6 = vscode.languages.getDiagnostics(c64.uri);
  ok('the made-up C64 program gives no warnings', w6.length === 0, w6.map(x => [x.range.start.line + 1, x.message]));

  // ---- Z80 (ZX Spectrum) ------------------------------------------------------------------------
  const { doc: zx } = await open('zxdemo.asm');
  const hz = await waitFor(async () => hoverText(await vscode.commands.executeCommand('vscode.executeHoverProvider', zx.uri, posOf(zx, 'jr nc,.done', 'jr'))), 8000);
  ok('an .asm file of Z80 code is read as Z80 (next to a 6502 one)', /Jump relative/.test(hz || ''), hz);
  ok('Z80 tooltip: the jump after a compare', /if A is greater than or equal to 'Q'/.test(hz || ''), hz);
  const hb = hoverText(await vscode.commands.executeCommand('vscode.executeHoverProvider', zx.uri, posOf(zx, 'ld a,2', '2')));
  ok('Z80 tooltip: the border colour sent to port $FE', /border red/.test(hb), hb);
  const dz = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', zx.uri, posOf(zx, 'jr z,.left', '.left'));
  ok('Z80: go to a local .label', dz && dz.length === 1 && target(dz[0]).line === 35, dz && dz.map(target));
  const lz = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', zx.uri);
  ok('Z80: summary line with address and size', (lz || []).some(l => l.command && /\$8000 · 66 bytes/.test(l.command.title)), (lz || []).map(l => l.command && l.command.title));
  await sleep(1500);
  const wz = vscode.languages.getDiagnostics(zx.uri);
  ok('the made-up Spectrum program gives no warnings', wz.length === 0, wz.map(x => [x.range.start.line + 1, x.message]));
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  // ---- build --------------------------------------------------------------------------------
  if (!info.xas99) { skip('build', 'no xas99.py: set XAS99'); return; }
  const script = process.platform === 'win32' ? 'build.bat' : 'build.sh';
  // the build would normally ask first (a pop-up the test can't click), so switch that off in the test's own user settings
  await vscode.workspace.getConfiguration('retroAsm').update('build.askFirst', false, vscode.ConfigurationTarget.Global);
  const { doc: pad, ed: padEd } = await open(path.join('buildtest', 'paddle.a99'));
  const obj = path.join(ws(), 'buildtest', 'PADDLE.obj');
  let r = await vscode.commands.executeCommand('retroAsm.build');
  ok(`build runs ${script} (Ctrl+Alt+B)`, r === true && fs.existsSync(obj), r);
  // break a line without saving: the build must save first, then show the assembler's error there
  const badLine = posOf(pad, 'LIMI 0').line;
  await padEd.edit(e => e.insert(new vscode.Position(badLine + 1, 0), '       BADOP R1\n'));
  ok('(the file now has an unsaved change)', pad.isDirty);
  r = await vscode.commands.executeCommand('retroAsm.build');
  ok('a broken build reports failure', r === false, r);
  ok('the build saved the file first', !pad.isDirty);
  const bd = await waitFor(() => vscode.languages.getDiagnostics(pad.uri).filter(x => x.source === 'assembler'), 3000);
  ok('the assembler\'s error is underlined on the right line', bd && bd.some(x => x.range.start.line === badLine + 1 && x.severity === vscode.DiagnosticSeverity.Error), bd && bd.map(x => [x.range.start.line + 1, x.message]));
  await padEd.edit(e => e.delete(new vscode.Range(badLine + 1, 0, badLine + 2, 0)));
  ok('the old error goes once the line is edited', vscode.languages.getDiagnostics(pad.uri).filter(x => x.source === 'assembler').length === 0);
  r = await vscode.commands.executeCommand('retroAsm.build');
  ok('fixed again: the build passes', r === true, r);

  // ---- build and run (F5) ----------------------------------------------------------------------
  if (process.platform !== 'win32') {
    r = await vscode.commands.executeCommand('retroAsm.buildAndRun');
    ok('F5 without an emulator builds, then says how to set one (does not hang)', r === true, r);
    skip('starting Classic99', 'Windows only');
    return;
  }
  if (!info.classic99) {
    r = await vscode.commands.executeCommand('retroAsm.buildAndRun');
    ok('F5 without an emulator builds, then says how to set one (does not hang)', r === true, r);
    skip('starting Classic99', 'set CLASSIC99 to the path of classic99.exe to include it');
    return;
  }
  const running = () => new Promise(res => cp.exec('tasklist /FI "IMAGENAME eq classic99.exe" /NH', { windowsHide: true }, (e, out) => res(!e && /classic99\.exe/i.test(out))));
  if (await running()) { skip('starting Classic99', 'Classic99 is already open; close it and run again to include this'); return; }
  r = await vscode.commands.executeCommand('retroAsm.buildAndRun');
  ok('F5 builds, then starts Classic99', r === 'started', r);
  ok('Classic99 is running', await waitFor(running, 10000, 500));
  r = await vscode.commands.executeCommand('retroAsm.buildAndRun');
  ok('F5 again sees Classic99 is already open', r === 'already running', r);
  cp.execSync('taskkill /IM classic99.exe /F', { windowsHide: true, stdio: 'ignore' });
  ok('Classic99 closed again', await waitFor(async () => !(await running()), 5000, 300));
}

module.exports = { run };
