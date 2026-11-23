// Praxis — Calendars: link Google Calendar (read-only) via its secret iCal address.

const CAL_COLORS = { Tomato: "#d50000", Tangerine: "#f4511e", Banana: "#f6bf26", Basil: "#0b8043", Sage: "#33b679",
  Peacock: "#039be5", Blueberry: "#3f51b5", Lavender: "#7986cb", Grape: "#8e24aa", Graphite: "#616161" };

function calList() { return (areasState.config && areasState.config.calendars) || []; }

function renderCalList() {
  const cals = calList();
  $("#cal-list").innerHTML = cals.length ? cals.map((c) => `
    <div class="cal-row" data-id="${esc(c.id)}">
      <span class="cal-dot" style="background:${esc(c.color)}"></span>
      <span class="cal-name">${esc(c.name)}</span>
      <span class="cal-url">${esc(maskUrl(c.url))}</span>
      <label class="cal-toggle"><input type="checkbox" data-act="toggle" ${c.enabled !== false ? "checked" : ""}/> Show</label>
      <button type="button" class="ghost-btn danger" data-act="remove">Remove</button>
    </div>`).join("") : `<p class="dialog-sub">No calendars linked yet.</p>`;
}
// Never show the secret part of the link on screen.
function maskUrl(u) {
  try { const x = new URL(u); return `${x.host}/…${x.pathname.slice(-12)}`; } catch { return "…"; }
}

async function saveCalendars(cals) {
  await saveConfig({ ...areasState.config, calendars: cals });
  renderCalList();
  loadAll({ quiet: true });
}

$("#calendars-btn").addEventListener("click", async () => {
  $("#menu").hidden = true;
  await ensureConfig();
  const used = new Set(calList().map((c) => c.color));
  $("#cal-color").innerHTML = Object.entries(CAL_COLORS).map(([n, hex]) => `<option value="${hex}">${n}</option>`).join("");
  const free = Object.values(CAL_COLORS).find((hex) => !used.has(hex));
  if (free) $("#cal-color").value = free;
  $("#cal-msg").textContent = "";
  $("#cal-url").value = ""; $("#cal-name").value = "";
  renderCalList();
  $(".cal-help").open = calList().length === 0;
  $("#calendars-dialog").showModal();
});

$("#cal-add-btn").addEventListener("click", async () => {
  const url = $("#cal-url").value.trim();
  const msg = $("#cal-msg");
  if (!url) { msg.textContent = "Paste the link first."; return; }
  if (calList().some((c) => c.url === url)) { msg.textContent = "That calendar is already linked."; return; }
  const btn = $("#cal-add-btn");
  btn.disabled = true; btn.textContent = "Testing…"; msg.className = "cal-msg"; msg.textContent = "";
  try {
    const r = await api("/api/calendar/test", { method: "POST", body: { url } });
    const name = $("#cal-name").value.trim() || r.name || "Calendar";
    const cal = { id: "c" + Math.random().toString(36).slice(2, 9), name, url, color: $("#cal-color").value, enabled: true };
    await saveCalendars([...calList(), cal]);
    msg.className = "cal-msg ok";
    msg.textContent = `Added “${name}”: ${r.upcoming} event${r.upcoming === 1 ? "" : "s"} in the next 7 days.`;
    $("#cal-url").value = ""; $("#cal-name").value = "";
  } catch (e) {
    msg.className = "cal-msg err";
    msg.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Test & add";
  }
});

$("#cal-list").addEventListener("change", async (e) => {
  if (e.target.dataset.act !== "toggle") return;
  const id = e.target.closest(".cal-row").dataset.id;
  await saveCalendars(calList().map((c) => (c.id === id ? { ...c, enabled: e.target.checked } : c)));
});
$("#cal-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act=remove]");
  if (!btn) return;
  const id = btn.closest(".cal-row").dataset.id;
  const c = calList().find((x) => x.id === id);
  if (!confirm(`Unlink “${c ? c.name : "this calendar"}”? Your Google Calendar isn't changed.`)) return;
  await saveCalendars(calList().filter((x) => x.id !== id));
});
