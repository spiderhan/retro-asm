'use strict';
// Sounds kept as BYTE / DATA lines, played with the sound chip's own rules.
// Nothing in here knows about VS Code.
//
// A block is marked as a sound with a comment just above it (or at the end of its first line):
//     * @sound
//     BEEP   BYTE 4,>9F,>BF,>DF,>FF,>05, 0
//
// The layout read is the TI-99/4A's usual sound list. Each step is:
//     a count, then that many bytes for the sound chip, then how long to wait (in 60ths of a second).
// The list ends with a count of 0.
// A chip file turns this on with a "sound" section (see dialects/tms9900.json).

const MARK = /^[^\w@]*@sound\b([^\n]*)/i;
const SOUND_LABEL = /(^|_)(SND|SOUND|SOUNDS|SFX|MUSIC|TUNE|SONG|BEEP|JINGLE|NOISE|BLEEP|MELODY)(_|\d|$)/i;
const SOUND_WORDS = /\b(sound|sounds|music|tune|song|beep|jingle|noise|sfx|melody|sound list)\b/i;
const MAX_TICKS = 3600;       // one minute: more than that is cut short

/** Does this chip file know how to play sounds? */
function settings(D) { return D && D.sound ? D.sound : null; }

/** Read a sound list. { steps: [{ bytes, ticks }], ended, spare } or { steps, error }. */
function parseList(bytes) {
  const steps = [];
  let i = 0;
  while (i < bytes.length) {
    const n = bytes[i];
    if (n === 0) return { steps, ended: true, spare: bytes.length - i - 1 };
    if (i + n + 2 > bytes.length) {
      return { steps, error: `Step ${steps.length + 1} says ${n} byte${n === 1 ? '' : 's'} go to the sound chip, but the data stops before those bytes and the wait that follows them.` };
    }
    steps.push({ bytes: bytes.slice(i + 1, i + 1 + n), ticks: bytes[i + 1 + n] });
    i += n + 2;
  }
  return { steps, ended: false, spare: 0 };
}

/** The sounding of a block: { steps, ticks, seconds, ... } or { error }. */
function analyse(bytes) {
  const list = parseList(bytes);
  if (list.error) return { error: list.error, steps: list.steps };
  if (!list.steps.length) return { error: 'The list is empty (it starts with a count of 0).' };
  let ticks = 0;
  list.steps.forEach(s => { ticks += s.ticks; });
  return { steps: list.steps, ended: list.ended, spare: list.spare, ticks, seconds: ticks / 60, tooLong: ticks > MAX_TICKS };
}

/**
 * What the sound chip is doing in each 60th of a second.
 * Self-contained on purpose: the player page runs a copy of this text.
 * Returns { frames: [{ per: [3 pitch numbers], att: [4 quietness numbers], nc, nr }], truncated }.
 */
function chipFrames(steps) {
  const MAX = 3600;
  const per = [1024, 1024, 1024], att = [15, 15, 15, 15];
  let nc = 0, nr = 0, last = -1, isAtt = false, truncated = false;
  const frames = [];
  for (let s = 0; s < steps.length && !truncated; s++) {
    const bytes = steps[s].bytes;
    for (let k = 0; k < bytes.length; k++) {
      const b = bytes[k] & 0xFF;
      if (b & 0x80) {                          // the first byte of a change: which voice, and pitch or quietness
        last = (b >> 5) & 3; isAtt = !!(b & 0x10);
        const d = b & 15;
        if (isAtt) att[last] = d;
        else if (last === 3) { nc = d & 7; nr++; }
        else per[last] = (per[last] & 0x3F0) | d;
      } else if (last >= 0) {                  // a following byte: the rest of what was just started
        if (isAtt) att[last] = b & 15;
        else if (last === 3) { nc = b & 7; nr++; }
        else per[last] = ((b & 0x3F) << 4) | (per[last] & 15);
      }
    }
    for (let t = 0; t < (steps[s].ticks & 0xFF); t++) {
      if (frames.length >= MAX) { truncated = true; break; }
      frames.push({ per: per.slice(), att: att.slice(), nc: nc, nr: nr });
    }
  }
  return { frames: frames, truncated: truncated };
}

