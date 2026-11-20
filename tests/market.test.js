/* 2.5.0–2.7.0 public matching map (endpoint=market): grid aggregation, material groups, privacy, cache invalidation. */
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };

const env = load({ sheets: { Config: new Sheet('Config', [HEADERS.Config]) }, props: { SUPER_ADMIN_USERNAME: 'krit', SUPER_ADMIN_PASSWORD: 'Super12345' } });
const { get, sheets, api } = env;
const log = console.log; console.log = () => {};
api.setupSystem();
console.log = log;

const day = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x; };
const F = (id, crop, harvest, area, lat, lng, status, matType, matOther) =>
  [id, '', 'ชื่อ' + id, 'สกุล', '0811111' + id.slice(-3), crop, '', harvest, area, lat, lng, status || 'Open', '0811111' + id.slice(-3), matType || '', matOther || ''];
const B = (id, lat, lng, matType, price, cap, status, after, matOther) => {
  const r = [id, '', 'ร้าน' + id, '', '0822222' + id.slice(-3), lat, lng, matType, '', price, cap, status || 'Active', '0822222' + id.slice(-3), matType, matOther || '', '', after === undefined ? '' : after];
  return r;
};
sheets.farmers.rows.push(
  F('f001', 'ข้าวนาปี', day(-3), '20 ไร่', 16.2483, 99.8358),            // ready, rice
  F('f002', 'ข้าวนาปรัง', day(40), '10 ไร่ 2 งาน', 16.2491, 99.8361),     // same cell, not ready yet
  F('f003', 'อ้อยโรงงาน', day(5), '30 ไร่', 16.4824, 99.5256),            // sugarcane
  F('f004', 'ข้าวนาปี', day(1), '5 ไร่', 16.30, 99.90, 'Sold'),            // not open → excluded
  F('f005', 'ข้าวนาปี', day(1), '5 ไร่', '', ''),                          // no coordinates → excluded
  F('f006', 'ข้าวโพดเลี้ยงสัตว์', day(2), '12 ไร่', 16.0743, 99.8720, 'Open', 'อื่นๆ', 'ซังข้าวโพด'));
sheets.buyers.rows.push(
  B('b001', 16.0759, 99.8850, 'ฟางข้าว', 30, '45', 'Active', 7),
  B('b002', 16.0761, 99.8852, 'ฟางข้าว', 25, '15 ตัน/วัน', 'Active', 3),
  B('b003', 16.1217, 99.9437, 'ใบอ้อย', '', '20'),
  B('b004', 16.1165, 99.8466, 'ฟางข้าว', 40, '10', 'Inactive'),
  B('b005', 16.0815, 99.7724, 'อื่นๆ', 18, '8', 'Active', '', 'ซังข้าวโพด'));

let p = get({ api: 'v1', endpoint: 'market' });
check(p.ok && p.apiVersion === '2.8.0' && p.data.ok, 'market endpoint answers');
const d = p.data;
check(d.gridDeg === 0.05 && d.gridKm === 5.6, 'grid ~5.5 km');
const g = Object.fromEntries(d.groups.map((x) => [x.key, x]));
check(g.rice.sell.plots === 2 && g.rice.sell.readyPlots === 1 && g.rice.sell.areaRai === 30.5, 'rice listings: open + coordinates only, ready = harvested or ≤15 days');
check(g.rice.buy.buyers === 2 && g.rice.buy.priceMin === 25 && g.rice.buy.priceMax === 30 && g.rice.buy.capacityTonPerDay === 60, 'rice buyers: active only, price range, capacity');
check(g.sugarcane.sell.plots === 1 && g.sugarcane.buy.buyers === 1 && g.sugarcane.buy.priceMin === null, 'sugarcane: buyer without price');
check(g.maize.sell.plots === 1 && g.maize.buy.buyers === 1, 'maize from crop name and from "อื่นๆ: ซังข้าวโพด" buyer');
check(g.rice.residueTRai > 0 && g.rice.sell.ton === Math.round(30.5 * g.rice.residueTRai * 10) / 10, 'tonnes from the GHG crop residue rate');
check(d.totals.plots === 4 && d.totals.buyers === 4, 'totals');

/* 2.7.0: when the residue is available (harvest date buckets) and the district list */
const tr = g.rice.sell.timing;
check(tr.now.plots === 1 && tr.now.areaRai === 20 && tr.d30.plots === 0 && tr.d90.plots === 1 && tr.d90.areaRai === 10.5 && tr.later.plots === 0, 'rice timing: harvested now / 31–90 days');
check(tr.now.ton === Math.round(20 * g.rice.residueTRai * 10) / 10, 'timing tonnes from the same residue rate');
check(g.sugarcane.sell.timing.d30.plots === 1 && g.maize.sell.timing.d30.plots === 1, 'harvest in 1–30 days → d30');
check(g.cassava.sell.timing.now.plots === 0 && g.cassava.sell.timing.now.ton !== undefined, 'empty material still has all buckets');
check(Array.isArray(d.districts) && d.districts.length === 11 && d.districts.every((x) => x.code && x.districtName && !x.geometry), 'all 11 districts listed, no geometry');
check(d.notes.timing && /30 วัน/.test(d.notes.timing), 'timing note');

/* privacy: cell centres only, no names / phones / real coordinates anywhere in the payload */
const body = JSON.stringify(d);
check(!/ชื่อf00|ร้านb00|0811111|0822222/.test(body), 'no names or phones');
check(!body.includes('16.2483') && !body.includes('99.8358') && !body.includes('16.0759'), 'no real coordinates');
const riceCell = d.cells.find((c) => c.sell.rice);
check(riceCell.sell.rice.plots === 2 && riceCell.lat === 16.225 && riceCell.lng === 99.825, 'two nearby plots share one cell; centre is published');
check(riceCell.sell.rice.nextHarvest && riceCell.district, 'next harvest date for the not-yet-ready plot; district name attached');
const buyCell = d.cells.find((c) => c.buy.rice);
check(buyCell.buy.rice.buyers === 2 && buyCell.buy.rice.afterHarvestDays === 3, 'buyers in one cell merged; shortest days after harvest');

/* cached, and a saved listing clears the cache */
sheets.farmers.rows.push(F('f007', 'มันสำปะหลัง', day(0), '8 ไร่', 16.3, 99.7));
check(get({ api: 'v1', endpoint: 'market' }).data.totals.plots === 4, 'served from cache for 5 minutes');
check(get({ api: 'v1', endpoint: 'market', refresh: '1' }).data.totals.plots === 5, 'refresh=1 rebuilds');
console.log('PASS: market endpoint (' + n + ' checks)');
