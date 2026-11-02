// The blocks panel's page script. It runs inside the VS Code panel (a web page), not in the extension.
// The extension puts the editing rules (lib/blocks-edit.js) in front of this as `E`, and sends the
// project and the list of blocks as a 'state' message. Every change is sent back as 'change'.
/* global E, acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let P = null, CAT = {}, CATS = [], PAL = [], problems = [], asm = '', paths = [], error = '', fileName = '';
  let PICS = [], SOUNDS = [], DATAFILE = '';
  let active = ['every_frame'];
  let dragging = null;
  let status = '';
  let view = 'blocks';      // 'blocks' or 'code'
  let selected = null;      // where the chosen block sits, like 'every_frame/3' (its lines are lit up in the code)

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;   // set through the page's style object: the panel's security rules block style="..." text
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const hue = (s) => { let n = 0; for (const c of s) n = (n * 31 + c.charCodeAt(0)) % 360; return n; };
  const words = (s) => s.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
  const sameList = (a, b) => a.length === b.length && a.every((k, i) => b[i] === k);

  /** `structure` = blocks were added, moved or removed (so what is selected may now be somewhere else). */
  function changed(structure) {
    if (structure) selected = null;
    vscode.postMessage({ type: 'change', project: P });
    render();
  }

  // ---------- colours: real colours, not numbers ----------
  const RAINBOW = 'linear-gradient(90deg,#FC5554,#D4C154,#21C842,#42EBF5,#5455ED,#C95BBA)';
  const CHECKS = 'repeating-conic-gradient(#8886 0% 25%, transparent 0% 50%) 0 0/8px 8px';
  function swatchStyle(n, zero) {
    if (zero !== undefined && n === 0) return 'background:' + RAINBOW;
    const c = PAL.find(x => x.n === n);
    return c && c.rgb ? 'background:' + c.rgb : 'background:' + CHECKS;
  }
  function colourName(n, zero) { if (zero !== undefined && n === 0) return zero; const c = PAL.find(x => x.n === n); return c ? c.name : String(n); }

  function closePops() { for (const p of document.querySelectorAll('.cpop')) p.remove(); }

  /** A small colour box. Click it and a grid of the machine's colours opens. */
  function colourPicker(value, p, label, onPick) {
    const zero = p.zero;
    const wrap = h('span', { class: 'cwrap' });
    const btn = h('button', { class: 'cbtn', title: colourName(value, zero), 'aria-label': label + ': ' + colourName(value, zero), 'aria-haspopup': 'true' },
      h('i', { class: 'sw', style: swatchStyle(value, zero) }), h('span', { class: 'cname' }, colourName(value, zero)));
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const open = wrap.querySelector('.cpop'); closePops();
      if (open) return;
      const pop = h('div', { class: 'cpop', role: 'listbox' });
      const choices = PAL.filter(c => c.n >= (p.min === undefined ? 0 : p.min) && c.n <= (p.max === undefined ? 15 : p.max));
      if (zero !== undefined && !choices.some(c => c.n === 0)) choices.unshift({ n: 0, name: zero });
      for (const c of choices) {
        const sb = h('button', { class: 'sb' + (c.n === value ? ' on' : ''), title: colourName(c.n, zero), 'aria-label': colourName(c.n, zero), role: 'option' }, h('i', { class: 'sw', style: swatchStyle(c.n, zero) }));
        sb.addEventListener('click', (e) => { e.stopPropagation(); closePops(); onPick(c.n); });
        pop.append(sb);
      }
      wrap.append(pop);
      const first = pop.querySelector('.on') || pop.querySelector('.sb'); if (first) first.focus();
    });
    wrap.append(btn);
    return wrap;
  }
  document.addEventListener('mousedown', (ev) => { if (!ev.target.closest || !ev.target.closest('.cwrap')) closePops(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePops(); });

  // ---------- one block ----------
  function paramInput(def, b, name, p, listPath, idx) {
    const set = (v) => { E.setParam(P, listPath, idx, name, v, def); changed(false); };
    if (p.type === 'colour' && PAL.length) return colourPicker(b[name] === undefined ? p.default : b[name], p, words(name), set);
    if (p.type === 'number' || p.type === 'colour') {
      const inp = h('input', { type: 'number', value: b[name] === undefined ? p.default : b[name], min: p.min, max: p.max, title: p.about || '', 'aria-label': words(name) });
      inp.addEventListener('change', () => set(inp.value));
      return inp;
    }
    if (p.type === 'choice') {
      const cur = b[name] === undefined ? p.default : b[name];
      const sel = h('select', { 'aria-label': words(name), title: p.about || '' }, p.options.map(([v, label]) => h('option', { value: v, selected: cur === v }, label)));
      sel.addEventListener('change', () => set(sel.value));
      return sel;
    }
    if (p.type === 'tile') {
      const names = Object.keys(P.tiles || {});
      const list = names.includes(b[name]) ? names : [''].concat(names);
      const sel = h('select', { 'aria-label': words(name), title: p.about || '' }, list.map(t => h('option', { value: t, selected: b[name] === t }, t === '' ? '(choose a tile)' : t)));
      sel.addEventListener('change', () => set(sel.value));
      return sel;
    }
    if (p.type === 'thing') {
      const sel = h('select', { 'aria-label': words(name) }, Object.keys(P.things || {}).map(t => h('option', { value: t, selected: b[name] === t }, t)));
      sel.addEventListener('change', () => set(sel.value));
      return sel;
    }
    const opts = name === 'sound' ? SOUNDS : null;
    if (opts && opts.length) {
      // never show a sound that is not really saved: if none is chosen yet, say so
      const shown = opts.includes(b[name]) ? opts : [''].concat(opts);
      const sel = h('select', { 'aria-label': words(name) }, shown.map(t => h('option', { value: t, selected: b[name] === t }, t === '' ? '(choose a sound)' : t)));
      sel.addEventListener('change', () => set(sel.value));
      return sel;
    }
    const inp = h('input', { type: 'text', value: b[name] === undefined ? '' : b[name], 'aria-label': words(name) });
    inp.addEventListener('change', () => set(inp.value));
    return inp;
  }

  function blockCard(b, listPath, idx) {
    const def = CAT[b.block];
    const here = listPath.concat([idx]).join('/');
    const card = h('div', { class: 'block' + (selected === here ? ' selected' : ''), style: '--hue:' + hue(def ? def.category : 'x') });
    card.addEventListener('click', (ev) => { if (ev.target.closest('input,select,button')) return; if (selected !== here) { selected = here; render(); } ev.stopPropagation(); });
    const handle = h('span', { class: 'handle', draggable: 'true', title: (def ? def.about : '') + ' (drag to move)' },
      h('span', { class: 'grip', 'aria-hidden': 'true' }, '⠇'), h('span', { class: 'bname' }, def ? def.name : 'Unknown block: ' + b.block));
    handle.addEventListener('dragstart', (ev) => {
      dragging = { t: 'move', list: listPath, idx, id: b.block };
      ev.dataTransfer.setData('text/plain', 'block'); ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setDragImage(card, 12, 12); } catch (e) { /* the default picture is fine */ }
      setTimeout(() => document.body.classList.add('dragging'), 0);
    });
    handle.addEventListener('dragend', () => { dragging = null; document.body.classList.remove('dragging'); });
    const simple = def ? Object.entries(def.params).filter(([name, p]) => p.type !== 'blocks' && E.shown(def, b, name)) : [];
    const row = h('div', { class: 'brow' }, handle,
      h('span', { class: 'params' }, simple.map(([name, p]) => h('label', {}, h('span', {}, words(name)), paramInput(def, b, name, p, listPath, idx)))),
      h('span', { class: 'tools' },
        h('button', { class: 'icon', title: 'Show the code this block makes', 'aria-label': 'Show the code this block makes', onclick: () => { selected = here; view = 'code'; render(); } }, '{ }'),
        h('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move up', disabled: idx === 0, onclick: () => { E.moveBlock(P, listPath, idx, listPath, idx - 1, CAT); changed(true); } }, '▲'),
        h('button', { class: 'icon', title: 'Move down', 'aria-label': 'Move down', onclick: () => { E.moveBlock(P, listPath, idx, listPath, idx + 2, CAT); changed(true); } }, '▼'),
        h('button', { class: 'icon', title: 'Delete this block', 'aria-label': 'Delete this block', onclick: () => { E.removeBlock(P, listPath, idx); changed(true); } }, '×')));
    card.append(row);
    if (def) {
      for (const [name, p] of Object.entries(def.params)) {
        if (p.type !== 'blocks') continue;
        card.append(h('div', { class: 'inner' }, h('div', { class: 'innertitle' }, 'then do these:'), listView(listPath.concat([idx, name]))));
      }
    }
    return card;
  }

  // ---------- a list of blocks, with a drop gap before and after every block ----------
  function allowed(listPath) {
    if (!dragging) return false;
    const def = CAT[dragging.id];
    if (!E.canDrop(def, listPath)) return false;
    if (dragging.t === 'move' && E.isInside(dragging.list.concat([dragging.idx]), listPath)) return false;
    return true;
  }

  function gap(listPath, at, empty) {
    const g = h('div', { class: 'gap' + (empty ? ' empty' : '') }, empty ? h('span', {}, 'Drop a block here') : null);
    g.addEventListener('dragover', (ev) => { if (!allowed(listPath)) return; ev.preventDefault(); ev.stopPropagation(); g.classList.add('over'); });
    g.addEventListener('dragleave', () => g.classList.remove('over'));
    g.addEventListener('drop', (ev) => {
      ev.preventDefault(); ev.stopPropagation(); g.classList.remove('over');
      if (!allowed(listPath)) return;
      active = listPath;
      if (dragging.t === 'new') E.insertBlock(P, listPath, at, E.newBlock(CAT[dragging.id], P, SOUNDS));
      else E.moveBlock(P, dragging.list, dragging.idx, listPath, at, CAT);
      dragging = null; document.body.classList.remove('dragging');
      changed(true);
    });
    return g;
  }

  function listView(listPath) {
    const list = E.listAt(P, listPath) || [];
    const box = h('div', { class: 'list' + (sameList(active, listPath) ? ' active' : '') });
    box.addEventListener('mousedown', (ev) => { if (!sameList(active, listPath)) { active = listPath; for (const l of document.querySelectorAll('.list.active')) l.classList.remove('active'); box.classList.add('active'); } ev.stopPropagation(); });
    if (!list.length) box.append(gap(listPath, 0, true));
    list.forEach((b, i) => { box.append(gap(listPath, i), blockCard(b, listPath, i)); });
    if (list.length) box.append(gap(listPath, list.length));
    return box;
  }

  // ---------- the pieces of the page ----------
  function palette() {
    const wrap = h('div', { class: 'palette' }, h('h2', {}, 'Blocks'), h('p', { class: 'muted small' }, 'Drag a block into a list, or click one to add it to the list you last clicked in.'));
    for (const cat of CATS) {
      wrap.append(h('h3', {}, cat.name));
      for (const d of cat.blocks) {
        const it = h('div', { class: 'pitem', draggable: 'true', title: d.about + (d.when === 'start' ? ' (start only)' : d.when === 'frame' ? ' (every frame only)' : ''), style: '--hue:' + hue(d.category), tabindex: '0', role: 'button' }, d.name);
        it.addEventListener('dragstart', (ev) => { dragging = { t: 'new', id: d.id }; ev.dataTransfer.setData('text/plain', d.id); ev.dataTransfer.effectAllowed = 'copy'; setTimeout(() => document.body.classList.add('dragging'), 0); });
        it.addEventListener('dragend', () => { dragging = null; document.body.classList.remove('dragging'); });
        const add = () => {
          let target = active;
          if (!E.canDrop(d, target)) target = [d.when === 'start' ? 'start' : 'every_frame'];
          const list = E.listAt(P, target); if (!list) return;
          E.insertBlock(P, target, list.length, E.newBlock(d, P, SOUNDS));
          active = target; changed(true);
        };
        it.addEventListener('click', add);
        it.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); add(); } });
        wrap.append(it);
      }
    }
    return wrap;
  }

  function thingsView() {
    const names = Object.keys(P.things || {});
    if (!names.length) return h('p', { class: 'muted' }, 'This game has no things yet.');
    const num = (name, key, min, max) => { const i = h('input', { type: 'number', value: P.things[name][key], min, max, 'aria-label': name + ' ' + key }); i.addEventListener('change', () => { E.setThing(P, name, key, i.value); changed(false); }); return h('td', {}, i); };
    const col = (name) => h('td', {}, PAL.length
      ? colourPicker(P.things[name].color === undefined ? 15 : P.things[name].color, { min: 1, max: 15 }, name + ' colour', (n) => { E.setThing(P, name, 'color', n); changed(false); })
      : (() => { const i = h('input', { type: 'number', value: P.things[name].color, min: 0, max: 15, 'aria-label': name + ' colour' }); i.addEventListener('change', () => { E.setThing(P, name, 'color', i.value); changed(false); }); return i; })());
    return h('table', { class: 'things' },
      h('thead', {}, h('tr', {}, ['Thing', 'Drawing', 'x', 'y', 'width', 'height', 'colour'].map(t => h('th', {}, t)))),
      h('tbody', {}, names.map(n => h('tr', {}, h('td', {}, n), h('td', { class: 'muted' }, P.things[n].art || '(none)'), num(n, 'x', 0, 255), num(n, 'y', 0, 191), num(n, 'w', 0, 255), num(n, 'h', 0, 191), col(n)))));
  }

  /** Tiles: a name for a picture that can be drawn all over the screen. The pictures themselves live in the pictures file. */
  function tilesView() {
    const tiles = P.tiles || {};
    const names = Object.keys(tiles);
    const picName = (l) => l;
    const sizeOf = (art) => {
      const pic = PICS.find(x => x.label === art);
      if (!pic) return h('span', { class: 'bad' }, art ? art + ' is not in the data yet' : 'no picture chosen');
      const sh = pic.shape;
      return sh && sh.error ? h('span', { class: 'bad' }, sh.error, sh.fix ? [' ', h('button', { title: 'Store this picture piece by piece (the drawing stays the same)', onclick: () => vscode.postMessage({ type: 'fixPicture', label: art }) }, 'Fix it')] : null) : h('span', { class: 'muted' }, sh.across + ' x ' + sh.down + ' pieces (' + pic.w + ' x ' + pic.h + ' dots)');
    };
    const pickPic = (cur, onpick, label, usableOnly) => {
      const labels = PICS.filter(x => !usableOnly || !(x.shape && x.shape.error)).map(x => x.label);
      const list = labels.includes(cur) ? labels : [cur || ''].concat(labels);
      const sel = h('select', { 'aria-label': label }, list.map(t => h('option', { value: t, selected: cur === t }, t === '' ? '(choose a picture)' : picName(t))));
      sel.addEventListener('change', () => onpick(sel.value));
      return sel;
    };
    const rows = names.map(n => h('tr', {},
      h('td', {}, n),
      h('td', {}, pickPic(tiles[n].art, (v) => { E.setTile(P, n, 'art', v); changed(false); }, n + ' picture')),
      h('td', {}, sizeOf(tiles[n].art)),
      h('td', {}, h('button', { class: 'icon', title: 'Make a copy of this tile and its picture, to draw a new one', onclick: () => vscode.postMessage({ type: 'copyTile', tile: n }) }, 'Copy'),
        h('button', { class: 'icon', title: 'Draw this picture', onclick: () => vscode.postMessage({ type: 'editPicture', label: tiles[n].art }) }, 'Edit picture'),
        h('button', { class: 'icon', title: 'Take this tile out of the game', 'aria-label': 'Remove ' + n, onclick: () => { delete P.tiles[n]; changed(true); } }, '×'))));
    const nameIn = h('input', { type: 'text', placeholder: 'name of a new tile', 'aria-label': 'Name of a new tile' });
    const usable = PICS.filter(x => !(x.shape && x.shape.error));
    const artSel = pickPic(usable.length ? usable[0].label : '', () => {}, 'Picture for the new tile', true);
    const add = () => {
      if (!E.addTile(P, nameIn.value, artSel.value)) { status = 'A tile name needs letters or digits, and can’t be one you already have.'; render(); return; }
      changed(true);
    };
    return h('div', {},
      names.length ? h('table', { class: 'things' }, h('thead', {}, h('tr', {}, ['Tile', 'Picture', 'Size', ''].map(t => h('th', {}, t)))), h('tbody', {}, rows)) : h('p', { class: 'muted' }, 'No tiles yet. A tile is a picture you draw, repeated over the screen (a brick, an alien, a crate).'),
      h('div', { class: 'addrow' }, nameIn, artSel, h('button', { onclick: add }, 'Add a tile'),
        h('button', { onclick: () => vscode.postMessage({ type: 'newPicture' }) }, 'New picture')),
      DATAFILE ? h('p', { class: 'muted small' }, 'Pictures and sounds live in ' + DATAFILE + '. Making the game never changes that file.')
        : h('p', { class: 'muted small' }, 'This game keeps its pictures inside the blocks file, so they can’t be drawn here. ', h('button', { onclick: () => vscode.postMessage({ type: 'moveData' }) }, 'Move pictures and sounds to their own file')));
  }

  /** The assembly, a line at a time. The lines of the chosen block are lit up; click a line to choose its block. */
  function codeView() {
    const lines = asm ? asm.split('\n') : [];
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const lit = (p) => selected && p && (p === selected || p.startsWith(selected + '/'));
    const box = h('div', { class: 'codebox' });
    if (!lines.length) box.append(h('div', { class: 'muted' }, problems.length ? 'The code appears here once the game can be made.' : '(nothing yet)'));
    lines.forEach((l, i) => {
      const p = paths[i] || null;
      const el = h('div', { class: 'cl' + (lit(p) ? ' hl' : '') + (p ? ' mine' : ''), title: p ? 'Click to choose the block that wrote this line' : '' }, l === '' ? ' ' : l);
      if (p) el.addEventListener('click', () => { selected = p; view = 'blocks'; render(); const c = document.querySelector('.block.selected'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' }); });
      box.append(el);
    });
    return box;
  }

  function render() {
    const root = $('root');
    const keep = window.scrollY;
    root.textContent = '';
    if (error) { root.append(h('div', { class: 'note error' }, error)); return; }
    if (!P) { root.append(h('p', { class: 'muted' }, 'Loading...')); return; }
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      h('button', { class: 'tab' + (view === 'blocks' ? ' on' : ''), role: 'tab', 'aria-selected': String(view === 'blocks'), onclick: () => { view = 'blocks'; render(); } }, 'Blocks'),
      h('button', { class: 'tab' + (view === 'code' ? ' on' : ''), role: 'tab', 'aria-selected': String(view === 'code'), onclick: () => { view = 'code'; render(); } }, 'Code'));
    const top = [
      h('header', {},
        h('h1', {}, P.title || 'Game'),
        h('span', { class: 'muted' }, fileName),
        h('span', { class: 'grow' }),
        h('button', { class: 'primary', title: 'Make the game file from these blocks, then start it in MAME', onclick: () => vscode.postMessage({ type: 'run' }) }, 'Make and run in MAME'),
        h('button', { onclick: () => vscode.postMessage({ type: 'make' }) }, 'Make the game file'),
        h('button', { onclick: () => vscode.postMessage({ type: 'openJson' }) }, 'Open the blocks file')),
      P.about ? h('p', { class: 'muted' }, P.about) : null,
      status ? h('div', { class: 'note ok' }, status) : null,
      problems.length ? h('div', { class: 'note error' }, h('strong', {}, 'This game can’t be made yet:'), h('ul', {}, problems.map(t => h('li', {}, t)))) : null,
      tabs];
    if (view === 'code') {
      root.append(h('div', { class: 'layout' }, h('div', { class: 'main wide' }, top, h('p', { class: 'muted small' }, 'Each line comes from the block that wrote it. Lines of the chosen block are lit; click any line to find its block. Lines with no block are shared routines.'), codeView())));
      const first = document.querySelector('.cl.hl'); if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' });
      return;
    }
    const main = h('div', { class: 'main' }, top,
      h('h2', {}, 'Things'), thingsView(),
      h('h2', {}, 'Tiles'), tilesView(),
      h('h2', {}, 'When the game starts'), h('p', { class: 'muted small' }, 'These run once, from the top.'), listView(['start']),
      h('h2', {}, 'Every frame'), h('p', { class: 'muted small' }, 'These run 60 times a second, from the top.'), listView(['every_frame']));
    root.append(h('div', { class: 'layout' }, palette(), main));
    window.scrollTo(0, keep);
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.type !== 'state') return;
    error = m.error || '';
    if (m.project) P = m.project;
    if (m.palette) PAL = m.palette;
    if (m.catalogue) {
      CAT = {}; const by = {};
      for (const d of m.catalogue) { CAT[d.id] = d; (by[d.category] = by[d.category] || []).push(d); }
      CATS = Object.keys(by).sort().map(name => ({ name, blocks: by[name] }));
    }
    problems = m.problems || []; asm = m.asm || ''; paths = m.paths || []; fileName = m.fileName || ''; status = m.status || '';
    PICS = m.pictures || []; SOUNDS = m.sounds || []; DATAFILE = m.dataFile || '';
    if (P && !E.listAt(P, active)) active = ['every_frame'];
    render();
  });
  document.addEventListener('dragover', (ev) => { if (dragging) ev.preventDefault(); });
  vscode.postMessage({ type: 'ready' });
})();
