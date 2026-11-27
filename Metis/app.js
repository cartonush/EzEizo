import "../sheet-data.js?v=1.7.6";
import { gate, revealApp, watchIssues, refreshManagerIssues, watchKeyLoads, watchAccounts, setAttendanceStatus, createIssue, createAssignedIssues, createManualIssue, createTechnician, setTechnicianPersonalNumber, updateAccountProfile, resetUserPassword, updateOpenIssueDefinition, setTechnicianActive, deleteTechnicianPermanently, assignIssue, appendIssueManagerNote, cancelIssueDispatch, closePrintedIssue } from "../firebase-sync.js?v=1.9.23";
import { SQUADRONS, SYSTEMS, COMPONENTS_BY_SYSTEM, WORKSHOPS, EW_SYSTEMS, validateCatalogSelection } from "./catalog.js?v=1.9.0";
import { initCatalogAdmin } from "./catalog-admin.js?v=1.9.23";
import { initCatalogView } from "./catalog-view.js?v=1.9.23";
import { resolveAssignees } from "./assignee-selection.js?v=1.7.6";
import { attachSignaturePad } from "../signature-canvas.js?v=1.9.31";
import { createEditLock } from "../edit-lock.js?v=1.9.23";
import { initKeyPages } from "../keys/app.js?v=1.9.31";
import { initReports, updateReportData, initAircraftConstants, constantsForAircraft, closeConstantsEditor } from "./management-pages.js?v=1.9.26";
import { FAULT_FILTERS, ORIGINS, filterIssues, componentHistory } from "./fault-taxonomy.js?v=1.8.0";
import { renderAttendance, REGULAR_RANKS, PERMANENT_RANKS, LICENSES, DEPARTMENTS, WORK_STAGES, SERVICE_TYPES, permanentService } from "./attendance.js?v=1.9.18";
import { initDuties, updateDutyPeople } from "./duties.js?v=1.9.23";
import { issueWorkStage, renderWorkStatus } from "./work-status.js?v=1.9.23";
import { makeSquadronEmblem } from "../squadron-emblems.js?v=1.9.19";
import { initToolAdmin } from "./tool-admin.js?v=1.9.30";

const managerUser = await gate("operations");
const fullManager = managerUser.isFullManager;
document.querySelectorAll("[data-full-manager]").forEach((element) => { element.hidden = !fullManager; });
if (!fullManager) document.querySelectorAll('[data-manager-view="management"], [data-manager-view="print-files"], [data-manager-view="tool-admin"], [data-manager-view="users"], [data-manager-view="systems"], [data-manager-view="components"], [data-manager-view="reports"], [data-manager-view="aircraft-constants"]').forEach((view) => { view.inert = true; });
if (fullManager) initToolAdmin(managerUser);
initCatalogAdmin();
initCatalogView();
initDuties();
document.querySelector("#connected-user").textContent = managerUser.name || (fullManager ? "מטיס" : "מג״ת");
function updateManagerGreeting() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const phrase = hour >= 6 && hour < 11 ? "בוקר טוב" : hour >= 11 && hour < 16 ? "צהריים טובים" : hour >= 16 && hour < 21 ? "ערב טוב" : "לילה טוב";
  document.querySelector(".manager-home-intro h2").textContent = `${phrase}, ${managerUser.name || (fullManager ? "מטיס" : "מג״ת")}`;
}
updateManagerGreeting();
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateManagerGreeting(); });
setInterval(updateManagerGreeting, 60_000);

const PAPER_QUEUE_KEY = "ezeizo-paper-closures-v1";
let syncingPaper = false;
function paperQueue() {
  try { const items = JSON.parse(localStorage.getItem(PAPER_QUEUE_KEY) || "[]"); return Array.isArray(items) ? items : []; }
  catch { return []; }
}
function savePaperQueue(items) { localStorage.setItem(PAPER_QUEUE_KEY, JSON.stringify(items)); updatePaperSyncStatus(); }
function paperPending(id) { return paperQueue().some((item) => item.id === id && item.uid === managerUser.uid); }
function updatePaperSyncStatus(message = "", error = false) {
  const count = paperQueue().filter((item) => item.uid === managerUser.uid).length;
  const status = document.querySelector("#paper-sync-status");
  status.textContent = message || (count ? `${count} סגירות טופס מודפס ממתינות לאישור השרת. אין לראות בהן סגורות עד לסנכרון.` : "");
  if (error) status.dataset.state = "error"; else delete status.dataset.state;
  document.querySelector("#paper-sync-retry").hidden = !count;
}
async function syncPaperClosures() {
  if (!fullManager || syncingPaper || !navigator.onLine || !paperQueue().some((item) => item.uid === managerUser.uid)) return;
  syncingPaper = true;
  let failed = false;
  try {
    for (const item of paperQueue().filter((entry) => entry.uid === managerUser.uid)) {
      try {
        await closePrintedIssue(item.id, item.uid, item.serial, item.status, item.reopenedAt, item.definitionUpdatedAt);
        savePaperQueue(paperQueue().filter((entry) => !(entry.id === item.id && entry.uid === item.uid)));
        updatePaperSyncStatus(`תקלה ${item.serial} נסגרה בשרת.`, false);
      } catch (error) {
        updatePaperSyncStatus(`תקלה ${item.serial} עדיין ממתינה: ${error.message}`, true);
        failed = true;
        break;
      }
    }
  } finally { syncingPaper = false; if (!failed) updatePaperSyncStatus(); renderIssueLists(); }
}
document.querySelector("#paper-sync-retry").addEventListener("click", () => void syncPaperClosures());
window.addEventListener("online", () => void syncPaperClosures());
document.addEventListener("visibilitychange", () => { if (!document.hidden) void syncPaperClosures(); });
updatePaperSyncStatus();
let cloudIssues = [];
let latestServerIssues = [];
const recentIssues = new Map();
let cloudKeyLoads = [];
let technicians = [];
let directoryAccounts = [];
const DRAFT_KEY = "ezeizo-metis-draft-v1";
const PICKER_KEY = "ezeizo-metis-picker-v1";
let draft = loadDraft();
let selections = loadSelections();
const draftStatus = document.querySelector("#draft-status");
const managerEditorLocks = new Set();
window.addEventListener("pagehide", () => managerEditorLocks.forEach((lock) => lock.dispose()));

function setStatus(selector, message, error = false) {
  const element = document.querySelector(selector);
  element.textContent = message;
  if (error) element.dataset.state = "error";
  else delete element.dataset.state;
}

function loadDraft() {
  try {
    return EzEizoData.normalizeSheet(JSON.parse(localStorage.getItem(DRAFT_KEY))) || EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  } catch {
    return EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  }
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  localStorage.setItem(PICKER_KEY, JSON.stringify(selections));
  draftStatus.textContent = "הטיוטה נשמרה במכשיר הזה";
}

