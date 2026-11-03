/**
 * Green Gain Hub 1.6.0 — Super Admin / Admin.
 *
 * Admin accounts are separate from farmer/buyer users and always need a
 * password (salted, iterated SHA-256). Admin calls go through doPost (JSON in a
 * text/plain body, so the browser sends no CORS preflight) because imports are
 * too large for the JSONP GET used by the public app.
 *
 * Roles
 *   super — everything below + API links, admin accounts, audit log
 *   admin — import crop data, manage import history and crop types
 *
 * Admins sign in with a username (3–32 chars: a–z, 0–9, . _ -) and password.
 *
 * First Super Admin: set Script Properties SUPER_ADMIN_USERNAME (or the older
 * SUPER_ADMIN_PHONE, read as a username) and SUPER_ADMIN_PASSWORD, then run
 * setupSystem(). The password property is deleted as soon as its hash is stored.
 */

const ADMIN_SHEETS = {
  admins: ['Username', 'Name', 'Role', 'Status', 'Pass_Hash', 'Salt', 'Created_At', 'Created_By', 'Last_Login', 'Updated_At', 'Telephone'],
  admin_log: ['Time', 'Username', 'Name', 'Role', 'Action', 'Detail']
};
const ADMIN_ROLES = ['super', 'admin'];
const ADMIN_SESSION_SECONDS = 7200; // 2 hours, refreshed on use
const ADMIN_MAX_FAILS = 5;
const ADMIN_LOCK_SECONDS = 900;
const PASSWORD_ROUNDS = 300;

const ADMIN_METHODS = {
  adminLoginServer: { role: null, fn: function (a) { return adminLoginServer(a[0]); } },
  adminLogoutServer: { role: 'admin', fn: function (a, s, t) { return adminLogoutServer(t); } },
  adminMeServer: { role: 'admin', fn: function (a, s) { return adminMeServer(s); } },
  adminChangePasswordServer: { role: 'admin', fn: function (a, s) { return adminChangePasswordServer(a[0], s); } },
  cropTypesListServer: { role: 'admin', fn: function () { return cropTypesList_(true); } },
  cropTypeSaveServer: { role: 'admin', fn: function (a, s) { return cropTypeSave_(a[0], s); } },
  cropImportCheckServer: { role: 'admin', fn: function (a) { return cropImportCheck_(a[0]); } },
  cropImportCommitServer: { role: 'admin', fn: function (a, s) { return cropImportCommit_(a[0], s); } },
  cropImportsListServer: { role: 'admin', fn: function () { return cropImportsList_(); } },
  cropImportDeleteServer: { role: 'admin', fn: function (a, s) { return cropImportDelete_(a[0], s); } },
  cacheClearServer: { role: 'admin', fn: function (a, s) { return adminCacheClear_(s); } },
  settingsGetServer: { role: 'super', fn: function () { return settingsGet_(); } },
  settingsSaveServer: { role: 'super', fn: function (a, s) { return settingsSave_(a[0], s); } },
  smartAgriTestServer: { role: 'super', fn: function () { return smartAgriTest_(); } },
  adminsListServer: { role: 'super', fn: function () { return adminsList_(); } },
  adminSaveServer: { role: 'super', fn: function (a, s) { return adminSave_(a[0], s); } },
  adminResetPasswordServer: { role: 'super', fn: function (a, s) { return adminResetPassword_(a[0], s); } },
  adminLogServer: { role: 'super', fn: function () { return adminLogList_(); } }
};

