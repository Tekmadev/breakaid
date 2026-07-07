import type { Employee } from "./types";

/**
 * The label to show for a person on the gameplan (grid, print, Excel, phone
 * view): their display name if one is set, otherwise their roster name (the key
 * that matches the schedule file). Trims so an all-spaces display name falls
 * back to the roster name.
 */
export function displayFor(e: Pick<Employee, "name" | "displayName">): string {
  const d = e.displayName?.trim();
  return d ? d : e.name;
}
