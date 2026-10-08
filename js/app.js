// All the DOM wiring. The only file that touches the page.
// Reads the files, asks the worker to solve, draws the results, builds the
// downloads. The thinking lives in parse.js / solve.js / output.js.

import {
  BLOCKS, Report, key, parseCSV, parseSessions, parseStudents,
  parseNonRespondents, parseOverrides, overridesToRows,
} from './parse.js';
import {
  MAIL_MERGE_FILE, MAIL_MERGE_COLUMNS, UNPLACED_FILE, PNG_ZIP_FILE,
  STAFF_MAIL_MERGE_FILE, STAFF_MAIL_MERGE_COLUMNS, ROSTER_ZIP_FILE,
  mailMergeRows, unplacedRows, scheduleRows, toCSV, drawSchedule,
  rosters, staffMailMergeRows, drawRoster,
} from './output.js';

const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const icon = name => el('span', 'icon', name);

const state = {
  rows: {},            // zone id -> 2D array of cells
  sessions: [],
  students: [],        // respondents + non-respondents, the solver's input
  rejected: [],        // rows thrown out at parse time
  overrides: [],
  reports: {},         // zone id -> Report
  result: null,
  dirty: false,        // overrides changed since the last download
};

// ------------------------------------------------------------------ theme

const themeBtn = $('#theme');
function paintTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-icon').textContent = dark ? 'light_mode' : 'dark_mode';
  $('#theme-label').textContent = dark ? 'Light' : 'Dark';
}
themeBtn.onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  paintTheme();
};
paintTheme();

// ------------------------------------------------------------- drop zones

const ZONES = [
  { id: 'sessions', label: 'Sessions', note: 'One row per session: name, room, capacity, blocks.', required: true },
  { id: 'responses', label: 'Student responses', note: 'The survey export, one row per student.', required: true },
  { id: 'nonrespondents', label: 'Non-respondents', note: 'Optional. Students who never filled the survey in.' },
  { id: 'overrides', label: 'Overrides', note: 'Optional. Last year&rsquo;s saved exceptions, or none.' },
];

for (const z of ZONES) {
  const wrap = el('label', 'drop');
  wrap.id = `zone-${z.id}`;
  wrap.append(icon('upload_file'));
  const text = el('div', 'drop-text');
  text.append(el('div', 'drop-name', z.label + (z.required ? '' : ' (optional)')));
  const note = el('div', 'drop-note');
  note.innerHTML = z.note;
  text.append(note);
  wrap.append(text);
  const input = el('input');
  input.type = 'file';
  input.accept = '.csv,.xlsx,.xls';
  input.onchange = () => input.files[0] && loadFile(z, input.files[0]);
  wrap.append(input);
  wrap.ondragover = e => { e.preventDefault(); wrap.classList.add('is-over'); };
  wrap.ondragleave = () => wrap.classList.remove('is-over');
  wrap.ondrop = e => {
    e.preventDefault();
    wrap.classList.remove('is-over');
    if (e.dataTransfer.files[0]) loadFile(z, e.dataTransfer.files[0]);
  };
  $('#drops').append(wrap);
}

/** File -> 2D array of trimmed-as-written cells. xlsx goes through SheetJS. */
async function readRows(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  }
  return parseCSV(await file.text());
}

async function loadFile(zone, file) {
  setZone(zone, 'loading', file.name, 'Reading…');
  try {
    state.rows[zone.id] = await readRows(file);
    state.rows[`${zone.id}-name`] = file.name;
  } catch (e) {
    delete state.rows[zone.id];
    setZone(zone, 'bad', file.name, `Could not read this file: ${e.message}`);
    return;
  }
  validateAll();
}

function setZone(zone, status, name, note) {
  const wrap = $(`#zone-${zone.id}`);
  wrap.classList.toggle('is-ok', status === 'ok');
  wrap.classList.toggle('is-bad', status === 'bad');
  wrap.querySelector('.icon').textContent =
    status === 'ok' ? 'check_circle' : status === 'bad' ? 'error' : 'upload_file';
  wrap.querySelector('.drop-name').textContent = `${zone.label} — ${name}`;
  wrap.querySelector('.drop-note').textContent = note;
}

// ------------------------------------------------------------- validation

