'use strict';
const { overlap } = require('./if-touching');

// How fast a thing moves along each line after a bounce, for the angle choices (dots per frame).
const ANGLES = { steep: { x: 1, y: 3 }, normal: { x: 2, y: 2 }, flat: { x: 3, y: 1 } };

module.exports = {
  id: 'when-things-hit', name: 'When one thing hits another', when: 'frame', category: 'Rules',
  about: 'Checks whether two things touch. If they do, the first one bounces off, is destroyed, or stops, and then the blocks inside run (for the score and a sound). When it bounces you choose which way it goes and at what angle.',
  params: {
    thing: { type: 'thing', about: 'The thing that moves (for example the ball)' },
    other: { type: 'thing', about: 'The thing it hits (for example the bat)' },
    then: {
      type: 'choice', default: 'bounce', about: 'What happens when they touch',
      options: [['bounce', 'Bounce off it'], ['destroy', 'It is destroyed'], ['destroy-other', 'The other one is destroyed'], ['stop', 'It stops'], ['nothing', 'Nothing (just run the blocks inside)']]
    },
    way: {
      type: 'choice', default: 'up', showWhen: { then: 'bounce' }, about: 'Which way it goes after the bounce',
      options: [['up', 'Up (off something below it)'], ['down', 'Down (off something above it)'], ['left', 'Left (off something on its right)'], ['right', 'Right (off something on its left)'], ['back', 'Straight back the way it came']]
    },
    angle: {
      type: 'choice', default: 'keep', showWhen: { then: 'bounce' }, about: 'How steeply it goes after the bounce',
      options: [['keep', 'Keep the angle it had'], ['steep', 'Steep (mostly up and down)'], ['normal', 'Diagonal'], ['flat', 'Flat (mostly sideways)'], ['where', 'Depends where it hit (the edges send it sideways)']]
    },
    do: { type: 'blocks' }
  },
  generate(ctx, p) {
    const T = ctx.thing(p.thing), O = ctx.thing(p.other); if (!T || !O) return;
    if (p.thing === p.other) return ctx.problem('"When one thing hits another" needs two different things.');
    const no = ctx.label('NOHIT');
    overlap(ctx, T, O, no);
    const then = p.then || 'bounce';
    if (then === 'bounce') {
      const way = p.way || 'up', angle = p.angle || 'keep';
      // 1. which way: turn the speed round (ABS makes it positive, NEG then makes it negative)
      if (way === 'up') { ctx.op('ABS', `@${T.vy}`); ctx.op('NEG', `@${T.vy}`, 'Going up'); }
      else if (way === 'down') ctx.op('ABS', `@${T.vy}`, 'Going down');
      else if (way === 'left') { ctx.op('ABS', `@${T.vx}`); ctx.op('NEG', `@${T.vx}`, 'Going left'); }
      else if (way === 'right') ctx.op('ABS', `@${T.vx}`, 'Going right');
      else { ctx.op('NEG', `@${T.vx}`, 'Straight back'); ctx.op('NEG', `@${T.vy}`); }
      // 2. how steeply
      const keepSign = (v, mag) => {         // set the speed to `mag`, going the way it already goes (standing still counts as the positive way)
        const neg = ctx.label('NEG'), done = ctx.label('SET');
        ctx.op('MOV', `@${v},R1`);
        ctx.op('JLT', neg);
        ctx.op('LI', `R1,${mag}`);
        ctx.op('JMP', done);
        ctx.at(neg, 'LI', `R1,${-mag}`);
        ctx.at(done, 'MOV', `R1,@${v}`);
      };
      if (ANGLES[angle]) { keepSign(T.vx, ANGLES[angle].x); keepSign(T.vy, ANGLES[angle].y); }
      else if (angle === 'where') {
        const side = way === 'left' || way === 'right';        // for a side hit the answer is how far up or down it hit
        const [tp, tl, op, ol, tv] = side ? [T.y, T.h, O.y, O.h, T.vy] : [T.x, T.w, O.x, O.w, T.vx];
        const lo = ctx.label('WLO'), hi = ctx.label('WHI');
        ctx.op('MOV', `@${tp},R1`);
        ctx.op('AI', `R1,${Math.floor(tl / 2)}`, 'Middle of the thing');
        ctx.op('MOV', `@${op},R2`);
        ctx.op('AI', `R2,${Math.floor(ol / 2)}`, 'Middle of what it hit');
        ctx.op('S', 'R2,R1', 'How far off the middle');
        ctx.op('SRA', 'R1,2', 'A quarter of that is the sideways speed');
        ctx.op('CI', 'R1,3');
        ctx.op('JLT', lo);
        ctx.op('JEQ', lo);
        ctx.op('LI', 'R1,3', 'At most 3');
        ctx.at(lo, 'CI', 'R1,-3');
        ctx.op('JGT', hi);
        ctx.op('JEQ', hi);
        ctx.op('LI', 'R1,-3', 'At least -3');
        ctx.at(hi, 'MOV', `R1,@${tv}`);
      }
      // 3. step out of the other thing, so it is not hit again next frame
      if (way === 'up') { ctx.op('MOV', `@${O.y},R1`); ctx.op('AI', `R1,${-T.h}`); ctx.op('MOV', `R1,@${T.y}`, 'Just above it'); }
      else if (way === 'down') { ctx.op('MOV', `@${O.y},R1`); ctx.op('AI', `R1,${O.h}`); ctx.op('MOV', `R1,@${T.y}`, 'Just below it'); }
      else if (way === 'left') { ctx.op('MOV', `@${O.x},R1`); ctx.op('AI', `R1,${-T.w}`); ctx.op('MOV', `R1,@${T.x}`, 'Just to its left'); }
      else if (way === 'right') { ctx.op('MOV', `@${O.x},R1`); ctx.op('AI', `R1,${O.w}`); ctx.op('MOV', `R1,@${T.x}`, 'Just to its right'); }
    } else if (then === 'destroy' || then === 'destroy-other') {
      const X = then === 'destroy' ? T : O;
      ctx.op('CLR', `@${X.x}`, 'Gone: parked below the bottom of the screen');
      ctx.op('LI', 'R1,200');
      ctx.op('MOV', `R1,@${X.y}`);
      ctx.op('CLR', `@${X.vx}`);
      ctx.op('CLR', `@${X.vy}`);
    } else if (then === 'stop') {
      ctx.op('CLR', `@${T.vx}`);
      ctx.op('CLR', `@${T.vy}`);
    }
    ctx.children(p.do, 'frame');
    ctx.at(no, '', '');
  }
};
