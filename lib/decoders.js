'use strict';
// Plain-English meanings for bytes sent to particular hardware chips.
// A chip file says which address goes with which decoder: the "ports" section for memory
// addresses (the TI's sound and video chips), "ioPorts" for IN/OUT ports (the Spectrum).

const COLOURS = ['transparent', 'black', 'medium green', 'light green', 'dark blue', 'light blue', 'dark red', 'cyan', 'medium red', 'light red', 'dark yellow', 'light yellow', 'dark green', 'magenta', 'grey', 'white'];
const h2 = (v) => '>' + (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const h4 = (v) => '>' + (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

/** One byte written to the TI sound chip (SN76489 / TMS9919). */
function sn76489(b) {
  b &= 0xFF;
  if (!(b & 0x80)) return `Sound chip: the second half of a pitch. It adds ${(b & 0x3F) * 16} to the pitch number (${b & 0x3F} x 16).`;
  const ch = (b >> 5) & 3;
  const low = b & 15;
  const who = ch === 3 ? 'the noise voice' : `voice ${ch + 1}`;
  if (b & 0x10) {
    const how = low === 15 ? 'off (silent)' : low === 0 ? 'full volume' : `quietness ${low} of 15 (0 is loudest, 15 is off)`;
    return `Sound chip: volume of ${who}: ${how}.`;
  }
  if (ch === 3) {
    const kind = low & 4 ? 'white noise (a hiss)' : 'a buzz (periodic noise)';
    const rate = ['high', 'medium', 'low', 'the pitch of voice 3'][low & 3];
    return `Sound chip: noise voice set to ${kind}, ${(low & 3) === 3 ? 'following ' + rate : rate + ' pitch'}.`;
  }
  return `Sound chip: pitch of ${who}, first half. The lowest 4 bits of the pitch number are ${low}. The next byte sent gives the rest.`;
}

/** What a value means in one of the TMS9918A video chip's 8 registers. */
function vdpRegister(reg, v) {
  v &= 0xFF; reg &= 7;
  const head = `Video register ${reg} = ${h2(v)}: `;
  switch (reg) {
    case 0: return head + ((v & 2) ? 'bitmap mode' : 'normal character mode') + ((v & 1) ? ', external video on' : '') + '.';
    case 1: {
      const bits = [];
      bits.push(v & 0x80 ? '16K video memory' : '4K video memory');
      bits.push(v & 0x40 ? 'screen ON' : 'screen OFF (blank)');
      bits.push(v & 0x20 ? 'frame interrupt on' : 'frame interrupt off');
      if (v & 0x10) bits.push('text mode (40 columns)');
      if (v & 0x08) bits.push('multicolour mode');
      bits.push(v & 0x02 ? '16x16 sprites' : '8x8 sprites');
      if (v & 0x01) bits.push('sprites doubled in size');
      return head + bits.join(', ') + '.';
    }
    case 2: return head + `the screen grid (name table) is at video address ${h4(v * 0x400)}.`;
    case 3: return head + `the colour table is at video address ${h4(v * 0x40)}.`;
    case 4: return head + `the character drawings (pattern table) are at video address ${h4(v * 0x800)}.`;
    case 5: return head + `the sprite list (attribute table) is at video address ${h4(v * 0x80)}.`;
    case 6: return head + `the sprite drawings are at video address ${h4(v * 0x800)}.`;
    default: return head + `text colour ${COLOURS[v >> 4]}, border and background ${COLOURS[v & 15]}.`;
  }
}

// ---------------------------------------------------------------------------
// ZX Spectrum
// ---------------------------------------------------------------------------
const ZX_COLOURS = ['black', 'blue', 'red', 'magenta', 'green', 'cyan', 'yellow', 'white'];
const ZX_ROWS = [
  ['CAPS SHIFT', 'Z', 'X', 'C', 'V'], ['A', 'S', 'D', 'F', 'G'], ['Q', 'W', 'E', 'R', 'T'], ['1', '2', '3', '4', '5'],
  ['0', '9', '8', '7', '6'], ['P', 'O', 'I', 'U', 'Y'], ['ENTER', 'L', 'K', 'J', 'H'], ['SPACE', 'SYMBOL SHIFT', 'M', 'N', 'B']
];
const d2 = (v) => '$' + (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');

/** A byte sent to port $FE: border colour, tape out, speaker. */
function zxUla(b) {
  b &= 0xFF;
  return `Port $FE gets ${d2(b)}: border ${ZX_COLOURS[b & 7]}, speaker ${b & 0x10 ? 'pushed out (bit 4 on)' : 'pulled in (bit 4 off)'}${b & 8 ? ', tape output (MIC) on' : ''}.`;
}

/** The top half of the port number when reading $FE: which keyboard rows are read. */
function zxKeys(hi) {
  hi &= 0xFF;
  const rows = [];
  for (let i = 0; i < 8; i++) if (!(hi & (1 << i))) rows.push(ZX_ROWS[i]);
  if (!rows.length) return `With ${d2(hi)} as the top half of the port number, no keyboard row is picked (each 0 bit picks one).`;
  if (rows.length === 8) return `With ${d2(hi)} as the top half of the port number, every keyboard row is read at once: bits 0 to 4 are 0 if any key in that position of any row is pressed.`;
  const which = rows.map(r => r.join(' ')).join(' / ');
  return `Reads the keyboard row${rows.length > 1 ? 's' : ''} ${which}. In the byte read, bits 0 to 4 are ${rows.length > 1 ? 'the keys in that order (rows combined)' : 'those keys in that order'}: 0 = pressed.`;
}

/** A byte sent to port $7FFD on a 128K Spectrum. */
function zx128(b) {
  b &= 0xFF;
  return `Port $7FFD gets ${d2(b)}: RAM bank ${b & 7} at $C000, screen ${b & 8 ? 'from bank 7 (the second screen)' : 'from bank 5 (the normal one)'}, ROM ${b & 0x10 ? '1 (48K BASIC)' : '0 (128K editor)'}${b & 0x20 ? ', paging LOCKED until the next reset' : ''}.`;
}

const AY_REGS = ['tone of channel A (fine)', 'tone of channel A (coarse)', 'tone of channel B (fine)', 'tone of channel B (coarse)',
  'tone of channel C (fine)', 'tone of channel C (coarse)', 'noise pitch', 'mixer (which channels play tone and noise)',
  'volume of channel A', 'volume of channel B', 'volume of channel C', 'envelope speed (fine)', 'envelope speed (coarse)',
  'envelope shape', 'I/O port A', 'I/O port B'];
/** A register number sent to port $FFFD (the AY sound chip). */
function aySelect(b) {
  b &= 0xFF;
  return b < 16 ? `Sound chip: picks register ${b}, the ${AY_REGS[b]}. The next byte sent to $BFFD goes there.` : `Sound chip: ${b} isn't a register number (they go 0 to 15).`;
}

// ---------------------------------------------------------------------------
// BBC Micro (hardware in SHEILA, &FE00 and up)
// ---------------------------------------------------------------------------
const a2 = (v) => '&' + (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const BBC_COLOURS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const ULA_MODES = { 0x9C: 'MODE 0 and MODE 3', 0xD8: 'MODE 1', 0xF4: 'MODE 2', 0x88: 'MODE 4 and MODE 6', 0xC4: 'MODE 5', 0x4B: 'MODE 7' };

/** The video ULA control register (&FE20): how the picture is made. */
function bbcUla(b) {
  b &= 0xFF;
  const bits = [];
  bits.push(b & 2 ? 'teletext display (the MODE 7 way)' : 'bitmap display');
  bits.push(`${[10, 20, 40, 80][(b >> 2) & 3]} characters across`);
  bits.push(b & 16 ? 'fast (2 MHz) video clock' : 'slow (1 MHz) video clock');
  if (b & 1) bits.push('flashing colours use the second colour');
  const std = ULA_MODES[b] ? ` This is the value ${ULA_MODES[b]} uses.` : '';
  return `Video ULA control ${a2(b)}: ${bits.join(', ')}.${std}`;
}

/** A write to the palette register (&FE21): the top 4 bits pick the logical colour, the low 3 hold the actual colour EOR 7. */
function bbcPalette(b) {
  b &= 0xFF;
  const logical = b >> 4;
  const actual = (b & 7) ^ 7;
  return `Palette ${a2(b)}: logical colour ${logical} is set to ${BBC_COLOURS[actual]}. (The video chip wants the colour number EOR 7, so ${b & 7} stands for ${BBC_COLOURS[actual]}.)`;
}

const CRTC = [
  'horizontal total', 'number of characters across the screen', 'horizontal sync position', 'sync widths', 'vertical total', 'vertical total adjust',
  'number of character rows shown', 'vertical sync position', 'interlace and delay', 'scan lines per character row (minus 1)',
  'cursor start line', 'cursor end line', 'screen start address (high byte)', 'screen start address (low byte)',
  'cursor position (high byte)', 'cursor position (low byte)'
];

/** Writing the register number to &FE00 picks one of the 6845 video chip's registers. */
function crtcSelect(b) {
  const r = b & 31;
  return r < 16 ? `Video chip (6845): chooses register ${r}, the ${CRTC[r]}. The next write to &FE01 sets it.` : `Video chip (6845): register ${r} does not exist (there are 16, 0 to 15).`;
}

/** A value written to &FE01, for the register chosen just before (or unknown). */
function crtcValue(reg, b) {
  b &= 0xFF;
  if (reg === null || reg === undefined) return `Video chip (6845): ${a2(b)} goes into the register chosen by the last write to &FE00.`;
  reg &= 31;
  if (reg > 15) return null;
  let more = '';
  if (reg === 1) more = ` The screen shows ${b} characters across.`;
  else if (reg === 6) more = ` The screen shows ${b} rows of characters.`;
  else if (reg === 9) more = ` Each character row is ${(b & 31) + 1} scan lines tall.`;
  else if (reg === 12 || reg === 13) more = ' The two bytes (high, then low) together say where the screen starts. The video chip counts in units of 8 bytes in the bitmap modes.';
  return `Video chip (6845) register ${reg}, the ${CRTC[reg]}, is set to ${a2(b)} (${b}).${more}`;
}

const LATCH = ['sound chip write enable', 'speech chip read select', 'speech chip write select', 'keyboard write enable',
  'screen size bit 0 (for hardware scrolling)', 'screen size bit 1 (for hardware scrolling)', 'Caps Lock light', 'Shift Lock light'];

/** A write to the system VIA's port B (&FE40): bits 0-2 pick a line of the addressable latch, bit 3 is the value to put on it. */
function bbcLatch(b) {
  b &= 0xFF;
  const line = b & 7, v = (b >> 3) & 1;
  return `System VIA, port B ${a2(b)}: sets line ${line} of the addressable latch (${LATCH[line]}) to ${v}. Bits 0 to 2 pick the line and bit 3 is the value.`;
}

const IER_BITS = [[6, 'timer 1'], [5, 'timer 2'], [4, 'end of a joystick reading (CB1)'], [3, 'light pen (CB2)'], [2, 'shift register'], [1, 'vertical sync, the start of each screen refresh (CA1)'], [0, 'keyboard (CA2)']];

/** A write to the system VIA's interrupt enable register (&FE4E): bit 7 says turn on or off, the other bits say which. */
function bbcIer(b) {
  b &= 0xFF;
  const names = IER_BITS.filter(([n]) => b & (1 << n)).map(([, t]) => t);
  if (!names.length) return `System VIA interrupts ${a2(b)}: no interrupt is picked, so nothing changes.`;
  const all = names.length === IER_BITS.length ? 'every interrupt source' : names.join(', ');
  return `System VIA interrupts ${a2(b)}: turns ${b & 0x80 ? 'ON' : 'OFF'} ${all}.`;
}

/**
 * Decode a value on its way to a port.
 * kind: decoder name from the chip file. word: the whole 16-bit value, byte: the byte actually sent first.
 */
function decode(kind, word, byte, both) {
  if (kind === 'sn76489') return sn76489(byte);
  if (kind === 'zxula') return zxUla(byte);
  if (kind === 'zxkeys') return zxKeys(byte);
  if (kind === 'zx128') return zx128(byte);
  if (kind === 'ayselect') return aySelect(byte);
  if (kind === 'bbcula') return bbcUla(byte);
  if (kind === 'bbcpalette') return bbcPalette(byte);
  if (kind === 'bbclatch') return bbcLatch(byte);
  if (kind === 'bbcier') return bbcIer(byte);
  if (kind === 'bbc6845select') return crtcSelect(byte);
  if (kind === 'bbc6845value') return crtcValue(null, byte);
  if (kind === 'tms9918vwtr') return vdpRegister(word >> 8, word & 0xFF);
  if (kind === 'tms9918control') {
    // two bytes go to this port: a value then >80 + register number, or an address (low byte, then high byte + >40)
    if (both && (word & 0xF8) === 0x80) return vdpRegister(word & 7, word >> 8);
    if ((byte & 0xF8) === 0x80 && !both) return `Video chip: ${h2(byte)} as the second byte means "that was a value for register ${byte & 7}".`;
    return null;
  }
  return null;
}

module.exports = { decode, crtcValue, bbcUla, bbcPalette, bbcLatch, bbcIer, crtcSelect, sn76489, vdpRegister, COLOURS, zxUla, zxKeys, zx128, aySelect, ZX_COLOURS };
