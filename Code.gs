// ════════════════════════════════════════════════════════════════════
// DELEGATION MANAGEMENT SYSTEM — Code.gs  (Final Production Edition)
//
// ALL FIXES INCLUDED:
//   1. Dates stored as Date objects — eliminates Google Sheets locale
//      MM/DD vs DD/MM silent-conversion bug (day ≤ 12 corruption).
//   2. Progressive revision penalty formula replaces binary score.
//      Performance = (Completion%×0.5 + OnTime%×0.5) − RevisionPenalty
//      RevisionPenalty = min(avgRevisions × 10, 50)
//      avgRevisions    = totalRevisions / activeTasks (active = completed + pending)
//   3. parseDate fallback restricted to unambiguous ISO-8601 only.
//   4. avgRevisions now exposed in all metric payloads so the UI can
//      display the exact value the formula uses — eliminating the visual
//      mismatch between the "Rev" column total and the computed penalty.
// ════════════════════════════════════════════════════════════════════

// ── Sheet names ──────────────────────────────────────────────────────
var SS_MASTER    = 'MASTER';
var SS_EMPLOYEES = 'EMPLOYEE MASTER';
var SS_ARCHIVE   = 'ARCHIVE';

// ── Master sheet column headers ───────────────────────────────────────
var MASTER_HEADERS = [
  'TASK ID','ASSIGN DATE','EMP ID','EMP NAME','DEPARTMENT',
  'EMAIL','MOBILE','TASK DESCRIPTION','FIRST COMMITMENT',
  'EXPECTED COMPLETION','REVISION DATE 1','REVISION DATE 2',
  'COMPLETION DATE','REVISION COUNT','STATUS','REMARKS'
];
var EMP_HEADERS = ['EMP ID','NAME','DEPARTMENT','MOBILE','EMAIL'];

// ── 1-based column numbers ────────────────────────────────────────────
var COL = {
  taskId:1, assignDate:2, empId:3, empName:4, dept:5, email:6, mobile:7,
  taskDesc:8, firstCommit:9, expectedComp:10, revDate1:11, revDate2:12,
  complDate:13, revCount:14, status:15, remarks:16
};

// ════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Delegation Management System')
    .addMetaTag('viewport','width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ════════════════════════════════════════════════════════════════════
// SHEET HELPERS
// ════════════════════════════════════════════════════════════════════
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function ensureSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length)
      .setBackground('#1a2744').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function tz() { return Session.getScriptTimeZone(); }

// ════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ════════════════════════════════════════════════════════════════════

/** Format any value to 'dd/MM/yyyy'. Returns '' for invalid/empty. */
function fmt(d) {
  if (d === null || d === undefined || d === '') return '';
  try {
    var dt;
    if (d instanceof Date) {
      dt = d;
    } else if (typeof d === 'number') {
      if (d <= 0) return '';
      dt = new Date(d);
    } else {
      var s = String(d).trim();
      if (!s) return '';
      var p = parseDate(s);
      if (!p) return '';
      dt = p;
    }
    if (!dt || isNaN(dt.getTime())) return '';
    var y = dt.getFullYear();
    if (y < 2000 || y > 2100) return '';
    return Utilities.formatDate(dt, tz(), 'dd/MM/yyyy');
  } catch(e) { return ''; }
}

/**
 * Parse string/Date to a Date object.
 * Accepts: dd/MM/yyyy  (Indian format, primary)
 *          yyyy-MM-dd  (HTML date input format)
 *          native Date object
 * Returns null for anything invalid.
 *
 * NOTE: generic new Date(string) is NOT used — it interprets
 * ambiguous strings (like dd/MM/yyyy) as MM/DD/yyyy on US-locale
 * systems, which is the root cause of the date corruption bug.
 */
function parseDate(str) {
  if (str === null || str === undefined || str === '') return null;
  if (str instanceof Date) {
    if (isNaN(str.getTime())) return null;
    var yy = str.getFullYear();
    if (yy < 2000 || yy > 2100) return null;
    return str;
  }
  var s = String(str).trim();
  if (!s) return null;
  var d = null;

  // dd/MM/yyyy
  var a = s.split('/');
  if (a.length === 3 && a[2].length === 4) {
    var day = parseInt(a[0],10), mon = parseInt(a[1],10), yr = parseInt(a[2],10);
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12 && yr >= 2000 && yr <= 2100) {
      d = new Date(yr, mon-1, day);
    }
  }

  // yyyy-MM-dd  (HTML <input type="date">)
  if (!d) {
    var b = s.split('-');
    if (b.length === 3 && b[0].length === 4) {
      var yr2 = parseInt(b[0],10), mon2 = parseInt(b[1],10), day2 = parseInt(b[2],10);
      if (day2 >= 1 && day2 <= 31 && mon2 >= 1 && mon2 <= 12 && yr2 >= 2000 && yr2 <= 2100) {
        d = new Date(yr2, mon2-1, day2);
      }
    }
  }

  // Unambiguous ISO-8601 only (e.g. 2026-04-30T00:00:00)
  if (!d && /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    try { var alt = new Date(s); if (!isNaN(alt.getTime())) d = alt; } catch(e){}
  }

  if (!d || isNaN(d.getTime())) return null;
  var yyy = d.getFullYear();
  if (yyy < 2000 || yyy > 2100) return null;
  return d;
}

