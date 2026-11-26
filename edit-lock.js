import { acquireEditLock, releaseEditLock, releaseMyEditLock, watchEditLock } from "./firebase-sync.js?v=1.9.21";

// The lease expires after a crashed window. A live editor renews it regularly.
export function createEditLock({ kind, serialOrId, formId, user, onChange, manager = false }) {
  const sessionKey = `ezeizo-edit-session:${user.uid}:${kind}:${serialOrId}`;
  let session;
  try { session = sessionStorage.getItem(sessionKey); } catch { /* Private storage can be unavailable. */ }
  if (!session) {
    session = crypto.randomUUID();
    try { sessionStorage.setItem(sessionKey, session); } catch { /* The current tab can still use its in-memory lease. */ }
  }
  let held = false, disposed = false, acquiring = false;
  let currentLock = null;
  const emit = (message) => { if (!disposed) onChange({ held, message, ownedByMe: !held && currentLock?.ownerUid === user.uid && currentLock?.session !== session }); };
  const unsubscribe = watchEditLock(kind, serialOrId, (lock) => {
    currentLock = lock;
    if (lock?.session === session && lock.ownerUid === user.uid && lock.formId === formId && lock.expiresAt.toMillis() > Date.now()) {
      if (!held) { held = true; emit(""); }
      return;
    }
    if (held && (!lock || lock.session !== session || lock.expiresAt.toMillis() <= Date.now())) {
      held = false;
      emit(lock?.ownerName ? `הטופס ננעל לעריכה על ידי ${lock.ownerName}.` : "נעילת העריכה פגה. לחץ כדי לנסות שוב.");
    } else if (!held && !acquiring && lock?.expiresAt.toMillis() > Date.now()) {
      emit(`הטופס נמצא כעת בעריכה של ${lock.ownerName}. אפשר לנסות שוב לאחר שיסיים.`);
    }
  }, (error) => { held = false; if (error.code === "unavailable") document.dispatchEvent(new Event("ezeizo:connection-lost")); emit(`לא ניתן לבדוק את נעילת העריכה: ${error.message}`); });
  const timer = setInterval(async () => {
    if (!held || disposed) return;
    try {
      const result = await acquireEditLock(kind, serialOrId, formId, user, session, manager);
      if (!result.held) { held = false; emit(`הטופס נמצא כעת בעריכה של ${result.ownerName}.`); }
    } catch (error) { held = false; if (error.code === "unavailable") document.dispatchEvent(new Event("ezeizo:connection-lost")); emit(`לא ניתן להמשיך לערוך: ${error.message}. בדוק את החיבור ונסה שוב.`); }
  }, 25000);
  async function acquire() {
    if (disposed || acquiring) return;
    acquiring = true;
    emit("בודק אם הטופס פנוי לעריכה…");
    try {
      const result = await acquireEditLock(kind, serialOrId, formId, user, session, manager);
      if (disposed) { if (result.held) await releaseEditLock(kind, serialOrId, session).catch(() => {}); return; }
      held = result.held;
      if (!result.held) currentLock = { ownerName: result.ownerName, ownerUid: result.ownerUid, session: result.session };
      emit(result.held ? "" : `הטופס נמצא כעת בעריכה של ${result.ownerName}. אפשר לנסות שוב לאחר שיסיים.`);
    } catch (error) {
      held = false;
      if (error.code === "unavailable") document.dispatchEvent(new Event("ezeizo:connection-lost"));
      emit(error.code === "permission-denied" ? "לא ניתן לנעול את הטופס. יש לפרסם את כללי Firestore המעודכנים." : `אבדה התקשורת עם השרת או שנעילת העריכה נכשלה: ${error.message}. נסה להפעיל מחדש את האפליקציה או את המכשיר.`);
    } finally { acquiring = false; }
  }
  async function renew() {
    if (!held || disposed) throw new Error("נעילת העריכה אינה פעילה. לחץ על בדוק שוב.");
    const result = await acquireEditLock(kind, serialOrId, formId, user, session, manager);
    if (!result.held) { held = false; emit(`הטופס נמצא כעת בעריכה של ${result.ownerName}.`); throw new Error("נעילת העריכה הועברה לעורך אחר."); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; clearInterval(timer); unsubscribe();
    if (held) void releaseEditLock(kind, serialOrId, session).catch(() => {});
    held = false;
  }
  async function release() {
    if (!held || disposed) return;
    held = false;
    await releaseEditLock(kind, serialOrId, session);
    emit("הטופס נשמר והנעילה שוחררה.");
  }
  async function releaseMine() {
    if (held || disposed || currentLock?.ownerUid !== user.uid) return;
    await releaseMyEditLock(kind, serialOrId, formId, user.uid);
    currentLock = null;
    await acquire();
  }
  return { acquire, renew, dispose, release, releaseMine, get held() { return held; }, session };
}
