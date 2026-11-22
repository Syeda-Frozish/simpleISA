// visualizer.js — draws the single-cycle datapath and animates one instruction through it.
//
// It reads a trace record from the CPU (see docs/TRACE_FORMAT.md) and moves a marker
// from unit to unit in the order of record.steps, showing each step's caption.
// Units the instruction does not use are dimmed.

import { toSigned16, toHex } from './isa.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------- Layout: where each unit is drawn ----------------
// Each key matches a unit ID used in trace steps. To redesign (e.g. in Figma),
// keep these IDs and change the coordinates.
const LAYOUT = {
  PC:      { x: 20,  y: 170, w: 60,  h: 60,  label: 'PC' },
  IMEM:    { x: 120, y: 150, w: 110, h: 100, label: 'Instruction\nMemory' },
  CONTROL: { x: 270, y: 30,  w: 120, h: 50,  label: 'Control' },
  REGFILE: { x: 280, y: 150, w: 120, h: 120, label: 'Registers' },
  SIGNEXT: { x: 290, y: 310, w: 100, h: 44,  label: 'Sign-extend' },
  ALU:     { x: 460, y: 150, w: 80,  h: 120, label: 'ALU', shape: 'alu' },
  DMEM:    { x: 600, y: 150, w: 120, h: 120, label: 'Data\nMemory' },
  WB:      { x: 770, y: 170, w: 50,  h: 80,  label: 'WB\nmux' },
  NEXTPC:  { x: 600, y: 30,  w: 140, h: 50,  label: 'Next PC' },
};

// ---------------- Wires: the path the marker follows between two units ----------------
// Key "A>B" = moving from unit A to unit B. Points are [x, y].
const ROUTES = {
  'PC>IMEM':         [[80, 200], [120, 200]],
  'IMEM>CONTROL':    [[230, 200], [250, 200], [250, 55], [270, 55]],
  'CONTROL>REGFILE': [[330, 80], [330, 150]],
  'CONTROL>NEXTPC':  [[390, 55], [600, 55]],
  'REGFILE>SIGNEXT': [[340, 270], [340, 310]],
  'REGFILE>ALU':     [[400, 190], [460, 190]],
  'SIGNEXT>ALU':     [[390, 332], [440, 332], [440, 240], [460, 240]],
  'ALU>DMEM':        [[540, 210], [600, 210]],
  'ALU>WB':          [[540, 210], [570, 210], [570, 295], [750, 295], [750, 230], [770, 230]],
  'ALU>NEXTPC':      [[510, 169], [510, 110], [640, 110], [640, 80]],
  'DMEM>WB':         [[720, 210], [770, 210]],
  'DMEM>NEXTPC':     [[700, 150], [700, 80]],
  'WB>NEXTPC':       [[795, 170], [795, 55], [740, 55]],
};
// Control signals are drawn dashed.
const DASHED = new Set(['CONTROL>REGFILE', 'CONTROL>NEXTPC']);
// Extra wires shown (not hops between steps).
const WRITEBACK_WIRE = [[820, 210], [850, 210], [850, 385], [255, 385], [255, 245], [280, 245]];
const PC_LOOP_WIRE = [[670, 30], [670, 12], [50, 12], [50, 170]];

const SPEEDS = {
  slow:   { hop: 1100, pause: 700 },
  normal: { hop: 600,  pause: 350 },
  fast:   { hop: 250,  pause: 120 },
};

export class Visualizer {
  /**
   * @param {HTMLElement} container  where the SVG goes
   * @param {HTMLElement} captionEl  where the step caption goes
   * @param {(index:number)=>void} onStep  called whenever the shown step changes
   */
  constructor(container, captionEl, onStep = () => {}) {
    this.captionEl = captionEl;
    this.onStep = onStep;
    this.speed = SPEEDS.normal;
    this.record = null;
    this.index = -1;
    this.token = 0; // bumped to cancel a running animation
    this.svg = this.#draw();
    container.appendChild(this.svg);
    this.clear();
  }

  setSpeed(name) {
    this.speed = SPEEDS[name] ?? SPEEDS.normal;
  }

  /** Empty datapath, no instruction. */
  clear() {
    this.token++;
    this.record = null;
    this.index = -1;
    this.#resetClasses();
    this.marker.style.display = 'none';
    this.captionEl.innerHTML = '<span class="muted">Press <b>Step</b> to send an instruction through the datapath.</span>';
    this.onStep(-1);
  }

