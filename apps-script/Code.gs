/**
 * Green Gain Hub 1.3.1 — API-only bridge from GitHub Pages to Google Sheets.
 * Database: Google Sheets / file storage: Google Drive.
 */
const APP_VERSION = '1.3.1';
const DEFAULT_SPREADSHEET_ID = '1_WNNYeCxeUYhDw8WA1A0NrR3NP6QO0oaM498vGsK1aA';
const DEFAULT_SESSION_TTL_SECONDS = 21600; // 6 hours
const MATERIAL_TYPES = ['ฟางข้าว', 'ใบอ้อย', 'เหง้ามันสำปะหลัง', 'อื่นๆ'];
const PUBLIC_METHODS = ['loginServer', 'registerServer', 'getApiInfoServer'];
const PRIVATE_METHODS = ['getUserProfileServer', 'saveDataServer', 'deleteDataServer', 'getMatchingDataServer'];

/** JSONP endpoint used by the static GitHub Pages frontend. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(p.callback || '') ? p.callback : '';
  let payload;
  try {
    if (p.action !== 'rpc') throw new Error('Invalid action');
    const method = String(p.method || '');
    const args = p.args ? JSON.parse(p.args) : [];
    if (!Array.isArray(args)) throw new Error('Invalid arguments');
    if (PUBLIC_METHODS.indexOf(method) < 0 && PRIVATE_METHODS.indexOf(method) < 0) {
      throw new Error('Method not allowed');
    }
    const session = PRIVATE_METHODS.indexOf(method) >= 0 ? requireSession_(p.token) : null;
    payload = { ok: true, result: apiMethods_()[method](args, session) };
  } catch (err) {
    payload = { ok: false, error: publicError_(err) };
  }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const body = callback ? callback + '(' + json + ');' : json;
  return ContentService.createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function apiMethods_() {
  return {
    loginServer: function (args) { return loginServer(args[0]); },
    registerServer: function (args) { return registerServer(args[0]); },
    getApiInfoServer: function () { return getApiInfoServer(); },
    getUserProfileServer: function (args, session) { return getUserProfileServer(session); },
    saveDataServer: function (args, session) { return saveDataServer(args[0], session); },
    deleteDataServer: function (args, session) { return deleteDataServer(args[0], session); },
    getMatchingDataServer: function (args, session) { return getMatchingDataServer(session); }
  };
}

/** Public, non-sensitive deployment check used to detect a stale Apps Script version. */
function getApiInfoServer() {
  return {
    status: 'success',
    success: true,
    apiVersion: APP_VERSION,
    feature: 'OPPOSITE_ROLE_CONTACT_AND_NAVIGATION'
  };
}

function loginServer(input) {
  input = input || {};
  const phone = normalizePhone_(input.phone || input.telephone || input.username || input);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  const rows = dataRows_(sheet_('users'));
  const found = rows.find(function (r) { return normalizePhone_(r[0]) === phone; });
  if (!found) throw new Error('ไม่พบหมายเลขโทรศัพท์นี้ในระบบ กรุณาลงทะเบียน');
  const role = normalizeRole_(found[2]);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const session = { phone: phone, role: role, name: cleanText_(found[3], 150) };
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(session), sessionTtlSeconds_());
  return { status: 'success', success: true, token: token, phone: phone, role: role, name: session.name };
}

function registerServer(input) {
  input = input || {};
  const phone = normalizePhone_(input.phone || input.telephone);
  const role = normalizeRole_(input.role || input.status);
  const name = cleanText_(input.name, 150);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  if (!name) throw new Error('กรุณากรอกชื่อ');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('users');
    if (dataRows_(sh).some(function (r) { return normalizePhone_(r[0]) === phone; })) {
      throw new Error('หมายเลขโทรศัพท์นี้ลงทะเบียนแล้ว');
    }
    const now = new Date();
    // A:I = Telephone, Password(legacy/unused), Role, Name, System,
    // Consent, Consent_Timestamp, Created_At, Updated_At
    sh.appendRow([phone, '', role, name, false, true, now, now, now]);
  } finally {
    lock.releaseLock();
  }
  return { status: 'success', success: true, message: 'ลงทะเบียนสำเร็จ กรุณาเข้าสู่ระบบ' };
}