/** Re-reads everything from state.rows. Cheap enough to run on every change. */
function validateAll() {
  state.reports = {};
  const rep = id => (state.reports[id] = new Report());

  const sessionsRep = rep('sessions');
  state.sessions = state.rows.sessions ? parseSessions(state.rows.sessions, sessionsRep).sessions : [];

  const respRep = rep('responses');
  let respondents = [];
  state.rejected = [];
  if (state.rows.responses && state.sessions.length) {
    const r = parseStudents(state.rows.responses, state.sessions, respRep);
    respondents = r.students;
    state.rejected = r.rejected;
  }

  const nonRep = rep('nonrespondents');
  const nonRespondents = state.rows.nonrespondents
    ? parseNonRespondents(state.rows.nonrespondents, respondents, nonRep).nonRespondents : [];

  state.students = [...respondents, ...nonRespondents];

  const ovRep = rep('overrides');
  if (state.rows.overrides) {
    state.overrides = parseOverrides(state.rows.overrides, state.sessions, state.students, ovRep).overrides;
    delete state.rows.overrides;   // the editor owns the list from here on
    state.dirty = false;
  }

  for (const z of ZONES) {
    const r = state.reports[z.id];
    if (!state.rows[z.id] && !(z.id === 'overrides' && state.overrides.length)) {
      if (!r.errors.length) continue;
    }
    const name = state.rows[`${z.id}-name`] || 'in the editor';
    if (r.errors.length) setZone(z, 'bad', name, r.errors[0] + (r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ''));
    else if (z.id === 'sessions') setZone(z, 'ok', name, count(state.sessions.length, 'session'));
    else if (z.id === 'responses') setZone(z, 'ok', name, count(state.students.filter(s => s.respondent).length, 'response') + (state.rejected.length ? `, ${state.rejected.length} rejected` : ''));
    else if (z.id === 'nonrespondents') setZone(z, 'ok', name, count(nonRespondents.length, 'student'));
    else if (z.id === 'overrides') setZone(z, 'ok', name, count(state.overrides.length, 'override'));
  }

  renderProblems();

  const problems = Object.values(state.reports).some(r => r.errors.length);
  const ready = state.sessions.length > 0 && state.students.length > 0 && !problems;
  $('#generate').disabled = !ready;
  $('#generate-hint').textContent = ready
    ? `${state.students.length} students, ${state.sessions.length} sessions.`
    : problems ? 'Fix the problems above first.' : 'Add the sessions and student responses files to start.';

  fillSessionPickers();
}

/**
 * Every problem in every uploaded file, in one list. The drop zones only have
 * room for the first one each, and the Review step is out of reach while an
 * error is blocking Generate, so this is the only place staff can see the lot.
 */
