'use strict';
module.exports = {
  id: 'if-hits-brick', name: 'If a thing hits a brick', when: 'frame', category: 'Bricks',
  about: 'Looks at the brick tile under the middle of the thing. If there is one, the whole brick is rubbed out, the thing bounces up or down, and the blocks inside run (for the score and a sound).',
  params: { thing: { type: 'thing' }, do: { type: 'blocks' } },
  generate(ctx, b) {
    const t = ctx.thing(b.thing); if (!t) return;
    ctx.variable('BRICKS', 0);
    ctx.need('VSBR'); ctx.need('VSBW');
    const no = ctx.label('NOBRK'), inr = ctx.label('INSCR'), yes = ctx.label('BRK');
    ctx.op('MOV', `@${t.x},R0`);
    ctx.op('AI', 'R0,4', 'Middle of the thing');
    ctx.op('SRL', 'R0,3', 'Across, in tiles (8 dots each)');
    ctx.op('MOV', `@${t.y},R1`);
    ctx.op('AI', 'R1,5');
    ctx.op('SRL', 'R1,3', 'Down, in tiles');
    ctx.op('SLA', 'R1,5', 'Down x 32');
    ctx.op('A', 'R1,R0', 'Screen position');
    ctx.op('CI', 'R0,768');
    ctx.op('JL', inr, 'Still on the screen?');
    ctx.op('B', `@${no}`);
    ctx.at(inr, 'MOV', 'R0,R4', 'Remember where');
    ctx.op('BL', '@VSBR', 'Which tile is there?');
    ctx.op('SRL', 'R1,8');
    ctx.op('AI', 'R1,-96', 'Brick tiles are 96 to 175');
    ctx.op('CI', 'R1,80');
    ctx.op('JL', yes, 'A brick?');
    ctx.op('B', `@${no}`);
    const left = ctx.label('LEFTHALF'), gone = ctx.label('RUBOUT');
    ctx.at(yes, 'MOV', 'R4,R5');
    ctx.op('ANDI', 'R1,1', 'Even tile = left half of a brick, odd = right half');
    ctx.op('JEQ', left);
    ctx.op('DEC', 'R5', 'Right half: the other half is on its left');
    ctx.op('JMP', gone);
    ctx.at(left, 'INC', 'R5', 'Left half: the other half is on its right');
    ctx.at(gone, 'MOV', 'R4,R0', 'Rub out both halves (a space)');
    ctx.op('LI', 'R1,>2000');
    ctx.op('BL', '@VSBW');
    ctx.op('MOV', 'R5,R0');
    ctx.op('LI', 'R1,>2000');
    ctx.op('BL', '@VSBW');
    ctx.op('DEC', '@BRICKS');
    ctx.op('NEG', `@${t.vy}`, 'Bounce');
    ctx.children(b.do, 'frame');
    ctx.at(no, '', '');
  }
};
