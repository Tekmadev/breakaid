import * as XLSX from "xlsx";
import { ParsedEmployee } from "@/types";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Discriminated-union result returned by `parseScheduleFile`.
 * Callers never need a try/catch — errors are returned as readable strings
 * ready to display directly in the UI.
 */
export type ParseResult =
  | { success: true; data: ParsedEmployee[] }
  | { success: false; error: string };

/** File extensions accepted by the parser. */
export type SupportedFileType = "xlsx" | "csv";

/**
 * The department section to extract employees from.
 * Matches against the department header rows in the schedule file.
 */
export const TARGET_DEPARTMENT = "086-Security";

/**
 * FTE type codes that identify an employee data row in Costco's schedule.
 * Any row whose column 2 value is one of these is an employee row.
 */
const FTE_TYPES = new Set(["PT", "FT", "LPT", "SAL", "FTE"]);

// ---------------------------------------------------------------------------
// Shift cell parser
// ---------------------------------------------------------------------------

/**
 * Extracts the first start and end time from a Costco shift cell string.
 *
 * Costco's weekly schedule stores shifts in column 4 as strings like:
 *   "07:30 - 16:00 8.50"
 *   "13:15 - 21:45 8.00x 086-Security 0005 MBR SRV"  ← job code noise
 *   "15:15 - 20:30 5.25\n21:00 - 23:45 2.75x ..."    ← split shift (first only)
 *   "15:30 - 00:00 8.00"                              ← overnight to midnight
 *   "CA Vacation Day 1.00"                            ← not a shift → null
 *
 * @param raw     - Raw cell value from column 4 of the schedule.
 * @returns         Object with shiftStart and shiftEnd in "HH:MM" format,
 *                  or null when the cell contains no valid time range.
 */
export function parseShiftCell(raw: unknown): {
  shiftStart: string;
  shiftEnd: string;
} | null {
  if (raw === null || raw === undefined) return null;

  const str = String(raw).trim();
  if (str === "") return null;

  // Match the first "HH:MM - HH:MM" occurrence (handles 1- or 2-digit hours)
  const match = str.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!match) return null;

  return {
    shiftStart: normalizeTime(match[1]),
    shiftEnd:   normalizeTime(match[2]),
  };
}

/**
 * Zero-pads a "H:MM" time string to "HH:MM".
 * "7:30" → "07:30".  "13:15" → "13:15" (unchanged).
 *
 * @param t - Time string in "H:MM" or "HH:MM" format.
 * @returns   Zero-padded "HH:MM" string.
 */
function normalizeTime(t: string): string {
  const [h, m] = t.split(":");
  return `${h.padStart(2, "0")}:${m}`;
}

/**
 * Converts a "HH:MM" time string to Costco's compact display code.
 *
 * The Gameplan CSV uses a compact integer format with no leading zeros
 * and no colon separator:
 *   "07:30" → "730"    "05:00" → "5"    "14:45" → "1445"
 *   "00:00" → "0"      (midnight — end of last slot)
 *
 * @param timeStr - Zero-padded "HH:MM" time string.
 * @returns         Compact Costco code as a string.
 */
export function toCompactCode(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  if (m === 0) return String(h);       // "5", "8", "14", "0" (midnight)
  return String(h * 100 + m);         // "730", "830", "1445"
}

// ---------------------------------------------------------------------------
// Department header detector
// ---------------------------------------------------------------------------

/**
 * Detects whether a row is a department section header.
 *
 * Department headers in Costco's schedule look like:
 *   "086-Security - Location : Costco/CA-4/Warehouse/..."
 *
 * @param row - Array of raw cell values for one spreadsheet row.
 * @returns     The department name string if this is a header row, else null.
 */
function getDepartmentHeader(row: unknown[]): string | null {
  const col0 = row[0];
  if (col0 == null) return null;
  const str = String(col0).trim();
  if (str.includes(" - Location :")) return str;
  return null;
}

// ---------------------------------------------------------------------------
// Row classifier
// ---------------------------------------------------------------------------

/**
 * Determines whether a raw spreadsheet row is an employee data row.
 *
 * Employee rows are identified by:
 *   - Column 0: a non-empty name string (not "Employee")
 *   - Column 2: one of the known FTE type codes
 *
 * @param row - Array of raw cell values for one spreadsheet row.
 * @returns     True when the row represents an employee.
 */
