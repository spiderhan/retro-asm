'use strict';
module.exports = {
  id: 'play-sound', name: 'Play a sound', when: 'any', category: 'Sound',
  about: 'Starts one of the sounds in your file (a block marked @sound).',
  params: { sound: { type: 'label' } },
  generate(ctx, b) {
    ctx.variable('SNDPTR', 0); ctx.variable('SNDWT', 0);
    ctx.need('SOUND');
    ctx.op('LI', `R1,${b.sound}`);
    ctx.op('MOV', 'R1,@SNDPTR');
    ctx.op('CLR', '@SNDWT');
  }
};
