'use strict';
module.exports = {
  id: 'place', name: 'Put a thing here', when: 'any', category: 'Things',
  about: 'Puts a thing at a spot on the screen (x across, y down) and stops it moving.',
  params: { thing: { type: 'thing' }, x: { type: 'number' }, y: { type: 'number' } },
  generate(ctx, b) {
    const t = ctx.thing(b.thing); if (!t) return;
    ctx.op('LI', `R1,${b.x}`);
    ctx.op('MOV', `R1,@${t.x}`);
    ctx.op('LI', `R1,${b.y}`);
    ctx.op('MOV', `R1,@${t.y}`);
    ctx.op('CLR', `@${t.vx}`);
    ctx.op('CLR', `@${t.vy}`);
  }
};
