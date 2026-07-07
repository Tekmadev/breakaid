/**
 * printLayout.ts - shared constants + helpers for the two "paper form" outputs:
 * the browser-print A4 form (GameplanPrint.tsx) and the Excel export
 * (excelExport.ts). Both reproduce the real Costco "Member Service Gameplan"
 * sheet, so their layout facts live in one place.
 */

// TIME_SLOTS index 2 = "8:00", index 29 = "21:30" (inclusive) - the paper's
// fixed window. 28 time rows.
export const PRINT_START_IDX = 2;
export const PRINT_END_IDX = 29;

// Pad employee columns out to this many so a small roster still fills the
// form with trailing blank columns, exactly like the printed sheet.
export const PRINT_MIN_COLS = 13;

/** Off-shift cell grey - matches the photocopied form. */
export const PRINT_GREY = "#d3d3d3";

/**
 * Codes printed in BOLD on the paper form (the "action" codes managers scan
 * for). Everything else - IN, OUT, PUSH, B/D, legacy D - prints regular weight.
 */
export const BOLD_CODES: ReadonlySet<string> = new Set(["B", "W", "SEC", "FE", "FE HELP"]);

export function isBoldCode(code: string): boolean {
  return BOLD_CODES.has(code);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Turn the app's date label ("Sat 06/13/2026") into the paper form's date
 * ("Sat June 13"). Unparseable labels pass through unchanged.
 */
export function formatPaperDate(dateLabel: string): string {
  const m = dateLabel.match(/^([A-Za-z]{3})\s+(\d{2})\/(\d{2})\/\d{4}$/);
  if (!m) return dateLabel;
  const month = MONTHS[parseInt(m[2], 10) - 1];
  if (!month) return dateLabel;
  return `${m[1]} ${month} ${parseInt(m[3], 10)}`;
}
