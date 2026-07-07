"use client";

import React, { useState, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Download, RefreshCw, AlertCircle, Settings, Play, X, FlaskConical, Trash2, Calendar, ChevronRight, Users, Printer, Save, Check, ShieldCheck, Layers, History, FileSpreadsheet, UserPlus, Search } from 'lucide-react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- TASK_CYCLE kept for reference; the popover editor below replaces click-to-cycle.
import { type DoorSide, type Employee, type EmployeeRecord, type FinalizedGameplan, type Gameplan, type TaskCode, TASK_CYCLE } from '@/lib/types';
import { generateGameplan, computeHelpRow, TIME_SLOTS } from '@/lib/generator';
import { parseScheduleRows, type ScheduleParseResult } from '@/lib/parser';
import { employeeStore } from '@/lib/employeeStore';
import { gameplanStore } from '@/lib/gameplanStore';
import { exportGameplanXlsx } from '@/lib/excelExport';
import { isPlanEditable } from '@/lib/planLock';
import { displayFor } from '@/lib/displayName';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import GameplanPrint from '@/components/GameplanPrint';
// TEMPORARY - feedback capture scaffolding for algorithm training. Safe to delete once deterministic rules are finalized.
import {
  type Correction,
  type CorrectionReason,
  type CorrectionScope,
  type FeedbackSession,
  loadSession,
  saveSession,
  clearSession,
  exportSessionAsFile,
} from '@/lib/feedback';

// TEMP - task options offered by the floating cell editor (feedback scaffolding).
// Door duty is picked as a SIDE (IN = entrance, OUT = exit); legacy "D" is not
// offered - old saved plans still render it, but new edits always take a side.
const TASK_OPTIONS: { code: TaskCode; label: string }[] = [
  { code: '', label: ' - ' },
  { code: 'IN', label: 'IN (entrance)' },
  { code: 'OUT', label: 'OUT (exit)' },
  { code: 'W', label: 'W' },
  { code: 'B', label: 'B' },
  { code: 'B/D', label: 'B/D' },
  { code: 'SEC', label: 'SEC' },
  { code: 'FE', label: 'FE' },
  { code: 'PUSH', label: 'PUSH' },
  { code: 'FE HELP', label: 'FE HELP' },
];

// The on-screen grid starts at 8:00 (TIME_SLOTS idx 2), matching the paper
// form. The 7 AM walk exists but is understood - it is not displayed.
const DISPLAY_START_IDX = 2;

// TEMP - reason chips (multi-select) mapping label → CorrectionReason.
const REASON_OPTIONS: { value: CorrectionReason; label: string }[] = [
  { value: 'break-too-late', label: 'Break too late' },
  { value: 'break-too-early', label: 'Break too early' },
  { value: 'breaks-bunched', label: 'Breaks bunched together' },
  { value: 'need-help-at-door', label: 'Needs help at door (FE HELP)' },
  { value: 'keep-on-door', label: 'Keep on door' },
  { value: 'wrong-walk', label: 'Wrong walk pick' },
  { value: 'coverage-problem', label: 'Coverage problem' },
  { value: 'wrong-person-sec', label: 'Wrong person on Security' },
  { value: 'other', label: 'Other' },
];

// TEMP - scope chips (single-select) mapping label → CorrectionScope.
const SCOPE_OPTIONS: { value: CorrectionScope; label: string }[] = [
  { value: 'once', label: 'Just this once' },
  { value: 'employee', label: 'Always for this employee' },
  { value: 'similar-shifts', label: 'All similar shifts' },
  { value: 'everyone', label: 'Everyone' },
];

// TEMP - describes a cell change awaiting a reason in the feedback modal.
type PendingChange = {
  empName: string;
  time: string;
  slotIdx: number;
  oldTask: TaskCode;
  newTask: TaskCode;
  doorCoverageBefore: number;
  doorCoverageAfter: number;
};

// parseTime will be used by the CSV parsing logic added in SCRUM-9.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const parseTime = (t: string) => {
  const parts = t.split(":");
  return parseInt(parts[0]) * 60 + (parts[1] ? parseInt(parts[1]) : 0);
};

// TEMP - deep clone of a Gameplan for the feedback baseline (one level of
// inner records). Mirrors the generator's own immutability approach.
const cloneMatrix = (matrix: Gameplan): Gameplan => {
  const clone: Gameplan = {};
  for (const name in matrix) clone[name] = { ...matrix[name] };
  return clone;
};

// TEMP - door-equivalent coverage (IN + OUT + legacy D + B/D) at a time, given
// a roster + matrix. Used to record doorCoverageBefore/After on each correction.
const countDoorCoverageAt = (
  matrix: Gameplan,
  roster: Employee[],
  time: string
): number => {
  let count = 0;
  for (const emp of roster) {
    const task = matrix[emp.name]?.[time];
    if (task === 'IN' || task === 'OUT' || task === 'D' || task === 'B/D') count++;
  }
  return count;
};

// Overlay saved capabilities + door-side onto a freshly parsed roster, so the
// generator honours each person's persisted settings. Names with no saved
// record keep the parser defaults (canWalk=true / canSec=false / doorSide=both).
const overlayCaps = (
  roster: Employee[],
  saved: Record<string, EmployeeRecord>
): Employee[] =>
  roster.map((e) =>
    saved[e.name]
      ? {
          ...e,
          displayName: saved[e.name].displayName,
          canWalk: saved[e.name].canWalk,
          canSec: saved[e.name].canSec,
          doorSide: saved[e.name].doorSide,
        }
      : e
  );

// Chronological roster order, matching the parser: earliest start first, then
// earliest finish, then name. Used when inserting an added helper into the grid.
const rosterSort = (a: Employee, b: Employee) =>
  a.shiftStartIdx - b.shiftStartIdx ||
  a.shiftEndIdx - b.shiftEndIdx ||
  a.name.localeCompare(b.name);

