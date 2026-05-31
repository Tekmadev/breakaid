# Costco BreakAid Gameplan Generator

## Project Overview
The **BreakAid Gameplan Generator** is a modern web application designed for Costco managers. It automates the complex daily scheduling of employees stationed at the warehouse entrance and exit (the Door). Managers can upload an employee weekly schedule, configure employee capabilities, and click a single button to auto-generate a 30-minute interval Gameplan grid that adheres to Costco's specific staffing and break policies.

## Technology Stack
- **Framework:** Next.js (App Router), React
- **Language:** TypeScript
- **Styling:** Premium Vanilla CSS (Glassmorphism UI) utilizing the official Costco brand colors (Costco Red `#E31837`, Costco Blue `#005DAA`).
- **Dependencies:** 
  - `xlsx` (SheetJS) for client-side Excel/CSV parsing without needing a backend.
  - `lucide-react` for UI iconography.

## Core Features
1. **File Upload:** A drag-and-drop zone to import the weekly schedule (`.xlsx` or `.csv`). 
2. **Employee Capabilities Management:** A settings modal where managers can toggle specific certifications for employees (e.g., who is authorized to do "Walks" or "Security").
3. **Interactive Grid:** A matrix UI displaying employees on the Y-axis and 30-minute time slots on the X-axis. Managers can click any active cell to manually cycle through task assignments.
4. **Auto Generate Engine:** A sophisticated algorithm that automatically assigns tasks to employees based on strict business rules.
5. **CSV Export:** Allows managers to download the finalized Gameplan in a format identical to the original Costco template.

## Auto-Generate Algorithm Rules
The core value of the application is the Auto Generate engine, which assigns the following task codes at 30-minute intervals:

- **Door (D):** The default assignment for active shifts. The algorithm attempts to maintain a target of exactly 4 employees on Door at any given time.
- **Walk (W):** Required at the start of every hour (e.g., 7:00, 8:00, 9:00). The algorithm randomly selects 1 capable employee, actively prioritizing those who have performed the fewest walks that day to ensure fair distribution.
- **Breaks (B or B/D):** 
  - **Full Shifts (8.5h):** Receive two 30-minute Breaks (`B`), spaced near the 1/3 and 2/3 marks of their shift.
  - **Shorter Shifts (4h - 5h):** Receive one 15-minute Break / 15-minute Door combo (`B/D`) near the middle of their shift.
  - **Coverage Constraint:** The algorithm validates that assigning a break will *never* drop Door coverage below a minimum of 3 people. If it would, the break is shifted to the closest available time slot.
- **Security (SEC):** Assigned only to authorized employees whose shifts end late (Midnight on weekdays, 11:30 PM on weekends). Typically assigned for the final duration of their shift after warehouse closing.
- **Front End (FE):** If a 30-minute block has more than 4 people assigned to the Door, and all Walks and Breaks are covered, the overflow employees are assigned to go help the Front End.

## Future Development & Next Steps
- **Custom Excel Parsing Logic:** Currently, the system uses mock data parsing. The immediate next step is to write the custom row-by-row extraction logic to pull the employee names and shift times directly from Costco's specific weekly schedule format.
- **Backend Integration (Optional):** Integrating a database to persistently store employee capabilities (`canWalk`, `canSec`) so managers don't have to re-configure them every time.