/** JSON POST endpoint for the admin page. Body: {"method": "...", "args": [...], "token": "..."} */
function doPost(e) {
  let payload;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const method = String(body.method || '');
    const def = ADMIN_METHODS[method];
    if (!def) throw new Error('Method not allowed');
    const args = Array.isArray(body.args) ? body.args : [];
    const session = def.role ? requireAdmin_(body.token, def.role) : null;
    payload = { ok: true, result: def.fn(args, session, String(body.token || '')) };
  } catch (err) {
    payload = { ok: false, error: publicError_(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------ schema ------------------------------ */

function ensureSheet_(name, headers) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (sh.setFrozenRows) sh.setFrozenRows(1);
    return sh;
  }
  const have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  headers.forEach(function (h, i) {
    if (have[i] && have[i] !== h) throw new Error(name + ': expected ' + h + ' in column ' + (i + 1) + ' but found ' + have[i]);
    if (!have[i]) sh.getRange(1, i + 1).setValue(h);
  });
  return sh;
}

function ensureAdminSchema_() {
  // Early 1.6.0 drafts keyed admins by Telephone. Rewrite the header only while a sheet has no data rows.
  const ss = spreadsheet_();
  Object.keys(ADMIN_SHEETS).forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (!sh || sh.getLastRow() >= 2 || !sh.getLastColumn()) return;
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    if (head.join('|') !== ADMIN_SHEETS[n].slice(0, head.length).join('|')) sh.getRange(1, 1, 1, ADMIN_SHEETS[n].length).setValues([ADMIN_SHEETS[n]]);
  });
  Object.keys(ADMIN_SHEETS).forEach(function (n) { ensureSheet_(n, ADMIN_SHEETS[n]); });
  sheetByName_('admins').getRange('A:A').setNumberFormat('@');
  sheetByName_('admins').getRange('K:K').setNumberFormat('@');
  return 'PASS: admins and admin_log sheets are ready';
}

function sheetByName_(name) {
  const sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต ' + name + ' กรุณา Run setupSystem()');
  return sh;
}

function normalizeUsername_(v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase(); }
function validUsername_(u) { return /^[a-z0-9._-]{3,32}$/.test(u); }

/** Creates the first Super Admin from Script Properties, then removes the plain password. */
function ensureSuperAdmin_() {
  const props = PropertiesService.getScriptProperties();
  const rows = dataRows_(sheetByName_('admins'));
  const hasSuper = rows.some(function (r) { return text_(r[2]) === 'super' && text_(r[3]) !== 'disabled'; });
  const username = normalizeUsername_(props.getProperty('SUPER_ADMIN_USERNAME') || props.getProperty('SUPER_ADMIN_PHONE'));
  const password = props.getProperty('SUPER_ADMIN_PASSWORD');
  if (!password) {
    return hasSuper ? 'PASS: Super Admin exists' :
      'INFO: no Super Admin yet — set Script Properties SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD, then run setupSystem()';
  }
  if (!validUsername_(username)) return 'FAIL: SUPER_ADMIN_USERNAME must be 3–32 characters (a–z, 0–9, . _ -)';
  validatePassword_(password);
  const sh = sheetByName_('admins');
  const row = findAdminRow_(username);
  const salt = Utilities.getUuid();
  const now = new Date();
  if (row) {
    sh.getRange(row, 3, 1, 4).setValues([['super', 'active', hashPassword_(salt, password), salt]]);
    sh.getRange(row, 10).setValue(now);
  } else {
    sh.appendRow([username, 'Super Admin', 'super', 'active', hashPassword_(salt, password), salt, now, 'setupSystem', '', now, '']);
  }
  props.deleteProperty('SUPER_ADMIN_PASSWORD');
  adminAudit_({ username: username, name: 'Super Admin', role: 'super' }, 'super_bootstrap', 'สร้าง/ตั้งรหัสผ่าน Super Admin จาก Script Properties');
  return 'PASS: Super Admin "' + username + '" is ready (SUPER_ADMIN_PASSWORD was removed from Script Properties)';
}

/* ------------------------------ auth ------------------------------ */

function hashPassword_(salt, password) {
  let h = String(salt) + ':' + String(password);
  for (let i = 0; i < PASSWORD_ROUNDS; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  }
  return h;
}

function validatePassword_(pw) {
  pw = String(pw || '');
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัว และมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข');
  }
  return pw;
}