function getUserProfileServer(session) {
  if (session.role === 'farmer') {
    const farmers = farmerRecords_(session.phone);
    return { status: farmers.length ? 'success' : 'not_found', success: true, role: 'farmer', name: session.name, farmers: farmers,
      message: farmers.length ? '' : 'ยังไม่มีข้อมูลแปลง กรุณาเพิ่มข้อมูล' };
  }
  const buyers = buyerRecords_(session.phone);
  return { status: buyers.length ? 'success' : 'not_found', success: true, role: 'buyer', name: session.name, buyers: buyers,
    message: buyers.length ? '' : 'ยังไม่มีข้อมูลการรับซื้อ กรุณาเพิ่มข้อมูล' };
}

function saveDataServer(data, session) {
  data = data || {};
  const requestedRole = normalizeRole_(data.role || session.role);
  if (requestedRole !== session.role) throw new Error('ไม่มีสิทธิ์บันทึกข้อมูลของบทบาทนี้');
  return requestedRole === 'farmer' ? saveFarmer_(data, session) : saveBuyer_(data, session);
}

function deleteDataServer(input, session) {
  input = input || {};
  const id = cleanText_(typeof input === 'object' ? input.id : input, 100);
  const role = normalizeRole_(typeof input === 'object' ? (input.role || session.role) : session.role);
  if (!id || role !== session.role) throw new Error('ไม่มีสิทธิ์ลบข้อมูลนี้');
  const sh = sheet_(role === 'farmer' ? 'farmers' : 'buyers');
  const ownerColumn = 13;
  const statusColumn = role === 'farmer' ? 12 : 12;
  const row = findOwnedRow_(sh, id, session.phone, ownerColumn);
  if (!row) throw new Error('ไม่พบข้อมูล หรือคุณไม่มีสิทธิ์แก้ไขข้อมูลนี้');
  sh.getRange(row, statusColumn).setValue('Deleted');
  sh.getRange(row, role === 'farmer' ? 18 : 16).setValue(new Date());
  return { status: 'success', success: true, message: 'ลบข้อมูลแล้ว' };
}

