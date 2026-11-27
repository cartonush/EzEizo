import "./sheet-data.js?v=1.7.6";
import { gate, revealApp, watchIssues, watchKeyLoads, watchComponents, watchToolCatalog, refreshTechnicianTasks, getIssue, startIssueWork, saveInitialIntake, addToolIntake, submitForReview, saveIssueWorkDraft, approveIssue, reopenIssue, updateClosedIssueReview } from "./firebase-sync.js?v=1.9.38";
import { attachSignaturePad } from "./signature-canvas.js?v=1.9.31";
import { validateTreatment } from "./mechanic-validation.js?v=1.9.39";
import { attachTimeNow } from "./time-now.js?v=1.7.6";
import { issueTimeline } from "./lifecycle.js?v=1.9.23";
import { createEditLock } from "./edit-lock.js?v=1.9.23";
import { initCatalogView } from "./Metis/catalog-view.js?v=1.9.33";
import { DEFAULT_COMPONENTS, mergeCatalog } from "./Metis/catalog-data.js?v=1.9.33";
import { makeSquadronEmblem } from "./squadron-emblems.js?v=1.9.19";
import { attachToolPicker, catalogTool, toolNumberRecorded, updateToolCatalog } from "./tool-catalog.js?v=1.9.30";
import { initToolIntakePopup } from "./mechanic/tool-intake-popup.js?v=1.9.39";

