/**
 * Green Gain Hub 3.1.0 — 6-digit PIN and "ขายแล้ว" (sold) records.
 *
 * PIN: phone number alone was enough to sign in. With all provinces open, anyone who knows a number could open that
 * account and see the partners' phone numbers. Each user now has a 6-digit PIN:
 *   - stored only as a salted SHA-256 in users!B (the old, unused "Password" column): pin1$<salt>$<hash>
 *   - new users choose it at registration; users from before 3.1.0 choose it at their next sign-in (setPinServer works
 *     only while the account has no PIN)
 *   - 5 wrong PINs lock the number for 15 minutes; officers (ABM Super Admin) can clear a forgotten PIN (abm_pin_reset)
 *
 * Sold: a farmer marks a plot "ขายแล้ว" with what was really sold (tonnes, baht, to whom — all optional). The plot leaves
 * the market (status Sold) and one row goes to the `sales` sheet, the only real income figure the system has.
 */
const PIN_PREFIX = 'pin1$';
const PIN_MAX_FAILS = 5;
const PIN_LOCK_SECONDS = 900;
const SALES_SHEET = 'sales';
const SALES_HEADERS = ['ID', 'Sold_At', 'Plot_ID', 'Owner_Telephone', 'Crop', 'Material', 'Area_Rai', 'Quantity_Ton', 'Amount_Baht',
  'Buyer_Name', 'Province_Code', 'Province', 'District_Code', 'District', 'Created_At'];

function pinValid_(pin) {
  pin = String(pin === null || pin === undefined ? '' : pin).trim();
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  if (/^(\d)\1{5}$/.test(pin) || '0123456789'.indexOf(pin) >= 0 || '9876543210'.indexOf(pin) >= 0) {
    throw new Error('PIN ง่ายเกินไป (เช่น 111111 หรือ 123456) กรุณาตั้งใหม่');
  }
  return pin;
}

function pinHash_(salt, pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function pinRecord_(pin) {
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return PIN_PREFIX + salt + '$' + pinHash_(salt, pin);
}

function hasPin_(row) { return String(row[1] || '').indexOf(PIN_PREFIX) === 0; }

/** true when the PIN matches; counts failures per phone and locks after PIN_MAX_FAILS. */
function pinCheck_(phone, row, pin) {
  const cache = CacheService.getScriptCache();
  const key = 'pinfail:' + phone;
  const fails = Number(cache.get(key) || 0);
  if (fails >= PIN_MAX_FAILS) throw new Error('ใส่ PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
  const parts = String(row[1]).split('$');
  const ok = /^\d{6}$/.test(String(pin || '')) && parts.length === 3 && pinHash_(parts[1], String(pin)) === parts[2];
  if (ok) { cache.remove(key); return true; }
  cache.put(key, String(fails + 1), PIN_LOCK_SECONDS);
  const left = PIN_MAX_FAILS - fails - 1;
  throw new Error(left > 0 ? 'PIN ไม่ถูกต้อง (ลองได้อีก ' + left + ' ครั้ง)' : 'ใส่ PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
}

function userRowIndex_(phone) {
  const rows = dataRows_(sheet_('users'));
  for (let i = 0; i < rows.length; i++) if (normalizePhone_(rows[i][0]) === phone) return { row: rows[i], index: i + 2 };
  return null;
}

function newSession_(phone, row) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const role = normalizeRole_(row[2]);
  const province = userProvince_(row);
  const session = { phone: phone, role: role, name: cleanText_(row[3], 150), province: province.code };
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(session), sessionTtlSeconds_());
  return { status: 'success', success: true, token: token, phone: phone, role: role, name: session.name, province: province };
}

/** Account from before 3.1.0 without a PIN: choose one now (only once — afterwards the PIN is needed to sign in). */
function setPinServer(input) {
  input = input || {};
  const phone = normalizePhone_(input.phone || input.username);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  const pin = pinValid_(input.pin);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const u = userRowIndex_(phone);
    if (!u) throw new Error('ไม่พบหมายเลขโทรศัพท์นี้ในระบบ กรุณาลงทะเบียน');
    if (hasPin_(u.row)) throw new Error('หมายเลขนี้ตั้ง PIN แล้ว กรุณาเข้าสู่ระบบด้วย PIN');
    sheet_('users').getRange(u.index, 2).setValue(pinRecord_(pin));
    sheet_('users').getRange(u.index, 9).setValue(new Date());
    u.row[1] = 'set';
    return newSession_(phone, u.row);
  } finally { lock.releaseLock(); }
}

/** ABM Super Admin clears a forgotten PIN (feed key); the user chooses a new one at the next sign-in. */
function abmPinReset_(body) {
  abmCheckKey_(body);
  const phone = normalizePhone_(body.phone);
  if (!/^0\d{9}$/.test(phone)) throw new Error('หมายเลขโทรศัพท์ไม่ถูกต้อง');
  const u = userRowIndex_(phone);
  if (!u) throw new Error('ไม่พบหมายเลขโทรศัพท์นี้ใน Green Gain Hub');
  sheet_('users').getRange(u.index, 2).setValue('');
  sheet_('users').getRange(u.index, 9).setValue(new Date());
  CacheService.getScriptCache().remove('pinfail:' + phone);
  return { phone: phone.slice(0, 3) + 'xxxx' + phone.slice(7), reset: true, by: cleanText_(body.by || '', 80) };
}

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
