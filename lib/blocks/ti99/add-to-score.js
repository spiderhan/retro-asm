'use strict';
module.exports = {
  id: 'add-to-score', name: 'Change the score', when: 'any', category: 'Score',
  about: 'Adds a number to the score (use a negative number to take points away).',
  params: { by: { type: 'number', default: 1 } },
  generate(ctx, b) {
    ctx.variable('SCORE', 0);
    const by = b.by === undefined ? 1 : b.by;
    if (by === 1) ctx.op('INC', '@SCORE');
    else {
      ctx.op('LI', `R1,${by}`);
      ctx.op('A', 'R1,@SCORE');
      if (by < 0) {                        // the score never goes below 0
        const ok = ctx.label('SCOK');
        ctx.op('JGT', ok);
        ctx.op('JEQ', ok);
        ctx.op('CLR', '@SCORE', 'No negative scores');
        ctx.at(ok, '', '');
      }
    }
  }
};
