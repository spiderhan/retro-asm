'use strict';
module.exports = {
  id: 'if-no-tiles', name: 'If all the tiles are gone', when: 'frame', category: 'Tiles',
  about: 'Runs the blocks inside once the last tile of that kind has been hit. Put "Fill an area with tiles" inside to start a new wall.',
  params: { tile: { type: 'tile' }, do: { type: 'blocks' } },
  plan(ctx, b) { ctx.wantTileGroups(b.tile, 1); },
  generate(ctx, b) {
    const T = ctx.tile(b.tile); if (!T) return;
    ctx.variable(T.left, 0);
    const no = ctx.label('TILES'), yes = ctx.label('NOTILES');
    ctx.op('MOV', `@${T.left},@${T.left}`, 'Any tiles left?');
    ctx.op('JEQ', yes);
    ctx.op('B', `@${no}`);
    ctx.at(yes, '', '');
    ctx.children(b.do, 'frame');
    ctx.at(no, '', '');
  }
};
