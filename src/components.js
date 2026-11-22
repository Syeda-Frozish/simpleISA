// components.js — the hardware building blocks of the CPU.
// Both the single-cycle CPU and the pipelined CPU use these same parts.

import { NUM_REGS, WORD_MASK, toSigned16, INSTRUCTIONS } from './isa.js';

// Raised when the program does something illegal (bad memory address, reserved opcode).
export class CPUError extends Error {}

// ---------------- Register file ----------------
// 8 registers of 16 bits. R0 always reads 0 and ignores writes.
export class RegisterFile {
  constructor() {
    this.regs = new Array(NUM_REGS).fill(0);
  }
  read(n) {
    return n === 0 ? 0 : this.regs[n];
  }
  write(n, value) {
    if (n !== 0) this.regs[n] = value & WORD_MASK;
  }
  snapshot() {
    return [...this.regs];
  }
}

// ---------------- Memory ----------------
// Used for both instruction memory and data memory.
export class Memory {
  constructor(size, name, initial = []) {
    this.name = name;
    this.words = new Array(size).fill(0);
    initial.forEach((v, i) => {
      if (v !== undefined) this.words[i] = v & WORD_MASK;
    });
  }
  check(address) {
    if (!Number.isInteger(address) || address < 0 || address >= this.words.length) {
      throw new CPUError(`${this.name} address ${address} is out of range (0..${this.words.length - 1})`);
    }
  }
  read(address) {
    this.check(address);
    return this.words[address];
  }
  write(address, value) {
    this.check(address);
    this.words[address] = value & WORD_MASK;
  }
  snapshot() {
    return [...this.words];
  }
}

// ---------------- ALU ----------------
// Takes two 16-bit inputs and an operation name.
// Returns the 16-bit result and the zero flag (used by BEQ/BNE).
export function alu(op, a, b) {
  let result;
  switch (op) {
    case 'ADD': result = a + b; break;
    case 'SUB': result = a - b; break;
    case 'AND': result = a & b; break;
    case 'OR':  result = a | b; break;
    case 'XOR': result = a ^ b; break;
    case 'SLT': result = toSigned16(a) < toSigned16(b) ? 1 : 0; break;
    case 'SLL': result = a << (b & 0xf); break;
    case 'SRL': result = (a & WORD_MASK) >>> (b & 0xf); break;
    default: throw new CPUError(`ALU has no operation "${op}"`);
  }
  result &= WORD_MASK; // keep 16 bits (this is the overflow wrap-around)
  return { result, zero: result === 0 };
}

// Symbol used in captions, e.g. "5 + 7 = 12".
export const ALU_SYMBOL = { ADD: '+', SUB: '-', AND: '&', OR: '|', XOR: '^', SLT: '<', SLL: '<<', SRL: '>>' };

// ---------------- Control unit ----------------
// Looks at the instruction name (from the opcode) and produces the control signals.
// This is the table in ISA_SPEC.md section 4.
const NONE = {
  regWrite: false, // write a register at the end?
  regDst: null,    // which field is the destination: 'rd' (R-type) or 'rA' (I-type)
  aluSrc: 'reg',   // ALU second input: 'reg' or 'imm'
  aluOp: null,     // ALU operation
  memRead: false,
  memWrite: false,
  memToReg: false, // write-back value comes from memory (true) or ALU (false)
  branch: null,    // 'EQ' (BEQ), 'NE' (BNE) or null
  jump: false,
  halt: false,
};

export function control(name) {
  const fmt = INSTRUCTIONS[name]?.format;
  if (fmt === 'R') return { ...NONE, regWrite: true, regDst: 'rd', aluOp: name };
  switch (name) {
    case 'ADDI': return { ...NONE, regWrite: true, regDst: 'rA', aluSrc: 'imm', aluOp: 'ADD' };
    case 'LW':   return { ...NONE, regWrite: true, regDst: 'rA', aluSrc: 'imm', aluOp: 'ADD', memRead: true, memToReg: true };
    case 'SW':   return { ...NONE, aluSrc: 'imm', aluOp: 'ADD', memWrite: true };
    case 'BEQ':  return { ...NONE, aluOp: 'SUB', branch: 'EQ' };
    case 'BNE':  return { ...NONE, aluOp: 'SUB', branch: 'NE' };
    case 'J':    return { ...NONE, jump: true };
    case 'HALT': return { ...NONE, halt: true };
    default: throw new CPUError(`Reserved/unknown opcode (${name})`);
  }
}
