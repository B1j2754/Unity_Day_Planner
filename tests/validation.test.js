// One case per input-validation bullet in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, says, scenario } from './helpers.js';
import { BLOCKS, Report, parseCSV, parseSessions, parseStudents, parseNonRespondents, parseOverrides } from '../js/parse.js';

const sessionsOf = name => {
  const report = new Report();
  const { sessions } = parseSessions(fixture(name), report);
  return { sessions, report };
};

// ------------------------------------------------------------------ sessions

test('capacity must be a whole number above zero', () => {
  for (const f of ['bad-capacity.csv', 'zero-capacity.csv']) {
    const { report } = sessionsOf(f);
    assert.ok(says(report.errors, 'Max Students Per Session'), `${f}: ${report.errors}`);
  }
});

test('block letters must be A-D and must not repeat', () => {
  assert.ok(says(sessionsOf('bad-block-letter.csv').report.errors, 'may only contain A, B, C or D'));
  assert.ok(says(sessionsOf('duplicate-block-letter.csv').report.errors, 'same letter twice'));
});

test('length must be 1-4', () => {
  assert.ok(says(sessionsOf('bad-length.csv').report.errors, 'must be 1, 2, 3 or 4'));
});

test('start blocks must fit the length', () => {
  assert.ok(says(sessionsOf('overlapping-starts.csv').report.errors, 'overlap or run past block D'));
  assert.ok(says(sessionsOf('past-d-starts.csv').report.errors, 'overlap or run past block D'));
});

test('empty Blocks: a 1-block session runs three times, the other lengths are unchanged', () => {
  const { sessions, report } = sessionsOf('empty-blocks.csv');
  assert.deepEqual(report.errors, []);
  const starts = Object.fromEntries(sessions.map(s => [s.name, s.starts.map(b => BLOCKS[b]).join('')]));
  // Solo sits out whichever block was fullest; Duo, Trio and Quad cannot run
  // three times, so their defaults stand.
  assert.deepEqual(starts, { Solo: 'BCD', Duo: 'AC', Trio: 'A', Quad: 'A' });
  assert.equal(sessions.find(s => s.name === 'Solo').sitsOut, BLOCKS.indexOf('A'));
});

test('spelling out ABCD still means all four blocks', () => {
  const rows = fixture('empty-blocks.csv');
  rows.find(r => r[0] === 'Solo')[5] = 'ABCD';
  const report = new Report();
  const { sessions } = parseSessions(rows, report);
  assert.deepEqual(report.errors, [], report.errors.join('\n'));
  const solo = sessions.find(s => s.name === 'Solo');
  assert.deepEqual(solo.starts.map(b => BLOCKS[b]), ['A', 'B', 'C', 'D']);
  assert.equal(solo.blocksBlank, false, 'an explicit value is never trimmed');
});

test('the block each blank session sits out balances the seats across the day', () => {
  const { sessions } = sessionsOf('sessions.csv');
  const seats = BLOCKS.map(() => 0);
  for (const s of sessions) {
    for (const start of s.starts) for (let i = 0; i < s.length; i++) seats[start + i] += s.capacity;
  }
  // Before spreading, block B held twice what A did. Now nothing is far out.
  assert.ok(Math.max(...seats) - Math.min(...seats) <= 3, `seats were ${seats}`);
  for (const s of sessions.filter(x => x.blocksBlank)) {
    assert.equal(s.starts.length, 3, `${s.name} should run three times`);
    assert.ok(!s.starts.includes(s.sitsOut));
  }
});

test('a missing description row is a warning, not a lost session', () => {
  const { sessions, report } = sessionsOf('no-description-row.csv');
  assert.equal(sessions.length, 1);
  assert.ok(says(report.warnings, 'no description row'));
});

test('the description row is skipped when it is there', () => {
  const { sessions, report } = sessionsOf('sessions.csv');
  assert.equal(sessions.length, 6);
  assert.ok(!says(report.warnings, 'no description row'));
});

// ------------------------------------------------------------------ students

test('a session with no matching response column is an error', () => {
  const { sessions } = sessionsOf('sessions.csv');
  const report = new Report();
  parseStudents(fixture('responses-missing-column.csv'), sessions, report);
  assert.ok(says(report.errors, 'has no matching column'), report.errors.join('\n'));
});

