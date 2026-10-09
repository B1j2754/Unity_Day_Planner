// CSV text -> validated sessions / students / overrides. No DOM, no file APIs:
// app.js hands us rows, tests import this directly in node.

export const BLOCKS = ['A', 'B', 'C', 'D'];

// Empty "Blocks" means these start letters, by session length. From the spec table.
// A 1-block session with no Blocks given runs three times, not four, and which
// block it sits out is chosen per session by spreadSpareBlocks() below. The
// other lengths cannot run three times — a 2-block session only fits two
// non-overlapping runs in a day, and a 3- or 4-block session only fits one.
const DEFAULT_STARTS = { 1: 'ABCD', 2: 'AC', 3: 'A', 4: 'A' };
const DEFAULT_RUNS_FOR_1_BLOCK = 3;

const YES = new Set(['yes', 'y', '1', 'true']);
const NO = new Set(['no', 'n', '0', 'false']);

/** RFC4180-ish. Handles quotes, escaped quotes, CRLF, BOM. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
  return rows;
}

export const norm = s => String(s ?? '').trim();
export const key = s => norm(s).toLowerCase();
export const firstChunk = s => norm(s).split(/\s+/)[0] || '';

/** Levenshtein distance, given up on early — we only care about "nearly the same". */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Is `actual` close enough to `wanted` to be a typo of it, and not a different word? */
function isTypo(actual, wanted) {
  const d = distance(actual, wanted);
  return d > 0 && d <= 2 && d <= Math.max(actual.length, wanted.length) / 4;
}

/** Other things a column gets called in the wild. Exact matches still win. */
const COLUMN_ALIASES = {
  'Name (FIRST LAST)': ['Name', 'Full Name', 'Student Name', 'First and Last Name'],
  'Email Address': ['Email', 'Student Email', 'Email address (auto-collected)'],
  'Grade': ['Grade Level', 'Year'],
  'Preferred Name': ['Nickname', 'Preferred First Name'],
};

/**
 * Column name -> index, in three passes, each only looking at columns nothing
 * has claimed yet: the exact name, then a known alias ("Name" for
 * "Name (FIRST LAST)"), then a near miss ("Email Adress"). Anything but an exact
 * hit is warned about, naming both spellings, so nobody is left guessing.
 *
 * @param skip columns already claimed by something else (session rating columns)
 * @returns {{at: (name: string) => number|undefined, claimed: Set<number>}}
 */
function matchHeaders(headerRow, wanted, report, where, skip = new Set()) {
  const found = new Map();
  const claimed = new Set(skip);
  // A form export carries the question's description in the header, under the
  // title, so every comparison has to be offered the title on its own too.
  const forms = headerRow.map(h => [...new Set([key(h), key(splitTitle(h))])].filter(Boolean));
  const take = (w, i, why) => {
    found.set(w, i);
    claimed.add(i);
    if (why) report.warn(`${where}: reading the column "${splitTitle(headerRow[i])}" as "${w}"${why}`);
  };
  const find = test => headerRow.findIndex((h, j) => !claimed.has(j) && forms[j].some(test));

  headerRow.forEach((h, i) => {
    if (claimed.has(i)) return;
    const hit = wanted.find(w => !found.has(w) && forms[i].includes(key(w)));
    if (hit) take(hit, i);
  });
  for (const w of wanted) {
    if (found.has(w)) continue;
    const aliases = (COLUMN_ALIASES[w] || []).map(key);
    const i = find(f => aliases.includes(f));
    if (i !== -1) take(w, i, '.');
  }
  for (const w of wanted) {
    if (found.has(w)) continue;
    const i = find(f => isTypo(f, key(w)));
    if (i !== -1) take(w, i, '. Correct the spelling in the file to stop this warning.');
  }
  return { at: name => found.get(name), claimed };
}

