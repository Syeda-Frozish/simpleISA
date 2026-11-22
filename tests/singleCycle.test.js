// Single-cycle CPU tests. Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/assembler.js';
import { SingleCycleCPU } from '../src/singleCycle.js';
import { alu } from '../src/components.js';

// Assemble + run; returns { cpu, trace, stats, stoppedBy }.
function runSource(source, maxCycles) {
  const program = assemble(source);
  assert.deepEqual(program.errors, [], 'program should assemble');
  const cpu = new SingleCycleCPU(program);
  return { cpu, ...cpu.run(maxCycles) };
}
const runFile = (name) => runSource(readFileSync(new URL(`../programs/${name}`, import.meta.url), 'utf8'));
const signed = (v) => (v & 0x8000 ? v - 0x10000 : v);

// ---------------- the three test programs ----------------

test('sum.asm: R1 = 15, DMem[0] = 15, 19 cycles', () => {
  const { cpu, stats, stoppedBy } = runFile('sum.asm');
  assert.equal(stoppedBy, 'halt');
  assert.equal(cpu.regs.read(1), 15);
  assert.equal(cpu.dmem.read(0), 15);
  assert.equal(stats.cycles, 19); // 2 setup + 5 loops x 3 + SW + HALT
  assert.equal(stats.cpi, 1);
});

test('fibonacci.asm: first 10 Fibonacci numbers in memory', () => {
  const { cpu, stoppedBy } = runFile('fibonacci.asm');
  assert.equal(stoppedBy, 'halt');
  assert.deepEqual(cpu.dmem.snapshot().slice(0, 10), [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
});

test('array.asm: sum = 24, max = 9', () => {
  const { cpu, stoppedBy } = runFile('array.asm');
  assert.equal(stoppedBy, 'halt');
  assert.equal(cpu.dmem.read(6), 24); // sum label
  assert.equal(cpu.dmem.read(7), 9);  // max label
});

// ---------------- the ALU ----------------

test('ALU operations, including wrap-around and signed SLT', () => {
  assert.equal(alu('ADD', 5, 7).result, 12);
  assert.equal(alu('SUB', 5, 7).result, 0xfffe); // -2 in 16 bits
  assert.equal(alu('AND', 0b1100, 0b1010).result, 0b1000);
  assert.equal(alu('OR', 0b1100, 0b1010).result, 0b1110);
  assert.equal(alu('XOR', 0b1100, 0b1010).result, 0b0110);
  assert.equal(alu('SLT', 0xffff, 1).result, 1); // -1 < 1
  assert.equal(alu('SLT', 1, 0xffff).result, 0);
  assert.equal(alu('SLL', 1, 4).result, 16);
  assert.equal(alu('SRL', 0x8000, 15).result, 1); // logical: fills with 0
  assert.equal(alu('ADD', 0xffff, 1).result, 0);  // overflow wraps to 0
  assert.equal(alu('SUB', 3, 3).zero, true);
});

// ---------------- instruction behaviour ----------------

test('R-type and ADDI with negative numbers', () => {
  const { cpu } = runSource(`
    LI   R1, -5
    LI   R2, 3
    ADD  R3, R1, R2     # -2
    SUB  R4, R2, R1     # 8
    SLT  R5, R1, R2     # 1
    LI   R6, 1
    SLL  R7, R2, R6     # 6
    HALT`);
  assert.equal(signed(cpu.regs.read(3)), -2);
  assert.equal(cpu.regs.read(4), 8);
  assert.equal(cpu.regs.read(5), 1);
  assert.equal(cpu.regs.read(7), 6);
});

test('writes to R0 are ignored', () => {
  const { cpu } = runSource('ADDI R0, R0, 9\nADD R1, R0, R0\nHALT');
  assert.equal(cpu.regs.read(0), 0);
  assert.equal(cpu.regs.read(1), 0);
});

test('LW and SW with base + offset', () => {
  const { cpu } = runSource(`
    LI  R1, 10
    LI  R2, 20
    SW  R2, 5(R1)     # DMem[15] = 20
    LW  R3, 5(R1)     # R3 = DMem[15]
    HALT`);
  assert.equal(cpu.dmem.read(15), 20);
  assert.equal(cpu.regs.read(3), 20);
});

test('BEQ taken / not taken, and J', () => {
  const { cpu } = runSource(`
          LI  R1, 1
          BEQ R1, R0, wrong   # not taken (1 != 0)
          BEQ R0, R0, right   # taken
  wrong:  LI  R2, 9 
          HALT
  right:  LI  R2, 7
          J   done
          LI  R2, 9           # skipped by the jump
  done:   HALT`);
  assert.equal(cpu.regs.read(2), 7);
});

// ---------------- errors and safety ----------------

test('reserved opcode stops the CPU with an error', () => {
  const cpu = new SingleCycleCPU({ code: [0xf000], data: [] });
  const { stoppedBy, trace } = cpu.run();
  assert.equal(stoppedBy, 'error');
  assert.match(trace[0].error, /Reserved/);
});

test('out-of-range memory access stops the CPU with an error', () => {
  const { stoppedBy, cpu } = runSource('LI R1, 31\nSLL R1, R1, R1\nLW R2, 0(R1)\nHALT');
  assert.equal(stoppedBy, 'error');
  assert.match(cpu.error, /out of range/);
});

test('infinite loop is stopped by maxCycles', () => {
  const { stoppedBy, stats } = runSource('top: J top', 50);
  assert.equal(stoppedBy, 'max-cycles');
  assert.equal(stats.cycles, 50);
});

// ---------------- trace records (what the visualizer uses) ----------------

test('trace lists only the units each instruction uses, in order', () => {
  const { trace } = runSource('ADD R1, R2, R3\nLW R1, 0(R0)\nSW R1, 0(R0)\nBEQ R0, R0, +0\nJ 5\nHALT');
  const units = trace.map((t) => t.steps.map((s) => s.unit).join(' '));
  assert.equal(units[0], 'PC IMEM CONTROL REGFILE ALU WB NEXTPC');               // ADD
  assert.equal(units[1], 'PC IMEM CONTROL REGFILE SIGNEXT ALU DMEM WB NEXTPC');  // LW
  assert.equal(units[2], 'PC IMEM CONTROL REGFILE SIGNEXT ALU DMEM NEXTPC');     // SW (no write-back)
  assert.equal(units[3], 'PC IMEM CONTROL REGFILE SIGNEXT ALU NEXTPC');          // BEQ
  assert.equal(units[4], 'PC IMEM CONTROL NEXTPC');                              // J
});

test('trace records register and memory changes', () => {
  const { trace } = runSource('LI R1, 7\nSW R1, 3(R0)\nHALT');
  assert.deepEqual(trace[0].changes.reg, { index: 1, old: 0, new: 7 });
  assert.deepEqual(trace[1].changes.mem, { address: 3, old: 0, new: 7 });
  assert.equal(trace[0].asm, 'ADDI R1, R0, 7');
  assert.equal(trace[2].halted, true);
});
