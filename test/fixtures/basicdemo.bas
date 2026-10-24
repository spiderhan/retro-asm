   10 REM Made-up demo for the Retro ASM tests: a BASIC wrapper with machine code inside
   20 MODE 1
   30 DIM code% 200
   40 oswrch = &FFEE : LET osbyte = &FFF4
   50 FOR pass% = 0 TO 2 STEP 2
   60 P% = code%
   70 [OPT pass%
   80 .start
   90 LDA #65 : JSR oswrch \ print an A
  100 LDA #19 : JSR &FFF4
  110 LDX #0
  120 .loop
  130 LDA msg,X : BEQ done
  140 JSR oswrch : INX : BNE loop
  150 .done RTS
  160 .msg EQUS "Hi [there]" : EQUB 0
  170 ]
  180 NEXT
  190 PRINT "This [ is not assembly ]"
  200 CALL start
  210 DATA 1,2,[3]
