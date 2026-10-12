'use strict';
// Building: work out which command to run, run it, and turn the assembler's messages
// into a list of { file, line, severity, message }. Nothing in here knows about VS Code.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

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

/** TI file names: capitals, at most 10 characters, no dots. */
function tiName(file) {
  return path.basename(file, path.extname(file)).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 10) || 'PROGRAM';
}

/**
 * Characters that could end the quotes around a file name and add a command of their own:
 * quote marks, backticks and $ (Mac and Linux), % (Windows), and line breaks. Windows doesn't allow
 * " in file names, but Mac and Linux do. Returns the first one found, or null.
 */
function unsafeChar(text) {
  const m = /["`$%\r\n]/.exec(String(text || ''));
  return m ? m[0] : null;
}

/**
 * Decide how to build. `rootFile` is the main source file (the one that COPYs the rest).
 * Returns { command, cwd, how } or { error }.
 */
/** Look for a program in the folders on the PATH. Returns its full path or null. */
function onPath(name, platform) {
  const sep = (platform || process.platform) === 'win32' ? ';' : ':';
  for (const d of String(process.env.PATH || '').split(sep)) {
    if (!d) continue;
    const p = path.join(d, name);
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* not here */ }
  }
  return null;
}

/**
 * The assembler or emulator a chip file names (build.tool.find / build.run.find): next to the
 * source or a few folders up, at a full path, or on the PATH. Returns { file, fromProject } or null.
 */
function findTool(dir, names, platform) {
  platform = platform || process.platform;
  const fits = (n) => platform === 'win32' ? /\.exe$/i.test(n) || !/\.\w+$/.test(n) : !/\.exe$/i.test(n);
  for (const n of names || []) {
    if (!fits(n)) continue;
    if (path.isAbsolute(n) || /^[A-Za-z]:[\\/]/.test(n)) { if (platform === 'win32' && fs.existsSync(n)) return { file: n, fromProject: false }; continue; }
    const p = findUp(dir, n, 4);
    if (p && fs.statSync(p).isFile()) return { file: p, fromProject: true };
  }
  for (const n of names || []) {
    if (!fits(n) || n.includes('/') || n.includes('\\')) continue;
    const p = onPath(n, platform);
    if (p) return { file: p, fromProject: false };
  }
  return null;
}

