// main.js — connects the webpage to the modules.
// Assemble -> create a CPU -> Step / Auto-play / Run / Reset -> show and animate what happened.

import { assemble } from './assembler.js';
import { SingleCycleCPU } from './singleCycle.js';
import { Visualizer } from './visualizer.js';
import { toSigned16 } from './isa.js';

const $ = (id) => document.getElementById(id);
const sourceEl = $('source');
const errorsEl = $('errors');
const statusEl = $('status');
const tbody = document.querySelector('#listing tbody');

let program = null;     // output of assemble()
let cpu = null;         // the running CPU
let lastRecord = null;  // trace record of the last cycle
let busy = false;       // an animation is running
let autoPlaying = false;

const viz = new Visualizer($('datapath'), $('caption'), highlightStep);

// ---------------- buttons ----------------

$('example').addEventListener('change', loadExample);
$('assemble-btn').addEventListener('click', assembleSource);
$('step-btn').addEventListener('click', stepAnimated);
$('auto-btn').addEventListener('click', toggleAutoPlay);
$('run-btn').addEventListener('click', runToEnd);
$('reset-btn').addEventListener('click', reset);
$('prev-btn').addEventListener('click', () => { stopAutoPlay(); viz.prev(); });
$('next-btn').addEventListener('click', () => { stopAutoPlay(); viz.next(); });
$('replay-btn').addEventListener('click', async () => {
  if (!lastRecord || busy) return;
  busy = true;
  await viz.replay();
  busy = false;
});
$('speed').addEventListener('change', (e) => viz.setSpeed(e.target.value));

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
  stopAutoPlay();
  program = assemble(sourceEl.value);
  errorsEl.innerHTML = '';
  cpu = null;
  lastRecord = null;
  viz.clear();

  if (!program.ok) {
    for (const e of program.errors) {
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = `Line ${e.line}: ${e.message}`;
      errorsEl.appendChild(div);
    }
    statusEl.textContent = `${program.errors.length} error(s) — fix them and assemble again.`;
    statusEl.className = 'status bad';
    for (const id of ['steps', 'regs', 'dmem']) $(id).innerHTML = '';
    tbody.innerHTML = '';
    $('cycle-title').textContent = '';
    return;
  }

  cpu = new SingleCycleCPU(program);
  renderListing();
  render();
}

async function stepAnimated() {
  if (!cpu || cpu.halted || busy) return;
  busy = true;
  lastRecord = cpu.step();
  render();
  await viz.play(lastRecord);
  busy = false;
}

async function toggleAutoPlay() {
  if (autoPlaying) return stopAutoPlay();
  if (!cpu || cpu.halted) return;
  autoPlaying = true;
  $('auto-btn').textContent = 'Pause';
  while (autoPlaying && cpu && !cpu.halted) {
    if (!busy) await stepAnimated();
    else await new Promise((r) => setTimeout(r, 50));
  }
  stopAutoPlay();
}

function stopAutoPlay() {
  autoPlaying = false;
  $('auto-btn').textContent = 'Auto-play';
}

function runToEnd() {
  if (!cpu || cpu.halted) return;
  stopAutoPlay();
  const { trace } = cpu.run();
  lastRecord = trace.at(-1) ?? lastRecord;
  busy = false;
  render();
  if (lastRecord) viz.show(lastRecord);
}

function reset() {
  if (!cpu) return;
  stopAutoPlay();
  cpu.reset();
  lastRecord = null;
  busy = false;
  viz.clear();
  render();
}

// ---------------- drawing the side panels ----------------

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
  } else if (s.cycle === 0) {
    statusEl.textContent = `Ready · ${program.code.length} instructions loaded · PC = 0`;
    statusEl.className = 'status';
  } else {
    statusEl.textContent = `Cycle ${s.cycle} · next PC = ${s.pc}`;
    statusEl.className = 'status';
  }

  // highlight the instruction that just ran
  for (const tr of tbody.querySelectorAll('tr')) {
    tr.classList.toggle('current', lastRecord !== null && Number(tr.dataset.addr) === lastRecord.pc);
  }
  const current = tbody.querySelector('tr.current');
  if (current) current.parentElement.parentElement.parentElement.scrollTop = current.offsetTop - 40;

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
  } else {
    $('cycle-title').textContent = '';
    steps.innerHTML = '<li class="muted">Press Step to run one instruction.</li>';
  }

  // registers
  const changedReg = lastRecord?.changes.reg?.index;
  $('regs').innerHTML = s.regs.map((v, i) => cell(`R${i}`, toSigned16(v), i === changedReg)).join('');

  // data memory 0..15
  const changedMem = lastRecord?.changes.mem?.address;
  $('dmem').innerHTML = s.dmem.slice(0, 16).map((v, i) => cell(`[${i}]`, toSigned16(v), i === changedMem)).join('');
}

// Keep the "This cycle" list in sync with the animation.
function highlightStep(index) {
  $('steps').querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === index));
}

function cell(label, value, changed) {
  return `<div class="cell${changed ? ' changed' : ''}"><span>${label}</span><b>${value}</b></div>`;
}
