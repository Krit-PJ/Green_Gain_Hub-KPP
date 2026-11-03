const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function assert(value, message) { if (!value) throw new Error(message); }
function throws(fn, re, message) {
  try { fn(); } catch (e) { if (!re || re.test(e.message)) return; throw new Error(message + ' (got: ' + e.message + ')'); }
  throw new Error(message + ' (did not throw)');
}

/* ---------- minimal Sheets mock ---------- */
const colNum = (l) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; }
  ensure(r, c) { while (this.rows.length < r) this.rows.push([]); while (this.rows[r - 1].length < c) this.rows[r - 1].push(''); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.length ? Math.max(...this.rows.map((r) => r.length)) : 0; }
  setFrozenRows() {}
  appendRow(r) { this.rows.push(r.slice()); }
  getRange(row, col, nr = 1, nc = 1) {
    if (typeof row === 'string') {
      const m = row.match(/^([A-Z]+):([A-Z]+)$/);
      return { setNumberFormat() { return this; } , m };
    }
    const sh = this;
    return {
      getDisplayValues() { return this.getValues().map((r) => r.map((v) => String(v ?? ''))); },
      getValue() { return ((sh.rows[row - 1] || [])[col - 1] ?? ''); },
      getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((sh.rows[row - 1 + i] || [])[col - 1 + j] ?? ''))); },
      setValues(v) { v.forEach((r, i) => r.forEach((x, j) => { sh.ensure(row + i, col + j); sh.rows[row - 1 + i][col - 1 + j] = x; })); return this; },
      setValue(x) { sh.ensure(row, col); sh.rows[row - 1][col - 1] = x; return this; },
      setNumberFormat() { return this; },
      setFormula(x) { return this.setValue(x); }
    };
  }
}
const sheets = {
  users: new Sheet('users', [['Telephone', 'Password', 'Status', 'Name', 'System', 'Consent', 'Consent_Timestamp', 'Created_At', 'Updated_At']]),
  farmers: new Sheet('farmers', [['ID', 'Timestamp', 'Name', 'Surname', 'Phone', 'Crop', 'Plant_Date', 'Havest_Date', 'Area (ไร่-งาน-ตร.ว.)', 'Lat', 'Lng', 'Stasus', 'Owner_Telephone', 'Material_Type', 'Material_Other', 'Map_Expire_Date', 'Map_Visible', 'Updated_At']]),
  buyers: new Sheet('buyers', [['ID', 'Timestamp', 'Name', 'Surname', 'Phone', 'Lat', 'Lng', 'Material', 'Quality', 'Price', 'Capacity', 'Status', 'Owner_Telephone', 'Material_Type', 'Material_Other', 'Updated_At', 'Purchase_After_Harvest_Days']]),
  Config: new Sheet('Config', [['Parameter', 'Value', 'Unit', 'Description']]),
  admins: new Sheet('admins', [['Telephone', 'Name', 'Role', 'Status', 'Pass_Hash', 'Salt', 'Created_At', 'Created_By', 'Last_Login', 'Updated_At']]),
  Research_Refs: new Sheet('Research_Refs', [['ID', 'Type', 'SubType', 'BioRate', 'PriceMin', 'PriceMax', 'PriceAvg', 'Source'], ['r1', 'ฟางข้าว', '', 0.5, '', '', '', 'test']])
};
global.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = new Sheet(n)) }) };
let props = { SUPER_ADMIN_PHONE: 'Krit', SUPER_ADMIN_PASSWORD: 'Start1234' }; // legacy property name, read as a username
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) };
const cache = new Map();
global.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const signed = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
global.Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, s) => signed(crypto.createHash(alg).update(String(s), 'utf8').digest()),
  base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => b & 255)).toString('base64url'),
  getUuid: () => crypto.randomUUID(),
  formatDate: (d, tz, f) => { const x = new Date(d), p = (n) => String(n).padStart(2, '0');
    if (f === 'yyyyMMddHHmmss') return `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}${p(x.getHours())}${p(x.getMinutes())}${p(x.getSeconds())}`;
    if (f === 'yyyy-MM') return `${x.getFullYear()}-${p(x.getMonth() + 1)}`;
    const date = `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    return f === 'yyyy-MM-dd' ? date : `${date} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`; }
};
global.Session = { getScriptTimeZone: () => 'Asia/Bangkok' };
global.ScriptApp = { getProjectTriggers: () => [], deleteTrigger() {} };
let lastOut = null;
global.ContentService = { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput: (b) => (lastOut = { body: b, setMimeType(m) { this.mime = m; return this; } }) };
global.UrlFetchApp = { fetchAll: () => { throw new Error('no network in tests'); } };
console.log = () => {}; // setupSystem() logs its report; keep test output short

const dir = path.join(__dirname, '..', 'apps-script');
const src = ['Districts.gs', 'Code.gs', 'Admin.gs', 'Crops.gs'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const api = new Function(src + '; return { doGet, doPost, setupSystem, buildCropSummary_, getCropDetail_, validateCropImport_, hashPassword_, requireAdmin_ };')();
const parser = require('../frontend/assets/crop-import.js');
const sample = parser.parse(require('./fixtures/rice-naphi-2569-70-harvest.json'));

const post = (method, args, token) => { api.doPost({ postData: { contents: JSON.stringify({ method, args, token }) } }); return JSON.parse(lastOut.body); };
const ok = (r, msg) => { assert(r.ok, msg + ': ' + r.error); return r.result; };

/* ---------- setup + super bootstrap ---------- */
props.SUPER_ADMIN_PASSWORD = '1234567';
assert(/FAIL: SUPER_ADMIN_PASSWORD/.test(api.setupSystem()) && props.SUPER_ADMIN_PASSWORD, 'weak bootstrap password must be reported, not thrown, and kept for correction');
props.SUPER_ADMIN_PASSWORD = '0812345678'; // digits-only is allowed
const setup = api.setupSystem();
assert(/PASS: admins and admin_log/.test(setup) && /PASS: crop_types/.test(setup) && /PASS: Super Admin "krit"/.test(setup), 'setupSystem must create admin/crop schema and Super Admin:\n' + setup);
assert(!('SUPER_ADMIN_PASSWORD' in props), 'plain Super Admin password must be removed from Script Properties');
assert(sheets.crop_types.rows.length === 6, 'default crop types must be seeded');
assert(sheets.admins.rows[0][0] === 'Username' && sheets.admins.rows[0][10] === 'Telephone' && sheets.admin_log.rows[0][1] === 'Username', 'empty legacy admin sheets must be migrated to username headers');
const superRow = sheets.admins.rows[1];
assert(superRow[0] === 'krit' && superRow[2] === 'super' && superRow[4] && superRow[4] !== '0812345678' && superRow[4].length === 64, 'password must be stored as a hash only');
assert(/PASS: Super Admin exists/.test(api.setupSystem()), 'setupSystem must be idempotent');

/* ---------- login / lockout / roles ---------- */
assert(post('adminLoginServer', [{ username: 'krit', password: 'wrong123' }]).ok === false, 'wrong password must fail');
const login = ok(post('adminLoginServer', [{ username: 'KRIT ', password: '0812345678' }]), 'super login');
const T = login.token;
assert(login.role === 'super' && /^[0-9a-f]{64}$/.test(T), 'login must return a super session token');
assert(post('adminMeServer', [], 'f'.repeat(64)).error === 'ADMIN_SESSION_EXPIRED', 'unknown token must be rejected');
assert(post('getUserProfileServer', [], T).error === 'Method not allowed', 'doPost must not expose farmer/buyer RPC');
for (let i = 0; i < 5; i++) post('adminLoginServer', [{ username: 'somchai', password: 'bad' + i + 'aaaa' }]);
assert(/15 นาที/.test(post('adminLoginServer', [{ username: 'somchai', password: 'x' }]).error), 'account must lock after 5 failed attempts');

ok(post('adminSaveServer', [{ username: 'admin.khanu', phone: '0899000003', name: 'Admin อำเภอ', role: 'admin', password: 'Admin1234' }], T), 'create admin');
assert(/8–128/.test(post('adminSaveServer', [{ username: 'weakpw', name: 'x', role: 'admin', password: 'short' }], T).error), 'weak password must be rejected');
const A = ok(post('adminLoginServer', [{ username: 'admin.khanu', password: 'Admin1234' }]), 'admin login').token;
assert(/เฉพาะ Super Admin/.test(post('settingsGetServer', [], A).error), 'admin must not read settings');
assert(/เฉพาะ Super Admin/.test(post('adminsListServer', [], A).error), 'admin must not manage admins');
assert(/ไม่สามารถลดสิทธิ์/.test(post('adminSaveServer', [{ username: 'krit', name: 'Super', role: 'admin', status: 'active' }], T).error), 'super must not demote self');
const admins = ok(post('adminsListServer', [], T), 'list admins');
assert(admins.length === 2 && admins[1].username === 'admin.khanu' && admins[1].phone === '0899000003' && !JSON.stringify(admins).includes(superRow[4]), 'admin list wrong or leaks password hashes');
assert(/ชื่อผู้ใช้ต้องยาว/.test(post('adminSaveServer', [{ username: 'a b', name: 'x', role: 'admin', password: 'Admin1234' }], T).error), 'invalid usernames must be rejected');

/* ---------- settings: keys are write-only ---------- */
ok(post('settingsSaveServer', [{ smartAgriKey: 'kpp_secretvalue1234567890' }], T), 'save smart agri key');
const st = ok(post('settingsGetServer', [], T), 'get settings');
assert(st.smartAgri.keySet && st.smartAgri.keyHint === 'kpp_secret…' && !JSON.stringify(st).includes('kpp_secretvalue1234567890'), 'API key must never be returned');
assert(/\/exec/.test(post('settingsSaveServer', [{ smartAgriUrl: 'https://evil.example.com/x' }], T).error), 'API URL must be an Apps Script /exec URL');

/* ---------- crop import: crop first, validate, replace ---------- */
const base = { crop: 'ข้าวนาปี', season: sample.suggestedSeason, monthType: 'harvest', fileName: 'ข้าวนาปี_เก็บเกี่ยว.xlsx', rows: sample.rows };
assert(/เลือกชนิดพืช/.test(post('cropImportCheckServer', [{ ...base, crop: '' }], A).error), 'import must require a crop');
assert(/เดือนที่คาดว่าจะเก็บเกี่ยว/.test(post('cropImportCheckServer', [{ ...base, monthType: 'plant' }], A).error), 'only harvest-month data is supported');
const bad = sample.rows.map((r) => (r.code === '62-01' && r.period === '202609' ? { ...r, area: r.area + 500 } : r));
assert(/ไม่สอดคล้อง/.test(post('cropImportCheckServer', [{ ...base, rows: bad }], A).error), 'inconsistent totals must be rejected');
assert(/ไม่ใช่จังหวัดกำแพงเพชร/.test(post('cropImportCheckServer', [{ ...base, rows: [{ code: '10-01', period: '202607', area: 1 }] }], A).error), 'other provinces must be rejected');

const check = ok(post('cropImportCheckServer', [base], A), 'check');
assert(check.rows === 580 && check.totalRai === 1177773.92 && check.districts === 11 && check.subdistricts === 78 && check.replaces.length === 0, 'preview check is wrong');
assert(sheets.crop_stats.rows.length === 1, 'check must not write anything');
const c1 = ok(post('cropImportCommitServer', [base], A), 'commit');
assert(c1.rows === 580 && c1.replaced === 0 && sheets.crop_stats.rows.length === 581, 'first import must append 580 rows');

const now = new Date(2026, 10, 3);
let cs = api.buildCropSummary_(now);
let rice = cs.crops.find((c) => c.crop === 'ข้าวนาปี');
const harvestedToOct = 7333.8 + 181556.68 + 497828.54 + 226055.33;
assert(rice && rice.totalRai === 1177773.92 && rice.asOfMonth === 202610, 'crop summary total/asOf wrong');
assert(Math.abs(rice.harvestedRai - harvestedToOct) < 0.01 && Math.abs(rice.remainingRai - (1177773.92 - harvestedToOct)) < 0.01, 'remaining = planted - harvested through last month');
assert(rice.currentMonthRai === 199680.82 && rice.nextMonthRai === 58147.83, 'current/next month harvest wrong');
assert(rice.months.length === 8 && rice.byDistrict.length === 11 && rice.byDistrict[0].code === '6201', 'monthly and district breakdown wrong');
const mueang = rice.byDistrict.find((d) => d.code === '6201');
assert(Math.abs(mueang.totalRai - (1765.5 + 13088.02 + 92378.0 + 33381.97 + 25488.5 + 6408.77 + 1124.78 + 251.0)) < 0.01, 'district total wrong');
assert(rice.residue && rice.residue.bioRateTonPerRai === 0.5 && rice.material === 'ฟางข้าว', 'BioRate residue estimate must follow the crop material');

const detail = api.getCropDetail_({ crop: 'ข้าวนาปี', season: base.season, district: '6201' });
assert(detail.subdistricts.length === 16 && detail.subdistricts.every((t) => t.code.startsWith('6201')), 'sub-district detail wrong');

// Re-import a revised file: replaces, does not add.
const revised = sample.rows.filter((r) => r.period !== '202702');
const c2 = ok(post('cropImportCommitServer', [{ ...base, rows: revised }], A), 'second commit');
assert(c2.replaced === 1, 'second import of same crop+season must replace the first');
cs = api.buildCropSummary_(now);
rice = cs.crops.filter((c) => c.crop === 'ข้าวนาปี');
assert(rice.length === 1 && Math.abs(rice[0].totalRai - (1177773.92 - 454.25)) < 0.01, 'replaced import must not be double counted');

// Second crop + delete
const sugar = sample.rows.map((r) => ({ ...r, area: Math.round(r.area * 10) / 100 }));
const sugarCheck = post('cropImportCheckServer', [{ ...base, crop: 'อ้อยโรงงาน', rows: sugar }], A);
assert(sugarCheck.ok, 'scaled second crop should validate: ' + sugarCheck.error);
const c3 = ok(post('cropImportCommitServer', [{ ...base, crop: 'อ้อยโรงงาน', rows: sugar }], A), 'second crop');
assert(api.buildCropSummary_(now).crops.length === 2, 'more than one crop must be supported');
ok(post('cropImportDeleteServer', [{ importId: c3.importId }], A), 'delete import');
assert(api.buildCropSummary_(now).crops.length === 1, 'deleted import must disappear from the summary');
const hist = ok(post('cropImportsListServer', [], A), 'history');
assert(hist.length === 3 && hist.map((h) => h.status).join(',') === 'deleted,active,replaced', 'import history statuses wrong: ' + hist.map((h) => h.status));

// Crop types managed by admin
ok(post('cropTypeSaveServer', [{ crop: 'ถั่วเหลือง', material: 'ต้นถั่ว', active: true, sortOrder: 6 }], A), 'add crop type');
assert(ok(post('cropTypesListServer', [], A), 'types').some((t) => t.crop === 'ถั่วเหลือง'), 'new crop type must be listed');

/* ---------- public API ---------- */
api.doGet({ parameter: { api: 'v1', endpoint: 'summary', refresh: '1' } });
const pub = JSON.parse(lastOut.body);
assert(pub.ok && pub.apiVersion === '1.6.0' && pub.data.crops.ok && pub.data.crops.crops[0].crop === 'ข้าวนาปี', 'summary must include crops');
assert(!lastOut.body.includes(superRow[4]) && !lastOut.body.includes('0899000003') && !lastOut.body.includes('admin.khanu'), 'public summary must not leak admin data');
api.doGet({ parameter: { api: 'v1', endpoint: 'crop', crop: 'ข้าวนาปี', district: '6204' } });
const det = JSON.parse(lastOut.body);
assert(det.ok && det.data.subdistricts.length > 0, 'crop detail endpoint failed');

/* ---------- audit ---------- */
const log = ok(post('adminLogServer', [], T), 'log');
['super_bootstrap', 'login', 'admin_create', 'settings_save', 'crop_import', 'crop_import_delete', 'crop_type_save'].forEach((a) => assert(log.some((l) => l.action === a), 'audit log missing ' + a));
ok(post('adminLogoutServer', [], A), 'logout');
assert(post('adminMeServer', [], A).error === 'ADMIN_SESSION_EXPIRED', 'logged-out token must be rejected');

process.stdout.write('PASS: admin roles/auth/lockout/audit, write-only API keys, crop import (validate, replace, delete, multi-crop) and crop summary\n');
