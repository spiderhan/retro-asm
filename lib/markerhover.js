'use strict';
// The tooltips on the @sprite and @sound comments: what the comment does, and what is below it.
// Nothing in here knows about VS Code.

const SPR = require('./sprites');
const SND = require('./sound');

/** Where the "@word" sits on the line, if (line, character) is on it and the comment is really that marker. */
function wordAt(model, line, character, MARK, word) {
  const pl = model.lines[line], raw = model.rawLines[line];
  if (!pl || !raw || !pl.comment || !MARK.test(pl.comment.text)) return null;
  const m = new RegExp('@' + word + '\\b', 'i').exec(raw);
  if (!m || character < m.index || character > m.index + m[0].length) return null;
  return { start: m.index, end: m.index + m[0].length };
}

const bytes = (n) => `${n} byte${n === 1 ? '' : 's'}`;

/** The tooltip for a @sprite comment: { start, end, parts[], link? { title, command, line } } or null. */
function spriteHover(project, file, line, character, dataBlock) {
  const model = project.get(file);
  const w = model && wordAt(model, line, character, SPR.MARK, 'sprite');
  if (!w) return null;
  const parts = ['**This marks the bytes below as a picture**'];
  const m = SPR.markedBlocks(project, file, dataBlock).find(b => b.marker === line);
  const blk = m && dataBlock(project, file, m.line);
  if (!blk) return Object.assign(w, { parts: parts.concat('⚠ There are no BYTE or DATA lines just below it, so there is nothing to draw yet.') });
  const pic = SPR.pictureOf(project, file, blk, m.spec);
  if (pic.error) return Object.assign(w, { parts: parts.concat('⚠ ' + pic.error) });
  const n = pic.frames.length;
  parts.push(`\`${m.label || 'The bytes below'}\` is drawn as ${pic.shape.name}: ${n} ${n === 1 ? 'picture' : 'pictures'}, ${bytes(blk.bytes.length)}.`);
  parts.push(pic.editable
    ? 'Click **Edit picture** to draw it. Each click changes the numbers in the BYTE or DATA lines, and typing new numbers changes the picture.'
    : `You can look at it but not draw on it, because ${pic.why}.`);
  return Object.assign(w, { parts, link: pic.editable ? { title: 'Edit picture', command: 'retroAsm.editSprite', line: m.line } : null });
}

/** The tooltip for a @sound comment, the same shape as spriteHover's. null if the chip has no sound player. */
function soundHover(project, file, line, character, dataBlock) {
  const model = project.get(file);
  const w = model && SND.settings(model.D) && wordAt(model, line, character, SND.MARK, 'sound');
  if (!w) return null;
  const parts = ['**This marks the bytes below as a sound**'];
  const m = SND.markedBlocks(project, file, dataBlock).find(b => b.marker === line);
  const blk = m && dataBlock(project, file, m.line);
  if (!blk) return Object.assign(w, { parts: parts.concat('⚠ There are no BYTE or DATA lines just below it, so there is nothing to play yet.') });
  const info = SND.analyse(blk.bytes);
  if (info.error) return Object.assign(w, { parts: parts.concat('⚠ ' + info.error) });
  parts.push(`\`${m.label || 'The bytes below'}\` is a sound of ${info.steps.length} ${info.steps.length === 1 ? 'step' : 'steps'}, ${info.seconds.toFixed(2)} seconds, played through the TI's sound chip.`);
  parts.push('Click **Play sound** to hear it and see what each byte does. Nothing in your code is changed.');
  return Object.assign(w, { parts, link: { title: 'Play sound', command: 'retroAsm.playSound', line: m.line } });
}

module.exports = { wordAt, spriteHover, soundHover };
