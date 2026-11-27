import { gate, revealApp, watchKeyLoads, watchTechnicians, watchToolCatalog, createKeyLoad, assignLegacyKeyLoadSerial, closeKeyLoad, approveKeyLoad, saveKeyManagerReview, reopenKeyLoad, appendKeyLoadManagerNote, saveKeyWorkDraft, cancelKeyDispatch } from "../firebase-sync.js?v=1.9.30";
import { attachSignaturePad } from "../signature-canvas.js?v=1.7.6";
import { KEY_SQUADRONS, KEY_TASKS, KEY_TABLES, aircraftFor, sheltersFor, periodFor, alreadyLoadedForPeriod, compactRows, validateRows, keyHistoryByAircraft } from "./data.js?v=1.9.26";
import { attachTimeNow } from "../time-now.js?v=1.7.6";
import { keyLoadTimeline } from "../lifecycle.js?v=1.9.23";
import { createEditLock } from "../edit-lock.js?v=1.9.23";
import { attachToolPicker, catalogTool, toolNumberRecorded, updateToolCatalog } from "../tool-catalog.js?v=1.9.30";

export function initKeyPages({ user, embedded = false }) {
const manager = embedded || !location.pathname.toLowerCase().includes("/mechanic/");
const route = (part) => embedded ? `keys/${part}` : part;
const backSelector = embedded ? "#key-back-link" : "#back-link";
const $ = (selector) => document.querySelector(selector);
const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const setMessage = (selector, message, bad = false) => { const node = $(selector); node.textContent = message; node.dataset.state = bad ? "error" : ""; };
const setMessageOnNode = (node, message, bad = false) => { node.textContent = message; node.dataset.state = bad ? "error" : ""; };
const currentDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const currentTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const draftKey = "ezeizo-key-draft-v1";
const defaultDraft = () => ({ date: currentDate(), time: currentTime(), squadron: "", shelter: "", teamUids: ["", ""], rows: [] });
let draft;
try { draft = { ...defaultDraft(), ...JSON.parse(localStorage.getItem(draftKey) || "{}") }; } catch { draft = defaultDraft(); }
let loads = [], history = new Map(), technicians = [], activeLoad = null, selectedSquadron = "101", work = null;
watchToolCatalog((items) => {
  updateToolCatalog(items);
  if (work && activeLoad?.status === "open") renderExtraRows("tools", false);
}, (error) => { if (!embedded) setMessage("#work-status", `טעינת מאגר הכלים נכשלה: ${error.message}`, true); });
let editLock = null, lockedLoadId = "";
let workLoadId = "", draftTimer = null, pendingDraft = Promise.resolve();
function queueDraft(id, snapshot, session) {
  pendingDraft = pendingDraft.catch(() => {}).then(() => saveKeyWorkDraft(id, user.uid, snapshot, session));
  pendingDraft.catch((error) => { if (activeLoad?.id === id && activeLoad.status === "open") setMessage("#work-status", `שמירת הטיוטה המשותפת נכשלה: ${error.message}. נסה שוב לפני סגירת החלון.`, true); });
  return pendingDraft;
}
function flushDraft(lock, id) {
  if (draftTimer !== null && lock?.held && work && id) {
    clearTimeout(draftTimer); draftTimer = null;
    return queueDraft(id, structuredClone(work), lock.session);
  }
  return pendingDraft;
}
let loadsReady = false;
let numberingLegacyLoads = false;
const matchesKeyNumber = (load, search) => {
  const value = search.trim().toUpperCase();
  if (!value) return true;
  const digits = value.replace(/^K-?/, "");
  return /^\d{1,9}$/.test(digits) && load.serial === `K-${digits.padStart(9, "0")}`;
};
let dispatchSignature = "";
const saveDraft = () => localStorage.setItem(draftKey, JSON.stringify(draft));
const saveWork = () => {
  if (activeLoad && activeLoad.status === "open" && editLock?.held) {
    try { localStorage.setItem(`ezeizo-key-work:${activeLoad.id}`, JSON.stringify(work)); }
    catch { setMessage("#work-status", "שמירת הטיוטה במכשיר נכשלה. השאר את הטופס פתוח ונסה לפנות מקום באחסון.", true); }
    clearTimeout(draftTimer);
    const id = activeLoad.id, snapshot = structuredClone(work), session = editLock.session;
    draftTimer = setTimeout(() => { draftTimer = null; void queueDraft(id, snapshot, session); }, 550);
  }
};
if (manager && embedded) document.addEventListener("ezeizo:reset-key-draft", () => {
  draft = defaultDraft();
  saveDraft();
  renderCreateFields();
  $("#key-briefed").checked = false;
  clearDispatch();
  dispatchSignature = "";
  setMessage("#create-status", "טיוטת הטענת המפתחות אופסה.");
});

function selectOptions(select, values, placeholder, selected = "") {
  select.replaceChildren(new Option(placeholder, ""));
  values.forEach((value) => select.append(new Option(value, value)));
  select.value = values.includes(selected) ? selected : "";
}
function renderTeam(values = draft.teamUids) {
  const container = $("#key-team"); container.replaceChildren();
  draft.teamUids = values.length >= 2 ? values : ["", ""];
  draft.teamUids.forEach((uid, index) => {
    const row = make("div", undefined, "assignee-row");
    const label = make("label", index === 0 ? "מוביל התקלה" : `טכנאי ${index + 1}`, "input-field");
    const select = document.createElement("select");
    select.append(new Option("בחר טכנאי", ""));
    technicians.filter((item) => item.active && !item.deleted).forEach((item) => select.append(new Option(item.name, item.uid)));
    select.value = uid;
    select.addEventListener("change", () => { draft.teamUids[index] = select.value; saveDraft(); });
    label.append(select); row.append(label);
    if (index >= 2) {
      const remove = make("button", "הסר", "secondary-button"); remove.type = "button";
      remove.addEventListener("click", () => { draft.teamUids.splice(index, 1); renderTeam([...draft.teamUids]); saveDraft(); }); row.append(remove);
    }
    container.append(row);
  });
}
function renderCreateFields() {
  $("#key-date").value = draft.date;
  $("#key-time").value = draft.time;
  selectOptions($("#key-squadron"), KEY_SQUADRONS, "בחר טייסת", draft.squadron);
  selectOptions($("#key-shelter"), sheltersFor(draft.squadron), "בחר דת״ק", draft.shelter);
  renderTeam(); renderAircraftRows(); refreshPeriod();
}
function refreshPeriod() {
  try { $("#key-required").textContent = `אחזקה נדרשת לביצוע: הטענת מטוסים במסגרת ביצוע שינוי מפתחות לחודשים ${periodFor(draft.date).label}`; }
  catch { $("#key-required").textContent = "בחר תאריך תקין להצגת חודשי המפתחות"; }
}
$("#key-date").addEventListener("change", (event) => { draft.date = event.target.value; refreshPeriod(); saveDraft(); });
$("#key-time").addEventListener("change", (event) => { draft.time = event.target.value; saveDraft(); });
$("#key-squadron").addEventListener("change", (event) => { draft.squadron = event.target.value; draft.shelter = ""; draft.rows = []; selectOptions($("#key-shelter"), sheltersFor(draft.squadron), "בחר דת״ק"); renderAircraftRows(); saveDraft(); });
$("#key-shelter").addEventListener("change", (event) => { draft.shelter = event.target.value; saveDraft(); });
$("#add-team").addEventListener("click", () => { draft.teamUids.push(""); renderTeam([...draft.teamUids]); saveDraft(); });
function normalizedAircraftRows() {
  draft.rows = (Array.isArray(draft.rows) ? draft.rows : []).filter((row) => row.aircraft || row.blue || row.shach || row.notes);
  return [...draft.rows, { aircraft: "", blue: false, shach: false, notes: "" }];
}
function renderAircraftRows() {
  const body = $("#key-aircraft-rows"); body.replaceChildren();
  const squadronSelected = KEY_SQUADRONS.includes(draft.squadron);
  const hint = $("#key-aircraft-hint");
  if (hint) hint.textContent = squadronSelected ? "חפש ובחר מטוס מהתוצאות, וסמן לפחות סוג מפתח אחד. שורה נוספת תיפתח אוטומטית." : "ראשית יש לבחור טייסת רצויה";
  normalizedAircraftRows().forEach((item, index) => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    const input = document.createElement("input"); input.type = "search"; input.inputMode = "numeric"; input.placeholder = squadronSelected ? "בחר מטוס" : "ראשית יש לבחור טייסת רצויה"; input.autocomplete = "off"; input.value = item.aircraft || ""; input.disabled = !squadronSelected;
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false");
    const choices = make("div", undefined, "picker-list"); choices.hidden = true; choices.id = `key-options-${index}`; choices.setAttribute("role", "listbox"); input.setAttribute("aria-controls", choices.id);
    const holder = make("div", undefined, "search-picker");
    function showChoices() {
      choices.replaceChildren(); const matches = aircraftFor(draft.squadron).filter((value) => value.includes(input.value.trim()) && (value === item.aircraft || !draft.rows.some((other, at) => at !== index && other.aircraft === value)));
      matches.forEach((value) => { const button = make("button", value, "picker-option"); button.type = "button"; button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(value === item.aircraft)); button.addEventListener("pointerdown", (event) => event.preventDefault()); button.addEventListener("click", () => {
        if (alreadyLoadedForPeriod(history, draft.squadron, value, draft.date) && !window.confirm("מטוס זה נטען כבר לחודש הנוכחי ולחודש הבא. האם להטעין שוב?")) { input.value = ""; choices.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
        const target = draft.rows[index] || (draft.rows[index] = { aircraft: "", blue: false, shach: false, notes: "" }); target.aircraft = value; saveDraft(); renderAircraftRows();
      }); choices.append(button); }); choices.hidden = !matches.length; input.setAttribute("aria-expanded", String(!choices.hidden));
    }
    input.addEventListener("focus", showChoices);
    input.addEventListener("input", () => { if (draft.rows[index]) { draft.rows[index].aircraft = ""; saveDraft(); } showChoices(); });
    input.addEventListener("keydown", (event) => { if (event.key === "Escape") { choices.hidden = true; input.setAttribute("aria-expanded", "false"); } else if (event.key === "Enter" && !choices.hidden && choices.querySelector("button")) { event.preventDefault(); choices.querySelector("button").click(); } else if (event.key === "ArrowDown") showChoices(); });
    input.addEventListener("blur", () => setTimeout(() => { choices.hidden = true; input.setAttribute("aria-expanded", "false"); input.value = draft.rows[index]?.aircraft || ""; }, 150));
    holder.append(input, choices); cell.append(holder); row.append(cell);
    ["blue", "shach"].forEach((key) => { const td = document.createElement("td"), box = document.createElement("input"); box.type = "checkbox"; box.checked = Boolean(item[key]); box.disabled = !squadronSelected; box.setAttribute("aria-label", `${key === "blue" ? "ארז כחול" : "שחק"}, שורה ${index + 1}`); box.addEventListener("change", () => { const target = draft.rows[index] || (draft.rows[index] = { aircraft: "", blue: false, shach: false, notes: "" }); target[key] = box.checked; saveDraft(); if (index === draft.rows.length - 1 && box.checked && !target.aircraft) renderAircraftRows(); }); td.append(box); row.append(td); });
    const noteCell = document.createElement("td"), note = document.createElement("input"); note.type = "text"; note.placeholder = "לא חובה"; note.maxLength = 500; note.value = item.notes || ""; note.disabled = !squadronSelected; note.setAttribute("aria-label", `הערות, שורה ${index + 1}`); note.addEventListener("input", () => { const target = draft.rows[index] || (draft.rows[index] = { aircraft: "", blue: false, shach: false, notes: "" }); target.notes = note.value; saveDraft(); }); noteCell.append(note); row.append(noteCell);
    const removeCell = document.createElement("td"); if (index < draft.rows.length) { const remove = make("button", "×", "remove-row"); remove.type = "button"; remove.setAttribute("aria-label", `הסר שורה ${index + 1}`); remove.addEventListener("click", () => { draft.rows.splice(index, 1); renderAircraftRows(); saveDraft(); }); removeCell.append(remove); } row.append(removeCell); body.append(row);
  });
}
$("#manager-key-tasks").replaceChildren(...KEY_TASKS.map((text, index) => make("li", `${index + 1}. ${text}${index === 0 ? " · ייחתם בעת פתיחה" : ""}`)));
$("#key-briefed").checked = false;
let clearDispatch = () => {};
let dispatchPadReady = false;
$("#key-clear-signature").addEventListener("click", () => clearDispatch());
$("#create-key-load").addEventListener("click", async () => {
  const button = $("#create-key-load");
  let period; try { period = periodFor(draft.date); } catch { return setMessage("#create-status", "בחר תאריך תקין.", true); }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return setMessage("#create-status", "בחר שעה תקינה.", true);
  if (!KEY_SQUADRONS.includes(draft.squadron) || !sheltersFor(draft.squadron).includes(draft.shelter)) return setMessage("#create-status", "בחר טייסת ודת״ק מהרשימות.", true);
  const teamUids = draft.teamUids.filter(Boolean);
  if (teamUids.length < 2 || new Set(teamUids).size !== teamUids.length || teamUids.some((uid) => !technicians.some((person) => person.uid === uid && person.active && !person.deleted))) return setMessage("#create-status", "בחר לפחות שני טכנאים שונים ופעילים.", true);
  const rows = normalizedAircraftRows().slice(0, -1);
  if (!rows.length || rows.some((row) => !aircraftFor(draft.squadron).includes(row.aircraft) || !(row.blue || row.shach)) || new Set(rows.map((row) => row.aircraft)).size !== rows.length) return setMessage("#create-status", "בכל שורה בחר מטוס ייחודי מהרשימה וסמן לפחות מפתח אחד.", true);
  if (!$("#key-briefed").checked || !dispatchSignature) return setMessage("#create-status", "יש לאשר את התדריך ולחתום כמשלח המשימה.", true);
  button.disabled = true;
  const loading = $("#key-create-loading");
  loading.hidden = false;
  setMessage("#create-status", "פותח הטענת מפתחות…");
  try {
    const created = await createKeyLoad({ date: draft.date, time: draft.time, squadron: draft.squadron, shelter: draft.shelter, teamUids, teamNames: teamUids.map((uid) => technicians.find((person) => person.uid === uid).name), rows, aircraftIds: rows.map((row) => row.aircraft), period: period.label, dispatcherSignature: dispatchSignature });
    draft = defaultDraft(); saveDraft(); renderCreateFields(); $("#key-briefed").checked = false; clearDispatch(); setMessage("#create-status", `הטענת המפתחות ${created.serial} נפתחה לצוות.`); location.hash = route("open");
  } catch (error) { setMessage("#create-status", error.code === "permission-denied" ? "פתיחת ההטענה נכשלה: יש לפרסם את כללי Firestore המעודכנים למספור הטענות." : `פתיחת ההטענה נכשלה: ${error.message}`, true); }
  finally { loading.hidden = true; button.disabled = false; }
});
function renderHistory() {
  const tabs = $("#history-tabs"); tabs.replaceChildren();
  KEY_SQUADRONS.forEach((name) => {
    const button = make("button", `טייסת ${name}`); button.type = "button";
    if (selectedSquadron === name) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => { selectedSquadron = name; renderHistory(); }); tabs.append(button);
  });
  const table = document.createElement("table"); table.className = "keys-table";
  const head = document.createElement("thead"), header = document.createElement("tr");
  ["מספר מטוס", "תאריך הטענת מפתחות ארז כחול", "חודשים ארז כחול", "תאריך הטענת שחק", "חודשים שחק"].forEach((value) => header.append(make("th", value)));
  head.append(header); table.append(head);
  const body = document.createElement("tbody");
  aircraftFor(selectedSquadron).forEach((aircraft) => {
    const record = history.get(`${selectedSquadron}_${aircraft}`);
    const row = document.createElement("tr");
    const dateOf = (entry) => entry?.date ? entry.date.split("-").reverse().join("/") : "טרם הוטען";
    const latest = !record?.shach || (record?.blue && record.blue.completedAt > record.shach.completedAt) ? record?.blue : record?.shach;
    [aircraft, dateOf(record?.blue), record?.blue?.period || "—", dateOf(record?.shach), record?.shach?.period || "—"].forEach((value, index) => {
      const cell = make("td", value);
      if (index && !record?.[index < 3 ? "blue" : "shach"]) cell.classList.add("key-history-missing");
      const entry = record?.[index === 2 ? "blue" : "shach"];
      if ((index === 2 || index === 4) && entry && latest?.period !== entry.period) {
        cell.append(make("small", "נדרש להשלים", "key-history-pending"));
      }
      row.append(cell);
    });
    body.append(row);
  });
  table.append(body); $("#history-table").replaceChildren(table);
}
function renderOpen() {
  const container = $("#open-key-loads"); container.replaceChildren();
  const search = $("#open-key-search")?.value || "";
  const list = loads.filter((load) => load.status === "open" && matchesKeyNumber(load, search));
  if (!list.length) { container.textContent = search ? "לא נמצאו הטענות פתוחות התואמות למזהה." : "אין הטענות פתוחות כרגע."; return; }
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach((load) => {
    const card = make("div", undefined, "issue-item");
    card.append(make("strong", `${load.serial || "מספר ההטענה נטען…"} · טייסת ${load.squadron} · דת״ק ${load.shelter} · ${load.date.split("-").reverse().join("/")}`), make("span", `מטוסים: ${load.aircraftIds.join(", ")} · צוות: ${load.teamNames.join(" · ")}`));
    const open = make("button", "פתח דף", "secondary-button"); open.type = "button";
    open.addEventListener("click", () => { location.hash = route(`work/${load.id}`); if (!embedded) showView(); }); card.append(open); container.append(card);
    if (manager) {
      const editor = make("details", undefined, "manager-note-editor");
      const note = document.createElement("textarea"); note.rows = 2; note.maxLength = 500; note.placeholder = "הוסף הערה לצוות…"; note.setAttribute("aria-label", `הוסף הערה להטענה בטייסת ${load.squadron}`);
      const send = make("button", "הוסף הערה", "secondary-button"); send.type = "button";
      const feedback = make("p", "", "copy-status"); feedback.setAttribute("role", "status");
      send.addEventListener("click", async () => {
        if (!note.value.trim()) return setMessageOnNode(feedback, "יש לכתוב הערה לפני השליחה.", true);
        send.disabled = true;
        try { await appendKeyLoadManagerNote(load.id, note.value); note.value = ""; setMessageOnNode(feedback, "ההערה נוספה ונשלחה לצוות."); }
        catch (error) { setMessageOnNode(feedback, `הוספת ההערה נכשלה: ${error.message}`, true); }
        finally { send.disabled = false; }
      });
      editor.append(make("summary", "הערות מטיס"), make("p", load.managerNotes || "עדיין אין הערות.", "manager-note-text"), note, send, feedback);
      card.append(editor);
      const cancel = make("details", undefined, "manager-note-editor");
      const reason = document.createElement("textarea"); reason.rows = 2; reason.maxLength = 500; reason.placeholder = "סיבת הביטול (חובה)"; reason.setAttribute("aria-label", `סיבת ביטול הטענה ${load.serial || load.id}`);
      const confirm = make("button", "אשר ביטול שילוח", "secondary-button"); confirm.type = "button";
      const cancelStatus = make("p", "", "copy-status"); cancelStatus.setAttribute("role", "status");
      confirm.addEventListener("click", async () => {
        if (!reason.value.trim()) return setMessageOnNode(cancelStatus, "יש להזין סיבה לביטול השילוח.", true);
        confirm.disabled = true;
        try { await cancelKeyDispatch(load.id, user.uid, reason.value); setMessageOnNode(cancelStatus, "השילוח בוטל ונשמר בארכיון."); }
        catch (error) { setMessageOnNode(cancelStatus, `הביטול נכשל: ${error.message}`, true); confirm.disabled = false; }
      });
      cancel.append(make("summary", "ביטול שילוח משימה"), reason, confirm, cancelStatus); card.append(cancel);
    }
  });
}
function renderClosed() {
  const container = $("#closed-key-loads"); container.replaceChildren();
  const search = $("#closed-key-search")?.value || "";
  const list = loads.filter((load) => ["closed", "cancelled"].includes(load.status) && matchesKeyNumber(load, search));
  if (!list.length) { container.textContent = search ? "לא נמצאו הטענות סגורות התואמות למזהה." : "אין הטענות סגורות כרגע."; return; }
  list.sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")).forEach((load) => {
    const card = make("div", undefined, "issue-item");
    card.append(make("strong", `${load.serial || "מספר ההטענה נטען…"} · טייסת ${load.squadron} · דת״ק ${load.shelter} · ${load.date.split("-").reverse().join("/")}`),
      make("span", `מטוסים: ${load.aircraftIds.join(", ")} · צוות: ${load.teamNames.join(" · ")}`),
      make("span", load.status === "cancelled" ? `שילוח בוטל: ${load.cancellationReason || "—"}` : `נסגר: ${load.reviewedAt ? new Date(load.reviewedAt).toLocaleString("he-IL") : "—"}`));
    const open = make("button", load.status === "cancelled" ? "צפה בשילוח שבוטל" : "צפה בטופס הסגור", "secondary-button"); open.type = "button";
    open.addEventListener("click", () => { location.hash = route(`work/${load.id}`); if (!embedded) showView(); });
    card.append(open); container.append(card);
  });
}
function renderPending() {
  const container = $("#pending-key-loads"); if (!container) return;
  container.replaceChildren();
  const pending = loads.filter((load) => load.status === "pendingReview").sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  pending.forEach((load) => {
    const card = make("article", undefined, "issue-item");
    card.append(make("strong", `${load.serial || "—"} · טייסת ${load.squadron} · ${(load.aircraftIds || []).join(", ")}`), make("span", `צוות: ${(load.teamNames || []).join(" · ")}`));
    const open = make("button", "בדוק וסגור", "secondary-button"); open.type = "button";
    open.addEventListener("click", () => { location.hash = route(`work/${load.id}`); if (!embedded) showView(); });
    card.append(open); container.append(card);
  });
  if (!pending.length) container.textContent = "אין הטענות מפתחות שממתינות לסגירה.";
}
function defaultWork(load) {
  return { actions: [true, ...Array(KEY_TASKS.length - 1).fill(false)], aircraft: load.rows.map((row) => ({ aircraft: row.aircraft, blueDone: false, shachDone: false, technicianNote: "" })), toolsEnabled: false, takenEnabled: false, rejectedEnabled: false, entryEnabled: false, interimEnabled: false, finalEnabled: false, tools: [], taken: [], rejected: [] };
}
function readWork(load) {
  const saved = { ...defaultWork(load), ...(load.work || {}), ...(load.workDraft || {}) };
  if (["closed", "cancelled"].includes(load.status)) return saved;
  if (load.workDraft) return saved;
  try { return { ...saved, ...JSON.parse(localStorage.getItem(`ezeizo-key-work:${load.id}`) || "{}") }; }
  catch { return saved; }
}
function renderKeyReview(load) {
  const panel = $("#key-review-panel"); if (!panel) return;
  panel.hidden = !manager || !["pendingReview", "closed"].includes(load.status);
  if (panel.hidden) return;
  const review = load.managerReview || {};
  panel.innerHTML = `<div class="section-heading"><div><p class="section-kicker">בדיקת מטיס</p><h2>בקרה וסגירת הטענה</h2></div></div>
    <div class="review-columns"><fieldset class="review-column"><legend>טיפול בתקלה</legend><label class="replaced-toggle"><input type="checkbox" data-key-review="verified"><span class="custom-check"></span><span>אומת</span></label><label class="replaced-toggle"><input type="checkbox" data-key-review="unitsReplaced"><span class="custom-check"></span><span>הוחלפו יחידות</span></label><label class="replaced-toggle"><input type="checkbox" data-key-review="repairPerformed"><span class="custom-check"></span><span>בוצע תיקון</span></label></fieldset>
    <fieldset class="review-column"><legend>חוזרת</legend><label class="replaced-toggle"><input type="checkbox" data-key-review="missionCancelled"><span class="custom-check"></span><span>ביטול משימה</span></label><label class="replaced-toggle"><input type="checkbox" data-key-review="sortieCancelled"><span class="custom-check"></span><span>ביטול גיחה</span></label><label class="replaced-toggle"><input type="checkbox" data-key-repeat="yes"><span class="custom-check"></span><span>חוזרת: כן</span></label><label class="replaced-toggle"><input type="checkbox" data-key-repeat="no"><span class="custom-check"></span><span>חוזרת: לא</span></label></fieldset>
    <fieldset class="review-column"><legend>היתרים / אישורים</legend><label class="replaced-toggle"><input type="checkbox" data-key-date-toggle="flightPermitUntil"><span class="custom-check"></span><span>היתר לטיסה עד תאריך</span></label><div class="review-date-field" data-key-date-wrap="flightPermitUntil" hidden><label class="input-field">תוקף ההיתר<input type="date" data-key-date="flightPermitUntil"></label><button type="button" class="secondary-button" data-key-today="flightPermitUntil">היום</button></div><label class="replaced-toggle"><input type="checkbox" data-key-review="trackingPermit"><span class="custom-check"></span><span>היתר למעקב</span></label><label class="replaced-toggle"><input type="checkbox" data-key-date-toggle="approvalUntil"><span class="custom-check"></span><span>אישור עד תאריך</span></label><div class="review-date-field" data-key-date-wrap="approvalUntil" hidden><label class="input-field">תוקף האישור<input type="date" data-key-date="approvalUntil"></label><button type="button" class="secondary-button" data-key-today="approvalUntil">היום</button></div></fieldset></div>
    <div class="signature-field"><span class="field-label">חתימת בודק הדף</span><canvas id="key-review-signature" class="signature-pad" aria-label="חתימת בודק ההטענה"></canvas><button id="clear-key-review-signature" class="clear-signature" type="button">נקה חתימה</button></div>
    <button id="save-key-review" type="button" class="secondary-button">שמור בקרה להמשך</button> <button id="approve-key-load" type="button" class="primary-button">חתום וסגור הטענה</button><p id="key-review-status" class="copy-status" role="status"></p>`;
  panel.querySelectorAll("[data-key-review]").forEach((input) => { input.checked = Boolean(review[input.dataset.keyReview]); });
  panel.querySelectorAll("[data-key-repeat]").forEach((input) => {
    input.checked = input.dataset.keyRepeat === (review.recurrentAnswer || (review.recurrent ? "yes" : ""));
    input.addEventListener("change", () => { if (input.checked) panel.querySelectorAll("[data-key-repeat]").forEach((other) => { if (other !== input) other.checked = false; }); });
  });
  panel.querySelectorAll("[data-key-date-toggle]").forEach((toggle) => {
    const key = toggle.dataset.keyDateToggle, field = panel.querySelector(`[data-key-date="${key}"]`), wrap = panel.querySelector(`[data-key-date-wrap="${key}"]`);
    field.value = review[key] || ""; toggle.checked = Boolean(field.value); wrap.hidden = !toggle.checked;
    toggle.addEventListener("change", () => { wrap.hidden = !toggle.checked; if (!toggle.checked) field.value = ""; });
  });
  panel.querySelectorAll("[data-key-today]").forEach((button) => button.addEventListener("click", () => { panel.querySelector(`[data-key-date="${button.dataset.keyToday}"]`).value = currentDate(); }));
  const closed = load.status === "closed";
  let signature = "";
  const clear = attachSignaturePad(panel.querySelector("#key-review-signature"), { initial: closed ? load.reviewerSignature || "" : "", onChange: (value) => { signature = value; } });
  panel.querySelector("#clear-key-review-signature").hidden = closed;
  panel.querySelector("#key-review-signature").style.pointerEvents = closed ? "none" : "auto";
  panel.querySelector("#clear-key-review-signature").addEventListener("click", clear);
  panel.querySelector("#approve-key-load").hidden = closed;
  panel.querySelector("#save-key-review").textContent = closed ? "שמור עדכון בקרה" : "שמור בקרה להמשך";
  const collect = () => {
    const result = { verified: false, unitsReplaced: false, repairPerformed: false, missionCancelled: false, sortieCancelled: false, trackingPermit: false, inspectionPermitUntil: "", flightPermitUntil: "", approvalUntil: "", recurrent: false, recurrentAnswer: "" };
    panel.querySelectorAll("[data-key-review]").forEach((input) => { result[input.dataset.keyReview] = input.checked; });
    result.recurrentAnswer = panel.querySelector("[data-key-repeat]:checked")?.dataset.keyRepeat || "";
    result.recurrent = result.recurrentAnswer === "yes";
    panel.querySelectorAll("[data-key-date]").forEach((input) => { result[input.dataset.keyDate] = input.value; });
    for (const toggle of panel.querySelectorAll("[data-key-date-toggle]:checked")) if (!result[toggle.dataset.keyDateToggle]) throw new Error("יש לבחור תאריך להיתר או לאישור שסומנו.");
    return result;
  };
  panel.querySelector("#save-key-review").addEventListener("click", async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try { await saveKeyManagerReview(load.id, user.uid, collect()); setMessage("#key-review-status", "הבקרה נשמרה."); }
    catch (error) { setMessage("#key-review-status", `שמירת הבקרה נכשלה: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
  panel.querySelector("#approve-key-load").addEventListener("click", async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try { if (!signature) throw new Error("יש לחתום כבודק הדף."); await approveKeyLoad(load.id, user.uid, signature, collect()); location.hash = route("closed"); }
    catch (error) { setMessage("#key-review-status", `סגירת ההטענה נכשלה: ${error.message}`, true); button.disabled = false; }
  });
}
function renderWork() {
  if (!activeLoad) return;
  const load = activeLoad, closed = load.status !== "open" || manager || !editLock?.held;
  const lockNotice = $("#key-edit-lock-notice");
  if (lockNotice) lockNotice.hidden = manager || load.status !== "open" || Boolean(editLock?.held);
  $("#work-summary").textContent = `${load.serial ? `${load.serial} · ` : ""}${load.date.split("-").reverse().join("/")} · ${load.time} · טייסת ${load.squadron} · דת״ק ${load.shelter} · צוות: ${load.teamNames.join(" · ")}${load.status === "closed" ? " · נסגר" : load.status === "cancelled" ? ` · השילוח בוטל: ${load.cancellationReason || "—"}` : load.status === "pendingReview" ? " · ממתין לבדיקת מטיס" : ""}`;
  $("#work-manager-notes").textContent = load.managerNotes || "";
  $("#work-manager-notes").hidden = !load.managerNotes;
  const table = document.createElement("table"); table.className = "work-aircraft-table";
  const head = document.createElement("thead"), header = document.createElement("tr");
  ["מס׳ מטוס", "ארז כחול", "שחק", "הערות"].forEach((name) => header.append(make("th", name))); head.append(header); table.append(head);
  const body = document.createElement("tbody");
  load.rows.forEach((row, index) => {
    const tr = document.createElement("tr"); tr.append(make("td", row.aircraft));
    ["blue", "shach"].forEach((key) => {
      const td = document.createElement("td");
      if (row[key]) { const label = make("label", undefined, "work-check"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.setAttribute("aria-label", `${key === "blue" ? "ארז כחול" : "שחק"} בוצע במטוס ${row.aircraft}`); checkbox.checked = Boolean(work.aircraft[index]?.[`${key}Done`]); checkbox.disabled = closed; checkbox.addEventListener("change", () => { work.aircraft[index][`${key}Done`] = checkbox.checked; saveWork(); }); label.append(checkbox, make("span", "בוצע")); td.append(label); }
      else td.textContent = "—";
      tr.append(td);
    });
    const notes = make("td", undefined, "key-work-notes");
    if (row.notes) notes.append(make("p", `מטיס: ${row.notes}`));
    const technicianNote = document.createElement("textarea");
    technicianNote.className = "key-technician-note"; technicianNote.rows = 2; technicianNote.maxLength = 500;
    technicianNote.placeholder = "הערת טכנאי (לא חובה)";
    technicianNote.value = work.aircraft[index]?.technicianNote || "";
    technicianNote.disabled = closed;
    technicianNote.setAttribute("aria-label", `הערת טכנאי למטוס ${row.aircraft}`);
    technicianNote.addEventListener("input", () => {
      work.aircraft[index] ||= { aircraft: row.aircraft, blueDone: false, shachDone: false };
      work.aircraft[index].technicianNote = technicianNote.value;
      saveWork();
    });
    if (!closed || technicianNote.value) notes.append(technicianNote);
    else if (!row.notes) notes.append(make("span", "—"));
    tr.append(notes); body.append(tr);
  }); table.append(body); $("#work-rows").replaceChildren(table);
  $("#work-instructions").replaceChildren(...[
    `אחזקה נדרשת לביצוע: הטענת מטוסים במסגרת ביצוע שינוי מפתחות לחודשים ${load.period}`,
    "יש לוודא כי לא מופיעות תקלות: EREZ 78 לאחר טעינה ולאחר שידור PTT בארז, SAK 7 / 34 בשחק.",
    "כלי עבודה / צב״ד צת״ת / חלפים נדרשים: מ.כ 2020 + חרב אש"
  ].map((content) => make("p", content)));
  const actions = $("#work-tasks"); actions.replaceChildren();
  KEY_TASKS.forEach((task, index) => {
    const row = make("li"), label = make("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox";
    checkbox.checked = index === 0 || Boolean(work.actions[index]); checkbox.disabled = index === 0 || closed;
    checkbox.addEventListener("change", () => { work.actions[index] = checkbox.checked; saveWork(); });
    label.append(checkbox, make("span", task)); row.append(label); actions.append(row);
    if (index === 0) { const image = document.createElement("img"); image.src = load.dispatcherSignature; image.alt = "חתימת משלח המשימה"; image.style.cssText = "display:block;max-width:220px;max-height:80px;margin:10px"; row.append(image); }
  });
  const period = periodFor(load.date);
  const reference = document.createElement("table"); reference.className = "key-reference-table";
  reference.innerHTML = `<thead><tr><th>שם הפריט</th><th>סימול</th><th>משמעות</th><th>תוקף</th></tr></thead><tbody><tr><td rowspan="3">כר-156<br>ארז כחול</td><td>6003-216</td><td>ארז כחול כרטיס מחיקה שנתי</td><td>${period.year}</td></tr><tr><td>6001-295</td><td>ארז כחול חודש נוכחי</td><td>${period.current}</td></tr><tr><td>6001-296</td><td>ארז כחול חודש הבא</td><td>${period.next}</td></tr><tr><td rowspan="2">כר-116<br>שחק</td><td>6016-385</td><td>שחק חודש נוכחי</td><td>${period.current}</td></tr><tr><td>6016-386</td><td>שחק חודש הבא</td><td>${period.next}</td></tr></tbody>`;
  $("#reference-table").replaceChildren(reference);
  bindExtraTables(closed);
  $("#complete-key-load").hidden = closed;
  $("#save-key-work")?.toggleAttribute("hidden", closed);
  $("#reopen-key-load").hidden = !manager || !["closed", "pendingReview"].includes(load.status);
  renderKeyReview(load);
  setMessage("#reopen-key-status", "");
  $("#key-reopen-history").hidden = !manager;
  if (manager) {
    $("#key-reopen-history").open = true;
    $("#key-reopen-events").replaceChildren(...keyLoadTimeline(load).map(({ label, at }) => make("li", `${label} · ${new Date(at).toLocaleString("he-IL")}`)));
  }
  setMessage("#work-status", load.status === "cancelled" ? "השילוח בוטל ונשמר בארכיון. לא ניתן לערוך אותו." : load.status === "closed" ? "ההטענה נסגרה לאחר בדיקת מטיס וההיסטוריה עודכנה." : load.status === "pendingReview" ? "ההטענה ממתינה לבדיקת מטיס; הטכנאים אינם יכולים לערוך אותה." : manager ? "צפייה בדף הצוות. רק טכנאי משויך יכול להגיש את ההטענה לבדיקה." : !editLock?.held ? "העריכה ממתינה לנעילת הטופס. בדוק את ההודעה שמעליו." : "ההתקדמות נשמרת במכשיר ובשרת עד להגשה לבדיקה.");
}
const signatures = new Map();
let signatureLoadId = "";
function initializeSignatures(root) {
  root.querySelectorAll("canvas[data-signature]").forEach((canvas) => {
    if (canvas.clientWidth === 0) return;
    const key = canvas.dataset.signature;
    if (!signatures.has(canvas)) signatures.set(canvas, attachSignaturePad(canvas, { initial: work[key] || "", onChange: (value) => { work[key] = value; saveWork(); } }));
    const button = root.querySelector(`[data-clear-signature="${key}"]`);
    if (button) { button.onclick = signatures.get(canvas); button.disabled = manager || activeLoad.status === "closed" || !editLock?.held; }
    canvas.style.pointerEvents = manager || activeLoad.status === "closed" || !editLock?.held ? "none" : "auto";
  });
}
function renderExtraRows(type, closed) {
  const target = $(`#${type}-rows`), columns = KEY_TABLES[type]; target.replaceChildren();
  const rows = compactRows(work[type], columns); work[type] = rows;
  if (!closed) rows.push(Object.fromEntries(columns.map(({ key }) => [key, ""])));
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    columns.forEach(({ key, label }) => {
      const td = document.createElement("td"), input = document.createElement("input"); td.dataset.label = label; input.type = type === "tools" && key === "toolNumber" ? "search" : "text"; input.value = row[key] || ""; input.placeholder = label; input.disabled = closed; input.setAttribute("aria-label", `${label}, שורה ${index + 1}`);
      if (type === "tools") {
        input.readOnly = key === "toolName" || Boolean(catalogTool(row.toolNumber));
      }
      input.addEventListener("input", () => {
        row[key] = input.value;
        const tool = type === "tools" && key === "toolNumber" && !toolNumberRecorded(input.value, rows, index) ? catalogTool(input.value) : null;
        if (type === "tools" && key === "toolNumber") row.toolName = tool?.toolName || "";
        if (tool) row.toolNumber = tool.toolNumber;
        if (tool || (index === rows.length - 1 && input.value.trim())) {
          const caret = input.selectionStart; renderExtraRows(type, false);
          const nextIndex = tool ? index + 1 : index;
          const nextKey = tool ? "toolNumber" : key;
          const next = target.children[nextIndex]?.querySelectorAll("input")[columns.findIndex((field) => field.key === nextKey)];
          next?.focus({ preventScroll: true }); if (!tool && caret != null) next?.setSelectionRange(caret, caret);
        }
        saveWork();
      }); td.append(type === "tools" && key === "toolNumber" ? attachToolPicker(input, { isUnavailable: (number) => toolNumberRecorded(number, rows, index) }) : input); tr.append(td);
    });
    const cell = document.createElement("td"); if (!closed && columns.some(({ key }) => row[key])) { const remove = make("button", "×", "remove-row"); remove.type = "button"; remove.addEventListener("click", () => { work[type].splice(index, 1); renderExtraRows(type, false); saveWork(); }); cell.append(remove); } tr.append(cell); target.append(tr);
  });
}
function bindExtraTables(closed) {
  const root = $("#extra-tables");
  if (signatureLoadId !== activeLoad.id) {
    root.querySelectorAll("canvas[data-signature]").forEach((canvas) => canvas.replaceWith(canvas.cloneNode(true)));
    signatures.clear();
    signatureLoadId = activeLoad.id;
  }
  root.querySelectorAll("[data-toggle-state]").forEach((checkbox) => {
    const key = checkbox.dataset.toggleState, target = root.querySelector(`#${checkbox.dataset.target}`);
    checkbox.checked = Boolean(work[key]); checkbox.disabled = closed; target.hidden = !checkbox.checked;
    checkbox.onchange = () => { work[key] = checkbox.checked; target.hidden = !checkbox.checked; if (checkbox.checked) initializeSignatures(target); saveWork(); };
  });
  root.querySelectorAll("[data-state-field]").forEach((input) => {
    const key = input.dataset.stateField; input.value = work[key] || ""; input.disabled = closed;
    input.closest(".time-field")?.querySelector(".time-now-button")?.toggleAttribute("disabled", closed);
    input.oninput = () => { if (key.endsWith("InspectorNumber") || key === "takenPersonalNumber") input.value = input.value.replace(/[^0-9]/g, "").slice(0, 7); work[key] = input.value; saveWork(); };
  });
  ["tools", "taken", "rejected"].forEach((key) => renderExtraRows(key, closed));
  initializeSignatures(root);
}
function validateWork() {
  if (!editLock?.held) return "הטופס אינו נעול לעריכה עבורך. לחץ על בדוק שוב.";
  if (work.actions.length !== 12 || work.actions.some((done) => !done)) return "יש לסמן את כל 12 המשימות.";
  for (const [index, row] of activeLoad.rows.entries()) if ((row.blue && !work.aircraft[index]?.blueDone) || (row.shach && !work.aircraft[index]?.shachDone)) return `יש לסמן ביצוע הטענה במטוס ${row.aircraft}.`;
  for (const type of ["tools", "taken", "rejected"]) if (work[`${type}Enabled`]) {
    const rows = compactRows(work[type], KEY_TABLES[type]);
    if (!rows.length) return `יש למלא שורה בטבלת ${type === "tools" ? "כלים" : type === "taken" ? "קשיחים נצרכים" : "קשיחים שנפסלו"}.`;
    if (type === "tools" && rows.some((row, index) => toolNumberRecorded(row.toolNumber, rows, index))) return "כלי זה כבר תועד בטבלת הכלים.";
    const error = validateRows(rows, KEY_TABLES[type], type); if (error) return error;
  }
  const required = [];
  if (work.toolsEnabled) {
    if (work.entryEnabled) required.push("entryTechnicianSignature", "entryInspectorSignature", "entryInspectorNumber");
    if (work.interimEnabled) required.push("interimTechnicianSignature", "interimInspectorNumber", "interimInspectorSignature", "interimToolsName", "interimToolsSignature");
    if (work.finalEnabled) required.push("finalTechnicianSignature", "finalInspectorNumber", "finalInspectorSignature", "finalLeadName", "finalLeadSignature", "departureTime");
  }
  if (work.takenEnabled) required.push("takenFullName", "takenPersonalNumber", "takenRank", "takenSignature");
  for (const key of required) {
    if (!String(work[key] || "").trim()) return "יש למלא את כל פרטי הביקורות והחתימות שסומנו.";
    if ((key.endsWith("InspectorNumber") || key === "takenPersonalNumber") && !/^[0-9]{1,7}$/.test(work[key])) return "מספר אישי חייב להכיל ספרות בלבד, עד שבע ספרות.";
  }
  if (work.finalEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(work.departureTime || "")) return "יש לבחור שעת עזיבה תקינה בביקורת סיום.";
  return "";
}
$("#complete-key-load").addEventListener("click", async () => {
  const error = validateWork(); if (error) return setMessage("#work-status", error, true);
  const button = $("#complete-key-load"); button.disabled = true;
  const clean = { ...work }; for (const [type, columns] of Object.entries(KEY_TABLES)) clean[type] = compactRows(work[type], columns);
  try { clearTimeout(draftTimer); draftTimer = null; await pendingDraft.catch(() => {}); await closeKeyLoad(activeLoad.id, user.uid, clean, editLock.session); try { localStorage.removeItem(`ezeizo-key-work:${activeLoad.id}`); } catch { /* The server already saved the completed form. */ } editLock.dispose(); editLock = null; location.replace("./"); }
  catch (failure) { setMessage("#work-status", `סגירת ההטענה נכשלה: ${failure.message}`, true); }
  finally { button.disabled = false; }
});
$("#save-key-work")?.addEventListener("click", async (event) => {
  if (!activeLoad || !editLock?.held) return setMessage("#work-status", "אין נעילת עריכה פעילה. לחץ על בדוק שוב.", true);
  const button = event.currentTarget; button.disabled = true;
  try { clearTimeout(draftTimer); draftTimer = null; await queueDraft(activeLoad.id, structuredClone(work), editLock.session); await editLock.release(); location.replace("./"); }
  catch (error) { setMessage("#work-status", `שמירת הטיוטה המשותפת נכשלה: ${error.message}`, true); button.disabled = false; }
});
$("#reopen-key-load").addEventListener("click", async () => {
  if (!manager || !["closed", "pendingReview"].includes(activeLoad?.status)) return;
  const button = $("#reopen-key-load"); button.disabled = true;
  setMessage("#reopen-key-status", "מחזיר את ההטענה לצוות…");
  try {
    await reopenKeyLoad(activeLoad.id, user.uid);
    location.hash = route("open");
  } catch (error) {
    const reason = error.code === "permission-denied" ? "יש לפרסם את כללי Firestore המעודכנים כדי לאפשר למטיס להחזיר הטענה לעריכה." : error.message;
    setMessage("#reopen-key-status", `החזרת ההטענה נכשלה: ${reason}`, true);
  } finally { button.disabled = false; }
});
function showView() {
  const rawHash = decodeURIComponent(location.hash.slice(1));
  if (embedded && !rawHash.startsWith("keys")) return;
  if (embedded && !loadsReady) return;
  const hash = embedded ? rawHash.replace(/^keys\/?/, "") : rawHash;
  const workId = hash.startsWith("work/") ? hash.slice(5) : null;
  activeLoad = workId ? loads.find((item) => item.id === workId) : null;
  if (activeLoad && !manager && !activeLoad.teamUids.includes(user.uid)) activeLoad = null;
  if (!manager && loadsReady && !activeLoad) { location.replace("./"); return; }
  const view = activeLoad ? "work" : manager && ["history", "create", "open", "pending", "closed"].includes(hash) ? hash : "open";
  const wantsLock = !manager && view === "work" && activeLoad?.status === "open";
  if (!wantsLock || lockedLoadId !== activeLoad.id) {
    const oldLock = editLock, oldId = lockedLoadId;
    if (oldLock) void flushDraft(oldLock, oldId).catch(() => {}).finally(() => oldLock.dispose());
    editLock = null; lockedLoadId = "";
  }
  if (wantsLock && !editLock) {
    lockedLoadId = activeLoad.id;
    editLock = createEditLock({ kind: "key", serialOrId: activeLoad.id, formId: activeLoad.id,
      user: { uid: user.uid, name: activeLoad.teamNames[activeLoad.teamUids.indexOf(user.uid)] },
      onChange: ({ held, message }) => {
        const notice = $("#key-edit-lock-notice");
        if (notice) { notice.querySelector("strong").textContent = message; notice.hidden = held; }
        if (activeLoad?.id === lockedLoadId && work) renderWork();
      }
    });
    void editLock.acquire();
  }
  ["history", "create", "open", "closed", "work", ...(manager ? ["pending"] : [])].forEach((name) => { $(`#${name}-view`).hidden = name !== view; });
  if (manager && !embedded) $("#keys-manager-nav").hidden = false;
  $("#keys-nav").hidden = !manager || view === "work";
  $(backSelector).hidden = manager && view !== "work";
  $(backSelector).href = manager ? view === "work" ? `#${route(["closed", "cancelled"].includes(activeLoad?.status) ? "closed" : activeLoad?.status === "pendingReview" ? "pending" : "open")}` : embedded ? "#home" : "../Metis/#home" : "./";
  $(backSelector).textContent = "→ חזרה";
  $(backSelector).setAttribute("aria-label", view === "work" ? `חזרה להטענות ${["closed", "cancelled"].includes(activeLoad?.status) ? "שבארכיון" : "פתוחות"}` : "חזרה");
  $("#keys-nav").querySelectorAll("button").forEach((button) => { if (button.dataset.view === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
  if (view === "history") renderHistory();
  if (view === "create" && !dispatchPadReady) { clearDispatch = attachSignaturePad($("#key-dispatch-signature"), { onChange: (value) => { dispatchSignature = value; } }); dispatchPadReady = true; }
  if (view === "open") renderOpen();
  if (view === "pending") renderPending();
  if (view === "closed") renderClosed();
  if (view === "work") {
    if (workLoadId !== activeLoad.id || !editLock?.held || activeLoad.status !== "open") work = readWork(activeLoad);
    workLoadId = activeLoad.id;
    renderWork();
  } else { workLoadId = ""; }
}
$("#keys-nav").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { location.hash = route(button.dataset.view); if (!embedded) showView(); }));
if (manager) for (const [id, render] of [["open-key-search", renderOpen], ["closed-key-search", renderClosed]]) $("#" + id)?.addEventListener("input", render);
window.addEventListener("hashchange", showView);
$("#retry-key-edit-lock")?.addEventListener("click", () => editLock?.acquire());
window.addEventListener("pagehide", () => { const oldLock = editLock; if (oldLock) void flushDraft(oldLock, lockedLoadId).catch(() => {}).finally(() => oldLock.dispose()); });
renderCreateFields();
attachTimeNow(embedded ? $("#view-keys") : document);
if (manager) {
  watchTechnicians((users) => { technicians = users; renderTeam([...draft.teamUids]); }, (error) => setMessage("#create-status", `טעינת טכנאים נכשלה: ${error.message}`, true));
}
async function numberLegacyLoads(items) {
  if (!manager || numberingLegacyLoads) return;
  const pending = items.filter((item) => !item.serial).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!pending.length) return;
  numberingLegacyLoads = true;
  const status = (message, bad = false) => document.querySelectorAll(".key-numbering-status").forEach((node) => setMessageOnNode(node, message, bad));
  status(`ממספר ${pending.length} הטענות קיימות…`);
  try {
    for (const item of pending) await assignLegacyKeyLoadSerial(item.id);
    status("");
  } catch (error) {
    status(error.code === "permission-denied" ? "כדי למספר הטענות קיימות יש לפרסם את כללי Firestore המעודכנים." : `מספור הטענות נכשל: ${error.message}`, true);
  } finally { numberingLegacyLoads = false; }
}
watchKeyLoads((items) => { loads = items; if (manager) history = keyHistoryByAircraft(loads); loadsReady = true; if (embedded) { $("#keys-loading").hidden = true; $("#keys-content").hidden = false; } if (activeLoad) activeLoad = loads.find((item) => item.id === activeLoad.id); if (!manager && activeLoad?.status === "cancelled") { editLock?.dispose(); location.replace("./"); return; } if (!manager && editLock?.held && activeLoad?.status === "open") { $("#work-manager-notes").textContent = activeLoad.managerNotes || ""; $("#work-manager-notes").hidden = !activeLoad.managerNotes; } else showView(); if (manager) void numberLegacyLoads(items); if (!embedded) revealApp(); }, (error) => {
  if (error.code === "unavailable") document.dispatchEvent(new Event("ezeizo:connection-lost"));
  $("#open-key-loads").textContent = `טעינת ההטענות נכשלה: ${error.message}`;
  $("#open-key-loads").style.color = "#d40000";
  if (embedded) { loadsReady = true; $("#keys-loading").hidden = true; $("#keys-content").hidden = false; showView(); }
  if (!embedded) revealApp();
}, manager ? null : user.uid);
showView();

}
if (location.pathname.toLowerCase().includes("/keys/") || location.pathname.toLowerCase().includes("/mechanic/keys.html")) {
  const user = await gate(location.pathname.toLowerCase().includes("/mechanic/") ? "technician" : "operations");
  initKeyPages({ user });
}
