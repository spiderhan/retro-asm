'use strict';
// The editor features, worked out from the Project with no VS Code types involved,
// so they can be tested with plain Node: tooltips, outline, colours, checks.

const path = require('path');
const { scan, opKinds, isCommentOnly, isAddressSlot, statements } = require('./parser');
const X = require('./explain');
const A = require('./analysis');
const OS = require('./oscalls');

function makeCtx(project, file) {
  const model = project.get(file);
  return {
    D: model.D, file, model,
    findDefs: (n) => project.findDefs(file, n),
    countRefs: (n) => project.findRefs(file, n).length,
    value: (n) => project.value(file, n),
    eval: (t) => project.eval(file, t),
    lineInfo: (line, part) => project.lineInfo(file, line, part),
    regNote: (r, line) => project.regNote(file, r, line),
    symbolNote: (n) => project.symbolNote(file, n),
    addressNote: (v) => project.addressNote(file, v),
    modelOf: (def) => project.get(def.file),
    usedAsAddress: (n) => project.findRefs(file, n).some(r => r.asAddress),
    workspace: () => {
      for (const f of project.unit(file)) {
        const m = project.get(f);
        if (m.workspace !== null) { const v = project.eval(f, m.workspace); if (v !== null) return v; }
      }
      return null;
    }
  };
}

/** "Address >A276 - 4 bytes" for one line, or null. */
function addressPart(project, file, line, withSize, part) {
  const model = project.get(file);
  const info = project.lineInfo(file, line, part);
  if (!info || info.approx) return null;
  const D = model.D;
  if (info.skipped) return '*Left out of the program: the IF test above it is false.*';
  if (model.noAddresses) return info.size ? `*Size:* ${info.size} byte${info.size === 1 ? '' : 's'}` : null;   // inside BASIC the address is only known when the program runs
  let text = `*Address:* ${X.esc(X.hex(info.addr, D, 4))}`;
  if (withSize && info.size) text += ` \u00B7 ${info.size} byte${info.size === 1 ? '' : 's'}`;
  if (info.dummy) text += ' (a layout only: nothing is put in the program here)';
  else if (info.reloc) text += ` *(if the program loads at ${X.esc(X.hex(project.layout(file).base, D, 4))})*`;
  return text;
}

/** Address (and size, for a routine) of a label, as tooltip text. */
function labelAddressPart(project, file, name) {
  const model = project.get(file);
  const D = model.D;
  const a = project.labelAddress(file, name);
  if (!a || a.approx || a.equ) return null;
  let text = model.noAddresses ? '' : `*Address:* ${X.esc(X.hex(a.addr, D, 4))}`;
  const entry = A.routineMap(project, file, buildOutline).get(project.key(file, name));
  if (entry && !entry.inner) {
    const size = A.routineSize(project, entry.file, entry.node);
    if (size) text += (text ? ' \u00B7 the' : 'The') + ` routine is ${size.size} bytes long`;
  }
  if (!text) return null;
  if (a.reloc && !model.noAddresses) text += ` *(if the program loads at ${X.esc(X.hex(project.layout(file).base, D, 4))})*`;
  return text;
}

