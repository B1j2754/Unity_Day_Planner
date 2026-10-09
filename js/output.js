// Assignments -> the deliverables. Two sets: what each student gets, and what
// each adult running a session gets.
//
// The two mail-merge files feed Microsoft Word's mail merge. Word picks the
// values up by column name, so the file names and every column name below are
// a contract with the Word templates — renaming one breaks a template.
//
// They are .csv, not .xlsx, and written with a UTF-8 byte-order mark so Word
// reads en dashes and curly apostrophes correctly. CSV also sidesteps the
// 255-character ceiling Word imposes on long fields coming from Excel, which
// matters because a roster runs to several thousand characters.

import { BLOCKS, key } from './parse.js';

export const MAIL_MERGE_FILE = 'unity-day_mail-merge.csv';
export const MAIL_MERGE_COLUMNS = ['Email', 'Name', 'Full_Name', 'Grade', 'Schedule_Text'];
export const UNPLACED_FILE = 'unity-day_unplaced.csv';
export const PNG_ZIP_FILE = 'unity-day_schedules.zip';

export const STAFF_MAIL_MERGE_FILE = 'unity-day_staff-mail-merge.csv';
export const STAFF_MAIL_MERGE_COLUMNS = ['Email', 'Name', 'Roster_Text', 'Sessions', 'Blocks', 'Student_Count'];
export const ROSTER_ZIP_FILE = 'unity-day_rosters.zip';

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

/**
 * A fixed-width table drawn in plain characters. Lines up only in a monospaced
 * font, so the Word template has to set the merge field to Courier New.
 * CRLF throughout, because that is what Word expects inside a field.
 */
function asciiTable(headers, rows) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)));
  const rule = '+' + w.map(n => '-'.repeat(n + 2)).join('+') + '+';
  const line = cells => '| ' + cells.map((c, i) => String(c ?? '').padEnd(w[i])).join(' | ') + ' |';
  return [rule, line(headers), rule, ...rows.map(line), rule].join('\r\n');
}

/** Block labels for plain text: ASCII hyphen, never an en dash. */
const plain = label => String(label ?? '').replace(/[–—·]/g, '-');

/**
 * A student's whole day as plain text, for a single merge field.
 *
 * Deliberately NOT a bordered table. Most students read this on a phone, and a
 * four-column grid needs about 75 characters a line once real session names are
 * in it — which a phone either shrinks to nothing or wraps, and a wrapped grid
 * puts its borders in the wrong places. Stacked blocks have no alignment to
 * break: every line is short, wrapping is harmless, and the Word template does
 * not need a monospaced font.
 */
export function scheduleText(rows, student) {
  const out = ['UNITY DAY SCHEDULE'];
  out.push([student.name, student.grade && `Grade ${student.grade}`].filter(Boolean).join('  -  '));
  for (const r of rows) {
    out.push('', `BLOCK ${plain(r.blocks)}`);
    out.push(`  ${r.session}`);
    if (r.location) out.push(`  ${r.location}`);
    const who = r.email ? `${r.organizer} (${r.email})` : r.organizer;
    if (who) out.push(`  ${who}`);
  }
  return out.join('\r\n');
}

/**
 * One row per scheduled student. Email, Name and Grade are their own columns so
 * the template can address and greet them; the schedule itself is one field.
 */
