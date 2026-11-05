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
const localDashboard = document.documentElement.dataset.dashboard === "local";
const initialQuery = new URLSearchParams(location.search);
let catalog = {
    projects: [],
    projectCount: 0,
    favoriteCount: 0,
    worktreeCount: 0,
    errors: [],
    file: "Loading local directory…",
  },
  refreshGeneration = 0,
  refreshInFlight = 0;
let state = { tasks: [], activity: [], checks: [] },
  view = localDashboard
    ? initialQuery.get("root")
      ? "overview"
      : "projects"
    : "overview",
  selected = new URLSearchParams(location.search).get("root") || "",
  token = "",
  signature = "",
  currentDetail = null;
let editingTask = null;
let favoritesOnly = initialQuery.get("favorites") === "1";
const pendingFavorites = new Set();
if (
  localDashboard &&
  ["projects", "overview", "board", "activity", "schedule"].includes(
    initialQuery.get("view"),
  )
)
  view = initialQuery.get("view");
let healthAt = 0,
  healthRoot = "";
const leases = new Map();
// Unsaved inputs in the detail dialog, kept when the same task re-renders.
const drafts = [
  "finish-outcome",
  "finish-summary",
  "finish-replacements",
  "document-query",
  "checkpoint",
];
let draftKey = "",
  draftGeneration = 0;
// A response may arrive after editing, switching tasks, or reopening the dialog.
// Clear only the submitted, unchanged form in the same dialog lifetime.
function clearSubmittedDraft(ids) {
  const key = draftKey,
    generation = draftGeneration,
    submitted = ids.map((id) => [id, $("#" + id).value]);
  return () => {
    if (
      !$("#detail-dialog").open ||
      key !== draftKey ||
      key !== selected + "\n" + currentDetail ||
      generation !== draftGeneration ||
      submitted.some(([id, value]) => $("#" + id)?.value !== value)
    )
      return;
    for (const [id] of submitted) {
      const node = $("#" + id);
      if (node.tagName !== "SELECT") node.value = "";
    }
  };
}
const url = (p) =>
  p + (selected ? "?root=" + encodeURIComponent(selected) : "");
