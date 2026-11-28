# Pipelined CPU — design notes

Code: `src/pipeline.js` · Tests: `tests/pipeline.test.js` · Comparison: `src/compare.js`

## 1. Why pipeline?

The single-cycle CPU finishes one whole instruction per clock cycle. That is simple but slow:

- Most hardware sits idle: while the ALU works, instruction memory and data memory do nothing.
- The clock must be long enough for the **slowest** instruction (LW uses every unit), so every
  instruction pays that long cycle.

Pipelining splits the work into 5 stages and starts a new instruction every cycle, like an
assembly line. Each cycle only has to be long enough for the **slowest stage**, so the clock is
much faster, and ideally one instruction still finishes every cycle.

## 2. The five stages

| Stage | Work | Units used |
|---|---|---|
| **IF** — Instruction Fetch | read IMEM[PC], PC = PC + 1 | PC, instruction memory |
| **ID** — Instruction Decode | control signals, hazard check, read registers | control unit, register file |
| **EX** — Execute | ALU operation; decide branches | sign-extend, ALU |
| **MEM** — Memory | LW reads / SW writes data memory | data memory |
| **WB** — Write Back | write the result into the register file | WB mux, register file |

Between the stages are **pipeline registers** (IF/ID, ID/EX, EX/MEM, MEM/WB). They hold an
instruction and its values (register values, ALU result, loaded data) as it moves forward one
stage per clock edge.

The ALU, register file, memories and control unit are the same parts the single-cycle CPU uses
(`src/components.js`). Only the timing changes.

## 3. Hazards and how we handle them

### Data hazards → stall (no forwarding)

An instruction needs a register value that an older instruction has not written back yet:

```
ADDI R2, R0, 5      # writes R2 in WB
ADD  R1, R1, R2     # reads R2 in ID — too early!
```

**Rule:** the register file writes in the first half of a cycle and reads in the second half.
So a value written in WB can be read by ID in the *same* cycle. An instruction in ID must wait
(stall) while the instruction that produces its source register is still in **EX or MEM**.

| Distance between producer and consumer | Stall cycles |
|---|---|
| next instruction | 2 |
| one instruction in between | 1 |
| two or more in between | 0 |

During a stall the instruction stays in ID, IF re-fetches the same instruction, and a
**bubble** (a NOP) is sent into EX.

Writes to R0 never cause a stall (R0 is always 0).

### Control hazards → flush

We always fetch PC + 1 next ("predict not taken").

- **BEQ / BNE** are decided in **EX**. If the branch is *taken*, the 2 instructions fetched
  after it (now in IF and ID) are on the wrong path and are **flushed**: thrown away without
  changing any register or memory. Penalty: 2 cycles. A branch that is *not* taken costs nothing.
- **J** is decided in **ID** (the target is in the instruction). The 1 instruction in IF is
  flushed. Penalty: 1 cycle.

### HALT

IF recognises HALT and stops fetching. The CPU finishes when HALT reaches WB, meaning every
older instruction has completed. A HALT fetched on a wrong path is flushed like any other
instruction and fetching resumes.

## 4. Why not forwarding?

Forwarding (bypassing) sends an ALU result straight to the next instruction's ALU input and
removes most stalls. The proposal chose a **stall-only** design because it is simpler to build
and makes hazards clearly visible in the pipeline diagram. Forwarding is a natural extension.

## 5. Measuring performance

- **CPI** = cycles ÷ instructions completed. Single-cycle CPI is always 1. Pipelined CPI is
  above 1 because of fill cycles (4), stalls and flushes.
- Cycles alone are not a fair comparison, so we compare **execution time = cycles × clock period**.

Stage delays (textbook example values, Patterson & Hennessy ch. 4):

| IF | ID | EX | MEM | WB |
|---|---|---|---|---|
| 200 ps | 100 ps | 200 ps | 200 ps | 100 ps |

- Single-cycle clock = sum of all stages = **800 ps**
- Pipelined clock = slowest stage = **200 ps**

## 6. Results

`node tools/compare.js` (or the comparison panel on the page):

| Program | Instructions | Single-cycle cycles | Pipelined cycles | Stalls | Flushes | Pipelined CPI | Single time | Pipelined time | Speedup |
|---|---|---|---|---|---|---|---|---|---|
| sum.asm | 19 | 19 | 43 | 12 | 8 | 2.26 | 15.2 ns | 8.6 ns | **1.77×** |
| fibonacci.asm | 75 | 75 | 128 | 31 | 9 | 1.71 | 60.0 ns | 25.6 ns | **2.34×** |
| array.asm | 45 | 45 | 92 | 31 | 12 | 2.04 | 36.0 ns | 18.4 ns | **1.96×** |

Both CPUs end with identical registers and memory for every program.

**Observations:**
- The pipeline needs more cycles, but each cycle is 4× shorter, so it is 1.8–2.3× faster overall.
- The ideal speedup is 4× (800 ps / 200 ps). Stalls, flushes and the 4 fill cycles eat into it.
- `sum.asm` has the worst CPI: its loop is short and every iteration has back-to-back
  dependencies (ADDI R2 → BNE R2) plus a taken branch (2 flushes).
- `fibonacci.asm` gets the best speedup: its loop body is longer, so the fixed costs are spread
  over more instructions.
- Reordering instructions (putting independent work between a producer and its consumer)
  or adding forwarding would reduce stalls.
