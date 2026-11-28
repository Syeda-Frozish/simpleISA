// pipeline.js — the 5-stage pipelined CPU.
//
//   IF  -> ID  -> EX  -> MEM -> WB
//   fetch  decode  ALU   memory  write back
//
// A new instruction enters every cycle, so up to 5 are in flight at once.
// Between the stages sit PIPELINE REGISTERS that carry an instruction forward:
//   IF/ID, ID/EX, EX/MEM, MEM/WB   (this.ifid, this.idex, this.exmem, this.memwb)
//
// Hazards (design choices — see docs/PIPELINE.md):
//   * Data hazard  -> STALL in ID. No forwarding (as in the proposal).
//     The register file writes in the first half of a cycle and reads in the
//     second half, so a value written in WB can be read in ID in the same cycle.
//     So an instruction must wait while the producer is still in EX or MEM.
//   * Branch (BEQ/BNE) -> resolved in EX. We always fetch PC+1 ("predict not taken").
//     If the branch IS taken, the 2 instructions fetched after it are FLUSHED.
//   * Jump (J)  -> resolved in ID. The 1 instruction fetched after it is flushed.
//   * HALT -> recognised when fetched: fetching stops, and the CPU finishes when
//     HALT reaches WB (all older instructions have completed).
//
// The ALU, register file, memories and control unit are the SAME parts the
// single-cycle CPU uses (components.js). Only the timing is different.

import { IMEM_SIZE, DMEM_SIZE, decode, disassemble, toSigned16 } from './isa.js';
import { RegisterFile, Memory, alu, control, CPUError } from './components.js';

export const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];

// A bubble is an empty slot (a NOP) inserted when the pipeline stalls or flushes.
const BUBBLE = Object.freeze({ bubble: true });

