import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAuth, onAuthStateChanged, getIdTokenResult, signInWithEmailAndPassword, createUserWithEmailAndPassword, setPersistence, inMemoryPersistence, deleteUser, signOut } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocsFromServer, setDoc, updateDoc, onSnapshot, query, where, runTransaction, Timestamp, deleteField } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDOFQALbwB8LTkdV3MSLE2BV7y6L0Tj1_g",
  authDomain: "ezeizo.firebaseapp.com",
  projectId: "ezeizo",
  storageBucket: "ezeizo.firebasestorage.app",
  messagingSenderId: "773744111322",
  appId: "1:773744111322:web:978661ed4127c4c91a7fe3"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const counterRef = doc(db, "metadata", "serial");
const keyCounterRef = doc(db, "metadata", "keySerial");
const leaseMillis = 90000;
const editLockRef = (kind, serialOrId) => doc(db, "editLocks", `${kind}_${serialOrId}`);

// A short renewable lease survives a crashed tab without blocking the form forever.
export function watchEditLock(kind, serialOrId, onChange, onError) {
  return onSnapshot(editLockRef(kind, serialOrId), (snapshot) => onChange(snapshot.exists() ? snapshot.data() : null), onError);
}

export async function acquireEditLock(kind, serialOrId, formId, user, session, manager = false) {
  const ref = editLockRef(kind, serialOrId);
  return runTransaction(db, async (transaction) => {
    const [current, form] = await Promise.all([transaction.get(ref), transaction.get(doc(db, kind === "key" ? "keyLoads" : "issues", formId))]);
    if (!form.exists() || form.data().status !== "open") throw new Error("הטופס אינו פתוח לעריכה.");
    if (!manager && (kind === "key" ? !form.data().teamUids.includes(user.uid) : !(form.data().teamUids || [form.data().assigneeUid]).includes(user.uid) || form.data().sheet.serial !== serialOrId)) throw new Error("אינך משויך לטופס הזה.");
    if (manager && kind !== "issue") throw new Error("עריכת מנהל נתמכת כרגע רק בתקלה.");
    const lock = current.data(), now = Date.now();
    if (lock && lock.expiresAt.toMillis() > now && lock.session !== session) return { held: false, ownerName: lock.ownerName, expiresAt: lock.expiresAt.toMillis() };
    transaction.set(ref, { kind, formId, serial: serialOrId, ownerUid: user.uid, ownerName: user.name || user.email || "טכנאי", session, expiresAt: Timestamp.fromMillis(now + leaseMillis) });
    return { held: true };
  });
}

export async function releaseEditLock(kind, serialOrId, session) {
  const ref = editLockRef(kind, serialOrId);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (current.exists() && current.data().session === session) transaction.delete(ref);
  });
}

async function requireEditLock(transaction, kind, serialOrId, session, uid) {
  const current = await transaction.get(editLockRef(kind, serialOrId));
  if (!current.exists() || current.data().session !== session || current.data().ownerUid !== uid || current.data().expiresAt.toMillis() <= Date.now()) throw new Error("נעילת העריכה אבדה. פתח את הטופס מחדש ונסה שוב.");
}

// Firestore cannot store an array inside another array. Keep the UI's [label, value]
// pairs and store each group as a map of scalar values instead.
function storedSheet(sheet) {
  return {
    ...sheet,
    constants: Object.fromEntries(Object.entries(sheet.constants || {}).map(([group, entries]) => [group, Object.fromEntries(entries)]))
  };
}

function restoredSheet(sheet) {
  if (!sheet) return sheet;
  return {
    ...sheet,
    constants: Object.fromEntries(Object.entries(sheet.constants || {}).map(([group, entries]) => [group, Array.isArray(entries) ? entries : Object.entries(entries)]))
  };
}

