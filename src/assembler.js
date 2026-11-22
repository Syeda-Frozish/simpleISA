// assembler.js — turns SimpleISA assembly text into 16-bit machine code.
//
// It works in two passes:
//   Pass 1: read every line, give each instruction/data word an address,
//           and remember where every label is.
//   Pass 2: now that all labels are known, encode each instruction.
// Two passes are needed because a branch can jump FORWARD to a label
// that has not been seen yet.

import {
  INSTRUCTIONS,
  PSEUDO_INSTRUCTIONS,
  IMEM_SIZE,
  DMEM_SIZE,
  IMM_MIN,
  IMM_MAX,
  encodeR,
  encodeI,
  encodeJ,
  toHex,
  toBinaryFields,
} from './isa.js';

// Thrown inside pass 2 for one bad line; caught and recorded with its line number.
class AsmError extends Error {}

const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REGISTER = /^R([0-7])$/i;

/**
 * Assemble a program.
 * @param {string} source  assembly text
 * @returns {{
 *   ok: boolean,
 *   code: number[],      // instruction memory words, address 0 upward
 *   data: number[],      // data memory words from .data, address 0 upward
 *   labels: Object,      // name -> { section: 'text'|'data', address }
 *   listing: Object[],   // one row per instruction: address, word, hex, binary, source, line
 *   errors: Object[]     // { line, message }
 * }}
 */
export function assemble(source) {
  const errors = [];
  const labels = new Map();
  const items = []; // instructions and data words found in pass 1

  // ---------------- Pass 1: addresses and labels ----------------
  let section = 'text';
  let textAddr = 0;
  let dataAddr = 0;

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    let text = stripComment(rawLine).trim();

    // Peel off any labels at the start of the line ("loop:", "a: b: ADD ...").
    let match;
    while ((match = text.match(/^([^\s:,()]+)\s*:(.*)$/))) {
      const name = match[1];
      text = match[2].trim();
      if (!LABEL_NAME.test(name)) {
        errors.push({ line, message: `Invalid label name "${name}"` });
      } else if (REGISTER.test(name)) {
        errors.push({ line, message: `"${name}" is a register name and cannot be a label` });
      } else if (labels.has(name)) {
        errors.push({ line, message: `Duplicate label "${name}" (first defined on line ${labels.get(name).line})` });
      } else {
        const address = section === 'text' ? textAddr : dataAddr;
        labels.set(name, { section, address, line });
      }
    }

    if (text === '') return; // blank line, comment-only line, or label-only line

    // Directives
    if (text.startsWith('.')) {
      const [directive, ...rest] = text.split(/\s+/);
      const dir = directive.toLowerCase();
      if (dir === '.text') section = 'text';
      else if (dir === '.data') section = 'data';
      else if (dir === '.word') {
        if (section !== 'data') {
          errors.push({ line, message: '.word is only allowed in the .data section' });
          return;
        }
        const values = splitOperands(rest.join(' '));
        if (values.length === 0 || values.includes('')) {
          errors.push({ line, message: '.word needs one or more comma-separated values' });
          return;
        }
        for (const v of values) {
          items.push({ kind: 'data', line, address: dataAddr, valueText: v });
          dataAddr++;
        }
      } else {
        errors.push({ line, message: `Unknown directive "${directive}"` });
      }
      return;
    }

    if (section === 'data') {
      errors.push({ line, message: 'Instructions are not allowed in the .data section (add ".text" first)' });
      return;
    }

    // An instruction: mnemonic followed by comma-separated operands.
    const spaceAt = text.search(/\s/);
    const mnemonic = (spaceAt === -1 ? text : text.slice(0, spaceAt)).toUpperCase();
    const operandText = spaceAt === -1 ? '' : text.slice(spaceAt + 1);
    items.push({ kind: 'instr', line, address: textAddr, mnemonic, operands: splitOperands(operandText), source: text });
    textAddr++; // every instruction (and every pseudo-instruction) is exactly one word
  });

  if (textAddr > IMEM_SIZE) {
    errors.push({ line: 0, message: `Program has ${textAddr} instructions; instruction memory holds only ${IMEM_SIZE}` });
  }
  if (dataAddr > DMEM_SIZE) {
    errors.push({ line: 0, message: `Program has ${dataAddr} data words; data memory holds only ${DMEM_SIZE}` });
  }

  // ---------------- Pass 2: encode ----------------
  const code = [];
  const data = [];
  const listing = [];

  for (const item of items) {
    try {
      if (item.kind === 'data') {
        const value = parseValue(item.valueText, labels);
        if (value < -32768 || value > 0xffff) {
          throw new AsmError(`.word value ${value} does not fit in 16 bits`);
        }
        data[item.address] = value & 0xffff;
      } else {
        const word = encodeInstruction(item, labels);
        code[item.address] = word;
        listing.push({
          address: item.address,
          word,
          hex: toHex(word),
          binary: toBinaryFields(word),
          source: item.source,
          line: item.line,
        });
      }
    } catch (e) {
      if (!(e instanceof AsmError)) throw e; // a real bug: let it crash loudly
      errors.push({ line: item.line, message: e.message });
    }
  }

  errors.sort((a, b) => a.line - b.line);

  return {
    ok: errors.length === 0,
    code,
    data,
    labels: Object.fromEntries([...labels].map(([name, { section, address }]) => [name, { section, address }])),
    listing,
    errors,
  };
}

