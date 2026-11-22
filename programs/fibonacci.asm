# fibonacci.asm — stores the first 10 Fibonacci numbers in DMem[0..9]
# Expected: DMem = 0, 1, 1, 2, 3, 5, 8, 13, 21, 34

        LI   R1, 0          # a = 0
        LI   R2, 1          # b = 1
        LI   R3, 0          # address = 0
        LI   R4, 10         # count = 10
loop:   SW   R1, 0(R3)      # DMem[address] = a
        ADD  R5, R1, R2     # next = a + b
        MOV  R1, R2         # a = b
        MOV  R2, R5         # b = next
        ADDI R3, R3, 1      # address = address + 1
        ADDI R4, R4, -1     # count = count - 1
        BNE  R4, R0, loop   # repeat while count != 0
        HALT