export function mailMergeRows(students, assignments, sessions) {
  return students
    .filter(s => assignments.has(s.email))
    .map(student => ({
      Email: student.email,
      Name: student.name,
      Full_Name: student.fullName,
      Grade: student.grade || '',
      Schedule_Text: scheduleText(scheduleRows(assignments.get(student.email), sessions), student),
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

// --------------------------------------------------------------- Rosters

/** "Byron, Ada" — how a register reads. A one-word name is left alone. */
export function listedName(fullName) {
  const bits = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (bits.length < 2) return bits[0] || '';
  return `${bits[bits.length - 1]}, ${bits.slice(0, -1).join(' ')}`;
}

const byListedName = (a, b) => {
  const [x, y] = [listedName(a.fullName), listedName(b.fullName)].map(key);
  if (x !== y) return x < y ? -1 : 1;
  return key(a.email) < key(b.email) ? -1 : 1;
};

/**
 * One roster per organizer, covering everything they run all day.
 *
 * Keyed on the organizer's email, because that is what the mail merge sends to
 * and what names the image file. A session with no organizer email is skipped:
 * there is nowhere to send it and nothing to call the file.
 *
 * Runs with nobody in them are kept — an empty room is something the adult
 * standing in it needs to know about.
 */
export function rosters(students, assignments, sessions) {
  const inRun = new Map();                       // "session|start" -> students
  for (const st of [...students].sort(byListedName)) {
    const got = assignments.get(st.email);
    if (!got) continue;
    for (const slot of new Set(got.values())) {
      const k = `${slot.sessionIndex}|${slot.start}`;
      if (!inRun.has(k)) inRun.set(k, []);
      inRun.get(k).push(st);
    }
  }

  const byOrganizer = new Map();
  sessions.forEach((session, si) => {
    if (!session.email) return;
    const k = key(session.email);
    if (!byOrganizer.has(k)) {
      byOrganizer.set(k, { email: session.email, name: session.organizer || session.email, runs: [] });
    }
    for (const start of session.starts) {
      byOrganizer.get(k).runs.push({
        session, start,
        blocks: Array.from({ length: session.length }, (_, i) => start + i),
        students: inRun.get(`${si}|${start}`) || [],
      });
    }
  });

  return [...byOrganizer.values()]
    .sort((a, b) => (key(a.email) < key(b.email) ? -1 : 1))
    .map(org => {
      org.runs.sort((a, b) => a.start - b.start || (key(a.session.name) < key(b.session.name) ? -1 : 1));
      const busy = new Set(org.runs.flatMap(r => r.blocks));
      return {
        ...org,
        free: BLOCKS.map((_, b) => b).filter(b => !busy.has(b)),
        studentCount: org.runs.reduce((n, r) => n + r.students.length, 0),
        sessionNames: [...new Set(org.runs.map(r => r.session.displayName || r.session.name))],
      };
    });
}

/** "A", or "A–B" for a run that spans blocks. */
const blockLabel = run => (run.blocks.length > 1
  ? `${BLOCKS[run.blocks[0]]}–${BLOCKS[run.blocks[run.blocks.length - 1]]}`
  : BLOCKS[run.blocks[0]]);

const runTitle = run => [
  `Block ${blockLabel(run)}`,
  run.session.displayName || run.session.name,
  run.session.location,
].filter(Boolean).join(' · ');

/**
 * An organizer's whole day as plain text: a heading, then one block per run
 * with its register under it. Several thousand characters for a busy teacher,
 * which Word carries fine from a .csv.
 */
export function rosterText(org) {
  const out = [
    `UNITY DAY ROSTER - ${org.name}`,
    [
      org.email,
      `${org.runs.length} ${org.runs.length === 1 ? 'run' : 'runs'}`,
      `${org.studentCount} ${org.studentCount === 1 ? 'student' : 'students'}`,
      org.free.length ? `free in ${org.free.map(b => BLOCKS[b]).join(', ')}` : 'running all four blocks',
    ].join('  -  '),
    '',
  ];
  for (const run of org.runs) {
    out.push(`${plain(runTitle(run))}   ${run.students.length} of ${run.session.capacity}`);
    out.push(run.students.length
      ? asciiTable(['#', 'STUDENT', 'GOES BY', 'GRADE', 'EMAIL'],
        run.students.map((st, i) => [i + 1, listedName(st.fullName), st.name, st.grade || '-', st.email]))
      : '  (nobody in this one)');
    out.push('');
  }
  return out.join('\r\n').trimEnd();
}

/** One row per organizer, for the staff Word mail merge. */
export function staffMailMergeRows(orgs) {
  return orgs.map(org => ({
    Email: org.email,
    Name: org.name,
    Roster_Text: rosterText(org),
    Sessions: org.sessionNames.join(', '),
    Blocks: [...new Set(org.runs.flatMap(r => r.blocks))].sort((a, b) => a - b).map(b => BLOCKS[b]).join(', '),
    Student_Count: org.studentCount,
  }));
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

const ROSTER = { w: 900, pad: 36, headerH: 104, barH: 38, colH: 26, rowH: 30, gap: 18 };

/** Draws one organizer's whole day as a register. Browser only. */
export function drawRoster(canvas, org) {
  const { w, pad, headerH, barH, colH, rowH, gap } = ROSTER;
  const { font } = PNG;
  const tableW = w - pad * 2;
  const bodyH = org.runs.reduce((h, r) => h + barH + colH + Math.max(r.students.length, 1) * rowH + gap, 0);
  canvas.width = w;
  canvas.height = headerH + bodyH + pad - gap;
  const c = canvas.getContext('2d');

  c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, canvas.height);
  c.fillStyle = '#111111';
  c.font = `700 30px ${font}`;
  c.fillText(`Unity Day Roster — ${org.name}`, pad, 52);
  c.font = `400 16px ${font}`;
  c.fillStyle = '#555555';
  c.fillText([
    org.email,
    `${org.runs.length} ${org.runs.length === 1 ? 'run' : 'runs'}`,
    `${org.studentCount} ${org.studentCount === 1 ? 'student' : 'students'}`,
    org.free.length ? `free in ${org.free.map(b => BLOCKS[b]).join(', ')}` : 'running all four blocks',
  ].join('  ·  '), pad, 82);

  // ponytail: fixed columns, clipped per cell. Long emails are the only thing
  // likely to run over; widen the email column if that ever bites.
  const cols = [
    { x: pad + 10, w: 44, key: r => r.n },
    { x: pad + 54, w: 230, key: r => listedName(r.s.fullName) },
    { x: pad + 284, w: 140, key: r => r.s.name },
    { x: pad + 424, w: 70, key: r => r.s.grade || '—' },
    { x: pad + 494, w: tableW - 504, key: r => r.s.email },
  ];
  const labels = ['#', 'Student', 'Goes by', 'Grade', 'Email'];
  let y = headerH;

  for (const run of org.runs) {
    c.fillStyle = '#eef2ff'; c.fillRect(pad, y, tableW, barH);
    c.fillStyle = '#1d4ed8'; c.font = `650 16px ${font}`;
    c.save();
    c.beginPath(); c.rect(pad, y, tableW - 110, barH); c.clip();
    c.fillText(runTitle(run), pad + 12, y + 25);
    c.restore();
    c.font = `600 14px ${font}`;
    const count = `${run.students.length} of ${run.session.capacity}`;
    c.fillText(count, pad + tableW - 12 - c.measureText(count).width, y + 25);
    y += barH;

    c.fillStyle = '#f4f4f5'; c.fillRect(pad, y, tableW, colH);
    c.fillStyle = '#52525b'; c.font = `600 11.5px ${font}`;
    cols.forEach((col, i) => c.fillText(labels[i].toUpperCase(), col.x, y + 17));
    y += colH;

    if (!run.students.length) {
      c.fillStyle = '#8b8b94'; c.font = `400 15px ${font}`;
      c.fillText('No students in this one.', pad + 12, y + 20);
      y += rowH;
    }
    run.students.forEach((s, i) => {
      if (i % 2) { c.fillStyle = '#fafafa'; c.fillRect(pad, y, tableW, rowH); }
      c.strokeStyle = '#ececef'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(pad, y + 0.5); c.lineTo(pad + tableW, y + 0.5); c.stroke();
      for (const col of cols) {
        c.fillStyle = col === cols[0] ? '#a1a1aa' : '#27272a';
        c.font = `400 14.5px ${font}`;
        c.save();
        c.beginPath(); c.rect(col.x, y, col.w, rowH); c.clip();
        c.fillText(String(col.key({ n: i + 1, s })), col.x, y + 20);
        c.restore();
      }
      y += rowH;
    });

    c.strokeStyle = '#d4d4d8';
    c.strokeRect(pad + 0.5, y - Math.max(run.students.length, 1) * rowH - colH - barH + 0.5,
      tableW - 1, barH + colH + Math.max(run.students.length, 1) * rowH - 1);
    y += gap;
  }
  return canvas;
}

// --------------------------------------------------- reading a merge back in
//
// The inverse of the two writers above. A finished day gets handed round as
// those two CSVs, so the app can read one back and act as a lookup directory
// on the day itself, with no sessions file, no survey and no solve. The reader
// lives next to the column names it depends on so the two cannot drift apart.

/**
 * Which merge sheet is this? Decided on the long text column, the one thing
 * the two contracts do not share.
 * @returns {'student'|'staff'|null}
 */
export function sheetKind(headers = []) {
  const h = headers.map(x => String(x ?? '').trim());
  if (h.includes('Schedule_Text')) return 'student';
  if (h.includes('Roster_Text')) return 'staff';
  return null;
}

/**
 * Rows of a downloaded merge sheet -> flat records for the lookup page.
 * Unknown or extra columns are ignored, so a sheet someone has added a note
 * column to still reads. Rows with no email are skipped: there is nothing to
 * identify them by.
 * @returns {{kind:'student'|'staff', people:object[]}}
 */
export function readMergeSheet(rows = []) {
  const kind = sheetKind(rows[0] || []);
  if (!kind) return { kind: null, people: [] };
  const head = rows[0].map(x => String(x ?? '').trim());
  const at = name => head.indexOf(name);
  const get = (row, name) => {
    const i = at(name);
    return i === -1 ? '' : String(row[i] ?? '').trim();
  };

  const people = [];
  for (const row of rows.slice(1)) {
    const email = get(row, 'Email');
    if (!email) continue;
    const text = get(row, kind === 'student' ? 'Schedule_Text' : 'Roster_Text');
    const meta = kind === 'student'
      ? [['Grade', get(row, 'Grade')]]
      : [['Sessions', get(row, 'Sessions')], ['Blocks', get(row, 'Blocks')], ['Students', get(row, 'Student_Count')]];
    people.push({
      kind,
      email,
      name: get(row, 'Full_Name') || get(row, 'Name') || email,
      text,
      meta: meta.filter(([, v]) => v !== ''),
    });
  }
  return { kind, people };
}

/**
 * People matching a typed query, best match first: whole email, then a name or
 * email that starts with it, then one that merely contains it. Deliberately
 * only matches on who someone is, not on the body of their schedule, so a
 * search for a common word cannot return half the school.
 */
export function searchDirectory(people, query, limit = 25) {
  const q = key(query);
  if (!q) return [];
  const rank = p => {
    const email = key(p.email), name = key(p.name);
    if (email === q) return 0;
    if (name === q) return 1;
    if (email.startsWith(q) || name.startsWith(q)) return 2;
    if (email.includes(q) || name.includes(q)) return 3;
    return -1;
  };
  return people
    .map(p => ({ p, r: rank(p) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || (key(a.p.name) < key(b.p.name) ? -1 : 1))
    .slice(0, limit)
    .map(x => x.p);
}
