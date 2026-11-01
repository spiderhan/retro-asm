'use strict';
module.exports = {
  id: 'if-touching', name: 'If two things touch', when: 'frame', category: 'Rules',
  about: 'Checks whether two things overlap. If they do, the blocks inside run.',
  params: { a: { type: 'thing' }, b: { type: 'thing' }, do: { type: 'blocks' } },
  generate(ctx, p) {
    const A = ctx.thing(p.a), B = ctx.thing(p.b); if (!A || !B) return;
    const no = ctx.label('NOHIT');
    const test = (pa, wa, pb, wb) => {
      const ok = ctx.label('HIT');
      ctx.op('MOV', `@${pb},R2`);
      ctx.op('AI', `R2,${wb}`);
      ctx.op('C', `R2,@${pa}`);
      ctx.op('JH', ok, 'Overlapping so far?');
      ctx.op('B', `@${no}`);
      ctx.at(ok, 'MOV', `@${pa},R2`);
      ctx.op('AI', `R2,${wa}`);
      const ok2 = ctx.label('HIT');
      ctx.op('C', `R2,@${pb}`);
      ctx.op('JH', ok2);
      ctx.op('B', `@${no}`);
      ctx.at(ok2, '', '');
    };
    test(A.x, A.w, B.x, B.w);
    test(A.y, A.h, B.y, B.h);
    ctx.children(p.do, 'frame');
    ctx.at(no, '', '');
  }
};
