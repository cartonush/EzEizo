const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { randomInt } = require("node:crypto");

initializeApp();

exports.deleteTechnicianPermanently = onCall({ region: "us-central1" }, async (request) => {
  const actor = request.auth;
  if (!actor || actor.token.email !== "roisuissa6@gmail.com") throw new HttpsError("permission-denied", "רק המטיס מורשה למחוק משתמשים.");
  const db = getFirestore();
  const manager = await db.doc(`roles/${actor.uid}`).get();
  if (manager.data()?.role !== "manager" || manager.data()?.active !== true) throw new HttpsError("permission-denied", "הרשאת המטיס אינה פעילה.");

  const uid = request.data?.uid;
  if (typeof uid !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(uid) || uid === actor.uid) throw new HttpsError("invalid-argument", "מזהה משתמש אינו תקין.");
  const roleRef = db.doc(`roles/${uid}`);
  const role = await roleRef.get();
  const person = role.data();
  if (!person || person.role !== "technician" || person.active !== false) throw new HttpsError("failed-precondition", "אפשר למחוק סופית רק טכנאי שהוסר מהפעילים.");
  if (person.deleted) return { deleted: true };

  const assigned = await db.collection("issues").where("assigneeUid", "==", uid).get();
  if (assigned.docs.some((issue) => issue.data().status === "open")) throw new HttpsError("failed-precondition", "יש לשייך מחדש תקלות פתוחות לפני המחיקה.");

  try { await getAuth().deleteUser(uid); }
  catch (error) { if (error.code !== "auth/user-not-found") throw new HttpsError("internal", "מחיקת חשבון ההתחברות נכשלה."); }
  await roleRef.set({ role: "technician", name: person.name || "טכנאי שנמחק", active: false, deleted: true, deletedAt: new Date().toISOString(), deletedBy: actor.uid });
  return { deleted: true };
});

async function requireManager(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "יש להתחבר כמטיס.");
  const role = await getFirestore().doc(`roles/${request.auth.uid}`).get();
  if (role.data()?.role !== "manager" || role.data()?.active === false) throw new HttpsError("permission-denied", "המשתמש אינו מורשה גישה.");
}

exports.resetUserPassword = onCall({ region: "us-central1" }, async (request) => {
  await requireManager(request);
  const uid = request.data?.uid;
  if (typeof uid !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(uid)) throw new HttpsError("invalid-argument", "מזהה המשתמש אינו תקין.");
  const roleRef = getFirestore().doc(`roles/${uid}`);
  const role = await roleRef.get();
  if (!role.exists || role.data().active === false || !["manager", "technician"].includes(role.data().role)) throw new HttpsError("failed-precondition", "החשבון אינו פעיל.");
  const temporaryPassword = Array.from({ length: 8 }, () => randomInt(0, 10)).join("");
  await getAuth().updateUser(uid, { password: temporaryPassword });
  await roleRef.update({ passwordResetRequired: true, passwordResetAt: new Date().toISOString() });
  await getAuth().revokeRefreshTokens(uid);
  return { temporaryPassword };
});

exports.completeTemporaryPassword = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "יש להתחבר תחילה.");
  const password = request.data?.password;
  if (typeof password !== "string" || !/^[0-9]{8}$/.test(password)) throw new HttpsError("invalid-argument", "הסיסמה חייבת להכיל בדיוק 8 ספרות.");
  const roleRef = getFirestore().doc(`roles/${request.auth.uid}`);
  const role = await roleRef.get();
  if (!role.exists || role.data().active === false || role.data().passwordResetRequired !== true) throw new HttpsError("failed-precondition", "לא נדרש שינוי סיסמה לחשבון הזה.");
  if (!request.auth.token?.auth_time || request.auth.token.auth_time < Math.ceil(new Date(role.data().passwordResetAt).getTime() / 1000)) throw new HttpsError("permission-denied", "יש להתחבר מחדש עם הסיסמה הזמנית.");
  await getAuth().updateUser(request.auth.uid, { password });
  await roleRef.update({ passwordResetRequired: false, passwordResetAt: null });
  return { changed: true };
});
