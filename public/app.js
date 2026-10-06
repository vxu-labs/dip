const $ = (s) => document.querySelector(s),
  escape = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let state = { tasks: [], activity: [], checks: [] },
  view = "overview",
  selected = "",
  token = "",
  signature = "",
  currentDetail = null;
const leases = new Map();
const url = (p) =>
  p + (selected ? "?root=" + encodeURIComponent(selected) : "");
const label = (t) =>
  t.conflicts.length
    ? "conflict"
    : t.interrupted
      ? "interrupted"
      : t.active
        ? "running"
        : t.verification === "stale" && t.status === "verified"
          ? "stale"
          : t.status;
const short = (s) =>
  String(s || "")
    .split(/[/\\]/)
    .at(-1);
const date = (s) =>
  s
    ? new Date(s).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
function notify(message) {
  $("#notice").hidden = !message;
  $("#notice").textContent = message || "";
}
async function action(action, args) {
  const res = await fetch(url("/api/action"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dip-token": token },
    body: JSON.stringify({ action, args }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  await refresh(true);
  return data;
}
async function refresh(force = false) {
  try {
    const projects = await (await fetch("/api/projects")).json();
    const select = $("#projects");
    if (JSON.stringify(projects) !== select.dataset.values) {
      select.innerHTML = projects
        .map((p) => `<option value="${escape(p)}">${escape(short(p))}</option>`)
        .join("");
      select.dataset.values = JSON.stringify(projects);
      if (selected) select.value = selected;
      else selected = select.value;
    }
    const data = await (await fetch(url("/api/state"))).json();
    if (data.error) throw new Error(data.error);
    state = data;
    $("#connection").textContent = "Local connection active";
    $("#branch").textContent = state.repo?.branch || "No project yet";
    $("#updated").textContent = "Updated " + new Date().toLocaleTimeString();
    const next = JSON.stringify(data);
    if (force || next !== signature) {
      signature = next;
      render();
      if (currentDetail && $("#detail-dialog").open)
        renderDetail(currentDetail);
    }
  } catch (e) {
    $("#connection").textContent = "Connection unavailable";
    notify(e.message);
  }
}
function card(t) {
  return `<button class="card" data-task="${escape(t.id)}"><span class="badge ${label(t)}">${escape(label(t).replaceAll("_", " "))}</span><h3>${escape(t.title)}</h3><p>${escape(t.scope.join(" · ") || t.description.slice(0, 100) || "Scope not yet specified")}</p><div class="card-footer"><span>${escape(t.lease?.actor || "Unassigned")}</span><span>${t.due ? escape(t.due) : escape(t.id.slice(-8))}</span></div></button>`;
}
function column(title, tasks) {
  return `<div><h2 class="column-title">${title}<span>${tasks.length}</span></h2>${tasks.length ? tasks.map(card).join("") : '<div class="empty">No tasks here. Activity is captured automatically.</div>'}</div>`;
}
function render() {
  const tasks = state.tasks || [],
    query = $("#search").value.toLowerCase(),
    filtered = tasks.filter((t) =>
      JSON.stringify([t.title, t.description, t.scope, t.lease?.actor])
        .toLowerCase()
        .includes(query),
    );
  const metrics = [
    [
      "Active agents",
      tasks.filter((t) => t.active).length,
      "Live task ownership",
    ],
    [
      "Needs attention",
      tasks.filter(
        (t) => t.interrupted || t.conflicts.length || t.blockedBy.length,
      ).length,
      "Paused, blocked or conflicting",
    ],
    [
      "Verified now",
      tasks.filter((t) => t.verifiedComplete).length,
      "Evidence matches current code",
    ],
    [
      "Implemented",
      tasks.filter((t) => t.status === "implemented").length,
      "Awaiting verification",
    ],
    [
      "Future work",
      tasks.filter((t) => ["backlog", "ready"].includes(t.status)).length,
      "Ideas and unstarted tasks",
    ],
  ];
  $("#metrics").innerHTML = metrics
    .map(
      ([title, note, sub]) =>
        `<div class="metric"><div class="metric-label">${title}</div><div class="metric-number">${note}</div><div class="metric-note">${sub}</div></div>`,
    )
    .join("");
  $("#heading").textContent = {
    overview: "Project overview",
    board: "Work board",
    activity: "Development activity",
  }[view];
  $("#section-label").textContent = {
    overview: "YOUR WORK, AT A GLANCE",
    board: "PERSISTENT TASKS",
    activity: "AUTOMATIC EVENT STREAM",
  }[view];
  if (view === "activity")
    $("#content").innerHTML = `<div class="activity-list">${
      (state.activity || [])
        .filter((a) => JSON.stringify(a).toLowerCase().includes(query))
        .slice(0, 200)
        .map(
          (a) =>
            `<div class="activity-row"><time>${escape(date(a.at))}</time><div><span class="badge">${escape(a.kind)}</span><br><small>${escape(a.agent)} · ${escape(a.branch)}</small></div><div class="activity-title">${escape(a.tool || a.kind)}<br><code>${escape(a.command || a.plan || (a.files || []).join(", ") || a.path || a.head || "")}</code></div></div>`,
        )
        .join("") ||
      '<div class="empty">Agent, Git, and file activity will appear here automatically.</div>'
    }</div>`;
  else if (view === "board")
    $("#content").innerHTML = `<div class="board">${column(
      "Backlog",
      filtered.filter((t) => ["backlog", "ready"].includes(t.status)),
    )}${column(
      "In progress",
      filtered.filter((t) => t.status === "in_progress"),
    )}${column(
      "Review & blockers",
      filtered.filter(
        (t) =>
          ["implemented", "blocked", "conflict"].includes(t.status) ||
          t.verification === "stale",
      ),
    )}${column(
      "Verified",
      filtered.filter((t) => t.verifiedComplete),
    )}</div>`;
  else
    $("#content").innerHTML = `<div class="columns">${column(
      "Running & paused",
      filtered.filter((t) => t.active || t.interrupted),
    )}${column(
      "Ready & remembered",
      filtered.filter((t) => ["backlog", "ready"].includes(t.status)),
    )}${column(
      "Review & recent completion",
      filtered.filter((t) =>
        ["implemented", "verified", "blocked", "conflict"].includes(t.status),
      ),
    )}</div>`;
  if (state.errors?.length)
    notify(
      "Project data needs repair: " +
        state.errors.map((e) => e.error).join("; "),
    );
  else if (!state.repo)
    notify(
      "No Git projects discovered yet. Create or clone a repository under an installed discovery root.",
    );
  document.querySelectorAll("[data-task]").forEach(
    (b) =>
      (b.onclick = () => {
        currentDetail = b.dataset.task;
        renderDetail(currentDetail);
        $("#detail-dialog").showModal();
      }),
  );
}
function renderDetail(taskId) {
  const t = state.tasks.find((t) => t.id === taskId);
  if (!t) return;
  $("#detail-title").textContent = t.title;
  $("#detail").innerHTML =
    `<span class="badge ${label(t)}">${escape(label(t))}</span> <small>${escape(t.id)}</small><div class="detail-section"><h3>Intent</h3><p>${escape(t.description || "No description")}</p><p>Scope: ${escape(t.scope.join(", ") || "Not specified")}<br>Depends on: ${escape(t.dependencies.join(", ") || "None")}<br>In current branch: ${escape(state.repo.branch)}</p>${(t.acceptance || []).map((a) => `<p>□ ${escape(a)}</p>`).join("")}</div><div class="detail-actions"><select id="task-status" aria-label="Task status">${["backlog", "ready", "in_progress", "blocked", "implemented", "cancelled", "superseded"].map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select><button id="save-status">Update status</button><button id="claim">Claim task</button>${leases.has(t.id) ? '<button id="release">Release</button>' : ""}</div>${t.conflicts.length ? `<div class="detail-section"><h3>Competing updates</h3>${t.conflicts.map((c) => `<p>${escape(c.field)}: ${escape(c.alternatives.map((a) => JSON.stringify(a.value)).join(" / "))}</p>`).join("")}<button id="resolve">Resolve with selected status</button></div>` : ""}<div class="detail-section"><h3>Verification</h3><p>${escape(t.verification || "missing")} evidence · ${t.integrated ? "Integrated in current history" : "Integration not established"}</p>${state.checks.length ? `<select id="check">${state.checks.map((c) => `<option>${escape(c)}</option>`).join("")}</select><button id="verify">Run configured check</button>` : "<p>Configure checks in .dip/config.json to verify this task.</p>"}${t.evidence.map((e) => `<p><span class="badge ${escape(e.result)}">${escape(e.result)}</span> ${escape(e.check)} · ${escape(date(e.at))}</p>`).join("")}</div><div class="detail-section"><h3>Latest handoff</h3><p>${escape(t.checkpoints.at(-1)?.summary || "No checkpoint")}</p><textarea id="checkpoint" rows="3" placeholder="What was done, what remains, and the next step"></textarea><button id="save-checkpoint">Save meaningful checkpoint</button></div><div class="detail-section"><h3>History</h3>${t.history
      .slice(-15)
      .reverse()
      .map(
        (e) =>
          `<div class="history-row">${escape(e.type)} · <small>${escape(e.actor)} · ${escape(date(e.createdAt))}</small></div>`,
      )
      .join("")}</div>`;
  const bind = (selector, fn) => {
    const node = $(selector);
    if (node)
      node.onclick = async () => {
        node.disabled = true;
        try {
          await fn();
          notify("");
        } catch (e) {
          notify(e.message);
        } finally {
          node.disabled = false;
        }
      };
  };
  bind("#save-status", () =>
    action("update", {
      id: t.id,
      patch: { status: $("#task-status").value },
      token: leases.get(t.id)?.token,
    }),
  );
  bind("#resolve", () =>
    action("resolve", {
      id: t.id,
      patch: { status: $("#task-status").value },
      token: leases.get(t.id)?.token,
    }),
  );
  bind("#claim", async () => {
    leases.set(t.id, await action("claim", { id: t.id, actor: "dashboard" }));
    renderDetail(t.id);
  });
  bind("#release", async () => {
    await action("release", { id: t.id, token: leases.get(t.id).token });
    leases.delete(t.id);
    renderDetail(t.id);
  });
  bind("#verify", () =>
    action("verify", {
      id: t.id,
      check: $("#check").value,
      token: leases.get(t.id)?.token,
    }),
  );
  bind("#save-checkpoint", () =>
    action("checkpoint", {
      id: t.id,
      summary: $("#checkpoint").value,
      token: leases.get(t.id)?.token,
    }),
  );
}
document.querySelectorAll(".nav").forEach(
  (b) =>
    (b.onclick = () => {
      view = b.dataset.view;
      document
        .querySelectorAll(".nav")
        .forEach((n) => n.classList.toggle("active", n === b));
      render();
    }),
);
$("#search").oninput = render;
$("#projects").onchange = () => {
  selected = $("#projects").value;
  signature = "";
  refresh(true);
};
$("#new-task").onclick = () => $("#task-dialog").showModal();
document.querySelectorAll(".close").forEach(
  (b) =>
    (b.onclick = () => {
      b.closest("dialog").close();
      if (b.closest("dialog").id === "detail-dialog") currentDetail = null;
    }),
);
$("#task-form").onsubmit = async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await action("create", {
      title: form.get("title"),
      description: form.get("description"),
      acceptance: form.get("acceptance").split("\n").filter(Boolean),
      scope: form
        .get("scope")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      due: form.get("due") || undefined,
    });
    e.target.reset();
    $("#task-dialog").close();
  } catch (e) {
    notify(e.message);
  }
};
token = (await (await fetch("/api/session")).json()).token;
const events = new EventSource("/api/events");
events.onmessage = () => refresh();
events.onerror = () => ($("#connection").textContent = "Reconnecting");
await refresh(true);
