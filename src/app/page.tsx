"use client";

import React, { useState, useCallback } from 'react';
import { Upload, Download, RefreshCw, AlertCircle, Settings, Play, X } from 'lucide-react';
import { parseScheduleFile, resolveFileType } from '@/lib/parser';
import type { Employee } from '@/types';

// Available 30-min time slots based on the gameplan CSV
const timeSlots = [
  "7:00", "7:30", "8:00", "8:30", "9:00", "9:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
  "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
  "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30",
  "23:00", "23:30", "0:00"
];

const parseTime = (t: string) => {
  const parts = t.split(":");
  return parseInt(parts[0]) * 60 + (parts[1] ? parseInt(parts[1]) : 0);
};

/**
 * Converts a "HH:mm" time string to its 0-based index in the timeSlots array.
 * Grid starts at 7:00 (index 0) with 30-minute intervals.
 * Returns a negative index for shifts starting before 7:00 AM.
 */
const timeToSlotIndex = (timeStr: string): number => {
  const [h, m] = timeStr.split(":").map(Number);
  // 00:00 is midnight — maps to the last grid slot (index 34 = "0:00")
  if (h === 0 && m === 0) return timeSlots.length - 1;
  return ((h * 60 + m) - 7 * 60) / 30;
};

/**
 * Computes shift length in hours between two "HH:mm" strings.
 * Handles overnight shifts correctly.
 */
const calcShiftLengthHours = (start: string, end: string): number => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin   = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
};

