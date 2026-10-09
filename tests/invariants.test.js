// The scheduling invariants from the spec, checked on every result, plus the
// conflicting-override cases and determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highs, run, scenario, says, shuffle, fixture } from './helpers.js';
import { Report, parseSessions, parseStudents, parseNonRespondents, parseOverrides, overridesToRows } from '../js/parse.js';
import { checkInvariants, exclusionGroups, solve } from '../js/solve.js';

const WITH_EVERYTHING = { nonrespondents: 'nonrespondents.csv', overrides: 'overrides.csv' };

/** The whole invariant list, run against one result. */
function ok(r) {
  assert.deepEqual(r.report.errors, [], r.report.errors.join('\n'));
  const bad = checkInvariants(r);
  assert.deepEqual(bad, [], bad.join('\n'));
  return r;
}

test('a plain run satisfies every invariant and schedules everyone', () => {
  const r = ok(run());
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.metrics.fullyScheduledPct, 100);
});

test('non-respondents are scheduled alongside respondents, never into a "No" session', () => {
  const r = ok(run({ nonrespondents: 'nonrespondents.csv' }));
  assert.equal(r.metrics.nonRespondentsScheduled, 2);
  assert.equal(r.unplaced.length, 0);
});

test('pins, excludes and free blocks are all honoured at once', () => {
  const r = ok(run(WITH_EVERYTHING));
  assert.equal(r.metrics.overridesApplied, 3);

  const ada = r.assignments.get('ada.byron@example.edu');
  const robotics = r.sessions.findIndex(s => s.name === 'Robotics Demo');
  for (const b of [0, 1, 2]) assert.equal(ada.get(b).sessionIndex, robotics, 'pinned to Robotics A-C');

  const chess = r.sessions.findIndex(s => s.name === 'Chess Club');
  const bo = r.assignments.get('bo.chen@example.edu');
  assert.ok(![...bo.values()].some(s => s.sessionIndex === chess), 'excluded from Chess Club');

  const cy = r.assignments.get('cy.diaz@example.edu');
  assert.equal(cy.get(3), undefined, 'block D is free');
  assert.ok(!r.unplaced.some(u => u.email === 'cy.diaz@example.edu'), 'a free block is not unplaced');
});

test('a free block counts as fully scheduled in the metrics', () => {
  const r = run(WITH_EVERYTHING);
  assert.equal(r.metrics.fullyScheduledPct, 100);
});

test('running twice on the same input gives an identical result', () => {
  const a = run(WITH_EVERYTHING), b = run(WITH_EVERYTHING);
  assert.equal(digest(a), digest(b));
});

test('shuffling the rows of any input file gives an identical result', () => {
  const base = digest(run(WITH_EVERYTHING));
  const files = {
    sessions: shuffle(fixture('sessions.csv'), { keep: 2 }),
    responses: shuffle(fixture('responses.csv')),
    nonrespondents: shuffle(fixture('nonrespondents.csv')),
    overrides: shuffle(fixture('overrides.csv')),
  };
  for (const [which, rows] of Object.entries(files)) {
    const report = new Report();
    const { sessions } = parseSessions(which === 'sessions' ? rows : fixture('sessions.csv'), report);
    const { students: resp } = parseStudents(which === 'responses' ? rows : fixture('responses.csv'), sessions, report);
    const { nonRespondents } = parseNonRespondents(which === 'nonrespondents' ? rows : fixture('nonrespondents.csv'), resp, report);
    const students = [...resp, ...nonRespondents];
    const { overrides } = parseOverrides(which === 'overrides' ? rows : fixture('overrides.csv'), sessions, students, report);
    const r = solve({ highs, sessions, students, overrides, report });
    assert.equal(digest({ ...r, sessions }), base, `shuffling ${which} changed the result`);
  }
});

test('overrides from the editor survive a round trip through Overrides.csv', () => {
  const direct = run(WITH_EVERYTHING);
  const rows = overridesToRows(direct.overrides, direct.sessions);
  const report = new Report();
  const { overrides } = parseOverrides(rows, direct.sessions, direct.students, report);
  assert.deepEqual(report.errors, []);
  const again = solve({ highs, sessions: direct.sessions, students: direct.students, overrides, report: new Report() });
  assert.equal(digest({ ...again, sessions: direct.sessions }), digest(direct));
});

test('an over-subscribed day still schedules everyone who fits', () => {
  const r = run({ sessions: 'sessions-oversubscribed.csv', nonrespondents: 'nonrespondents.csv' });
  assert.deepEqual(r.report.errors, []);
  assert.deepEqual(checkInvariants(r), []);
  // The two non-respondents can only use two of the six sessions, so they
  // cannot fill four blocks. Everyone else still gets a full schedule.
  assert.equal(r.unplaced.length, 2);
  assert.equal(r.metrics.scheduled, 6);
  for (const u of r.unplaced) assert.match(u.reason, /No open seat in block/);
});

test('a block with fewer seats than students is reported before solving', () => {
  const r = run({ sessions: 'sessions-short-block.csv', nonrespondents: 'nonrespondents.csv' });
  assert.ok(says(r.report.errors, 'Block D has 1 seats but 8 students'), r.report.errors.join('\n'));
});

