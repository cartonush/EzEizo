import { watchDutyAssignments, saveDutyAssignment } from "../firebase-sync.js?v=1.9.15";

export const DUTY_DAYS = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי"];
export const DUTY_ROLES = [
  ["morningDriver", "נהג בוקר", 1], ["dayDriver", "נהג יום", 1], ["reinforcement", "מתגבר", 1],
  ["morningTools", "פקיד כלים בוקר", 1], ["dayTools", "פקיד כלים יום", 1], ["garageTeam", "צוות מוסך", 2]
];
const root = document.querySelector("#duties-grid");
const label = document.querySelector("#duties-week-label");
const feedback = document.querySelector("#duties-status");
let week = startOfWeek(new Date());
let accounts = [];
let assignments = new Map();
let unsubscribe = null;

function isoDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
export function startOfWeek(date) { const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()); start.setDate(start.getDate() - start.getDay()); return start; }
const key = (day, role) => `${day}_${role}`;
const nameOf = (uid) => accounts.find((person) => person.uid === uid)?.name || "משתמש לא זמין";
function showStatus(message, error = false) { feedback.textContent = message; feedback.dataset.state = error ? "error" : ""; }

function personPicker(day, role, slot, selected, otherUid) {
  const picker = document.createElement("details"); picker.className = "duty-picker";
  if (day >= 4) picker.classList.add("duty-picker-left");
  const summary = document.createElement("summary"); summary.textContent = selected ? nameOf(selected) : slot ? "בחר אדם שני" : "בחר טכנאי";
  summary.setAttribute("aria-label", `${DUTY_DAYS[day]} · ${DUTY_ROLES.find(([id]) => id === role)[1]}${slot ? ` · אדם ${slot + 1}` : ""}: ${summary.textContent}`);
  const panel = document.createElement("div"); panel.className = "duty-picker-panel";
  const search = document.createElement("input"); search.type = "search"; search.placeholder = "חפש שם או מספר אישי"; search.setAttribute("aria-label", "חיפוש טכנאי");
  const results = document.createElement("div"); results.className = "duty-picker-results";
  const options = () => {
    results.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase("he");
    const matches = accounts.filter((person) => !person.deleted && person.active !== false && person.uid !== otherUid && `${person.name || ""} ${person.personalNumber || ""}`.toLocaleLowerCase("he").includes(query));
    for (const person of matches) {
      const option = document.createElement("button"); option.type = "button"; option.className = "duty-picker-option";
      option.textContent = `${person.name || "משתמש"}${person.personalNumber ? ` · ${person.personalNumber}` : ""}`;
      option.addEventListener("click", () => save(person.uid)); results.append(option);
    }
    if (!matches.length) results.textContent = "אין תוצאות מתאימות";
  };
  async function save(uid) {
    const current = assignments.get(key(day, role))?.assignees || [];
    const next = role === "garageTeam" ? [current[0] || "", current[1] || ""] : [""];
    next[slot] = uid;
    if (new Set(next.filter(Boolean)).size !== next.filter(Boolean).length) { showStatus("יש לבחור שני אנשים שונים לצוות מוסך.", true); return; }
    picker.open = false;
    summary.textContent = uid ? nameOf(uid) : slot ? "בחר אדם שני" : "בחר טכנאי";
    picker.classList.add("duty-saving");
    try { await saveDutyAssignment(isoDate(week), String(day), role, next); showStatus("השיבוץ נשמר."); }
    catch (error) { showStatus(`שמירת השיבוץ נכשלה: ${error.message}`, true); render(); }
    finally { picker.classList.remove("duty-saving"); }
  }
  search.addEventListener("input", options);
  picker.addEventListener("toggle", () => { if (picker.open) { options(); search.focus(); } });
  panel.append(search, results);
  if (selected) { const clear = document.createElement("button"); clear.type = "button"; clear.className = "duty-clear"; clear.textContent = "נקה בחירה"; clear.addEventListener("click", () => save("")); panel.append(clear); }
  picker.append(summary, panel); return picker;
}

function render() {
  label.textContent = `${addDays(week, 0).toLocaleDateString("he-IL")} – ${addDays(week, 5).toLocaleDateString("he-IL")}`;
  root.replaceChildren();
  const table = document.createElement("table"); table.className = "duties-table";
  const head = document.createElement("thead"), header = document.createElement("tr");
  for (const text of ["תפקיד", ...DUTY_DAYS]) { const th = document.createElement("th"); th.textContent = text; header.append(th); }
  head.append(header);
  const body = document.createElement("tbody");
  for (const [role, title, count] of DUTY_ROLES) {
    const row = document.createElement("tr"), name = document.createElement("th"); name.scope = "row"; name.textContent = title; row.append(name);
    for (let day = 0; day < DUTY_DAYS.length; day++) {
      const cell = document.createElement("td"); cell.dataset.label = DUTY_DAYS[day];
      const selected = assignments.get(key(day, role))?.assignees || [];
      for (let slot = 0; slot < count; slot++) cell.append(personPicker(day, role, slot, selected[slot] || "", selected[1 - slot] || ""));
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body); root.append(table);
}

function subscribe() {
  unsubscribe?.(); assignments = new Map(); render();
  unsubscribe = watchDutyAssignments(isoDate(week), (items) => {
    assignments = new Map(items.map((item) => [key(item.day, item.role), item])); render();
  }, (error) => showStatus(`טעינת התורנויות נכשלה: ${error.message}`, true));
}
export function initDuties() {
  document.querySelector("#duties-prev").addEventListener("click", () => { week = addDays(week, -7); subscribe(); });
  document.querySelector("#duties-next").addEventListener("click", () => { week = addDays(week, 7); subscribe(); });
  document.querySelector("#duties-today").addEventListener("click", () => { week = startOfWeek(new Date()); subscribe(); });
  subscribe();
}
export function updateDutyPeople(people) { accounts = people; render(); }