export class PipelinedCPU {
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
    // pipeline registers: each holds one instruction object, a BUBBLE, or null (empty)
    this.ifid = null;
    this.idex = null;
    this.exmem = null;
    this.memwb = null;
    this.fetchStopped = false; // true after HALT has been fetched
    this.fetchCache = null;    // instruction waiting in IF during a stall
    this.nextId = 0;           // every fetched instruction gets a number (row in the diagram)
    this.cycle = 0;
    this.halted = false;
    this.error = null;
    this.retired = 0; // instructions that completed WB
    this.stalls = 0;  // cycles lost to data hazards
    this.flushes = 0; // wrong-path instructions thrown away
  }

  /** Advance the pipeline by one clock cycle. Returns the trace record for that cycle. */
  step() {
    if (this.halted) return null;
    this.cycle++;

    // Every stage works on what was in the pipeline registers at the START of the cycle.
    const ifid = this.ifid;
    const idex = this.idex;
    const exmem = this.exmem;
    const memwb = this.memwb;

    const stages = { IF: null, ID: null, EX: null, MEM: null, WB: null };
    const events = [];
    const changes = { reg: null, mem: null };
    let stalled = false;
    let flushedNow = 0;
    let finished = false;

    // values for the pipeline registers at the END of the cycle
    let newIfid = null;
    let newIdex = null;
    let newExmem = null;
    let newMemwb = null;

    try {
      // ---------------- WB: write the result into the register file ----------------
      // Done FIRST so that ID (below) reads the new value in the same cycle.
      stages.WB = slot(memwb);
      if (isReal(memwb)) {
        this.retired++;
        if (memwb.c.regWrite) {
          const r = destRegOf(memwb);
          const value = memwb.c.memToReg ? memwb.memData : memwb.aluResult;
          const old = this.regs.read(r);
          this.regs.write(r, value);
          if (r !== 0) {
            changes.reg = { index: r, old, new: value & 0xffff };
            events.push({ stage: 'WB', text: `${memwb.asm}: write ${toSigned16(value)} into R${r}` });
          }
        }
        if (memwb.c.halt) {
          finished = true;
          events.push({ stage: 'WB', text: 'HALT reached the end of the pipeline: all instructions are done' });
        }
      }

      // ---------------- MEM: data memory ----------------
      stages.MEM = slot(exmem);
      if (isReal(exmem)) {
        if (exmem.c.memRead) {
          exmem.memData = this.dmem.read(exmem.aluResult);
          events.push({ stage: 'MEM', text: `${exmem.asm}: load DMem[${exmem.aluResult}] = ${toSigned16(exmem.memData)}` });
        } else if (exmem.c.memWrite) {
          const old = this.dmem.read(exmem.aluResult);
          this.dmem.write(exmem.aluResult, exmem.storeVal);
          changes.mem = { address: exmem.aluResult, old, new: exmem.storeVal & 0xffff };
          events.push({ stage: 'MEM', text: `${exmem.asm}: store ${toSigned16(exmem.storeVal)} into DMem[${exmem.aluResult}]` });
        }
      }
      newMemwb = exmem;

      // ---------------- EX: ALU, and branch decision ----------------
      stages.EX = slot(idex);
      let branchTarget = null;
      if (isReal(idex) && idex.c.aluOp) {
        const b = idex.c.aluSrc === 'imm' ? idex.d.imm & 0xffff : idex.bVal;
        const { result, zero } = alu(idex.c.aluOp, idex.aVal, b);
        idex.aluResult = result;
        if (idex.c.branch) {
          const taken = idex.c.branch === 'EQ' ? zero : !zero;
          if (taken) {
            branchTarget = idex.pc + 1 + idex.d.imm;
            if (branchTarget < 0 || branchTarget >= IMEM_SIZE) {
              throw new CPUError(`Branch target ${branchTarget} is outside instruction memory`);
            }
            events.push({ stage: 'EX', text: `${idex.asm}: branch TAKEN, so PC = ${branchTarget}; flush the 2 instructions fetched after it` });
          } else {
            events.push({ stage: 'EX', text: `${idex.asm}: branch not taken, so keep going` });
          }
        }
      }
      newExmem = idex;

      // ---------------- ID: decode, hazard check, read registers ----------------
      let jumpTarget = null;
      if (ifid === null) {
        newIdex = null;
      } else if (branchTarget !== null) {
        // wrong-path instruction: the branch in EX was taken
        stages.ID = slot(ifid, 'flushed');
        this.flushes++;
        flushedNow++;
        newIdex = BUBBLE;
      } else {
        if (ifid.error) throw new CPUError(ifid.error);
        const needs = sourceRegs(ifid);
        const producer = [idex, exmem].find((p) => {
          const r = destRegOf(p);
          return r !== null && r !== 0 && needs.includes(r);
        });
        if (producer) {
          // DATA HAZARD: the value is not in the register file yet -> wait.
          stalled = true;
          this.stalls++;
          const r = destRegOf(producer);
          const where = producer === idex ? 'EX' : 'MEM';
          stages.ID = slot(ifid, 'stall', `waits for R${r}`);
          events.push({ stage: 'ID', text: `${ifid.asm}: STALL, needs R${r} but ${producer.asm} (in ${where}) has not written it yet` });
          newIdex = BUBBLE; // send a bubble down the pipeline
          newIfid = ifid;   // keep this instruction in ID for another cycle
        } else {
          readRegisters(ifid, this.regs);
          stages.ID = slot(ifid);
          newIdex = ifid;
          if (ifid.c.jump) {
            jumpTarget = ifid.d.address;
            events.push({ stage: 'ID', text: `${ifid.asm}: jump, so PC = ${jumpTarget}; flush the 1 instruction fetched after it` });
          }
        }
      }

      // ---------------- IF: fetch ----------------
      if (branchTarget !== null || jumpTarget !== null) {
        // whatever IF fetches this cycle is on the wrong path
        if (!this.fetchStopped) {
          const wrong = this.#fetch(this.pc);
          stages.IF = slot(wrong, 'flushed');
          this.flushes++;
          flushedNow++;
        }
        this.fetchCache = null;
        this.pc = branchTarget ?? jumpTarget;
        this.fetchStopped = false; // a HALT fetched on the wrong path doesn't count
        newIfid = null;
      } else if (stalled) {
        // IF waits too: the same instruction will be fetched again next cycle
        if (!this.fetchStopped) {
          const waiting = this.#fetch(this.pc);
          this.fetchCache = waiting;
          stages.IF = slot(waiting, 'stall');
        }
      } else if (!this.fetchStopped) {
        const inst = this.#fetch(this.pc);
        this.fetchCache = null;
        stages.IF = slot(inst);
        newIfid = inst;
        this.pc++;
        if (inst.c?.halt) this.fetchStopped = true; // nothing after HALT is fetched
      }
    } catch (e) {
      if (!(e instanceof CPUError)) throw e;
      this.halted = true;
      this.error = e.message;
      return this.#record(stages, events, changes, stalled, flushedNow);
    }

    // clock edge: pipeline registers take their new values
    this.ifid = newIfid;
    this.idex = newIdex;
    this.exmem = newExmem;
    this.memwb = newMemwb;
    if (finished) this.halted = true;

    return this.#record(stages, events, changes, stalled, flushedNow);
  }

  /** Run until HALT leaves WB, an error, or maxCycles. */
  run(maxCycles = 20000) {
    const trace = [];
    while (!this.halted && this.cycle < maxCycles) trace.push(this.step());
    let stoppedBy = 'halt';
    if (this.error) stoppedBy = 'error';
    else if (!this.halted) stoppedBy = 'max-cycles';
    return { trace, stats: this.stats(), stoppedBy };
  }

  stats() {
    return {
      cycles: this.cycle,
      instructions: this.retired,
      cpi: this.retired ? this.cycle / this.retired : 0,
      stalls: this.stalls,
      flushes: this.flushes,
    };
  }

  state() {
    return { pc: this.pc, regs: this.regs.snapshot(), dmem: this.dmem.snapshot(), halted: this.halted, error: this.error, cycle: this.cycle };
  }

  // Fetch the instruction at pc (reusing the one already waiting in IF after a stall).
  #fetch(pc) {
    if (this.fetchCache && this.fetchCache.pc === pc) return this.fetchCache;
    const inst = { id: this.nextId++, pc, word: null, asm: '???', d: null, c: null, error: null };
    try {
      inst.word = this.imem.read(pc);
      inst.d = decode(inst.word);
      inst.asm = disassemble(inst.word);
      inst.c = control(inst.d.name); // pre-decode so IF can recognise HALT
    } catch (e) {
      if (!(e instanceof CPUError)) throw e;
      inst.error = e.message; // reported only if this instruction is really executed
    }
    return inst;
  }

  #record(stages, events, changes, stalled, flushed) {
    return {
      cycle: this.cycle,
      stages,
      events,
      changes,
      stall: stalled,
      flushed,
      nextPc: this.pc,
      halted: this.halted,
      error: this.error,
    };
  }
}

