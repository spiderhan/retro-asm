// made-up 6502 test
// In: A = the character
plot:   sta $0400
        inx
        rts

start:  lda #65
        ldx #3
        ldy score
        sta total
        jsr plot
        txa
        rts
score:  .byte 0
total:  .byte 0
