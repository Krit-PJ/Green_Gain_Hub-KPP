/* 4.0.0: GGH officers — Super Admin from Script Properties, Admin self-registration + approval, province scope,
   users / plots / buyer points management with audit, reports (every district, facts vs estimates), market rule. */
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };
const day = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x; };
const F = (id, owner, crop, area, lat, lng) => [id, '', 'ชื่อ' + id, '', owner, crop, '', day(2), area, lat, lng, 'Open', owner, '', '', '', '', ''];
const B = (id, owner, mat, lat, lng) => [id, '', 'ร้าน' + id, '', owner, lat, lng, mat, '', 500, '10', 'Active', owner, mat, '', '', 'ALL'];
const env = load({
  sheets: {
    Config: new Sheet('Config', [HEADERS.Config]),
    users: new Sheet('users', [HEADERS.users,
      ['0810000001', '', 'farmer', 'เกษตรกร กพ', false, true, '', new Date(2026, 10, 1), ''],
      ['0810000002', '', 'farmer', 'เกษตรกร เชียงใหม่', false, true, '', new Date(2026, 10, 2), ''],
      ['0820000001', '', 'buyer', 'โรงอัดฟาง กพ', false, true, '', new Date(2026, 9, 5), '']]),
    farmers: new Sheet('farmers', [HEADERS.farmers,
      F('k1', '0810000001', 'ข้าวนาปี', '20 ไร่', 16.4828, 99.5227),
      F('k2', '0810000001', 'ข้าวนาปรัง', '10 ไร่', 16.0743, 99.8720),
      F('c1', '0810000002', 'ข้าวนาปี', '15 ไร่', 18.7883, 98.9853)]),
    buyers: new Sheet('buyers', [HEADERS.buyers, B('kb', '0820000001', 'ฟางข้าว', 16.4700, 99.5300)])
  },
  props: { SUPER_ADMIN_USERNAME: 'krit', SUPER_ADMIN_PASSWORD: 'Super12345' }
});
const { get, sheets, props, api } = env;
const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const post = (method, arg, token) => { api.doPost({ postData: { contents: JSON.stringify({ method, args: arg === undefined ? [] : [arg], token: token || '' }) } }); return JSON.parse(env.out().body); };
const bad = (r, re, m) => { n++; assert(!r.ok && re.test(r.error), m + ': ' + JSON.stringify(r).slice(0, 200)); };

/* Super Admin from Script Properties; the plain password is removed */
const out = quiet(() => api.setupSystem());
check(/Super Admin "krit" is ready/.test(out) && !props.SUPER_ADMIN_PASSWORD, 'Super Admin bootstrapped, password property deleted');
check(sheets.ggh_admins && sheets.ggh_admin_log && !sheets.admins, 'own sheets ggh_admins / ggh_admin_log (old "admins" untouched)');
check(!JSON.stringify(sheets.ggh_admins.rows).includes('Super12345'), 'password stored as a hash only');
const T = post('adminLoginServer', { username: 'krit', password: 'Super12345' }).result.token;
check(/^[0-9a-f]{64}$/.test(T), 'Super Admin signs in');

/* Admin registers → pending → approved by Super Admin */
const reg = { username: 'somchai.kpp', name: 'สมชาย ใจดี', phone: '089-123-4567', agency: 'สำนักงานเกษตรจังหวัดกำแพงเพชร', provinceCode: '62', password: 'Admin12345' };
bad(post('adminRegisterServer', Object.assign({}, reg, { password: 'short' })), /8–128/, 'short password refused');
bad(post('adminRegisterServer', Object.assign({}, reg, { provinceCode: '' })), /จังหวัด/, 'province required');
check(post('adminRegisterServer', reg).ok, 'Admin registered');
bad(post('adminRegisterServer', reg), /มีผู้ใช้แล้ว/, 'username taken');
bad(post('adminLoginServer', { username: 'somchai.kpp', password: 'Admin12345' }), /รอ Super Admin อนุมัติ/, 'pending cannot sign in');
check(post('adminsListServer', undefined, T).result.rows.find((a) => a.username === 'somchai.kpp').status === 'pending', 'Super sees the request');
check(post('adminOverviewServer', { province: '62' }, T).result.pendingAdmins === 1, 'overview counts pending requests');
{ const ov = post('adminOverviewServer', { province: '62' }, T).result; check(Array.isArray(ov.harvest) && Array.isArray(ov.materials), '4.2.0 overview returns harvest + materials for the charts'); }
{ const fs = require('fs'), path = require('path'); const fe = (f) => fs.readFileSync(path.join(__dirname, '..', 'frontend', f), 'utf8');
  const h = fe('admin.html'), j = fe('assets/admin.js');
  check(/name="nearKm" min="10" max="100"/.test(h) && /nearRadiusKm: Number\(e\.target\.nearKm\.value\)/.test(j), '4.2.0 settings form sends the partner radius');
  check(h.includes('id="adHarvestChart"') && h.includes('id="adMaterialChart"') && j.includes('function drawHarvest') && j.includes('function chartTip'), '4.2.0 dashboard charts with tooltips');
  check((h.match(/class="ad-nav-group"/g) || []).length === 3 && h.includes('data-filters="farmers"') && h.includes('admin.js?v=4.2.0'), '4.2.0 grouped menu, filter pills, asset version'); }