/** Warns about every column nothing claimed. */
function warnUnclaimed(headerRow, claimed, report, where) {
  headerRow.forEach((h, i) => {
    if (norm(h) && !claimed.has(i)) report.warn(`Ignoring unrecognised ${where} column "${norm(h)}".`);
  });
}

const cell = (row, idx) => (idx === undefined ? '' : norm(row[idx]));

const isPositiveInt = s => /^\d+$/.test(s) && Number(s) > 0;

export const isEmail = s => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(s);

export class Report {
  constructor() { this.errors = []; this.warnings = []; }
  error(msg) { this.errors.push(msg); }
  warn(msg) { this.warnings.push(msg); }
}

// ---------------------------------------------------------------- Sessions

const SESSION_COLS = {
  name: 'Session Name',
  organizer: 'Session Organizer Name',
  email: 'Session Organizer Contact Email Address',
  location: 'Location',
  capacity: 'Max Students Per Session',
  blocks: 'Blocks',
  length: 'Length of Session (in blocks)',
  random: 'Can be Randomly Assigned?',
  // Optional. The last word on which survey column belongs to this session, for
  // when the two sheets call it something too different to work out.
  surveyColumn: 'Survey Column',
};

/**
 * Decides which single block each "Blocks left blank" 1-block session sits out.
 *
 * Sessions that named their blocks are counted first, then each blank one sits
 * out whichever block is fullest at that moment, so the four blocks end up
 * holding roughly the same number of seats. Capacity is what is balanced, not
 * the number of sessions, because one 60-seat session outweighs three 10-seat
 * ones. Sessions arrive sorted by name and ties go to the earliest block, so
 * the result never depends on the order of the rows in the file.
 */
function spreadSpareBlocks(sessions) {
  const seats = new Array(BLOCKS.length).fill(0);
  const add = s => {
    for (const start of s.starts) {
      for (let i = 0; i < s.length; i++) seats[start + i] += s.capacity;
    }
  };
  sessions.filter(s => !s.blocksBlank).forEach(add);

  for (const s of sessions) {
    if (!s.blocksBlank) continue;
    let fullest = 0;
    for (let b = 1; b < BLOCKS.length; b++) if (seats[b] > seats[fullest]) fullest = b;
    s.starts = BLOCKS.map((_, b) => b).filter(b => b !== fullest);
    s.sitsOut = fullest;           // which block it skips, for anyone who asks
    add(s);
  }
}

/**
 * A set of start blocks is valid iff every run ends by block D and no two runs
 * overlap. `starts` are 0-based block indices, already sorted ascending.
 */
function startsAreValid(starts, length) {
  for (const s of starts) if (s + length - 1 > 3) return false;
  for (let i = 1; i < starts.length; i++) if (starts[i] - starts[i - 1] < length) return false;
  return true;
}

