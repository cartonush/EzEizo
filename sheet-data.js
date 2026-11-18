(function () {
  const defaultSheet = {
    id: "example",
    location: "14/105",
    aircraft: "603",
    systemCode: "74A",
    systemName: "מכם",
    ewSystem: "גרניט",
    technicians: "רועי סויסה · צוק עינב",
    fault: "פירוק והרכבה אנטנת מכם",
    constants: {
      HUD: [["k1", "0"], ["K2", "74"], ["K3", "829"], ["K4", "-949"], ["K5", "90"], ["K6", "-719"], ["K7", "0"], ["K8", "7"], ["K9", "-88890"]],
      CTVS: [["T1", "78"], ["T2", "789"], ["T3", "13"], ["T4", "781"], ["T5", "99"], ["T6", "11"], ["T7", "9"], ["T8", "0"], ["T9", "72939"]],
      CAMERA: [["HG1", "793"], ["HO2", "829"], ["VG3", "829"], ["VO4", "918"], ["CS5", "0"]],
      TFL: [["K10-K13", "0"], ["K14", "0"]],
      INS: [["MISC37", "893"], ["MISC38", "-930"], ["MISC39", "193"]]
    },
    actions: [
      "חתום על כלים רלוונטיים וגש לנקודת העבודה",
      "זמן הגעה לדת״ק",
      "קבל אישור עבודה על המטוס מר״צ חימוש / מפקד דת״ק",
      "בצע ביקורת כלים עם ר״צ / מפקד תורן – קוד שכיח 310 (משוך את הכלים לנקודת העבודה)",
      "וודא מטוס בטוח לאחזקה לפי כרך בטיחות המטוס",
      "לפתרון התקלה פעל עפ״י תהליך מרכזי דרג א׳",
      "עדכן ר״צ / מפקד דת״ק בסטטוס המטוס",
      "בצע ביקורת כלים בסיום העבודה – קוד שכיח 310",
      "בצע בדיקה להיעדר גופים זרים במקום העבודה – קוד שכיח 3100",
      "זכה את הכלים שנלקחו מהגף",
      "הצמד תג בר תיקון למכלול / צב״ד תקול",
      "זמן סיום התקלה"
    ]
  };

  const scalarKeys = ["location", "aircraft", "systemCode", "systemName", "ewSystem", "technicians", "fault"];
  function normalizeSheet(input) {
    if (!input || typeof input !== "object") return null;
    const sheet = structuredClone(defaultSheet);
    sheet.id = String(input.id || sheet.id).slice(0, 80);
    scalarKeys.forEach((key) => {
      if (typeof input[key] === "string") sheet[key] = input[key].slice(0, key === "fault" ? 2000 : 200);
    });
    if (input.constants && typeof input.constants === "object") {
      Object.keys(sheet.constants).forEach((group) => {
        const source = input.constants[group];
        if (!Array.isArray(source)) return;
        sheet.constants[group] = sheet.constants[group].map(([label, value], index) => [label, String(source[index]?.[1] ?? value).slice(0, 80)]);
      });
    }
    if (Array.isArray(input.actions)) {
      sheet.actions = sheet.actions.map((label, index) => typeof input.actions[index] === "string" ? input.actions[index].slice(0, 300) : label);
    }
    return sheet;
  }

  function encodeSheet(sheet) {
    const bytes = new TextEncoder().encode(JSON.stringify(normalizeSheet(sheet)));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeSheet(value) {
    try {
      if (!value || value.length > 30000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
      const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return normalizeSheet(JSON.parse(new TextDecoder().decode(bytes)));
    } catch { return null; }
  }

  window.EzEizoData = { defaultSheet, normalizeSheet, encodeSheet, decodeSheet };
})();
