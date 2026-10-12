; Made-up test program for the Z80 chip file: a ZX Spectrum "catch the star" toy.
; Written for sjasmplus. Not taken from any real game.

        DEVICE ZXSPECTRUM48
        ORG 32768

LAST_K  EQU 23560               ; system variable: last key pressed
ATTRS   EQU $5800               ; screen colours
CLS     EQU $0D6B
SPEED   = 4

; Start: set up the screen, then run the main loop.
start:  call CLS
        ld a,2                  ; red border
        out ($fe),a
        ld hl,ATTRS
        ld de,ATTRS+1
        ld bc,767
        ld (hl),%00111000       ; white paper, black ink
        ldir
        ld de,title
        ld bc,title_end-title
        call 8252               ; PR-STRING
        ex af,af'
        ld ix,stars
        ld (ix+2),SPEED

; Main loop: wait a frame, read the keys, move the player.
main:   halt
        ld a,$fb                ; keyboard row Q W E R T
        in a,($fe)
        bit 0,a
        jr z,.left
        cp 'Q'
        jr nc,.done
.left:  ld hl,player_x
        dec (hl)
        ld b,8
.wait:  djnz .wait
.done:  ld a,(LAST_K)
        or a
        jr nz,main
        ret

; Beep: HL = pitch, DE = length.
beep:   push ix
        call 949                ; BEEPER
        pop ix
        ret

; Count down BC until it is 0.
count:  dec bc
        ld a,b
        or c
        jr nz,count
        ret z
        ret

        INCLUDE "zxdata.asm"
