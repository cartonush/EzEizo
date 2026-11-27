import { gate, revealApp, getIssue, getAccountName } from "../firebase-sync.js?v=1.9.24";
import { createFilledFaultPdf } from "./filled-print.js?v=1.9.24";

const status = document.querySelector("#print-status");
try {
  const user = await gate("manager");
  revealApp();
  const id = new URLSearchParams(location.search).get("id");
  if (!id) throw new Error("חסר מספר מזהה לתקלה.");
  const issue = await getIssue(id);
  if (!issue?.manualPaper) throw new Error("התקלה הידנית לא נמצאה.");
  status.textContent = "יוצר PDF עם פרטי התקלה…";
  const dispatcherName = await getAccountName(issue.manualCreatedBy).catch(() => "") || user.name || "";
  const pdf = await createFilledFaultPdf(issue, dispatcherName);
  location.replace(URL.createObjectURL(pdf));
} catch (error) {
  status.textContent = `לא ניתן להכין את הטופס: ${error.message}`;
}
