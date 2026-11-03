/**
 * Green Gain Hub 1.7.0 — visit counter for the public landing page.
 *
 * The page calls ?api=v1&endpoint=hit once per browser session (sessionStorage
 * flag), and ?api=v1&endpoint=visits for later page loads in that session.
 *   visit_stats      Date (yyyy-MM-dd, Asia/Bangkok) | Visits | Updated_At
 *   Config!visit_count  running total (the row that already existed)
 * Counts are sessions, not unique people. No IP or identifier is stored.
 */
const VISIT_HEADERS = ['Date', 'Visits', 'Updated_At'];
const VISIT_CACHE_KEY = 'visits:v1';
const VISIT_CACHE_SECONDS = 60;

function ensureVisitSchema_() {
  ensureSheet_('visit_stats', VISIT_HEADERS);
  sheetByName_('visit_stats').getRange('A:A').setNumberFormat('@');
  visitTotalRow_(true);
  return 'PASS: visit_stats sheet and Config visit_count are ready';
}

function visitDay_(d) { return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** Row number of Config!visit_count; creates it when asked. */
function visitTotalRow_(create) {
  const sh = sheet_('settings');
  const rows = dataRows_(sh);
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === 'visit_count') return i + 2;
  if (!create) return 0;
  sh.appendRow(['visit_count', 0, 'ครั้ง', 'จำนวนครั้งที่มีการเข้าใช้งานเว็บไซต์ (นับ 1 ครั้งต่อการเปิดใช้งาน)']);
  return sh.getLastRow();
}

/** Counts one session. If the lock is busy the visit is skipped rather than slowing the page. */
function recordVisit_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return visitCounts_(false);
  try {
    const sh = ensureSheet_('visit_stats', VISIT_HEADERS);
    const today = visitDay_();
    const now = new Date();
    const last = sh.getLastRow();
    let row = 0;
    // Today's row is almost always the last one; check a few in case of manual edits.
    for (let r = last; r >= Math.max(2, last - 3); r--) {
      if (String(sh.getRange(r, 1).getValue()).trim() === today) { row = r; break; }
    }
    if (row) {
      sh.getRange(row, 2, 1, 2).setValues([[(Number(sh.getRange(row, 2).getValue()) || 0) + 1, now]]);
    } else {
      sh.appendRow([today, 1, now]);
      sh.getRange(sh.getLastRow(), 1).setNumberFormat('@');
    }
    const totalRow = visitTotalRow_(true);
    const settings = sheet_('settings');
    settings.getRange(totalRow, 2).setValue((Number(settings.getRange(totalRow, 2).getValue()) || 0) + 1);
    CacheService.getScriptCache().remove(VISIT_CACHE_KEY);
  } finally {
    lock.releaseLock();
  }
  return visitCounts_(true);
}

function visitCounts_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get(VISIT_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  }
  const today = visitDay_();
  const month = today.slice(0, 7);
  let todayCount = 0, monthCount = 0;
  const ss = spreadsheet_();
  if (ss.getSheetByName('visit_stats')) {
    dataRows_(sheetByName_('visit_stats')).forEach(function (r) {
      const d = String(r[0]).trim();
      const v = Number(r[1]) || 0;
      if (d === today) todayCount += v;
      if (d.slice(0, 7) === month) monthCount += v;
    });
  }
  const totalRow = visitTotalRow_(false);
  const total = totalRow ? Number(sheet_('settings').getRange(totalRow, 2).getValue()) || 0 : monthCount;
  const out = { today: todayCount, month: monthCount, total: Math.max(total, monthCount), date: today };
  try { cache.put(VISIT_CACHE_KEY, JSON.stringify(out), VISIT_CACHE_SECONDS); } catch (err) { /* ignore */ }
  return out;
}

/** Daily rows for reports (newest last). */
function visitDaily_() {
  const ss = spreadsheet_();
  if (!ss.getSheetByName('visit_stats')) return [];
  return dataRows_(sheetByName_('visit_stats')).map(function (r) {
    return { date: String(r[0]).trim(), visits: Number(r[1]) || 0 };
  }).filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x.date); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}
