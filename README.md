# 📋 Delegation Management System

> A full-stack **Google Apps Script** web application for managing task delegation, follow-ups, revision tracking, and executive-level performance dashboards — built entirely without any external backend or database.

---

## 🌟 What This Is

A production-ready internal tool built for real business use. The system lets a manager assign tasks to employees, track their progress through a follow-up workflow, log revisions, mark completions, and view live performance analytics — all inside a Google Sheets backend with a custom-built web UI.

No paid services. No external APIs. Just Google Apps Script + Sheets + a handcrafted dark-themed dashboard.

---

## ✨ Features

- **Task Assignment** — Assign tasks to employees with a First Commitment date; employee details auto-fill from the Employee Master
- **Follow-Up Workflow** — Mark revisions, log completion dates, update remarks — all from a single view
- **MD Dashboard** — Executive summary with live KPI cards, completion rate, on-time %, revision penalty, and performance score
- **Employee Performance Table** — Per-employee breakdown with total revisions, avg revisions/task, performance %, and status badges
- **Performance Formula** — Transparent, formula-driven scoring:
  ```
  Performance % = (Completion% × 0.5) + (OnTime% × 0.5) − RevisionPenalty
  RevisionPenalty = min(avgRevisions × 10, 50)
  avgRevisions    = totalRevisions ÷ activeTasks
  ```
- **Archive System** — Completed tasks can be archived to keep the active sheet clean
- **Employee Master Management** — Add, view, and manage employee records inline
- **Dark-Themed UI** — Fully responsive, professional dark interface with chart visualizations

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Google Apps Script (JavaScript) |
| Frontend | Vanilla HTML + CSS + JavaScript |
| Database | Google Sheets (MASTER, EMPLOYEE MASTER, ARCHIVE) |
| Charts | Chart.js 4.4 |
| Hosting | Google Apps Script Web App (no server needed) |

---

## 📁 Project Structure

```
delegation-mis/
├── Code.gs        # All backend logic — sheet ops, metrics, task management
├── Index.html     # Complete frontend — UI, styles, charts, client JS
└── README.md
```

The entire app lives in two files. `Code.gs` runs server-side in Google's infrastructure. `Index.html` is served as a web app and communicates with the backend via `google.script.run`.

---

## 🚀 How to Deploy

1. Go to [script.google.com](https://script.google.com) and create a **New Project**
2. Paste `Code.gs` content into the default `Code.gs` file
3. Create a new file → **HTML** → name it `Index` → paste `Index.html` content
4. Click **Deploy → New deployment → Web app**
5. Set "Execute as" → **Me**, "Who has access" → **Anyone in your organisation** (or Anyone)
6. Click **Deploy** and open the generated URL

The app will auto-create the required Google Sheets tabs (`MASTER`, `EMPLOYEE MASTER`, `ARCHIVE`) on first run.

---

## 📊 Sheet Structure

### MASTER Sheet
| Column | Field |
|---|---|
| A | Task ID |
| B | Assign Date |
| C | Emp ID |
| D | Emp Name |
| E | Department |
| F | Email |
| G | Mobile |
| H | Task Description |
| I | First Commitment |
| J | Expected Completion *(retained for legacy data)* |
| K | Revision Date 1 |
| L | Revision Date 2 |
| M | Completion Date |
| N | Revision Count |
| O | Status |
| P | Remarks |

### EMPLOYEE MASTER Sheet
`EMP ID · NAME · DEPARTMENT · MOBILE · EMAIL`

---

## 🔐 Notes on Data Safety

- All dates are stored as **Date objects** (not strings) — prevents Google Sheets' US-locale `MM/DD` silent-conversion bug
- `parseDate` accepts only unambiguous formats (`dd/MM/yyyy`, `yyyy-MM-dd`) — no silent misinterpretation
- Revision penalty is capped at 50% — protects against extreme outliers unfairly zeroing scores

---

## 💡 Key Engineering Decisions

**Why Google Apps Script?**
The client wanted zero infrastructure cost and no external dependencies. GAS runs on Google's servers, uses Google Sheets as the database, and is deployed as a web app — all free.

**Why store dates as Date objects?**
Google Sheets interprets string dates like `01/05/2026` differently based on the spreadsheet's locale. Storing native `Date` objects bypasses this entirely.

**Why average revisions (not total) for the penalty?**
Using total revisions would unfairly penalise employees with more tasks. A person with 10 tasks and 2 revisions is performing better than one with 2 tasks and 2 revisions. Average per active task normalises for workload.

---


---

## 👤 Author

**Abhishek Kumar**
Built as a production internal tool for real business operations by using AI assisted development automation and workflow optimization 
---

