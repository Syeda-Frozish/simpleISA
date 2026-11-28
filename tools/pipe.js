// Run a program on the pipelined CPU and print the pipeline, cycle by cycle.
// Usage:  node tools/pipe.js programs/sum.asm            (stage table)
//         node tools/pipe.js programs/sum.asm --events   (also explain stalls/flushes/writes)

import { readFileSync } from 'node:fs';
import { assemble } from '../src/assembler.js';
import { PipelinedCPU, STAGES } from '../src/pipeline.js';
import { toSigned16 } from '../src/isa.js';

const file = process.argv[2];
const showEvents = process.argv.includes('--events');
if (!file) {
  console.log('Usage: node tools/pipe.js <file.asm> [--events]');
  process.exit(1);
}

const program = assemble(readFileSync(file, 'utf8'));
if (!program.ok) {
  for (const e of program.errors) console.log(`line ${e.line}: ${e.message}`);
  process.exit(1);
}

const cpu = new PipelinedCPU(program);
const { trace, stats, stoppedBy } = cpu.run();

// How a stage slot is printed: "ADD R1,R1,R2", "--" for a bubble, "." for empty.
// (s) = stalled, (x) = flushed
const W = 20;
const cell = (s) => {
  if (!s) return '.'.padEnd(W);
  if (s.bubble) return '--'.padEnd(W);
  const tag = s.status === 'stall' ? ' (s)' : s.status === 'flushed' ? ' (x)' : '';
  return (s.asm.replace(/, /g, ',') + tag).slice(0, W - 1).padEnd(W);
};

console.log(`\n${file} on the pipelined CPU   (s) = stalled, (x) = flushed, -- = bubble\n`);
console.log('cycle  ' + STAGES.map((s) => s.padEnd(W)).join(''));
for (const t of trace) {
  console.log(String(t.cycle).padStart(5) + '  ' + STAGES.map((s) => cell(t.stages[s])).join(''));
  if (showEvents) for (const e of t.events) console.log(`         ${e.stage.padEnd(4)} ${e.text}`);
  if (t.error) console.log(`         ERROR: ${t.error}`);
}

console.log(`\nStopped by: ${stoppedBy}`);
console.log(`Cycles: ${stats.cycles}   Instructions: ${stats.instructions}   CPI: ${stats.cpi.toFixed(2)}   Stalls: ${stats.stalls}   Flushes: ${stats.flushes}`);
console.log('\nRegisters:');
console.log('  ' + cpu.regs.snapshot().map((v, i) => `R${i}=${toSigned16(v)}`).join('  '));
const used = cpu.dmem.snapshot().map((v, i) => [i, v]).filter(([, v]) => v !== 0);
console.log('\nData memory (non-zero):');
console.log('  ' + (used.map(([i, v]) => `[${i}]=${toSigned16(v)}`).join('  ') || '(all zero)'));
console.log();