export function parseSessions(rows, report = new Report()) {
  const sessions = [];
  if (!rows.length) { report.error('Sessions file is empty.'); return { sessions, report }; }

  const head = matchHeaders(rows[0], Object.values(SESSION_COLS), report, 'Sessions file');
  const col = {};
  for (const [k, name] of Object.entries(SESSION_COLS)) col[k] = head.at(name);
  for (const k of ['name', 'capacity', 'length', 'blocks', 'random']) {
    if (col[k] === undefined) report.error(`Sessions file is missing the "${SESSION_COLS[k]}" column.`);
  }
  for (const k of ['organizer', 'email', 'location']) {
    if (col[k] === undefined) report.warn(`Sessions file has no "${SESSION_COLS[k]}" column; it will be left off the schedules.`);
  }
  warnUnclaimed(rows[0], head.claimed, report, 'Sessions');
  if (report.errors.length) return { sessions, report };

  // Row 2 is the description row, but only if it looks like one: a staff member
  // may have deleted it, in which case row 2 is a real session.
  let start = 2;
  if (rows.length > 1 && isPositiveInt(cell(rows[1], col.capacity))) {
    report.warn('Sessions file has no description row (row 2); reading row 2 as a session.');
    start = 1;
  }

  const seen = new Set();
  for (let r = start; r < rows.length; r++) {
    const row = rows[r], at = `Sessions row ${r + 1}`;
    const name = cell(row, col.name);
    if (!name) { report.warn(`${at}: blank session name, row skipped.`); continue; }
    if (seen.has(key(name))) { report.error(`${at}: session "${name}" is listed twice.`); continue; }

    const capRaw = cell(row, col.capacity);
    if (!isPositiveInt(capRaw)) {
      report.error(`${at}: "Max Students Per Session" must be a whole number above zero, got "${capRaw}".`);
      continue;
    }
    const lenRaw = cell(row, col.length);
    if (!isPositiveInt(lenRaw) || Number(lenRaw) > 4) {
      report.error(`${at}: "Length of Session (in blocks)" must be 1, 2, 3 or 4, got "${lenRaw}".`);
      continue;
    }
    const length = Number(lenRaw);

    let blocksRaw = cell(row, col.blocks).toUpperCase().replace(/[\s,]/g, '');
    // Blocks left blank on a 1-block session: start from all four and drop one
    // later, once every session's capacity is known. Spelling out ABCD still
    // means all four.
    const blocksBlank = !blocksRaw && length === 1;
    if (!blocksRaw) blocksRaw = DEFAULT_STARTS[length];
    const bad = [...blocksRaw].filter(c => !BLOCKS.includes(c));
    if (bad.length) {
      report.error(`${at}: "Blocks" may only contain A, B, C or D, got "${[...new Set(bad)].join('')}".`);
      continue;
    }
    if (new Set(blocksRaw).size !== blocksRaw.length) {
      report.error(`${at}: "Blocks" lists the same letter twice ("${blocksRaw}").`);
      continue;
    }
    const starts = [...blocksRaw].map(c => BLOCKS.indexOf(c)).sort((a, b) => a - b);
    if (!startsAreValid(starts, length)) {
      report.error(`${at}: a ${length}-block session cannot start at ${[...blocksRaw].join(', ')} — the runs would overlap or run past block D.`);
      continue;
    }

    const randRaw = cell(row, col.random);
    let canRandom;
    // Blank means Yes: most sessions are open to everyone, so the common case
    // is the one you can leave empty.
    if (!randRaw || YES.has(key(randRaw))) canRandom = true;
    else if (NO.has(key(randRaw))) canRandom = false;
    else { report.error(`${at}: "Can be Randomly Assigned?" must be Yes or No, got "${randRaw}".`); continue; }

    const email = cell(row, col.email);
    if (email && !isEmail(email)) {
      report.warn(`${at}: "${email}" is not a valid email address; it will be left off the schedules.`);
    }

    seen.add(key(name));
    sessions.push({
      name, starts, length, capacity: Number(capRaw), canRandom,
      organizer: cell(row, col.organizer),
      email: isEmail(email) ? email : '',
      location: cell(row, col.location),
      surveyColumn: cell(row, col.surveyColumn),
      blocksBlank,
    });
  }
  if (!sessions.length && !report.errors.length) report.error('Sessions file has no sessions in it.');
  // Sorted by name so that shuffling the rows of Sessions.csv cannot change the
  // solver's variable order, and so dropdowns read alphabetically. Everything
  // downstream refers to sessions by index, so this must happen here or nowhere.
  sessions.sort((a, b) => (key(a.name) < key(b.name) ? -1 : 1));

  spreadSpareBlocks(sessions);

  assignExclusionGroups(sessions, report);

  // What a student sees. A session name is often a whole sentence — the title
  // plus a description — and only the title belongs on a schedule sheet. The
  // full name is kept for staff-facing messages, and is used on the sheet too
  // wherever the title alone would not say which session is meant.
  const titles = sessionTitles(sessions);
  sessions.forEach((s, i) => { s.displayName = titles[i] ? splitTitle(s.name) : s.name; });

  return { sessions, report };
}

