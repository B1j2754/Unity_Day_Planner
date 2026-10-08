// Assignments -> the three deliverables. The mail-merge file name and its three
// column names are a frozen contract with the Outlook Power Automate flow.

import { BLOCKS } from './parse.js';

export const MAIL_MERGE_FILE = 'unity-day_mail-merge.xlsx';
export const MAIL_MERGE_COLUMNS = ['Email', 'Name', 'Schedule_HTML'];
export const UNPLACED_FILE = 'unity-day_unplaced.csv';
export const PNG_ZIP_FILE = 'unity-day_schedules.zip';

/**
 * One line per slot, consecutive blocks of a multi-block session merged.
 * @returns {{blocks:string, session:string, location:string, organizer:string, email:string}[]}
 */
export function scheduleRows(got, sessions) {
  const out = [];
  for (let b = 0; b < BLOCKS.length; b++) {
    const slot = got.get(b);
    const prev = out[out.length - 1];
    if (prev && prev.slot === slot) { prev.blocks.push(BLOCKS[b]); continue; }
    out.push({ slot, blocks: [BLOCKS[b]] });
  }
  return out.map(({ slot, blocks }) => {
    const s = slot ? sessions[slot.sessionIndex] : null;
    return {
      blocks: blocks.length > 1 ? `${blocks[0]}–${blocks[blocks.length - 1]}` : blocks[0],
      session: s ? (s.displayName || s.name) : 'Free',
      location: s ? s.location : '',
      organizer: s ? s.organizer : '',
      email: s ? s.email : '',
    };
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Simple table, inline styles only — Outlook strips everything else. */
export function scheduleHTML(rows) {
  const cell = (v, extra = '') => `<td style="border:1px solid #ccc;padding:6px 10px;${extra}">${esc(v)}</td>`;
  const body = rows.map(r => {
    const who = [r.organizer, r.email].filter(Boolean).join(' &middot; ');
    return `<tr>${cell(r.blocks, 'font-weight:bold;white-space:nowrap;')}${cell(r.session)}${cell(r.location)}<td style="border:1px solid #ccc;padding:6px 10px;">${who}</td></tr>`;
  }).join('');
  const head = ['Block', 'Session', 'Location', 'Run by']
    .map(h => `<th style="border:1px solid #ccc;padding:6px 10px;text-align:left;background:#f4f4f4;">${h}</th>`).join('');
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** One row per scheduled student, in the shape the Power Automate flow expects. */
export function mailMergeRows(students, assignments, sessions) {
  return students
    .filter(s => assignments.has(s.email))
    .map(s => ({
      Email: s.email,
      Name: s.name,
      Schedule_HTML: scheduleHTML(scheduleRows(assignments.get(s.email), sessions)),
    }));
}

/** Unplaced students plus rows that were rejected outright at parse time. */
export function unplacedRows(unplaced, rejected, sessions) {
  const partial = got => !got || !got.size ? ''
    : scheduleRows(got, sessions).filter(r => r.session !== 'Free').map(r => `${r.blocks}: ${r.session}`).join('; ');
  return [
    ...rejected.map(r => ({ Email: r.email, Name: r.name, Grade: r.grade, Reason: r.reason, 'Partial Schedule': '' })),
    ...unplaced.map(u => ({ Email: u.email, Name: u.name, Grade: u.grade, Reason: u.reason, 'Partial Schedule': partial(u.partial) })),
  ];
}

export function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const q = v => { v = String(v ?? ''); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------- PNG

const PNG = {
  w: 820, pad: 36, headerH: 104, rowH: 52, headH: 40,
  font: 'Inter, Arial, sans-serif',
};

/** Draws one student's schedule onto a canvas and returns it. Browser only. */
export function drawSchedule(canvas, student, rows) {
  const { w, pad, headerH, rowH, headH, font } = PNG;
  const h = headerH + headH + rows.length * rowH + pad;
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d');

  c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#111111';
  c.font = `700 30px ${font}`;
  c.fillText('Unity Day Schedule', pad, 52);
  c.font = `400 17px ${font}`;
  c.fillStyle = '#555555';
  const who = [student.name, student.grade ? `Grade ${student.grade}` : '', student.email].filter(Boolean);
  c.fillText(who.join('  ·  '), pad, 82);

  // ponytail: fixed column widths. Long session names are clipped by the cell,
  // which is fine for room numbers and 30-character session names; measure and
  // wrap if a session title ever needs two lines.
  const cols = [
    { label: 'Block', key: 'blocks', x: pad, w: 78 },
    { label: 'Session', key: 'session', x: pad + 78, w: 292 },
    { label: 'Location', key: 'location', x: pad + 370, w: 150 },
    { label: 'Run by', key: 'organizer', x: pad + 520, w: 228 },
  ];
  const tableW = w - pad * 2;
  let y = headerH;

  c.fillStyle = '#f4f4f5'; c.fillRect(pad, y, tableW, headH);
  c.fillStyle = '#52525b'; c.font = `600 13px ${font}`;
  for (const col of cols) c.fillText(col.label.toUpperCase(), col.x + 12, y + 26);
  y += headH;

  rows.forEach((r, i) => {
    if (i % 2) { c.fillStyle = '#fafafa'; c.fillRect(pad, y, tableW, rowH); }
    c.strokeStyle = '#e4e4e7'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(pad, y + 0.5); c.lineTo(pad + tableW, y + 0.5); c.stroke();
    for (const col of cols) {
      const v = r[col.key] || (col.key === 'session' ? '' : '—');
      c.fillStyle = col.key === 'blocks' ? '#111111' : '#3f3f46';
      c.font = col.key === 'blocks' ? `700 17px ${font}` : `400 16px ${font}`;
      c.save();
      c.beginPath(); c.rect(col.x, y, col.w, rowH); c.clip();
      c.fillText(v, col.x + 12, y + 33);
      c.restore();
    }
    y += rowH;
  });
  c.strokeStyle = '#d4d4d8';
  c.strokeRect(pad + 0.5, headerH + 0.5, tableW - 1, headH + rows.length * rowH - 1);
  return canvas;
}