export function gate(role) {
  const main = document.querySelector("main");
  if (!document.querySelector("#server-connection-warning")) {
    const warning = document.createElement("div");
    warning.id = "server-connection-warning";
    warning.className = "server-connection-warning";
    warning.setAttribute("role", "alert");
    warning.textContent = "אבדה התקשורת עם השרת. נסה להפעיל מחדש את האפליקציה או את המכשיר.";
    warning.hidden = navigator.onLine;
    document.body.prepend(warning);
    window.addEventListener("offline", () => { warning.hidden = false; });
    window.addEventListener("online", () => { warning.hidden = true; });
    document.addEventListener("ezeizo:connection-lost", () => { warning.hidden = false; });
  }
  main.hidden = true;
  const panel = document.createElement("section");
  panel.className = "card auth-card";
  panel.hidden = true;
  panel.innerHTML = '<h2>כניסה למערכת</h2><p>התחבר לחשבון שלך.</p><form><label class="input-field">דואר אלקטרוני<input type="email" required autocomplete="username"></label><label class="input-field">סיסמה<input type="password" required autocomplete="current-password"></label><button class="primary-button" type="submit">התחבר</button></form><p class="copy-status" role="status" aria-live="polite">בודק התחברות…</p>';
  main.before(panel);
  const status = panel.querySelector('[role="status"]');
  const help = document.createElement("div");
  help.className = "auth-help";
  help.hidden = true;
  panel.append(help);
  function showSetup(user, reason) {
    document.querySelector("#app-skeleton")?.remove();
    status.textContent = reason;
    status.dataset.state = "error";
    help.replaceChildren();
    if (reason === "המשתמש אינו מורשה גישה.") { help.hidden = true; return; }
    if (role === "manager" && reason !== "המשתמש אינו מורשה גישה.") {
      const instructions = document.createElement("p");
      instructions.textContent = "ההזדהות ב־Firebase הצליחה. ודא שקיים מסמך הרשאת מנהל פעיל ב־Firestore עבור ה־UID הזה, פרסם את הכללים המעודכנים ולחץ ״בדוק שוב״. ה־UID שלך:";
      const uid = document.createElement("code"); uid.textContent = user.uid;
      const copy = document.createElement("button"); copy.type = "button"; copy.className = "secondary-button"; copy.textContent = "העתק UID";
      copy.addEventListener("click", async () => { await navigator.clipboard.writeText(user.uid); copy.textContent = "הועתק"; });
      const rules = document.createElement("a"); rules.href = "https://github.com/cartonush/EzEizo/blob/main/firestore.rules"; rules.target = "_blank"; rules.rel = "noopener"; rules.textContent = "הכללים להדבקה";
      const consoleLink = document.createElement("a"); consoleLink.href = "https://console.firebase.google.com/project/ezeizo/firestore/rules"; consoleLink.target = "_blank"; consoleLink.rel = "noopener"; consoleLink.textContent = "פתח את Rules ב־Firebase";
      help.append(instructions, uid, copy, rules, document.createTextNode(" · "), consoleLink);
    }
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "primary-button"; retry.textContent = "בדוק שוב";
    retry.addEventListener("click", () => location.reload());
    help.append(retry);
    help.hidden = false;
  }
  function requireNewPassword(user) {
    document.querySelector("#app-skeleton")?.remove();
    panel.hidden = false; help.hidden = true;
    const loginForm = panel.querySelector("form"); loginForm.hidden = true;
    panel.querySelector("h2").textContent = "בחירת סיסמה חדשה";
    status.textContent = "נכנסת עם סיסמה זמנית. בחר סיסמה חדשה בת 8 ספרות.";
    delete status.dataset.state;
    let form = panel.querySelector("#password-change-form");
    if (!form) {
      form = document.createElement("form"); form.id = "password-change-form";
      form.innerHTML = '<label class="input-field">סיסמה חדשה<input name="password" type="password" inputmode="numeric" pattern="[0-9]{8}" minlength="8" maxlength="8" required autocomplete="new-password"></label><label class="input-field">אימות סיסמה<input name="confirm" type="password" inputmode="numeric" pattern="[0-9]{8}" minlength="8" maxlength="8" required autocomplete="new-password"></label><button class="primary-button" type="submit">שמור סיסמה חדשה</button><button class="secondary-button" type="button" id="password-change-logout">החלף משתמש</button>';
      form.querySelector("#password-change-logout").addEventListener("click", () => signOut(auth));
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const password = form.elements.password.value;
        if (!/^[0-9]{8}$/.test(password) || password !== form.elements.confirm.value) { status.textContent = "הסיסמאות צריכות להיות זהות ולהכיל בדיוק 8 ספרות."; status.dataset.state = "error"; return; }
        form.querySelector("button").disabled = true;
        try { await completeTemporaryPassword(password); status.textContent = "הסיסמה הוחלפה. טוען את המערכת…"; location.reload(); }
        catch (error) { status.textContent = `לא ניתן לשנות סיסמה: ${error.message}`; status.dataset.state = "error"; form.querySelector("button").disabled = false; }
      });
      panel.append(form);
    }
  }
  panel.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    help.hidden = true;
    status.textContent = "מתחבר…";
    delete status.dataset.state;
    try {
      await signInWithEmailAndPassword(auth, panel.querySelector('[type="email"]').value.trim(), panel.querySelector('[type="password"]').value);
      if (status.textContent === "מתחבר…") status.textContent = "ההזדהות הצליחה. בודק הרשאות Firestore…";
    } catch (error) {
      status.textContent = error.code === "auth/invalid-credential" ? "הפרטים אינם נכונים." : `ההתחברות נכשלה: ${error.code || error.message}`;
      status.dataset.state = "error";
    }
  });
  return new Promise((resolve) => {
    let active = false;
    let resetSessionPending = false;
    onAuthStateChanged(auth, async (user) => {
      if (!user) { if (active) location.reload(); document.querySelector("#app-skeleton")?.remove(); panel.hidden = false; help.hidden = true; panel.querySelector("h2").textContent = "כניסה למערכת"; panel.querySelector("form").hidden = false; panel.querySelector("#password-change-form")?.setAttribute("hidden", ""); status.textContent = resetSessionPending ? "הסיסמה אופסה. התחבר עם הסיסמה הזמנית שקיבלת מהמנהל." : "יש להתחבר כדי לראות תקלות."; resetSessionPending = false; delete status.dataset.state; return; }
      status.textContent = "ההזדהות הצליחה. בודק הרשאות Firestore…";
      delete status.dataset.state;
      try {
        const roleRef = doc(db, "roles", user.uid);
        const roleDoc = await Promise.race([
          getDoc(roleRef),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000))
        ]);
        if (roleDoc.data()?.role !== role || roleDoc.data()?.active === false) {
          panel.hidden = false;
          showSetup(user, "המשתמש אינו מורשה גישה.");
          return;
        }
        if (roleDoc.data()?.passwordResetRequired === true) {
          const token = await getIdTokenResult(user);
          if (Math.floor(new Date(token.authTime).getTime() / 1000) < Math.ceil(new Date(roleDoc.data().passwordResetAt).getTime() / 1000)) { resetSessionPending = true; await signOut(auth); return; }
          requireNewPassword(user); return;
        }
        if (active) return;
        active = true;
        panel.remove();
        const logout = document.createElement("button");
        logout.type = "button"; logout.className = "secondary-button auth-logout"; logout.textContent = "התנתק";
        logout.addEventListener("click", () => signOut(auth));
        const headerActions = document.querySelector(".header-actions");
        if (headerActions) headerActions.append(logout);
        else document.querySelector(".topbar").append(logout);
        onSnapshot(doc(db, "roles", user.uid), (snapshot) => {
          if (!snapshot.exists() || snapshot.data().active === false || snapshot.data().role !== role || snapshot.data().passwordResetRequired === true) location.reload();
        }, () => { main.hidden = true; location.reload(); });
        resolve(user);
      } catch (error) {
        panel.hidden = false;
        showSetup(user, error.code === "permission-denied" ? "הסיסמה נכונה, אבל כללי Firestore עדיין חוסמים את בדיקת ההרשאה." : error.message === "timeout" ? "ההזדהות הצליחה, אך בדיקת ההרשאה מתעכבת. בדוק חיבור אינטרנט או נסה שוב." : `לא ניתן לבדוק הרשאה: ${error.message}`);
      }
    }, (error) => { document.querySelector("#app-skeleton")?.remove(); panel.hidden = false; status.textContent = `שגיאת התחברות: ${error.message}`; });
  });
}