function getMatchingDataServer(session) {
  // Enforce partner-only visibility at the API layer. Empty arrays are retained
  // for backward compatibility with the existing Frontend response structure.
  const isFarmer = session.role === 'farmer';
  const farmers = isFarmer ? [] : openFarmersWithCoordinates_().map(farmerPublic_);
  const buyers = isFarmer ? activeBuyersWithCoordinates_().map(buyerPublic_) : [];
  return {
    status: 'success',
    success: true,
    apiVersion: APP_VERSION,
    viewerRole: session.role,
    visibleRole: isFarmer ? 'buyer' : 'farmer',
    farmers: farmers,
    buyers: buyers,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Single source of truth for the buyer's "ALL" option.
 * Deliberately ignores Havest_Date, Map_Expire_Date and Map_Visible.
 */
function openFarmersWithCoordinates_() {
  return dataRows_(sheet_('farmers')).filter(function (r) {
    return String(r[11] || '').trim().toLowerCase() === 'open' &&
      hasCoordinates_(r[9], r[10]);
  });
}

/** Returns only Active buyers with valid coordinates. */
function activeBuyersWithCoordinates_() {
  return dataRows_(sheet_('buyers')).filter(function (r) {
    return String(r[11] || '').trim().toLowerCase() === 'active' &&
      hasCoordinates_(r[5], r[6]);
  });
}

function saveFarmer_(data, session) {
  const sh = sheet_('farmers');
  const material = validateMaterial_(data.materialType, data.materialOther);
  const harvest = parseDate_(data.harvestDate || data.havestDate, 'วันเก็บเกี่ยว');
  const plant = parseDate_(data.plantDate, 'วันเพาะปลูก');
  if (plant && harvest && plant.getTime() > harvest.getTime()) throw new Error('วันเก็บเกี่ยวต้องไม่ก่อนวันเพาะปลูก');
  const id = cleanText_(data.id, 100) || newId_();
  const now = new Date();
  const rowValues = [
    id, now, cleanText_(data.fname, 100), cleanText_(data.lname, 100),
    normalizeContactPhone_(data.phone || session.phone), cleanText_(data.crop, 150), plant || '', harvest || '',
    cleanText_(data.area, 80), numberInRange_(data.lat, -90, 90, 'ละติจูด'),
    numberInRange_(data.lng, -180, 180, 'ลองจิจูด'), 'Open', session.phone, material.type, material.other,
    '', '', now
  ];
  requireFields_(rowValues, [[2, 'ชื่อ'], [4, 'โทรศัพท์'], [5, 'ชนิดพืช'], [8, 'พื้นที่']]);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let row = data.id ? findOwnedRow_(sh, id, session.phone, 13) : 0;
    const occupiedRow = data.id ? findIdRow_(sh, id) : 0;
    if (occupiedRow && !row) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
    if (row) {
      rowValues[1] = sh.getRange(row, 2).getValue() || now;
      sh.getRange(row, 1, 1, 18).setValues([rowValues]);
    } else {
      sh.appendRow(rowValues);
      row = sh.getLastRow();
    }
    setFarmerFormulas_(sh, row);
  } finally {
    lock.releaseLock();
  }
  return { status: 'success', success: true, id: id, message: 'บันทึกข้อมูลเกษตรกรสำเร็จ' };
}

function saveBuyer_(data, session) {
  const sh = sheet_('buyers');
  ensureBuyerHarvestDaysColumn_();
  const material = validateMaterial_(data.materialType || data.material, data.materialOther);
  const id = cleanText_(data.id, 100) || newId_();
  const now = new Date();
  const purchaseAfterHarvestDays = purchaseAfterHarvestDays_(data.purchaseAfterHarvestDays);
  const rowValues = [
    id, now, cleanText_(data.fname, 100), cleanText_(data.lname, 100),
    normalizeContactPhone_(data.phone || session.phone), numberInRange_(data.lat, -90, 90, 'ละติจูด'),
    numberInRange_(data.lng, -180, 180, 'ลองจิจูด'), material.resolved,
    cleanText_(data.quality, 100), nonNegative_(data.price, 'ราคา'), cleanText_(data.capacity, 80),
    'Active', session.phone, material.type, material.other, now, purchaseAfterHarvestDays
  ];
  requireFields_(rowValues, [[2, 'ชื่อ'], [4, 'โทรศัพท์'], [8, 'คุณภาพ'], [10, 'ปริมาณ']]);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let row = data.id ? findOwnedRow_(sh, id, session.phone, 13) : 0;
    const occupiedRow = data.id ? findIdRow_(sh, id) : 0;
    if (occupiedRow && !row) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
    if (row) {
      rowValues[1] = sh.getRange(row, 2).getValue() || now;
      sh.getRange(row, 1, 1, 17).setValues([rowValues]);
    } else {
      sh.appendRow(rowValues);
    }
  } finally {
    lock.releaseLock();
  }
  return { status: 'success', success: true, id: id, message: 'บันทึกข้อมูลผู้ซื้อสำเร็จ' };
}

function farmerRecords_(phone) {
  return dataRows_(sheet_('farmers')).filter(function (r) {
    return isOwned_(r, phone, 12) && String(r[11]) !== 'Deleted';
  }).map(function (r) {
    return {
      id: text_(r[0]), timestamp: dateTime_(r[1]), fname: text_(r[2]), lname: text_(r[3]), phone: text_(r[4]),
      crop: text_(r[5]), plantDate: dateInput_(r[6]), harvestDate: dateInput_(r[7]), area: text_(r[8]),
      lat: maybeNumber_(r[9]), lng: maybeNumber_(r[10]), recordStatus: text_(r[11]), materialType: text_(r[13]), materialOther: text_(r[14])
    };
  });
}

