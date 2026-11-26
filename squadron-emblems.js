const EMBLEMS = {
  "101": "101.png",
  "105": "105.png",
  "109": "109.png",
  "מנ״ט": "mant.png",
  "מנט": "mant.png"
};

export function squadronEmblem(name) {
  const filename = EMBLEMS[String(name || "").trim()];
  return filename ? new URL(`./assets/emblems/${filename}`, import.meta.url).href : "";
}

export function makeSquadronEmblem(name) {
  const src = squadronEmblem(name);
  if (!src) return null;
  const image = document.createElement("img");
  image.className = "squadron-emblem";
  image.src = src;
  image.alt = "";
  image.loading = "lazy";
  return image;
}