const managerClosedView = location.pathname.toLowerCase().endsWith("/metis/closed.html");
const currentUser = await gate(managerClosedView ? "operations" : "technician");
if (!managerClosedView) watchToolCatalog((items) => updateToolCatalog(items), () => {});
const connectedUser = document.querySelector("#connected-user");
if (connectedUser) connectedUser.textContent = currentUser.name || (managerClosedView ? "מטיס" : "טכנאי");
const openToolIntakePopup = managerClosedView ? () => {} : initToolIntakePopup(currentUser);
let cloudIssues = [];
let keyLoads = [];
let keyLoadError = "";
let issueListError = "";
let selectedIssueError = "";
let issuesReady = false, keyLoadsReady = false;
const selectedId = new URLSearchParams(window.location.search).get("id");
let remoteIssue = null;
if (selectedId) {
  try { remoteIssue = await Promise.race([getIssue(selectedId), new Promise((_, reject) => setTimeout(() => reject(new Error("השרת לא השיב בזמן")), 12000))]); }
  catch (error) { selectedIssueError = error.code === "permission-denied" ? "אין הרשאה לפתוח את התקלה. בדוק שהחשבון משויך לצוות ושהרשאות Firestore מעודכנות." : `טעינת התקלה נכשלה: ${error.message}. חזור לרשימה ונסה לרענן.`; }
}
const sheet = EzEizoData.normalizeSheet(remoteIssue?.sheet || EzEizoData.defaultSheet);
const selectedSheet = Boolean(remoteIssue && (managerClosedView ? ["closed", "pendingReview"].includes(remoteIssue.status) : remoteIssue.status !== "cancelled" && (remoteIssue.teamUids || [remoteIssue.assigneeUid]).includes(currentUser.uid)));
if (!managerClosedView) {
  initCatalogView();
  const catalog = document.querySelector("#catalog-view"), tile = document.querySelector("#open-catalog"), queue = document.querySelector(".queue-card"), greeting = document.querySelector("#technician-greeting");
  function updateGreeting() {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
    const time = hour * 60 + minute;
    const phrase = time >= 360 && time <= 660 ? "בוקר טוב" : time > 660 && time <= 960 ? "צהריים טובים" : time > 960 && time <= 1260 ? "ערב טוב" : "לילה טוב";
    greeting.querySelector("h2").textContent = `${phrase}, ${currentUser.name || "טכנאי"}`;
  }
  updateGreeting();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) updateGreeting(); });
  setInterval(updateGreeting, 60_000);
  function showCatalog() {
    const open = !selectedSheet && location.hash === "#catalog";
    catalog.hidden = !open;
    greeting.hidden = open || selectedSheet;
    tile.hidden = open || selectedSheet;
    queue.hidden = open || selectedSheet;
  }
  document.querySelector("#close-catalog").addEventListener("click", () => { location.hash = ""; showCatalog(); });
  window.addEventListener("hashchange", showCatalog);
  showCatalog();
}
if (selectedId && !managerClosedView && !selectedSheet && !selectedIssueError) selectedIssueError = remoteIssue ? "התקלה אינה משויכת לחשבון זה או שהשילוח בוטל." : "התקלה לא נמצאה. חזור לרשימה ורענן משימות.";
document.querySelector("#sheet-form").hidden = !selectedSheet || (!managerClosedView && remoteIssue?.status === "open");
if (selectedSheet && remoteIssue?.paperClosure) {
  const notice = document.createElement("section");
  notice.className = "card paper-form-notice";
  const title = document.createElement("strong"); title.textContent = "נסגר באמצעות דף תקלה מודפס";
  const details = document.createElement("p");
  details.textContent = `${remoteIssue.closed?.state?.paper ? "הדף מולא ונשמר על נייר; פרטי הטיפול והחתימות אינם מתועדים בדף הדיגיטלי." : "הסגירה אושרה לפי טופס נייר. נתונים שהוגשו קודם לכן בידי הטכנאי נשמרו בדף הדיגיטלי."} מועד הסגירה במערכת: ${new Date(remoteIssue.paperClosure.at).toLocaleString("he-IL")}.`;
  notice.append(title, details);
  document.querySelector("#sheet-form").prepend(notice);
}
document.querySelector("#mechanic-back").hidden = !selectedId && !managerClosedView;
document.querySelector(".queue-card").hidden = selectedSheet || (!managerClosedView && location.hash === "#catalog");
const ACTIONS = sheet.actions;
const STORAGE_KEY = selectedSheet && sheet.id !== "example" ? `fault-sheet-v2:${sheet.id}` : "fault-sheet-v1";
const actionList = document.querySelector("#action-list");
const repairField = document.querySelector("#repair-description");
const unitsToggle = document.querySelector("#units-toggle");
const unitsArea = document.querySelector("#units-area");
let editLock = null;
let loadedDraftAt = remoteIssue?.workDraft?.savedAt || "";
let pendingDraftAt = "";
if (selectedSheet && !managerClosedView && remoteIssue.status === "open") {
  const notice = document.createElement("section");
  notice.className = "card edit-lock-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const message = document.createElement("strong");
  const retry = document.createElement("button"); retry.className = "secondary-button"; retry.type = "button"; retry.textContent = "בדוק שוב";
  retry.addEventListener("click", () => editLock?.acquire());
  const releaseMine = document.createElement("button"); releaseMine.className = "secondary-button"; releaseMine.type = "button"; releaseMine.textContent = "שחרר נעילה שלי מהפעלה קודמת"; releaseMine.hidden = true;
  releaseMine.addEventListener("click", async () => {
    releaseMine.disabled = true;
    try { await editLock?.releaseMine(); }
    catch (error) { message.textContent = `שחרור הנעילה נכשל: ${error.message}`; }
    finally { releaseMine.disabled = false; }
  });
  notice.append(message, retry, releaseMine);
  document.querySelector("#sheet-form").before(notice);
  editLock = createEditLock({ kind: "issue", serialOrId: sheet.serial, formId: sheet.id, user: { uid: currentUser.uid, name: currentUser.name || remoteIssue.assigneeName }, onChange: ({ held, message: info, ownedByMe }) => {
    notice.hidden = held;
    releaseMine.hidden = !ownedByMe;
    message.textContent = info;
    document.querySelector("#sheet-form").hidden = true;
    if (held) void getIssue(sheet.id).then((latest) => {
      if (!editLock?.held) return;
      if (![loadedDraftAt, pendingDraftAt].includes(latest.workDraft?.savedAt || "") || (latest.definitionUpdatedAt || "") !== (remoteIssue.definitionUpdatedAt || "")) { location.reload(); return; }
      document.querySelector("#sheet-form").hidden = false;
      setupSignaturePads();
      applyPreflightGate();
      document.dispatchEvent(new Event("ezeizo:edit-ready"));
      if (!workStarted && state.preflightSaved && state.safetyTechnicianSignature) void beginIssueWork();
    }).catch((error) => {
      notice.hidden = false;
      message.textContent = error.code === "permission-denied"
        ? "השרת חסם את בדיקת הטיוטה בגלל הרשאות Firestore. בדוק את כללי השרת ואת שיוך הטכנאי לתקלה, ואז לחץ על בדוק שוב."
        : `בדיקת הטיוטה המשותפת נכשלה: ${error.message}. לחץ על בדוק שוב.`;
    });
  } });
  window.addEventListener("pagehide", () => editLock?.dispose());
  void editLock.acquire();
}
const TABLES = {
  removed: [
    { key: "name", label: "שם יחידה", placeholder: "חפש מכלול במאגר" },
    { key: "serial", label: "מס״ד", placeholder: "מס״ד" }
  ],
  installed: [
    { key: "name", label: "שם יחידה", placeholder: "חפש מכלול במאגר" },
    { key: "serial", label: "מס״ד", placeholder: "מס״ד" }
  ],
  tools: [
    { key: "toolNumber", label: "מספר כלי", placeholder: "מספר כלי" },
    { key: "toolName", label: "שם כלי", placeholder: "שם כלי" },
    { key: "notes", label: "הערות", placeholder: "הערות", optional: true }
  ],
  taken: [
    { key: "description", label: "תיאור קשיח / נצרך", placeholder: "תיאור קשיח / נצרך" },
    { key: "removedFrom", label: "הוסר מרכיב / אזור", placeholder: "מרכיב / אזור" },
    { key: "quantityIn", label: "כמות בכניסה", placeholder: "כמות", type: "number" },
    { key: "quantityOut", label: "כמות ביציאה", placeholder: "כמות", type: "number" },
    { key: "notes", label: "הערות", placeholder: "הערות", optional: true }
  ],
  rejected: [
    { key: "description", label: "תיאור הקשיח", placeholder: "תיאור הקשיח" },
    { key: "quantity", label: "כמות", placeholder: "כמות", type: "number" },
    { key: "mascha", label: "מסחא", placeholder: "מסחא" },
    { key: "reason", label: "סיבת הפסילה", placeholder: "סיבת הפסילה" }
  ]
};
const componentNames = () => [...new Set(mergeCatalog(DEFAULT_COMPONENTS, savedUnitComponents).map((item) => item.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
let savedUnitComponents = [];
const defaultState = {
  repair: "", repairClassification: "", preflightSaved: false, technicianNotes: [], actions: ACTIONS.map(() => false), action11Result: "", arrivalTime: "", completionTime: "", closedAt: "",
  unitsEnabled: false, removed: [], installed: [], constantsEnabled: false,
  toolsEnabled: false, tools: [], entryEnabled: false, interimEnabled: false, finalEnabled: false,
  takenEnabled: false, taken: [], rejectedEnabled: false, rejected: [],
  entryInspectorNumber: "", interimInspectorNumber: "", interimToolsName: "", finalInspectorNumber: "", finalLeadName: "", departureTime: "",
  takenFullName: "", takenPersonalNumber: "", takenRank: "",
  safetyTechnicianSignature: "", technicianDeclarationSignature: "",
  entryTechnicianSignature: "", entryInspectorSignature: "", interimTechnicianSignature: "", interimInspectorSignature: "", interimToolsSignature: "",
  finalTechnicianSignature: "", finalInspectorSignature: "", finalLeadSignature: "", takenSignature: ""
};
let state = remoteIssue?.status === "open" && remoteIssue.workDraft?.state ? { ...defaultState, ...remoteIssue.workDraft.state } : loadState();
if (remoteIssue?.status === "open" && remoteIssue?.intake && !remoteIssue?.workDraft?.state) {
  const saved = remoteIssue.intake;
  Object.assign(state, { toolsEnabled: saved.tools.length > 0, tools: saved.tools, entryEnabled: saved.tools.length > 0,
    takenEnabled: saved.taken.length > 0, taken: saved.taken,
    entryTechnicianSignature: saved.entryTechnicianSignature || "", entryInspectorSignature: saved.entryInspectorSignature || "",
    entryInspectorNumber: saved.entryInspectorNumber || "", takenSignature: saved.takenSignature || "",
    takenFullName: saved.takenFullName || "", takenPersonalNumber: saved.takenPersonalNumber || "", takenRank: saved.takenRank || "" });
}
if (remoteIssue?.status === "open" && remoteIssue?.intake) {
  const saved = remoteIssue.intake;
  Object.assign(state, {
    entryTechnicianSignature: saved.entryTechnicianSignature || "",
    entryInspectorSignature: saved.entryInspectorSignature || "",
    entryInspectorNumber: saved.entryInspectorNumber || "",
    takenSignature: saved.takenSignature || ""
  });
}
if (remoteIssue?.acceptedTools) state.tools = remoteIssue.acceptedTools;
if (remoteIssue?.status === "open" && remoteIssue.toolIntakes?.length && state.finalInspectionToolCount !== state.tools.length) {
  for (const key of ["finalTechnicianSignature", "finalInspectorSignature", "finalInspectorNumber", "finalLeadName", "finalLeadSignature", "departureTime"]) state[key] = "";
  state.finalInspectionToolCount = null;
  state.finalEnabled = true;
}
if (remoteIssue?.intake) { state.toolsEnabled = state.tools.length > 0; state.entryEnabled = remoteIssue.intake.tools.length > 0; state.takenEnabled = remoteIssue.intake.taken.length > 0; }
let intakeChoice = remoteIssue?.intake?.choice || "";
let intakeSaved = Boolean(remoteIssue?.intake || remoteIssue?.startedAt);
let intakePending = false;
if (remoteIssue?.workDraft?.state && !("preflightSaved" in remoteIssue.workDraft.state) && state.safetyTechnicianSignature) state.preflightSaved = true;
if (remoteIssue?.safetySignature) state.safetyTechnicianSignature = remoteIssue.safetySignature;
let workStarted = Boolean(remoteIssue?.startedAt);
let safetyStartPending = false;
let safetyRetryNeeded = Boolean(intakeSaved && !state.preflightSaved && state.safetyTechnicianSignature);
let savingTechnicianDraft = false;
if (["closed", "pendingReview"].includes(remoteIssue?.status) && remoteIssue.closed?.state) {
  state = { ...defaultState, ...remoteIssue.closed.state };
} else if (remoteIssue?.status === "open" && remoteIssue.reopenedAt && state.reopenMarker !== remoteIssue.reopenedAt) {
  state = { ...defaultState, ...remoteIssue.closed.state, closedAt: "", reopenMarker: remoteIssue.reopenedAt };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
state.completionTime = state.completionTime || "";
state.arrivalTime = state.arrivalTime || "";
if (!Array.isArray(state.actions)) state.actions = ACTIONS.map(() => false);
if (!Array.isArray(state.technicianNotes)) state.technicianNotes = [];
state.action11Result = ["done", "notRequired"].includes(state.action11Result) ? state.action11Result : state.actions[10] ? "done" : "";
state.actions[10] = Boolean(state.action11Result);
state.actions[1] = Boolean(state.arrivalTime) || Boolean(remoteIssue?.status === "closed" && state.actions[1]);
state.actions[ACTIONS.length - 1] = Boolean(state.completionTime);

function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
  catch { return { ...defaultState }; }
}

function saveState() {
  if (managerClosedView) return;
  if (state.closedAt) return;
  const status = document.querySelector("#save-state");
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { status.textContent = "שמירת הטיוטה במכשיר נכשלה. השאר את הטופס פתוח ופנה מקום באחסון."; status.dataset.state = "error"; return; }
  delete status.dataset.state;
  status.textContent = "נשמר עכשיו במכשיר";
  window.clearTimeout(saveState.timer);
  saveState.timer = window.setTimeout(() => { status.textContent = "נשמר אוטומטית במכשיר"; }, 1400);
}

const classificationLabels = { verified: "אומת", notVerified: "לא אומת", notFault: "לא תקלה" };
function repairWithClassification() {
  const prefix = classificationLabels[state.repairClassification];
  return prefix ? `${prefix}\n${state.repair.trim()}` : state.repair;
}
function renderRepairClassification() {
  document.querySelectorAll("[data-repair-class]").forEach((box) => { box.checked = box.dataset.repairClass === state.repairClassification; });
  const preview = document.querySelector("#repair-class-preview");
  if (preview) { preview.hidden = !state.repairClassification; preview.textContent = state.repairClassification ? classificationLabels[state.repairClassification] : ""; }
}
document.querySelectorAll("[data-repair-class]").forEach((box) => box.addEventListener("change", () => {
  state.repairClassification = box.checked ? box.dataset.repairClass : "";
  renderRepairClassification(); saveState();
}));
renderRepairClassification();

function applyPreflightGate() {
  if (managerClosedView || !selectedSheet || remoteIssue?.status !== "open") return;
  const started = workStarted || Boolean(state.safetyTechnicianSignature && state.preflightSaved);
  const unlocked = started && state.preflightSaved;
  const form = document.querySelector("#sheet-form");
  document.querySelector("#intake-choice").hidden = intakeSaved;
  document.querySelector("#intake-save-area").hidden = intakeSaved;
  document.querySelectorAll(".sheet-save-toolbar").forEach((toolbar) => { toolbar.hidden = !unlocked; });
  document.querySelector("#intake-save").disabled = intakePending || !editLock?.held;
  for (const selector of [".tools-card", '.parts-card[aria-labelledby="taken-title"]']) form.querySelector(selector).hidden = !intakeSaved && intakeChoice !== "yes";
  const safetyCard = document.querySelector(".safety-card");
  safetyCard.hidden = !intakeSaved;
  if (intakeSaved && !form.hidden && !document.querySelector("main").hidden) setupSignaturePads(safetyCard);
  const toolsLocked = intakeSaved && Boolean(remoteIssue?.intake);
  const inspectionStatus = document.querySelector("#entry-inspection-status");
  inspectionStatus.textContent = toolsLocked && remoteIssue.intake.tools.length
    ? "ביקורת הכניסה נחתמה ונשמרה. החתימות מוצגות לקריאה בלבד. לקליטת כלי נוסף השתמש בכפתור הוספת כלי חדש ברשימת התקלות."
    : "";
  document.querySelector("#tools-toggle").disabled = toolsLocked;
  document.querySelector("#entry-check").disabled = toolsLocked;
  for (const key of ["interim", "final"]) {
    const toggle = document.querySelector(`#${key}-check`);
    toggle.closest("label").hidden = !unlocked;
    document.querySelector(`#${key}-fields`).hidden = !unlocked || !toggle.checked;
  }
  document.querySelectorAll("#tools-rows input, #tools-rows button, #entry-fields input, #entry-fields button").forEach((el) => { el.disabled = toolsLocked; });
  document.querySelectorAll('#entry-fields [data-clear-signature]').forEach((button) => { button.hidden = toolsLocked; });
  document.querySelectorAll('[data-signature="entryTechnicianSignature"], [data-signature="entryInspectorSignature"]').forEach((canvas) => { canvas.style.pointerEvents = toolsLocked ? "none" : ""; });
  document.querySelector("#taken-toggle").disabled = intakeSaved && !started;
  document.querySelector("#add-tools-link").hidden = true;
  for (const selector of [".descriptions-card", ".actions-card", ".units-card", ".constants-card", '.parts-card[aria-labelledby="rejected-title"]', ".close-card"]) form.querySelector(selector).hidden = !unlocked;
  if (unlocked && !document.querySelector("main").hidden) setupSignaturePads(form);
  document.querySelectorAll("#save-sheet, #save-sheet-bottom").forEach((button) => { button.disabled = !started || safetyStartPending || savingTechnicianDraft; });
  document.querySelector('canvas[data-signature="safetyTechnicianSignature"]').style.pointerEvents = workStarted ? "none" : "";
  document.querySelector('[data-clear-signature="safetyTechnicianSignature"]').disabled = workStarted || safetyStartPending;
  const safetyRetry = document.querySelector("#retry-safety-save");
  safetyRetry.hidden = !safetyRetryNeeded || !state.safetyTechnicianSignature || unlocked;
  safetyRetry.disabled = safetyStartPending || !editLock?.held;
  if (safetyRetryNeeded && workStarted && !document.querySelector("#safety-start-status").textContent) {
    document.querySelector("#safety-start-status").textContent = "חתימת הבטיחות שמורה בשרת, אך טיוטת העבודה עדיין לא נשמרה. לחץ לנסות שוב.";
  }
  if (document.querySelector("#shared-save-status")?.dataset.state !== "error") {
    if (!intakeSaved) setSharedSaveStatus("בחר אם נלקחו כלים או קשיחים ושמור את ביקורת הכניסה לפני בדיקת בטיחות המטוס.");
    else if (!started) setSharedSaveStatus("הקליטה נשמרה. חתום על מטוס בטוח לאחזקה כדי להתחיל בעבודה.");
    else if (!unlocked && !savingTechnicianDraft) setSharedSaveStatus("שמור את חתימת בטיחות המטוס כדי לפתוח את שאר הטופס.");
  }
}

async function beginIssueWork() {
  if (managerClosedView || safetyStartPending || !intakeSaved || !editLock?.held || remoteIssue?.status !== "open" || !state.safetyTechnicianSignature) return false;
  if (workStarted && state.preflightSaved) return true;
  safetyStartPending = true; applyPreflightGate();
  const feedback = document.querySelector("#safety-start-status"); feedback.textContent = workStarted ? "שומר טיוטת עבודה…" : "שומר חתימת בטיחות…";
  delete feedback.dataset.state;
  try {
    await editLock.renew();
    if (!workStarted) {
      await startIssueWork(sheet.id, currentUser.uid, state.safetyTechnicianSignature, editLock.session);
      workStarted = true;
    }
    state.preflightSaved = true;
    const savedAt = new Date().toISOString(); pendingDraftAt = savedAt;
    try {
      await saveIssueWorkDraft(sheet.id, currentUser.uid, { ...structuredClone(state), tools: remoteIssue.acceptedTools || [] }, editLock.session, savedAt);
      loadedDraftAt = savedAt; pendingDraftAt = "";
    } catch (error) {
      state.preflightSaved = false; pendingDraftAt = "";
      saveState();
      safetyRetryNeeded = true;
      feedback.textContent = `חתימת הבטיחות נשמרה, אך הטיוטה לא נשמרה: ${error.message}. לחץ על ״נסה שוב לשמור את חתימת הבטיחות״.`;
      feedback.dataset.state = "error";
      applyPreflightGate(); return false;
    }
    safetyRetryNeeded = false;
    feedback.textContent = "חתימת הבטיחות נשמרה. התקלה בתהליך עבודה.";
    applyPreflightGate();
    document.querySelector("#preflight-notice").showModal();
    return true;
  } catch (error) {
    safetyRetryNeeded = true;
    feedback.textContent = error.code === "permission-denied"
      ? "השרת דחה את שמירת חתימת הבטיחות בגלל הרשאות Firestore. החתימה נשארה כאן; אפשר לנסות שוב בלי לנקות אותה. אם השגיאה חוזרת, יש לבדוק את הכללים שפורסמו בשרת ואת שיוך הטכנאי לתקלה."
      : `שמירת חתימת הבטיחות נכשלה: ${error.message}. אפשר לנסות שוב בלי לנקות את החתימה.`;
    feedback.dataset.state = "error";
    return false;
  }
  finally { safetyStartPending = false; applyPreflightGate(); }
}
document.querySelector("#retry-safety-save")?.addEventListener("click", () => { void beginIssueWork(); });
document.querySelector("#preflight-notice-close")?.addEventListener("click", () => document.querySelector("#preflight-notice").close());

if (selectedSheet && !managerClosedView && remoteIssue?.status === "open") {
  const form = document.querySelector("#sheet-form"), safety = form.querySelector(".safety-card");
  form.insertBefore(form.querySelector(".tools-card"), safety);
  form.insertBefore(form.querySelector('[aria-labelledby="taken-title"]'), safety);
  form.insertBefore(form.querySelector("#intake-save-area"), safety);
  document.querySelectorAll('[name="initial-intake"]').forEach((radio) => radio.addEventListener("change", () => {
    intakeChoice = radio.value;
    if (radio.value === "no") {
      state.toolsEnabled = false; state.takenEnabled = false;
      document.querySelector("#tools-toggle").checked = false; document.querySelector("#taken-toggle").checked = false;
      document.querySelector("#tools-area").hidden = true; document.querySelector("#taken-area").hidden = true;
    }
    applyPreflightGate();
  }));
  document.querySelector("#intake-save").addEventListener("click", async () => {
    const feedback = document.querySelector("#intake-status"), button = document.querySelector("#intake-save");
    const intakeError = (message, target) => {
      feedback.textContent = message; feedback.dataset.state = "error";
      const field = target || feedback; field.scrollIntoView({ behavior: "smooth", block: "center" }); field.focus?.({ preventScroll: true });
    };
    const tools = state.toolsEnabled ? compactRows(state.tools, TABLES.tools) : [];
    const taken = state.takenEnabled ? compactRows(state.taken, TABLES.taken) : [];
    if (!intakeChoice) { intakeError("יש לבחור כן או לא.", document.querySelector('[name="initial-intake"]')); return; }
    if (intakeChoice === "yes" && !tools.length && !taken.length) { intakeError("יש למלא לפחות כלי או קשיח אחד.", document.querySelector("#tools-toggle")); return; }
    if (intakeChoice === "no" && (tools.length || taken.length)) { intakeError("יש להסיר את הפריטים לפני בחירה בלא.", document.querySelector("#intake-choice")); return; }
    const repeatedTool = tools.findIndex((tool, index) => toolNumberRecorded(tool.toolNumber, tools, index));
    if (repeatedTool !== -1) { intakeError("כלי זה כבר תועד בטבלה.", document.querySelector(`#tools-rows tr:nth-child(${repeatedTool + 1}) input[type="search"]`)); return; }
    const intake = { choice: intakeChoice, tools, taken,
      entryTechnicianSignature: state.entryTechnicianSignature, entryInspectorSignature: state.entryInspectorSignature,
      entryInspectorNumber: state.entryInspectorNumber, takenSignature: state.takenSignature,
      takenFullName: state.takenFullName, takenPersonalNumber: state.takenPersonalNumber, takenRank: state.takenRank };
    button.disabled = true; intakePending = true; delete feedback.dataset.state; feedback.textContent = "שומר ביקורת כניסה בשרת…";
    try {
      await editLock.renew();
      const at = await saveInitialIntake(sheet.id, currentUser.uid, intake, editLock.session);
      remoteIssue.intake = { ...intake, at, by: currentUser.uid };
      remoteIssue.acceptedTools = tools; state.tools = tools; state.toolsEnabled = tools.length > 0;
      state.entryEnabled = tools.length > 0; state.takenEnabled = taken.length > 0;
      document.querySelector("#entry-check").checked = state.entryEnabled;
      document.querySelector("#entry-fields").hidden = !state.entryEnabled;
      intakeSaved = true; feedback.textContent = "הקליטה נשמרה. כעת אפשר לחתום על בטיחות המטוס."; delete feedback.dataset.state;
      applyPreflightGate(); saveState();
    } catch (error) {
      intakeError(error.code === "permission-denied"
        ? "השרת דחה את שמירת ביקורת הכניסה בגלל הרשאות Firestore. החתימות נשארו בטופס; בדוק את הכללים שפורסמו ואת שיוך הצוות, ואז לחץ שוב על שמור קליטה וביקורת כניסה."
        : `הקליטה לא נשמרה: ${error.message}. אפשר ללחוץ שוב על שמור קליטה וביקורת כניסה.`);
    }
    finally { intakePending = false; if (!intakeSaved) button.disabled = false; }
  });
}

function renderSheetDetails() {
  if (managerClosedView) {
    const timeline = document.querySelector("#lifecycle-events");
    timeline.replaceChildren(...issueTimeline(remoteIssue).map(({ label, at }) => {
      const item = document.createElement("li");
      const name = document.createElement("strong"); name.textContent = label;
      const time = document.createElement("time"); time.dateTime = at; time.textContent = new Date(at).toLocaleString("he-IL");
      item.append(name, time); return item;
    }));
  }
  const times = document.querySelector("#closed-times");
  if (times) {
    times.hidden = !["closed", "pendingReview"].includes(remoteIssue?.status);
    if (!times.hidden) {
      const format = (value) => value ? new Date(value).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—";
      document.querySelector("#opened-at").textContent = format(remoteIssue.createdAt);
      document.querySelector("#closed-at").textContent = format(remoteIssue.reviewedAt || remoteIssue.closed?.state?.closedAt);
      document.querySelector("#closed-at").previousElementSibling.textContent = remoteIssue.status === "pendingReview" ? "שעת הגשת הטכנאי" : "שעת סגירה";
    }
  }
  document.querySelector("#workshop-detail").hidden = !sheet.workshop;
  document.querySelectorAll("[data-sheet-field]").forEach((element) => {
    element.textContent = sheet[element.dataset.sheetField] || "—";
  });
  const squadronField = document.querySelector('[data-sheet-field="squadron"]');
  const emblem = makeSquadronEmblem(sheet.squadron);
  if (emblem) squadronField.prepend(emblem);
  const originDisplay = document.querySelector("#fault-origins-display");
  if (originDisplay) originDisplay.textContent = (sheet.faultOrigins?.length ? sheet.faultOrigins : [sheet.faultOrigin].filter(Boolean)).join(" · ") || "—";
  document.querySelector("#fault-description").value = sheet.fault;
  document.querySelector("#dispatch-briefing").hidden = !sheet.dispatcherSignature;
  if (sheet.dispatcherSignature) document.querySelector("#dispatcher-signature-display").src = sheet.dispatcherSignature;
  const grid = document.querySelector("#constants-grid");
  grid.replaceChildren();
  Object.entries(sheet.constants).forEach(([groupName, entries]) => {
    const group = document.createElement("section");
    group.className = "constant-group";
    const heading = document.createElement("h3");
    heading.textContent = groupName;
    const list = document.createElement("dl");
    entries.forEach(([label, value]) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      row.append(term, description);
      list.append(row);
    });
    group.append(heading, list);
    grid.append(group);
  });
}

function renderTechnicianNotes() {
  const box = document.querySelector("#combined-notes");
  let prefix = sheet.managerNotes ? `${sheet.managerNotes}\n\n` : "";
  box.value = prefix + state.technicianNotes.join("\n");
  box.updateManagerNotes = (notes) => {
    sheet.managerNotes = notes;
    prefix = notes ? `${notes}\n\n` : "";
    box.value = prefix + state.technicianNotes.join("\n");
  };
  box.readOnly = managerClosedView || Boolean(state.closedAt);
  box.addEventListener("beforeinput", (event) => {
    if (box.selectionStart < prefix.length) event.preventDefault();
  });
  box.addEventListener("input", () => {
    if (!box.value.startsWith(prefix)) { box.value = prefix + state.technicianNotes.join("\n"); box.setSelectionRange(box.value.length, box.value.length); return; }
    const notes = box.value.slice(prefix.length);
    state.technicianNotes = notes ? [notes] : [];
    saveState();
  });
  box.addEventListener("click", () => { if (box.selectionStart < prefix.length) box.setSelectionRange(prefix.length, prefix.length); });
}

function renderActions() {
  actionList.replaceChildren();
  ACTIONS.forEach((label, index) => {
    const row = document.createElement("li");
    row.className = `action-row${state.actions[index] ? " done" : ""}`;
    const number = document.createElement("span");
    number.className = "action-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const text = document.createElement("span");
    text.className = "action-text";
    text.textContent = label;
    if (index === 10) {
      row.classList.add("has-choice");
      row.classList.toggle("not-required", state.action11Result === "notRequired");
      const choices = document.createElement("div");
      choices.className = "action-choices";
      choices.setAttribute("role", "radiogroup");
      choices.setAttribute("aria-label", "פעולה 11: בוצעה או לא נדרשה");
      [["done", "✓", "בוצעה"], ["notRequired", "X", "לא נדרשה"]].forEach(([value, symbol, description]) => {
        const option = document.createElement("label");
        option.className = `action-choice ${value === "notRequired" ? "choice-x" : "choice-done"}`;
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `action-11-${sheet.id}`;
        radio.value = value;
        radio.checked = state.action11Result === value;
        radio.setAttribute("aria-label", `פעולה 11 ${description}`);
        radio.addEventListener("change", () => {
          state.action11Result = value;
          state.actions[index] = true;
          row.classList.add("done");
          row.classList.toggle("not-required", value === "notRequired");
          updateProgress();
          saveState();
        });
        const mark = document.createElement("span"); mark.textContent = symbol;
        option.append(radio, mark); choices.append(option);
      });
      row.append(number, text, choices);
    } else if (index === 1 || index === ACTIONS.length - 1) {
      const isArrival = index === 1;
      const timePicker = document.createElement("input");
      timePicker.className = "time-picker";
      timePicker.type = "time";
      timePicker.step = "60";
      timePicker.value = isArrival ? state.arrivalTime : state.completionTime;
      timePicker.dir = "ltr";
      timePicker.setAttribute("aria-label", isArrival ? "בחר שעת הגעה לדת״ק" : "בחר שעת סיום תקלה");
      timePicker.addEventListener("change", () => {
        if (isArrival) state.arrivalTime = timePicker.value;
        else state.completionTime = timePicker.value;
        state.actions[index] = Boolean(timePicker.value);
        row.classList.toggle("done", state.actions[index]);
        updateProgress();
        saveState();
      });
      row.append(number, text, timePicker);
    } else {
      const checkbox = document.createElement("input");
      checkbox.className = "action-check";
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(state.actions[index]);
      checkbox.setAttribute("aria-label", `סמן פעולה ${index + 1} כהושלמה`);
      checkbox.addEventListener("change", () => {
        state.actions[index] = checkbox.checked;
        row.classList.toggle("done", checkbox.checked);
        updateProgress();
        saveState();
      });
      row.append(number, text, checkbox);
    }
    actionList.append(row);
  });
  updateProgress();
}

function updateProgress() {
  const complete = state.actions.filter(Boolean).length;
  document.querySelector("#action-progress").textContent = `${complete} מתוך ${ACTIONS.length}`;
}

function renderIssueList() {
  const list = document.querySelector("#mechanic-issues");
  list.replaceChildren();
  delete list.dataset.state;
  if (managerClosedView) {
    if (!selectedSheet) list.textContent = "התקלה הסגורה לא נמצאה. חזור לרשימת התקלות הסגורות.";
    return;
  }
  if (selectedIssueError || issueListError || keyLoadError) {
    const warning = document.createElement("p"); warning.className = "copy-status"; warning.dataset.state = "error";
    warning.textContent = [selectedIssueError, issueListError && `לא ניתן לטעון תקלות: ${issueListError}`, keyLoadError && `לא ניתן לטעון הטענות מפתחות: ${keyLoadError}`].filter(Boolean).join(" · ");
    list.append(warning);
  }
  if (!issuesReady || !keyLoadsReady) {
    const loading = document.createElement("p"); loading.className = "section-note";
    loading.textContent = "טוען משימות מהשרת…"; list.append(loading);
    return;
  }
  const issues = cloudIssues.filter((item) => item.status === "open").map((item) => ({ type: "issue", createdAt: item.createdAt, data: item.sheet }));
  const loads = keyLoads.filter((item) => item.status === "open").map((item) => ({ type: "keys", createdAt: item.createdAt, data: item }));
  const tasks = [...issues, ...loads].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (!tasks.length && !issueListError && !keyLoadError && !selectedIssueError) list.textContent = "אין משימות פתוחות כרגע.";
  tasks.forEach(({ type, data: item }) => {
    const card = document.createElement("a");
    card.className = "issue-item";
    card.href = type === "keys" ? `./keys.html#work/${encodeURIComponent(item.id)}` : `?id=${encodeURIComponent(item.id)}`;
    const title = document.createElement("strong");
    title.textContent = type === "keys" ? `הטענת מפתחות ${item.serial || ""} · טייסת ${item.squadron} · דת״ק ${item.shelter}` : `תקלה ${item.serial || "ללא מספר"} · מטוס ${item.aircraft || "—"} · ${item.location || "—"}`;
    const info = document.createElement("span");
    info.textContent = type === "keys" ? `מטוסים: ${item.aircraftIds.join(", ")} · ${item.date.split("-").reverse().join("/")} · פתוחה` : `${item.fault || "ללא תיאור"} · פתוחה`;
    card.append(title, info);
    const row = document.createElement("div"); row.className = "technician-task-row"; row.append(card);
    if (type === "issue" && cloudIssues.find((issue) => issue.id === item.id)?.intake && cloudIssues.find((issue) => issue.id === item.id)?.startedAt) {
      const add = document.createElement("button"); add.type = "button"; add.className = "secondary-button";
      add.textContent = "הוסף כלי חדש";
      add.addEventListener("click", () => openToolIntakePopup(cloudIssues.find((issue) => issue.id === item.id)));
      row.append(add);
    }
    list.append(row);
  });
}

function closureRecord() {
  return {
    id: sheet.id, serial: sheet.serial, location: sheet.location, aircraft: sheet.aircraft,
    systemCode: sheet.systemCode, systemName: sheet.systemName,
    technicians: sheet.technicians, fault: sheet.fault,
    managerNotes: sheet.managerNotes || "", technicianNotes: state.technicianNotes,
    closedAt: state.closedAt, arrivalTime: state.arrivalTime, completionTime: state.completionTime,
    repair: repairWithClassification().slice(0, 1200),
    actionsComplete: state.actions.every(Boolean) && Boolean(state.action11Result),
    removedCount: state.removed.filter((row) => row.name || row.serial).length,
    installedCount: state.installed.filter((row) => row.name || row.serial).length,
    toolsCount: state.tools.filter((row) => row.toolName || row.toolNumber || row.notes).length,
    takenCount: state.taken.filter((row) => row.description).length,
    rejectedCount: state.rejected.filter((row) => row.description).length
  };
}

function showClosed() {
  if (!selectedSheet) return;
  document.querySelector("#sheet-form").classList.add("is-closed");
  document.querySelectorAll(".sheet-save-toolbar").forEach((toolbar) => { toolbar.hidden = true; });
  document.querySelector("#sheet-form").querySelectorAll("input, textarea, select, button").forEach((element) => {
    if (element.closest("#review-panel")) return;
    element.disabled = true;
  });
  document.querySelectorAll("canvas[data-signature]").forEach((canvas) => { canvas.style.pointerEvents = "none"; });
  document.querySelector("#close-sheet").hidden = true;
  const message = document.querySelector("#close-message");
  delete message.dataset.state;
  message.textContent = remoteIssue?.paperClosure ? "התקלה נסגרה במערכת על סמך טופס נייר. המידע הידני נשמר מחוץ לאפליקציה." : remoteIssue?.status === "closed" ? `הדף נסגר ב־${new Date(remoteIssue.reviewedAt || state.closedAt).toLocaleString("he-IL")}. אי אפשר לערוך אותו.` : "הדף הועבר לבדיקת בודק הדף וממתין לחתימתו.";
}

if (managerClosedView && selectedSheet) {
  document.querySelector("#mechanic-back").href = remoteIssue.status === "pendingReview" ? "./#pending" : "./#closed";
  const panel = document.querySelector("#manager-edit-panel");
  panel.hidden = remoteIssue.status !== "pendingReview";
  document.querySelector("#manager-edit-open").addEventListener("click", async (event) => {
    if (!window.confirm("להחזיר את התקלה לטכנאי לעריכה? כל הפרטים שמולאו יישמרו והוא יוכל לסגור שוב.")) return;
    const button = event.currentTarget; button.disabled = true;
    try { await reopenIssue(sheet.id, currentUser.uid); location.replace("./#open"); }
    catch (error) { document.querySelector("#manager-edit-status").textContent = `ההחזרה נכשלה: ${error.message}`; button.disabled = false; }
  });
  const reviewPanel = document.querySelector("#review-panel");
  const managerReview = remoteIssue.managerReview || {};
  document.querySelectorAll("[data-review]").forEach((input) => { input[input.type === "checkbox" ? "checked" : "value"] = managerReview[input.dataset.review] || (input.type === "checkbox" ? false : ""); });
  for (const key of ["verified", "notVerified"]) document.querySelector(`[data-review="${key}"]`).addEventListener("change", (event) => {
    if (event.target.checked) document.querySelector(`[data-review="${key === "verified" ? "notVerified" : "verified"}"]`).checked = false;
  });
  document.querySelectorAll("[data-date-toggle]").forEach((toggle) => {
    const field = document.querySelector(`[data-review="${toggle.dataset.dateToggle}"]`);
    toggle.checked = Boolean(field.value);
    field.closest(".review-date-field").hidden = !toggle.checked;
    toggle.addEventListener("change", () => { field.closest(".review-date-field").hidden = !toggle.checked; if (!toggle.checked) field.value = ""; });
  });
  document.querySelectorAll("[data-date-today]").forEach((button) => button.addEventListener("click", () => {
    const input = document.querySelector(`[data-review="${button.dataset.dateToday}"]`);
    input.value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }));
  const answer = managerReview.recurrentAnswer || (managerReview.recurrent ? "yes" : "");
  document.querySelectorAll("[data-recurrent-answer]").forEach((toggle) => {
    toggle.checked = toggle.dataset.recurrentAnswer === answer;
    toggle.addEventListener("change", () => { if (toggle.checked) document.querySelectorAll("[data-recurrent-answer]").forEach((other) => { if (other !== toggle) other.checked = false; }); });
  });
  function collectManagerReview() {
    const review = Object.fromEntries([...document.querySelectorAll("[data-review]")].map((input) => [input.dataset.review, input.type === "checkbox" ? input.checked : input.value]));
    if (review.verified && review.notVerified) throw new Error("בחר אומת או לא אומת, לא את שניהם.");
    review.recurrentAnswer = document.querySelector("[data-recurrent-answer]:checked")?.dataset.recurrentAnswer || "";
    review.recurrent = review.recurrentAnswer === "yes";
    for (const toggle of document.querySelectorAll("[data-date-toggle]:checked")) {
      const date = document.querySelector(`[data-review="${toggle.dataset.dateToggle}"]`);
      if (!date.value) { date.focus(); throw new Error("יש לבחור תאריך לסימון היתר או אישור."); }
    }
    return review;
  }
  function reviewError(message, target) {
    const status = document.querySelector("#review-status");
    status.textContent = message; status.dataset.state = "error";
    const field = target || status;
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus?.({ preventScroll: true });
  }
  const firstTechnicianCard = document.querySelector(".safety-card") || document.querySelector(".parts-card");
  if (firstTechnicianCard && firstTechnicianCard.parentElement === reviewPanel.parentElement) {
    const details = document.createElement("details"); details.className = "card";
    const heading = document.createElement("summary"); heading.textContent = "מידע הטכנאי והטיפול בתקלה · הצג/הסתר"; details.append(heading);
    let node = firstTechnicianCard;
    while (node && node !== reviewPanel) { const next = node.nextElementSibling; details.append(node); node = next; }
    reviewPanel.before(details);
  }
  reviewPanel.hidden = Boolean(remoteIssue.paperClosure);
  const saveClosed = document.querySelector("#save-closed-review");
  saveClosed.hidden = Boolean(remoteIssue.paperClosure) || remoteIssue.status !== "pendingReview";
  saveClosed.textContent = "שמור בקרה להמשך";
  saveClosed.addEventListener("click", async () => {
    try {
      const review = collectManagerReview(); saveClosed.disabled = true;
      await updateClosedIssueReview(sheet.id, currentUser.uid, review);
      const status = document.querySelector("#review-status"); status.textContent = remoteIssue.status === "pendingReview" ? "הבקרה נשמרה. אפשר לחזור אליה ולסגור בהמשך." : "הבקרה נשמרה. הסינון ברשימת התקלות הסגורות עודכן."; delete status.dataset.state;
    } catch (error) { reviewError(`שמירת הבקרה נכשלה: ${error.message}`, document.activeElement?.matches('input[type="date"]') ? document.activeElement : null); }
    finally { saveClosed.disabled = false; }
  });
  if (!reviewPanel.hidden) {
    const isPending = remoteIssue.status === "pendingReview";
    if (!isPending) document.querySelectorAll("#review-panel input, #review-panel button[data-date-today]").forEach((input) => { input.disabled = true; });
    const canvas = document.querySelector("#reviewer-signature");
    let signature = "";
    const clear = attachSignaturePad(canvas, {
      initial: isPending ? "" : remoteIssue.reviewerSignature || "",
      onChange: (value) => { signature = value; }
    });
    canvas.style.pointerEvents = isPending ? "auto" : "none";
    document.querySelector("#clear-reviewer-signature").hidden = !isPending;
    document.querySelector("#approve-sheet").hidden = !isPending;
    document.querySelector("#clear-reviewer-signature").addEventListener("click", clear);
    document.querySelector("#approve-sheet").addEventListener("click", async (event) => {
      if (!signature) { reviewError("יש לחתום כבודק הדף לפני הסגירה.", canvas); return; }
      const button = event.currentTarget; button.disabled = true;
      try { const review = collectManagerReview(); await approveIssue(sheet.id, currentUser.uid, signature, review); location.replace("./#closed"); }
      catch (error) { reviewError(`הסגירה נכשלה: ${error.message}`, document.activeElement?.matches('input[type="date"]') ? document.activeElement : null); button.disabled = false; }
    });
  }
}

async function submitTreatment() {
  if (managerClosedView) return;
  if (!editLock?.held) { const message = document.querySelector("#close-message"); message.textContent = "הטופס אינו נעול לעריכה עבורך. לחץ על בדוק שוב."; message.dataset.state = "error"; message.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  if (document.querySelector("#close-sheet").disabled) return;
  const validation = validateTreatment(sheet, state, TABLES, { requireFreshExit: Boolean(remoteIssue?.toolIntakes?.length) });
  if (validation) {
    const message = document.querySelector("#close-message");
    message.textContent = validation.message;
    message.dataset.state = "error";
    const target = document.querySelector(validation.selector);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
    return;
  }
  const button = document.querySelector("#close-sheet");
  button.disabled = true;
  const closedAt = new Date().toISOString();
  const closingState = { ...state, closedAt };
  for (const [type, fields] of Object.entries(TABLES)) closingState[type] = compactRows(state[type], fields);
  const record = { ...closureRecord(), closedAt, actionsComplete: true };
  try {
    await editLock.renew();
    await submitForReview(sheet.id, record, closingState, editLock.session);
    Object.assign(state, closingState);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* The transaction has already saved the form on the server. */ }
    showClosed();
    editLock.dispose();
    document.querySelector("#close-title").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    const message = document.querySelector("#close-message");
    message.textContent = error.code === "permission-denied" ? "השרת דחה את שליחת הדף. הטיוטה נשמרה במכשיר; בדוק שהתקלה עדיין משויכת אליך ולחץ על ״בדוק שוב״ בנעילה. אם התקלה חוזרת, שלח צילום של ההודעה לבדיקה." : `השמירה נכשלה: ${error.message}. נסה שוב.`;
    message.dataset.state = "error";
    button.disabled = false;
  }
}
document.querySelector("#close-sheet").addEventListener("click", submitTreatment);
function setSharedSaveStatus(message, error = false) {
  document.querySelectorAll("#shared-save-status, #shared-save-status-bottom").forEach((status) => { status.textContent = message; if (error) status.dataset.state = "error"; else delete status.dataset.state; });
}
async function saveTechnicianDraft() {
  if (savingTechnicianDraft) return;
  if (!editLock?.held || remoteIssue?.status !== "open") { setSharedSaveStatus("הטופס אינו נעול לעריכה עבורך. בדוק שוב את הנעילה.", true); return; }
  if (!intakeSaved || !state.safetyTechnicianSignature) { setSharedSaveStatus("יש להשלים קליטה ובדיקת בטיחות המטוס לפני שמירת טיוטת העבודה.", true); return; }
  savingTechnicianDraft = true; applyPreflightGate();
  setSharedSaveStatus("שומר טיוטה בשרת…");
  const previousPreflight = state.preflightSaved, previousDraftAt = loadedDraftAt;
  try {
    await editLock.renew();
    if (!state.preflightSaved && !(await beginIssueWork())) throw new Error("שמירת חתימת הבטיחות או הטיוטה עדיין לא הושלמה. השתמש בכפתור הניסיון החוזר ליד החתימה.");
    state.preflightSaved = true;
    saveState();
    const savedAt = new Date().toISOString(); pendingDraftAt = savedAt;
    await saveIssueWorkDraft(sheet.id, currentUser.uid, { ...structuredClone(state), tools: remoteIssue.acceptedTools || compactRows(state.tools, TABLES.tools) }, editLock.session, savedAt);
    loadedDraftAt = savedAt; pendingDraftAt = "";
    setSharedSaveStatus("הטיוטה נשמרה לצוות בשרת. אפשר להמשיך לעבוד בדף.");
    applyPreflightGate();
  } catch (error) {
    state.preflightSaved = previousPreflight; loadedDraftAt = previousDraftAt; pendingDraftAt = "";
    saveState();
    setSharedSaveStatus(error.code === "permission-denied"
      ? "השרת דחה את שמירת הטיוטה בגלל הרשאות Firestore. העבודה נשארה במכשיר. בדוק את כללי השרת ושיוך הצוות, ואז לחץ שוב על שמור טיוטה."
      : `השמירה המשותפת נכשלה: ${error.message}. לחץ שוב על שמור טיוטה.`, true);
  }
  finally { savingTechnicianDraft = false; applyPreflightGate(); }
}
document.querySelectorAll("#save-sheet, #save-sheet-bottom").forEach((button) => button.addEventListener("click", saveTechnicianDraft));

if (selectedSheet && !managerClosedView && remoteIssue?.status === "open") {
  const panel = document.querySelector("#late-tools"), form = document.querySelector("#sheet-form");
  const rows = document.querySelector("#late-tool-rows"), feedback = document.querySelector("#late-tools-status");
  const lateInspectorNumber = document.querySelector("#late-inspector-number");
  lateInspectorNumber.addEventListener("input", () => {
    lateInspectorNumber.value = lateInspectorNumber.value.replace(/[^0-9]/g, "").replace(/^0+/, "").slice(0, 7);
  });
  let draftTools = [{ toolName: "", toolNumber: "", notes: "" }];
  let technicianSignature = "", inspectorSignature = "", clearTechnician, clearInspector;
  let previousVisibility = null;
  function renderLateRows() {
    rows.replaceChildren();
    draftTools.forEach((row, index) => {
      const tr = document.createElement("tr");
      for (const [key, label] of [["toolNumber", "מספר כלי"], ["toolName", "שם כלי"], ["notes", "הערות"]]) {
        const td = document.createElement("td"), input = document.createElement("input");
        input.type = key === "toolNumber" ? "search" : "text"; input.value = row[key]; input.setAttribute("aria-label", `${label}, שורה ${index + 1}`);
        if (catalogTool(row.toolNumber)) input.readOnly = true;
        else if (key !== "toolNumber") input.readOnly = true;
        input.addEventListener("input", () => {
          row[key] = input.value;
          if (key === "toolNumber") {
            const tool = catalogTool(input.value);
            if (tool && !toolNumberRecorded(tool.toolNumber, draftTools, index, remoteIssue.acceptedTools || [])) { row.toolNumber = tool.toolNumber; row.toolName = tool.toolName; if (index === draftTools.length - 1) draftTools.push({ toolName: "", toolNumber: "", notes: "" }); renderLateRows(); rows.children[index + 1]?.querySelector('input[type="search"]')?.focus(); return; }
            row.toolName = "";
          }
          if (index === draftTools.length - 1 && (row.toolName || row.toolNumber || row.notes)) {
            draftTools.push({ toolName: "", toolNumber: "", notes: "" }); renderLateRows();
            const current = rows.children[index]?.querySelectorAll("input")[["toolNumber", "toolName", "notes"].indexOf(key)];
            current?.focus(); current?.setSelectionRange(current.value.length, current.value.length);
          }
        });
        td.append(key === "toolNumber" ? attachToolPicker(input, { isUnavailable: (number) => toolNumberRecorded(number, draftTools, index, remoteIssue.acceptedTools || []) }) : input); tr.append(td);
      }
      const actions = document.createElement("td"), remove = document.createElement("button");
      remove.type = "button"; remove.className = "remove-row"; remove.textContent = "×"; remove.setAttribute("aria-label", `מחק שורה ${index + 1}`);
      remove.hidden = !(row.toolName || row.toolNumber || row.notes);
      remove.addEventListener("click", () => { draftTools.splice(index, 1); if (!draftTools.length || draftTools.at(-1).toolNumber) draftTools.push({ toolName: "", toolNumber: "", notes: "" }); renderLateRows(); });
      actions.append(remove); tr.append(actions); rows.append(tr);
    });
  }
  function showLateTools() {
    if (!workStarted || !editLock?.held || previousVisibility) return;
    previousVisibility = [...form.children].map((el) => [el, el.hidden]);
    previousVisibility.forEach(([el]) => { el.hidden = el !== panel; });
    panel.hidden = false; renderLateRows();
    if (!clearTechnician) clearTechnician = attachSignaturePad(document.querySelector("#late-technician-signature"), { onChange: (value) => { technicianSignature = value; } });
    if (!clearInspector) clearInspector = attachSignaturePad(document.querySelector("#late-inspector-signature"), { onChange: (value) => { inspectorSignature = value; } });
    panel.scrollIntoView({ block: "start" });
  }
  function hideLateTools() {
    previousVisibility?.forEach(([el, hidden]) => { el.hidden = hidden; });
    previousVisibility = null; panel.hidden = true; applyPreflightGate();
    if (location.hash === "#add-tools") history.replaceState(null, "", location.pathname + location.search);
  }
  document.querySelector("#add-tools-link").addEventListener("click", showLateTools);
  document.querySelector("#cancel-late-tools").addEventListener("click", hideLateTools);
  document.querySelector("#clear-late-technician").addEventListener("click", () => clearTechnician?.());
  document.querySelector("#clear-late-inspector").addEventListener("click", () => clearInspector?.());
  document.querySelector("#save-late-tools").addEventListener("click", async (event) => {
    const button = event.currentTarget, tools = draftTools.filter((row) => row.toolName || row.toolNumber || row.notes);
    const repeatedTool = tools.findIndex((tool, index) => toolNumberRecorded(tool.toolNumber, tools, index, remoteIssue.acceptedTools || []));
    if (repeatedTool !== -1) {
      feedback.textContent = "כלי זה כבר תועד בתקלה."; feedback.dataset.state = "error";
      document.querySelector(`#late-tool-rows tr:nth-child(${repeatedTool + 1}) input[type="search"]`)?.focus(); return;
    }
    button.disabled = true; feedback.textContent = "שומר ביקורת כניסה…";
    try {
      await editLock.renew();
      const at = await addToolIntake(sheet.id, currentUser.uid, { tools, technicianSignature, inspectorSignature, inspectorNumber: document.querySelector("#late-inspector-number").value }, editLock.session);
      state.tools = [...(remoteIssue.acceptedTools || []), ...tools]; state.toolsEnabled = true;
      remoteIssue.acceptedTools = state.tools;
      remoteIssue.toolIntakes = [...(remoteIssue.toolIntakes || []), { tools, at, by: currentUser.uid }];
      state.finalEnabled = true;
      state.finalInspectionToolCount = null;
      for (const key of ["finalTechnicianSignature", "finalInspectorSignature", "finalInspectorNumber", "finalLeadName", "finalLeadSignature", "departureTime"]) {
        signatureClearers.get(key)?.();
        state[key] = "";
        const field = document.querySelector(`[data-state-field="${key}"]`);
        if (field) field.value = "";
      }
      renderRows("tools"); document.querySelector("#tools-toggle").checked = true;
      document.querySelector("#tools-area").hidden = false;
      document.querySelector("#final-check").checked = true;
      document.querySelector("#final-fields").hidden = false;
      setupSignaturePads(document.querySelector("#final-fields"));
      applyPreflightGate();
      renderToolIntakeHistory(); saveState();
      draftTools = [{ toolName: "", toolNumber: "", notes: "" }];
      clearTechnician(); clearInspector(); document.querySelector("#late-inspector-number").value = "";
      hideLateTools();
      setSharedSaveStatus("הכלים החדשים נקלטו. יש לבצע ולחתום שוב על ביקורת יציאה לכל הכלים לפני הגשת הדף.");
    } catch (error) { feedback.textContent = `הכלים לא נקלטו: ${error.message}`; feedback.dataset.state = "error"; }
    finally { button.disabled = false; }
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#add-tools") showLateTools(); });
  if (location.hash === "#add-tools") window.addEventListener("ezeizo:edit-ready", showLateTools, { once: true });
}

function renderToolIntakeHistory() {
  const container = document.querySelector("#tool-intake-history"); if (!container) return;
  container.replaceChildren();
  (remoteIssue?.toolIntakes || []).forEach((batch) => {
    const line = document.createElement("p");
    line.textContent = `כלים שנוספו בביקורת כניסה ${new Date(batch.at).toLocaleString("he-IL")}: ${batch.tools.map((tool) => `${tool.toolName} – ${tool.toolNumber}`).join(", ")}`;
    container.append(line);
  });
}

watchIssues((issues, partialError = "") => {
  cloudIssues = issues;
  issuesReady = true;
  issueListError = partialError;
  renderIssueList();
  const current = issues.find((item) => item.id === selectedId);
  if (!managerClosedView && current?.status === "cancelled") {
    editLock?.dispose();
    location.replace("./");
    return;
  }
  if (current?.status === "open" && current.sheet.managerNotes !== sheet.managerNotes) {
    document.querySelector("#combined-notes").updateManagerNotes?.(current.sheet.managerNotes || "");
  }
  if (current?.status === "open" && current.reopenedAt && state.closedAt) {
    location.reload();
    return;
  }
  if (["closed", "pendingReview"].includes(current?.status) && !state.closedAt) {
    state = { ...defaultState, ...current.closed.state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    location.reload();
  }
}, (error) => { issuesReady = true; issueListError = error.message; renderIssueList(); if (error.code === "unavailable") document.dispatchEvent(new Event("ezeizo:connection-lost")); }, managerClosedView ? null : currentUser.uid);

if (!managerClosedView) watchKeyLoads((loads) => { keyLoads = loads; keyLoadsReady = true; keyLoadError = ""; renderIssueList(); }, (error) => { keyLoadsReady = true; keyLoadError = error.message; renderIssueList(); }, currentUser.uid);
document.querySelector("#refresh-tasks")?.addEventListener("click", async (event) => {
  const button = event.currentTarget, status = document.querySelector("#refresh-tasks-status");
  button.disabled = true;
  status.textContent = "מרענן משימות מהשרת…";
  delete status.dataset.state;
  try {
    const fresh = await Promise.race([refreshTechnicianTasks(currentUser.uid), new Promise((_, reject) => setTimeout(() => reject(new Error("השרת לא השיב בזמן. בדוק את החיבור ונסה שוב.")), 12000))]);
    cloudIssues = fresh.issues; keyLoads = fresh.keyLoads;
    issuesReady = true; keyLoadsReady = true; issueListError = ""; keyLoadError = ""; selectedIssueError = "";
    renderIssueList();
    status.textContent = `הרשימה עודכנה · ${fresh.issues.filter((item) => item.status === "open").length + fresh.keyLoads.filter((item) => item.status === "open").length} משימות פתוחות.`;
  } catch (error) { status.textContent = `הרענון נכשל: ${error.message}`; status.dataset.state = "error"; }
  finally { button.disabled = false; }
});

function rowHasValue(item, fields) {
  return fields.some(({ key }) => String(item?.[key] ?? "").trim() !== "");
}

function compactRows(rows, fields) {
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => rowHasValue(item, fields))
    .map((item) => Object.fromEntries(fields.map(({ key }) => [key, item[key] ?? ""])));
}

function normalizeRows(rows, fields, editable = true) {
  const filledRows = compactRows(rows, fields);
  return editable ? [...filledRows, Object.fromEntries(fields.map(({ key }) => [key, ""]))] : filledRows;
}

function renderRows(type, focusTarget = null) {
  const fields = TABLES[type];
  if (!fields) return;
  state[type] = normalizeRows(state[type], fields, !managerClosedView && !state.closedAt);
  const target = document.querySelector(`#${type}-rows`);
  const rows = state[type];
  target.replaceChildren();
  rows.forEach((item, index) => {
    const tr = document.createElement("tr");
    fields.forEach((field) => {
      const { key } = field;
      const td = document.createElement("td");
      const componentField = (type === "removed" || type === "installed") && key === "name";
      const input = document.createElement("input");
      input.type = componentField || (type === "tools" && key === "toolNumber") ? "search" : field.type || "text";
      if (componentField) input.autocomplete = "off";
      if (type === "tools") {
        input.readOnly = Boolean(catalogTool(item.toolNumber)) || key !== "toolNumber";
      }
      if (field.type === "number") input.step = "1";
      input.value = item[key] || "";
      input.placeholder = field.placeholder;
      input.dataset.rowIndex = String(index);
      input.dataset.field = key;
      input.setAttribute("aria-label", `${field.label}, שורה ${index + 1}`);
      function commitValue(value) {
        const wasFilled = rowHasValue(rows[index], fields);
        rows[index][key] = value;
        const chosenTool = type === "tools" && key === "toolNumber" && !toolNumberRecorded(value, rows, index) ? catalogTool(value) : null;
        if (chosenTool) { rows[index].toolNumber = chosenTool.toolNumber; rows[index].toolName = chosenTool.toolName; }
        else if (type === "tools" && key === "toolNumber") rows[index].toolName = "";
        const isFilled = rowHasValue(rows[index], fields);
        const isLastRow = index === rows.length - 1;
        if (chosenTool || (isFilled && isLastRow) || (wasFilled && !isFilled && !isLastRow)) {
          const caret = input.selectionStart;
          renderRows(type, chosenTool ? { index: index + 1, key: "toolNumber", caret: null } : componentField && value ? { index, key: "serial", caret: null } : { index, key, caret });
        }
        saveState();
      }
      if (componentField && !managerClosedView && !state.closedAt) {
        const picker = document.createElement("div");
        picker.className = "component-picker";
        const list = document.createElement("div");
        list.className = "component-results";
        list.id = `component-results-${type}-${index}`;
        list.setAttribute("role", "listbox");
        list.setAttribute("aria-label", "תוצאות חיפוש מכלולים");
        list.hidden = true;
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-autocomplete", "list");
        input.setAttribute("aria-controls", list.id);
        input.setAttribute("aria-expanded", "false");
        const hideResults = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); };
        const selectComponent = (name) => {
          input.value = name;
          input.setCustomValidity("");
          hideResults();
          commitValue(name);
          requestAnimationFrame(() => target.querySelector(`[data-row-index="${index}"][data-field="serial"]`)?.focus({ preventScroll: true }));
        };
        const showResults = () => {
          const query = input.value.trim().toLocaleLowerCase("he");
          const matches = componentNames().filter((name) => name.toLocaleLowerCase("he").includes(query));
          list.replaceChildren();
          if (!matches.length) {
            const empty = document.createElement("span"); empty.className = "component-no-results"; empty.textContent = "לא נמצאו מכלולים במאגר."; list.append(empty);
          }
          matches.forEach((name) => {
            const option = document.createElement("button");
            option.type = "button"; option.className = "component-result";
            option.setAttribute("role", "option"); option.textContent = name;
            option.addEventListener("click", () => selectComponent(name));
            list.append(option);
          });
          list.hidden = false;
          input.setAttribute("aria-expanded", "true");
          input.setCustomValidity(input.value && !componentNames().some((name) => name.toLocaleLowerCase("he") === query) ? "בחר מכלול מתוך תוצאות החיפוש." : "");
        };
        input.addEventListener("focus", showResults);
        input.addEventListener("input", showResults);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Escape") { hideResults(); return; }
          if (event.key !== "Enter" && event.key !== "ArrowDown") return;
          const first = list.querySelector(".component-result");
          if (!first || list.hidden) return;
          event.preventDefault();
          if (event.key === "Enter") selectComponent(first.textContent);
          else first.focus();
        });
        input.addEventListener("change", () => {
          const exact = componentNames().find((name) => name.toLocaleLowerCase("he") === input.value.trim().toLocaleLowerCase("he"));
          if (exact) selectComponent(exact);
          else if (!input.value.trim()) commitValue("");
        });
        picker.addEventListener("focusout", () => { setTimeout(() => { if (!picker.contains(document.activeElement)) hideResults(); }, 100); });
        picker.append(input, list); td.append(picker);
      } else {
        input.addEventListener("input", () => commitValue(input.value));
        td.append(type === "tools" && key === "toolNumber" ? attachToolPicker(input, { isUnavailable: (number) => toolNumberRecorded(number, rows, index) }) : input);
      }
      tr.append(td);
    });
    const removeCell = document.createElement("td");
    const remove = document.createElement("button");
    remove.className = "remove-row";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "הסר שורה");
    if (!rowHasValue(item, fields)) {
      remove.hidden = true;
      remove.tabIndex = -1;
    }
    remove.addEventListener("click", () => { rows.splice(index, 1); renderRows(type); saveState(); });
    removeCell.append(remove);
    tr.append(removeCell);
    target.append(tr);
  });
  if (focusTarget) {
    requestAnimationFrame(() => {
      const input = target.querySelector(`[data-row-index="${focusTarget.index}"][data-field="${focusTarget.key}"]`);
      if (!input) return;
      input.focus({ preventScroll: true });
      if (focusTarget.caret !== null) input.setSelectionRange(focusTarget.caret, focusTarget.caret);
    });
  }
}