function renderProblems() {
  const box = $('#problems-list');
  box.replaceChildren();
  let errors = 0, warnings = 0;

  for (const z of ZONES) {
    const r = state.reports[z.id];
    if (!r || (!r.errors.length && !r.warnings.length)) continue;
    const name = state.rows[`${z.id}-name`] || z.label;
    if (r.errors.length) {
      errors += r.errors.length;
      box.append(notice('bad', 'error', `${name} — ${count(r.errors.length, 'problem')}`, r.errors));
    }
    if (r.warnings.length) {
      warnings += r.warnings.length;
      box.append(notice('warn', 'warning', `${name} — ${count(r.warnings.length, 'thing')} to know`, r.warnings));
    }
  }

  const panel = $('#problems');
  panel.hidden = !errors && !warnings;
  if (panel.hidden) { panel.open = false; return; }
  $('#problems-icon').textContent = errors ? 'error' : 'warning';
  $('#problems-label').textContent = [
    errors ? count(errors, 'problem') : '',
    warnings ? count(warnings, 'warning') : '',
  ].filter(Boolean).join(' and ') + ' across your files';
  // Anything blocking Generate opens the panel. Warnings alone do not, but they
  // do not close it either: whatever the user last chose stays.
  if (errors) panel.open = true;
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------------ solve

let worker;
function getWorker() {
  worker ??= new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
  return worker;
}

function runSolve() {
  const btn = $('#generate'), regen = $('#regenerate');
  for (const b of [btn, regen]) b.disabled = true;
  $('#generate-label').textContent = 'Working…';
  btn.querySelector('.icon').replaceWith(el('span', 'spinner'));

  const done = () => {
    $('#generate-label').textContent = 'Generate schedules';
    const s = btn.querySelector('.spinner');
    if (s) s.replaceWith(icon('auto_awesome'));
    btn.disabled = false;
    regen.disabled = false;
  };

  getWorker().onmessage = ({ data }) => {
    done();
    if (data.fatal) {
      showMessages([`Something went wrong in the solver: ${data.fatal}`], []);
      $('#review').hidden = false;
      $('#download').hidden = true;
      return;
    }
    state.result = data;
    render();
  };
  getWorker().postMessage({
    sessions: state.sessions,
    students: state.students,
    overrides: state.overrides,
  });
}

$('#generate').onclick = runSolve;
$('#regenerate').onclick = runSolve;

// ----------------------------------------------------------------- render

function render() {
  const { metrics, errors, warnings, unplaced } = state.result;
  $('#review').hidden = false;

  const warnAll = [...warnings, ...Object.values(state.reports).flatMap(r => r.warnings)];
  const errAll = [...errors, ...Object.values(state.reports).flatMap(r => r.errors)];

  $('#metrics').replaceChildren();
  if (metrics) {
    const tiles = [
      [`${metrics.fullyScheduledPct.toFixed(1)}%`, 'Fully scheduled'],
      [metrics.avgRating ? metrics.avgRating.toFixed(2) : '—', 'Average rating received'],
      [`${metrics.highRatingPct.toFixed(0)}%`, 'Assignments rated 4 or 5'],
      [String(metrics.nonRespondentsScheduled), 'Non-respondents placed'],
      [String(metrics.overridesApplied), 'Overrides applied'],
    ];
    for (const [v, label] of tiles) {
      const m = el('div', 'metric');
      m.append(el('div', 'metric-value', v), el('div', 'metric-label', label));
      $('#metrics').append(m);
    }
  }

  const unplacedTotal = unplaced.length + state.rejected.length;
  showMessages(errAll, warnAll, unplacedTotal);

  renderOverrides();
  fillStudentList();
  renderLookup();

  const ok = !errAll.length && metrics;
  $('#download').hidden = !ok;
  $('#dl-unplaced').hidden = !unplacedTotal;
  if (ok) {
    $('#download-hint').textContent =
      `${metrics.scheduled} students have a full schedule.` +
      (unplacedTotal ? ` ${unplacedTotal} need placing by hand.` : '');
  }
  $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function notice(kind, iconName, heading, items) {
  const n = el('div', `notice notice-${kind}`);
  n.append(icon(iconName));
  const body = el('div', 'notice-body');
  body.append(el('div', 'h3', heading));
  if (items?.length) {
    const ul = el('ul', 'notice-list');
    for (const t of items.slice(0, 50)) ul.append(el('li', null, t));
    if (items.length > 50) ul.append(el('li', 'faint', `…and ${items.length - 50} more.`));
    body.append(ul);
  }
  n.append(body);
  return n;
}

function showMessages(errors, warnings, unplacedTotal = 0) {
  const box = $('#messages');
  box.replaceChildren();
  if (errors.length) box.append(notice('bad', 'error', count(errors.length, 'problem'), errors));
  if (unplacedTotal) {
    box.append(notice('bad', 'person_alert',
      `${count(unplacedTotal, 'student')} could not be scheduled`,
      [...state.rejected, ...(state.result?.unplaced || [])].map(u => `${u.email} — ${u.reason}`)));
  }
  if (warnings.length) box.append(notice('warn', 'warning', `${count(warnings.length, 'thing')} to know`, warnings));
  if (!errors.length && !warnings.length && !unplacedTotal) {
    box.append(notice('good', 'check_circle', 'Every student has a full schedule and nothing looked odd in the files.'));
  }
}

// -------------------------------------------------------- overrides editor

function fillSessionPickers() {
  const sel = $('#ov-session');
  sel.replaceChildren(...state.sessions.map((s, i) => {
    const o = el('option', null, s.displayName || s.name);
    o.value = String(i);
    return o;
  }));
  fillBlockPicker();
}

function fillBlockPicker() {
  const type = $('#ov-type').value;
  const sel = $('#ov-block');
  const free = type === 'Free';
  $('#ov-session-field').hidden = free;
  sel.disabled = type === 'Exclude';

  let opts;
  if (type === 'Exclude') opts = [['', 'All blocks']];
  else if (free) opts = BLOCKS.map(b => [b, b]);
  else {
    const s = state.sessions[Number($('#ov-session').value)];
    opts = [['', 'Any'], ...(s ? s.starts.map(b => [BLOCKS[b], BLOCKS[b]]) : [])];
  }
  sel.replaceChildren(...opts.map(([v, label]) => {
    const o = el('option', null, label);
    o.value = v;
    return o;
  }));
}
$('#ov-type').onchange = fillBlockPicker;
$('#ov-session').onchange = fillBlockPicker;

function findStudent(text) {
  const q = key(text);
  if (!q) return null;
  return state.students.find(s => key(s.email) === q)
    || state.students.find(s => key(`${s.name} (${s.email})`) === q)
    || state.students.find(s => key(s.fullName) === q)
    || state.students.find(s => key(s.email).startsWith(q) || key(s.fullName).includes(q))
    || null;
}

function addOverride(o) {
  const sig = [key(o.email), o.type, o.sessionIndex, o.block].join('|');
  if (state.overrides.some(x => [key(x.email), x.type, x.sessionIndex, x.block].join('|') === sig)) return false;
  // Pin and Exclude on one session is an error the solver refuses, so the newer
  // one wins: pressing "Not this" on a block they are pinned to means not this.
  const opposite = { Pin: 'Exclude', Exclude: 'Pin' }[o.type];
  if (opposite) {
    state.overrides = state.overrides.filter(
      x => !(key(x.email) === key(o.email) && x.type === opposite && x.sessionIndex === o.sessionIndex));
  }
  state.overrides.push(o);
  state.dirty = true;
  renderOverrides();
  return true;
}

$('#ov-add').onclick = () => {
  const err = $('#ov-error');
  const student = findStudent($('#ov-student').value);
  if (!student) { err.textContent = 'That is not a student in the uploaded files.'; return; }
  const type = $('#ov-type').value;
  const blockRaw = $('#ov-block').value;
  if (type === 'Free' && !blockRaw) { err.textContent = 'A Free override needs a block.'; return; }
  err.textContent = '';
  addOverride({
    email: student.email,
    type,
    sessionIndex: type === 'Free' ? null : Number($('#ov-session').value),
    block: blockRaw ? BLOCKS.indexOf(blockRaw) : null,
    note: $('#ov-note').value.trim(),
  });
  $('#ov-student').value = '';
  $('#ov-note').value = '';
};

function renderOverrides() {
  const body = $('#override-rows');
  body.replaceChildren();
  $('#override-count').textContent = String(state.overrides.length);
  $('#dirty-hint').hidden = !state.dirty;

  if (!state.overrides.length) {
    const tr = el('tr');
    const td = el('td', 'table-empty', 'No overrides. The schedule is whatever the solver found.');
    td.colSpan = 6;
    tr.append(td);
    body.append(tr);
    return;
  }
  state.overrides.forEach((o, i) => {
    const st = state.students.find(s => key(s.email) === key(o.email));
    const tr = el('tr');
    tr.append(
      el('td', null, st ? `${st.name} (${o.email})` : o.email),
      el('td', null, o.type),
      el('td', null, o.sessionIndex === null ? '—' : (state.sessions[o.sessionIndex].displayName || state.sessions[o.sessionIndex].name)),
      el('td', null, o.block === null ? (o.type === 'Pin' ? 'Any' : '—') : BLOCKS[o.block]),
      el('td', 'faint', o.note || ''),
    );
    const td = el('td');
    const del = el('button', 'btn btn-icon btn-danger');
    del.type = 'button';
    del.title = 'Delete this override';
    del.append(icon('delete'));
    del.onclick = () => {
      state.overrides.splice(i, 1);
      state.dirty = true;
      renderOverrides();
    };
    td.append(del);
    tr.append(td);
    body.append(tr);
  });
}

$('#dl-overrides').onclick = () => {
  download('Overrides.csv', toCSV(rowsToObjects(overridesToRows(state.overrides, state.sessions))));
  state.dirty = false;
  renderOverrides();
};

const rowsToObjects = ([head, ...rest]) => rest.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));

addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------- student lookup

function fillStudentList() {
  $('#student-list').replaceChildren(...state.students.map(s => {
    const o = el('option');
    o.value = `${s.name} (${s.email})`;
    return o;
  }));
}

$('#lookup').oninput = renderLookup;

function renderLookup() {
  const box = $('#lookup-result');
  box.replaceChildren();
  const text = $('#lookup').value.trim();
  if (!text || !state.result) return;

  const student = findStudent(text);
  if (!student) { box.append(notice('warn', 'search_off', 'No student by that name or email.')); return; }

  const got = state.result.assignments.get(student.email);
  if (!got) {
    const u = state.result.unplaced.find(x => key(x.email) === key(student.email))
      || state.rejected.find(x => key(x.email) === key(student.email));
    box.append(notice('bad', 'person_alert', `${student.name} has no schedule`, [u ? u.reason : 'Not in the last run.']));
    return;
  }

  const wrap = el('div', 'table-wrap');
  const table = el('table', 'table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Block', 'Session', 'Location', 'Run by', '']) hr.append(el('th', null, h));
  thead.append(hr);
  const tbody = el('tbody');

  for (const r of scheduleRows(got, state.sessions)) {
    const tr = el('tr');
    tr.append(
      el('td', null, r.blocks),
      el('td', null, r.session),
      el('td', null, r.location || '—'),
      el('td', 'faint', [r.organizer, r.email].filter(Boolean).join(' · ') || '—'),
    );
    const td = el('td');
    if (r.session !== 'Free') {
      const slot = got.get(BLOCKS.indexOf(r.blocks[0]));
      const keep = el('button', 'btn btn-sm', 'Keep this');
      keep.type = 'button';
      keep.onclick = () => {
        addOverride({ email: student.email, type: 'Pin', sessionIndex: slot.sessionIndex, block: slot.start, note: 'Kept from the lookup' });
        flash(keep, 'Pinned');
      };
      const not = el('button', 'btn btn-sm btn-danger', 'Not this');
      not.type = 'button';
      not.onclick = () => {
        addOverride({ email: student.email, type: 'Exclude', sessionIndex: slot.sessionIndex, block: null, note: 'Excluded from the lookup' });
        flash(not, 'Excluded');
      };
      const row = el('div', 'row');
      row.style.gap = 'var(--s-2)';
      row.append(keep, not);
      td.append(row);
    }
    tr.append(td);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  box.append(wrap);
}