// ---------------- Encoding one instruction ----------------

function encodeInstruction(item, labels) {
  let { mnemonic, operands } = item;

  // Expand pseudo-instructions into the real instruction they stand for.
  if (PSEUDO_INSTRUCTIONS.includes(mnemonic)) {
    if (mnemonic === 'NOP') {
      expectCount(mnemonic, operands, 0);
      return encodeR(INSTRUCTIONS.ADD.opcode, 0, 0, 0);
    }
    if (mnemonic === 'MOV') {
      expectCount(mnemonic, operands, 2, 'MOV rd, rs');
      return encodeR(INSTRUCTIONS.ADD.opcode, parseRegister(operands[0]), parseRegister(operands[1]), 0);
    }
    if (mnemonic === 'LI') {
      expectCount(mnemonic, operands, 2, 'LI rd, imm');
      const imm = checkImmediate(parseValue(operands[1], labels));
      return encodeI(INSTRUCTIONS.ADDI.opcode, parseRegister(operands[0]), 0, imm);
    }
  }

  const info = INSTRUCTIONS[mnemonic];
  if (!info) throw new AsmError(`Unknown instruction "${mnemonic}"`);
  const { opcode, format } = info;

  if (format === 'R') {
    expectCount(mnemonic, operands, 3, `${mnemonic} rd, rs, rt`);
    const [rd, rs, rt] = operands.map(parseRegister);
    return encodeR(opcode, rd, rs, rt);
  }

  if (mnemonic === 'ADDI') {
    expectCount(mnemonic, operands, 3, 'ADDI rA, rB, imm');
    const rA = parseRegister(operands[0]);
    const rB = parseRegister(operands[1]);
    const imm = checkImmediate(parseValue(operands[2], labels));
    return encodeI(opcode, rA, rB, imm);
  }

  if (mnemonic === 'LW' || mnemonic === 'SW') {
    expectCount(mnemonic, operands, 2, `${mnemonic} rA, imm(rB)`);
    const rA = parseRegister(operands[0]);
    const { offset, base } = parseMemoryOperand(operands[1], labels);
    return encodeI(opcode, rA, base, checkImmediate(offset));
  }

  if (mnemonic === 'BEQ' || mnemonic === 'BNE') {
    expectCount(mnemonic, operands, 3, `${mnemonic} rA, rB, label`);
    const rA = parseRegister(operands[0]);
    const rB = parseRegister(operands[1]);
    const target = operands[2];
    let offset;
    if (isNumber(target)) {
      offset = parseNumber(target); // a raw offset written by hand
    } else {
      const label = lookupLabel(target, labels);
      if (label.section !== 'text') throw new AsmError(`Branch target "${target}" is a data label, not code`);
      offset = label.address - (item.address + 1); // PC-relative, counted from the next instruction
    }
    if (offset < IMM_MIN || offset > IMM_MAX) {
      throw new AsmError(`Branch target is ${offset} instructions away; branches reach only ${IMM_MIN}..+${IMM_MAX}`);
    }
    return encodeI(opcode, rA, rB, offset);
  }

  if (mnemonic === 'J') {
    expectCount(mnemonic, operands, 1, 'J label');
    const target = operands[0];
    let address;
    if (isNumber(target)) {
      address = parseNumber(target);
    } else {
      const label = lookupLabel(target, labels);
      if (label.section !== 'text') throw new AsmError(`Jump target "${target}" is a data label, not code`);
      address = label.address;
    }
    if (address < 0 || address >= IMEM_SIZE) {
      throw new AsmError(`Jump address ${address} is outside instruction memory (0..${IMEM_SIZE - 1})`);
    }
    return encodeJ(opcode, address);
  }

  if (mnemonic === 'HALT') {
    expectCount(mnemonic, operands, 0);
    return encodeJ(opcode, 0);
  }

  throw new AsmError(`No encoder for "${mnemonic}"`); // should never happen
}