function loadSelections() {
  try { const value = JSON.parse(localStorage.getItem(PICKER_KEY) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}

document.querySelectorAll("[data-sheet-field]").forEach((input) => {
  if (input.closest(".search-picker") || input.readOnly) return;
  const key = input.dataset.sheetField;
  input.value = draft[key] || "";
  input.addEventListener("input", () => {
    draft[key] = input.value;
    saveDraft();
  });
});
function syncOriginChoices() {
  document.querySelectorAll("[data-origin]").forEach((input) => { input.checked = (draft.faultOrigins || []).includes(input.dataset.origin); });
}
syncOriginChoices();
document.querySelectorAll("[data-origin]").forEach((input) => input.addEventListener("change", () => {
  draft.faultOrigins = [...document.querySelectorAll("[data-origin]:checked")].map((choice) => choice.dataset.origin);
  draft.faultOrigin = draft.faultOrigins[0] || "";
  saveDraft();
}));

const pickers = Object.fromEntries([...document.querySelectorAll("[data-picker]")].map((root) => [root.dataset.picker, {
  root, input: root.querySelector("input"), list: root.querySelector(".picker-list"), matches: [], activeIndex: 0
}]));

function availableFor(key) {
  if (key === "squadron") return Object.keys(SQUADRONS);
  if (key === "systemName") return SYSTEMS.map((system) => system.name);
  if (key === "workshop") return selections.shelter === "מוסך" ? WORKSHOPS : [];
  return Object.hasOwn(SQUADRONS, selections.squadron) ? SQUADRONS[selections.squadron][key === "shelter" ? "shelters" : "aircraft"] : [];
}

function locationForDraft() {
  return [draft.shelter === "מוסך" && draft.workshop ? draft.workshop : draft.shelter, draft.squadron].filter(Boolean).join("/");
}

function closePicker(key) {
  const picker = pickers[key];
  picker.list.hidden = true;
  picker.input.setAttribute("aria-expanded", "false");
  picker.input.removeAttribute("aria-activedescendant");
}

function renderOptions(key) {
  const picker = pickers[key];
  const search = picker.input.value.trim().toLocaleLowerCase("he");
  picker.matches = availableFor(key).filter((value) => value.toLocaleLowerCase("he").includes(search));
  picker.activeIndex = 0;
  picker.list.replaceChildren();
  if (!picker.matches.length) {
    const empty = document.createElement("p"); empty.className = "picker-empty"; empty.textContent = "אין תוצאות מתאימות";
    picker.list.append(empty);
  }
  picker.matches.forEach((value, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.id = `option-${key}-${index}`;
    option.className = key === "squadron" ? "picker-option squadron-option" : "picker-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(value === selections[key]));
    if (key === "squadron") {
      const emblem = makeSquadronEmblem(value);
      if (emblem) option.append(emblem);
    }
    option.append(document.createTextNode(value));
    option.addEventListener("pointerdown", (event) => event.preventDefault());
    option.addEventListener("click", () => choosePicker(key, value));
    picker.list.append(option);
  });
  picker.list.hidden = false;
  picker.input.setAttribute("aria-expanded", "true");
  if (picker.matches.length) picker.input.setAttribute("aria-activedescendant", `option-${key}-0`);
}

function refreshPickers() {
  document.querySelector("#workshop-field").hidden = selections.shelter !== "מוסך";
  for (const [key, picker] of Object.entries(pickers)) {
    picker.input.disabled = key === "workshop" ? selections.shelter !== "מוסך" : (key === "shelter" || key === "aircraft") && !selections.squadron;
    picker.input.placeholder = picker.input.disabled ? "בחר טייסת תחילה" : key === "aircraft" ? "חפש ובחר מספר מטוס" : key === "shelter" ? "חפש ובחר דת״ק" : key === "workshop" ? "חפש ובחר מוסך" : key === "systemName" ? "חפש ובחר מערכת" : "חפש ובחר טייסת";
    picker.input.value = selections[key] || "";
    closePicker(key);
  }
  const preview = document.querySelector("#selected-squadron-emblem");
  const emblem = makeSquadronEmblem(selections.squadron);
  preview.replaceChildren();
  if (emblem) preview.append(emblem, document.createTextNode(selections.squadron));
  preview.hidden = !emblem;
  document.querySelector('[data-sheet-field="systemCode"]').value = draft.systemCode;
  const ewSelect = document.querySelector("#ew-system-select");
  document.querySelector("#ew-system-field").hidden = !selections.aircraft;
  ewSelect.disabled = !selections.aircraft;
  ewSelect.value = selections.aircraft ? (draft.ewSystem || "גרניט") : "";
}

function clearPicker(key) {
  selections[key] = "";
  draft[key] = "";
  if (key === "squadron") {
    selections.shelter = ""; selections.workshop = ""; selections.aircraft = "";
    draft.shelter = ""; draft.workshop = ""; draft.aircraft = ""; draft.ewSystem = "";
  }
  if (key === "shelter") { selections.workshop = ""; draft.workshop = ""; }
  if (key === "aircraft") draft.ewSystem = "";
  if (key === "systemName") draft.systemCode = "";
  draft.location = locationForDraft();
  refreshPickers();
  saveDraft();
}

function choosePicker(key, value) {
  if (!availableFor(key).includes(value)) return;
  const changedAircraft = key === "aircraft" && selections.aircraft !== value;
  if (key === "squadron" && selections.squadron !== value) {
    selections.shelter = ""; selections.workshop = ""; selections.aircraft = "";
    draft.shelter = ""; draft.workshop = ""; draft.aircraft = ""; draft.ewSystem = "";
  }
  if (key === "shelter" && selections.shelter !== value) { selections.workshop = ""; draft.workshop = ""; }
  selections[key] = value;
  draft[key] = value;
  if (changedAircraft) { draft.ewSystem = "גרניט"; draft.constants = constantsForAircraft(selections.squadron, value); renderConstants(); }
  if (key === "systemName") draft.systemCode = SYSTEMS.find((system) => system.name === value).code;
  draft.location = locationForDraft();
  refreshPickers();
  saveDraft();
  setStatus("#created-status", "");
}

for (const [key, picker] of Object.entries(pickers)) {
  picker.input.addEventListener("focus", () => renderOptions(key));
  picker.input.addEventListener("input", () => {
    const search = picker.input.value;
    clearPicker(key);
    picker.input.value = search;
    renderOptions(key);
  });
  picker.input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closePicker(key); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (picker.list.hidden) renderOptions(key);
      if (!picker.matches.length) return;
      picker.activeIndex = (picker.activeIndex + (event.key === "ArrowDown" ? 1 : -1) + picker.matches.length) % picker.matches.length;
      picker.input.setAttribute("aria-activedescendant", `option-${key}-${picker.activeIndex}`);
      picker.list.children[picker.activeIndex].scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter" && !picker.list.hidden && picker.matches.length) {
      event.preventDefault(); choosePicker(key, picker.matches[picker.activeIndex]);
    }
  });
  picker.input.addEventListener("blur", () => setTimeout(() => {
    if (!picker.root.contains(document.activeElement)) closePicker(key);
  }, 250));
}

function restorePickers() {
  if (!Object.hasOwn(SQUADRONS, selections.squadron) || draft.squadron !== selections.squadron) selections.squadron = "";
  for (const key of ["shelter", "workshop", "aircraft", "systemName"]) {
    if (!availableFor(key).includes(selections[key]) || draft[key] !== selections[key]) selections[key] = "";
  }
  for (const key of Object.keys(pickers)) draft[key] = selections[key] || "";
  draft.systemCode = SYSTEMS.find((system) => system.name === selections.systemName)?.code || "";
  draft.ewSystem = selections.aircraft ? (EW_SYSTEMS.includes(draft.ewSystem) ? draft.ewSystem : "גרניט") : "";
  draft.location = locationForDraft();
  refreshPickers();
  saveDraft();
}

restorePickers();

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

async function createFault(event) {
  const button = event.currentTarget;
  const manual = button.id === "create-manual";
  const faultError = (message, target) => {
    setStatus("#created-status", message, true);
    const field = target || document.querySelector("#created-status");
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus?.({ preventScroll: true });
  };
  const acknowledgment = document.querySelector("#creation-ack");
  if (!acknowledgment.checked) { faultError("יש לאשר את בדיקת פרטי התקלה לפני פתיחתה.", acknowledgment); return; }
  if (!draft.dispatcherSignature) { faultError("חובה להחתים את משלח המשימה על תדריך הבטיחות וניהול הסיכונים.", document.querySelector("#dispatcher-signature")); return; }
  const catalogError = validateCatalogSelection(selections, draft);
  if (catalogError) { faultError(catalogError.message, pickers[catalogError.field]?.input || document.querySelector("#ew-system-select")); return; }
  const { assignees, error: assigneeError } = resolveAssignees(selectedAssigneeUids(), technicians);
  if (assigneeError) { faultError(assigneeError, document.querySelector("#new-assignees .assignee-row input") || document.querySelector("#new-assignees")); return; }
  button.disabled = true;
  const sheet = EzEizoData.normalizeSheet(draft);
  sheet.technicians = assignees.map((person) => person.name).join(" · ");
  if (!sheet.fault.trim()) {
    faultError("חובה למלא תיאור תקלה לפני פתיחת התקלה.", document.querySelector('[data-sheet-field="fault"]'));
    button.disabled = false;
    return;
  }
  sheet.id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Open while the click still has user activation so mobile Safari allows the PDF tab.
  const printTab = manual ? window.open("about:blank", "_blank") : null;
  try {
    const created = manual ? await createManualIssue(sheet, managerUser.uid) : await createAssignedIssues(sheet, assignees);
    sheet.serial = created.serial;
    recentIssues.set(created.id, { id: created.id, sheet: { ...sheet, id: created.id }, status: manual ? "pendingReview" : "open", manualPaper: manual, closed: manual ? { record: { ...sheet, id: created.id, serial: created.serial }, state: { paper: true } } : undefined, createdAt: created.createdAt, assigneeUid: assignees[0]?.uid || "", assigneeName: assignees[0]?.name || "", teamUids: assignees.map((person) => person.uid), teamNames: assignees.map((person) => person.name) });
    updateManagerIssues(latestServerIssues);
    if (printTab) printTab.location.replace(`./filled-print.html?id=${encodeURIComponent(created.id)}`);
    resetFaultDraft();
    setStatus("#created-status", manual ? `תקלה ידנית מספר ${sheet.serial} נפתחה וממתינה למילוי וסגירה בידי המטיס. טופס התקלה נפתח להדפסה.` : `תקלה מספר ${sheet.serial} הוקצתה ל־${assignees.map((person) => person.name).join(" ו־")}. הטופס מוכן לפתיחת תקלה חדשה.`);
    window.location.hash = manual ? "pending" : "open";
  } catch (error) { printTab?.close(); faultError(`פתיחת התקלה נכשלה: ${error.message}`); }
  finally { button.disabled = false; }
}
document.querySelector("#create-link").addEventListener("click", createFault);
document.querySelector("#create-manual").addEventListener("click", createFault);