function findAdminRow_(username) {
  const rows = dataRows_(sheetByName_('admins'));
  for (let i = 0; i < rows.length; i++) if (normalizeUsername_(rows[i][0]) === username) return i + 2;
  return 0;
}

function adminRecord_(username) {
  const row = findAdminRow_(username);
  if (!row) return null;
  const r = sheetByName_('admins').getRange(row, 1, 1, ADMIN_SHEETS.admins.length).getValues()[0];
  return { row: row, username: normalizeUsername_(r[0]), name: text_(r[1]), role: text_(r[2]), status: text_(r[3]) || 'active',
    hash: String(r[4] || ''), salt: String(r[5] || ''), phone: text_(r[10]) };
}

function adminLoginServer(input) {
  input = input || {};
  const username = normalizeUsername_(input.username);
  const password = String(input.password || '');
  if (!validUsername_(username) || !password) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  const cache = CacheService.getScriptCache();
  const failKey = 'afail:' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= ADMIN_MAX_FAILS) throw new Error('ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
  const a = adminRecord_(username);
  const ok = a && a.status === 'active' && ADMIN_ROLES.indexOf(a.role) >= 0 && a.hash && hashPassword_(a.salt, password) === a.hash;
  if (!ok) {
    cache.put(failKey, String(fails + 1), ADMIN_LOCK_SECONDS);
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  cache.remove(failKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const session = { username: a.username, role: a.role, name: a.name };
  cache.put('admin:' + token, JSON.stringify(session), ADMIN_SESSION_SECONDS);
  sheetByName_('admins').getRange(a.row, 9).setValue(new Date());
  adminAudit_(session, 'login', 'เข้าสู่ระบบผู้ดูแล');
  return { status: 'success', token: token, username: a.username, name: a.name, role: a.role, expiresIn: ADMIN_SESSION_SECONDS };
}

function adminLogoutServer(token) {
  CacheService.getScriptCache().remove('admin:' + token);
  return { status: 'success' };
}

/** Validates the admin token and re-checks the account status on every call. */
function requireAdmin_(token, minRole) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('ADMIN_SESSION_EXPIRED');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('admin:' + token);
  if (!raw) throw new Error('ADMIN_SESSION_EXPIRED');
  const s = JSON.parse(raw);
  const a = adminRecord_(s.username);
  if (!a || a.status !== 'active' || ADMIN_ROLES.indexOf(a.role) < 0) {
    cache.remove('admin:' + token);
    throw new Error('บัญชีผู้ดูแลถูกระงับหรือถูกลบ');
  }
  if (minRole === 'super' && a.role !== 'super') throw new Error('เฉพาะ Super Admin เท่านั้น');
  const session = { username: a.username, role: a.role, name: a.name };
  cache.put('admin:' + token, JSON.stringify(session), ADMIN_SESSION_SECONDS);
  return session;
}

function adminMeServer(s) {
  return { status: 'success', username: s.username, name: s.name, role: s.role, apiVersion: APP_VERSION };
}

function adminChangePasswordServer(input, s) {
  input = input || {};
  const a = adminRecord_(s.username);
  if (!a || hashPassword_(a.salt, String(input.current || '')) !== a.hash) throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  const next = validatePassword_(input.next);
  const salt = Utilities.getUuid();
  const sh = sheetByName_('admins');
  sh.getRange(a.row, 5, 1, 2).setValues([[hashPassword_(salt, next), salt]]);
  sh.getRange(a.row, 10).setValue(new Date());
  adminAudit_(s, 'password_change', 'เปลี่ยนรหัสผ่านของตนเอง');
  return { status: 'success', message: 'เปลี่ยนรหัสผ่านแล้ว' };
}

/* ------------------------------ admin accounts (super) ------------------------------ */

function adminsList_() {
  return dataRows_(sheetByName_('admins')).map(function (r) {
    return { username: normalizeUsername_(r[0]), name: text_(r[1]), role: text_(r[2]), status: text_(r[3]) || 'active',
      phone: displayPhone_(r[10]), createdAt: dateTime_(r[6]), createdBy: text_(r[7]), lastLogin: dateTime_(r[8]) };
  });
}

function adminSave_(input, s) {
  input = input || {};
  const username = normalizeUsername_(input.username);
  if (!validUsername_(username)) throw new Error('ชื่อผู้ใช้ต้องยาว 3–32 ตัว ใช้ a–z, 0–9, จุด, ขีดล่าง หรือขีดกลาง');
  const phone = input.phone ? normalizePhone_(input.phone) : '';
  if (phone && !/^0\d{9}$/.test(phone)) throw new Error('เบอร์โทรศัพท์ต้องมี 10 หลัก (หรือเว้นว่าง)');
  const name = cleanText_(input.name, 120);
  const role = String(input.role || 'admin');
  const status = String(input.status || 'active');
  if (!name) throw new Error('กรุณากรอกชื่อ');
  if (ADMIN_ROLES.indexOf(role) < 0) throw new Error('บทบาทไม่ถูกต้อง');
  if (['active', 'disabled'].indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheetByName_('admins');
    const existing = adminRecord_(username);
    const now = new Date();
    if (existing) {
      if (username === s.username && (role !== 'super' || status !== 'active')) throw new Error('ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้');
      if (existing.role === 'super' && (role !== 'super' || status !== 'active') && activeSuperCount_() <= 1) {
        throw new Error('ต้องมี Super Admin ที่ใช้งานได้อย่างน้อย 1 คน');
      }
      sh.getRange(existing.row, 2, 1, 3).setValues([[name, role, status]]);
      sh.getRange(existing.row, 10, 1, 2).setValues([[now, phone]]);
      adminAudit_(s, 'admin_update', username + ' → ' + role + '/' + status);
      return { status: 'success', message: 'บันทึกผู้ดูแลแล้ว' };
    }
    const password = validatePassword_(input.password);
    const salt = Utilities.getUuid();
    sh.appendRow([username, name, role, status, hashPassword_(salt, password), salt, now, s.name + ' (' + s.username + ')', '', now, phone]);
    sh.getRange(sh.getLastRow(), 1).setNumberFormat('@');
    adminAudit_(s, 'admin_create', username + ' (' + role + ')');
    return { status: 'success', message: 'เพิ่มผู้ดูแลแล้ว ส่งรหัสผ่านเริ่มต้นให้ผู้ใช้ทางช่องทางที่ปลอดภัย' };
  } finally {
    lock.releaseLock();
  }
}

function activeSuperCount_() {
  return dataRows_(sheetByName_('admins')).filter(function (r) { return text_(r[2]) === 'super' && (text_(r[3]) || 'active') === 'active'; }).length;
}

function adminResetPassword_(input, s) {
  input = input || {};
  const a = adminRecord_(normalizeUsername_(input.username));
  if (!a) throw new Error('ไม่พบผู้ดูแล');
  const pw = validatePassword_(input.password);
  const salt = Utilities.getUuid();
  const sh = sheetByName_('admins');
  sh.getRange(a.row, 5, 1, 2).setValues([[hashPassword_(salt, pw), salt]]);
  sh.getRange(a.row, 10).setValue(new Date());
  CacheService.getScriptCache().remove('afail:' + a.username);
  adminAudit_(s, 'password_reset', a.username);
  return { status: 'success', message: 'ตั้งรหัสผ่านใหม่แล้ว' };
}

/* ------------------------------ settings / API links (super) ------------------------------ */

function keyHint_(v) {
  v = String(v || '');
  return v ? v.slice(0, 10) + '…' : '';
}

function settingsGet_() {
  const p = PropertiesService.getScriptProperties();
  return {
    status: 'success',
    apiVersion: APP_VERSION,
    spreadsheetId: p.getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID,
    smartAgri: {
      url: p.getProperty('SMART_AGRI_API_URL') || SMART_AGRI_DEFAULT_URL,
      urlIsDefault: !p.getProperty('SMART_AGRI_API_URL'),
      keySet: !!p.getProperty('SMART_AGRI_API_KEY'),
      keyHint: keyHint_(p.getProperty('SMART_AGRI_API_KEY'))
    },
    summaryKeySet: !!p.getProperty('SUMMARY_API_KEY'),
    publicEndpoints: ['?api=v1&endpoint=summary', '?api=v1&endpoint=crop&crop=…&season=…&district=…', '?api=v1&endpoint=health']
  };
}

/** Keys are write-only: they are never returned, only whether one is set and its prefix. */
function settingsSave_(input, s) {
  input = input || {};
  const p = PropertiesService.getScriptProperties();
  const changed = [];
  if ('smartAgriUrl' in input) {
    const url = String(input.smartAgriUrl || '').trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
      throw new Error('URL ต้องเป็น Apps Script Web App ที่ลงท้ายด้วย /exec');
    }
    if (url && url !== SMART_AGRI_DEFAULT_URL) p.setProperty('SMART_AGRI_API_URL', url); else p.deleteProperty('SMART_AGRI_API_URL');
    changed.push('SMART_AGRI_API_URL');
  }
  if (input.smartAgriKey) {
    const key = String(input.smartAgriKey).trim();
    if (!/^[A-Za-z0-9_\-]{12,200}$/.test(key)) throw new Error('API Key มีรูปแบบไม่ถูกต้อง');
    p.setProperty('SMART_AGRI_API_KEY', key);
    changed.push('SMART_AGRI_API_KEY');
  }
  if (input.clearSmartAgriKey) { p.deleteProperty('SMART_AGRI_API_KEY'); changed.push('SMART_AGRI_API_KEY (ลบ)'); }
  if (input.summaryKey) {
    const k = String(input.summaryKey).trim();
    if (!/^[A-Za-z0-9_\-]{8,200}$/.test(k)) throw new Error('Summary key มีรูปแบบไม่ถูกต้อง');
    p.setProperty('SUMMARY_API_KEY', k);
    changed.push('SUMMARY_API_KEY');
  }
  if (input.clearSummaryKey) { p.deleteProperty('SUMMARY_API_KEY'); changed.push('SUMMARY_API_KEY (ลบ)'); }
  try { CacheService.getScriptCache().remove(SMART_AGRI_CACHE_KEY); } catch (err) { /* best effort */ }
  adminAudit_(s, 'settings_save', changed.join(', ') || 'ไม่มีการเปลี่ยนแปลง');
  return { status: 'success', changed: changed, settings: settingsGet_() };
}

