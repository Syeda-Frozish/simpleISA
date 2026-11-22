// main.js — connects the webpage to the modules.
// Assemble -> create a CPU -> Step / Run / Reset -> show what happened.

import { assemble } from './assembler.js';
import { SingleCycleCPU } from './singleCycle.js';
import { toSigned16 } from './isa.js';

const $ = (id) => document.getElementById(id);
const sourceEl = $('source');
const errorsEl = $('errors');
const statusEl = $('status');
const tbody = document.querySelector('#listing tbody');

let program = null; // output of assemble()
let cpu = null;     // the running CPU
let lastRecord = null;

// ---------------- buttons ----------------

$('example').addEventListener('change', loadExample);
$('assemble-btn').addEventListener('click', assembleSource);
$('step-btn').addEventListener('click', () => {
  if (!cpu || cpu.halted) return;
  lastRecord = cpu.step();
  render();
});
$('run-btn').addEventListener('click', () => {
  if (!cpu || cpu.halted) return;
  const { trace } = cpu.run();
  lastRecord = trace.at(-1) ?? lastRecord;
  render();
});
$('reset-btn').addEventListener('click', () => {
  if (!cpu) return;
  cpu.reset();
  lastRecord = null;
  render();
});

loadExample();

// ---------------- actions ----------------

async function loadExample() {
  const name = $('example').value;
  try {
    const res = await fetch(`programs/${name}`);
    sourceEl.value = await res.text();
  } catch {
    sourceEl.value = '# could not load programs/' + name;
  }
  assembleSource();
}

function assembleSource() {
  program = assemble(sourceEl.value);
  errorsEl.innerHTML = '';
  cpu = null;
  lastRecord = null;

  if (!program.ok) {
    for (const e of program.errors) {
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = `Line ${e.line}: ${e.message}`;
      errorsEl.appendChild(div);
    }
    statusEl.textContent = `${program.errors.length} error(s) — fix them and assemble again.`;
    statusEl.className = 'status bad';
    tbody.innerHTML = '';
    $('steps').innerHTML = '';
    $('cycle-title').textContent = '';
    $('regs').innerHTML = '';
    $('dmem').innerHTML = '';
    return;
  }

  cpu = new SingleCycleCPU(program);
  renderListing();
  render();
}

// ---------------- drawing ----------------

function renderListing() {
  tbody.innerHTML = '';
  for (const row of program.listing) {
    const tr = document.createElement('tr');
    tr.dataset.addr = row.address;
    for (const text of [row.address, row.hex, row.binary, row.source]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function render() {
  const s = cpu.state();

  // status line
  if (s.error) {
    statusEl.textContent = `Stopped with error after ${s.cycle} cycle(s): ${s.error}`;
    statusEl.className = 'status bad';
  } else if (s.halted) {
    const st = cpu.stats();
    statusEl.textContent = `HALT — finished in ${st.cycles} cycles, ${st.instructions} instructions, CPI = ${st.cpi}`;
    statusEl.className = 'status good';
  } else {
    statusEl.textContent = `Cycle ${s.cycle} done · next PC = ${s.pc}`;
    statusEl.className = 'status';
  }

  // highlight the instruction that just ran
  for (const tr of tbody.querySelectorAll('tr')) {
    tr.classList.toggle('current', lastRecord !== null && Number(tr.dataset.addr) === lastRecord.pc);
  }
  tbody.querySelector('tr.current')?.scrollIntoView({ block: 'nearest' });

  // steps of the last cycle
  const steps = $('steps');
  steps.innerHTML = '';
  if (lastRecord) {
    $('cycle-title').textContent = `— cycle ${lastRecord.cycle}: ${lastRecord.asm ?? ''}`;
    for (const step of lastRecord.steps) {
      const li = document.createElement('li');
      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = step.unit;
      li.append(unit, step.caption);
      steps.appendChild(li);
    }
    if (lastRecord.error) {
      const li = document.createElement('li');
      li.className = 'error';
      li.textContent = 'ERROR: ' + lastRecord.error;
      steps.appendChild(li);
    }
  } else {
    $('cycle-title').textContent = '';
    steps.innerHTML = '<li class="muted">Press Step to run one instruction.</li>';
  }

  // registers
  const changedReg = lastRecord?.changes.reg?.index;
  $('regs').innerHTML = s.regs
    .map((v, i) => cell(`R${i}`, toSigned16(v), i === changedReg))
    .join('');

  // data memory 0..15
  const changedMem = lastRecord?.changes.mem?.address;
  $('dmem').innerHTML = s.dmem
    .slice(0, 16)
    .map((v, i) => cell(`[${i}]`, toSigned16(v), i === changedMem))
    .join('');
}

function cell(label, value, changed) {
  return `<div class="cell${changed ? ' changed' : ''}"><span>${label}</span><b>${value}</b></div>`;
}
