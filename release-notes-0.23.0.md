## Retro Assembly Helper 0.23.0: sound player (TI-99/4A)

You can now hear the sounds you keep in your code.

### How to use it

1. Put a comment with `@sound` just above a block of BYTE or DATA lines.
2. Click the **Play sound** link that appears above it.
3. A player opens beside your code.

```
* @sound
BEEP   BYTE 3,>8E,>0F,>90,10     ; voice 1 at about 440 Hz, for 10/60 s
       BYTE 1,>9F,1              ; voice 1 off
       BYTE 0                    ; the end
```

### What the player gives you

- Play, Stop and repeat.
- A picture of the pitch and loudness of the three tone voices and the noise.
- A table of the steps, saying in plain English what each byte does.
- Live updates: change a number in your code and the player follows. The player never changes your code.

### The layout it reads

It reads the console's sound list. Each step is a count, then that many bytes for the sound chip, then how long to wait in 60ths of a second. A count of 0 ends the list.

### Also new

- A block named like a sound (`SND_...`, `MUSIC`, `BEEP`, `TUNE`) that reads cleanly as a sound list gets a **Play as a sound?** link, even without the marker.
- A list that doesn't add up shows what is wrong.
- Setting `retroAsm.soundLinks` switches the links off.
- Command **Retro ASM: Play these bytes as a sound** plays the block at the cursor.
- A made-up example, `examples/sounds/sounds.a99`, is in the repository. It isn't in the `.vsix`.

### Good to know

- This is the TI-99/4A only for now. The other computers have different sound chips, so each needs its own player.
- This is a player only. Drawing and editing sounds isn't in this version.

### What was and wasn't tested

- **Tested:** reading sound lists, the pitch (pitch number 254 gives about 440 Hz), volume steps, noise, the example file, the player page's script, and the links and player in a stand-in for VS Code. The main test run passes.
- **Not tested:** nobody has listened to it yet. It hasn't been tried in real VS Code, or against a real TI or MAME. How a count of 0 ends a list follows general knowledge of the TI sound list, not TI's manual.

### Install

Download `retro-asm-0.23.0.vsix` below, then in VS Code use **Extensions → ⋯ → Install from VSIX...**
