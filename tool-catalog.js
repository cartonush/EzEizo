export const DEFAULT_TOOLS = Object.freeze([
  { toolNumber: "F-20", toolName: "מ.כ 2020" },
  { toolNumber: "H-18", toolName: "חרב אש (F20)" },
  { toolNumber: "T-A", toolName: "ארגז בורסייד" }
]);
export let TOOL_CATALOG = [...DEFAULT_TOOLS];

export function updateToolCatalog(items) {
  TOOL_CATALOG = Array.isArray(items) ? items.map(({ toolNumber, toolName }) => ({ toolNumber, toolName })) : [...DEFAULT_TOOLS];
}

export function catalogTool(number) {
  return TOOL_CATALOG.find((tool) => tool.toolNumber.toLocaleLowerCase() === String(number || "").trim().toLocaleLowerCase());
}

export function toolNumberRecorded(number, rows = [], index = -1, earlier = []) {
  const key = String(number || "").trim().toLocaleLowerCase();
  return Boolean(key) && (rows.some((row, rowIndex) => rowIndex !== index && String(row.toolNumber || "").trim().toLocaleLowerCase() === key)
    || earlier.some((row) => String(row.toolNumber || "").trim().toLocaleLowerCase() === key));
}

let pickerCount = 0;

export function attachToolPicker(input, { isUnavailable = () => false } = {}) {
  if (input.readOnly || input.disabled) return input;
  const picker = document.createElement("div");
  picker.className = "tool-picker";
  const results = document.createElement("div");
  results.className = "tool-picker-results";
  results.id = `tool-picker-results-${++pickerCount}`;
  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", "כלים במאגר");
  results.hidden = true;
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", results.id);
  input.setAttribute("aria-expanded", "false");
  const hide = () => { results.hidden = true; input.setAttribute("aria-expanded", "false"); };
  const show = () => {
    const query = input.value.trim().toLocaleLowerCase("he");
    const matches = TOOL_CATALOG.filter((tool) => `${tool.toolNumber} ${tool.toolName}`.toLocaleLowerCase("he").includes(query));
    const selected = catalogTool(input.value);
    const duplicate = selected && isUnavailable(selected.toolNumber);
    input.setCustomValidity(duplicate ? "כלי זה כבר תועד בטופס." : "");
    if (duplicate) { input.setAttribute("aria-invalid", "true"); input.dataset.toolDuplicate = "true"; }
    else if (input.dataset.toolDuplicate) { input.removeAttribute("aria-invalid"); delete input.dataset.toolDuplicate; }
    results.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement("span");
      empty.className = "tool-picker-empty";
      empty.textContent = "לא נמצאו כלים במאגר.";
      results.append(empty);
    }
    matches.forEach((tool) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "tool-picker-option";
      option.setAttribute("role", "option");
      option.disabled = isUnavailable(tool.toolNumber);
      option.textContent = `${tool.toolNumber} · ${tool.toolName}${option.disabled ? " · כבר תועד" : ""}`;
      option.addEventListener("click", () => {
        input.value = tool.toolNumber;
        hide();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      results.append(option);
    });
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("focus", show);
  input.addEventListener("input", () => { if (input.isConnected) show(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hide(); return; }
    if (event.key === "ArrowDown" && !results.hidden) { event.preventDefault(); results.querySelector("button")?.focus(); }
  });
  picker.addEventListener("focusout", () => { setTimeout(() => { if (!picker.contains(document.activeElement)) hide(); }, 150); });
  picker.append(input, results);
  return picker;
}