// ---------------------------------------------------------------- Students

const STUDENT_COLS = ['Timestamp', 'Email Address', 'Name (FIRST LAST)', 'Preferred Name', 'Grade'];

/** Straightens curly quotes and collapses line breaks so two sheets can agree. */
const flatten = s => key(s)
  .replace(/[‘’ʼ]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * The short title at the front of a long name: everything before the first dash,
 * colon, bracket or line break. The same session is usually written out twice,
 * each time with a different tail:
 *   Sessions.csv  "Harbor Mural Project – Designing and painting a mural…"
 *   the form      "Harbor Mural Project" + a line break + the description
 * so the title is the only part the two sheets have in common.
 */
const splitTitle = s => String(s ?? '').split(/[\r\n–—]|\s-\s|:\s|\s\(|\s\[/)[0].trim();

/**
 * A trailing duration label, as in "Cycling (1 block)" / "Cycling (2 blocks)".
 * Deliberately narrow: only a block count counts as one, so "Studio (painting)"
 * and "Studio (sculpture)" stay two independent sessions.
 */
const DURATION_LABEL = /\s*\(\s*\d+\s*blocks?\s*\)\s*$/i;

/** The activity a session name names, with any duration label taken off. */
const activityOf = name => flatten(String(name ?? '').replace(DURATION_LABEL, ''));
const titleOf = s => flatten(splitTitle(s));

/**
 * Session index for a response column, tried in order of how certain each rule
 * is. The loose rules at the end only fire when exactly one session qualifies,
 * and they say what they did, because a wrong guess silently puts students in
 * the wrong room — far worse than refusing and asking.
 *
 * @param titles one per session, pre-computed, blank where the title is shared
 *   with another session and so cannot identify one on its own
 * @returns {{index: number, why: string}} index -1 when nothing fits
 */
function matchSession(header, sessions, titles) {
  const h = flatten(header);
  const ht = titleOf(header);
  const only = hits => (hits.length === 1 ? hits[0] : -1);
  let best = -1, bestLen = -1;

  // 1. The header begins with the whole session name. Longest wins, so
  //    "Art History [Room 14]" goes to Art History and not to Art.
  sessions.forEach((s, i) => {
    const n = flatten(s.name);
    if (n && h.startsWith(n) && n.length > bestLen) { best = i; bestLen = n.length; }
  });
  if (best !== -1) return { index: best, why: '' };

  // 2. Staff said outright which column this is.
  const stated = only(sessions.flatMap((s, i) => (s.surveyColumn && h.startsWith(flatten(s.surveyColumn)) ? [i] : [])));
  if (stated !== -1) return { index: stated, why: '' };

  // 3. The header begins with the session's short title.
  titles.forEach((t, i) => {
    if (t && ht.startsWith(t) && t.length > bestLen) { best = i; bestLen = t.length; }
  });
  if (best !== -1) return { index: best, why: '' };

  // 4. The other way round: the session name begins with the header's title,
  //    because someone shortened it on the form. Only when it points at one
  //    session. The title, not the whole header, or the form's description of
  //    the question would stop it ever lining up.
  const shortened = only(sessions.flatMap((s, i) => (ht && flatten(s.name).startsWith(ht) ? [i] : [])));
  if (shortened !== -1) {
    return { index: shortened, why: `is a shortened form of the session "${sessions[shortened].name}"` };
  }

  // 5. A spelling slip between the two sheets.
  const typo = only(sessions.flatMap((s, i) =>
    (isTypo(h, flatten(s.name)) || (titles[i] && isTypo(ht, titles[i])) ? [i] : [])));
  if (typo !== -1) {
    return { index: typo, why: `looks like a misspelling of the session "${sessions[typo].name}"` };
  }

  return { index: -1, why: '' };
}

/** Short titles, blanked out wherever two sessions would share one. */
/**
 * Gives every session an `exclusionGroup`. Sessions whose names are the same
 * once a trailing duration label is removed share one, because they are a
 * single activity offered at two lengths and nobody should be put in both.
 * Every other session is alone in its group, so the solver rule stays uniform:
 * at most one placement per group per student.
 *
 * Duplicate session names are already an error by the time this runs, so two
 * sessions can only share a group by having had a label stripped.
 */
function assignExclusionGroups(sessions, report) {
  const byActivity = new Map();
  sessions.forEach((s, i) => {
    const a = activityOf(s.name);
    if (!byActivity.has(a)) byActivity.set(a, []);
    byActivity.get(a).push(i);
  });
  let g = 0;
  for (const members of byActivity.values()) {
    for (const i of members) sessions[i].exclusionGroup = g;
    if (members.length > 1) {
      const names = members.map(i => `"${sessions[i].name}"`).join(' and ');
      const labels = members
        .map(i => (sessions[i].name.match(DURATION_LABEL) || [''])[0].trim())
        .filter(Boolean)
        .join(' and ');
      report.warn(`${names} are being treated as one activity offered at different lengths, because their names are identical apart from the block count in brackets: ${labels}. No student will be placed in more than one of them. If they are genuinely separate sessions, rename one so the names differ by more than the bracket.`);
    }
    g++;
  }
}

function sessionTitles(sessions) {
  const titles = sessions.map(s => titleOf(s.name));
  const seen = new Map();
  for (const t of titles) seen.set(t, (seen.get(t) || 0) + 1);
  return titles.map(t => (seen.get(t) === 1 ? t : ''));
}

export function parseStudents(rows, sessions, report = new Report()) {
  const students = [], rejected = [];
  if (!rows.length) { report.error('Student responses file is empty.'); return { students, rejected, report }; }

  // Sessions claim their rating columns first, so correcting a typo in one of
  // the fixed columns below can never steal a column a session needs.
  const colToSession = new Map();
  const sessionToCol = new Map();
  const exactFixed = new Set(STUDENT_COLS.map(key));
  const titles = sessionTitles(sessions);
  const shown = h => (splitTitle(h).length < norm(h).length ? `${splitTitle(h)}…` : splitTitle(h));
  rows[0].forEach((h, i) => {
    const name = norm(h);
    if (!name || exactFixed.has(key(h))) return;
    const { index: si, why } = matchSession(name, sessions, titles);
    if (si === -1) return;
    if (sessionToCol.has(si)) {
      report.error(`Two columns both match the session "${sessions[si].name}": "${norm(rows[0][sessionToCol.get(si)])}" and "${name}".`);
      return;
    }
    if (why) {
      report.warn(`The survey column "${shown(name)}" ${why}, so they have been paired up. Make the two sheets agree, or fill in the "Survey Column" column in the sessions file, to stop this warning.`);
    }
    sessionToCol.set(si, i);
    colToSession.set(i, si);
  });

  const head = matchHeaders(rows[0], STUDENT_COLS, report, 'Student responses file', new Set(colToSession.keys()));
  for (const c of ['Email Address', 'Name (FIRST LAST)']) {
    if (head.at(c) === undefined) report.error(`Student responses file is missing the "${c}" column.`);
  }
  warnUnclaimed(rows[0], new Set([...head.claimed, ...colToSession.keys()]), report, 'Student responses');

  const spare = rows[0]
    .map((h, i) => (norm(h) && !colToSession.has(i) && !head.claimed.has(i) ? shown(h) : ''))
    .filter(Boolean);
  const leftovers = spare.length
    ? ` The columns it could not place are: ${spare.map(t => `"${t}"`).join(', ')}.`
    : '';
  sessions.forEach((s, i) => {
    if (sessionToCol.has(i)) return;
    if (!titles[i]) {
      // Its short title belongs to more than one session, so matching on the
      // title would be a coin toss. Say so instead of guessing.
      report.error(`Session "${s.name}" has no matching column in the student responses file, and more than one session starts with "${splitTitle(s.name)}", so that is not enough to tell them apart. Give the survey column a header that begins with the full session name.`);
      return;
    }
    report.error(`Session "${s.name}" has no matching column in the student responses file. Either rename one of the two so the survey column starts with "${splitTitle(s.name)}", or put the survey column's exact heading in a "Survey Column" column in the sessions file.${leftovers}`);
  });
  if (report.errors.length) return { students, rejected, report };

  const tsCol = head.at('Timestamp');
  const byEmail = new Map();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r], at = `Student responses row ${r + 1}`;
    const email = cell(row, head.at('Email Address'));
    const fullName = cell(row, head.at('Name (FIRST LAST)'));
    if (!email && !fullName) continue;
    if (!isEmail(email)) {
      rejected.push({ email, name: fullName, grade: '', reason: `"${email}" is not a valid email address` });
      continue;
    }

    let preferred = cell(row, head.at('Preferred Name'));
    if (!preferred) {
      preferred = firstChunk(fullName);
    } else if (preferred.includes('@')) {
      report.warn(`${at}: Preferred Name looked like an email address, using "${firstChunk(fullName)}" instead.`);
      preferred = firstChunk(fullName);
    }
    if (!preferred) preferred = email.split('@')[0];

    let grade = cell(row, head.at('Grade'));
    if (grade && !['9', '10', '11', '12'].includes(grade)) {
      report.warn(`${at}: Grade "${grade}" is not 9, 10, 11 or 12; leaving the grade off this schedule.`);
      grade = '';
    }

    const ratings = new Map();
    let bad = null;
    for (const [ci, si] of colToSession) {
      const v = cell(row, ci);
      if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 5) {
        bad = v === ''
          ? `Blank rating for "${sessions[si].name}"`
          : `Rating "${v}" for "${sessions[si].name}" is not between 1 and 5`;
        break;
      }
      ratings.set(si, Number(v));
    }
    if (bad) { rejected.push({ email, name: preferred, grade, reason: bad }); continue; }

    const student = {
      email, fullName, name: preferred, grade, ratings,
      respondent: true, timestamp: cell(row, tsCol),
    };
    const prev = byEmail.get(key(email));
    if (!prev) { byEmail.set(key(email), student); continue; }
    report.warn(`${email} answered the survey more than once; keeping the latest submission.`);
    // Later row wins on a tie, so a re-submission without a Timestamp column still works.
    if ((student.timestamp || '') >= (prev.timestamp || '')) byEmail.set(key(email), student);
  }

  students.push(...byEmail.values());
  return { students, rejected, report };
}

