'use strict';
// Row colours, used when no single colour is chosen (TI colour numbers).
const RAINBOW = [8, 10, 11, 2, 7, 5, 13, 9, 3, 14];
module.exports = {
  id: 'brick-wall', name: 'Build a wall of bricks', when: 'any', category: 'Bricks',
  about: 'Fills the screen with rows of brick-shaped bricks (screen tiles, not sprites, so there can be as many as you like). Every row has its own colour, unless you pick one colour for all. The game keeps count of how many bricks are left.',
  params: {
    rows: { type: 'number', default: 4, min: 1, max: 10 },
    top: { type: 'number', default: 3, min: 1, max: 12 },
    colour: { type: 'number', default: 0, min: 0, max: 15, about: '0 = a different colour for each row; 2 to 15 = that one colour for every row' }
  },
  generate(ctx, b) {
    const rows = b.rows === undefined ? 4 : b.rows, top = b.top === undefined ? 3 : b.top;
    const one = (b.colour || 0) & 15;
    if (!(rows >= 1 && rows <= 10)) return ctx.problem('"Build a wall of bricks" needs 1 to 10 rows.');
    if (!(top >= 1 && top + rows <= 23)) return ctx.problem('The wall would run off the bottom of the screen: "top" plus "rows" must be 23 or less.');
    ctx.variable('BRICKS', 0);
    ctx.need('VBRICKS'); ctx.need('VSBW'); ctx.need('BRICKPAT');
    const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
    let total = 0;
    for (let r = 0; r < rows; r++) {
      const tile = 96 + r * 8, col = one || RAINBOW[r % RAINBOW.length], pos = (top + r) * 32 + 1, odd = r % 2 === 1;
      ctx.note(`Row ${top + r}: ${odd ? 'shifted half a brick' : 'whole bricks'}`);
      ctx.op('LI', `R0,>${hex(0x0800 + tile * 8, 4)}`, `Drawing of the bricks in this row (tiles ${tile} and ${tile + 1})`);
      ctx.op('LI', 'R1,BRKPAT');
      ctx.op('LI', 'R2,16');
      ctx.op('BL', '@VMBW');
      ctx.op('LI', `R0,>${hex(0x0380 + (tile >> 3), 4)}`, 'Colour of this row');
      ctx.op('LI', `R1,>${hex(col, 1)}000`);
      ctx.op('BL', '@VSBW');
      if (!odd) {
        ctx.op('LI', `R0,${pos}`);
        ctx.op('LI', `R1,>${hex(tile, 2)}00`);
        ctx.op('LI', 'R2,15', 'Whole bricks');
        ctx.op('BL', '@VBRICKS');
        total += 15;
      } else {
        ctx.op('LI', `R0,${pos}`, 'Half a brick at the left end');
        ctx.op('LI', `R1,>${hex(tile + 1, 2)}00`);
        ctx.op('BL', '@VSBW');
        ctx.op('LI', `R0,${pos + 1}`);
        ctx.op('LI', `R1,>${hex(tile, 2)}00`);
        ctx.op('LI', 'R2,14', 'Whole bricks');
        ctx.op('BL', '@VBRICKS');
        ctx.op('LI', `R0,${pos + 29}`, 'Half a brick at the right end');
        ctx.op('LI', `R1,>${hex(tile, 2)}00`);
        ctx.op('BL', '@VSBW');
        total += 16;
      }
    }
    ctx.op('LI', `R1,${total}`, 'Bricks in the wall');
    ctx.op('MOV', 'R1,@BRICKS');
  }
};
