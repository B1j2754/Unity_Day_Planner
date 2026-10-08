Human-written description of utility

# Unity Day Planner

## Input

> **Clarification:** All input files may be uploaded as `.csv` or `.xlsx`. Header matching is trimmed and case-insensitive (so `Email Address` and `email address ` are the same column). A column that is a near miss for an expected one is read as that column, with a warning naming both spellings, so a typo like `Email Adress` or `Session Organiser Name` does not silently drop data. Session rating columns are matched first, so correcting a typo can never steal a column a session needs. Columns not described below and not matching a session are ignored, with a warning shown to the user.

#### Sessions.csv

Columns:
* "Session Name"
    * The name of the session, as it will appear on sheets
    * Order agnostic. **MUST** match the beginning of a session column header in StudentResponses.csv (see the "..." column below for the exact matching rule)
* "Session Organizer Name"
    * The name of the **MAIN** adult running the event
    * Any name is okay, with any spelling
    * This is purely for the schedule sheets
* "Session Organizer Contact Email Address"
    * The email of the person (or entity) that is running the session
    * Must be a valid email address, and will serve as the recommended point of contact
    * If left out, schedule will omit any mention of an email for that session
* "Location"
    * The place where the event takes place
    * Usually a room number, though any value is allowed to make room for specific instructions
    * Printed on schedule sheets
* "Max Students Per Session"
    * The maximum capacity of students for this session
    * **MUST** be a positive and greater-than-zero integer
    * Capacity is **per run**. A session that runs in blocks A and C with capacity 20 can hold 20 students in the A run and 20 different students in the C run.
* "Blocks"
    * The blocks in which a run of this session **starts**. The session runs once for each letter listed.
    * Empty value, a.k.a. "", means the app picks the start blocks (see table below). For a 1-block session that is __three__ of the four blocks, not all four; for the other lengths it is back-to-back runs starting at A.
    * The string can only contain the characters `A`, `B`, `C`, or `D`
    * Duplicate letters get flagged as an issue, but order of letters does not matter
    * A string such as `AB` means it supports blocks `A` and `B`, but not `C` or `D`. A session of length 2 block cannot exist for more than two blocks: `A` and `C`, as it would collide otherwise.
    * > **Clarification:** A set of start blocks is valid only if (a) every run ends by block D (start + length − 1 ≤ D), and (b) no two runs overlap (start letters are at least `length` apart). Invalid examples: `BC` with length 2 (B–C and C–D overlap on C), `D` with length 2 (runs past D), `AB` with length 3.
    >
    > Default when empty:
    >
    > | Length | Empty "Blocks" means | Runs |
    > |---|---|---|
    > | 1 | three of `A`, `B`, `C`, `D`, chosen by the app | 3 runs, one block sat out |
    > | 2 | `AC` | A–B, C–D |
    > | 3 | `A` | A–C |
    > | 4 | `A` | A–D |
    >
    > **Clarification: which block a 1-block session sits out.** Only length 1 can run three times — a 2-block session only fits two non-overlapping runs in a day, and a 3- or 4-block session only fits one — so only length 1 has a block to choose. Writing `ABCD` out in full still means all four runs; the three-run default applies only when the cell is blank.
    >
    > The app picks the sat-out block to keep the four blocks holding roughly the same number of seats. It counts every session that named its own blocks first, then goes through the blank ones and has each sit out whichever block is fullest at that point. Capacity is what gets balanced, not the number of sessions, because one 60-seat session outweighs three 10-seat ones. Sessions are processed in name order and ties go to the earliest block, so the result never depends on the row order of the file.
* "Length of Session (in blocks)"
    * The amount of blocks a session occupies
    * **MUST** be a positive and greater-than-zero integer, in the range: 1 <= x <= 4
    * Determines how a student's schedule is determined, and the blocks a session would occupy
    * Works in tandem with "Blocks" to specify
* "Survey Column"
    * __Optional__, and usually left blank
    * The exact heading of this session's column in `StudentResponses.csv`, used when the two sheets name the session too differently for any rule to pair them up (e.g. `Museum Visit` in one and `Grade 10 Museum Visit` in the other)
    * When filled in, it beats every automatic rule except an exact session-name match
    * The column may be left out of the file entirely
