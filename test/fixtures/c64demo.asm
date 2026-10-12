// Made-up C64 test program for Retro Assembly Helper: "Star Hopper".
// Not taken from any real game.
.const BORDER = $D020
.const SCREEN = $0400
.label ptr = $FB            // a zero-page pointer (2 bytes)
.var count = 0

/* Start-up: put a BASIC line in, so RUN starts the program.
 * The code itself begins at $080D.
 */
BasicUpstart2(start)

// ---------------------------------------------------------
// START: set up the screen, then wait for the fire button
// ---------------------------------------------------------
start:
        sei
        lda #BLACK
        sta BORDER
        sta $D021
        jsr clear_screen
        jsr print_title
        lda #<irq
        sta $0314
        lda #>irq
        sta $0315
        cli
wait:   lda $DC00           // joystick in port 2
        and #%00010000      // fire button (0 = pressed)
        bne wait
        jmp start

// Fill the screen with spaces, 250 bytes at a time.
clear_screen:
        lda #$20
        ldx #0
!loop:  sta SCREEN,x
        sta SCREEN+250,x
        sta SCREEN+500,x
        sta SCREEN+750,x
        inx
        cpx #250
        bne !loop-
        rts

// Copy the title text to the top line, through the pointer.
print_title:
        lda #<title
        sta ptr
        lda #>title
        sta ptr+1
        ldy #0
!next:  lda (ptr),y
        beq !done+
        sta SCREEN,y
        iny
        bne !next-
!done:  rts

// Runs 50 times a second: flash the border.
irq:
        inc BORDER
        dec frame
        lda frame
        cmp #10
        bcs !skip+
        asl
        lsr frame
!skip:  jmp $EA31

.macro setColours(edge, back) {
        lda #edge
        sta BORDER
        lda #back
        sta $D021
}

colours: {
        setColours(WHITE, BLUE)
        rts
}

.for (var i=0; i<4; i++) {
        .eval count = count + i
}

#import "c64data.asm"