// ---------------- Small parsing helpers ----------------

function stripComment(line) {
  const cut = line.search(/[#;]/);
  return cut === -1 ? line : line.slice(0, cut);
}

function splitOperands(text) {
  if (text.trim() === '') return [];
  return text.split(',').map((s) => s.trim());
}

function expectCount(mnemonic, operands, count, usage) {
  if (operands.includes('')) throw new AsmError(`Empty operand in ${mnemonic} (check the commas)`);
  if (operands.length !== count) {
    const hint = usage ? ` — expected: ${usage}` : '';
    throw new AsmError(`${mnemonic} needs ${count} operand${count === 1 ? '' : 's'}, got ${operands.length}${hint}`);
  }
}

function parseRegister(text) {
  const m = text.match(REGISTER);
  if (!m) throw new AsmError(`"${text}" is not a register (use R0..R7)`);
  return Number(m[1]);
}

function isNumber(text) {
  return /^[+-]?(0x[0-9a-f]+|\d+)$/i.test(text);
}

function parseNumber(text) {
  const negative = text.startsWith('-');
  const body = text.replace(/^[+-]/, '');
  const value = /^0x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body, 10);
  return negative ? -value : value;
}

function lookupLabel(name, labels) {
  if (!LABEL_NAME.test(name)) throw new AsmError(`"${name}" is not a number or a label`);
  const label = labels.get(name);
  if (!label) throw new AsmError(`Undefined label "${name}"`);
  return label;
}

// A number, or a label used as a number (its address).
function parseValue(text, labels) {
  if (isNumber(text)) return parseNumber(text);
  return lookupLabel(text, labels).address;
}

function checkImmediate(value) {
  if (value < IMM_MIN || value > IMM_MAX) {
    throw new AsmError(`Immediate ${value} is out of range (${IMM_MIN}..${IMM_MAX})`);
  }
  return value;
}

// "4(R2)" -> { offset: 4, base: 2 };  "(R2)" -> offset 0;  "nums(R0)" -> label address
function parseMemoryOperand(text, labels) {
  const m = text.match(/^(.*)\(\s*([^()]*?)\s*\)$/);
  if (!m) throw new AsmError(`"${text}" is not a memory operand (use offset(Rn), e.g. 4(R2))`);
  const offsetText = m[1].trim();
  const offset = offsetText === '' ? 0 : parseValue(offsetText, labels);
  return { offset, base: parseRegister(m[2]) };
}
