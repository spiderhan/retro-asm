# Quick start

Ten minutes from nothing to a built program. The full details are in `README.md`.

## 1. Install the extension

1. In VS Code, open the Extensions panel.
2. Click the `...` menu at the top of it and choose **Install from VSIX...**
3. Pick the newest `retro-asm-<version>.vsix`.

## 2. Get the tools (once)

The extension reads and checks your code by itself. To **build** and **run**, each computer also needs two free programs: an assembler (turns your code into a program) and an emulator (pretends to be the computer).

Press **Ctrl+Shift+P** and run **Retro ASM: Set up tools**. It shows what each computer needs, what it found, and where to get the rest. Pick a line to open its download page.

| Computer | Assembler | Emulator | Also needs |
|---|---|---|---|
| TI-99/4A | xas99 | Classic99 (Windows only) | Python 3 |
| ZX Spectrum | sjasmplus | Fuse | |
| Commodore 64 | KickAssembler (`KickAss.jar`) | VICE | Java |
| BBC Micro | BeebAsm | BeebEm (Windows only) | |

**The easy way:** download each one and unpack it into `retro-asm-tools` in your home folder (the first line of **Set up tools** opens it). The folder names inside don't matter. For KickAssembler, put `KickAss.jar` in there. Things you already installed the normal way are found too.

When everything has a tick, you're done. Nothing needs setting up again.

## 3. Your first program

| Computer | Make a file ending in | Then |
|---|---|---|
| TI-99/4A | `.a99` | nothing extra |
| ZX Spectrum | `.z80` | nothing extra |
| BBC Micro | `.6502` | nothing extra |
| Commodore 64 | `.asm` | add `"files.associations": { "*.asm": "retroasm" }` to your VS Code settings first |

1. On the first empty line, type `program` and press **Enter**. A whole starting program appears (press **Tab** to jump between the spots to fill in).
2. Write your code where it says. Hover over anything for a plain-English explanation.
3. Press **Ctrl+Alt+B** to build. Mistakes are underlined in the code and listed in the Problems panel.
4. Press **F5** to build and start the emulator.

Two things the emulator needs from your code:

- **ZX Spectrum:** a `SAVESNA "game.sna",start` line (the starter code has one).
- **BBC Micro:** a `SAVE "Name", start, end` line, so the disc starts the program by itself.

## 4. Keys worth knowing

On a Mac, use Cmd instead of Ctrl.

| Keys | What it does |
|---|---|
| **Ctrl+Alt+B** | Build |
| **F5** | Build, then start the emulator |
| **Ctrl+Alt+E** | Explain the selected lines in plain English |
| **Ctrl+Alt+A** | Show or hide each line's memory address |
| **Ctrl+Alt+T** | Show or hide how many cycles each line takes |
| **Shift+Alt+U** | Tidy the letter case (instructions, registers, labels), so you never need Caps Lock |
| **Shift+Alt+L** | Line up the label, instruction, operands and comment in columns |
| **F12** / **Shift+F12** | Go to where a label is defined / find where it is used |

Everything else is in **Ctrl+Shift+P**: type `Retro ASM`. Useful ones: **Show the cheat sheet for this chip**, **Insert starter code**, **New picture here** (draw sprites with the mouse), **Switch chip**, and (TI-99/4A only) **Convert the whole file to xas99 style**.

## 5. Find your way around

- **Side panel:** click the chip icon on the bar down the left. It shows your program's size and files, what the current line does, what is in each register, the memory map and the hardware you use.
- **Hover:** instructions, labels, numbers, registers and machine routines all explain themselves.
- **Underlines:** wavy lines are mistakes the extension spotted before the assembler did. Hover to see why.

## 6. If something doesn't work

| What you see | What to do |
|---|---|
| "... wasn't found" when you build | Run **Set up tools**, or unpack the tool into `retro-asm-tools`. |
| F5 says a file "was not made" | The build didn't make what the emulator needs: add the `SAVESNA` (Spectrum) or `SAVE` (BBC) line. |
| F5 does nothing on a Mac or Linux for the TI or BBC | Classic99 and BeebEm are Windows only. Set `retroAsm.build.runCommand` to another emulator. |
| A `.asm` file isn't coloured | Add the `files.associations` setting from step 3. |
| It's reading my file as the wrong computer | **Ctrl+Shift+P**, then **Retro ASM: Switch chip**. The chip's name is also in the bottom-right corner. |
| Asked "This project wants to run ..." | Normal the first time a project brings its own build script or tool. Check the command shown and choose **Allow**. |
| Everything else the assembler said | **Retro ASM: Show what the assembler said**. |
