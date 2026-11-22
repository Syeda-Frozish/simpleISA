// Assembler tests. Run with:  npm test
// Uses Node's built-in test runner, so nothing needs to be installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/assembler.js';
import { disassemble } from '../src/isa.js';

// Assemble one line and return its word (fails the test if there are errors).
function one(line) {
  const r = assemble(line);
  assert.deepEqual(r.errors, [], `unexpected errors for "${line}"`);
  return r.code[0];
}

// Assemble and return just the error messages.
function errorsOf(source) {
  return assemble(source).errors.map((e) => e.message).join(' | ');
}

test('encodings match the table in ISA_SPEC.md section 5', () => {
  assert.equal(one('ADD R1, R2, R3'), 0x0298);
  assert.equal(one('SUB R4, R5, R6'), 0x1970);
  assert.equal(one('SLT R3, R1, R2'), 0x5650);
  assert.equal(one('ADDI R1, R0, 5'), 0x8205);
  assert.equal(one('ADDI R2, R2, -1'), 0x84bf);
  assert.equal(one('LW R1, 4(R2)'), 0x9284);
  assert.equal(one('SW R1, 4(R2)'), 0xa284);
  assert.equal(one('BEQ R1, R2, +3'), 0xb283);
  assert.equal(one('BNE R2, R0, -3'), 0xc43d);
  assert.equal(one('J 5'), 0xd005);
  assert.equal(one('HALT'), 0xe000);
  assert.equal(one('NOP'), 0x0000);
});

test('sum.asm assembles to the hex in ISA_SPEC.md section 7', () => {
  const r = assemble(readFileSync(new URL('../programs/sum.asm', import.meta.url), 'utf8'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.code, [0x8200, 0x8405, 0x0250, 0x84bf, 0xc43d, 0xa200, 0xe000]);
  assert.deepEqual(r.labels.loop, { section: 'text', address: 2 });
});

test('forward branches and jumps resolve labels', () => {
  const r = assemble(`
        BEQ R1, R0, done   # 0: jumps forward
        ADDI R1, R1, 1     # 1
        J done             # 2
  done: HALT               # 3
  `);
  assert.deepEqual(r.errors, []);
  assert.equal(r.code[0], 0xb202); // offset = 3 - (0 + 1) = 2
  assert.equal(r.code[2], 0xd003);
});

test('pseudo-instructions expand correctly', () => {
  assert.equal(one('MOV R3, R5'), one('ADD R3, R5, R0'));
  assert.equal(one('LI R2, -7'), one('ADDI R2, R0, -7'));
});

test('case, comments, hex numbers and label-only lines are accepted', () => {
  const r = assemble(`
  ; a comment line
  start:
     addi r1, r0, 0x0A   # hex 10
     add R1, r1, R1      ; mixed case
     j start
  `);
  assert.deepEqual(r.errors, []);
  assert.equal(r.code[0], one('ADDI R1, R0, 10'));
  assert.equal(r.code[2], 0xd000);
});

test('.data and .word place values in data memory; labels usable as offsets', () => {
  const r = assemble(`
  .data
  nums:  .word 4, 7, -1
  total: .word 0
  .text
         LW R1, nums(R0)
         SW R1, total(R0)
         HALT
  `);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data, [4, 7, 0xffff, 0]);
  assert.deepEqual(r.labels.total, { section: 'data', address: 3 });
  assert.equal(r.code[0], one('LW R1, 0(R0)'));
  assert.equal(r.code[1], one('SW R1, 3(R0)'));
});

test('memory operand without offset means 0', () => {
  assert.equal(one('LW R1, (R2)'), one('LW R1, 0(R2)'));
});

test('errors are reported with line numbers', () => {
  const r = assemble('ADD R1, R2, R3\nFOO R1\nADDI R1, R0, 99');
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.line), [2, 3]);
});

test('each kind of mistake gives a clear message', () => {
  assert.match(errorsOf('FOO R1'), /Unknown instruction "FOO"/);
  assert.match(errorsOf('ADD R1, R2'), /needs 3 operands, got 2/);
  assert.match(errorsOf('ADD R1, R2, R8'), /"R8" is not a register/);
  assert.match(errorsOf('ADDI R1, R0, 32'), /out of range/);
  assert.match(errorsOf('ADDI R1, R0, -33'), /out of range/);
  assert.match(errorsOf('BEQ R1, R0, nowhere'), /Undefined label "nowhere"/);
  assert.match(errorsOf('a: NOP\na: NOP'), /Duplicate label "a"/);
  assert.match(errorsOf('LW R1, R2'), /not a memory operand/);
  assert.match(errorsOf('ADD R1,, R2'), /Empty operand/);
  assert.match(errorsOf('J 300'), /outside instruction memory/);
  assert.match(errorsOf('HALT R1'), /needs 0 operands/);
  assert.match(errorsOf('.data\nADD R1, R2, R3'), /not allowed in the .data section/);
  assert.match(errorsOf('.word 5'), /only allowed in the .data section/);
  assert.match(errorsOf('.bogus'), /Unknown directive/);
  assert.match(errorsOf('R1: NOP'), /register name/);
});

test('branch too far is caught', () => {
  const far = 'BEQ R0, R0, end\n' + 'NOP\n'.repeat(40) + 'end: HALT';
  assert.match(errorsOf(far), /branches reach only/);
});

test('disassemble reverses assemble', () => {
  const lines = [
    'ADD R1, R2, R3', 'SUB R4, R5, R6', 'AND R7, R1, R2', 'OR R1, R1, R1', 'XOR R2, R3, R4',
    'SLT R3, R1, R2', 'SLL R1, R2, R3', 'SRL R1, R2, R3', 'ADDI R1, R2, -5', 'LW R1, 4(R2)',
    'SW R3, -2(R4)', 'BEQ R1, R2, +3', 'BNE R2, R0, -3', 'J 17', 'HALT',
  ];
  for (const line of lines) assert.equal(disassemble(one(line)), line);
});