// ---------------------------------------------------------- Non-respondents

export function parseNonRespondents(rows, students, report = new Report()) {
  const nonRespondents = [];
  if (!rows.length) return { nonRespondents, report };

  const head = matchHeaders(rows[0], ['Email Address', 'Name (FIRST LAST)'], report, 'Non-respondents file');
  if (head.at('Email Address') === undefined) {
    report.error('Non-respondents file is missing the "Email Address" column.');
    return { nonRespondents, report };
  }
  warnUnclaimed(rows[0], head.claimed, report, 'Non-respondents');
  const have = new Set(students.map(s => key(s.email)));
  const seen = new Set();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r], at = `Non-respondents row ${r + 1}`;
    const email = cell(row, head.at('Email Address'));
    if (!email) continue;
    if (!isEmail(email)) { report.error(`${at}: "${email}" is not a valid email address.`); continue; }
    if (have.has(key(email))) {
      report.warn(`${email} is in both the responses and the non-respondents file; using their survey answers.`);
      continue;
    }
    if (seen.has(key(email))) {
      report.warn(`${email} is listed twice in the non-respondents file; scheduling them once.`);
      continue;
    }
    seen.add(key(email));

    let fullName = cell(row, head.at('Name (FIRST LAST)'));
    if (!fullName) {
      fullName = email.split('@')[0];
      report.warn(`${at}: no name given, using "${fullName}" from the email address.`);
    }
    nonRespondents.push({
      email, fullName, name: firstChunk(fullName), grade: '',
      ratings: null, respondent: false,
    });
  }
  return { nonRespondents, report };
}

