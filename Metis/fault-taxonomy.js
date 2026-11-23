// Pure selectors shared by the manager's issue list, history and reports.
// Older issues without classification stay visible in the general views.
export const FAULT_FILTERS = [
  ["open-default", "פתוחות ללא אישורים והיתרים"],
  ["workshop-open", "מוסכים · פתוחות"],
  ["open-all", "פתוחות כולל היתרים לבדיקה"],
  ["inspection-permit", "היתרים לבדיקה"],
  ["permits", "היתרים בלבד"],
  ["approvals", "אישורים בלבד"],
  ["aircraft-date", "תקלות במטוס לפי תאריך"],
  ["date", "תקלות בתאריך"],
  ["pilot-date", "תקלות טייס לפי תאריך"],
  ["sortie-cancelled", "ביטולי גיחה"],
  ["repeat", "תקלות חוזרות"],
  ["open-squadron", "פתוחות לפי טייסת / יא״א"],
  ["serial", "סינון לפי מספר תקלה"],
  ["closed", "תקלות סגורות"],
  ["pending", "תקלות לסגירה"]
];

export const ORIGINS = ["תקלת טייס", "תקלת טכנאי", "פג תוקף", "שינוי", "בדיקה", "פירוק/הרכבה", "פריקת ל״א"];
export const REVIEW_CATEGORIES = ["בקרי", "קשר", "ל״א", "אישורים והיתרים", "פירוקים והרכבות"];

export const aircraftKey = (issue) => `${issue.sheet?.squadron || ""}|${issue.sheet?.aircraft || ""}`;
export const issueDate = (issue) => issue.reviewedAt || issue.closed?.state?.closedAt || issue.createdAt || "";
export const permitFlags = (issue) => {
  const review = issue.managerReview || {};
  return {
    inspection: Boolean(review.inspectionPermitUntil),
    permit: Boolean(review.inspectionPermitUntil || review.flightPermitUntil || review.trackingPermit),
    approval: Boolean(review.approvalUntil)
  };
};

export function filterIssues(issues, { mode = "open-default", serial = "", squadron = "", aircraft = "", from = "", to = "", category = "", reviewFilters = [], originFilters = [] } = {}) {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
  return issues.filter((issue) => {
    const sheet = issue.sheet || {}, review = issue.managerReview || {}, flags = permitFlags(issue);
    if (serial && !String(sheet.serial || "").includes(serial.trim())) return false;
    if (squadron && sheet.squadron !== squadron) return false;
    if (aircraft && sheet.aircraft !== aircraft) return false;
    if (category && (sheet.reviewCategory || review.category || "") !== category) return false;
    if (mode === "closed") {
      const origins = Array.isArray(sheet.faultOrigins) && sheet.faultOrigins.length ? sheet.faultOrigins : [sheet.faultOrigin].filter(Boolean);
      if (originFilters.length && !originFilters.some((origin) => origins.includes(origin))) return false;
      const treatments = ["verified", "unitsReplaced", "repairPerformed"];
      const recurrence = ["missionCancelled", "sortieCancelled", "recurrentYes", "recurrentNo"];
      const permits = ["flightPermitUntil", "trackingPermit", "approvalUntil"];
      const matchesReview = (key) => key === "recurrentYes" ? (review.recurrentAnswer === "yes" || (!review.recurrentAnswer && review.recurrent === true)) : key === "recurrentNo" ? review.recurrentAnswer === "no" : Boolean(review[key]);
      if ([treatments, recurrence, permits].some((group) => reviewFilters.some((key) => group.includes(key)) && !reviewFilters.some((key) => group.includes(key) && matchesReview(key)))) return false;
    }
    const when = new Date(issueDate(issue)).getTime();
    if (Number.isFinite(start) && (!Number.isFinite(when) || when < start)) return false;
    if (Number.isFinite(end) && (!Number.isFinite(when) || when > end)) return false;
    switch (mode) {
      case "open-default": return issue.status === "open" && !flags.permit && !flags.approval;
      case "workshop-open": return issue.status === "open" && sheet.shelter === "מוסך";
      case "open-all": case "open-squadron": return issue.status === "open";
      case "inspection-permit": return flags.inspection;
      case "permits": return flags.permit;
      case "approvals": return flags.approval;
      case "pilot-date": return (sheet.faultOrigins || [sheet.faultOrigin]).includes("תקלת טייס");
      case "sortie-cancelled": return Boolean(review.sortieCancelled);
      case "repeat": return review.recurrentAnswer === "yes" || Boolean(review.recurrent);
      case "closed": return issue.status === "closed";
      case "pending": return issue.status === "pendingReview";
      default: return true;
    }
  }).sort((a, b) => new Date(issueDate(b)) - new Date(issueDate(a)));
}

export function unitHistory(issues, serial) {
  const needle = String(serial || "").trim().toLocaleLowerCase("he");
  if (!needle) return [];
  return issues.flatMap((issue) => ["removed", "installed"].flatMap((kind) =>
    (issue.closed?.state?.[kind] || []).filter((unit) => String(unit.serial || "").trim().toLocaleLowerCase("he") === needle)
      .map((unit) => ({ issue, kind, unit, at: issueDate(issue) })))).sort((a, b) => new Date(b.at) - new Date(a.at));
}
export function componentHistory(issues, name) {
  const needle = String(name || "").trim().toLocaleLowerCase("he");
  if (!needle) return [];
  return issues.flatMap((issue) => ["removed", "installed"].flatMap((kind) =>
    (issue.closed?.state?.[kind] || []).filter((unit) => String(unit.name || "").trim().toLocaleLowerCase("he") === needle)
      .map((unit) => ({ issue, kind, unit, at: issueDate(issue) })))).sort((a, b) => new Date(b.at) - new Date(a.at));
}
