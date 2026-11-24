# Praxis

*Praxis (Greek): turning ideas into action.*

A desktop planner built on top of Todoist that connects the big picture
(life areas and milestones) to the small one (today's time blocks). Your
phone keeps using the Todoist app, and Praxis reads and writes the same tasks.

## Install

1. Download **Praxis-Setup-x.y.z.exe** from the [latest release](https://github.com/Quasician/praxis/releases/latest) and run it.
   Windows may say "Windows protected your PC" because the installer isn't code-signed: click
   **More info → Run anyway**.
2. Praxis opens in its own window. Paste your Todoist API token (Todoist → Settings →
   Integrations → Developer → Copy API token).
3. Right-click Praxis on the taskbar → **Pin to taskbar**.

From then on:

- **Updates install themselves.** Praxis checks GitHub Releases every 30 minutes (and when you bring
  the window up), downloads new versions in the background and asks to restart. If it's sitting in
  the tray, it just updates.
- **Right-click Praxis on the taskbar** for Quick add, Brain dump, Shut down the day and Check for updates.
- **Fullscreen and zoom:** `F11` toggles fullscreen; `Ctrl +` / `Ctrl −` / `Ctrl 0` zoom. Praxis remembers
  both, plus the window's size and position.
- **Wide screens:** on an ultrawide (2200 px wide or more, e.g. a 5K2K monitor) the Day view shows your
  areas in a third column, and the timeline grows to fill the screen's height.
- **Opens at login** (turn it off in the tray menu).
- **Closing the window keeps Praxis in the system tray**, so the hotkey keeps working. Quit from the tray icon.
- **Ctrl+Shift+Space** from anywhere opens Praxis with the quick-add box focused.

Your data stays on your computer in `%APPDATA%\Praxis` (`.env` holds the Todoist token,
`praxis.config.json` your settings). Nothing is sent anywhere except Todoist and your calendar links.

## Shortcuts

| Key | Action |
| --- | --- |
| `Q` or `/` | Quick add (Todoist's natural language works: "call landlord tomorrow 3pm #Errands p1") |
| `R` | Refresh |
| `P` | Plan my day (auto-fill free time) |
| `Enter` | Accept the proposed plan |
| `D` / `W` / `A` | Day / Week / Areas view |
| `B` | Brain dump |
| `M` | Morning commit |
| `S` | Shut down the day |
| `G` | Progress |
| `?` | All keyboard shortcuts (and the version you're on) |
| `Ctrl+Shift+Space` | Quick add from anywhere (desktop app) |
| `Ctrl+Alt+D` | Mark the Now task done from anywhere (desktop app) |
| `F11`, `Ctrl +/−/0` | Fullscreen, zoom (desktop app) |
| `1` / `2` | Today / Inbox |
| `Esc` | Leave the input, or cancel a drag |

## Planning your day

- **Block time:** drag any task (from Today, Overdue or Inbox) onto the timeline. It snaps to 15 minutes and gets a 30-minute block unless it already has a duration.
- **Move:** drag a block up or down.
- **Resize:** drag a block's bottom edge.
- **Unschedule:** drag a block back onto the task list. It stays due today, just without a time.
- **Complete:** tick the circle on a block.

Every change saves the time and duration to Todoist, so your phone reminds you when a block starts.
Repeating tasks keep repeating: moving today's "every day at 7pm" only moves today's occurrence.
They can't be unscheduled, since the repeat rule needs a time.

## Auto-planning ("Plan my day")

Praxis can fill your free time for you, **hardest work first**:

1. **Free time** = your planning window (default 7:00 AM–9:30 PM), minus work hours on work days
   (default Mon–Fri 7 AM–3 PM, plus a 30-minute break after work), minus blocks already on the
   timeline, with 10-minute gaps. 20% of the free time is kept open on purpose.
2. **Candidates** = today's and overdue tasks without a time, plus the next step of your two
   nearest milestones.
3. **Ranking**: willpower first (`@deep` > unlabelled > `@light`), then priority, then how overdue.
   The hardest tasks get the earliest free slots; anything that doesn't fit is listed, not crammed in.
4. You get a **proposal** (dashed blocks). Drag them to adjust, drag one onto the list to leave it
   out, **Reshuffle**, or **Accept**, which saves everything to Todoist in one go.

With **auto** on (the default), Praxis proposes the plan the first time you open it each day.
Change any of this in **⋯ → Planner settings**.

## Nothing gets lost: "Needs a decision"

Overdue tasks don't pile up silently. A task moves into the **Needs a decision** tray (pinned at the
top of the Today list, with a counter in the header) when it is:

- **2+ days overdue**, or
- has **slipped 3+ times** (pushed to a later date while already due, including from your phone).

Tray tasks leave the normal list and the auto-planner until you decide. Choices are grouped by how stale
they are:

| Choice | What it does |
| --- | --- |
| **Today** | Due today, so the planner can place it |
| **Pick a day** | Tomorrow, this weekend, next week, or any date |
| **Someday** | Removes the date and tags `@someday`, parked on purpose (the Friday review resurfaces them) |
| **Break down** | Turns it into a `@milestone` with one small first step due today |
| **Done** / **Drop** | Drop completes it tagged `@dropped`, so it's recoverable in Todoist's completed list |
| **Skip to next** | For repeating tasks: closes the stale occurrence and moves to the next one |

Groups with 3+ tasks get a one-click **Move all to Someday** for backlog cleanup. Tasks that slipped
before rank higher in "Plan my day", so they stop sinking.

## Look and feel (2.0)

Praxis is built to be easy on the eyes on a big monitor all day:

- **Theme**: follows Windows dark/light by default. Change it under ⋯ → Theme.
- **Warmer colors after 8 PM**: the screen shifts warmer in the evening so it's gentler before bed (on by default).
- **The sky**: the timeline is tinted by the time of day (dawn, daylight, golden hour, dusk, night), and the now line is a small sun. The Now card takes on the color of the current sky.
- **Focus mode (F)**: hides everything except Now and the next three tasks. Press F again to see everything.
- **Readable type**: Atkinson Hyperlegible for text (designed for legibility) and Bricolage Grotesque for headings, bundled so they work offline.
- **Calm motion**: finishing a task fills the circle and folds the row away; the focus timer is a ring that fills. If Windows has "Show animations" turned off, Praxis stops animating too.

## Weather and motion (3.5)

**The real weather.** With the wallpaper on, Praxis checks the weather here every 15 minutes with the US National Weather Service (weather.gov): the nearest station's reading, or the hourly forecast when the station has nothing. Rain falls as rain, fog lies as mist on the lake, overcast greys the light and hides most of the stars, and the wind sets how hard things move. In deep winter, cold rain falls as snow in the valley. No account or key: each request just names the app, as the service asks. Switch it off in the Wallpaper dialog.

**A moving wallpaper (experimental).** Tick "Make it move" and the valley comes alive behind your desktop icons: grass and trees sway in the real wind, the lake shimmers, stars twinkle, mist drifts, rain or snow falls. It holds still while a full-screen app is in front, when the PC is locked and on battery. If Windows ever stops showing it, the still picture is always underneath.

## Your mottos on the valley (3.4)

Turn it on under ⋯ → **Wallpaper…** (or the tray menu). Your Windows wallpaper becomes a landscape drawn live behind your mottos:

- **The season follows the calendar**, a little each day: buds and blossom in spring, deep green in summer, colour moving through the forest in October (each tree turns on its own day), bare branches by mid-November, snow on the peaks first and then the whole valley from about mid-December, a frozen lake in deep winter.
- **The light follows the real sun and moon** where you are (Milpitas by default): dawn, day, golden hour, dusk and night blend into each other; the sun climbs higher in summer than in winter; at night the moon shows its real phase.
- **The motto changes on the hour**, shuffled so none repeats until all have shown. With Claude connected, each motto is matched once to the time of day it suits (from its file name). New mottos you drop in the folder are picked up within the hour.
- **Your projects shine as constellations**, lit star by star as you finish steps. Nothing is ever drawn across the words, and task names never appear on the wallpaper.
- Redrawn every 10 minutes and whenever you come back to the PC. Pictures go to Praxis's own folder; your Mottos folder is only read.
- Turning it off puts your Windows slideshow (or previous wallpaper) back the way it was.

How it works: the valley's land, tree shapes and tree positions are baked once (`public_static/valley`); light, season, weather and your sky are drawn on the graphics card (`src/valley`), and the desktop app sets the result as the wallpaper through Windows' own wallpaper interface.

## Stay in view (3.3)

**The edge horizon.** A strip a few pixels tall runs along the top of your main screen, above full-screen apps too: the day's sky from 6 AM to midnight, the past dimmed, your blocks as colored marks and the sun as a bright tick at "now". Clicks always go straight through it. Rest the mouse on the very top edge for half a second and a small card opens under it with the next block and how long until it (and the block under the mouse, if there is one); move away and it closes. Turn it off from the tray menu: "Edge horizon".

**The tray sundial.** The tray icon is a tiny sundial: the sun moves along its arc through the day (the moon at night), and a badge shows how many of today's commitments are still open. Hover it for the details: commitments left, the next block and sunset.

## The Horizon (3.2)

The Day view runs **left to right as one sky**. The sun crosses it at today's real sunrise and sunset (dotted ahead of you, solid behind), the past dims, and your blocks hang below it at their times. Drag tasks onto the day, drag a block sideways to move it or by its right edge to change its length; the mouse wheel scrolls through the day. Prefer the old top-to-bottom timeline? ⋯ → untick "Day as a horizon".

**The week as seven skies.** Each day in the Week view has a little sky: clear when it's light, cloudier as it fills up, stormy when you've planned more than you have time for. Stars over a day are project steps planned for it. Click today's sky to zoom back into the day. Moving between Day and Week zooms out and in.

**Every block fits its words (3.2.1).** A block shorter than its title is drawn as wide as its words, with a bar along the top showing its real length; a finished block grows to the left so it never crosses the now line. The work-hours band is a faint line with its label on the part still ahead. The Now pop-out puts the time guess on one row and grows to fit.

**Colors follow the time of day.** Buttons, highlights and a faint wash at the top of the window shift through the day: rose at dawn, blue by day, amber at golden hour, violet at dusk, indigo at night. Reminder cards and the Now pop-out match. Every phase keeps text at comfortable reading contrast.

## New projects, getting unstuck, and your sense of time (3.1)

- **New project (N, or "+ New project" on your sky).** Describe a goal; Claude breaks it into steps you can start without thinking, sized and in order. You see the constellation it'll make (Reshape for another), edit the steps, and Praxis writes the milestone and steps to Todoist, with the first step on today if you like.
- **I'm stuck** (on the Now card and the pop-out). One tiny next move, under two minutes. "Another" for a different one; "Add as a step" to keep it. Without Claude connected you still get a plain first move.
- **Guess the time.** When you start a focus session, tap how long you think it'll take (or ignore it). When you finish, Praxis tells you how close you were, and Progress shows your **time sense**: how far off you usually are, which way you lean, and whether you're getting sharper.

If Todoist has a bad minute, Praxis retries a change once by itself and tells you plainly if Todoist is down.

## Your sky (3.0)

Progress opens on a night sky where your projects are constellations:

- Every task labelled **@milestone** is a constellation, and its sub-tasks are its stars. Nothing to set up.
- **Bright stars are done, faint ones are still to do.** You see a project's whole shape from day one and watch it fill in.
- The **next step** has a gold ring, and it pulses when it's on today.
- **Height is the deadline:** the closer it is, the lower the project sinks toward the horizon (amber when it's late).
- **Bigger steps are brighter stars** (from the task's duration).
- **Areas are regions of the sky**, left to right, so a quiet area shows as an empty patch.
- **Finished projects** drift up into the Milky Way; finished tasks that aren't project steps become stardust.
- Stars you've lit since your last look light up in front of you.
- Click a constellation to see its steps, and send the next one to today.

Todoist only keeps about three months of finished tasks, so Praxis keeps its own record of every star: old ones never go dark.

In **focus mode (F)** the task you're doing is the sun, with the focus timer wrapped around it.

## Reminders that reach you (2.1)

When you're deep in a full-screen app, Windows' Do Not Disturb hides ordinary notifications. So the desktop app shows its own small card at the top of the screen instead, on top of everything (full-screen apps too) and without taking your keyboard:

- **A heads-up** a few minutes before a planned block, then **when it starts** (Start focus, Already done, In 10 min).
- **When a focus timer runs out** (Done, +5 min, Stop timer).
- **Shut down the day** and **Wind down** at your evening times.
- **Time checks** every 90 minutes when nothing is planned and you've been at the computer the whole time, so hours don't vanish.

A card you don't answer shrinks to a small pill in the corner after 30 seconds and stays until you click it. Change all of this under ⋯ → Reminders…, including a soft chime and a "Show a test reminder" button. If you'd rather have normal Windows notifications, pick that there, and add Praxis to Windows' priority notifications so they get through. Games running in *exclusive* full screen draw over everything, including these cards; borderless/windowed full screen is fine.

## Calendar

Link your Google Calendar under **⋯ → Calendars…** and your events appear on the timeline;
"Plan my day" schedules around them (events marked *free* in Google don't block time).

1. In [Google Calendar settings](https://calendar.google.com/calendar/r/settings), click a calendar
   under **Settings for my calendars**.
2. Copy **Integrate calendar → Secret address in iCal format** and paste it into Praxis.

Praxis only reads the calendar. The link is a secret, so it's stored only in `praxis.config.json` on
this computer (never committed) and masked on screen. Changes in Google can take a few minutes to show.
Events that duplicate a Todoist task at the same time (from Todoist's own calendar sync) are hidden.

## Finishing more of what you plan

Praxis is built around one number: how much of what you plan actually gets done.

- **Morning commit (`M`, or it opens on your first visit each day).** You get today's plan with **3 committed** tasks
  (★, at most one Deep) and the rest as **bonus**. Swap any in or out, pick **the one that matters**, then **Commit**.
  A day you can win beats a day you can't.
- **Plans fill 60% of your free time**, not 80%. If you finished 80%+ of last week's commitments, plans get fuller.
  Under 50%, they get lighter. (Planner settings: *Fill free time*, *Commit to N tasks*, and the switches.)
- **The Now card** at the top of the Day view shows one task: what's happening now, else your next commitment.
  **▶ Start** runs a 25-minute timer, **✓** finishes, **↷** shows the next. In the desktop app, **⧉** pops it out
  into a small always-on-top window.
- **First steps.** Big or vague tasks stall because there's no obvious first move. In **Needs a decision**, ✦ *Suggest
  first steps* has Claude write a concrete 10–15 minute starting action for each stuck task. *Use it* turns the task
  into a milestone with that step on today. Brain dumps suggest first steps for big tasks too.
- **Clean up backlog with Claude** (⋯ menu): Claude reviews every open task and suggests Keep, Someday, Merge or
  Drop. You review, change anything, then apply. Dropped and merged tasks are completed and tagged @dropped, so
  nothing is lost.
- **Progress (`G`)** shows planned vs. done for the last 28 days, week by week, by effort, by area, and your shutdown streak.
- **Learning.** Praxis notices when you actually finish Deep work and schedules Deep tasks there. Timed Now
  sessions teach it how long things really take, and plans use those durations.

## Low-energy and busy days

The smallest possible day should still count.

- **How's today?** The morning commit starts with *Full / Low / Slammed*.
  - **Low:** two commitments, light work, and Deep tasks only as a 10-minute **tiny version**.
  - **Slammed:** one small thing, and everything else due today is spread over the rest of the week.
- **Tiny versions.** Claude writes a 2–5 minute version of your habits and Deep tasks ("Put on rowing shoes and
  row 5 minutes"). On low days the Now card offers **✓ Tiny**. For a repeating task it counts as done; a one-off
  stays open, but the day still counts.
- **Never miss twice.** The streak in the top bar counts days where you did a committed thing (tiny counts) or
  closed the day. One missed day is allowed, and the chip turns amber to say "keep it alive today". Two in a row ends it.
- **Fresh start.** Come back after a couple of days away to a pile of overdue tasks, and Praxis offers one button:
  spread them over the next week (or park them in Someday). Missed repeating tasks just start again today.
- **Less friction.** Notifications when a planned block starts (click to open the Now pop-out). **Ctrl+Alt+D**
  marks the Now task done from anywhere. **The one that matters** becomes p1 in Todoist for the day, so your phone
  shows it first; it goes back at shutdown.
- **Small rewards.** Confetti for the one that matters and for finishing every commitment. On Friday the Week view
  opens with a recap: what got done, commitments kept, your streak, best day and top wins.

## Brain dump (Claude)

Press `B` or click **✦ Brain dump**, and type everything on your mind, as messy as you like. Claude turns it into
tasks, each with a project, a date only if you implied one, a duration and an effort level (`@deep` / `@light`).
Nothing is added until you've reviewed the list: edit anything, untick what you don't want, then **Add**. Everything
goes to Todoist in one batch.

- **File my Inbox:** on the Inbox tab, Claude suggests a project, effort and duration for everything sitting
  there. Dates you already set are kept unless you change them.
- **Connecting Claude (⋯ → Claude…):** either
  - **your Claude subscription**, through [Claude Code](https://code.claude.com/docs/en/setup) on this computer: install it,
    run `claude` once and sign in, then click *Check again*. No key, nothing extra to pay; requests count against your
    plan's monthly allowance for scripted Claude Code use. Or
  - **an Anthropic API key** (pay-as-you-go; a dump costs well under a cent). Stored next to your Todoist token,
    never sent to the window.

## Shutting down the day

From 9 PM (change it in Planner settings) a **☾ Shut down the day** pill appears; or press `S` any time.
It takes two minutes:

1. **Done today:** everything you ticked off, repeating tasks included, and the time it took.
2. **Still open:** give each leftover a home: Done, Tomorrow, Next week, Someday or Drop (repeating
   tasks: Done, Tomorrow or Skip). **Spread over the week** puts them on the first days with room, so
   tomorrow doesn't overflow; **All to tomorrow** does what it says.
3. **Tomorrow:** what's on it, your calendar, and whether it fits in your free time.

Then **Close the day**. Nothing stays overdue by accident, so the Friday plan has less to clean up.

## Weekly planner

Press `W` (or click **Week**). On **Friday after work** Praxis opens a draft of next week by itself
(it catches up on Saturday or Sunday if you missed it). Midweek, the same view plans the rest of this week.

- **A look-back strip** shows what each area got this week, and which ones went quiet.
- **Each day shows its capacity**: free time after work and calendar events, minus the slack you keep free.
- **The draft decides the day; each morning's plan picks the time.** It:
  - keeps everything already dated that week (repeating tasks are locked),
  - gives **every overdue task** a day (spread so no day passes 60% full), and parks ones overdue for
    60+ days in **Someday**,
  - schedules each milestone's next step and one task for each area that went quiet,
  - puts `@deep` tasks on the roomiest days, at most one per work day.
- **Resurfaced from Someday** offers your three oldest parked tasks; drag one onto a day to bring it back.
- Drag cards between days, into **Someday** (no date, tagged `@someday`) or **Didn't fit**, then **Accept**:
  every change goes to Todoist in one batch. **Redraft** starts over.

## Areas and milestones

Switch to **Areas** (top of the window, or press `A`) for the bigger picture.

- **Areas** group your Todoist projects into parts of your life (Career, Health, Hobbies, Home…).
  Praxis guesses them from your project names the first time; change them with **Edit areas**.
  They're saved in `praxis.config.json` in this folder (kept out of git).
- Each area shows **time and tasks done this week**, a **7-day activity strip**, and a nudge when
  it has **gone quiet** for a week or more.
- **Milestones** are Todoist tasks labelled `@milestone`; their sub-tasks are the steps. Each one
  shows a progress bar, its target date (Todoist deadline), and the **next step** with a
  **Do today** button that puts it on today's list, ready to drag onto the timeline.
- Add milestones and steps right from the card; they're created in Todoist, so they're on your phone too.

## What's in it

- Overdue and Today tasks, sorted by time and then priority
- Inbox tab
- Project filter chips
- Complete a task with Undo
- Quick add (on the Today tab, tasks without a date get due today)
- Timeline with drag-to-schedule, move, resize and unschedule, side-by-side overlaps, and a "now" line
- Auto-refresh every 2 minutes and whenever you switch back to the window

## Development

Built with React + TypeScript (Vite), TanStack Query and Zustand; the local server and the
Electron shell are TypeScript too.

```
npm install
npm run serve     # build + run the server, then open http://localhost:4321 in a browser
npm start         # build + run the desktop app
npm run dev       # live-reloading UI (run `npm run serve` alongside for the API)
npm run typecheck
npm run dist      # build a Windows installer into release/
```

**Releasing:** bump `version` in `package.json` and push to `main`. GitHub Actions tags the commit,
builds the Windows installer and publishes the release; installed copies update within about half an hour.
Pushes that don't change the version are only checked, not released.

| Folder | What's in it |
| --- | --- |
| `src/` | The UI: `components/` (views and dialogs), `domain/` (planner, triage, areas, timeline layout), `data/` (Todoist queries and changes), `lib/`, `state/` |
| `server/` | Local server: Todoist relay, settings, calendar reader (`ics.ts`) |
| `electron/` | Desktop shell: window, tray, hotkey, open at login, auto-update |
| `.github/workflows/` | Build checks and the release pipeline |

## Roadmap

- ~~Day 2: drag tasks onto the timeline to time-block them~~ ✓
- ~~Day 3: life areas and milestones~~ ✓
- ~~Auto-planner: fills free time, hardest tasks first~~ ✓
- ~~Day 4: Google Calendar events on the timeline (and the planner works around them)~~ ✓
- ~~"Needs a decision" tray so overdue tasks never get lost~~ ✓
- ~~Rebuild on React + TypeScript, desktop app with auto-updates~~ ✓
- ~~Weekly planner: Friday draft, look-back, every overdue task gets a home~~ ✓
- ~~Ultrawide layout, fullscreen and zoom; releases publish themselves~~ ✓
- ~~Day 5: brain-dump inbox with Claude~~ ✓
- ~~Day 6: end-of-day shutdown~~ ✓
- ~~Day 7: taskbar jump list, shortcut help, crash screen, repeating tasks count as done~~ ✓
- ~~1.3: energy check-in, tiny versions, never-miss-twice streak, fresh start, block notifications, rewards~~ ✓
- ~~2.0: Daylight look; 2.1: reminders on top of full-screen apps~~ ✓
- ~~3.0: the night sky (projects as constellations) and the sun in focus mode~~ ✓
- ~~3.1: draw a constellation with Claude, "I'm stuck", guess the time~~ ✓
- ~~3.2: the Horizon (the day left to right), the week as seven skies, colors by time of day~~ ✓
- ~~3.2.1: every block fits its words, the pop-out grows to fit~~ ✓
- ~~3.3: stay in view: the edge horizon strip and the tray sundial~~ ✓
- ~~3.4: the valley: your mottos on a living landscape as the wallpaper (seasons by date, light by the hour)~~ ✓
- ~~3.5: real Milpitas weather on the wallpaper, and an optional live (moving) wallpaper~~ ✓
- 3.6: never rot: offline queue, self-healing days, capture hotkey
- 3.7: rewards: sky events, constellation legends, the Sunday letter, optional sound
- 3.8: finish the theme: sunrise and sunset rituals, ideas as clouds, Areas in the sky, the Horizon clouds over as the day fills
- ~~1.1: morning commit, committed vs. bonus, adaptive plans, Now card, first steps, backlog cleanup, Progress, learning~~ ✓
