import { gate, revealApp, getIssue, watchToolCatalog, saveManualIssueDetails, approveManualIssue } from "../firebase-sync.js?v=1.9.23";
import { attachSignaturePad } from "../signature-canvas.js?v=1.7.6";
import { catalogTool, toolNumberOptions, updateToolCatalog } from "../tool-catalog.js?v=1.9.23";

const user = await gate("manager");
watchToolCatalog((items) => updateToolCatalog(items), () => {});
const issue = await getIssue(new URLSearchParams(location.search).get("id") || "").catch((error) => {
  const message = document.querySelector("#manual-error"); message.textContent = `לא ניתן לטעון את התקלה: ${error.message}`; message.dataset.state = "error"; return null;
});
revealApp();
if (!issue?.manualPaper) {
  const message = document.querySelector("#manual-error"); message.textContent ||= "התקלה הידנית לא נמצאה."; message.dataset.state = "error";
} else {
  document.querySelector("#manual-filled-print").href = `./filled-print.html?id=${encodeURIComponent(issue.id)}`;
  const closed = issue.status === "closed";
  document.querySelector("#manual-editor").hidden = false;
  document.querySelector("#manual-heading").textContent = `תקלה ${issue.sheet.serial}${closed ? " · סגורה" : " · לסגירה"}`;
  document.querySelector("#manual-summary").textContent = `טייסת ${issue.sheet.squadron || "—"} · דת״ק ${issue.sheet.shelter || "—"} · מטוס ${issue.sheet.aircraft || "—"} · ${issue.sheet.fault || "ללא תיאור תקלה"}`;
  const fields = {
    removed: [["name", "מכלול"], ["serial", "מספר סידורי"]],
    installed: [["name", "מכלול"], ["serial", "מספר סידורי"]],
    tools: [["toolName", "שם כלי"], ["toolNumber", "מספר כלי"], ["notes", "הערות"]],
    taken: [["description", "תיאור"], ["quantityIn", "כמות בכניסה"], ["quantityOut", "כמות ביציאה"], ["notes", "הערות"]],
    rejected: [["description", "תיאור"], ["quantity", "כמות"], ["reason", "סיבת פסילה"]]
  };
  const defaults = { repair: "", classification: "", technicianNotes: "", arrivalTime: "", completionTime: "", inspection: "", actions: Array(12).fill(false), removed: [], installed: [], tools: [], taken: [], rejected: [] };
  const state = { ...defaults, ...issue.manualDetails };
  delete state.paperReference;
  const previouslySavedTools = new Set((issue.manualDetails?.tools || []).map((row) => `${row.toolNumber}\u0000${row.toolName}`));
  let dirty = false, saving = false, signature = "";
  const status = document.querySelector("#manual-status");
  function clearError() {
    document.querySelector(".manual-validation-error")?.remove();
    document.querySelectorAll('#manual-editor [aria-invalid="true"]').forEach((input) => input.removeAttribute("aria-invalid"));
    delete status.dataset.state;
  }
  function reportError(error) {
    const target = error.target;
    status.textContent = error.message;
    status.dataset.state = "error";
    document.querySelector(".manual-validation-error")?.remove();
    if (target) {
      target.setAttribute("aria-invalid", "true");
      const warning = document.createElement("p");
      warning.className = "manual-validation-error"; warning.setAttribute("role", "alert"); warning.textContent = error.message;
      (target.closest("label, .signature-field") || target).after(warning);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    } else status.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function required(message, target) { throw Object.assign(new Error(message), { target }); }
  function markDirty() { clearError(); dirty = true; status.textContent = "יש שינויים שטרם נשמרו בשרת."; }
  for (const input of document.querySelectorAll("[data-manual]")) {
    input.value = state[input.dataset.manual] || "";
    input.addEventListener("input", () => { state[input.dataset.manual] = input.value; markDirty(); });
  }
  const actions = document.querySelector("#manual-actions");
  const actionChecks = [];
  (issue.sheet.actions || []).forEach((label, index) => {
    const row = document.createElement("label"); row.className = "manager-action-row";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = Boolean(state.actions[index]);
    actionChecks.push(check);
    check.addEventListener("change", () => { state.actions[index] = check.checked; markDirty(); });
    const text = document.createElement("span"); text.textContent = `${index + 1}. ${label}`;
    row.append(check, text); actions.append(row);
  });
  const timesPanel = document.querySelector("#all-manual-times");
  for (const input of timesPanel.querySelectorAll('input[type="time"]')) input.addEventListener("input", () => { const error = document.querySelector("#all-actions-error"); error.textContent = ""; delete error.dataset.state; });
  document.querySelector("#all-manual-actions").addEventListener("click", () => {
    timesPanel.hidden = false;
    document.querySelector("#all-arrival-time").value = state.arrivalTime;
    document.querySelector("#all-completion-time").value = state.completionTime;
    document.querySelector("#all-arrival-time").scrollIntoView({ behavior: "smooth", block: "center" });
    document.querySelector("#all-arrival-time").focus({ preventScroll: true });
  });
  document.querySelector("#cancel-all-actions").addEventListener("click", () => { timesPanel.hidden = true; document.querySelector("#all-actions-error").textContent = ""; });
  document.querySelector("#confirm-all-actions").addEventListener("click", () => {
    const arrival = document.querySelector("#all-arrival-time"), completion = document.querySelector("#all-completion-time"), error = document.querySelector("#all-actions-error");
    const missing = !arrival.value ? arrival : !completion.value ? completion : null;
    if (missing) { error.textContent = missing === arrival ? "יש למלא שעת הגעה." : "יש למלא שעת סיום."; error.dataset.state = "error"; missing.scrollIntoView({ behavior: "smooth", block: "center" }); missing.focus({ preventScroll: true }); return; }
    error.textContent = ""; delete error.dataset.state;
    state.arrivalTime = arrival.value; state.completionTime = completion.value;
    document.querySelector('[data-manual="arrivalTime"]').value = arrival.value;
    document.querySelector('[data-manual="completionTime"]').value = completion.value;
    state.actions = Array(12).fill(true);
    actionChecks.forEach((check) => { check.checked = true; });
    timesPanel.hidden = true; markDirty();
  });
  function filled(row) { return Object.values(row).some((value) => String(value || "").trim()); }
  function renderRows(type, focus = null) {
    const body = document.querySelector(`[data-rows="${type}"]`);
    body.replaceChildren();
    const items = state[type].filter(filled);
    state[type] = items;
    [...items, ...(!closed ? [Object.fromEntries(fields[type].map(([key]) => [key, ""]))] : [])].forEach((item, index) => {
      const tr = document.createElement("tr");
      for (const [key, label] of fields[type]) {
        const td = document.createElement("td"), input = document.createElement("input");
        input.type = key === "toolNumber" ? "search" : ["quantityIn", "quantityOut", "quantity"].includes(key) ? "number" : "text";
        if (input.type === "number") { input.min = "0"; input.step = "1"; }
        input.value = item[key] || ""; input.setAttribute("aria-label", `${label}, שורה ${index + 1}`);
        if (type === "tools") {
          if (key === "toolNumber") { input.setAttribute("list", toolNumberOptions()); input.autocomplete = "off"; }
          input.readOnly = Boolean(catalogTool(item.toolNumber)) || previouslySavedTools.has(`${item.toolNumber}\u0000${item.toolName}`) || key !== "toolNumber";
        }
        input.addEventListener("input", () => {
          if (index === state[type].length) state[type].push(item);
          item[key] = input.value;
          if (type === "tools" && key === "toolNumber") {
            const tool = catalogTool(input.value);
            if (tool) { item.toolNumber = tool.toolNumber; item.toolName = tool.toolName; renderRows(type); body.children[index + 1]?.querySelector('[list="tool-number-options"]')?.focus(); markDirty(); return; }
          }
          if (index === state[type].length - 1 && body.children.length === state[type].length) renderRows(type, { index, key, caret: input.selectionStart });
          markDirty();
        });
        td.append(input); tr.append(td);
      }
      const td = document.createElement("td"), remove = document.createElement("button");
      remove.type = "button"; remove.className = "remove-row"; remove.textContent = "×"; remove.setAttribute("aria-label", `מחק שורה ${index + 1}`);
      remove.hidden = closed || !filled(item);
      remove.addEventListener("click", () => { state[type].splice(index, 1); renderRows(type); markDirty(); });
      td.append(remove); tr.append(td); body.append(tr);
    });
    if (focus) requestAnimationFrame(() => {
      const target = body.children[focus.index]?.querySelector(`[aria-label^="${fields[type].find(([key]) => key === focus.key)?.[1]},"]`);
      target?.focus({ preventScroll: true });
      if (target && focus.caret != null && target.setSelectionRange) target.setSelectionRange(focus.caret, focus.caret);
    });
  }
  Object.keys(fields).forEach(renderRows);
  const checks = issue.managerReview || {};
  for (const input of document.querySelectorAll("[data-review]")) {
    input[input.type === "checkbox" ? "checked" : "value"] = input.dataset.review === "recurrentYes" ? checks.recurrentAnswer === "yes" : input.dataset.review === "recurrentNo" ? checks.recurrentAnswer === "no" : checks[input.dataset.review] || (input.type === "checkbox" ? false : "");
    input.addEventListener("change", () => {
      const opposite = { verified: "notVerified", notVerified: "verified", recurrentYes: "recurrentNo", recurrentNo: "recurrentYes" }[input.dataset.review];
      if (input.checked && opposite) document.querySelector(`[data-review="${opposite}"]`).checked = false;
    });
  }
  const clear = attachSignaturePad(document.querySelector("#manual-review-signature"), { initial: closed ? issue.reviewerSignature || "" : "", onChange: (value) => { signature = value; if (value) clearError(); } });
  document.querySelector("#manual-clear-signature").addEventListener("click", clear);
  function collectReview() {
    const get = (key) => document.querySelector(`[data-review="${key}"]`);
    return {
      verified: get("verified").checked, notVerified: get("notVerified").checked,
      unitsReplaced: get("unitsReplaced").checked, repairPerformed: get("repairPerformed").checked,
      recurrent: get("recurrentYes").checked, recurrentAnswer: get("recurrentYes").checked ? "yes" : get("recurrentNo").checked ? "no" : "",
      missionCancelled: get("missionCancelled").checked, sortieCancelled: get("sortieCancelled").checked,
      inspectionPermitUntil: "", flightPermitUntil: get("flightPermitUntil").value,
      trackingPermit: get("trackingPermit").checked, approvalUntil: get("approvalUntil").value
    };
  }
  function rowInput(type, index, key) {
    return document.querySelector(`[data-rows="${type}"] tr:nth-child(${index + 1}) [aria-label^="${fields[type].find(([field]) => field === key)?.[1]},"]`);
  }
  function validate() {
    if (!state.repair.trim()) required("יש למלא תיאור תיקון.", document.querySelector('[data-manual="repair"]'));
    if (state.actions[1] && !state.arrivalTime) required("יש למלא שעת הגעה למשימה 2.", document.querySelector('[data-manual="arrivalTime"]'));
    if (state.actions[11] && !state.completionTime) required("יש למלא שעת סיום למשימה 12.", document.querySelector('[data-manual="completionTime"]'));
    for (const [index, row] of state.tools.filter(filled).entries()) {
      if (!previouslySavedTools.has(`${row.toolNumber}\u0000${row.toolName}`) && (!catalogTool(row.toolNumber) || catalogTool(row.toolNumber).toolName !== row.toolName)) required("יש לבחור מספר כלי מתוך הרשימה.", rowInput("tools", index, "toolNumber"));
      if (state.tools.filter(filled).some((other, otherIndex) => otherIndex < index && other.toolNumber === row.toolNumber)) required("אין להזין את אותו מספר כלי פעמיים.", rowInput("tools", index, "toolNumber"));
    }
    for (const [type, keys] of [["removed", ["name", "serial"]], ["installed", ["name", "serial"]], ["taken", ["description", "quantityIn", "quantityOut"]], ["rejected", ["description", "quantity", "reason"]]]) {
      for (const [index, row] of state[type].filter(filled).entries()) {
        for (const key of keys) if (!String(row[key] ?? "").trim()) required(`יש להשלים ${fields[type].find(([field]) => field === key)?.[1]} בשורה ${index + 1}.`, rowInput(type, index, key));
      }
    }
  }
  async function save() {
    validate();
    await saveManualIssueDetails(issue.id, user.uid, { ...state, actions: state.actions.slice(0, 12), ...Object.fromEntries(Object.keys(fields).map((key) => [key, state[key].filter(filled)])) });
    dirty = false;
  }
  document.querySelector("#save-manual").addEventListener("click", async () => {
    if (saving) return; saving = true; clearError(); status.textContent = "שומר בשרת…";
    try { await save(); status.textContent = "פרטי הטיפול נשמרו בשרת."; }
    catch (error) { reportError(error); }
    finally { saving = false; }
  });
  document.querySelector("#close-manual").addEventListener("click", async () => {
    if (saving) return; saving = true; clearError(); status.textContent = "שומר וסוגר…";
    try {
      validate();
      if (!signature) required("יש לחתום על בדיקת הדף.", document.querySelector("#manual-review-signature"));
      await save();
      await approveManualIssue(issue.id, user.uid, signature, collectReview());
      location.replace("./#pending");
    } catch (error) { reportError(error); }
    finally { saving = false; }
  });
  if (closed) {
    document.querySelectorAll("#manual-editor input, #manual-editor textarea, #manual-editor select, #manual-editor button").forEach((input) => { input.disabled = true; });
    document.querySelector("#manual-review-signature").style.pointerEvents = "none";
    status.textContent = "התקלה סגורה. הנתונים מוצגים לקריאה בלבד.";
  }
}
