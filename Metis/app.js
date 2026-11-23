import "../sheet-data.js?v=1.7.6";
import { gate, revealApp, watchIssues, watchKeyLoads, watchTechnicians, createIssue, createAssignedIssues, createTechnician, setTechnicianPersonalNumber, updateOpenIssueDefinition, setTechnicianActive, deleteTechnicianPermanently, assignIssue, appendIssueManagerNote, cancelIssueDispatch } from "../firebase-sync.js?v=1.8.0";
import { SQUADRONS, SYSTEMS, COMPONENTS_BY_SYSTEM, WORKSHOPS, EW_SYSTEMS, validateCatalogSelection } from "./catalog.js?v=1.7.6";
import { resolveAssignees } from "./assignee-selection.js?v=1.7.6";
import { attachSignaturePad } from "../signature-canvas.js?v=1.7.6";
import { initKeyPages } from "../keys/app.js?v=1.7.6";
import { initReports, updateReportData, initAircraftConstants, constantsForAircraft, closeConstantsEditor } from "./management-pages.js?v=1.7.6";
import { FAULT_FILTERS, ORIGINS, filterIssues, componentHistory } from "./fault-taxonomy.js?v=1.8.0";

const managerUser = await gate("manager");
document.querySelector(".brand-copy h1").textContent = "Metis · נימר";
let cloudIssues = [];
let cloudKeyLoads = [];
let technicians = [];
const DRAFT_KEY = "ezeizo-metis-draft-v1";
const PICKER_KEY = "ezeizo-metis-picker-v1";
let draft = loadDraft();
let selections = loadSelections();
const draftStatus = document.querySelector("#draft-status");

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
    option.className = "picker-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(value === selections[key]));
    option.textContent = value;
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

