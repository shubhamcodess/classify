// Write the results back in the format the file came in. For Excel, the original workbook is opened and
// new columns are added beside the table, so other sheets, formatting and formulas stay where they were.
import { OUTPUT_COLUMNS, outputFields } from "./engine/run.js";
import { toCSV } from "./parse.js";

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  json: "application/json",
  jsonl: "application/x-ndjson",
};
const stem = (name) => name.replace(/\.[^.]+$/, "");
const out = (name, ext, data) => ({ filename: `${stem(name)}-classified.${ext}`, data, mime: MIME[ext] });
const merged = (data, results) => data.rows.map((r, i) => ({ ...r, ...outputFields(results[i]) }));

async function loadExcel() {
  const m = await import("exceljs/dist/exceljs.min.js");
  return m.default || m;
}

async function intoWorkbook(data, results) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data.buffer);
  const ws = wb.getWorksheet(data.sheet) || wb.worksheets[0];
  const header = ws.getRow(data.headerRow);
  const cols = {};
  let last = 0;
  header.eachCell({ includeEmpty: false }, (cell, c) => {
    last = Math.max(last, c);
    if (OUTPUT_COLUMNS.includes(String(cell.value))) cols[cell.value] = c; // re-running reuses earlier columns
  });
  const model = header.getCell(last || 1);
  let next = Math.max(last, ws.columnCount) + 1;
  for (const name of OUTPUT_COLUMNS) {
    if (cols[name]) continue;
    cols[name] = next++;
    const cell = header.getCell(cols[name]);
    cell.value = name;
    if (model.style) cell.style = { ...model.style };
    ws.getColumn(cols[name]).width = name === "reason" ? 48 : Math.max(14, name.length + 2);
  }
  header.commit?.();
  data.rowNumbers.forEach((rowNumber, i) => {
    const row = ws.getRow(rowNumber);
    const fields = outputFields(results[i]);
    for (const name of OUTPUT_COLUMNS) {
      const v = fields[name];
      row.getCell(cols[name]).value = name.endsWith("confidence") && v !== "" ? Number(v) : v;
    }
  });
  return wb.xlsx.writeBuffer();
}

async function newWorkbook(data, results) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(data.sheet || "Classified");
  const columns = [...data.columns, ...OUTPUT_COLUMNS];
  ws.addRow(columns);
  ws.getRow(1).font = { bold: true };
  for (const r of merged(data, results)) ws.addRow(columns.map((c) => r[c]));
  return wb.xlsx.writeBuffer();
}

/** Returns { filename, data, mime }. `format` overrides the source format ("xlsx", "csv", "json"). */
export async function buildExport(data, results, format) {
  const k = format || { xls: "xlsx", ods: "xlsx", xlsm: "xlsx", text: "csv" }[data.kind] || data.kind;
  if (k === "xlsx") {
    const canEdit = data.kind === "xlsx" || data.kind === "xlsm";
    return out(data.name, "xlsx", await (canEdit ? intoWorkbook(data, results) : newWorkbook(data, results)));
  }
  if (k === "json") return out(data.name, "json", JSON.stringify(merged(data, results), null, 2));
  if (k === "jsonl") return out(data.name, "jsonl", merged(data, results).map((r) => JSON.stringify(r)).join("\n"));
  const delim = format ? "," : data.delim || ",";
  return out(data.name, "csv", toCSV([...data.columns, ...OUTPUT_COLUMNS], merged(data, results), delim, (c) => OUTPUT_COLUMNS.includes(c)));
}