export function revealApp() {
  document.querySelector("#app-skeleton")?.remove();
  document.querySelector("main").hidden = false;
}

export function watchIssues(onChange, onError, technicianUid = null) {
  const source = collection(db, "issues");
  const mapDocs = (snapshot) => snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data(), sheet: restoredSheet(entry.data().sheet) }));
  if (!technicianUid) return onSnapshot(source, (snapshot) => onChange(mapDocs(snapshot)), onError);
  const snapshots = [null, null];
  const errors = [null, null];
  const merge = () => onChange([...new Map(snapshots.flatMap((items) => items || []).map((item) => [item.id, item])).values()], errors.filter(Boolean).map((error) => error.message).join(" · "));
  const unsubs = [query(source, where("assigneeUid", "==", technicianUid)), query(source, where("teamUids", "array-contains", technicianUid))]
    .map((queryRef, index) => onSnapshot(queryRef, (snapshot) => { snapshots[index] = mapDocs(snapshot); errors[index] = null; merge(); }, (error) => { errors[index] = error; merge(); onError?.(error); }));
  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}

export async function refreshTechnicianTasks(uid) {
  const issues = collection(db, "issues");
  const [assigned, team, keys] = await Promise.all([
    getDocsFromServer(query(issues, where("assigneeUid", "==", uid))),
    getDocsFromServer(query(issues, where("teamUids", "array-contains", uid))),
    getDocsFromServer(query(collection(db, "keyLoads"), where("teamUids", "array-contains", uid)))
  ]);
  const faultItems = [...new Map([...assigned.docs, ...team.docs].map((entry) => [entry.id, { id: entry.id, ...entry.data(), sheet: restoredSheet(entry.data().sheet) }])).values()];
  return { issues: faultItems, keyLoads: keys.docs.map((entry) => ({ id: entry.id, ...entry.data() })) };
}

