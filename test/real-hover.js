// Show the tooltip for a word on a line of your own code, to check tooltips on a real project.
//   node test/real-hover.js <folder> <file.a99> "<text on the line>" [word] [full]
// Every .a99 file in the folder is loaded, so labels from COPY files are found.
// "full" prints the whole tooltip; otherwise only its last three parts.
// With no text, it prints the summary lines above each routine and the program's size instead.
const path = require('path'), fs = require('fs');
const { loadFile } = require('../lib/dialect'); const { Project } = require('../lib/project');
const F = require('../lib/features'); const A = require('../lib/analysis');
const [folder, name, needle, word, full] = process.argv.slice(2);
if (!folder || !name) { console.log('Usage: node test/real-hover.js <folder> <file.a99> "<text on the line>" [word] [full]'); process.exit(1); }
const dir = path.resolve(folder); const D = loadFile(path.join(__dirname, '../dialects/tms9900.json')); const P = new Project();
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.a99'))) P.set(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8'), D);
const file = path.join(dir, name);
if (!P.get(file)) { console.log('Not found:', file); process.exit(1); }
if (needle) {
  const M = P.get(file); const ln = M.rawLines.findIndex(l => l.includes(needle));
  if (ln < 0) { console.log('No line contains', JSON.stringify(needle)); process.exit(1); }
  const sub = word || needle.trim().split(/\s+/)[0]; const ch = M.rawLines[ln].indexOf(sub) + 1;
  const h = F.hoverAt(P, file, ln, ch);
  console.log(`### ${name}:${ln + 1} [${sub}]  ${M.rawLines[ln].trim().slice(0, 60)}`);
  console.log(h ? h.parts.slice(full === 'full' || word === 'full' ? 0 : -3).join('\n\n') : '(no tooltip)');
} else {
  const t = Date.now(); const ls = F.lenses(P, file);
  console.log('summary lines', ls.length, `(${Date.now() - t} ms)`);
  for (const l of ls) console.log(' ', l.name.padEnd(14), l.parts.map(p => p.text).join('  |  '));
  console.log(A.programSize(P, file));
}
