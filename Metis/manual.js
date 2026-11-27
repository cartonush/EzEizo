import { gate, revealApp, getIssue, watchToolCatalog, saveManualIssueDetails, approveManualIssue } from "../firebase-sync.js?v=1.9.23";
import { attachSignaturePad } from "../signature-canvas.js?v=1.7.6";
import { catalogTool, toolNumberOptions, updateToolCatalog } from "../tool-catalog.js?v=1.9.23";

const user = await gate("manager");
watchToolCatalog((items) => updateToolCatalog(items), () => {});
const issue = await getIssue(new URLSearchParams(location.search).get("id") || "").catch((error) => {
  document.querySelector("#manual-error").textContent = `לא ניתן לטעון את התקלה: ${error.message}`; return null;
});
revealApp();
if (!issue?.manualPaper) {
  document.querySelector("#manual-error").textContent ||= "התקלה הידנית לא נמצאה.";
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
  const defaults = { repair: "", classification: "", technicianNotes: "", arrivalTime: "", completionTime: "", paperReference: "", inspection: "", actions: Array(12).fill(false), removed: [], installed: [], tools: [], taken: [], rejected: [] };
  const state = { ...defaults, ...issue.manualDetails };
  const previouslySavedTools = new Set((issue.manualDetails?.tools || []).map((row) => `${row.toolNumber}\u0000${row.toolName}`));
  let dirty = false, saving = false, signature = "";
  const status = document.querySelector("#manual-status");
  function markDirty() { dirty = true; status.textContent = "יש שינויים שטרם נשמרו בשרת."; }
  for (const input of document.querySelectorAll("[data-manual]")) {
    input.value = state[input.dataset.manual] || "";
    input.addEventListener("input", () => { state[input.dataset.manual] = input.value; markDirty(); });
  }
  const actions = document.querySelector("#manual-actions");
  (issue.sheet.actions || []).forEach((label, index) => {
    const row = document.createElement("label"); row.className = "manager-action-row";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = Boolean(state.actions[index]);
    check.addEventListener("change", () => { state.actions[index] = check.checked; markDirty(); });
    const text = document.createElement("span"); text.textContent = `${index + 1}. ${label}`;
    row.append(check, text); actions.append(row);
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
  const clear = attachSignaturePad(document.querySelector("#manual-review-signature"), { initial: closed ? issue.reviewerSignature || "" : "", onChange: (value) => { signature = value; } });
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
  async function save() {
    if (!state.repair.trim()) throw new Error("יש למלא תיאור תיקון.");
    if (state.tools.filter(filled).some((row) => !previouslySavedTools.has(`${row.toolNumber}\u0000${row.toolName}`) && (!catalogTool(row.toolNumber) || catalogTool(row.toolNumber).toolName !== row.toolName))) throw new Error("יש לבחור מספר כלי מתוך הרשימה בכל שורת כלים.");
    if (new Set(state.tools.filter(filled).map((row) => row.toolNumber)).size !== state.tools.filter(filled).length) throw new Error("אין להזין את אותו מספר כלי פעמיים.");
    for (const [type, keys] of [["removed", ["name", "serial"]], ["installed", ["name", "serial"]], ["taken", ["description", "quantityIn", "quantityOut"]], ["rejected", ["description", "quantity", "reason"]]]) {
      if (state[type].filter(filled).some((row) => keys.some((key) => !String(row[key] || "").trim()))) throw new Error("יש להשלים את השורות שמולאו בטבלאות.");
    }
    await saveManualIssueDetails(issue.id, user.uid, { ...state, actions: state.actions.slice(0, 12), ...Object.fromEntries(Object.keys(fields).map((key) => [key, state[key].filter(filled)])) });
    dirty = false;
  }
  document.querySelector("#save-manual").addEventListener("click", async () => {
    if (saving) return; saving = true; status.textContent = "שומר בשרת…";
    try { await save(); status.textContent = "פרטי הטיפול נשמרו בשרת."; }
    catch (error) { status.textContent = `השמירה נכשלה: ${error.message}`; }
    finally { saving = false; }
  });
  document.querySelector("#close-manual").addEventListener("click", async () => {
    if (saving) return; saving = true; status.textContent = "שומר וסוגר…";
    try {
      if (!signature) throw new Error("יש לחתום על בדיקת הדף.");
      await save();
      await approveManualIssue(issue.id, user.uid, signature, collectReview());
      location.replace("./#pending");
    } catch (error) { status.textContent = `הסגירה נכשלה: ${error.message}`; }
    finally { saving = false; }
  });
  if (closed) {
    document.querySelectorAll("#manual-editor input, #manual-editor textarea, #manual-editor select, #manual-editor button").forEach((input) => { input.disabled = true; });
    document.querySelector("#manual-review-signature").style.pointerEvents = "none";
    status.textContent = "התקלה סגורה. הנתונים מוצגים לקריאה בלבד.";
  }
}