* "Can be Randomly Assigned?"
    * Whether or not this is a session that can have students who did **not** answer the survey (see NonRespondents.csv) placed in it
    * Valid answers to indicate **YES**, non-respondents **CAN** be placed here:
        * `Yes`, `yes`, `y`, `1`
    * Valid answers to indicate **NO**, non-respondents can **NOT** be placed here:
        * `No`, `no`, `n`, `0`
    * An empty value, a.k.a. "", means __YES__. Most sessions are open to everyone, so the common case is the one you can leave blank.
    * `Yes` and `No` are most readable and preferred
    * > **Clarification:** This setting does not affect students who answered the survey. They can be placed in any session based on their ratings.

Rows:
* Row 1: Column headers
* Row 2: Description / Details / Explanation for header
    * > **Clarification:** Row 2 is detected, not assumed: if row 2's "Max Students Per Session" is not an integer, it is treated as the description row and skipped. Otherwise it is treated as data (in case a staff member deleted it).
* Row 3-inf: Data entries

#### StudentResponses.csv

Columns:
* "Email Address"
    * Auto collected
    * Ensure its on in the form, by having `Settings > Defaults > Form defaults > Collect email addresses by default` set to `Verified`
    * > **Clarification:** Email is the unique student ID. If the same email appears more than once, the latest submission (by timestamp) is kept and the duplicates are listed in the warnings.
* "Name (FIRST LAST)"
    * Legal (or school-accepted) first and last name of student filling out this form
* "Preferred Name"
    * The way in which the student filling out this form wants to be referred to. Can be anything.
    * Most commonly mis-filled with an email for contact, so any response using an @ will be rejected, and the script will opt to use the first name of the student as provided in the `Name (FIRST LAST)` column. It will default to the first chunk when separated with spaces
    * > **Clarification:** A blank Preferred Name falls back the same way.
* "Grade"
    * The grade of the student
    * **MUST** be one of the following: `9`, `10`, `11`, or `12`
    * Purely for schedule sheet info
* "..."
    * The ellipsis must be the name of the event (this value is in the header row), and must begin with an identical portion to that of the `Session Name` field in `Sessions.csv`. The beginning-only match is to allow any other text to come after to clarify, but the beginnings MUST match. The app throws an error if the two sheets do not match up.
    * > **Clarification:** If more than one session name is a prefix of a column header (e.g. `Art` and `Art History`), the **longest** matching session name wins. The app shows an error if (a) a session in Sessions.csv has no matching column, or (b) two columns match the same session.
    * > **Clarification: short titles.** In practice the two sheets describe a session differently — the form question carries its own blurb and `Sessions.csv` carries another, so neither string begins with the other. If no session name is a prefix of the header, the app falls back to matching the **short title**: the text before the first dash, colon, bracket or line break, on both sides. `Harbor Mural Project – Designing and painting a mural…` and `Harbor Mural Project
Students sketch, plan and paint…` both shorten to `Harbor Mural Project` and so pair up. Curly and straight apostrophes and stray line breaks are normalised first. The full name is always tried before the title. If two sessions share a short title, the app refuses to guess and reports it.
    * The value for this column must be a positive integer, 1 <= x <= 5
    * This value represents how much a student wants to have this session, where 5 is the most, and 1 is the least
    * This continues down the line, filling the remaining column slots
    * Ratings can **NOT** be blank. A row with a blank or invalid rating is an error: that row is rejected, listed in the errors, and that student is not scheduled.

Rows:
* Row 1: Column headers
* Row 2-inf: Data entries

#### NonRespondents.csv

Students who did not answer the survey. They still get a full schedule, placed only into sessions marked **YES** for "Can be Randomly Assigned?". This is a simple 2-column sheet that staff build by hand or paste from any roster.

Columns:
* "Email Address"
    * The student's school email. Used as their unique ID, and for the mail merge and PNG file names.
    * **MUST** be a valid email address
* "Name (FIRST LAST)"
    * Legal (or school-accepted) first and last name of the student
    * The first chunk (split by spaces) is used as their name on the schedule, since there is no Preferred Name
    * If blank, the part of the email before the `@` is used, and a warning is shown

Grade is not collected for non-respondents; the grade line is left off their schedule sheet.

Rows:
* Row 1: Column headers
* Row 2-inf: Data entries

Rules:
* If an email appears in both StudentResponses.csv and NonRespondents.csv, the survey response wins, and the overlap is listed in the warnings.
* Duplicate emails within this file are listed in the warnings and only scheduled once.
* This file is optional. If not provided, only survey respondents are scheduled.

#### Overrides.csv

Manual exceptions made by staff, e.g. "this student must be in Robotics Demo", "keep this student out of Chess Club", or "this student leaves after block B". Overrides can be uploaded as a file **or** created in the app (see Overrides Editor under Workflow / UI). Both are the same list: the file is just the saved form of what the editor shows.

