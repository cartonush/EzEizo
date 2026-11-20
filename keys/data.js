import { SQUADRONS } from "../Metis/catalog.js?v=1.4.9";

export const KEY_SQUADRONS = ["101", "105", "109"];
export const KEY_TASKS = [
  'תדריך בטיחות וניהול סיכונים ע"י מ"ע המחלקה / משלח המשימה (חתימת המשלח)',
  'בדיקת מטוס בטוח לאחזקה טרם התהליך – אין קסטות מוץ, נורים וכפט"ים מורכבים על המטוס',
  'התייצב אצל אחראי / ר"צ מטוס וקבל אישור עבודה',
  'פתח פ"א לביצוע שינוי מפתחות במערכת ארז / שקנאי לפי הצורך',
  'העבר את כלי העבודה לפיקוח תורן כלים ובדוק מטוס בטוח לאחזקה לפני תחילת העבודה',
  'בדוק לניקיון מגופים זרים בסיום העבודה',
  'תעד פעולות אחזקה (ספר / להבה / תפנית / שביט...)',
  'במידת הצורך בהחלפת ציוד, תייג ציוד תקול (בר תיקון מהלהבה)',
  'הודע לאחראי / ר"צ מטוס על גמר האחזקה',
  'הזדכה על כלי העבודה ואסוף את הכלים שהבאת מהגף',
  'החזר ציוד למקומו בגף, העבר ציוד בר תיקון לעמדה',
  'סמן בדף זה ביצוע הטענה בכל המטוסים הרשומים והחזר להטסה בסיום'
];
export const KEY_TABLES = {
  tools: [{ key: "toolName", label: "שם כלי" }, { key: "toolNumber", label: "מספר כלי" }, { key: "notes", label: "הערות", optional: true }],
  taken: [{ key: "description", label: "תיאור קשיח / נצרך" }, { key: "removedFrom", label: "הוסר מרכיב / אזור" }, { key: "quantityIn", label: "כמות בכניסה" }, { key: "quantityOut", label: "כמות ביציאה" }, { key: "notes", label: "הערות", optional: true }],
  rejected: [{ key: "description", label: "תיאור הקשיח" }, { key: "quantity", label: "כמות" }, { key: "mascha", label: "מסחא" }, { key: "reason", label: "סיבת הפסילה" }]
};
export const aircraftFor = (squadron) => SQUADRONS[squadron]?.aircraft || [];
export const sheltersFor = (squadron) => SQUADRONS[squadron]?.shelters || [];
export function periodFor(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  if (!year || !month || !day || new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date) throw new Error("תאריך אינו תקין");
  const next = new Date(Date.UTC(year, month, 1));
  return { label: `${String(month).padStart(2, "0")}-${String(next.getUTCMonth() + 1).padStart(2, "0")}/${String(next.getUTCFullYear()).slice(-2)}`, year: String(year), current: `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`, next: `${String(next.getUTCMonth() + 1).padStart(2, "0")}/${String(next.getUTCFullYear()).slice(-2)}` };
}
export function compactRows(rows, columns) {
  return (Array.isArray(rows) ? rows : []).filter((row) => columns.some(({ key }) => String(row?.[key] ?? "").trim())).map((row) => Object.fromEntries(columns.map(({ key }) => [key, row[key] ?? ""])));
}
export function validateRows(rows, columns, label) {
  for (const [index, row] of rows.entries()) for (const column of columns) {
    if (!column.optional && !String(row[column.key] ?? "").trim()) return `בטבלת ${label}, בשורה ${index + 1} חסר ${column.label}.`;
  }
  return "";
}