function addDefinitionEditor(card, issue) {
  const editor = document.createElement("details"); editor.className = "manager-note-editor";
  const summary = document.createElement("summary"); summary.textContent = "ערוך פרטי תקלה וצוות";
  const form = document.createElement("form"); form.className = "definition-editor";
  const fields = document.createElement("div"); fields.className = "manager-grid";
  const makeField = (label, control) => { const wrapper = document.createElement("label"); wrapper.className = "input-field"; wrapper.append(label, control); fields.append(wrapper); return control; };
  const makeSelect = (label, values, selected) => { const select = document.createElement("select"); values.forEach((value) => select.append(new Option(value, value))); select.value = selected || ""; return makeField(label, select); };
  const squadron = makeSelect("טייסת", Object.keys(SQUADRONS), issue.sheet.squadron);
  const shelter = makeSelect("דת״ק", [], issue.sheet.shelter);
  const aircraft = makeSelect("מספר מטוס", [], issue.sheet.aircraft);
  const workshop = makeSelect("מוסך", ["", ...WORKSHOPS], issue.sheet.workshop);
  const system = makeSelect("מערכת", SYSTEMS.map((entry) => entry.name), issue.sheet.systemName);
  const code = makeField("קוד מערכת", document.createElement("input")); code.value = issue.sheet.systemCode || "";
  const category = makeSelect("סיווג תקלה", ["", "בקרי", "קשר", "ל״א", "אישורים והיתרים", "פירוקים והרכבות"], issue.sheet.reviewCategory);
  const fault = makeField("תיאור תקלה", document.createElement("textarea")); fault.rows = 3; fault.value = issue.sheet.fault || "";
  const notes = makeField("הערות מטיס", document.createElement("textarea")); notes.rows = 2; notes.maxLength = 2000; notes.value = issue.sheet.managerNotes || "";
  const refreshLocations = () => {
    const oldShelter = shelter.value, oldAircraft = aircraft.value;
    shelter.replaceChildren(...(SQUADRONS[squadron.value]?.shelters || []).map((value) => new Option(value, value)));
    aircraft.replaceChildren(...(SQUADRONS[squadron.value]?.aircraft || []).map((value) => new Option(value, value)));
    if ([...shelter.options].some((option) => option.value === oldShelter)) shelter.value = oldShelter;
    if ([...aircraft.options].some((option) => option.value === oldAircraft)) aircraft.value = oldAircraft;
    workshop.parentElement.hidden = shelter.value !== "מוסך";
  };
  squadron.addEventListener("change", refreshLocations); shelter.addEventListener("change", refreshLocations); refreshLocations();
  const origins = document.createElement("fieldset"); origins.className = "origin-options";
  const legend = document.createElement("legend"); legend.textContent = "מקור התקלה"; origins.append(legend);
  ORIGINS.forEach((value) => { const label = document.createElement("label"); const box = document.createElement("input"); box.type = "checkbox"; box.value = value; box.checked = (issue.sheet.faultOrigins || [issue.sheet.faultOrigin]).includes(value); label.append(box, ` ${value}`); origins.append(label); });
  const team = document.createElement("fieldset"); team.className = "assignee-fieldset";
  const teamLegend = document.createElement("legend"); teamLegend.textContent = "צוות טכנאים · לפחות שניים"; team.append(teamLegend);
  const selected = issue.teamUids || [issue.assigneeUid];
  technicians.filter((person) => person.active || selected.includes(person.uid)).forEach((person) => { const label = document.createElement("label"); const box = document.createElement("input"); box.type = "checkbox"; box.value = person.uid; box.checked = selected.includes(person.uid); box.disabled = !person.active; label.append(box, ` ${person.name}${person.personalNumber ? ` · ${person.personalNumber}` : ""}`); team.append(label); });
  const save = document.createElement("button"); save.type = "submit"; save.className = "primary-button"; save.textContent = "שמור פרטי תקלה";
  const status = document.createElement("p"); status.className = "copy-status"; status.setAttribute("role", "status");
  const retryLock = document.createElement("button"); retryLock.type = "button"; retryLock.className = "secondary-button"; retryLock.textContent = "בדוק שוב"; retryLock.hidden = true;
  retryLock.addEventListener("click", () => { if (editLock && !editLock.held) void editLock.acquire(); });
  let editLock = null;
  form.hidden = true;
  const release = () => { if (editLock) { editLock.dispose(); managerEditorLocks.delete(editLock); editLock = null; } form.hidden = true; retryLock.hidden = true; };
  editor.addEventListener("toggle", () => {
    if (!editor.open) { release(); return; }
    status.textContent = "בודק אם הטופס פנוי ונועל אותו לעריכת המטיס…";
    retryLock.hidden = true;
    editLock = createEditLock({ kind: "issue", serialOrId: issue.sheet.serial, formId: issue.id, user: { uid: managerUser.uid, name: "מטיס" }, manager: true,
      onChange: ({ held, message }) => { form.hidden = !held; retryLock.hidden = held || !message || message.includes("בודק אם"); status.textContent = held ? "הטופס נעול לעריכת המטיס. הטכנאים יוכלו לערוך לאחר סגירת החלונית." : message; } });
    managerEditorLocks.add(editLock);
    void editLock.acquire();
  });
  form.append(fields, origins, team, save); editor.append(summary, status, retryLock, form); card.append(editor);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const members = [...team.querySelectorAll("input:checked")].map((box) => technicians.find((person) => person.uid === box.value && person.active)).filter(Boolean);
    if (!editLock?.held || !fault.value.trim() || members.length < 2 || !shelter.value || !aircraft.value) { status.textContent = "בדוק שהטופס נעול לעריכתך, מלא תיאור ומיקום ובחר לפחות שני טכנאים פעילים."; status.dataset.state = "error"; return; }
    save.disabled = true; status.textContent = "בודק נעילה ושומר…"; delete status.dataset.state;
    try {
      const faultOrigins = [...origins.querySelectorAll("input:checked")].map((box) => box.value);
      await updateOpenIssueDefinition(issue.id, { squadron: squadron.value, shelter: shelter.value, workshop: shelter.value === "מוסך" ? workshop.value : "", aircraft: aircraft.value, systemName: system.value, systemCode: code.value.trim(), reviewCategory: category.value, fault: fault.value.trim(), managerNotes: notes.value.trim(), faultOrigins, faultOrigin: faultOrigins[0] || "" }, members, editLock.session);
      status.textContent = "פרטי התקלה עודכנו ונשלחו לצוות.";
      editor.open = false;
    } catch (error) { status.textContent = `השמירה נכשלה: ${error.message}`; status.dataset.state = "error"; }
    finally { save.disabled = false; }
  });
}