test('the longest matching session name wins, so Art and Art History both resolve', () => {
  const { sessions } = sessionsOf('sessions-prefix.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('responses-prefix-ok.csv'), sessions, report);
  assert.deepEqual(report.errors, []);
  const art = sessions.findIndex(s => s.name === 'Art');
  const hist = sessions.findIndex(s => s.name === 'Art History');
  assert.equal(students[0].ratings.get(art), 4);
  assert.equal(students[0].ratings.get(hist), 2);
});

test('two columns matching the same session is an error', () => {
  const { sessions } = sessionsOf('sessions-prefix.csv');
  const report = new Report();
  parseStudents(fixture('responses-prefix-collision.csv'), sessions, report);
  assert.ok(says(report.errors, 'Two columns both match'), report.errors.join('\n'));
});

test('a rating outside 1-5, or blank, rejects that student', () => {
  const { sessions } = sessionsOf('sessions.csv');
  for (const [f, text] of [['rating-out-of-range.csv', 'is not between 1 and 5'], ['rating-blank.csv', 'Blank rating']]) {
    const { students, rejected } = parseStudents(fixture(f), sessions, new Report());
    assert.equal(students.length, 0, f);
    assert.equal(rejected.length, 1, f);
    assert.ok(rejected[0].reason.includes(text), `${f}: ${rejected[0].reason}`);
  }
});

test('a Preferred Name with an @ falls back to the first name', () => {
  const { sessions } = sessionsOf('sessions.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('preferred-name-email.csv'), sessions, report);
  assert.equal(students[0].name, 'Ada');
  assert.ok(says(report.warnings, 'looked like an email address'));
});

test('a grade outside 9-12 is dropped with a warning, not a rejection', () => {
  const { sessions } = sessionsOf('sessions.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('grade-out-of-range.csv'), sessions, report);
  assert.equal(students.length, 1);
  assert.equal(students[0].grade, '');
  assert.ok(says(report.warnings, 'is not 9, 10, 11 or 12'));
});

test('a duplicate email keeps the latest submission', () => {
  const { sessions } = sessionsOf('sessions.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('duplicate-email.csv'), sessions, report);
  assert.equal(students.length, 1);
  assert.equal(students[0].name, 'Addy');
  assert.ok(says(report.warnings, 'more than once'));
});

// ----------------------------------------------------------- non-respondents

test('an email in both files uses the survey answers; duplicates and blank names warn', () => {
  const { sessions } = sessionsOf('sessions.csv');
  const respondents = parseStudents(fixture('responses.csv'), sessions, new Report()).students;
  const report = new Report();
  const { nonRespondents } = parseNonRespondents(fixture('nonrespondents-overlap.csv'), respondents, report);
  assert.deepEqual(nonRespondents.map(s => s.email), ['gus.hall@example.edu']);
  assert.equal(nonRespondents[0].name, 'gus.hall');
  assert.ok(says(report.warnings, 'in both the responses and the non-respondents'));
  assert.ok(says(report.warnings, 'listed twice'));
  assert.ok(says(report.warnings, 'using "gus.hall" from the email address'));
});

// --------------------------------------------------------------- overrides

const overrideErrors = file => scenario({ nonrespondents: 'nonrespondents.csv', overrides: file }).report.errors;

test('an override for an unknown email is an error', () => {
  assert.ok(says(overrideErrors('ov-unknown-email.csv'), 'is not a student in either input file'));
});

test('a Pin on a block the session does not start in is an error', () => {
  assert.ok(says(overrideErrors('ov-bad-start-block.csv'), 'does not start in block B'));
});

test('a valid override file parses with no errors', () => {
  const s = scenario({ nonrespondents: 'nonrespondents.csv', overrides: 'overrides.csv' });
  assert.deepEqual(s.report.errors, []);
  assert.equal(s.overrides.length, 3);
});

test('exact duplicate override rows are merged with a warning', () => {
  const s = scenario({ overrides: 'ov-duplicate.csv' });
  assert.equal(s.overrides.length, 1);
  assert.ok(says(s.report.warnings, 'duplicate override'));
});

test('unrecognised columns are ignored with a warning', () => {
  const rows = fixture('responses.csv');
  rows[0].push('Favourite Colour');
  const { sessions } = sessionsOf('sessions.csv');
  const report = new Report();
  parseStudents(rows, sessions, report);
  assert.ok(says(report.warnings, 'Ignoring unrecognised'));
});

test('an invalid organizer email is dropped with a warning', () => {
  const rows = fixture('sessions.csv');
  rows[2][2] = 'not-an-email';
  const report = new Report();
  const { sessions } = parseSessions(rows, report);
  assert.equal(sessions.find(s => s.name === 'Archery').email, '');
  assert.ok(says(report.warnings, 'is not a valid email address'));
});

// ---------------------------------------------------------------- templates

const template = name => parseCSV(readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8'));

test('the Sessions template uses the exact headers the parser looks for', () => {
  const report = new Report();
  const { sessions } = parseSessions(template('Sessions.csv'), report);
  assert.equal(sessions.length, 0, 'a template holds no sessions');
  assert.ok(!says(report.errors, 'is missing the'), report.errors.join('\n'));
  assert.ok(!says(report.warnings, 'has no'), report.warnings.join('\n'));
  assert.ok(!says(report.warnings, 'Ignoring unrecognised'), report.warnings.join('\n'));
  assert.ok(!says(report.warnings, 'no description row'), 'row 2 must read as the description row');
});

test('the other templates use the exact headers their parsers look for', () => {
  const { sessions } = sessionsOf('sessions.csv');

  const studentReport = new Report();
  parseStudents(template('StudentResponses.csv'), sessions, studentReport);
  // Only the two placeholder session columns should go unrecognised.
  assert.equal(studentReport.warnings.filter(w => w.includes('Ignoring unrecognised')).length, 2);
  assert.ok(!says(studentReport.errors, 'is missing the'), studentReport.errors.join('\n'));

  const nonRep = new Report();
  const { nonRespondents } = parseNonRespondents(template('NonRespondents.csv'), [], nonRep);
  assert.deepEqual(nonRep.errors, []);
  assert.equal(nonRespondents.length, 0);

  const ovRep = new Report();
  const { overrides } = parseOverrides(template('Overrides.csv'), sessions, [], ovRep);
  assert.deepEqual(ovRep.errors, []);
  assert.equal(overrides.length, 0);
});

test('a blank "Can be Randomly Assigned?" means Yes', () => {
  const { sessions, report } = sessionsOf('blank-random.csv');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    Object.fromEntries(sessions.map(s => [s.name, s.canRandom])),
    { Archery: true, 'Chess Club': false, Pottery: true },
  );
});

test('a bad sessions file reports every problem, not just the first', () => {
  const { sessions, report } = sessionsOf('many-errors.csv');
  // One error per bad row, so the "every problem" panel has something to show.
  assert.equal(report.errors.length, 5, report.errors.join('\n'));
  assert.equal(sessions.length, 0);
  assert.ok(says(report.warnings, 'Ignoring unrecognised'));
  for (const row of [3, 4, 5, 6, 7]) {
    assert.ok(says(report.errors, `Sessions row ${row}:`), `row ${row} missing`);
  }
});

// ------------------------------------------------------- near-miss headers

test('a misspelled header is still read, with a warning naming both spellings', () => {
  const { sessions, report } = sessionsOf('typo-headers.csv');
  assert.deepEqual(report.errors, []);
  assert.equal(sessions.length, 1);
  // The three typo'd columns still reach the schedules.
  assert.equal(sessions[0].organizer, 'Dana Reed');
  assert.equal(sessions[0].email, 'dana.reed@example.org');
  assert.equal(sessions[0].location, 'Field');
  assert.ok(says(report.warnings, 'reading the column "Session Organizer Contact Email Adress" as "Session Organizer Contact Email Address"'));
  assert.ok(says(report.warnings, 'reading the column "Session Organiser Name" as "Session Organizer Name"'));
  assert.ok(says(report.warnings, 'reading the column "Locaton" as "Location"'));
  // A column that is genuinely something else is still left alone.
  assert.ok(says(report.warnings, 'Ignoring unrecognised Sessions column "Notes"'));
});

test('a session column is never stolen by a near-miss fixed column', () => {
  const { sessions } = sessionsOf('sessions-grade-lookalike.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('responses-grade-lookalike.csv'), sessions, report);
  assert.deepEqual(report.errors, []);
  assert.equal(students[0].grade, '11', '"Grade" is the grade');
  assert.equal(students[0].ratings.get(0), 4, '"Grades" is the session rating');
  assert.ok(!says(report.warnings, 'reading the column'), report.warnings.join('\n'));
});

// ----------------------------------------------- long names / short titles

test('a session and its survey column match on the short title when the tails differ', () => {
  const { sessions } = sessionsOf('sessions-long-names.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('responses-long-names.csv'), sessions, report);
  assert.deepEqual(report.errors, [], report.errors.join('\n'));
  assert.deepEqual(report.warnings, [], report.warnings.join('\n'));

  // Sessions.csv says "Harbor Mural Project – Designing and painting…",
  // the form says "Harbor Mural Project" then a line break and the description.
  const mural = sessions.findIndex(s => s.name.startsWith('Harbor Mural Project'));
  const robotics = sessions.findIndex(s => s.name.startsWith('Robotics Demo'));
  const chess = sessions.findIndex(s => s.name === 'Chess Club');
  const art = sessions.findIndex(s => s.name === 'Art');
  assert.ok(mural >= 0 && robotics >= 0);
  assert.deepEqual(
    [mural, robotics, chess, art].map(i => students[0].ratings.get(i)),
    [5, 4, 3, 2],
  );
});

test('two sessions sharing a short title refuse to guess, and say why', () => {
  const { sessions } = sessionsOf('sessions-title-collision.csv');
  const report = new Report();
  parseStudents(fixture('responses-title-collision.csv'), sessions, report);
  assert.equal(report.errors.length, 2);
  for (const e of report.errors) {
    assert.ok(e.includes('more than one session starts with "Studio"'), e);
    assert.ok(e.includes('full session name'), e);
  }
});

test('the full session name still beats the short title', () => {
  // "Art History [Room 14]" must not fall back to the session "Art".
  const { sessions } = sessionsOf('sessions-prefix.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('responses-prefix-ok.csv'), sessions, report);
  assert.deepEqual(report.errors, []);
  assert.equal(students[0].ratings.get(sessions.findIndex(s => s.name === 'Art')), 4);
  assert.equal(students[0].ratings.get(sessions.findIndex(s => s.name === 'Art History')), 2);
});

// -------------------------------------- sheets that name sessions differently

test('a shortened or misspelled survey column is paired up, and says so', () => {
  const { sessions } = sessionsOf('sessions-mismatched.csv');
  const report = new Report();
  parseStudents(fixture('responses-mismatched.csv'), sessions, report);

  // "Board Games" -> "Board Games & Puzzles", and friends.
  assert.ok(says(report.warnings, 'is a shortened form of the session "Board Games & Puzzles"'));
  assert.ok(says(report.warnings, 'is a shortened form of the session "Growing Up in Eastfield during'));
  // "Knitting Circle" -> "Kniting Circle", "Sculpture Workshop" -> "Scuplture Workshop".
  assert.ok(says(report.warnings, 'looks like a misspelling of the session "Kniting Circle"'));
  assert.ok(says(report.warnings, 'looks like a misspelling of the session "Scuplture Workshop"'));

  // The four that are genuinely different names are refused, not guessed at.
  assert.equal(report.errors.length, 4, report.errors.join('\n'));
  for (const name of ['Museum Visit', 'Choir Info Sessions', 'Learn About Rocks', 'Watch classic silent']) {
    assert.ok(says(report.errors, `Session "${name}`), name);
  }
  assert.ok(says(report.errors, 'put the survey column\'s exact heading in a "Survey Column" column'));
});

test('"Survey Column" settles the ones no rule should guess', () => {
  const { sessions } = sessionsOf('sessions-survey-column.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('responses-mismatched.csv'), sessions, report);
  assert.deepEqual(report.errors, [], report.errors.join('\n'));
  assert.equal(students[0].ratings.size, 8, 'every session found its column');
  const at = name => students[0].ratings.get(sessions.findIndex(s => s.name.startsWith(name)));
  assert.equal(at('Museum Visit'), 1);        // column "Grade 10 Museum Visit"
  assert.equal(at('Choir Info Sessions'), 3); // column "EHS Choir Tour 2030"
  assert.equal(at('Watch classic'), 3);       // column "Classic Silent Films"
});

test('"Name" and "Email" are accepted for the longer official headings', () => {
  const { sessions } = sessionsOf('sessions-survey-column.csv');
  const report = new Report();
  const { students } = parseStudents(fixture('responses-mismatched.csv'), sessions, report);
  assert.equal(students[0].fullName, 'Ada Byron');
  assert.equal(students[0].email, 'ada.byron@example.edu');
  assert.ok(says(report.warnings, 'reading the column "Name" as "Name (FIRST LAST)"'));
});
