// Validated data -> assignments. No DOM: the tests import this in node and the
// browser runs it inside js/solver.worker.js.
//
// One integer program over every student at once, respondents and
// non-respondents together, so non-respondents are never stuck with whatever
// seats are left over. The usual case is a single solve: "every student fills
// every block, now make them as happy as possible". Only a day that genuinely
// cannot fill everyone falls back to the two-stage solve the spec describes.

import { BLOCKS, Report, key } from './parse.js';

/** Rating -> weight. Each step doubles, because students spike their favourites. */
export const RATING_WEIGHTS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

// Everything in the objective is a whole number so the solve is exact: weights
// are scaled up and the non-respondent tie-breaker lives in the digits below,
// where it can never outweigh a real one-step rating difference.
const SCALE = 1000;

// ponytail: each student only competes for their best TOP_OPTIONS sessions.
// They only need four, so the answer is the same in practice while the model is
// several times smaller — 1000 students drops from ~35s to ~9s. If anyone ends
// up unplaced we throw the result away and redo it with every option open, so
// this can cost a little optimality but never a schedule. Raise it if the
// matches ever come out tighter than they should be.
const TOP_OPTIONS = 10;

const SEED = 20260101;
export const SOLVE_TIME_LIMIT_S = 300;

/** FNV-1a. Only used to spread non-respondents deterministically. */
function hash(str) {
  let h = 0x811c9dc5 ^ SEED;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/** One run of a session: the session, its start block, and the blocks it covers. */
export function buildRuns(sessions) {
  const runs = [];
  sessions.forEach((s, sessionIndex) => {
    for (const start of s.starts) {
      runs.push({
        sessionIndex, start, length: s.length, capacity: s.capacity,
        blocks: Array.from({ length: s.length }, (_, i) => start + i),
      });
    }
  });
  return runs;
}

const NO_OVERRIDES = { pins: [], excluded: new Set(), free: new Set() };

/** Overrides grouped per student, with the conflicts the spec calls errors. */
function collectOverrides(overrides, sessions, runs, report) {
  const byStudent = new Map();
  const get = email => {
    const k = key(email);
    if (!byStudent.has(k)) byStudent.set(k, { pins: [], excluded: new Set(), free: new Set() });
    return byStudent.get(k);
  };
  for (const o of overrides) {
    const g = get(o.email);
    if (o.type === 'Pin') g.pins.push(o);
    else if (o.type === 'Exclude') g.excluded.add(o.sessionIndex);
    else g.free.add(o.block);
  }

  const pinsPerRun = new Map();
  for (const [who, g] of byStudent) {
    for (const p of g.pins) {
      const name = sessions[p.sessionIndex].name;
      if (g.excluded.has(p.sessionIndex)) {
        report.error(`${who} is both pinned to and excluded from "${name}". Remove one of the two overrides.`);
      }
      const options = runs.filter(r => r.sessionIndex === p.sessionIndex && (p.block === null || r.start === p.block));
      if (!options.some(r => !r.blocks.some(b => g.free.has(b)))) {
        const blocks = [...g.free].sort().map(b => BLOCKS[b]).join(', ');
        report.error(`${who} is pinned to "${name}" but is marked Free for block ${blocks}, which is when it runs. Remove one of the two overrides.`);
        continue;
      }
      if (p.block !== null) {
        const rk = `${p.sessionIndex}|${p.block}`;
        pinsPerRun.set(rk, (pinsPerRun.get(rk) || 0) + 1);
      }
    }
    // Two pins on one session would put the student in it twice.
    const perSession = new Map();
    for (const p of g.pins) perSession.set(p.sessionIndex, (perSession.get(p.sessionIndex) || 0) + 1);
    for (const [si, n] of perSession) {
      if (n > 1) report.error(`${who} is pinned to "${sessions[si].name}" more than once. A student cannot take the same session twice.`);
    }
    // Pins with an explicit block that collide in time.
    const fixed = g.pins.filter(p => p.block !== null);
    for (let i = 0; i < fixed.length; i++) {
      for (let j = i + 1; j < fixed.length; j++) {
        const a = sessions[fixed[i].sessionIndex], b = sessions[fixed[j].sessionIndex];
        const aEnd = fixed[i].block + a.length - 1, bEnd = fixed[j].block + b.length - 1;
        if (fixed[i].block <= bEnd && fixed[j].block <= aEnd) {
          report.error(`${who} is pinned to both "${a.name}" and "${b.name}" at the same time. Remove one of the two overrides.`);
        }
      }
    }
  }

  for (const [rk, n] of pinsPerRun) {
    const [si, start] = rk.split('|').map(Number);
    const s = sessions[si];
    if (n > s.capacity) {
      report.error(`"${s.name}" starting in block ${BLOCKS[start]} has ${n} students pinned to it but only holds ${s.capacity}. Raise "Max Students Per Session" in the sessions file, or remove some pins.`);
    }
  }
  return byStudent;
}

/** Does every block have enough seats for everyone? The usual cause of unplaced students. */
function checkSeats(students, runs, report) {
  for (let b = 0; b < BLOCKS.length; b++) {
    const seats = runs.filter(r => r.blocks.includes(b)).reduce((n, r) => n + r.capacity, 0);
    if (seats < students.length) {
      report.error(`Block ${BLOCKS[b]} has ${seats} seats but ${students.length} students — ${students.length - seats} of them cannot be placed. Add a session or raise a capacity.`);
    }
  }
}

/**
 * @param {object} args
 * @param args.highs loaded highs-js runtime
 * @returns {{assignments: Map, unplaced: object[], metrics: object|null, report: Report}}
 */
export function solve({ highs, sessions, students: input, overrides = [], report = new Report() }) {
  // Sorted by email so input row order can never change the answer.
  const students = [...input].sort((a, b) => (key(a.email) < key(b.email) ? -1 : 1));
  const runs = buildRuns(sessions);
  const ov = collectOverrides(overrides, sessions, runs, report);
  checkSeats(students, runs, report);
  if (report.errors.length) return { assignments: new Map(), unplaced: [], metrics: null, report };

  const ctx = { highs, sessions, students, runs, ov };
  let out = attempt(ctx, TOP_OPTIONS, new Report());
  // The shortlist is only a speed trick. If it cost anybody a schedule, redo
  // the whole thing with every option open and keep that answer instead.
  if (out.pruned && out.unplaced.length) out = attempt(ctx, Infinity, new Report());

  report.errors.push(...out.report.errors);
  report.warnings.push(...out.report.warnings);
  return {
    assignments: out.assignments,
    unplaced: out.unplaced,
    metrics: metrics(students, out.assignments, overrides, out.unplaced),
    report,
  };
}

/** Builds and solves the program with each student limited to `limit` sessions. */
function attempt({ highs, sessions, students, runs, ov }, limit, report) {
  const cols = [];                               // {si, ri}
  const colOf = students.map(() => new Map());   // student -> run -> column
  const costLen = [], costSat = [], lower = [];
  let pruned = false;

  students.forEach((st, si) => {
    const g = ov.get(key(st.email)) || NO_OVERRIDES;
    const pinnedSessions = new Set(g.pins.map(p => p.sessionIndex));

    // What is this student allowed in, and how much do they want it?
    const want = new Map();                      // sessionIndex -> weight
    sessions.forEach((s, j) => {
      if (g.excluded.has(j)) return;
      if (!st.respondent && !s.canRandom && !pinnedSessions.has(j)) return;
      want.set(j, st.respondent
        ? RATING_WEIGHTS[st.ratings.get(j)] * SCALE
        // No ratings to go on, so spread them instead of filling the first
        // session alphabetically. Always below one rating step.
        : hash(`${st.email}|${s.name}`) % SCALE);
    });

    let allowed = want;
    if (want.size > limit) {
      pruned = true;
      const best = [...want].sort((a, b) => b[1] - a[1] || (key(sessions[a[0]].name) < key(sessions[b[0]].name) ? -1 : 1));
      allowed = new Map(best.slice(0, limit));
      for (const j of pinnedSessions) if (want.has(j)) allowed.set(j, want.get(j));
    }

    runs.forEach((r, ri) => {
      if (!allowed.has(r.sessionIndex)) return;
      if (r.blocks.some(b => g.free.has(b))) return;
      colOf[si].set(ri, cols.length);
      cols.push({ si, ri });
      costLen.push(r.length);
      costSat.push(allowed.get(r.sessionIndex));
      lower.push(g.pins.some(p => p.sessionIndex === r.sessionIndex && p.block === r.start) ? 1 : 0);
    });
  });

  const rows = [];                               // {lo, hi, idx}
  const fill = [];                               // row numbers of the per-block rows
  const colsFor = (si, pick) => [...colOf[si]].filter(([ri]) => pick(runs[ri])).map(([, c]) => c);
  const add = (lo, hi, idx) => {
    if (!idx.length) return -1;
    rows.push({ lo, hi, idx });
    return rows.length - 1;
  };

  students.forEach((st, si) => {
    const g = ov.get(key(st.email)) || NO_OVERRIDES;
    // Exactly one session per block to begin with, relaxed to "at most one"
    // only if that turns out to be impossible.
    for (let b = 0; b < BLOCKS.length; b++) {
      if (g.free.has(b)) continue;
      const i = add(1, 1, colsFor(si, r => r.blocks.includes(b)));
      if (i >= 0) fill.push(i);
    }
    // Never the same session twice.
    sessions.forEach((s, j) => {
      if (s.starts.length < 2) return;
      add(0, 1, colsFor(si, r => r.sessionIndex === j));
    });
    // A pin with no block: the solver picks the run, but it must pick one.
    for (const p of g.pins) {
      if (p.block === null) add(1, 1, colsFor(si, r => r.sessionIndex === p.sessionIndex));
    }
  });
  runs.forEach((r, ri) => {
    const idx = [];
    students.forEach((_, si) => { const c = colOf[si].get(ri); if (c !== undefined) idx.push(c); });
    add(0, r.capacity, idx);
  });

  const colValue = cols.length
    ? runSolver(highs, { rows, fill, costLen, costSat, lower }, report)
    : new Float64Array(0);

  // ---- read the answer back
  const assignments = new Map();   // email -> Map(block -> slot)
  cols.forEach((c, i) => {
    if (colValue[i] < 0.5) return;
    const st = students[c.si], r = runs[c.ri];
    if (!assignments.has(st.email)) assignments.set(st.email, new Map());
    const slot = { sessionIndex: r.sessionIndex, start: r.start };
    for (const b of r.blocks) assignments.get(st.email).set(b, slot);
  });

  const unplaced = [];
  for (const st of students) {
    const g = ov.get(key(st.email)) || NO_OVERRIDES;
    const got = assignments.get(st.email) || new Map();
    const missing = [];
    for (let b = 0; b < BLOCKS.length; b++) if (!g.free.has(b) && !got.has(b)) missing.push(BLOCKS[b]);
    if (missing.length) {
      unplaced.push({
        email: st.email, name: st.name, grade: st.grade,
        reason: `No open seat in block ${missing.join(', ')}`,
        partial: got,
      });
    }
  }
  for (const u of unplaced) assignments.delete(u.email);

  return { assignments, unplaced, pruned, report };
}

function runSolver(highs, { rows, fill, costLen, costSat, lower }, report) {
  const n = costSat.length;
  const starts = new Int32Array(rows.length + 1);
  let nnz = 0;
  rows.forEach((r, i) => { starts[i] = nnz; nnz += r.idx.length; });
  starts[rows.length] = nnz;
  const indices = new Int32Array(nnz);
  let k = 0;
  for (const r of rows) for (const c of r.idx) indices[k++] = c;

  const C = highs.constants.modelStatus;
  return highs.withModel({
    numCols: n, numRows: rows.length,
    sense: highs.constants.objectiveSense.maximize,
    colCost: Float64Array.from(costSat),
    colLower: Float64Array.from(lower),
    colUpper: new Float64Array(n).fill(1),
    rowLower: Float64Array.from(rows, r => r.lo),
    rowUpper: Float64Array.from(rows, r => r.hi),
    matrix: { format: 'csr', numRows: rows.length, numCols: n, starts, indices, values: new Float64Array(nnz).fill(1) },
    integrality: new Int32Array(n).fill(highs.constants.variableType.integer),
  }, model => {
    // Zero gaps: anything looser lets HiGHS stop early at a different answer on
    // a different day, and determinism is a hard requirement.
    model.options.set({
      output_flag: false, random_seed: SEED,
      mip_rel_gap: 0, mip_abs_gap: 0, time_limit: SOLVE_TIME_LIMIT_S,
    });

    model.run();
    if (model.getModelStatus() !== C.infeasible) return read(model, C, report, n);

    // Somebody cannot fill all four blocks. Let blocks go empty, maximise how
    // many get filled, lock that number in, then maximise satisfaction.
    for (const i of fill) model.changeRowBounds(i, 0, 1);
    model.changeColsCost({ kind: 'range', from: 0, to: n - 1 }, Float64Array.from(costLen));
    model.run();
    const st = model.getModelStatus();
    if (st === C.infeasible) {
      report.error('The overrides cannot all be satisfied at once. Remove some pins or Free blocks and try again.');
      return new Float64Array(n);
    }
    if (st !== C.optimal && st !== C.timeLimit) {
      report.error('The solver could not finish. Check the inputs, then contact the developer.');
      return new Float64Array(n);
    }
    model.addRow(Math.round(model.getObjectiveValue()), highs.infinity, {
      indices: Int32Array.from({ length: n }, (_, i) => i),
      values: Float64Array.from(costLen),
    });
    model.changeColsCost({ kind: 'range', from: 0, to: n - 1 }, Float64Array.from(costSat));
    model.run();
    return read(model, C, report, n);
  });
}

function read(model, C, report, n) {
  const st = model.getModelStatus();
  if (st === C.timeLimit) {
    report.warn(`The solver hit its ${SOLVE_TIME_LIMIT_S} second limit. Every schedule is valid, but the matches may not be the best possible.`);
  } else if (st !== C.optimal) {
    report.error('The solver could not finish. Check the inputs, then contact the developer.');
    return new Float64Array(n);
  }
  return Float64Array.from(model.getSolution().colValue);
}

function metrics(students, assignments, overrides, unplaced) {
  let ratingSum = 0, ratingCount = 0, high = 0, nonResp = 0;
  for (const st of students) {
    const got = assignments.get(st.email);
    if (!got) continue;
    if (!st.respondent) { nonResp++; continue; }
    for (const slot of new Set(got.values())) {
      const rating = st.ratings.get(slot.sessionIndex);
      ratingSum += rating; ratingCount++;
      if (rating >= 4) high++;
    }
  }
  return {
    students: students.length,
    scheduled: students.length - unplaced.length,
    fullyScheduledPct: students.length ? (100 * (students.length - unplaced.length)) / students.length : 0,
    avgRating: ratingCount ? ratingSum / ratingCount : 0,
    highRatingPct: ratingCount ? (100 * high) / ratingCount : 0,
    nonRespondentsScheduled: nonResp,
    overridesApplied: overrides.length,
  };
}

/** Every invariant from the spec, in one place. Returns a list of violations. */
export function checkInvariants({ sessions, students, overrides, assignments, unplaced }) {
  const bad = [];
  const runs = buildRuns(sessions);
  const seats = new Map();
  const freeOf = new Map(), pinOf = new Map(), excOf = new Map();
  for (const o of overrides) {
    const k = key(o.email);
    if (o.type === 'Free') { if (!freeOf.has(k)) freeOf.set(k, new Set()); freeOf.get(k).add(o.block); }
    if (o.type === 'Pin') { if (!pinOf.has(k)) pinOf.set(k, []); pinOf.get(k).push(o); }
    if (o.type === 'Exclude') { if (!excOf.has(k)) excOf.set(k, new Set()); excOf.get(k).add(o.sessionIndex); }
  }
  const unplacedEmails = new Set(unplaced.map(u => key(u.email)));

  for (const st of students) {
    const k = key(st.email);
    const got = assignments.get(st.email);
    const free = freeOf.get(k) || new Set();

    if (!!got === unplacedEmails.has(k)) {
      bad.push(`${st.email} is ${got ? 'both scheduled and' : 'neither scheduled nor'} listed as unplaced.`);
    }
    if (!got) continue;

    for (let b = 0; b < BLOCKS.length; b++) {
      if (free.has(b) && got.has(b)) bad.push(`${st.email} has a session in block ${BLOCKS[b]} but is marked Free.`);
      if (!free.has(b) && !got.has(b)) bad.push(`${st.email} has nothing in block ${BLOCKS[b]} but is not listed as unplaced.`);
    }

    const slots = new Set(got.values());
    const perSession = new Map();
    for (const slot of slots) {
      const run = runs.find(r => r.sessionIndex === slot.sessionIndex && r.start === slot.start);
      if (!run) { bad.push(`${st.email} is in a session run that does not exist.`); continue; }
      for (const b of run.blocks) {
        if (got.get(b) !== slot) {
          bad.push(`${st.email} is in "${sessions[slot.sessionIndex].name}" but not for all of blocks ${run.blocks.map(x => BLOCKS[x]).join(', ')}.`);
        }
      }
      perSession.set(slot.sessionIndex, (perSession.get(slot.sessionIndex) || 0) + 1);
      const rk = `${slot.sessionIndex}|${slot.start}`;
      seats.set(rk, (seats.get(rk) || 0) + 1);

      if (!st.respondent && !sessions[slot.sessionIndex].canRandom) {
        const pinnedHere = (pinOf.get(k) || []).some(p => p.sessionIndex === slot.sessionIndex);
        if (!pinnedHere) bad.push(`Non-respondent ${st.email} is in "${sessions[slot.sessionIndex].name}", which is marked No for random assignment.`);
      }
      if ((excOf.get(k) || new Set()).has(slot.sessionIndex)) {
        bad.push(`${st.email} is in "${sessions[slot.sessionIndex].name}" but is excluded from it.`);
      }
    }
    for (const [si, n] of perSession) {
      if (n > 1) bad.push(`${st.email} is in "${sessions[si].name}" ${n} times.`);
    }
    for (const p of pinOf.get(k) || []) {
      const ok = [...slots].some(s => s.sessionIndex === p.sessionIndex && (p.block === null || s.start === p.block));
      if (!ok) bad.push(`${st.email} is pinned to "${sessions[p.sessionIndex].name}" but was not placed there.`);
    }
  }

  for (const [rk, n] of seats) {
    const [si, start] = rk.split('|').map(Number);
    if (n > sessions[si].capacity) {
      bad.push(`"${sessions[si].name}" starting in block ${BLOCKS[start]} has ${n} students but holds ${sessions[si].capacity}.`);
    }
  }
  return bad;
}
