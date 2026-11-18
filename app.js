const selectedId = new URLSearchParams(window.location.search).get("id");
const sheet = EzEizoData.normalizeSheet(EzEizoData.readIssues().find((item) => item.id === selectedId)) || EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
const selectedSheet = Boolean(selectedId && (selectedId === "example" || EzEizoData.readIssues().some((item) => item.id === selectedId)));
document.querySelector("#sheet-form").hidden = !selectedSheet;
const ACTIONS = sheet.actions;
const STORAGE_KEY = selectedSheet && sheet.id !== "example" ? `fault-sheet-v2:${sheet.id}` : "fault-sheet-v1";
const actionList = document.querySelector("#action-list");
const repairField = document.querySelector("#repair-description");
const unitsToggle = document.querySelector("#units-toggle");
const unitsArea = document.querySelector("#units-area");
const TABLES = {
  removed: [
    { key: "name", label: "שם יחידה", placeholder: "שם יחידה" },
    { key: "serial", label: "מס״ד", placeholder: "מס״ד" }
  ],
  installed: [
    { key: "name", label: "שם יחידה", placeholder: "שם יחידה" },
    { key: "serial", label: "מס״ד", placeholder: "מס״ד" }
  ],
  tools: [
    { key: "toolName", label: "שם כלי", placeholder: "שם כלי" },
    { key: "toolNumber", label: "מספר כלי", placeholder: "מספר כלי" },
    { key: "notes", label: "הערות", placeholder: "הערות" }
  ],
  taken: [
    { key: "description", label: "תיאור קשיח / נצרך", placeholder: "תיאור קשיח / נצרך" },
    { key: "removedFrom", label: "הוסר מרכיב / אזור", placeholder: "מרכיב / אזור" },
    { key: "quantityIn", label: "כמות בכניסה", placeholder: "כמות", type: "number" },
    { key: "quantityOut", label: "כמות ביציאה", placeholder: "כמות", type: "number" },
    { key: "notes", label: "הערות", placeholder: "הערות" }
  ],
  rejected: [
    { key: "description", label: "תיאור הקשיח", placeholder: "תיאור הקשיח" },
    { key: "quantity", label: "כמות", placeholder: "כמות", type: "number" },
    { key: "mascha", label: "מסחא", placeholder: "מסחא" },
    { key: "reason", label: "סיבת הפסילה", placeholder: "סיבת הפסילה" }
  ]
};
const defaultState = {
  repair: "", actions: ACTIONS.map(() => false), completionTime: "", closedAt: "",
  unitsEnabled: false, removed: [], installed: [], constantsEnabled: false,
  toolsEnabled: false, tools: [], interimEnabled: false, finalEnabled: false,
  takenEnabled: false, taken: [], rejectedEnabled: false, rejected: [],
  interimInspectorName: "", interimToolsName: "", finalInspectorName: "", finalLeadName: "", departureTime: "",
  takenFullName: "", takenPersonalNumber: "", takenRank: "",
  interimTechnicianSignature: "", interimInspectorSignature: "", interimToolsSignature: "",
  finalTechnicianSignature: "", finalInspectorSignature: "", finalLeadSignature: "", takenSignature: ""
};
let state = loadState();
state.completionTime = state.completionTime || "";
if (!Array.isArray(state.actions)) state.actions = ACTIONS.map(() => false);
state.actions[ACTIONS.length - 1] = Boolean(state.completionTime);

function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
  catch { return { ...defaultState }; }
}

function saveState() {
  if (state.closedAt) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const status = document.querySelector("#save-state");
  status.textContent = "נשמר עכשיו במכשיר";
  window.clearTimeout(saveState.timer);
  saveState.timer = window.setTimeout(() => { status.textContent = "נשמר אוטומטית במכשיר"; }, 1400);
}

