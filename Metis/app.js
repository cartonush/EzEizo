const DRAFT_KEY = "ezeizo-metis-draft-v1";
let draft = loadDraft();
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
  sheet.id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sheet.serial = EzEizoData.nextSerial();
  EzEizoData.saveIssue(sheet);
  document.querySelector("#created-status").textContent = `תקלה מספר ${sheet.serial} נפתחה ונוספה לרשימה`;
  renderIssueLists();
  document.querySelector("#issued-title").scrollIntoView({ behavior: "smooth", block: "start" });
});

function addIssueCard(container, item, isClosed) {
  const card = document.createElement("div");
  card.className = "issue-item";
  const title = document.createElement("strong");
  title.textContent = `תקלה ${item.serial || "ללא מספר"} · מטוס ${item.aircraft || "—"} · ${item.location || "—"}`;
  const subtitle = document.createElement("span");
  subtitle.textContent = `${item.fault || "ללא תיאור"} · ${isClosed ? "סגורה" : "פתוחה"}`;
  card.append(title, subtitle);
  if (isClosed) {
    const details = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = "הצג דף סגור";
    const description = document.createElement("p");
    description.textContent = `נסגרה: ${new Date(item.closedAt).toLocaleString("he-IL")} · שעת סיום: ${item.completionTime || "—"} · כל הפעולות סומנו: ${item.actionsComplete ? "כן" : "לא"} · טכנאים: ${item.technicians || "—"}`;
    const repair = document.createElement("p");
    repair.textContent = `תיאור תקלה: ${item.fault || "—"} · תיאור תיקון: ${item.repair || "—"}`;
    const tables = document.createElement("p");
    tables.textContent = `יחידות שפורקו: ${item.removedCount || 0} · יחידות שהורכבו: ${item.installedCount || 0} · כלים: ${item.toolsCount || 0} · קשיחים שנלקחו: ${item.takenCount || 0} · קשיחים שנפסלו: ${item.rejectedCount || 0}`;
    details.append(heading, description, repair, tables);
    card.append(details);
    const view = document.createElement("a");
    view.href = `../mechanic/?id=${encodeURIComponent(item.id)}`;
    view.textContent = "צפה בדף הסגור";
    card.append(view);
  }
  container.append(card);
}

function renderIssueLists() {
  const opened = document.querySelector("#issued-list");
  const closed = document.querySelector("#closed-list");
  opened.replaceChildren();
  closed.replaceChildren();
  const allClosed = EzEizoData.readClosed().filter((item) => item && typeof item.id === "string" && item.closedAt);
  const closedIds = new Set(allClosed.map((item) => item.id));
  const active = EzEizoData.readIssues().filter((item) => item && typeof item.id === "string" && !closedIds.has(item.id));
  const search = document.querySelector("#closed-search").value.trim();
  active.forEach((item) => addIssueCard(opened, item, false));
  allClosed.filter((item) => !search || String(item.serial || "").includes(search)).forEach((item) => addIssueCard(closed, item, true));
  if (!active.length) opened.textContent = "אין תקלות פתוחות במכשיר הזה.";
  if (!closed.childElementCount) closed.textContent = search ? "לא נמצאה תקלה סגורה במספר הזה." : "אין תקלות סגורות במכשיר הזה.";
}

document.querySelector("#closed-search").addEventListener("input", renderIssueLists);
document.querySelector("#new-draft").addEventListener("click", () => {
  draft = EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  document.querySelectorAll("[data-sheet-field]").forEach((input) => { input.value = draft[input.dataset.sheetField] || ""; });
  renderConstants();
  renderActions();
  saveDraft();
  document.querySelector("#created-status").textContent = "";
  document.querySelector("#manager-details-title").scrollIntoView({ behavior: "smooth", block: "start" });
});

window.addEventListener("storage", renderIssueLists);
window.addEventListener("pageshow", renderIssueLists);
renderConstants();
renderActions();
renderIssueLists();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
