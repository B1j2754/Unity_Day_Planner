import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, scenario } from './helpers.js';
import {
  MAIL_MERGE_COLUMNS, mailMergeRows, unplacedRows, scheduleRows, scheduleHTML, toCSV,
} from '../js/output.js';

test('the mail merge has exactly the three contract columns, one row per scheduled student', () => {
  const r = run({ nonrespondents: 'nonrespondents.csv' });
  const rows = mailMergeRows(r.students, r.assignments, r.sessions);
  assert.equal(rows.length, r.assignments.size);
  assert.equal(rows.length, 8, 'includes the non-respondents');
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), MAIL_MERGE_COLUMNS);
    assert.match(row.Schedule_HTML, /^<table/);
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

test('the schedule HTML escapes anything odd in a session name', () => {
  const sessions = [{ name: 'Fun & <Games>', location: 'Room "1"', organizer: 'Dana', email: '', length: 1, starts: [0] }];
  const got = new Map([[0, { sessionIndex: 0, start: 0 }]]);
  const html = scheduleHTML(scheduleRows(got, sessions));
  assert.ok(html.includes('Fun &amp; &lt;Games&gt;'));
  assert.ok(html.includes('Room &quot;1&quot;'));
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
