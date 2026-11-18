(function () {
  const ENDPOINT = "https://api.github.com/repos/cartonush/EzEizo/contents/data/issues.json";
  const TOKEN_KEY = "ezeizo-github-token-v1";
  const API_VERSION = "2022-11-28";
  const token = () => sessionStorage.getItem(TOKEN_KEY) || "";
  const encode = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const decode = (value) => {
    const binary = atob(value.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(binary, (letter) => letter.charCodeAt(0)));
  };
  const headers = () => ({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    ...(token() ? { Authorization: `Bearer ${token()}` } : {})
  });
  function validate(document) {
    if (document?.version !== 1 || !Array.isArray(document.issues)) throw new Error("קובץ התקלות ב־GitHub אינו תקין.");
    return document;
  }
  async function errorFor(response) {
    if (response.status === 401 || response.status === 403) return new Error("אין גישה ל־GitHub. בדוק שההרשאה בתוקף וכוללת Contents: Read and write ל־EzEizo.");
    if (response.status === 404) return new Error("קובץ data/issues.json לא נמצא ב־main.");
    return new Error(`הבקשה ל־GitHub נכשלה (${response.status}).`);
  }
  async function read() {
    let response;
    try { response = await fetch(`${ENDPOINT}?ref=main&_=${Date.now()}`, { headers: headers(), cache: "no-store" }); }
    catch { throw new Error("אין חיבור ל־GitHub. בדוק את החיבור לאינטרנט."); }
    if (!response.ok) throw await errorFor(response);
    const file = await response.json();
    if (!file.content || !file.sha) throw new Error("קובץ התקלות גדול מדי לקריאה דרך GitHub.");
    return { document: validate(JSON.parse(decode(file.content))), sha: file.sha };
  }
  async function mutate(change, message) {
    if (!token()) throw new Error("כדי לשמור ב־GitHub יש להזין הרשאת כתיבה.");
    for (let attempt = 0; attempt < 4; attempt++) {
      const { document, sha } = await read();
      const result = change(document);
      const response = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: encode(document), sha, branch: "main" })
      });
      if (response.ok) return { result, document };
      if (response.status === 409 || response.status === 422) continue;
      throw await errorFor(response);
    }
    throw new Error("התקלות עודכנו במקביל. נסה שוב.");
  }
  async function createIssue(draft) {
    return mutate((document) => {
      const max = document.issues.reduce((value, entry) => Math.max(value, Number(entry.sheet?.serial) || 0), 0);
      const sheet = EzEizoData.normalizeSheet(draft);
      sheet.id = crypto.randomUUID();
      sheet.serial = String(max + 1).padStart(6, "0");
      document.issues.unshift({ sheet, closed: null });
      return sheet;
    }, "Open EzEizo fault");
  }
  async function closeIssue(id, record, state) {
    return mutate((document) => {
      const entry = document.issues.find((item) => item.sheet?.id === id);
      if (!entry) throw new Error("התקלה כבר אינה קיימת ב־GitHub.");
      if (entry.closed) throw new Error("התקלה כבר נסגרה ממכשיר אחר.");
      if (record.id !== id || record.serial !== entry.sheet.serial || !Array.isArray(state.actions) || state.actions.length !== 12 || !state.actions.every(Boolean) || !state.completionTime) throw new Error("לא ניתן לסגור: חסרות פעולות או שעת סיום.");
      entry.closed = { record, state };
      return entry;
    }, `Close EzEizo fault ${record.serial}`);
  }
  async function importLocal(issues, closed, getState) {
    return mutate((document) => {
      let added = 0;
      let max = document.issues.reduce((value, entry) => Math.max(value, Number(entry.sheet?.serial) || 0), 0);
      const used = new Set(document.issues.map((entry) => entry.sheet?.serial));
      for (const local of issues) {
        if (!local || typeof local.id !== "string" || local.id === "example" || document.issues.some((entry) => entry.sheet?.id === local.id)) continue;
        const sheet = EzEizoData.normalizeSheet(local);
        if (!/^\d{6}$/.test(sheet.serial) || used.has(sheet.serial)) sheet.serial = String(++max).padStart(6, "0");
        else max = Math.max(max, Number(sheet.serial));
        used.add(sheet.serial);
        const record = closed.find((entry) => entry.id === local.id);
        const state = record && getState(local.id);
        const validClosed = state && state.closedAt === record.closedAt && state.completionTime && state.actions?.length === 12 && state.actions.every(Boolean);
        document.issues.unshift({ sheet, closed: validClosed ? { record: { ...record, serial: sheet.serial }, state } : null });
        added++;
      }
      return added;
    }, "Import local EzEizo faults");
  }
  window.EzEizoGitHub = { read, createIssue, closeIssue, importLocal, hasToken: () => Boolean(token()), setToken: (value) => sessionStorage.setItem(TOKEN_KEY, value.trim()), clearToken: () => sessionStorage.removeItem(TOKEN_KEY) };
})();