function plan(rootFile, settings, platform, D, info) {
  platform = platform || process.platform;
  const dir = path.dirname(rootFile);
  const vars = {
    file: rootFile,
    fileDirname: dir,
    fileBasename: path.basename(rootFile),
    fileBasenameNoExtension: path.basename(rootFile, path.extname(rootFile)),
    name: tiName(rootFile),
    workspaceFolder: settings.workspaceFolder || dir
  };
  const bad = unsafeChar(rootFile) || unsafeChar(settings.workspaceFolder);
  if (bad) return { error: `The file's name or folder contains ${bad === '\n' || bad === '\r' ? 'a line break' : bad}, which can't be passed safely to a build command. Rename it (or the folder) and build again.` };
  const fill = (s) => s.replace(/\$\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));

  if (settings.command && settings.command.trim()) return { command: fill(settings.command), cwd: dir, how: 'your build command (from the settings)' };

  // a build script next to the source (or a few folders up) wins
  const script = platform === 'win32' ? (findUp(dir, 'build.bat', 3) || findUp(dir, 'build.cmd', 3)) : findUp(dir, 'build.sh', 3);
  if (script) {
    if (unsafeChar(script)) return { error: `The path to ${path.basename(script)} contains a character that can't be passed safely to a command. Rename the folder and build again.` };
    const cwd = path.dirname(script);
    const command = platform === 'win32' ? `"${script}"` : `sh "${script}"`;
    return { command, cwd, how: path.basename(script), fromProject: true };
  }

  // the chip file names its assembler (BeebAsm for the BBC Micro): find it and fill in its command
  if (D && D.build && D.build.tool) {
    const t = D.build.tool;
    const found = findTool(dir, t.find, platform);
    if (found) {
      if (unsafeChar(found.file)) return { error: `The path to ${path.basename(found.file)} contains a character that can't be passed safely to a command. Move it, or set "retroAsm.build.command".` };
      const save = info && info.saveName && !unsafeChar(info.saveName) ? info.saveName : '';
      vars.tool = found.file;
      vars.saveName = save;
      const boot = save && t.boot ? fill(t.boot) : '';
      const command = fill(t.command.replace('${boot}', boot));
      return { command, cwd: dir, how: t.name || path.basename(found.file), fromProject: found.fromProject, note: save || !t.boot ? '' : 'There is no SAVE line with a name in quotes, so the disc won\'t start a program by itself (and BeebAsm only puts on the disc what a SAVE line asks for).' };
    }
  }

  // a chip whose assembler isn't xas99 (the chip file says how to set it up)
  if (D && D.build && D.build.hint) return { error: D.build.hint };

  // otherwise run xas99 directly, if we can find it
  const xasSet = !!(settings.xas99Path && settings.xas99Path.trim());
  let xas = xasSet ? settings.xas99Path.trim() : (findUp(dir, path.join('xdt99', 'xas99.py'), 4) || findUp(dir, 'xas99.py', 2));
  if (!xas) return { error: 'No build.bat was found next to this file, and xas99.py could not be found either. Set "retroAsm.build.command" (or "retroAsm.build.xas99Path") in the settings.' };
  if (unsafeChar(xas)) return { error: 'The path to xas99.py contains a character that can\'t be passed safely to a command. Move it, or set "retroAsm.build.command".' };
  const py = settings.python || (platform === 'win32' ? 'python' : 'python3');
  const xdm = path.join(path.dirname(xas), 'xdm99.py');
  let command = `${py} "${xas}" -R "${vars.fileBasename}" -o "${vars.name}.obj"`;
  if (fs.existsSync(xdm)) command += ` && ${py} "${xdm}" -T "${vars.name}.obj" -f DF80 -n ${vars.name} -o "${vars.name}"`;
  return { command, cwd: dir, how: 'xas99', fromProject: !xasSet };
}

/**
 * Read assembler output. xas99 writes two lines per problem:
 *   > game.a99 <2> 0123 - the source line
 *   ***** Error: Unknown symbol: NOPE
 * Returns [{ file, line (0-based, or -1 for "whole program"), severity, message }].
 */
function parseOutput(text, cwd) {
  const out = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  let where = null;
  for (const l of lines) {
    let m = /^>\s+(.+?)\s+<\d+>\s+(\d+|\*+)\s+-/.exec(l);
    if (m) { where = { file: path.resolve(cwd, m[1]), line: /^\d+$/.test(m[2]) ? parseInt(m[2], 10) - 1 : -1 }; continue; }
    m = /^\*{3,}\s*(Error|Warning)\s*:\s*(.*)$/i.exec(l);
    if (m && where) {
      const item = { file: where.file, line: where.line, severity: m[1].toLowerCase(), message: m[2].trim() };
      const key = `${item.file}|${item.line}|${item.message}`;
      if (!seen.has(key)) { seen.add(key); out.push(item); }   // xas99 reports some errors once per pass
      where = null;
      continue;
    }
    // KickAssembler: "(C:\\code\\game.asm 12:9) Error: Unknown symbol 'foo'"
    m = /^\s*\((.+?\.\w+)\s+(\d+):(\d+)\)\s*(Error|Warning)?\s*:?\s*(.+)$/i.exec(l);
    if (m) {
      const item = { file: path.resolve(cwd, m[1]), line: parseInt(m[2], 10) - 1, severity: (m[4] || 'error').toLowerCase(), message: m[5].trim() };
      const key = `${item.file}|${item.line}|${item.message}`;
      if (!seen.has(key)) { seen.add(key); out.push(item); }
      continue;
    }
    // the common "file:line: message" shape, for other assemblers
    m = /^(.+?\.\w+)[:(](\d+)\)?:\s*(?:(error|warning)\s*:?\s*)?(.+)$/i.exec(l);
    if (m && fs.existsSync(path.resolve(cwd, m[1]))) out.push({ file: path.resolve(cwd, m[1]), line: parseInt(m[2], 10) - 1, severity: (m[3] || 'error').toLowerCase(), message: m[4].trim() });
  }
  return out;
}