// Valid task roles
const TASKS = ["", "W", "D", "B", "FE", "SEC", "B/D"];

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // scheduleMatrix[employeeName][timeSlot] = Task string
  const [scheduleMatrix, setScheduleMatrix] = useState<Record<string, Record<string, string>>>({});
  const [isGenerated, setIsGenerated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const fileType = resolveFileType(selectedFile);
    if (!fileType) {
      setError("Please upload a valid Excel (.xlsx) or CSV file.");
      return;
    }

    setFile(selectedFile);
    setError(null);
    setLoading(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      if (!buffer) {
        setError("Failed to read the file.");
        setLoading(false);
        return;
      }

      const result = parseScheduleFile(buffer, fileType);

      if (!result.success) {
        setError(result.error);
        setLoading(false);
        return;
      }

      // Convert ParsedEmployee[] -> Employee[] by computing grid indices
      const parsedEmployees: Employee[] = result.data.map((parsed) => ({
        name:             parsed.name,
        shift:            parsed.shiftRaw,
        canWalk:          false,
        canSec:           false,
        shiftStartIdx:    timeToSlotIndex(parsed.shiftStart),
        shiftEndIdx:      timeToSlotIndex(parsed.shiftEnd),
        shiftLengthHours: calcShiftLengthHours(parsed.shiftStart, parsed.shiftEnd),
      }));

      const initialMatrix: Record<string, Record<string, string>> = {};
      parsedEmployees.forEach((emp) => {
        initialMatrix[emp.name] = {};
        timeSlots.forEach((time) => {
          initialMatrix[emp.name][time] = "";
        });
      });

      setEmployees(parsedEmployees);
      setScheduleMatrix(initialMatrix);
      setLoading(false);
    };

    reader.onerror = () => {
      setError("Error reading the file.");
      setLoading(false);
    };

    reader.readAsArrayBuffer(selectedFile);
  }, []);

  const toggleCapability = (idx: number, field: 'canWalk' | 'canSec') => {
    const newEmp = [...employees];
    newEmp[idx][field] = !newEmp[idx][field];
    setEmployees(newEmp);
  };

  const handleAutoGenerate = () => {
    setIsGenerated(true);
    const newMatrix: Record<string, Record<string, string>> = {};
    
    // Initialize matrix with empty strings or default 'D' for active shifts
    employees.forEach(emp => {
      newMatrix[emp.name] = {};
      timeSlots.forEach((time, idx) => {
        if (idx >= emp.shiftStartIdx && idx < emp.shiftEndIdx) {
          newMatrix[emp.name][time] = "D"; // Default everyone to Door
        } else {
          newMatrix[emp.name][time] = ""; // Outside shift
        }
      });
    });

    // 1. Assign Walks (W) at the start of every hour
    // Identify hourly slots (e.g., 7:00, 8:00... indices where time ends with "00")
    const walkCounts: Record<string, number> = {};
    employees.forEach(e => walkCounts[e.name] = 0);

    timeSlots.forEach((time, tIdx) => {
      if (time.endsWith(":00")) {
        // Find eligible walkers active at this time
        const eligible = employees.filter(e => 
          e.canWalk && 
          tIdx >= e.shiftStartIdx && tIdx < e.shiftEndIdx &&
          newMatrix[e.name][time] === "D"
        );
        
        if (eligible.length > 0) {
          // Sort by who has done the least walks to ensure fairness
          eligible.sort((a, b) => walkCounts[a.name] - walkCounts[b.name]);
          // Pick one randomly among those with the minimum count
          const minCount = walkCounts[eligible[0].name];
          const minEligible = eligible.filter(e => walkCounts[e.name] === minCount);
          const chosen = minEligible[Math.floor(Math.random() * minEligible.length)];
          
          newMatrix[chosen.name][time] = "W";
          walkCounts[chosen.name]++;
        }
      }
    });

    // 2. Assign Breaks (B or B/D) ensuring min 3 people on D
    employees.forEach(emp => {
      const shiftLength = emp.shiftEndIdx - Math.max(0, emp.shiftStartIdx);
      if (shiftLength <= 0) return;

      const attemptBreak = (targetIdx: number, type: string) => {
        // Find closest valid spot around targetIdx
        for (let offset = 0; offset < 4; offset++) {
          for (let sign of [1, -1]) {
            const idx = targetIdx + (offset * sign);
            if (idx >= emp.shiftStartIdx + 2 && idx < emp.shiftEndIdx - 2) {
              const time = timeSlots[idx];
              if (newMatrix[emp.name][time] === "D") {
                // Check if we have at least 3 people left on D or B/D
                let dCount = 0;
                employees.forEach(e => {
                  if (newMatrix[e.name][time] === "D" || newMatrix[e.name][time] === "B/D") dCount++;
                });
                
                if (dCount > 3 || (dCount === 3 && type === "B/D")) {
                  newMatrix[emp.name][time] = type;
                  return true;
                }
              }
            }
          }
        }
        return false;
      };

      if (emp.shiftLengthHours >= 8) {
        // Two 30 min breaks (B)
        const b1 = Math.floor(Math.max(0, emp.shiftStartIdx) + shiftLength * 0.33);
        const b2 = Math.floor(Math.max(0, emp.shiftStartIdx) + shiftLength * 0.66);
        attemptBreak(b1, "B");
        attemptBreak(b2, "B");
      } else {
        // One B/D break
        const mid = Math.floor(Math.max(0, emp.shiftStartIdx) + shiftLength * 0.5);
        attemptBreak(mid, "B/D");
      }
    });

    // 3. Assign Security (SEC)
    employees.forEach(emp => {
      if (emp.canSec) {
        // Give SEC for the last 1.5 hours of their shift
        for (let i = emp.shiftEndIdx - 3; i < emp.shiftEndIdx; i++) {
          if (i >= 0 && i < timeSlots.length) {
            newMatrix[emp.name][timeSlots[i]] = "SEC";
          }
        }
      }
    });

    // 4. Front End overflow (FE)
    timeSlots.forEach((time) => {
      let dCount = 0;
      employees.forEach(e => {
        if (newMatrix[e.name][time] === "D" || newMatrix[e.name][time] === "B/D") dCount++;
      });
      
      if (dCount > 4) {
        // Assign excess to FE
        employees.forEach(e => {
          if (newMatrix[e.name][time] === "D" && dCount > 4) {
            newMatrix[e.name][time] = "FE";
            dCount--;
          }
        });
      }
    });

    setScheduleMatrix(newMatrix);
  };

  const handleExport = () => {
    if (!employees.length || !isGenerated) {
      alert("Please upload a schedule and generate the gameplan first.");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    
    // Header rows to mimic the Gameplan CSV format
    csvContent += ",,, ,,,,,,,,,,,,,,,,,,,,\n";
    csvContent += "DATE: " + new Date().toDateString() + ",,,,,,,,,,,,,,,,,,,,,,,\n";
    
    // Names row
    const names = ["Name", ...employees.map(e => e.name + ",,")].join(",");
    csvContent += names + "\n";
    
    // Shifts row
    const shifts = ["Shift", ...employees.map(e => e.shift + ",,")].join(",");
    csvContent += shifts + "\n";
    csvContent += ",,,,,,,,,,,,,,,,,,,,,,,\n";
    
    // Time rows
    timeSlots.forEach(time => {
      let row = [`${time}`];
      employees.forEach(emp => {
        row.push(scheduleMatrix[emp.name]?.[time] || "");
        row.push(""); // The original CSV format has an empty column between employees
      });
      csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `BreakAid_Gameplan_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const cycleTask = (empName: string, time: string) => {
    const currentTask = scheduleMatrix[empName][time];
    const currentIndex = TASKS.indexOf(currentTask);
    const nextTask = TASKS[(currentIndex + 1) % TASKS.length];
    
    setScheduleMatrix({
      ...scheduleMatrix,
      [empName]: {
        ...scheduleMatrix[empName],
        [time]: nextTask
      }
    });
  };

  const getTaskColor = (task: string) => {
    switch(task) {
      case 'W':   return '#dbeafe'; // blue
      case 'D':   return '#fef9c3'; // yellow
      case 'B':   return '#dcfce7'; // green
      case 'FE':  return '#fce7f3'; // pink
      case 'SEC': return '#e0e7ff'; // indigo
      case 'B/D': return '#fef9c3'; // yellow (same as D)
      default:    return '#ffffff';
    }
  };

  const getTaskTextColor = (task: string) => {
    switch(task) {
      case 'W':   return '#1d4ed8';
      case 'D':   return '#92400e';
      case 'B':   return '#15803d';
      case 'FE':  return '#be185d';
      case 'SEC': return '#3730a3';
      case 'B/D': return '#92400e';
      default:    return '#111827';
    }
  };

  return (
    <div className="animate-fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
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
        <button onClick={handleExport} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Download size={18} />
          Export Gameplan
        </button>
      </header>

      <main className="container" style={{ flex: 1, maxWidth: '1400px' }}>
        {!file || employees.length === 0 ? (
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
                color: '#ef4444', backgroundColor: '#fee2e2',
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
        ) : (
          <div className="glass-panel animate-fade-in" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <div>
                <h2>Gameplan Grid</h2>
                <p style={{ color: 'var(--text-secondary)' }}>Showing {employees.length} employees</p>
              </div>
              
              <div style={{ display: 'flex', gap: '1rem' }}>
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
                  onClick={() => { setFile(null); setEmployees([]); setIsGenerated(false); }}
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

            <div style={{ marginBottom: '0.75rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>
              086 - Security
            </div>

            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '75vh', backgroundColor: '#ffffff', borderRadius: 'var(--radius-md)', border: '2px solid #d1d5db' }}>

              <table style={{ borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.8rem', backgroundColor: '#ffffff' }}>
                <thead>
                  {/* Row 1 — Employee names */}
                  <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '2px solid #d1d5db' }}>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', position: 'sticky', left: 0, top: 0, backgroundColor: '#f3f4f6', zIndex: 20, border: '1px solid #d1d5db', minWidth: '70px', fontWeight: 600 }}></th>
                    <th style={{ padding: '0.5rem 0.75rem', position: 'sticky', top: 0, backgroundColor: '#f3f4f6', zIndex: 10, border: '1px solid #d1d5db', fontWeight: 600, color: '#111827' }}>Name</th>
                    {employees.map(emp => (
                      <th key={emp.name} style={{ padding: '0.4rem 0.5rem', position: 'sticky', top: 0, backgroundColor: '#f3f4f6', zIndex: 10, border: '1px solid #d1d5db', minWidth: '72px', fontWeight: 600, whiteSpace: 'nowrap', color: '#111827' }}>
                        {emp.name}
                      </th>
                    ))}
                  </tr>
                  {/* Row 2 — Shift codes */}
                  <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '2px solid #d1d5db' }}>
                    <td style={{ padding: '0.4rem 0.75rem', position: 'sticky', left: 0, top: 0, backgroundColor: '#f3f4f6', zIndex: 20, border: '1px solid #d1d5db', color: '#111827', fontWeight: 500 }}>Shift</td>
                    <td style={{ padding: '0.4rem 0.75rem', position: 'sticky', top: 0, backgroundColor: '#f3f4f6', zIndex: 10, border: '1px solid #d1d5db' }}></td>
                    {employees.map(emp => (
                      <td key={emp.name} style={{ padding: '0.4rem 0.5rem', position: 'sticky', top: 0, backgroundColor: '#f3f4f6', zIndex: 10, border: '1px solid #d1d5db', color: '#111827', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {emp.shift}
                      </td>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeSlots.map((time, tIdx) => {
                    const dCount = employees.filter(e =>
                      scheduleMatrix[e.name]?.[time] === "D" || scheduleMatrix[e.name]?.[time] === "B/D"
                    ).length;
                    const isHour = time.endsWith(":00");
                    return (
                      <tr key={time} style={{ backgroundColor: isHour ? '#f9fafb' : '#ffffff' }}>
                        <td style={{ padding: '0.35rem 0.75rem', position: 'sticky', left: 0, backgroundColor: isHour ? '#f9fafb' : '#ffffff', zIndex: 10, border: '1px solid #d1d5db', fontWeight: isHour ? 600 : 400, whiteSpace: 'nowrap', color: '#111827' }}>
                          {time}
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', fontWeight: 600, color: dCount < 3 ? 'var(--accent-primary)' : dCount >= 4 ? '#15803d' : '#92400e' }}>
                          {dCount > 0 ? dCount : ''}
                        </td>
                        {employees.map(emp => {
                          const cellTask = scheduleMatrix[emp.name]?.[time] || "";
                          const isActive = tIdx >= emp.shiftStartIdx && tIdx < emp.shiftEndIdx;
                          return (
                            <td
                              key={emp.name}
                              onClick={() => isActive && cycleTask(emp.name, time)}
                              style={{
                                padding: '0.35rem 0.25rem',
                                border: '1px solid #d1d5db',
                                backgroundColor: isActive ? getTaskColor(cellTask) : '#f3f4f6',
                                color: isActive ? getTaskTextColor(cellTask) : 'transparent',
                                cursor: isActive ? 'pointer' : 'default',
                                fontWeight: cellTask ? 700 : 400,
                                transition: 'background-color 0.15s',
                                minWidth: '72px',
                              }}
                            >
                              {isActive ? cellTask : ''}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {!isGenerated && (
              <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'var(--task-w-bg)', color: 'var(--task-w-text)', borderRadius: 'var(--radius-md)' }}>
                <p style={{ fontSize: '0.875rem' }}>
                  <strong>Tip:</strong> Click the "Auto Generate" button above to automatically populate the Gameplan based on schedule rules, or click inside the grid cells to manually assign tasks.
                </p>
              </div>
            )}
          </div>
        )}
      </main>

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
  );
}