function smartAgriTest_() {
  return { status: 'success', result: verifySmartAgriConnection() };
}

function adminCacheClear_(s) {
  const c = CacheService.getScriptCache();
  [SUMMARY_CACHE_KEY, SMART_AGRI_CACHE_KEY, CROP_SUMMARY_CACHE_KEY].forEach(function (k) { try { c.remove(k); } catch (err) { /* ignore */ } });
  adminAudit_(s, 'cache_clear', 'ล้าง cache ข้อมูลหน้าแรก');
  return { status: 'success', message: 'ล้าง cache แล้ว หน้าแรกจะแสดงข้อมูลล่าสุด' };
}

/* ------------------------------ audit ------------------------------ */

function adminAudit_(s, action, detail) {
  try {
    sheetByName_('admin_log').appendRow([new Date(), s && s.username || '', s && s.name || '', s && s.role || '', action, cleanText_(detail, 400)]);
  } catch (err) { /* never block the action on logging */ }
}

function adminLogList_() {
  const rows = dataRows_(sheetByName_('admin_log'));
  return rows.slice(-200).reverse().map(function (r) {
    return { time: dateTime_(r[0]), username: text_(r[1]), name: text_(r[2]), role: text_(r[3]), action: text_(r[4]), detail: text_(r[5]) };
  });
}