export function watchAircraftConstants(onChange, onError) {
  return onSnapshot(collection(db, "aircraftConstants"), (snapshot) => {
    onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
  }, onError);
}

export async function saveAircraftConstants(squadron, aircraft, constants, managerUid) {
  await setDoc(doc(db, "aircraftConstants", `${squadron}_${aircraft}`), {
    squadron, aircraft, constants, updatedAt: new Date().toISOString(), updatedBy: managerUid
  });
}

export async function getIssue(id) {
  const snapshot = await getDoc(doc(db, "issues", id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data(), sheet: restoredSheet(snapshot.data().sheet) } : null;
}

export async function createIssue(sheet, assignee, preserveSerial = false) {
  const issueRef = doc(db, "issues", sheet.id);
  return runTransaction(db, async (transaction) => {
    const [existing, counter] = await Promise.all([transaction.get(issueRef), transaction.get(counterRef)]);
    if (existing.exists()) return existing.data().sheet.serial;
    const last = Number(counter.data()?.last) || 0;
    const candidate = preserveSerial ? Number(sheet.serial) : 0;
    const next = candidate > last && candidate <= 9999999999 ? candidate : last + 1;
    if (next > 9999999999) throw new Error("מספרי התקלות אזלו.");
    const serial = String(next).padStart(10, "0");
    transaction.set(counterRef, { last: next });
    transaction.set(issueRef, { sheet: storedSheet({ ...sheet, serial }), status: "open", assigneeUid: assignee.uid, assigneeName: assignee.name, createdAt: new Date().toISOString() });
    return serial;
  });
}

// One serial and one document represent the team's shared form.
export async function createAssignedIssues(sheet, assignees) {
  if (assignees.length < 2 || new Set(assignees.map(({ uid }) => uid)).size !== assignees.length) throw new Error("יש לבחור לפחות שני טכנאים, ללא כפילויות.");
  const ref = doc(collection(db, "issues"));
  return runTransaction(db, async (transaction) => {
    const counter = await transaction.get(counterRef);
    const next = (Number(counter.data()?.last) || 0) + 1;
    if (next > 9999999999) throw new Error("מספרי התקלות אזלו.");
    const serial = String(next).padStart(10, "0");
    transaction.set(counterRef, { last: next });
    transaction.set(ref, {
      sheet: storedSheet({ ...sheet, id: ref.id, serial, technicians: assignees.map(({ name }) => name).join(" · ") }),
      status: "open", assigneeUid: assignees[0].uid, assigneeName: assignees[0].name,
      teamUids: assignees.map(({ uid }) => uid), teamNames: assignees.map(({ name }) => name), createdAt: new Date().toISOString()
    });
    return serial;
  });
}

export function watchTechnicians(onChange, onError) {
  return onSnapshot(collection(db, "roles"), (snapshot) => {
    onChange(snapshot.docs.filter((entry) => entry.data().role === "technician").map((entry) => ({ uid: entry.id, ...entry.data() })));
  }, onError);
}
export function watchAccounts(onChange, onError) {
  return onSnapshot(collection(db, "roles"), (snapshot) => onChange(snapshot.docs.filter((entry) => ["technician", "manager"].includes(entry.data().role)).map((entry) => ({ uid: entry.id, ...entry.data() }))), onError);
}

export async function setAttendanceStatus(uid, status) {
  await updateDoc(doc(db, "roles", uid), { attendanceStatus: status });
}

export function watchDutyAssignments(week, onChange, onError) {
  return onSnapshot(query(collection(db, "dutyAssignments"), where("week", "==", week)),
    (snapshot) => onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))), onError);
}

