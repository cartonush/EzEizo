import { watchAircraftConstants, saveAircraftConstants } from "../firebase-sync.js?v=1.4.9";
import { SQUADRONS } from "./catalog.js?v=1.4.9";

const $ = (selector) => document.querySelector(selector);
const byDate = (value) => value ? new Date(value).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—";
const localDateTime = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const option = (label, value = label) => new Option(label, value);
const element = (tag, content, className) => { const node = document.createElement(tag); if (content != null) node.textContent = content; if (className) node.className = className; return node; };

let aircraftProfiles = new Map();
let selectedAircraft = "";
let selectedSquadron = "";
let editorDirty = false;
let reportIssues = [];
let reportLoads = [];
let reportUsers = [];
let reportRows = [];

function baseConstants() {
  return structuredClone(EzEizoData.defaultSheet.constants);
}

export function constantsForAircraft(squadron, aircraft) {
  const values = aircraftProfiles.get(`${squadron}_${aircraft}`)?.constants || {};
  return Object.fromEntries(Object.entries(baseConstants()).map(([group, entries]) => [group, entries.map(([name, initial]) => [name, String(values[group]?.[name] ?? initial)])]));
}

function selectOptions(select, values, placeholder) {
  const current = select.value;
  select.replaceChildren(option(placeholder, ""), ...values.map((value) => option(value)));
  select.value = values.includes(current) ? current : "";
}

function renderAircraftList() {
  const list = $("#constants-aircraft-list"); list.replaceChildren();
  if (!selectedSquadron) { list.textContent = "בחר טייסת כדי להציג את המטוסים שלה."; return; }
  SQUADRONS[selectedSquadron].aircraft.forEach((aircraft) => {
    const button = element("button", `מטוס ${aircraft}${aircraftProfiles.has(`${selectedSquadron}_${aircraft}`) ? " · עודכן" : ""}`, "secondary-button");
    button.type = "button";
    if (selectedAircraft === aircraft) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => { selectedAircraft = aircraft; editorDirty = false; $("#constants-picker").hidden = true; renderConstantsEditor(); });
    list.append(button);
  });
}

function renderConstantsEditor() {
  const section = $("#constants-editor"); section.hidden = !selectedAircraft;
  if (!selectedAircraft) return;
  $("#constants-aircraft-title").textContent = `טייסת ${selectedSquadron} · מטוס ${selectedAircraft}`;
  const container = $("#constants-fields"); container.replaceChildren();
  Object.entries(constantsForAircraft(selectedSquadron, selectedAircraft)).forEach(([group, entries]) => {
    const card = element("section", null, "constant-group"); card.dataset.group = group;
    card.append(element("h3", group));
    const grid = element("div", null, "manager-constant-list");
    entries.forEach(([name, value]) => {
      const field = element("label", null, "manager-constant-row");
      const input = document.createElement("input"); input.type = "text"; input.inputMode = "numeric"; input.maxLength = 80; input.value = value; input.dataset.name = name;
      input.addEventListener("input", () => { editorDirty = true; });
      field.append(element("span", name), input); grid.append(field);
    });
    card.append(grid); container.append(card);
  });
  const profile = aircraftProfiles.get(`${selectedSquadron}_${selectedAircraft}`);
  $("#constants-status").textContent = profile ? `עודכן לאחרונה: ${byDate(profile.updatedAt)}` : "ערכי הפתיחה זהים לקבועים שנמסרו לכל המטוסים.";
  delete $("#constants-status").dataset.state;
}

export function initAircraftConstants({ user, onProfilesLoaded }) {
  const squadronSelect = $("#constants-squadron");
  selectOptions(squadronSelect, Object.keys(SQUADRONS), "בחר טייסת");
  squadronSelect.addEventListener("change", () => {
    selectedSquadron = squadronSelect.value; selectedAircraft = ""; editorDirty = false;
    $("#constants-editor").hidden = true; renderAircraftList();
  });
  $("#constants-close").addEventListener("click", closeConstantsEditor);
  $("#constants-save").addEventListener("click", async () => {
    if (!selectedSquadron || !SQUADRONS[selectedSquadron].aircraft.includes(selectedAircraft)) return;
    const values = {};
    for (const group of $("#constants-fields").querySelectorAll("[data-group]")) {
      values[group.dataset.group] = {};
      for (const input of group.querySelectorAll("input")) {
        const value = input.value.trim();
        if (!/^-?\d{1,18}$/.test(value)) { $("#constants-status").textContent = `יש להזין מספר תקין עבור ${group.dataset.group} ${input.dataset.name}.`; $("#constants-status").dataset.state = "error"; input.focus(); return; }
        values[group.dataset.group][input.dataset.name] = value;
      }
    }
    const button = $("#constants-save"); button.disabled = true;
    try { await saveAircraftConstants(selectedSquadron, selectedAircraft, values, user.uid); editorDirty = false; $("#constants-status").textContent = "הקבועים נשמרו למטוס. תקלות חדשות שייפתחו למטוס יקבלו אותם."; delete $("#constants-status").dataset.state; }
    catch (error) { $("#constants-status").textContent = `השמירה נכשלה: ${error.message}`; $("#constants-status").dataset.state = "error"; }
    finally { button.disabled = false; }
  });
  watchAircraftConstants((profiles) => {
    aircraftProfiles = new Map(profiles.map((profile) => [profile.id, profile]));
    renderAircraftList(); if (selectedAircraft && !editorDirty) renderConstantsEditor();
    onProfilesLoaded?.();
  }, (error) => { $("#constants-aircraft-list").textContent = `טעינת קבועים נכשלה: ${error.message}`; $("#constants-aircraft-list").dataset.state = "error"; });
  renderAircraftList();
}

