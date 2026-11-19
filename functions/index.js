const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

exports.deleteTechnicianPermanently = onCall({ region: "us-central1" }, async (request) => {
  const actor = request.auth;
  if (!actor || actor.token.email !== "roisuissa6@gmail.com") throw new HttpsError("permission-denied", "רק המנהל מורשה למחוק משתמשים.");
  const db = getFirestore();
  const manager = await db.doc(`roles/${actor.uid}`).get();
  if (manager.data()?.role !== "manager" || manager.data()?.active !== true) throw new HttpsError("permission-denied", "הרשאת המנהל אינה פעילה.");

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
