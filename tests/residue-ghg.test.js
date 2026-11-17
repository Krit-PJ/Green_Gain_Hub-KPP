const { load, Sheet, HEADERS } = require('./helpers/gas-mock');

function assert(value, message) { if (!value) throw new Error(message); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const config = new Sheet('Config', [HEADERS.Config, ['visit_count', 1, 'ครั้ง', '']]);
// A 1.7.0 "admin" (province importer, no district) must become Mini Super Admin on setup.
const admins = new Sheet('admins', [['Username', 'Name', 'Role', 'Status', 'Pass_Hash', 'Salt', 'Created_At', 'Created_By', 'Last_Login', 'Updated_At', 'Telephone'],
  ['old.importer', 'ผู้นำเข้าเดิม', 'admin', 'active', 'x', 'y', '', '', '', '', '']]);
const env = load({ sheets: { Config: config, admins }, props: { SUPER_ADMIN_USERNAME: 'krit', SUPER_ADMIN_PASSWORD: 'Super12345' },
  expose: ['ghgCalculate_', 'ghgDefaultCropObjects_', 'fiscalYearOf_'] });
const { post, get, sheets, drive, api } = env;
const ok = (r, m) => { assert(r.ok, m + ': ' + r.error); return r.result; };
console.log = () => {};

/* ---------- setup ---------- */
const setup = api.setupSystem();
assert(/PASS: ghg_params \(AR5, EF 94\.15 gCO2e\/kg\) and ghg_crops are ready; central price 0\.8 baht\/kg \(set 1\)(?:; 2\.2\.0 migration[^;]*)?; validation (\d+)\/\1 PASS/.test(setup), 'GHG schema + validation suite must pass in setupSystem:\n' + setup);
assert(/targets 2570 seeded \(70500 rai\)/.test(setup) && /photo folder/.test(setup), 'targets and photo folder must be prepared:\n' + setup);
assert(/became Mini Super Admin: old\.importer/.test(setup) && sheets.admins.rows[1][2] === 'mini', 'admin without district must migrate to mini');
assert(sheets.residue_methods.rows.length === 7 && sheets.residue_methods.rows.map((r) => r[0]).slice(1).join('|') === 'ไถกลบ|อัดฟางก้อน|อัดใบอ้อย|ทำปุ๋ยหมัก|เพาะเห็ด|อื่น ๆ', 'default methods');
assert(sheets.residue_targets.rows.length === 12, 'one target row per district');
assert(sheets.Config.rows.some((r) => r[0] === 'province_name' && r[1] === 'กำแพงเพชร'), 'province name config');
const again = api.setupSystem();
assert(sheets.residue_targets.rows.length === 12 && sheets.ghg_crops.rows.length === 7 && !/seeded/.test(again), 'setupSystem must be idempotent');

/* ---------- engine: prompt §10 validation, run for real ---------- */
const T = ok(post('adminLoginServer', [{ username: 'krit', password: 'Super12345' }]), 'super login').token;
const suite = ok(post('ghgValidationServer', [], T), 'validation suite');
assert(suite.passed === suite.total && suite.total === 20, 'all validation cases must pass: ' + JSON.stringify(suite.cases.filter((c) => !c.pass)));
const crops = api.ghgDefaultCropObjects_();
const P = { EF_CH4: 2.7, EF_N2O: 0.07, GWP_CH4: 28, GWP_N2O: 265, GWP_SET: 'AR5', HA_TO_RAI: 6.25, DEFAULT_MODE: 'standard' };
const tc1 = api.ghgCalculate_([{ crop: 'rice', area: 100 }, { crop: 'maize', area: 100 }, { crop: 'sugarcane', area: 100 }], crops, P);
assert(tc1.ok && near(tc1.totals.ghg, 33.1408) && near(tc1.totals.btotal, 352000) && near(tc1.totals.ch4, 0.9504) && near(tc1.totals.n2o, 0.02464), 'TC1 totals');
assert(tc1.items[0].biomassBefore === null && tc1.items[0].cf === null, 'standard mode must leave Biomass Before Burning and Cf as N/A');
const eq6 = api.ghgCalculate_([{ crop: 'rice', area: 37, mode: 'custom', mb: 950, cf: 0.8, reference: 'field' }], crops, P);
assert(near(eq6.items[0].lfire, 37 * 950 * 0.00007532), 'Equation 6 (Cf 0.80): L_fire = A × MB × 0.00007532');
const fresh = api.ghgCalculate_([{ crop: 'rice', area: 10, mode: 'custom', fresh: 2000, dmf: 0.55, cf: 0.8, reference: 'field' }], crops, P);
assert(fresh.ok && near(fresh.items[0].biomassBefore, 1100), 'fresh weight must be converted with the dry-matter fraction');
assert(!api.ghgCalculate_([{ crop: 'rice', area: 10, mode: 'custom', fresh: 2000, cf: 0.8, reference: 'f' }], crops, P).ok, 'fresh weight without DMF must be rejected');
assert(!api.ghgCalculate_([{ crop: 'cassava', area: 10, mode: 'custom', mb: 500, cf: 0.8 }], crops, P).ok, 'custom crop without reference must be rejected');
assert(/ผสม/.test((() => { try { api.ghgCalculate_([{ crop: 'rice', area: 1 }], crops, { ...P, GWP_N2O: 273 }); } catch (e) { return e.message; } return ''; })()), 'mixing AR5 label with AR6 values must be rejected');

/* ---------- accounts ---------- */
ok(post('adminSaveServer', [{ username: 'mini1', name: 'มินิ หนึ่ง', role: 'mini', password: 'Mini12345' }], T), 'mini');
ok(post('adminSaveServer', [{ username: 'rec.khanu', name: 'นวส. ขาณุ ก', role: 'admin', district: '6204', password: 'Rec123456' }], T), 'rec 1');
ok(post('adminSaveServer', [{ username: 'rec.khanu2', name: 'นวส. ขาณุ ข', role: 'admin', district: '6204', password: 'Rec123456' }], T), 'rec 2');
const M = ok(post('adminLoginServer', [{ username: 'mini1', password: 'Mini12345' }]), 'mini login').token;
const D = ok(post('adminLoginServer', [{ username: 'rec.khanu', password: 'Rec123456' }]), 'rec login').token;
const D2 = ok(post('adminLoginServer', [{ username: 'rec.khanu2', password: 'Rec123456' }]), 'rec2 login').token;

const meta = ok(post('residueMetaServer', [], D), 'meta');
assert(meta.district === '6204' && meta.districts.length === 1 && meta.subdistricts.length === 11 && meta.subdistricts.every((t) => t.district === '6204'), 'district admin meta must be scoped');
assert(meta.methods.length === 6 && meta.crops.some((c) => c.key === 'cassava' && !c.hasStandard) && meta.crops.find((c) => c.key === 'rice').consumedKgRai === 880, 'meta crops/methods');
assert(ok(post('residueMetaServer', [], M), 'meta mini').subdistricts.length === 78, 'mini sees all 78 sub-districts');

/* ---------- recording ---------- */
const photo = { name: 'a.jpg', mime: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==' };
const rec = { date: '2026-11-10', subdistrict: '620403', crop: 'rice', method: 'อัดฟางก้อน', area: 25, lat: 16.07, lng: 99.89, photos: [photo], confirmed: true };
const err = (input, token, re, m) => { const r = post('residueSaveServer', [input], token || D); assert(!r.ok && re.test(r.error), m + ': ' + r.error); };
err({ ...rec, photos: [] }, D, /ภาพถ่าย/, 'photo is required');
err({ ...rec, confirmed: false }, D, /ยืนยัน/, 'recorder must confirm');
err({ ...rec, subdistrict: '620101' }, D, /ตำบลในอำเภอขาณุ/, 'sub-district must be in the own district');
err({ ...rec, method: 'อัดใบอ้อย' }, D, /อ้อย/, 'sugarcane-leaf baling only for sugarcane');
err({ ...rec, date: '2099-01-01' }, D, /ไม่เกินวันนี้/, 'future date rejected');
err({ ...rec, area: -3 }, D, /มากกว่า 0/, 'negative area rejected');
err({ ...rec, lat: 13.7, lng: 100.5 }, D, /นอกจังหวัด/, 'coordinates outside the province rejected');
err({ ...rec, method: 'อื่น ๆ' }, D, /ระบุวิธี/, 'other method needs detail');
err({ ...rec, custom: { mb: 900, cf: 1.4, reference: 'x' } }, D, /Combustion Factor/, 'custom Cf out of range rejected');

const s1 = ok(post('residueSaveServer', [{ ...rec, district: '6201' }], D), 'save 1');
assert(s1.record.district === '6204' && s1.record.recordedBy === 'rec.khanu' && s1.record.recorderName === 'นวส. ขาณุ ก' && s1.record.fy === 2570, 'district forced from the account, recorder from login');
assert(near(s1.record.ghg, 25 * 880 * 94.15 / 1e6, 1e-4) && s1.record.tonnes === 18.75 && s1.record.dataStatus === 'Estimated', 'record GHG (standard) and tonnes (0.75 t/rai): ' + JSON.stringify(s1.record));
const fileIds = Object.keys(drive.files);
assert(fileIds.length === 1 && drive.files[fileIds[0]].blob.name.startsWith(s1.id) && drive.files[fileIds[0]].folder === drive.folders[env.props.RESIDUE_PHOTO_FOLDER_ID].id, 'photo stored in the private photo folder');
const ph = ok(post('residuePhotoServer', [{ id: s1.id, index: 0 }], D), 'photo');
assert(ph.mime === 'image/jpeg' && ph.data === '/9j/4AAQSkZJRgABAQ==', 'photo round trip');
const s2 = ok(post('residueSaveServer', [{ ...rec, crop: 'sugarcane', method: 'อัดใบอ้อย', area: 40, subdistrict: '620404', lat: 16.43, lng: 99.5 }], D2), 'save 2');
assert(s2.warnings.some((w) => /พิกัดอยู่ในอำเภอเมืองกำแพงเพชร/.test(w)), 'GPS in another district must warn: ' + JSON.stringify(s2.warnings));
const s3 = ok(post('residueSaveServer', [{ ...rec, crop: 'cassava', method: 'ไถกลบ', area: 10, lat: '', lng: '' }], D), 'cassava');
assert(s3.record.ghg === null && /ไม่มีค่ามาตรฐาน/.test(s3.record.ghgNote), 'cassava without standard value must not get a GHG number');
const s4 = ok(post('residueSaveServer', [{ ...rec, crop: 'cassava', method: 'ทำปุ๋ยหมัก', area: 10, custom: { mb: 500, cf: 0.8, reference: 'แปลงทดลอง สนง.' } }], D), 'cassava custom');
assert(near(s4.record.ghg, 10 * 500 * 0.8 * 94.15 / 1e6, 1e-6) && s4.record.dataStatus === 'Measured' && s4.record.tonnes === 5, 'custom biomass record is computed and Measured');
const sM = ok(post('residueSaveServer', [{ ...rec, district: '6201', subdistrict: '620101', crop: 'maize', method: 'ไถกลบ', area: 100, lat: '', lng: '' }], M), 'mini save Mueang');
assert(sM.record.district === '6201' && near(sM.record.ghg, 15.064, 1e-6), 'mini may record any district');

/* ---------- scope & edit rights ---------- */
const listD = ok(post('residueListServer', [{ district: '6201' }], D), 'list D');
assert(listD.records.length === 4 && listD.records.every((r) => r.district === '6204'), 'district admin must only see the own district');
assert(listD.records.find((r) => r.id === s2.id).canEdit === false && listD.records.find((r) => r.id === s1.id).canEdit === true, 'admin edits only own records');
assert(/ไม่มีสิทธิ์/.test(post('residueSaveServer', [{ ...rec, id: s2.id }], D).error), 'admin cannot edit another recorder record');
assert(/ไม่มีสิทธิ์/.test(post('residueDeleteServer', [{ id: sM.id }], D).error), 'admin cannot delete another district record');
assert(/ไม่มีสิทธิ์/.test(post('residuePhotoServer', [{ id: sM.id }], D).error), 'admin cannot open photos of another district');
assert(ok(post('residueListServer', [{}], M), 'list M').records.length === 5, 'mini sees all districts');
const e1 = ok(post('residueSaveServer', [{ ...rec, id: s1.id, area: 30, photos: [], keepPhotos: [0, 0, 5] }], D), 'edit own');
assert(e1.record.area === 30 && e1.record.photoCount === 1 && e1.id === s1.id, 'edit keeps photos and id');

/* ---------- public endpoint ---------- */
let pub = get({ api: 'v1', endpoint: 'residue', fy: '2570' });
assert(pub.ok && pub.apiVersion === '2.2.1', 'residue endpoint');
let t = pub.data.totals;
const ghgRice = 30 * 880 * 94.15 / 1e6, ghgCane = 40 * 1040 * 94.15 / 1e6, ghgCass = 10 * 500 * 0.8 * 94.15 / 1e6, ghgMaize = 15.064;
assert(t.records === 5 && t.areaRai === 190 && near(t.ghg, ghgRice + ghgCane + ghgCass + ghgMaize, 1e-3) && t.excludedRai === 10, 'public totals: ' + JSON.stringify(t));
assert(near(t.ch4e + t.n2oe, t.ghg, 1e-3), 'GHG total = CH4 CO2e + N2O CO2e');
assert(pub.data.targets.total === 70500 && pub.data.targets.byDistrict['6204'].total === 10500 && pub.data.targets.byDistrict['6204'].officers === 7, 'targets in the public summary');
assert(pub.data.cells.filter((c) => c.d === '6204').length === 4 && pub.data.params.gwpSet === 'AR5' && pub.data.province === 'กำแพงเพชร', 'cells by district/crop/method');
const body = JSON.stringify(pub);
['นวส. ขาณุ', 'rec.khanu', s1.id, '16.07', '99.89', fileIds[0], 'แปลงทดลอง'].forEach((secret) => assert(!body.includes(secret), 'public residue data leaked: ' + secret));

/* ---------- parameters (Mini Super Admin) ---------- */
assert(/Mini Super Admin/.test(post('ghgParamsSaveServer', [{ GWP_SET: 'AR6' }], D).error), 'district admin cannot change parameters');
assert(/อ้างอิง/.test(post('ghgParamsSaveServer', [{ GWP_SET: 'CUSTOM', GWP_CH4: 30, GWP_N2O: 300, REF_GWP: '' }], M).error), 'custom GWP set needs a reference');
const ar6 = ok(post('ghgParamsSaveServer', [{ GWP_SET: 'AR6', GWP_CH4: 999 }], M), 'AR6');
assert(ar6.settings.params.GWP_CH4 === 27 && ar6.settings.params.GWP_N2O === 273 && ar6.settings.params.PARAM_VERSION === 2 && /AR6/.test(ar6.settings.params.REF_GWP), 'preset carries its own values (no mixing) and bumps the version');
pub = get({ api: 'v1', endpoint: 'residue', fy: '2570' });
const ef6 = 2.7 * 27 + 0.07 * 273;
assert(near(pub.data.totals.ghg, (30 * 880 + 40 * 1040 + 10 * 500 * 0.8 + 100 * 1600) * ef6 / 1e6, 1e-3) && pub.data.params.gwpSet === 'AR6', 'cache invalidated and totals recomputed with ONE parameter set');
ok(post('ghgParamsSaveServer', [{ GWP_SET: 'AR5', DEFAULT_MODE: 'residue' }], M), 'residue mode');
pub = get({ api: 'v1', endpoint: 'residue', fy: '2570' });
assert(near(pub.data.totals.ghg, (30 * 750 * 0.8 + 40 * 230 * 0.8 + 10 * 500 * 0.8 + 100 * 830 * 0.8) * 94.15 / 1e6, 1e-3), 'residue mode uses residue t/rai × Cf');
ok(post('ghgParamsSaveServer', [{ DEFAULT_MODE: 'standard' }], M), 'back to standard');
assert(/อ้างอิง/.test(post('ghgCropSaveServer', [{ key: 'cassava', name: 'มันสำปะหลัง', consumedTHa: 3 }], M).error), 'a new standard value needs a reference');
ok(post('ghgCropSaveServer', [{ key: 'cassava', name: 'มันสำปะหลัง', consumedTHa: 3, cf: 0.8, reference: 'งานวิจัยทดสอบ', active: true, sortOrder: 4 }], M), 'cassava standard');
pub = get({ api: 'v1', endpoint: 'residue', fy: '2570' });
assert(pub.data.totals.excludedRai === 0 && near(pub.data.totals.ghg, (30 * 880 + 40 * 1040 + 10 * 480 + 10 * 400 + 100 * 1600) * 94.15 / 1e6, 1e-3), 'cassava counts once a referenced value exists');

/* ---------- targets ---------- */
assert(/Mini Super Admin/.test(post('residueTargetsSaveServer', [{ fy: 2570, rows: [] }], D).error), 'district admin cannot edit targets');
const tg = ok(post('residueTargetsSaveServer', [{ fy: 2570, rows: [{ district: '6204', total: 10500, officers: 7, byMethod: { 'อัดฟางก้อน': 4000 } }, { district: '6201', total: 12000, officers: 8 }] }], M), 'targets save');
assert(tg.targets.total === 22500 && tg.targets.byMethod['อัดฟางก้อน'] === 4000 && sheets.residue_targets.rows.filter((r) => r[0] === 2570).length === 3, 'targets replaced for the fiscal year: ' + JSON.stringify(tg.targets));
ok(post('residueTargetsSaveServer', [{ fy: 2570, rows: [[6201, 8, 12000], [6202, 4, 6000], [6203, 4, 6000], [6204, 7, 10500], [6205, 4, 6000], [6206, 5, 7500], [6207, 4, 6000], [6208, 2, 3000], [6209, 2, 3000], [6210, 4, 6000], [6211, 3, 4500]]
  .map(([d, o, t]) => ({ district: String(d), officers: o, total: t, byMethod: d === 6204 ? { 'อัดฟางก้อน': 4000 } : {} })) }], M), 'restore targets');

/* ---------- reports ---------- */
const sec = (r, k) => r.sections.find((x) => x.key === k);
const rd = ok(post('reportDataServer', [{ sections: ['residue.summary', 'residue.subdistricts', 'residue.admins', 'residue.methods', 'residue.records'], fy: 2570, district: '6201' }], D), 'district report');
assert(rd.residue.district === '6204' && sec(rd, 'residue.records').rows.length === 4, 'district report is limited to the own district');
const sub = sec(rd, 'residue.subdistricts').rows;
assert(sub.length === 4 && sub.some((r) => r.name === 'ยางสูง' && r.method === 'อัดฟางก้อน' && r.area === 30 && r.tonnes === 22.5), 'tambon × type rows: ' + JSON.stringify(sub));
const adm = sec(rd, 'residue.admins').rows;
const a1 = adm.find((r) => r.username === 'rec.khanu');
assert(adm.length === 2 && a1.personal === 1500 && a1.area === 50 && a1.pct === 3.3 && a1.share === 0.5, 'per-admin target = 10500 / 7 officers: ' + JSON.stringify(adm));
const mt = sec(rd, 'residue.methods');
assert(mt.rows.find((r) => r.method === 'อัดฟางก้อน').target === 4000 && mt.totals.target === 10500 && mt.totals.pct === round1(90 / 10500 * 100), 'method targets: ' + JSON.stringify(mt.totals));
function round1(x) { return Math.round(x * 10) / 10; }
const rp = ok(post('reportDataServer', [{ sections: ['residue.summary', 'residue.map', 'residue.districts', 'residue.crops', 'residue.ghgcrops', 'residue.params'], fy: 2570 }], M), 'province report');
assert(rp.residue.district === '' && Object.keys(sec(rp, 'residue.map').map.values).length === 11, 'province map has 11 districts');
assert(sec(rp, 'residue.districts').totals.target === 70500 && sec(rp, 'residue.districts').totals.area === 190, 'province district table');
const cr = sec(rp, 'residue.ghgcrops');
assert(near(sec(rp, 'residue.crops').totals.lfire, cr.totals.lfire, 1e-6) && sec(rp, 'residue.crops').columns.length === 6, 'simple crop table reconciles with the GHG appendix');
assert(near(cr.totals.lfire, cr.totals.ch4e + cr.totals.n2oe, 1e-3) && cr.rows.length === 4, 'crop GHG table: ' + JSON.stringify(cr.totals));
assert(sec(rp, 'residue.params').rows.some((r) => /EF_CO2e/.test(r.item) && r.value === 94.15), 'params section lists the combined EF with sources');

/* ---------- delete ---------- */
ok(post('residueDeleteServer', [{ id: s1.id }], D), 'delete own');
pub = get({ api: 'v1', endpoint: 'residue', fy: '2570' });
assert(pub.data.totals.records === 4 && pub.data.totals.areaRai === 160, 'deleted record must leave the totals');
assert(sheets.residue_records.rows.length === 6, 'soft delete keeps the row');
const log = ok(post('adminLogServer', [], T), 'log');
['residue_create', 'residue_update', 'residue_delete', 'ghg_params_save', 'ghg_crop_save', 'residue_targets_save'].forEach((a) => assert(log.some((l) => l.action === a), 'audit missing ' + a));
assert(api.fiscalYearOf_('2026-09-30') === 2569 && api.fiscalYearOf_('2026-10-01') === 2570, 'fiscal year boundary');

process.stdout.write('PASS: GHG engine (TC1–TC5, Eq.6, fresh→dry, no GWP mixing), residue records (validation, photos, district scope, edit rights), targets, public residue summary, district/province reports, audit\n');
