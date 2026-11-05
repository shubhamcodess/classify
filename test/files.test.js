import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseFile, fromMatrix, detectDelimiter, delimitedToMatrix, detectHeader } from "../src/parse.js";
import { buildExport } from "../src/export.js";
import { OUTPUT_COLUMNS } from "../src/engine/run.js";

const fileOf = (name, content) => ({ name, arrayBuffer: async () => (typeof content === "string" ? new TextEncoder().encode(content).buffer : content) });
const result = (label, by) => ({ category: { label: "billing", confidence: 0.91, signals: ["words"] }, decision: { label, confidence: 0.8, signals: ["words", "meaning"], by }, needsReview: false, reason: "closest example" });

test("messy CSV: title line, blank row, BOM, semicolons, empty column", async () => {
  const d = await parseFile(fileOf("x.csv", "﻿Report for November;;;\n;;;\nid;;name;message\n1;;Ana;hello there\n\n2;;Bo;second one\n"));
  assert.deepEqual(d.columns, ["id", "name", "message"]);
  assert.equal(d.rows.length, 2);
  assert.equal(d.rows[1].message, "second one");
  assert.deepEqual(d.rowNumbers, [4, 6]);
  assert.equal(d.delim, ";");
});

test("delimiter detection ignores commas inside prose", () => {
  assert.equal(detectDelimiter("a\tb\tc\n1\thello, world, again\t3\n2\tx\t4\n"), "\t");
  assert.deepEqual(delimitedToMatrix('a,"b,c"\n', ","), [["a", "b,c"]]);
});

test("a single text column with no header keeps its first line as data only when numeric-free header exists", () => {
  assert.equal(detectHeader([["Title only"], ["", ""], ["a", "b"], ["1", "2"]]), 2);
  const d = fromMatrix([["name", "v"], ["x", "1"]], 5);
  assert.equal(d.headerRow, 5);
  assert.deepEqual(d.rowNumbers, [6]);
});

async function workbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tickets");
  ws.addRow(["Export of 5 Nov"]);
  ws.addRow([]);
  const h = ws.addRow(["id", "message", "amount", "double"]);
  h.font = { bold: true, color: { argb: "FFFF0000" } };
  ws.addRow([1, "charged twice", 100, { formula: "C4*2", result: 200 }]);
  ws.addRow([2, "app crashes", 50, { formula: "C5*2", result: 100 }]);
  ws.getCell("B4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00FF00" } };
  wb.addWorksheet("Notes").addRow(["keep me"]);
  return wb.xlsx.writeBuffer();
}

test("Excel round trip adds columns in place and keeps sheets, formatting and formulas", async () => {
  const buf = await workbook();
  const d = await parseFile(fileOf("t.xlsx", buf));
  assert.deepEqual(d.columns, ["id", "message", "amount", "double"]);
  assert.equal(d.headerRow, 3);
  assert.deepEqual(d.sheets, ["Tickets", "Notes"]);
  const out = await buildExport(d, [result("Refund"), result("Send to engineering")]);
  assert.equal(out.filename, "t-classified.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out.data);
  const ws = wb.getWorksheet("Tickets");
  assert.equal(wb.getWorksheet("Notes").getCell("A1").value, "keep me");
  assert.equal(ws.getCell("A1").value, "Export of 5 Nov");
  assert.equal(ws.getCell("E3").value, "category");
  assert.equal(ws.getCell("G3").value, "decision");
  assert.equal(ws.getCell("G4").value, "Refund");
  assert.equal(ws.getCell("G5").value, "Send to engineering");
  assert.equal(ws.getCell("F4").value, 0.91);
  assert.equal(ws.getCell("D4").value.formula, "C4*2");
  assert.equal(ws.getCell("B4").fill.fgColor.argb, "FF00FF00");
  assert.equal(ws.getCell("G3").font.bold, true);
});

test("running twice reuses the same columns instead of adding more", async () => {
  const first = await buildExport(await parseFile(fileOf("t.xlsx", await workbook())), [result("Refund"), result("Refund")]);
  const again = await parseFile(fileOf("t-classified.xlsx", first.data));
  const second = await buildExport(again, [result("Ignore"), result("Ignore")]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(second.data);
  const ws = wb.getWorksheet("Tickets");
  assert.equal(ws.getCell("G4").value, "Ignore");
  assert.equal(ws.getRow(3).cellCount, 4 + OUTPUT_COLUMNS.length);
});

test("CSV keeps its separator; JSON keeps its shape; our cells cannot become formulas", async () => {
  const d = await parseFile(fileOf("a.csv", "id;msg\n1;=SUM(A1)\n"));
  const r = [{ ...result("=cmd()"), reason: "+evil" }];
  const out = await buildExport(d, r);
  const text = out.data;
  assert.ok(text.startsWith("id;msg;category"));
  assert.ok(text.includes("'=cmd()"));
  assert.ok(text.includes("'+evil"));
  assert.ok(text.includes(";=SUM(A1);"), "the user's own cell is left unchanged");
  const j = await parseFile(fileOf("a.json", JSON.stringify([{ a: "x" }])));
  const jo = JSON.parse((await buildExport(j, [result("Refund")])).data);
  assert.equal(jo[0].a, "x");
  assert.equal(jo[0].decision, "Refund");
});
