import { watchSystems, watchComponents, saveSystem, saveComponent } from "../firebase-sync.js?v=1.9.0";
import { SYSTEMS, COMPONENTS_BY_SYSTEM } from "./catalog.js?v=1.9.0";

const defaultSystems = [
  { id: "system_fcr", name: "מכם | FCR", code: "74A", volume: "0235" },
  { id: "system_tcn", name: "טאקאן | TCN", code: "63A", volume: "" },
  { id: "system_ew", name: "אימפריה פאסיבית", code: "76E", volume: "" }
];
const defaultComponents = ["ANT", "DMT", "MLPRF", "PSP"].map((name) => ({ id: `component_${name.toLowerCase()}`, name, systemId: "system_fcr" }));
let savedSystems = [], savedComponents = [];
const byId = (defaults, saved) => [...new Map([...defaults, ...saved].map((item) => [item.id, item])).values()];
const systems = () => byId(defaultSystems, savedSystems);
const components = () => byId(defaultComponents, savedComponents);
const status = (selector, message, error = false) => { const el = document.querySelector(selector); el.textContent = message; if (error) el.dataset.state = "error"; else delete el.dataset.state; };

function syncCatalog() {
  SYSTEMS.splice(0, SYSTEMS.length, ...systems().map(({ name, code, volume }) => ({ name, code, volume })));
  for (const key of Object.keys(COMPONENTS_BY_SYSTEM)) delete COMPONENTS_BY_SYSTEM[key];
  for (const item of components()) {
    const system = systems().find(({ id }) => id === item.systemId);
    if (system) (COMPONENTS_BY_SYSTEM[system.name] ||= []).push(item.name);
  }
  for (const id of ["history-aircraft-system", "history-component-system"]) {
    const select = document.getElementById(id);
    if (!select?.options.length || select.options.length === 1) continue;
    const old = select.value;
    select.replaceChildren(new Option("בחר מערכת", ""), ...systems().map((item) => new Option(item.name, item.name)));
    select.value = old;
    select.dispatchEvent(new Event("change"));
  }
}

function field(value, label, maxLength = 80) {
  const input = document.createElement("input"); input.value = value || ""; input.maxLength = maxLength; input.setAttribute("aria-label", label); return input;
}

function renderSystems() {
  const body = document.querySelector("#systems-table"); body.replaceChildren();
  systems().forEach((item) => {
    const row = document.createElement("tr"), name = field(item.name, `שם מערכת ${item.name}`), code = field(item.code, `קוד מערכת ${item.name}`, 30), volume = field(item.volume, `כרך ${item.name}`, 30);
    for (const [label, input] of [["שם מערכת", name], ["קוד מערכת", code], ["כרך", volume]]) { const cell = document.createElement("td"); cell.dataset.label = label; cell.append(input); row.append(cell); }
    const action = document.createElement("td"); action.dataset.label = "פעולות";
    const button = document.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.textContent = "שמור";
    button.addEventListener("click", async () => { button.disabled = true; try { await saveSystem(item.id, name.value, code.value, volume.value); status("#system-status", `המערכת ${name.value} נשמרה.`); } catch (error) { status("#system-status", `שמירת המערכת נכשלה: ${error.message}`, true); } finally { button.disabled = false; } });
    action.append(button); row.append(action); body.append(row);
  });
  const select = document.querySelector('#component-form [name="systemId"]'), previous = select.value;
  select.replaceChildren(new Option("בחר מערכת", ""), ...systems().map((item) => new Option(item.name, item.id)));
  select.value = previous;
}

function renderComponents() {
  const body = document.querySelector("#components-table"); body.replaceChildren();
  components().forEach((item) => {
    const row = document.createElement("tr"), name = field(item.name, `שם מכלול ${item.name}`);
    const system = document.createElement("select"); system.setAttribute("aria-label", `מערכת למכלול ${item.name}`);
    systems().forEach((entry) => system.append(new Option(entry.name, entry.id))); system.value = item.systemId;
    for (const [label, input] of [["מכלול", name], ["מערכת", system]]) { const cell = document.createElement("td"); cell.dataset.label = label; cell.append(input); row.append(cell); }
    const action = document.createElement("td"); action.dataset.label = "פעולות";
    const button = document.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.textContent = "שמור";
    button.addEventListener("click", async () => { button.disabled = true; try { await saveComponent(item.id, name.value, system.value); status("#component-status", `המכלול ${name.value} נשמר.`); } catch (error) { status("#component-status", `שמירת המכלול נכשלה: ${error.message}`, true); } finally { button.disabled = false; } });
    action.append(button); row.append(action); body.append(row);
  });
}

export function initCatalogAdmin() {
  const render = () => { syncCatalog(); renderSystems(); renderComponents(); };
  render();
  watchSystems((items) => { savedSystems = items; render(); }, (error) => status("#system-status", `טעינת מערכות נכשלה: ${error.message}`, true));
  watchComponents((items) => { savedComponents = items; render(); }, (error) => status("#component-status", `טעינת מכלולים נכשלה: ${error.message}`, true));
  document.querySelector("#system-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector("button"); button.disabled = true;
    const name = form.elements.name.value.trim();
    if (systems().some((item) => item.name.toLocaleLowerCase("he") === name.toLocaleLowerCase("he"))) { status("#system-status", "המערכת כבר קיימת. ערוך אותה בטבלה.", true); button.disabled = false; return; }
    try { await saveSystem(`system_${crypto.randomUUID()}`, name, form.elements.code.value, form.elements.volume.value); form.reset(); status("#system-status", "המערכת נוספה."); }
    catch (error) { status("#system-status", `הוספת מערכת נכשלה: ${error.message}`, true); } finally { button.disabled = false; }
  });
  document.querySelector("#component-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector("button"); button.disabled = true;
    const name = form.elements.name.value.trim(), systemId = form.elements.systemId.value;
    if (components().some((item) => item.name.toLocaleLowerCase("he") === name.toLocaleLowerCase("he") && item.systemId === systemId)) { status("#component-status", "המכלול כבר קיים במערכת הזאת. ערוך אותו בטבלה.", true); button.disabled = false; return; }
    try { await saveComponent(`component_${crypto.randomUUID()}`, name, systemId); form.reset(); status("#component-status", "המכלול נוסף."); }
    catch (error) { status("#component-status", `הוספת מכלול נכשלה: ${error.message}`, true); } finally { button.disabled = false; }
  });
}
