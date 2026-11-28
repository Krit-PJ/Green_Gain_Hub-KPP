/**
 * Green Gain Hub 4.0.0 — officers of this system only (no central identity / SSO).
 *
 * Roles
 *   super — every province: approves Admins, manages accounts, market settings, every report, the audit log
 *   admin — the province on the account only: users, plots for sale and buyer points of that province, its reports
 *
 * Sign-in: username + password (salted, iterated SHA-256; 5 wrong tries lock the username for 15 minutes).
 * First Super Admin: the owner sets Script Properties SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD, then runs
 * setupSystem() — the plain password property is deleted as soon as its hash is stored.
 * Admins register themselves (status "pending") and work only after a Super Admin approves them.
 *
 * Every look at personal data (phone numbers, exact coordinates) and every change is written to ggh_admin_log.
 * The sheets "admins" / "admin_log" from before 2.6.0 (now ABM's) are not read or changed.
 *
 * Calls: POST {method, args:[…], token} (text/plain JSON, no CORS preflight) — see doPost in Code.gs.
 */
const GADMIN_SHEETS = {
  ggh_admins: ['Username', 'Name', 'Role', 'Status', 'Pass_Hash', 'Salt', 'Telephone', 'Agency', 'Province_Code', 'Province',
    'Created_At', 'Created_By', 'Approved_At', 'Approved_By', 'Last_Login', 'Updated_At'],
  ggh_admin_log: ['Time', 'Username', 'Name', 'Role', 'Province_Code', 'Action', 'Detail']
};
const GADMIN_ROLES = ['super', 'admin'];
const GADMIN_STATUS = ['pending', 'active', 'disabled', 'rejected'];
const GADMIN_SESSION_SECONDS = 7200;
const GADMIN_MAX_FAILS = 5;
const GADMIN_LOCK_SECONDS = 900;
const GADMIN_ROUNDS = 300;
const GADMIN_LIST_MAX = 2000;

function gadminRoleLabel_(r) { return r === 'super' ? 'Super Admin' : 'Admin'; }
function gadminUsername_(v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase(); }
function gadminValidUsername_(u) { return /^[a-z0-9._-]{3,32}$/.test(u); }
function gadminPassword_(pw) {
  pw = String(pw || '');
  if (pw.length < 8 || pw.length > 128) throw new Error('รหัสผ่านต้องยาว 8–128 ตัวอักษร');
  return pw;
}
function gadminHash_(salt, password) {
  let h = String(salt) + ':' + String(password);
  for (let i = 0; i < GADMIN_ROUNDS; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  }
  return h;
}

/* ------------------------------ schema / first Super Admin ------------------------------ */
function ensureAdminSchema_() {
  Object.keys(GADMIN_SHEETS).forEach(function (n) { ensureSheet_(n, GADMIN_SHEETS[n]); });
  const sh = sheetByName_('ggh_admins');
  sh.getRange('A:A').setNumberFormat('@'); sh.getRange('G:I').setNumberFormat('@');
  return 'PASS: ggh_admins and ggh_admin_log sheets are ready';
}