function bindToggleInputs() {
  document.querySelectorAll("[data-toggle-state]").forEach((input) => {
    const key = input.dataset.toggleState;
    const target = document.getElementById(input.dataset.target);
    input.checked = Boolean(state[key]);
    target.hidden = !input.checked;
    input.addEventListener("change", () => {
      state[key] = input.checked;
      target.hidden = !input.checked;
      if (key === "toolsEnabled" && input.checked && !intakeSaved) {
        state.entryEnabled = true;
        document.querySelector("#entry-check").checked = true;
        document.querySelector("#entry-fields").hidden = false;
        setupSignaturePads(document.querySelector("#entry-fields"));
      }
      if (input.checked) setupSignaturePads(target);
      saveState();
    });
  });
}

function bindStateFields() {
  document.querySelectorAll("[data-state-field]").forEach((input) => {
    const key = input.dataset.stateField;
    input.value = state[key] || "";
    const eventName = input.type === "time" ? "change" : "input";
    input.addEventListener(eventName, () => {
      if (key.endsWith("InspectorNumber") || key === "takenPersonalNumber") input.value = input.value.replace(/[^0-9]/g, "").replace(/^0+/, "").slice(0, 7);
      state[key] = input.value;
      saveState();
    });
  });
}

const signatureClearers = new Map();
function setupSignaturePads(root = document) {
  root.querySelectorAll("canvas[data-signature]").forEach((canvas) => {
    if (canvas.dataset.initialized === "true" || canvas.clientWidth === 0) return;
    canvas.dataset.initialized = "true";
    const key = canvas.dataset.signature;
    signatureClearers.set(key, attachSignaturePad(canvas, { initial: state[key] || "", onChange(value) {
      state[key] = value;
      if (key === "finalInspectorSignature") state.finalInspectionToolCount = value ? state.tools.length : null;
      saveState();
      if (key === "safetyTechnicianSignature") {
        if (value) void beginIssueWork();
        else { safetyRetryNeeded = false; const feedback = document.querySelector("#safety-start-status"); feedback.textContent = ""; delete feedback.dataset.state; applyPreflightGate(); }
      }
    } }));
  });
}

