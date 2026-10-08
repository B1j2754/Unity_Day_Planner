# Templates

Blank starting files for the Unity Day Planner. Each one has the exact column
headers the app looks for — download it, fill in your rows underneath, and drop
it into the page.

Headers are matched with the spaces trimmed and upper/lower case ignored, so
`Email Address` and `email address ` are the same column. A small spelling slip
is forgiven too — `Email Adress` or `Session Organiser Name` are read as the
columns they were meant to be, and the app says so in the warnings. Anything it
genuinely does not recognise is ignored, also with a warning. Both `.csv` and
`.xlsx` work.

`spec_sheet.md` in the repo root is the full rulebook. This is the short version.

---

## Sessions.csv — required

One row per session. **Row 2 is the description row**: leave it there, the app
skips it. Your sessions start on row 3.

| Column | What goes in it |
|---|---|
| Session Name | Exactly as it should read on student schedules. Must match the start of that session's column in the responses file. |
| Session Organizer Name | The main adult running it. Any spelling. |
| Session Organizer Contact Email Address | Point of contact. Leave blank to keep any mention of an email off the schedules. |
| Location | Room number, or any instruction you want printed. |
| Max Students Per Session | Whole number above zero. **Per run, not per day** — a session in blocks A and C with capacity 20 holds 20 students in A and 20 different students in C. |
| Blocks | The letters a run *starts* in, e.g. `AC`. One run per letter. Leave blank for the default below. |
| Length of Session (in blocks) | `1`, `2`, `3` or `4`. |
| Can be Randomly Assigned? | `Yes` or `No` — may students who never filled in the survey be put here? **Leave it blank and it means `Yes`.** |
| Survey Column | Optional, and usually left empty. The exact heading of this session's column in the responses file, for when the two sheets name it too differently to pair up on their own. See below. |

**Leaving Blocks blank** lets the app choose:

| Length | Blank Blocks means | Runs |
|---|---|---|
| 1 | three of A, B, C, D, chosen for you | 3 runs, one block sat out |
| 2 | `AC` | A–B, C–D |
| 3 | `A` | A–C |
| 4 | `A` | A–D |

A 1-block session with Blocks left blank runs **three times, not four**. Only
length 1 has a choice to make — a 2-block session only fits two non-overlapping
runs in a day, and a 3- or 4-block session only fits one. If you want all four,
write `ABCD` in the cell.

Which block each one sits out is picked to keep the four blocks holding about
the same number of seats: sessions that named their own blocks are counted
first, then each blank one sits out whichever block is fullest so far. Big
sessions count for more than small ones, and the same files always give the same
answer. To decide for a particular session yourself, just fill its Blocks in.

If you do fill Blocks in, every run has to finish by block D and no two runs of
the same session may overlap. So `BC` at length 2 is rejected (B–C and C–D would
both want block C), and so is `D` at length 2 (it would run past the end of the
day).

---

## StudentResponses.csv — required

The Google Forms export, one row per student. You do not build this by hand; the
template is here to show the shape the app expects.

The first columns are fixed. **After them comes one column per session**, named
so that the header *begins* with that session's name from Sessions.csv —
anything you like may follow. `Archery [Field, 3rd period]` matches the session
`Archery`. Every student scores every session from 1 (least) to 5 (most), and no
score may be left blank.

In practice the two sheets rarely spell a session out the same way. The form
question carries its own description, and Sessions.csv carries a different one:

```
Sessions.csv   Harbor Mural Project – Designing and painting a mural…
the form       Harbor Mural Project
               Students sketch, plan and paint a corridor mural…
```

So the app also matches on the **short title**: everything up to the first dash,
colon, bracket or line break. Both of those shorten to `Harbor Mural Project`,
so they pair up. Curly apostrophes, straight apostrophes and stray line breaks
are all treated the same.

The full name is tried first, so `Art History [Room 14]` goes to `Art History`
and not to `Art`. If two sessions shorten to the *same* title — `Studio –
painting` and `Studio – sculpture` — the app refuses to guess and tells you to
spell the column out in full.

It will also pair up a column that is a **shortened** version of the session
name (`Board Games` for `Board Games & Puzzles`) or a **misspelling**
of it (`Sculpture Workshop` for `Scuplture Workshop`), as long as only one
session fits. Both come with a warning naming what it did, so you can check it.

### When the two sheets just call it different things

No rule can tell that `Watch classic silent films` and `Classic Silent Films`
are the same session, or that `Museum Visit` is `Grade 10 Museum Visit`.
Guessing would quietly put students in the wrong room, so the
app refuses and names the session.

Two ways out, and the first is better:

1. **Rename one of them** so the survey column starts with the session name.
   Then the sheets agree and anyone reading them can see why.
2. **Fill in `Survey Column`** in Sessions.csv with that session's exact heading
   from the responses file. Use this when the survey has already gone out and
   renaming is not an option.

| Column | What goes in it |
|---|---|
| Timestamp | Collected by the form. Used to pick the latest answer if someone submits twice. |
| Email Address | The student's unique ID. In the form, set `Settings > Defaults > Form defaults > Collect email addresses by default` to **Verified**. |
| Name (FIRST LAST) | Legal or school-accepted name. |
| Preferred Name | Whatever they want to be called. Anything with an `@` in it is thrown away and their first name is used instead. |
| Grade | `9`, `10`, `11` or `12`. Only printed on the schedule. |
| *one per session* | A whole number, 1 to 5. |

A row with a blank or out-of-range score is rejected and that student appears in
`unity-day_unplaced.csv` for you to sort out by hand.

---

## NonRespondents.csv — optional

Students who never answered the survey. They still get a full schedule, but only
into sessions marked `Yes` for "Can be Randomly Assigned?". Build this by hand or
paste it from any roster.

| Column | What goes in it |
|---|---|
| Email Address | Their school email. Used as the ID and for the PNG file names. |
| Name (FIRST LAST) | The first word becomes the name on their schedule. Leave it blank and the part of the email before the `@` is used instead, with a warning. |

If an email turns up in both this file and the responses file, their survey
answers win. No grade is collected, so the grade line is left off their schedule.

---

## Overrides.csv — optional

Manual exceptions, and they beat every other rule. You can also build these in
the page itself — the file is just the saved form of what the Overrides table
shows, and **Download Overrides** writes it back out.

The page keeps nothing between visits, so saving this file is the only way to
get the same result next time. Upload it alongside the others.

| Column | What goes in it |
|---|---|
| Email Address | Must be a student in one of the two files above. |
| Type | `Pin` (must be in), `Exclude` (never in), or `Free` (no session at all that block). |
| Session Name | Required for `Pin` and `Exclude`, matching Sessions.csv exactly. Leave blank for `Free`. |
| Block | `Pin`: optional, the run to put them in — leave blank to let the app choose. `Exclude`: leave blank. `Free`: required, one letter `A`–`D`, one row per free block. |
| Note | Optional. Why it exists, e.g. "requested by Ms. Smith". Never shown to students. |

A `Pin` can put a student into a session marked `No` for random assignment, and
it takes up one of that run's seats. A `Free` block is meant to be empty, so it
does not make the student count as unplaced.

Overrides that contradict each other stop the run with a plain-English message —
two pins at the same time, a pin and a free on one block, a pin and an exclude on
one session, or more pins on a run than it holds.
