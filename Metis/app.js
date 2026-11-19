import "../sheet-data.js?v=1.10.0";
import { gate, watchIssues, watchTechnicians, createIssue, createTechnician, setTechnicianActive, assignIssue } from "../firebase-sync.js?v=1.10.0";
import { SQUADRONS, SYSTEMS, validateCatalogSelection } from "./catalog.js?v=1.10.0";

await gate("manager");
document.querySelector(".brand-copy h1").textContent = "Metis · נימר";
let cloudIssues = [];
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

const pickers = Object.fromEntries([...document.querySelectorAll("[data-picker]")].map((root) => [root.dataset.picker, {
  root, input: root.querySelector("input"), list: root.querySelector(".picker-list"), matches: [], activeIndex: 0
}]));

function availableFor(key) {
  if (key === "squadron") return Object.keys(SQUADRONS);
  if (key === "systemName") return SYSTEMS.map((system) => system.name);
  return Object.hasOwn(SQUADRONS, selections.squadron) ? SQUADRONS[selections.squadron][key === "shelter" ? "shelters" : "aircraft"] : [];
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
    option.addEventListener("pointerdown", (event) => { event.preventDefault(); choosePicker(key, value); });
    option.addEventListener("click", () => choosePicker(key, value));
    picker.list.append(option);
  });
  picker.list.hidden = false;
  picker.input.setAttribute("aria-expanded", "true");
  if (picker.matches.length) picker.input.setAttribute("aria-activedescendant", `option-${key}-0`);
}

function refreshPickers() {
  for (const [key, picker] of Object.entries(pickers)) {
    picker.input.disabled = (key === "shelter" || key === "aircraft") && !selections.squadron;
    picker.input.placeholder = picker.input.disabled ? "בחר טייסת תחילה" : key === "aircraft" ? "חפש ובחר מספר מטוס" : key === "shelter" ? "חפש ובחר דת״ק" : key === "systemName" ? "חפש ובחר מערכת" : "חפש ובחר טייסת";
    picker.input.value = selections[key] || "";
    closePicker(key);
  }
  document.querySelector('[data-sheet-field="systemCode"]').value = draft.systemCode;
  document.querySelector('[data-sheet-field="ewSystem"]').value = draft.ewSystem;
}

function clearPicker(key) {
  selections[key] = "";
  draft[key] = "";
  if (key === "squadron") {
    selections.shelter = ""; selections.aircraft = "";
    draft.shelter = ""; draft.aircraft = ""; draft.ewSystem = "";
  }
  if (key === "aircraft") draft.ewSystem = "";
  if (key === "systemName") draft.systemCode = "";
  draft.location = [draft.shelter, draft.squadron].filter(Boolean).join("/");
  refreshPickers();
  saveDraft();
}

function choosePicker(key, value) {
  if (!availableFor(key).includes(value)) return;
  if (key === "squadron" && selections.squadron !== value) {
    selections.shelter = ""; selections.aircraft = "";
    draft.shelter = ""; draft.aircraft = ""; draft.ewSystem = "";
  }
  selections[key] = value;
  draft[key] = value;
  if (key === "aircraft") draft.ewSystem = "גרניט";
  if (key === "systemName") draft.systemCode = SYSTEMS.find((system) => system.name === value).code;
  draft.location = [draft.shelter, draft.squadron].filter(Boolean).join("/");
  refreshPickers();
  saveDraft();
  pickers[key].input.focus({ preventScroll: true });
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
  }, 120));
}

