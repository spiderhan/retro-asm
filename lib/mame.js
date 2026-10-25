'use strict';
// Talking to MAME, so the TI-99/4A program can be stopped and stepped on a real emulated
// machine. Nothing in here knows about VS Code. It does three things:
//   1. makeScript: joins your program and settings to mame/ti99-bridge.lua (the script that runs
//      inside MAME),
//   2. mameArgs: the command line that starts MAME with that script,
//   3. MameLink: the connection to the script (send a line, get a line back, hear "stopped").
// This is a first proof, not a finished feature.

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const DEFAULT_PORT = 2161;

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

/**
 * The Lua text to give MAME: your settings first, then the bridge script.
 * The program is `blocks` ([{ addr, bytes }], one for each separate piece of code), or just `bytes` at `load`.
 */
function makeScript(opts) {
  const o = Object.assign({ port: DEFAULT_PORT, load: 0xA000, entry: null, wp: 0x8300, bootFrames: 400 }, opts);
  const blocks = (o.blocks || [{ addr: o.load, bytes: o.bytes }]).filter(b => b.bytes && b.bytes.length);
  if (!blocks.length) throw new Error('There is no program to load.');
  if (o.entry === null) o.entry = blocks[0].addr;
  const lua = blocks.map(b => `{ addr = ${b.addr | 0}, hex = "${toHex(b.bytes)}" }`).join(', ');
  const cfg = `local CONFIG = { port = ${o.port | 0}, entry = ${o.entry | 0}, ` +
    `wp = ${o.wp | 0}, bootFrames = ${o.bootFrames | 0}, blocks = { ${lua} } }\n`;
  return cfg + fs.readFileSync(path.join(__dirname, '..', 'mame', 'ti99-bridge.lua'), 'utf8');
}

/** The arguments for starting MAME. scriptPath is where makeScript's text was saved. */
function mameArgs(scriptPath, opts) {
  const o = opts || {};
  const a = ['ti99_4a', '-debug', '-window', '-skip_gameinfo'];
  if (o.rompath) a.push('-rompath', o.rompath);
  // The 32K memory card, so a program can live at >A000. (First try: the proof showed the card did
  // not seem to be there, so this may need changing.)
  if (o.memoryCard !== false) a.push('-ioport', 'peb', '-ioport:peb:slot2', '32kmem');
  a.push('-autoboot_script', scriptPath);
  return a;
}

/** One connection to the script inside MAME. */
class MameLink extends EventEmitter {
  constructor(port) {
    super();
    this.port = port || DEFAULT_PORT;
    this.sock = null;
    this.buf = '';
    this.waiting = [];     // replies we are waiting for, oldest first
    this.events = [];      // "stopped" lines nobody has asked for yet
  }

  /** Connect, trying again for a while: MAME takes a few seconds to start listening. */
  connect(seconds) {
    const until = Date.now() + (seconds || 30) * 1000;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const s = net.connect(this.port, '127.0.0.1');
        s.setEncoding('utf8');
        s.once('connect', () => { this.sock = s; s.on('data', d => this._data(d)); s.on('close', () => this.emit('closed')); resolve(); });
        s.once('error', () => {
          s.destroy();
          if (Date.now() > until) reject(new Error('Could not connect to MAME on port ' + this.port + '.'));
          else setTimeout(attempt, 500);
        });
      };
      attempt();
    });
  }

  _data(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this._line(line);
    }
  }

  _line(line) {
    if (/^(ok|regs|mem|probe)\b/.test(line)) {
      const w = this.waiting.shift();
      if (w) w.resolve(line);
    } else if (/^err\b/.test(line)) {
      const w = this.waiting.shift();
      if (w) w.reject(new Error(line.slice(4))); else this.emit('error-line', line.slice(4));
    } else if (/^stopped\b/.test(line)) {
      this.events.push(parseInt(line.split(/\s+/)[1], 16));
      this.emit('stopped');
    }
  }

  /** Send a command line and wait for its one-line reply. */
  ask(line, seconds) {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      this.waiting.push(w);
      this.sock.write(line + '\n');
      const t = setTimeout(() => reject(new Error('MAME did not answer "' + line + '".')), (seconds || 10) * 1000);
      const done = () => clearTimeout(t);
      const r = w.resolve, j = w.reject;
      w.resolve = v => { done(); r(v); };
      w.reject = e => { done(); j(e); };
    });
  }

  /** Wait until the program stops; gives the address it stopped at. */
  stopped(seconds) {
    if (this.events.length) return Promise.resolve(this.events.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.removeListener('stopped', on); reject(new Error('The program did not stop in time.')); }, (seconds || 30) * 1000);
      const on = () => { clearTimeout(t); resolve(this.events.shift()); };
      this.once('stopped', on);
    });
  }

  async regs() {
    const line = await this.ask('regs');
    const out = {};
    for (const m of line.matchAll(/(\w+)=([0-9A-Fa-f]{4})/g)) out[m[1]] = parseInt(m[2], 16);
    return out;
  }

  async mem(addr, len) {
    const line = await this.ask('mem ' + addr.toString(16) + ' ' + len.toString(16));
    return Buffer.from(line.slice(4).trim(), 'hex');
  }

  setReg(name, value) { return this.ask('setreg ' + name + ' ' + (value & 0xFFFF).toString(16)); }
  poke(addr, buf) { return this.ask('poke ' + addr.toString(16) + ' ' + Buffer.from(buf).toString('hex')); }
  probe(addr) { return this.ask('probe ' + addr.toString(16)); }
  setBreak(addr) { return this.ask('bp ' + addr.toString(16)); }
  clearBreak(addr) { return this.ask('bpclr ' + addr.toString(16)); }
  step() { return this.ask('step'); }
  go() { return this.ask('go'); }
  pause() { return this.ask('pause'); }
  async quit() { try { await this.ask('quit', 3); } catch (e) { /* MAME closing is fine */ } if (this.sock) this.sock.destroy(); }
}

/**
 * Start MAME with the program loaded, and connect to it. `o`: { mamePath, rompath, blocks (or load and bytes), entry,
 * folder (a place for the script), port }. Gives { link, kill() }.
 */
async function startMame(o) {
  fs.mkdirSync(o.folder, { recursive: true });
  const scriptPath = path.join(o.folder, 'ti99-bridge-run.lua');
  fs.writeFileSync(scriptPath, makeScript({ port: o.port, load: o.load, entry: o.entry, bytes: o.bytes, blocks: o.blocks }));
  // MAME writes its settings into the folder it is started in: keep that beside MAME, not in your project
  const proc = spawn(o.mamePath, mameArgs(scriptPath, { rompath: o.rompath }), { cwd: path.dirname(o.mamePath), stdio: 'ignore' });
  let early = null;
  const exited = new Promise((resolve, reject) => {
    proc.once('error', (e) => { early = new Error('MAME could not be started: ' + e.message); reject(early); });
    proc.once('exit', (code) => { early = early || new Error('MAME closed straight away (code ' + code + '). The usual reason is a missing ti99_4a.zip in its roms folder.'); reject(early); });
  });
  exited.catch(() => {});
  const link = new MameLink(o.port);
  try { await Promise.race([link.connect(40), exited]); }
  catch (e) { try { proc.kill(); } catch (x) { /* gone already */ } throw early || e; }
  await link.ask('hello');      // the script waits for this before it lets the TI start up
  proc.removeAllListeners('exit');
  proc.once('exit', () => link.emit('closed'));
  return { link, kill() { try { proc.kill(); } catch (e) { /* gone already */ } } };
}

module.exports = { DEFAULT_PORT, toHex, makeScript, mameArgs, MameLink, startMame };
