import "../sheet-data.js?v=1.8.0";
import { gate, watchIssues, watchTechnicians, createIssue, createTechnician, setTechnicianActive, assignIssue } from "../firebase-sync.js?v=1.8.0";

await gate("manager");
document.querySelector(".brand-copy h1").textContent = "Metis · נימר";
let cloudIssues = [];
let technicians = [];
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
  const uid = document.querySelector("#new-assignee").value;
  const assignee = technicians.find((person) => person.uid === uid && person.active);
  if (!assignee) { document.querySelector("#created-status").textContent = "בחר טכנאי פעיל לפני פתיחת התקלה."; return; }
  button.disabled = true;
  const sheet = EzEizoData.normalizeSheet(draft);
  sheet.id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    sheet.serial = await createIssue(sheet, { uid, name: assignee.name });
    document.querySelector("#created-status").textContent = `תקלה מספר ${sheet.serial} הוקצתה ל־${assignee.name}.`;
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
    select.addEventListener("change", async () => {
      const person = technicians.find((entry) => entry.uid === select.value && entry.active);
      if (!person) { select.value = fullIssue?.assigneeUid || ""; return; }
      select.disabled = true;
      try { await assignIssue(item.id, person.uid, person.name); }
      catch (error) { alert(`השיבוץ נכשל: ${error.message}`); select.value = fullIssue?.assigneeUid || ""; }
      finally { select.disabled = false; }
    });
    assignLabel.append(select);
    card.append(assignLabel);
  }
  container.append(card);
}

function renderIssueLists() {
  const opened = document.querySelector("#issued-list");
  const closed = document.querySelector("#closed-list");
  opened.replaceChildren();
  closed.replaceChildren();
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
  document.querySelectorAll("[data-sheet-field]").forEach((input) => { input.value = draft[input.dataset.sheetField] || ""; });
  renderConstants();
  renderActions();
  saveDraft();
  document.querySelector("#created-status").textContent = "";
  window.location.hash = "new";
  document.querySelector("#manager-details-title").scrollIntoView({ behavior: "smooth", block: "start" });
});

watchIssues((issues) => { cloudIssues = issues; renderIssueLists(); renderUsers(); }, (error) => {
  document.querySelector("#issued-list").textContent = `לא ניתן לטעון תקלות: ${error.message}`;
  document.querySelector("#closed-list").textContent = `לא ניתן לטעון תקלות: ${error.message}`;
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
      catch (error) { document.querySelector("#user-status").textContent = `שינוי המשתמש נכשל: ${error.message}`; }
      finally { toggle.disabled = false; }
    });
    card.append(title, email, history, view, toggle); list.append(card);
  });
}
watchTechnicians((items) => { technicians = items.sort((a, b) => a.name.localeCompare(b.name, "he")); updateUserSelectors(); renderUsers(); renderIssueLists(); }, (error) => {
  document.querySelector("#user-status").textContent = `טעינת המשתמשים נכשלה: ${error.message}`;
});
const userForm = document.querySelector("#create-user-form");
userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = userForm.querySelector('button[type="submit"]'); button.disabled = true;
  const status = document.querySelector("#user-status"); status.textContent = "יוצר משתמש…";
  try {
    await createTechnician(userForm.elements.name.value, userForm.elements.email.value, userForm.elements.password.value);
    userForm.reset(); status.textContent = "הטכנאי נוצר. מסור לו את פרטי הכניסה בערוץ מתאים.";
  } catch (error) { status.textContent = `יצירת המשתמש נכשלה: ${error.message}`; }
  finally { button.disabled = false; }
});
document.querySelector("#create-demo-users").addEventListener("click", async (event) => {
  const button = event.currentTarget; button.disabled = true;
  const status = document.querySelector("#user-status");
  const panel = document.querySelector("#demo-credentials"); panel.hidden = false;
  panel.textContent = "שמור את פרטי הכניסה כעת; הסיסמאות לא יוצגו שוב לאחר רענון.";
  for (let index = 1; index <= 2; index++) {
    const token = crypto.randomUUID().slice(0, 12);
    const email = `demo-${token}@ezeizo.example`;
    const password = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
    try {
      await createTechnician(`טכנאי דוגמה ${index}`, email, password);
      const detail = document.createElement("p"); detail.textContent = `טכנאי דוגמה ${index}: ${email} · סיסמה: ${password}`; panel.append(detail);
      status.textContent = `${index} חשבונות דוגמה נוצרו.`;
    } catch (error) { status.textContent = `יצירת טכנאי דוגמה ${index} נכשלה: ${error.message}`; break; }
  }
  button.disabled = false;
});
const locallyClosed = new Set(EzEizoData.readClosed().map((item) => item.id));
const legacy = EzEizoData.readIssues().filter((item) => item?.id && item.id !== "example" && !locallyClosed.has(item.id));
if (legacy.length) {
  const status = document.querySelector("#legacy-status");
  status.textContent = `נמצאו ${legacy.length} תקלות מקומיות ישנות. מעביר אותן למסד המשותף…`;
  let imported = 0;
  for (const item of legacy) {
    try { await createIssue(EzEizoData.normalizeSheet(item), { uid: "", name: "" }, true); imported++; }
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