export async function saveDutyAssignment(week, day, role, assignees) {
  await setDoc(doc(db, "dutyAssignments", `${week}_${day}_${role}`),
    { week, day, role, assignees, updatedAt: new Date().toISOString() });
}
export function watchSystems(onChange, onError) {
  return onSnapshot(collection(db, "systemCatalog"), (snapshot) => onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))), onError);
}
export function watchComponents(onChange, onError) {
  return onSnapshot(collection(db, "componentCatalog"), (snapshot) => onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))), onError);
}
export async function saveSystem(id, name, code, volume) {
  if (!name.trim() || !code.trim()) throw new Error("שם וקוד מערכת הם שדות חובה.");
  await setDoc(doc(db, "systemCatalog", id), { name: name.trim(), code: code.trim(), volume: volume.trim(), updatedAt: new Date().toISOString() });
}
export async function saveComponent(id, name, systemId) {
  if (!name.trim() || !systemId) throw new Error("בחר מכלול ומערכת.");
  await setDoc(doc(db, "componentCatalog", id), { name: name.trim(), systemId, updatedAt: new Date().toISOString() });
}

export function watchKeyLoads(onChange, onError, technicianUid = null) {
  const source = technicianUid ? query(collection(db, "keyLoads"), where("teamUids", "array-contains", technicianUid)) : collection(db, "keyLoads");
  return onSnapshot(source, (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), onError);
}

export function watchKeyHistory(onChange, onError) {
  return onSnapshot(collection(db, "keyHistory"), (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), onError);
}

export async function createKeyLoad(load) {
  const ref = doc(collection(db, "keyLoads"));
  return runTransaction(db, async (transaction) => {
    const counter = await transaction.get(keyCounterRef);
    const next = (Number(counter.data()?.last) || 0) + 1;
    if (next > 999999999) throw new Error("מספרי ההטענות אזלו.");
    const serial = `K-${String(next).padStart(9, "0")}`;
    transaction.set(keyCounterRef, { last: next });
    transaction.set(ref, { ...load, serial, status: "open", createdAt: new Date().toISOString() });
    return { id: ref.id, serial };
  });
}

// Assign a stable number to older key loads while keeping their document IDs and links.
export async function assignLegacyKeyLoadSerial(id) {
  const ref = doc(db, "keyLoads", id);
  return runTransaction(db, async (transaction) => {
    const [existing, counter] = await Promise.all([transaction.get(ref), transaction.get(keyCounterRef)]);
    if (!existing.exists()) return null;
    if (existing.data().serial) return existing.data().serial;
    const next = (Number(counter.data()?.last) || 0) + 1;
    if (next > 999999999) throw new Error("מספרי ההטענות אזלו.");
    const serial = `K-${String(next).padStart(9, "0")}`;
    transaction.set(keyCounterRef, { last: next });
    transaction.update(ref, { serial });
    return serial;
  });
}

export async function closeKeyLoad(id, completedBy, work, session) {
  const ref = doc(db, "keyLoads", id);
  await runTransaction(db, async (transaction) => {
    await requireEditLock(transaction, "key", id, session, completedBy);
    const current = await transaction.get(ref);
    if (!current.exists() || current.data().status !== "open") throw new Error("ההטענה כבר נסגרה או אינה קיימת.");
    const load = current.data();
    if (!load.teamUids.includes(completedBy)) throw new Error("אינך משויך לצוות ההטענה.");
    const completedAt = new Date().toISOString();
    transaction.update(ref, { status: "pendingReview", work, completedAt, completedBy, workDraft: deleteField() });
  });
}

