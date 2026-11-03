const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
const parser = require('../frontend/assets/crop-import.js');

function assert(value, message) { if (!value) throw new Error(message); }

const farmers = new Sheet('farmers', [HEADERS.farmers,
  ['f1', '', 'สมชาย', 'ใจดี', '0841157666', 'ข้าวนาปี', '', '2026-11-20', '20 ไร่ 1 งาน 25 ตร.ว.', 16.073426, 99.891172, 'Open', '0841157666', 'ฟางข้าว', ''],
  ['f2', '', 'ลบ', 'แล้ว', '0811111111', 'ข้าวนาปี', '', '', '5 ไร่', 16.07, 99.89, 'Deleted', '0811111111', 'ฟางข้าว', '']]);
const buyers = new Sheet('buyers', [HEADERS.buyers,
  ['b1', '', 'ศูนย์อัดฟาง', 'ขาณุ', '0625419987', 16.075923, 99.885041, 'ฟางข้าว', 'แห้ง', 30, '45', 'Active', '0625419987', 'ฟางข้าว', '']]);
const config = new Sheet('Config', [HEADERS.Config, ['visit_count', 1, 'ครั้ง', 'จำนวนครั้งที่มีการเข้าใช้งานเว็บไซต์']]);
const env = load({ sheets: { farmers, buyers, Config: config }, props: { SUPER_ADMIN_USERNAME: 'krit', SUPER_ADMIN_PASSWORD: '0812345678' } });
const { post, get, sheets } = env;
const ok = (r, m) => { assert(r.ok, m + ': ' + r.error); return r.result; };
console.log = () => {};

const setup = env.api.setupSystem();
assert(/PASS: visit_stats sheet/.test(setup), 'setupSystem must prepare visit_stats');

/* ---------- counter ---------- */
let v = get({ api: 'v1', endpoint: 'hit' });
assert(v.ok && v.data.today === 1 && v.data.month === 1 && v.data.total === 2, 'first hit must count once and add to the existing Config total (1 → 2): ' + JSON.stringify(v.data));
get({ api: 'v1', endpoint: 'hit' }); get({ api: 'v1', endpoint: 'hit' });
v = get({ api: 'v1', endpoint: 'visits' });
assert(v.data.today === 3 && v.data.total === 4, 'visits endpoint must read without counting: ' + JSON.stringify(v.data));
assert(sheets.visit_stats.rows.length === 2 && sheets.visit_stats.rows[1][1] === 3, 'one row per day in visit_stats');
assert(sheets.Config.rows.find((r) => r[0] === 'visit_count')[1] === 4, 'Config visit_count must hold the running total');
const jsonp = get({ api: 'v1', endpoint: 'visits', callback: 'cb' });
assert(typeof jsonp === 'string' && jsonp.startsWith('cb('), 'counter must support JSONP');
// Yesterday's row stays separate.
sheets.visit_stats.rows.splice(1, 0, ['2026-01-15', 7, '']);
assert(get({ api: 'v1', endpoint: 'hit' }).data.today === 4, 'today must not include other days');

/* ---------- import data to report on ---------- */
const T = ok(post('adminLoginServer', [{ username: 'krit', password: '0812345678' }]), 'super login').token;
ok(post('adminSaveServer', [{ username: 'admin1', name: 'Admin 1', role: 'admin', password: 'admin-pass-1' }], T), 'create admin');
const A = ok(post('adminLoginServer', [{ username: 'admin1', password: 'admin-pass-1' }]), 'admin login').token;
const sample = parser.parse(require('./fixtures/rice-naphi-2569-70-harvest.json'));
ok(post('cropImportCommitServer', [{ crop: 'ข้าวนาปี', season: '2569/70', monthType: 'harvest', fileName: 'rice.xlsx', rows: sample.rows }], A), 'import');

/* ---------- catalog / roles ---------- */
const catA = ok(post('reportCatalogServer', [], A), 'catalog admin');
const flat = (c) => Object.fromEntries(c.groups.flatMap((g) => g.sections.map((s) => [s.key, s.allowed])));
assert(flat(catA)['market.plots'] === false && flat(catA)['audit.log'] === false && flat(catA)['crops.districts'] === true, 'admin catalog must disable contact and audit-log sections');
assert(catA.crops.length === 1 && catA.crops[0].key === 'ข้าวนาปี|2569/70', 'catalog must list imported crops');
const catS = ok(post('reportCatalogServer', [], T), 'catalog super');
assert(Object.values(flat(catS)).every(Boolean), 'super must see every section');
assert(post('reportCatalogServer', [], 'f'.repeat(64)).error === 'ADMIN_SESSION_EXPIRED', 'reports require login');

assert(/เฉพาะ Super Admin/.test(post('reportDataServer', [{ sections: ['market.plots'] }], A).error), 'admin must not get contact lists');
assert(/เฉพาะ Super Admin/.test(post('reportDataServer', [{ sections: ['audit.log'] }], A).error), 'admin must not get the audit log');
assert(/อย่างน้อย 1/.test(post('reportDataServer', [{ sections: [] }], A).error), 'empty selection must be rejected');
assert(/ไม่รู้จัก/.test(post('reportDataServer', [{ sections: ['x.y'] }], A).error), 'unknown section must be rejected');

