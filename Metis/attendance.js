export const RANK_ORDER = ["רסן", "סרן", "סגן", "סגם", "רנג", "רסב", "רסמ", "רסר", "רסל", "סמר", "סמל", "רבט", "טוראי"];
export const REGULAR_RANKS = ["טוראי", "רבט", "סמל", "סמר"];
export const PERMANENT_RANKS = ["סמר", "סמל", "רסל", "רסר", "רסמ", "רסב", "רנג", "סגם", "סגן", "סרן", "רסן"];
export const LICENSES = ["אין", "אוטומטי", "ידני"];
export const DEPARTMENTS = ["דרג א", "קשר", "ברקת", "תחקור", "חלון לוגיסטי", "הטסה"];
export const WORK_STAGES = ["1", "7", "9", "11"];
export const SERVICE_TYPES = ["חובה", "קבע"];
export const ATTENDANCE_STATUSES = [
  ["נוכח", ""], ["רענון", "#6587cf"], ["גימלים", "#e43228"], ["בדרך", "#e3cf45"],
  ["שמירות", "#d4a782"], ["הפניה", "#d6aa30"], ["אבט״ש", "#9aacc5"],
  ["ליווי קבלנים", "#d58c88"], ["רס״ר", "#a95835"], ["יוצא", "#33c8d7"],
  ["בח״א 10", "#d1d8ad"], ["נהג מנהלות", "#a7c88c"], ["מחוץ ליחידה", "#168ed2"],
  ["הרצאות", "#079a40"], ["צוות לילה", "#56368e"]
];
const OFFICERS = new Set(["סגם", "סגן", "סרן", "רסן"]);
const rankIndex = (rank) => { const index = RANK_ORDER.indexOf(rank); return index < 0 ? RANK_ORDER.length : index; };
const nameSort = (a, b) => (a.name || "").localeCompare(b.name || "", "he");
export const permanentService = (value) => /קבע/.test(value || "");

export function attendanceGroups(accounts) {
  const people = accounts.filter((person) => !person.deleted && person.active !== false);
  const mandatory = people.filter((person) => /חובה/.test(person.serviceType || ""));
  const remaining = mandatory.filter((person) => String(person.workStage || "").trim() !== "11");
  const groups = [
    { title: "כפלים · חובה · שלב 11", people: mandatory.filter((person) => String(person.workStage || "").trim() === "11").sort(nameSort), style: "trainees" },
    ...DEPARTMENTS.map((department) => ({
      title: `מחלקת ${department}`,
      people: remaining.filter((person) => (person.department || "").trim() === department).sort(nameSort),
      style: "regular"
    })),
    { title: "חובה · מחלקות נוספות", people: remaining.filter((person) => !DEPARTMENTS.includes((person.department || "").trim())).sort(nameSort), style: "regular" },
    { title: "קבע", people: people.filter((person) => permanentService(person.serviceType)).sort((a, b) => rankIndex(a.rank) - rankIndex(b.rank) || nameSort(a, b)), style: "permanent" },
    { title: "ללא סוג שירות", people: people.filter((person) => !/חובה|קבע/.test(person.serviceType || "")).sort(nameSort), style: "regular" }
  ];
  return groups.filter((group) => group.people.length);
}

export function renderAttendance(accounts, onStatusChange = () => {}) {
  const root = document.querySelector("#attendance-groups");
  root.replaceChildren();
  const groups = attendanceGroups(accounts);
  if (!groups.length) { root.textContent = "אין טכנאים פעילים להצגה."; return; }
  for (const group of groups) {
    const section = document.createElement("section"); section.className = "attendance-group";
    const heading = document.createElement("h3"); heading.textContent = `${group.title} · ${group.people.length}`;
    const wrap = document.createElement("div"); wrap.className = "table-wrap";
    const table = document.createElement("table"); table.className = "attendance-table";
    const thead = document.createElement("thead");
    const head = document.createElement("tr");
    for (const title of ["שם", "שם משפחה", "מספר אישי", "נוכחות", "שלב עבודה / הסמכה", "מחלקה", "סוג שירות", "דרגה", "רישיון"]) {
      const th = document.createElement("th"); th.textContent = title; head.append(th);
    }
    thead.append(head);
    const body = document.createElement("tbody");
    for (const person of group.people) {
      const row = document.createElement("tr");
      row.className = !permanentService(person.serviceType) && OFFICERS.has(person.rank) ? "attendance-officer" : `attendance-${group.style}`;
      const status = ATTENDANCE_STATUSES.find(([name]) => name === person.attendanceStatus) || ATTENDANCE_STATUSES[0];
      if (status[1]) { row.classList.add("attendance-status-row"); if (["גימלים", "רס״ר", "מחוץ ליחידה", "הרצאות", "צוות לילה"].includes(status[0])) row.classList.add("attendance-status-dark"); row.style.setProperty("--attendance-status-color", status[1]); }
      const parts = (person.name || "").trim().split(/\s+/);
      const qualification = [person.workStage ? `שלב ${person.workStage}` : "", person.magatCertified ? "מג״ת" : ""].filter(Boolean).join(" · ");
      const values = [person.firstName || parts[0], person.lastName || parts.slice(1).join(" "), person.personalNumber, null, qualification, person.department, person.serviceType, person.rank, person.license || "אין"];
      values.forEach((value, index) => {
        const cell = document.createElement("td"); cell.dataset.label = head.children[index].textContent;
        if (index === 3) {
          const select = document.createElement("select"); select.setAttribute("aria-label", `נוכחות · ${person.name}`);
          for (const [name] of ATTENDANCE_STATUSES) select.append(new Option(name, name));
          select.value = status[0];
          select.addEventListener("change", async () => {
            select.disabled = true;
            try { await onStatusChange(person.uid, select.value); }
            catch (error) { select.value = status[0]; window.alert(`עדכון הנוכחות נכשל: ${error.message}`); }
            finally { select.disabled = false; }
          });
          cell.append(select);
        } else cell.textContent = value || "—";
        row.append(cell);
      });
      body.append(row);
    }
    table.append(thead, body); wrap.append(table); section.append(heading, wrap); root.append(section);
  }
}
