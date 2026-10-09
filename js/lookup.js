// The lookup page. Reads the two finished mail-merge sheets back in and lets
// someone search them on the day: a student's schedule, or a session leader's
// roster. No sessions file, no survey, no solving — this page only reads.
//
// Deliberately separate from app.js. The planner's own lookup is wired to a
// live solve and offers Keep this / Not this; this one has nothing to change,
// and the people using it should not be shown a Generate button.

import { parseCSV } from './parse.js';
import { readMergeSheet, searchDirectory } from './output.js';

const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const icon = name => el('span', 'icon', name);

// Kept in memory only, never in localStorage: these rows are real students.
const sheets = { student: [], staff: [] };

// ------------------------------------------------------------------ theme

const sync = () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-icon').textContent = dark ? 'light_mode' : 'dark_mode';
  $('#theme-label').textContent = dark ? 'Light' : 'Dark';
};
$('#theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  sync();
};
sync();

// ------------------------------------------------------------ loading files

const zone = $('#zone');
zone.ondragover = e => { e.preventDefault(); zone.classList.add('is-over'); };
zone.ondragleave = () => zone.classList.remove('is-over');
zone.ondrop = e => {
  e.preventDefault();
  zone.classList.remove('is-over');
  load(e.dataTransfer.files);
};
$('#file').onchange = e => load(e.target.files);

$('#clear').onclick = () => {
  sheets.student = [];
  sheets.staff = [];
  $('#q').value = '';
  $('#file').value = '';
  setZone(null, 'Student and staff mail-merge files',
    'Drop the files the planner produced here — both at once is fine.');
  render();
};

async function load(files) {
  const names = [], problems = [];
  for (const file of [...(files || [])]) {
    if (/\.xlsx?$/i.test(file.name)) {
      problems.push(`${file.name} is a spreadsheet. Open it and save as CSV, or download the .csv from the planner.`);
      continue;
    }
    try {
      const { kind, people } = readMergeSheet(parseCSV(await file.text()));
      if (!kind) {
        problems.push(`${file.name} is not a Unity Day mail-merge file — no Schedule_Text or Roster_Text column.`);
        continue;
      }
      if (!people.length) {
        problems.push(`${file.name} is a ${kind} sheet but has no rows with an email in them.`);
        continue;
      }
      sheets[kind] = people;
      names.push(`${file.name} → ${people.length} ${kind === 'student' ? 'students' : 'session leaders'}`);
    } catch (e) {
      problems.push(`Could not read ${file.name}: ${e.message}`);
    }
  }

  if (problems.length) setZone('bad', 'Some files were not read', problems.join(' '));
  else if (names.length) setZone('ok', 'Loaded', names.join(' · '));
  render();
}

function setZone(status, name, note) {
  zone.classList.toggle('is-ok', status === 'ok');
  zone.classList.toggle('is-bad', status === 'bad');
  zone.querySelector('.icon').textContent =
    status === 'ok' ? 'check_circle' : status === 'bad' ? 'error' : 'upload_file';
  $('#zone-name').textContent = name;
  $('#zone-note').textContent = note;
}

// ----------------------------------------------------------------- drawing

const everyone = () => [...sheets.student, ...sheets.staff];

function render() {
  const people = everyone();
  const counts = [['#count-students', sheets.student.length, 'student'], ['#count-staff', sheets.staff.length, 'session leader']];
  for (const [sel, n, label] of counts) {
    const badge = $(sel);
    badge.hidden = n === 0;
    badge.textContent = `${n} ${label}${n === 1 ? '' : 's'}`;
  }
  $('#loaded').hidden = people.length === 0;
  $('#search-card').hidden = people.length === 0;

  $('#people').replaceChildren(...people.map(p => {
    const o = el('option');
    o.value = `${p.name} (${p.email})`;
    return o;
  }));
  renderResults();
}

$('#q').oninput = renderResults;

function renderResults() {
  const box = $('#results');
  box.replaceChildren();
  const q = $('#q').value.trim();
  if (!q) {
    box.append(hint('Type a name or an email address. Paste a whole email to jump straight to one person.'));
    return;
  }
  // A datalist pick arrives as "Name (email)"; the email alone is the better key.
  const inBrackets = q.match(/\(([^()]+@[^()]+)\)\s*$/);
  const found = searchDirectory(everyone(), inBrackets ? inBrackets[1] : q);
  if (!found.length) {
    box.append(notice('warn', 'search_off', 'Nobody by that name or email',
      ['Check the spelling, or try just the surname.',
        'Only the sheets loaded above are searched — a student will not be found in the staff sheet alone.']));
    return;
  }
  for (const p of found) box.append(card(p));
}

function card(p) {
  const wrap = el('div', 'stack-sm');
  const head = el('div', 'row');
  head.append(el('div', 'h2', p.name));
  head.append(el('span', p.kind === 'student' ? 'badge badge-accent' : 'badge', p.kind === 'student' ? 'Student' : 'Session leader'));
  wrap.append(head);

  const meta = el('div', 'row');
  meta.style.gap = 'var(--s-2)';
  meta.append(el('span', 'badge mono', p.email));
  for (const [label, value] of p.meta) meta.append(el('span', 'badge', `${label}: ${value}`));
  wrap.append(meta);

  // Already formatted by output.js for Word, and correct to show as-is.
  wrap.append(el('pre', 'sheet', p.text || 'This row has no schedule text in it.'));
  return wrap;
}

const hint = text => el('p', 'hint', text);

function notice(kind, iconName, heading, items) {
  const n = el('div', `notice notice-${kind}`);
  n.append(icon(iconName));
  const body = el('div', 'notice-body');
  body.append(el('div', 'h3', heading));
  if (items?.length) {
    const ul = el('ul', 'notice-list');
    for (const t of items) ul.append(el('li', null, t));
    body.append(ul);
  }
  n.append(body);
  return n;
}

render();
