'use strict';
module.exports = {
  id: 'if-below', name: 'If a thing goes past the bottom', when: 'frame', category: 'Rules',
  about: 'Checks whether a thing has gone lower than a line on the screen. If so, the blocks inside run.',
  params: { thing: { type: 'thing' }, line: { type: 'number' }, do: { type: 'blocks' } },
  generate(ctx, p) {
    const t = ctx.thing(p.thing); if (!t) return;
    const no = ctx.label('NOLOW'), low = ctx.label('LOW');
    ctx.op('MOV', `@${t.y},R1`);
    ctx.op('CI', `R1,${p.line}`, 'Lower than the line?');
    ctx.op('JGT', low);
    ctx.op('B', `@${no}`, 'No: skip the blocks inside (a far jump, so they can be as long as you like)');
    ctx.at(low, '', '');
    ctx.children(p.do, 'frame');
    ctx.at(no, '', '');
  }
};