/** Run the build. Calls onText with output as it arrives. Resolves { code, text, problems }. */
function run(planned, onText) {
  return new Promise((resolve) => {
    let text = '';
    let child;
    try { child = cp.spawn(planned.command, { cwd: planned.cwd, shell: true, windowsHide: true }); }
    catch (e) { resolve({ code: -1, text: String(e.message), problems: [] }); return; }
    const take = (b) => { const s = b.toString(); text += s; if (onText) onText(s); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => { text += '\n' + e.message; resolve({ code: -1, text, problems: parseOutput(text, planned.cwd) }); });
    child.on('close', (code) => resolve({ code, text, problems: parseOutput(text, planned.cwd) }));
  });
}

/** Find the emulator to start after a build: { command, cwd, exe } or null. */
function findRunner(rootFile, settings, platform, D) {
  platform = platform || process.platform;
  if (settings.runCommand && settings.runCommand.trim()) {
    const cmd = settings.runCommand.trim();
    const q = /^"([^"]+)"/.exec(cmd);                       // "C:\Program Files\Classic99\classic99.exe" ...
    const prog = q ? q[1] : cmd.split(/\s+/)[0];
    return { command: cmd, cwd: path.dirname(rootFile), exe: path.basename(prog.replace(/\\/g, '/')) };
  }
  // an emulator the chip file names (BeebEm for the BBC Micro), started with the disc image
  if (D && D.build && D.build.run) {
    const r = D.build.run;
    const found = findTool(path.dirname(rootFile), r.find, platform);
    if (!found || unsafeChar(found.file)) return null;
    const vars = { fileDirname: path.dirname(rootFile), fileBasenameNoExtension: path.basename(rootFile, path.extname(rootFile)), fileBasename: path.basename(rootFile), file: rootFile };
    const args = (r.args || []).map(a => path.normalize(a.replace(/\$\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all))));
    if (args.some(a => unsafeChar(a))) return null;
    return { command: `"${found.file}"${args.map(a => ` "${a}"`).join('')}`, file: found.file, args, cwd: path.dirname(found.file), exe: path.basename(found.file), fromProject: found.fromProject };
  }
  if (platform !== 'win32') return null;
  if (D && D.build && D.build.hint) return null;          // Classic99 only runs TI programs
  const exe = findUp(path.dirname(rootFile), path.join('classic99', 'classic99.exe'), 4);
  return exe ? { command: `"${exe}"`, file: exe, cwd: path.dirname(exe), exe: path.basename(exe), fromProject: true } : null;
}

/** Is a program with this file name already running? (Windows only; false elsewhere.) */
function isRunning(exeName, platform) {
  platform = platform || process.platform;
  if (platform !== 'win32' || !exeName || unsafeChar(exeName)) return Promise.resolve(false);
  return new Promise((resolve) => {
    cp.exec(`tasklist /FI "IMAGENAME eq ${exeName}" /NH`, { windowsHide: true }, (err, stdout) => resolve(!err && stdout.toLowerCase().includes(exeName.toLowerCase())));
  });
}

function start(runner) {
  // An emulator we found ourselves is started directly. Going through the shell on Windows
  // would leave an empty black command window open for as long as the emulator runs.
  // Your own run command does need the shell; its window is hidden (the emulator's isn't).
  const child = runner.file
    ? cp.spawn(runner.file, runner.args || [], { cwd: runner.cwd, detached: true, stdio: 'ignore' })
    : cp.spawn(runner.command, { cwd: runner.cwd, shell: true, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

module.exports = { findTool, onPath, unsafeChar, plan, parseOutput, run, findRunner, isRunning, start, tiName, findUp };
