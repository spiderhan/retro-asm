'use strict';
// Finding the programs a chip needs (an assembler, an emulator, and what runs them), and saying
// plainly what is missing and where to get it. Nothing in here knows about VS Code, and nothing
// in here runs a program: it only looks at what is on the disk.

const fs = require('fs');
const path = require('path');
const os = require('os');

function findUp(startDir, rel, levels) {
  let d = startDir;
  for (let i = 0; i <= levels; i++) {
    const p = path.join(d, rel);
    if (fs.existsSync(p)) return p;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

/** Look for a program in the folders on the PATH. Returns its full path or null. */
function onPath(name, platform, env) {
  const sep = (platform || process.platform) === 'win32' ? ';' : ':';
  for (const d of String((env || process.env).PATH || (env || process.env).Path || '').split(sep)) {
    if (!d) continue;
    if ((platform || process.platform) === 'win32' && /WindowsApps/i.test(d)) continue;   // the Store's empty stand-ins for python
    const p = path.join(d, name);
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* not here */ }
  }
  return null;
}

/** A Windows program name only makes sense on Windows (and the other way round). */
function nameFits(n, platform) {
  platform = platform || process.platform;
  return platform === 'win32' ? true : !/\.exe$/i.test(n);
}

/**
 * Look for any of `names` (file names only) inside `root` and the folders under it, down to `depth`
 * levels. A tools folder holds things like `xdt99-3.6.5-Windows/xas99.py`, with the version in the
 * name, so the exact folder can't be guessed. Stops after looking in `budget.n` folders.
 */
function scanFolder(root, names, depth, budget) {
  budget = budget || { n: 400 };
  const want = names.map(n => path.basename(n).toLowerCase());
  const queue = [[root, 0]];
  while (queue.length && budget.n > 0) {
    const [dir, level] = queue.shift();
    budget.n--;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) if (e.isFile() && want.includes(e.name.toLowerCase())) return path.join(dir, e.name);
    if (level < depth) for (const e of entries) if (e.isDirectory() && !/^(node_modules|\.git)$/i.test(e.name)) queue.push([path.join(dir, e.name), level + 1]);
  }
  return null;
}

/** The folder the extension looks in for tools you unpack yourself. */
function toolsFolder(setting, home) {
  let f = String(setting || '').trim();
  if (f.startsWith('~')) f = path.join(home || os.homedir(), f.slice(1));
  return f || path.join(home || os.homedir(), 'retro-asm-tools');
}

/** The usual places programs get installed, as [folder, depth] pairs. */
function standardDirs(platform, env, home) {
  env = env || process.env;
  home = home || os.homedir();
  const out = [];
  if (platform === 'win32') {
    for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) if (env[k]) out.push([env[k], 2]);
    if (env.LOCALAPPDATA) out.push([path.join(env.LOCALAPPDATA, 'Programs'), 2]);
    out.push([path.join(home, 'Downloads'), 2]);
    out.push(['C:\\', 1]);
  } else if (platform === 'darwin') {
    out.push(['/Applications', 3], ['/opt/homebrew/bin', 0], ['/usr/local/bin', 0], [path.join(home, 'Applications'), 3], [path.join(home, 'bin'), 0]);
  } else {
    out.push(['/usr/local/bin', 0], ['/usr/games', 0], ['/usr/bin', 0], ['/opt', 2], [path.join(home, 'bin'), 0], [path.join(home, '.local', 'bin'), 0]);
  }
  return out;
}

/**
 * Where is this tool? `spec` is { id, find: [names] } from a chip file. `ctx` says where to look:
 * { dir (the source's folder), platform, env, home, toolPaths: { id: path }, toolsFolder, standardDirs (for tests) }.
 * Looks, in this order: a file you chose, next to the source (and a few folders up), the tools
 * folder, the PATH, and the usual install folders. Returns { file, from, fromProject } or null.
 */
function locate(spec, ctx) {
  ctx = ctx || {};
  const platform = ctx.platform || process.platform;
  const names = (spec.find || []).filter(n => nameFits(n, platform));
  if (!names.length) return null;
  const chosen = ctx.toolPaths && spec.id && ctx.toolPaths[spec.id];
  if (chosen && fs.existsSync(chosen)) return { file: chosen, from: 'the file you chose in the settings', fromProject: false };
  // next to the source or a few folders up (full paths are tried as they are)
  for (const n of names) {
    if (path.isAbsolute(n) || /^[A-Za-z]:[\\/]/.test(n)) { if (platform === 'win32' && fs.existsSync(n)) return { file: n, from: 'a usual install folder', fromProject: false }; continue; }
    if (ctx.dir) { const p = findUp(ctx.dir, n, 4); if (p && fs.statSync(p).isFile()) return { file: p, from: 'next to your source', fromProject: true }; }
  }
  const plain = names.filter(n => !path.isAbsolute(n) && !/^[A-Za-z]:[\\/]/.test(n));
  if (ctx.toolsFolder) { const p = scanFolder(ctx.toolsFolder, plain, 3); if (p) return { file: p, from: 'your tools folder', fromProject: false }; }
  for (const n of plain) { if (n.includes('/') || n.includes('\\')) continue; const p = onPath(n, platform, ctx.env); if (p) return { file: p, from: 'your PATH', fromProject: false }; }
  const budget = { n: 300 };
  for (const [d, depth] of (ctx.standardDirs !== undefined ? ctx.standardDirs : standardDirs(platform, ctx.env, ctx.home))) {
    if (!fs.existsSync(d)) continue;
    const p = scanFolder(d, plain, depth, budget);
    if (p) return { file: p, from: 'a usual install folder', fromProject: false };
  }
  return null;
}

