; Data for the made-up Spectrum test program.

title:  DEFM "Catch",32,"the star",13
title_end:
player_x: DEFB 16
stars:  DEFB 1,2,3,4
        DEFW start
star_gfx:                       ; 8x8 star picture
        DEFB %00011000
        DEFB %00011000
        DEFB %11111111
        DEFB %01111110
        DEFB %00111100
        DEFB %01100110
        DEFB %11000011
        DEFB %00000000
        DZ "end"
