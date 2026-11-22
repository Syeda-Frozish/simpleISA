# array.asm — finds the sum and the maximum of an array stored in data memory
# Expected: sum = 24, max = 9

.data
nums:   .word 4, 7, 1, 9, 3     # the array (DMem[0..4])
count:  .word 5                 # number of elements
sum:    .word 0                 # result: sum goes here
max:    .word 0                 # result: max goes here

.text
        LI   R1, 0              # total = 0
        LI   R5, 0              # biggest = 0
        LI   R2, nums           # pointer = address of nums[0]
        LW   R3, count(R0)      # n = count
loop:   LW   R4, 0(R2)          # x = nums[i]
        ADD  R1, R1, R4         # total = total + x
        SLT  R6, R5, R4         # R6 = 1 if biggest < x
        BEQ  R6, R0, skip       # if not, skip the update
        MOV  R5, R4             # biggest = x
skip:   ADDI R2, R2, 1          # pointer = pointer + 1
        ADDI R3, R3, -1         # n = n - 1
        BNE  R3, R0, loop       # repeat while n != 0
        SW   R1, sum(R0)        # store total
        SW   R5, max(R0)        # store biggest
        HALT