/** Strip time — returns midnight Date or null. */
function dateOnly(d) {
  if (!d) return null;
  var dt = (d instanceof Date) ? d : parseDate(d);
  if (!dt) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/** (d2 − d1) in whole days. Positive = d2 is later. */
function daysBetween(d1, d2) {
  var a = dateOnly(d1), b = dateOnly(d2);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** ISO week number. */
function getISOWeek(d) {
  var dt = dateOnly(d);
  if (!dt) return 0;
  dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7));
  var y = new Date(dt.getFullYear(), 0, 1);
  return Math.ceil((((dt.getTime() - y.getTime()) / 86400000) + 1) / 7);
}

/** Final deadline = max(firstCommitment, revDate1, revDate2). Returns Date or null. */
function getFinalDeadline(t) {
  var dates = [];
  var f1 = parseDate(t.firstCommitment); if (f1) dates.push(f1.getTime());
  var r1 = parseDate(t.revDate1);        if (r1) dates.push(r1.getTime());
  var r2 = parseDate(t.revDate2);        if (r2) dates.push(r2.getTime());
  if (!dates.length) return null;
  return new Date(Math.max.apply(null, dates));
}

/** Today at midnight in script timezone. */
function todayDateOnly() {
  var n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Generate unique TASK ID like TSK-20260428-001. */
function generateTaskId() {
  var sh = ensureSheet(SS_MASTER, MASTER_HEADERS);
  var last = sh.getLastRow();
  var datePart = Utilities.formatDate(new Date(), tz(), 'yyyyMMdd');
  if (last <= 1) return 'TSK-' + datePart + '-001';
  var ids = sh.getRange(2,1,last-1,1).getValues().map(function(r){ return String(r[0]); });
  var todayIds = ids.filter(function(id){ return id.indexOf(datePart) !== -1; });
  return 'TSK-' + datePart + '-' + ('000' + (todayIds.length + 1)).slice(-3);
}

// ════════════════════════════════════════════════════════════════════
// EMPLOYEE MASTER (CRUD)
// ════════════════════════════════════════════════════════════════════
function getEmployeeList() {
  try {
    var sh = ensureSheet(SS_EMPLOYEES, EMP_HEADERS);
    var data = sh.getDataRange().getValues();
    if (data.length <= 1) return { success:true, employees:[] };
    var employees = data.slice(1).filter(function(r){ return r[0]; }).map(function(r){
      return {
        empId      : String(r[0]||''),
        name       : String(r[1]||''),
        department : String(r[2]||''),
        mobile     : String(r[3]||''),
        email      : String(r[4]||'')
      };
    });
    return { success:true, employees:employees };
  } catch(e) { return { success:false, error:e.message, employees:[] }; }
}

function addEmployee(p) {
  try {
    var sh = ensureSheet(SS_EMPLOYEES, EMP_HEADERS);
    var data = sh.getDataRange().getValues();
    var existing = data.slice(1).map(function(r){ return String(r[0]).toLowerCase(); });
    if (existing.indexOf(String(p.empId).toLowerCase()) !== -1)
      return { success:false, error:'Employee ID already exists.' };
    sh.appendRow([p.empId, p.name, p.department, p.mobile, p.email]);
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

function updateEmployee(p) {
  try {
    var sh = ensureSheet(SS_EMPLOYEES, EMP_HEADERS);
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(p.empId)) {
        sh.getRange(i+1,1,1,5).setValues([[p.empId,p.name,p.department,p.mobile,p.email]]);
        return { success:true };
      }
    }
    return { success:false, error:'Employee not found.' };
  } catch(e) { return { success:false, error:e.message }; }
}

function deleteEmployee(empId) {
  try {
    var sh = ensureSheet(SS_EMPLOYEES, EMP_HEADERS);
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(empId)) { sh.deleteRow(i+1); return { success:true }; }
    }
    return { success:false, error:'Employee not found.' };
  } catch(e) { return { success:false, error:e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// ADD NEW TASK
// Dates stored as Date objects — NOT formatted strings.
// Formatted strings like '01/05/2026' get silently reinterpreted by
// Google Sheets (US locale) as January 5 instead of May 1.
// Date objects are stored as numeric timestamps — locale-safe.
// NOTE: expectedCompletion field has been removed from the Add Task UI.
//       The column is retained in the sheet for backward compatibility
//       with existing data; it is simply left blank for new tasks.
// ════════════════════════════════════════════════════════════════════
function addNewTask(p) {
  try {
    var sh = ensureSheet(SS_MASTER, MASTER_HEADERS);
    var taskId = generateTaskId();

    var firstCommitObj = parseDate(p.firstCommitment);

    if (!firstCommitObj)
      return { success:false, error:'Invalid First Commitment date.' };

    sh.appendRow([
      taskId,
      new Date(),            // ASSIGN DATE         — Date object
      p.empId      || '',
      p.empName    || '',
      p.department || '',
      p.email      || '',
      p.mobile     || '',
      p.taskDesc   || '',
      firstCommitObj,        // FIRST COMMITMENT    — Date object
      '',                    // EXPECTED COMPLETION — blank (field removed from UI)
      '', '',                // REVISION DATE 1, 2  — empty
      '',                    // COMPLETION DATE     — empty
      0,                     // REVISION COUNT
      'Pending',             // STATUS
      ''                     // REMARKS
    ]);
    return { success:true, taskId:taskId };
  } catch(e) { return { success:false, error:e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// ROW → TASK OBJECT
// ════════════════════════════════════════════════════════════════════
function rowToTask(r, rowIndex) {
  var t = {
    row               : rowIndex,
    taskId            : String(r[0]  || ''),
    assignDate        : fmt(r[1]),
    empId             : String(r[2]  || ''),
    empName           : String(r[3]  || ''),
    department        : String(r[4]  || ''),
    email             : String(r[5]  || ''),
    mobile            : String(r[6]  || ''),
    taskDesc          : String(r[7]  || ''),
    firstCommitment   : fmt(r[8]),
    expectedCompletion: fmt(r[9]),
    revDate1          : fmt(r[10]),
    revDate2          : fmt(r[11]),
    completionDate    : fmt(r[12]),
    revisionCount     : parseInt(r[13]) || 0,
    status            : String(r[14] || 'Pending'),
    remarks           : String(r[15] || '')
  };

  // Computed: final deadline = max of all committed dates
  var fd = getFinalDeadline(t);
  t.finalDeadline = fd ? Utilities.formatDate(fd, tz(), 'dd/MM/yyyy') : '';

  // daysLeft: positive = days remaining, negative = overdue / late
  if (fd && t.status === 'Pending') {
    t.daysLeft = daysBetween(todayDateOnly(), dateOnly(fd));
  } else if (fd && t.status === 'Completed') {
    var cd = parseDate(t.completionDate);
    t.daysLeft = cd ? daysBetween(dateOnly(cd), dateOnly(fd)) : null;
  } else {
    t.daysLeft = null;
  }
  return t;
}

// ════════════════════════════════════════════════════════════════════
// FOLLOW UP
// Shows: assigned today / due within 3 days / overdue / has revisions
// ════════════════════════════════════════════════════════════════════
function getFollowUpTasks() {
  try {
    var sh = ensureSheet(SS_MASTER, MASTER_HEADERS);
    var data = sh.getDataRange().getValues();
    if (data.length <= 1) return { success:true, tasks:[] };

    var today = todayDateOnly();
    var threeDaysOut = new Date(today.getTime() + 3 * 86400000);

    var tasks = [];
    for (var i = 1; i < data.length; i++) {
      var t = rowToTask(data[i], i+1);
      if (t.status !== 'Pending') continue;

      var ad = parseDate(t.assignDate);
      var fd = getFinalDeadline(t);

      var show = false;
      if (ad && dateOnly(ad).getTime() === today.getTime()) show = true;
      if (fd && dateOnly(fd) <= threeDaysOut)               show = true;
      if (t.revisionCount > 0)                              show = true;

      if (show) tasks.push(t);
    }
    return { success:true, tasks:tasks };
  } catch(e) { return { success:false, error:e.message, tasks:[] }; }
}

// ════════════════════════════════════════════════════════════════════
// ALL PENDING — every Pending task sorted oldest deadline first
// ════════════════════════════════════════════════════════════════════
function getAllPendingTasks() {
  try {
    var sh = ensureSheet(SS_MASTER, MASTER_HEADERS);
    var data = sh.getDataRange().getValues();
    if (data.length <= 1) return { success:true, tasks:[] };

    var tasks = [];
    for (var i = 1; i < data.length; i++) {
      var t = rowToTask(data[i], i+1);
      if (t.status !== 'Pending') continue;
      var fd = getFinalDeadline(t);
      t._sortKey = fd ? fd.getTime() : 9999999999999;
      tasks.push(t);
    }
    tasks.sort(function(a,b){ return a._sortKey - b._sortKey; });
    tasks.forEach(function(t){ delete t._sortKey; });
    return { success:true, tasks:tasks };
  } catch(e) { return { success:false, error:e.message, tasks:[] }; }
}

// ════════════════════════════════════════════════════════════════════
// COMPLETE / REVISE / CANCEL
// All date writes use Date objects — not formatted strings.
// ════════════════════════════════════════════════════════════════════
function completeTask(row, remarks) {
  try {
    var sh = ensureSheet(SS_MASTER, MASTER_HEADERS);
    sh.getRange(row, COL.status).setValue('Completed');
    sh.getRange(row, COL.complDate).setValue(new Date()); // Date object
    if (remarks) sh.getRange(row, COL.remarks).setValue(remarks);
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

function reviseTask(p) {
  try {
    var sh = ensureSheet(SS_MASTER, MASTER_HEADERS);
    var rowD = sh.getRange(p.row, 1, 1, MASTER_HEADERS.length).getValues()[0];
    var rev = parseInt(rowD[COL.revCount-1]) || 0;

    var newDateObj = parseDate(p.newDate);
    if (!newDateObj) return { success:false, error:'Invalid revision date.' };

    if (rev === 0)      sh.getRange(p.row, COL.revDate1).setValue(newDateObj); // Date object
    else if (rev === 1) sh.getRange(p.row, COL.revDate2).setValue(newDateObj); // Date object
    // rev >= 2: both slots full — only increment count

    sh.getRange(p.row, COL.revCount).setValue(rev + 1);
    if (p.remarks) sh.getRange(p.row, COL.remarks).setValue(p.remarks);
    return { success:true, newRevCount: rev + 1 };
  } catch(e) { return { success:false, error:e.message }; }
}

function cancelTask(row, remarks) {
  try {
    var sh = ensureSheet(SS_MASTER, MASTER_HEADERS);
    sh.getRange(row, COL.status).setValue('Cancelled');
    if (remarks) sh.getRange(row, COL.remarks).setValue(remarks);
    return { success:true };
  } catch(e) { return { success:false, error:e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// MD DASHBOARD
// ════════════════════════════════════════════════════════════════════

function resolvePeriodRange(f) {
  f = f || {};
  var today = todayDateOnly();
  var v = f.viewType || 'all';

  if (v === 'all') return { from:null, to:null, label:'All Time', isAll:true };

  if (v === 'today') {
    return { from:today, to:today,
             label:'Today (' + Utilities.formatDate(today, tz(),'dd/MM/yyyy') + ')',
             isAll:false };
  }

  if (v === 'daily') {
    var d = parseDate(f.targetDate) || today;
    var dd = dateOnly(d);
    return { from:dd, to:dd, label:Utilities.formatDate(dd, tz(),'dd/MM/yyyy'), isAll:false };
  }

  if (v === 'weekly') {
    var ws = parseDate(f.weekStart);
    if (!ws) {
      var dow = today.getDay() || 7;
      ws = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow + 1);
    }
    ws = dateOnly(ws);
    var we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
    return { from:ws, to:we,
             label:'Week ' + getISOWeek(ws) + ' (' +
                   Utilities.formatDate(ws, tz(),'dd MMM') + ' – ' +
                   Utilities.formatDate(we, tz(),'dd MMM yyyy') + ')',
             isAll:false };
  }

  if (v === 'monthly') {
    var year, month;
    if (f.monthYear) {
      var pts = String(f.monthYear).split('-');
      year  = parseInt(pts[0],10);
      month = parseInt(pts[1],10) - 1;
    } else {
      year  = today.getFullYear();
      month = today.getMonth();
    }
    var ms = new Date(year, month, 1);
    var me = new Date(year, month+1, 0);
    var MN = ['January','February','March','April','May','June',
              'July','August','September','October','November','December'];
    return { from:ms, to:me, label:MN[month]+' '+year, isAll:false };
  }

  if (v === 'custom') {
    var fd = parseDate(f.fromDate);
    var td = parseDate(f.toDate);
    if (!fd || !td) return { from:today, to:today, label:'Custom (no dates)', isAll:false };
    if (fd > td) { var tmp = fd; fd = td; td = tmp; }
    return { from:dateOnly(fd), to:dateOnly(td),
             label:Utilities.formatDate(fd, tz(),'dd/MM/yyyy') + ' – ' +
                   Utilities.formatDate(td, tz(),'dd/MM/yyyy'),
             isAll:false };
  }

  return { from:null, to:null, label:'All Time', isAll:true };
}

function filterTasks(tasks, range, empName, deptName) {
  return tasks.filter(function(t){
    if (!range.isAll) {
      var ad = parseDate(t.assignDate);
      if (!ad) return false;
      var adDay = dateOnly(ad);
      if (adDay < range.from || adDay > range.to) return false;
    }
    if (empName  && empName  !== 'All' && t.empName    !== empName)  return false;
    if (deptName && deptName !== 'All' && t.department !== deptName) return false;
    return true;
  });
}

/**
 * Performance formula (progressive revision penalty):
 *
 *   BaseScore       = (Completion% × 0.50) + (OnTime% × 0.50)
 *   AvgRevisions    = TotalRevisionCount / ActiveTasks
 *   RevisionPenalty = min(AvgRevisions × 10, 50)
 *   Performance     = max(0, BaseScore − RevisionPenalty)
 *
 * "ActiveTasks" = completed + pending (cancelled tasks are excluded).
 *
 * Scale (1 task, completed on-time):
 *   0 rev/task → 100%  Excellent
 *   1 rev/task →  90%  Excellent
 *   2 rev/task →  80%  Good
 *   3 rev/task →  70%  Average
 *   4 rev/task →  60%  Average
 *   5 rev/task →  50%  Poor
 *
 * KEY: AvgRevisions is exposed in the returned object so the UI can
 * display it alongside the Total revision count, making it clear that
 * the penalty is driven by the PER-TASK average — not the raw total.
 * Two employees with the same Total Revisions but different task counts
 * will have different AvgRevisions, different penalties, and different
 * performance scores — which is mathematically correct and intentional.
 */
function computeMetrics(tasks) {
  var n = tasks.length;
  var completed = 0, pending = 0, cancelled = 0;
  var revisionsTotal = 0, tasksWithRevision = 0;
  var onTime = 0, late = 0;

  tasks.forEach(function(t){
    if (t.status === 'Completed')      completed++;
    else if (t.status === 'Cancelled') cancelled++;
    else                                pending++;

    var rc = parseInt(t.revisionCount) || 0;
    revisionsTotal += rc;
    if (rc > 0) tasksWithRevision++;

    if (t.status === 'Completed') {
      var compDate = parseDate(t.completionDate);
      var deadline = getFinalDeadline(t);
      if (compDate && deadline) {
        if (dateOnly(compDate).getTime() <= dateOnly(deadline).getTime()) onTime++;
        else late++;
      } else if (compDate) {
        onTime++; // no deadline — treat as on-time
      }
    }
  });

  var active = completed + pending;

  var completionPct = active    ? Math.round((completed / active) * 100) : 0;
  var onTimePct     = completed ? Math.round((onTime / completed) * 100)  : 0;

  // avgRevisions is the PER-TASK average — this is the exact value that
  // drives the RevisionPenalty.  It is returned for UI transparency.
  var avgRevisions    = active > 0 ? revisionsTotal / active : 0;
  var revisionPenalty = Math.min(Math.round(avgRevisions * 10), 50);

  var basePct = Math.round(completionPct * 0.5 + onTimePct * 0.5);
  var perfPct = Math.max(0, Math.min(100, basePct - revisionPenalty));

  var status;
  if (n === 0)            status = 'No Data';
  else if (perfPct >= 90) status = 'Excellent';
  else if (perfPct >= 75) status = 'Good';
  else if (perfPct >= 60) status = 'Average';
  else if (perfPct >= 40) status = 'Poor';
  else                    status = 'Critical';

  return {
    total: n,
    completed: completed, pending: pending, cancelled: cancelled,
    revisions: revisionsTotal, tasksWithRevision: tasksWithRevision,
    onTime: onTime, late: late,
    completionPct: completionPct, onTimePct: onTimePct,
    avgRevisions: parseFloat(avgRevisions.toFixed(2)),   // ← exposed for UI
    revisionPenalty: revisionPenalty,
    perfPct: perfPct, status: status
  };
}

function buildEmployeeTable(filtered) {
  var byEmp = {};
  filtered.forEach(function(t){
    var key = t.empName || '(Unknown)';
    if (!byEmp[key]) byEmp[key] = { name:key, dept:t.department || '—', tasks:[] };
    byEmp[key].tasks.push(t);
    if (t.department && byEmp[key].dept === '—') byEmp[key].dept = t.department;
  });
  var rows = Object.keys(byEmp).map(function(k){
    var e = byEmp[k];
    var m = computeMetrics(e.tasks);
    return {
      name: e.name, dept: e.dept,
      total: m.total, completed: m.completed, pending: m.pending,
      revisions: m.revisions, tasksWithRevision: m.tasksWithRevision,
      onTime: m.onTime, late: m.late,
      completionPct: m.completionPct, onTimePct: m.onTimePct,
      avgRevisions: m.avgRevisions,             // ← passed to UI
      revisionPenalty: m.revisionPenalty,
      perfPct: m.perfPct, status: m.status
    };
  });
  rows.sort(function(a,b){
    if (b.perfPct !== a.perfPct) return b.perfPct - a.perfPct;
    return b.total - a.total;
  });
  return rows;
}

function buildDeptTable(filtered) {
  var byDept = {};
  filtered.forEach(function(t){
    var key = t.department || '(Unknown)';
    if (!byDept[key]) byDept[key] = { dept:key, tasks:[] };
    byDept[key].tasks.push(t);
  });
  return Object.keys(byDept).map(function(k){
    var d = byDept[k];
    var m = computeMetrics(d.tasks);
    return {
      dept: d.dept, total: m.total, completed: m.completed,
      pending: m.pending, perfPct: m.perfPct, status: m.status
    };
  }).sort(function(a,b){ return b.perfPct - a.perfPct; });
}

function buildTrendData(allTasks, viewType, empFilter, deptFilter) {
  var today = todayDateOnly();
  var buckets = [];

  if (viewType === 'today' || viewType === 'daily' || viewType === 'custom') {
    for (var i = 13; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var rng = { from:d, to:d, isAll:false };
      var ft = filterTasks(allTasks, rng, empFilter, deptFilter);
      var m  = computeMetrics(ft);
      buckets.push({ label:Utilities.formatDate(d,tz(),'dd MMM'),
                     total:m.total, completed:m.completed, pending:m.pending, perfPct:m.perfPct });
    }
  } else if (viewType === 'monthly') {
    for (var j = 5; j >= 0; j--) {
      var ms = new Date(today.getFullYear(), today.getMonth()-j, 1);
      var me = new Date(today.getFullYear(), today.getMonth()-j+1, 0);
      var rng2 = { from:ms, to:me, isAll:false };
      var ft2 = filterTasks(allTasks, rng2, empFilter, deptFilter);
      var m2  = computeMetrics(ft2);
      buckets.push({ label:Utilities.formatDate(ms,tz(),'MMM yy'),
                     total:m2.total, completed:m2.completed, pending:m2.pending, perfPct:m2.perfPct });
    }
  } else {
    for (var k = 11; k >= 0; k--) {
      var dow = today.getDay() || 7;
      var ws = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow + 1 - k*7);
      var we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
      var rng3 = { from:ws, to:we, isAll:false };
      var ft3  = filterTasks(allTasks, rng3, empFilter, deptFilter);
      var m3   = computeMetrics(ft3);
      buckets.push({ label:'W'+getISOWeek(ws), sub:Utilities.formatDate(ws,tz(),'dd MMM'),
                     total:m3.total, completed:m3.completed, pending:m3.pending, perfPct:m3.perfPct });
    }
  }
  return buckets;
}

function computeDashboardPayload(allTasks, range, empName, deptName) {
  var filtered = filterTasks(allTasks, range, empName, deptName);
  var m = computeMetrics(filtered);

  var pending = filtered.filter(function(t){ return t.status === 'Pending'; });
  pending.sort(function(a,b){
    var ad = getFinalDeadline(a), bd = getFinalDeadline(b);
    return (ad ? ad.getTime() : 9e15) - (bd ? bd.getTime() : 9e15);
  });

  return {
    label: range.label,
    isAll: range.isAll,
    cards: {
      total: m.total, completed: m.completed, pending: m.pending,
      cancelled: m.cancelled, revisions: m.revisions,
      tasksWithRevision: m.tasksWithRevision,
      onTime: m.onTime, late: m.late,
      completionPct: m.completionPct, onTimePct: m.onTimePct,
      avgRevisions: m.avgRevisions,             // ← passed to UI
      revisionPenalty: m.revisionPenalty,
      perfPct: m.perfPct, status: m.status
    },
    pieData: [
      { label:'Completed', value:m.completed, color:'#22c55e' },
      { label:'Pending',   value:m.pending,   color:'#f59e0b' },
      { label:'Cancelled', value:m.cancelled, color:'#7d8590' }
    ],
    empTable:     buildEmployeeTable(filtered),
    deptTable:    buildDeptTable(filtered),
    pendingTasks: pending
  };
}

function getDashboardData(filters) {
  try {
    filters = filters || {};
    var sh = ensureSheet(SS_MASTER, MASTER_HEADERS);
    var data = sh.getDataRange().getValues();
    if (data.length <= 1) return _emptyDashboard('No tasks yet.');

    var allTasks = [];
    for (var i = 1; i < data.length; i++) allTasks.push(rowToTask(data[i], i+1));

    var emp  = filters.employee   || 'All';
    var dept = filters.department || 'All';

    var range1  = resolvePeriodRange(filters);
    var primary = computeDashboardPayload(allTasks, range1, emp, dept);

    var compare = null;
    if (filters.compare && filters.compareWith) {
      var range2 = resolvePeriodRange(filters.compareWith);
      compare = computeDashboardPayload(allTasks, range2,
        filters.compareWith.employee   || emp,
        filters.compareWith.department || dept);
    }

    var trendData = buildTrendData(allTasks, filters.viewType || 'all', emp, dept);

    var allEmployees = [], allDepts = [];
    allTasks.forEach(function(t){
      if (t.empName    && allEmployees.indexOf(t.empName)    === -1) allEmployees.push(t.empName);
      if (t.department && allDepts.indexOf(t.department)     === -1) allDepts.push(t.department);
    });
    allEmployees.sort(); allDepts.sort();

    return { success:true, primary:primary, compare:compare,
             trendData:trendData, allEmployees:allEmployees, allDepts:allDepts };
  } catch(e) { return _emptyDashboard(e.message); }
}

function _emptyDashboard(msg) {
  var ep = { label:'—', isAll:true,
    cards:{ total:0, completed:0, pending:0, cancelled:0, revisions:0,
            tasksWithRevision:0, onTime:0, late:0,
            completionPct:0, onTimePct:0,
            avgRevisions:0,                       // ← included
            revisionPenalty:0,
            perfPct:0, status:'No Data' },
    pieData:[], empTable:[], deptTable:[], pendingTasks:[] };
  return { success:true, message:msg||'', primary:ep, compare:null,
           trendData:[], allEmployees:[], allDepts:[] };
}

function getPeriodOptions() {
  try {
    var today = todayDateOnly();
    var weeks = [], months = [];

    for (var i = 0; i < 12; i++) {
      var dow = today.getDay() || 7;
      var ws = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow + 1 - i*7);
      var we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
      var suf = i===0 ? '  (This Week)' : i===1 ? '  (Last Week)' : '';
      weeks.push({ value:Utilities.formatDate(ws,tz(),'yyyy-MM-dd'),
                   label:'Week '+getISOWeek(ws)+' — '+Utilities.formatDate(ws,tz(),'dd MMM')+
                         ' to '+Utilities.formatDate(we,tz(),'dd MMM yyyy')+suf });
    }

    var MN = ['January','February','March','April','May','June',
              'July','August','September','October','November','December'];
    for (var j = 0; j < 12; j++) {
      var ms = new Date(today.getFullYear(), today.getMonth()-j, 1);
      var suf2 = j===0 ? '  (This Month)' : j===1 ? '  (Last Month)' : '';
      months.push({ value:Utilities.formatDate(ms,tz(),'yyyy-MM'),
                    label:MN[ms.getMonth()]+' '+ms.getFullYear()+suf2 });
    }

    return { success:true, weeks:weeks, months:months,
             today:Utilities.formatDate(today,tz(),'yyyy-MM-dd') };
  } catch(e) { return { success:false, error:e.message, weeks:[], months:[] }; }
}

// ════════════════════════════════════════════════════════════════════
// MANUAL REMINDER
// ════════════════════════════════════════════════════════════════════
function sendManualReminders(selectedEmpName) {
  try {
    var sh   = ensureSheet(SS_MASTER, MASTER_HEADERS);
    var data = sh.getDataRange().getValues();
    if (data.length <= 1) return { success:true, sent:0, message:'No tasks found.' };

    var today = todayDateOnly();
    var rows  = [];
    for (var i = 1; i < data.length; i++) {
      var t = rowToTask(data[i], i+1);
      if (t.status !== 'Pending') continue;
      rows.push(t);
    }
    if (selectedEmpName && selectedEmpName !== 'All')
      rows = rows.filter(function(t){ return t.empName === selectedEmpName; });
    if (!rows.length)
      return { success:true, sent:0, message:'No pending tasks for selected employee.' };

    var grouped = {};
    rows.forEach(function(t){
      if (!grouped[t.empName]) grouped[t.empName] = { email:t.email, tasks:[] };
      grouped[t.empName].tasks.push(t);
    });

    var sent = 0, errors = [];
    Object.keys(grouped).forEach(function(name){
      var info = grouped[name];
      if (!info.email || info.email.indexOf('@') === -1) { errors.push(name+': no email'); return; }

      var taskRows = info.tasks.map(function(t){
        var fd = getFinalDeadline(t);
        var dlText   = fd ? Utilities.formatDate(fd, tz(),'dd/MM/yyyy') : 'No date';
        var daysLeft = fd ? daysBetween(today, dateOnly(fd)) : null;
        var urgency;
        if (daysLeft === null)   urgency = '<span style="color:#6b7280">—</span>';
        else if (daysLeft < 0)   urgency = '<span style="color:#dc2626;font-weight:700">'+Math.abs(daysLeft)+'d OVERDUE</span>';
        else if (daysLeft === 0) urgency = '<span style="color:#d97706;font-weight:700">DUE TODAY</span>';
        else                     urgency = '<span style="color:#16a34a">+'+daysLeft+'d left</span>';
        return '<tr>'+
          '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:12px;">'+t.taskId+'</td>'+
          '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">'+t.taskDesc+'</td>'+
          '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">'+dlText+'</td>'+
          '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">'+urgency+'</td></tr>';
      }).join('');

      var html =
        '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;">'+
        '<div style="max-width:680px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1);">'+
        '<div style="background:linear-gradient(135deg,#1e3a5f,#1e40af);padding:28px 32px;">'+
        '<div style="font-size:12px;color:#93c5fd;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">Delegation Management System</div>'+
        '<h1 style="margin:0;color:#fff;font-size:22px;">Pending Task Reminder</h1></div>'+
        '<div style="padding:28px 32px;">'+
        '<p style="font-size:15px;color:#111827;">Dear <strong>'+name+'</strong>,</p>'+
        '<p style="font-size:14px;color:#6b7280;">You have <strong>'+info.tasks.length+' pending task(s)</strong> requiring your attention.</p>'+
        '<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">'+
        '<thead><tr style="background:#f9fafb;">'+
        '<th style="padding:11px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Task ID</th>'+
        '<th style="padding:11px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Description</th>'+
        '<th style="padding:11px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Final Deadline</th>'+
        '<th style="padding:11px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Status</th>'+
        '</tr></thead><tbody>'+taskRows+'</tbody></table>'+
        '<div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:14px 18px;margin-top:20px;">'+
        '<p style="margin:0;font-size:13px;color:#854d0e;">Please complete your tasks on time. Contact your manager if you need assistance.</p></div></div>'+
        '<div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;">'+
        '<p style="margin:0;font-size:12px;color:#9ca3af;">Manual reminder from Delegation Management System. Do not reply.</p></div></div></body></html>';

      MailApp.sendEmail({ to:info.email,
        subject:'[DMS Reminder] '+info.tasks.length+' Pending Task(s) — Action Required',
        htmlBody:html });
      sent++;
    });

    return { success:true, sent:sent,
             message:'Reminder sent to '+sent+' employee(s).'+
                     (errors.length ? ' Issues: '+errors.join('; ') : '') };
  } catch(e) { return { success:false, error:e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// SHEET INITIALIZER + MENU
// ════════════════════════════════════════════════════════════════════
function initializeAllSheets() {
  ensureSheet(SS_MASTER, MASTER_HEADERS);
  ensureSheet(SS_EMPLOYEES, EMP_HEADERS);
  ensureSheet(SS_ARCHIVE, ['SNAPSHOT DATE','EMPLOYEE','DEPT','TOTAL','COMPLETED','PENDING','REVISIONS','PERF%']);
  var master = getSheet(SS_MASTER);
  if (master) { master.setColumnWidth(1,130); master.setColumnWidth(8,320); }
  SpreadsheetApp.getUi().alert('All sheets initialized.\n\nSheets:\n• MASTER\n• EMPLOYEE MASTER\n• ARCHIVE');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('DMS Admin')
    .addItem('Initialize All Sheets','initializeAllSheets')
    .addItem('Send All Reminders','_sendAllReminders')
    .addToUi();
}

function _sendAllReminders() {
  var r = sendManualReminders('All');
  SpreadsheetApp.getUi().alert(r.success ? r.message : (r.error || 'Failed.'));
}