Columns:
* "Email Address"
    * The student this override applies to
    * **MUST** match a student in StudentResponses.csv or NonRespondents.csv, otherwise it is an error
* "Type"
    * One of:
        * `Pin`: the student **must** be placed in this session
        * `Exclude`: the student must **never** be placed in this session
        * `Free`: the student has **no** session in this block (absent, appointment, leaves early, etc.)
    * Case-insensitive
* "Session Name"
    * Required for `Pin` and `Exclude`. Must match a `Session Name` in Sessions.csv exactly (case-insensitive, trimmed). Leave blank for `Free`.
* "Block"
    * For `Pin`: optional. The start block of the run to place them in. If blank, the solver picks the run.
    * For `Exclude`: leave blank (excludes all runs of the session).
    * For `Free`: required. A single letter `A`–`D`. One row per free block.
* "Note"
    * Optional. Why the override exists (e.g. "requested by Ms. Smith"). Shown in the editor only, never on student schedules.

Rows:
* Row 1: Column headers
* Row 2-inf: Data entries

Rules:
* Overrides beat every other rule. A `Pin` can place a non-respondent in a session marked **NO** for random assignment, and a `Pin` counts toward that run's capacity.
* `Free` blocks are intentionally empty. A student with only free blocks left unfilled counts as **fully scheduled** and is not listed in Unplaced Students. Their schedule shows "Free" for that block.
* Conflicting overrides are errors and stop the run, with a plain-English message. Examples:
    * Two `Pin`s whose runs overlap in time
    * A `Pin` and a `Free` on the same block
    * A `Pin` and an `Exclude` for the same session
    * More `Pin`s on one run than its capacity (message suggests raising capacity in Sessions.csv)
    * A `Pin` with a Block that is not a valid start block for that session
* Exact duplicate rows are merged with a warning.
* This file is optional.

## Main Logic / Program Overview

This is a cost-minimization problem, or satisfaction-maximization problem, however you like to see it. Most students filled this out by giving many low scores to everything, and spiking their favorite sessions with 5s and 4s. So value the higher scores more than lower scores.

> **Clarification:** Ratings are converted to weights before optimizing. Default: `1→1, 2→2, 3→4, 4→8, 5→16` (each step doubles). These weights live in one config constant so they can be tuned. The objective is the **pure sum** of weights over all assignments. There is deliberately no fairness tier that boosts the worst-off student, because that would reward students who rate everything 1 except their favorites.

The main goal of this program is to match each student to their best-fit session to maximize their happiness. Now each student has multiple thoughts, and they all conflict with everyone else. The main method to use is Integer Linear Program (ILP). Use the webassembly ported version that will run in the browser (HiGHS). If it proves too slow for 1000ish students, fall back on local search. For the local search fallback only, there are a variety of potential local minima (or maxima) that one could fall into, so the best approach is to run a certain amount of randomly seeded restarts to ensure good coverage, and keep the best. The program needs to account for each block's length, its capacity, and account for each student's individual rating. It needs to maximize satisfaction. Whatever algorithm fits best to do this task.

This should be deterministic, and each staff member running the program with same inputs should get the same result.

> **Clarification:** Any randomness (including local search seeds) uses a fixed seed. Ties are broken by a stable order (e.g. sorted by email) so input row order does not change the result.

Hard constraints:
* Each student is in at most one session per block.
* A multi-block session places the student in it for all of its blocks.
* No session run exceeds "Max Students Per Session".
* A student is never placed in the same session twice.
* Non-respondents are only placed in sessions marked **YES** for "Can be Randomly Assigned?" (unless pinned by an override).
* Every `Pin` override is satisfied, no `Exclude`d session is assigned, and `Free` blocks stay empty.

> **Clarification: non-respondents.** All students (respondents and non-respondents) are scheduled in one optimization, so non-respondents can never be left without seats because respondents took them first. Non-respondents have no ratings, so they contribute nothing to the satisfaction score; to spread them out instead of clustering them in the first sessions listed, each of their eligible options gets a tiny seeded jitter weight (far smaller than 1).

> **Clarification: unfillable students.** Every student must have all four blocks filled. If that is impossible for some students, the run must still produce schedules for everyone else, not fail entirely. To do this, the solver works in two stages:
> 1. Maximize the total number of filled student-blocks.
> 2. With that number locked in, maximize satisfaction.
>
> Any student with an unfilled block is **omitted** from the mail merge and PNG outputs and listed in the Unplaced Students output (see below), shown as an error.
>
> Before solving, the app also checks each block: if the total seats across all runs covering that block are fewer than the number of students, it shows an error naming the block and the shortfall. This is the most likely cause of unplaced students.