/** Tooltip for a position: { start, end, parts: [markdown] } or null. */
function hoverAt(project, file, line, ch, opts) {
  opts = opts || {};
  const model = project.get(file);
  if (!model) return null;
  const tok = model.tokenAt(line, ch);
  if (!tok) return null;
  const D = model.D;
  const ctx = makeCtx(project, file);
  const done = (parts, start, end) => (parts && parts.length ? { start, end, parts } : null);

  if (tok.where === 'mnem') {
    let parts = X.hoverInstruction(tok.pl, ctx, line) || X.hoverDirective(tok.pl, ctx, line);
    const data = A.dataAfterLines(project, file).get(line);
    if (data) {
      // really data (the ROM calculator's list after RST $28): say so first
      const head = [`**Data for ${X.esc(data.rule.name)}, not an instruction** (see the ${X.esc(model.lines[data.from].mnem.text)} on line ${data.from + 1}).`, data.rule.note];
      if (data.last && data.rule.endNote && D.instr(tok.pl.mnem.upper)) head.push(data.rule.endNote);   // only when an instruction swallowed the end
      parts = head.concat(parts ? ['*If it were an instruction:*'].concat(parts.filter(p => !p.startsWith('**This line:**'))) : []);
    }
    if (parts) {
      const where = addressPart(project, file, line, true, tok.pl.part);
      if (where) parts.push(where);
      const pic = A.pictureAt(project, file, line, opts.pictures || 'auto');
      if (pic) parts.push(...pic);
      return done(parts, tok.start, tok.end);
    }
    const name = tok.pl.mnem.upper.replace(/^\./, '');
    if (project.macros(file).has(name)) return done([`**${X.esc(tok.pl.mnem.text)}** \u2014 one of your macros.`], tok.start, tok.end);
    return null;
  }
  const symbolParts = (name, o) => {
    const parts = X.hoverSymbol(name, ctx, o);
    if (!parts) return parts;
    const def = ctx.findDefs(name)[0];
    if (def && def.kind !== 'equ' && def.kind !== 'extern') {
      const where = labelAddressPart(project, file, name);
      if (where) parts.push(where);
      if (def.kind === 'data') {
        const pic = A.pictureAt(project, def.file, def.line, opts.pictures || 'auto');
        if (pic) parts.push(...pic);
      }
    }
    return parts;
  };
  if (tok.where === 'label') return done(symbolParts(model.qualify(tok.text, line), {}), tok.start, tok.end);
  if (tok.where === 'comment') {
    if (tok.text.length < 3 || !ctx.findDefs(tok.text).length) return null;
    if (tok.text !== tok.text.toUpperCase()) return null;
    return done(symbolParts(tok.text, { quiet: true }), tok.start, tok.end);
  }

  // inside an operand
  const pl = tok.pl;
  const dir = D.directive(pl.mnem.upper);
  const ins = D.instr(pl.mnem.upper);
  if (dir && dir.kind === 'include') {
    const inc = model.includes.find(i => i.line === line && i.start === tok.operand.start) || model.includes.find(i => i.line === line);
    if (inc) return done([`Pulls in **${X.esc(inc.name)}** at this point. Ctrl+click (Cmd+click on a Mac) to open it.`], tok.operand.start, tok.operand.end);
  }
  if (dir && dir.symbolOperands === false && dir.kind !== 'import') return null;
  const t = tok.tok;
  let parts = null;
  if (t) {
    const raw = model.rawLines[line];
    const slot = ins ? opKinds(ins, pl.operands.length) : null;
    const asAddress = (!!D.syntax.addressPrefix && raw[t.start - 1] === D.syntax.addressPrefix) || (!!ins && isAddressSlot(ins, pl, tok.index, D));
    const isCond = !!slot && slot[tok.index] === 'cc' && (t.type === 'ident' || t.type === 'reg') && D.conditions.has(t.text.toUpperCase());
    if (isCond) parts = [`**${X.esc(t.text)}** \u2014 condition: ${D.conditions.get(t.text.toUpperCase()).text}.`];
    else if (t.type === 'num') parts = X.hoverNumber(t, ctx, { asAddress });
    else if (t.type === 'str' && t.value !== null) parts = X.hoverNumber(t, ctx, {});
    else if (t.type === 'reg') parts = X.hoverRegister(t, ctx, line);
    else if (t.type === 'here') parts = ['**$** \u2014 stands for the address of this line. `$+2` means "the next instruction".'];
    else if (t.type === 'ident') {
      parts = symbolParts(model.qualify(t.text, line), {});
    }
    // a hardware port (Z80: OUT ($FE),A): what it is, and what is being sent to it
    if (slot && slot[tok.index] === 'p' && D.ioPorts && D.ioPorts.size && (t.type === 'num' || t.type === 'ident' || t.type === 'reg')) {
      const n = A.portNumber(project, file, line, pl.operands[tok.index].text);
      const p = D.ioPort(n);
      if (t.type === 'reg') parts = [`**${X.esc(t.text.toUpperCase())}** \u2014 the port number is in BC: C is the low half, B the high half.${n !== null ? ` Here BC was set to ${X.esc(X.hex(n, D, 4))} just above.` : ''}`];
      if (p) {
        parts = (parts || []).concat(p.text || p.name || []);
        const sent = A.decodePortSend(project, file, line);
        if (sent) parts.push(sent);
      }
    }
    // is this value on its way to the sound or video chip?
    if (parts && (t.type === 'num' || t.type === 'ident')) {
      let meaning = null;
      if (ins && slot && slot.length === 2 && slot[0] === 'r' && slot[1] === 'i' && tok.index === 1 && ins.rw && ins.rw[0] === 'w') {
        const word = project.eval(file, pl.operands[1].text);
        if (word !== null) meaning = A.decodeLoaded(project, file, line, pl.operands[0].text.trim(), word & 0xFFFF);
      } else if (dir && dir.kind === 'data' && dir.unit === 1 && t.type === 'num' && t.value !== null) {
        const kind = A.blockPort(project, file, A.dataBlock(project, file, line));
        if (kind) meaning = A.decode(kind, t.value << 8, t.value, false);
      }
      if (!meaning && D.ioPorts && D.ioPorts.size && ins && slot && tok.index === 1 && pl.operands.length === 2 && D.isRegister(pl.operands[0].text.trim()) && pl.mnem.upper === 'LD') {
        // Z80: LD A,2 with OUT ($FE),A a few lines down
        const v = project.eval(file, pl.operands[1].text);
        if (v !== null) meaning = A.decodePortValue(project, file, line, pl.operands[0].text.trim(), v & 0xFF);
      }
      if (meaning) { parts = parts.filter(x => !x.startsWith('If this is a memory address')); parts.push(meaning); }
    }
    // BBC: a number on its way to OSBYTE / OSWORD / OSWRCH or to hardware (LDA #&13 then JSR OSBYTE), or the call itself
    if (parts && pl.operands.length === 1 && ((D.osCalls && D.osCalls.size) || (D.hwValues && D.hwValues.size)) && tok.index === 0) {
      const said = OS.hoverFor(project, file, line, pl);
      if (said) parts.push(said);
    }
  }
  if (ins) {
    const kinds = opKinds(ins, pl.operands.length);
    if (kinds && kinds[tok.index] === 'g') {
      // the shape of the whole operand (*R1+, @TABLE(R1) ...). The plain @LABEL shape is only
      // explained when the cursor is on the @ itself, to keep label tooltips short.
      const form = X.hoverOperandForm(tok.operand, ctx, !t || t.type === 'op');
      if (form) parts = (parts || []).concat(form);
    }
  }
  if (!parts) return null;
  return done(parts, t ? t.start : tok.operand.start, t ? t.end : tok.operand.end);
}

