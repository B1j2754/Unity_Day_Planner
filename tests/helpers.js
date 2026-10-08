import { readFileSync } from 'node:fs';
import loadHighs from '../vendor/highs.mjs';
import {
  Report, parseCSV, parseSessions, parseStudents, parseNonRespondents, parseOverrides,
} from '../js/parse.js';
import { solve } from '../js/solve.js';

const dir = new URL('./fixtures/', import.meta.url);

export const fixture = name => parseCSV(readFileSync(new URL(name, dir), 'utf8'));

export const highs = await loadHighs();

/** Parses a set of fixtures the way the app does, keeping one shared report. */
export function scenario({
  sessions: sessionsFile = 'sessions.csv',
  responses = 'responses.csv',
  nonrespondents = null,
  overrides = null,
} = {}) {
  const report = new Report();
  const { sessions } = parseSessions(fixture(sessionsFile), report);
  const { students: respondents, rejected } = responses
    ? parseStudents(fixture(responses), sessions, report)
    : { students: [], rejected: [] };
  const { nonRespondents } = nonrespondents
    ? parseNonRespondents(fixture(nonrespondents), respondents, report)
    : { nonRespondents: [] };
  const students = [...respondents, ...nonRespondents];
  const { overrides: ovs } = overrides
    ? parseOverrides(fixture(overrides), sessions, students, report)
    : { overrides: [] };
  return { sessions, students, rejected, overrides: ovs, report };
}

/** scenario() + solve(), with the parse and solve reports merged. */
export function run(opts = {}) {
  const s = scenario(opts);
  const out = solve({ highs, sessions: s.sessions, students: s.students, overrides: s.overrides, report: s.report });
  return { ...s, ...out, report: s.report };
}

/** Does any message mention this text? Keeps assertions readable. */
export const says = (list, text) => list.some(m => m.toLowerCase().includes(text.toLowerCase()));

/** Shuffles the data rows, leaving the first `keep` rows (headers, description) alone. */
export function shuffle(rows, { keep = 1, seed = 7 } = {}) {
  const head = rows.slice(0, keep);
  const rest = rows.slice(keep);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...head, ...rest];
}
