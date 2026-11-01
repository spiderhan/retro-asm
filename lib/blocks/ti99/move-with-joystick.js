'use strict';
module.exports = {
  id: 'move-with-joystick', name: 'Move with the joystick', when: 'frame', category: 'Controls',
  about: 'Left and right on joystick 1 slide the thing sideways. It stops at the two ends you choose.',
  params: { thing: { type: 'thing' }, speed: { type: 'number', default: 3 }, leftEnd: { type: 'number' }, rightEnd: { type: 'number' } },
  generate(ctx, b) {
    const t = ctx.thing(b.thing); if (!t) return;
    const s = b.speed || 3;
    const lt = ctx.label('NOL'), rt = ctx.label('NOR'), lo = ctx.label('OKL'), hi = ctx.label('OKH');
    ctx.op('LI', 'R12,>0024', 'Look at the keyboard column that holds joystick 1');
    ctx.op('LI', 'R1,>0600');
    ctx.op('LDCR', 'R1,3');
    ctx.op('LI', 'R12,>0006');
    ctx.op('STCR', 'R1,8', 'Read the 8 switches (0 means pressed)');
    ctx.op('INV', 'R1', 'Now 1 means pressed');
    ctx.op('MOV', `@${t.x},R2`);
    ctx.op('COC', `@KLEFT,R1`, 'Pushed left?');
    ctx.op('JNE', lt);
    ctx.op('AI', `R2,-${s}`);
    ctx.at(lt, 'COC', `@KRIGHT,R1`, 'Pushed right?');
    ctx.op('JNE', rt);
    ctx.op('AI', `R2,${s}`);
    ctx.at(rt, 'CI', `R2,${b.leftEnd}`, 'Keep it between the two ends');
    ctx.op('JGT', lo);
    ctx.op('LI', `R2,${b.leftEnd}`);
    ctx.at(lo, 'CI', `R2,${b.rightEnd}`);
    ctx.op('JLT', hi);
    ctx.op('LI', `R2,${b.rightEnd}`);
    ctx.at(hi, 'MOV', `R2,@${t.x}`);
    ctx.need('JOYBITS');
  }
};