/** "2026-07-07T…Z" → short local "Jul 7, 3:41 PM", or " - ". */
const fmtFinalized = (iso?: string): string => {
  if (!iso) return ' - ';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ' - ';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // scheduleMatrix[employeeName][timeSlot] = TaskCode
  const [scheduleMatrix, setScheduleMatrix] = useState<Gameplan>({});
  const [isGenerated, setIsGenerated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Weekday vs weekend ruleset - set from the selected day's date (no toggle).
  const [isWeekend, setIsWeekend] = useState(false);

  // The parsed workbook (may hold multiple days) and which day is open.
  const [parsed, setParsed] = useState<ScheduleParseResult | null>(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);

  // Finalize & save state for the printable gameplan.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Finalized-gameplan history (the dashboard list) + bulk "generate all days".
  const [history, setHistory] = useState<FinalizedGameplan[]>([]);
  const [bulkState, setBulkState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkSkipped, setBulkSkipped] = useState(0);
  // A saved plan queued for reprint/re-export from the history list (rendered
  // into the hidden print form so it can be printed without reopening it).
  const [savedForPrint, setSavedForPrint] = useState<FinalizedGameplan | null>(null);

  // "Add a helper" picker: pull a reserve-pool employee onto the day's roster.
  const [showAddHelper, setShowAddHelper] = useState(false);
  const [helperSearch, setHelperSearch] = useState('');
  // True once the roster changes (helper added/removed) after a plan was built,
  // so we can prompt the manager to Auto Generate and rebuild with the new team.
  const [rosterDirty, setRosterDirty] = useState(false);

  // ── TEMP FEEDBACK STATE - remove with feedback scaffolding ──────────────
  // Floating cell editor: which active cell is open + its on-screen rect.
  const [editingCell, setEditingCell] = useState<
    { empName: string; time: string; slotIdx: number; rect: DOMRect } | null
  >(null);
  // The change awaiting a reason, plus the modal's working reason/scope/note.
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [modalReasons, setModalReasons] = useState<CorrectionReason[]>([]);
  const [modalScope, setModalScope] = useState<CorrectionScope>('once');
  const [modalNote, setModalNote] = useState('');
  // React mirror of the persisted FeedbackSession so the toolbar count updates.
  // Lazy initializer hydrates from a previous visit. loadSession() is SSR-safe
  // (returns null when there is no window), so server and first client render
  // agree on null and there is no hydration mismatch.
  const [feedbackSession, setFeedbackSession] = useState<FeedbackSession | null>(
    () => loadSession()
  );

  // Close the floating cell editor on Escape, scroll, or resize. The popover is
  // anchored to a rect captured at click time, so on scroll (the grid scrolls
  // independently - capture:true catches that inner scroll) we close it rather
  // than let it detach and float over an unrelated cell.
  useEffect(() => {
    if (!editingCell) return;
    const close = () => setEditingCell(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [editingCell]);

  // Escape while the feedback modal is open = Cancel (revert the staged edit).
  useEffect(() => {
    if (!pendingChange) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const { empName, time, oldTask } = pendingChange;
      setScheduleMatrix((prev) => {
        const reverted = cloneMatrix(prev);
        if (!reverted[empName]) reverted[empName] = {};
        reverted[empName][time] = oldTask;
        return reverted;
      });
      setPendingChange(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingChange]);

  // Load the finalized-gameplan history (dashboard list) on mount and after any
  // save. setHistory only fires inside the resolved promise, never synchronously.
  const refreshHistory = useCallback(() => {
    gameplanStore.list().then(setHistory).catch(() => {});
  }, []);
  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.csv')) {
      setError("Please upload a valid Excel (.xlsx) or CSV file.");
      return;
    }

    setFile(selectedFile);
    setError(null);
    setLoading(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        // Parse the real Costco Weekly Schedule workbook into per-day rosters.
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as string[][];
        const result = parseScheduleRows(rows);

        if (result.days.length === 0) {
          setError("Couldn't find any scheduled days in this file. Is it a Costco Weekly Schedule export?");
          setLoading(false);
          return;
        }

        // Reset any prior day's grid; the manager picks a day next.
        setParsed(result);
        setSelectedDayIdx(null);
        setEmployees([]);
        setScheduleMatrix({});
        setIsGenerated(false);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError("Failed to parse the file.");
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setError("Error reading the file.");
      setLoading(false);
    };
    reader.readAsBinaryString(selectedFile);
  }, []);

  // Open a parsed day in the gameplan builder.
  const selectDay = (idx: number) => {
    if (!parsed) return;
    const day = parsed.days[idx];
    setSelectedDayIdx(idx);
    setIsWeekend(day.isWeekend);
    setEditingCell(null);
    setPendingChange(null);
    setSaveState('idle');
    setRosterDirty(false);
    setShowAddHelper(false);
    setHelperSearch('');

    // A past day is LOCKED: read-only, print/export only. Load its finalized
    // version (if one was saved) so it can still be reprinted/exported from
    // here; never overlay capabilities or register names for a locked day.
    if (!isPlanEditable(day.dateLabel)) {
      const saved = history.find((h) => h.date === day.dateLabel);
      if (saved) {
        setEmployees(saved.roster);
        setScheduleMatrix(saved.plan);
        setIsGenerated(true);
      } else {
        setEmployees(day.employees);
        const blank: Gameplan = {};
        day.employees.forEach((emp) => {
          blank[emp.name] = {};
          TIME_SLOTS.forEach((time) => { blank[emp.name][time] = ""; });
        });
        setScheduleMatrix(blank);
        setIsGenerated(false);
      }
      return;
    }

    // Show the parsed roster immediately (canWalk=true / canSec=false defaults).
    setEmployees(day.employees);
    setIsGenerated(false);
    const initialMatrix: Gameplan = {};
    day.employees.forEach((emp) => {
      initialMatrix[emp.name] = {};
      TIME_SLOTS.forEach((time) => { initialMatrix[emp.name][time] = ""; });
    });
    setScheduleMatrix(initialMatrix);

    // Then overlay saved capabilities from the store (Supabase when configured,
    // else localStorage) so the manager doesn't re-set canWalk/canSec each
    // upload, and register any unseen names so they appear on the Employee
    // Management page (defaults only - existing saved capabilities are never
    // clobbered, since unseen = those with no stored record).
    employeeStore
      .list()
      .then((rows) => {
        const saved: Record<string, EmployeeRecord> = {};
        for (const r of rows) saved[r.name] = r;
        setEmployees((prev) =>
          prev.map((e) =>
            saved[e.name]
              ? {
                  ...e,
                  displayName: saved[e.name].displayName,
                  canWalk: saved[e.name].canWalk,
                  canSec: saved[e.name].canSec,
                  doorSide: saved[e.name].doorSide,
                }
              : e
          )
        );
        const unseen = day.employees.filter((e) => !saved[e.name]);
        if (unseen.length) {
          Promise.all(
            unseen.map((e) =>
              employeeStore.upsert({
                name: e.name,
                canWalk: e.canWalk,
                canSec: e.canSec,
                doorSide: e.doorSide ?? 'both',
                lastShift: e.shift,
              })
            )
          ).catch(() => {});
        }
      })
      .catch(() => {});
  };

  // Back to the day list (keep the parsed file loaded).
  const backToDays = () => {
    setSelectedDayIdx(null);
    setEmployees([]);
    setScheduleMatrix({});
    setIsGenerated(false);
    setRosterDirty(false);
  };

  // Full reset to the upload screen.
  const handleStartOver = () => {
    setFile(null);
    setParsed(null);
    setSelectedDayIdx(null);
    setEmployees([]);
    setScheduleMatrix({});
    setIsGenerated(false);
    setError(null);
  };

  const toggleCapability = (idx: number, field: 'canWalk' | 'canSec') => {
    const emp = employees[idx];
    if (!emp) return;
    const nextVal = !emp[field];
    // Optimistic UI update - never mutate the existing employee in place.
    setEmployees((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: nextVal } : e)));
    // Persist (non-clobbering single-field upsert) so it sticks for future
    // uploads of the same person, and stays in sync with the Employee page.
    employeeStore.upsert({ name: emp.name, [field]: nextVal }).catch(() => {});
  };

  // Door-side restriction (Both / Entrance only / Exit only) - same optimistic
  // + persisted pattern; the generator honours it on the next Auto Generate.
  const setDoorSide = (idx: number, side: DoorSide) => {
    const emp = employees[idx];
    if (!emp) return;
    setEmployees((prev) => prev.map((e, i) => (i === idx ? { ...e, doorSide: side } : e)));
    employeeStore.upsert({ name: emp.name, doorSide: side }).catch(() => {});
  };

  // Display name (friendlier label on the plan). Edit locally on each keystroke,
  // persist on blur. It does NOT require a regenerate: cells are keyed by the
  // real name, so only the header label changes.
  const setEmpDisplayName = (idx: number, value: string) => {
    setEmployees((prev) => prev.map((e, i) => (i === idx ? { ...e, displayName: value } : e)));
  };
  const commitEmpDisplayName = (idx: number) => {
    const emp = employees[idx];
    if (!emp) return;
    employeeStore.upsert({ name: emp.name, displayName: emp.displayName?.trim() || undefined }).catch(() => {});
  };

  // Generate (or rebuild) the plan for a given roster and reset the feedback
  // baseline. Shared by Auto Generate and by adding/removing a helper, so the
  // rebuild always runs against the exact roster passed in (no stale state).
  const runGenerate = (roster: Employee[]) => {
    // Delegate all scheduling logic to the pure generator function, which
    // enforces the Costco business rules internally and branches on weekday/
    // weekend.
    const newMatrix = generateGameplan(roster, isWeekend);
    setScheduleMatrix(newMatrix);
    setIsGenerated(true);
    setSaveState('idle'); // a fresh plan is unsaved until finalized
    setRosterDirty(false); // the plan now matches the current roster

    // ── TEMP - (re)write the feedback baseline on every generation ─────────
    // Corrections are always measured against the plan that is on screen, so a
    // fresh generation resets the session entirely.
    const session: FeedbackSession = {
      sessionId: crypto.randomUUID(),
      generatedAt: new Date().toISOString(),
      isWeekend,
      timeSlots: [...TIME_SLOTS],
      coverageRule: {
        definition: 'Door coverage = count of employees whose task is "IN", "OUT" or "B/D" at that slot (legacy "D" also counts).',
        min: 3,
        target: 4,
      },
      // Deep snapshot so later capability toggles can't retroactively change
      // what this baseline was generated under.
      roster: roster.map((e) => ({ ...e })),
      generatedGameplan: cloneMatrix(newMatrix),
      corrections: [],
    };
    saveSession(session);
    setFeedbackSession(session);
    // Make sure no stale editor/modal is left open across a regeneration.
    setEditingCell(null);
    setPendingChange(null);
  };

  const handleAutoGenerate = () => {
    // Locked past day: never regenerate (read-only, print/export only).
    if (selectedDayIdx === null || !parsed) return;
    if (!isPlanEditable(parsed.days[selectedDayIdx].dateLabel)) return;
    runGenerate(employees);
  };

  // Pull a scheduled non-door employee onto this day's roster as a helper (for a
  // short-staffed door). Their saved capabilities are applied if we have them;
  // a brand-new helper is registered so they appear in Employee Management going
  // forward. The manager then clicks Auto Generate to rebuild with the new team.
  const handleAddHelper = async (helper: Employee) => {
    if (!dayEditable) return;
    if (employees.some((e) => e.name === helper.name)) return;
    let h = helper;
    try {
      const rows = await employeeStore.list();
      const rec = rows.find((r) => r.name === helper.name);
      if (rec) {
        h = { ...helper, displayName: rec.displayName, canWalk: rec.canWalk, canSec: rec.canSec, doorSide: rec.doorSide };
      } else {
        await employeeStore.upsert({
          name: helper.name,
          canWalk: helper.canWalk,
          canSec: helper.canSec,
          doorSide: helper.doorSide ?? 'both',
          lastShift: helper.shift,
        });
      }
    } catch {
      // Capability lookup / registration is best-effort; still add the helper.
    }
    setEmployees((prev) => (prev.some((e) => e.name === h.name) ? prev : [...prev, h].sort(rosterSort)));
    if (isGenerated) setRosterDirty(true);
    setHelperSearch('');
  };

  // Remove a helper that was added to this day. Never touches the core door team
  // (the picker only offers removal for added helpers).
  const handleRemoveHelper = (name: string) => {
    if (!dayEditable) return;
    setEmployees((prev) => prev.filter((e) => e.name !== name));
    if (isGenerated) setRosterDirty(true);
  };

  // Download the day as a print-ready .xlsx styled exactly like the paper
  // "Member Service Gameplan" (grey off-shift cells, borders, A4 fit-to-page)
  // for managers who prefer printing from Excel / Google Sheets.
  const handleExport = async () => {
    if (!employees.length || !isGenerated || selectedDayIdx === null || !parsed) {
      alert("Please upload a schedule and generate the gameplan first.");
      return;
    }
    try {
      await exportGameplanXlsx(
        parsed.days[selectedDayIdx].dateLabel,
        employees,
        scheduleMatrix
      );
    } catch (err) {
      console.error(err);
      alert("Excel export failed - see the console for details.");
    }
  };

  // Persist the finalized day (roster snapshot + grid) to the gameplan store so
  // it's saved as the day's official version and reprintable later.
  const handleFinalizeSave = async () => {
    if (!isGenerated || selectedDayIdx === null || !parsed) return;
    // A past day is locked: it can be reprinted/exported but never re-finalized.
    if (!isPlanEditable(parsed.days[selectedDayIdx].dateLabel)) return;
    setSaveState('saving');
    try {
      await gameplanStore.save({
        date: parsed.days[selectedDayIdx].dateLabel,
        isWeekend,
        roster: employees.map((e) => ({ ...e })),
        plan: cloneMatrix(scheduleMatrix),
      });
      setSaveState('saved');
      refreshHistory();
    } catch (err) {
      console.error(err);
      setSaveState('error');
    }
  };

  // Generate AND finalize EVERY day in the uploaded file in one pass, applying
  // each person's saved capabilities/door-side. Managers get the whole week's
  // gameplans saved (and reprintable from the history dashboard) without opening
  // each day. Unseen names are registered so they appear on the Employees page.
  const handleGenerateAllDays = async () => {
    if (!parsed) return;
    setBulkState('running');
    setBulkDone(0);
    setBulkSkipped(0);
    try {
      const rows = await employeeStore.list();
      const saved: Record<string, EmployeeRecord> = {};
      for (const r of rows) saved[r.name] = r;

      const known = new Set(rows.map((r) => r.name));
      const unseen = new Map<string, Employee>();
      for (const day of parsed.days) {
        for (const e of day.employees) if (!known.has(e.name)) unseen.set(e.name, e);
      }
      if (unseen.size) {
        await Promise.all(
          [...unseen.values()].map((e) =>
            employeeStore.upsert({
              name: e.name,
              canWalk: e.canWalk,
              canSec: e.canSec,
              doorSide: e.doorSide ?? 'both',
              lastShift: e.shift,
            })
          )
        ).catch(() => {});
      }

      let done = 0;
      let skipped = 0;
      for (const day of parsed.days) {
        // Skip past days: they are locked and must not be (re)finalized.
        if (!isPlanEditable(day.dateLabel)) {
          skipped++;
          continue;
        }
        const roster = overlayCaps(day.employees, saved);
        const plan = generateGameplan(roster, day.isWeekend);
        await gameplanStore.save({
          date: day.dateLabel,
          isWeekend: day.isWeekend,
          roster: roster.map((e) => ({ ...e })),
          plan,
        });
        done++;
        setBulkDone(done);
      }
      setBulkSkipped(skipped);
      setBulkState('done');
      refreshHistory();
    } catch (err) {
      console.error(err);
      setBulkState('error');
    }
  };

  // Reprint / re-export a saved plan straight from the history list.
  const handlePrintSaved = (fp: FinalizedGameplan) => {
    setSavedForPrint(fp);
    // Let React paint the hidden print form before opening the dialog.
    window.setTimeout(() => window.print(), 60);
  };
  const handleExcelSaved = (fp: FinalizedGameplan) => {
    exportGameplanXlsx(fp.date, fp.roster, fp.plan).catch((e) => {
      console.error(e);
      alert('Excel export failed - see the console.');
    });
  };

  // Open the browser print dialog. The print CSS swaps the screen for the A4
  // "Member Service Gameplan" form (#gameplan-print); "Save as PDF" yields a file.
  const handlePrint = () => window.print();

  // ── TEMP - floating cell editor + feedback capture ──────────────────────
  // Open the popover for an active cell, anchored to its on-screen rect.
  // Only meaningful once a baseline exists (after Auto Generate), so corrections
  // are always recorded against a real generated plan.
  const openCellEditor = (
    e: React.MouseEvent<HTMLTableCellElement>,
    empName: string,
    time: string,
    slotIdx: number
  ) => {
    if (!feedbackSession) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setEditingCell({ empName, time, slotIdx, rect });
  };

  // Apply a chosen task to the matrix. If it actually changes the value, open
  // the feedback modal; otherwise just close the popover.
  const handleSelectTask = (newTask: TaskCode) => {
    if (!editingCell) return;
    const { empName, time, slotIdx } = editingCell;
    const oldTask = (scheduleMatrix[empName]?.[time] || '') as TaskCode;
    setEditingCell(null);

    if (newTask === oldTask) return; // No-op selection - nothing to record.

    // Coverage BEFORE applying the change, measured on the current matrix.
    const doorCoverageBefore = countDoorCoverageAt(scheduleMatrix, employees, time);

    // Apply the new value, then measure coverage AFTER on the updated matrix.
    const updated = cloneMatrix(scheduleMatrix);
    if (!updated[empName]) updated[empName] = {};
    updated[empName][time] = newTask;
    const doorCoverageAfter = countDoorCoverageAt(updated, employees, time);
    setScheduleMatrix(updated);
    setSaveState('idle'); // a manual edit means the saved version is now stale

    // Stage the change and open the "Why did you change this?" modal.
    setPendingChange({
      empName,
      time,
      slotIdx,
      oldTask,
      newTask,
      doorCoverageBefore,
      doorCoverageAfter,
    });
    setModalReasons([]);
    setModalScope('once');
    setModalNote('');
  };

  // Toggle a reason chip in the modal (multi-select).
  const toggleReason = (reason: CorrectionReason) => {
    setModalReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );
  };

  // Build and persist a Correction against the current baseline. `labeled`
  // distinguishes an explained "Save" from a kept-but-unexplained "Skip".
  // The edited cell is already applied to scheduleMatrix; recording here keeps
  // the session's correction log a faithful, replayable diff of the baseline.
  const recordCorrection = (labeled: boolean) => {
    if (!pendingChange || !feedbackSession) {
      setPendingChange(null);
      return;
    }
    const emp = employees.find((e) => e.name === pendingChange.empName);

    const correction: Correction = {
      id: crypto.randomUUID(),
      sessionId: feedbackSession.sessionId,
      sequence: feedbackSession.corrections.length,
      labeled,
      timestamp: new Date().toISOString(),
      employeeName: pendingChange.empName,
      employeeShift: emp?.shift ?? '',
      employeeShiftLengthHours: emp?.shiftLengthHours ?? 0,
      employeeCanWalk: emp?.canWalk ?? false,
      employeeCanSec: emp?.canSec ?? false,
      time: pendingChange.time,
      slotIdx: pendingChange.slotIdx,
      oldTask: pendingChange.oldTask,
      newTask: pendingChange.newTask,
      reasons: labeled ? modalReasons : [],
      scope: modalScope,
      note: modalNote.trim(),
      doorCoverageBefore: pendingChange.doorCoverageBefore,
      doorCoverageAfter: pendingChange.doorCoverageAfter,
    };

    const nextSession: FeedbackSession = {
      ...feedbackSession,
      corrections: [...feedbackSession.corrections, correction],
    };
    saveSession(nextSession);
    setFeedbackSession(nextSession);
    setPendingChange(null);
  };

  // Save: requires at least one reason (enforced by the disabled button).
  const handleSaveFeedback = () => recordCorrection(true);

  // Skip: keep the edit, record it as an UNLABELED correction (no reason) so
  // the grid stays in sync with the correction log for replay.
  const handleSkipFeedback = () => recordCorrection(false);

  // Cancel (X / Escape / backdrop): REVERT the cell to its prior value and
  // record nothing - a true undo for accidental edits.
  const handleCancelEdit = () => {
    if (!pendingChange) return;
    const { empName, time, oldTask } = pendingChange;
    setScheduleMatrix((prev) => {
      const reverted = cloneMatrix(prev);
      if (!reverted[empName]) reverted[empName] = {};
      reverted[empName][time] = oldTask;
      return reverted;
    });
    setPendingChange(null);
  };

  // Clear all recorded feedback (with confirmation) and reset the session.
  const handleClearFeedback = () => {
    if (!window.confirm('Clear all recorded feedback corrections? This cannot be undone.')) {
      return;
    }
    clearSession();
    setFeedbackSession(null);
  };

  const getTaskColor = (task: string) => {
    switch(task) {
      case 'W': return 'var(--task-w-bg)';
      case 'IN': return 'var(--task-in-bg)';
      case 'OUT': return 'var(--task-out-bg)';
      case 'D': return 'var(--task-d-bg)';
      case 'B': return 'var(--task-b-bg)';
      case 'FE': return 'var(--task-fe-bg)';
      case 'SEC': return 'var(--task-sec-bg)';
      case 'B/D': return 'var(--task-d-bg)';
      case 'PUSH': return 'var(--task-push-bg)';
      // TEMP - "FE HELP" uses the danger token (red in both themes) so a short-handed door stands out.
      case 'FE HELP': return 'var(--alert-danger)';
      default: return 'var(--task-none-bg)';
    }
  };

  const getTaskTextColor = (task: string) => {
    switch(task) {
      case 'W': return 'var(--task-w-text)';
      case 'IN': return 'var(--task-in-text)';
      case 'OUT': return 'var(--task-out-text)';
      case 'D': return 'var(--task-d-text)';
      case 'B': return 'var(--task-b-text)';
      case 'FE': return 'var(--task-fe-text)';
      case 'SEC': return 'var(--task-sec-text)';
      case 'B/D': return 'var(--task-d-text)';
      case 'PUSH': return 'var(--task-push-text)';
      // TEMP - white on red for the "FE HELP" alert.
      case 'FE HELP': return '#ffffff';
      default: return 'var(--text-primary)';
    }
  };

  // Per-slot understaffing flags for the far-right "FE HELP" column, recomputed
  // from the current grid (so manual edits update it live).
  const helpRow = isGenerated ? computeHelpRow(scheduleMatrix, employees, isWeekend) : {};

  // Whether the open day may still be edited/finalized (today or a future day).
  // A past day is locked: read-only, print and Excel export only.
  const dayEditable =
    parsed && selectedDayIdx !== null ? isPlanEditable(parsed.days[selectedDayIdx].dateLabel) : true;
  // How many days in the uploaded file are still editable (for the bulk button).
  const editableDaysCount = parsed ? parsed.days.filter((d) => isPlanEditable(d.dateLabel)).length : 0;

  // Dashboard history panel - the list of finalized gameplans with reprint /
  // re-export actions. Rendered on the landing (no-file) screen.
  const historyBtnStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '32px', height: '32px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)',
    color: 'var(--text-secondary)', cursor: 'pointer',
  };
  const historyPanel = history.length > 0 ? (
    <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', maxWidth: '600px', margin: '1.5rem auto 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <History size={18} color="var(--accent-secondary)" />
        <h3 style={{ fontSize: '1rem' }}>Finalized gameplans</h3>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1rem' }}>
        Saved day plans - reprint or export any of them without re-uploading.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '360px', overflowY: 'auto' }}>
        {history.map((fp) => (
          <div key={fp.date} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.6rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0, textAlign: 'left' }}>
              <span style={{ fontWeight: 600 }}>{fp.date}</span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                finalized {fmtFinalized(fp.finalizedAt)}{fp.updatedByEmail ? ` · ${fp.updatedByEmail}` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <span style={{ fontSize: '0.64rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '999px', backgroundColor: fp.isWeekend ? 'var(--accent-primary)' : 'var(--accent-secondary)', color: '#fff' }}>
                {fp.isWeekend ? 'WEEKEND' : 'WEEKDAY'}
              </span>
              <button onClick={() => handlePrintSaved(fp)} title={`Print / PDF - ${fp.date}`} aria-label={`Print ${fp.date}`} style={historyBtnStyle}>
                <Printer size={15} />
              </button>
              <button onClick={() => handleExcelSaved(fp)} title={`Export Excel - ${fp.date}`} aria-label={`Export ${fp.date}`} style={historyBtnStyle}>
                <FileSpreadsheet size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <>
    <div className="animate-fade-in app-screen" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppHeader
        actions={[
          { kind: 'link', label: 'Manage Employees', href: '/employees', icon: <Users size={18} /> },
          { kind: 'link', label: 'Accounts', href: '/users', icon: <ShieldCheck size={18} /> },
          { kind: 'button', label: 'Export Excel', onClick: handleExport, icon: <Download size={18} />, primary: true },
        ]}
      />

      <main className="container" style={{ flex: 1, maxWidth: '1400px' }}>
        {!parsed ? (
          <>
          <div className="glass-panel" style={{
            padding: '4rem 2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.5rem',
            maxWidth: '600px',
            margin: '3rem auto 0'
          }}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: 'var(--bg-tertiary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Upload size={40} color="var(--accent-primary)" />
            </div>

            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Upload Weekly Schedule</h2>
              <p style={{ color: 'var(--text-secondary)' }}>
                Drag and drop the Costco Excel schedule file here, or click to browse.
              </p>
            </div>

            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                color: 'var(--alert-text)', backgroundColor: 'var(--alert-bg)',
                padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)'
              }}>
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <label className="btn-primary" style={{ display: 'inline-block', marginTop: '1rem' }}>
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RefreshCw className="animate-spin" size={18} /> Processing...
                </span>
              ) : 'Select File'}
            </label>
          </div>
          {historyPanel}
          </>
        ) : selectedDayIdx === null ? (
          <>
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem', maxWidth: '720px', margin: '2rem auto 0' }}>
            <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={20} color="var(--accent-secondary)" />
              <h2>Pick a day</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
              {file ? `${file.name} - ` : ''}
              {parsed.timePeriod ? `period ${parsed.timePeriod}. ` : ''}
              Generate the whole week at once, or open a single day to review it.
            </p>

            {/* Generate & finalize every day in one pass. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              <button
                onClick={handleGenerateAllDays}
                disabled={bulkState === 'running' || editableDaysCount === 0}
                className="btn-primary"
                title={editableDaysCount === 0 ? 'Every day in this file has already passed and is locked' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  backgroundColor: 'var(--accent-secondary)',
                  opacity: bulkState === 'running' || editableDaysCount === 0 ? 0.7 : 1,
                  cursor: bulkState === 'running' || editableDaysCount === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                {bulkState === 'running' ? <RefreshCw className="animate-spin" size={18} /> : <Layers size={18} />}
                {bulkState === 'running'
                  ? `Generating ${bulkDone}/${editableDaysCount}…`
                  : editableDaysCount === parsed.days.length
                    ? `Generate & Save all ${parsed.days.length} days`
                    : `Generate & Save ${editableDaysCount} open day${editableDaysCount === 1 ? '' : 's'}`}
              </button>
              {bulkState === 'done' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--task-b-text)', fontSize: '0.85rem', fontWeight: 600 }}>
                  <Check size={16} /> Saved {bulkDone} day{bulkDone === 1 ? '' : 's'}{bulkSkipped > 0 ? `, skipped ${bulkSkipped} past day${bulkSkipped === 1 ? '' : 's'}` : ''}. Find them below and on the dashboard.
                </span>
              )}
              {bulkState === 'error' && (
                <span style={{ color: 'var(--alert-text)', fontSize: '0.85rem' }}>Something failed - try again.</span>
              )}
              {editableDaysCount === 0 && bulkState !== 'running' && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  All days in this file have already passed. Reprint any saved plan from the dashboard below.
                </span>
              )}
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
              …or open a single day to review and adjust it:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {parsed.days.map((day, idx) => (
                <button
                  key={day.dateLabel + idx}
                  onClick={() => selectDay(idx)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '1rem 1.25rem', cursor: 'pointer', textAlign: 'left',
                    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span style={{ fontWeight: 600 }}>{day.dateLabel}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {day.employees.length} door staff
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {!isPlanEditable(day.dateLabel) && (
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                        borderRadius: '999px', backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-muted)', border: '1px solid var(--border-color)',
                      }}>
                        LOCKED
                      </span>
                    )}
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                      borderRadius: '999px',
                      backgroundColor: day.isWeekend ? 'var(--accent-primary)' : 'var(--accent-secondary)',
                      color: '#ffffff',
                    }}>
                      {day.isWeekend ? 'WEEKEND' : 'WEEKDAY'}
                    </span>
                    <ChevronRight size={18} color="var(--text-secondary)" />
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={handleStartOver}
              style={{
                marginTop: '1.5rem', background: 'none', border: '1px solid var(--border-color)',
                padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                color: 'var(--text-secondary)', fontFamily: 'inherit',
              }}
            >
              Upload a different file
            </button>
          </div>
          {historyPanel}
          </>
        ) : (
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <div>
                <h2>Gameplan Grid</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {parsed.days[selectedDayIdx].dateLabel} · {isWeekend ? 'Weekend' : 'Weekday'} · {employees.length} door staff
                  {!dayEditable && (
                    <span style={{ marginLeft: '0.5rem', fontWeight: 700, color: 'var(--text-muted)' }}>· Locked (past day)</span>
                  )}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <button
                  onClick={backToDays}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    background: 'none', border: '1px solid var(--border-color)',
                    padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'inherit',
                  }}
                >
                  <Calendar size={16} />
                  Change day
                </button>
                <button
                  onClick={handleAutoGenerate}
                  disabled={!dayEditable}
                  className="btn-primary"
                  title={dayEditable ? 'Generate the gameplan from the schedule rules' : 'This day has passed and is locked'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    opacity: dayEditable ? 1 : 0.5,
                    cursor: dayEditable ? 'pointer' : 'not-allowed',
                  }}
                >
                  <Play size={18} />
                  Auto Generate
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                >
                  <Settings size={18} />
                  Capabilities
                </button>
                {dayEditable && (
                  <button
                    onClick={() => setShowAddHelper(true)}
                    className="btn-primary"
                    title="Add someone else scheduled today to help at the door"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                  >
                    <UserPlus size={18} />
                    Add helper
                  </button>
                )}
                <button
                  onClick={handleFinalizeSave}
                  disabled={!isGenerated || !dayEditable || saveState === 'saving'}
                  className="btn-primary"
                  title={
                    !dayEditable
                      ? 'This day has passed and can no longer be finalized'
                      : !isGenerated
                        ? 'Generate a plan first'
                        : 'Save this day as the finalized version'
                  }
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    backgroundColor: saveState === 'saved' ? 'var(--task-b-text)' : 'var(--accent-secondary)',
                    opacity: !isGenerated || !dayEditable ? 0.5 : 1,
                    cursor: !isGenerated || !dayEditable || saveState === 'saving' ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saveState === 'saving' ? <RefreshCw className="animate-spin" size={18} /> : saveState === 'saved' ? <Check size={18} /> : <Save size={18} />}
                  {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Retry save' : 'Finalize & Save'}
                </button>
                <button
                  onClick={handlePrint}
                  disabled={!isGenerated}
                  className="btn-primary"
                  title={!isGenerated ? 'Generate a plan first' : 'Print or save the A4 gameplan as PDF'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    opacity: !isGenerated ? 0.5 : 1,
                    cursor: !isGenerated ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Printer size={18} />
                  Print / PDF
                </button>
                <button
                  onClick={handleStartOver}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    padding: '0.5rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)'
                  }}
                >
                  Start Over
                </button>
              </div>
            </div>

            {/* TEMP FEEDBACK TOOLBAR - remove when algorithm is finalized. Hidden
                on a locked past day, which cannot be edited or corrected. */}
            {dayEditable && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                flexWrap: 'wrap',
                marginBottom: '1.5rem',
                padding: '0.75rem 1rem',
                border: '2px dashed var(--accent-primary)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-tertiary)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
                <FlaskConical size={18} />
                Feedback Mode (temporary)
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                {feedbackSession?.corrections.length ?? 0} corrections recorded
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                <button
                  onClick={() => feedbackSession && exportSessionAsFile(feedbackSession)}
                  disabled={(feedbackSession?.corrections.length ?? 0) === 0}
                  className="btn-primary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1rem',
                    opacity: (feedbackSession?.corrections.length ?? 0) === 0 ? 0.5 : 1,
                    cursor: (feedbackSession?.corrections.length ?? 0) === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Download size={16} />
                  Export Feedback
                </button>
                <button
                  onClick={handleClearFeedback}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    padding: '0.5rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Trash2 size={16} />
                  Clear
                </button>
              </div>
              <span style={{ flexBasis: '100%', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                Generate a plan, then click any cell to correct it and tell me why - Export when done.
              </span>
            </div>
            )}

            {dayEditable && rosterDirty && (
              <div style={{
                marginBottom: '1rem', padding: '0.75rem 1rem',
                backgroundColor: 'var(--task-w-bg)', color: 'var(--task-w-text)',
                borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center',
                gap: '0.6rem', flexWrap: 'wrap',
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '0.85rem' }}>
                  The roster changed. Rebuild the plan so it includes the updated team.
                </span>
                <button
                  onClick={handleAutoGenerate}
                  className="btn-primary"
                  style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.85rem' }}
                >
                  <Play size={16} /> Auto Generate now
                </button>
              </div>
            )}

            <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', position: 'sticky', left: 0, top: 0, backgroundColor: 'var(--bg-tertiary)', zIndex: 20, borderRight: '2px solid var(--border-color)', minWidth: '80px' }}>Time</th>
                    {employees.map((emp, idx) => (
                      <th key={idx} style={{ padding: '0.75rem 0.5rem', position: 'sticky', top: 0, backgroundColor: 'var(--bg-tertiary)', zIndex: 10, borderRight: '1px solid var(--border-color)', minWidth: '70px' }}>
                        <div style={{ fontWeight: 600 }}>{displayFor(emp)}</div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)' }}>{emp.shift}</div>
                      </th>
                    ))}
                    <th style={{ padding: '0.75rem 0.5rem', position: 'sticky', top: 0, backgroundColor: 'var(--bg-tertiary)', zIndex: 10, borderLeft: '2px solid var(--border-color)', minWidth: '80px', fontSize: '0.8rem' }}>
                      Door<br />(IN+OUT)
                    </th>
                    <th style={{ padding: '0.75rem 0.5rem', position: 'sticky', top: 0, backgroundColor: 'var(--bg-tertiary)', zIndex: 10, borderLeft: '1px solid var(--border-color)', minWidth: '90px', fontSize: '0.8rem' }}>
                      Need<br />Help?
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TIME_SLOTS.map((time, tIdx) => {
                    // The grid starts at 8:00 like the paper form - pre-8:00
                    // work (the 7 AM walk) is generated but not displayed.
                    if (tIdx < DISPLAY_START_IDX) return null;
                    let coverage = 0;
                    employees.forEach(e => {
                      const t = scheduleMatrix[e.name]?.[time];
                      if (t === "IN" || t === "OUT" || t === "D" || t === "B/D") coverage++;
                    });
                    return (
                      <tr key={time} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'left', position: 'sticky', left: 0, backgroundColor: 'var(--bg-secondary)', zIndex: 5, borderRight: '2px solid var(--border-color)', fontWeight: 500, fontSize: '0.875rem' }}>
                          {time}
                        </td>
                        {employees.map((emp, empIdx) => {
                          const cellTask = scheduleMatrix[emp.name]?.[time] || "";
                          const isActive = tIdx >= emp.shiftStartIdx && tIdx < emp.shiftEndIdx;
                          // Editable only after a baseline exists (so every edit
                          // is a correction against a real generated plan) and
                          // only while the day itself is unlocked (not a past day).
                          const editable = isActive && isGenerated && dayEditable;
                          return (
                            <td
                              key={`${empIdx}-${time}`}
                              onClick={(e) => editable && openCellEditor(e, emp.name, time, tIdx)}
                              style={{
                                padding: '0.5rem',
                                borderRight: '1px solid var(--border-color)',
                                backgroundColor: isActive ? getTaskColor(cellTask) : 'var(--bg-tertiary)',
                                color: getTaskTextColor(cellTask),
                                cursor: editable ? 'pointer' : (isActive ? 'default' : 'not-allowed'),
                                fontWeight: cellTask ? 600 : 400,
                                fontSize: '0.875rem',
                                transition: 'background-color 0.2s',
                                opacity: isActive ? 1 : 0.4
                              }}
                            >
                              {cellTask}
                            </td>
                          );
                        })}
                        <td style={{ padding: '0.5rem', fontWeight: 600, borderLeft: '2px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: coverage < 3 ? 'var(--alert-danger)' : 'inherit' }}>
                          {coverage}
                        </td>
                        <td style={{
                          padding: '0.5rem',
                          fontWeight: 700,
                          fontSize: '0.7rem',
                          borderLeft: '1px solid var(--border-color)',
                          backgroundColor: helpRow[time] ? 'var(--alert-danger)' : 'var(--bg-tertiary)',
                          color: helpRow[time] ? '#ffffff' : 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                        }}>
                          {helpRow[time] ? 'FE HELP' : ' - '}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!dayEditable && (
              <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'var(--task-d-bg)', color: 'var(--task-d-text)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <p style={{ fontSize: '0.875rem' }}>
                  <strong>This day has passed and is locked.</strong> It can be printed or exported to Excel, but it can no longer be edited or finalized.{' '}
                  {isGenerated
                    ? 'You are viewing its finalized version.'
                    : 'No finalized version was saved for this day.'}
                </p>
              </div>
            )}

            {dayEditable && !isGenerated && (
              <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'var(--task-w-bg)', color: 'var(--task-w-text)', borderRadius: 'var(--radius-md)' }}>
                <p style={{ fontSize: '0.875rem' }}>
                  <strong>Tip:</strong> Click <strong>Auto Generate</strong> to populate the Gameplan from the schedule rules. After generating, click any cell to adjust it and record why.
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      <AppFooter />

      {/* TEMP - floating cell editor popover (feedback scaffolding) */}
      {editingCell && (() => {
        // Anchor near the clicked cell; clamp into the viewport so it stays visible.
        const POPOVER_WIDTH = 160;
        const POPOVER_MAX_HEIGHT = 320;
        const left = Math.min(
          editingCell.rect.left,
          window.innerWidth - POPOVER_WIDTH - 8
        );
        const top = Math.min(
          editingCell.rect.bottom + 4,
          window.innerHeight - POPOVER_MAX_HEIGHT - 8
        );
        return (
          <>
            {/* Click-away overlay closes the popover on any outside click. */}
            <div
              onClick={() => setEditingCell(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'transparent' }}
            />
            <div
              role="menu"
              style={{
                position: 'fixed',
                top: Math.max(8, top),
                left: Math.max(8, left),
                width: POPOVER_WIDTH,
                zIndex: 61,
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden',
                padding: '0.25rem',
              }}
            >
              {TASK_OPTIONS.map((opt) => (
                <button
                  key={opt.code || 'empty'}
                  role="menuitem"
                  onClick={() => handleSelectTask(opt.code)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    width: '100%',
                    border: 'none',
                    background: 'none',
                    padding: '0.4rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '2.5rem',
                      height: '1.5rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      backgroundColor: getTaskColor(opt.code),
                      color: getTaskTextColor(opt.code),
                      fontSize: '0.75rem',
                      fontWeight: 600,
                    }}
                  >
                    {opt.code || ' - '}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {/* TEMP - "Why did you change this?" feedback modal (feedback scaffolding) */}
      {pendingChange && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) handleCancelEdit(); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70
          }}
        >
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem', width: '560px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <h2>Why did you change this?</h2>
              <button onClick={handleCancelEdit} title="Undo this change" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={24} /></button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              {pendingChange.empName} at {pendingChange.time}:{'  '}
              {(pendingChange.oldTask || ' - ')} &rarr; {(pendingChange.newTask || ' - ')}
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Reason (pick any)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {REASON_OPTIONS.map((opt) => {
                  const selected = modalReasons.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleReason(opt.value)}
                      style={{
                        padding: '0.4rem 0.75rem',
                        borderRadius: '999px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontFamily: 'inherit',
                        border: selected ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                        backgroundColor: selected ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                        color: selected ? '#ffffff' : 'var(--text-primary)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Apply to</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {SCOPE_OPTIONS.map((opt) => {
                  const selected = modalScope === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setModalScope(opt.value)}
                      style={{
                        padding: '0.4rem 0.75rem',
                        borderRadius: '999px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontFamily: 'inherit',
                        border: selected ? '1px solid var(--accent-secondary)' : '1px solid var(--border-color)',
                        backgroundColor: selected ? 'var(--accent-secondary)' : 'var(--bg-tertiary)',
                        color: selected ? '#ffffff' : 'var(--text-primary)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem', display: 'block' }}>
                Explain in your own words (optional)
              </label>
              <textarea
                value={modalNote}
                onChange={(e) => setModalNote(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  fontSize: '0.875rem',
                  resize: 'vertical',
                }}
              />
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              Your edit is already applied. <strong>Save</strong> records your reason ·
              {' '}<strong>Skip</strong> keeps it without a reason · <strong>Close (Esc)</strong> undoes it.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                className="btn-primary"
                style={{ flex: 1, opacity: modalReasons.length === 0 ? 0.5 : 1, cursor: modalReasons.length === 0 ? 'not-allowed' : 'pointer' }}
                onClick={handleSaveFeedback}
                disabled={modalReasons.length === 0}
                title={modalReasons.length === 0 ? 'Pick at least one reason to save' : undefined}
              >
                Save feedback
              </button>
              <button
                onClick={handleSkipFeedback}
                style={{
                  flex: 1,
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  padding: '0.75rem 1.5rem',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  fontFamily: 'inherit',
                }}
              >
                Skip (keep, no reason)
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem', width: '640px', maxWidth: '92vw', backgroundColor: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>Employee Capabilities</h2>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={24} /></button>
            </div>
            <div style={{ maxHeight: '400px', overflowY: 'auto', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.5rem' }}>Name</th>
                    <th style={{ padding: '0.5rem' }}>Display name</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}>Can Walk (W)</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}>Can Sec (SEC)</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}>Door side</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.5rem' }}>{emp.name}</td>
                      <td style={{ padding: '0.5rem' }}>
                        <input
                          value={emp.displayName ?? ''}
                          onChange={(e) => setEmpDisplayName(idx, e.target.value)}
                          onBlur={() => commitEmpDisplayName(idx)}
                          placeholder={emp.name}
                          aria-label={`Display name for ${emp.name}`}
                          style={{
                            padding: '0.25rem 0.4rem', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)',
                            color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.8rem', width: '120px',
                          }}
                        />
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <input type="checkbox" checked={emp.canWalk} onChange={() => toggleCapability(idx, 'canWalk')} />
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <input type="checkbox" checked={emp.canSec} onChange={() => toggleCapability(idx, 'canSec')} />
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <select
                          value={emp.doorSide ?? 'both'}
                          onChange={(e) => setDoorSide(idx, e.target.value as DoorSide)}
                          style={{
                            padding: '0.25rem 0.4rem', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)',
                            color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.8rem',
                          }}
                        >
                          <option value="both">Both</option>
                          <option value="in">Entrance only</option>
                          <option value="out">Exit only</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={() => setShowSettings(false)}>
              Save Settings
            </button>
          </div>
        </div>
      )}

      {/* Add-a-helper picker: pull a reserve-pool employee onto this day's roster. */}
      {showAddHelper && selectedDayIdx !== null && parsed && (() => {
        const day = parsed.days[selectedDayIdx];
        const inRoster = new Set(employees.map((e) => e.name));
        const originalDoor = new Set(day.employees.map((e) => e.name));
        const addedHelpers = employees.filter((e) => !originalDoor.has(e.name));
        const q = helperSearch.trim().toLowerCase();
        const candidates = day.additional
          .filter((e) => !inRoster.has(e.name))
          .filter((e) => !q || e.name.toLowerCase().includes(q));
        return (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) setShowAddHelper(false); }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', zIndex: 55, padding: '1rem',
            }}
          >
            <div className="glass-panel animate-fade-in" style={{ padding: '1.75rem', width: '520px', maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto', backgroundColor: 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <UserPlus size={20} color="var(--accent-secondary)" />
                  <h2>Add a helper</h2>
                </div>
                <button onClick={() => setShowAddHelper(false)} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={22} /></button>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Pull in someone else scheduled on {day.dateLabel} when the door is short-staffed. After adding, click <strong>Auto Generate</strong> to rebuild the plan with them.
              </p>

              {addedHelpers.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Added helpers</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {addedHelpers.map((e) => (
                      <span key={e.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem', borderRadius: '999px', backgroundColor: 'var(--task-b-bg)', color: 'var(--task-b-text)', fontSize: '0.8rem' }}>
                        {e.name}
                        <button onClick={() => handleRemoveHelper(e.name)} title={`Remove ${e.name}`} aria-label={`Remove ${e.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0 }}>
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {day.additional.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>
                  No one else is scheduled on this day, so there is no one to pull in.
                </p>
              ) : (
                <>
                  <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
                    <Search size={16} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      value={helperSearch}
                      onChange={(e) => setHelperSearch(e.target.value)}
                      placeholder="Search by name…"
                      style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.9rem' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '320px', overflowY: 'auto' }}>
                    {candidates.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
                        {q ? 'No matches.' : 'Everyone scheduled today is already on the roster.'}
                      </p>
                    ) : (
                      candidates.map((e) => (
                        <div key={e.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)' }}>
                          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontWeight: 600 }}>{e.name}</span>
                            <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>shift {e.shift}</span>
                          </span>
                          <button
                            onClick={() => handleAddHelper(e)}
                            className="btn-primary"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', flexShrink: 0 }}
                          >
                            <UserPlus size={15} /> Add
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>

    {/* Printable A4 "Member Service Gameplan" - hidden on screen, shown on print. */}
    {isGenerated && selectedDayIdx !== null && parsed && (
      <GameplanPrint
        date={parsed.days[selectedDayIdx].dateLabel}
        roster={employees}
        plan={scheduleMatrix}
      />
    )}

    {/* Reprint form for a saved plan chosen from the history list. Only on the
        landing screen, where the builder's own print form isn't rendered, so
        exactly one #gameplan-print exists at print time. */}
    {!parsed && savedForPrint && (
      <GameplanPrint
        date={savedForPrint.date}
        roster={savedForPrint.roster}
        plan={savedForPrint.plan}
      />
    )}
    </>
  );
}
