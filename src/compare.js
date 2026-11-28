// compare.js — runs one program on both CPUs and compares them.
//
// Cycle counts alone are not a fair comparison: a pipelined clock cycle is much
// SHORTER than a single-cycle clock cycle. So we also compare execution TIME.
//
// Stage delays (picoseconds) are the textbook example values
// (Patterson & Hennessy, Computer Organization and Design, ch. 4):
//   IF 200 · ID (register read) 100 · EX 200 · MEM 200 · WB (register write) 100
//
// Single-cycle clock = time of the slowest instruction (LW uses every stage) = 800 ps
// Pipelined clock    = time of the slowest stage                            = 200 ps

import { SingleCycleCPU } from './singleCycle.js';
import { PipelinedCPU } from './pipeline.js';

export const STAGE_DELAY_PS = { IF: 200, ID: 100, EX: 200, MEM: 200, WB: 100 };
export const SINGLE_CYCLE_CLOCK_PS = Object.values(STAGE_DELAY_PS).reduce((a, b) => a + b, 0);
export const PIPELINE_CLOCK_PS = Math.max(...Object.values(STAGE_DELAY_PS));

/**
 * @param {{code:number[], data:number[]}} program  output of assemble()
 * @returns {{ single, pipelined, sameResult, speedup }}
 */
export function compare(program) {
  const a = new SingleCycleCPU(program);
  const ra = a.run();
  const b = new PipelinedCPU(program);
  const rb = b.run();

  const single = { ...ra.stats, stoppedBy: ra.stoppedBy, clockPs: SINGLE_CYCLE_CLOCK_PS, timePs: ra.stats.cycles * SINGLE_CYCLE_CLOCK_PS };
  const pipelined = { ...rb.stats, stoppedBy: rb.stoppedBy, clockPs: PIPELINE_CLOCK_PS, timePs: rb.stats.cycles * PIPELINE_CLOCK_PS };

  // Both CPUs must end with the same registers and data memory.
  const sa = a.state();
  const sb = b.state();
  const sameResult = JSON.stringify(sa.regs) === JSON.stringify(sb.regs) && JSON.stringify(sa.dmem) === JSON.stringify(sb.dmem);

  return { single, pipelined, sameResult, speedup: pipelined.timePs ? single.timePs / pipelined.timePs : 0 };
}
