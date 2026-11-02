'use strict';
const BOUNCE = [['auto', 'Bounce off it, the way it came in'], ['up-down', 'Bounce up or down'], ['left-right', 'Bounce left or right'], ['back', 'Straight back'], ['none', 'Pass straight through']];
module.exports = {
  id: 'tile-hit', name: 'If a thing hits a tile', when: 'frame', category: 'Tiles',
  about: 'Looks at the tile under the middle of the thing. If there is one, the whole tile is rubbed out, the thing can bounce (by default the way it came in: off the side if it came from the side, off the bottom if it came from below), and the blocks inside run (for the score and a sound).',
  params: {
    thing: { type: 'thing' },
    tile: { type: 'tile' },
    bounce: { type: 'choice', default: 'auto', options: BOUNCE, about: 'What the thing does when it hits a tile' },
    do: { type: 'blocks' }
  },
  plan(ctx, b) { ctx.wantTileGroups(b.tile, 1); },
  generate(ctx, b) {
    const t = ctx.thing(b.thing); if (!t) return;
    const T = ctx.tile(b.tile); if (!T) return;
    ctx.variable(T.left, 0);
    ctx.need('VSBR'); ctx.need('VSBW'); ctx.need('VFILL');
    const no = ctx.label('NOTILE'), inr = ctx.label('INSCR'), yes = ctx.label('TILE');
    const a = T.across, d = T.down, first = T.group * 8;
    ctx.op('MOV', `@${t.x},R5`);
    ctx.op('AI', 'R5,4', 'Middle of the thing');
    ctx.op('SRL', 'R5,3', 'Column on the screen (8 dots each)');
    ctx.op('MOV', `@${t.y},R6`);
    ctx.op('AI', 'R6,5');
    ctx.op('SRL', 'R6,3', 'Row on the screen');
    ctx.op('MOV', 'R6,R0');
    ctx.op('SLA', 'R0,5', 'Row x 32');
    ctx.op('A', 'R5,R0', 'Screen position');
    ctx.op('CI', 'R0,768');
    ctx.op('JL', inr, 'Still on the screen?');
    ctx.op('B', `@${no}`);
    ctx.at(inr, 'MOV', 'R0,R4', 'Remember where');
    ctx.op('BL', '@VSBR', 'Which character is there?');
    ctx.op('SRL', 'R1,8');
    ctx.op('AI', 'R1,' + (-first), `This tile uses characters ${first} to ${first + T.groups * 8 - 1}`);
    ctx.op('CI', 'R1,' + T.groups * 8);
    ctx.op('JL', yes, 'A piece of this tile?');
    ctx.op('B', `@${no}`);
    ctx.at(yes, 'ANDI', 'R1,7', 'Which piece of the tile it is');
    // piece number = row of pieces x across + column of pieces
    ctx.op('MOV', 'R1,R2');
    if (a > 1) { ctx.op('ANDI', 'R2,' + (a - 1), 'Column of pieces'); ctx.op('SRL', 'R1,' + Math.log2(a), 'Row of pieces'); }
    else ctx.op('CLR', 'R2', 'Column of pieces');
    ctx.op('SLA', 'R1,5', 'Row x 32');
    ctx.op('A', 'R1,R2');
    ctx.op('S', 'R2,R4', 'Back to the top-left piece of the tile');
    for (let r = 0; r < d; r++) {
      ctx.op('MOV', 'R4,R0', r === 0 ? 'Rub out the whole tile (spaces)' : '');
      if (r) ctx.op('AI', `R0,${r * 32}`);
      ctx.op('LI', 'R1,>2000');
      ctx.op('LI', `R2,${a}`);
      ctx.op('BL', '@VFILL');
    }
    ctx.op('DEC', `@${T.left}`);
    const bounce = b.bounce === undefined ? 'auto' : b.bounce;
    if (bounce === 'auto') {
      // which side did it come in from? Compare the column and row it was in a moment ago with where it is now.
      const same = ctx.label('SAMECOL'), side = ctx.label('SIDE'), done = ctx.label('BOUNCED');
      ctx.op('MOV', `@${t.x},R0`, 'Where was the middle of it a moment ago?');
      ctx.op('S', `@${t.vx},R0`);
      ctx.op('AI', 'R0,4');
      ctx.op('SRL', 'R0,3', 'Column before');
      ctx.op('MOV', `@${t.y},R1`);
      ctx.op('S', `@${t.vy},R1`);
      ctx.op('AI', 'R1,5');
      ctx.op('SRL', 'R1,3', 'Row before');
      ctx.op('C', 'R0,R5', 'Same column as now?');
      ctx.op('JEQ', same);
      ctx.op('C', 'R1,R6', 'Different column. Same row?');
      ctx.op('JEQ', side);
      ctx.op('NEG', `@${t.vy}`, 'Came in at a corner: bounce back both ways');
      ctx.at(side, 'NEG', `@${t.vx}`, 'Came in from the side: bounce sideways');
      ctx.op('JMP', done);
      ctx.at(same, 'NEG', `@${t.vy}`, 'Came in from above or below: bounce up or down');
      ctx.at(done, '', '');
    }
    else if (bounce === 'up-down') ctx.op('NEG', `@${t.vy}`, 'Bounce');
    else if (bounce === 'left-right') ctx.op('NEG', `@${t.vx}`, 'Bounce');
    else if (bounce === 'back') { ctx.op('NEG', `@${t.vx}`, 'Bounce'); ctx.op('NEG', `@${t.vy}`); }
    ctx.children(b.do, 'frame');
    ctx.at(no, '', '');
  }
};