check(post('adminSaveServer', { username: 'somchai.kpp', status: 'active' }, T).ok, 'approved');
const A = post('adminLoginServer', { username: 'somchai.kpp', password: 'Admin12345' }).result;
check(A.token && A.role === 'admin' && A.province === '62' && A.provinceName === 'กำแพงเพชร', 'Admin signs in, province 62');
check(sheets.ggh_admins.rows.find((r) => r[0] === 'somchai.kpp')[13] === 'krit', 'who approved is kept');

/* Super-only methods */
bad(post('adminsListServer', undefined, A.token), /เฉพาะ Super Admin/, 'Admin cannot list officers');
bad(post('marketRuleSaveServer', { hideAfterHarvestDays: 10 }, A.token), /เฉพาะ Super Admin/, 'Admin cannot change the market rule');
bad(post('adminLogServer', {}, A.token), /เฉพาะ Super Admin/, 'Admin cannot read the officers log');
bad(post('adminSaveServer', { username: 'krit', status: 'disabled' }, T), /ของตนเอง/, 'Super cannot suspend self');

/* province scope: users */
let r = post('adminUsersServer', { province: '50' }, A.token).result;
check(r.province === '62' && r.rows.length === 2 && r.rows.every((u) => u.province === '62'), 'Admin sees own province only, whatever is asked');
check(r.rows.find((u) => u.key === '0810000001').records === 2 && r.rows.find((u) => u.key === '0810000001').phone === '0810000001', 'records counted, phone shown');
check(post('adminUsersServer', { province: '50' }, T).result.rows.length === 1, 'Super chooses any province');
check(post('adminUsersServer', { province: 'ALL' }, A.token).result.province === '62', 'Admin asking ALL still gets own province');
bad(post('adminUserSaveServer', { phone: '0810000002', name: 'แก้ชื่อ' }, A.token), /นอกจังหวัด/, 'Admin cannot edit a user of another province');
bad(post('adminUserSaveServer', { phone: '0810000001', name: 'x', provinceCode: '50' }, A.token), /ย้ายผู้ใช้/, 'Admin cannot move a user out');
check(post('adminUserSaveServer', { phone: '0810000001', name: 'สมใจ ปลูกข้าว', role: 'farmer' }, A.token).ok && sheets.users.rows[1][3] === 'สมใจ ปลูกข้าว', 'Admin edits a user of own province');

/* plots / buyer points */
r = post('adminRecordsServer', { kind: 'farmers' }, A.token).result;
check(r.rows.length === 2 && r.rows.every((x) => x.location.province === 'กำแพงเพชร') && r.rows[0].owner && r.rows[0].lat, 'Admin: own province plots with contact and location');
check(post('adminRecordsServer', { kind: 'buyers' }, A.token).result.rows.length === 1, 'buyer points');
bad(post('adminRecordStatusServer', { kind: 'farmers', id: 'c1', status: 'Closed' }, A.token), /นอกจังหวัด/, 'Admin cannot change a plot of another province');
bad(post('adminRecordStatusServer', { kind: 'farmers', id: 'k1', status: 'Weird' }, A.token), /สถานะ/, 'unknown status refused');
check(post('adminRecordStatusServer', { kind: 'farmers', id: 'k2', status: 'Closed' }, A.token).ok && sheets.farmers.rows[2][11] === 'Closed', 'Admin hides a plot');
check(get({ api: 'v1', endpoint: 'market', refresh: '1' }).data.totals.plots === 1, 'hidden plot leaves the market');

