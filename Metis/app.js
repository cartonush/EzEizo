import "../sheet-data.js?v=1.7.0";
import { gate, watchIssues, createIssue } from "../firebase-sync.js?v=1.7.0";

await gate("manager");
let cloudIssues = [];
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
  input.addEventListener("input", () => {
    draft[key] = input.value;
    if (key === "shelter" || key === "squadron") draft.location = [draft.shelter, draft.squadron].filter(Boolean).join("/");
    saveDraft();
  });
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
  EzEizoData.defaultSheet.actions.forEach((label, index) => {
    const row = document.createElement("div");
    row.className = "manager-action-row";
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const text = document.createElement("p");
    text.textContent = label;
    row.append(number, text);
    container.append(row);
  });
}

document.querySelector("#create-link").addEventListener("click", async () => {
  const button = document.querySelector("#create-link");
  button.disabled = true;
  const sheet = EzEizoData.normalizeSheet(draft);
  sheet.id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    sheet.serial = await createIssue(sheet);
    document.querySelector("#created-status").textContent = `תקלה מספר ${sheet.serial} נפתחה ותופיע אוטומטית אצל הטכנאי.`;
    window.location.hash = "open";
  } catch (error) { document.querySelector("#created-status").textContent = `פתיחת התקלה נכשלה: ${error.message}`; }
  finally { button.disabled = false; }
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
    const full = cloudIssues.find((issue) => issue.id === item.id);
    const state = full?.closed?.state;
    if (state) {
      const work = document.createElement("p");
      work.textContent = `פעולות: ${state.actions?.map((checked, index) => `${index + 1}: ${checked ? "✓" : "—"}`).join(" · ") || "—"}`;
      details.append(work);
      for (const [label, rows] of [["יחידות שפורקו", state.removed], ["יחידות שהורכבו", state.installed], ["כלים", state.tools], ["קשיחים שנלקחו", state.taken], ["קשיחים שנפסלו", state.rejected]]) {
        const list = document.createElement("p");
        list.textContent = `${label}: ${(rows || []).filter((row) => Object.values(row).some((value) => String(value).trim())).map((row) => Object.values(row).filter(Boolean).join(" · ")).join(" | ") || "אין"}`;
        details.append(list);
      }
      const names = document.createElement("p");
      names.textContent = `בודקים: ${[state.interimInspectorName, state.interimToolsName, state.finalInspectorName, state.finalLeadName].filter(Boolean).join(" · ") || "—"} · שעת עזיבה: ${state.departureTime || "—"} · חתימת קשיחים: ${[state.takenFullName, state.takenPersonalNumber, state.takenRank].filter(Boolean).join(" · ") || "—"}`;
      details.append(names);
      Object.entries(state).filter(([key, value]) => key.endsWith("Signature") && typeof value === "string" && value.startsWith("data:image/")).forEach(([key, value]) => {
        const figure = document.createElement("figure");
        const caption = document.createElement("figcaption"); caption.textContent = `חתימה: ${key}`;
        const signature = document.createElement("img"); signature.src = value; signature.alt = "חתימה"; signature.className = "closed-signature";
        figure.append(caption, signature); details.append(figure);
      });
    }
  }
  container.append(card);
}

function renderIssueLists() {
  const opened = document.querySelector("#issued-list");
  const closed = document.querySelector("#closed-list");
  opened.replaceChildren();
  closed.replaceChildren();
  const allClosed = cloudIssues.filter((item) => item.status === "closed" && item.closed?.record).map((item) => item.closed.record);
  const active = cloudIssues.filter((item) => item.status === "open").map((item) => item.sheet);
  active.forEach((item) => addIssueCard(opened, item, false));
  allClosed.forEach((item) => addIssueCard(closed, item, true));
  if (!active.length) opened.textContent = "אין תקלות פתוחות.";
  if (!allClosed.length) closed.textContent = "אין תקלות סגורות.";
}

function showManagerView() {
  const requested = window.location.hash.slice(1);
  const selected = ["new", "open", "closed"].includes(requested) ? requested : "new";
  document.querySelectorAll("[data-manager-view]").forEach((view) => { view.hidden = view.dataset.managerView !== selected; });
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    if (link.dataset.viewLink === selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (selected !== "new") renderIssueLists();
}
window.addEventListener("hashchange", showManagerView);
document.querySelector("#new-draft").addEventListener("click", () => {
  draft = EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  document.querySelectorAll("[data-sheet-field]").forEach((input) => { input.value = draft[input.dataset.sheetField] || ""; });
  renderConstants();
  renderActions();
  saveDraft();
  document.querySelector("#created-status").textContent = "";
  window.location.hash = "new";
  document.querySelector("#manager-details-title").scrollIntoView({ behavior: "smooth", block: "start" });
});

watchIssues((issues) => { cloudIssues = issues; renderIssueLists(); }, (error) => {
  document.querySelector("#issued-list").textContent = `לא ניתן לטעון תקלות: ${error.message}`;
  document.querySelector("#closed-list").textContent = `לא ניתן לטעון תקלות: ${error.message}`;
});
const locallyClosed = new Set(EzEizoData.readClosed().map((item) => item.id));
const legacy = EzEizoData.readIssues().filter((item) => item?.id && item.id !== "example" && !locallyClosed.has(item.id));
if (legacy.length) {
  const status = document.querySelector("#legacy-status");
  status.textContent = `נמצאו ${legacy.length} תקלות מקומיות ישנות. מעביר אותן למסד המשותף…`;
  let imported = 0;
  for (const item of legacy) {
    try { await createIssue(EzEizoData.normalizeSheet(item), true); imported++; }
    catch (error) { status.textContent = `הועברו ${imported} מתוך ${legacy.length}. שגיאה: ${error.message}`; break; }
  }
  if (imported === legacy.length) status.textContent = `${imported} תקלות מקומיות הועברו למסד המשותף.`;
}
renderConstants();
renderActions();
renderIssueLists();
showManagerView();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