// What runs the assembler: xas99 is a Python script, KickAssembler is a Java program.
const RUNTIMES = {
  python: {
    id: 'python', name: 'Python', why: 'runs xas99',
    find: ['python.exe', 'python3', 'python', 'py.exe'],
    url: 'https://www.python.org/downloads/',
    get: 'Install Python 3 from python.org. On the first screen of the installer, tick "Add python.exe to PATH".'
  },
  java: {
    id: 'java', name: 'Java', why: 'runs KickAssembler',
    find: ['java.exe', 'java'],
    url: 'https://adoptium.net/',
    get: 'Install a Java runtime (version 11 or newer). The "Temurin" one from adoptium.net is free.'
  }
};

function javaLocate(ctx) {
  const env = ctx.env || process.env;
  const platform = ctx.platform || process.platform;
  if (env.JAVA_HOME) {
    const p = path.join(env.JAVA_HOME, 'bin', platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(p)) return { file: p, from: 'JAVA_HOME', fromProject: false };
  }
  const found = locate(RUNTIMES.java, Object.assign({}, ctx, { dir: null, toolsFolder: null }));
  if (found) return found;
  if (platform === 'win32') {
    for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
      const base = env[k];
      if (!base) continue;
      for (const v of ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'AdoptOpenJDK']) {
        const p = scanFolder(path.join(base, v), ['java.exe'], 3, { n: 80 });
        if (p) return { file: p, from: 'a usual install folder', fromProject: false };
      }
    }
  }
  return null;
}

function pythonLocate(ctx) {
  const platform = ctx.platform || process.platform;
  const found = locate(RUNTIMES.python, Object.assign({}, ctx, { dir: null, toolsFolder: null }));
  if (found) return found;
  const env = ctx.env || process.env;
  if (platform === 'win32' && env.LOCALAPPDATA) {
    const p = scanFolder(path.join(env.LOCALAPPDATA, 'Programs', 'Python'), ['python.exe'], 2, { n: 40 });
    if (p) return { file: p, from: 'a usual install folder', fromProject: false };
  }
  return null;
}

/** Find what runs a tool ('java' or 'python'), or null. */
function locateRuntime(kind, ctx) {
  ctx = ctx || {};
  return kind === 'java' ? javaLocate(ctx) : kind === 'python' ? pythonLocate(ctx) : null;
}

/** One plain sentence about a missing tool: what it is for, and what to do. */
function missingMessage(spec, ctx) {
  const folder = ctx && ctx.toolsFolder ? ctx.toolsFolder : toolsFolder('', ctx && ctx.home);
  const why = spec.why ? ` (${spec.why})` : '';
  return `${spec.name} wasn't found${why}. Run "Retro ASM: Set up tools" to see where to get it and to point to it, or unpack it into ${folder}.`;
}

/**
 * Everything a chip needs, and where each thing is. Returns a list of
 * { role: 'assembler' | 'emulator' | 'runtime', id, name, why, url, get, found, spec }.
 * `found` is { file, from } or null. Assembler first, then what runs it, then the emulator.
 */
function report(D, ctx) {
  const out = [];
  const b = (D && D.build) || {};
  const add = (role, spec) => out.push({ role, id: spec.id, name: spec.name, why: spec.why || '', url: spec.url || '', get: spec.get || '', found: locate(spec, ctx), spec });
  if (b.tool && b.tool.id) add('assembler', b.tool);
  if (b.tool && b.tool.needs && RUNTIMES[b.tool.needs]) {
    const r = RUNTIMES[b.tool.needs];
    out.push({ role: 'runtime', id: r.id, name: r.name, why: r.why, url: r.url, get: r.get, found: locateRuntime(r.id, ctx), spec: r });
  }
  if (b.run && b.run.id) add('emulator', b.run);
  return out;
}

module.exports = { findUp, onPath, nameFits, scanFolder, toolsFolder, standardDirs, locate, locateRuntime, missingMessage, report, RUNTIMES };