## Workflow / UI

The app is a single page with three steps, shown top to bottom:

1. **Upload.** Drop zones for Sessions, Student Responses, Non-Respondents (optional), and Overrides (optional). Each shows a green check or a plain-English list of problems as soon as a file is dropped.
2. **Review & Overrides.** After clicking "Generate Schedules", show the metrics, warnings, errors, and the Overrides Editor.
3. **Download.** Buttons for the three outputs, plus "Download Overrides".

#### Overrides Editor

A simple table of the current overrides (loaded from Overrides.csv if uploaded, otherwise empty), with the same columns as the file.

* **Add override:** a small form with
    * Student: a search box that matches name or email from the loaded students
    * Type: dropdown (`Pin`, `Exclude`, `Free`)
    * Session: dropdown of session names (hidden for `Free`)
    * Block: dropdown limited to valid options for the chosen type and session
    * Note: optional text
* **Shortcut from results:** a student lookup that shows one student's current schedule; each block has "Keep this" (adds a `Pin` for that exact run) and "Not this" (adds an `Exclude`) buttons. This is the common case: a staff member gets a complaint about one student and fixes it.
* Each row has a delete button.
* Changing overrides does **not** re-run automatically. A visible "Re-generate with overrides" button re-runs the solver, so the result never changes without someone clicking.
* **"Download Overrides"** saves the list as `Overrides.csv`. Because the app keeps nothing between visits (see Privacy), this file is how overrides are kept: next time, upload it alongside the other files to get the same result. If there are unsaved overrides, the page warns before closing.

> These are all ordinary form elements (search input, dropdowns, buttons, table), styled from the component library. No advanced UI elements are needed.

## Privacy

> **Clarification:**
> * All processing happens in the browser. No uploads, no backend, no database, no analytics.
> * Real student data must never be committed to the repo. Tests use anonymized or generated fixtures only.
> * Any feature that would require sending data off the user's computer must be raised with the main developer first.

## Output

5 outputs are required: three for students, two for the adults running sessions

1. Power-Automate-acceptable output
    * One file output: `unity-day_mail-merge.xlsx`
    * One row per student, with the following columns:
        * "Email": The student's email
        * "Name": The student's preferred name
        * "Schedule_HTML": The student's schedule list, as a simple HTML table
    * This is meant to be used with Microsoft Outlook's Power Automate function, meaning a flow will read this and build all the emails for the students
    * > **Clarification:** The file name and column names above are a fixed contract with the Power Automate flow. Never change them without updating the flow. Includes non-respondents; excludes unplaced students.

2. PNG Zip File
    * A zip file of PNGs, containing all the students' schedules
    * The schedules must be a table-like output, with descriptions of each block and session
    * Each PNG file must be named `first.last@example.edu.png` or whatever the email is, plus `.png`
    * > **Clarification:** Includes non-respondents; excludes unplaced students.

3. Staff mail merge
    * One file output: `unity-day_staff-mail-merge.xlsx`
    * One row per __organizer__, not per session. Everything one adult runs all day lands in a single row, so they get one email rather than one per session. Keyed on "Session Organizer Contact Email Address".
    * Columns:
        * "Email": the organizer's email
        * "Name": the organizer's name, as written in Sessions.csv
        * "Roster_HTML": their whole day as an HTML table, one section per run, each listing the students placed in it
        * "Sessions": the session names they run, comma separated, plain text
        * "Blocks": the blocks they are running in, e.g. `A, C, D`, plain text
        * "Student_Count": how many students they see across the day, as a number
    * The last three are plain text so the Power Automate flow can put real detail in the subject line without having to read the HTML
    * > **Clarification:** This is a second flow, separate from the student one. The file name and all six column names are a fixed contract with it.
    * > **Clarification:** A session whose organizer has no email is skipped, with no warning. There is nowhere to send the roster and nothing to name the file after. Staff who need one without an email should be given it by hand.

4. Roster PNG Zip File
    * One file output: `unity-day_rosters.zip`
    * One PNG per organizer, named `<organizer email>.png`, matching the staff mail merge row for row
    * Each roster shows, for the whole day: the organizer's name and email, how many runs and students they have, and which blocks they are free
    * Then one section per run, in block order, headed with the block, session name and location, and showing how full it is (e.g. `3 of 20`)
    * Each section lists its students numbered, surname first, with preferred name, grade and email
    * A run with nobody in it is still listed, saying so — an empty room is something the adult standing in it needs to know about