document.querySelectorAll("[data-clear-signature]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.clearSignature;
    if (key === "safetyTechnicianSignature" && (workStarted || safetyStartPending)) return;
    if (["entryTechnicianSignature", "entryInspectorSignature"].includes(key) && remoteIssue?.intake) return;
    const canvas = document.querySelector(`canvas[data-signature="${key}"]`);
    if (canvas && !signatureClearers.has(key)) setupSignaturePads(canvas.parentElement);
    signatureClearers.get(key)?.();
  });
});

repairField.value = managerClosedView ? repairWithClassification() : state.repair;
document.querySelector("#repair-count").textContent = `${state.repair.length} / 1200`;
repairField.addEventListener("input", () => {
  state.repair = repairField.value;
  document.querySelector("#repair-count").textContent = `${repairField.value.length} / 1200`;
  saveState();
});

unitsToggle.checked = Boolean(state.unitsEnabled);
unitsArea.hidden = !unitsToggle.checked;
unitsToggle.addEventListener("change", () => {
  state.unitsEnabled = unitsToggle.checked;
  unitsArea.hidden = !state.unitsEnabled;
  saveState();
});

renderSheetDetails();
if (managerClosedView) document.querySelector("#save-state").textContent = "דף סגור · קריאה בלבד";
renderTechnicianNotes();
renderActions();
Object.keys(TABLES).forEach((table) => renderRows(table));
if (selectedSheet) watchComponents((items) => { savedUnitComponents = items; }, () => {});
bindToggleInputs();
bindStateFields();
renderToolIntakeHistory();
attachTimeNow();
revealApp();
setupSignaturePads();
applyPreflightGate();

renderIssueList();
if (selectedSheet && state.closedAt) showClosed();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
