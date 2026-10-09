import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, scenario } from './helpers.js';
import { parseCSV } from '../js/parse.js';
import {
  MAIL_MERGE_COLUMNS, mailMergeRows, unplacedRows, scheduleRows, scheduleText, toCSV,
  STAFF_MAIL_MERGE_COLUMNS, rosters, rosterText, staffMailMergeRows, listedName,
  sheetKind, readMergeSheet, searchDirectory,
} from '../js/output.js';

test('the mail merge has exactly the three contract columns, one row per scheduled student', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  const rows = mailMergeRows(r.students, r.assignments, r.sessions);
  assert.equal(rows.length, r.assignments.size);
  assert.equal(rows.length, 8, 'includes the non-respondents');
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), MAIL_MERGE_COLUMNS);
    assert.match(row.Schedule_Text, /^UNITY DAY SCHEDULE/);
  }
});

test('unplaced students are left out of the mail merge', () => {
  const r = run({ sessions: 'sessions-oversubscribed.csv', nonrespondents: 'nonrespondents.csv' });
  const emails = new Set(mailMergeRows(r.students, r.assignments, r.sessions).map(x => x.Email));
  assert.equal(emails.size, 6);
  for (const u of r.unplaced) assert.ok(!emails.has(u.email), `${u.email} should be left out`);
});

test('the zip would hold one <email>.png per scheduled student', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  const names = [...r.assignments.keys()].map(e => `${e}.png`);
  assert.equal(new Set(names).size, 8);
  assert.ok(names.includes('gus.hall@example.edu.png'));
});

test('the unplaced CSV has the five spec columns and a partial schedule', () => {
  const r = run({ sessions: 'sessions-oversubscribed.csv', nonrespondents: 'nonrespondents.csv' });
  const rows = unplacedRows(r.unplaced, r.rejected, r.sessions);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]), ['Email', 'Name', 'Grade', 'Reason', 'Partial Schedule']);
  assert.ok(rows.some(x => x['Partial Schedule'].length > 0), 'whatever blocks were filled');
  assert.match(toCSV(rows).split('\r\n')[0], /^Email,Name,Grade,Reason,"?Partial Schedule/);
});

test('rejected rows are listed alongside unplaced students', () => {
  const r = run({ responses: 'rating-blank.csv' });
  const rows = unplacedRows(r.unplaced, r.rejected, r.sessions);
  assert.ok(rows.some(x => x.Reason.startsWith('Blank rating')), JSON.stringify(rows));
});

test('a multi-block session shows as one merged row, and a free block says Free', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv', overrides: 'overrides.csv' });
  const ada = scheduleRows(r.assignments.get('ada.byron@example.edu'), r.sessions);
  assert.deepEqual(ada.map(x => x.blocks), ['A–C', 'D']);
  assert.equal(ada[0].session, 'Robotics Demo');

  const cy = scheduleRows(r.assignments.get('cy.diaz@example.edu'), r.sessions);
  assert.equal(cy.at(-1).session, 'Free');
  assert.equal(cy.at(-1).blocks, 'D');
});

test('a schedule reads as short stacked lines, not a wide table', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  for (const row of mailMergeRows(r.students, r.assignments, r.sessions)) {
    const lines = row.Schedule_Text.split('\r\n');
    assert.equal(lines[0], 'UNITY DAY SCHEDULE');
    // Students read these on a phone, so nothing may depend on column
    // alignment and no line may be wide enough to wrap badly.
    for (const l of lines) assert.ok(l.length <= 48, `too wide for a phone: "${l}"`);
    assert.ok(!row.Schedule_Text.includes('|'), 'no table borders');
    assert.ok(!/[–—·]/.test(row.Schedule_Text), 'plain ASCII punctuation only');
    // One BLOCK heading per distinct slot in that student's day.
    const slots = scheduleRows(r.assignments.get(row.Email), r.sessions).length;
    assert.equal(lines.filter(l => l.startsWith('BLOCK ')).length, slots);
  }
});

test('a free block says Free, and a multi-block session shows its range', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv', overrides: 'overrides.csv' });
  const rows = mailMergeRows(r.students, r.assignments, r.sessions);
  const cy = rows.find(x => x.Email.startsWith('cy.diaz'));
  assert.ok(cy.Schedule_Text.includes('BLOCK D\r\n  Free'), cy.Schedule_Text);
  const ada = rows.find(x => x.Email.startsWith('ada.byron'));
  assert.ok(ada.Schedule_Text.includes('BLOCK A-C'), ada.Schedule_Text);
});

test('CSV quoting survives commas, quotes and newlines', () => {
  const csv = toCSV([{ A: 'x,y', B: 'he said "hi"', C: 'one\ntwo' }]);
  assert.equal(csv, 'A,B,C\r\n"x,y","he said ""hi""","one\ntwo"\r\n');
});

