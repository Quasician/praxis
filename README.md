# Praxis

*Praxis (Greek): turning ideas into action.*

A desktop planner built on top of Todoist that connects the big picture
(life areas and milestones) to the small one (today's time blocks). Your
phone keeps using the Todoist app, and Praxis reads and writes the same tasks.

## Run it

1. Install **Node.js LTS** from https://nodejs.org if you don't have it.
2. Double-click **Start Praxis.bat**. A small black window opens (that's
   the app's server, so leave it open) and your browser opens
   http://localhost:4321.
3. The first time, paste your Todoist API token (Todoist → Settings →
   Integrations → Developer → Copy API token).

The token is saved in a `.env` file in this folder. Never share or upload that file.

## Shortcuts

| Key | Action |
| --- | --- |
| `Q` or `/` | Quick add (Todoist's natural language works: "call landlord tomorrow 3pm #Errands p1") |
| `R` | Refresh |
| `P` | Plan my day (auto-fill free time) |
| `Enter` | Accept the proposed plan |
| `D` / `A` | Day view / Areas view |
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

## Files

- `server.js`: local server that relays requests to the Todoist API (v1). No npm install needed.
- `public/`: the app (HTML, CSS, JS)

## Roadmap

- ~~Day 2: drag tasks onto the timeline to time-block them~~ ✓
- ~~Day 3: life areas and milestones~~ ✓
- ~~Auto-planner: fills free time, hardest tasks first~~ ✓
- Day 4: Google Calendar events on the timeline (and the planner works around them)
- Day 5: brain-dump inbox powered by Claude
- Day 6: end-of-day shutdown and a weekly review that checks in on each area
- Day 7: polish, more shortcuts, open it like a real app