/** The name under the cursor, if it could be a label. */
function symbolAt(project, file, line, ch) {
  const model = project.get(file);
  if (!model) return null;
  const tok = model.tokenAt(line, ch);
  if (!tok) return null;
  if (tok.where === 'label') return { name: model.qualify(tok.text, line), text: tok.text, start: tok.start, end: tok.end, where: 'label' };
  if (tok.where === 'comment') return project.findDefs(file, tok.text).length ? { name: tok.text, start: tok.start, end: tok.end, where: 'comment' } : null;
  if (tok.where === 'operand' && tok.tok && tok.tok.type === 'ident') {
    const dir = model.D.directive(tok.pl.mnem.upper);
    if (dir && dir.symbolOperands === false && dir.kind !== 'import') return null;
    return { name: model.qualify(tok.tok.text, line), text: tok.tok.text, start: tok.tok.start, end: tok.tok.end, where: 'operand' };
  }
  return null;
}

function includeAt(project, file, line, ch) {
  const model = project.get(file);
  if (!model) return null;
  const inc = model.includes.find(i => i.line === line && ch >= i.start && ch <= i.end);
  return inc ? Object.assign({ target: project.resolveInclude(file, inc.name) }, inc) : null;
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------
function firstDocLine(model, def) {
  let doc = model.docAbove(def.line);
  let line = doc.find(l => l.trim().length) || model.trailingComment(def.line) || '';
  line = line.trim();
  const rx = new RegExp('^' + def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:\\-\u2013]\\s*', 'i');
  line = line.replace(rx, '').replace(/^[\s\-=*]+|[\s\-=*]+$/g, '');
  return line.length > 90 ? line.slice(0, 87) + '\u2026' : line;
}

/** Is this label only ever reached by short jumps (JNE, JMP ...)? Then it belongs inside the routine above it. */
function isLocal(project, file, def) {
  if (def.kind !== 'code' && def.kind !== 'label') return false;
  // sjasmplus .loop labels belong to the label above them
  if (project.get(def.file || file).scopes && def.name.startsWith('.')) return true;
  const refs = project.findRefs(file, def.upper || def.name);
  if (!refs.length) return false;
  const D = project.get(file).D;
  return refs.every(r => { const i = D.instr(r.mnem); return !!(i && i.local); });
}

/** Is this just a marker (for example an end-of-text label): nothing refers to it and no code or data follows it before the next label? */
function isMarker(project, file, def) {
  if (def.kind !== 'code' && def.kind !== 'label') return false;
  if (project.findRefs(file, def.upper || def.name).length) return false;
  const model = project.get(def.file || file);
  if (!model) return false;
  let seen = false;
  for (let ln = def.line; ln < model.lines.length; ln++) {
    for (const pl of statements(model.lines[ln])) {
      if (!seen) { if (pl.label && pl.label.start === def.start && ln === def.line) seen = true; else continue; }
      else if (pl.label) return true;           // the next label comes first: nothing belongs to this one
      if (pl.mnem) return false;                // something is assembled here: this is a real place
    }
  }
  return true;
}

function buildOutline(project, file) {
  const model = project.get(file);
  if (!model) return [];
  const D = model.D;
  const defs = model.defList.filter(d => d.kind !== 'extern' && d.kind !== 'param').slice().sort((a, b) => a.line - b.line);
  const top = [];
  let current = null;
  for (const def of defs) {
    let kind = def.kind === 'equ' ? 'const' : def.kind === 'data' ? 'data' : def.kind === 'macro' ? 'macro' : 'routine';
    let detail = '';
    if (kind === 'const') {
      const v = project.value(file, def.name);
      const single = scan(def.expr || '', 0, D).length === 1;
      detail = v === null || single ? `= ${def.expr || ''}` : `= ${def.expr} (${X.hex(v, D, v > 0xFF || v < 0 ? 4 : 2)})`;
    } else if (kind === 'data') detail = model.trailingComment(def.line);
    else detail = firstDocLine(model, def);
    const node = { name: def.name, detail, kind, line: def.line, endLine: def.line, start: def.start, end: def.end, children: [], def };
    if (kind === 'routine' && current && current.kind === 'routine' && isLocal(project, file, def)) {
      node.kind = 'label';
      node.detail = model.trailingComment(def.line) ? '' : '';
      current.children.push(node);
    } else if (kind === 'routine' && current && isMarker(project, file, def)) {
      // an end marker: it sits inside whatever is above it, not in the routines list
      node.kind = 'label';
      current.children.push(node);
    } else {
      top.push(node);
      current = node;
    }
  }
  // work out where each one ends
  const lastLine = model.lines.length - 1;
  for (let i = 0; i < top.length; i++) {
    const n = top[i];
    let end = i + 1 < top.length ? model.docStart(top[i + 1].line) - 1 : lastLine;
    if (n.kind !== 'routine' && n.kind !== 'macro') {
      // constants and data: just their own lines (data runs on until the next label or blank line)
      end = n.line;
      if (n.kind === 'data') {
        const stop = i + 1 < top.length ? top[i + 1].line : lastLine + 1;
        for (let k = n.line + 1; k < stop; k++) {
          const pl = model.lines[k];
          if (pl.label || (!pl.mnem && !pl.comment) || isCommentOnly(pl)) break;
          end = k;
        }
      }
    }
    while (end > n.line && !model.lines[end].mnem && !model.lines[end].label) end--;
    n.endLine = Math.max(end, n.line);
    for (let c = 0; c < n.children.length; c++) {
      const ch = n.children[c];
      ch.endLine = Math.max(ch.line, c + 1 < n.children.length ? n.children[c + 1].line - 1 : n.endLine);
    }
  }
  return top;
}

/** Folding: each routine, and each comment block of 3 lines or more. */
function foldingRanges(project, file) {
  const model = project.get(file);
  if (!model) return [];
  const out = [];
  for (const n of buildOutline(project, file)) {
    if ((n.kind === 'routine' || n.kind === 'macro') && n.endLine > n.line) out.push({ start: n.line, end: n.endLine, kind: 'region' });
  }
  let s = -1;
  for (let i = 0; i <= model.lines.length; i++) {
    const c = i < model.lines.length && isCommentOnly(model.lines[i]);
    if (c && s < 0) s = i;
    if (!c && s >= 0) { if (i - s >= 3) out.push({ start: s, end: i - 1, kind: 'comment' }); s = -1; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colours (semantic tokens)
// ---------------------------------------------------------------------------
const TOKEN_TYPES = ['keyword', 'macro', 'function', 'label', 'enumMember', 'variable', 'register'];
const TOKEN_MODS = ['declaration', 'defaultLibrary'];

function typeForDef(project, file, def, localCache) {
  if (!def) return null;
  if (def.kind === 'equ') return 'enumMember';
  if (def.kind === 'data') return 'variable';
  if (def.kind === 'extern') return 'function';
  const key = def.file + '|' + def.upper;
  if (!localCache.has(key)) localCache.set(key, isLocal(project, def.file, def));
  if (!localCache.has(key + '|m')) localCache.set(key + '|m', isMarker(project, def.file, def));
  return localCache.get(key) || localCache.get(key + '|m') ? 'label' : 'function';
}

function semanticTokens(project, file) {
  const model = project.get(file);
  if (!model) return [];
  const D = model.D;
  const out = [];
  const localCache = new Map();
  const defCache = new Map();
  const lookup = (name) => {
    const u = D.key(name);
    if (!defCache.has(u)) defCache.set(u, project.findDefs(file, name)[0] || null);
    return defCache.get(u);
  };
  for (let ln = 0; ln < model.lines.length; ln++) for (const pl of statements(model.lines[ln])) {
    if (pl.label) {
      const def = (model.defs.get(pl.label.upper || D.key(pl.label.name)) || []).find(d => d.line === ln && d.start === pl.label.start);
      const type = typeForDef(project, file, def, localCache);
      if (type) out.push({ line: ln, start: pl.label.start, length: pl.label.end - pl.label.start, type, mods: ['declaration'] });
    }
    if (!pl.mnem) continue;
    const ins = D.instr(pl.mnem.upper), dir = D.directive(pl.mnem.upper);
    if (pl.mnem.upper === '=' && dir) continue;      // "name = value": nothing to colour on the =
    if (ins || dir) out.push({ line: ln, start: pl.mnem.start, length: pl.mnem.end - pl.mnem.start, type: ins ? 'keyword' : 'macro', mods: [] });
    if (dir && dir.symbolOperands === false && dir.kind !== 'import') continue;
    const kinds = ins ? opKinds(ins, pl.operands.length) : null;
    for (let oi = 0; oi < pl.operands.length; oi++) {
      for (const t of scan(pl.operands[oi].text, pl.operands[oi].start, D)) {
        if (kinds && kinds[oi] === 'cc' && (t.type === 'reg' || t.type === 'ident') && D.conditions.has(t.text.toUpperCase())) { out.push({ line: ln, start: t.start, length: t.end - t.start, type: 'keyword', mods: [] }); continue; }
        if (t.type === 'reg') out.push({ line: ln, start: t.start, length: t.end - t.start, type: 'register', mods: [] });
        else if (t.type === 'ident') {
          if (kinds && kinds[oi] === 'cc' && D.conditions.has(t.upper)) { out.push({ line: ln, start: t.start, length: t.end - t.start, type: 'keyword', mods: [] }); continue; }
          const def = lookup(model.qualify(t.text, ln));
          const type = typeForDef(project, file, def, localCache);
          if (type) out.push({ line: ln, start: t.start, length: t.end - t.start, type, mods: def.kind === 'extern' ? ['defaultLibrary'] : [] });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks (the wavy underlines)
// ---------------------------------------------------------------------------
function check(project, file) {
  const model = project.get(file);
  if (!model) return [];
  const D = model.D;
  const out = [];
  const realOut = out;
  try { out.push(...A.extraChecks(project, file, buildOutline)); } catch (e) { /* never let an extra check stop the basic ones */ out.push({ line: 0, start: 0, end: 1, severity: 'info', message: 'Retro ASM: an internal check failed (' + e.message + ')' }); }
  const macros = project.macros(file);

  // lines an IF leaves out (BeebAsm's IF 0 ... ENDIF) aren't checked: the assembler never reads them
  const skipped = (f, ln) => { const i = project.lineInfo(f, ln); return !!(i && i.skipped); };
  for (let ln = 0; ln < model.lines.length; ln++) for (const pl of statements(model.lines[ln])) {
    if (!pl.mnem || skipped(file, ln)) continue;
    const known = D.isMnemonic(pl.mnem.upper);
    if (!known) {
      const asMacro = pl.mnem.upper.replace(/^[.:+]/, '');
      if (!macros.has(asMacro)) out.push({ line: ln, start: pl.mnem.start, end: pl.mnem.end, severity: 'warning', message: `"${pl.mnem.text}" isn't an instruction or directive in ${D.short}. Check the spelling.` });
      continue;
    }
    const range = D.operandRange(pl.mnem.upper);
    if (range) {
      const n = pl.operands.length;
      if (n < range[0] || n > range[1]) {
        const want = range[0] === range[1] ? (range[0] === 0 ? 'no operands' : range[0] === 1 ? '1 operand' : `${range[0]} operands`) : `${range[0]} to ${range[1]} operands`;
        const info = D.instr(pl.mnem.upper) || D.directive(pl.mnem.upper);
        out.push({ line: ln, start: pl.mnem.start, end: pl.mnem.end, severity: 'warning', message: `${pl.mnem.upper} takes ${want}, but this line has ${n}.${info && info.syntax ? ' It is written: ' + info.syntax : ''}` });
      }
    }
  }

  const seenUndefined = new Set();
  for (const r of model.refs) {
    if (project.findDefs(file, r.upper).length || skipped(file, r.line)) continue;
    const knownHelper = D.knownSymbols.has(r.upper);
    // BeebAsm minds capitals: "OSBYTE" is not "osbyte"
    if (D.syntax.caseSensitive) {
      const other = project.allDefs(file).find(d => d.name.toUpperCase() === r.name.toUpperCase() && d.kind !== 'param');
      if (other) {
        out.push({ line: r.line, start: r.start, end: r.end, severity: 'warning', message: `No label called ${r.name} was found, but there is ${other.name}. BeebAsm minds capitals, so these are different names.` });
        continue;
      }
    }
    const imp = [...D.directives.values()].find(d => d.kind === 'import');
    out.push({
      line: r.line, start: r.start, end: r.end, severity: 'warning',
      message: knownHelper && imp
        ? `${r.name} is a built-in helper, but it needs a "${imp.key} ${r.name}" line near the top of the program first.`
        : `No label called ${r.name} was found${seenUndefined.has(r.upper) ? '' : ' in this program'}. Check the spelling, or it may not be written yet.`
    });
    seenUndefined.add(r.upper);
  }

  for (const [u, list] of model.defs) {
    const all = project.findDefs(file, list[0].upper).filter(d => d.kind !== 'extern' && d.kind !== 'param' && !skipped(d.file, d.line));
    if (all.length < 2) continue;
    const weak = all.every(d => {
      const m = project.get(d.file); const pl = m && m.lines[d.line];
      return pl && pl.mnem && pl.mnem.upper === 'WEQU';
    });
    // BeebAsm: the same name set in the IF and the ELSE half is fine, only one half is used
    const branches = all.every(d => d.file === all[0].file) && all.every((d, i) => all.every((e, j) => i === j || inOtherBranches(project.get(d.file), d.line, e.line)));
    if (branches) continue;
    if (weak) continue;
    for (const d of list) {
      if (d.kind === 'extern' || d.kind === 'param' || skipped(d.file, d.line)) continue;
      const other = all.find(o => o !== d);
      const where = other.file === file ? `line ${other.line + 1}` : `line ${other.line + 1} of ${path.basename(other.file)}`;
      out.push({ line: d.line, start: d.start, end: d.end, severity: 'warning', message: `${d.name} is defined more than once (also on ${where}).` });
    }
  }
  // lines that are really data (after RST $28) aren't checked as instructions
  const data = A.dataAfterLines(project, file);
  return data.size ? realOut.filter(x => !data.has(x.line)) : realOut;
}

/** For each line, the IF blocks it is inside and which part of each: [[if number, part number], ...]. */
function branchPaths(model) {
  if (model._branchPaths) return model._branchPaths;
  const D = model.D;
  const stack = [];
  let ids = 0;
  model._branchPaths = model.lines.map(pl => {
    let here = null;
    for (const st of statements(pl)) {
      const dir = st.mnem ? D.directive(st.mnem.upper) : null;
      if (!dir) continue;
      if (dir.kind === 'if') stack.push([++ids, 0]);
      else if ((dir.kind === 'else' || dir.kind === 'elif') && stack.length) stack[stack.length - 1] = [stack[stack.length - 1][0], stack[stack.length - 1][1] + 1];
      else if (dir.kind === 'endif') { if (!here) here = stack.map(x => x.slice()); stack.pop(); }
    }
    return here || stack.map(x => x.slice());
  });
  return model._branchPaths;
}

/** Are two lines in different parts of the same IF ... ELIF ... ELSE ... ENDIF (so only one is used)? */
function inOtherBranches(model, a, b) {
  if (!model || a === b) return false;
  const p = branchPaths(model);
  return (p[a] || []).some(([id, part]) => (p[b] || []).some(([id2, part2]) => id === id2 && part !== part2));
}

/** Plain-English walk through a run of lines, as Markdown. */
/** The plain-English sentence for one line (the same one the "Explain" command uses). */
function lineSentence(project, file, ln, ctx, only) {
  const model = project.get(file);
  const D = model.D;
  ctx = ctx || makeCtx(project, file);
  const whole = model.lines[ln];
  if (whole.parts && only === undefined) {
    // "LDA #1:STA &70": one sentence per statement, in order
    let joined = whole.parts.map((p, k) => lineSentence(project, file, ln, ctx, k)).filter(Boolean).map(t => t.replace(/\.$/, '')).join('. Then ').replace(/Then ([A-Z])(?=[a-z])/g, (a, c) => 'Then ' + c.toLowerCase()) + '.';
    const info = project.lineInfo(file, ln);
    if (info && info.skipped) joined += ' *(Left out: the IF test above is false.)*';
    return joined;
  }
  const pl = only !== undefined && whole.parts ? whole.parts[only] : whole;
  let text = '';
  const data = A.dataAfterLines(project, file).get(ln);
  if (data) text = `Data for ${data.rule.name} (after line ${data.from + 1}), not an instruction.${data.last ? ' The end of the list.' : ''}`;
  else if (pl.mnem) {
    const ins = D.instr(pl.mnem.upper), dir = D.directive(pl.mnem.upper);
    if (ins) text = X.explainLine(pl, ctx, ln) || ins.summary;
    else if (dir) {
      const parts = X.hoverDirective(pl, ctx, ln) || [];
      const mine = parts.find(p => p.startsWith('**This line:**'));
      text = mine ? mine.replace('**This line:** ', '') : dir.summary;
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }
    else if (project.macros(file).has(pl.mnem.upper.replace(/^[.:+]/, ''))) text = `Use your macro ${pl.mnem.text}: its lines are put in here.`;
  } else if (pl.label) text = whole.parts ? '' : '*A label: a name for this spot, so other lines can jump here.*';
  if (text && only === undefined) { const info = project.lineInfo(file, ln); if (info && info.skipped) text += ' *(Left out: the IF test above is false.)*'; }
  return text || '';
}

function explainLines(project, file, from, to) {
  const model = project.get(file);
  if (!model) return '';
  const ctx = makeCtx(project, file);
  const D = model.D;
  const out = [`# ${path.basename(file)}, lines ${from + 1} to ${to + 1}`, '', `*${D.name}*`, ''];
  out.push('| Line | Code | In plain English |', '|---|---|---|');
  for (let ln = from; ln <= to && ln < model.lines.length; ln++) {
    const pl = model.lines[ln];
    if (!pl.mnem && !pl.label) continue;
    let code = model.rawLines[ln].slice(0, pl.comment ? pl.comment.start : undefined).trim().replace(/\s+/g, ' ');
    const text = lineSentence(project, file, ln, ctx);
    out.push(`| ${ln + 1} | \`${code.replace(/\|/g, '\\|').replace(/`/g, "'")}\` | ${text.replace(/\|/g, '\\|')} |`);
  }
  return out.join('\n');
}

/** The one-line summaries shown above each routine. */
function lenses(project, file) {
  const model = project.get(file);
  if (!model) return [];
  const D = model.D;
  const out = [];
  const map = A.routineMap(project, file, buildOutline);
  for (const node of buildOutline(project, file)) {
    if (node.kind !== 'routine') continue;
    const item = { line: node.line, start: node.start, end: node.end, name: node.name, parts: [] };
    const c = A.callers(project, file, node.name);
    let who;
    if (!c.refs.length) who = 'Not called by name';
    else if (c.calls.length === c.refs.length) who = `Called from ${c.refs.length} place${c.refs.length === 1 ? '' : 's'}`;
    else if (!c.calls.length) who = `Jumped to from ${c.refs.length} place${c.refs.length === 1 ? '' : 's'}`;
    else who = `Used in ${c.refs.length} places (${c.calls.length} call${c.calls.length === 1 ? '' : 's'})`;
    item.parts.push({ text: who, refs: c.refs });
    const size = A.routineSize(project, file, node);
    if (size) item.parts.push({ text: `${X.hex(size.addr, D, 4)} \u00B7 ${size.size} bytes` });
    const entry = map.get(project.key(file, node.name));
    if (entry && entry.use && D.registers.list.length) {
      const use = entry.use;
      const bits = [];
      // the link register (R11) is left out: every call and return touches it
      const link = D.checks.linkRegister ? D.checks.linkRegister.toUpperCase() : '';
      const writes = new Set([...use.writes].filter(r => r !== link));
      if (writes.size) bits.push('Changes ' + A.regList(writes, D));
      const onlyRead = new Set([...use.reads].filter(r => ![...use.writes].some(w => D.registers.overlap(w, r)) && r !== link));
      if (onlyRead.size) bits.push((bits.length ? 'only reads ' : 'Only reads ') + A.regList(onlyRead, D));
      const through = new Set([...A.writesThroughCalls(map, project.key(file, node.name))].filter(r => ![...use.writes].some(w => D.registers.overlap(w, r)) && r !== link));
      if (through.size) bits.push('routines it calls change ' + A.regList(through, D));
      if (bits.length) item.parts.push({ text: bits.join(' \u00B7 ') });
    }
    out.push(item);
  }
  return out;
}

/**
 * The small "14 cycles" notes beside instruction lines, for lines from..to.
 * Returns [{ line, label, tooltip }]. Lines the IF test leaves out, and instructions the chip
 * file has no timing for (or only gives in words), get none.
 */
function cycleHints(project, file, from, to) {
  const model = project.get(file);
  if (!model || !model.D.timing) return [];
  const D = model.D;
  const T = require('./timing');
  const ctx = makeCtx(project, file);
  const out = [];
  const last = Math.min(to, model.lines.length - 1);
  for (let ln = Math.max(0, from); ln <= last; ln++) {
    const labels = [], tips = [];
    for (const pl of statements(model.lines[ln])) {
      if (!pl.mnem) continue;
      const ins = D.instr(pl.mnem.upper);
      if (!ins) continue;
      const info = ctx.lineInfo(ln, pl.part);
      if (info && info.skipped) continue;
      const res = X.cyclesResult(ins, pl, ctx, ln);
      const s = T.shortLabel(res, D.timing);
      if (!s) continue;
      labels.push(s);
      tips.push(res.text);
    }
    if (!labels.length) continue;
    out.push({ line: ln, label: labels.join(' | ') + (labels.length === 1 && labels[0] === '1' ? ' cycle' : ' cycles'), tooltip: tips.join(' ') });
  }
  return out;
}

module.exports = { cycleHints, lineSentence, lenses, addressPart, makeCtx, hoverAt, symbolAt, includeAt, buildOutline, foldingRanges, semanticTokens, check, explainLines, firstDocLine, isLocal, TOKEN_TYPES, TOKEN_MODS };