test('a schedule shows the short title, not the whole descriptive session name', () => {
  const r = run({ sessions: 'sessions-long-names.csv', responses: 'responses-long-names.csv' });
  const rows = scheduleRows(r.assignments.get('ada.byron@example.edu'), r.sessions);
  const names = rows.map(x => x.session).sort();
  assert.deepEqual(names, ['Art', 'Chess Club', 'Harbor Mural Project', 'Robotics Demo']);
  for (const n of names) assert.ok(n.length < 40, `"${n}" is too long for a schedule sheet`);
});

test('the full name is kept when a short title would be ambiguous', () => {
  const { sessions } = scenario({ sessions: 'sessions-title-collision.csv', responses: null });
  assert.deepEqual(sessions.map(s => s.displayName), ['Studio – painting', 'Studio – sculpture']);
});

// --------------------------------------------------------- staff rosters

test('one roster per organizer, covering everything they run all day', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  const orgs = rosters(r.students, r.assignments, r.sessions);

  // Pottery's organizer has no email in the fixture, so there is nowhere to
  // send their roster and they are left out on purpose.
  const withEmail = new Set(r.sessions.filter(s => s.email).map(s => s.email.toLowerCase()));
  assert.equal(orgs.length, withEmail.size);
  for (const o of orgs) assert.ok(withEmail.has(o.email.toLowerCase()));
  assert.ok(!orgs.some(o => o.runs.some(x => x.session.name === 'Pottery')));

  // Every run of every session they own, with the students placed in it.
  for (const o of orgs) {
    const mine = r.sessions.filter(s => s.email === o.email);
    assert.equal(o.runs.length, mine.reduce((n, s) => n + s.starts.length, 0));
    assert.equal(o.studentCount, o.runs.reduce((n, x) => n + x.students.length, 0));
    for (const x of o.runs) assert.ok(x.students.length <= x.session.capacity);
  }
});

test('a roster lists exactly the students the solver placed in that run', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  for (const o of rosters(r.students, r.assignments, r.sessions)) {
    for (const x of o.runs) {
      const expected = r.students.filter(s => {
        const got = r.assignments.get(s.email);
        return got && [...got.values()].some(v => v.sessionIndex === r.sessions.indexOf(x.session) && v.start === x.start);
      });
      assert.deepEqual(
        x.students.map(s => s.email).sort(),
        expected.map(s => s.email).sort(),
        `${x.session.name} block ${x.start}`,
      );
    }
  }
});

test('the staff mail merge has the six contract columns, one row per organizer', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  const orgs = rosters(r.students, r.assignments, r.sessions);
  const rows = staffMailMergeRows(orgs);
  assert.equal(rows.length, orgs.length);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), STAFF_MAIL_MERGE_COLUMNS);
    assert.match(row.Roster_Text, /^UNITY DAY ROSTER - /);
    assert.ok(row.Email.includes('@'));
    assert.ok(row.Sessions.length > 0);
    assert.match(row.Blocks, /^[ABCD](, [ABCD])*$/);
    assert.equal(typeof row.Student_Count, 'number');
  }
  // The plain-text columns are what the flow puts in the subject line.
  const total = rows.reduce((n, x) => n + x.Student_Count, 0);
  assert.ok(total > 0);
});

test('a roster names students surname-first and keeps the register in order', () => {
  assert.equal(listedName('Ada Byron'), 'Byron, Ada');
  assert.equal(listedName('Mary Jane Watson'), 'Watson, Mary Jane');
  assert.equal(listedName('Prince'), 'Prince');
  assert.equal(listedName(''), '');

  const r = run({ nonrespondents: 'nonrespondents.csv' });
  for (const o of rosters(r.students, r.assignments, r.sessions)) {
    for (const x of o.runs) {
      const names = x.students.map(s => listedName(s.fullName).toLowerCase());
      assert.deepEqual(names, [...names].sort(), `${x.session.name} is out of order`);
    }
  }
});

test('a roster shows the blocks the organizer is free, and keeps empty runs', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  for (const o of rosters(r.students, r.assignments, r.sessions)) {
    const busy = new Set(o.runs.flatMap(x => x.blocks));
    for (const b of o.free) assert.ok(!busy.has(b), 'a free block is one they do not run in');
    assert.equal(o.free.length + busy.size, 4);
    // An empty run is still listed; the adult standing in the room needs to know.
    assert.ok(o.runs.every(x => Array.isArray(x.students)));
  }
  const text = rosterText(rosters(r.students, r.assignments, r.sessions)[0]);
  assert.ok(/ \d+ of \d+/.test(text), 'each section shows filled of capacity');
});

