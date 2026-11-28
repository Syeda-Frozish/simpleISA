# Trace format (CPU → Visualizer)

Every time the CPU runs one cycle, `step()` returns a **trace record**.
The visualizer reads these records and animates them. Both CPUs must produce this shape.

## Single-cycle trace record

```js
{
  cycle: 3,                       // cycle number, starting at 1
  pc: 2,                          // address of the instruction that ran
  word: 0x0250,                   // the 16-bit instruction
  hex: '0x0250',
  asm: 'ADD R1, R1, R2',          // disassembled text
  name: 'ADD',                    // mnemonic
  control: { regWrite: true, regDst: 'rd', aluSrc: 'reg', aluOp: 'ADD',
             memRead: false, memWrite: false, memToReg: false,
             branch: null, jump: false, halt: false },
  steps: [                        // units used, IN ORDER — one marker stop each
    { unit: 'PC',      caption: 'PC = 2: address of the next instruction', values: { pc: 2 } },
    { unit: 'IMEM',    caption: 'Fetch IMEM[2] = 0x0250 → ADD R1, R1, R2', values: { ... } },
    { unit: 'CONTROL', caption: 'Opcode 0000 = ADD: RegWrite, ALUOp=ADD',   values: { ... } },
    { unit: 'REGFILE', caption: 'Read R1 = 0, R2 = 5',                      values: { R1: 0, R2: 5 } },
    { unit: 'ALU',     caption: '0 + 5 = 5',                                values: { op, a, b, result, zero } },
    { unit: 'WB',      caption: 'Write 5 into R1 (from ALU)',               values: { reg: 1, value: 5 } },
    { unit: 'NEXTPC',  caption: 'PC = 2 + 1 = 3',                           values: { to: 3 } }
  ],
  changes: {
    reg: { index: 1, old: 0, new: 5 },   // or null
    mem: null                            // or { address, old, new }
  },
  nextPc: 3,
  halted: false,
  error: null                     // message if the CPU stopped with an error
}
```

## Unit IDs

| Unit | Datapath component | Used by |
|---|---|---|
| `PC` | Program counter | all |
| `IMEM` | Instruction memory | all |
| `CONTROL` | Control unit | all |
| `REGFILE` | Register file (read) | all except J, HALT |
| `SIGNEXT` | Sign-extend | ADDI, LW, SW, BEQ, BNE |
| `ALU` | ALU | all except J, HALT |
| `DMEM` | Data memory | LW, SW |
| `WB` | Write-back mux → register file | R-type, ADDI, LW |
| `NEXTPC` | Next-PC logic (PC+1 / branch / jump) | all |

The visualizer gives each unit an SVG element with a matching `id`, and moves the marker
through `steps` in order, showing each `caption`.

Values in `values` are raw 16-bit numbers (0..65535). Use `toSigned16()` from `isa.js` to display negatives.

## Run result

`cpu.run()` returns `{ trace: [...records], stats, stoppedBy }`:

- `stats`: `{ cycles, instructions, cpi, stalls, flushes }`
- `stoppedBy`: `'halt'`, `'error'` or `'max-cycles'`

## Pipelined trace record

`PipelinedCPU.step()` returns one record per clock cycle:

```js
{
  cycle: 4,
  stages: {                         // what each stage holds THIS cycle
    IF:  { id: 3, pc: 3, asm: 'ADDI R2, R2, -1', status: 'stall', note: '' },
    ID:  { id: 2, pc: 2, asm: 'ADD R1, R1, R2',  status: 'stall', note: 'waits for R2' },
    EX:  { id: 1, pc: 1, asm: 'ADDI R2, R0, 5',  status: 'ok',    note: '' },
    MEM: { id: 0, pc: 0, asm: 'ADDI R1, R0, 0',  status: 'ok',    note: '' },
    WB:  null                       // null = empty, { bubble: true, ... } = bubble
  },
  events: [                         // what happened, in stage order WB -> IF
    { stage: 'ID', text: 'ADD R1, R1, R2: STALL, needs R2 but ADDI R2, R0, 5 (in EX) has not written it yet' }
  ],
  changes: { reg: null, mem: null },// same shape as single-cycle
  stall: true,                      // ID stalled this cycle
  flushed: 0,                       // instructions flushed this cycle
  nextPc: 3,
  halted: false,
  error: null
}
```

- `id` is a number given to every fetched instruction, in fetch order. The pipeline diagram
  uses it as the row.
- `status`: `'ok'`, `'stall'` (held in place this cycle) or `'flushed'` (wrong path, discarded).

`run()` returns `{ trace, stats, stoppedBy }` like the single-cycle CPU. Pipelined `stats`:
`{ cycles, instructions, cpi, stalls, flushes }`. `stalls` counts stall cycles, `flushes`
counts flushed instructions. See docs/PIPELINE.md for the design.
