# Day Planner

A desktop day planner built on top of Todoist. Your phone keeps using the
Todoist app, and this app reads and writes the same tasks.

## Run it

1. Install **Node.js LTS** from https://nodejs.org if you don't have it.
2. Double-click **Start Day Planner.bat**. A small black window opens (that's
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
| `1` / `2` | Today / Inbox |
| `Esc` | Leave the input |

## What's in it (Day 1)

- Overdue and Today tasks, sorted by time and then priority
- Inbox tab
- Project filter chips
- Complete a task with Undo
- Quick add (on the Today tab, tasks without a date get due today)
- Read-only timeline of today's timed tasks with a "now" line
- Auto-refresh every 2 minutes and whenever you switch back to the window

## Files

- `server.js`: local server that relays requests to the Todoist API (v1). No npm install needed.
- `public/`: the app (HTML, CSS, JS)

## Roadmap

- Day 2: drag tasks onto the timeline to time-block them (saves time and duration to Todoist)
- Day 3: Google Calendar events on the timeline
- Day 4: brain-dump inbox powered by Claude
- Day 5: end-of-day "shut down" rollover
- Days 6–7: polish, more shortcuts, open it like a real app
