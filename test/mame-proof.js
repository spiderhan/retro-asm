'use strict';
// A first try at stepping a TI-99/4A program in a real emulated machine (MAME).
// Run it yourself:   node test/mame-proof.js "C:\path\to\mame.exe" [folder-with-the-TI-ROMs] [--load=8320] [--no-card]
// (--load=8320 puts the program in the console's own small memory instead of the 32K card;
//  --no-card starts MAME without the memory card option.)
// MAME needs the TI-99/4A console ROM files (the "ti99_4a" set) in its roms folder, or in the
// folder you give as the second argument. They are not included with this extension.
//
// The program is 4 made-up instructions, put at >A000 (or where --load says; the A000 below is just the usual):
//   A000  LI  R0,>1234
//   A004  LI  R1,>0005
//   A008  A   R1,R0
//   A00A  JMP $
// What should happen: stop at A000; run to the breakpoint at A008 (R0 is >1234, R1 is >0005);
// step once, and now R0 is >1239 and the next instruction is A00A.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const M = require('../lib/mame');

const program = [0x02, 0x00, 0x12, 0x34, 0x02, 0x01, 0x00, 0x05, 0xA0, 0x01, 0x10, 0xFF];
const plain = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [mamePath, romPath] = plain;
const loadArg = process.argv.find(a => a.startsWith('--load='));
const L = loadArg ? parseInt(loadArg.slice(7), 16) : 0xA000;
const noCard = process.argv.includes('--no-card');
if (!mamePath) { console.log('Usage: node test/mame-proof.js <path to mame> [<folder with the TI ROMs>]'); process.exit(2); }

let fails = 0;
const check = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
const hex = v => '>' + v.toString(16).toUpperCase().padStart(4, '0');

async function whereAmI(link, why) {
  console.log('  (' + why + '; pausing to see where the chip is...)');
  try {
    await link.pause();
    const pc = await link.stopped(8).catch(() => null);
    const r = await link.regs();
    console.log('  paused at', pc === null ? '(no stop reported)' : hex(pc), 'registers:', JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, hex(v)]))));
  } catch (e) { console.log('  could not pause:', e.message); }
}

(async () => {
  const script = path.join(os.tmpdir(), 'retro-asm-ti99-proof.lua');
  fs.writeFileSync(script, M.makeScript({ bytes: program, load: L }));
  const args = M.mameArgs(script, { rompath: romPath, memoryCard: !noCard });
  console.log('Starting MAME:', mamePath, args.join(' '));
  const proc = spawn(mamePath, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: path.dirname(mamePath) });   // MAME keeps its own settings files beside itself
  let said = '';
  proc.stdout.on('data', d => said += d); proc.stderr.on('data', d => said += d);
  proc.on('exit', code => { if (code) console.log('MAME stopped with code', code, '\n' + said.slice(-1500)); });

  const link = new M.MameLink();
  link.on('error-line', l => console.log('MAME script says:', l));
  try {
    await link.connect(40);
    await link.ask('hello');
    console.log('Connected. Waiting for the TI to start up and for the program to be loaded...');
    const first = await link.stopped(60);
    check('stops at the first instruction', first === L, hex(first));
    if (process.argv.includes('--probe')) {
      // Diagnostic only: shows which ways of reading and writing memory work in this MAME.
      for (const a of [0x0000, 0x8320, 0xA000]) console.log('probe >' + a.toString(16).toUpperCase().padStart(4, '0') + ':\n  ' + (await link.probe(a)).slice(6).split(' ').join('\n  '));
      await link.quit(); setTimeout(() => process.exit(0), 1000); return;
    }
    if (process.argv.includes('--explore')) {
      // Diagnostic only: stop at a known place in the console ROM and see how the chip behaves.
      const show = async label => { const r = await link.regs(); const w = await link.mem(r.PC, 4); console.log('  ' + label.padEnd(30), 'PC', hex(r.PC), 'IR', hex(r.IR), 'WP', hex(r.WP), 'next words', w.toString('hex')); };
      await show('stopped by the extension:');
      for (const spot of [0x0954, 0x0950, 0x0970]) {
        await link.setBreak(spot); await link.go();
        let at = null; try { at = await link.stopped(15); } catch (e) { /* not reached */ }
        console.log('breakpoint at ' + hex(spot) + ': ' + (at === null ? 'never reached' : 'stopped at ' + hex(at)));
        if (at !== null) { await show('at the breakpoint:'); await link.step(); await link.stopped(5).catch(() => null); await show('after one step:'); await link.step(); await link.stopped(5).catch(() => null); await show('after two steps:'); }
        await link.clearBreak(spot);
        if (at === null) await link.pause().then(() => link.stopped(5)).catch(() => null);
      }
      await link.quit(); setTimeout(() => process.exit(0), 1000); return;
    }
    const mem = await link.mem(L, program.length);
    check('the program is in memory', mem.equals(Buffer.from(program)), 'reads back as ' + mem.toString('hex'));
    if (!mem.equals(Buffer.from(program))) console.log('  (memory at that address did not keep the program; try --load=8320)');
    // 1. one plain step first, so we know the chip really runs from the new start point
    await link.step();
    let at; try { at = await link.stopped(10); } catch (e) { at = null; }
    if (at === null) await whereAmI(link, 'a single step did not report a stop');
    check('one step from the start lands on the second instruction', at === L + 4, at === null ? 'no stop' : hex(at));
    let r = await link.regs();
    check('R0 is >1234 after the first instruction', r.R0 === 0x1234, r);
    // 2. now the breakpoint
    await link.setBreak(L + 8);
    await link.go();
    let hit; try { hit = await link.stopped(15); } catch (e) { hit = null; }
    if (hit === null) await whereAmI(link, 'the program did not stop at the breakpoint');
    check('the breakpoint stops at the third instruction', hit === L + 8, hit === null ? 'no stop' : hex(hit));
    r = await link.regs();
    check('R0 is >1234 and R1 is >0005 at the breakpoint', r.R0 === 0x1234 && r.R1 === 0x0005, r);
    // 3. step over the add
    await link.step();
    let next; try { next = await link.stopped(10); } catch (e) { next = null; }
    check('one more step lands on the fourth instruction', next === L + 10, next === null ? 'no stop' : hex(next));
    r = await link.regs();
    check('R0 is now >1239', r.R0 === 0x1239, r);
  } catch (e) {
    fails++; console.log('FAIL', e.message); console.log(said.slice(-1500));
  }
  await link.quit();
  setTimeout(() => { proc.kill(); console.log(fails ? fails + ' problem(s).' : 'All good.'); process.exit(fails ? 1 : 0); }, 1500);
})();