export function closeConstantsEditor() {
  if (!selectedAircraft) return false;
  selectedAircraft = ""; editorDirty = false; $("#constants-editor").hidden = true; $("#constants-picker").hidden = false; renderAircraftList();
  return true;
}

function statusLabel(status) { return ({ open: "פתוח", pendingReview: "ממתין לסגירה", closed: "סגור" })[status] || status; }
function reportRecords() {
  const faults = reportIssues.map((issue) => ({
    id: issue.id, type: "issue", kind: "תקלה", serial: issue.sheet?.serial || "—", squadron: issue.sheet?.squadron || "", aircraft: issue.sheet?.aircraft || "", technician: issue.assigneeName || "—", technicianUids: [issue.assigneeUid], status: issue.status, title: issue.sheet?.fault || "—", openedAt: issue.createdAt, closedAt: issue.closed?.state?.closedAt || "", eventAt: issue.status === "closed" ? (issue.reviewedAt || issue.closed?.state?.closedAt || issue.createdAt) : issue.status === "pendingReview" ? (issue.closed?.state?.closedAt || issue.createdAt) : (issue.reopenedAt || issue.createdAt)
  }));
  const keys = reportLoads.flatMap((load) => (load.aircraftIds || []).map((aircraft) => ({
    id: load.id, type: "key", kind: "מפתחות", serial: "—", squadron: load.squadron, aircraft, technician: (load.teamNames || []).join(" · ") || "—", technicianUids: load.teamUids || [], status: load.status, title: `הטענת מפתחות ${load.period || ""}`.trim(), openedAt: load.createdAt, closedAt: load.completedAt || "", eventAt: load.status === "closed" ? (load.completedAt || load.createdAt) : (load.reopenedAt || load.createdAt)
  })));
  return [...faults, ...keys];
}

const reportTitles = { journal: "יומן פעילות", aircraft: "היסטוריית מטוס", technician: "פעילות טכנאי", squadron: "סיכום טייסת", pending: "דפים הממתינים לסגירה" };
function reportState() {
  const squadron = $("#report-squadron").value;
  const mode = document.querySelector('[name="report-mode"]:checked').value;
  const allAircraft = $("#report-all-aircraft").checked;
  const aircraft = $("#report-aircraft").value;
  const technician = $("#report-technician").value;
  const from = new Date($("#report-from").value).getTime();
  const to = new Date($("#report-to").value).getTime();
  const kind = $("#report-kind").value;
  const status = kind === "pending" ? "pendingReview" : $("#report-status").value;
  const type = kind === "pending" ? "issue" : $("#report-form").value;
  const error = !squadron ? "בחר טייסת כדי להציג דוח." : !Number.isFinite(from) || !Number.isFinite(to) || from > to ? "בחר טווח תאריכים תקין." : mode === "aircraft" && !allAircraft && !aircraft ? "בחר מטוס מהרשימה או סמן את כל מטוסי הטייסת." : mode === "technician" && !technician ? "בחר טכנאי מהרשימה." : "";
  return { squadron, mode, allAircraft, aircraft, technician, from, to, kind, status, type, error };
}

function makeReportRows(state) {
  if (state.error) return [];
  return reportRecords().filter((row) => row.squadron === state.squadron
    && (state.type === "all" || row.type === state.type)
    && (state.status === "all" || row.status === state.status)
    && (state.mode === "technician" ? row.technicianUids.includes(state.technician) : state.allAircraft || row.aircraft === state.aircraft)
    && new Date(row.eventAt).getTime() >= state.from && new Date(row.eventAt).getTime() <= state.to)
    .sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt));
}