/* ---------- crop report numbers ---------- */
const rep = ok(post('reportDataServer', [{ sections: ['crops.summary', 'crops.monthly', 'crops.districts', 'crops.subdistricts'], cropKey: 'ข้าวนาปี|2569/70', asOf: 202610 }], A), 'crop report');
const sec = (r, k) => r.sections.find((x) => x.key === k);
const sum = sec(rep, 'crops.summary').rows;
assert(sum[0].value === 1177773.92 && Math.abs(sum[1].value - 912774.35) < 0.01 && Math.abs(sum[3].value - 264999.57) < 0.01, 'summary numbers wrong: ' + JSON.stringify(sum.slice(0, 4)));
const monthly = sec(rep, 'crops.monthly');
assert(monthly.rows.length === 8 && monthly.rows[7].remaining === 0 && monthly.totals.area === 1177773.92, 'monthly table wrong');
const dist = sec(rep, 'crops.districts');
assert(dist.rows.length === 11 && Math.abs(dist.totals.total - 1177773.92) < 0.05 && Math.abs(dist.totals.harvested - 912774.35) < 0.05, 'district totals must reconcile with the province');
const sub = sec(rep, 'crops.subdistricts');
assert(sub.rows.length === 78 && Math.abs(sub.rows.reduce((a, r) => a + r.total, 0) - 1177773.92) < 1, 'sub-district rows must reconcile within source rounding: ' + sub.rows.length + ' ' + sub.rows.reduce((a, r) => a + r.total, 0) + ' ' + JSON.stringify(sub.rows.slice(0, 2)));
const repSep = ok(post('reportDataServer', [{ sections: ['crops.summary'], cropKey: 'ข้าวนาปี|2569/70', asOf: 202609 }], A), 'as-of');
assert(Math.abs(repSep.sections[0].rows[1].value - (7333.8 + 181556.68 + 497828.54)) < 0.01, 'as-of month must change harvested-to-date');

/* ---------- market contacts: masked by default ---------- */
const m1 = ok(post('reportDataServer', [{ sections: ['market.plots', 'market.buyers', 'market.districts'] }], T), 'market masked');
const plots = sec(m1, 'market.plots').rows;
assert(plots.length === 1 && plots[0].phone === '084-xxx-7666' && plots[0].district === 'ขาณุวรลักษบุรี' && plots[0].areaRai === 20.31, 'plots must be Open only, district-mapped, masked: ' + JSON.stringify(plots));
assert(sec(m1, 'market.buyers').rows[0].phone === '062-xxx-9987' && m1.phonesMasked, 'buyers must be masked by default');
assert(!JSON.stringify(m1).includes('0841157666'), 'masked report must not contain the full phone anywhere');
const m2 = ok(post('reportDataServer', [{ sections: ['market.plots'], unmaskPhones: true }], T), 'market unmasked');
assert(sec(m2, 'market.plots').rows[0].phone === '084-115-7666' && !m2.phonesMasked, 'super may unmask phones on request');
const m3 = ok(post('reportDataServer', [{ sections: ['market.districts'], unmaskPhones: true }], A), 'admin unmask ignored');
assert(m3.phonesMasked, 'unmask flag from an admin must be ignored');

/* ---------- visits + audit sections ---------- */
const vis = ok(post('reportDataServer', [{ sections: ['visits.monthly', 'visits.daily', 'audit.imports'] }], A), 'visits');
assert(sec(vis, 'visits.daily').rows.length === 2 && sec(vis, 'visits.monthly').rows.length === 2 && sec(vis, 'visits.monthly').totals.visits === 5, 'visit report wrong: ' + JSON.stringify(sec(vis, 'visits.monthly')));
assert(sec(vis, 'audit.imports').rows[0].crop === 'ข้าวนาปี', 'import history section wrong');

/* ---------- smart agri unavailable is reported, not thrown ---------- */
const sa = ok(post('reportDataServer', [{ sections: ['reports.status'] }], A), 'smart agri down');
assert(/ยังดึงข้อมูล/.test(sa.sections[0].rows[0].message), 'unavailable Smart Agri must produce a note row');

/* ---------- audit trail ---------- */
ok(post('reportExportLogServer', [{ format: 'xlsx', sections: ['market.plots'], unmaskPhones: true }], T), 'export log');
const log = ok(post('adminLogServer', [], T), 'log');
assert(log.some((l) => l.action === 'report_view' && /market\.plots/.test(l.detail) && /เบอร์เต็ม/.test(l.detail)), 'unmasked contact report must be audited');
assert(log.some((l) => l.action === 'report_export' && /^xlsx:/.test(l.detail)), 'export format must be audited');

/* ---------- public endpoints carry no report data ---------- */
const pub = JSON.stringify(get({ api: 'v1', endpoint: 'summary' }));
assert(!pub.includes('สมชาย') && !pub.includes('0841157666'), 'public summary must stay aggregate-only');

process.stdout.write('PASS: visit counter (session hits, daily rows, Config total) and admin reports (roles, masking, reconciled totals, audit)\n');
