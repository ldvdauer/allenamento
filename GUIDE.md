# User guide

## First time
1. Open the app in Safari → Share → **Add to Home Screen**. From then on, always open it from the Home Screen.
2. **More → Diagnostics → Run the checks**: verifies audio, screen on, offline use and storage on your phone.
3. **Analytics → Tests and maxes**: enter your body weight and the maxes you know. They are used to compute kg.
4. **More → Automatic backup**: connect a private GitHub repository, or use "Save backup" every now and then.

## Every day
- **Home** shows today's session, or "Rest day". From here you can also create a session or log one already done.
- **Start** opens the list of exercises. Each exercise has its own timer: when it ends you log how it went (minutes, load, RPE, surface and grade, note) and go back to the list.
- During the session you can add exercises or tests. At the end you give the overall RPE and feeling.
- If you leave halfway, Home offers "Resume".

## Planning
- **Calendar**: tap a day to view, create or edit sessions. Drag "≡" to reorder exercises.
- Tap an exercise to set its parameters *in that session*: rounds, seconds or reps, rests, L/R, reference test and %, surface, note.
- **Programmes** (More): import a `.yaml` file (see [Programme files](#programme-files)), choose the day of the first session and find it in the calendar. Any day of the week works: the other sessions keep their order and the days between them.
- "Copy to a date" duplicates a session on another day.
- A programme can be exported as `.yaml` (More → the programme → Export .yaml), edited and imported again.

## Loads and tests
- An exercise linked to a test with a % shows the kg computed from the latest result.
- **Progression**: if you log load and RPE, next time the app suggests the load (rule in More → Load progression).
- **+ Test** in a session adds a test as an exercise: the result updates the max straight away.
- Hangboard hangs are two-handed; lifts (max lift, pinch) have one test per side, L and R.

## Analytics
Filter by period, then: sessions, time, RPE, adherence; time by category with the share on the wall; weekly volume
by group against the planned one; load (minutes × RPE); effort and feeling; surfaces and grades; loads by exercise.
Tap a chart to see the values; the table is underneath.

## During the trial
- **Note** (bottom bar, or in the session in progress): jot down what is wrong. Notes go to More → Notebook, where they can be exported.
- If "A newer version of the app is available." shows up, tap Update.

## Good to know
- It works offline after the first launch; the automatic backup resumes when the network is back and the app is open.
- The timer does not run with the screen off: during a session the app keeps the screen on.
- Numbers use a decimal point (4.5 kg); a comma is still accepted when typing.
- Data is on the phone only. Without a backup, losing the phone means losing the data.

## Programme files

A programme is a YAML text file: easy to read, to review and to change. Lines starting with `#` are comments.

```yaml
title: Karma - Fase 1
weeks: 4                     # how many weeks the programme lasts
first_session: "2026-11-18"  # optional: suggested date of the first session

sessions:
  - week: 1-3                # 2, "1-3", "1,3", "1-2,4" or all
    day: tue                 # mon tue wed thu fri sat sun
    title: Fingers           # optional
    exercises:
      - name: Wall warm-up
        minutes: 20
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
      - name: Flash sets
        minutes: 60
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
      - test: open-hand      # a test: the result updates the max
```

**Rules**
- One session per day. The same session in several weeks is written once, with a range in `week`.
- `name` is free text. Names of the standard exercises (Exercise library) are recognised, so time is counted in the right category in Analytics.
- Timer: `sets` plus either `work` (a time, or `done`) or `reps`. `rest`, `rounds` + `set_rest` and `sides: L/R` are optional.
- `minutes` is calculated from the timer when missing. It is required for exercises without a timer, unless they are standard exercises.
- Durations: `7s`, `45s`, `3min`, `1min30s` (also `3'` and `1'30"`).
- `load`: a percentage of one of your tests: `open-hand`, `half-crimp`, `sloper`, `pinch`, `lift`, `wrist`, `pull-up`, `one-arm`. The kg are calculated from the latest result. `test:` uses the same names.
- `surface`: one of your surfaces (More → Climbing surfaces), by key or by name.
- If something is wrong the programme is not imported, and the app lists every problem with the session and exercise it refers to.

Blok Sessions files (`.blokplan`) are no longer supported.
