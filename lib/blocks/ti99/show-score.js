'use strict';
module.exports = {
  id: 'show-score', name: 'Show the score', when: 'frame', category: 'Score',
  about: 'Writes the score as three digits on the screen (column across, row down).',
  params: { column: { type: 'number', default: 0 }, row: { type: 'number', default: 0 } },
  generate(ctx, b) {
    ctx.variable('SCORE', 0);
    ctx.need('DIGITS');
    ctx.op('MOV', '@SCORE,R0');
    ctx.op('LI', `R1,${(b.row || 0) * 32 + (b.column || 0)}`, 'Screen position = row x 32 + column');
    ctx.op('BL', '@SHOWNUM');
  }
};