function ensureSuperAdmin_() {
  const props = PropertiesService.getScriptProperties();
  const username = gadminUsername_(props.getProperty('SUPER_ADMIN_USERNAME'));
  const password = props.getProperty('SUPER_ADMIN_PASSWORD');
  const hasSuper = dataRows_(sheetByName_('ggh_admins')).some(function (r) { return text_(r[2]) === 'super' && text_(r[3]) === 'active'; });
  if (!password) return hasSuper ? 'PASS: Super Admin exists' :
    'INFO: no Super Admin yet — set Script Properties SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD, then run setupSystem()';
  if (!gadminValidUsername_(username)) return 'FAIL: SUPER_ADMIN_USERNAME must be 3–32 characters (a–z, 0–9, . _ -)';
  try { gadminPassword_(password); } catch (err) { return 'FAIL: SUPER_ADMIN_PASSWORD — ' + err.message; }
  const sh = sheetByName_('ggh_admins');
  const a = gadminRecord_(username);
  const salt = Utilities.getUuid(), now = new Date();
  if (a) {
    sh.getRange(a.row, 3, 1, 4).setValues([['super', 'active', gadminHash_(salt, password), salt]]);
    sh.getRange(a.row, 16).setValue(now);
  } else {
    sh.appendRow([username, 'Super Admin', 'super', 'active', gadminHash_(salt, password), salt, '', '', '', '', now, 'setupSystem', now, 'setupSystem', '', now]);
  }
  props.deleteProperty('SUPER_ADMIN_PASSWORD');
  gadminAudit_({ username: username, name: 'Super Admin', role: 'super', province: '' }, 'super_bootstrap', 'สร้าง/ตั้งรหัสผ่าน Super Admin จาก Script Properties');
  return 'PASS: Super Admin "' + username + '" is ready (SUPER_ADMIN_PASSWORD was removed from Script Properties)';
}

/* ------------------------------ accounts ------------------------------ */
function gadminRecord_(username) {
  const sh = sheetByName_('ggh_admins');
  const rows = dataRows_(sh);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (gadminUsername_(r[0]) !== username) continue;
    return { row: i + 2, username: username, name: text_(r[1]), role: text_(r[2]), status: text_(r[3]) || 'pending', hash: String(r[4] || ''),
      salt: String(r[5] || ''), phone: normalizePhone_(r[6]), agency: text_(r[7]), province: text_(r[8]), provinceName: text_(r[9]),
      createdAt: r[10], approvedAt: r[12], approvedBy: text_(r[13]), lastLogin: r[14] };
  }
  return null;
}
function gadminProvinceCode_(code) {
  const c = String(code || '').replace(/\D/g, '').slice(0, 2);
  const p = c ? geoProvinceByCode_(c) : null;
  if (!p) throw new Error('กรุณาเลือกจังหวัด');
  return { code: c, name: p.name };
}
function gadminSessionOf_(a) {
  return { username: a.username, name: a.name, role: a.role, province: a.role === 'admin' ? a.province : '', provinceName: a.role === 'admin' ? a.provinceName : '' };
}

/** Self-registration of an Admin (province officer). Pending until a Super Admin approves. */
function adminRegisterServer(input) {
  input = input || {};
  const username = gadminUsername_(input.username);
  if (!gadminValidUsername_(username)) throw new Error('ชื่อผู้ใช้ต้องยาว 3–32 ตัว ใช้ a–z, 0–9, จุด, ขีดล่าง หรือขีดกลาง');
  const name = cleanText_(input.name, 120);
  if (!name) throw new Error('กรุณากรอกชื่อ-นามสกุล');
  const phone = normalizePhone_(input.phone);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  const agency = cleanText_(input.agency, 150);
  if (!agency) throw new Error('กรุณากรอกหน่วยงาน');
  const prov = gadminProvinceCode_(input.provinceCode || input.province);
  const password = gadminPassword_(input.password);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    ensureAdminSchema_();
    if (gadminRecord_(username)) throw new Error('ชื่อผู้ใช้นี้มีผู้ใช้แล้ว กรุณาเลือกชื่ออื่น');
    const sh = sheetByName_('ggh_admins');
    if (dataRows_(sh).some(function (r) { return normalizePhone_(r[6]) === phone && ['pending', 'active'].indexOf(text_(r[3])) >= 0; })) {
      throw new Error('หมายเลขโทรศัพท์นี้ลงทะเบียนเป็นเจ้าหน้าที่แล้ว');
    }
    const salt = Utilities.getUuid(), now = new Date();
    sh.appendRow([username, name, 'admin', 'pending', gadminHash_(salt, password), salt, phone, agency, prov.code, prov.name, now, 'register', '', '', '', now]);
    gadminAudit_({ username: username, name: name, role: 'admin', province: prov.code }, 'admin_register', 'สมัคร Admin จังหวัด' + prov.name + ' (' + agency + ')');
  } finally { lock.releaseLock(); }
  return { status: 'success', message: 'ส่งคำขอแล้ว เข้าสู่ระบบได้เมื่อ Super Admin อนุมัติ' };
}