function isEmployeeRow(row: unknown[]): boolean {
  const name = row[0];
  const fte  = row[2];
  return (
    name != null &&
    String(name).trim() !== "" &&
    String(name).trim() !== "Employee" &&
    typeof fte === "string" &&
    FTE_TYPES.has(fte.trim().toUpperCase())
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parses a Costco Employee Weekly Schedule file and returns only the
 * employees from the 086-Security department section.
 *
 * --- Real Costco file format ---
 * The schedule is a single-sheet xlsx/csv organised into department sections.
 * Each section starts with a header row like:
 *   "086-Security - Location : Costco/CA-4/Warehouse/.../086-Security/-"
 *
 * Within each section, employee rows are identified by:
 *   Col 0  Employee name      e.g. "Ross Ta"
 *   Col 2  FTE type           PT / FT / LPT / SAL / FTE
 *   Col 4  Shift string       e.g. "09:00 - 17:30 8.00"
 *                             or   null (not scheduled)
 *                             or   "CA Vacation Day 1.00" (skip)
 *
 * Only the 086-Security section is extracted. Employees with no shift or on
 * vacation are silently skipped.
 *
 * This is a pure function — no side effects, no mutations, no external I/O.
 *
 * @param buffer    - Raw file bytes as an ArrayBuffer.
 * @param fileType  - "xlsx" or "csv".
 * @returns           { success: true, data: ParsedEmployee[] } on success,
 *                    { success: false, error: string } on any failure.
 *
 * @example
 * ```ts
 * const result = parseScheduleFile(buffer, "xlsx");
 * if (result.success) {
 *   buildGrid(result.data); // only 086-Security employees
 * } else {
 *   showError(result.error);
 * }
 * ```
 */
export function parseScheduleFile(
  buffer: ArrayBuffer,
  fileType: SupportedFileType
): ParseResult {
  try {
    // ── 1. Decode workbook ──────────────────────────────────────────────────
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "array", raw: true });
    } catch {
      return {
        success: false,
        error:
          "The file could not be read — it may be corrupted or password-protected. " +
          "Please upload a valid .xlsx or .csv Costco schedule file.",
      };
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return {
        success: false,
        error: "The file contains no worksheets. Please check the file and try again.",
      };
    }

    // ── 2. Convert to 2-D array ─────────────────────────────────────────────
    const rows: unknown[][] = XLSX.utils.sheet_to_json(
      workbook.Sheets[sheetName],
      { header: 1, defval: null, raw: true }
    );

    if (rows.length < 2) {
      return {
        success: false,
        error: "The file appears to be empty. Please upload a valid Costco weekly schedule.",
      };
    }

    // ── 3. Scan rows — track current department, extract 086-Security only ──
    const employees: ParsedEmployee[] = [];
    let inTargetDept = false;

    for (const row of rows) {
      // Check for department header row
      const deptHeader = getDepartmentHeader(row);
      if (deptHeader !== null) {
        inTargetDept = deptHeader.includes(TARGET_DEPARTMENT);
        continue;
      }

      // Only process employee rows inside the target department
      if (!inTargetDept) continue;
      if (!isEmployeeRow(row)) continue;

      const name  = String(row[0]).trim();
      const times = parseShiftCell(row[4]);

      // Skip employees with no shift, on vacation, etc.
      if (!times) continue;

      const { shiftStart, shiftEnd } = times;
      const shiftRaw = `${toCompactCode(shiftStart)}-${toCompactCode(shiftEnd)}`;

      employees.push({ name, shiftStart, shiftEnd, shiftRaw });
    }

    // ── 4. Validate results ─────────────────────────────────────────────────
    if (employees.length === 0) {
      return {
        success: false,
        error:
          `No scheduled employees were found in the ${TARGET_DEPARTMENT} department. ` +
          `Please make sure this is a Costco Employee Weekly Schedule export ` +
          `that includes the ${TARGET_DEPARTMENT} section.`,
      };
    }

    return { success: true, data: employees };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `An unexpected error occurred while parsing the file: ${message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// File-type resolver
// ---------------------------------------------------------------------------

/**
 * Infers the supported file type from a browser File object.
 *
 * Checks the filename extension first, then falls back to the MIME type.
 *
 * @param file    - The browser File selected or dropped by the user.
 * @returns         "xlsx", "csv", or null if the format is unsupported.
 */
export function resolveFileType(file: File): SupportedFileType | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx") return "xlsx";
  if (ext === "csv") return "csv";

  const mime = file.type.toLowerCase();
  if (mime.includes("spreadsheetml") || mime.includes("excel")) return "xlsx";
  if (mime.includes("csv") || mime.includes("comma-separated")) return "csv";

  return null;
}