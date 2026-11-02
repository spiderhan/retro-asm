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
.bad { color: var(--vscode-errorForeground); } .addrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; }
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
.brow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
.handle { display: inline-flex; align-items: center; gap: 6px; cursor: grab; min-width: 12em; } .bname { font-weight: 600; } .grip { opacity: .5; }
.tools { display: flex; margin-left: auto; }
.params { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
.params label { display: flex; align-items: center; gap: 5px; } .params label span { color: var(--vscode-descriptionForeground); }
input, select { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, #8886); border-radius: 3px; padding: 1px 4px; }
input[type=number] { width: 4.6em; } input[type=text] { width: 9em; }
.block.selected { outline: 2px solid var(--vscode-focusBorder); }
.cwrap { position: relative; display: inline-block; }
button.cbtn { display: inline-flex; align-items: center; gap: 6px; padding: 1px 8px 1px 4px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, #8886); }
.sw { display: inline-block; width: 18px; height: 14px; border-radius: 3px; border: 1px solid #0006; } .cname { white-space: nowrap; }
.cpop { position: absolute; z-index: 10; top: 100%; left: 0; margin-top: 3px; padding: 6px; display: grid; grid-template-columns: repeat(4, auto); gap: 4px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-focusBorder); border-radius: 6px; box-shadow: 0 4px 14px #0006; }
button.sb { padding: 3px; background: transparent; border: 2px solid transparent; border-radius: 5px; } button.sb .sw { width: 32px; height: 24px; } button.sb:hover, button.sb:focus, button.sb.on { border-color: var(--vscode-focusBorder); outline: none; }
.tabs { display: flex; gap: 4px; margin: 10px 0 4px; border-bottom: 1px solid var(--vscode-panel-border, #8885); }
button.tab { background: transparent; color: var(--vscode-foreground); border-radius: 4px 4px 0 0; border-bottom: 2px solid transparent; padding: 4px 16px; } button.tab.on { border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
.main.wide { max-width: none; }
.codebox { font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 12px); background: var(--vscode-textCodeBlock-background); border-radius: 6px; padding: 8px 0; overflow-x: auto; }
.cl { white-space: pre; padding: 0 12px; border-left: 3px solid transparent; } .cl.mine { cursor: pointer; } .cl.mine:hover { background: var(--vscode-list-hoverBackground, #8882); }
.cl.hl { background: var(--vscode-editor-findMatchHighlightBackground, #ea5c0055); border-left-color: var(--vscode-focusBorder); }
.inner { margin: 6px 0 0 18px; } .innertitle { color: var(--vscode-descriptionForeground); font-size: .92em; }
.gap { height: 6px; border-radius: 3px; transition: height .08s; }
.gap.empty { height: auto; min-height: 26px; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: .92em; }
body.dragging .gap { background: var(--vscode-editor-selectionBackground, #8883); height: 12px; } body.dragging .gap.empty { height: auto; }
body.dragging .gap.over { background: var(--vscode-focusBorder); height: 14px; }
table.things { border-collapse: collapse; } .things th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 2px 12px 2px 0; } .things td { padding: 2px 12px 2px 0; }
.note { border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700); padding: 6px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 0 4px 4px 0; margin: 8px 0; }
.note.error { border-left-color: var(--vscode-editorError-foreground, #f14c4c); } .note.ok { border-left-color: var(--vscode-testing-iconPassed, #3fb950); } .note ul { margin: 4px 0 0 18px; padding: 0; }
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
