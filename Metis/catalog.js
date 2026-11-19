export const SQUADRONS = {
  "101": {
    shelters: ["3", "4", "5", "17"],
    aircraft: ["101", "502", "503", "506", "511", "512", "514", "516", "519", "520", "522", "523", "527", "528", "530", "531", "524", "536", "538", "539", "542", "543", "546", "547", "551", "554", "557", "558"]
  },
  "105": {
    shelters: ["2", "7", "9", "14"],
    aircraft: ["601", "603", "610", "615", "619", "624", "628", "630", "633", "638", "642", "647", "648", "651", "652", "656", "664", "666", "667", "673", "676", "678", "682", "687"]
  },
  "109": {
    shelters: ["8", "13", "15", "16"],
    aircraft: [20, 22, 23, 27, 34, 36, 39, 41, 45, 46, 50, 55, 57, 61, 63, 69, 72, 74, 75, 79, 83, 88].map((number) => String(number).padStart(3, "0")).concat(["612", "637"])
  },
  "מנ״ט": { shelters: ["מנ״ט"], aircraft: ["000"] },
  "מוסכים": { shelters: ["מוסך א", "מוסך ב", "כנפ״ת"], aircraft: ["000"] }
};

export const SYSTEMS = [
  { name: "מכם | FCR", code: "74A" },
  { name: "טאקאן | TCN", code: "63A" },
  { name: "אימפריה פאסיבית", code: "76E" }
];

export function validateCatalogSelection(selected, draft) {
  if (!Object.hasOwn(SQUADRONS, selected.squadron) || draft.squadron !== selected.squadron) return { field: "squadron", message: "בחר טייסת מהרשימה." };
  if (!SQUADRONS[selected.squadron].shelters.includes(selected.shelter) || draft.shelter !== selected.shelter) return { field: "shelter", message: "בחר דת״ק מהרשימה של הטייסת." };
  if (!SQUADRONS[selected.squadron].aircraft.includes(selected.aircraft) || draft.aircraft !== selected.aircraft) return { field: "aircraft", message: "בחר מספר מטוס מתוך תוצאות החיפוש של הטייסת." };
  const system = SYSTEMS.find((item) => item.name === selected.systemName);
  if (!system || draft.systemName !== system.name || draft.systemCode !== system.code) return { field: "systemName", message: "בחר שם מערכת מהרשימה כדי למלא קוד מערכת." };
  return null;
}
