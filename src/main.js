// main.js — connects the webpage to the modules.
// Assemble -> create a CPU -> Step / Auto-play / Run / Reset -> show and animate what happened.

import { assemble } from './assembler.js';
import { SingleCycleCPU } from './singleCycle.js';
import { Visualizer } from './visualizer.js';
import { PipelinedCPU } from './pipeline.js';
import { PipelineView } from './pipelineView.js';
import { compare, SINGLE_CYCLE_CLOCK_PS, PIPELINE_CLOCK_PS } from './compare.js';
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

let pipe = null; // the pipelined CPU (runs the same program independently)
const pipeView = new PipelineView({ stages: $('pipe-stages'), events: $('pipe-events'), grid: $('pipe-grid') });
const EXAMPLES = ['sum.asm', 'fibonacci.asm', 'array.asm'];

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

$('pipe-step-btn').addEventListener('click', () => {
  if (!pipe || pipe.halted) return;
  pipeView.add([pipe.step()]);
  renderPipe();
});
$('pipe-run-btn').addEventListener('click', () => {
  if (!pipe || pipe.halted) return;
  pipeView.add(pipe.run().trace);
  renderPipe();
});
$('pipe-reset-btn').addEventListener('click', () => {
  if (!pipe) return;
  pipe.reset();
  pipeView.reset();
  renderPipe();
});
$('compare-btn').addEventListener('click', compareAll);

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
  pipe = null;
  lastRecord = null;
  viz.clear();
  pipeView.reset();

  if (!program.ok) {
    for (const e of program.errors) {
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = `Line ${e.line}: ${e.message}`;
      errorsEl.appendChild(div);
    }
    statusEl.textContent = `${program.errors.length} error(s) — fix them and assemble again.`;
    statusEl.className = 'status bad';
    $('pipe-status').textContent = statusEl.textContent;
    $('pipe-status').className = 'status bad';
    for (const id of ['steps', 'regs', 'dmem', 'pipe-regs']) $(id).innerHTML = '';
    tbody.innerHTML = '';
    $('cycle-title').textContent = '';
    return;
  }

  cpu = new SingleCycleCPU(program);
  pipe = new PipelinedCPU(program);
  renderListing();
  render();
  renderPipe();
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

// ---------------- pipelined CPU panel ----------------

function renderPipe() {
  const s = pipe.state();
  const st = pipe.stats();
  const el = $('pipe-status');
  if (s.error) {
    el.textContent = `Stopped with error at cycle ${s.cycle}: ${s.error}`;
    el.className = 'status bad';
  } else if (s.halted) {
    el.textContent = `HALT — ${st.cycles} cycles, ${st.instructions} instructions, CPI = ${st.cpi.toFixed(2)}, ${st.stalls} stall cycles, ${st.flushes} flushed instructions`;
    el.className = 'status good';
  } else {
    el.textContent = `Cycle ${s.cycle} · next fetch PC = ${s.pc} · completed ${st.instructions} · stalls ${st.stalls} · flushes ${st.flushes}`;
    el.className = 'status';
  }
  const last = pipeView.history.at(-1);
  const changed = last?.changes.reg?.index;
  $('pipe-regs').innerHTML = s.regs.map((v, i) => cell(`R${i}`, toSigned16(v), i === changed)).join('');
}

// ---------------- comparison ----------------

async function compareAll() {
  const out = $('compare-out');
  out.innerHTML = '<p class="muted">Running…</p>';
  const rows = [];
  for (const name of EXAMPLES) {
    const text = await (await fetch(`programs/${name}`)).text();
    const p = assemble(text);
    if (p.ok) rows.push({ name, ...compare(p) });
  }
  // also the program currently in the editor, if it is not one of the examples
  if (program?.ok && !EXAMPLES.some((n) => sourceEl.value.trim().startsWith(`# ${n}`))) {
    rows.push({ name: 'your program', ...compare(program) });
  }

  const maxTime = Math.max(...rows.map((r) => r.single.timePs));
  let html = `<table class="compare"><thead><tr>
    <th>Program</th><th>Instructions</th><th>Single-cycle cycles</th><th>Pipelined cycles</th>
    <th>Stalls</th><th>Flushes</th><th>Single CPI</th><th>Pipelined CPI</th>
    <th>Single time</th><th>Pipelined time</th><th>Speedup</th><th>Same result</th></tr></thead><tbody>`;
  for (const r of rows) {
    html += `<tr><td>${r.name}</td><td>${r.single.instructions}</td><td>${r.single.cycles}</td><td>${r.pipelined.cycles}</td>
      <td>${r.pipelined.stalls}</td><td>${r.pipelined.flushes}</td><td>${r.single.cpi.toFixed(2)}</td><td>${r.pipelined.cpi.toFixed(2)}</td>
      <td>${(r.single.timePs / 1000).toFixed(1)} ns</td><td>${(r.pipelined.timePs / 1000).toFixed(1)} ns</td>
      <td><b>${r.speedup.toFixed(2)}×</b></td><td class="${r.sameResult ? 'good' : 'bad'}">${r.sameResult ? '✓' : '✗'}</td></tr>`;
  }
  html += '</tbody></table>';

  html += '<h3>Execution time <span class="muted">(shorter is faster)</span></h3><div class="bars">';
  for (const r of rows) {
    const w1 = (r.single.timePs / maxTime) * 62;
    const w2 = (r.pipelined.timePs / maxTime) * 62;
    html += `<div class="bar-group"><div class="bar-label">${r.name}</div>
      <div class="bar-row"><span class="bar-key">single-cycle</span><div class="bar single" style="width:${w1}%"></div><span class="bar-val">${(r.single.timePs / 1000).toFixed(1)} ns · ${r.single.cycles} cycles × ${SINGLE_CYCLE_CLOCK_PS} ps</span></div>
      <div class="bar-row"><span class="bar-key">pipelined</span><div class="bar piped" style="width:${w2}%"></div><span class="bar-val">${(r.pipelined.timePs / 1000).toFixed(1)} ns · ${r.pipelined.cycles} cycles × ${PIPELINE_CLOCK_PS} ps</span></div>
    </div>`;
  }
  html += '</div>';
  html += `<p class="muted small">The pipeline needs <b>more cycles</b> (stalls and flushes push its CPI above 1), but each cycle is
    <b>4× shorter</b>, so the program still finishes sooner. With no hazards at all, the speedup would approach 4×.</p>`;
  out.innerHTML = html;
}

// Keep the "This cycle" list in sync with the animation.
function highlightStep(index) {
  $('steps').querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === index));
}

function cell(label, value, changed) {
  return `<div class="cell${changed ? ' changed' : ''}"><span>${label}</span><b>${value}</b></div>`;
}