function addIssueCard(container, item, mode) {
  const card = document.createElement("div");
  card.className = "issue-item";
  const title = document.createElement("strong");
  title.textContent = `תקלה ${item.serial || "ללא מספר"} · מטוס ${item.aircraft || "—"} · ${item.location || "—"}`;
  const subtitle = document.createElement("span");
  const fullIssue = cloudIssues.find((issue) => issue.id === item.id);
  subtitle.textContent = `${item.fault || "ללא תיאור"} · ${fullIssue?.manualPaper ? "תקלה ידנית · " : ""}${mode === "closed" ? "סגורה" : mode === "pendingReview" ? "ממתינה לבודק הדף" : mode === "cancelled" ? "שילוח בוטל" : "פתוחה"} · ${(fullIssue?.teamNames || [fullIssue?.assigneeName || "לא שובצה"]).join(" · ")}`;
  card.append(title, subtitle);
  if (mode === "cancelled") {
    const reason = document.createElement("span"); reason.textContent = `סיבת הביטול: ${fullIssue?.cancellationReason || "—"}`; card.append(reason);
  } else if (mode !== "open") {
    const view = document.createElement("a");
    view.className = "secondary-button";
    view.href = `./${fullIssue?.manualPaper ? "manual.html" : "closed.html"}?id=${encodeURIComponent(item.id)}`;
    view.textContent = fullIssue?.manualPaper && mode === "pendingReview" ? "מלא וסגור תקלה ידנית" : mode === "pendingReview" ? "בדוק וחתום" : "פתח דף סגור";
    card.append(view);
  } else if (fullIssue?.teamUids?.length) {
    const team = document.createElement("span"); team.textContent = `צוות משויך: ${fullIssue.teamNames.join(" · ")}`; card.append(team);
  } else {
    const assignLabel = document.createElement("label");
    assignLabel.className = "input-field";
    assignLabel.textContent = "טכנאי משויך";
    const select = document.createElement("select");
    select.setAttribute("aria-label", `שיוך תקלה ${item.serial}`);
    select.append(new Option("לא משויכת", ""));
    technicians.filter((person) => person.active || person.uid === fullIssue?.assigneeUid).forEach((person) => {
      select.append(new Option(`${person.name}${person.active ? "" : " (מושבת)"}`, person.uid));
    });
    select.value = fullIssue?.assigneeUid || "";
    const assignFeedback = document.createElement("p");
    assignFeedback.className = "copy-status";
    assignFeedback.setAttribute("role", "status");
    select.addEventListener("change", async () => {
      const person = technicians.find((entry) => entry.uid === select.value && entry.active);
      if (!person) { select.value = fullIssue?.assigneeUid || ""; return; }
      select.disabled = true;
      try { await assignIssue(item.id, person.uid, person.name); }
      catch (error) { assignFeedback.textContent = `השיבוץ נכשל: ${error.message}`; assignFeedback.dataset.state = "error"; select.value = fullIssue?.assigneeUid || ""; }
      finally { select.disabled = false; }
    });
    assignLabel.append(select);
    card.append(assignLabel, assignFeedback);
    const editor = document.createElement("details"); editor.className = "manager-note-editor";
    const summary = document.createElement("summary"); summary.textContent = "הערות מטיס";
    const existing = document.createElement("p"); existing.className = "manager-note-text"; existing.textContent = fullIssue?.sheet?.managerNotes || "עדיין אין הערות.";
    const note = document.createElement("textarea"); note.rows = 2; note.maxLength = 500; note.placeholder = "הוסף הערה לטכנאי…"; note.setAttribute("aria-label", `הוסף הערה לתקלה ${item.serial}`);
    const send = document.createElement("button"); send.type = "button"; send.className = "secondary-button"; send.textContent = "הוסף הערה";
    const feedback = document.createElement("p"); feedback.className = "copy-status"; feedback.setAttribute("role", "status");
    send.addEventListener("click", async () => {
      if (!note.value.trim()) { feedback.textContent = "יש לכתוב הערה לפני השליחה."; feedback.dataset.state = "error"; return; }
      send.disabled = true;
      try { await appendIssueManagerNote(item.id, note.value); note.value = ""; feedback.textContent = "ההערה נוספה ונשלחה לטכנאי."; delete feedback.dataset.state; }
      catch (error) { feedback.textContent = `הוספת ההערה נכשלה: ${error.message}`; feedback.dataset.state = "error"; }
      finally { send.disabled = false; }
    });
    editor.append(summary, existing, note, send, feedback); card.append(editor);
  }
  if (mode === "open") {
    if (fullIssue?.teamUids?.length) addDefinitionEditor(card, fullIssue);
    const cancel = document.createElement("details"); cancel.className = "manager-note-editor";
    const summary = document.createElement("summary"); summary.textContent = "ביטול שילוח משימה";
    const reason = document.createElement("textarea"); reason.rows = 2; reason.maxLength = 500; reason.placeholder = "סיבת הביטול (חובה)"; reason.setAttribute("aria-label", `סיבת ביטול שילוח תקלה ${item.serial}`);
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "secondary-button"; confirm.textContent = "אשר ביטול שילוח";
    const feedback = document.createElement("p"); feedback.className = "copy-status"; feedback.setAttribute("role", "status");
    confirm.addEventListener("click", async () => {
      if (!reason.value.trim()) { feedback.textContent = "יש להזין סיבה לביטול השילוח."; feedback.dataset.state = "error"; return; }
      confirm.disabled = true;
      try { await cancelIssueDispatch(item.id, managerUser.uid, reason.value); feedback.textContent = "השילוח בוטל ונשמר בהיסטוריה."; }
      catch (error) { feedback.textContent = `הביטול נכשל: ${error.message}`; feedback.dataset.state = "error"; confirm.disabled = false; }
    });
    cancel.append(summary, reason, confirm, feedback); card.append(cancel);
  }
  if (fullManager && fullIssue && !fullIssue.manualPaper && ["open", "pendingReview"].includes(mode)) {
    const panel = document.createElement("details"); panel.className = "paper-closure-panel";
    const heading = document.createElement("summary"); heading.textContent = "הדפסה וסגירה בטופס נייר";
    const print = document.createElement("a"); print.className = "secondary-button";
    print.href = "./printable-fault-form.pdf"; print.target = "_blank"; print.rel = "noopener";
    print.textContent = "פתח טופס להדפסה";
    const label = document.createElement("label");
    const checked = document.createElement("input"); checked.type = "checkbox";
    label.append(checked, document.createTextNode("אני מאשר שהטופס הודפס ומולא ידנית. העותק המודפס נשמר מחוץ לאפליקציה."));
    const close = document.createElement("button"); close.type = "button"; close.className = "secondary-button"; close.textContent = "סגור תקלה לאחר הדפסה";
    const feedback = document.createElement("p"); feedback.className = "copy-status"; feedback.setAttribute("role", "status");
    if (paperPending(fullIssue.id)) {
      close.disabled = true;
      feedback.textContent = "הסגירה ממתינה לאישור השרת; התקלה עדיין אינה סגורה במערכת.";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "secondary-button"; cancel.textContent = "בטל סגירה ממתינה";
      cancel.addEventListener("click", () => { savePaperQueue(paperQueue().filter((entry) => !(entry.id === fullIssue.id && entry.uid === managerUser.uid))); renderIssueLists(); });
      panel.append(heading, print, label, close, cancel, feedback);
    } else panel.append(heading, print, label, close, feedback);
    close.addEventListener("click", async () => {
      if (!checked.checked) { feedback.textContent = "יש לאשר שהטופס הודפס ומולא ידנית."; feedback.dataset.state = "error"; return; }
      if (!window.confirm(`לסגור את תקלה ${fullIssue.sheet.serial} על סמך טופס הנייר? הפרטים שמולאו ידנית לא יועברו לדף הדיגיטלי.`)) return;
      close.disabled = true; delete feedback.dataset.state;
      const item = { id: fullIssue.id, uid: managerUser.uid, serial: fullIssue.sheet.serial, status: fullIssue.status, reopenedAt: fullIssue.reopenedAt || "", definitionUpdatedAt: fullIssue.definitionUpdatedAt || "" };
      if (!navigator.onLine) {
        try { savePaperQueue([...paperQueue(), item]); feedback.textContent = "הבקשה נשמרה במכשיר וממתינה לחיבור לשרת. התקלה עדיין פתוחה במערכת. אין למחוק את נתוני האפליקציה עד לסנכרון."; renderIssueLists(); }
        catch (error) { close.disabled = false; feedback.textContent = `לא ניתן לשמור בקשה במכשיר: ${error.message}`; feedback.dataset.state = "error"; }
        return;
      }
      try { await closePrintedIssue(item.id, item.uid, item.serial, item.status, item.reopenedAt, item.definitionUpdatedAt); feedback.textContent = "התקלה נסגרה בשרת על סמך טופס מודפס."; }
      catch (error) {
        if (["unavailable", "deadline-exceeded"].includes(error.code)) {
          try { savePaperQueue([...paperQueue(), item]); feedback.textContent = "השרת אינו זמין. הבקשה נשמרה במכשיר וממתינה לסנכרון."; renderIssueLists(); return; }
          catch (storageError) { feedback.textContent = `שמירה במכשיר נכשלה: ${storageError.message}`; }
        } else feedback.textContent = `הסגירה נכשלה: ${error.message}`;
        feedback.dataset.state = "error"; close.disabled = false;
      }
    });
    card.append(panel);
  }
  container.append(card);
}

function renderIssueLists() {
  managerEditorLocks.forEach((lock) => lock.dispose()); managerEditorLocks.clear();
  const opened = document.querySelector("#issued-list");
  const pending = document.querySelector("#pending-list");
  opened.replaceChildren();
  pending.replaceChildren();
  delete opened.dataset.state;
  const matches = (selector, serial) => String(serial || "").includes(document.querySelector(selector).value.trim());
  const uniqueSerials = (items) => [...new Map(items.map((item) => [item.serial, item])).values()];
  const awaiting = uniqueSerials(cloudIssues.filter((item) => item.status === "pendingReview" && item.closed?.record && matches("#pending-issue-search", item.closed.record.serial)).map((item) => item.closed.record));
  const technician = document.querySelector("#fault-technician").value;
  const technicianSearch = document.querySelector("#fault-technician-search").value.trim().toLocaleLowerCase("he");
  const technicianUids = technician || technicianSearch ? technicians.filter((person) => (!technician || person.uid === technician) && (!technicianSearch || `${person.name} ${person.personalNumber || ""}`.toLocaleLowerCase("he").includes(technicianSearch))).map((person) => person.uid) : document.querySelector("#fault-mode").value === "technician-history" ? [] : null;
  const mode = document.querySelector("#fault-mode").value;
  const active = filterIssues(cloudIssues, { mode, technicianUids, serial: document.querySelector("#open-issue-search").value, squadron: document.querySelector("#fault-squadron").value, aircraft: document.querySelector("#fault-aircraft").value.trim(), from: document.querySelector("#fault-from").value, to: document.querySelector("#fault-to").value, reviewFilters: [...document.querySelectorAll("[data-closed-filter]:checked")].map((input) => input.dataset.closedFilter), originFilters: [...document.querySelectorAll("[data-closed-origin]:checked")].map((input) => input.dataset.closedOrigin) });
  const stageMode = ["open-default", "workshop-open", "open-all", "open-squadron"].includes(mode);
  document.querySelector("#open-stage-tabs").hidden = !stageMode;
  document.querySelector("#issued-title").textContent = stageMode ? location.hash === "#in-progress" ? "תקלות בתהליך" : "תקלות פתוחות" : "כל התקלות";
  const visible = stageMode ? active.filter((issue) => issueWorkStage(issue) === (location.hash === "#in-progress" ? "progress" : "start")) : active;
  [...new Map(visible.map((issue) => [issue.sheet.serial, issue])).values()].forEach((issue) => addIssueCard(opened, issue.closed?.record || issue.sheet, issue.status));
  const pendingCategory = document.querySelector("#pending-category").value;
  awaiting.filter((item) => !pendingCategory || cloudIssues.find((issue) => issue.id === item.id)?.sheet?.reviewCategory === pendingCategory).forEach((item) => addIssueCard(pending, item, "pendingReview"));
  if (!pendingCategory) cloudKeyLoads.filter((load) => load.status === "pendingReview" && matches("#pending-issue-search", load.serial)).forEach((load) => {
    const card = document.createElement("article"); card.className = "issue-item";
    const title = document.createElement("strong"); title.textContent = `הטענת מפתחות ${load.serial || "—"} · טייסת ${load.squadron}`;
    const subtitle = document.createElement("span"); subtitle.textContent = `מטוסים: ${(load.aircraftIds || []).join(", ")} · צוות: ${(load.teamNames || []).join(" · ")}`;
    const link = document.createElement("a"); link.className = "secondary-button"; link.href = `#keys/work/${encodeURIComponent(load.id)}`; link.textContent = "בדוק וסגור הטענה";
    card.append(title, subtitle, link); pending.append(card);
  });
  if (!visible.length) opened.textContent = "לא נמצאו תקלות התואמות לסינון.";
  if (!pending.children.length) pending.textContent = "לא נמצאו תקלות לסגירה התואמות לסינון.";
  renderFaultHistory();
}