// ---------------- helpers ----------------

function isReal(inst) {
  return inst !== null && !inst.bubble;
}

// What a stage shows in the trace.
function slot(inst, status = 'ok', note = '') {
  if (inst === null) return null;
  if (inst.bubble) return { bubble: true, status: 'bubble', asm: 'bubble' };
  return { id: inst.id, pc: inst.pc, asm: inst.asm, status, note };
}

// Registers an instruction READS in ID.
function sourceRegs(inst) {
  const { d, c } = inst;
  if (!c || c.jump || c.halt) return [];
  if (d.format === 'R') return [d.rs, d.rt];
  if (c.branch) return [d.rA, d.rB];
  if (c.memWrite) return [d.rB, d.rA]; // SW: base address and value to store
  return [d.rB];                       // ADDI, LW: base / source
}

// Register an instruction WRITES in WB (or null).
function destRegOf(inst) {
  if (!isReal(inst) || !inst.c?.regWrite) return null;
  return inst.c.regDst === 'rd' ? inst.d.rd : inst.d.rA;
}

// ID stage: read the source registers into the instruction (they travel in ID/EX).
function readRegisters(inst, regs) {
  const { d, c } = inst;
  if (c.jump || c.halt) return;
  if (d.format === 'R') {
    inst.aVal = regs.read(d.rs);
    inst.bVal = regs.read(d.rt);
  } else if (c.branch) {
    inst.aVal = regs.read(d.rA);
    inst.bVal = regs.read(d.rB);
  } else {
    inst.aVal = regs.read(d.rB);
    if (c.memWrite) inst.storeVal = regs.read(d.rA);
  }
}
