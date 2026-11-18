const DRAFT_KEY = "ezeizo-metis-draft-v1";
let draft = loadDraft();
const result = document.querySelector("#link-result");
const draftStatus = document.querySelector("#draft-status");

function loadDraft() {
  try {
    return EzEizoData.normalizeSheet(JSON.parse(localStorage.getItem(DRAFT_KEY))) || EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  } catch {
    return EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  }
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  result.hidden = true;
  draftStatus.textContent = "הטיוטה נשמרה במכשיר הזה";
}

document.querySelectorAll("[data-sheet-field]").forEach((input) => {
  const key = input.dataset.sheetField;
  input.value = draft[key] || "";
  input.addEventListener("input", () => { draft[key] = input.value; saveDraft(); });
});

function renderConstants() {
  const container = document.querySelector("#manager-constants");
  container.replaceChildren();
  Object.entries(draft.constants).forEach(([groupName, entries]) => {
    const section = document.createElement("section");
    section.className = "constant-group";
    const heading = document.createElement("h3");
    heading.textContent = groupName;
    const grid = document.createElement("div");
    grid.className = "manager-constant-list";
    entries.forEach(([label, value], index) => {
      const field = document.createElement("label");
      field.className = "manager-constant-row";
      const name = document.createElement("span");
      name.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.value = value;
      input.setAttribute("aria-label", `${groupName} ${label}`);
      input.addEventListener("input", () => { draft.constants[groupName][index][1] = input.value; saveDraft(); });
      field.append(name, input);
      grid.append(field);
    });
    section.append(heading, grid);
    container.append(section);
  });
}

function renderActions() {
  const container = document.querySelector("#manager-actions");
  container.replaceChildren();
  draft.actions.forEach((label, index) => {
    const row = document.createElement("label");
    row.className = "manager-action-row";
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const input = document.createElement("input");
    input.type = "text";
    input.value = label;
    input.setAttribute("aria-label", `פעולה ${index + 1}`);
    input.addEventListener("input", () => { draft.actions[index] = input.value; saveDraft(); });
    row.append(number, input);
    container.append(row);
  });
}

