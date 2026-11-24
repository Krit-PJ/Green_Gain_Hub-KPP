/* 3.2.0 executive report for ABM: key required, one province by district or all by province, facts vs estimates, no personal data. */
const crypto = require('crypto');
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };
const day = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x; };
const F = (id, owner, crop, area, lat, lng, h) => [id, '', 'ชื่อ' + id, 'นามสกุล', owner, crop, '', day(h), area, lat, lng, 'Open', owner, '', '', '', '', ''];
const B = (id, owner, mat, price, cap, lat, lng) => [id, '', 'ร้าน' + id, '', owner, lat, lng, mat, '', price, cap, 'Active', owner, mat, '', '', 'ALL'];
const env = load({ sheets: {
  Config: new Sheet('Config', [HEADERS.Config]),
  users: new Sheet('users', [HEADERS.users, ['0810000001', '', 'farmer', 'ก', false, true, '', '', ''], ['0810000002', '', 'farmer', 'ข', false, true, '', '', ''], ['0820000001', '', 'buyer', 'ร้าน', false, true, '', '', '']]),
  farmers: new Sheet('farmers', [HEADERS.farmers,
    F('k1', '0810000001', 'ข้าวนาปี', '20 ไร่', 16.4828, 99.5227, -2), F('k2', '0810000001', 'ข้าวนาปรัง', '10 ไร่', 16.07, 99.87, 40),
    F('k3', '0810000002', 'อ้อยโรงงาน', '30 ไร่', 16.48, 99.53, 10), F('c1', '0819000001', 'ข้าวนาปี', '15 ไร่', 18.79, 98.98, 5)]),
  buyers: new Sheet('buyers', [HEADERS.buyers, B('b1', '0820000001', 'ฟางข้าว', 600, '30', 16.47, 99.53), B('b2', '0820000002', 'ฟางข้าว', 400, '10 ตัน/วัน', 16.2, 99.6), B('cb', '0829000001', 'ฟางข้าว', 550, '20', 18.8, 99.0)])
} });
const { api, sheets } = env;
const key = crypto.randomBytes(32).toString('hex');
sheets.Config.rows.push(['abm_feed_key_sha256', crypto.createHash('sha256').update(key).digest('hex'), 'sha256', 'ABM']);
const post = (body) => { const l = console.log; console.log = () => {}; try { api.doPost({ postData: { contents: JSON.stringify(body) } }); } finally { console.log = l; } return JSON.parse(env.out().body); };

check(!post({ action: 'abm_report', key: 'x'.repeat(64) }).ok, 'needs the ABM key');
check(!post({ action: 'abm_report', key, province: '99' }).ok, 'unknown province refused');
let r = post({ action: 'abm_report', key, province: '62' });
check(r.ok && r.data.scope.name === 'กำแพงเพชร' && r.data.scope.by === 'district', 'one province, by district');
const s = r.data.summary;
check(s.plots === 3 && s.farmers === 2 && s.areaRai === 60 && s.buyers === 2 && s.usersFarmers === 2 && s.usersBuyers === 1, 'facts: plots, distinct sellers, area, buyers, registered users');
check(s.ton > 0 && s.potentialBaht === (20 + 10) * 500, 'estimates: biomass, possible value = rice area × average rice offer (500) — sugarcane has no offer');
check(r.data.areas.some((a) => a.name === 'เมืองกำแพงเพชร' && a.plots === 2) && r.data.areas.every((a) => !/^\d+$/.test(a.name)), 'district rows by name');
check(r.data.materials.find((m) => m.code === 'rice').avgPriceBahtPerRai === 500, 'average offer per material');
check(r.data.harvest.some((h) => h.month === 'done') && r.data.harvest.length >= 2, 'harvest by month (done / coming months)');
check(r.data.notes.costs && /ประมาณการ/.test(r.data.notes.estimates), 'report says what is estimated and that costs are not collected');

/* a real sale shows up as a fact */
sheets.sales = new Sheet('sales', [['ID', 'Sold_At', 'Plot_ID', 'Owner_Telephone', 'Crop', 'Material', 'Area_Rai', 'Quantity_Ton', 'Amount_Baht', 'Buyer_Name', 'Province_Code', 'Province', 'District_Code', 'District', 'Created_At'],
  ['s1', new Date('2026-11-20'), 'k9', '0810000001', 'ข้าวนาปี', 'ฟางข้าว', 12, 9, 5400, 'โรงงาน X', '62', 'กำแพงเพชร', '6201', 'เมืองกำแพงเพชร', new Date()]]);
r = post({ action: 'abm_report', key, province: '62' });
check(r.data.summary.salesCount === 1 && r.data.summary.salesBaht === 5400 && r.data.summary.salesTon === 9 && r.data.sales[0].bahtPerTon === 600, 'sales: count, baht, tonnes, baht/ton');
const body = JSON.stringify(r.data);
check(!/ชื่อk|นามสกุล|ร้านb|081000|082000|โรงงาน X|16\.4828/.test(body), 'no names, phones, buyer names or coordinates');

/* all provinces, by province */
r = post({ action: 'abm_report', key, province: 'ALL' });
check(r.data.scope.by === 'province' && r.data.summary.plots === 4 && r.data.summary.provincesActive === 2 && r.data.areas.map((a) => a.name).sort().join(',') === 'กำแพงเพชร,เชียงใหม่', 'all provinces');
check(r.data.areas.find((a) => a.name === 'เชียงใหม่').potentialBaht === 15 * 550, 'each province uses its own buyers\' offers');
console.log('PASS: ' + n + ' checks — 3.2.0 executive report (province / all, facts vs estimates, sales, privacy)');
