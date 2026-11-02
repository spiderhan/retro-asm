'use strict';
// Shared routines that blocks can ask for (a block calls ctx.need('NAME')).
const { fmt } = require('../../blocks');
module.exports = {
  helpers: {
    // Screen tiles: write one tile, read one tile, fill a run of tiles. R0 is the screen position.
    VSBW: () => [
      '* VSBW: write the tile in the left byte of R1 to screen position R0.',
      fmt('VSBW', 'ORI', 'R0,>4000'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'), fmt('', 'SWPB', 'R0'),
      fmt('', 'MOVB', 'R0,@VDPWA'), fmt('', 'MOVB', 'R1,@VDPWD'), fmt('', 'ANDI', 'R0,>3FFF'), fmt('', 'B', '*R11')
    ],
    VSBR: () => [
      '* VSBR: read the tile at screen position R0 into the left byte of R1.',
      fmt('VSBR', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'),
      fmt('', 'NOP', ''), fmt('', 'MOVB', '@>8800,R1', 'Video chip: read a byte'), fmt('', 'B', '*R11')
    ],
    VFILL: () => [
      '* VFILL: put the tile in the left byte of R1 in R2 screen positions in a row, starting at R0.',
      fmt('VFILL', 'ORI', 'R0,>4000'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'),
      fmt('VFL1', 'MOVB', 'R1,@VDPWD'), fmt('', 'DEC', 'R2'), fmt('', 'JNE', 'VFL1'), fmt('', 'B', '*R11')
    ],
    // R0 = screen position, R1 = first piece (left byte), R2 = how many tiles, R3 = pieces in one tile. Draws the tiles side by side.
    VTILES: () => [
      '* VTILES: draw R2 tiles side by side from screen position R0. Each tile is R3 pieces: the screen character in',
      '* the left byte of R1, then the next one, and so on; the next tile starts again at R1.',
      fmt('VTILES', 'ORI', 'R0,>4000'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'),
      fmt('VTL1', 'MOV', 'R1,R4', 'The first piece of this tile'), fmt('', 'MOV', 'R3,R5'),
      fmt('VTL2', 'MOVB', 'R4,@VDPWD'), fmt('', 'AI', 'R4,>0100'), fmt('', 'DEC', 'R5'), fmt('', 'JNE', 'VTL2'),
      fmt('', 'DEC', 'R2'), fmt('', 'JNE', 'VTL1'), fmt('', 'B', '*R11')
    ],
    JOYBITS: () => [
      '* The joystick switches: which bit means left, and which means right.',
      fmt('KLEFT', 'DATA', '>0200'),
      fmt('KRIGHT', 'DATA', '>0400')
    ],
    // Plays the sound lists that the Retro ASM sound player already understands (@sound blocks):
    // a count, that many bytes for the sound chip, then how long to wait in 60ths of a second.
    SOUND: () => [
      '* SNDTICK: called once a frame. Plays the next step of the current sound list, if one is playing.',
      fmt('SNDTICK', 'MOV', '@SNDWT,@SNDWT', 'Still waiting?'),
      fmt('', 'JEQ', 'SND1'),
      fmt('', 'DEC', '@SNDWT'),
      fmt('', 'B', '*R11'),
      fmt('SND1', 'MOV', '@SNDPTR,R0', 'Where are we in the list? (0 = nothing playing)'),
      fmt('', 'JEQ', 'SNDEND'),
      fmt('', 'MOVB', '*R0+,R2', 'How many bytes for the sound chip'),
      fmt('', 'JEQ', 'SNDOFF', 'A count of 0 ends the list'),
      fmt('', 'SRL', 'R2,8'),
      fmt('SND2', 'MOVB', '*R0+,@>8400', 'Send a byte to the sound chip'),
      fmt('', 'DEC', 'R2'),
      fmt('', 'JNE', 'SND2'),
      fmt('', 'MOVB', '*R0+,R2', 'How long to wait'),
      fmt('', 'SRL', 'R2,8'),
      fmt('', 'MOV', 'R2,@SNDWT'),
      fmt('', 'MOV', 'R0,@SNDPTR'),
      fmt('SNDEND', 'B', '*R11'),
      fmt('SNDOFF', 'CLR', '@SNDPTR'),
      fmt('', 'B', '*R11')
    ],
    // Shows the number in R0 (0-999) as three digits at the screen address in R1.
    DIGITS: () => [
      '* SHOWNUM: R0 = the number (0-999), R1 = screen position. Writes three digits.',
      fmt('SHOWNUM', 'MOV', 'R11,R9'),
      fmt('', 'MOV', 'R1,R4', 'Keep the screen position'),
      fmt('', 'CLR', 'R2'),
      fmt('', 'MOV', 'R0,R3', 'R2:R3 is the number to divide'),
      fmt('', 'LI', 'R5,100'),
      fmt('', 'DIV', 'R5,R2', 'R2 = hundreds, R3 = the rest'),
      fmt('', 'MOV', 'R2,R6'),
      fmt('', 'CLR', 'R2'),
      fmt('', 'LI', 'R5,10'),
      fmt('', 'DIV', 'R5,R2', 'R2 = tens, R3 = ones'),
      fmt('', 'MOV', 'R2,R7'),
      fmt('', 'MOV', 'R3,R8'),
      fmt('', 'MOV', 'R4,R0'),
      fmt('', 'ORI', 'R0,>4000'),
      fmt('', 'SWPB', 'R0'),
      fmt('', 'MOVB', 'R0,@VDPWA'),
      fmt('', 'SWPB', 'R0'),
      fmt('', 'MOVB', 'R0,@VDPWA'),
      fmt('', 'AI', 'R6,>30', 'Digit characters start at 48'),
      fmt('', 'SWPB', 'R6'),
      fmt('', 'MOVB', 'R6,@VDPWD'),
      fmt('', 'AI', 'R7,>30'),
      fmt('', 'SWPB', 'R7'),
      fmt('', 'MOVB', 'R7,@VDPWD'),
      fmt('', 'AI', 'R8,>30'),
      fmt('', 'SWPB', 'R8'),
      fmt('', 'MOVB', 'R8,@VDPWD'),
      fmt('', 'B', '*R9')
    ]
  }
};
