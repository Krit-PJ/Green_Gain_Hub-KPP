const { load, Sheet, HEADERS } = require('./helpers/gas-mock');

function assert(value, message) { if (!value) throw new Error(message); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const env = load({ sheets: { Config: new Sheet('Config', [HEADERS.Config]) }, props: { SUPER_ADMIN_USERNAME: 'krit', SUPER_ADMIN_PASSWORD: 'Super12345' } });
const { post, get, sheets, api } = env;
const ok = (r, m) => { assert(r.ok, m + ': ' + r.error); return r.result; };
const bad = (r, re, m) => assert(!r.ok && re.test(r.error), m + ': ' + JSON.stringify(r));
console.log = () => {};
api.setupSystem();

/* ---------- defaults ---------- */
assert(sheets.ghg_crops.rows.slice(1).every((r) => r[12] === 10 && /10 บาท/.test(r[13])), 'every crop starts at 10 baht/kg');
const cv = Object.fromEntries(sheets.residue_methods.rows.slice(1).map((r) => [r[0], r[6]]));
assert(cv['ไถกลบ'] === false && cv['อัดฟางก้อน'] === true && cv['เพาะเห็ด'] === true, 'ploughing-in does not count value by default');
const T = ok(post('adminLoginServer', [{ username: 'krit', password: 'Super12345' }]), 'super').token;

/* ---------- registration ---------- */
const meta = ok(post('staffMetaServer', []), 'meta (public)');
assert(meta.provinces.length === 77 && meta.province === 'กำแพงเพชร' && meta.groups.length === 4 && meta.districts.length === 11, 'registration meta');
const reg = { name: 'สมชาย ใจดี', phone: '0812345678', officeType: 'district', district: '6204', province: 'กำแพงเพชร' };
bad(post('staffRegisterServer', [{ ...reg, name: 'สมชาย' }]), /นามสกุล/, 'surname required');
bad(post('staffRegisterServer', [{ ...reg, phone: '12345' }]), /10 หลัก/, 'phone format');
bad(post('staffRegisterServer', [{ ...reg, province: 'ตาก' }]), /เฉพาะจังหวัดกำแพงเพชร/, 'other provinces are not open yet');
bad(post('staffRegisterServer', [{ ...reg, province: 'ไม่มีจริง' }]), /จากรายการ/, 'province must be from the list');
bad(post('staffRegisterServer', [{ ...reg, district: '' }]), /อำเภอ/, 'district office needs a district');
bad(post('staffRegisterServer', [{ ...reg, phone: '0899999999', officeType: 'province', district: '' }]), /กลุ่ม/, 'provincial office needs a group');
const D = ok(post('staffRegisterServer', [reg]), 'register district officer');
assert(D.token && D.role === 'admin' && D.scope === 'district' && D.district === '6204' && D.officeLabel === 'สำนักงานเกษตรอำเภอขาณุวรลักษบุรี', 'registered and signed in at once: ' + JSON.stringify(D));
bad(post('staffRegisterServer', [reg]), /ลงทะเบียนแล้ว/, 'one account per phone');
const P = ok(post('staffRegisterServer', [{ name: 'วิไล อารักขา', phone: '0898887777', officeType: 'province', group: 'กลุ่มอารักขาพืช', province: 'จังหวัดกำแพงเพชร' }]), 'register provincial officer');
assert(P.scope === 'province' && P.district === '' && /สำนักงานเกษตรจังหวัดกำแพงเพชร \(กลุ่มอารักขาพืช\)/.test(P.officeLabel), 'provincial officer scope: ' + JSON.stringify(P));

/* ---------- phone sign-in ---------- */
const L = ok(post('staffLoginServer', [{ phone: '081-234-5678' }]), 'phone login');
assert(L.token && L.username === 'p0812345678' && L.district === '6204', 'phone-only sign-in');
bad(post('staffLoginServer', [{ phone: '0811111111' }]), /ลงทะเบียน/, 'unknown phone');
ok(post('adminSaveServer', [{ username: 'mini1', name: 'มินิ', role: 'mini', phone: '0855555555', password: 'Mini12345' }], T), 'mini with phone');
bad(post('staffLoginServer', [{ phone: '0855555555' }]), /ชื่อผู้ใช้และรหัสผ่าน/, 'mini/super cannot sign in by phone');
bad(post('adminSaveServer', [{ username: 'other', name: 'x y', role: 'admin', district: '6201', phone: '0812345678', password: 'Other1234' }], T), /ใช้กับบัญชีอื่น/, 'phone must stay unique');
const list = ok(post('adminsListServer', [], T), 'admins');
const rd = list.find((a) => a.username === 'p0812345678');
assert(rd.registeredVia === 'self' && rd.officeType === 'district' && rd.role === 'admin', 'self-registered account listed');
assert(post('ghgSettingsServer', [], L.token).error.includes('Mini Super Admin'), 'self-registered account is Admin only');

/* ---------- value ---------- */
const photo = [{ name: 'a.jpg', mime: 'image/jpeg', data: '/9j/4AAQ' }];
const base = { date: '2026-11-10', photos: photo, confirmed: true };
const r1 = ok(post('residueSaveServer', [{ ...base, subdistrict: '620403', crop: 'rice', method: 'อัดฟางก้อน', area: 25 }], L.token), 'rice baling').record;
assert(r1.tonnes === 18.75 && r1.value === 187500 && r1.valueCounted, 'value = 18.75 t × 1,000 × 10 baht: ' + JSON.stringify(r1));
const r2 = ok(post('residueSaveServer', [{ ...base, subdistrict: '620404', crop: 'rice', method: 'ไถกลบ', area: 10 }], L.token), 'rice plough').record;
assert(r2.value === 0 && r2.valueCounted === false, 'ploughing-in adds no value');
const r3 = ok(post('residueSaveServer', [{ ...base, district: '6201', subdistrict: '620101', crop: 'sugarcane', method: 'อัดใบอ้อย', area: 40 }], P.token), 'provincial officer records Mueang').record;
assert(r3.district === '6201' && near(r3.value, 92000), 'provincial officer may record any district; cane 40 × 0.23 t × 10,000');
bad(post('residueSaveServer', [{ ...base, district: '6201', subdistrict: '620101', crop: 'rice', method: 'ไถกลบ', area: 1 }], L.token), /ตำบลในอำเภอขาณุ/, 'district officer stays in the own district');
assert(ok(post('residueListServer', [{}], L.token), 'list D').records.every((x) => x.district === '6204'), 'district officer sees only the own district');
const listP = ok(post('residueListServer', [{}], P.token), 'list P').records;
assert(listP.length === 3 && listP.find((x) => x.id === r1.id).canEdit === false && listP.find((x) => x.id === r3.id).canEdit === true, 'provincial officer sees all, edits only own records');
bad(post('residueDeleteServer', [{ id: r1.id }], P.token), /ไม่มีสิทธิ์/, 'provincial officer cannot delete others');
let pub = get({ api: 'v1', endpoint: 'residue', fy: '2570' });
assert(near(pub.data.totals.value, 187500 + 92000) && pub.data.crops.every((c) => c.priceBahtKg === 10) && pub.data.methods.find((m) => m.method === 'ไถกลบ').countValue === false, 'public value totals');
assert(!JSON.stringify(pub).includes('0812345678') && !JSON.stringify(pub).includes('สมชาย'), 'public data stays anonymous');

const M = ok(post('adminLoginServer', [{ username: 'mini1', password: 'Mini12345' }]), 'mini').token;
bad(post('ghgCropSaveServer', [{ key: 'rice', name: 'ข้าว', consumedTHa: 5.5, cf: 0.8, reference: 'IPCC', residueTRai: 0.75, residueReference: 'สกว.', priceBahtKg: 2 }], M), /แหล่งที่มา/, 'price needs a source');
ok(post('ghgCropSaveServer', [{ key: 'rice', name: 'ข้าว', consumedTHa: 5.5, cf: 0.8, reference: 'IPCC', residueTRai: 0.75, residueReference: 'สกว.', priceBahtKg: 2, priceReference: 'ราคาฟางอัดก้อนในพื้นที่', active: true, sortOrder: 1 }], M), 'rice price 2');
ok(post('ghgCropSaveServer', [{ key: 'maize', name: 'ข้าวโพด', consumedTHa: 10, cf: 0.8, reference: 'IPCC', residueTRai: 0.83, residueReference: 'สกว.', active: true, sortOrder: 3 }], M), 'save without price');
assert(sheets.ghg_crops.rows.find((r) => r[0] === 'maize')[12] === 10, 'saving without a price keeps the old price');
ok(post('residueMethodSaveServer', [{ method: 'ไถกลบ', cropKey: '', needsDetail: false, active: true, sortOrder: 1, countValue: true }], M), 'count ploughing');
pub = get({ api: 'v1', endpoint: 'residue', fy: '2570' });
assert(near(pub.data.totals.value, 18.75 * 2000 + 7.5 * 2000 + 92000), 'value recomputed with the new price and switch: ' + pub.data.totals.value);
const rep = ok(post('reportDataServer', [{ sections: ['residue.summary', 'residue.crops', 'residue.methods', 'residue.params'], fy: 2570 }], M), 'report');
assert(rep.sections.find((x) => x.key === 'residue.summary').rows.some((r) => /มูลค่า/.test(r.item) && near(r.value, pub.data.totals.value, 0.01)), 'summary has value');
assert(near(rep.sections.find((x) => x.key === 'residue.crops').totals.value, pub.data.totals.value, 0.01), 'crop table value reconciles');
assert(rep.sections.find((x) => x.key === 'residue.params').rows.some((r) => /ข้าว: ราคาเศษวัสดุ/.test(r.item) && r.value === 2), 'params lists prices with sources');

/* ---------- disable at once ---------- */
ok(post('adminSaveServer', [{ username: 'p0812345678', name: 'สมชาย ใจดี', role: 'admin', status: 'disabled', district: '6204', phone: '0812345678' }], T), 'disable');
bad(post('staffLoginServer', [{ phone: '0812345678' }]), /ระงับ/, 'disabled officer cannot sign in');
bad(post('residueListServer', [{}], L.token), /ระงับ|ADMIN_SESSION_EXPIRED/, 'existing session of a disabled officer stops working');
const log = ok(post('adminLogServer', [], T), 'log');
assert(log.some((l) => l.action === 'staff_register') && log.some((l) => l.action === 'login' && /หมายเลขโทรศัพท์/.test(l.detail)), 'registration and phone sign-in are audited');

process.stdout.write('PASS: officer self-registration + phone sign-in (scope, uniqueness, Admin-only, disable), residue value (10 baht/kg default, per-crop price, count-value switch, reports)\n');
