'use strict';
module.exports = {
  id: 'move-by-speed', name: 'Keep moving at its speed', when: 'frame', category: 'Things',
  about: 'Every frame, moves the thing by its speed (see "Set how fast a thing moves").',
  params: { thing: { type: 'thing' } },
  generate(ctx, b) {
    const t = ctx.thing(b.thing); if (!t) return;
    ctx.op('A', `@${t.vx},@${t.x}`);
    ctx.op('A', `@${t.vy},@${t.y}`);
  }
};