function buyerRecords_(phone) {
  return dataRows_(sheet_('buyers')).filter(function (r) {
    return isOwned_(r, phone, 12) && String(r[11]) !== 'Deleted';
  }).map(function (r) {
    return {
      id: text_(r[0]), timestamp: dateTime_(r[1]), fname: text_(r[2]), lname: text_(r[3]), phone: text_(r[4]),
      lat: maybeNumber_(r[5]), lng: maybeNumber_(r[6]), material: text_(r[7]), quality: text_(r[8]), price: maybeNumber_(r[9]), capacity: text_(r[10]),
      recordStatus: text_(r[11]), materialType: text_(r[13]), materialOther: text_(r[14]),
      purchaseAfterHarvestDays: purchaseAfterHarvestDays_(r[16])
    };
  });
}

function farmerPublic_(r) {
  return {
    id: text_(r[0]), name: (text_(r[2]) + ' ' + text_(r[3])).trim(), fname: text_(r[2]), lname: text_(r[3]),
    phone: text_(r[4]), crop: text_(r[5]), harvest: dateInput_(r[7]), harvestDate: dateInput_(r[7]), area: text_(r[8]), lat: Number(r[9]), lng: Number(r[10]),
    materialType: text_(r[13]), materialOther: text_(r[14]), material: resolvedMaterial_(r[13], r[14], r[5])
  };
}

function buyerPublic_(r) {
  return {
    id: text_(r[0]), name: (text_(r[2]) + ' ' + text_(r[3])).trim(), fname: text_(r[2]), lname: text_(r[3]),
    phone: text_(r[4]), lat: Number(r[5]), lng: Number(r[6]),
    material: resolvedMaterial_(r[13], r[14], r[7]), quality: text_(r[8]), price: maybeNumber_(r[9]), capacity: text_(r[10]),
    purchaseAfterHarvestDays: purchaseAfterHarvestDays_(r[16])
  };
}

/** Legacy compatibility entry point. Farmer records no longer expire by harvest date. */
function autoExpireFarmers() {
  return 'SKIPPED: harvest-date expiry is disabled';
}

/** Removes every legacy trigger so old deployments cannot expire records later. */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'autoExpireFarmers';
  }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return 'PASS: legacy expiry trigger removed';
}

/** Run before deployment to verify the new database and required columns. */
function verifyDatabaseSchema() {
  const expected = {
    users: ['Telephone','Password','Status','Name','System','Consent','Consent_Timestamp','Created_At','Updated_At'],
    farmers: ['ID','Timestamp','Name','Surname','Phone','Crop','Plant_Date','Havest_Date','Area (ไร่-งาน-ตร.ว.)','Lat','Lng','Stasus','Owner_Telephone','Material_Type','Material_Other','Map_Expire_Date','Map_Visible','Updated_At'],
    buyers: ['ID','Timestamp','Name','Surname','Phone','Lat','Lng','Material','Quality','Price','Capacity','Status','Owner_Telephone','Material_Type','Material_Other','Updated_At','Purchase_After_Harvest_Days'],
    settings: ['Parameter','Value','Unit','Description']
  };
  Object.keys(expected).forEach(function (kind) {
    const sh = sheet_(kind);
    const headers = sh.getRange(1, 1, 1, expected[kind].length).getDisplayValues()[0];
    expected[kind].forEach(function (name, i) {
      if (headers[i] !== name) throw new Error(kind + ': expected ' + name + ' in column ' + (i + 1));
    });
  });
  return 'PASS: users, farmers, buyers and settings schema are ready';
}

/** One-time administrator setup after pasting this code into a new project. */
function setupSystem() {
  const migration = ensureBuyerHarvestDaysColumn_();
  const schema = verifyDatabaseSchema();
  const restored = restoreLegacyExpiredFarmers_();
  const trigger = setupDailyTrigger();
  return migration + '\n' + schema + '\n' + restored + '\n' + trigger;
}