function adminLoginServer(input) {
  input = input || {};
  const username = gadminUsername_(input.username);
  const password = String(input.password || '');
  if (!gadminValidUsername_(username) || !password) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  const cache = CacheService.getScriptCache();
  const failKey = 'gafail:' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= GADMIN_MAX_FAILS) throw new Error('ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
  ensureAdminSchema_();
  const a = gadminRecord_(username);
  if (!a || !a.hash || gadminHash_(a.salt, password) !== a.hash) {
    cache.put(failKey, String(fails + 1), GADMIN_LOCK_SECONDS);
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  cache.remove(failKey);
  if (a.status === 'pending') throw new Error('บัญชีรอ Super Admin อนุมัติ');
  if (a.status !== 'active' || GADMIN_ROLES.indexOf(a.role) < 0) throw new Error('บัญชีนี้ถูกระงับ กรุณาติดต่อ Super Admin');
  if (a.role === 'admin' && !a.province) throw new Error('บัญชีนี้ยังไม่ได้กำหนดจังหวัด กรุณาติดต่อ Super Admin');
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const s = gadminSessionOf_(a);
  cache.put('gadmin:' + token, JSON.stringify(s), GADMIN_SESSION_SECONDS);
  sheetByName_('ggh_admins').getRange(a.row, 15).setValue(new Date());
  gadminAudit_(s, 'login', 'เข้าสู่ระบบ');
  return Object.assign({ status: 'success', token: token, expiresIn: GADMIN_SESSION_SECONDS }, adminMeServer(s));
}

/** Token → session; the account is re-read every call so a suspended account stops at once. */
function requireAdminSession_(token, minRole) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('ADMIN_SESSION_EXPIRED');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('gadmin:' + token);
  if (!raw) throw new Error('ADMIN_SESSION_EXPIRED');
  const a = gadminRecord_(JSON.parse(raw).username);
  if (!a || a.status !== 'active' || GADMIN_ROLES.indexOf(a.role) < 0) { cache.remove('gadmin:' + token); throw new Error('บัญชีเจ้าหน้าที่ถูกระงับหรือถูกลบ'); }
  if (minRole === 'super' && a.role !== 'super') throw new Error('เฉพาะ Super Admin เท่านั้น');
  const s = gadminSessionOf_(a);
  cache.put('gadmin:' + token, JSON.stringify(s), GADMIN_SESSION_SECONDS);
  return s;
}

function adminMeServer(s) {
  const a = gadminRecord_(s.username) || {};
  return { status: 'success', username: s.username, name: s.name, role: s.role, roleLabel: gadminRoleLabel_(s.role), province: s.province, provinceName: s.provinceName,
    agency: a.agency || '', phone: a.phone ? displayPhone_(a.phone) : '', apiVersion: APP_VERSION };
}

function adminChangePasswordServer(input, s) {
  input = input || {};
  const a = gadminRecord_(s.username);
  if (!a || gadminHash_(a.salt, String(input.current || '')) !== a.hash) throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  const next = gadminPassword_(input.next), salt = Utilities.getUuid();
  const sh = sheetByName_('ggh_admins');
  sh.getRange(a.row, 5, 1, 2).setValues([[gadminHash_(salt, next), salt]]); sh.getRange(a.row, 16).setValue(new Date());
  gadminAudit_(s, 'password_change', 'เปลี่ยนรหัสผ่านของตนเอง');
  return { status: 'success', message: 'เปลี่ยนรหัสผ่านแล้ว' };
}

