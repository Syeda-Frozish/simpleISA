// singleCycle.js — the single-cycle CPU.
// Every instruction does ALL of its work in one clock cycle:
//   fetch -> decode/control -> read registers -> ALU -> memory -> write back -> next PC
//
// Each call to step() runs one instruction and returns a TRACE RECORD describing
// which units were used, in order, with the values that passed through them.
// The visualizer animates these records. (Format: docs/TRACE_FORMAT.md)

import { IMEM_SIZE, DMEM_SIZE, decode, disassemble, toHex, toSigned16 } from './isa.js';
import { RegisterFile, Memory, alu, control, CPUError, ALU_SYMBOL } from './components.js';

// Unit IDs used in trace steps. The visualizer maps each one to a box in the datapath SVG.
export const UNITS = {
  PC: 'PC',
  IMEM: 'IMEM',
  CONTROL: 'CONTROL',
  REGFILE: 'REGFILE',
  SIGNEXT: 'SIGNEXT',
  ALU: 'ALU',
  DMEM: 'DMEM',
  WB: 'WB',
  NEXTPC: 'NEXTPC',
};

export class SingleCycleCPU {
  /** @param {{code: number[], data: number[]}} program  output of assemble() */
  constructor(program) {
    this.program = program;
    this.reset();
  }

  reset() {
    this.pc = 0;
    this.regs = new RegisterFile();
    this.imem = new Memory(IMEM_SIZE, 'Instruction memory', this.program.code);
    this.dmem = new Memory(DMEM_SIZE, 'Data memory', this.program.data ?? []);
    this.cycle = 0;
    this.halted = false;
    this.error = null;
  }

  /** Run one instruction. Returns its trace record (or null if already stopped). */
  step() {
    if (this.halted) return null;

    this.cycle++;
    const pc = this.pc;
    const steps = [];
    const add = (unit, caption, values = {}) => steps.push({ unit, caption, values });
    const record = {
      cycle: this.cycle,
      pc,
      word: null,
      hex: null,
      asm: null,
      name: null,
      control: null,
      steps,
      changes: { reg: null, mem: null },
      nextPc: null,
      halted: false,
      error: null,
    };

    try {
      // 1. FETCH
      add(UNITS.PC, `PC = ${pc}: address of the next instruction`, { pc });
      const word = this.imem.read(pc);
      const d = decode(word);
      record.word = word;
      record.hex = toHex(word);
      record.asm = disassemble(word);
      record.name = d.name;
      add(UNITS.IMEM, `Fetch IMEM[${pc}] = ${toHex(word)} → ${record.asm}`, { address: pc, word });

      // 2. DECODE + CONTROL
      const c = control(d.name); // throws on reserved opcode
      record.control = c;
      add(UNITS.CONTROL, `Opcode ${d.opcode.toString(2).padStart(4, '0')} = ${d.name}: ${describeControl(c)}`, {
        opcode: d.opcode,
        signals: c,
      });

      if (c.halt) {
        this.halted = true;
        record.halted = true;
        record.nextPc = pc;
        add(UNITS.NEXTPC, 'HALT: the CPU stops', { pc });
        return record;
      }

      if (c.jump) {
        this.pc = d.address;
        record.nextPc = this.pc;
        add(UNITS.NEXTPC, `Jump: PC = ${d.address}`, { from: pc, to: d.address });
        return record;
      }

      // 3. READ REGISTERS
      //   R-type:        ALU inputs are rs and rt
      //   BEQ/BNE:       ALU compares rA and rB
      //   ADDI/LW/SW:    ALU input is rB (+ immediate); SW also reads rA = value to store
      const isR = d.format === 'R';
      const aReg = c.branch ? d.rA : isR ? d.rs : d.rB;
      const bReg = c.branch ? d.rB : isR ? d.rt : null;
      const aVal = this.regs.read(aReg);
      const bVal = bReg === null ? null : this.regs.read(bReg);
      const storeVal = c.memWrite ? this.regs.read(d.rA) : null;

      const reads = [`R${aReg} = ${toSigned16(aVal)}`];
      if (bReg !== null) reads.push(`R${bReg} = ${toSigned16(bVal)}`);
      if (c.memWrite) reads.push(`R${d.rA} = ${toSigned16(storeVal)} (value to store)`);
      const regValues = { [`R${aReg}`]: aVal };
      if (bReg !== null) regValues[`R${bReg}`] = bVal;
      if (c.memWrite) regValues[`R${d.rA}`] = storeVal;
      add(UNITS.REGFILE, `Read ${reads.join(', ')}`, regValues);

      // 4. SIGN-EXTEND the immediate (I-type that uses it in the ALU)
      let aluB = bVal;
      if (c.aluSrc === 'imm') {
        aluB = d.imm & 0xffff;
        add(UNITS.SIGNEXT, `Sign-extend immediate ${d.imm} to 16 bits`, { imm: d.imm });
      } else if (c.branch) {
        add(UNITS.SIGNEXT, `Sign-extend branch offset ${d.imm}`, { imm: d.imm });
      }

      // 5. ALU
      const { result, zero } = alu(c.aluOp, aVal, aluB);
      add(UNITS.ALU, aluCaption(c, aVal, aluB, result, zero), { op: c.aluOp, a: aVal, b: aluB, result, zero });

      // 6. DATA MEMORY
      let memData = null;
      if (c.memRead) {
        memData = this.dmem.read(result);
        add(UNITS.DMEM, `Load DMEM[${result}] = ${toSigned16(memData)}`, { address: result, value: memData });
      } else if (c.memWrite) {
        const old = this.dmem.read(result);
        this.dmem.write(result, storeVal);
        record.changes.mem = { address: result, old, new: storeVal };
        add(UNITS.DMEM, `Store ${toSigned16(storeVal)} into DMEM[${result}]`, { address: result, value: storeVal });
      }

      // 7. WRITE BACK
      if (c.regWrite) {
        const dest = c.regDst === 'rd' ? d.rd : d.rA;
        const value = c.memToReg ? memData : result;
        const old = this.regs.read(dest);
        this.regs.write(dest, value);
        if (dest === 0) {
          add(UNITS.WB, `Write to R0 ignored (R0 is always 0)`, { reg: 0, value });
        } else {
          record.changes.reg = { index: dest, old, new: value & 0xffff };
          add(UNITS.WB, `Write ${toSigned16(value)} into R${dest} (from ${c.memToReg ? 'memory' : 'ALU'})`, {
            reg: dest,
            value,
          });
        }
      }

      // 8. NEXT PC
      let next = pc + 1;
      if (c.branch) {
        const taken = c.branch === 'EQ' ? zero : !zero;
        if (taken) {
          next = pc + 1 + d.imm;
          add(UNITS.NEXTPC, `Branch taken: PC = ${pc} + 1 + (${d.imm}) = ${next}`, { taken, to: next });
        } else {
          add(UNITS.NEXTPC, `Branch not taken: PC = ${pc} + 1 = ${next}`, { taken, to: next });
        }
      } else {
        add(UNITS.NEXTPC, `PC = ${pc} + 1 = ${next}`, { to: next });
      }
      if (next < 0 || next >= IMEM_SIZE) throw new CPUError(`Next PC ${next} is outside instruction memory`);
      this.pc = next;
      record.nextPc = next;
      return record;
    } catch (e) {
      if (!(e instanceof CPUError)) throw e;
      this.halted = true;
      this.error = e.message;
      record.halted = true;
      record.error = e.message;
      return record;
    }
  }

