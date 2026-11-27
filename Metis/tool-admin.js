import { watchToolCatalog, saveToolCatalog } from "../firebase-sync.js?v=1.9.23";
import { DEFAULT_TOOLS, updateToolCatalog } from "../tool-catalog.js?v=1.9.29";

export function initToolAdmin(user) {
  const form = document.querySelector("#tool-admin-form");
  const list = document.querySelector("#tool-admin-list");
  const status = document.querySelector("#tool-admin-status");
  let items = [...DEFAULT_TOOLS], ready = false, busy = false, available = true;
  function render() {
    list.replaceChildren();
    if (!ready) { list.textContent = "טוען את רשימת הכלים…"; return; }
    if (!items.length) { list.textContent = "אין כלים ברשימה."; return; }
    items.forEach((tool) => {
      const card = document.createElement("div"); card.className = "issue-item";
      const text = document.createElement("strong"); text.textContent = `${tool.toolNumber} · ${tool.toolName}`;
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button"; remove.textContent = "מחק כלי";
      remove.setAttribute("aria-label", `מחק כלי ${tool.toolNumber}`);
      remove.disabled = !available;
      remove.addEventListener("click", async () => {
        if (busy || !window.confirm(`האם את/ה בטוח/ה שברצונך למחוק את הכלי ${tool.toolNumber} – ${tool.toolName}?`)) return;
        busy = true; remove.disabled = true;
        try { await saveToolCatalog(items.filter((item) => item.toolNumber !== tool.toolNumber), user.uid); status.textContent = `הכלי ${tool.toolNumber} נמחק מהרשימה.`; }
        catch (error) { status.textContent = `המחיקה נכשלה: ${error.message}`; remove.disabled = false; }
        finally { busy = false; }
      });
      card.append(text, remove); list.append(card);
    });
  }
  render();
  watchToolCatalog((saved) => {
    items = saved === null ? [...DEFAULT_TOOLS] : saved;
    ready = true; available = true;
    form.querySelector('button[type="submit"]').disabled = false;
    updateToolCatalog(saved); render();
    status.textContent = "";
  }, (error) => {
    items = [...DEFAULT_TOOLS]; ready = true; available = false;
    form.querySelector('button[type="submit"]').disabled = true;
    render();
    status.textContent = `אין גישה לניהול הכלים כרגע (${error.message}). מוצגת הרשימה הראשונית לצפייה בלבד. נסו לרענן לאחר עדכון ההרשאות.`;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (!ready || busy || !available) return;
    const number = form.elements.toolNumber.value.trim(), name = form.elements.toolName.value.trim();
    if (items.some((item) => item.toolNumber.toLocaleLowerCase() === number.toLocaleLowerCase())) { status.textContent = "מספר הכלי כבר קיים ברשימה."; return; }
    busy = true; const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try { await saveToolCatalog([...items, { toolNumber: number, toolName: name }], user.uid); form.reset(); status.textContent = `הכלי ${number} נוסף לרשימה.`; }
    catch (error) { status.textContent = `ההוספה נכשלה: ${error.message}`; }
    finally { busy = false; button.disabled = false; }
  });
}
