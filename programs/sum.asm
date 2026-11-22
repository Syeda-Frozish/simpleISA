# sum.asm — adds 1 + 2 + 3 + 4 + 5
# Expected result: R1 = 15 and DMem[0] = 15

        ADDI R1, R0, 0      # sum = 0
        ADDI R2, R0, 5      # i = 5
loop:   ADD  R1, R1, R2     # sum = sum + i
        ADDI R2, R2, -1     # i = i - 1
        BNE  R2, R0, loop   # repeat while i != 0
        SW   R1, 0(R0)      # DMem[0] = sum
        HALT
