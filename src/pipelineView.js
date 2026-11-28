// pipelineView.js — draws the pipelined CPU on the page.
//
// Two pictures:
//  1. Five stage boxes (IF ID EX MEM WB) showing what is in each stage THIS cycle.
//  2. The classic pipeline diagram: one row per instruction, one column per cycle,
//     each cell says which stage the instruction was in. Stalls and flushes are coloured.

import { STAGES } from './pipeline.js';

export class PipelineView {
  /**
   * @param {{stages:HTMLElement, events:HTMLElement, grid:HTMLElement}} els
   */
  constructor(els) {
    this.els = els;
    this.reset();
  }

  reset() {
    this.history = []; // every trace record so far
    this.#renderStages(null);
    this.els.events.innerHTML = '<li class="muted">Press Step cycle to clock the pipeline.</li>';
    this.els.grid.innerHTML = '';
  }

  /** Add one or more new trace records and redraw. */
  add(records) {
    for (const r of records) if (r) this.history.push(r);
    const last = this.history.at(-1) ?? null;
    this.#renderStages(last);
    this.#renderEvents(last);
    this.#renderGrid();
  }

  // ---------------- 1. stage boxes ----------------

  #renderStages(record) {
    const names = { IF: 'Fetch', ID: 'Decode', EX: 'Execute', MEM: 'Memory', WB: 'Write back' };
    this.els.stages.innerHTML = STAGES.map((s) => {
      const slot = record?.stages[s] ?? null;
      let cls = 'empty';
      let text = 'empty';
      let note = '';
      if (slot?.bubble) {
        cls = 'bubble';
        text = 'bubble';
        note = 'no instruction (NOP)';
      } else if (slot) {
        cls = slot.status; // ok | stall | flushed
        text = slot.asm;
        note = slot.status === 'stall' ? `STALL · ${slot.note || 'waiting'}` : slot.status === 'flushed' ? 'FLUSHED · wrong path' : `PC ${slot.pc}`;
      }
      return `<div class="stage ${cls}"><div class="stage-name">${s}<span>${names[s]}</span></div>` +
             `<div class="stage-instr">${escape(text)}</div><div class="stage-note">${escape(note)}</div></div>`;
    }).join('<div class="stage-arrow">→</div>');
  }

  // ---------------- events of the last cycle ----------------

  #renderEvents(record) {
    if (!record) return;
    const items = record.events.map((e) => {
      const kind = /STALL/.test(e.text) ? 'stall' : /TAKEN|jump/.test(e.text) ? 'flushed' : '';
      return `<li class="${kind}"><span class="unit">${e.stage}</span>${escape(e.text)}</li>`;
    });
    if (record.error) items.push(`<li class="error">ERROR: ${escape(record.error)}</li>`);
    this.els.events.innerHTML = items.join('') || '<li class="muted">Nothing special this cycle: every stage just passes its instruction on.</li>';
  }

  // ---------------- 2. pipeline diagram ----------------

  #renderGrid() {
    // rows: every real instruction that entered the pipeline, in fetch order
    const rows = new Map(); // id -> { pc, asm, cells: Map(cycle -> {stage, status}) }
    for (const rec of this.history) {
      for (const s of STAGES) {
        const slot = rec.stages[s];
        if (!slot || slot.bubble) continue;
        if (!rows.has(slot.id)) rows.set(slot.id, { pc: slot.pc, asm: slot.asm, cells: new Map() });
        rows.get(slot.id).cells.set(rec.cycle, { stage: s, status: slot.status });
      }
    }
    const cycles = this.history.length;
    const ids = [...rows.keys()].sort((a, b) => a - b);

    let html = '<table class="pipe-grid"><thead><tr><th class="sticky">Instruction</th>';
    for (let c = 1; c <= cycles; c++) html += `<th class="${c === cycles ? 'now' : ''}">${c}</th>`;
    html += '</tr></thead><tbody>';
    for (const id of ids) {
      const row = rows.get(id);
      const wasFlushed = [...row.cells.values()].some((x) => x.status === 'flushed');
      html += `<tr class="${wasFlushed ? 'row-flushed' : ''}"><th class="sticky"><span class="muted">${row.pc}</span> ${escape(row.asm)}</th>`;
      for (let c = 1; c <= cycles; c++) {
        const cell = row.cells.get(c);
        const now = c === cycles ? ' now' : '';
        if (!cell) html += `<td class="${now}"></td>`;
        else {
          const label = cell.status === 'stall' ? `${cell.stage}*` : cell.status === 'flushed' ? '✕' : cell.stage;
          html += `<td class="c-${cell.status} s-${cell.stage}${now}">${label}</td>`;
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    this.els.grid.innerHTML = html;
    this.els.grid.scrollLeft = this.els.grid.scrollWidth; // keep the newest cycle in view
  }
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