  /** Run until HALT, an error, or maxCycles (protects against infinite loops). */
  run(maxCycles = 10000) {
    const trace = [];
    while (!this.halted && this.cycle < maxCycles) trace.push(this.step());
    let stoppedBy = 'halt';
    if (this.error) stoppedBy = 'error';
    else if (!this.halted) stoppedBy = 'max-cycles';
    return { trace, stats: this.stats(), stoppedBy };
  }

  /** Performance numbers for the comparison table. */
  stats() {
    const instructions = this.cycle; // single-cycle: exactly one instruction per cycle
    return { cycles: this.cycle, instructions, cpi: instructions ? this.cycle / instructions : 0, stalls: 0, flushes: 0 };
  }

  state() {
    return { pc: this.pc, regs: this.regs.snapshot(), dmem: this.dmem.snapshot(), halted: this.halted, error: this.error, cycle: this.cycle };
  }
}

// ---------------- caption helpers ----------------

function describeControl(c) {
  const on = [];
  if (c.regWrite) on.push('RegWrite');
  if (c.aluSrc === 'imm') on.push('ALUSrc=imm');
  if (c.memRead) on.push('MemRead');
  if (c.memWrite) on.push('MemWrite');
  if (c.memToReg) on.push('MemToReg');
  if (c.branch) on.push(`Branch=${c.branch}`);
  if (c.jump) on.push('Jump');
  if (c.halt) on.push('Halt');
  if (c.aluOp) on.push(`ALUOp=${c.aluOp}`);
  return on.join(', ') || 'no signals';
}

function aluCaption(c, a, b, result, zero) {
  const sa = toSigned16(a);
  const sb = toSigned16(b);
  if (c.branch) {
    return `Compare: ${sa} - ${sb} = ${toSigned16(result)} → zero = ${zero}`;
  }
  if (c.memRead || c.memWrite) return `Address = ${sa} + ${sb} = ${result}`;
  if (c.aluOp === 'SLT') return `${sa} < ${sb} ? → ${result}`;
  return `${sa} ${ALU_SYMBOL[c.aluOp]} ${sb} = ${toSigned16(result)}`;
}
