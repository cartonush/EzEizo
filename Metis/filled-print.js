import { pdfFromJpegs } from "./report-pdf.js?v=1.7.6";

const WIDTH = 1240;
const HEIGHT = 1754;
const templates = ["./print-template-1.jpg", "./print-template-2.jpg"];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("לא ניתן לטעון את תבנית ההדפסה."));
    image.src = src;
  });
}

function field(ctx, value, right, top, width, size = 18) {
  const content = String(value ?? "").trim();
  if (!content) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(right - width, top, width, 26); ctx.clip();
  ctx.fillStyle = "#182a32";
  ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "top";
  while (size > 11) {
    ctx.font = `${size}px Arial, sans-serif`;
    if (ctx.measureText(content).width <= width - 3) break;
    size -= 1;
  }
  ctx.fillText(content, right, top);
  ctx.restore();
}

function paragraph(ctx, value, right, top, width, maxLines = 2) {
  const content = String(value ?? "").trim();
  if (!content) return;
  ctx.save();
  ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "top";
  ctx.fillStyle = "#182a32"; ctx.font = "17px Arial, sans-serif";
  const lines = [];
  for (const rawLine of content.split(/\n/)) {
    let line = "";
    for (const word of rawLine.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
  }
  for (const [index, line] of lines.slice(0, maxLines).entries()) field(ctx, line, right, top + index * 25, width, 17);
  ctx.restore();
}

async function signature(ctx, dataUrl, x, y, width, height) {
  if (!dataUrl?.startsWith("data:image/png;base64,")) return;
  try {
    const image = await loadImage(dataUrl);
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    ctx.drawImage(image, x + (width - image.naturalWidth * scale) / 2, y + (height - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  } catch { /* Leave the signature space blank if the stored image cannot be decoded. */ }
}

function canvasFor(image) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function jpeg(canvas) {
  const base64 = canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function constants(ctx, groups) {
  // The printed blank form contains sample values. Cover only their value cells,
  // leaving the constant labels and the original table lines intact.
  ctx.fillStyle = "#d9ddde";
  ctx.fillRect(58, 404, 1124, 31);
  ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "top";
  ctx.fillStyle = "#182a32"; ctx.font = "bold 18px Arial, sans-serif";
  ctx.fillText("קבועים · ערכי המטוס", 1170, 408);
  const positions = {
    HUD: [[104, 477], [104, 500], [104, 523], [104, 546], [104, 569], [214, 477], [214, 500], [214, 523], [214, 546]],
    CTVS: [[331, 477], [331, 500], [331, 523], [331, 546], [331, 569], [440, 477], [440, 500], [440, 523], [440, 546]],
    CAMERA: [[558, 477], [558, 500], [558, 523], [558, 546], [558, 569]],
    TFL: [[810, 477], [810, 500]],
    INS: [[1028, 477], [1028, 500], [1028, 523]]
  };
  for (const [group, coords] of Object.entries(positions)) {
    (groups?.[group] || []).slice(0, coords.length).forEach(([, value], index) => {
      const [x, y] = coords[index];
      const maxWidth = group === "HUD" || group === "CTVS" ? 53 : group === "TFL" ? 135 : 80;
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 1, y - 2, maxWidth, 21);
      ctx.save();
      ctx.fillStyle = "#182a32"; ctx.direction = "ltr"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      let fontSize = 13;
      while (fontSize > 9) {
        ctx.font = `${fontSize}px Arial, sans-serif`;
        if (ctx.measureText(String(value ?? "")).width < maxWidth - 2) break;
        fontSize--;
      }
      ctx.fillText(String(value ?? ""), x, y);
      ctx.restore();
    });
  }
}

export async function createFilledFaultPdf(issue, dispatcherName) {
  const sheet = issue.sheet || {};
  const [first, second] = await Promise.all(templates.map(loadImage));
  await document.fonts?.ready;
  const { canvas: page1, ctx: a } = canvasFor(first);
  const { canvas: page2, ctx: b } = canvasFor(second);
  const opened = issue.createdAt ? new Date(issue.createdAt) : null;
  const date = opened && !Number.isNaN(opened.getTime()) ? opened.toLocaleDateString("he-IL") : "";
  const time = opened && !Number.isNaN(opened.getTime()) ? opened.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "";
  const team = sheet.technicians || (issue.teamNames || []).join(" · ");
  const firstNames = team.split("·").map((name) => name.trim().split(/\s+/)[0]).filter(Boolean).join(" · ");
  const shelter = sheet.shelter === "מוסך" && sheet.workshop ? sheet.workshop : sheet.shelter;
  const origins = (sheet.faultOrigins?.length ? sheet.faultOrigins : [sheet.faultOrigin]).filter(Boolean).join(" · ");

  [
    [sheet.serial, 1170, 243, 260], [sheet.squadron, 888, 243, 252], [shelter, 605, 243, 251], [sheet.aircraft, 323, 243, 251],
    [date, 1170, 300, 260], [time, 888, 300, 252], [sheet.systemName, 605, 300, 251], [sheet.systemCode, 323, 300, 251],
    [sheet.ewSystem, 1170, 356, 260], [origins, 888, 356, 252], [sheet.reviewCategory, 605, 356, 251]
  ].forEach(([value, right, top, width]) => field(a, value, right, top, width));
  const members = team.split("·").map((name) => name.trim()).filter(Boolean);
  const midpoint = Math.ceil(members.length / 2);
  if (members.length > 2) {
    field(a, members.slice(0, midpoint).join(" · "), 323, 357, 251, 12);
    field(a, members.slice(midpoint).join(" · "), 323, 374, 251, 12);
  } else field(a, team, 323, 356, 251);
  constants(a, sheet.constants);
  paragraph(a, sheet.fault, 1168, 682, 526, 3);
  paragraph(a, sheet.managerNotes, 602, 682, 526, 3);
  await signature(a, sheet.dispatcherSignature, 671, 1583, 112, 36);

  [
    [date, 1170, 80, 210], ["אוויוניקה קרב", 945, 80, 208], [sheet.squadron, 719, 80, 210], [shelter, 494, 80, 207], [sheet.aircraft, 267, 80, 198],
    [dispatcherName, 1168, 139, 125]
  ].forEach(([value, right, top, width]) => field(b, value, right, top, width));
  const technicianNames = firstNames.split("·").map((name) => name.trim()).filter(Boolean);
  if (technicianNames.length > 3) {
    const split = Math.ceil(technicianNames.length / 2);
    field(b, technicianNames.slice(0, split).join(" · "), 887, 135, 255, 13);
    field(b, technicianNames.slice(split).join(" · "), 887, 152, 255, 13);
  } else field(b, firstNames, 887, 139, 255);
  await signature(b, sheet.dispatcherSignature, 913, 135, 118, 30);

  return pdfFromJpegs([jpeg(page1), jpeg(page2)]);
}
