'use strict';
module.exports = {
  id: 'screen-colour', name: 'Set the screen colour', when: 'start', category: 'Setup',
  about: 'Sets the colour of the screen behind everything else (pick any colour except see-through).',
  params: { colour: { type: 'colour', default: 1, min: 1, max: 15 } },
  generate(ctx, b) {
    const c = ((b.colour === undefined ? 1 : b.colour) & 15).toString(16).toUpperCase();
    ctx.op('LI', `R0,>07${'0' + c}`, 'Register 7: the screen colour');
    ctx.op('BL', '@VWREG');
  }
};
