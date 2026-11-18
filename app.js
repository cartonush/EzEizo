const ACTIONS = [
  "חתום על כלים רלוונטיים וגש לנקודת העבודה",
  "זמן הגעה לדת״ק",
  "קבל אישור עבודה על המטוס מר״צ חימוש / מפקד דת״ק",
  "בצע ביקורת כלים עם ר״צ / מפקד תורן – קוד שכיח 310 (משוך את הכלים לנקודת העבודה)",
  "וודא מטוס בטוח לאחזקה לפי כרך בטיחות המטוס",
  "לפתרון התקלה פעל עפ״י תהליך מרכזי דרג א׳",
  "עדכן ר״צ / מפקד דת״ק בסטטוס המטוס",
  "בצע ביקורת כלים בסיום העבודה – קוד שכיח 310",
  "בצע בדיקה להיעדר גופים זרים במקום העבודה – קוד שכיח 3100",
  "זכה את הכלים שנלקחו מהגף",
  "הצמד תג בר תיקון למכלול / צב״ד תקול",
  "זמן סיום התקלה"
];

const STORAGE_KEY = "fault-sheet-v1";
const actionList = document.querySelector("#action-list");
const repairField = document.querySelector("#repair-description");
const unitsToggle = document.querySelector("#units-toggle");
const unitsArea = document.querySelector("#units-area");
const defaultState = { repair: "", actions: ACTIONS.map(() => false), completionTime: "", unitsEnabled: false, removed: [], installed: [] };
let state = loadState();
state.completionTime = state.completionTime || "";
state.actions[ACTIONS.length - 1] = Boolean(state.completionTime);

function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
  catch { return { ...defaultState }; }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const status = document.querySelector("#save-state");
  status.textContent = "נשמר עכשיו במכשיר";
  window.clearTimeout(saveState.timer);
  saveState.timer = window.setTimeout(() => { status.textContent = "נשמר אוטומטית במכשיר"; }, 1400);
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

function rowHasValue(item) {
  return Boolean(String(item.name || "").trim() || String(item.serial || "").trim());
}

function normalizeRows(rows) {
  const filledRows = (Array.isArray(rows) ? rows : [])
    .filter(rowHasValue)
    .map((item) => ({ name: item.name || "", serial: item.serial || "" }));
  return [...filledRows, { name: "", serial: "" }];
}

function renderRows(type, focusTarget = null) {
  state[type] = normalizeRows(state[type]);
  const target = document.querySelector(`#${type}-rows`);
  const rows = state[type];
  target.replaceChildren();
  rows.forEach((item, index) => {
    const tr = document.createElement("tr");
    ["name", "serial"].forEach((key) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = item[key] || "";
      input.placeholder = key === "name" ? "שם יחידה" : "מס״ד";
      input.dataset.rowIndex = String(index);
      input.dataset.field = key;
      input.setAttribute("aria-label", `${key === "name" ? "שם יחידה" : "מספר סידורי"}, שורה ${index + 1}`);
      input.addEventListener("input", () => {
        const wasFilled = rowHasValue(rows[index]);
        rows[index][key] = input.value;
        const isFilled = rowHasValue(rows[index]);
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
    if (!rowHasValue(item)) {
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

renderActions();
renderRows("removed");
renderRows("installed");

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
