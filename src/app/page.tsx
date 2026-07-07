"use client";

import React, { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { Upload, Download, RefreshCw, AlertCircle, Settings, Play, X, FlaskConical, Trash2, Calendar, ChevronRight, Users, Printer, Save, Check, ShieldCheck } from 'lucide-react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- TASK_CYCLE kept for reference; the popover editor below replaces click-to-cycle.
import { type DoorSide, type Employee, type EmployeeRecord, type Gameplan, type TaskCode, TASK_CYCLE } from '@/lib/types';
import { generateGameplan, computeHelpRow, TIME_SLOTS } from '@/lib/generator';
import { parseScheduleRows, type ScheduleParseResult } from '@/lib/parser';
import { employeeStore } from '@/lib/employeeStore';
import { gameplanStore } from '@/lib/gameplanStore';
import { exportGameplanXlsx } from '@/lib/excelExport';
import SignOutButton from '@/components/SignOutButton';
import GameplanPrint from '@/components/GameplanPrint';
// TEMPORARY — feedback capture scaffolding for algorithm training. Safe to delete once deterministic rules are finalized.
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

// TEMP — task options offered by the floating cell editor (feedback scaffolding).
// Door duty is picked as a SIDE (IN = entrance, OUT = exit); legacy "D" is not
// offered — old saved plans still render it, but new edits always take a side.
const TASK_OPTIONS: { code: TaskCode; label: string }[] = [
  { code: '', label: '—' },
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
// form. The 7 AM walk exists but is understood — it is not displayed.
const DISPLAY_START_IDX = 2;

// TEMP — reason chips (multi-select) mapping label → CorrectionReason.
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

// TEMP — scope chips (single-select) mapping label → CorrectionScope.
const SCOPE_OPTIONS: { value: CorrectionScope; label: string }[] = [
  { value: 'once', label: 'Just this once' },
  { value: 'employee', label: 'Always for this employee' },
  { value: 'similar-shifts', label: 'All similar shifts' },
  { value: 'everyone', label: 'Everyone' },
];

// TEMP — describes a cell change awaiting a reason in the feedback modal.
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

// TEMP — deep clone of a Gameplan for the feedback baseline (one level of
// inner records). Mirrors the generator's own immutability approach.
const cloneMatrix = (matrix: Gameplan): Gameplan => {
  const clone: Gameplan = {};
  for (const name in matrix) clone[name] = { ...matrix[name] };
  return clone;
};

// TEMP — door-equivalent coverage (IN + OUT + legacy D + B/D) at a time, given
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

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // scheduleMatrix[employeeName][timeSlot] = TaskCode
  const [scheduleMatrix, setScheduleMatrix] = useState<Gameplan>({});
  const [isGenerated, setIsGenerated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Weekday vs weekend ruleset — set from the selected day's date (no toggle).
  const [isWeekend, setIsWeekend] = useState(false);

  // The parsed workbook (may hold multiple days) and which day is open.
  const [parsed, setParsed] = useState<ScheduleParseResult | null>(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);

  // Finalize & save state for the printable gameplan.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // ── TEMP FEEDBACK STATE — remove with feedback scaffolding ──────────────
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
  // independently — capture:true catches that inner scroll) we close it rather
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
    // Show the parsed roster immediately (canWalk=true / canSec=false defaults).
    setEmployees(day.employees);
    setIsWeekend(day.isWeekend);
    setIsGenerated(false);
    const initialMatrix: Gameplan = {};
    day.employees.forEach((emp) => {
      initialMatrix[emp.name] = {};
      TIME_SLOTS.forEach((time) => { initialMatrix[emp.name][time] = ""; });
    });
    setScheduleMatrix(initialMatrix);
    setEditingCell(null);
    setPendingChange(null);
    setSaveState('idle');

    // Then overlay saved capabilities from the store (Supabase when configured,
    // else localStorage) so the manager doesn't re-set canWalk/canSec each
    // upload, and register any unseen names so they appear on the Employee
    // Management page (defaults only — existing saved capabilities are never
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
    // Optimistic UI update — never mutate the existing employee in place.
    setEmployees((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: nextVal } : e)));
    // Persist (non-clobbering single-field upsert) so it sticks for future
    // uploads of the same person, and stays in sync with the Employee page.
    employeeStore.upsert({ name: emp.name, [field]: nextVal }).catch(() => {});
  };

  // Door-side restriction (Both / Entrance only / Exit only) — same optimistic
  // + persisted pattern; the generator honours it on the next Auto Generate.
  const setDoorSide = (idx: number, side: DoorSide) => {
    const emp = employees[idx];
    if (!emp) return;
    setEmployees((prev) => prev.map((e, i) => (i === idx ? { ...e, doorSide: side } : e)));
    employeeStore.upsert({ name: emp.name, doorSide: side }).catch(() => {});
  };

  const handleAutoGenerate = () => {
    // Delegate all scheduling logic to the pure generator function.
    // The generator enforces the Costco business rules internally, branching
    // on the weekday/weekend ruleset selected above.
    const newMatrix = generateGameplan(employees, isWeekend);
    setScheduleMatrix(newMatrix);
    setIsGenerated(true);
    setSaveState('idle'); // a fresh plan is unsaved until finalized

    // ── TEMP — (re)write the feedback baseline on every generation ─────────
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
      roster: employees.map((e) => ({ ...e })),
      generatedGameplan: cloneMatrix(newMatrix),
      corrections: [],
    };
    saveSession(session);
    setFeedbackSession(session);
    // Make sure no stale editor/modal is left open across a regeneration.
    setEditingCell(null);
    setPendingChange(null);
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
      alert("Excel export failed — see the console for details.");
    }
  };

  // Persist the finalized day (roster snapshot + grid) to the gameplan store so
  // it's saved as the day's official version and reprintable later.
  const handleFinalizeSave = async () => {
    if (!isGenerated || selectedDayIdx === null || !parsed) return;
    setSaveState('saving');
    try {
      await gameplanStore.save({
        date: parsed.days[selectedDayIdx].dateLabel,
        isWeekend,
        roster: employees.map((e) => ({ ...e })),
        plan: cloneMatrix(scheduleMatrix),
      });
      setSaveState('saved');
    } catch (err) {
      console.error(err);
      setSaveState('error');
    }
  };

  // Open the browser print dialog. The print CSS swaps the screen for the A4
  // "Member Service Gameplan" form (#gameplan-print); "Save as PDF" yields a file.
  const handlePrint = () => window.print();

  // ── TEMP — floating cell editor + feedback capture ──────────────────────
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

    if (newTask === oldTask) return; // No-op selection — nothing to record.

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
  // record nothing — a true undo for accidental edits.
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
      // TEMP — "FE HELP" uses the danger token (red in both themes) so a short-handed door stands out.
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
      // TEMP — white on red for the "FE HELP" alert.
      case 'FE HELP': return '#ffffff';
      default: return 'var(--text-primary)';
    }
  };

  // Per-slot understaffing flags for the far-right "FE HELP" column, recomputed
  // from the current grid (so manual edits update it live).
  const helpRow = isGenerated ? computeHelpRow(scheduleMatrix, employees, isWeekend) : {};

  return (
    <>
    <div className="animate-fade-in app-screen" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid var(--accent-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/5/59/Costco_Wholesale_logo_2010-10-26.svg"
            alt="Costco Wholesale"
            style={{ height: '32px' }}
          />
          <h1 style={{ color: 'var(--accent-secondary)', borderLeft: '2px solid var(--border-color)', paddingLeft: '1rem', marginLeft: '0.5rem' }}>
            BreakAid Gameplan
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            href="/employees"
            className="btn-primary"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none',
              backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)',
            }}
          >
            <Users size={18} />
            Manage Employees
          </Link>
          <Link
            href="/users"
            className="btn-primary"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none',
              backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)',
            }}
          >
            <ShieldCheck size={18} />
            Accounts
          </Link>
          <button onClick={handleExport} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Download size={18} />
            Export Excel
          </button>
          <SignOutButton />
        </div>
      </header>

      <main className="container" style={{ flex: 1, maxWidth: '1400px' }}>
        {!parsed ? (
          <div className="glass-panel" style={{
            padding: '4rem 2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.5rem',
            maxWidth: '600px',
            margin: '4rem auto'
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
        ) : selectedDayIdx === null ? (
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem', maxWidth: '720px', margin: '2rem auto' }}>
            <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={20} color="var(--accent-secondary)" />
              <h2>Pick a day</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              {file ? `${file.name} — ` : ''}
              {parsed.timePeriod ? `period ${parsed.timePeriod}. ` : ''}
              Select a day to build its gameplan.
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
        ) : (
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <div>
                <h2>Gameplan Grid</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {parsed.days[selectedDayIdx].dateLabel} · {isWeekend ? 'Weekend' : 'Weekday'} · {employees.length} door staff
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
                  className="btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
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
                <button
                  onClick={handleFinalizeSave}
                  disabled={!isGenerated || saveState === 'saving'}
                  className="btn-primary"
                  title={!isGenerated ? 'Generate a plan first' : 'Save this day as the finalized version'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    backgroundColor: saveState === 'saved' ? 'var(--task-b-text)' : 'var(--accent-secondary)',
                    opacity: !isGenerated ? 0.5 : 1,
                    cursor: !isGenerated || saveState === 'saving' ? 'not-allowed' : 'pointer',
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

            {/* TEMP FEEDBACK TOOLBAR — remove when algorithm is finalized */}
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
                Generate a plan, then click any cell to correct it and tell me why — Export when done.
              </span>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', position: 'sticky', left: 0, top: 0, backgroundColor: 'var(--bg-tertiary)', zIndex: 20, borderRight: '2px solid var(--border-color)', minWidth: '80px' }}>Time</th>
                    {employees.map((emp, idx) => (
                      <th key={idx} style={{ padding: '0.75rem 0.5rem', position: 'sticky', top: 0, backgroundColor: 'var(--bg-tertiary)', zIndex: 10, borderRight: '1px solid var(--border-color)', minWidth: '70px' }}>
                        <div style={{ fontWeight: 600 }}>{emp.name}</div>
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
                    // The grid starts at 8:00 like the paper form — pre-8:00
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
                          // Editable only after a baseline exists, so every edit
                          // is a correction against a real generated plan.
                          const editable = isActive && isGenerated;
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
                          {helpRow[time] ? 'FE HELP' : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!isGenerated && (
              <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'var(--task-w-bg)', color: 'var(--task-w-text)', borderRadius: 'var(--radius-md)' }}>
                <p style={{ fontSize: '0.875rem' }}>
                  <strong>Tip:</strong> Click <strong>Auto Generate</strong> to populate the Gameplan from the schedule rules. After generating, click any cell to adjust it and record why.
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* TEMP — floating cell editor popover (feedback scaffolding) */}
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
                    {opt.code || '—'}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {/* TEMP — "Why did you change this?" feedback modal (feedback scaffolding) */}
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
              {(pendingChange.oldTask || '—')} &rarr; {(pendingChange.newTask || '—')}
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
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem', width: '500px', backgroundColor: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>Employee Capabilities</h2>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={24} /></button>
            </div>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.5rem' }}>Name</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}>Can Walk (W)</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}>Can Sec (SEC)</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}>Door side</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.5rem' }}>{emp.name}</td>
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
    </div>

    {/* Printable A4 "Member Service Gameplan" — hidden on screen, shown on print. */}
    {isGenerated && selectedDayIdx !== null && parsed && (
      <GameplanPrint
        date={parsed.days[selectedDayIdx].dateLabel}
        roster={employees}
        plan={scheduleMatrix}
      />
    )}
    </>
  );
}
