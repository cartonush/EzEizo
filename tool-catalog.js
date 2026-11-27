export const DEFAULT_TOOLS = Object.freeze([
  { toolNumber: "F-20", toolName: "מ.כ 2020" },
  { toolNumber: "H-18", toolName: "חרב אש (F20)" },
  { toolNumber: "T-A", toolName: "ארגז בורסייד" }
]);
export let TOOL_CATALOG = [...DEFAULT_TOOLS];

export function updateToolCatalog(items) {
  TOOL_CATALOG = Array.isArray(items) ? items.map(({ toolNumber, toolName }) => ({ toolNumber, toolName })) : [...DEFAULT_TOOLS];
  const list = document.getElementById("tool-number-options");
  if (list) { list.remove(); toolNumberOptions(); }
}

export function catalogTool(number) {
  return TOOL_CATALOG.find((tool) => tool.toolNumber.toLocaleLowerCase() === String(number || "").trim().toLocaleLowerCase());
}

// The browser's native datalist supports filtering while typing and a keyboard
// selection on mobile. Only an exact catalog number is a locked catalog row.
export function toolNumberOptions() {
  let list = document.getElementById("tool-number-options");
  if (!list) {
    list = document.createElement("datalist"); list.id = "tool-number-options";
    for (const tool of TOOL_CATALOG) {
      const option = document.createElement("option");
      option.value = tool.toolNumber; option.label = `${tool.toolNumber} · ${tool.toolName}`;
      list.append(option);
    }
    document.body.append(list);
  }
  return list.id;
}
