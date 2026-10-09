# Unity Day Planner — agent instructions

Read `spec_sheet.md` first. It is the human-written contract; this file is only
how to work in the repo. Where they disagree, `spec_sheet.md` wins.

## What this is

A static, single-page browser app that assigns students to Unity Day sessions.
No backend, no build step. Open `index.html` and it runs. Deployed to GitHub
Pages straight from the repo root.

## Hard rules

1. **Nothing leaves the browser.** No fetch to a third party, no analytics, no
   CDN at runtime — that is why `vendor/` is committed instead. Any feature
   that would send data off the user's machine needs Benjamin Clark
   (b1j2754@gmail.com) to say yes first.
2. **No real student data in the repo.** `tests/fixtures/` is generated or
   anonymized, and `templates/` holds blank headers only. If someone drops a
   real export in here, it does not get committed.
3. **No build step.** Plain ES modules, relative paths, no bundler, no
   transpile. If you reach for a bundler, you have taken a wrong turn.
4. **The Word mail-merge contracts are frozen.** Two templates, two files:
   `unity-day_mail-merge.csv` with `Email` / `Name` / `Full_Name` / `Grade` /
   `Schedule_Text` for students, and `unity-day_staff-mail-merge.csv` with
   `Email` / `Name` / `Roster_Text` / `Sessions` / `Blocks` / `Student_Count`
   for the adults running sessions. Changing any of those strings breaks a
   Word template someone already built.

   They are `.csv`, never `.xlsx`: Word truncates a merge field at 255
   characters when reading from Excel, and a roster is thousands. They carry a
   UTF-8 BOM so Word reads en dashes correctly. Student schedules are stacked
   plain text with no alignment, because students read them on phones; staff
   rosters are column-aligned and need a monospaced font in the template.
5. **Determinism.** Same inputs, same bytes out. All randomness is seeded
   (`js/solve.js` `hash()`), ties break on sorted email, HiGHS runs with
   `random_seed` fixed and zero MIP gap. Row order of an input file must never
   change the result.
6. **Never guess a student into the wrong room.** Where two sheets disagree,
   match only on evidence and report what you could not resolve. The one
   inference allowed is the duration pair: `Cycling (1 block)` and
   `Cycling (2 blocks)` are one activity, so they share an `exclusionGroup`
   and no student gets both. Only a trailing block count in brackets counts,
   and every pair found is warned about. Widening that rule needs a test
   showing it cannot swallow two genuinely different sessions.
7. **`npm test` must pass before you call anything done.**

## Layout

```
index.html         the app — upload / review / download
components.html    the UI component library, rendered. Look here before styling anything.
templates/         blank input files staff download from the page, plus the column-by-column guide
css/components.css the library itself: tokens + every component class
js/parse.js        CSV text -> validated sessions / students / overrides  (pure, no DOM)
js/solve.js        validated data -> assignments                          (pure, no DOM)
js/output.js       assignments -> merge rows, schedule/roster text, PNG, CSVs
js/app.js          all the DOM wiring. The only file that touches the page.
js/solver.worker.js  runs solve.js off the main thread
vendor/            highs (WASM solver), xlsx (SheetJS), fflate (zip). Committed on purpose.
tests/             node:test, no framework
```

`templates/*.csv` are the headers the parser actually looks for. Change a
column name in `js/parse.js` and you change it in the template and in
`templates/README.md` in the same commit, or staff get a file the app rejects.

`parse.js` and `solve.js` must stay DOM-free — the tests import them directly in
Node. Keep file reading (`File`, `XLSX`) in `app.js`.

## The UI component library

`css/components.css` is the single source of style. Rules:

- Every element on the page is a clone of something in there.
- You may **copy** styles and **add** new components. You may never delete one.
- A new component has to look like it belongs with what is already there — same
  tokens, same radii, same spacing scale.
- Add it to `components.html` in the same commit, or it does not exist.
- Native controls that look like 1998 by default (`button`, `input[type=file]`,
  `select`, checkboxes) are always custom styled.
- No component libraries, no frameworks, no "advanced" widgets. If a plain
  search input, dropdown, button or table genuinely cannot do the job, ask
  Benjamin before inventing one.
- Light and dark both have to look right. Dark is the default.
- Fonts and icons come from Google Fonts only (currently Inter + Material
  Symbols, both vendored-by-link in `index.html`'s `<head>`).

## Style of the code

Boring and short. The solver is the only genuinely hard part of this repo; keep
everything around it dull enough that a teacher could follow it next year.

- No abstraction with one caller. No config object for a value that never
  changes. No class where a function works.
- Tunable numbers live in one named constant at the top of their file
  (`RATING_WEIGHTS`, `SOLVE_TIME_LIMIT_S`). Do not scatter them.
- Deliberate shortcuts get a `ponytail:` comment naming the ceiling and the
  upgrade path, so the next person knows it was a choice.
- Error messages are plain English aimed at a staff member, not a developer.
  "Session 'Robotics' has no matching column in StudentResponses.csv" — not
  "KeyError: robotics".

## Tests

```
npm test
```

`node:test` + `node:assert`, run against `tests/fixtures/`. No framework, no
fixtures-as-code, no mocks.

- `tests/invariants.test.js` — the scheduling invariants from the spec, checked
  on every solve result. Add to `checkInvariants()` rather than writing a new
  bespoke assertion.
- `tests/validation.test.js` — one case per input-validation bullet in the spec.
  Each gets a fixture file and asserts on the exact error/warning.
- `tests/output.test.js` — mail-merge columns, zip naming, unplaced CSV.

When you change the solver, the invariants test is what proves you did not break
it. When you add a validation rule, it needs a fixture.

## Deploying

Push to `main`. `.github/workflows/pages.yml` uploads the repo root to GitHub
Pages as-is. There is nothing to build, so there is nothing to break. Enable
Pages once, with source "GitHub Actions".

## If things go wrong

Last resort, reach the main developer: Benjamin Clark, b1j2754@gmail.com.