document.querySelector("#create-link").addEventListener("click", () => {
  const sheet = EzEizoData.normalizeSheet(draft);
  sheet.id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  EzEizoData.saveIssue(sheet);
  renderIssueLists();
  const url = new URL("../mechanic/", window.location.href);
  url.hash = `sheet=${EzEizoData.encodeSheet(sheet)}`;
  document.querySelector("#share-link").value = url.href;
  document.querySelector("#open-link").href = url.href;
  document.querySelector("#copy-status").textContent = "";
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

function issueLink(sheet) {
  const url = new URL("../mechanic/", window.location.href);
  url.hash = `sheet=${EzEizoData.encodeSheet(sheet)}`;
  return url.href;
}

function addIssueCard(container, item, isClosed) {
  const card = document.createElement("div");
  card.className = "issue-item";
  const title = document.createElement("strong");
  title.textContent = `${item.aircraft || "ללא מספר מטוס"} · ${item.location || "ללא מיקום"}`;
  const subtitle = document.createElement("span");
  subtitle.textContent = `${item.fault || "ללא תיאור"} · ${isClosed ? "סגורה" : "פתוחה"}`;
  card.append(title, subtitle);
  if (isClosed) {
    const details = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = "הצג פרטי סגירה";
    const description = document.createElement("p");
    description.textContent = `נסגרה: ${new Date(item.closedAt).toLocaleString("he-IL")} · שעת סיום: ${item.completionTime || "—"} · כל הפעולות סומנו: ${item.actionsComplete ? "כן" : "לא"} · טכנאים: ${item.technicians || "—"}`;
    const repair = document.createElement("p");
    repair.textContent = `תיאור תיקון: ${item.repair || "—"}`;
    const tables = document.createElement("p");
    tables.textContent = `יחידות שפורקו: ${item.removedCount || 0} · יחידות שהורכבו: ${item.installedCount || 0} · כלים: ${item.toolsCount || 0} · קשיחים שנלקחו: ${item.takenCount || 0} · קשיחים שנפסלו: ${item.rejectedCount || 0}`;
    details.append(heading, description, repair, tables);
    card.append(details);
  } else {
    const link = document.createElement("a");
    link.href = issueLink(item);
    link.textContent = "פתח או העתק קישור לטכנאי";
    link.target = "_blank";
    link.rel = "noopener";
    card.append(link);
  }
  container.append(card);
}

function renderIssueLists() {
  const opened = document.querySelector("#issued-list");
  const closed = document.querySelector("#closed-list");
  opened.replaceChildren();
  closed.replaceChildren();
  const closedIssues = EzEizoData.readClosed().filter((item) => item && typeof item.id === "string" && item.closedAt);
  const closedIds = new Set(closedIssues.map((item) => item.id));
  const activeIssues = EzEizoData.readIssues().filter((item) => item && typeof item.id === "string" && !closedIds.has(item.id));
  activeIssues.forEach((item) => addIssueCard(opened, item, false));
  closedIssues.forEach((item) => addIssueCard(closed, item, true));
  if (!activeIssues.length) opened.textContent = "אין תקלות פתוחות במכשיר הזה.";
  if (!closedIssues.length) closed.textContent = "אין תקלות סגורות במכשיר הזה.";
}

function importClosedLink(payload = new URLSearchParams(window.location.hash.slice(1)).get("closed")) {
  if (!payload) return false;
  const record = EzEizoData.decodePayload(payload);
  if (!record || typeof record.id !== "string" || record.id.length > 80 || !Number.isFinite(Date.parse(record.closedAt)) || record.actionsComplete !== true || !/^\d{2}:\d{2}$/.test(record.completionTime || "")) {
    draftStatus.textContent = "קישור הסגירה אינו תקין";
    return false;
  }
  const issue = EzEizoData.readIssues().find((item) => item.id === record.id);
  const safeRecord = {
    id: record.id,
    location: String(record.location || issue?.location || "").slice(0, 200),
    aircraft: String(record.aircraft || issue?.aircraft || "").slice(0, 200),
    fault: String(record.fault || issue?.fault || "").slice(0, 2000),
    technicians: String(record.technicians || issue?.technicians || "").slice(0, 200),
    closedAt: record.closedAt,
    completionTime: record.completionTime,
    actionsComplete: true,
    repair: String(record.repair || "").slice(0, 1200),
    removedCount: Math.max(0, Math.min(1000, Number(record.removedCount) || 0)),
    installedCount: Math.max(0, Math.min(1000, Number(record.installedCount) || 0)),
    toolsCount: Math.max(0, Math.min(1000, Number(record.toolsCount) || 0)),
    takenCount: Math.max(0, Math.min(1000, Number(record.takenCount) || 0)),
    rejectedCount: Math.max(0, Math.min(1000, Number(record.rejectedCount) || 0))
  };
  EzEizoData.saveClosed(safeRecord);
  history.replaceState(null, "", window.location.pathname + window.location.search);
  draftStatus.textContent = "התקלה הסגורה נוספה לרשימה במכשיר הזה";
  renderIssueLists();
  return true;
}

document.querySelector("#import-closed").addEventListener("click", () => {
  const status = document.querySelector("#import-closed-status");
  try {
    const url = new URL(document.querySelector("#import-closed-link").value);
    const expected = new URL("./", window.location.href);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || !importClosedLink(new URLSearchParams(url.hash.slice(1)).get("closed"))) throw new Error("invalid");
    document.querySelector("#import-closed-link").value = "";
    status.textContent = "הסגירה נוספה לרשימה";
  } catch { status.textContent = "לא נמצא בקישור דיווח סגירה תקין"; }
});

document.querySelector("#new-draft").addEventListener("click", () => {
  draft = EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  document.querySelectorAll("[data-sheet-field]").forEach((input) => { input.value = draft[input.dataset.sheetField] || ""; });
  renderConstants();
  renderActions();
  saveDraft();
  document.querySelector("#manager-details-title").scrollIntoView({ behavior: "smooth", block: "start" });
});

window.addEventListener("storage", renderIssueLists);
window.addEventListener("pageshow", renderIssueLists);

document.querySelector("#copy-link").addEventListener("click", async () => {
  const field = document.querySelector("#share-link");
  try {
    await navigator.clipboard.writeText(field.value);
    document.querySelector("#copy-status").textContent = "הקישור הועתק";
  } catch {
    field.focus();
    field.select();
    document.querySelector("#copy-status").textContent = "אפשר להעתיק את הקישור המסומן";
  }
});

renderConstants();
renderActions();
importClosedLink();
renderIssueLists();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
