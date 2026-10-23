# Retro Assembly Helper: instructions for Claude

This is Ian's VS Code extension for reading and writing retro assembly code (publisher `hanmade`). Read this file first, then `README.md` and `CHANGELOG.md`. The current version is in `package.json`.

## What it is

It gives plain-English tooltips, colours, warnings and quick navigation for four computers:

| Computer | Chip | Assembler | Files |
|---|---|---|---|
| TI-99/4A | TMS9900 | xas99 | `.a99` |
| ZX Spectrum | Z80 | sjasmplus | `.z80` |
| Commodore 64 | 6502 | KickAssembler | `.asm` |
| BBC Micro | 6502 / 65C02 | BeebAsm | `.6502` |

Each chip is a data file in `dialects/` (`tms9900.json`, `z80.json`, `6502.json`, `bbc.json`). Adding a chip means adding a data file, not new code. `templates/new-dialect.json` is the starting point.

## How the code is laid out

Plain JavaScript. There is no build step.

- `extension.js` is the only file that talks to VS Code.
- `lib/` holds the logic and does not need VS Code to run: `parser`, `project`, `layout`, `analysis`, `explain`, `features`, `build`, `decoders`, `skool`, `caseformat`, `sprites`, `timing`, and the panel pages.
- `test/` holds the checks. `test/mock-vscode.js` stands in for VS Code in the quick tests.

Keep new logic in `lib/` so it can be tested without VS Code. Keep `extension.js` thin.

## Standing decisions

- **Keep it general.** The extension must work for any program. Never mention any specific game or personal project in code, tests, README, CHANGELOG or this file.
- **Test files are made up.** Files in `test/fixtures` must be invented code, never pieces copied from a real game.
- **No AI features for now.** If one is ever added, users must connect their own AI subscription. Nothing may use Ian's own keys.
- **Easy to install.** Anything the extension needs (snippets, templates, icons) ships inside it. No extra setup for the user.
- **No other extensions needed.** For example, the case formatter is built in.
- **Don't commit or push to GitHub unless Ian asks.** The repo is private for now.

## Checks

Run these from the project folder.

| Command | What it checks |
|---|---|
| `node test/ext-test.js` | Main test run. Set `XAS99` to the path of `xas99.py` to include the build step. |
| `node test/lib-test.js misc` | The logic in `lib/` |
| `node test/case-test.js` | Letter-case changing |
| `node test/real-check.js <folder>` | Reads a folder of real code. A clean, correct program must give 0 warnings. |
| `node test/layout-check.js file.a99 file.lst` | Compares addresses with an xas99 `-L` listing |
| `npm run test:vscode` | Runs inside real VS Code. Set `CLASSIC99` to also test the F5 run. |

`real-check.js` and `layout-check.js` need real code from outside the repo. Ask Ian for the folder. Ask before writing anything in that folder.

## When a change is done

Do all of these, in order:

1. Run the checks that apply.
2. Bump the version in `package.json`.
3. Update `README.md` and `CHANGELOG.md`. Add a new section at the top of the changelog, in the same plain style as the others.
4. Package a new `.vsix` into this folder:
   `npx @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license`
5. Tell Ian plainly **what was tested and what was not**. Say if something could not be run (for example, no xas99 or no real VS Code).

`.vsix` files are ignored by git. Leave the old ones alone.

## How to write for Ian

- Keep explanations simple, with little jargon. Say what a thing does before what it is called.
- Do the same inside the extension. Tooltips and messages are in plain English.
- Say what you did and did not check. Don't claim something works if you only read the code.