let historyMode = "aircraft";
function renderFaultHistory() {
  const results = document.querySelector("#history-results");
  results.replaceChildren();
  const squadron = document.querySelector("#history-squadron").value;
  const aircraft = document.querySelector("#history-aircraft").value.trim();
  const system = document.querySelector(historyMode === "aircraft" ? "#history-aircraft-system" : "#history-component-system").value;
  const component = document.querySelector(historyMode === "aircraft" ? "#history-aircraft-unit" : "#history-unit").value;
  const serial = document.querySelector("#history-unit-serial").value.trim();
  if (historyMode === "aircraft" && (!squadron || !aircraft || !system || !component)) { results.textContent = "בחר טייסת, מטוס, מערכת ומכלול כדי לראות את הפירוקים וההרכבות."; return; }
  if (historyMode === "component" && (!system || !component || !serial)) { results.textContent = "בחר מערכת ומכלול והזן מספר סידורי כדי לראות את ההיסטוריה שלו."; return; }
  if (!COMPONENTS_BY_SYSTEM[system]?.includes(component)) { results.textContent = "המכלול אינו שייך למערכת שנבחרה."; return; }
  const matching = componentHistory(cloudIssues, component)
    .filter(({ issue, unit }) => historyMode === "aircraft" ? issue.sheet?.squadron === squadron && issue.sheet?.aircraft === aircraft : String(unit.serial || "").trim().toLocaleLowerCase("he") === serial.toLocaleLowerCase("he"))
    .map(({ issue, kind, unit, at }) => ({ issue, detail: `${kind === "removed" ? "פורק" : "הורכב"}: ${unit.name || "מכלול"} · מספר סידורי ${unit.serial || "לא צוין"} · ${new Date(at).toLocaleDateString("he-IL")}` }));
  const grouped = new Map();
  for (const { issue, detail } of matching) {
    const key = `${issue.sheet?.serial || issue.id}|${issue.sheet?.squadron || ""}|${issue.sheet?.aircraft || ""}`;
    const notes = [detail];
    if (!grouped.has(key)) grouped.set(key, { issue, notes: new Set() });
    const entry = grouped.get(key);
    notes.forEach((note) => entry.notes.add(note));
    const rank = { closed: 3, pendingReview: 2, open: 1, cancelled: 0 };
    if ((rank[issue.status] || 0) > (rank[entry.issue.status] || 0) || (issue.status === entry.issue.status && notes.length > 0 && !(entry.issue.closed?.state?.removed?.length || entry.issue.closed?.state?.installed?.length))) entry.issue = issue;
  }
  [...grouped.values()].forEach(({ issue, notes }) => {
    const card = document.createElement("article"); card.className = "issue-item history-card";
    const heading = document.createElement("div"); heading.className = "history-card-heading";
    const title = document.createElement("strong"); title.textContent = `תקלה ${issue.sheet?.serial || "—"}`;
    const badge = document.createElement("span"); badge.className = `history-status history-status-${issue.status}`;
    badge.textContent = issue.status === "closed" ? "סגורה" : issue.status === "pendingReview" ? "לסגירה" : issue.status === "cancelled" ? "שילוח בוטל" : "פתוחה";
    heading.append(title, badge);
    const metadata = document.createElement("div"); metadata.className = "history-metadata";
    for (const value of [`טייסת ${issue.sheet?.squadron || "—"}`, `מטוס ${issue.sheet?.aircraft || "—"}`, new Date(issue.createdAt).toLocaleDateString("he-IL")]) { const chip = document.createElement("span"); chip.textContent = value; metadata.append(chip); }
    const description = document.createElement("p"); description.className = "history-description"; description.textContent = issue.sheet?.fault || "ללא תיאור תקלה";
    card.append(heading, metadata, description);
    notes.forEach((text) => { const note = document.createElement("p"); note.className = "history-unit-note"; note.textContent = text; card.append(note); });
    if (issue.status === "cancelled") { const note = document.createElement("span"); note.textContent = `שילוח בוטל: ${issue.cancellationReason || "—"}`; card.append(note); }
    if (["closed", "pendingReview"].includes(issue.status)) { const link = document.createElement("a"); link.className = "secondary-button"; link.href = `./${issue.manualPaper ? "manual.html" : "closed.html"}?id=${encodeURIComponent(issue.id)}`; link.textContent = "פתח דף תקלה"; card.append(link); }
    results.append(card);
  });
  if (!grouped.size) results.textContent = "לא נמצאו פירוקים או הרכבות התואמים לבחירה.";
}

