import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

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

export function gate(role) {
  const main = document.querySelector("main");
  main.hidden = true;
  const panel = document.createElement("section");
  panel.className = "card auth-card";
  panel.innerHTML = '<h2>כניסה למערכת</h2><p>התחבר לחשבון שהוגדר עבורך ב־Firebase.</p><form><label class="input-field">דואר אלקטרוני<input type="email" required autocomplete="username"></label><label class="input-field">סיסמה<input type="password" required autocomplete="current-password"></label><button class="primary-button" type="submit">התחבר</button></form><p class="copy-status" role="status" aria-live="polite">בודק התחברות…</p>';
  main.before(panel);
  const status = panel.querySelector('[role="status"]');
  panel.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "מתחבר…";
    try {
      await signInWithEmailAndPassword(auth, panel.querySelector('[type="email"]').value.trim(), panel.querySelector('[type="password"]').value);
    } catch (error) {
      status.textContent = error.code === "auth/invalid-credential" ? "הפרטים אינם נכונים." : `ההתחברות נכשלה: ${error.code || error.message}`;
    }
  });
  return new Promise((resolve) => {
    let active = false;
    onAuthStateChanged(auth, async (user) => {
      if (!user) { if (active) location.reload(); status.textContent = "יש להתחבר כדי לראות תקלות."; return; }
      try {
        const roleDoc = await getDoc(doc(db, "roles", user.uid));
        if (roleDoc.data()?.role !== role) {
          status.textContent = `לחשבון זה אין הרשאת ${role === "manager" ? "מנהל" : "טכנאי"}. הגדר מסמך roles/${user.uid} עם role: ${role} ורענן.`;
          return;
        }
        if (active) return;
        active = true;
        panel.remove(); main.hidden = false;
        const logout = document.createElement("button");
        logout.type = "button"; logout.className = "secondary-button auth-logout"; logout.textContent = "התנתק";
        logout.addEventListener("click", () => signOut(auth));
        document.querySelector(".topbar").after(logout);
        resolve(user);
      } catch (error) { status.textContent = `לא ניתן לבדוק הרשאה: ${error.message}`; }
    }, (error) => { status.textContent = `שגיאת התחברות: ${error.message}`; });
  });
}

export function watchIssues(onChange, onError) {
  return onSnapshot(collection(db, "issues"), (snapshot) => {
    onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
  }, onError);
}

export async function getIssue(id) {
  const snapshot = await getDoc(doc(db, "issues", id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function createIssue(sheet, preserveSerial = false) {
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
    transaction.set(issueRef, { sheet: { ...sheet, serial }, status: "open", createdAt: new Date().toISOString() });
    return serial;
  });
}

export async function closeIssue(id, record, state) {
  const issueRef = doc(db, "issues", id);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(issueRef);
    if (!current.exists() || current.data().status !== "open") throw new Error("התקלה כבר נסגרה או אינה קיימת. רענן את הדף.");
    if (current.data().sheet.serial !== record.serial) throw new Error("מספר התקלה אינו תואם.");
    transaction.update(issueRef, { status: "closed", closed: { record, state } });
  });
}
