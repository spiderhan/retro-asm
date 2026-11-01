'use strict';
// The blocks panel's web page. It loads nothing from outside (the panel's security rules forbid it).
// The editing rules (lib/blocks-edit.js) and the page script (lib/blocks-panel.client.js) are put straight in.
const fs = require('fs');
const path = require('path');

const STYLE = `
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; line-height: 1.4; }
.layout { display: flex; gap: 20px; align-items: flex-start; padding: 12px 16px 40px; }
.palette { flex: 0 0 210px; position: sticky; top: 8px; max-height: calc(100vh - 20px); overflow-y: auto; padding-right: 6px; }
.main { flex: 1 1 auto; min-width: 0; max-width: 56em; }
h1 { font-size: 1.4em; font-weight: 600; margin: 0; }
h2 { font-size: 1.1em; margin: 18px 0 4px; }
h3 { font-size: .85em; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); margin: 12px 0 4px; }
.muted { color: var(--vscode-descriptionForeground); } .small { font-size: .92em; margin: 0 0 6px; }
header { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; } .grow { flex: 1; }
button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; }
button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); } button:disabled { opacity: .35; cursor: default; }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); } button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.icon { padding: 0 6px; background: transparent; color: var(--vscode-foreground); } button.icon:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, #8884); }
.pitem { padding: 5px 8px; margin: 3px 0; border-radius: 4px; cursor: grab; background: var(--vscode-textCodeBlock-background); border-left: 4px solid hsl(var(--hue) 55% 50%); user-select: none; }
.pitem:hover, .pitem:focus { outline: 1px solid var(--vscode-focusBorder); }
.list { min-height: 30px; padding: 4px; border-radius: 6px; border: 1px dashed var(--vscode-panel-border, #8885); }
.list.active { border-color: var(--vscode-focusBorder); }
.list .list { margin: 2px 0; }
.block { border-radius: 5px; border-left: 5px solid hsl(var(--hue) 55% 50%); background: var(--vscode-textCodeBlock-background); padding: 4px 8px 6px; }
.bhead { display: flex; align-items: center; gap: 6px; cursor: grab; } .bname { font-weight: 600; flex: 1; } .grip { opacity: .5; }
.tools { display: flex; }
.params { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 4px 0 2px 18px; }
.params label { display: flex; align-items: center; gap: 5px; } .params label span { color: var(--vscode-descriptionForeground); }
input, select { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, #8886); border-radius: 3px; padding: 1px 4px; }
input[type=number] { width: 4.6em; } input[type=text] { width: 9em; }
.inner { margin: 6px 0 0 18px; } .innertitle { color: var(--vscode-descriptionForeground); font-size: .92em; }
.gap { height: 6px; border-radius: 3px; transition: height .08s; }
.gap.empty { height: auto; min-height: 26px; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: .92em; }
body.dragging .gap { background: var(--vscode-editor-selectionBackground, #8883); height: 12px; } body.dragging .gap.empty { height: auto; }
body.dragging .gap.over { background: var(--vscode-focusBorder); height: 14px; }
table.things { border-collapse: collapse; } .things th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 2px 12px 2px 0; } .things td { padding: 2px 12px 2px 0; }
.note { border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700); padding: 6px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 0 4px 4px 0; margin: 8px 0; }
.note.error { border-left-color: var(--vscode-editorError-foreground, #f14c4c); } .note.ok { border-left-color: var(--vscode-testing-iconPassed, #3fb950); } .note ul { margin: 4px 0 0 18px; padding: 0; }
details.code { margin-top: 22px; } details.code pre { overflow-x: auto; background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 6px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); }
@media (max-width: 640px) { .layout { flex-direction: column; } .palette { position: static; flex-basis: auto; max-height: none; } }
`;

function script() {
  const edit = fs.readFileSync(path.join(__dirname, 'blocks-edit.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, 'blocks-panel.client.js'), 'utf8');
  return `const E = (function () { const module = { exports: {} }; ${edit}\n return module.exports; })();\n${client}`;
}

function page(nonce, cspSource) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game blocks</title><style nonce="${nonce}">${STYLE}</style></head>
<body><div id="root"><p class="muted">Loading...</p></div>
<script nonce="${nonce}">${script()}</script></body></html>`;
}

module.exports = { page, script, STYLE };
