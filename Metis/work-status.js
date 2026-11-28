export function issueWorkStage(issue) {
  if (issue.status === "open") return issue.startedAt ? "progress" : "start";
  if (issue.status === "pendingReview" || issue.status === "closed") return "finished";
  return null;
}

export function issueStageDate(issue) {
  const stage = issueWorkStage(issue);
  if (stage === "start") return issue.intake?.at || issue.createdAt;
  if (stage === "progress") return issue.startedAt || issue.workDraft?.savedAt;
  if (stage === "finished") return issue.status === "closed"
    ? issue.reviewedAt || issue.closed?.state?.closedAt || issue.closed?.record?.closedAt
    : issue.closed?.state?.closedAt || issue.closed?.record?.closedAt;
  return null;
}

export function isToday(value, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function visibleWorkIssues(issues, now = new Date()) {
  const end = now.getTime(), start = end - 24 * 60 * 60 * 1000;
  return issues.filter((issue) => {
    const at = new Date(issueStageDate(issue)).getTime();
    return issue.sheet && issueWorkStage(issue) && Number.isFinite(at) && at >= start && at <= end;
  });
}

let midnightRefresh;
export function renderWorkStatus(issues) {
  const root = document.querySelector("#work-status-board");
  root.replaceChildren();
  const now = new Date();
  document.querySelector("#work-status-date").textContent = `תקלות עם פעילות ב־24 השעות האחרונות · עד ${new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(now)}`;
  clearTimeout(midnightRefresh);
  midnightRefresh = setTimeout(() => renderWorkStatus(issues), 60_000);
  const unique = visibleWorkIssues(issues, now);
  for (const [stage, title, hint] of [["start", "תחילת עבודה", "פתוחות · טרם נשמרה תחילת העבודה לאחר חתימת בטיחות המטוס"], ["progress", "מהלך עבודה", "חתימת בטיחות נשמרה"], ["finished", "סיום עבודה", "ממתינות לבקרה או סגורות"]]) {
    const lane = document.createElement("section"); lane.className = `work-status-lane work-status-${stage}`;
    const group = unique.filter((item) => issueWorkStage(item) === stage).sort((a, b) => String(issueStageDate(b)).localeCompare(String(issueStageDate(a))));
    const heading = document.createElement("h3"); heading.textContent = `${title} · ${group.length}`;
    const description = document.createElement("p"); description.textContent = hint;
    lane.append(heading, description);
    if (!group.length) { const empty = document.createElement("p"); empty.className = "work-status-empty"; empty.textContent = "אין תקלות בשלב זה."; lane.append(empty); }
    for (const issue of group) {
      const card = document.createElement("article"); card.className = "work-status-card";
      const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "work-status-toggle";
      toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", `הצג פרטי תקלה ${issue.sheet.serial}`);
      const serial = document.createElement("strong"); serial.textContent = `תקלה ${issue.sheet.serial}`;
      const aircraft = document.createElement("span"); aircraft.textContent = `מטוס ${issue.sheet.aircraft || "—"} · טייסת ${issue.sheet.squadron || "—"}`;
      const team = document.createElement("span"); team.textContent = (issue.teamNames || [issue.assigneeName].filter(Boolean)).join(" · ") || "צוות טרם שובץ";
      const state = document.createElement("small"); state.textContent = issue.status === "closed" ? "סגורה" : issue.status === "pendingReview" ? "ממתינה לבקרת מטיס" : stage === "progress" ? "בתהליך" : "פתוחה";
      const legacy = issue.closed?.state || issue.workDraft?.state;
      const tools = issue.acceptedTools || (legacy?.entryInspectorSignature && legacy?.entryTechnicianSignature ? (legacy.tools || []).filter((row) => row.toolName && row.toolNumber) : []);
      toggle.append(serial, aircraft, team, state);
      if (tools.length) { const count = document.createElement("span"); count.textContent = `כלים שנצרכו: ${tools.length}`; toggle.append(count); }
      const details = document.createElement("div"); details.className = "work-status-details"; details.hidden = true;
      for (const [label, value] of [["מיקום", issue.sheet.location || issue.sheet.shelter], ["תיאור תקלה", issue.sheet.fault], ["סוג התקלה", (issue.sheet.faultOrigins?.length ? issue.sheet.faultOrigins : [issue.sheet.faultOrigin].filter(Boolean)).join(" · ") || issue.sheet.reviewCategory]]) {
        const line = document.createElement("p"); const title = document.createElement("strong"); title.textContent = `${label}: `;
        line.append(title, document.createTextNode(value || "—")); details.append(line);
      }
      if (tools.length) { const heading = document.createElement("strong"); heading.textContent = "כלים שנקלטו בביקורת כניסה"; const list = document.createElement("ul");
        tools.forEach((tool) => { const item = document.createElement("li"); item.textContent = `${tool.toolName} – ${tool.toolNumber}`; list.append(item); });
        details.append(heading, list); }
      const link = document.createElement("a"); link.className = "secondary-button";
      link.href = issue.status === "closed" ? `./closed.html?id=${encodeURIComponent(issue.id)}` : stage === "finished" ? "#pending" : stage === "progress" ? "#in-progress" : "#open";
      link.textContent = "פתח את דף התקלה"; details.append(link);
      toggle.addEventListener("click", () => { details.hidden = !details.hidden; toggle.setAttribute("aria-expanded", String(!details.hidden)); });
      card.append(toggle, details); lane.append(card);
    }
    root.append(lane);
  }
}