function flash(btn, text) {
  const was = btn.textContent;
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = was; btn.disabled = false; }, 1200);
}

// -------------------------------------------------------------- downloads

function download(name, data, type = 'text/csv;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadXlsx(name, rows, columns) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MailMerge');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(name, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

$('#dl-merge').onclick = () => {
  downloadXlsx(MAIL_MERGE_FILE, mailMergeRows(orderedStudents(), state.result.assignments, state.sessions), MAIL_MERGE_COLUMNS);
};

const organizerRosters = () => rosters(orderedStudents(), state.result.assignments, state.sessions);

$('#dl-staff-merge').onclick = () => {
  downloadXlsx(STAFF_MAIL_MERGE_FILE, staffMailMergeRows(organizerRosters()), STAFF_MAIL_MERGE_COLUMNS);
};

$('#dl-unplaced').onclick = () => {
  download(UNPLACED_FILE, toCSV(unplacedRows(state.result.unplaced, state.rejected, state.sessions)));
};

/**
 * Draws one PNG per item and zips them. `draw` gets a reused canvas and must
 * return the file name to store it under.
 */
async function downloadPngZip(btn, zipName, items, noun, draw) {
  btn.disabled = true;
  const canvas = document.createElement('canvas');
  const files = {};
  for (let i = 0; i < items.length; i++) {
    const name = draw(canvas, items[i]);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    files[name] = new Uint8Array(await blob.arrayBuffer());
    if (i % 20 === 0) {
      $('#download-hint').textContent = `Drawing ${noun}… ${i + 1} of ${items.length}`;
      await new Promise(requestAnimationFrame);
    }
  }
  $('#download-hint').textContent = 'Zipping…';
  // ponytail: store, no deflate. PNGs are already compressed, and zipping 1000
  // of them with deflate just burns a few seconds for ~1% off the file.
  const zip = fflate.zipSync(files, { level: 0 });
  download(zipName, new Blob([zip], { type: 'application/zip' }));
  $('#download-hint').textContent = `${items.length} ${noun}.`;
  btn.disabled = false;
}

$('#dl-pngs').onclick = () => {
  const students = orderedStudents().filter(s => state.result.assignments.has(s.email));
  return downloadPngZip($('#dl-pngs'), PNG_ZIP_FILE, students, 'schedule images', (canvas, s) => {
    drawSchedule(canvas, s, scheduleRows(state.result.assignments.get(s.email), state.sessions));
    return `${s.email}.png`;
  });
};

$('#dl-rosters').onclick = () => downloadPngZip(
  $('#dl-rosters'), ROSTER_ZIP_FILE, organizerRosters(), 'rosters',
  (canvas, org) => { drawRoster(canvas, org); return `${org.email}.png`; });

/** Stable output order, so two runs produce byte-identical files. */
const orderedStudents = () => [...state.students].sort((a, b) => (key(a.email) < key(b.email) ? -1 : 1));