/* reports: every district of the province, facts apart from estimates, map values */
const cat = post('reportCatalogServer', undefined, A.token).result;
check(!cat.allProvinces && !cat.sections.some((x) => x.key === 'audit') && cat.types.length === 4, 'Admin catalog: no audit, no all-provinces');
r = post('reportDataServer', { sections: ['summary', 'areas', 'materials', 'harvest', 'sales', 'registrations', 'audit'], province: '50' }, A.token).result;
check(r.scope.code === '62' && r.sections.length === 6 && !r.sections.some((x) => x.key === 'audit'), 'Admin report: own province, audit dropped');
const areas = r.sections.find((x) => x.key === 'areas');
check(areas.rows.length === 11 && areas.rows.filter((x) => x.plots).length === 1 && areas.totals.area === 20, 'every district of Kamphaeng Phet (11), zeros included');
check(r.sections[0].rows.find((x) => /ชีวมวล/.test(x.item)).kind === 'ประมาณการ' && r.sections[0].notes.some((x) => /ไม่เก็บต้นทุน/.test(x)), 'estimates labelled; costs not collected');
check(r.map.province === '62' && r.map.values.length === 11, 'map values for every district');
check(!JSON.stringify(r).match(/081-?000-?000[12]|0820000001/), 'no phone numbers in reports');
check(r.sections.find((x) => x.key === 'registrations').totals.total === 2, 'registrations of the province');
r = post('reportDataServer', { sections: ['registrations'], from: '2026-11-01', to: '2026-11-30' }, A.token).result;
check(r.sections[0].totals.total === 1 && r.period.from === '2026-11-01', 'period filters registrations');
bad(post('reportDataServer', { sections: ['summary'], from: '2026-12-01', to: '2026-11-01' }, A.token), /ไม่เกิน/, 'from after to refused');
r = post('reportDataServer', { sections: ['summary', 'areas', 'audit'], province: 'ALL' }, T).result;
check(r.scope.code === 'ALL' && r.sections[1].columns[1].label === 'จังหวัด' && r.sections[2].rows.length > 5, 'Super: all provinces by province + audit');

/* audit trail */
const log = post('adminLogServer', { province: 'ALL' }, T).result.rows.map((x) => x.action);
['login', 'admin_register', 'admin_approve', 'view_users', 'user_update', 'view_farmers', 'record_status', 'report_view'].forEach((a) => check(log.includes(a), 'logged: ' + a));
check(post('adminLogServer', { province: '62' }, T).result.rows.every((x) => x.province === '62'), 'log by province');

/* account safety */
for (let i = 0; i < 5; i++) post('adminLoginServer', { username: 'somchai.kpp', password: 'wrong-pass' });
bad(post('adminLoginServer', { username: 'somchai.kpp', password: 'Admin12345' }), /รอ 15 นาที/, 'locked after 5 wrong passwords');
env.cache.delete('gafail:somchai.kpp');
check(post('adminChangePasswordServer', { current: 'Admin12345', next: 'Admin67890' }, A.token).ok, 'change own password');
check(post('adminSaveServer', { username: 'somchai.kpp', status: 'disabled' }, T).ok, 'Super suspends the Admin');
bad(post('adminMeServer', undefined, A.token), /ถูกระงับ/, 'a suspended account stops at once');
check(post('adminResetPasswordServer', { username: 'somchai.kpp', password: 'Reset12345' }, T).ok, 'Super resets a password');

/* user delete: user row removed, their plots marked Deleted */
check(post('adminUserDeleteServer', { phone: '0810000002' }, T).ok && !sheets.users.rows.some((x) => x[0] === '0810000002') && sheets.farmers.rows[3][11] === 'Deleted', 'Super deletes a user, plots hidden');

console.log('PASS: ' + n + ' checks — 4.0.0/4.2.0 GGH officers (Super/Admin, province scope, management, reports, audit)');
