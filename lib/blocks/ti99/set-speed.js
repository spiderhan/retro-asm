'use strict';
module.exports = {
  id: 'set-speed', name: 'Set how fast a thing moves', when: 'any', category: 'Things',
  about: 'Sets how many dots a thing moves each frame, across (negative = left) and down (negative = up).',
  params: { thing: { type: 'thing' }, across: { type: 'number', default: 0 }, down: { type: 'number', default: 0 } },
  generate(ctx, b) {
    const t = ctx.thing(b.thing); if (!t) return;
    ctx.op('LI', `R1,${b.across || 0}`);
    ctx.op('MOV', `R1,@${t.vx}`);
    ctx.op('LI', `R1,${b.down || 0}`);
    ctx.op('MOV', `R1,@${t.vy}`);
  }
};
