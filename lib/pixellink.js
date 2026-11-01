'use strict';
// Editing a whole screen in the pixel editor, a separate program of yours, and taking the changed tables back.
// Nothing in here knows about VS Code, and nothing in here touches the network.
//
// How the two programs talk (a folder on your own computer, nothing else):
//     in.a99      a copy of the file you are editing, as it is on screen right now
//     meta.json   { name, line, nonce }: the file's name, which @screen line, and a number that changes each time
//     out.json    written by the pixel editor when you press "Send to code":
//                 { format, nonce, tables: [{ label, bytes }], notes }
// The extension starts the pixel editor (`python pixel_editor.py --link FOLDER`), opens its page, and when
// out.json appears it puts the new numbers into the tables of the same names, changing only the numbers that
// are different, written the way you wrote them. It is one step in the editor, so Ctrl+Z undoes all of it.

const path = require('path');
const fs = require('fs');
const SPR = require('./sprites');
const SCR = require('./screen');

const FORMAT = 'pixel-editor-link/1';

/**
 * Where the pixel editor is. `setting` is the folder that holds pixel_editor.py, or the path of pixel_editor.py itself.
 * Returns { script, folder } or { error } (a plain sentence).
 */
function locateEditor(setting, fsLike) {
  const f = fsLike || fs;
  const given = String(setting || '').trim();
  if (!given) return { error: 'The pixel editor is switched off. To use it, set "retroAsm.pixelEditor.path" to the folder that holds pixel_editor.py.' };
  let script = given;
  try { if (f.statSync(given).isDirectory()) script = path.join(given, 'pixel_editor.py'); }
  catch (e) { return { error: `I can't find "${given}". Set "retroAsm.pixelEditor.path" to the folder that holds pixel_editor.py.` }; }
  if (!f.existsSync(script)) return { error: `There is no pixel_editor.py in "${given}". Set "retroAsm.pixelEditor.path" to the folder that holds it.` };
  return { script, folder: path.dirname(script) };
}

/** The command that starts the pixel editor for one shared folder. Port 0 lets the computer pick a free one. */
function launchPlan(python, script, shared) {
  return { command: python, args: ['-u', script, '--link', shared, '--port', '0', '--no-browser'], cwd: path.dirname(script) };
}

/** The web address in the pixel editor's first line of output, or null. */
function startedUrl(text) {
  const m = /Pixel Editor is running at (http:\/\/127\.0\.0\.1:\d+\/app\/)/.exec(String(text || ''));
  return m ? m[1] : null;
}

/** What the extension leaves for the pixel editor to open. */
function shareFiles(text, name, line, nonce) {
  return { 'in.a99': text, 'meta.json': JSON.stringify({ name, line, nonce }) };
}

/** Read what the pixel editor wrote. Returns { result } or { error }. */
function parseResult(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { error: 'The pixel editor\'s reply could not be read.' }; }
  if (!doc || doc.format !== FORMAT || !Array.isArray(doc.tables)) return { error: 'That reply is not from the pixel editor.' };
  for (const t of doc.tables) {
    if (!t || typeof t.label !== 'string' || !Array.isArray(t.bytes) || t.bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) return { error: 'The pixel editor\'s reply has a table that is not made of bytes.' };
  }
  return { result: doc };
}

/**
 * The text changes that put the pixel editor's tables into the file.
 * All or nothing: if any table can't be updated, nothing is changed, so the file never ends up half done.
 * Returns { edits: [{ line, start, end, text }], changed: [label], same: [label], problems: [sentence] }.
 */
function planEdits(project, file, result, dataBlock) {
  const model = project.get(file);
  const out = { edits: [], changed: [], same: [], problems: [] };
  if (!model) { out.problems.push('That file is not open as assembly any more.'); return out; }
  for (const t of result.tables) {
    const ln = SCR.labelLine(model, t.label);
    if (ln < 0) { out.problems.push(`There is no label called ${t.label} in this file any more.`); continue; }
    const blk = dataBlock(project, file, ln);
    if (!blk) { out.problems.push(`${t.label} is not followed by BYTE or DATA lines made of plain numbers any more.`); continue; }
    if (!blk.editable) { out.problems.push(`${t.label} can't be changed: ${blk.why}.`); continue; }
    if (blk.bytes.length !== t.bytes.length) { out.problems.push(`${t.label} now holds ${blk.bytes.length} bytes, but the pixel editor sent ${t.bytes.length}. The file changed after the editor was opened; open the pixel editor again from the link.`); continue; }
    const edits = SPR.editsFor(project, file, blk, t.bytes);
    (edits.length ? out.changed : out.same).push(t.label);
    out.edits.push(...edits);
  }
  if (out.problems.length) { out.edits = []; out.changed = []; out.same = []; }
  return out;
}

/** One plain sentence about what happened. */
function summary(plan, notes) {
  if (plan.problems.length) return 'Nothing was changed. ' + plan.problems.join(' ');
  const base = plan.changed.length
    ? `Updated ${plan.changed.length} table${plan.changed.length > 1 ? 's' : ''} from the pixel editor (${plan.changed.join(', ')}). Ctrl+Z undoes it.`
    : 'The pixel editor sent its tables, and they are the same as the ones in your code. Nothing changed.';
  return notes && notes.length ? base + ' ' + notes.join(' ') : base;
}

module.exports = { FORMAT, locateEditor, launchPlan, startedUrl, shareFiles, parseResult, planEdits, summary };
