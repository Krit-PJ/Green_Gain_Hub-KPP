/**
 * Green Gain Hub 3.3.0 — sign-in session and "ขายแล้ว" (sold) records (was Pin.gs in 3.1.0–3.2.0).
 *
 * 3.3.0: the 6-digit PIN is removed — farmers and buyers register and sign in with their phone number only.
 * The PIN hashes 3.1.0 kept in users!B are blanked once (pinCleanup_, Script Property PIN_REMOVED) so no PIN derivative
 * stays in the sheet.
 *
 * Sold: a farmer marks a plot "ขายแล้ว" with what was really sold (tonnes, baht, to whom — all optional). The plot leaves
 * the market (status Sold) and one row goes to the `sales` sheet, the only real income figure the system has.
 */

const SALES_SHEET = 'sales';
const SALES_HEADERS = ['ID', 'Sold_At', 'Plot_ID', 'Owner_Telephone', 'Crop', 'Material', 'Area_Rai', 'Quantity_Ton', 'Amount_Baht',
  'Buyer_Name', 'Province_Code', 'Province', 'District_Code', 'District', 'Created_At'];

function newSession_(phone, row) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const role = normalizeRole_(row[2]);
  const province = userProvince_(row);
  const session = { phone: phone, role: role, name: cleanText_(row[3], 150), province: province.code };
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(session), sessionTtlSeconds_());
  return { status: 'success', success: true, token: token, phone: phone, role: role, name: session.name, province: province };
}

/** 3.3.0: one time — blank the 3.1.0 PIN hashes (pin1$…) in users!B. Safe to call on every sign-in. */
const PIN_REMOVED_PROP = 'PIN_REMOVED';
function pinCleanup_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PIN_REMOVED_PROP) === '3.3.0') return 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (props.getProperty(PIN_REMOVED_PROP) === '3.3.0') return 0;
    const sh = sheet_('users'), last = sh.getLastRow();
    let n = 0;
    if (last >= 2) {
      const col = sh.getRange(2, 2, last - 1, 1).getValues();
      col.forEach(function (r) { if (String(r[0]).indexOf('pin1$') === 0) { r[0] = ''; n++; } });
      if (n) sh.getRange(2, 2, last - 1, 1).setValues(col);
    }
    props.setProperty(PIN_REMOVED_PROP, '3.3.0');
    return n;
  } finally { lock.releaseLock(); }
}
function pinCleanupSafe_() { try { pinCleanup_(); } catch (err) { /* retried at the next sign-in */ } }

/* ------------------------------ ขายแล้ว ------------------------------ */
function salesSheet_() { return ensureSheet_(SALES_SHEET, SALES_HEADERS); }

function optionalAmount_(v, label, max) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > max) throw new Error(label + 'ไม่ถูกต้อง');
  return Math.round(n * 100) / 100;
}

function markSoldServer(input, session) {
  if (session.role !== 'farmer') throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
  input = input || {};
  const id = cleanText_(input.id, 100);
  const qty = optionalAmount_(input.quantityTon, 'ปริมาณที่ขาย', 100000);
  const amount = optionalAmount_(input.amountBaht, 'จำนวนเงิน', 100000000);
  const buyer = cleanText_(input.buyerName, 150);
  const soldAt = parseDate_(input.soldDate, 'วันที่ขาย') || startOfDay_(new Date());
  if (soldAt.getTime() > Date.now() + 86400000) throw new Error('วันที่ขายต้องไม่เกินวันนี้');
  const sh = sheet_('farmers');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = id ? findOwnedRow_(sh, id, session.phone, 13) : 0;
    if (!row) throw new Error('ไม่พบข้อมูล หรือคุณไม่มีสิทธิ์แก้ไขข้อมูลนี้');
    const r = sh.getRange(row, 1, 1, 24).getValues()[0];
    if (String(r[11] || '').trim().toLowerCase() !== 'open') throw new Error('แปลงนี้ไม่ได้ประกาศขายอยู่');
    sh.getRange(row, 12).setValue('Sold');
    sh.getRange(row, 18).setValue(new Date());
    const material = resolvedMaterial_(r[13], r[14], r[5]);
    const saleId = newId_();
    salesSheet_().appendRow([saleId, soldAt, id, session.phone, text_(r[5]), material, round_(parseAreaRai_(r[8]), 2), qty, amount, buyer,
      text_(r[FARMER_GEO_COL - 1]), text_(r[FARMER_GEO_COL]), text_(r[FARMER_GEO_COL + 1]), text_(r[FARMER_GEO_COL + 2]), new Date()]);
  } finally { lock.releaseLock(); }
  invalidateSummary_();
  return { status: 'success', success: true, message: 'บันทึกการขายแล้ว แปลงนี้ไม่แสดงบนตลาดแล้ว' };
}

/** The farmer's own sales, newest first (shown on the sold plot's card). */
function salesOf_(phone) {
  let sh;
  try { sh = spreadsheet_().getSheetByName(SALES_SHEET); } catch (e) { sh = null; }
  if (!sh || sh.getLastRow() < 2) return [];
  return dataRows_(sh).filter(function (r) { return normalizePhone_(r[3]) === phone; }).map(function (r) {
    return { id: text_(r[0]), soldDate: dateInput_(r[1]), plotId: text_(r[2]), quantityTon: maybeNumber_(r[7]), amountBaht: maybeNumber_(r[8]), buyerName: text_(r[9]) };
  }).reverse();
}

/** Sales rows of one province for ABM (officers' report): no phone numbers or buyer names. */
function salesForFeed_(province) {
  let sh;
  try { sh = spreadsheet_().getSheetByName(SALES_SHEET); } catch (e) { sh = null; }
  if (!sh || sh.getLastRow() < 2) return { headers: ['ID', 'Sold_At', 'Plot_ID', 'Crop', 'Material', 'Area_Rai', 'Quantity_Ton', 'Amount_Baht', 'Province_Code', 'District_Code', 'District'], rows: [] };
  const rows = dataRows_(sh).filter(function (r) { return (text_(r[10]) || DEFAULT_PROVINCE_CODE) === province; })
    .map(function (r) { return [r[0], r[1], r[2], r[4], r[5], r[6], r[7], r[8], r[10], r[12], r[13]]; });
  return { headers: ['ID', 'Sold_At', 'Plot_ID', 'Crop', 'Material', 'Area_Rai', 'Quantity_Ton', 'Amount_Baht', 'Province_Code', 'District_Code', 'District'], rows: rows };
}
