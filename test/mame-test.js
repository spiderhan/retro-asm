'use strict';
// Tests for lib/mame.js: node test/mame-test.js (ext-test.js runs it too).
// No MAME is needed: a pretend MAME (a small server that answers the same lines) stands in.
const net = require('net');
const M = require('../lib/mame');
let fails = 0;
const ok = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };

(async () => {
  // --- the script text and the command line ---
  const s = M.makeScript({ bytes: [0x02, 0x00, 0x12, 0x34], load: 0xA000, port: 3456 });
  ok('script starts with the settings', /^local CONFIG = \{ port = 3456, entry = 40960,/.test(s), s.slice(0, 120));
  ok('the program bytes are in the settings', s.includes('{ addr = 40960, hex = "02001234" }'));
  const two = M.makeScript({ blocks: [{ addr: 0x2000, bytes: [1, 2] }, { addr: 0xA000, bytes: [3] }], port: 3456 });
  ok('several separate blocks each get their own address', two.includes('{ addr = 8192, hex = "0102" }, { addr = 40960, hex = "03" }') && /entry = 8192,/.test(two), two.slice(0, 160));
  ok('the bridge script follows', s.includes('emu.register_periodic'));
  let threw = false; try { M.makeScript({ bytes: [] }); } catch (e) { threw = /no program/.test(e.message); }
  ok('an empty program is refused in plain words', threw);
  const a = M.mameArgs('x.lua', { rompath: 'R' });
  ok('MAME is started with -debug and the script', a.includes('-debug') && a.join(' ').includes('-autoboot_script x.lua') && a.includes('ti99_4a'), a);
  ok('the ROM folder is passed on', a.join(' ').includes('-rompath R'));

  // --- the link, against a pretend MAME ---
  const server = net.createServer(c => {
    c.setEncoding('utf8');
    let buf = '';
    c.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 1);
        if (l === 'hello') c.write('ok\n');
        else if (l === 'regs') c.write('regs PC=A008 WP=8300 ST=0000 R0=1234 R1=0005\n');
        else if (l.startsWith('mem ')) c.write('mem 0200123402\n');
        else if (l === 'go') { c.write('ok\n'); setTimeout(() => c.write('stopped A008\n'), 20); }
        else if (l === 'bad') c.write('err something plain\n');
        else c.write('ok\n');
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const link = new M.MameLink(server.address().port);
  await link.connect(5);
  ok('hello is answered', (await link.ask('hello')) === 'ok');
  const r = await link.regs();
  ok('registers come back as numbers', r.PC === 0xA008 && r.R0 === 0x1234 && r.R1 === 5 && r.WP === 0x8300, r);
  const m = await link.mem(0xA000, 5);
  ok('memory comes back as bytes', m.length === 5 && m[2] === 0x12, [...m]);
  await link.go();
  ok('a stop is heard after go', (await link.stopped(3)) === 0xA008);
  let msg = ''; try { await link.ask('bad'); } catch (e) { msg = e.message; }
  ok('an err line becomes an error with the plain words', msg === 'something plain', msg);
  let gaveUp = false;
  try { await new M.MameLink(1).connect(1); } catch (e) { gaveUp = /Could not connect/.test(e.message); }
  ok('no MAME running gives a plain message', gaveUp);
  link.sock.destroy(); server.close();
  console.log(fails ? fails + ' problem(s).' : 'All good.');
  process.exit(fails ? 1 : 0);
})();
