'use strict';
module.exports = {
  id: 'bounce-off-walls', name: 'Bounce off the walls', when: 'frame', category: 'Things',
  about: 'If the thing reaches the left, right or top wall, it bounces back (it turns round and stays inside).',
  params: { thing: { type: 'thing' }, left: { type: 'number' }, right: { type: 'number' }, top: { type: 'number' } },
  generate(ctx, b) {
    const t = ctx.thing(b.thing); if (!t) return;
    const a = ctx.label('BW'), c = ctx.label('BW'), d = ctx.label('BW');
    ctx.op('MOV', `@${t.x},R1`);
    ctx.op('CI', `R1,${b.left}`, 'Past the left wall?');
    ctx.op('JGT', a);
    ctx.op('LI', `R1,${b.left}`);
    ctx.op('MOV', `R1,@${t.x}`);
    ctx.op('NEG', `@${t.vx}`);
    ctx.at(a, 'MOV', `@${t.x},R1`);
    ctx.op('CI', `R1,${b.right}`, 'Past the right wall?');
    ctx.op('JLT', c);
    ctx.op('LI', `R1,${b.right}`);
    ctx.op('MOV', `R1,@${t.x}`);
    ctx.op('NEG', `@${t.vx}`);
    ctx.at(c, 'MOV', `@${t.y},R1`);
    ctx.op('CI', `R1,${b.top}`, 'Past the top?');
    ctx.op('JGT', d);
    ctx.op('LI', `R1,${b.top}`);
    ctx.op('MOV', `R1,@${t.y}`);
    ctx.op('NEG', `@${t.vy}`);
    ctx.at(d, '', '');
  }
};
