// Pipelined CPU tests. Run with:  npm test
//
// The most important test: for every program, the pipeline must end with
// EXACTLY the same registers and memory as the single-cycle CPU.
// The rest check that stalls and flushes happen exactly when they should.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/assembler.js';
import { PipelinedCPU } from '../src/pipeline.js';
import { compare } from '../src/compare.js';

function asm(source) {
  const p = assemble(source);
  assert.deepEqual(p.errors, [], 'program should assemble');
  return p;
}
function runPipe(source, maxCycles) {
  const cpu = new PipelinedCPU(asm(source));
  return { cpu, ...cpu.run(maxCycles) };
}
const load = (name) => asm(readFileSync(new URL(`../programs/${name}`, import.meta.url), 'utf8'));

// ---------------- same answers as the single-cycle CPU ----------------

for (const name of ['sum.asm', 'fibonacci.asm', 'array.asm']) {
  test(`${name}: pipeline gives the same registers and memory as single-cycle`, () => {
    const r = compare(load(name));
    assert.equal(r.single.stoppedBy, 'halt');
    assert.equal(r.pipelined.stoppedBy, 'halt');
    assert.equal(r.sameResult, true);
    assert.equal(r.pipelined.instructions, r.single.instructions); // same work done
  });
}

test('sum.asm pipeline numbers (regression check)', () => {
  const { stats } = runPipe(readFileSync(new URL('../programs/sum.asm', import.meta.url), 'utf8'));
  assert.deepEqual(
    { cycles: stats.cycles, instructions: stats.instructions, stalls: stats.stalls, flushes: stats.flushes },
    { cycles: 43, instructions: 19, stalls: 12, flushes: 8 },
  );
});

// ---------------- no hazards: the ideal pipeline ----------------

test('independent instructions: N instructions take N + 4 cycles, no stalls', () => {
  const { stats, cpu } = runPipe(`
    LI R1, 1
    LI R2, 2
    LI R3, 3
    LI R4, 4
    HALT`);
  assert.equal(stats.cycles, 5 + 4); // 4 cycles to fill the pipeline
  assert.equal(stats.stalls, 0);
  assert.equal(stats.flushes, 0);
  assert.deepEqual(cpu.regs.snapshot().slice(1, 5), [1, 2, 3, 4]);
});

// ---------------- data hazards (stalls) ----------------

test('dependent instruction right after the producer: 2 stalls', () => {
  const { stats, cpu } = runPipe('LI R1, 5\nADD R2, R1, R1\nHALT');
  assert.equal(stats.stalls, 2);
  assert.equal(cpu.regs.read(2), 10);
});

test('one instruction in between: 1 stall', () => {
  const { stats } = runPipe('LI R1, 5\nLI R3, 1\nADD R2, R1, R1\nHALT');
  assert.equal(stats.stalls, 1);
});

test('two instructions in between: no stall (write first half, read second half)', () => {
  const { stats } = runPipe('LI R1, 5\nLI R3, 1\nLI R4, 2\nADD R2, R1, R1\nHALT');
  assert.equal(stats.stalls, 0);
});

test('load followed by use: 2 stalls, correct value', () => {
  const { stats, cpu } = runPipe('LI R1, 9\nSW R1, 3(R0)\nLW R2, 3(R0)\nADDI R3, R2, 1\nHALT');
  assert.equal(cpu.regs.read(3), 10);
  assert.ok(stats.stalls >= 2);
});

test('SW waits for the value it stores', () => {
  const { cpu, stats } = runPipe('LI R1, 7\nSW R1, 0(R0)\nHALT');
  assert.equal(cpu.dmem.read(0), 7);
  assert.equal(stats.stalls, 2);
});

test('writing R0 never causes a stall', () => {
  const { stats } = runPipe('ADDI R0, R0, 5\nADD R1, R0, R0\nHALT');
  assert.equal(stats.stalls, 0);
});

// ---------------- control hazards (flushes) ----------------

test('taken branch flushes 2 wrong-path instructions, which have no effect', () => {
  const { stats, cpu } = runPipe(`
          BEQ R0, R0, skip   # always taken
          LI  R1, 7          # wrong path: must NOT happen
          LI  R2, 7          # wrong path: must NOT happen
  skip:   HALT`);
  assert.equal(stats.flushes, 2);
  assert.equal(cpu.regs.read(1), 0);
  assert.equal(cpu.regs.read(2), 0);
});

test('not-taken branch flushes nothing', () => {
  const { stats, cpu } = runPipe('LI R1, 1\nLI R3, 0\nLI R4, 0\nBEQ R1, R0, out\nLI R2, 3\nout: HALT');
  assert.equal(stats.flushes, 0);
  assert.equal(cpu.regs.read(2), 3);
});

test('jump flushes 1 wrong-path instruction', () => {
  const { stats, cpu } = runPipe('J end\nLI R1, 7\nend: HALT');
  assert.equal(stats.flushes, 1);
  assert.equal(cpu.regs.read(1), 0);
});

test('nothing after HALT is executed', () => {
  const { cpu } = runPipe('HALT\nLI R1, 5');
  assert.equal(cpu.regs.read(1), 0);
});

test('a wrong-path store does not change memory', () => {
  const { cpu } = runPipe('LI R1, 9\nLI R2, 0\nLI R3, 0\nJ end\nSW R1, 0(R0)\nend: HALT');
  assert.equal(cpu.dmem.read(0), 0);
});

// ---------------- errors ----------------

test('reserved opcode on the real path stops with an error', () => {
  const cpu = new PipelinedCPU({ code: [0xf000, 0xe000], data: [] });
  const { stoppedBy } = cpu.run();
  assert.equal(stoppedBy, 'error');
  assert.match(cpu.error, /Reserved/);
});

test('reserved opcode on a flushed (wrong) path is harmless', () => {
  // J 2 ; <reserved word> ; HALT  -> the reserved word is fetched but flushed
  const cpu = new PipelinedCPU({ code: [0xd002, 0xf000, 0xe000], data: [] });
  const { stoppedBy } = cpu.run();
  assert.equal(stoppedBy, 'halt');
});

test('infinite loop stops at maxCycles', () => {
  const { stoppedBy } = runPipe('top: J top', 30);
  assert.equal(stoppedBy, 'max-cycles');
});

// ---------------- trace (what the page draws) ----------------

test('trace shows each stage; stall and flush are marked', () => {
  const { trace } = runPipe('LI R1, 5\nADD R2, R1, R1\nHALT');
  assert.equal(trace[0].stages.IF.asm, 'ADDI R1, R0, 5');
  assert.equal(trace[1].stages.ID.asm, 'ADDI R1, R0, 5');
  const stallCycle = trace.find((t) => t.stall);
  assert.equal(stallCycle.stages.ID.status, 'stall');
  assert.equal(stallCycle.stages.EX.asm, 'ADDI R1, R0, 5');
  assert.ok(trace.some((t) => t.stages.EX?.bubble), 'a bubble should appear in EX');

  const j = runPipe('J end\nLI R1, 7\nend: HALT').trace;
  assert.ok(j.some((t) => t.stages.IF?.status === 'flushed'));
});