document.querySelector("#create-link").addEventListener("click", async () => {
  const button = document.querySelector("#create-link");
  const acknowledgment = document.querySelector("#creation-ack");
  if (!acknowledgment.checked) { setStatus("#created-status", "יש לאשר את בדיקת פרטי התקלה לפני פתיחתה.", true); acknowledgment.focus(); return; }
  if (!draft.dispatcherSignature) { setStatus("#created-status", "חובה להחתים את משלח המשימה על תדריך הבטיחות וניהול הסיכונים.", true); document.querySelector("#dispatcher-signature").scrollIntoView({ block: "center" }); return; }
  const catalogError = validateCatalogSelection(selections, draft);
  if (catalogError) { setStatus("#created-status", catalogError.message, true); (pickers[catalogError.field]?.input || document.querySelector("#ew-system-select")).focus(); return; }
  const { assignees, error: assigneeError } = resolveAssignees(selectedAssigneeUids(), technicians);
  if (assigneeError) { setStatus("#created-status", assigneeError, true); document.querySelector("#new-assignees").scrollIntoView({ block: "center" }); return; }
  button.disabled = true;
  const sheet = EzEizoData.normalizeSheet(draft);
  if (!sheet.fault.trim()) {
    setStatus("#created-status", "חובה למלא תיאור תקלה לפני פתיחת התקלה.", true);
    document.querySelector('[data-sheet-field="fault"]').focus();
    button.disabled = false;
    return;
  }
  sheet.id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    sheet.serial = await createAssignedIssues(sheet, assignees);
    resetFaultDraft();
    setStatus("#created-status", `תקלה מספר ${sheet.serial} הוקצתה ל־${assignees.map((person) => person.name).join(" ו־")}. הטופס מוכן לפתיחת תקלה חדשה.`);
    window.location.hash = "open";
  } catch (error) { setStatus("#created-status", `פתיחת התקלה נכשלה: ${error.message}`, true); }
  finally { button.disabled = false; }
});

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
  const notes = makeField("הערות מנהל", document.createElement("textarea")); notes.rows = 2; notes.maxLength = 2000; notes.value = issue.sheet.managerNotes || "";
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
  form.append(fields, origins, team, save, status); editor.append(summary, form); card.append(editor);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const members = [...team.querySelectorAll("input:checked")].map((box) => technicians.find((person) => person.uid === box.value && person.active)).filter(Boolean);
    if (!fault.value.trim() || members.length < 2 || !shelter.value || !aircraft.value) { status.textContent = "מלא תיאור, מיקום ומטוס ובחר לפחות שני טכנאים פעילים."; status.dataset.state = "error"; return; }
    save.disabled = true; status.textContent = "בודק נעילה ושומר…"; delete status.dataset.state;
    try {
      const faultOrigins = [...origins.querySelectorAll("input:checked")].map((box) => box.value);
      await updateOpenIssueDefinition(issue.id, { squadron: squadron.value, shelter: shelter.value, workshop: shelter.value === "מוסך" ? workshop.value : "", aircraft: aircraft.value, systemName: system.value, systemCode: code.value.trim(), reviewCategory: category.value, fault: fault.value.trim(), managerNotes: notes.value.trim(), faultOrigins, faultOrigin: faultOrigins[0] || "" }, members);
      status.textContent = "פרטי התקלה עודכנו ונשלחו לצוות.";
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
  subtitle.textContent = `${item.fault || "ללא תיאור"} · ${mode === "closed" ? "סגורה" : mode === "pendingReview" ? "ממתינה לבודק הדף" : mode === "cancelled" ? "שילוח בוטל" : "פתוחה"} · ${(fullIssue?.teamNames || [fullIssue?.assigneeName || "לא שובצה"]).join(" · ")}`;
  card.append(title, subtitle);
  if (mode === "cancelled") {
    const reason = document.createElement("span"); reason.textContent = `סיבת הביטול: ${fullIssue?.cancellationReason || "—"}`; card.append(reason);
  } else if (mode !== "open") {
    const view = document.createElement("a");
    view.className = "secondary-button";
    view.href = `./closed.html?id=${encodeURIComponent(item.id)}`;
    view.textContent = mode === "pendingReview" ? "בדוק וחתום" : "פתח דף סגור";
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
    const summary = document.createElement("summary"); summary.textContent = "הערות מנהל";
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
  container.append(card);
}

function renderIssueLists() {
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
  const active = filterIssues(cloudIssues, { mode: document.querySelector("#fault-mode").value, technicianUids, serial: document.querySelector("#open-issue-search").value, squadron: document.querySelector("#fault-squadron").value, aircraft: document.querySelector("#fault-aircraft").value.trim(), from: document.querySelector("#fault-from").value, to: document.querySelector("#fault-to").value, reviewFilters: [...document.querySelectorAll("[data-closed-filter]:checked")].map((input) => input.dataset.closedFilter), originFilters: [...document.querySelectorAll("[data-closed-origin]:checked")].map((input) => input.dataset.closedOrigin) });
  [...new Map(active.map((issue) => [issue.sheet.serial, issue])).values()].forEach((issue) => addIssueCard(opened, issue.closed?.record || issue.sheet, issue.status));
  const pendingCategory = document.querySelector("#pending-category").value;
  awaiting.filter((item) => !pendingCategory || cloudIssues.find((issue) => issue.id === item.id)?.sheet?.reviewCategory === pendingCategory).forEach((item) => addIssueCard(pending, item, "pendingReview"));
  if (!pendingCategory) cloudKeyLoads.filter((load) => load.status === "pendingReview" && matches("#pending-issue-search", load.serial)).forEach((load) => {
    const card = document.createElement("article"); card.className = "issue-item";
    const title = document.createElement("strong"); title.textContent = `הטענת מפתחות ${load.serial || "—"} · טייסת ${load.squadron}`;
    const subtitle = document.createElement("span"); subtitle.textContent = `מטוסים: ${(load.aircraftIds || []).join(", ")} · צוות: ${(load.teamNames || []).join(" · ")}`;
    const link = document.createElement("a"); link.className = "secondary-button"; link.href = `#keys/work/${encodeURIComponent(load.id)}`; link.textContent = "בדוק וסגור הטענה";
    card.append(title, subtitle, link); pending.append(card);
  });
  if (!active.length) opened.textContent = "לא נמצאו תקלות התואמות לסינון.";
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
    if (["closed", "pendingReview"].includes(issue.status)) { const link = document.createElement("a"); link.className = "secondary-button"; link.href = `./closed.html?id=${encodeURIComponent(issue.id)}`; link.textContent = "פתח דף תקלה"; card.append(link); }
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
function showManagerView() {
  const requested = window.location.hash.slice(1);
  const selected = requested === "keys" || requested.startsWith("keys/") ? "keys" : requested === "closed" ? "open" : ["home", "management", "reports", "aircraft-constants", "new", "open", "pending", "history", "users"].includes(requested) ? requested : "home";
  if (requested === "closed") document.querySelector("#fault-mode").value = "closed";
  if (selected === "open" && previousManagerView !== "open" && requested !== "closed") document.querySelector("#fault-mode").value = "open-default";
  previousManagerView = selected;
  document.querySelector("#closed-review-filters").hidden = !["closed"].includes(document.querySelector("#fault-mode").value);
  document.querySelector("#manager-back").hidden = !["users", "reports", "aircraft-constants"].includes(selected);
  document.querySelector("#reset-draft").hidden = requested !== "new" && requested !== "keys/create";
  if (selected !== "keys") document.querySelector("#key-back-link").hidden = true;
  document.querySelector("#fault-nav").hidden = !["new", "open", "pending", "history"].includes(selected);
  document.querySelectorAll("[data-manager-view]").forEach((view) => { view.hidden = view.dataset.managerView !== (selected === "pending" ? "closed" : selected); });
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    const nav = ["new", "open", "pending", "history"].includes(selected) ? "faults" : ["users", "reports", "aircraft-constants"].includes(selected) ? "management" : selected;
    if (link.dataset.viewLink === nav) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-fault-link]").forEach((link) => { if (link.dataset.faultLink === selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  if (selected === "keys" && !keyPagesStarted) { keyPagesStarted = true; initKeyPages({ user: managerUser, embedded: true }); }
  if (selected !== "new") renderIssueLists();
}
document.querySelector("#manager-back").addEventListener("click", () => { if (location.hash === "#aircraft-constants" && closeConstantsEditor()) return; location.hash = "management"; });
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

watchIssues((issues) => {
  cloudIssues = issues;
  updateReportData({ issues });
  document.querySelector("#home-open-count").textContent = `${issues.filter((item) => item.status === "open").length} תקלות פתוחות`;
  document.querySelector("#home-review-count").textContent = `${issues.filter((item) => item.status === "pendingReview").length} ממתינות לסגירה · ${issues.filter((item) => item.status === "closed").length} סגורות`;
  renderIssueLists(); renderUsers();
}, (error) => {
  setStatus("#issued-list", `לא ניתן לטעון תקלות: ${error.message}`, true);
  setStatus("#pending-list", `לא ניתן לטעון תקלות: ${error.message}`, true);
});
function selectedAssigneeUids() {
  return [...document.querySelectorAll('#new-assignees select')].map((select) => select.value);
}
function syncAssigneeNames() {
  const selected = selectedAssigneeUids().filter(Boolean);
  const duplicate = selected.length !== new Set(selected).size;
  document.querySelectorAll('#new-assignees select').forEach((select) => { select.setAttribute('aria-invalid', String(Boolean(select.value && selected.filter((uid) => uid === select.value).length > 1))); });
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
    const select = document.createElement('select'); select.setAttribute('aria-label', roleLabel);
    select.append(new Option('בחר טכנאי', ''));
    technicians.filter((person) => person.active).forEach((person) => select.append(new Option(person.name, person.uid)));
    select.value = uid;
    select.addEventListener('change', syncAssigneeNames);
    label.append(select); row.append(label);
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
function renderUsers() {
  const list = document.querySelector("#users-list");
  const removedList = document.querySelector("#removed-users-list");
  const search = document.querySelector("#user-search").value.trim().toLocaleLowerCase("he");
  list.replaceChildren();
  removedList.replaceChildren();
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
    const numberInput = document.createElement("input"); numberInput.type = "text"; numberInput.inputMode = "numeric"; numberInput.pattern = "[0-9]{7}"; numberInput.maxLength = 7; numberInput.value = person.personalNumber || ""; numberInput.placeholder = "מספר אישי בן 7 ספרות"; numberInput.setAttribute("aria-label", `מספר אישי של ${person.name}`);
    const saveNumber = document.createElement("button"); saveNumber.type = "button"; saveNumber.className = "secondary-button"; saveNumber.textContent = "שמור מספר אישי";
    saveNumber.addEventListener("click", async () => { saveNumber.disabled = true; try { await setTechnicianPersonalNumber(person.uid, numberInput.value.trim()); setStatus("#user-status", `המספר האישי של ${person.name} נשמר.`); } catch (error) { setStatus("#user-status", `שמירת המספר האישי נכשלה: ${error.message}`, true); } finally { saveNumber.disabled = false; } });
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
    card.append(title, email, personal, numberInput, saveNumber, history, view, action);
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
document.querySelector("#user-search").addEventListener("input", renderUsers);
function refreshTechnicianFilter() {
  const select = document.querySelector("#fault-technician"), previous = select.value;
  select.replaceChildren(new Option("כל הטכנאים", ""), ...technicians.map((person) => new Option(`${person.name}${person.personalNumber ? ` · ${person.personalNumber}` : ""}`, person.uid)));
  select.value = previous;
}
watchTechnicians((items) => { technicians = items.sort((a, b) => a.name.localeCompare(b.name, "he")); updateReportData({ users: technicians }); updateUserSelectors(); refreshTechnicianFilter(); renderUsers(); renderIssueLists(); }, (error) => {
  setStatus("#user-status", `טעינת המשתמשים נכשלה: ${error.message}`, true);
});
const userForm = document.querySelector("#create-user-form");
userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = userForm.querySelector('button[type="submit"]'); button.disabled = true;
  setStatus("#user-status", "יוצר משתמש…");
  try {
    await createTechnician(userForm.elements.name.value, userForm.elements.email.value, userForm.elements.password.value, userForm.elements.personalNumber.value.trim());
    userForm.reset(); setStatus("#user-status", "הטכנאי נוצר. מסור לו את פרטי הכניסה בערוץ מתאים.");
  } catch (error) { setStatus("#user-status", `יצירת המשתמש נכשלה: ${error.message}`, true); }
  finally { button.disabled = false; }
});
const locallyClosed = new Set(EzEizoData.readClosed().map((item) => item.id));
const legacy = EzEizoData.readIssues().filter((item) => item?.id && item.id !== "example" && !locallyClosed.has(item.id));
if (legacy.length) {
  setStatus("#legacy-status", `נמצאו ${legacy.length} תקלות מקומיות ישנות. מעביר אותן למסד המשותף…`);
  let imported = 0;
  for (const item of legacy) {
    try { await createIssue(EzEizoData.normalizeSheet(item), { uid: "", name: "" }, true); imported++; }
    catch (error) { setStatus("#legacy-status", `הועברו ${imported} מתוך ${legacy.length}. שגיאה: ${error.message}`, true); break; }
  }
  if (imported === legacy.length) setStatus("#legacy-status", `${imported} תקלות מקומיות הועברו למסד המשותף.`);
}
initReports();
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
