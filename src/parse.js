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

/**
 * Real exports are messy: a title line or blank rows above the table, empty columns, odd separators.
 * Find the header as the first row that is about as wide as the table and mostly text.
 */
export function detectHeader(matrix) {
  const filled = (r) => r.filter((c) => String(c ?? "").trim() !== "");
  const width = Math.max(0, ...matrix.slice(0, 50).map((r) => filled(r).length));
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const cells = filled(matrix[i]);
    if (!cells.length || cells.length < Math.max(1, width * 0.6)) continue;
    const texty = cells.filter((c) => isNaN(Number(c))).length;
    if (texty >= cells.length * 0.6) return i;
    return width === 1 ? -1 : i;
  }
  return matrix.findIndex((r) => filled(r).length);
}

/** Turn a grid of cells into columns + rows. rowNumbers maps each row back to its place in the source. */
export function fromMatrix(matrix, firstRowNumber = 1) {
  if (!matrix.length) return { columns: [], rows: [], rowNumbers: [], headerRow: 1 };
  const headerIdx = detectHeader(matrix);
  const width = Math.max(...matrix.map((r) => r.length));
  const head = headerIdx >= 0 ? matrix[headerIdx] : [];
  const keep = [];
  for (let c = 0; c < width; c++) if (matrix.some((r) => String(r[c] ?? "").trim() !== "")) keep.push(c);
  const names = keep.map((c, i) => String(head[c] ?? "").trim() || `column ${i + 1}`);
  const columns = names.map((h, i) => (names.indexOf(h) === i ? h : `${h} (${i + 1})`));
  const rows = [];
  const rowNumbers = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r.some((c) => String(c ?? "").trim() !== "")) continue;
    rows.push(Object.fromEntries(columns.map((name, x) => [name, String(r[keep[x]] ?? "")])));
    rowNumbers.push(firstRowNumber + i);
  }
  return { columns, rows, rowNumbers, headerRow: firstRowNumber + Math.max(0, headerIdx) };
}

export function detectDelimiter(text) {
  const lines = text.slice(0, 20000).split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",";
  let bestScore = 0;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = lines.map((l) => l.split(d).length - 1).filter(Boolean).sort((a, b) => a - b);
    const typical = counts[counts.length >> 1] || 0;
    const score = typical * counts.filter((c) => c === typical).length;
    if (score > bestScore) (best = d), (bestScore = score);
  }
  return best;
}

export function delimitedToMatrix(text, delim) {
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
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) (row.push(cell), rows.push(row));
  return rows;
}

const stripBOM = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

function kindOf(name) {
  const ext = name.toLowerCase().split(".").pop();
  if (["xlsx", "xlsm", "xls", "ods"].includes(ext)) return ext;
  if (["csv", "tsv", "tab"].includes(ext)) return "csv";
  if (ext === "json") return "json";
  if (["jsonl", "ndjson"].includes(ext)) return "jsonl";
  return "text";
}

export async function workbookSheet(buffer, sheetName) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: "", raw: false });
  const first = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
  return { sheets: wb.SheetNames, sheet, ...fromMatrix(matrix, first) };
}

/** Read any supported file. `buffer` is kept so the export can write back into the original. */
export async function parseFile(file, { sheet } = {}) {
  const kind = kindOf(file.name);
  const buffer = await file.arrayBuffer();
  const base = { name: file.name, kind, buffer };
  if (["xlsx", "xlsm", "xls", "ods"].includes(kind)) return { ...base, ...(await workbookSheet(buffer, sheet)) };
  const text = stripBOM(new TextDecoder().decode(buffer));
  if (kind === "csv") {
    const delim = detectDelimiter(text);
    return { ...base, delim, ...fromMatrix(delimitedToMatrix(text, delim)) };
  }
  if (kind === "json") {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.rows) ? j.rows : Array.isArray(j?.items) ? j.items : [j];
    return { ...base, ...fromObjects(list) };
  }
  if (kind === "jsonl") {
    return { ...base, ...fromObjects(text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return l;
      }
    })) };
  }
  return { ...base, ...parseLines(text) };
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

export function toCSV(columns, rows, delim = ",", safe = () => false) {
  const esc = (v, c) => {
    let s = String(v ?? "");
    if (safe(c) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // our own cells must never run as a spreadsheet formula
    return s.includes(delim) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c)).join(delim), ...rows.map((r) => columns.map((c) => esc(r[c], c)).join(delim))].join("\n");
}
