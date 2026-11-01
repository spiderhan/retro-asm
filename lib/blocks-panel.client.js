// The blocks panel's page script. It runs inside the VS Code panel (a web page), not in the extension.
// The extension puts the editing rules (lib/blocks-edit.js) in front of this as `E`, and sends the
// project and the list of blocks as a 'state' message. Every change is sent back as 'change'.
/* global E, acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let P = null, CAT = {}, CATS = [], problems = [], asm = '', error = '', fileName = '';
  let active = ['every_frame'];
  let dragging = null;
  let status = '';

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

  function changed() {
    vscode.postMessage({ type: 'change', project: P });
    render();
  }

  // ---------- the sounds this game has (a "@sound" line in the data, then its label) ----------
  function soundLabels() {
    const out = [], d = (P && P.data) || [];
    for (let i = 0; i < d.length; i++) {
      if (/^\*\s*@sound\b/i.test(d[i])) { const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(d[i + 1] || ''); if (m) out.push(m[1]); }
    }
    return out;
  }

  // ---------- one block ----------
  function paramInput(def, b, name, p, listPath, idx) {
    const set = (v) => { E.setParam(P, listPath, idx, name, v, def); changed(); };
    if (p.type === 'number') {
      const inp = h('input', { type: 'number', value: b[name] === undefined ? p.default : b[name], min: p.min, max: p.max, title: p.about || '', 'aria-label': words(name) });
      inp.addEventListener('change', () => set(inp.value));
      return inp;
    }
    if (p.type === 'thing') {
      const sel = h('select', { 'aria-label': words(name) }, Object.keys(P.things || {}).map(t => h('option', { value: t, selected: b[name] === t }, t)));
      sel.addEventListener('change', () => set(sel.value));
      return sel;
    }
    const opts = name === 'sound' ? soundLabels() : null;
    if (opts && opts.length) {
      const sel = h('select', { 'aria-label': words(name) }, opts.map(t => h('option', { value: t, selected: b[name] === t }, t)));
      sel.addEventListener('change', () => set(sel.value));
      return sel;
    }
    const inp = h('input', { type: 'text', value: b[name] === undefined ? '' : b[name], 'aria-label': words(name) });
    inp.addEventListener('change', () => set(inp.value));
    return inp;
  }

  function blockCard(b, listPath, idx) {
    const def = CAT[b.block];
    const card = h('div', { class: 'block', style: '--hue:' + hue(def ? def.category : 'x') });
    const head = h('div', { class: 'bhead', draggable: 'true', title: def ? def.about : '' },
      h('span', { class: 'grip', 'aria-hidden': 'true' }, '⠇'),
      h('span', { class: 'bname' }, def ? def.name : 'Unknown block: ' + b.block),
      h('span', { class: 'tools' },
        h('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move up', disabled: idx === 0, onclick: () => { E.moveBlock(P, listPath, idx, listPath, idx - 1, CAT); changed(); } }, '▲'),
        h('button', { class: 'icon', title: 'Move down', 'aria-label': 'Move down', onclick: () => { E.moveBlock(P, listPath, idx, listPath, idx + 2, CAT); changed(); } }, '▼'),
        h('button', { class: 'icon', title: 'Delete this block', 'aria-label': 'Delete this block', onclick: () => { E.removeBlock(P, listPath, idx); changed(); } }, '×')));
    head.addEventListener('dragstart', (ev) => {
      dragging = { t: 'move', list: listPath, idx, id: b.block };
      ev.dataTransfer.setData('text/plain', 'block'); ev.dataTransfer.effectAllowed = 'move';
      setTimeout(() => document.body.classList.add('dragging'), 0);
    });
    head.addEventListener('dragend', () => { dragging = null; document.body.classList.remove('dragging'); });
    card.append(head);
    if (def) {
      const simple = Object.entries(def.params).filter(([, p]) => p.type !== 'blocks');
      if (simple.length) card.append(h('div', { class: 'params' }, simple.map(([name, p]) => h('label', {}, h('span', {}, words(name)), paramInput(def, b, name, p, listPath, idx)))));
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
      if (dragging.t === 'new') E.insertBlock(P, listPath, at, E.newBlock(CAT[dragging.id], P));
      else E.moveBlock(P, dragging.list, dragging.idx, listPath, at, CAT);
      dragging = null; document.body.classList.remove('dragging');
      changed();
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
          E.insertBlock(P, target, list.length, E.newBlock(d, P));
          active = target; changed();
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
    const num = (name, key, min, max) => { const i = h('input', { type: 'number', value: P.things[name][key], min, max, 'aria-label': name + ' ' + key }); i.addEventListener('change', () => { E.setThing(P, name, key, i.value); changed(); }); return h('td', {}, i); };
    return h('table', { class: 'things' },
      h('thead', {}, h('tr', {}, ['Thing', 'Drawing', 'x', 'y', 'width', 'height', 'colour'].map(t => h('th', {}, t)))),
      h('tbody', {}, names.map(n => h('tr', {}, h('td', {}, n), h('td', { class: 'muted' }, P.things[n].art || '(none)'), num(n, 'x', 0, 255), num(n, 'y', 0, 191), num(n, 'w', 0, 255), num(n, 'h', 0, 191), num(n, 'color', 0, 15)))));
  }

  function render() {
    const root = $('root');
    const keep = window.scrollY;
    root.textContent = '';
    if (error) { root.append(h('div', { class: 'note error' }, error)); return; }
    if (!P) { root.append(h('p', { class: 'muted' }, 'Loading...')); return; }
    const main = h('div', { class: 'main' },
      h('header', {},
        h('h1', {}, P.title || 'Game'),
        h('span', { class: 'muted' }, fileName),
        h('span', { class: 'grow' }),
        h('button', { class: 'primary', onclick: () => vscode.postMessage({ type: 'make' }) }, 'Make the game file'),
        h('button', { onclick: () => vscode.postMessage({ type: 'openJson' }) }, 'Open the blocks file')),
      P.about ? h('p', { class: 'muted' }, P.about) : null,
      status ? h('div', { class: 'note ok' }, status) : null,
      problems.length ? h('div', { class: 'note error' }, h('strong', {}, 'This game can’t be made yet:'), h('ul', {}, problems.map(t => h('li', {}, t)))) : null,
      h('h2', {}, 'Things'), thingsView(),
      h('h2', {}, 'When the game starts'), h('p', { class: 'muted small' }, 'These run once, from the top.'), listView(['start']),
      h('h2', {}, 'Every frame'), h('p', { class: 'muted small' }, 'These run 60 times a second, from the top.'), listView(['every_frame']),
      h('details', { class: 'code' }, h('summary', {}, 'Show the assembly code this makes'), h('pre', {}, asm || '(nothing yet)')));
    root.append(h('div', { class: 'layout' }, palette(), main));
    window.scrollTo(0, keep);
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type !== 'state') return;
    error = m.error || '';
    if (m.project) P = m.project;
    if (m.catalogue) {
      CAT = {}; const by = {};
      for (const d of m.catalogue) { CAT[d.id] = d; (by[d.category] = by[d.category] || []).push(d); }
      CATS = Object.keys(by).sort().map(name => ({ name, blocks: by[name] }));
    }
    problems = m.problems || []; asm = m.asm || ''; fileName = m.fileName || ''; status = m.status || '';
    if (P && !E.listAt(P, active)) active = ['every_frame'];
    render();
  });
  document.addEventListener('dragover', (ev) => { if (dragging) ev.preventDefault(); });
  vscode.postMessage({ type: 'ready' });
})();
