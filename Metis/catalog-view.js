import { watchSystems, watchComponents } from "../firebase-sync.js?v=1.9.21";
import { VOLUMES, DEFAULT_SYSTEMS, DEFAULT_COMPONENTS, mergeCatalog, volumeLabel } from "./catalog-data.js?v=1.9.6";

function cell(row, content, span = 1) {
  const element = document.createElement("td");
  element.textContent = content;
  if (span > 1) element.rowSpan = span;
  row.append(element);
}
function row(body) { const element = document.createElement("tr"); body.append(element); return element; }

export function initCatalogView() {
  const view = document.querySelector("#catalog-view");
  if (!view) return;
  let savedSystems = [], savedComponents = [];
  const status = view.querySelector("[role=status]");
  function render() {
    const systems = mergeCatalog(DEFAULT_SYSTEMS, savedSystems);
    const components = mergeCatalog(DEFAULT_COMPONENTS, savedComponents);
    const volumesBody = view.querySelector("#catalog-volumes");
    const systemsBody = view.querySelector("#catalog-systems");
    const componentsBody = view.querySelector("#catalog-components");
    volumesBody.replaceChildren(); systemsBody.replaceChildren(); componentsBody.replaceChildren();
    for (const volume of VOLUMES) {
      const entries = systems.filter((system) => system.volume === volume.code);
      const summary = row(volumesBody);
      cell(summary, volumeLabel(volume.code));
      cell(summary, entries.map((system) => system.name).join(" · ") || "אין מערכות בכרך");
    }
    const volumes = [...VOLUMES.map((item) => item.code), ...new Set(systems.map((system) => system.volume).filter((code) => code && !VOLUMES.some((item) => item.code === code)))];
    for (const volume of volumes) {
      const entries = systems.filter((system) => system.volume === volume);
      entries.forEach((system, index) => {
        const line = row(systemsBody);
        if (index === 0) cell(line, volumeLabel(volume), entries.length);
        cell(line, system.name); cell(line, system.code);
      });
    }
    for (const system of systems) {
      const entries = components.filter((component) => component.systemId === system.id);
      if (!entries.length) continue;
      entries.forEach((component, index) => {
        const line = row(componentsBody);
        if (index === 0) cell(line, system.name, entries.length);
        cell(line, component.name);
      });
    }
  }
  render();
  watchSystems((items) => { savedSystems = items; status.textContent = ""; render(); }, (error) => { status.textContent = `טעינת המערכות נכשלה: ${error.message}`; });
  watchComponents((items) => { savedComponents = items; render(); }, (error) => { status.textContent = `טעינת המכלולים נכשלה: ${error.message}`; });
}