function renderSheetDetails() {
  document.querySelectorAll("[data-sheet-field]").forEach((element) => {
    element.textContent = sheet[element.dataset.sheetField] || "—";
  });
  document.querySelector("#fault-description").value = sheet.fault;
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
    if (index === ACTIONS.length - 1) {
      const timePicker = document.createElement("input");
      timePicker.className = "time-picker";
      timePicker.type = "time";
      timePicker.step = "60";
      timePicker.value = state.completionTime;
      timePicker.dir = "ltr";
      timePicker.setAttribute("aria-label", "בחר שעת סיום תקלה");
      timePicker.addEventListener("change", () => {
        state.completionTime = timePicker.value;
        state.actions[index] = Boolean(state.completionTime);
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
  const closedIds = new Set(EzEizoData.readClosed().map((item) => item.id));
  const issues = EzEizoData.readIssues().filter((item) => !closedIds.has(item.id));
  if (!issues.length) { list.textContent = "אין תקלות פתוחות כאן. העתק תקלה מהמנהל ולחץ ״קבל תקלה מהלוח״."; return; }
  issues.forEach((item) => {
    const card = document.createElement("a");
    card.className = "issue-item";
    card.href = `?id=${encodeURIComponent(item.id)}`;
    const title = document.createElement("strong");
    title.textContent = `תקלה ${item.serial || "ללא מספר"} · מטוס ${item.aircraft || "—"} · ${item.location || "—"}`;
    const info = document.createElement("span");
    info.textContent = `${item.fault || "ללא תיאור"} · פתוחה`;
    card.append(title, info);
    list.append(card);
  });
}

function closureRecord() {
  return {
    id: sheet.id, serial: sheet.serial, location: sheet.location, aircraft: sheet.aircraft,
    systemCode: sheet.systemCode, systemName: sheet.systemName,
    technicians: sheet.technicians, fault: sheet.fault,
    closedAt: state.closedAt, completionTime: state.completionTime,
    repair: state.repair.slice(0, 1200),
    actionsComplete: state.actions.every(Boolean),
    removedCount: state.removed.filter((row) => row.name || row.serial).length,
    installedCount: state.installed.filter((row) => row.name || row.serial).length,
    toolsCount: state.tools.filter((row) => row.toolName || row.toolNumber || row.notes).length,
    takenCount: state.taken.filter((row) => row.description).length,
    rejectedCount: state.rejected.filter((row) => row.description).length
  };
}

function showClosed() {
  document.querySelector("#sheet-form").classList.add("is-closed");
  document.querySelector("#sheet-form").querySelectorAll("input, textarea, button").forEach((element) => {
    element.disabled = true;
  });
  document.querySelectorAll("canvas[data-signature]").forEach((canvas) => { canvas.style.pointerEvents = "none"; });
  document.querySelector("#close-sheet").hidden = true;
  document.querySelector("#close-message").textContent = `הדף נסגר ב־${new Date(state.closedAt).toLocaleString("he-IL")}. אי אפשר לערוך אותו.`;
  if (sheet.id !== "example") {
    let copy = document.querySelector("#copy-closed-sheet");
    if (!copy) {
      copy = document.createElement("button");
      copy.id = "copy-closed-sheet";
      copy.type = "button";
      copy.className = "primary-button";
      copy.textContent = "העתק דף סגור למנהל";
      copy.addEventListener("click", async () => {
        try { await EzEizoData.copyTransfer("closed", { issue: sheet, record: closureRecord(), state }); copy.textContent = "הועתק · פתח את המנהל ולחץ קבל מהלוח"; }
        catch { copy.textContent = "לא ניתן להעתיק · השתמש בשיתוף קובץ"; }
      });
      document.querySelector("#close-sheet").after(copy);
    }
    let transfer = document.querySelector("#share-closed-sheet");
    if (!transfer) {
      transfer = document.createElement("button");
      transfer.id = "share-closed-sheet";
      transfer.type = "button";
      transfer.className = "secondary-button";
      transfer.textContent = "העבר דף סגור למנהל";
      transfer.addEventListener("click", async () => {
        try {
          const result = await EzEizoData.shareTransfer("closed", { issue: sheet, record: closureRecord(), state }, sheet.serial);
          if (result !== "cancelled") transfer.textContent = result === "shared" ? "הקובץ שותף" : "הקובץ נשמר";
        } catch { transfer.textContent = "ההעברה נכשלה. נסה שוב."; }
      });
      document.querySelector("#close-sheet").after(transfer);
    }
  }
}

document.querySelector("#close-sheet").addEventListener("click", () => {
  const missing = ACTIONS.findIndex((_, index) => index === ACTIONS.length - 1 ? !state.completionTime : !state.actions[index]);
  if (missing !== -1) {
    document.querySelector("#close-message").textContent = `אי אפשר לסגור: פעולה ${missing + 1} עדיין לא סומנה${missing === ACTIONS.length - 1 ? " (בחר שעת סיום)" : ""}.`;
    const row = actionList.children[missing];
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.querySelector("input")?.focus({ preventScroll: true });
    return;
  }
  state.closedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (sheet.id !== "example") EzEizoData.saveClosed(closureRecord());
  showClosed();
  renderIssueList();
  document.querySelector("#close-title").scrollIntoView({ behavior: "smooth", block: "center" });
});

window.addEventListener("storage", renderIssueList);
function importIssuePayload(payload) {
  if (!payload || typeof payload.id !== "string" || payload.id === "example" || payload.id.length > 80 || !/^\d{6}$/.test(payload.serial) || typeof payload.fault !== "string") throw new Error("נתוני התקלה אינם תקינים.");
  const issue = EzEizoData.normalizeSheet(payload);
  const existing = EzEizoData.readIssues().find((item) => item.id === issue.id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(issue)) throw new Error("תקלה עם אותו מזהה כבר קיימת עם נתונים אחרים.");
  if (EzEizoData.readClosed().some((item) => item.id === issue.id)) throw new Error("התקלה הזו כבר סגורה במכשיר.");
  if (!existing) EzEizoData.saveIssue(issue);
  renderIssueList();
  return issue.serial;
}
document.querySelector("#mechanic-import-issues").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const status = document.querySelector("#mechanic-transfer-status");
  try {
    const file = input.files?.[0];
    if (!file || file.size > 2_000_000) throw new Error("בחר קובץ EzEizo שגודלו עד 2MB.");
    const serial = importIssuePayload(EzEizoData.parseTransfer(await file.text(), "issue"));
    status.textContent = `תקלה ${serial} נקלטה. בחר אותה מהרשימה למילוי הדף.`;
  } catch (error) { status.textContent = error.message || "הייבוא נכשל."; }
  finally { input.value = ""; }
});
document.querySelector("#mechanic-paste-issue").addEventListener("click", async () => {
  const status = document.querySelector("#mechanic-transfer-status");
  try { status.textContent = `תקלה ${importIssuePayload(await EzEizoData.readTransfer("issue"))} נקלטה. בחר אותה מהרשימה.`; }
  catch (error) { status.textContent = error.message || "לא ניתן לקלוט מהלוח. בחר קובץ במקום."; }
});

function rowHasValue(item, fields) {
  return fields.some(({ key }) => String(item[key] ?? "").trim() !== "");
}

function normalizeRows(rows, fields) {
  const filledRows = (Array.isArray(rows) ? rows : [])
    .filter((item) => rowHasValue(item, fields))
    .map((item) => Object.fromEntries(fields.map(({ key }) => [key, item[key] ?? ""])));
  return [...filledRows, Object.fromEntries(fields.map(({ key }) => [key, ""]))];
}

function renderRows(type, focusTarget = null) {
  const fields = TABLES[type];
  if (!fields) return;
  state[type] = normalizeRows(state[type], fields);
  const target = document.querySelector(`#${type}-rows`);
  const rows = state[type];
  target.replaceChildren();
  rows.forEach((item, index) => {
    const tr = document.createElement("tr");
    fields.forEach((field) => {
      const { key } = field;
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = field.type || "text";
      if (field.type === "number") input.step = "1";
      input.value = item[key] || "";
      input.placeholder = field.placeholder;
      input.dataset.rowIndex = String(index);
      input.dataset.field = key;
      input.setAttribute("aria-label", `${field.label}, שורה ${index + 1}`);
      input.addEventListener("input", () => {
        const wasFilled = rowHasValue(rows[index], fields);
        rows[index][key] = input.value;
        const isFilled = rowHasValue(rows[index], fields);
        const isLastRow = index === rows.length - 1;
        if ((isFilled && isLastRow) || (wasFilled && !isFilled && !isLastRow)) {
          const caret = input.selectionStart;
          renderRows(type, { index, key, caret });
        }
        saveState();
      });
      td.append(input);
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
    input.addEventListener(eventName, () => { state[key] = input.value; saveState(); });
  });
}

function setupSignaturePads(root = document) {
  root.querySelectorAll("canvas[data-signature]").forEach((canvas) => {
    if (canvas.dataset.initialized === "true" || canvas.clientWidth === 0) return;
    canvas.dataset.initialized = "true";
    const key = canvas.dataset.signature;
    const context = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#18334a";

    if (state[key]) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, width, height);
      image.src = state[key];
    }

    let drawing = false;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const p = point(event);
      context.beginPath();
      context.moveTo(p.x, p.y);
      context.lineTo(p.x + 0.1, p.y + 0.1);
      context.stroke();
      event.preventDefault();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const p = point(event);
      context.lineTo(p.x, p.y);
      context.stroke();
      event.preventDefault();
    });
    const finish = () => {
      if (!drawing) return;
      drawing = false;
      state[key] = canvas.toDataURL("image/png");
      saveState();
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("lostpointercapture", finish);
  });
}

document.querySelectorAll("[data-clear-signature]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.clearSignature;
    state[key] = "";
    const canvas = document.querySelector(`canvas[data-signature="${key}"]`);
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    saveState();
  });
});

repairField.value = state.repair;
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
renderActions();
Object.keys(TABLES).forEach((table) => renderRows(table));
bindToggleInputs();
bindStateFields();
setupSignaturePads();

renderIssueList();
if (selectedSheet && state.closedAt) showClosed();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
