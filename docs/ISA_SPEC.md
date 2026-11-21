# SimpleISA — Instruction Set Specification (v1.0)

This document is the single source of truth for the SimpleISA project.
The assembler, single-cycle CPU, pipelined CPU and visualizer must all follow it.
Any change here must be made **before** changing code, and the version number bumped.

---

## 1. Overview

| Property | Value |
|---|---|
| Instruction length | 16 bits, fixed |
| Word size | 16 bits (1 word = 1 instruction = 1 data value) |
| Registers | 8 general-purpose registers, `R0`–`R7`, 16 bits each |
| `R0` | Hard-wired to 0. Reads return 0, writes are ignored |
| Instruction memory | 256 words (addresses 0–255), separate from data memory |
| Data memory | 256 words (addresses 0–255) |
| Addressing | Word-addressed: each address holds one 16-bit word |
| PC | Starts at 0, increments by **1** after each instruction |
| Number format | 16-bit two's complement; arithmetic wraps around on overflow |
| Opcode size | 4 bits → 16 opcodes (15 used, 1 reserved) |
| Formats | R-type, I-type, J-type |
| Reset state | All registers = 0, all data memory = 0, PC = 0 |

---

## 2. Instruction formats

All formats are exactly 16 bits. Bit 15 is the most significant bit.

### R-type (register–register)

```![alt text](image.png)
| opcode | rd    | rs    | rt    | unused |
| 15..12 | 11..9 | 8..6  | 5..3  | 2..0   |
|   4    |   3   |   3   |   3   |   3    |
```

Meaning: `rd = rs <op> rt`. The unused bits must be `000`.

### I-type (immediate)

```
| opcode | rA    | rB    | immediate |
| 15..12 | 11..9 | 8..6  | 5..0      |
|   4    |   3   |   3   |   6       |
```

- `immediate` is a **6-bit signed** value, range **−32 to +31**.
- It is **sign-extended** to 16 bits before use.
- Role of `rA` and `rB` depends on the opcode (see table in §3).

### J-type (jump)

```
| opcode | address |
| 15..12 | 11..0   |
|   4    |   12    |
```

- `address` is an unsigned absolute instruction address.
- Valid targets are 0–255 (instruction memory size). Upper bits must be 0.
- For `HALT`, the address field is `000000000000`.

---

## 3. Instruction set

| Opcode | Hex | Name | Type | Assembly | Operation |
|---|---|---|---|---|---|
| 0000 | 0 | **ADD**  | R | `ADD rd, rs, rt`   | `rd = rs + rt` |
| 0001 | 1 | **SUB**  | R | `SUB rd, rs, rt`   | `rd = rs - rt` |
| 0010 | 2 | **AND**  | R | `AND rd, rs, rt`   | `rd = rs & rt` |
| 0011 | 3 | **OR**   | R | `OR rd, rs, rt`    | `rd = rs \| rt` |
| 0100 | 4 | **XOR**  | R | `XOR rd, rs, rt`   | `rd = rs ^ rt` |
| 0101 | 5 | **SLT**  | R | `SLT rd, rs, rt`   | `rd = (rs < rt) ? 1 : 0` (signed compare) |
| 0110 | 6 | **SLL**  | R | `SLL rd, rs, rt`   | `rd = rs << (rt & 0xF)` |
| 0111 | 7 | **SRL**  | R | `SRL rd, rs, rt`   | `rd = rs >>> (rt & 0xF)` (logical, fills with 0) |
| 1000 | 8 | **ADDI** | I | `ADDI rA, rB, imm` | `rA = rB + signext(imm)` |
| 1001 | 9 | **LW**   | I | `LW rA, imm(rB)`   | `rA = DMem[rB + signext(imm)]` |
| 1010 | A | **SW**   | I | `SW rA, imm(rB)`   | `DMem[rB + signext(imm)] = rA` |
| 1011 | B | **BEQ**  | I | `BEQ rA, rB, label`| `if (rA == rB) PC = PC + 1 + signext(imm)` |
| 1100 | C | **BNE**  | I | `BNE rA, rB, label`| `if (rA != rB) PC = PC + 1 + signext(imm)` |
| 1101 | D | **J**    | J | `J label`          | `PC = address` |
| 1110 | E | **HALT** | J | `HALT`             | Stop execution |
| 1111 | F | *reserved* | — | — | Executing it is an error (CPU stops and reports it) |

