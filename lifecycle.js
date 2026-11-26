export function issueTimeline(issue) {
  if (!issue) return [];
  const events = [{ label: "נפתח", at: issue.createdAt }];
  if (issue.intake?.at) events.push({ label: "קליטת כלים וקשיחים לפני עבודה", at: issue.intake.at });
  for (const batch of issue.toolIntakes || []) events.push({ label: `נקלטו ${batch.tools?.length || 0} כלים נוספים בביקורת כניסה`, at: batch.at });
  for (const reopen of issue.reopenEvents || []) {
    events.push({ label: "נסגר", at: reopen.priorReviewedAt || reopen.priorClosedAt });
    events.push({ label: "נפתח לעריכה", at: reopen.at });
  }
  if (issue.status === "closed") events.push({ label: issue.paperClosure ? "נסגר על סמך טופס מודפס" : (issue.reopenEvents || []).length ? "נסגר לאחר עריכה" : "נסגר", at: issue.reviewedAt || issue.closed?.state?.closedAt });
  if (issue.status === "pendingReview") events.push({ label: (issue.reopenEvents || []).length ? "הוגש לסגירה לאחר עריכה" : "הוגש לסגירה", at: issue.closed?.state?.closedAt });
  if (issue.status === "cancelled") events.push({ label: `שילוח בוטל: ${issue.cancellationReason || "—"}`, at: issue.cancelledAt });
  return events.filter((event) => event.at);
}

export function keyLoadTimeline(load) {
  if (!load) return [];
  const events = [{ label: "נפתח", at: load.createdAt }];
  for (const reopen of load.reopenEvents || []) {
    events.push({ label: "נסגר", at: reopen.priorCompletedAt });
    events.push({ label: "נפתח לעריכה", at: reopen.at });
  }
  if (["pendingReview", "closed"].includes(load.status)) events.push({ label: "הוגש לבדיקת מטיס", at: load.completedAt });
  if (load.status === "closed") events.push({ label: "נסגר בחתימת מטיס", at: load.reviewedAt || load.completedAt });
  if (load.status === "cancelled") events.push({ label: `שילוח בוטל: ${load.cancellationReason || "—"}`, at: load.cancelledAt });
  return events.filter((event) => event.at);
}