/**
 * Run from the Apps Script editor after setupSystem().
 * The returned count must match Open farmer rows with valid Lat/Lng in farmers!A:R.
 */
function verifyLiveMatchingData() {
  const rows = openFarmersWithCoordinates_();
  return 'PASS: API ' + APP_VERSION + ' returns ' + rows.length +
    ' Open farmer record(s) with coordinates; harvest expiry and Map_Visible are ignored';
}

/** Adds the new buyers column without moving or rewriting any existing column. */
function ensureBuyerHarvestDaysColumn_() {
  const sh = sheet_('buyers');
  const cell = sh.getRange(1, 17);
  const current = String(cell.getValue() || '').trim();
  if (!current) cell.setValue('Purchase_After_Harvest_Days');
  if (current && current !== 'Purchase_After_Harvest_Days') {
    throw new Error('buyers: column Q is already used by ' + current);
  }
  return 'PASS: buyers column Q is ready';
}

/**
 * Restores rows marked Expired by versions that enforced harvest date +10 days.
 * Deleted rows and every other status are preserved.
 */
function restoreLegacyExpiredFarmers_() {
  const sh = sheet_('farmers');
  const rows = dataRows_(sh);
  let restored = 0;
  rows.forEach(function (r, i) {
    const row = i + 2;
    let status = String(r[11]).trim();
    if (status === 'Expired') {
      sh.getRange(row, 12).setValue('Open');
      sh.getRange(row, 18).setValue(new Date());
      status = 'Open';
      restored++;
    }
    if (status === 'Open') {
      sh.getRange(row, 16).setValue('');
      sh.getRange(row, 17).setFormula('=L' + row + '="Open"');
    }
  });
  return 'PASS: restored ' + restored + ' legacy Expired farmer record(s) to Open';
}

function setFarmerFormulas_(sh, row) {
  // Keep the existing P/Q columns for schema compatibility, but do not expire by harvest date.
  sh.getRange(row, 16).setValue('');
  sh.getRange(row, 17).setFormula('=L' + row + '="Open"');
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
  return SpreadsheetApp.openById(id);
}

function sheet_(kind) {
  const props = PropertiesService.getScriptProperties();
  const names = {
    users: props.getProperty('USERS_SHEET') || 'users',
    farmers: props.getProperty('FARMERS_SHEET') || 'farmers',
    buyers: props.getProperty('BUYERS_SHEET') || 'buyers',
    settings: props.getProperty('SETTINGS_SHEET') || 'Config'
  };
  const sh = spreadsheet_().getSheetByName(names[kind]);
  if (!sh) throw new Error('ไม่พบชีต ' + names[kind]);
  return sh;
}

function dataRows_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function findOwnedRow_(sh, id, phone, ownerColumn) {
  const values = dataRows_(sh);
  for (let i = 0; i < values.length; i++) {
    if (text_(values[i][0]) === id && isOwned_(values[i], phone, ownerColumn - 1)) return i + 2;
  }
  return 0;
}

function findIdRow_(sh, id) {
  const values = dataRows_(sh);
  for (let i = 0; i < values.length; i++) {
    if (text_(values[i][0]) === id) return i + 2;
  }
  return 0;
}

function isOwned_(row, phone, ownerIndex) {
  const explicitOwner = normalizePhone_(row[ownerIndex]);
  const legacyOwner = normalizePhone_(row[4]);
  return explicitOwner ? explicitOwner === phone : legacyOwner === phone;
}

function requireSession_(token) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('SESSION_EXPIRED');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('session:' + token);
  if (!raw) throw new Error('SESSION_EXPIRED');
  cache.put('session:' + token, raw, sessionTtlSeconds_());
  return JSON.parse(raw);
}

function setting_(key, fallback) {
  try {
    const sh = sheet_('settings');
    if (sh.getLastRow() < 2) return fallback;
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    const found = rows.find(function (r) { return String(r[0]).trim() === key; });
    return found ? found[1] : fallback;
  } catch (err) {
    return fallback;
  }
}

