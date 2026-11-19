# User guide

## First time
1. Open the app in Safari → Share → **Add to Home Screen**. From then on, always open it from the Home Screen.
2. **More → Diagnostics → Run the checks**: verifies audio, screen on, offline use and storage on your phone.
3. **Analytics → Tests and maxes**: enter your body weight and the maxes you know. They are used to compute kg.
4. **More → Automatic backup**: connect a private GitHub repository, or use "Save backup" every now and then.

## Every day
- **Home** shows today's training, or "Rest day" with **+ Exercise** to train anyway. You log exercises, not sessions: an exercise done without the app's timer is logged from its sheet with **Log without timer** (also on past days).
- Every exercise of today has its **▶**: it starts that exercise's timer. When it ends you log how it went (sets done, missed reps, minutes, load, RPE, surface and grade, note) and you are back on the day; done exercises show ✓ (tap it to redo).
- There is nothing to start or finish: you can add, remove and reorder exercises at any time, also halfway through. **Rate the day** (optional) adds overall RPE, feeling and notes.
- Timer sounds: short beeps in the last 3 seconds, a long tone at the end of each set, two long tones at the end of the exercise. On iPhone they play even with the silent switch on (iOS 17 or later); the volume still counts.
- In exercises with reps the timer shows how many to do ("6 reps") instead of the time. Skipped sets are counted for you in "Sets done".
- If you leave halfway, Home offers "Resume".

## Planning
- **Calendar**: tap a day to see or change its exercises (+ Exercise, + Test). Drag "≡" to reorder them. A day with no exercises is a rest day: there is nothing to create or delete.
  What you logged appears under each exercise (load, RPE, sets, grade, note; yellow if sets or reps were missed), with the day's RPE and notes at the bottom.
