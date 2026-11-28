// Compare the single-cycle and pipelined CPUs on every program in programs/.
// Usage:  node tools/compare.js          (table)
//         node tools/compare.js --csv    (CSV to paste into Google Sheets)

import { readFileSync, readdirSync } from 'node:fs';
import { assemble } from '../src/assembler.js';
import { compare, SINGLE_CYCLE_CLOCK_PS, PIPELINE_CLOCK_PS } from '../src/compare.js';

const csv = process.argv.includes('--csv');
const files = readdirSync('programs').filter((f) => f.endsWith('.asm')).sort();

const rows = [];
for (const f of files) {
  const program = assemble(readFileSync(`programs/${f}`, 'utf8'));
  if (!program.ok) {
    console.log(`${f}: does not assemble (${program.errors[0].message})`);
    continue;
  }
  const r = compare(program);
  rows.push([
    f,
    r.single.instructions,
    r.single.cycles,
    r.pipelined.cycles,
    r.pipelined.stalls,
    r.pipelined.flushes,
    r.single.cpi.toFixed(2),
    r.pipelined.cpi.toFixed(2),
    r.single.timePs,
    r.pipelined.timePs,
    r.speedup.toFixed(2),
    r.sameResult ? 'yes' : 'NO',
  ]);
}

const header = ['Program', 'Instr', 'SC cycles', 'Pipe cycles', 'Stalls', 'Flushes', 'SC CPI', 'Pipe CPI', 'SC time (ps)', 'Pipe time (ps)', 'Speedup', 'Same result'];

if (csv) {
  console.log(header.join(','));
  for (const r of rows) console.log(r.join(','));
} else {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padStart(widths[i])).join('  ');
  console.log(`\nSingle-cycle clock = ${SINGLE_CYCLE_CLOCK_PS} ps, pipelined clock = ${PIPELINE_CLOCK_PS} ps\n`);
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
  console.log('\nSC = single-cycle. Speedup = SC time / pipelined time.\n');
}