export async function approveKeyLoad(id, managerUid, signature, managerReview) {
  const ref = doc(db, "keyLoads", id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists() || current.data().status !== "pendingReview") throw new Error("ההטענה אינה ממתינה עוד לבדיקת מנהל.");
    if (!signature.startsWith("data:image/png;base64,")) throw new Error("יש לחתום לפני סגירת ההטענה.");
    transaction.update(ref, { status: "closed", reviewedAt: new Date().toISOString(), reviewedBy: managerUid, reviewerSignature: signature, managerReview });
  });
}

export async function saveKeyManagerReview(id, managerUid, managerReview) {
  const ref = doc(db, "keyLoads", id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists() || !["pendingReview", "closed"].includes(current.data().status)) throw new Error("ההטענה אינה ממתינה לבקרה או סגורה.");
    transaction.update(ref, { managerReview, reviewUpdatedAt: new Date().toISOString(), reviewUpdatedBy: managerUid });
  });
}

export async function saveKeyWorkDraft(id, uid, work, session) {
  const ref = doc(db, "keyLoads", id);
  await runTransaction(db, async (transaction) => {
    await requireEditLock(transaction, "key", id, session, uid);
    const current = await transaction.get(ref);
    if (!current.exists() || current.data().status !== "open" || !current.data().teamUids.includes(uid)) throw new Error("ההטענה אינה פתוחה עוד לעריכה.");
    transaction.update(ref, { workDraft: work, draftBy: uid });
  });
}

export async function appendKeyLoadManagerNote(id, note) {
  const text = note.trim();
  if (!text || text.length > 500) throw new Error("יש להזין הערה של עד 500 תווים.");
  const ref = doc(db, "keyLoads", id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().status !== "open") throw new Error("אפשר להוסיף הערות רק להטענה פתוחה.");
    const previous = snapshot.data().managerNotes || "";
    const next = [previous, text].filter(Boolean).join("\n");
    if (next.length > 2000) throw new Error("הגעת למגבלת ההערות בהטענה זו.");
    transaction.update(ref, { managerNotes: next });
  });
}

export async function reopenKeyLoad(id, managerUid) {
  const ref = doc(db, "keyLoads", id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || !["closed", "pendingReview"].includes(snapshot.data().status)) throw new Error("ההטענה כבר פתוחה או אינה קיימת.");
    const load = snapshot.data();
    const reopenedAt = new Date().toISOString();
    transaction.update(ref, {
      status: "open", reopenedAt, reopenedBy: managerUid,
      reopenEvents: [...(load.reopenEvents || []), { at: reopenedAt, by: managerUid, priorCompletedAt: load.completedAt }]
    });
  });
}

export async function createTechnician(name, email, password, personalNumber, profile = {}) {
  if (!/^\d{7}$/.test(personalNumber)) throw new Error("מספר אישי חייב להכיל שבע ספרות.");
  if (!/^[0-9]{8}$/.test(password)) throw new Error("הסיסמה חייבת להכיל בדיוק 8 ספרות.");
  const secondary = initializeApp(firebaseConfig, `provision-${crypto.randomUUID()}`);
  const provisioningAuth = getAuth(secondary);
  let createdUser = null;
  try {
    await setPersistence(provisioningAuth, inMemoryPersistence);
    const credential = await createUserWithEmailAndPassword(provisioningAuth, email.trim(), password);
    createdUser = credential.user;
    await runTransaction(db, async (transaction) => {
      const numberRef = doc(db, "personalNumbers", personalNumber);
      if ((await transaction.get(numberRef)).exists()) throw new Error("המספר האישי כבר משויך למשתמש אחר.");
      transaction.set(doc(db, "roles", createdUser.uid), { role: "technician", name: name.trim(), email: email.trim(), personalNumber, firstName: profile.firstName || "", lastName: profile.lastName || "", workStage: profile.workStage || "", department: profile.department || "", serviceType: profile.serviceType || "", rank: profile.rank || "", license: profile.license || "אין", active: true, createdAt: new Date().toISOString() });
      transaction.set(numberRef, { uid: createdUser.uid });
    });
    return createdUser.uid;
  } catch (error) {
    if (createdUser) await deleteUser(createdUser).catch(() => {});
    throw error;
  } finally {
    await signOut(provisioningAuth).catch(() => {});
    await deleteApp(secondary);
  }
}

