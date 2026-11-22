# SimpleISA

Custom 16-bit ISA toolchain: assembler, single-cycle & pipelined CPU simulators, and a step-by-step datapath visualizer.

CS-339 Computer Architecture — semester project.

## Status

| Part | Status |
|---|---|
| ISA specification (`docs/ISA_SPEC.md`) | ✅ v1.0 |
| Assembler (`src/assembler.js`) | ✅ working, tested |
| Single-cycle CPU (`src/singleCycle.js`) | ✅ working, tested |
| Visualizer | ⬜ next |
| Pipelined CPU | ⬜ |
| Comparison (CPI, stalls) | ⬜ |

## Folder structure

```
simpleISA/
├── index.html          the web page (open with Live Server)
├── css/style.css       page styling
├── src/
│   ├── isa.js          opcodes, formats, encode/decode — shared by all modules
│   ├── assembler.js    assembly text -> machine code
│   ├── components.js   ALU, register file, memory, control unit
│   ├── singleCycle.js  single-cycle CPU (produces the trace)
│   └── main.js         connects the page to the modules
├── programs/           example assembly programs (*.asm)
├── tests/              automated tests (npm test)
├── tools/
│   ├── asm.js          command-line assembler
│   └── run.js          run a program on the CPU from the terminal
└── docs/
    ├── ISA_SPEC.md     the instruction set specification
    └── TRACE_FORMAT.md what the CPU gives the visualizer
```

## How to run

**In the browser:** open the folder in VS Code, right-click `index.html` → **Open with Live Server**.

**Assemble a file in the terminal:**
```
node tools/asm.js programs/sum.asm
```

**Run a program on the CPU:**
```
node tools/run.js programs/sum.asm
node tools/run.js programs/sum.asm --trace
```

**Run the tests:**
```
npm test
```
