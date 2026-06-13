"use client";

import React, { useState, useCallback } from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for real CSV parsing in SCRUM-9
import * as XLSX from 'xlsx';
import { Upload, Download, RefreshCw, AlertCircle, Settings, Play, X } from 'lucide-react';
import { type Employee, type Gameplan, type TaskCode, TASK_CYCLE } from '@/lib/types';
import { generateGameplan, TIME_SLOTS } from '@/lib/generator';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
// parseTime will be used by the CSV parsing logic added in SCRUM-9.
const parseTime = (t: string) => {
  const parts = t.split(":");
  return parseInt(parts[0]) * 60 + (parts[1] ? parseInt(parts[1]) : 0);
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
        // Mock parsing logic based on provided CSV structure
        const mockEmployees: Employee[] = [
          { name: "Sabrina", shift: "5-1330", canWalk: true, canSec: false, shiftStartIdx: -4, shiftEndIdx: 13, shiftLengthHours: 8.5 },
          { name: "Far", shift: "750-1620", canWalk: true, canSec: false, shiftStartIdx: 2, shiftEndIdx: 19, shiftLengthHours: 8.5 },
          { name: "Jen L", shift: "750-1620", canWalk: true, canSec: false, shiftStartIdx: 2, shiftEndIdx: 19, shiftLengthHours: 8.5 },
          { name: "Sue J", shift: "8-1630", canWalk: true, canSec: false, shiftStartIdx: 2, shiftEndIdx: 19, shiftLengthHours: 8.5 },
          { name: "Gail", shift: "830-1700", canWalk: false, canSec: false, shiftStartIdx: 3, shiftEndIdx: 20, shiftLengthHours: 8.5 },
          { name: "Ross", shift: "11-1930", canWalk: false, canSec: false, shiftStartIdx: 8, shiftEndIdx: 25, shiftLengthHours: 8.5 },
          { name: "Nikki", shift: "1445-2315", canWalk: false, canSec: true, shiftStartIdx: 15, shiftEndIdx: 32, shiftLengthHours: 8.5 },
          { name: "Shajeed", shift: "14-1900", canWalk: true, canSec: false, shiftStartIdx: 14, shiftEndIdx: 24, shiftLengthHours: 5 }
        ];
        
        setTimeout(() => {
          setEmployees(mockEmployees);
          
          const initialMatrix: Gameplan = {};
          mockEmployees.forEach(emp => {
            initialMatrix[emp.name] = {};
            TIME_SLOTS.forEach(time => {
              initialMatrix[emp.name][time] = "";
            });
          });
          setScheduleMatrix(initialMatrix);
          setLoading(false);
        }, 800); 
        
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

  const toggleCapability = (idx: number, field: 'canWalk' | 'canSec') => {
    const newEmp = [...employees];
    newEmp[idx][field] = !newEmp[idx][field];
    setEmployees(newEmp);
  };

  const handleAutoGenerate = () => {
    // Delegate all scheduling logic to the pure generator function.
    // The generator enforces all six Costco business rules internally.
    const newMatrix = generateGameplan(employees);
    setScheduleMatrix(newMatrix);
    setIsGenerated(true);
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
    TIME_SLOTS.forEach(time => {
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
    const currentTask = scheduleMatrix[empName][time] as TaskCode;
    const currentIndex = TASK_CYCLE.indexOf(currentTask);
    const nextTask = TASK_CYCLE[(currentIndex + 1) % TASK_CYCLE.length];
    
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
      case 'W': return 'var(--task-w-bg)';
      case 'D': return 'var(--task-d-bg)';
      case 'B': return 'var(--task-b-bg)';
      case 'FE': return 'var(--task-fe-bg)';
      case 'SEC': return 'var(--task-sec-bg)';
      case 'B/D': return 'var(--task-d-bg)';
      default: return 'var(--task-none-bg)';
    }
  };

  const getTaskTextColor = (task: string) => {
    switch(task) {
      case 'W': return 'var(--task-w-text)';
      case 'D': return 'var(--task-d-text)';
      case 'B': return 'var(--task-b-text)';
      case 'FE': return 'var(--task-fe-text)';
      case 'SEC': return 'var(--task-sec-text)';
      case 'B/D': return 'var(--task-d-text)';
      default: return 'var(--text-primary)';
    }
  };

  return (
    <html>
    <body>
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

            <div style={{ overflowX: 'auto', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', minWidth: '1200px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '1rem', textAlign: 'left', position: 'sticky', left: 0, backgroundColor: 'var(--bg-tertiary)', zIndex: 10, borderRight: '1px solid var(--border-color)' }}>Employee</th>
                    <th style={{ padding: '1rem', minWidth: '100px', borderRight: '2px solid var(--border-color)' }}>Shift</th>
                    {TIME_SLOTS.map(time => (
                      <th key={time} style={{ padding: '0.5rem', fontSize: '0.875rem', fontWeight: 500, minWidth: '50px', borderRight: '1px solid var(--border-color)' }}>
                        {time}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '1rem', textAlign: 'left', position: 'sticky', left: 0, backgroundColor: 'var(--bg-secondary)', zIndex: 10, borderRight: '1px solid var(--border-color)', fontWeight: 500 }}>
                        {emp.name}
                      </td>
                      <td style={{ padding: '1rem', fontSize: '0.875rem', borderRight: '2px solid var(--border-color)' }}>
                        {emp.shift}
                      </td>
                      {TIME_SLOTS.map((time, tIdx) => {
                        const cellTask = scheduleMatrix[emp.name]?.[time] || "";
                        const isActive = tIdx >= emp.shiftStartIdx && tIdx < emp.shiftEndIdx;
                        return (
                          <td 
                            key={`${emp.name}-${time}`} 
                            onClick={() => isActive && cycleTask(emp.name, time)}
                            style={{ 
                              padding: '0.5rem', 
                              borderRight: '1px solid var(--border-color)',
                              backgroundColor: isActive ? getTaskColor(cellTask) : 'var(--bg-tertiary)',
                              color: getTaskTextColor(cellTask),
                              cursor: isActive ? 'pointer' : 'not-allowed',
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
                    </tr>
                  ))}
                  <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '2px solid var(--border-color)' }}>
                    <td colSpan={2} style={{ padding: '1rem', textAlign: 'right', fontWeight: 600, borderRight: '2px solid var(--border-color)', position: 'sticky', left: 0, zIndex: 10 }}>Door (D) Coverage:</td>
                    {TIME_SLOTS.map(time => {
                      let count = 0;
                      employees.forEach(e => {
                        if (scheduleMatrix[e.name]?.[time] === "D" || scheduleMatrix[e.name]?.[time] === "B/D") count++;
                      });
                      return (
                        <td key={time} style={{ padding: '0.5rem', fontWeight: 600, color: count < 3 ? 'var(--accent-primary)' : 'inherit', borderRight: '1px solid var(--border-color)' }}>
                          {count}
                        </td>
                      );
                    })}
                  </tr>
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
                </
                tbody>
              </table>
            </div>
            <button className="btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={() => setShowSettings(false)}>
              Save Settings
            </button>
          </div>
        </div>
      )}
    </div>
    </body>
    </html>
  );
}