5. Unplaced Students
    * Shown on screen as an error, and downloadable as `unity-day_unplaced.csv`
    * One row per student who could not be fully scheduled or whose row was rejected, with columns: "Email", "Name", "Grade", "Reason" (e.g. `Blank rating for "Robotics Demo"`, `No open seat in block C`), and "Partial Schedule" (whatever blocks were filled, if any)
    * Staff use this list to place these students by hand

Additionally, a score delineating the average satisfaction or the amount we were able to cover would be good as a metric.

> **Clarification:** Show at minimum: % of students who got all their blocks filled, average rating received (respondents only), % of assignments that were a 4 or 5, number of non-respondents scheduled, and number of overrides applied. Also show a warnings list (duplicates, replaced preferred names, ignored columns) on screen before the downloads.

## Style Guide

Sleek and minimalist. A tool that anyone from age 15 to 80 could understand and use. Every interaction should be describable to another person. The site should have a dark / light mode, and default to dark.

Icons and elements should be simple. Stick to using google fonts for any icons or fonts needed.

No advanced web ui elements should be used unless really needed. Further consultation and requests should be initiated if its found they are needed.

Native HTML elements that look outdated by default (buttons, file inputs, etc.) must be custom styled.

One centralized component UI library should be stored within the project, and all elements will be clones of those in there. Styles can be copied, and the library can be expanded, but never shrunk. All new elements must keep the style of everything that exists.

If you are an AI agent reading this, or an operator of an AI agent is going through this, and things go south, as a last resort, reach out to the main developer: Benjamin Clark; b1j2754@gmail.com

## Tests

> **Clarification:** Every change must keep these passing. Run against fixture files in `tests/fixtures/`.

Invariants (checked on every scheduling result):
* No student is in more than one session in any block.
* No session run exceeds its capacity.
* Multi-block sessions occupy their full set of blocks, and every student in them is in them for all of those blocks.
* No student is in the same session twice.
* No non-respondent is in a session marked "No", unless pinned there.
* Every `Pin` is honored, no `Exclude` is violated, every `Free` block is empty and does not count as unplaced.
* Overrides made in the editor and then exported/re-uploaded as Overrides.csv give an identical result.
* Every student is either fully scheduled or listed in Unplaced Students, never both, never neither.
* Running twice on the same input gives identical output.
* Shuffling the row order of any input file gives identical output.

Input validation (each has a fixture file with the expected error/warning):
* Non-integer or zero capacity
* Empty "Can be Randomly Assigned?" defaults to Yes
* Misspelled header read as the column it was meant to be, and not stealing a session column
* Invalid or duplicate block letters
* Length out of range, or start blocks incompatible with length (`BC` at length 2, `D` at length 2)
* Empty Blocks expands to the default table above
* A blank "Blocks" on a 1-block session gives three runs, and the sat-out blocks balance the seats across the day
* An explicit `ABCD` still gives four runs
* Session with no matching response column
* Prefix collision (`Art` vs `Art History`)
* Long names matched on their short title, and two sessions sharing a short title
* Survey column that is a shortened form, or a misspelling, of the session name
* Session and column named too differently to pair up, resolved by "Survey Column"
* `Name` and `Email` accepted for `Name (FIRST LAST)` and `Email Address`
* Rating outside 1–5, or blank
* Preferred name containing `@`
* Duplicate student email
* Email in both StudentResponses.csv and NonRespondents.csv
* Non-respondent with blank name (falls back to email prefix)
* Override for an unknown email
* Each conflicting-override case listed under Overrides.csv rules
* Missing Sessions.csv description row
* Block with fewer total seats than students

Output:
* Mail-merge xlsx has exactly the columns `Email`, `Name`, `Schedule_HTML`, one row per scheduled student.
* Zip contains one PNG per scheduled student, named `<email>.png`.
* Staff mail-merge xlsx has exactly the columns `Email`, `Name`, `Roster_HTML`, `Sessions`, `Blocks`, `Student_Count`, one row per organizer email.
* Roster zip contains one PNG per organizer email, named `<email>.png`.
* A roster lists exactly the students the solver placed in that run, no more and no fewer, and keeps runs that came out empty.
* An organizer with no email appears in neither staff output.
* A deliberately over-subscribed fixture still produces outputs for everyone who fits, and lists the rest in Unplaced Students.