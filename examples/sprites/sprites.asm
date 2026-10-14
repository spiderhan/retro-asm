// Picture examples for the Commodore 64 (made up, for trying the Retro ASM picture editor).
//
// Click "Edit picture" above a block to draw it. Each click changes the numbers in the
// .byte lines here, and typing new numbers changes the picture.
// The @sprite comment above a block says what shape it is.
//
// Builds with KickAssembler (java -jar KickAss.jar sprites.asm) into sprites.prg:
// RUN it to see the balloon as sprite 0.

BasicUpstart2(start)            // A BASIC line, so RUN starts the program

start:
        lda #balloon/64         // Sprite pointers count in 64-byte steps
        sta $07f8               // Sprite 0 uses the balloon
        lda #1
        sta $d015               // Switch sprite 0 on
        lda #160
        sta $d000               // Across
        lda #120
        sta $d001               // Down
        lda #7
        sta $d027               // Yellow
        rts                     // Back to BASIC (the sprite stays on screen)

        .align 64               // A sprite must start on a 64-byte boundary
// A one-colour sprite: 24x21, 3 bytes a row, 63 bytes, then one spare byte.
// @sprite c64
balloon:
        .byte $00,$fe,$00
        .byte $03,$ff,$80
        .byte $07,$ff,$c0
        .byte $0f,$ff,$e0
        .byte $0e,$7f,$e0
        .byte $1c,$ff,$f0
        .byte $1d,$ff,$f0
        .byte $1f,$ff,$f0
        .byte $1f,$ff,$f0
        .byte $1f,$ff,$f0
        .byte $0f,$ff,$e0
        .byte $0f,$ff,$e0
        .byte $07,$ff,$c0
        .byte $03,$ff,$80
        .byte $00,$fe,$00
        .byte $00,$38,$00
        .byte $00,$10,$00
        .byte $00,$20,$00
        .byte $00,$10,$00
        .byte $00,$08,$00
        .byte $00,$10,$00
        .byte $00               // The spare 64th byte

// Multicolour: each pixel is two bits and twice as wide. Two pictures (wings up, wings down)
// 64 bytes apart, so the editor shows "1 of 2".
// @sprite c64multi
bird:
        .byte $00,$00,$00
        .byte $80,$00,$02
        .byte $a0,$00,$0a
        .byte $28,$00,$28
        .byte $0a,$00,$a0
        .byte $02,$96,$80
        .byte $00,$75,$00
        .byte $00,$55,$00
        .byte $00,$3c,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$55
        .byte $00,$00,$75
        .byte $00,$0a,$55
        .byte $a0,$28,$55
        .byte $28,$a0,$3c
        .byte $0a,$80,$00
        .byte $02,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00,$00,$00
        .byte $00
        .byte $00

// An 8x8 character.
// @sprite 8x8
tree:
        .byte $18,$3c,$7e,$3c,$7e,$ff,$18,$18

// A multicolour character: 4 double-width pixels a row.
// @sprite charmulti
brick:
        .byte $fe,$56,$56,$aa,$ef,$65,$65,$aa