- **Day…** on a day: title, move it to another date (days you created), copy its exercises to another date, or clear it.
- Tap an exercise to set its parameters *on that day*: rounds, seconds or reps, rests, L/R, reference test and %, surface, note; for Fingers exercises also grip, edge (mm) and one or two hands. With a timer the duration is calculated; minutes are typed only for "Duration only" exercises.
- **Programmes** (More): import a `.yaml` file (see [Programme files](#programme-files)), choose the first training day and find it in the calendar. Any day of the week works: the other sessions keep their order and the days between them.
- "Copy to a date" adds the exercises of a day to another day.
- A programme can be exported as `.yaml` (More → the programme → Export .yaml), edited and imported again.

## Loads and tests
- An exercise linked to a test with a % shows the kg computed from the latest result.
- **Progression**: if you log load and RPE, next time the app suggests the load (rule in More → Load progression).
- **+ Test** on a day adds a test as an exercise: the result updates the max straight away.
- Hangboard hangs are two-handed; lifts (max lift, pinch) have one test per side, L and R.

## Categories
Every exercise has a category, shown as a coloured bar next to its name; the same colours are used in Analytics.

| Category | What goes there |
|---|---|
| Fingers | Everything on the hangboard and lifts (block, pinch), whatever the goal |
| Strength | Hard climbing: limit, project, board, campus, outdoor bouldering |
| Power endurance | 4x4, flash sets, volume |
| Endurance | Circuits, outdoor routes |
| Technique | Isolated moves |
| Conditioning | Everything that is not climbing: pull-ups, core, shoulders, antagonists, legs, wrists |
| Mobility | Stretching and mobility |
| Other | Mental work, activation sessions, your exercises without a category |

## Trips
Climbing trips and the projects you want to do there. It is a separate section: it plans nothing and does not touch days, programmes, tests or charts.
- **+ Trip**: name, place, status (Idea, Confirmed, Done), notes and dates. Dates can be exact days, just a month, or none yet.
- The list shows confirmed trips coming up first, with the days left; then ideas; then the archive (Done, and confirmed trips already over).
- **Projects**: boulders and routes with grade (Font; routes are written in lower case, e.g. 7a+), sector, style, status and notes for beta and conditions. Tap the circle to mark a project as sent (today's date), tap again to reopen it. Tap the row to edit it.
- **Countdown**: Home shows the nearest trip with dates, Idea or Confirmed (one only), below today's training, with a yellow (Idea) or green (Confirmed) dot. The number is the days to go ("~" when only the month is set; "Day 3 of 14" during the trip); the ring fills up from the day you added the trip to the departure. Tap it to open the trip.
- Trips are in the backup with everything else; a backup made before this section restores with no trips.

## Analytics
Choose the metric (training time or training days) and the period (week, month, 3 months, year). Counts start from
your first logged day, and the change against the previous period appears only once a whole previous period exists.
- **Donut**: time by category, with the share of climbing in the middle.
- **Bars**: time per day (week, month) or per week (3 months, year) split by category; with *Training days*, days
  per week against the planned ones.
- **Progress**: latest value of each test and its change in the period, top grade per surface. Tap a row for the trend.
- **Consistency**: planned days trained, sets completed, average RPE and feeling.
Tap a chart to see the values; the table is underneath. Tests are managed in *Tests and maxes*.

## During the trial
- **Note** (top of More): jot down what is wrong. Notes go to More → Notebook, where they can be exported.
- If "A newer version of the app is available." shows up, tap Update.

## Good to know
- It works offline after the first launch; the automatic backup resumes when the network is back and the app is open.
- The timer does not run with the screen off: while a timer runs the app keeps the screen on.
- Numbers use a decimal point (4.5 kg); a comma is still accepted when typing.
- Data is on the phone only. Without a backup, losing the phone means losing the data.

## Programme files

A programme is a YAML text file: easy to read, to review and to change. Lines starting with `#` are comments.

```yaml
title: Karma - Fase 1
weeks: 4                     # how many weeks the programme lasts
first_session: "2026-11-18"  # optional: suggested date of the first training day

days:
  - week: 1-3                # 2, "1-3", "1,3", "1-2,4" or all
    day: tue                 # mon tue wed thu fri sat sun
    title: Fingers           # optional
    exercises:
      - name: Sloper hang
        sets: 4
        work: 7s
        rest: 3min
        load: 82.5% sloper
        note: 2-3" in reserve
      - name: Pinch block
        sets: 6              # with sides, sets count both sides: 6 = 3 per side
        work: 7s
        rest: 1min15s
        sides: L/R
        load: 75% pinch
        grip: Pinch
      - name: Max hang
        sets: 4
        work: 7s
        rest: 3min
        grip: Half crimp     # Fingers only: grip, edge (mm), hands (1 or 2)
        edge: 20
        hands: 2
        load: 85% half-crimp
      - name: Flash sets
        sets: 6
        rounds: 3            # rounds in each set
        work: done           # no countdown: tap Done at the end of each round
        rest: 2min           # between rounds
        set_rest: 5min       # between sets
      - name: KB press
        sets: 3
        reps: 6              # counted instead of timed
        rest: 2min
      - name: Limit bouldering
        minutes: 30
        surface: moonboard
      - name: Spray circuit
        minutes: 25
        category: power endurance   # your own exercise, in this category
      - test: open-hand      # a test: the result updates the max
```

**Rules**
- Each entry is a training day: all its exercises go together. The same day in several weeks is written once, with a range in `week`. Days that are not listed are rest days.
- Files written with `sessions:` instead of `days:` still work.
- Warm-up is taken for granted: it is not written in programmes and is not a category.
- `name` is free text. If it is recognised as a standard exercise (also in Italian, e.g. "Flessione polso"), the app shows the library name ("Wrist curl") and counts the time in the right category. Put details such as the board or the edge in `note`. Names that are not recognised become your own exercises and are shown as written, in Other unless you add `category` (Fingers, Strength, Power endurance, Endurance, Technique, Conditioning, Mobility, Other). With `category` the exercise is always your own, even if its name looks like a standard one.
- Timer: `sets` plus either `work` (a time, or `done`) or `reps`. `rest`, `rounds` + `set_rest` and `sides: L/R` are optional.
- `minutes`: only for exercises without a timer (required unless it is a standard exercise). With a timer the minutes are calculated from its parameters; with `reps` or `work: done` each round counts about 45 s.
- Durations: `7s`, `45s`, `3min`, `1min30s` (also `3'` and `1'30"`).
- `load`: a percentage of one of your tests: `open-hand`, `half-crimp`, `sloper`, `pinch`, `lift`, `wrist`, `pull-up`, `one-arm`. The kg are calculated from the latest result. `test:` uses the same names.
- `grip`, `edge`, `hands` (Fingers exercises only): Half crimp, Full crimp, Open hand, Open hand 3 fingers, Half crimp 3 fingers, 2 fingers front/middle/back, Sloper, Pinch; edge depth in mm; 1 or 2 hands.
- `surface`: one of your surfaces (More → Climbing surfaces), by key or by name.
- If something is wrong the programme is not imported, and the app lists every problem with the day and exercise it refers to.

Blok Sessions files (`.blokplan`) are no longer supported.