test('a roster is an aligned register, and says when a run is empty', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  for (const org of rosters(r.students, r.assignments, r.sessions)) {
    const text = rosterText(org);
    assert.ok(text.startsWith(`UNITY DAY ROSTER - ${org.name}`));
    assert.ok(!/[–—·]/.test(text), 'plain ASCII punctuation only');
    for (const x of org.runs) {
      if (x.students.length) {
        // A register is read in columns, so this one does line up. Teachers
        // print it or read it on a laptop, unlike the student schedules.
        for (const s of x.students) assert.ok(text.includes(s.email), `${s.email} missing`);
      } else {
        assert.ok(text.includes('(nobody in this one)'));
      }
    }
  }
});

// ------------------------------------------- reading a merge sheet back in

/** The two sheets, written and then parsed exactly as the lookup page does. */
function roundTrip(opts = { nonrespondents: 'nonrespondents.csv' }) {
  const r = run(opts);
  const orgs = rosters(r.students, r.assignments, r.sessions);
  return {
    r,
    student: readMergeSheet(parseCSV(toCSV(mailMergeRows(r.students, r.assignments, r.sessions)))),
    staff: readMergeSheet(parseCSV(toCSV(staffMailMergeRows(orgs)))),
  };
}

test('each merge sheet is recognised by its own text column', () => {
  assert.equal(sheetKind(MAIL_MERGE_COLUMNS), 'student');
  assert.equal(sheetKind(STAFF_MAIL_MERGE_COLUMNS), 'staff');
  assert.equal(sheetKind(['Email', 'Name']), null);
  assert.equal(sheetKind([]), null);
  assert.equal(sheetKind(), null);
  // Stray whitespace and extra columns are what a sheet looks like after
  // someone has opened it in Excel, and must still be recognised.
  assert.equal(sheetKind([' Schedule_Text ', 'Notes']), 'student');
});

test('a written mail merge reads back as the same people', () => {
  const { r, student, staff } = roundTrip();
  assert.equal(student.kind, 'student');
  assert.equal(student.people.length, r.assignments.size);
  assert.deepEqual(student.people.map(p => p.email).sort(), [...r.assignments.keys()].sort());
  assert.equal(staff.kind, 'staff');
  assert.equal(staff.people.length, rosters(r.students, r.assignments, r.sessions).length);
});

test('a read-back record carries the text and the facts worth showing', () => {
  const { student, staff } = roundTrip();
  const ada = student.people.find(p => p.email === 'ada.byron@example.edu');
  assert.equal(ada.name, 'Ada Byron');
  assert.match(ada.text, /^UNITY DAY SCHEDULE/);
  assert.ok(ada.text.includes('BLOCK '), ada.text);
  assert.deepEqual(ada.meta, [['Grade', '11']]);

  const org = staff.people[0];
  assert.match(org.text, /^UNITY DAY ROSTER - /);
  assert.deepEqual(org.meta.map(([k]) => k), ['Sessions', 'Blocks', 'Students']);
});

test('rows with no email are skipped, since nothing identifies them', () => {
  const rows = [['Email', 'Name', 'Grade', 'Schedule_Text'], ['', 'Nobody', '9', 'x'], ['a@b.c', 'Someone', '9', 'y']];
  assert.deepEqual(readMergeSheet(rows).people.map(p => p.email), ['a@b.c']);
});

test('a sheet that is neither merge file yields nothing rather than guessing', () => {
  const { kind, people } = readMergeSheet([['Session Name', 'Location'], ['Archery', 'Field']]);
  assert.equal(kind, null);
  assert.deepEqual(people, []);
  assert.deepEqual(readMergeSheet([]), { kind: null, people: [] });
  assert.deepEqual(readMergeSheet(), { kind: null, people: [] });
});

test('search ranks a whole email first, and caps how much it returns', () => {
  const { student } = roundTrip();
  const people = student.people;
  assert.deepEqual(searchDirectory(people, 'ada.byron@example.edu').map(p => p.email), ['ada.byron@example.edu']);
  assert.deepEqual(searchDirectory(people, 'Ada').map(p => p.email), ['ada.byron@example.edu']);
  // A shared domain matches everybody, so the cap is what keeps the page usable.
  assert.equal(searchDirectory(people, 'example.edu').length, people.length);
  assert.equal(searchDirectory(people, 'example.edu', 3).length, 3);
  assert.deepEqual(searchDirectory(people, ''), []);
  assert.deepEqual(searchDirectory(people, '   '), []);
  assert.deepEqual(searchDirectory(people, 'nobody at all'), []);
});

test('search never matches on the body of a schedule, only on who someone is', () => {
  const { student } = roundTrip();
  // "BLOCK" is in every schedule; matching it would hand back the whole school.
  assert.deepEqual(searchDirectory(student.people, 'BLOCK'), []);
  assert.deepEqual(searchDirectory(student.people, 'UNITY DAY'), []);
});

test('students and session leaders search as one directory', () => {
  const { student, staff } = roundTrip();
  const both = [...student.people, ...staff.people];
  const kinds = new Set(searchDirectory(both, 'example', 100).map(p => p.kind));
  assert.deepEqual([...kinds].sort(), ['staff', 'student']);
});

