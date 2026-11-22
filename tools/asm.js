// Command-line assembler.
// Usage:  node tools/asm.js programs/sum.asm

import { readFileSync } from 'node:fs';
import { assemble } from '../src/assembler.js';

const file = process.argv[2];
if (!file) {
  console.log('Usage: node tools/asm.js <file.asm>');
  process.exit(1);
}

const result = assemble(readFileSync(file, 'utf8'));

if (!result.ok) {
  console.log(`\n${result.errors.length} error(s) in ${file}:\n`);
  for (const e of result.errors) console.log(`  line ${e.line}: ${e.message}`);
  console.log();
  process.exit(1);
}

console.log(`\n${file} — ${result.code.length} instruction(s), ${result.data.length} data word(s)\n`);
console.log('Addr  Hex     Binary                  Source');
console.log('----  ------  ----------------------  ------------------------');
for (const row of result.listing) {
  console.log(`${String(row.address).padStart(4)}  ${row.hex}  ${row.binary.padEnd(22)}  ${row.source}`);
}
if (result.data.length) {
  console.log('\nData memory:');
  result.data.forEach((v, addr) => console.log(`  [${addr}] = ${v}`));
}
if (Object.keys(result.labels).length) {
  console.log('\nLabels:');
  for (const [name, { section, address }] of Object.entries(result.labels)) {
    console.log(`  ${name.padEnd(10)} ${section}  ${address}`);
  }
}
console.log();
