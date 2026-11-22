// main.js — connects the webpage to the modules.
// For now it only runs the assembler; the CPUs and visualizer plug in here later.

import { assemble } from './assembler.js';

const SAMPLE = `# sum.asm — adds 1 + 2 + 3 + 4 + 5
# Expected result: R1 = 15 and DMem[0] = 15

        ADDI R1, R0, 0      # sum = 0
        ADDI R2, R0, 5      # i = 5
loop:   ADD  R1, R1, R2     # sum = sum + i
        ADDI R2, R2, -1     # i = i - 1
        BNE  R2, R0, loop   # repeat while i != 0
        SW   R1, 0(R0)      # DMem[0] = sum
        HALT
`;

const sourceEl = document.getElementById('source');
const statusEl = document.getElementById('status');
const errorsEl = document.getElementById('errors');
const tbody = document.querySelector('#listing tbody');
const dataEl = document.getElementById('data');

sourceEl.value = SAMPLE;
document.getElementById('assemble-btn').addEventListener('click', run);
run();

function run() {
  const result = assemble(sourceEl.value);

  errorsEl.innerHTML = '';
  tbody.innerHTML = '';
  dataEl.innerHTML = '';

  if (!result.ok) {
    statusEl.textContent = `${result.errors.length} error(s)`;
    statusEl.className = 'bad';
    for (const e of result.errors) {
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = `Line ${e.line}: ${e.message}`;
      errorsEl.appendChild(div);
    }
    return;
  }

  statusEl.textContent = `✓ ${result.code.length} instruction(s)`;
  statusEl.className = 'good';

  for (const row of result.listing) {
    const tr = document.createElement('tr');
    for (const text of [row.address, row.hex, row.binary, row.source]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  if (result.data.length) {
    dataEl.textContent = 'Data memory: ' + result.data.map((v, i) => `[${i}]=${v}`).join('  ');
  }
}