export async function setTechnicianPersonalNumber(uid, personalNumber) {
  if (!/^\d{7}$/.test(personalNumber)) throw new Error("מספר אישי חייב להכיל שבע ספרות.");
  await runTransaction(db, async (transaction) => {
    const roleRef = doc(db, "roles", uid), numberRef = doc(db, "personalNumbers", personalNumber);
    const [role, number] = await Promise.all([transaction.get(roleRef), transaction.get(numberRef)]);
    if (!role.exists() || !["technician", "manager"].includes(role.data().role)) throw new Error("המשתמש אינו קיים.");
    if (role.data().personalNumber && role.data().personalNumber !== personalNumber) throw new Error("מספר אישי שכבר נקבע אינו ניתן לשינוי.");
    if (number.exists() && number.data().uid !== uid) throw new Error("המספר האישי כבר משויך למשתמש אחר.");
    if (role.data().personalNumber === personalNumber) return;
    transaction.update(roleRef, { personalNumber });
    if (!number.exists()) transaction.set(numberRef, { uid });
  });
}

export async function updateAccountProfile(uid, profile) {
  const fields = ["firstName", "lastName", "workStage", "department", "serviceType", "rank", "license"];
  const changes = Object.fromEntries(fields.map((key) => [key, String(profile[key] || "").trim().slice(0, 80)]));
  if (!changes.firstName || !changes.lastName) throw new Error("יש להזין שם ושם משפחה.");
  await updateDoc(doc(db, "roles", uid), { ...changes, name: `${changes.firstName} ${changes.lastName}` });
}

export async function updateOpenIssueDefinition(id, sheet, team, session) {
  if (team.length < 2 || new Set(team.map((person) => person.uid)).size !== team.length) throw new Error("בחר לפחות שני טכנאים שונים.");
  const ref = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists() || current.data().status !== "open") throw new Error("התקלה כבר אינה פתוחה לעריכה.");
    const issue = current.data();
    const lock = await transaction.get(editLockRef("issue", issue.sheet.serial));
    if (!lock.exists() || lock.data().ownerUid !== auth.currentUser?.uid || lock.data().session !== session || lock.data().expiresAt.toMillis() <= Date.now()) throw new Error("נעילת המנהל אבדה. פתח את העריכה מחדש.");
    transaction.update(ref, {
      sheet: storedSheet({ ...restoredSheet(issue.sheet), ...sheet, id, serial: issue.sheet.serial, technicians: team.map((person) => person.name).join(" · ") }),
      assigneeUid: team[0].uid, assigneeName: team[0].name,
      teamUids: team.map((person) => person.uid), teamNames: team.map((person) => person.name),
      definitionUpdatedAt: new Date().toISOString()
    });
  });
}

export async function setTechnicianActive(uid, active) {
  await updateDoc(doc(db, "roles", uid), { active });
}

export async function resetUserPassword(uid) {
  const callable = httpsCallable(getFunctions(app, "us-central1"), "resetUserPassword");
  return (await callable({ uid })).data.temporaryPassword;
}

export async function completeTemporaryPassword(password) {
  const callable = httpsCallable(getFunctions(app, "us-central1"), "completeTemporaryPassword");
  return (await callable({ password })).data;
}

export async function deleteTechnicianPermanently(uid) {
  const callable = httpsCallable(getFunctions(app, "us-central1"), "deleteTechnicianPermanently");
  return (await callable({ uid })).data;
}

export async function assignIssue(id, uid, name) {
  await updateDoc(doc(db, "issues", id), { assigneeUid: uid, assigneeName: name });
}

export async function cancelIssueDispatch(id, managerUid, reason) {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 500) throw new Error("יש להזין סיבת ביטול עד 500 תווים.");
  const ref = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists() || current.data().status !== "open") throw new Error("השילוח כבר אינו פתוח. רענן את הרשימה.");
    transaction.update(ref, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelledBy: managerUid, cancellationReason: trimmed });
  });
}

