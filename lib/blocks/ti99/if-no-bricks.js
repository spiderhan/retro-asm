'use strict';
module.exports = {
  id: 'if-no-bricks', name: 'If all the bricks are gone', when: 'frame', category: 'Bricks',
  about: 'Runs the blocks inside once the last brick has been hit. Put "Build a wall of bricks" inside to start a new wall.',
  params: { do: { type: 'blocks' } },
  generate(ctx, b) {
    ctx.variable('BRICKS', 0);
    const no = ctx.label('BRKS'), yes = ctx.label('NOBRKS');
    ctx.op('MOV', '@BRICKS,@BRICKS', 'Any bricks left?');
    ctx.op('JEQ', yes);
    ctx.op('B', `@${no}`);
    ctx.at(yes, '', '');
    ctx.children(b.do, 'frame');
    ctx.at(no, '', '');
  }
};
