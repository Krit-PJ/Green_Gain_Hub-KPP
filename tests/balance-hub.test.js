const { load, Sheet, HEADERS } = require('./helpers/gas-mock');

function assert(value, message) { if (!value) throw new Error(message); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const env = load({ sheets: { Config: new Sheet('Config', [HEADERS.Config]) }, props: { SUPER_ADMIN_USERNAME: 'krit', SUPER_ADMIN_PASSWORD: 'Super12345' }, expose: ['districtList_', 'districtForPoint_'] });
const { post, get, sheets, api } = env;
const ok = (r, m) => { assert(r.ok, m + ': ' + r.error); return r.result; };
const bad = (r, re, m) => assert(!r.ok && re.test(r.error), m + ': ' + JSON.stringify(r));
console.log = () => {};
api.setupSystem();

/* A point inside a district, found from the boundary data itself. */
function pointIn(code) {
  const ds = api.districtList_();
  for (let lat = 15.6; lat < 17.2; lat += 0.02) for (let lng = 98.9; lng < 100.3; lng += 0.02) {
    const d = api.districtForPoint_(lat, lng, ds);
    if (d && d.code === code) return [Number(lat.toFixed(4)), Number(lng.toFixed(4))];
  }
  throw new Error('no point in ' + code);
}
const khanu = pointIn('6204');
const mueang = pointIn('6201');

/* ① registry: rice harvested in FY 2570 (Oct 2026 – Sep 2027) and one month outside it */
sheets.crop_imports.rows.push(['IMP1', 'ข้าวนาปี', '2569/70', 'harvest', 'rice.xlsx', 4, 1300, '202609-202611', 'active', new Date(), 'test', '', '']);
sheets.crop_stats.rows.push(
  ['IMP1', 'ข้าวนาปี', '2569/70', 'harvest', '202610', 'district', '62-04', 'ขาณุวรลักษบุรี', 10, 10, 800],
  ['IMP1', 'ข้าวนาปี', '2569/70', 'harvest', '202611', 'district', '62-04', 'ขาณุวรลักษบุรี', 5, 5, 200],
  ['IMP1', 'ข้าวนาปี', '2569/70', 'harvest', '202609', 'district', '62-04', 'ขาณุวรลักษบุรี', 5, 5, 300],
  ['IMP1', 'ข้าวนาปี', '2569/70', 'harvest', '202611', 'district', '62-01', 'เมืองกำแพงเพชร', 5, 5, 100]);

/* ③ marketplace: two open rice plots in Khanu (one harvested in the FY), one sugarcane plot in Mueang */
sheets.farmers.rows.push(
  ['F1', new Date(), 'สมศรี', 'ขายฟาง', '0811111111', 'ข้าวนาปี', '2026-08-01', '2026-11-20', '30', khanu[0], khanu[1], 'Open', '0811111111', 'ฟางข้าว', '', '', '', ''],
  ['F2', new Date(), 'สมหมาย', 'ขายฟาง', '0811111112', 'ข้าวนาปี', '2027-07-01', '2027-11-20', '50', khanu[0], khanu[1], 'Open', '0811111112', 'ฟางข้าว', '', '', '', ''],
  ['F3', new Date(), 'มานะ', 'อ้อย', '0811111113', 'อ้อยโรงงาน', '2026-03-01', '2027-01-15', '12', mueang[0], mueang[1], 'Open', '0811111113', 'ใบอ้อย', '', '', '', '']);
/* ④ one rice-straw buyer in Mueang only */
sheets.buyers.rows.push(['B1', new Date(), 'โรงอัดฟาง', 'เมือง', '0862222222', mueang[0], mueang[1], 'ฟางข้าว', 'ดี', 500, '15 ตัน/วัน', 'Active', '0862222222', 'ฟางข้าว', '', new Date(), 'ALL']);

/* ⑤ officer records */
const T = ok(post('adminLoginServer', [{ username: 'krit', password: 'Super12345' }]), 'super').token;
const D = ok(post('staffRegisterServer', [{ name: 'สมชาย ใจดี', phone: '0812345678', officeType: 'district', district: '6204', province: 'กำแพงเพชร' }]), 'district officer');
const photo = [{ name: 'a.jpg', mime: 'image/jpeg', data: '/9j/4AAQ' }];
const base = { date: '2026-11-10', photos: photo, confirmed: true };
ok(post('residueSaveServer', [{ ...base, subdistrict: '620403', crop: 'rice', method: 'ไถกลบ', area: 100 }], D.token), 'plough 100');
ok(post('residueSaveServer', [{ ...base, subdistrict: '620404', crop: 'rice', method: 'อัดฟางก้อน', area: 20, buyerId: 'B1', soldTonnes: 12 }], D.token), 'baling 20 sold to B1');

/* balance (Admin API, own district only) */
const b = ok(post('residueBalanceServer', [{ fy: 2570, district: '6201' }], D.token), 'balance for district officer');
assert(b.district === '6204' && b.rows.every((r) => r.district === '6204'), 'district officer gets the own district only');
const rice = b.rows.find((r) => r.crop === 'rice');
assert(rice.harvestedRai === 1000, '① harvested rai counts months inside the fiscal year only: ' + rice.harvestedRai);
assert(near(rice.potentialTon, 750) && near(rice.removableTon, 337.5), '① 1,000 × 0.75 t, ② × 45%: ' + JSON.stringify(rice));
assert(rice.listedPlots === 1 && rice.listedRai === 30 && near(rice.listedTon, 22.5), '③ open plots harvested in the FY only');
assert(rice.buyers === 0 && rice.flags.includes('need_buyer'), '④ no rice buyer in Khanu → flagged');
assert(rice.managedRai === 120 && rice.linkedRai === 20 && rice.soldTon === 12 && near(rice.managedTon, 90), '⑤ officer records only: ' + JSON.stringify(rice));
assert(rice.atRiskRai === 880 && near(rice.managedPct, 12) && rice.flags.includes('low_managed'), '⑥ 1,000 − 120 rai at risk, 12% managed');
assert(b.months.length === 12 && b.months[0].month === 202610 && b.months.find((m) => m.month === 202610).harvestedRai === 800 && b.months.find((m) => m.month === 202611).managedRai === 120, 'harvest calendar by fiscal month');

/* province view (Super): Mueang has a buyer and a cane listing */
const all = ok(post('residueBalanceServer', [{ fy: 2570 }], T), 'province balance');
const mr = all.rows.find((r) => r.district === '6201' && r.crop === 'rice');
const mc = all.rows.find((r) => r.district === '6201' && r.crop === 'sugarcane');
assert(mr.buyers === 1 && mr.capacityTonPerDay === 15 && mr.harvestedRai === 100 && mr.managedRai === 0 && mr.atRiskRai === 100, 'Mueang rice: buyer, nothing managed yet');
assert(mc.listedRai === 12 && mc.buyers === 0 && mc.flags.includes('need_buyer'), 'sugarcane listing without a cane buyer');
assert(all.totals.harvestedRai === 1100 && all.totals.managedRai === 120 && near(all.totals.linkedPct, 16.7, 0.05), 'province totals');
assert(all.byDistrict.length === 11 && all.byDistrict.find((d) => d.district === '6204').flags.includes('need_buyer'), 'per-district flags');

/* public endpoint: aggregate only */
const pub = get({ api: 'v1', endpoint: 'balance', fy: '2570' });
assert(pub.ok && pub.data.totals.harvestedRai === 1100 && pub.data.rows.length >= 3, 'public balance route');
const pj = JSON.stringify(pub);
['0811111111', '0862222222', 'สมศรี', 'โรงอัดฟาง', String(khanu[0]), 'สมชาย'].forEach((x) => assert(!pj.includes(x), 'public balance leaked: ' + x));

/* caches are cleared when a record changes */
ok(post('residueSaveServer', [{ ...base, subdistrict: '620405', crop: 'rice', method: 'ไถกลบ', area: 30 }], D.token), 'one more record');
assert(ok(post('residueBalanceServer', [{ fy: 2570 }], D.token), 'balance again').totals.managedRai === 150, 'balance is recomputed after a save');

/* report types */
const cat = ok(post('reportCatalogServer', [], D.token), 'catalog (Admin)');
assert(cat.types.map((t) => t.key).join(',') === 'district,ghg,register', 'Admin sees district, GHG appendix, register: ' + cat.types.map((t) => t.key));
const catM = ok(post('reportCatalogServer', [], T), 'catalog (Super)');
assert(catM.types.map((t) => t.key).join(',') === 'district,province,ghg,register' && catM.types.every((t) => t.sections.length >= 1 && t.sections.length <= 6), 'four report types with at most 6 sections each');
const allowed = new Set(catM.groups.flatMap((g) => g.sections.map((x) => x.key)));
assert(catM.types.every((t) => t.sections.every((k) => allowed.has(k))), 'every type section exists');
const rp = ok(post('reportDataServer', [{ sections: catM.types.find((t) => t.key === 'district').sections, fy: 2570, district: '6204' }], T), 'district report type');
assert(rp.sections.length === 5 && rp.sections.every((x) => x.columns.length <= 11), 'district report fits A4 (≤ 11 columns per table)');
assert(!JSON.stringify(rp).includes('tCO2e'), 'reports use the Thai unit');
assert(JSON.stringify(rp).includes('ตันคาร์บอนไดออกไซด์เทียบเท่า'), 'Thai unit present');

/* wrong login box hints */
api.doGet({ parameter: { action: 'rpc', method: 'loginServer', args: JSON.stringify([{ username: '0812345678' }]) } });
const lr = JSON.parse(env.out().body);
assert(!lr.ok && /STAFF_ACCOUNT/.test(lr.error), 'officer number in the farmer box: ' + JSON.stringify(lr));
sheets.users.rows.push(['0899998888', '', 'farmer', 'ชาวนา ทดสอบ', false, true, new Date(), new Date(), new Date()]);
bad(post('staffLoginServer', [{ phone: '0899998888' }]), /MARKET_ACCOUNT/, 'farmer number in the officer box');

/* 2.2.1: farmers and buyers are signed in right after registering */
api.doGet({ parameter: { action: 'rpc', method: 'registerServer', args: JSON.stringify([{ role: 'buyer', name: 'โรงงาน ทดสอบ', phone: '0877776666' }]) } });
const rg = JSON.parse(env.out().body);
assert(rg.ok && rg.result.token && rg.result.role === 'buyer', 'register returns a session: ' + JSON.stringify(rg));
api.doGet({ parameter: { action: 'rpc', method: 'getUserProfileServer', args: '[]', token: rg.result.token } });
assert(JSON.parse(env.out().body).ok, 'the new session works at once');

process.stdout.write('PASS: residue balance ①–⑥ (fiscal months, removable share, listings, buyers, officer records only, flags, scope, cache), public balance privacy, four report types, Thai units, wrong-login hints, sign-in after registration\n');
