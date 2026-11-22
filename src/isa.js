// isa.js — SimpleISA definitions shared by every module.
// Follows docs/ISA_SPEC.md (v1.0). If the spec changes, change this file first.

export const WORD_BITS = 16;
export const WORD_MASK = 0xffff;
export const NUM_REGS = 8;
export const IMEM_SIZE = 256; // instruction memory, in words
export const DMEM_SIZE = 256; // data memory, in words
export const IMM_MIN = -32; // 6-bit signed immediate
export const IMM_MAX = 31;

// Every real instruction: its 4-bit opcode and its format.
export const INSTRUCTIONS = {
  ADD:  { opcode: 0x0, format: 'R' },
  SUB:  { opcode: 0x1, format: 'R' },
  AND:  { opcode: 0x2, format: 'R' },
  OR:   { opcode: 0x3, format: 'R' },
  XOR:  { opcode: 0x4, format: 'R' },
  SLT:  { opcode: 0x5, format: 'R' },
  SLL:  { opcode: 0x6, format: 'R' },
  SRL:  { opcode: 0x7, format: 'R' },
  ADDI: { opcode: 0x8, format: 'I' },
  LW:   { opcode: 0x9, format: 'I' },
  SW:   { opcode: 0xa, format: 'I' },
  BEQ:  { opcode: 0xb, format: 'I' },
  BNE:  { opcode: 0xc, format: 'I' },
  J:    { opcode: 0xd, format: 'J' },
  HALT: { opcode: 0xe, format: 'J' },
};

// Reverse lookup: opcode number -> mnemonic (opcode 15 is reserved).
export const OPCODE_NAMES = Object.fromEntries(
  Object.entries(INSTRUCTIONS).map(([name, info]) => [info.opcode, name]),
);

// Shortcuts the assembler expands into one real instruction each.
export const PSEUDO_INSTRUCTIONS = ['NOP', 'MOV', 'LI'];

// ---------- Encoding: fields -> 16-bit word ----------

export function encodeR(opcode, rd, rs, rt) {
  return ((opcode & 0xf) << 12) | ((rd & 7) << 9) | ((rs & 7) << 6) | ((rt & 7) << 3);
}

export function encodeI(opcode, rA, rB, imm) {
  return ((opcode & 0xf) << 12) | ((rA & 7) << 9) | ((rB & 7) << 6) | (imm & 0x3f);
}

export function encodeJ(opcode, address) {
  return ((opcode & 0xf) << 12) | (address & 0xfff);
}

// ---------- Decoding: 16-bit word -> fields ----------

// Turn a 6-bit field (0..63) into a signed number (-32..31).
export function signExtend6(value) {
  value &= 0x3f;
  return value & 0x20 ? value - 64 : value;
}

// Turn a 16-bit word (0..65535) into a signed number (-32768..32767).
export function toSigned16(value) {
  value &= WORD_MASK;
  return value & 0x8000 ? value - 0x10000 : value;
}

export function decode(word) {
  word &= WORD_MASK;
  const opcode = (word >> 12) & 0xf;
  const name = OPCODE_NAMES[opcode] ?? 'RESERVED';
  const format = INSTRUCTIONS[name]?.format ?? null;
  return {
    word,
    opcode,
    name,
    format,
    // R-type fields
    rd: (word >> 9) & 7,
    rs: (word >> 6) & 7,
    rt: (word >> 3) & 7,
    // I-type fields (rA shares bits with rd, rB with rs)
    rA: (word >> 9) & 7,
    rB: (word >> 6) & 7,
    imm: signExtend6(word & 0x3f),
    // J-type field
    address: word & 0xfff,
  };
}

// Turn a word back into readable assembly (used by the CPUs and visualizer).
export function disassemble(word) {
  const d = decode(word);
  if (d.word === 0) return 'NOP';
  const r = (n) => `R${n}`;
  switch (d.name) {
    case 'ADDI':
      return `ADDI ${r(d.rA)}, ${r(d.rB)}, ${d.imm}`;
    case 'LW':
    case 'SW':
      return `${d.name} ${r(d.rA)}, ${d.imm}(${r(d.rB)})`;
    case 'BEQ':
    case 'BNE':
      return `${d.name} ${r(d.rA)}, ${r(d.rB)}, ${d.imm >= 0 ? '+' : ''}${d.imm}`;
    case 'J':
      return `J ${d.address}`;
    case 'HALT':
      return 'HALT';
    case 'RESERVED':
      return `RESERVED (${toHex(word)})`;
    default: // R-type
      return `${d.name} ${r(d.rd)}, ${r(d.rs)}, ${r(d.rt)}`;
  }
}

// ---------- Display helpers ----------

export function toHex(word) {
  return '0x' + (word & WORD_MASK).toString(16).toUpperCase().padStart(4, '0');
}

// Binary string split into the fields of the instruction's format.
export function toBinaryFields(word) {
  const b = (word & WORD_MASK).toString(2).padStart(16, '0');
  const format = decode(word).format;
  if (format === 'R') return [b.slice(0, 4), b.slice(4, 7), b.slice(7, 10), b.slice(10, 13), b.slice(13)].join(' ');
  if (format === 'I') return [b.slice(0, 4), b.slice(4, 7), b.slice(7, 10), b.slice(10)].join(' ');
  return [b.slice(0, 4), b.slice(4)].join(' ');
}
