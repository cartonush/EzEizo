import { addToolIntake } from "../firebase-sync.js?v=1.9.30";
import { createEditLock } from "../edit-lock.js?v=1.9.23";
import { attachSignaturePad } from "../signature-canvas.js?v=1.9.31";
import { attachToolPicker, catalogTool, toolNumberRecorded } from "../tool-catalog.js?v=1.9.30";

export function initToolIntakePopup(user) {
  const dialog = document.querySelector("#tool-intake-dialog");
  const body = document.querySelector("#tool-intake-rows");
  const status = document.querySelector("#tool-intake-error");
  const lockStatus = document.querySelector("#tool-intake-lock");
  const retry = document.querySelector("#retry-tool-intake-lock");
  const save = document.querySelector("#save-tool-intake-dialog");
  const inspectorNumber = document.querySelector("#tool-intake-inspector-number");
  const technicianCanvas = document.querySelector("#tool-intake-technician-signature");
  const inspectorCanvas = document.querySelector("#tool-intake-inspector-signature");
  let issue = null, lock = null, rows = [], technicianSignature = "", inspectorSignature = "", saving = false;
  let clearTechnician, clearInspector;
  inspectorNumber.addEventListener("input", () => {
    inspectorNumber.value = inspectorNumber.value.replace(/[^0-9]/g, "").replace(/^0+/, "").slice(0, 7);
    clearError();
  });

  function error(message, target) {
    status.textContent = message; status.dataset.state = "error";
    const field = target || status;
    field.setAttribute?.("aria-invalid", "true");
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus?.({ preventScroll: true });
  }
  function clearError() {
    status.textContent = ""; delete status.dataset.state;
    dialog.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute("aria-invalid"));
  }
  function render() {
    body.replaceChildren();
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      for (const [key, label] of [["toolNumber", "מספר כלי"], ["toolName", "שם כלי"], ["notes", "הערות"]]) {
        const cell = document.createElement("td"), input = document.createElement("input");
        input.type = key === "toolNumber" ? "search" : "text";
        input.value = row[key]; input.setAttribute("aria-label", `${label}, שורה ${index + 1}`);
        input.readOnly = key === "toolName" || Boolean(catalogTool(row.toolNumber));
        input.addEventListener("input", () => {
          clearError(); row[key] = input.value;
          if (key === "toolNumber") {
            const selected = catalogTool(input.value);
            if (selected && !toolNumberRecorded(selected.toolNumber, rows, index, issue?.acceptedTools || [])) {
              row.toolNumber = selected.toolNumber; row.toolName = selected.toolName;
              if (index === rows.length - 1) rows.push({ toolName: "", toolNumber: "", notes: "" });
              render(); body.children[index + 1]?.querySelector('input[type="search"]')?.focus(); return;
            }
            row.toolName = "";
          }
          if (index === rows.length - 1 && Object.values(row).some(Boolean)) rows.push({ toolName: "", toolNumber: "", notes: "" });
          if (rows.length !== body.children.length) {
            const caret = input.selectionStart; render();
            const same = body.children[index]?.querySelectorAll("input")[["toolNumber", "toolName", "notes"].indexOf(key)];
            same?.focus(); if (caret != null) same?.setSelectionRange(caret, caret);
          }
        });
        cell.append(key === "toolNumber" ? attachToolPicker(input, { isUnavailable: (number) => toolNumberRecorded(number, rows, index, issue?.acceptedTools || []) }) : input); tr.append(cell);
      }
      const cell = document.createElement("td"), remove = document.createElement("button");
      remove.type = "button"; remove.className = "remove-row"; remove.textContent = "×";
      remove.setAttribute("aria-label", `מחק שורה ${index + 1}`);
      remove.hidden = !Object.values(row).some(Boolean);
      remove.addEventListener("click", () => {
        rows.splice(index, 1);
        if (!rows.length || Object.values(rows.at(-1)).some(Boolean)) rows.push({ toolName: "", toolNumber: "", notes: "" });
        clearError(); render();
      });
      cell.append(remove); tr.append(cell); body.append(tr);
    });
  }
  function close() {
    if (saving) return;
    dialog.close();
  }
  dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    lock?.dispose(); lock = null; issue = null;
    clearTechnician?.(); clearInspector?.(); technicianSignature = ""; inspectorSignature = "";
    inspectorNumber.value = ""; rows = [];
  });
  document.querySelector("#close-tool-intake-dialog").addEventListener("click", close);
  document.querySelector("#cancel-tool-intake-dialog").addEventListener("click", close);
  document.querySelector("#clear-tool-intake-technician").addEventListener("click", () => clearTechnician?.());
  document.querySelector("#clear-tool-intake-inspector").addEventListener("click", () => clearInspector?.());
  window.addEventListener("pagehide", () => lock?.dispose());
  retry.addEventListener("click", () => lock?.acquire());
  save.addEventListener("click", async () => {
    if (saving || !issue || !lock?.held) return;
    clearError();
    const tools = rows.filter((row) => Object.values(row).some((value) => String(value).trim()));
    if (!tools.length) { error("יש לבחור לפחות כלי אחד.", body.querySelector('input[type="search"]')); return; }
    for (const [index, row] of tools.entries()) {
      if (toolNumberRecorded(row.toolNumber, tools, index, issue.acceptedTools || [])) { error("כלי זה כבר תועד בתקלה.", body.children[index]?.querySelector('input[type="search"]')); return; }
      const tool = catalogTool(row.toolNumber);
      if (!tool || tool.toolName !== row.toolName) { error("יש לבחור מספר כלי מתוך הרשימה.", body.children[index]?.querySelector('input[type="search"]')); return; }
    }
    if (!technicianSignature) { error("יש לחתום כטכנאי על ביקורת הכניסה.", technicianCanvas); return; }
    if (!inspectorSignature) { error("יש להחתים את הבודק על ביקורת הכניסה.", inspectorCanvas); return; }
    if (!/^[1-9][0-9]{6}$/.test(inspectorNumber.value.trim())) { error("יש למלא מספר אישי של הבודק: שבע ספרות, הראשונה אינה 0.", inspectorNumber); return; }
    saving = true; save.disabled = true; status.textContent = "שומר את ביקורת הכניסה בשרת…";
    try {
      await lock.renew();
      await addToolIntake(issue.id, user.uid, { tools, technicianSignature, inspectorSignature, inspectorNumber: inspectorNumber.value.trim() }, lock.session);
      await lock.release().catch(() => {});
      const queueStatus = document.querySelector("#refresh-tasks-status");
      queueStatus.textContent = `${tools.length} כלים נקלטו לתקלה ${issue.sheet.serial} לאחר ביקורת כניסה. יש לבצע שוב ביקורת יציאה לפני הגשת הדף.`;
      delete queueStatus.dataset.state;
      dialog.close();
    } catch (failure) { error(`הכלים לא נקלטו: ${failure.message}`); }
    finally { saving = false; save.disabled = !lock?.held; }
  });
  return (selectedIssue) => {
    if (!selectedIssue || dialog.open) return;
    issue = selectedIssue;
    rows = [{ toolName: "", toolNumber: "", notes: "" }]; clearError(); render();
    document.querySelector("#tool-intake-issue").textContent = `תקלה ${issue.sheet.serial} · מטוס ${issue.sheet.aircraft || "—"}`;
    save.disabled = true; retry.hidden = true; lockStatus.textContent = "בודק שהתקלה פנויה לעדכון…";
    dialog.showModal();
    if (!clearTechnician) clearTechnician = attachSignaturePad(technicianCanvas, { onChange: (value) => { technicianSignature = value; if (value) clearError(); } });
    if (!clearInspector) clearInspector = attachSignaturePad(inspectorCanvas, { onChange: (value) => { inspectorSignature = value; if (value) clearError(); } });
    lock = createEditLock({ kind: "issue", serialOrId: issue.sheet.serial, formId: issue.id, user: { uid: user.uid, name: user.name || "טכנאי" }, onChange: ({ held, message }) => {
      lockStatus.textContent = message || "התקלה פנויה לעדכון.";
      save.disabled = !held || saving; retry.hidden = held;
      if (!held && message) lockStatus.dataset.state = "error";
      else delete lockStatus.dataset.state;
    } });
    void lock.acquire();
  };
}
