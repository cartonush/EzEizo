export const VOLUMES = [
  { name: "בקרי", code: "0235" },
  { name: "קשר", code: "0859-9" },
  { name: "ל״א", code: "0859-0" }
];

export const DEFAULT_SYSTEMS = [
  { id: "system_fcr", name: "מכם | FCR", code: "74A", volume: "0235" },
  { id: "system_tcn", name: "טאקאן | TCN", code: "63A", volume: "0859-9" },
  { id: "system_ew", name: "אימפריה פאסיבית", code: "76E", volume: "0859-0" }
];
export const DEFAULT_COMPONENTS = ["ANT", "DMT", "MLPRF", "PSP"].map((name) => ({ id: `component_${name.toLowerCase()}`, name, systemId: "system_fcr" }));

export function mergeCatalog(defaults, saved) {
  const result = new Map(defaults.map((item) => [item.id, item]));
  for (const item of saved) result.set(item.id, { ...result.get(item.id), ...item, volume: item.volume || result.get(item.id)?.volume || "" });
  return [...result.values()];
}

export function volumeLabel(code) {
  const volume = VOLUMES.find((item) => item.code === code);
  return volume ? `כרך ${volume.name} · ${volume.code}` : code || "לא שויך כרך";
}
