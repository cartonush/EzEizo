const DRAFT_KEY = "ezeizo-metis-draft-v1";
const draft = loadDraft();
const result = document.querySelector("#link-result");
const draftStatus = document.querySelector("#draft-status");

function loadDraft() {
  try {
    return EzEizoData.normalizeSheet(JSON.parse(localStorage.getItem(DRAFT_KEY))) || EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  } catch {
    return EzEizoData.normalizeSheet(EzEizoData.defaultSheet);
  }
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  result.hidden = true;
  draftStatus.textContent = "הטיוטה נשמרה במכשיר הזה";
}

document.querySelectorAll("[data-sheet-field]").forEach((input) => {
  const key = input.dataset.sheetField;
  input.value = draft[key] || "";
  input.addEventListener("input", () => { draft[key] = input.value; saveDraft(); });
});

function renderConstants() {
  const container = document.querySelector("#manager-constants");
  container.replaceChildren();
  Object.entries(draft.constants).forEach(([groupName, entries]) => {
    const section = document.createElement("section");
    section.className = "constant-group";
    const heading = document.createElement("h3");
    heading.textContent = groupName;
    const grid = document.createElement("div");
    grid.className = "manager-constant-list";
    entries.forEach(([label, value], index) => {
      const field = document.createElement("label");
      field.className = "manager-constant-row";
      const name = document.createElement("span");
      name.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.value = value;
      input.setAttribute("aria-label", `${groupName} ${label}`);
      input.addEventListener("input", () => { draft.constants[groupName][index][1] = input.value; saveDraft(); });
      field.append(name, input);
      grid.append(field);
    });
    section.append(heading, grid);
    container.append(section);
  });
}

function renderActions() {
  const container = document.querySelector("#manager-actions");
  container.replaceChildren();
  draft.actions.forEach((label, index) => {
    const row = document.createElement("label");
    row.className = "manager-action-row";
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const input = document.createElement("input");
    input.type = "text";
    input.value = label;
    input.setAttribute("aria-label", `פעולה ${index + 1}`);
    input.addEventListener("input", () => { draft.actions[index] = input.value; saveDraft(); });
    row.append(number, input);
    container.append(row);
  });
}

document.querySelector("#create-link").addEventListener("click", () => {
  const sheet = EzEizoData.normalizeSheet(draft);
  sheet.id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const url = new URL("../mechanic/", window.location.href);
  url.hash = `sheet=${EzEizoData.encodeSheet(sheet)}`;
  document.querySelector("#share-link").value = url.href;
  document.querySelector("#open-link").href = url.href;
  document.querySelector("#copy-status").textContent = "";
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.querySelector("#copy-link").addEventListener("click", async () => {
  const field = document.querySelector("#share-link");
  try {
    await navigator.clipboard.writeText(field.value);
    document.querySelector("#copy-status").textContent = "הקישור הועתק";
  } catch {
    field.focus();
    field.select();
    document.querySelector("#copy-status").textContent = "אפשר להעתיק את הקישור המסומן";
  }
});

renderConstants();
renderActions();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
