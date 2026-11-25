// A stand-in for Todoist's API, with a small made-up week of work, for the release checks (scripts/app-check/run.mjs).
// It answers the calls Praxis makes and remembers the changes it's sent, so the checks can see what Praxis did.
import http from "http";

const DAY = 864e5;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Starts the stand-in on `port`; returns { server, sent, data }. Dates are relative to `now`. */
export function startFakeTodoist(port, now = new Date()) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const at = (daysAgo, hour = 12) => new Date(+d0 - daysAgo * DAY + hour * 3600e3).toISOString();
  const projects = [{ id: "inbox", name: "Inbox", color: "grey", inbox_project: true }, { id: "home", name: "Home", color: "blue" }, { id: "music", name: "Music", color: "violet" }, { id: "work", name: "Work", color: "green" }];
  const T = (o) => ({ priority: 1, due: null, labels: [], project_id: "home", child_order: 1, ...o });
  let tasks = [];
  const completed = [];
  const project = (id, name, pid, steps, deadline) => {
    tasks.push(T({ id, content: name, project_id: pid, labels: ["milestone"], ...(deadline ? { deadline: { date: deadline } } : {}) }));
    steps.forEach(([title, doneAgo], i) => {
      const t = T({ id: `${id}-s${i}`, content: title, project_id: pid, parent_id: id, child_order: i + 1, duration: { amount: 30, unit: "minute" } });
      if (doneAgo != null) completed.push({ ...t, completed_at: at(doneAgo, 16) }); else tasks.push(t);
    });
  };
  project("m1", "Personal website", "home", [["Pick a template", 20], ["Write the about page", 9], ["Choose photos", 3], ["Export", 1], ["Publish", null]], ymd(new Date(+d0 + 25 * DAY)));
  project("m2", "Learn the piano piece", "music", [["Right hand", 40], ["Left hand", 31], ["Hands together", null], ["Record a take", null]]);
  project("m3", "Apartment move", "home", [["Must-haves", 14], ["Shortlist", 12], ["Viewings", null], ["Decide", null]], ymd(new Date(+d0 + 6 * DAY)));
  [["Draft the project update", 60, ["deep"]], ["Reply to the landlord", 20, ["light"]], ["Plan next week's meals", 45, []], ["Review the budget", 60, []]].forEach(([c, m, l], i) =>
    tasks.push(T({ id: `t${i}`, content: c, project_id: i % 2 ? "home" : "work", labels: l, due: { date: ymd(d0) }, duration: { amount: m, unit: "minute" }, child_order: i })));
  // Overlapping blocks (4.5): two on now (the checks run at 10:00), three around 2 PM, two of them starting together.
  const timed = (h, m) => `${ymd(d0)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  [["Stand-up notes", 9, 45, 30], ["Inbox zero", 10, 0, 20], ["Write the report", 14, 0, 60], ["Call the bank", 14, 0, 30], ["Review the slides", 14, 15, 45]].forEach(([c, h, m, min], i) =>
    tasks.push(T({ id: `o${i}`, content: c, project_id: i % 2 ? "work" : "home", due: { date: timed(h, m) }, duration: { amount: min, unit: "minute" }, child_order: 10 + i })));
  for (let n = 1; n <= 10; n++) completed.push(T({ id: `h${n}-0`, content: "Morning block", completed_at: at(n, 10), duration: { amount: 60, unit: "minute" } }));

  const sent = [];
  const page = (xs) => JSON.stringify({ results: xs, next_cursor: null });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let body = "";
    req.on("data", (c) => (body += c)).on("end", () => {
      res.setHeader("content-type", "application/json");
      const p = u.pathname;
      if (p === "/projects") return res.end(page(projects));
      if (p === "/tasks/filter") return res.end(page(tasks.filter((t) => t.due)));
      if (p === "/tasks/completed/by_completion_date") return res.end(JSON.stringify({ items: completed, next_cursor: null }));
      if (p === "/tasks") return res.end(page(u.searchParams.get("project_id") ? tasks.filter((t) => t.project_id === u.searchParams.get("project_id")) : tasks));
      if (p === "/activities") return res.end(page([]));
      const close = p.match(/^\/tasks\/([^/]+)\/close$/);
      if (close) { const t = tasks.find((x) => x.id === close[1]); if (t) { tasks = tasks.filter((x) => x !== t); completed.push({ ...t, completed_at: new Date().toISOString() }); } sent.push({ type: "close", id: close[1] }); res.statusCode = 204; return res.end(); }
      if (p === "/sync") {
        const { commands = [] } = JSON.parse(body || "{}");
        const st = {}, map = {};
        for (const c of commands) {
          st[c.uuid] = "ok"; sent.push(c);
          if (c.type === "item_update") tasks = tasks.map((t) => (t.id === c.args.id ? { ...t, ...c.args } : t));
          if (c.type === "item_add") { const id = `new${tasks.length}`; map[c.temp_id] = id; tasks.push(T({ id, ...c.args })); }
        }
        return res.end(JSON.stringify({ sync_status: st, temp_id_mapping: map }));
      }
      if (/^\/tasks\/[^/]+$/.test(p) && req.method === "POST") { sent.push({ type: "update", path: p, body }); return res.end("{}"); }
      res.statusCode = 404; res.end("{}");
    });
  });
  server.listen(port, "127.0.0.1");
  return { server, sent, tasks: () => tasks };
}
