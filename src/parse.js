// Parse an uploaded file into { columns: string[], rows: object[] }.

export function parseCSV(text, delim) {
  if (!delim) {
    const head = text.slice(0, 2000).split("\n")[0] || "";
    delim = [",", "\t", ";", "|"].reduce((a, d) => (head.split(d).length > head.split(a).length ? d : a), ",");
  }
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') (cell += '"'), i++;
        else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  if (!rows.length) return { columns: [], rows: [] };
  const header = rows[0].map((h, i) => h.trim() || `column ${i + 1}`);
  const columns = header.map((h, i) => (header.indexOf(h) === i ? h : `${h} (${i + 1})`));
  return {
    columns,
    rows: rows.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ""]))),
  };
}

function fromObjects(list) {
  const rows = list.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? x : { value: typeof x === "string" ? x : JSON.stringify(x) }));
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return {
    columns,
    rows: rows.map((r) =>
      Object.fromEntries(columns.map((c) => [c, r[c] == null ? "" : typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c])])),
    ),
  };
}

export function parseLines(text) {
  return { columns: ["line"], rows: text.split(/\r?\n/).filter((l) => l.trim()).map((line) => ({ line })) };
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const XLSX = await import("xlsx"); // loaded only when a spreadsheet is opened
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    return { ...fromObjects(data), sheet: wb.SheetNames[0] };
  }
  const text = await file.text();
  if (/\.(csv)$/.test(name)) return parseCSV(text, ",");
  if (/\.(tsv|tab)$/.test(name)) return parseCSV(text, "\t");
  if (/\.json$/.test(name)) {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.rows) ? j.rows : [j];
    return fromObjects(list);
  }
  if (/\.(jsonl|ndjson)$/.test(name)) {
    return fromObjects(text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return l;
      }
    }));
  }
  return parseLines(text); // .log, .txt and anything else: one row per line
}

/** Columns that look like text worth classifying (not ids, dates or numbers). */
export function guessTextColumns(columns, rows) {
  const sample = rows.slice(0, 200);
  const scored = columns.map((c) => {
    const vals = sample.map((r) => String(r[c] ?? ""));
    const avgLen = vals.reduce((a, v) => a + v.length, 0) / (vals.length || 1);
    const numeric = vals.filter((v) => v && !isNaN(Number(v))).length / (vals.length || 1);
    return { c, score: numeric > 0.8 ? 0 : avgLen };
  });
  const best = Math.max(...scored.map((s) => s.score));
  return scored.filter((s) => s.score > 0 && s.score >= best * 0.35).map((s) => s.c);
}

export function toCSV(columns, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}