function restorePickers() {
  if (!Object.hasOwn(SQUADRONS, selections.squadron) || draft.squadron !== selections.squadron) selections.squadron = "";
  for (const key of ["shelter", "aircraft", "systemName"]) {
    if (!availableFor(key).includes(selections[key]) || draft[key] !== selections[key]) selections[key] = "";
  }
  for (const key of Object.keys(pickers)) draft[key] = selections[key] || "";
  draft.systemCode = SYSTEMS.find((system) => system.name === selections.systemName)?.code || "";
  draft.ewSystem = selections.aircraft ? "גרניט" : "";
  draft.location = [draft.shelter, draft.squadron].filter(Boolean).join("/");
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
  const catalogError = validateCatalogSelection(selections, draft);
  if (catalogError) { setStatus("#created-status", catalogError.message, true); pickers[catalogError.field].input.focus(); return; }
  const uid = document.querySelector("#new-assignee").value;
  const assignee = technicians.find((person) => person.uid === uid && person.active);
  if (!assignee) { setStatus("#created-status", "בחר טכנאי פעיל לפני פתיחת התקלה.", true); document.querySelector("#new-assignee").focus(); return; }
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
    sheet.serial = await createIssue(sheet, { uid, name: assignee.name });
    setStatus("#created-status", `תקלה מספר ${sheet.serial} הוקצתה ל־${assignee.name}.`);
    window.location.hash = "open";
  } catch (error) { setStatus("#created-status", `פתיחת התקלה נכשלה: ${error.message}`, true); }
  finally { button.disabled = false; }
});

function addIssueCard(container, item, isClosed) {
  const card = document.createElement("div");
  card.className = "issue-item";
  const title = document.createElement("strong");
  title.textContent = `תקלה ${item.serial || "ללא מספר"} · מטוס ${item.aircraft || "—"} · ${item.location || "—"}`;
  const subtitle = document.createElement("span");
  const fullIssue = cloudIssues.find((issue) => issue.id === item.id);
  subtitle.textContent = `${item.fault || "ללא תיאור"} · ${isClosed ? "סגורה" : "פתוחה"} · ${fullIssue?.assigneeName || "לא שובצה"}`;
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
    const state = fullIssue?.closed?.state;
    if (state) {
      const work = document.createElement("p");
      work.textContent = `פעולות: ${state.actions?.map((checked, index) => `${index + 1}: ${index === 10 && state.action11Result === "notRequired" ? "X" : checked ? "✓" : "—"}`).join(" · ") || "—"}`;
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
  }
  container.append(card);
}

function renderIssueLists() {
  const opened = document.querySelector("#issued-list");
  const closed = document.querySelector("#closed-list");
  opened.replaceChildren();
  closed.replaceChildren();
  delete opened.dataset.state;
  delete closed.dataset.state;
  const filter = document.querySelector("#closed-filter").value;
  const allClosed = cloudIssues.filter((item) => item.status === "closed" && item.closed?.record && (!filter || item.assigneeUid === filter)).map((item) => item.closed.record);
  const active = cloudIssues.filter((item) => item.status === "open").map((item) => item.sheet);
  active.forEach((item) => addIssueCard(opened, item, false));
  allClosed.forEach((item) => addIssueCard(closed, item, true));
  if (!active.length) opened.textContent = "אין תקלות פתוחות.";
  if (!allClosed.length) closed.textContent = "אין תקלות סגורות.";
}

function showManagerView() {
  const requested = window.location.hash.slice(1);
  const selected = ["new", "open", "closed", "users"].includes(requested) ? requested : "new";
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
  selections = {};
  for (const key of Object.keys(pickers)) draft[key] = "";
  draft.systemCode = "";
  draft.ewSystem = "";
  draft.location = "";
  document.querySelectorAll("[data-sheet-field]").forEach((input) => { input.value = draft[input.dataset.sheetField] || ""; });
  refreshPickers();
  renderConstants();
  renderActions();
  saveDraft();
  setStatus("#created-status", "");
  window.location.hash = "new";
  document.querySelector("#manager-details-title").scrollIntoView({ behavior: "smooth", block: "start" });
});

