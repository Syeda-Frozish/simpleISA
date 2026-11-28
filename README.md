# SimpleISA

Custom 16-bit ISA toolchain: assembler, single-cycle & pipelined CPU simulators, and a step-by-step datapath visualizer.

CS-339 Computer Architecture — semester project.

## Status

| Part | Status |
|---|---|
| ISA specification (`docs/ISA_SPEC.md`) | ✅ v1.0 |
| Assembler (`src/assembler.js`) | ✅ working, tested |
| Single-cycle CPU (`src/singleCycle.js`) | ✅ working, tested |
| Visualizer (`src/visualizer.js`) | ✅ single-cycle datapath animation |
| Pipelined CPU (`src/pipeline.js`) | ✅ 5 stages, stalls, flushes, tested |
| Comparison (`src/compare.js`) | ✅ cycles, CPI, stalls, flushes, execution time |
| Report + GitHub Pages | ⬜ next |

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
│   ├── visualizer.js   draws the datapath and animates the trace
│   ├── pipeline.js     5-stage pipelined CPU (stall + flush)
│   ├── pipelineView.js draws the stage boxes and pipeline diagram
│   ├── compare.js      runs a program on both CPUs and compares them
│   └── main.js         connects the page to the modules
├── programs/           example assembly programs (*.asm)
├── tests/              automated tests (npm test)
├── tools/
│   ├── asm.js          command-line assembler
│   ├── run.js          run a program on the single-cycle CPU
│   ├── pipe.js         run a program on the pipelined CPU
│   └── compare.js      comparison table for all programs (--csv for Sheets)
└── docs/
    ├── ISA_SPEC.md     the instruction set specification
    ├── PIPELINE.md     pipeline design, hazards, results
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

**Run a program on the pipelined CPU:**
```
node tools/pipe.js programs/sum.asm
node tools/pipe.js programs/sum.asm --events
```

**Compare both CPUs on every program:**
```
node tools/compare.js
node tools/compare.js --csv
```

**Run the tests:**
```
npm test
```
