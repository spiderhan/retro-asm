'use strict';
// Row colours, used when "a different colour for each row" is chosen (TI colour numbers).
const RAINBOW = [8, 10, 11, 2, 7, 5, 13, 9, 3, 14];
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');

module.exports = {
  id: 'tile-fill', name: 'Fill an area with tiles', when: 'any', category: 'Tiles',
  about: 'Covers part of the screen with rows of a tile (any picture you draw, in 8x8 pieces: a brick, an alien, a crate). Tiles are drawn on the screen, not as sprites, so there can be as many as you like. Every row can have its own colour. The game keeps count of how many are left.',
  params: {
    tile: { type: 'tile', about: 'Which tile to use' },
    rows: { type: 'number', default: 4, min: 1, max: 12, about: 'How many rows of tiles' },
    across: { type: 'number', default: 0, min: 0, max: 30, zero: 'As many as fit', about: 'How many tiles in each row (0 = as many as fit)' },
    top: { type: 'number', default: 3, min: 0, max: 22, about: 'How far down the screen it starts, in rows of 8 dots' },
    left: { type: 'number', default: 1, min: 0, max: 30, about: 'How far across it starts, in columns of 8 dots' },
    colour: { type: 'colour', default: 0, min: 0, max: 15, zero: 'A different colour for each row', about: 'One colour for every row, or a different colour for each row' },
    stagger: {
      type: 'choice', default: 'no', about: 'Shift every other row by half a tile, like a brick wall',
      options: [['no', 'Rows line up'], ['yes', 'Every other row shifted by half a tile']]
    }
  },
  plan(ctx, b) { ctx.wantTileGroups(b.tile, b.colour ? 1 : Math.max(1, Math.min(b.rows === undefined ? 4 : b.rows, 12))); },
  generate(ctx, b) {
    const T = ctx.tile(b.tile); if (!T) return;
    const rows = b.rows === undefined ? 4 : b.rows, top = b.top === undefined ? 3 : b.top, left = b.left === undefined ? 1 : b.left;
    const one = (b.colour || 0) & 15, stagger = b.stagger === 'yes';
    const a = T.across, d = T.down;
    const half = a / 2;
    const n = b.across ? b.across : Math.floor((stagger ? 32 - half - left : 31 - left) / a);
    if (!(rows >= 1 && rows <= 12)) return ctx.problem('"Fill an area with tiles" needs 1 to 12 rows.');
    if (n < 1) return ctx.problem('"Fill an area with tiles": there is no room for a tile there. Try a smaller "left".');
    if (left + n * a > 31) return ctx.problem(`"Fill an area with tiles": ${n} tiles of ${a * 8} dots each, starting ${left} columns in, run off the right of the screen. Use fewer tiles or a smaller "left".`);
    if (top + rows * d > 23) return ctx.problem(`"Fill an area with tiles": the area would run off the bottom of the screen (${rows} rows of ${d * 8}-dot tiles from row ${top}). Use fewer rows or a smaller "top".`);
    if (stagger && a < 2) return ctx.problem('"Fill an area with tiles" can only shift rows by half a tile when the tile is 16 dots wide or more.');
    if (stagger && a >= 2 && left < half) return ctx.problem(`"Fill an area with tiles": shifting every other row by half a tile needs "left" to be at least ${half}, so the shifted row stays on the screen.`);
    if (stagger && a >= 2 && left + n * a + half > 32) return ctx.problem(`"Fill an area with tiles": with every other row shifted by half a tile, the wall is ${n * a + half} columns wide and does not fit from column ${left}. Use fewer tiles or a smaller "left".`);
    if (stagger && n < 2) return ctx.problem('"Fill an area with tiles" needs at least 2 tiles in a row to shift every other row.');
    if (!one && rows > T.groups) return ctx.problem(`"Fill an area with tiles": ${rows} rows each in a different colour need ${rows} groups of screen characters, but this tile has ${T.groups}.`);
    ctx.variable(T.left, 0);
    ctx.need('VTILES'); ctx.need('VSBW');
    const size = T.cells * 8;
    let total = 0;
    for (let r = 0; r < rows; r++) {
      const odd = stagger && r % 2 === 1;
      const g = T.group + (one ? 0 : r);
      const first = (g * 8);
      ctx.note(`Row ${r + 1} of tiles${odd ? ' (shifted half a tile)' : ''}`);
      if (!one || r === 0) {
        ctx.op('LI', `R0,>${hex(0x0800 + first * 8, 4)}`, `Drawing of the tile for screen characters ${first} to ${first + T.cells - 1}`);
        ctx.op('LI', `R1,${T.art}`);
        ctx.op('LI', `R2,${size}`);
        ctx.op('BL', '@VMBW');
        const colour = one || RAINBOW[r % RAINBOW.length];
        ctx.op('LI', `R0,>${hex(0x0380 + g, 4)}`, 'Colour of those characters');
        ctx.op('LI', `R1,>${hex(colour, 1)}000`);
        ctx.op('BL', '@VSBW');
      }
      for (let t = 0; t < d; t++) {
        const pos = (top + r * d + t) * 32 + left;
        const start = first + t * a;
        const call = (at, piece, count, cells) => {
          ctx.op('LI', `R0,${at}`);
          ctx.op('LI', `R1,>${hex(piece, 2)}00`);
          ctx.op('LI', `R2,${count}`);
          ctx.op('LI', `R3,${cells}`);
          ctx.op('BL', '@VTILES');
        };
        if (!odd) call(pos, start, n, a);
        else {
          call(pos, start + half, 1, half);                   // the right half of a tile, at the left end
          if (n > 1) call(pos + half, start, n - 1, a);       // whole tiles
          call(pos + half + (n - 1) * a, start, 1, half);     // the left half of a tile, at the right end
        }
      }
      total += odd ? n + 1 : n;
    }
    ctx.op('LI', `R1,${total}`, 'Tiles in the area');
    ctx.op('MOV', `R1,@${T.left}`);
  }
};