  /** Animate a whole record, step by step. Resolves when finished (or cancelled). */
  async play(record) {
    if (!record) return;
    const token = ++this.token;
    this.record = record;
    this.index = -1;
    this.#resetClasses();
    for (let i = 0; i < record.steps.length; i++) {
      await this.#animateTo(i, token);
      if (token !== this.token) return;
      await sleep(this.speed.pause);
      if (token !== this.token) return;
    }
    this.#showError();
  }

  /** Replay the current record from the start. */
  replay() {
    return this.play(this.record);
  }

  /** Show a record at one step, no animation (used by ◀ ▶ and after Run). */
  show(record, index = record.steps.length - 1) {
    this.token++;
    this.record = record;
    this.#showStatic(Math.max(0, Math.min(index, record.steps.length - 1)));
    if (index >= record.steps.length - 1) this.#showError();
  }

  next() {
    if (!this.record) return;
    this.show(this.record, Math.min(this.index + 1, this.record.steps.length - 1));
  }

  prev() {
    if (!this.record) return;
    this.show(this.record, Math.max(this.index - 1, 0));
  }

  // ---------------- drawing the SVG ----------------

  #draw() {
    const svg = el('svg', { viewBox: '0 0 880 400', class: 'datapath' });

    // marker glow
    const defs = el('defs');
    const filter = el('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
    filter.append(el('feGaussianBlur', { stdDeviation: '4', result: 'b' }));
    const merge = el('feMerge');
    merge.append(el('feMergeNode', { in: 'b' }), el('feMergeNode', { in: 'SourceGraphic' }));
    filter.append(merge);
    defs.append(filter);
    svg.append(defs);

    // wires first, so boxes sit on top
    this.wires = {};
    for (const [key, points] of Object.entries(ROUTES)) {
      const line = el('polyline', { points: pts(points), class: 'wire' + (DASHED.has(key) ? ' dashed' : '') });
      svg.append(line);
      this.wires[key] = line;
    }
    this.writeback = el('polyline', { points: pts(WRITEBACK_WIRE), class: 'wire' });
    this.pcLoop = el('polyline', { points: pts(PC_LOOP_WIRE), class: 'wire' });
    svg.append(this.writeback, this.pcLoop);

    // units
    this.units = {};
    for (const [id, u] of Object.entries(LAYOUT)) {
      const g = el('g', { id: `unit-${id}`, class: 'unit' });
      if (u.shape === 'alu') {
        const { x, y, w, h } = u;
        const p = [[x, y], [x + w, y + 30], [x + w, y + h - 30], [x, y + h], [x, y + 75], [x + 15, y + 60], [x, y + 45]];
        g.append(el('polygon', { points: pts(p), class: 'box' }));
      } else {
        g.append(el('rect', { x: u.x, y: u.y, width: u.w, height: u.h, rx: 8, class: 'box' }));
      }
      const lines = u.label.split('\n');
      const isAlu = u.shape === 'alu';
      const cx = u.x + u.w / 2 + (isAlu ? 8 : 0);
      const top = isAlu ? u.y + u.h / 2 + 5 : u.h < 60 ? u.y + 20 : u.y + 24;
      lines.forEach((line, i) => {
        const t = el('text', { x: cx, y: top + i * 15, class: 'label' });
        t.textContent = line;
        g.append(t);
      });
      const valueY = isAlu ? u.y + u.h / 2 + 25 : u.y + u.h - (u.h < 60 ? 9 : 16);
      const value = el('text', { x: cx, y: valueY, class: 'value' });
      g.append(value);
      svg.append(g);
      this.units[id] = { g, value };
    }

    this.marker = el('circle', { r: 8, class: 'marker', filter: 'url(#glow)' });
    svg.append(this.marker);
    return svg;
  }

  // ---------------- state display ----------------