/* ------------------------------ Super Admin: accounts ------------------------------ */
function adminsList_() {
  return dataRows_(sheetByName_('ggh_admins')).map(function (r) {
    return { username: gadminUsername_(r[0]), name: text_(r[1]), role: text_(r[2]), roleLabel: gadminRoleLabel_(text_(r[2])), status: text_(r[3]) || 'pending',
      phone: displayPhone_(r[6]), agency: text_(r[7]), province: text_(r[8]), provinceName: text_(r[9]), createdAt: dateTime_(r[10]),
      approvedAt: dateTime_(r[12]), approvedBy: text_(r[13]), lastLogin: dateTime_(r[14]) };
  });
}
function gadminActiveSupers_() { return dataRows_(sheetByName_('ggh_admins')).filter(function (r) { return text_(r[2]) === 'super' && text_(r[3]) === 'active'; }).length; }

/** Approve / reject a pending Admin, or change role, status, province of any account. */
function adminSave_(input, s) {
  input = input || {};
  const a = gadminRecord_(gadminUsername_(input.username));
  if (!a) throw new Error('ไม่พบบัญชี');
  const role = input.role ? String(input.role) : a.role;
  const status = input.status ? String(input.status) : a.status;
  if (GADMIN_ROLES.indexOf(role) < 0) throw new Error('บทบาทไม่ถูกต้อง');
  if (GADMIN_STATUS.indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง');
  if (a.username === s.username && (role !== 'super' || status !== 'active')) throw new Error('ไม่สามารถเปลี่ยนบทบาทหรือระงับบัญชีของตนเองได้');
  if (a.role === 'super' && a.status === 'active' && (role !== 'super' || status !== 'active') && gadminActiveSupers_() <= 1) throw new Error('ต้องมี Super Admin ที่ใช้งานได้อย่างน้อย 1 คน');
  let prov = { code: a.province, name: a.provinceName };
  if (input.provinceCode !== undefined && input.provinceCode !== '') prov = gadminProvinceCode_(input.provinceCode);
  if (role === 'admin' && !prov.code) throw new Error('Admin ต้องมีจังหวัด');
  const sh = sheetByName_('ggh_admins'), now = new Date();
  sh.getRange(a.row, 3, 1, 2).setValues([[role, status]]);
  sh.getRange(a.row, 9, 1, 2).setValues([[role === 'admin' ? prov.code : '', role === 'admin' ? prov.name : '']]);
  if (a.status === 'pending' && status === 'active') sh.getRange(a.row, 13, 1, 2).setValues([[now, s.username]]);
  sh.getRange(a.row, 16).setValue(now);
  const what = a.status === 'pending' && status === 'active' ? 'admin_approve' : a.status === 'pending' && status === 'rejected' ? 'admin_reject' : 'admin_update';
  gadminAudit_(s, what, a.username + ' → ' + gadminRoleLabel_(role) + ' / ' + status + (role === 'admin' ? ' / จ.' + prov.name : ''));
  return { status: 'success', message: what === 'admin_approve' ? 'อนุมัติแล้ว' : what === 'admin_reject' ? 'ไม่อนุมัติแล้ว' : 'บันทึกแล้ว' };
}

function adminResetPassword_(input, s) {
  input = input || {};
  const a = gadminRecord_(gadminUsername_(input.username));
  if (!a) throw new Error('ไม่พบบัญชี');
  const pw = gadminPassword_(input.password), salt = Utilities.getUuid();
  const sh = sheetByName_('ggh_admins');
  sh.getRange(a.row, 5, 1, 2).setValues([[gadminHash_(salt, pw), salt]]); sh.getRange(a.row, 16).setValue(new Date());
  CacheService.getScriptCache().remove('gafail:' + a.username);
  gadminAudit_(s, 'password_reset', a.username);
  return { status: 'success', message: 'ตั้งรหัสผ่านใหม่แล้ว ส่งให้เจ้าของบัญชีทางช่องทางที่ปลอดภัย' };
}

/* ------------------------------ province scope ------------------------------ */
/** Admin: always the account's province. Super Admin: the asked province ('ALL' only where allowed). */
function adminScope_(s, want, allowAll) {
  if (s.role !== 'super') return s.province;
  const w = String(want || '').toUpperCase();
  if (w === 'ALL') { if (!allowAll) throw new Error('กรุณาเลือกจังหวัด'); return 'ALL'; }
  return gadminProvinceCode_(w || DEFAULT_PROVINCE_CODE).code;
}
function inScope_(scope, code) { return scope === 'ALL' || (code || DEFAULT_PROVINCE_CODE) === scope; }

/** Province picker for the page: Super Admin — all 77; Admin — their own. */
function adminProvinces_(s) {
  const list = geoProvinces_().map(function (p) { return { code: p.code, name: p.name }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return s.role === 'super' ? list : list.filter(function (p) { return p.code === s.province; });
}

/** Numbers of the province on the dashboard (no personal data). */
function adminOverview_(input, s) {
  const scope = adminScope_(s, (input || {}).province, true);
  const rep = marketReport_(scope);
  const pending = s.role === 'super' ? dataRows_(sheetByName_('ggh_admins')).filter(function (r) { return text_(r[3]) === 'pending'; }).length : 0;
  return { status: 'success', scope: rep.scope, summary: rep.summary, areas: rep.areas, materials: rep.materials, harvest: rep.harvest, listing: rep.listing, pendingAdmins: pending, generatedAt: rep.generatedAt };
}

/* ------------------------------ users / plots / buyer points ------------------------------ */
function adminUsers_(input, s) {
  input = input || {};
  const scope = adminScope_(s, input.province, false);
  const q = String(input.q || '').trim().toLowerCase();
  const counts = {};
  ['farmers', 'buyers'].forEach(function (k) {
    dataRows_(sheet_(k)).forEach(function (r) { if (String(r[11]) === 'Deleted') return; const o = normalizePhone_(r[12]) || normalizePhone_(r[4]); counts[o] = (counts[o] || 0) + 1; });
  });
  const rows = [];
  dataRows_(sheet_('users')).forEach(function (r, i) {
    const pc = text_(r[USER_GEO_COL - 1]) || DEFAULT_PROVINCE_CODE;
    if (!inScope_(scope, pc)) return;
    const phone = normalizePhone_(r[0]);
    const u = { phone: displayPhone_(phone), key: phone, name: text_(r[3]), role: normalizeRole_(r[2]), roleLabel: normalizeRole_(r[2]) === 'buyer' ? 'ผู้รับซื้อ' : 'เกษตรกร',
      province: pc, provinceName: text_(r[USER_GEO_COL]), createdAt: dateTime_(r[7]), updatedAt: dateTime_(r[8]), records: counts[phone] || 0 };
    if (q && (u.name + ' ' + phone).toLowerCase().indexOf(q.replace(/\D/g, '') || q) < 0 && u.name.toLowerCase().indexOf(q) < 0) return;
    rows.push(u);
  });
  gadminAudit_(s, 'view_users', 'ดูรายชื่อผู้ใช้ จ.' + scope + (q ? ' ค้นหา "' + cleanText_(q, 40) + '"' : '') + ' (' + rows.length + ' ราย)');
  return { status: 'success', province: scope, rows: rows.slice(0, GADMIN_LIST_MAX), total: rows.length };
}

function gadminUserRow_(phone) {
  const rows = dataRows_(sheet_('users'));
  for (let i = 0; i < rows.length; i++) if (normalizePhone_(rows[i][0]) === phone) return { index: i + 2, row: rows[i] };
  return null;
}
function gadminCheckUser_(s, phone) {
  const u = gadminUserRow_(phone);
  if (!u) throw new Error('ไม่พบผู้ใช้');
  const pc = text_(u.row[USER_GEO_COL - 1]) || DEFAULT_PROVINCE_CODE;
  if (s.role !== 'super' && pc !== s.province) throw new Error('ผู้ใช้นี้อยู่นอกจังหวัดของคุณ');
  return u;
}

/** Edit a user's name / role / province (Admin: inside the province only, cannot move users out of it). */
function adminUserSave_(input, s) {
  input = input || {};
  const phone = normalizePhone_(input.phone);
  const u = gadminCheckUser_(s, phone);
  const name = cleanText_(input.name, 150);
  if (!name) throw new Error('กรุณากรอกชื่อ');
  const role = normalizeRole_(input.role || u.row[2]);
  let prov = { code: text_(u.row[USER_GEO_COL - 1]) || DEFAULT_PROVINCE_CODE, name: text_(u.row[USER_GEO_COL]) };
  if (input.provinceCode && input.provinceCode !== prov.code) {
    if (s.role !== 'super') throw new Error('Admin ย้ายผู้ใช้ไปจังหวัดอื่นไม่ได้');
    prov = gadminProvinceCode_(input.provinceCode);
  }
  const sh = sheet_('users');
  sh.getRange(u.index, 3).setValue(role); sh.getRange(u.index, 4).setValue(name); sh.getRange(u.index, 9).setValue(new Date());
  sh.getRange(u.index, USER_GEO_COL, 1, 2).setValues([[prov.code, prov.name]]);
  gadminAudit_(s, 'user_update', displayPhone_(phone) + ' → ' + name + ' / ' + role + ' / จ.' + prov.name);
  invalidateSummary_();
  return { status: 'success', message: 'บันทึกผู้ใช้แล้ว' };
}

/** Delete a user; their plots / buyer points are marked Deleted (kept in the sheet, gone from the market). */
function adminUserDelete_(input, s) {
  input = input || {};
  const phone = normalizePhone_(input.phone);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  let n = 0;
  try {
    const u = gadminCheckUser_(s, phone);
    ['farmers', 'buyers'].forEach(function (k) {
      const sh = sheet_(k);
      dataRows_(sh).forEach(function (r, i) {
        if ((normalizePhone_(r[12]) || normalizePhone_(r[4])) !== phone || String(r[11]) === 'Deleted') return;
        sh.getRange(i + 2, 12).setValue('Deleted'); sh.getRange(i + 2, k === 'farmers' ? 18 : 16).setValue(new Date()); n++;
      });
    });
    sheet_('users').deleteRow(u.index);
  } finally { lock.releaseLock(); }
  gadminAudit_(s, 'user_delete', 'ลบผู้ใช้ ' + displayPhone_(phone) + ' และรายการ ' + n + ' รายการ');
  invalidateSummary_();
  return { status: 'success', message: 'ลบผู้ใช้แล้ว (ซ่อนแปลง/จุดรับซื้อ ' + n + ' รายการ)' };
}

const GADMIN_STATUS_SET = { farmers: ['Open', 'Closed', 'Sold', 'Deleted'], buyers: ['Active', 'Inactive', 'Deleted'] };

/** Plots for sale or buyer points of the province, with contact and exact location (logged). */
function adminRecords_(input, s) {
  input = input || {};
  const kind = input.kind === 'buyers' ? 'buyers' : 'farmers';
  const scope = adminScope_(s, input.province, false);
  const q = String(input.q || '').trim().toLowerCase();
  const showDeleted = !!input.showDeleted;
  const rule = marketHideRule_(), today = startOfDay_(new Date());
  const names = {}; dataRows_(sheet_('users')).forEach(function (r) { names[normalizePhone_(r[0])] = text_(r[3]); });
  const out = [];
  dataRows_(sheet_(kind)).forEach(function (r) {
    if (!inScope_(scope, rowProvince_(r, kind))) return;
    const status = text_(r[11]);
    if (!showDeleted && status === 'Deleted') return;
    const owner = normalizePhone_(r[12]) || normalizePhone_(r[4]);
    const loc = recordLocation_(r, kind === 'farmers' ? FARMER_GEO_COL : BUYER_GEO_COL);
    const x = kind === 'farmers' ? {
      id: text_(r[0]), owner: displayPhone_(owner), ownerName: names[owner] || [text_(r[2]), text_(r[3])].join(' ').trim(), crop: text_(r[5]),
      material: resolvedMaterial_(r[13], r[14], r[5]), harvestDate: dateInput_(r[7]), areaRai: round_(parseAreaRai_(r[8]), 2), area: text_(r[8]),
      lat: r[9], lng: r[10], status: status, listed: status.toLowerCase() === 'open' && farmerListing_(r, rule, today).listed, updatedAt: dateTime_(r[17]), location: loc
    } : {
      id: text_(r[0]), owner: displayPhone_(owner), ownerName: names[owner] || [text_(r[2]), text_(r[3])].join(' ').trim(),
      material: buyerOffers_(r).map(function (o) { return o.material; }).join(', '), offers: buyerOffers_(r),   // 4.3.0
      priceText: buyerOffers_(r).map(offerPriceText_).join(' · '),
      price: maybeNumber_(r[9]), capacity: text_(r[10]), lat: r[5], lng: r[6], status: status, updatedAt: dateTime_(r[15]), location: loc
    };
    if (q && (x.ownerName + ' ' + owner + ' ' + (x.crop || '') + ' ' + x.material + ' ' + (loc.district || '')).toLowerCase().indexOf(q) < 0) return;
    out.push(x);
  });
  gadminAudit_(s, 'view_' + kind, 'ดู' + (kind === 'farmers' ? 'แปลงประกาศขาย' : 'จุดรับซื้อ') + ' จ.' + scope + ' (' + out.length + ' รายการ)');
  return { status: 'success', kind: kind, province: scope, rows: out.slice(0, GADMIN_LIST_MAX), total: out.length, statuses: GADMIN_STATUS_SET[kind] };
}

/** Change the status of a plot / buyer point (hide, show again, mark deleted). */
function adminRecordStatus_(input, s) {
  input = input || {};
  const kind = input.kind === 'buyers' ? 'buyers' : 'farmers';
  const status = String(input.status || '');
  if (GADMIN_STATUS_SET[kind].indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง');
  const sh = sheet_(kind);
  const row = findIdRow_(sh, cleanText_(input.id, 100));
  if (!row) throw new Error('ไม่พบรายการ');
  const r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  if (s.role !== 'super' && (rowProvince_(r, kind) || DEFAULT_PROVINCE_CODE) !== s.province) throw new Error('รายการนี้อยู่นอกจังหวัดของคุณ');
  sh.getRange(row, 12).setValue(status);
  sh.getRange(row, kind === 'farmers' ? 18 : 16).setValue(new Date());
  gadminAudit_(s, 'record_status', (kind === 'farmers' ? 'แปลง ' : 'จุดรับซื้อ ') + text_(r[0]) + ': ' + text_(r[11]) + ' → ' + status);
  invalidateSummary_();
  return { status: 'success', message: 'บันทึกสถานะแล้ว' };
}

/* ------------------------------ Super Admin: market settings, log ------------------------------ */
function adminMarketRule_() { return { status: 'success', rule: marketListingInfo_(), nearRadiusKm: nearRadiusKm_(), nearMin: NEAR_KM_MIN, nearMax: NEAR_KM_MAX }; }
function adminMarketRuleSave_(input, s) {
  input = input || {};
  const days = hideDaysValid_(input.hideAfterHarvestDays);
  const near = input.nearRadiusKm === undefined ? null : nearRadiusValid_(input.nearRadiusKm);   // 4.2.0
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const before = marketHideRule_();
    const start = days > 0 && (!before.days || !before.start) ? dateInput_(new Date()) : (before.start ? dateInput_(before.start) : '');
    hideRuleWrite_(days, start);
    settingWrite_('hide_after_harvest_updated', new Date(), 'วันที่', 'แก้ไขล่าสุดโดย ' + s.username);
    if (near !== null) settingWrite_(NEAR_KM_PARAM, near, 'กม.', 'รัศมี "รวมคู่ค้าต่างจังหวัด" ของเกษตรกรและผู้รับซื้อ — Super Admin ของ Green Gain Hub ตั้งค่า');
  } finally { lock.releaseLock(); }
  invalidateSummary_();
  gadminAudit_(s, 'market_rule', 'แสดงแปลงถึง ' + days + ' วันหลังวันเก็บเกี่ยว' + (near !== null ? ' · รัศมีคู่ค้าต่างจังหวัด ' + near + ' กม.' : ''));
  return { status: 'success', rule: marketListingInfo_(), nearRadiusKm: nearRadiusKm_() };
}

function gadminAudit_(s, action, detail) {
  try {
    ensureSheet_('ggh_admin_log', GADMIN_SHEETS.ggh_admin_log)
      .appendRow([new Date(), s && s.username || '', s && s.name || '', s && s.role || '', s && s.province || '', action, cleanText_(detail, 400)]);
  } catch (err) { /* never block the action on logging */ }
}

function adminLog_(input, s) {
  input = input || {};
  const scope = adminScope_(s, input.province || 'ALL', true);
  const rows = dataRows_(sheetByName_('ggh_admin_log'));
  return { status: 'success', rows: rows.filter(function (r) { return scope === 'ALL' || text_(r[4]) === scope; }).slice(-300).reverse().map(function (r) {
    return { time: dateTime_(r[0]), username: text_(r[1]), name: text_(r[2]), role: text_(r[3]), province: text_(r[4]), action: text_(r[5]), detail: text_(r[6]) };
  }) };
}

/* ------------------------------ routing ------------------------------ */
const GADMIN_METHODS = {
  adminLoginServer: { role: null, fn: function (a) { return adminLoginServer(a[0]); } },
  adminRegisterServer: { role: null, fn: function (a) { return adminRegisterServer(a[0]); } },
  adminLogoutServer: { role: 'admin', fn: function (a, s, t) { CacheService.getScriptCache().remove('gadmin:' + t); gadminAudit_(s, 'logout', 'ออกจากระบบ'); return { status: 'success' }; } },
  adminMeServer: { role: 'admin', fn: function (a, s) { return adminMeServer(s); } },
  adminChangePasswordServer: { role: 'admin', fn: function (a, s) { return adminChangePasswordServer(a[0], s); } },
  adminProvincesServer: { role: 'admin', fn: function (a, s) { return { status: 'success', rows: adminProvinces_(s) }; } },
  adminOverviewServer: { role: 'admin', fn: function (a, s) { return adminOverview_(a[0], s); } },
  adminUsersServer: { role: 'admin', fn: function (a, s) { return adminUsers_(a[0], s); } },
  adminUserSaveServer: { role: 'admin', fn: function (a, s) { return adminUserSave_(a[0], s); } },
  adminUserDeleteServer: { role: 'admin', fn: function (a, s) { return adminUserDelete_(a[0], s); } },
  adminRecordsServer: { role: 'admin', fn: function (a, s) { return adminRecords_(a[0], s); } },
  adminRecordStatusServer: { role: 'admin', fn: function (a, s) { return adminRecordStatus_(a[0], s); } },
  reportCatalogServer: { role: 'admin', fn: function (a, s) { return reportCatalog_(s); } },
  reportDataServer: { role: 'admin', fn: function (a, s) { return reportData_(a[0], s); } },
  adminsListServer: { role: 'super', fn: function () { return { status: 'success', rows: adminsList_() }; } },
  adminSaveServer: { role: 'super', fn: function (a, s) { return adminSave_(a[0], s); } },
  adminResetPasswordServer: { role: 'super', fn: function (a, s) { return adminResetPassword_(a[0], s); } },
  adminLogServer: { role: 'super', fn: function (a, s) { return adminLog_(a[0], s); } },
  marketRuleServer: { role: 'super', fn: function () { return adminMarketRule_(); } },
  marketRuleSaveServer: { role: 'super', fn: function (a, s) { return adminMarketRuleSave_(a[0], s); } }
};

function adminDispatch_(body) {
  const def = GADMIN_METHODS[String(body.method || '')];
  if (!def) throw new Error('Method not allowed');
  const args = Array.isArray(body.args) ? body.args : [];
  const s = def.role ? requireAdminSession_(body.token, def.role) : null;
  return def.fn(args, s, String(body.token || ''));
}