test('higher ratings are preferred', () => {
  const r = run();
  assert.ok(r.metrics.avgRating >= 3.5, `average rating was ${r.metrics.avgRating}`);
});

// -------------------------------------------------- conflicting overrides

const conflict = file => run({ overrides: file }).report.errors;

test('a Pin and an Exclude on the same session is an error', () => {
  assert.ok(says(conflict('ov-pin-and-exclude.csv'), 'both pinned to and excluded from'));
});

test('a Pin and a Free on the same block is an error', () => {
  assert.ok(says(conflict('ov-pin-and-free.csv'), 'marked Free for block B'));
});

test('two Pins whose runs overlap is an error', () => {
  assert.ok(says(conflict('ov-pin-overlap.csv'), 'at the same time'));
});

test('more Pins on one run than it holds is an error, and says to raise the capacity', () => {
  const errors = conflict('ov-over-capacity.csv');
  assert.ok(says(errors, 'only holds 3'), errors.join('\n'));
  assert.ok(says(errors, 'Raise "Max Students Per Session"'));
});

test('a Pin can put a non-respondent in a session marked No', () => {
  const s = scenario({ nonrespondents: 'nonrespondents.csv' });
  const robotics = s.sessions.findIndex(x => x.name === 'Robotics Demo');
  const overrides = [{ email: 'gus.hall@example.edu', type: 'Pin', sessionIndex: robotics, block: 0, note: '' }];
  const r = solve({ highs, ...s, overrides, report: new Report() });
  assert.deepEqual(checkInvariants({ ...s, overrides, ...r }), []);
  assert.equal(r.assignments.get('gus.hall@example.edu').get(0).sessionIndex, robotics);
});

// ------------------------------- one activity, two lengths

const DURATION = { sessions: 'sessions-duration-pair.csv', responses: 'responses-duration-pair.csv' };

test('sessions named only by a differing block count share an exclusion group', () => {
  const { sessions, report } = scenario(DURATION);
  const groups = exclusionGroups(sessions).map(g => [...g].map(i => sessions[i].name).sort());
  const cycling = groups.find(g => g.length > 1);
  assert.deepEqual(cycling, ['Cycling (1 block)', 'Cycling (2 blocks)']);
  // A parenthetical that is not a block count is a real difference in the
  // activity, so those sessions stay independent and a student may take both.
  assert.equal(groups.length, 4, JSON.stringify(groups));
  assert.ok(groups.some(g => g.length === 1 && g[0] === 'Studio (painting)'));
  assert.ok(groups.some(g => g.length === 1 && g[0] === 'Studio (sculpture)'));
  // The guess is never silent.
  assert.ok(says(report.warnings, 'identical apart from the block count in brackets'));
  assert.ok(says(report.warnings, '(1 block) and (2 blocks)'));
});

test('nobody is placed in two sessions that are one activity at two lengths', () => {
  const r = run(DURATION);
  assert.deepEqual(checkInvariants(r), []);
  for (const st of r.students) {
    const names = [...new Set([...r.assignments.get(st.email).values()]
      .map(v => r.sessions[v.sessionIndex].name))];
    const cycling = names.filter(n => n.startsWith('Cycling'));
    assert.equal(cycling.length, 1, `${st.email} got ${cycling.join(' + ')}`);
  }
  // Both studios in one day is fine: different activities, not two lengths.
  const cy = [...r.assignments.get('cy.diaz@example.edu').values()]
    .map(v => r.sessions[v.sessionIndex].name);
  assert.ok(cy.includes('Studio (painting)') && cy.includes('Studio (sculpture)'));
});

test('a student rated both lengths top marks still only gets one of them', () => {
  // ada rates both 5 and everything else 1, so without the group constraint the
  // solver would hand her both. Checked by mutation: it does.
  const r = run(DURATION);
  const slots = [...r.assignments.get('ada.byron@example.edu').values()];
  assert.equal(slots.filter(v => r.sessions[v.sessionIndex].name.startsWith('Cycling')).length, 1);
});

test('pinning a student to both lengths is reported, not silently dropped', () => {
  const s = scenario({ ...DURATION, overrides: 'ov-duration-conflict.csv' });
  const r = solve({ highs, ...s, report: s.report });
  assert.ok(says(s.report.errors, 'one activity at two different lengths'), JSON.stringify(s.report.errors));
  assert.ok(says(s.report.errors, 'Cycling (1 block)'));
  assert.ok(says(s.report.errors, 'Cycling (2 blocks)'));
  assert.ok(r, 'the run still returns a result rather than throwing');
});

/** A stable string for the whole result, so two runs can be compared exactly. */
function digest({ assignments, unplaced, sessions }) {
  const lines = [...assignments.keys()].sort().map(email => {
    const got = assignments.get(email);
    const slots = [0, 1, 2, 3].map(b => {
      const s = got.get(b);
      return s ? `${sessions[s.sessionIndex].name}@${s.start}` : 'free';
    });
    return `${email}: ${slots.join(' | ')}`;
  });
  return [...lines, ...unplaced.map(u => `UNPLACED ${u.email}: ${u.reason}`).sort()].join('\n');
}