function sessionTtlSeconds_() {
  const seconds = Number(setting_('SESSION_TTL_SECONDS', DEFAULT_SESSION_TTL_SECONDS));
  return isFinite(seconds) && seconds >= 300 && seconds <= 21600 ? Math.floor(seconds) : DEFAULT_SESSION_TTL_SECONDS;
}

function purchaseAfterHarvestDays_(value) {
  // New format: ALL or an integer from 1–15. Legacy 0/blank values become ALL.
  if (value === '' || value === null || value === undefined || value === 0 || String(value).trim().toUpperCase() === 'ALL') {
    return 'ALL';
  }
  const days = Number(value);
  const maxDays = 15;
  if (!isFinite(days) || Math.floor(days) !== days || days < 1 || days > maxDays) {
    throw new Error('กรุณาเลือกทั้งหมด หรือจำนวนเต็มตั้งแต่ 1 ถึง ' + maxDays + ' วันหลังเก็บเกี่ยว');
  }
  return days;
}

function validateMaterial_(type, other) {
  type = cleanText_(type, 80);
  other = cleanText_(other, 150);
  // Backward-compatible: an old free-text material becomes “อื่นๆ”.
  if (MATERIAL_TYPES.indexOf(type) < 0 && type) { other = type; type = 'อื่นๆ'; }
  if (MATERIAL_TYPES.indexOf(type) < 0) throw new Error('กรุณาเลือกชนิดเศษวัสดุ');
  if (type === 'อื่นๆ' && !other) throw new Error('กรุณาระบุชนิดเศษวัสดุอื่นๆ');
  if (type !== 'อื่นๆ') other = '';
  return { type: type, other: other, resolved: type === 'อื่นๆ' ? other : type };
}

function resolvedMaterial_(type, other, fallback) {
  type = text_(type);
  other = text_(other);
  return type === 'อื่นๆ' ? (other || text_(fallback)) : (type || text_(fallback));
}

function parseDate_(value, label) {
  if (value === '' || value === null || value === undefined) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(label + 'ไม่ถูกต้อง');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    throw new Error(label + 'ไม่ถูกต้อง');
  }
  return d;
}

function toDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function numberInRange_(v, min, max, label) {
  const n = Number(v);
  if (!isFinite(n) || n < min || n > max) throw new Error(label + 'ไม่ถูกต้อง');
  return n;
}

function nonNegative_(v, label) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw new Error(label + 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  return n;
}

function maybeNumber_(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return isFinite(n) ? n : '';
}

function hasCoordinates_(lat, lng) {
  if (lat === '' || lat === null || lat === undefined || lng === '' || lng === null || lng === undefined) return false;
  const a = Number(lat), b = Number(lng);
  return isFinite(a) && isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}

function requireFields_(row, fields) {
  fields.forEach(function (f) { if (row[f[0]] === '') throw new Error('กรุณากรอก' + f[1]); });
}

function normalizeRole_(v) {
  const role = String(v || '').trim().toLowerCase();
  if (role !== 'farmer' && role !== 'buyer') throw new Error('บทบาทไม่ถูกต้อง');
  return role;
}

function normalizePhone_(v) { return String(v || '').replace(/\D/g, ''); }

function normalizeContactPhone_(v) {
  const phone = normalizePhone_(v);
  if (!/^0\d{9}$/.test(phone)) throw new Error('หมายเลขโทรศัพท์ต้องมี 10 หลัก');
  return phone;
}

function newId_() {
  return String(new Date().getTime()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

function cleanText_(v, max) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, max || 500);
}

function text_(v) { return cleanText_(v, 500); }

function dateInput_(v) {
  const d = toDate_(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

function dateTime_(v) {
  const d = toDate_(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : text_(v);
}

function publicError_(err) {
  const msg = String(err && err.message || err || 'เกิดข้อผิดพลาด');
  if (msg === 'SESSION_EXPIRED') return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  return cleanText_(msg, 300) || 'เกิดข้อผิดพลาด';
}