function renderReport() {
  const state = reportState();
  const error = $("#report-error"); error.textContent = state.error; error.dataset.state = state.error ? "error" : "";
  $("#report-title").textContent = reportTitles[state.kind];
  const subject = state.mode === "technician" ? `טכנאי: ${reportUsers.find((user) => user.uid === state.technician)?.name || "—"}` : state.allAircraft ? "כל מטוסי הטייסת" : `מטוס ${state.aircraft || "—"}`;
  $("#report-period").textContent = `טייסת ${state.squadron || "—"} · ${subject} · ${byDate(state.from)} עד ${byDate(state.to)} · ${state.type === "all" ? "כל סוגי הטפסים" : state.type === "issue" ? "תקלות" : "מפתחות"} · ${state.status === "all" ? "כל המצבים" : statusLabel(state.status)}`;
  reportRows = makeReportRows(state);
  const forms = new Set(reportRows.map((row) => `${row.type}:${row.type === "issue" ? row.serial : row.id}`));
  $("#report-count").textContent = state.error ? "" : `${reportRows.length} רשומות · ${forms.size} טפסים`;
  $("#report-print").disabled = $("#report-csv").disabled = Boolean(state.error || !reportRows.length);
  const summary = $("#report-summary"); summary.replaceChildren();
  if (!state.error) {
    const counts = [["תקלות", reportRows.filter((r) => r.type === "issue").length], ["מטוסים בהטענות", reportRows.filter((r) => r.type === "key").length], ["פתוח", reportRows.filter((r) => r.status === "open").length], ["ממתין לסגירה", reportRows.filter((r) => r.status === "pendingReview").length], ["סגור", reportRows.filter((r) => r.status === "closed").length]];
    counts.forEach(([label, amount]) => { const item = element("div", null, "report-stat"); item.append(element("strong", String(amount)), element("span", label)); summary.append(item); });
  }
  const results = $("#report-results"); results.replaceChildren();
  if (state.error || !reportRows.length) { results.textContent = state.error ? "" : "אין רשומות שמתאימות לסינון הזה."; return; }
  reportRows.forEach((row) => {
    const card = element("article", null, "report-entry");
    const heading = element("div", null, "report-entry-heading");
    const title = element("h3", `${row.kind} · מטוס ${row.aircraft}`);
    heading.append(title, element("span", statusLabel(row.status), "report-entry-status"));
    const description = element("p", row.title, "report-entry-description");
    const details = element("dl", null, "report-entry-details");
    [["מספר תקלה", row.serial], ["טכנאי / צוות", row.technician], ["מועד הפעילות", byDate(row.eventAt)], ["נפתח", byDate(row.openedAt)], ["נסגר", byDate(row.closedAt)]].forEach(([label, value]) => {
      const pair = element("div"); pair.append(element("dt", label), element("dd", value)); details.append(pair);
    });
    const link = element("a", "פתח טופס", "secondary-button");
    link.href = row.type === "key" ? `#keys/work/${encodeURIComponent(row.id)}` : row.status === "open" ? "#open" : `./closed.html?id=${encodeURIComponent(row.id)}`;
    if (row.type === "issue" && row.status === "open") link.textContent = "הצג ברשימה";
    card.append(heading, description, details, link); results.append(card);
  });
}

function refreshReportSelectors() {
  const squadron = $("#report-squadron").value;
  selectOptions($("#report-aircraft"), SQUADRONS[squadron]?.aircraft || [], "בחר מטוס");
  const current = $("#report-technician").value;
  const select = $("#report-technician"); select.replaceChildren(option("בחר טכנאי", ""), ...reportUsers.map((user) => option(`${user.name}${user.active ? "" : " (הוסר)"}`, user.uid)));
  select.value = reportUsers.some((user) => user.uid === current) ? current : "";
  const isAircraft = document.querySelector('[name="report-mode"]:checked').value === "aircraft";
  $("#report-aircraft-fields").hidden = !isAircraft;
  $("#report-technician-field").hidden = isAircraft;
  $("#report-aircraft-field").hidden = $("#report-all-aircraft").checked;
}

export function updateReportData({ issues, loads, users } = {}) {
  if (issues) reportIssues = issues;
  if (loads) reportLoads = loads;
  if (users) reportUsers = users;
  refreshReportSelectors(); renderReport();
}

export function initReports() {
  selectOptions($("#report-squadron"), Object.keys(SQUADRONS), "בחר טייסת");
  const now = new Date();
  $("#report-to").value = localDateTime(now);
  $("#report-from").value = localDateTime(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  $("#view-reports").querySelectorAll("input, select").forEach((control) => control.addEventListener("change", () => { refreshReportSelectors(); renderReport(); }));
  $("#report-kind").addEventListener("change", () => {
    const kind = $("#report-kind").value;
    if (kind === "aircraft") { document.querySelector('[name="report-mode"][value="aircraft"]').checked = true; $("#report-all-aircraft").checked = false; }
    if (kind === "technician") document.querySelector('[name="report-mode"][value="technician"]').checked = true;
    if (kind === "pending") { $("#report-form").value = "issue"; $("#report-status").value = "pendingReview"; }
    refreshReportSelectors(); renderReport();
  });
  $("#report-print").addEventListener("click", () => window.print());
  $("#report-csv").addEventListener("click", () => {
    const cell = (value) => `"${String(value ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const lines = [["מועד", "טייסת", "סוג", "מטוס", "מספר תקלה", "עבודה", "טכנאי / צוות", "מצב", "שעת פתיחה", "שעת סגירה"], ...reportRows.map((row) => [byDate(row.eventAt), row.squadron, row.kind, row.aircraft, row.serial, row.title, row.technician, statusLabel(row.status), byDate(row.openedAt), byDate(row.closedAt)])];
    const url = URL.createObjectURL(new Blob(["\uFEFF", lines.map((line) => line.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `EzEizo-report-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  refreshReportSelectors(); renderReport();
}