watchIssues((issues) => { cloudIssues = issues; renderIssueLists(); renderUsers(); }, (error) => {
  setStatus("#issued-list", `לא ניתן לטעון תקלות: ${error.message}`, true);
  setStatus("#closed-list", `לא ניתן לטעון תקלות: ${error.message}`, true);
});
function updateUserSelectors() {
  for (const selector of ["#new-assignee", "#closed-filter"]) {
    const element = document.querySelector(selector);
    const previous = element.value;
    element.replaceChildren(new Option(selector === "#new-assignee" ? "בחר טכנאי פעיל" : "כל הטכנאים", ""));
    technicians.filter((person) => selector === "#closed-filter" || person.active).forEach((person) => element.append(new Option(`${person.name}${person.active ? "" : " (מושבת)"}`, person.uid)));
    element.value = previous;
  }
}
document.querySelector("#closed-filter").addEventListener("change", renderIssueLists);
function renderUsers() {
  const list = document.querySelector("#users-list");
  list.replaceChildren();
  if (!technicians.length) { list.textContent = "עדיין אין טכנאים. צור משתמש חדש או שני חשבונות לדוגמה."; return; }
  technicians.forEach((person) => {
    const card = document.createElement("div"); card.className = "issue-item";
    const title = document.createElement("strong"); title.textContent = `${person.name} · ${person.active ? "פעיל" : "מושבת"}`;
    const email = document.createElement("span"); email.textContent = person.email || person.uid;
    const assigned = cloudIssues.filter((issue) => issue.assigneeUid === person.uid);
    const closed = assigned.filter((issue) => issue.status === "closed");
    const history = document.createElement("p");
    history.textContent = `תקלות פתוחות: ${assigned.length - closed.length} · תקלות סגורות: ${closed.length} · מספרים סידוריים: ${closed.map((issue) => issue.sheet.serial).join(", ") || "אין"}`;
    const view = document.createElement("button"); view.type = "button"; view.className = "secondary-button"; view.textContent = "הצג דפים סגורים";
    view.addEventListener("click", () => { document.querySelector("#closed-filter").value = person.uid; location.hash = "closed"; renderIssueLists(); });
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "secondary-button";
    toggle.textContent = person.active ? "השבת גישה" : "הפעל גישה";
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      try { await setTechnicianActive(person.uid, !person.active); }
      catch (error) { setStatus("#user-status", `שינוי המשתמש נכשל: ${error.message}`, true); }
      finally { toggle.disabled = false; }
    });
    card.append(title, email, history, view, toggle); list.append(card);
  });
}
watchTechnicians((items) => { technicians = items.sort((a, b) => a.name.localeCompare(b.name, "he")); updateUserSelectors(); renderUsers(); renderIssueLists(); }, (error) => {
  setStatus("#user-status", `טעינת המשתמשים נכשלה: ${error.message}`, true);
});
const userForm = document.querySelector("#create-user-form");
userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = userForm.querySelector('button[type="submit"]'); button.disabled = true;
  setStatus("#user-status", "יוצר משתמש…");
  try {
    await createTechnician(userForm.elements.name.value, userForm.elements.email.value, userForm.elements.password.value);
    userForm.reset(); setStatus("#user-status", "הטכנאי נוצר. מסור לו את פרטי הכניסה בערוץ מתאים.");
  } catch (error) { setStatus("#user-status", `יצירת המשתמש נכשלה: ${error.message}`, true); }
  finally { button.disabled = false; }
});
document.querySelector("#create-demo-users").addEventListener("click", async (event) => {
  const button = event.currentTarget; button.disabled = true;
  const panel = document.querySelector("#demo-credentials"); panel.hidden = false;
  panel.textContent = "שמור את פרטי הכניסה כעת; הסיסמאות לא יוצגו שוב לאחר רענון.";
  for (let index = 1; index <= 2; index++) {
    const token = crypto.randomUUID().slice(0, 12);
    const email = `demo-${token}@ezeizo.example`;
    const password = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
    try {
      await createTechnician(`טכנאי דוגמה ${index}`, email, password);
      const detail = document.createElement("p"); detail.textContent = `טכנאי דוגמה ${index}: ${email} · סיסמה: ${password}`; panel.append(detail);
      setStatus("#user-status", `${index} חשבונות דוגמה נוצרו.`);
    } catch (error) { setStatus("#user-status", `יצירת טכנאי דוגמה ${index} נכשלה: ${error.message}`, true); break; }
  }
  button.disabled = false;
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
renderConstants();
renderActions();
renderIssueLists();
showManagerView();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
