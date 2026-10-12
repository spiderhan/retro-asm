// Runs the extension inside a real copy of VS Code and checks it works there.
//
//   npm install                 (once: fetches the test helper, @vscode/test-electron)
//   npm run test:vscode
//
// The first run downloads a copy of VS Code into .vscode-test (about 150 MB); later runs reuse it.
// Your own VS Code and its settings are not touched.
//
// Optional settings, as environment variables (Windows: set NAME=value first; PowerShell: $env:NAME="value"):
//   XAS99=C:\path\to\xas99.py   for the build test. Without it, the build test is skipped.
//   PYTHON=py                   the command that runs Python (default: python on Windows, python3 elsewhere).
//   CLASSIC99=C:\path\to\classic99.exe   also test F5 (build and start the emulator). Classic99 opens
//                               for a moment and is closed again. Skipped if Classic99 is already open.
//   VSCODE_EXECUTABLE=...       use this VS Code (or VSCodium) instead of downloading one.
//   VSCODE_VERSION=1.75.0       which VS Code to download (default: the latest stable).
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
  let runTests;
  try { ({ runTests } = require('@vscode/test-electron')); }
  catch (e) { console.error('The test helper is missing. Run "npm install" in the retro-asm folder first.'); process.exit(2); }

  const root = path.resolve(__dirname, '..', '..');
  const win = process.platform === 'win32';

  // a throwaway project folder, filled with the test files
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'retroasm-vscode-'));
  const fx = path.join(root, 'test', 'fixtures');
  for (const f of fs.readdirSync(fx)) fs.copyFileSync(path.join(fx, f), path.join(ws, f));

  // a sub-folder with its own build script, to test the build command the way it is really used
  const xas = [process.env.XAS99].find(p => p && fs.existsSync(p));
  const bt = path.join(ws, 'buildtest');
  fs.mkdirSync(bt);
  fs.copyFileSync(path.join(fx, 'paddle.a99'), path.join(bt, 'paddle.a99'));
  const py = process.env.PYTHON || (win ? 'python' : 'python3');
  if (xas) {
    if (win) fs.writeFileSync(path.join(bt, 'build.bat'), `@echo off\r\nrem test build script\r\ncd /d "%~dp0"\r\n${py} "${xas}" -R paddle.a99 -o PADDLE.obj\r\nif errorlevel 1 goto failed\r\necho Built PADDLE.\r\ngoto end\r\n:failed\r\necho BUILD FAILED - see the messages above.\r\n:end\r\n`);
    else fs.writeFileSync(path.join(bt, 'build.sh'), `#!/bin/sh\n# test build script\ncd "$(dirname "$0")"\n${py} "${xas}" -R paddle.a99 -o PADDLE.obj || { echo "BUILD FAILED - see the messages above."; exit 1; }\necho Built PADDLE.\n`);
  }
  // F5 test: a folder called "classic99" next to the source, pointing at the real one
  let junction = null;
  const c99 = process.env.CLASSIC99;
  if (c99 && fs.existsSync(c99)) {
    junction = path.join(bt, 'classic99');
    fs.symlinkSync(path.dirname(c99), junction, 'junction');
    if (path.basename(c99).toLowerCase() !== 'classic99.exe') console.log('Note: CLASSIC99 should point at classic99.exe; the extension only looks for that name.');
  }
  fs.mkdirSync(path.join(ws, '.vscode'));
  fs.writeFileSync(path.join(ws, '.vscode', 'settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'retroAsm.build.python': py, 'files.associations': { '*.asm': 'retroasm' } }, null, 2));

  const info = { workspace: ws, xas99: xas || null, classic99: junction ? c99 : null, results: path.join(root, '.vscode-test', 'results.txt') };
  fs.mkdirSync(path.dirname(info.results), { recursive: true });
  console.log('Test project folder:', ws);
  console.log(xas ? 'Build test uses: ' + xas : 'No xas99.py found: the build tests will be skipped (set XAS99 to include them).');

  const launchArgs = [ws, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu',
    '--user-data-dir', path.join(root, '.vscode-test', 'user-data')];
  if (process.getuid && process.getuid() === 0) launchArgs.push('--no-sandbox');
  const opts = {
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    launchArgs,
    extensionTestsEnv: { RETROASM_TEST_INFO: JSON.stringify(info) }
  };
  if (process.env.VSCODE_EXECUTABLE) opts.vscodeExecutablePath = process.env.VSCODE_EXECUTABLE;
  else if (process.env.VSCODE_VERSION) opts.version = process.env.VSCODE_VERSION;

  let code = 0;
  try { await runTests(opts); }
  catch (e) { code = 1; }
  finally {
    if (junction) { try { fs.unlinkSync(junction); } catch (e) { try { fs.rmdirSync(junction); } catch (e2) { /* leave it */ } } }
  }
  if (fs.existsSync(info.results)) console.log('\n' + fs.readFileSync(info.results, 'utf8'));
  console.log(code ? 'Some checks FAILED inside VS Code (see above).' : 'All checks passed inside VS Code.');
  process.exit(code);
}

main().catch((e) => { console.error(e); process.exit(1); });
