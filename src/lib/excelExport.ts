/**
 * excelExport.ts - download the finalized gameplan as a .xlsx that reproduces
 * the paper "Member Service Gameplan" sheet: centered title, DATE line,
 * Name/Shift rows, grey separator, 8:00→21:30 time rows, black gridlines,
 * grey off-shift cells, trailing blank columns - print-ready on A4 portrait
 * (fit-to-width page setup baked in), black-and-white only.
 *
 * For managers who prefer the familiar Google Sheets / Excel print flow over
 * the in-app Print / PDF button. ExcelJS is imported dynamically so its ~1 MB
 * stays out of the initial bundle.
 */

import type { Employee, Gameplan } from "./types";
import { TIME_SLOTS } from "./generator";
import {
  PRINT_START_IDX,
  PRINT_END_IDX,
  PRINT_MIN_COLS,
  formatPaperDate,
  isBoldCode,
} from "./printLayout";
import { displayFor } from "./displayName";

const GREY_ARGB = "FFD3D3D3"; // same grey as the printed form

export async function exportGameplanXlsx(
  date: string,
  roster: Employee[],
  plan: Gameplan
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Gameplan", {
    pageSetup: {
      paperSize: 9, // PaperSize.A4 (const enum - value inlined)
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });

  const colCount = 1 + Math.max(roster.length, PRINT_MIN_COLS); // time col + employees + padding
  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const allBorders = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: "center" as const, vertical: "middle" as const };

  // Column widths: narrow time column, uniform employee columns.
  ws.getColumn(1).width = 7;
  for (let c = 2; c <= colCount; c++) ws.getColumn(c).width = 9;

  // Row 1 - centered title across the whole grid.
  ws.mergeCells(1, 1, 1, colCount);
  const title = ws.getCell(1, 1);
  title.value = "Member Service Gameplan";
  title.font = { name: "Arial", size: 14, bold: true };
  title.alignment = center;

  // Row 2 - DATE line, paper style ("DATE: Sat June 13").
  ws.mergeCells(2, 1, 2, colCount);
  const dateCell = ws.getCell(2, 1);
  dateCell.value = `DATE: ${formatPaperDate(date)}`;
  dateCell.font = { name: "Arial", size: 9 };
  dateCell.alignment = { horizontal: "left", vertical: "middle" };

  // Row 3 - Name row. Row 4 - Shift row. Row 5 - grey separator.
  const NAME_ROW = 3;
  const SHIFT_ROW = 4;
  const SEP_ROW = 5;
  const FIRST_TIME_ROW = 6;

  const nameRow = ws.getRow(NAME_ROW);
  const shiftRow = ws.getRow(SHIFT_ROW);
  nameRow.getCell(1).value = "Name";
  shiftRow.getCell(1).value = "Shift";
  roster.forEach((e, i) => {
    nameRow.getCell(2 + i).value = displayFor(e);
    shiftRow.getCell(2 + i).value = e.shift;
  });
  for (let c = 1; c <= colCount; c++) {
    for (const row of [nameRow, shiftRow]) {
      const cell = row.getCell(c);
      cell.border = allBorders;
      cell.alignment = center;
      cell.font = { name: "Arial", size: c === 1 || row === nameRow ? 9 : 8, bold: row === nameRow };
    }
    const sep = ws.getRow(SEP_ROW).getCell(c);
    sep.border = allBorders;
    sep.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY_ARGB } };
  }
  ws.getRow(SEP_ROW).height = 5;

  // Time rows 7:00 → 21:30. Row height is tuned so the 30 rows + header fill an
  // A4 page (fit-to-page keeps it to exactly one sheet). Two more rows than
  // before, so each is proportionally shorter: 24 × 28/30 ≈ 22.
  for (let i = PRINT_START_IDX; i <= PRINT_END_IDX; i++) {
    const rowIdx = FIRST_TIME_ROW + (i - PRINT_START_IDX);
    const row = ws.getRow(rowIdx);
    row.height = 22;

    const timeCell = row.getCell(1);
    timeCell.value = TIME_SLOTS[i];
    timeCell.border = allBorders;
    timeCell.alignment = center;
    timeCell.font = { name: "Arial", size: 9, bold: true };

    for (let c = 2; c <= colCount; c++) {
      const emp = roster[c - 2]; // undefined for padding columns
      const cell = row.getCell(c);
      cell.border = allBorders;
      cell.alignment = center;
      if (emp && i >= emp.shiftStartIdx && i < emp.shiftEndIdx) {
        const code = plan[emp.name]?.[TIME_SLOTS[i]] || "";
        cell.value = code;
        // Only B/W/SEC/FE/FE HELP are bold; IN/OUT/PUSH/B/D regular weight.
        cell.font = { name: "Arial", size: 9, bold: isBoldCode(code) };
      } else {
        cell.font = { name: "Arial", size: 9 };
        if (emp) {
          // Off-shift → grey, exactly like the printed form.
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY_ARGB } };
        }
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Gameplan ${date.replace(/\//g, "-")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
