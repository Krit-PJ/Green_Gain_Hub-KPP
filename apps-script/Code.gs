/**
 * Green Gain Hub 0.7.1 — API-only bridge from GitHub Pages to Google Sheets.
 * Database: Google Sheets / file storage: Google Drive.
 */
const DEFAULT_SPREADSHEET_ID = '1_WNNYeCxeUYhDw8WA1A0NrR3NP6QO0oaM498vGsK1aA';
const DEFAULT_SESSION_TTL_SECONDS = 21600; // 6 hours
const DEFAULT_MAP_EXPIRY_DAYS = 10;
const MATERIAL_TYPES = ['ฟางข้าว', 'ใบอ้อย', 'เหง้ามันสำปะหลัง', 'อื่นๆ'];
const PUBLIC_METHODS = ['loginServer', 'registerServer'];
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
    getUserProfileServer: function (args, session) { return getUserProfileServer(session); },
    saveDataServer: function (args, session) { return saveDataServer(args[0], session); },
    deleteDataServer: function (args, session) { return deleteDataServer(args[0], session); },
    getMatchingDataServer: function (args, session) { return getMatchingDataServer(session); }
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
  // session is intentionally required even though matching data is shared.
  const farmers = dataRows_(sheet_('farmers')).filter(function (r) {
    return String(r[11]).trim() === 'Open' && isMapVisible_(r[7], r[11], new Date()) && hasCoordinates_(r[9], r[10]);
  }).map(farmerPublic_);
  const buyers = dataRows_(sheet_('buyers')).filter(function (r) {
    return String(r[11]).trim() === 'Active' && hasCoordinates_(r[5], r[6]);
  }).map(buyerPublic_);
  return { status: 'success', success: true, farmers: farmers, buyers: buyers, generatedAt: new Date().toISOString() };
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
  const material = validateMaterial_(data.materialType || data.material, data.materialOther);
  const id = cleanText_(data.id, 100) || newId_();
  const now = new Date();
  const rowValues = [
    id, now, cleanText_(data.fname, 100), cleanText_(data.lname, 100),
    normalizeContactPhone_(data.phone || session.phone), numberInRange_(data.lat, -90, 90, 'ละติจูด'),
    numberInRange_(data.lng, -180, 180, 'ลองจิจูด'), material.resolved,
    cleanText_(data.quality, 100), nonNegative_(data.price, 'ราคา'), cleanText_(data.capacity, 80),
    'Active', session.phone, material.type, material.other, now
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
      sh.getRange(row, 1, 1, 16).setValues([rowValues]);
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
      recordStatus: text_(r[11]), materialType: text_(r[13]), materialOther: text_(r[14])
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
    material: resolvedMaterial_(r[13], r[14], r[7]), quality: text_(r[8]), price: maybeNumber_(r[9]), capacity: text_(r[10])
  };
}

/** Marks old Open records Expired. Install with setupDailyTrigger(). */
function autoExpireFarmers() {
  const sh = sheet_('farmers');
  const rows = dataRows_(sh);
  const now = new Date();
  rows.forEach(function (r, i) {
    if (String(r[11]) === 'Open' && !isMapVisible_(r[7], r[11], now)) {
      sh.getRange(i + 2, 12).setValue('Expired');
      sh.getRange(i + 2, 18).setValue(now);
    }
  });
}

function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'autoExpireFarmers';
  }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('autoExpireFarmers').timeBased().everyDays(1).atHour(1).create();
}

/** Run before deployment to verify the new database and required columns. */
function verifyDatabaseSchema() {
  const expected = {
    users: ['Telephone','Password','Status','Name','System','Consent','Consent_Timestamp','Created_At','Updated_At'],
    farmers: ['ID','Timestamp','Name','Surname','Phone','Crop','Plant_Date','Havest_Date','Area (ไร่-งาน-ตร.ว.)','Lat','Lng','Stasus','Owner_Telephone','Material_Type','Material_Other','Map_Expire_Date','Map_Visible','Updated_At'],
    buyers: ['ID','Timestamp','Name','Surname','Phone','Lat','Lng','Material','Quality','Price','Capacity','Status','Owner_Telephone','Material_Type','Material_Other','Updated_At'],
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
  const schema = verifyDatabaseSchema();
  const expiry = testMapExpiryRule();
  setupDailyTrigger();
  return schema + '\n' + expiry + '\nPASS: daily trigger installed';
}

/** Run once in the Apps Script editor: day 10 must be true and day 11 false. */
function testMapExpiryRule() {
  const harvest = new Date(2026, 0, 1);
  const day10 = new Date(2026, 0, 11, 23, 59, 59);
  const day11 = new Date(2026, 0, 12, 0, 0, 0);
  if (!isMapVisible_(harvest, 'Open', day10)) throw new Error('Day 10 should be visible');
  if (isMapVisible_(harvest, 'Open', day11)) throw new Error('Day 11 should be hidden');
  return 'PASS: visible through day 10; hidden from day 11';
}

function isMapVisible_(harvestValue, status, now) {
  if (String(status).trim() !== 'Open') return false;
  const harvest = toDate_(harvestValue);
  if (!harvest) return true;
  const expireExclusive = new Date(harvest.getFullYear(), harvest.getMonth(), harvest.getDate() + mapExpiryDays_() + 1, 0, 0, 0, 0);
  return now.getTime() < expireExclusive.getTime();
}

function setFarmerFormulas_(sh, row) {
  sh.getRange(row, 16).setFormula('=IF(H' + row + '="","",H' + row + '+10)');
  sh.getRange(row, 17).setFormula('=IF(L' + row + '<>"Open",FALSE,IF(H' + row + '="",TRUE,TODAY()<=P' + row + '))');
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

function mapExpiryDays_() {
  const days = Number(setting_('MAP_EXPIRY_DAYS', DEFAULT_MAP_EXPIRY_DAYS));
  return isFinite(days) && days >= 0 && days <= 365 ? Math.floor(days) : DEFAULT_MAP_EXPIRY_DAYS;
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