  #resetClasses() {
    const used = new Set(this.record?.steps.map((s) => s.unit) ?? []);
    for (const [id, { g, value }] of Object.entries(this.units)) {
      g.classList.remove('current', 'visited');
      g.classList.toggle('unused', this.record !== null && !used.has(id));
      value.textContent = '';
    }
    for (const w of [...Object.values(this.wires), this.writeback, this.pcLoop]) {
      w.classList.remove('active', 'visited');
    }
  }

  #mark(i) {
    const step = this.record.steps[i];
    for (const { g } of Object.values(this.units)) g.classList.remove('current');
    const unit = this.units[step.unit];
    if (unit) {
      unit.g.classList.add('current', 'visited');
      unit.value.textContent = shortValue(step, this.record);
    }
    if (step.unit === 'WB') this.writeback.classList.add('visited');
    if (step.unit === 'NEXTPC') this.pcLoop.classList.add('visited');

    const total = this.record.steps.length;
    this.captionEl.innerHTML =
      `<span class="cap-head">Cycle ${this.record.cycle} · ${escape(this.record.asm ?? '')} · step ${i + 1} of ${total}</span>` +
      `<span class="cap-unit">${step.unit}</span> ${escape(step.caption)}`;
    this.index = i;
    this.onStep(i);
  }

  #showStatic(index) {
    this.#resetClasses();
    for (let i = 0; i <= index; i++) {
      const hop = this.#hop(i);
      if (hop) this.wires[hop].classList.add('visited');
      this.#mark(i);
    }
    const hop = this.#hop(index);
    if (hop) this.wires[hop].classList.add('active');
    const [x, y] = this.#markerPoint(index);
    this.#placeMarker(x, y);
    if (this.record.steps[index].unit === 'NEXTPC' && !this.record.halted) this.#showNewPc();
  }

  // The PC register now holds the next address.
  #showNewPc() {
    if (this.record.nextPc !== null) this.units.PC.value.textContent = String(this.record.nextPc);
  }

  #showError() {
    if (!this.record?.error) return;
    this.captionEl.innerHTML += `<div class="error">ERROR: ${escape(this.record.error)}</div>`;
  }

  // ---------------- animation ----------------

  #hop(i) {
    if (i <= 0) return null;
    const key = `${this.record.steps[i - 1].unit}>${this.record.steps[i].unit}`;
    return ROUTES[key] ? key : null;
  }

  #markerPoint(i) {
    const hop = this.#hop(i);
    if (hop) return ROUTES[hop].at(-1);
    const u = LAYOUT[this.record.steps[i].unit];
    return [u.x + u.w / 2, u.y + u.h / 2];
  }

  async #animateTo(i, token) {
    const hop = this.#hop(i);
    for (const w of Object.values(this.wires)) w.classList.remove('active');
    if (hop) {
      this.wires[hop].classList.add('active');
      await this.#moveAlong(ROUTES[hop], token);
      if (token !== this.token) return;
      this.wires[hop].classList.remove('active');
      this.wires[hop].classList.add('visited');
    } else {
      const [x, y] = this.#markerPoint(i);
      this.#placeMarker(x, y);
    }
    this.#mark(i);
    // After Next PC, show the new PC travelling back to the PC register.
    if (this.record.steps[i].unit === 'NEXTPC' && !this.record.halted) {
      await sleep(this.speed.pause / 2);
      if (token !== this.token) return;
      this.pcLoop.classList.add('active');
      await this.#moveAlong(PC_LOOP_WIRE, token);
      this.pcLoop.classList.remove('active');
      this.#showNewPc();
    }
  }

  #moveAlong(points, token) {
    const lengths = [];
    let total = 0;
    for (let k = 1; k < points.length; k++) {
      const d = Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
      lengths.push(d);
      total += d;
    }
    const duration = this.speed.hop;
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        if (token !== this.token) return resolve();
        const t = Math.min(1, (now - start) / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        let dist = eased * total;
        let k = 0;
        while (k < lengths.length - 1 && dist > lengths[k]) dist -= lengths[k++];
        const f = lengths[k] ? dist / lengths[k] : 1;
        const x = points[k][0] + (points[k + 1][0] - points[k][0]) * f;
        const y = points[k][1] + (points[k + 1][1] - points[k][1]) * f;
        this.#placeMarker(x, y);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  #placeMarker(x, y) {
    this.marker.style.display = '';
    this.marker.setAttribute('cx', x);
    this.marker.setAttribute('cy', y);
  }
}

// ---------------- helpers ----------------

// Short text shown inside a unit box once the marker reaches it.
function shortValue(step, record) {
  const v = step.values ?? {};
  switch (step.unit) {
    case 'PC':      return String(v.pc);
    case 'IMEM':    return toHex(v.word);
    case 'CONTROL': return record.name ?? '';
    case 'REGFILE': return Object.entries(v).map(([r, val]) => `${r}=${toSigned16(val)}`).join(' ');
    case 'SIGNEXT': return String(v.imm);
    case 'ALU':     return String(toSigned16(v.result));
    case 'DMEM':    return `[${v.address}]=${toSigned16(v.value)}`;
    case 'WB':      return `R${v.reg}←${toSigned16(v.value)}`;
    case 'NEXTPC':  return record.halted ? 'HALT' : `PC=${v.to}`;
    default:        return '';
  }
}

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function pts(points) {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
