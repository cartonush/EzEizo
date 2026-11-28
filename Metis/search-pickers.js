import { makeSquadronEmblem } from "../squadron-emblems.js?v=1.9.19";

export function enhanceSelectPicker(select, { emblem = false, label = "" } = {}) {
  if (!select || select.dataset.pickerEnhanced) return;
  select.dataset.pickerEnhanced = "true";
  select.style.display = "none";
  const root = document.createElement("div");
  root.className = "filter-search-picker";
  const preview = document.createElement("span");
  preview.className = "filter-picker-emblem";
  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-label", label || "חפש ובחר");
  input.placeholder = label || "חפש ובחר";
  const list = document.createElement("div");
  list.className = "filter-picker-options";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  root.append(preview, input, list);
  select.after(root);
  let active = 0;
  const options = () => [...select.options].filter((option) => !option.disabled);
  function sync() {
    const selected = options().find((option) => option.value === select.value);
    input.value = select.value ? selected?.textContent || "" : "";
    preview.replaceChildren();
    if (emblem && select.value) {
      const icon = makeSquadronEmblem(select.value);
      if (icon) preview.append(icon);
    }
    preview.hidden = !preview.children.length;
  }
  function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); }
  function choose(value) {
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    sync(); close();
  }
  function show() {
    const query = input.value.trim().toLocaleLowerCase("he");
    const matches = options().filter((option) => !option.value || option.textContent.toLocaleLowerCase("he").includes(query));
    list.replaceChildren();
    matches.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "filter-picker-option";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === select.value));
      if (emblem && option.value) {
        const icon = makeSquadronEmblem(option.value);
        if (icon) button.append(icon);
      }
      button.append(document.createTextNode(option.textContent));
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => choose(option.value));
      list.append(button);
    });
    active = 0;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  input.addEventListener("focus", show);
  input.addEventListener("input", show);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { close(); sync(); return; }
    if (event.key === "ArrowDown" && !list.hidden) { event.preventDefault(); active = Math.min(active + 1, list.children.length - 1); list.children[active]?.scrollIntoView({ block: "nearest" }); }
    if (event.key === "ArrowUp" && !list.hidden) { event.preventDefault(); active = Math.max(0, active - 1); list.children[active]?.scrollIntoView({ block: "nearest" }); }
    if (event.key === "Enter" && !list.hidden && list.children[active]) { event.preventDefault(); list.children[active].click(); }
  });
  input.addEventListener("blur", () => setTimeout(() => { if (!root.contains(document.activeElement)) { close(); sync(); } }, 150));
  select.addEventListener("change", sync);
  new MutationObserver(sync).observe(select, { childList: true, subtree: true });
  sync();
}

export function enhanceManagerPickers() {
  for (const id of ["fault-squadron", "history-squadron", "report-squadron", "constants-squadron", "key-squadron"]) enhanceSelectPicker(document.getElementById(id), { emblem: true, label: "חפש ובחר טייסת" });
  enhanceSelectPicker(document.getElementById("fault-technician"), { label: "חפש טכנאי לפי שם או מספר אישי" });
  enhanceSelectPicker(document.getElementById("fault-aircraft"), { label: "חפש ובחר מטוס" });
}