/** Turn those frames into sound: an array of numbers from -1 to 1. Self-contained, like chipFrames. */
function renderFrames(frames, sr) {
  const CLOCK = 111860.8, RATES = [3579545 / 512, 3579545 / 1024, 3579545 / 2048];
  const tick = Math.round(sr / 60), n = frames.length * tick, out = new Float32Array(n);
  const ph = [0, 0, 0];
  let nph = 0, lfsr = 0x4000, bit = 1, nr = -1;
  const amp = (a) => (a >= 15 ? 0 : Math.pow(10, -2 * a / 20) * 0.2);       // 2 dB a step, 15 is off
  for (let s = 0; s < n; s++) {
    const f = frames[Math.min(frames.length - 1, Math.floor(s / tick))];
    if (f.nr !== nr) { nr = f.nr; lfsr = 0x4000; }                          // setting the noise starts it again
    let v = 0;
    for (let c = 0; c < 3; c++) {
      const hz = CLOCK / (f.per[c] || 1024);
      ph[c] = (ph[c] + hz / sr) % 1;
      if (f.att[c] < 15 && hz < 20000) v += (ph[c] < 0.5 ? 1 : -1) * amp(f.att[c]);   // above 20 kHz nobody hears it
    }
    const t3 = CLOCK / (f.per[2] || 1024);
    nph += ((f.nc & 3) === 3 ? t3 : RATES[f.nc & 3]) / sr;
    while (nph >= 1) {
      nph -= 1;
      const fb = (f.nc & 4) ? ((lfsr ^ (lfsr >> 1)) & 1) : (lfsr & 1);     // hiss: two bits mixed. buzz: one.
      bit = lfsr & 1;
      lfsr = (lfsr >> 1) | (fb << 14);
    }
    if (f.att[3] < 15) v += (bit ? 1 : -1) * amp(f.att[3]);
    out[s] = v;
  }
  return out;
}

/** The marker comment for a block (the lines just above it, or the end of its first lines). */
function markerFor(model, labelLine, firstLine) {
  const D = model.D;
  const lines = [];
  let k = labelLine - 1;
  while (k >= 0 && model.lines[k].label && !model.lines[k].mnem) k--;
  for (; k >= 0 && k >= labelLine - 40; k--) {
    const pl = model.lines[k];
    if (pl.label || pl.mnem || !pl.comment) break;
    lines.push({ line: k, text: pl.comment.text });
  }
  for (const ln of [labelLine, firstLine]) {
    const pl = model.lines[ln];
    if (pl && pl.comment) lines.push({ line: ln, text: pl.comment.text });
  }
  for (const c of lines) if (MARK.test(c.text)) return { line: c.line };
  return null;
}

/** Every block marked @sound: [{ line, label, marker }]. */
function markedBlocks(project, file, dataBlock) {
  const model = project.get(file);
  if (!model) return [];
  const out = [], seen = new Set();
  for (let ln = 0; ln < model.lines.length; ln++) {
    const pl = model.lines[ln];
    if (!pl.comment || !MARK.test(pl.comment.text)) continue;
    for (let k = ln; k < model.lines.length && k <= ln + 6; k++) {
      const q = model.lines[k];
      if (!q.mnem) continue;
      const d = model.D.directive(q.mnem.upper);
      if (!d || d.kind !== 'data') break;
      const blk = dataBlock(project, file, k);
      if (blk && !seen.has(blk.labelLine)) {
        const mk = markerFor(model, blk.labelLine, blk.firstLine);
        if (mk) { seen.add(blk.labelLine); out.push({ line: blk.labelLine, label: blk.label, marker: mk.line }); }
      }
      break;
    }
  }
  return out;
}

/** A quick first look: does the name or a comment say sound? */
function soundHint(label, text) { return SOUND_LABEL.test(label || '') || SOUND_WORDS.test(text || ''); }

/** Does a block read cleanly as a sound list from start to finish, with a name or comment that says sound? */
function looksLikeSound(blk) {
  if (!blk || blk.bytes.length < 4 || !(SOUND_LABEL.test(blk.label || '') || SOUND_WORDS.test(blk.hint))) return false;
  const a = analyse(blk.bytes);
  return !a.error && a.ended && a.spare === 0;
}

module.exports = { MARK, settings, parseList, analyse, chipFrames, renderFrames, markerFor, markedBlocks, soundHint, looksLikeSound, MAX_TICKS };
