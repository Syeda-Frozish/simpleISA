// Run a program on the single-cycle CPU and print what happened.
// Usage:  node tools/run.js programs/sum.asm           (summary)
//         node tools/run.js programs/sum.asm --trace   (every step of every cycle)

import { readFileSync } from 'node:fs';
import { assemble } from '../src/assembler.js';
import { SingleCycleCPU } from '../src/singleCycle.js';
import { toSigned16 } from '../src/isa.js';

const file = process.argv[2];
const showTrace = process.argv.includes('--trace');
if (!file) {
  console.log('Usage: node tools/run.js <file.asm> [--trace]');
  process.exit(1);
}

const program = assemble(readFileSync(file, 'utf8'));
if (!program.ok) {
  for (const e of program.errors) console.log(`line ${e.line}: ${e.message}`);
  process.exit(1);
}

const cpu = new SingleCycleCPU(program);
const { trace, stats, stoppedBy } = cpu.run();

console.log(`\n${file} on the single-cycle CPU\n`);
for (const t of trace) {
  const change = t.changes.reg
    ? `R${t.changes.reg.index} = ${toSigned16(t.changes.reg.new)}`
    : t.changes.mem
      ? `DMem[${t.changes.mem.address}] = ${toSigned16(t.changes.mem.new)}`
      : '';
  console.log(`cycle ${String(t.cycle).padStart(3)}  PC=${String(t.pc).padStart(3)}  ${(t.asm ?? '').padEnd(20)} ${change}`);
  if (showTrace) for (const s of t.steps) console.log(`             ${s.unit.padEnd(8)} ${s.caption}`);
  if (t.error) console.log(`             ERROR: ${t.error}`);
}

console.log(`\nStopped by: ${stoppedBy}`);
console.log(`Cycles: ${stats.cycles}   Instructions: ${stats.instructions}   CPI: ${stats.cpi}`);
console.log('\nRegisters:');
console.log('  ' + cpu.regs.snapshot().map((v, i) => `R${i}=${toSigned16(v)}`).join('  '));
const used = cpu.dmem.snapshot().map((v, i) => [i, v]).filter(([, v]) => v !== 0);
console.log('\nData memory (non-zero):');
console.log('  ' + (used.map(([i, v]) => `[${i}]=${toSigned16(v)}`).join('  ') || '(all zero)'));
console.log();