### Register field roles in I-type

| Instruction | `rA` | `rB` | Writes a register? |
|---|---|---|---|
| ADDI | destination | source | yes (`rA`) |
| LW   | destination | base address | yes (`rA`) |
| SW   | value to store (source) | base address | no |
| BEQ / BNE | first value compared | second value compared | no |

### Notes

- **Branches are PC-relative.** The offset counts from the *next* instruction (`PC + 1`). Range: −32 to +31 instructions. The assembler computes the offset from the label.
- **Jumps are absolute.** `J` loads the address field directly into PC.
- **Memory addresses** from `LW`/`SW` must be in 0–255; out-of-range access is an error.
- **NOP** is encoded as `0x0000` (= `ADD R0, R0, R0`), which has no effect. The pipeline uses this as its bubble.

---

## 4. Control signals (reference for the CPUs)

| Instr | RegWrite | RegDst | ALUSrc | ALUOp | MemRead | MemWrite | MemToReg | Branch | Jump | Halt |
|---|---|---|---|---|---|---|---|---|---|---|
| ADD  | 1 | rd | reg | ADD | 0 | 0 | ALU | — | 0 | 0 |
| SUB  | 1 | rd | reg | SUB | 0 | 0 | ALU | — | 0 | 0 |
| AND  | 1 | rd | reg | AND | 0 | 0 | ALU | — | 0 | 0 |
| OR   | 1 | rd | reg | OR  | 0 | 0 | ALU | — | 0 | 0 |
| XOR  | 1 | rd | reg | XOR | 0 | 0 | ALU | — | 0 | 0 |
| SLT  | 1 | rd | reg | SLT | 0 | 0 | ALU | — | 0 | 0 |
| SLL  | 1 | rd | reg | SLL | 0 | 0 | ALU | — | 0 | 0 |
| SRL  | 1 | rd | reg | SRL | 0 | 0 | ALU | — | 0 | 0 |
| ADDI | 1 | rA | imm | ADD | 0 | 0 | ALU | — | 0 | 0 |
| LW   | 1 | rA | imm | ADD | 1 | 0 | Mem | — | 0 | 0 |
| SW   | 0 | —  | imm | ADD | 0 | 1 | —   | — | 0 | 0 |
| BEQ  | 0 | —  | reg | SUB | 0 | 0 | —   | EQ | 0 | 0 |
| BNE  | 0 | —  | reg | SUB | 0 | 0 | —   | NE | 0 | 0 |
| J    | 0 | —  | —   | —   | 0 | 0 | —   | — | 1 | 0 |
| HALT | 0 | —  | —   | —   | 0 | 0 | —   | — | 0 | 1 |

- **RegDst:** which field names the destination register (`rd` for R-type, `rA` for I-type).
- **ALUSrc:** second ALU input comes from a register (`rt` / `rB`) or the sign-extended immediate.
- **Branch:** `EQ` = take if ALU result is zero; `NE` = take if non-zero.
- Any write to `R0` is discarded.

---

## 5. Example encodings

| Assembly | Binary (split by field) | Hex |
|---|---|---|
| `ADD R1, R2, R3`  | `0000 001 010 011 000` | `0x0298` |
| `SUB R4, R5, R6`  | `0001 100 101 110 000` | `0x1970` |
| `SLT R3, R1, R2`  | `0101 011 001 010 000` | `0x5650` |
| `ADDI R1, R0, 5`  | `1000 001 000 000101`  | `0x8205` |
| `ADDI R2, R2, -1` | `1000 010 010 111111`  | `0x84BF` |
| `LW R1, 4(R2)`    | `1001 001 010 000100`  | `0x9284` |
| `SW R1, 4(R2)`    | `1010 001 010 000100`  | `0xA284` |
| `BEQ R1, R2, +3`  | `1011 001 010 000011`  | `0xB283` |
| `BNE R2, R0, -3`  | `1100 010 000 111101`  | `0xC43D` |
| `J 5`             | `1101 000000000101`    | `0xD005` |
| `HALT`            | `1110 000000000000`    | `0xE000` |
| `NOP`             | `0000 000 000 000 000` | `0x0000` |

