import { CONTENT_WIDTH, MARGIN, PAGE_HEIGHT, PAGE_WIDTH, pageCanvas, pdfFromJpegs, wrapped } from "./report-pdf.js?v=1.5.7";
import { KEY_TASKS, KEY_TABLES, periodFor } from "../keys/data.js?v=1.5.7";

const left = MARGIN, right = PAGE_WIDTH - MARGIN;
const dateTime = (value) => value ? new Date(value).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—";
const show = (value) => String(value ?? "").trim() || "—";
const checked = (value) => value ? "✓" : "—";
const columns = {
  removed: [["שם יחידה", "name"], ["מס״ד", "serial"]],
  installed: [["שם יחידה", "name"], ["מס״ד", "serial"]],
  ...Object.fromEntries(Object.entries(KEY_TABLES).map(([key, fields]) => [key, fields.map((field) => [field.label, field.key])]))
};

function pdfPages(title, subtitle) {
  let page, ctx, y, pageNumber = 0;
  const images = [];
  function start() {
    ({ canvas: page, ctx } = pageCanvas()); pageNumber++;
    ctx.fillStyle = "#102c45"; ctx.fillRect(0, 0, PAGE_WIDTH, 165);
    ctx.fillStyle = "#bcd6e5"; ctx.font = "24px Arial";
    ctx.fillText("כנף 1 · טייסת תחזוקה · גף אוויוניקה קרב", right, 28);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 45px Arial"; ctx.fillText(title, right, 67);
    ctx.font = "22px Arial"; ctx.fillText(subtitle, right, 123);
    y = 192;
  }
  function finish() {
    ctx.fillStyle = "#6b7f8d"; ctx.font = "19px Arial"; ctx.fillText(`עמוד ${pageNumber}`, right, PAGE_HEIGHT - 65);
    const bytes = atob(page.toDataURL("image/jpeg", .91).split(",")[1]);
    images.push(Uint8Array.from(bytes, (char) => char.charCodeAt(0)));
    page.width = 0;
  }
  function space(height) { if (y + height > PAGE_HEIGHT - 115) { finish(); start(); } }
  function heading(title) {
    space(85); y += 17; ctx.fillStyle = "#eaf4f8"; ctx.fillRect(left, y, CONTENT_WIDTH, 54);
    ctx.fillStyle = "#173b5d"; ctx.font = "bold 28px Arial"; ctx.fillText(title, right - 17, y + 12); y += 65;
  }
  function text(label, value, prefix = "") {
    ctx.font = "23px Arial";
    const lines = wrapped(ctx, `${prefix}${label}: ${show(value)}`, CONTENT_WIDTH - 36);
    space(lines.length * 34 + 12);
    ctx.fillStyle = "#274457";
    for (const line of lines) { ctx.fillText(line, right - 15, y); y += 34; }
    y += 10;
  }
  function paragraph(value) {
    ctx.font = "22px Arial";
    const lines = String(value || "—").split("\n").flatMap((line) => wrapped(ctx, line, CONTENT_WIDTH - 38));
    space(lines.length * 32 + 18); ctx.fillStyle = "#344f61";
    for (const line of lines) { ctx.fillText(line, right - 16, y); y += 32; }
    y += 17;
  }
  function row(values) {
    ctx.font = "21px Arial";
    const lines = wrapped(ctx, values.join("    ·    "), CONTENT_WIDTH - 40);
    const height = Math.max(50, lines.length * 31 + 20); space(height + 6);
    ctx.fillStyle = "#f8fbfd"; ctx.fillRect(left, y, CONTENT_WIDTH, height);
    ctx.strokeStyle = "#dbe7ed"; ctx.strokeRect(left, y, CONTENT_WIDTH, height);
    ctx.fillStyle = "#274457"; let lineY = y + 10;
    for (const line of lines) { ctx.fillText(line, right - 16, lineY); lineY += 31; }
    y += height + 6;
  }
  function rows(title, entries, fields) {
    heading(title);
    if (!entries?.length) { paragraph("לא נרשמו פריטים."); return; }
    for (const [index, entry] of entries.entries()) row([`שורה ${index + 1}`, ...fields.map(([label, key]) => `${label}: ${show(entry?.[key])}`)]);
  }
  async function signature(label, dataUrl) {
    if (!dataUrl?.startsWith("data:image/")) { text(label, "טרם נחתם"); return; }
    space(100); ctx.fillStyle = "#274457"; ctx.font = "22px Arial"; ctx.fillText(`${label}:`, right - 15, y + 12);
    try {
      const img = new Image(); img.src = dataUrl; await img.decode();
      const scale = Math.min(250 / img.naturalWidth, 76 / img.naturalHeight);
      ctx.drawImage(img, right - 255 - img.naturalWidth * scale, y, img.naturalWidth * scale, img.naturalHeight * scale);
    } catch { ctx.fillText("חתימה שמורה", right - 260, y + 12); }
    y += 95;
  }
  start();
  return { heading, text, paragraph, row, rows, signature, blob: () => { finish(); return pdfFromJpegs(images); } };
}

