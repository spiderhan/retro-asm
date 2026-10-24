'use strict';
// Reads BBC BASIC listings that have machine code inside [ ] (BBC BASIC's own assembler).
//
//   50 [OPT pass
//   60 .start
//   70 LDA #65 : JSR &FFEE
//   80 ]
//
// mask(text) hands back the same text with everything that is not assembly turned into spaces
// (BASIC line numbers, BASIC statements, the [ and ] themselves, the OPT setting). Line numbers and
// columns stay exactly where they were, so a tooltip on the masked text lines up with the real file.
// Nothing in here knows about VS Code.

const isWordChar = (c) => /[A-Za-z0-9_$%]/.test(c || '');

/** { text, any }: `text` is `source` with only the assembly left; `any` says if there was any. */
function mask(source) {
  const lines = String(source).split('\n');
  const out = [];
  let inAsm = false, any = false;

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const keep = new Array(line.length).fill(false);        // which characters are assembly
    let i = 0;
    const num = /^[ \t]*\d+/.exec(line);                     // a BASIC line number
    if (num) i = num[0].length;
    let stmt = inAsm;                                        // at the start of an assembler statement?
    let bstmt = !inAsm;                                      // at the start of a BASIC statement?
    let lastKept = false;                                    // was the BASIC statement just before a kept one?

    while (i < line.length) {
      const c = line[i];
      if (!inAsm) {
        if (c === ' ' || c === '\t') { i++; continue; }
        if (bstmt) {                                         // oswrch = &FFEE : a plain number given a name, kept for the assembly to use
          bstmt = false; lastKept = false;
          const m = /^(?:LET[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*([&$][0-9A-Fa-f]+|\d+)[ \t]*(?=:|\\|$)/.exec(line.slice(i));
          if (m && !/^(?:REM|DATA)$/i.test(m[1])) {
            const from = i + m[0].indexOf(m[1]);
            for (let k = from; k < i + m[0].trimEnd().length; k++) keep[k] = true;
            i += m[0].length; lastKept = true;
            continue;
          }
        }
        if (c === ':') { if (lastKept) keep[i] = true; lastKept = false; bstmt = true; i++; continue; }
        if (c === '"') {                                     // a BASIC string: "" is a quote inside it
          i++;
          while (i < line.length) { if (line[i] === '"') { if (line[i + 1] === '"') { i += 2; continue; } break; } i++; }
          i++;
          continue;
        }
        if (c === '[') { inAsm = true; stmt = true; any = true; i++; continue; }
        const rest = line.slice(i, i + 4).toUpperCase();
        if ((rest.startsWith('REM') || rest === 'DATA') && !isWordChar(line[i - 1])) break;   // the rest is not code
        i++;
        continue;
      }
      // inside [ ]
      if (c === ']') { inAsm = false; i++; continue; }
      if (c === '\\' || c === ';') { for (let k = i; k < line.length; k++) keep[k] = true; break; }
      if (c === ' ' || c === '\t') { keep[i] = true; i++; continue; }
      if (stmt && /^OPT\b/i.test(line.slice(i, i + 4))) {   // [OPT pass: not an instruction
        while (i < line.length && !/[:\]\\;]/.test(line[i])) i++;
        stmt = false;
        continue;
      }
      stmt = false;
      if (c === ':') { keep[i] = true; stmt = true; i++; continue; }
      if (c === '"') {
        keep[i] = true; i++;
        while (i < line.length) { keep[i] = true; if (line[i] === '"') { if (line[i + 1] === '"') { keep[i + 1] = true; i += 2; continue; } i++; break; } i++; }
        continue;
      }
      keep[i] = true; i++;
    }
    let s = '';
    for (let k = 0; k < line.length; k++) s += keep[k] ? line[k] : (line[k] === '\t' ? '\t' : ' ');
    out.push(s + (raw.endsWith('\r') ? '\r' : ''));
  }
  return { text: out.join('\n'), any };
}

module.exports = { mask };