export async function cancelKeyDispatch(id, managerUid, reason) {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 500) throw new Error("יש להזין סיבת ביטול עד 500 תווים.");
  const ref = doc(db, "keyLoads", id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists() || current.data().status !== "open") throw new Error("השילוח כבר אינו פתוח. רענן את הרשימה.");
    transaction.update(ref, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelledBy: managerUid, cancellationReason: trimmed });
  });
}

export async function submitForReview(id, record, state, session) {
  const issueRef = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    await requireEditLock(transaction, "issue", record.serial, session, auth.currentUser?.uid);
    const current = await transaction.get(issueRef);
    if (!current.exists() || current.data().status !== "open") throw new Error("התקלה כבר נשלחה לבדיקה או אינה קיימת. רענן את הדף.");
    if (current.data().sheet.serial !== record.serial) throw new Error("מספר התקלה אינו תואם.");
    if (!(current.data().teamUids || [current.data().assigneeUid]).includes(auth.currentUser?.uid)) throw new Error("השיוך לטכנאי השתנה. לא ניתן לשמור את הדף הזה.");
    transaction.update(issueRef, { status: "pendingReview", closed: { record, state }, workDraft: deleteField() });
  });
}

export async function saveIssueWorkDraft(id, uid, state, session) {
  const ref = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists() || current.data().status !== "open") throw new Error("התקלה אינה פתוחה עוד.");
    if (!(current.data().teamUids || [current.data().assigneeUid]).includes(uid)) throw new Error("אינך משויך לצוות התקלה.");
    await requireEditLock(transaction, "issue", current.data().sheet.serial, session, uid);
    transaction.update(ref, { workDraft: { state, savedAt: new Date().toISOString(), savedBy: uid } });
  });
}

export async function approveIssue(id, reviewerUid, signature, managerReview = {}) {
  const issueRef = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(issueRef);
    if (!snapshot.exists() || snapshot.data().status !== "pendingReview") throw new Error("הדף אינו ממתין עוד לבדיקת בודק.");
    if (!signature.startsWith("data:image/png;base64,")) throw new Error("יש לחתום על בדיקת הדף.");
    transaction.update(issueRef, { status: "closed", reviewedAt: new Date().toISOString(), reviewedBy: reviewerUid, reviewerSignature: signature, managerReview });
  });
}

export async function updateClosedIssueReview(id, reviewerUid, managerReview) {
  const issueRef = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(issueRef);
    if (!snapshot.exists() || !["closed", "pendingReview"].includes(snapshot.data().status)) throw new Error("התקלה אינה ממתינה לבקרה או סגורה. רענן את הדף.");
    transaction.update(issueRef, { managerReview, reviewUpdatedAt: new Date().toISOString(), reviewUpdatedBy: reviewerUid });
  });
}

export async function reopenIssue(id, managerUid) {
  const issueRef = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(issueRef);
    if (!snapshot.exists() || !["closed", "pendingReview"].includes(snapshot.data().status)) throw new Error("התקלה כבר פתוחה או אינה קיימת.");
    const issue = snapshot.data();
    if (!issue.assigneeUid) throw new Error("לא הוגדר טכנאי לתקלה.");
    const reopenedAt = new Date().toISOString();
    transaction.update(issueRef, {
      status: "open", reopenedAt, reopenedBy: managerUid,
      reopenEvents: [...(issue.reopenEvents || []), { at: reopenedAt, by: managerUid, priorClosedAt: issue.closed.state.closedAt, priorReviewedAt: issue.reviewedAt || null }]
    });
  });
}

export async function appendIssueManagerNote(id, note) {
  const text = note.trim();
  if (!text || text.length > 500) throw new Error("יש להזין הערה של עד 500 תווים.");
  const ref = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().status !== "open") throw new Error("אפשר להוסיף הערות רק לתקלה פתוחה.");
    const previous = snapshot.data().sheet.managerNotes || "";
    const next = [previous, text].filter(Boolean).join("\n");
    if (next.length > 2000) throw new Error("הגעת למגבלת ההערות בתקלה זו.");
    transaction.update(ref, { "sheet.managerNotes": next });
  });
}