document.querySelectorAll("[data-history-mode]").forEach((button) => button.addEventListener("click", () => {
  historyMode = button.dataset.historyMode;
  document.querySelectorAll("[data-history-mode]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  document.querySelectorAll("[data-history-fields]").forEach((group) => { group.hidden = group.dataset.historyFields !== historyMode; });
  document.querySelector("#history-hint").textContent = historyMode === "aircraft" ? "בחר טייסת, מטוס, מערכת ומכלול להצגת הפירוקים וההרכבות שלו." : "בחר מערכת, מכלול ומספר סידורי להצגת כל הפעולות במכלול הזה.";
  renderFaultHistory();
}));

let keyPagesStarted = false;
let previousManagerView = "";
let previousIssueRoute = "";
function showManagerView() {
  const requested = window.location.hash.slice(1);
  if (!fullManager && ["management", "print-files", "tool-admin", "technicians", "users", "systems", "components", "reports", "aircraft-constants"].includes(requested)) { location.replace("#home"); return; }
  const selected = requested === "keys" || requested.startsWith("keys/") ? "keys" : requested === "closed" || requested === "in-progress" ? "open" : requested === "technicians" ? "users" : ["home", "catalog", "attendance", "duties", "work-status", "management", "print-files", "tool-admin", "reports", "aircraft-constants", "new", "open", "pending", "history", "users", "systems", "components"].includes(requested) ? requested : "home";
  if (requested === "closed") document.querySelector("#fault-mode").value = "closed";
  if (selected === "open" && requested !== "closed" && (previousIssueRoute !== requested || previousManagerView !== "open")) document.querySelector("#fault-mode").value = requested === "in-progress" ? "open-all" : "open-default";
  if (selected === "open") previousIssueRoute = requested;
  previousManagerView = selected;
  document.querySelector("#closed-review-filters").hidden = !["closed"].includes(document.querySelector("#fault-mode").value);
  document.querySelector("#manager-back").hidden = !["catalog", "attendance", "duties", "work-status", "users", "systems", "components", "reports", "aircraft-constants", "print-files", "tool-admin"].includes(selected);
  document.querySelectorAll("[data-open-stage]").forEach((link) => { if (link.dataset.openStage === (requested === "in-progress" ? "progress" : "start")) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  document.querySelector("#issued-title").textContent = requested === "in-progress" ? "תקלות בתהליך" : "כל התקלות";
  document.querySelector("#reset-draft").hidden = requested !== "new" && requested !== "keys/create";
  if (selected !== "keys") document.querySelector("#key-back-link").hidden = true;
  document.querySelector("#fault-nav").hidden = !["new", "open", "pending", "history"].includes(selected);
  document.querySelectorAll("[data-manager-view]").forEach((view) => { view.hidden = view.dataset.managerView !== (selected === "pending" ? "closed" : selected); });
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    const nav = ["new", "open", "pending", "history"].includes(selected) ? "faults" : ["users", "systems", "components", "reports", "aircraft-constants", "print-files", "tool-admin"].includes(selected) ? "management" : selected;
    if (link.dataset.viewLink === nav) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-fault-link]").forEach((link) => { if (link.dataset.faultLink === selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  if (selected === "keys" && !keyPagesStarted) { keyPagesStarted = true; initKeyPages({ user: managerUser, embedded: true }); }
  if (selected !== "new") renderIssueLists();
}
document.querySelector("#manager-back").addEventListener("click", () => { if (fullManager && location.hash === "#aircraft-constants" && closeConstantsEditor()) return; location.hash = !fullManager || ["#catalog", "#attendance", "#duties", "#work-status"].includes(location.hash) ? "home" : "management"; });
window.addEventListener("hashchange", showManagerView);
function resetFaultDraft() {
  draft = EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  selections = {};
  for (const key of Object.keys(pickers)) draft[key] = "";
  draft.systemCode = "";
  draft.ewSystem = "";
  draft.location = "";
  draft.technicians = "";
  draft.fault = "";
  draft.managerNotes = "";
  draft.faultOrigin = "";
  draft.faultOrigins = [];
  draft.dispatcherSignature = "";
  clearDispatcherSignature();
  document.querySelectorAll("[data-sheet-field]").forEach((input) => { if ("value" in input) input.value = draft[input.dataset.sheetField] || ""; });
  syncOriginChoices();
  refreshPickers();
  renderAssigneeSelectors(["", ""]);
  document.querySelector("#creation-ack").checked = false;
  setStatus("#assignee-feedback", "");
  renderConstants();
  renderActions();
  saveDraft();
  setStatus("#created-status", "טיוטת התקלה אופסה.");
}
document.querySelector("#reset-draft").addEventListener("click", () => {
  if (window.location.hash === "#new") resetFaultDraft();
  else if (window.location.hash === "#keys/create") document.dispatchEvent(new Event("ezeizo:reset-key-draft"));
});

function updateManagerIssues(issues) {
  latestServerIssues = issues;
  for (const issue of issues) recentIssues.delete(issue.id);
  cloudIssues = [...issues, ...recentIssues.values()];
  updateReportData({ issues: cloudIssues });
  document.querySelector("#home-open-count").textContent = `${cloudIssues.filter((item) => issueWorkStage(item) === "start").length} תקלות פתוחות`;
  document.querySelector("#home-progress-count").textContent = `${cloudIssues.filter((item) => issueWorkStage(item) === "progress").length} תקלות בתהליך`;
  document.querySelector("#home-review-count").textContent = `${cloudIssues.filter((item) => item.status === "pendingReview").length} ממתינות לסגירה · ${cloudIssues.filter((item) => item.status === "closed").length} סגורות`;
  renderIssueLists(); renderWorkStatus(cloudIssues); renderUsers();
}
watchIssues((issues) => {
  updateManagerIssues(issues);
  void syncPaperClosures();
}, (error) => {
  setStatus("#issued-list", `לא ניתן לטעון תקלות: ${error.message}`, true);
  setStatus("#pending-list", `לא ניתן לטעון תקלות: ${error.message}`, true);
});
document.querySelector("#refresh-work-status").addEventListener("click", async (event) => {
  const button = event.currentTarget, message = document.querySelector("#work-status-refresh-message");
  button.disabled = true; message.textContent = "מעדכן תקלות מהשרת…"; delete message.dataset.state;
  try { updateManagerIssues(await refreshManagerIssues()); message.textContent = "הסטטוס עודכן עכשיו."; }
  catch (error) { message.textContent = `הרענון נכשל: ${error.message}`; message.dataset.state = "error"; }
  finally { button.disabled = false; }
});
function selectedAssigneeUids() {
  return [...document.querySelectorAll('#new-assignees .assignee-row')].map((row) => row.dataset.assigneeUid || '');
}
function syncAssigneeNames() {
  const selected = selectedAssigneeUids().filter(Boolean);
  const duplicate = selected.length !== new Set(selected).size;
  document.querySelectorAll('#new-assignees .assignee-row').forEach((row) => {
    const uid = row.dataset.assigneeUid;
    row.querySelector('input[type="search"]').setAttribute('aria-invalid', String(Boolean(uid && selected.filter((value) => value === uid).length > 1)));
  });
  setStatus('#assignee-feedback', duplicate ? 'כל טכנאי יכול להיבחר פעם אחת בלבד.' : '', duplicate);
  draft.technicians = selected.map((uid) => technicians.find((person) => person.uid === uid)?.name).filter(Boolean).join(' · ');
  saveDraft();
}
function renderAssigneeSelectors(values = selectedAssigneeUids()) {
  const container = document.querySelector('#new-assignees');
  container.replaceChildren();
  (values.length >= 2 ? values : ["", ""]).forEach((uid, index) => {
    const row = document.createElement('div'); row.className = 'assignee-row';
    const roleLabel = index === 0 ? 'מוביל התקלה' : `טכנאי ${index + 1}`;
    const label = document.createElement('label'); label.className = 'input-field'; label.textContent = roleLabel;
    const picker = document.createElement('div'); picker.className = 'search-picker';
    const input = document.createElement('input'); input.id = `assignee-search-${index}`; input.type = 'search'; input.autocomplete = 'off'; input.placeholder = index === 0 ? 'חפש ובחר מוביל תקלה' : 'חפש ובחר טכנאי';
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', `assignee-options-${index}`); input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-label', roleLabel);
    const list = document.createElement('div'); list.id = `assignee-options-${index}`; list.className = 'picker-list'; list.setAttribute('role', 'listbox'); list.hidden = true;
    let check;
    if (index === 0) {
      const filter = document.createElement('label'); filter.className = 'leader-inspection-toggle';
      check = document.createElement('input'); check.type = 'checkbox'; check.id = 'leader-requires-inspection'; check.checked = Boolean(selections.leaderRequiresInspection);
      filter.append(check, document.createTextNode('דורש בדיקה'));
      row.append(filter);
    }
    const eligible = () => technicians.filter((person) => person.active && (index !== 0 || !check.checked || Number(person.workStage) >= 11));
    function setAssignee(person) { row.dataset.assigneeUid = person?.uid || ''; input.value = person?.name || ''; list.hidden = true; input.setAttribute('aria-expanded', 'false'); syncAssigneeNames(); }
    function showOptions(showAll = false) {
      const term = showAll ? '' : input.value.trim().toLocaleLowerCase('he');
      list.replaceChildren();
      const matches = eligible().filter((person) => person.name.toLocaleLowerCase('he').includes(term) || String(person.personalNumber || '').includes(term));
      for (const person of matches) {
        const option = document.createElement('button'); option.type = 'button'; option.className = 'picker-option'; option.setAttribute('role', 'option'); option.textContent = person.name;
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => setAssignee(person)); list.append(option);
      }
      if (!matches.length) { const empty = document.createElement('p'); empty.className = 'picker-empty'; empty.textContent = 'לא נמצאו טכנאים מתאימים'; list.append(empty); }
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    input.addEventListener('focus', () => { input.select(); showOptions(true); });
    input.addEventListener('input', () => { row.dataset.assigneeUid = ''; syncAssigneeNames(); showOptions(); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { list.hidden = true; input.setAttribute('aria-expanded', 'false'); } else if (event.key === 'Enter' && !list.hidden) { event.preventDefault(); list.querySelector('button')?.click(); } });
    input.addEventListener('blur', () => { setTimeout(() => { if (!picker.contains(document.activeElement)) { list.hidden = true; input.setAttribute('aria-expanded', 'false'); if (!row.dataset.assigneeUid) input.value = ''; } }, 120); });
    if (check) check.addEventListener('change', () => { selections.leaderRequiresInspection = check.checked; if (row.dataset.assigneeUid && !eligible().some((person) => person.uid === row.dataset.assigneeUid)) setAssignee(null); else saveDraft(); showOptions(); });
    picker.append(input, list); label.append(picker); row.prepend(label);
    setAssignee(eligible().find((person) => person.uid === uid));
    if (index >= 2) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary-button'; remove.textContent = 'הסר';
      remove.setAttribute('aria-label', `הסר ${roleLabel}`);
      remove.addEventListener('click', () => renderAssigneeSelectors(selectedAssigneeUids().filter((_, position) => position !== index)));
      row.append(remove);
    }
    container.append(row);
  });
  syncAssigneeNames();
}
document.querySelector('#add-assignee').addEventListener('click', () => renderAssigneeSelectors([...selectedAssigneeUids(), '']));
function updateUserSelectors() {
  renderAssigneeSelectors();
}
for (const id of ["open-issue-search", "pending-issue-search", "fault-technician-search"]) document.getElementById(id).addEventListener("input", renderIssueLists);
FAULT_FILTERS.forEach(([value, label]) => document.querySelector("#fault-mode").append(new Option(label, value)));
ORIGINS.forEach((origin) => { const label = document.createElement("label"); const input = document.createElement("input"); input.type = "checkbox"; input.dataset.closedOrigin = origin; label.append(input, document.createTextNode(` ${origin}`)); document.querySelector("#closed-origin-filters").append(label); });
document.querySelector("#clear-closed-filters").addEventListener("click", () => { document.querySelectorAll("[data-closed-filter], [data-closed-origin]").forEach((input) => { input.checked = false; }); renderIssueLists(); });
document.querySelectorAll("[data-closed-filter], [data-closed-origin]").forEach((input) => input.addEventListener("change", renderIssueLists));
for (const squadron of Object.keys(SQUADRONS)) {
  document.querySelector("#fault-squadron").append(new Option(squadron, squadron));
  document.querySelector("#history-squadron").append(new Option(squadron, squadron));
}
function refreshFaultAircraftOptions() {
  const select = document.querySelector("#fault-aircraft");
  const current = select.value;
  const squadron = document.querySelector("#fault-squadron").value;
  const aircraft = squadron ? [...(SQUADRONS[squadron]?.aircraft || [])] : [...new Set(Object.values(SQUADRONS).flatMap((item) => item.aircraft))];
  select.replaceChildren(new Option("כל המטוסים", ""), ...aircraft.sort((a, b) => a.localeCompare(b, "he", { numeric: true })).map((number) => new Option(number, number)));
  select.value = aircraft.includes(current) ? current : "";
}
refreshFaultAircraftOptions();
document.querySelector("#fault-squadron").addEventListener("change", () => { refreshFaultAircraftOptions(); renderIssueLists(); });
for (const [inputId, optionsId, values] of [["history-aircraft", "history-aircraft-options", () => SQUADRONS[document.querySelector("#history-squadron").value]?.aircraft || []]]) {
  const input = document.getElementById(inputId), list = document.getElementById(optionsId);
  function showChoices() {
    list.replaceChildren();
    const query = input.value.trim().toLocaleLowerCase("he");
    values().filter((value) => String(value).toLocaleLowerCase("he").includes(query)).forEach((value) => {
      const choice = document.createElement("button"); choice.type = "button"; choice.className = "picker-option"; choice.setAttribute("role", "option"); choice.textContent = value;
      choice.addEventListener("pointerdown", (event) => event.preventDefault());
      choice.addEventListener("click", () => { input.value = value; list.hidden = true; input.setAttribute("aria-expanded", "false"); renderIssueLists(); });
      list.append(choice);
    });
    list.hidden = !list.children.length; input.setAttribute("aria-expanded", String(!list.hidden));
  }
  input.addEventListener("focus", showChoices);
  input.addEventListener("input", showChoices);
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; input.setAttribute("aria-expanded", "false"); }, 200));
  input.addEventListener("keydown", (event) => { if (event.key === "Escape") { list.hidden = true; input.setAttribute("aria-expanded", "false"); } if (event.key === "Enter" && !list.hidden && list.firstElementChild) { event.preventDefault(); list.firstElementChild.click(); } });
}
for (const systemId of ["history-aircraft-system", "history-component-system"]) {
  const select = document.getElementById(systemId);
  SYSTEMS.forEach((system) => select.append(new Option(system.name, system.name)));
  select.addEventListener("change", () => {
    const unit = document.getElementById(systemId === "history-aircraft-system" ? "history-aircraft-unit" : "history-unit");
    unit.replaceChildren(new Option("בחר מכלול", ""));
    (COMPONENTS_BY_SYSTEM[select.value] || []).forEach((name) => unit.append(new Option(name, name)));
    unit.disabled = unit.options.length === 1;
    document.querySelector("#history-unit-serial").value = "";
    document.querySelector("#history-unit-serial").disabled = true;
    renderFaultHistory();
  });
}
document.querySelector("#history-unit").addEventListener("change", () => { document.querySelector("#history-unit-serial").value = ""; document.querySelector("#history-unit-serial").disabled = !document.querySelector("#history-unit").value; renderFaultHistory(); });
document.querySelector("#history-squadron").addEventListener("change", () => { document.querySelector("#history-aircraft").value = ""; renderFaultHistory(); });
document.querySelector("#history-reset").addEventListener("click", () => {
  for (const id of ["history-squadron", "history-aircraft", "history-aircraft-system", "history-aircraft-unit", "history-component-system", "history-unit", "history-unit-serial"]) document.getElementById(id).value = "";
  for (const id of ["history-aircraft-unit", "history-unit"]) { document.getElementById(id).replaceChildren(new Option("בחר מכלול", "")); document.getElementById(id).disabled = true; }
  document.querySelector("#history-unit-serial").disabled = true;
  renderFaultHistory();
});
for (const id of ["fault-mode", "fault-technician", "fault-squadron", "fault-aircraft", "fault-from", "fault-to", "pending-category", "history-squadron", "history-aircraft", "history-aircraft-unit", "history-unit-serial"]) document.getElementById(id).addEventListener("input", renderIssueLists);
document.querySelector("#fault-mode").addEventListener("change", () => { document.querySelector("#closed-review-filters").hidden = document.querySelector("#fault-mode").value !== "closed"; });
function renderDirectory() {
  const body = document.querySelector("#technician-directory"); body.replaceChildren();
  const editor = document.querySelector("#directory-editor");
  const person = directoryAccounts.find((entry) => entry.uid === selectedDirectoryUid && !entry.deleted);
  editor.hidden = !person;
  if (!person) return;
  document.querySelector("#directory-editor-title").textContent = `פרטי טכנאי · ${person.name || person.personalNumber || "משתמש"}`;
  [person].forEach((person) => {
    if (person.deleted) return;
    const row = document.createElement("tr"), profile = {};
    const parts = (person.name || "").trim().split(/\s+/);
    let rankSelect, serviceInput;
    for (const [key, fallback] of [["firstName", parts[0] || ""], ["lastName", parts.slice(1).join(" ")], ["personalNumber", ""], ["workStage", ""], ["department", ""], ["serviceType", ""], ["rank", ""], ["license", "אין"]]) {
      const td = document.createElement("td"); td.dataset.label = ({ firstName: "שם", lastName: "שם משפחה", personalNumber: "מספר אישי", workStage: "שלב עבודה / הסמכה", department: "מחלקה", serviceType: "סוג שירות", rank: "דרגה", license: "רישיון" })[key];
      if (key === "personalNumber" && person.personalNumber) td.textContent = person.personalNumber;
      else {
        const choices = { workStage: WORK_STAGES, department: DEPARTMENTS, serviceType: SERVICE_TYPES, license: LICENSES };
        const input = document.createElement(["rank", ...Object.keys(choices)].includes(key) ? "select" : "input");
        input.maxLength = key === "personalNumber" ? 7 : 80; input.setAttribute("aria-label", `${td.dataset.label} · ${person.name || person.uid}`);
        if (key === "personalNumber") { input.inputMode = "numeric"; input.pattern = "[0-9]{7}"; input.placeholder = "הגדרה חד פעמית"; }
        if (choices[key]) {
          const value = person[key] || fallback;
          input.append(new Option(`בחר ${td.dataset.label}`, ""), ...choices[key].map((item) => new Option(key === "workStage" ? `שלב ${item}` : item, item)));
          if (value && !choices[key].includes(value)) input.append(new Option(`${value} · ערך קודם`, value));
          input.value = value;
        } else if (key !== "rank") input.value = person[key] || fallback;
        if (key === "rank") rankSelect = input;
        if (key === "serviceType") serviceInput = input;
        if (key !== "personalNumber") profile[key] = input;
        td.append(input);
        if (key === "workStage") {
          const certification = document.createElement("select"); certification.setAttribute("aria-label", `הסמכת מג״ת · ${person.name || person.uid}`);
          certification.append(new Option("ללא הסמכה", "false"), new Option("מוסמך מג״ת", "true"));
          certification.value = person.magatCertified === true ? "true" : "false";
          profile.magatCertified = certification;
          td.append(certification);
        }
      }
      row.append(td);
    }
    const refreshRank = (current = rankSelect.value || person.rank || "") => {
      const ranks = permanentService(serviceInput.value) ? PERMANENT_RANKS : REGULAR_RANKS;
      rankSelect.replaceChildren(new Option("בחר דרגה", ""), ...ranks.map((value) => new Option(value, value)));
      if (current && !ranks.includes(current)) rankSelect.append(new Option(`${current} · דרגה קודמת`, current));
      rankSelect.value = current;
    };
    refreshRank();
    serviceInput.addEventListener("change", () => refreshRank(""));
    const actions = document.createElement("td"); actions.dataset.label = "פעולות";
    const save = document.createElement("button"); save.type = "button"; save.className = "secondary-button"; save.textContent = "שמור פרטים";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const number = row.querySelector('td[data-label="מספר אישי"] input')?.value.trim();
        if (number) await setTechnicianPersonalNumber(person.uid, number);
        await updateAccountProfile(person.uid, Object.fromEntries(Object.entries(profile).map(([key, input]) => [key, key === "magatCertified" ? input.value === "true" : input.value])));
        setStatus("#directory-status", `פרטי ${person.name || "המשתמש"} נשמרו.`);
      } catch (error) { setStatus("#directory-status", `שמירת הפרטים נכשלה: ${error.message}`, true); }
      finally { save.disabled = false; }
    });
    actions.append(save); row.append(actions); body.append(row);
  });
}
let selectedDirectoryUid = "";
function selectDirectoryPerson(uid) {
  selectedDirectoryUid = uid;
  renderDirectory();
  document.querySelector("#directory-editor").scrollIntoView({ block: "start", behavior: "smooth" });
}
function renderDirectoryMatches() {
  const matches = document.querySelector("#directory-matches");
  const query = document.querySelector("#user-search").value.trim().toLocaleLowerCase("he");
  matches.replaceChildren();
  if (!query) { matches.textContent = "הקלד שם או מספר אישי כדי לבחור משתמש לעריכה."; return; }
  const found = directoryAccounts.filter((person) => !person.deleted && `${person.name || ""} ${person.personalNumber || ""}`.toLocaleLowerCase("he").includes(query));
  if (!found.length) { matches.textContent = "לא נמצאו משתמשים התואמים לחיפוש."; return; }
  found.slice(0, 30).forEach((person) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "secondary-button";
    button.textContent = `${person.name || "משתמש"}${person.personalNumber ? ` · ${person.personalNumber}` : ""}${person.role === "manager" ? " · מטיס" : ""}`;
    button.setAttribute("aria-label", `פתח פרטים של ${person.name || person.personalNumber || "משתמש"}`);
    button.addEventListener("click", () => selectDirectoryPerson(person.uid));
    matches.append(button);
  });
  if (found.length > 30) matches.append(document.createTextNode(`נמצאו ${found.length} משתמשים. הוסף אותיות לחיפוש מדויק יותר.`));
}
watchAccounts((accounts) => {
  directoryAccounts = accounts.sort((a, b) => (a.name || "").localeCompare(b.name || "", "he"));
  technicians = directoryAccounts.filter((person) => person.role === "technician");
  updateReportData({ users: technicians }); updateUserSelectors(); refreshTechnicianFilter(); renderDirectory(); renderDirectoryMatches(); renderUsers(); renderAttendance(directoryAccounts, setAttendanceStatus); updateDutyPeople(directoryAccounts); renderIssueLists();
}, (error) => setStatus("#directory-status", `טעינת הטבלה נכשלה: ${error.message}`, true));
function renderUsers() {
  const list = document.querySelector("#users-list");
  const removedList = document.querySelector("#removed-users-list");
  const search = document.querySelector("#user-search").value.trim().toLocaleLowerCase("he");
  list.replaceChildren();
  removedList.replaceChildren();
  if (!search) { list.textContent = "חפש משתמש כדי להציג את החשבון והפעולות שלו."; removedList.textContent = "חפש משתמש שהוסר כדי להציג את הפרטים שלו."; return; }
  if (!technicians.some((person) => person.active && !person.deleted)) list.textContent = "אין טכנאים פעילים. צור משתמש חדש.";
  if (!technicians.some((person) => !person.active && !person.deleted)) removedList.textContent = "אין משתמשים שהוסרו.";
  technicians.forEach((person) => {
    if (person.deleted) return;
    if (search && !`${person.name} ${person.personalNumber || ""}`.toLocaleLowerCase("he").includes(search)) return;
    const card = document.createElement("div"); card.className = "issue-item";
    const title = document.createElement("strong"); title.textContent = `${person.name} · ${person.active ? "פעיל" : "הוסר"}`;
    const email = document.createElement("span"); email.textContent = person.email || person.uid;
    const personal = document.createElement("span"); personal.textContent = `מספר אישי: ${person.personalNumber || "טרם הוגדר"}`;
    const assigned = cloudIssues.filter((issue) => (issue.teamUids || [issue.assigneeUid]).includes(person.uid));
    const distinct = new Map();
    const rank = { closed: 3, pendingReview: 2, open: 1, cancelled: 0 };
    assigned.forEach((issue) => {
      const key = `${issue.sheet?.serial || issue.id}|${issue.sheet?.squadron || ""}|${issue.sheet?.aircraft || ""}`;
      if (!distinct.has(key) || (rank[issue.status] || 0) > (rank[distinct.get(key).status] || 0)) distinct.set(key, issue);
    });
    const count = (status) => [...distinct.values()].filter((issue) => issue.status === status).length;
    const closed = [...distinct.values()].filter((issue) => issue.status === "closed");
    const history = document.createElement("p");
    const open = [...distinct.values()].filter((issue) => issue.status === "open");
    history.textContent = `תקלות פתוחות: ${open.length} · לסגירה: ${count("pendingReview")} · סגורות: ${closed.length} · מספרי תקלות פתוחות: ${open.map((issue) => issue.sheet.serial).join(", ") || "אין"}`;
    const view = document.createElement("button"); view.type = "button"; view.className = "secondary-button"; view.textContent = "הצג תקלות סגורות";
    view.textContent = "היסטוריית טכנאי";
    view.addEventListener("click", () => { location.hash = "open"; showManagerView(); document.querySelector("#fault-mode").value = "technician-history"; document.querySelector("#fault-technician").value = person.uid; renderIssueLists(); });
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "secondary-button"; reset.textContent = "אפס סיסמה";
    reset.addEventListener("click", async () => {
      if (!window.confirm(`לאפס את הסיסמה של ${person.name}? הסיסמה הקודמת תפסיק לעבוד.`)) return;
      reset.disabled = true;
      try { const temporary = await resetUserPassword(person.uid); setStatus("#user-status", `סיסמה זמנית עבור ${person.name}: ${temporary} · מסור אותה לטכנאי באופן פרטי. בכניסה הבאה יידרש לבחור סיסמה חדשה.`); }
      catch (error) { setStatus("#user-status", `איפוס הסיסמה נכשל: ${error.message}`, true); }
      finally { reset.disabled = false; }
    });
    const action = document.createElement("button"); action.type = "button"; action.className = "secondary-button";
    action.textContent = person.active ? "מחק משתמש" : "שחזר משתמש";
    action.addEventListener("click", async () => {
      if (person.active && assigned.some((issue) => issue.status === "open")) {
        setStatus("#user-status", `יש לשייך מחדש את התקלות הפתוחות של ${person.name} בדף ״תקלות פתוחות״ לפני הסרת המשתמש.`, true);
        return;
      }
      action.disabled = true;
      try {
        await setTechnicianActive(person.uid, !person.active);
        setStatus("#user-status", person.active ? `${person.name} הוסר מהמערכת והגישה שלו נחסמה. היסטוריית התקלות נשמרה.` : `${person.name} שוחזר.`);
      }
      catch (error) { setStatus("#user-status", `שינוי המשתמש נכשל: ${error.message}`, true); }
      finally { action.disabled = false; }
    });
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "secondary-button"; edit.textContent = "ערוך פרטי טכנאי";
    edit.addEventListener("click", () => selectDirectoryPerson(person.uid));
    card.append(title, email, personal, edit, view, history, reset, action);
    if (!person.active) {
      const destroy = document.createElement("button"); destroy.type = "button"; destroy.className = "secondary-button danger-button";
      destroy.textContent = "מחק סופית";
      destroy.addEventListener("click", async () => {
        if (!window.confirm(`למחוק סופית את חשבון ההתחברות של ${person.name} (${person.email || person.uid})? לא ניתן לשחזר אותו; תקלות סגורות יישמרו.`)) return;
        destroy.disabled = true;
        setStatus("#user-status", `מוחק את חשבון ההתחברות של ${person.name}…`);
        try { await deleteTechnicianPermanently(person.uid); setStatus("#user-status", `${person.name} נמחק סופית מ־Firebase Authentication. היסטוריית התקלות נשמרה.`); }
        catch (error) { setStatus("#user-status", error.code === "functions/not-found" ? "פונקציית המחיקה עדיין לא נפרסה ב־Firebase. יש לפרוס את deleteTechnicianPermanently כדי למחוק את החשבון סופית." : `המחיקה הסופית נכשלה: ${error.message}`, true); }
        finally { destroy.disabled = false; }
      });
      card.append(destroy);
    }
    (person.active ? list : removedList).append(card);
  });
  if (search && !list.children.length) list.textContent = "לא נמצאו משתמשים פעילים התואמים לחיפוש.";
  if (search && !removedList.children.length) removedList.textContent = "לא נמצאו משתמשים שהוסרו התואמים לחיפוש.";
}
document.querySelector("#user-search").addEventListener("input", () => { selectedDirectoryUid = ""; renderDirectory(); renderDirectoryMatches(); renderUsers(); });
renderDirectoryMatches();
function refreshTechnicianFilter() {
  const select = document.querySelector("#fault-technician"), previous = select.value;
  select.replaceChildren(new Option("כל הטכנאים", ""), ...technicians.map((person) => new Option(`${person.name}${person.personalNumber ? ` · ${person.personalNumber}` : ""}`, person.uid)));
  select.value = previous;
}
const userForm = document.querySelector("#create-user-form");
function refreshNewUserRanks() {
  const select = userForm.elements.rank, old = select.value;
  const ranks = permanentService(userForm.elements.serviceType.value) ? PERMANENT_RANKS : REGULAR_RANKS;
  select.replaceChildren(new Option("בחר דרגה", ""), ...ranks.map((value) => new Option(value, value)));
  select.value = ranks.includes(old) ? old : "";
}
userForm.elements.serviceType.addEventListener("change", refreshNewUserRanks);
refreshNewUserRanks();
userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = userForm.querySelector('button[type="submit"]'); button.disabled = true;
  setStatus("#user-status", "יוצר משתמש…");
  try {
    const firstName = userForm.elements.firstName.value.trim(), lastName = userForm.elements.lastName.value.trim();
    await createTechnician(`${firstName} ${lastName}`, userForm.elements.email.value, userForm.elements.password.value, userForm.elements.personalNumber.value.trim(), { firstName, lastName, workStage: userForm.elements.workStage.value.trim(), magatCertified: userForm.elements.magatCertified.value === "true", department: userForm.elements.department.value.trim(), serviceType: userForm.elements.serviceType.value.trim(), rank: userForm.elements.rank.value, license: userForm.elements.license.value });
    userForm.reset(); refreshNewUserRanks(); setStatus("#user-status", "הטכנאי נוצר. מסור לו את פרטי הכניסה בערוץ מתאים.");
  } catch (error) { setStatus("#user-status", `יצירת המשתמש נכשלה: ${error.message}`, true); }
  finally { button.disabled = false; }
});
const locallyClosed = new Set(EzEizoData.readClosed().map((item) => item.id));
const legacy = EzEizoData.readIssues().filter((item) => item?.id && item.id !== "example" && !locallyClosed.has(item.id));
if (fullManager && legacy.length) {
  setStatus("#legacy-status", `נמצאו ${legacy.length} תקלות מקומיות ישנות. מעביר אותן למסד המשותף…`);
  let imported = 0;
  for (const item of legacy) {
    try { await createIssue(EzEizoData.normalizeSheet(item), { uid: "", name: "" }, true); imported++; }
    catch (error) { setStatus("#legacy-status", `הועברו ${imported} מתוך ${legacy.length}. שגיאה: ${error.message}`, true); break; }
  }
  if (imported === legacy.length) setStatus("#legacy-status", `${imported} תקלות מקומיות הועברו למסד המשותף.`);
}
if (fullManager) initReports();
let initialProfilesApplied = false;
initAircraftConstants({ user: managerUser, onProfilesLoaded: () => {
  if (!initialProfilesApplied && selections.squadron && selections.aircraft) {
    draft.constants = constantsForAircraft(selections.squadron, selections.aircraft);
    renderConstants();
  }
  initialProfilesApplied = true;
} });
watchKeyLoads((loads) => { cloudKeyLoads = loads; updateReportData({ loads }); renderIssueLists(); }, (error) => { setStatus("#report-error", `טעינת הטענות נכשלה: ${error.message}`, true); });
renderConstants();
renderActions();
renderIssueLists();
showManagerView();
revealApp();
const clearDispatcherSignature = attachSignaturePad(document.querySelector("#dispatcher-signature"), {
  initial: draft.dispatcherSignature,
  onChange: (value) => { draft.dispatcherSignature = value; saveDraft(); }
});
document.querySelector("#clear-dispatcher-signature").addEventListener("click", clearDispatcherSignature);
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
