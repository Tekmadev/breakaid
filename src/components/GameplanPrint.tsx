import React from "react";
import type { Employee, Gameplan } from "@/lib/types";
import { TIME_SLOTS } from "@/lib/generator";
import {
  PRINT_START_IDX,
  PRINT_END_IDX,
  PRINT_MIN_COLS,
  PRINT_GREY,
  formatPaperDate,
  isBoldCode,
} from "@/lib/printLayout";
import { displayFor } from "@/lib/displayName";

/**
 * GameplanPrint - renders the printable "Member Service Gameplan" A4 form for a
 * finalized day, reproducing the paper layout: centered title, DATE, a Name row
 * and a Shift row, then 30-min time rows from 8:00 to 21:30. Each cell shows the
 * task code; cells outside a person's shift are greyed out.
 *
 * Hidden on screen and shown only when printing (see #gameplan-print rules in
 * globals.css). The fixed 8:00–21:30 range matches the paper exactly - security
 * or PUSH past 21:30 is intentionally not shown.
 */

const MIN_COLS = PRINT_MIN_COLS;
const GREY = PRINT_GREY;
const BORDER = "1px solid #000";

// Time-row height, tuned so the 28 rows (8:00→21:30) plus the header rows fill
// an A4 portrait page (≈28.1cm usable inside the 8mm print margin) instead of
// leaving the lower third blank - while keeping that margin untouched.
const TIME_ROW_H = "0.86cm";

export default function GameplanPrint({
  date,
  roster,
  plan,
}: {
  date: string;
  roster: Employee[];
  plan: Gameplan;
}) {
  const rowIdxs: number[] = [];
  for (let i = PRINT_START_IDX; i <= PRINT_END_IDX; i++) rowIdxs.push(i);

  const padCount = Math.max(0, MIN_COLS - roster.length);
  const pad = Array.from({ length: padCount });

  const cell: React.CSSProperties = {
    border: BORDER,
    padding: "1px 2px",
    textAlign: "center",
    fontSize: "9pt",
    height: "0.72cm",
    overflow: "hidden",
  };
  const labelCell: React.CSSProperties = { ...cell, fontWeight: 600, width: "1.6cm" };

  return (
    <div id="gameplan-print">
      <div style={{ textAlign: "center", fontSize: "14pt", fontWeight: 700, marginBottom: "2px" }}>
        Member Service Gameplan
      </div>
      {/* Paper-style date, e.g. "DATE: Sat June 13". */}
      <div style={{ fontSize: "9pt", marginBottom: "4px" }}>DATE: {formatPaperDate(date)}</div>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <tbody>
          {/* Name row */}
          <tr>
            <td style={labelCell}>Name</td>
            {roster.map((e) => (
              <td key={`n-${e.name}`} style={{ ...cell, fontWeight: 600 }}>
                {displayFor(e)}
              </td>
            ))}
            {pad.map((_, i) => (
              <td key={`np-${i}`} style={cell} />
            ))}
          </tr>

          {/* Shift row */}
          <tr>
            <td style={labelCell}>Shift</td>
            {roster.map((e) => (
              <td key={`s-${e.name}`} style={{ ...cell, fontSize: "7pt" }}>
                {e.shift}
              </td>
            ))}
            {pad.map((_, i) => (
              <td key={`sp-${i}`} style={cell} />
            ))}
          </tr>

          {/* Grey separator row */}
          <tr>
            <td style={{ ...cell, background: GREY, height: "0.18cm", padding: 0 }} />
            {roster.map((e) => (
              <td key={`g-${e.name}`} style={{ ...cell, background: GREY, height: "0.18cm", padding: 0 }} />
            ))}
            {pad.map((_, i) => (
              <td key={`gp-${i}`} style={{ ...cell, background: GREY, height: "0.18cm", padding: 0 }} />
            ))}
          </tr>

          {/* Time rows 8:00 → 21:30 */}
          {rowIdxs.map((i) => {
            const time = TIME_SLOTS[i];
            return (
              <tr key={time}>
                <td style={{ ...cell, height: TIME_ROW_H, fontWeight: 600 }}>{time}</td>
                {roster.map((e) => {
                  const active = i >= e.shiftStartIdx && i < e.shiftEndIdx;
                  const code = plan[e.name]?.[time] || "";
                  return (
                    <td
                      key={`${e.name}-${time}`}
                      style={{
                        ...cell,
                        height: TIME_ROW_H,
                        // Only the "action" codes (B/W/SEC/FE/FE HELP) are bold;
                        // IN/OUT/PUSH/B/D print regular weight.
                        fontWeight: active && isBoldCode(code) ? 700 : 400,
                        background: active ? "#fff" : GREY,
                      }}
                    >
                      {active ? code : ""}
                    </td>
                  );
                })}
                {pad.map((_, p) => (
                  <td key={`p-${p}-${time}`} style={{ ...cell, height: TIME_ROW_H }} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