// --------------------------------------------------------------- Overrides

export const OVERRIDE_TYPES = ['Pin', 'Exclude', 'Free'];

export function parseOverrides(rows, sessions, students, report = new Report()) {
  const overrides = [];
  if (!rows.length) return { overrides, report };

  const head = matchHeaders(rows[0], ['Email Address', 'Type', 'Session Name', 'Block', 'Note'], report, 'Overrides file');
  if (head.at('Email Address') === undefined || head.at('Type') === undefined) {
    report.error('Overrides file needs at least an "Email Address" and a "Type" column.');
    return { overrides, report };
  }
  warnUnclaimed(rows[0], head.claimed, report, 'Overrides');
  const byEmail = new Map(students.map(s => [key(s.email), s]));
  const bySession = new Map(sessions.map((s, i) => [key(s.name), i]));
  const seen = new Set();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r], at = `Overrides row ${r + 1}`;
    const email = cell(row, head.at('Email Address'));
    if (!email) continue;

    const typeRaw = cell(row, head.at('Type'));
    const type = OVERRIDE_TYPES.find(t => t.toLowerCase() === key(typeRaw));
    if (!type) { report.error(`${at}: Type must be Pin, Exclude or Free, got "${typeRaw}".`); continue; }
    if (!byEmail.has(key(email))) {
      report.error(`${at}: "${email}" is not a student in either input file.`);
      continue;
    }

    const sessionName = cell(row, head.at('Session Name'));
    const blockRaw = cell(row, head.at('Block')).toUpperCase();
    const note = cell(row, head.at('Note'));
    let sessionIndex = null, block = null;

    if (type === 'Free') {
      if (!BLOCKS.includes(blockRaw)) {
        report.error(`${at}: a Free override needs a single Block letter A-D, got "${blockRaw}".`);
        continue;
      }
      block = BLOCKS.indexOf(blockRaw);
    } else {
      if (!bySession.has(key(sessionName))) {
        report.error(`${at}: "${sessionName}" is not a session name in the sessions file.`);
        continue;
      }
      sessionIndex = bySession.get(key(sessionName));
      if (type === 'Pin' && blockRaw) {
        if (!BLOCKS.includes(blockRaw)) {
          report.error(`${at}: Block must be A, B, C or D, got "${blockRaw}".`);
          continue;
        }
        block = BLOCKS.indexOf(blockRaw);
        const s = sessions[sessionIndex];
        if (!s.starts.includes(block)) {
          report.error(`${at}: "${s.name}" does not start in block ${blockRaw}. It starts in ${s.starts.map(b => BLOCKS[b]).join(', ')}.`);
          continue;
        }
      }
    }

    const sig = [key(email), type, sessionIndex, block].join('|');
    if (seen.has(sig)) { report.warn(`${at}: duplicate override, merged.`); continue; }
    seen.add(sig);
    overrides.push({ email: byEmail.get(key(email)).email, type, sessionIndex, block, note });
  }
  return { overrides, report };
}

/** Overrides back to CSV rows, so the editor can round-trip to Overrides.csv. */
export function overridesToRows(overrides, sessions) {
  return [
    ['Email Address', 'Type', 'Session Name', 'Block', 'Note'],
    ...overrides.map(o => [
      o.email,
      o.type,
      o.sessionIndex === null ? '' : sessions[o.sessionIndex].name,
      o.block === null ? '' : BLOCKS[o.block],
      o.note || '',
    ]),
  ];
}