const label = (t) =>
  t.conflicts.length
    ? "conflict"
    : t.activityState
      ? t.activityState
      : t.active
        ? "running"
        : t.verification === "stale" && t.status === "verified"
          ? "stale"
          : t.kind === "discussion" && t.resolution?.outcome === "answered"
            ? "answered"
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
    body: JSON.stringify({ action, args: { actor: "dashboard", ...args } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  await refresh(true);
  return data;
}
async function refresh(force = false) {
  const generation = ++refreshGeneration;
  refreshInFlight++;
  try {
    let projects;
    if (localDashboard) {
      const response = await fetch("/api/catalog");
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Catalog unavailable");
      if (generation !== refreshGeneration) return;
      catalog = data;
      projects = catalog.projects.flatMap((p) =>
        p.worktrees.map((w) => w.path),
      );
      $("#app-version").textContent = `v${catalog.version} · Local projects`;
    } else projects = await (await fetch("/api/projects")).json();
    if (generation !== refreshGeneration) return;
    const select = $("#projects");
    const values = JSON.stringify(localDashboard ? catalog.projects : projects);
    if (values !== select.dataset.values) {
      if (selected && !projects.includes(selected)) {
        selected = "";
        currentDetail = null;
        $("#detail-dialog").close();
        $("#task-dialog").close();
        if (localDashboard) {
          view = "projects";
          $("#search").value = "";
          updateLocation();
        }
      }
      select.innerHTML = localDashboard
        ? '<option value="">Choose a local project</option>' +
          catalog.projects
            .map(
              (p) =>
                `<optgroup label="${escape((p.favorite ? "★ " : "") + p.name + " · " + p.root)}">${p.worktrees.map((w) => `<option value="${escape(w.path)}">${escape(short(w.path))} · ${escape(w.path)}</option>`).join("")}</optgroup>`,
            )
            .join("")
        : projects
            .map(
              (p) =>
                `<option value="${escape(p)}">${escape(short(p))}</option>`,
            )
            .join("");
      select.dataset.values = values;
      if (selected) select.value = selected;
      else if (!localDashboard) selected = select.value;
    }
    if (localDashboard && (view === "projects" || !selected)) {
      view = "projects";
      $("#connection").textContent = "Local connection active";
      $(".sidebar-bottom").dataset.connected = "true";
      $("#updated").textContent = "Updated " + new Date().toLocaleTimeString();
      const next = JSON.stringify(catalog);
      if (force || next !== signature) {
        signature = next;
        render();
      }
      return;
    }
    const requestedRoot = selected;
    const data = await (await fetch(url("/api/state"))).json();
    if (generation !== refreshGeneration || requestedRoot !== selected) return;
    if (data.error) throw new Error(data.error);
    state = data;
    $("#app-version").textContent = `v${data.version} · Apache-2.0`;
    if (selected !== healthRoot || Date.now() - healthAt > 10000) {
      const health = await (await fetch(url("/api/health"))).json();
      if (generation !== refreshGeneration || requestedRoot !== selected)
        return;
      healthAt = Date.now();
      healthRoot = selected;
      const messages = [...(health.issues || []), ...(health.advisories || [])];
      $("#automation-status").className = messages.length
        ? "automation warning"
        : "automation";
      $("#automation-status").textContent = messages.length
        ? messages.join(" ")
        : `Recorder running · ${health.watcherAttached ? "Project watcher active" : "Hooks available"} · ${health.agentCapture?.status === "observed" ? "Agent prompt capture observed" : "Agent prompts not observed in this project; check host hooks and trust"}`;
    }
    $("#connection").textContent = "Local connection active";
    $(".sidebar-bottom").dataset.connected = "true";
    $("#branch").textContent = state.repo?.branch || "No project yet";
    $("#updated").textContent = "Updated " + new Date().toLocaleTimeString();
    const next = JSON.stringify([data, localDashboard ? catalog : null]);
    if (force || next !== signature) {
      signature = next;
      render();
      if (currentDetail && $("#detail-dialog").open)
        renderDetail(currentDetail);
    }
  } catch (e) {
    if (generation !== refreshGeneration) return;
    $("#connection").textContent = "Connection unavailable";
    $(".sidebar-bottom").dataset.connected = "false";
    notify(e.message);
  } finally {
    refreshInFlight--;
  }
}
function updateLocation() {
  if (!localDashboard) return;
  const query = new URLSearchParams();
  if (selected) query.set("root", selected);
  if (favoritesOnly) query.set("favorites", "1");
  if (view !== "overview" && !(view === "projects" && !selected))
    query.set("view", view);
  history.replaceState(null, "", "/local" + (query.size ? "?" + query : ""));
}
function updateNavigation() {
  document.querySelectorAll(".nav[data-view]").forEach((node) => {
    const active = node.dataset.view === view;
    node.classList.toggle("active", active);
    if (active) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
}
async function chooseProject(root) {
  selected = root;
  $("#projects").value = selected;
  currentDetail = null;
  editingTask = null;
  $("#detail-dialog").close();
  $("#task-dialog").close();
  state = { tasks: [], activity: [], checks: [] };
  signature = "";
  $("#search").value = "";
  healthAt = 0;
  if (localDashboard) {
    view = selected ? "overview" : "projects";
    updateLocation();
    updateNavigation();
  }
  $("#new-task").disabled = true;
  $("#content").innerHTML = '<div class="empty">Loading project…</div>';
  await refresh(true);
}
function projectCard(p) {
  const favoriteLabel =
    (p.favorite ? "Remove from favorites: " : "Add to favorites: ") + p.name;
  return `<article class="project-card" data-project-id="${escape(p.id)}" data-favorite="${!!p.favorite}">
    <div class="project-card-header"><span class="badge">Local project</span>
      <button class="favorite-star" data-favorite-id="${escape(p.id)}" data-favorite-next="${!p.favorite}" aria-pressed="${!!p.favorite}" aria-label="${escape(favoriteLabel)}" title="${escape(favoriteLabel)}" ${pendingFavorites.has(p.id) ? "disabled" : ""}>${p.favorite ? "★" : "☆"}</button>
    </div>
    <h3 dir="auto">${escape(p.name)}</h3><p class="project-path" dir="auto">${escape(p.root)}</p>
    <div class="project-actions"><button class="primary" data-project-root="${escape(p.root)}">Open project</button><a href="${escape(p.links.dashboard)}" target="_blank" rel="noopener">Project dashboard ↗</a><button data-open-folder="${escape(p.root)}">Open folder</button><button data-copy-path="${escape(p.root)}">Copy path</button></div>
    <details><summary>${p.worktrees.length} worktree${p.worktrees.length === 1 ? "" : "s"}</summary>${p.worktrees.map((w) => `<div class="worktree-link"><button data-project-root="${escape(w.path)}">${escape(short(w.path))}</button><code dir="auto">${escape(w.path)}</code></div>`).join("")}</details>
  </article>`;
}
function renderProjectCatalog() {
  const query = $("#search").value.toLocaleLowerCase();
  const projects = catalog.projects.filter(
    (p) =>
      (!favoritesOnly || p.favorite) &&
      JSON.stringify([p.name, p.root, p.worktrees.map((w) => w.path)])
        .toLocaleLowerCase()
        .includes(query),
  );
  $("#heading").textContent = favoritesOnly
    ? "Favorite projects"
    : "All local projects";
  $(".subtitle").textContent =
    "Choose a project to see its tasks, handoffs, activity and verification.";
  $("#section-label").textContent = "PROJECTS ON THIS COMPUTER";
  $("#branch").textContent = "Local workspace";
  $("#automation-status").className = "automation";
  $("#automation-status").textContent = "Project directory: " + catalog.file;
  $("#metrics").innerHTML = [
    ["Local projects", catalog.projectCount],
    ["Favorites", catalog.favoriteCount || 0],
    ["Worktrees", catalog.worktreeCount],
    ["Matching projects", projects.length],
  ]
    .map(
      ([label, count]) =>
        `<div class="metric"><div class="metric-label">${label}</div><div class="metric-number">${count}</div><div class="metric-note">Available on this computer</div></div>`,
    )
    .join("");
  $("#content").innerHTML =
    '<div class="project-grid">' +
    (projects.map(projectCard).join("") ||
      '<div class="empty">' +
        (favoritesOnly
          ? "No matching favorite projects. <button data-show-all-projects>Show all projects</button>"
          : "No matching local projects.") +
        "</div>") +
    "</div>";
  document
    .querySelectorAll("[data-project-root]")
    .forEach(
      (button) =>
        (button.onclick = () => chooseProject(button.dataset.projectRoot)),
    );
  document.querySelectorAll("[data-favorite-id]").forEach(
    (button) =>
      (button.onclick = async () => {
        const id = button.dataset.favoriteId;
        if (pendingFavorites.has(id)) return;
        pendingFavorites.add(id);
        button.disabled = true;
        try {
          const favorite = button.dataset.favoriteNext === "true";
          const response = await fetch("/api/project-favorite", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-dip-token": token,
            },
            body: JSON.stringify({ id, favorite }),
          });
          const data = await response.json();
          if (!response.ok)
            throw Error(data.error || "Favorite could not be saved");
          await refresh(true);
          notify(
            data.favorite ? "Added to favorites." : "Removed from favorites.",
          );
        } catch (error) {
          notify(error.message);
        } finally {
          pendingFavorites.delete(id);
          document.querySelectorAll("[data-favorite-id]").forEach((node) => {
            node.disabled = pendingFavorites.has(node.dataset.favoriteId);
          });
        }
      }),
  );
  $("[data-show-all-projects]")?.addEventListener("click", () => {
    favoritesOnly = false;
    updateLocation();
    render();
  });
  document.querySelectorAll("[data-copy-path]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copyPath);
          notify("Project path copied.");
        } catch {
          notify("Project path: " + button.dataset.copyPath);
        }
      }),
  );
  document.querySelectorAll("[data-open-folder]").forEach(
    (button) =>
      (button.onclick = async () => {
        button.disabled = true;
        try {
          const response = await fetch(
            "/api/open-project?root=" +
              encodeURIComponent(button.dataset.openFolder),
            { method: "POST", headers: { "x-dip-token": token } },
          );
          const data = await response.json();
          if (!response.ok)
            throw Error(data.error || "Folder could not be opened");
          notify("Opened " + data.root);
        } catch (error) {
          notify(error.message);
        } finally {
          button.disabled = false;
        }
      }),
  );
  if (catalog.errors.length)
    notify(
      "Some project entries need attention: " +
        catalog.errors.map((e) => e.error).join("; "),
    );
}
function card(t) {
  return `<button class="card" data-task="${escape(t.id)}"><span class="badge ${label(t)}">${escape(label(t) === "responded" ? "Response recorded" : label(t).replaceAll("_", " "))}</span><h3>${escape(t.title)}</h3><p>${escape(t.scope.join(" · ") || t.description.slice(0, 100) || "Scope not yet specified")}</p><div class="card-footer"><span>${escape(t.lease?.actor || "Unassigned")}</span><span>${t.due ? escape(t.due) : escape(t.id.slice(-8))}</span></div></button>`;
}
function column(title, tasks) {
  return `<div><h2 class="column-title">${title}<span>${tasks.length}</span></h2>${tasks.length ? tasks.map(card).join("") : '<div class="empty"><strong>A little room for what’s next.</strong>Saved work will appear here.</div>'}</div>`;
}
function render() {
  updateNavigation();
  const favoritesFilter = $("#favorites-filter");
  if (favoritesFilter) {
    favoritesFilter.hidden = view !== "projects";
    favoritesFilter.setAttribute("aria-pressed", String(favoritesOnly));
  }
  $("#task-kind").hidden = view === "projects";
  $("#search").placeholder =
    view === "projects"
      ? "Search local projects or paths"
      : "Search tasks, agents, or scope";
  $("#search").setAttribute(
    "aria-label",
    view === "projects" ? "Search local projects" : "Search tasks",
  );
  $("#new-task").disabled = view === "projects" || !state.repo;
  if (view === "projects") {
    renderProjectCatalog();
    return;
  }
  if (localDashboard) $(".subtitle").textContent = selected;
  const tasks = (state.tasks || []).filter((t) =>
      $("#task-kind").value === "requests"
        ? t.requestState === "captured" &&
          t.kind !== "work" &&
          !["implemented", "verified", "cancelled", "superseded"].includes(
            t.status,
          )
        : $("#task-kind").value === "all" ||
          (t.kind || "work") === $("#task-kind").value,
    ),
    query = $("#search").value.toLowerCase(),
    filtered = tasks.filter((t) =>
      JSON.stringify([t.title, t.description, t.scope, t.lease?.actor])
        .toLowerCase()
        .includes(query),
    );
  const metrics = [
    [
      "Active agents",
      new Set((state.activeWorkers || []).map((w) => w.actor)).size,
      "Across local worktrees",
    ],
    [
      "Needs attention",
      tasks.filter(
        (t) =>
          t.inactive ||
          t.conflicts.length ||
          t.blockedBy.length ||
          (t.status === "verified" && t.verification === "stale"),
      ).length,
      "Unfinished, blocked or conflicting",
    ],
    [
      "Verified now",
      tasks.filter((t) => t.verifiedComplete).length,
      "Evidence matches current code",
    ],
    [
      "Implemented",
      tasks.filter(
        (t) =>
          t.status === "implemented" && t.resolution?.outcome !== "answered",
      ).length,
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
    schedule: "Schedule & priorities",
  }[view];
  $("#section-label").textContent = {
    overview: "YOUR WORK, AT A GLANCE",
    board: "PERSISTENT TASKS",
    activity: "AUTOMATIC EVENT STREAM",
    schedule: "TARGET DATES & DEPENDENCIES",
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
  else if (view === "schedule") {
    const today = new Date().toLocaleDateString("en-CA"),
      scheduled = filtered
        .filter(
          (t) =>
            !t.verifiedComplete &&
            t.resolution?.outcome !== "answered" &&
            !["cancelled", "superseded"].includes(t.status),
        )
        .sort(
          (a, b) =>
            (a.due || "9999").localeCompare(b.due || "9999") ||
            (a.priority || 3) - (b.priority || 3),
        );
    $("#content").innerHTML = `<div class="columns">${column(
      "Overdue",
      scheduled.filter((t) => t.due && t.due < today),
    )}${column(
      "Upcoming",
      scheduled.filter((t) => t.due && t.due >= today),
    )}${column(
      "No target date",
      scheduled.filter((t) => !t.due),
    )}</div>`;
  } else if (view === "board")
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
          t.resolution?.outcome !== "answered" &&
          (["implemented", "blocked", "conflict"].includes(t.status) ||
            (t.status === "verified" && t.verification === "stale")),
      ),
    )}${column(
      "Finished / replaced",
      filtered.filter(
        (t) =>
          t.verifiedComplete ||
          t.resolution?.outcome === "answered" ||
          ["superseded", "cancelled"].includes(t.status),
      ),
    )}</div>`;
  else
    $("#content").innerHTML = `<div class="columns">${column(
      "Running & unfinished",
      filtered.filter((t) => t.active || t.inactive),
    )}${column(
      "Ready & remembered",
      filtered.filter((t) => ["backlog", "ready"].includes(t.status)),
    )}${column(
      "Review & recent completion",
      filtered.filter((t) =>
        [
          "implemented",
          "verified",
          "blocked",
          "conflict",
          "superseded",
          "cancelled",
        ].includes(t.status),
      ),
    )}</div>`;
  const elsewhere = (state.activeWorkers || []).filter(
    (w) => w.root && w.root !== state.repo?.root,
  );
  if (elsewhere.length && view !== "activity") {
    $("#content").insertAdjacentHTML(
      "beforeend",
      `<div class="worker-section"><h2>Workers in other worktrees</h2><div class="columns">${elsewhere.map((w) => `<button class="card" data-worker-root="${escape(w.root)}"><span class="badge running">running</span><h3>${escape(w.title || w.task)}</h3><p>${escape(w.actor)} · ${escape(w.branch)}</p><p>${escape(w.scope.join(" · "))}</p><small title="${escape(w.root)}">${escape(short(w.root))}</small></button>`).join("")}</div></div>`,
    );
    document.querySelectorAll("[data-worker-root]").forEach(
      (b) =>
        (b.onclick = async () => {
          await chooseProject(b.dataset.workerRoot);
        }),
    );
  }
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
  const dialog = $("#detail-dialog"),
    key = selected + "\n" + t.id,
    same = dialog.open && draftKey === key,
    kept = same
      ? drafts
          .map((id) => [id, $("#" + id)?.value])
          .filter(([, v]) => v != null)
      : [],
    focused =
      same && $("#detail").contains(document.activeElement)
        ? document.activeElement
        : null,
    caret = [
      focused?.selectionStart,
      focused?.selectionEnd,
      focused?.selectionDirection,
    ],
    scroll = dialog.scrollTop;
  if (!same) draftGeneration++;
  $("#detail-title").textContent = t.title;
  $("#detail").innerHTML =
    `<span class="badge ${label(t)}">${escape(label(t) === "responded" ? "Response recorded" : label(t))}</span> <small>${escape(t.id)}</small><div class="detail-section"><h3>Intent</h3><p>${escape(t.description || "No description")}</p><p>Scope: ${escape(t.scope.join(", ") || "Not specified")}<br>Depends on: ${escape(t.dependencies.join(", ") || "None")}<br>In current branch: ${escape(state.repo.branch)}</p>${(t.acceptance || []).map((a) => `<p>□ ${escape(a)}</p>`).join("")}</div><div class="detail-actions"><select id="task-status" aria-label="Task status">${["backlog", "ready", "in_progress", "blocked", "implemented", "cancelled", "superseded"].map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select><button id="save-status">Update status</button><button id="claim">Claim task</button>${leases.has(t.id) ? '<button id="release">Release</button>' : ""}</div>${t.conflicts.length ? `<div class="detail-section"><h3>Competing updates</h3>${t.conflicts.map((c) => `<p>${escape(c.field)}: ${escape(c.alternatives.map((a) => JSON.stringify(a.value)).join(" / "))}</p>`).join("")}<button id="resolve">Resolve with selected status</button></div>` : ""}<div class="detail-section"><h3>Verification</h3><p>${escape(t.verification || "missing")} evidence · ${t.integrated ? "Integrated in current history" : "Integration not established"}</p>${state.checks.length ? `<select id="check">${state.checks.map((c) => `<option>${escape(c)}</option>`).join("")}</select><button id="verify">Run configured check</button>` : "<p>Configure checks in .dip/config.json to verify this task.</p>"}${t.evidence.map((e) => `<p><span class="badge ${escape(e.result)}">${escape(e.result)}</span> ${escape(e.check)} · ${escape(date(e.at))}</p>`).join("")}</div><div class="detail-section"><h3>Latest handoff</h3><p>${escape(([...t.checkpoints].reverse().find((c) => !c.automatic) || t.checkpoints.at(-1))?.summary || "No checkpoint")}</p><textarea id="checkpoint" rows="3" placeholder="What was done, what remains, and the next step"></textarea><button id="save-checkpoint">Save meaningful checkpoint</button></div><div class="detail-section"><h3>History</h3>${t.history
      .slice(-15)
      .reverse()
      .map(
        (e) =>
          `<div class="history-row">${escape(e.type)} · <small>${escape(e.actor)} · ${escape(date(e.createdAt))}</small></div>`,
      )
      .join("")}</div>`;
  if (t.inactive || t.activityState === "responded") {
    const explanation =
      t.activityState === "responded"
        ? "The host recorded an assistant response. This does not establish that the request was fulfilled or verified."
        : t.interrupted
          ? "The host explicitly reported an interruption or failure."
          : "No worker is active. No explicit interruption or verified completion was recorded.";
    $("#detail").insertAdjacentHTML(
      "afterbegin",
      `<p class="activity-explanation">${escape(explanation)}</p>`,
    );
  }
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
  $("#detail").insertAdjacentHTML(
    "afterbegin",
    `<div class="detail-section" id="linked-documents"><h3>Linked documents</h3><p>Source documents are read on demand. Task status and verification stay in DIP.</p><label>Find sections <input id="document-query" placeholder="Heading or keywords" maxlength="1000"></label><div id="document-links"></div><div id="document-preview" aria-live="polite"></div></div>`,
  );
  renderDocuments(t).catch((e) => notify(e.message));
  const paused = [...t.checkpoints]
    .reverse()
    .find((c) => !c.automatic && c.remaining);
  if (paused && !t.resolution)
    $("#detail").insertAdjacentHTML(
      "afterbegin",
      `<div class="detail-section"><h3>Remaining work</h3>${paused.remaining.map((r) => `<p>${escape(r.disposition)}: ${escape(r.summary)}</p>`).join("")}</div>`,
    );
  $("#detail").insertAdjacentHTML(
    "afterbegin",
    `<div class="detail-section" id="finish-section"><h3>Outcome</h3>${t.resolution ? `<p>${escape(t.resolution.outcome)}: ${escape(t.resolution.summary)}</p>${t.resolution.replacedBy.map((id) => `<button data-replacement="${escape(id)}">View replacement ${escape(id.slice(-8))}</button>`).join("")}` : "<p>Record an outcome explicitly. Implemented work still needs configured verification.</p>"}<label>Outcome<select id="finish-outcome">${(t.kind === "discussion" ? ["answered", "superseded", "cancelled"] : ["implemented", ...(!t.scope.length && !t.acceptance.length && !t.evidence.length ? ["answered"] : []), "superseded", "cancelled"]).map((o) => `<option>${o}</option>`).join("")}</select></label><label>Summary<textarea id="finish-summary" maxlength="2000" rows="2"></textarea></label><label>Replacement task IDs<input id="finish-replacements" placeholder="Required only for superseded"></label><button id="finish-task">Save outcome</button></div>`,
  );
  document.querySelectorAll("[data-replacement]").forEach(
    (button) =>
      (button.onclick = () => {
        currentDetail = button.dataset.replacement;
        renderDetail(currentDetail);
      }),
  );
  bind("#finish-task", async () => {
    const clear = clearSubmittedDraft([
      "finish-outcome",
      "finish-summary",
      "finish-replacements",
    ]);
    const result = await action("finish", {
      id: t.id,
      outcome: $("#finish-outcome").value,
      summary: $("#finish-summary").value,
      replacedBy: $("#finish-replacements")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      token: leases.get(t.id)?.token,
    });
    if (result.released) leases.delete(t.id);
    clear();
  });
  if (t.plan) {
    const input = t.plan.input,
      steps = input.plan || input.todos || input.steps,
      content = Array.isArray(steps)
        ? steps
            .map(
              (s) =>
                `${s.status || "pending"}: ${s.step || s.content || s.title || ""}`,
            )
            .join("\n")
        : input.text || JSON.stringify(input, null, 2);
    $("#detail").insertAdjacentHTML(
      "afterbegin",
      `<div class="detail-section" id="captured-plan"><h3>Latest plan</h3><small>${escape(t.plan.tool)} · ${escape(date(t.plan.at))}</small><p>Plan progress and passing checks do not finish open work. Completion requires an explicit finish and a current configured check.</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(content)}</pre></div>`,
    );
  }
  $("#detail").insertAdjacentHTML(
    "afterbegin",
    '<button id="edit-intent">Edit requirements & schedule</button>',
  );
  bind("#edit-intent", () => {
    editingTask = t.id;
    const form = $("#task-form");
    for (const field of ["title", "description", "due"])
      form.elements[field].value = t[field] || "";
    form.elements.acceptance.value = (t.acceptance || []).join("\n");
    form.elements.scope.value = t.scope.join(", ");
    form.elements.dependencies.value = t.dependencies.join(", ");
    form.elements.priority.value = t.priority || 3;
    $("#task-form-title").textContent = "Update requirements & schedule";
    $("#detail-dialog").close();
    currentDetail = null;
    $("#task-dialog").showModal();
  });
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
  bind("#save-checkpoint", async () => {
    const clear = clearSubmittedDraft(["checkpoint"]);
    await action("checkpoint", {
      id: t.id,
      summary: $("#checkpoint").value,
      token: leases.get(t.id)?.token,
    });
    clear();
  });
  draftKey = key;
  for (const [id, value] of kept) {
    const node = $("#" + id);
    // Requirement changes can make a previously selected outcome unavailable.
    if (
      node &&
      (node.tagName !== "SELECT" ||
        [...node.options].some((o) => o.value === value))
    )
      node.value = value;
  }
  const refocus = focused?.id && $("#" + focused.id);
  if (refocus) {
    refocus.focus({ preventScroll: true });
    if (caret[0] != null) refocus.setSelectionRange(...caret);
  }
  if (same) dialog.scrollTop = scroll;
}

async function documentAction(action, args) {
  const res = await fetch(url("/api/action"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dip-token": token },
    body: JSON.stringify({ action, args }),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Document unavailable");
  return result;
}

async function renderDocuments(task) {
  const container = $("#document-links"),
    projectRoot = selected;
  if (!task.documents?.length) {
    container.textContent = "No linked documents yet.";
    return;
  }
  const data = await documentAction("document-list", { id: task.id });
  if (
    currentDetail !== task.id ||
    selected !== projectRoot ||
    !container.isConnected
  )
    return;
  container.innerHTML =
    data.documents
      .map(
        (d, i) =>
          `<div class="document-row"><button data-document="${i}">${escape(d.path)}</button><small>${escape(d.role)} · ${escape(d.currentness)} · ${escape(d.hash?.slice(0, 12) || "competing versions")}</small></div>`,
      )
      .join("") +
    (data.nextOffset
      ? "<p>More documents are available through DIP tools.</p>"
      : "");
  container.querySelectorAll("[data-document]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        const d = data.documents[Number(button.dataset.document)],
          result = await documentAction("document-read", {
            id: task.id,
            path: d.path,
            role: d.role,
            query: $("#document-query").value,
            maxChars: 12000,
          });
        if (
          currentDetail !== task.id ||
          selected !== projectRoot ||
          !container.isConnected
        )
          return;
        $("#document-preview").innerHTML =
          `<p>${escape(result.path)} · ${escape(result.currentness)} · ${escape(result.currentHash.slice(0, 12))}</p><p>Source text; checkboxes do not establish completion.</p>${result.sections.map((s) => `<h4>${escape(s.heading)}</h4><small>Lines ${s.startLine} to ${s.endLine}${s.truncated ? " · excerpt truncated" : ""}</small><pre class="document-excerpt">${escape(s.text)}</pre>`).join("") || "<p>No matching sections.</p>"}`;
      } catch (e) {
        notify(e.message);
      } finally {
        button.disabled = false;
      }
    };
  });
}
document.querySelectorAll(".nav[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      if ((view === "projects") !== (b.dataset.view === "projects"))
        $("#search").value = "";
      view = b.dataset.view;
      document.querySelectorAll(".nav").forEach((n) => {
        n.classList.toggle("active", n === b);
        if (n === b) n.setAttribute("aria-current", "page");
        else n.removeAttribute("aria-current");
      });
      render();
      if (localDashboard) {
        updateLocation();
        refresh(true);
      }
    }),
);
$("#search").oninput = render;
if ($("#favorites-filter"))
  $("#favorites-filter").onclick = () => {
    favoritesOnly = !favoritesOnly;
    updateLocation();
    render();
  };
$("#task-kind").onchange = render;
$("#projects").onchange = () => {
  chooseProject($("#projects").value);
};
$("#new-task").onclick = () => {
  editingTask = null;
  $("#task-form").reset();
  $("#task-form-title").textContent = "Save a task or future idea";
  $("#task-dialog").showModal();
};
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
    const payload = {
      title: form.get("title"),
      description: form.get("description"),
      acceptance: form.get("acceptance").split("\n").filter(Boolean),
      scope: form
        .get("scope")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      due: form.get("due") || "",
      priority: Number(form.get("priority")),
      dependencies: form
        .get("dependencies")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (editingTask)
      await action("update", {
        id: editingTask,
        patch: payload,
        token: leases.get(editingTask)?.token,
      });
    else await action("create", payload);
    editingTask = null;
    e.target.reset();
    $("#task-dialog").close();
  } catch (e) {
    notify(e.message);
  }
};
token = (await (await fetch("/api/session")).json()).token;
const events = new EventSource("/api/events");
events.onmessage = () => {
  if (!refreshInFlight) refresh();
};
events.onerror = () => {
  $("#connection").textContent = "Reconnecting";
  $(".sidebar-bottom").dataset.connected = "false";
};
await refresh(true);
