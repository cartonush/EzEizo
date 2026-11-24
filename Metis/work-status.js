export function issueWorkStage(issue) {
  if (issue.status === "open") return issue.startedAt || issue.workDraft?.state?.safetyTechnicianSignature ? "progress" : "start";
  if (issue.status === "pendingReview" || issue.status === "closed") return "finished";
  return null;
}

export function renderWorkStatus(issues) {
  const root = document.querySelector("#work-status-board");
  root.replaceChildren();
  const bySerial = new Map(), rank = { closed: 3, pendingReview: 2, open: 1 };
  for (const issue of issues.filter((item) => item.sheet?.serial)) {
    const previous = bySerial.get(issue.sheet.serial);
    if (!previous || (rank[issue.status] || 0) > (rank[previous.status] || 0)) bySerial.set(issue.sheet.serial, issue);
  }
  const unique = [...bySerial.values()];
  for (const [stage, title, hint] of [["start", "תחילת עבודה", "פתוחות · טרם נחתם בטוח לאחזקה"], ["progress", "מהלך עבודה", "חתימת בטיחות נשמרה"], ["finished", "סיום עבודה", "ממתינות לבקרה או סגורות"]]) {
    const lane = document.createElement("section"); lane.className = `work-status-lane work-status-${stage}`;
    const group = unique.filter((item) => issueWorkStage(item) === stage).sort((a, b) => (b.startedAt || b.createdAt || "").localeCompare(a.startedAt || a.createdAt || ""));
    const heading = document.createElement("h3"); heading.textContent = `${title} · ${group.length}`;
    const description = document.createElement("p"); description.textContent = hint;
    lane.append(heading, description);
    if (!group.length) { const empty = document.createElement("p"); empty.className = "work-status-empty"; empty.textContent = "אין תקלות בשלב זה."; lane.append(empty); }
    for (const issue of group) {
      const card = document.createElement("a"); card.className = "work-status-card";
      card.href = issue.status === "closed" ? `./closed.html?id=${encodeURIComponent(issue.id)}` : stage === "finished" ? "#pending" : stage === "progress" ? "#in-progress" : "#open";
      const serial = document.createElement("strong"); serial.textContent = `תקלה ${issue.sheet.serial}`;
      const aircraft = document.createElement("span"); aircraft.textContent = `מטוס ${issue.sheet.aircraft || "—"} · טייסת ${issue.sheet.squadron || "—"}`;
      const team = document.createElement("span"); team.textContent = (issue.teamNames || [issue.assigneeName].filter(Boolean)).join(" · ") || "צוות טרם שובץ";
      const state = document.createElement("small"); state.textContent = issue.status === "closed" ? "סגורה" : issue.status === "pendingReview" ? "ממתינה לבקרת מנהל" : stage === "progress" ? "בתהליך" : "פתוחה";
      card.append(serial, aircraft, team, state); lane.append(card);
    }
    root.append(lane);
  }
}
