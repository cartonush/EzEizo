import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, setPersistence, inMemoryPersistence, deleteUser, signOut } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, onSnapshot, query, where, runTransaction } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
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
  main.hidden = true;
  const panel = document.createElement("section");
  panel.className = "card auth-card";
  panel.hidden = true;
  panel.innerHTML = '<h2>כניסה למערכת</h2><p>התחבר לחשבון שלך.</p><form><label class="input-field">דואר אלקטרוני<input type="email" required autocomplete="username"></label><label class="input-field">סיסמה<input type="password" required autocomplete="current-password"></label><button class="primary-button" type="submit">התחבר</button></form><p class="copy-status" role="status" aria-live="polite">בודק התחברות…</p>';
  main.before(panel);
  if (role === "manager") panel.querySelector('[type="email"]').value = "roisuissa6@gmail.com";
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
    if (role === "manager") {
      const instructions = document.createElement("p");
      instructions.textContent = "ההזדהות ב־Firebase הצליחה. פרסם את כללי Firestore המעודכנים ב־Firebase Console ולחץ ״בדוק שוב״. הרשאת נימר תיווצר אוטומטית. ה־UID שלך:";
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
    onAuthStateChanged(auth, async (user) => {
      if (!user) { if (active) location.reload(); document.querySelector("#app-skeleton")?.remove(); panel.hidden = false; help.hidden = true; status.textContent = "יש להתחבר כדי לראות תקלות."; delete status.dataset.state; return; }
      status.textContent = "ההזדהות הצליחה. בודק הרשאות Firestore…";
      delete status.dataset.state;
      try {
        const roleRef = doc(db, "roles", user.uid);
        let roleDoc = await Promise.race([
          getDoc(roleRef),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000))
        ]);
        if (!roleDoc.exists() && role === "manager" && user.email === "roisuissa6@gmail.com") {
          status.textContent = "יוצר הרשאת מנהל…";
          await setDoc(roleRef, { role: "manager", name: "נימר", email: user.email, active: true, createdAt: new Date().toISOString() });
          roleDoc = await getDoc(roleRef);
        }
        if (roleDoc.data()?.role !== role || roleDoc.data()?.active === false || (role === "manager" && user.email !== "roisuissa6@gmail.com")) {
          panel.hidden = false;
          showSetup(user, `אין לחשבון הזה הרשאת ${role === "manager" ? "מנהל" : "טכנאי"} פעילה.`);
          return;
        }
        if (active) return;
        active = true;
        panel.remove();
        const logout = document.createElement("button");
        logout.type = "button"; logout.className = "secondary-button auth-logout"; logout.textContent = "התנתק";
        logout.addEventListener("click", () => signOut(auth));
        const managerControls = role === "manager" ? document.querySelector("#manager-controls") : null;
        if (managerControls) managerControls.append(logout);
        else document.querySelector(".topbar").after(logout);
        onSnapshot(doc(db, "roles", user.uid), (snapshot) => {
          if (!snapshot.exists() || snapshot.data().active === false || snapshot.data().role !== role) location.reload();
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
  const source = technicianUid ? query(collection(db, "issues"), where("assigneeUid", "==", technicianUid)) : collection(db, "issues");
  return onSnapshot(source, (snapshot) => {
    onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data(), sheet: restoredSheet(entry.data().sheet) })));
  }, onError);
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
    const next = candidate > last && candidate <= 999999 ? candidate : last + 1;
    if (next > 999999) throw new Error("מספרי התקלות אזלו.");
    const serial = String(next).padStart(6, "0");
    transaction.set(counterRef, { last: next });
    transaction.set(issueRef, { sheet: storedSheet({ ...sheet, serial }), status: "open", assigneeUid: assignee.uid, assigneeName: assignee.name, createdAt: new Date().toISOString() });
    return serial;
  });
}

// One serial represents the job; each technician gets a private form and closure.
export async function createAssignedIssues(sheet, assignees) {
  if (assignees.length < 1 || new Set(assignees.map(({ uid }) => uid)).size !== assignees.length) throw new Error("יש לבחור לפחות טכנאי אחד, ללא כפילויות.");
  const refs = assignees.map(() => doc(collection(db, "issues")));
  return runTransaction(db, async (transaction) => {
    const counter = await transaction.get(counterRef);
    const next = (Number(counter.data()?.last) || 0) + 1;
    if (next > 999999) throw new Error("מספרי התקלות אזלו.");
    const serial = String(next).padStart(6, "0");
    transaction.set(counterRef, { last: next });
    refs.forEach((ref, index) => {
      const assignee = assignees[index];
      transaction.set(ref, {
        sheet: storedSheet({ ...sheet, id: ref.id, serial, technicians: assignees.map(({ name }) => name).join(" · ") }),
        status: "open", assigneeUid: assignee.uid, assigneeName: assignee.name, createdAt: new Date().toISOString()
      });
    });
    return serial;
  });
}

export function watchTechnicians(onChange, onError) {
  return onSnapshot(collection(db, "roles"), (snapshot) => {
    onChange(snapshot.docs.filter((entry) => entry.data().role === "technician").map((entry) => ({ uid: entry.id, ...entry.data() })));
  }, onError);
}

export async function createTechnician(name, email, password) {
  const secondary = initializeApp(firebaseConfig, `provision-${crypto.randomUUID()}`);
  const provisioningAuth = getAuth(secondary);
  let createdUser = null;
  try {
    await setPersistence(provisioningAuth, inMemoryPersistence);
    const credential = await createUserWithEmailAndPassword(provisioningAuth, email.trim(), password);
    createdUser = credential.user;
    await setDoc(doc(db, "roles", createdUser.uid), { role: "technician", name: name.trim(), email: email.trim(), active: true, createdAt: new Date().toISOString() });
    return createdUser.uid;
  } catch (error) {
    if (createdUser) await deleteUser(createdUser).catch(() => {});
    throw error;
  } finally {
    await signOut(provisioningAuth).catch(() => {});
    await deleteApp(secondary);
  }
}

export async function setTechnicianActive(uid, active) {
  await updateDoc(doc(db, "roles", uid), { active });
}

export async function deleteTechnicianPermanently(uid) {
  const callable = httpsCallable(getFunctions(app, "us-central1"), "deleteTechnicianPermanently");
  return (await callable({ uid })).data;
}

export async function assignIssue(id, uid, name) {
  await updateDoc(doc(db, "issues", id), { assigneeUid: uid, assigneeName: name });
}

export async function submitForReview(id, record, state) {
  const issueRef = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(issueRef);
    if (!current.exists() || current.data().status !== "open") throw new Error("התקלה כבר נשלחה לבדיקה או אינה קיימת. רענן את הדף.");
    if (current.data().sheet.serial !== record.serial) throw new Error("מספר התקלה אינו תואם.");
    transaction.update(issueRef, { status: "pendingReview", closed: { record, state } });
  });
}

export async function approveIssue(id, reviewerUid, signature) {
  const issueRef = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(issueRef);
    if (!snapshot.exists() || snapshot.data().status !== "pendingReview") throw new Error("הדף אינו ממתין עוד לבדיקת בודק.");
    if (!signature.startsWith("data:image/png;base64,")) throw new Error("יש לחתום על בדיקת הדף.");
    transaction.update(issueRef, { status: "closed", reviewedAt: new Date().toISOString(), reviewedBy: reviewerUid, reviewerSignature: signature });
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
      reopenEvents: [...(issue.reopenEvents || []), { at: reopenedAt, by: managerUid, priorClosedAt: issue.closed.state.closedAt }]
    });
  });
}