---

## 6. Assembly language syntax

- One instruction per line. Mnemonics and register names are **case-insensitive** (`add r1, r2, r3` is fine).
- Operands are separated by commas.
- Registers: `R0`–`R7`.
- Immediates: decimal (`5`, `-3`) or hex (`0x1F`).
- Comments start with `#` or `;` and run to the end of the line.
- Labels: a name followed by a colon, e.g. `loop:`. A label may be on its own line or before an instruction. Names start with a letter or `_` and contain letters, digits and `_`.
- Blank lines are ignored.

### Sections and data (for array programs)

```
.data
nums:   .word 4, 7, 1, 9      # placed in data memory starting at address 0
.text
        LW R1, nums(R0)       # data labels can be used as immediates
```

- `.text` (default) — instructions, placed in instruction memory from address 0.
- `.data` — data values, placed in data memory from address 0.
- `.word v1, v2, ...` — one 16-bit value per word.
- A data label used as an immediate must fit in the 6-bit signed range (address ≤ 31).

### Pseudo-instructions (expanded by the assembler)

| Pseudo | Expands to |
|---|---|
| `NOP`         | `ADD R0, R0, R0` |
| `MOV rd, rs`  | `ADD rd, rs, R0` |
| `LI rd, imm`  | `ADDI rd, R0, imm` (imm in −32…31) |

### Building other comparisons (no extra hardware needed)

| Want | Write |
|---|---|
| branch if `a < b`  | `SLT t, a, b` → `BNE t, R0, label` |
| branch if `a >= b` | `SLT t, a, b` → `BEQ t, R0, label` |
| branch if `a > b`  | `SLT t, b, a` → `BNE t, R0, label` |
| branch if `a <= b` | `SLT t, b, a` → `BEQ t, R0, label` |

### Assembler errors (must be reported with line number)

Unknown mnemonic · wrong number of operands · invalid register · immediate out of range · undefined label · duplicate label · branch target out of range · program larger than 256 instructions.

---

## 7. Example program — sum of 1..5

```
        ADDI R1, R0, 0      # sum = 0
        ADDI R2, R0, 5      # i = 5
loop:   ADD  R1, R1, R2     # sum = sum + i
        ADDI R2, R2, -1     # i = i - 1
        BNE  R2, R0, loop   # repeat while i != 0
        SW   R1, 0(R0)      # DMem[0] = sum  (= 15)
        HALT
```

| Addr | Instruction | Hex |
|---|---|---|
| 0 | `ADDI R1, R0, 0`  | `0x8200` |
| 1 | `ADDI R2, R0, 5`  | `0x8405` |
| 2 | `ADD R1, R1, R2`  | `0x0250` |
| 3 | `ADDI R2, R2, -1` | `0x84BF` |
| 4 | `BNE R2, R0, -3`  | `0xC43D` (target = 4 + 1 − 3 = 2) |
| 5 | `SW R1, 0(R0)`    | `0xA200` |
| 6 | `HALT`            | `0xE000` |

Expected result: `R1 = 15`, `DMem[0] = 15`.

---

## 8. Future extensions (not in v1.0)

Opcode `1111` is reserved. Candidates if needed later:

- **BGE / BLT** as real instructions, or as assembler pseudo-instructions (would reserve a temp register).
- **JAL / JR** for function calls.
- **LUI** for loading larger constants.

Adding any of these requires updating this spec first, then the assembler, CPUs and tests.

---

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-11-21 | Initial locked specification |
