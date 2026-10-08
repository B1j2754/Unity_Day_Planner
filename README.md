# Unity Day Planner

Assigns every student to a Unity Day session for each of the four blocks, based
on how they rated the sessions in the survey.

**It runs entirely in your browser.** No files are uploaded anywhere, there is
no server and no database. Close the tab and nothing is kept.

## Using it

1. Open the site.
2. Drop in **Sessions** and **Student responses** (`.csv` or `.xlsx`). Add
   **Non-respondents** and **Overrides** if you have them. Starting from
   scratch? The page links blank templates for all four, and
   [templates/README.md](templates/README.md) explains every column.
3. Press **Generate schedules**. It takes a few seconds for a small day, up to
   about a minute for a thousand students.
4. Read the numbers and the warnings. Fix anybody who needs fixing in the
   Overrides table, then press **Re-generate with overrides**.
5. Download:
   - `unity-day_mail-merge.xlsx` — feed this to the Outlook Power Automate flow.
   - `unity-day_schedules.zip` — one PNG per student, named after their email.
   - `unity-day_unplaced.csv` — anyone who needs placing by hand.
   - `Overrides.csv` — **download this if you made any overrides.** The page
     keeps nothing between visits, so this file is the only way to get the same
     result next time.

[templates/README.md](templates/README.md) is the short guide to the input
files. `spec_sheet.md` is the full rulebook behind it.

## Running it locally

```sh
npm run serve      # then open http://localhost:8080
```

A plain static file server is all it needs — it will not work from `file://`,
because browsers block ES modules and workers there.

## Developing

```sh
npm test           # 44 tests, node's built-in runner, no framework
```

See [AGENTS.md](AGENTS.md) for the layout and the rules. The short version:
no build step, no backend, nothing leaves the browser, and
`css/components.css` is the only place styles live.

## Deploying

Push to `main`. `.github/workflows/pages.yml` runs the tests and publishes the
repo root to GitHub Pages. Enable it once under **Settings → Pages** with the
source set to **GitHub Actions**.

## How the matching works

A single integer program over every student at once, solved by
[HiGHS](https://highs.dev/) compiled to WebAssembly (`vendor/highs.wasm`).
Ratings become weights that double each step (`1→1, 2→2, 3→4, 4→8, 5→16`), so a
5 is worth sixteen 1s, and the solver maximises the total. Same inputs always
give the same schedules.

The spec allows falling back to local search if the solver is too slow. It
isn't: 1000 students across 24–40 sessions solves in well under a minute, so
there is no second solver to maintain.

## Contact

Benjamin Clark — b1j2754@gmail.com
