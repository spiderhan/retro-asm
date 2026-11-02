'use strict';
// Older blocks files keep working: this turns the blocks an earlier version had into the ones that
// replaced them. It changes a copy and says what it did, so the panel can save the result.
//
// 0.30: the three brick blocks became general tile blocks, and a brick became just a picture.

const BRICK_PICTURE = [
  '',
  '* A brick is one picture, two 8x8 pieces wide. Redraw it (or point the tile at another picture) to make something else.',
  '* @sprite 16x8 cells',
  'BRICK_PIC BYTE >FF,>FF,>FF,>FF,>FF,>FF,>FF,>00',
  '       BYTE >FE,>FE,>FE,>FE,>FE,>FE,>FE,>00'
];

function walk(list, fn) {
  (list || []).forEach((b) => {
    fn(b);
    for (const v of Object.values(b)) if (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object' && x.block)) walk(v, fn);
  });
}

/** Returns { project, notes: [plain-English strings], changed }. */
function upgrade(input) {
  const project = JSON.parse(JSON.stringify(input));
  const notes = [];
  let usesOld = false;
  const fix = (b) => {
    if (b.block === 'brick-wall') {
      usesOld = true;
      const nb = { block: 'tile-fill', tile: 'brick', rows: b.rows === undefined ? 4 : b.rows, top: b.top === undefined ? 3 : b.top, left: 1, across: 0, colour: b.colour || 0, stagger: 'yes' };
      for (const k of Object.keys(b)) delete b[k]; Object.assign(b, nb);
    } else if (b.block === 'if-hits-brick') {
      usesOld = true;
      const nb = { block: 'tile-hit', thing: b.thing, tile: 'brick', bounce: 'auto', do: b.do || [] };
      for (const k of Object.keys(b)) delete b[k]; Object.assign(b, nb);
    } else if (b.block === 'if-no-bricks') {
      usesOld = true;
      const nb = { block: 'if-no-tiles', tile: 'brick', do: b.do || [] };
      for (const k of Object.keys(b)) delete b[k]; Object.assign(b, nb);
    }
  };
  walk(project.start, fix); walk(project.every_frame, fix);
  if (usesOld) {
    project.tiles = project.tiles || {};
    if (!project.tiles.brick) project.tiles.brick = { art: 'BRICK_PIC' };
    if (!project.dataFile && !(project.data || []).some(l => /^BRICK_PIC\b/.test(l))) project.data = (project.data || []).concat(BRICK_PICTURE);
    notes.push('The brick blocks are now tile blocks (a brick is a tile with a picture called BRICK_PIC).');
  }
  return { project, notes, changed: notes.length > 0 };
}

/**
 * Takes the pictures and sounds out of a project and into their own file, which the game then includes.
 * Returns { project, text } (the changed copy, and what the new file should hold), or null if it already has one.
 */
function moveDataToFile(input, fileName) {
  if (input.dataFile) return null;
  const project = JSON.parse(JSON.stringify(input));
  const lines = (project.data || []).slice();
  while (lines.length && lines[0].trim() === '') lines.shift();
  const text = [
    '* Pictures and sounds' + (project.title ? ' for "' + project.title + '"' : '') + '.',
    '* Draw the pictures with the picture editor and play the sounds from here. Making the game again never changes this file.',
    ''
  ].concat(lines, ['']).join('\n');
  project.dataFile = fileName;
  delete project.data;
  return { project, text };
}

module.exports = { upgrade, moveDataToFile, BRICK_PICTURE };