async function materials(pdf, state) {
  if (state.toolsEnabled) {
    pdf.rows("כלים", state.tools, columns.tools);
    for (const [enabled, title, fields] of [
      ["entryEnabled", "ביקורת כניסה", [["מספר אישי של הבודק", "entryInspectorNumber"], ["חתימת הטכנאי", "entryTechnicianSignature"], ["חתימת הבודק", "entryInspectorSignature"]]],
      ["interimEnabled", "ביקורת במהלך העבודה", [["מספר אישי של הבודק", "interimInspectorNumber"], ["שם פ.כלים / מ״ע", "interimToolsName"], ["חתימת הטכנאי", "interimTechnicianSignature"], ["חתימת הבודק", "interimInspectorSignature"], ["חתימת פ.כלים / מ״ע", "interimToolsSignature"]]],
      ["finalEnabled", "ביקורת בסיום העבודה", [["מספר אישי של הבודק", "finalInspectorNumber"], ["שם ר״צ / מ״ע", "finalLeadName"], ["שעת עזיבה", "departureTime"], ["חתימת הטכנאי", "finalTechnicianSignature"], ["חתימת הבודק", "finalInspectorSignature"], ["חתימת ר״צ / מ״ע", "finalLeadSignature"]]]
    ]) if (state[enabled]) { pdf.heading(title); for (const [label, key] of fields) { if (key.includes("Signature")) await pdf.signature(label, state[key]); else pdf.text(label, state[key]); } }
  }
  if (state.takenEnabled) {
    pdf.rows("קשיחים נצרכים", state.taken, columns.taken);
    for (const [label, key] of [["שם מלא", "takenFullName"], ["מספר אישי", "takenPersonalNumber"], ["דרגה", "takenRank"]]) pdf.text(label, state[key]);
    await pdf.signature("חתימת קשיחים נצרכים", state.takenSignature);
  }
  if (state.rejectedEnabled) pdf.rows("קשיחים שנפסלו", state.rejected, columns.rejected);
}

async function issuePdf(issue) {
  const sheet = issue.sheet || {}, state = issue.closed?.state || {};
  const pdf = pdfPages(`טופס תקלה ${show(sheet.serial)}`, `${issue.status === "closed" ? "סגור" : issue.status === "pendingReview" ? "ממתין לסגירה" : "פתוח"} · מטוס ${show(sheet.aircraft)}`);
  pdf.heading("פרטי התקלה");
  for (const [label, value] of [["מספר תקלה", sheet.serial], ["טייסת", sheet.squadron], ["דת״ק", sheet.shelter], ["מוסך", sheet.workshop], ["מספר מטוס", sheet.aircraft], ["שם מערכת", sheet.systemName], ["קוד מערכת", sheet.systemCode], ["חליפת ל״א", sheet.ewSystem], ["מוביל התקלה", issue.assigneeName], ["שעת פתיחה", dateTime(issue.createdAt)], ["שעת סגירה", dateTime(state.closedAt || issue.reviewedAt)]]) if (value) pdf.text(label, value);
  pdf.heading("תדריך ובדיקת בטיחות");
  pdf.paragraph('תדריך בטיחות וניהול סיכונים: יועבר ע״י מ״ע התקלה / משלח המשימה וייחתם על ידו.');
  await pdf.signature("חתימת משלח המשימה", sheet.dispatcherSignature);
  pdf.paragraph('בדיקת המטוס בטוח לאחזקה טרם התהליך: אין קסטות מוץ / נורים וכפט״ים מורכבים על המטוס.');
  await pdf.signature("חתימת הטכנאי על בדיקת בטיחות", state.safetyTechnicianSignature);
  pdf.heading("תקלה ותיקון");
  if (issue.status === "open") pdf.paragraph("הטופס פתוח. נתונים שהטכנאי הזין ונשמרו במכשירו בלבד יופיעו כאן לאחר סגירת הטופס.");
  pdf.text("תיאור תקלה", sheet.fault); pdf.text("הערות מנהל", sheet.managerNotes);
  for (const note of state.technicianNotes || []) pdf.text("הערות טכנאי", note);
  pdf.text("תיאור תיקון", state.repair);
  pdf.heading("פעולות לביצוע");
  (sheet.actions || window.EzEizoData?.defaultSheet.actions || []).forEach((task, index) => pdf.row([`${String(index + 1).padStart(2, "0")}. ${task}`, index === 1 ? show(state.arrivalTime) : index === 11 ? show(state.completionTime) : index === 10 ? state.action11Result === "notRequired" ? "X · לא נדרש" : checked(state.actions?.[index]) : checked(state.actions?.[index])]));
  if (state.unitsEnabled) { pdf.rows("יחידות שפורקו", state.removed, columns.removed); pdf.rows("יחידות שהורכבו", state.installed, columns.installed); }
  if (state.constantsEnabled) {
    pdf.heading("קבועים");
    for (const [group, entries] of Object.entries(sheet.constants || {})) pdf.row([group, ...(entries || []).map(([key, value]) => `${key}: ${value}`)]);
  }
  await materials(pdf, state);
  pdf.heading("אישור סיום");
  pdf.paragraph("הנני מאשר שכל הפרטים הרשומים שלמים נכונים ומדויקים. הנני מאשר שעדכנתי במערכות ממוכנות / בספר המטוס את מספרי המכשירים שפורקו והורכבו. הנני מאשר שהעברתי את המכשירים התקולים בצירוף תגי בר תיקון ממולאים בצורה מושלמת. הדף הוא בלשון זכר אך מתייחס לשני המינים.");
  await pdf.signature("חתימת הטכנאי", state.technicianDeclarationSignature);
  if (issue.status === "closed") await pdf.signature("חתימת בודק הדף", issue.reviewerSignature);
  return pdf.blob();
}

async function keyPdf(load) {
  const state = load.work || {};
  const pdf = pdfPages(`הטענת מפתחות ${show(load.serial)}`, `${load.status === "closed" ? "סגור" : "פתוח"} · טייסת ${load.squadron}`);
  pdf.heading("פרטי הטענה");
  for (const [label, value] of [["מספר הטענה", load.serial], ["תאריך", load.date], ["שעה", load.time], ["טייסת", load.squadron], ["דת״ק", load.shelter], ["צוות", (load.teamNames || []).join(" · ")], ["נפתחה", dateTime(load.createdAt)], ["נסגרה", dateTime(load.completedAt)]]) if (value) pdf.text(label, value);
  pdf.heading("רשימת הטענה");
  if (load.status === "open") pdf.paragraph("ההטענה פתוחה. נתונים שהטכנאי הזין ונשמרו במכשירו בלבד יופיעו כאן לאחר סגירת הטופס.");
  for (const [index, entry] of (load.rows || []).entries()) {
    const done = state.aircraft?.[index] || {};
    pdf.row([`מטוס ${entry.aircraft}`, `ארז כחול: ${entry.blue ? checked(done.blueDone) : "לא נדרש"}`, `שחק: ${entry.shach ? checked(done.shachDone) : "לא נדרש"}`]);
    if (entry.notes) pdf.text(`הערות מנהל למטוס ${entry.aircraft}`, entry.notes);
    if (done.technicianNote) pdf.text(`הערות טכנאי למטוס ${entry.aircraft}`, done.technicianNote);
  }
  if (load.managerNotes) pdf.text("הערות מנהל", load.managerNotes);
  pdf.heading("הנחיות עבודה");
  pdf.paragraph(`אחזקה נדרשת לביצוע: הטענת מטוסים במסגרת ביצוע שינוי מפתחות לחודשים ${load.period}.`);
  pdf.paragraph("יש לוודא כי לא מופיעות תקלות: EREZ 78 לאחר טעינה ולאחר שידור PTT בארז, SAK 7 / 34 בשחק.");
  pdf.paragraph("כלי עבודה / צב״ד צת״ת / חלפים נדרשים: מ.כ 2020 + חרב אש");
  pdf.heading("משימות לביצוע");
  KEY_TASKS.forEach((task, index) => pdf.row([`${String(index + 1).padStart(2, "0")}. ${task}`, checked(index === 0 || state.actions?.[index])]));
  await pdf.signature("חתימת משלח המשימה", load.dispatcherSignature);
  if (load.date) {
    const period = periodFor(load.date);
    pdf.heading("מידע לעזר הטכנאי");
    pdf.paragraph("קוד ביקורת: ברק 1 – 500, ברק 2 – 584 לביצוע מפתחות שחק. ברק 1 – 510, ברק 2 – 578 לביצוע מפתחות ארז.");
    [["כר-156 · ארז כחול", "6003-216", "כרטיס מחיקה שנתי", period.year], ["כר-156 · ארז כחול", "6001-295", "חודש נוכחי", period.current], ["כר-156 · ארז כחול", "6001-296", "חודש הבא", period.next], ["כר-116 · שחק", "6016-385", "חודש נוכחי", period.current], ["כר-116 · שחק", "6016-386", "חודש הבא", period.next]].forEach((values) => pdf.row(values));
  }
  await materials(pdf, state);
  return pdf.blob();
}

export async function createFormPdf(form, type) {
  await document.fonts?.ready;
  return type === "key" ? keyPdf(form) : issuePdf(form);
}
