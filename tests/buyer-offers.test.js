/* 4.3.0: a buy point buys several materials, each with its own price unit (บาท/ไร่ · บาท/ตัน · บาท/ก้อน). */
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };
const day = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x; };
const F = (id, owner, crop, area, lat, lng) => [id, '', 'ชื่อ' + id, '', owner, crop, '', day(3), area, lat, lng, 'Open', owner, '', '', '', '', ''];
const env = load({
  expose: ['marketReport_', 'buyerOffers_'],
  sheets: {
    Config: new Sheet('Config', [HEADERS.Config]),
    users: new Sheet('users', [HEADERS.users,
      ['0810000001', '', 'farmer', 'เกษตรกร', false, true, '', '', '', '62', 'กำแพงเพชร'],
      ['0820000001', '', 'buyer', 'โรงอัด', false, true, '', '', '', '62', 'กำแพงเพชร']]),
    farmers: new Sheet('farmers', [HEADERS.farmers, F('f1', '0810000001', 'ข้าวนาปี', '20 ไร่', 16.47, 99.52), F('f2', '0810000001', 'อ้อยโรงงาน', '10 ไร่', 16.48, 99.53)]),
    buyers: new Sheet('buyers', [HEADERS.buyers,
      // an old row (4.2.0 and before): one material, no unit → บาท/ไร่
      ['old', '', 'ร้านเก่า', '', '0820000099', 16.46, 99.51, 'ฟางข้าว', '', 500, '10', 'Active', '0820000099', 'ฟางข้าว', '', '', 'ALL']])
  }
});
const { get, sheets, api } = env;
const rpc = (method, arg, token) => get({ action: 'rpc', method, args: JSON.stringify([arg]), callback: '', token: token || '' });
const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
quiet(() => api.setupSystem());
check(sheets.buyers.rows[0][23] === 'Price_Unit' && sheets.buyers.rows[0][24] === 'Materials_JSON', 'setup adds X Price_Unit, Y Materials_JSON');

const old = api.buyerOffers_(sheets.buyers.rows[1]);
check(old.length === 1 && old[0].material === 'ฟางข้าว' && old[0].unit === 'rai' && old[0].price === 500, 'old rows read as one material in บาท/ไร่');

const buyer = rpc('loginServer', { username: '0820000001' }).result.token;
const base = { role: 'buyer', fname: 'โรงอัด', lname: 'ฟาง', phone: '0820000001', quality: 'แห้ง', capacity: '30', lat: 16.47, lng: 99.52 };
let r = rpc('saveDataServer', Object.assign({}, base, { offers: [
  { materialType: 'ฟางข้าว', price: 800, unit: 'ton' },
  { materialType: 'ใบอ้อย', price: 25, unit: 'bale' },
  { materialType: 'อื่นๆ', materialOther: 'ซังข้าวโพด', price: 400, unit: 'rai' }] }), buyer);
check(r.ok && r.result.status === 'success', 'save 3 materials: ' + JSON.stringify(r).slice(0, 200));
const row = sheets.buyers.rows.at(-1);
check(row[7] === 'ฟางข้าว' && row[9] === 800 && row[13] === 'ฟางข้าว' && row[23] === 'ton', 'first material kept in H/J/N + unit in X');
const offers = JSON.parse(row[24]);
check(offers.length === 3 && offers[1].unit === 'bale' && offers[2].material === 'ซังข้าวโพด', 'all materials in Y as JSON');

check(!rpc('saveDataServer', Object.assign({}, base, { offers: [{ materialType: 'ฟางข้าว', price: 1, unit: 'rai' }, { materialType: 'ฟางข้าว', price: 2, unit: 'ton' }] }), buyer).ok, 'the same material twice is refused');
check(!rpc('saveDataServer', Object.assign({}, base, { offers: [{ materialType: 'ฟางข้าว', price: 1, unit: 'kg' }] }), buyer).ok, 'unknown unit is refused');
check(!rpc('saveDataServer', Object.assign({}, base, { offers: [{ materialType: 'ฟางข้าว', price: '', unit: 'rai' }] }), buyer).ok, 'a material without a price is refused');
// an older page (no offers) still saves, unit บาท/ไร่ unless priceUnit is sent
r = rpc('saveDataServer', Object.assign({}, base, { lat: 16.5, materialType: 'ใบอ้อย', price: 300 }), buyer);
check(r.ok && sheets.buyers.rows.at(-1)[23] === 'rai' && JSON.parse(sheets.buyers.rows.at(-1)[24]).length === 1, 'older page: one material, บาท/ไร่');

const prof = rpc('getUserProfileServer', {}, buyer).result;
const mine = prof.buyers.find((b) => b.offers && b.offers.length === 3);
check(mine && mine.offers[0].unit === 'ton', 'the owner gets every material back to edit');

const farmer = rpc('loginServer', { username: '0810000001' }).result.token;
const m = rpc('getMatchingDataServer', { province: '62' }, farmer).result;
const b3 = m.buyers.find((b) => b.offers.length === 3);
check(b3 && b3.materials.join() === 'ฟางข้าว,ใบอ้อย,ซังข้าวโพด' && /800 บาท\/ตัน/.test(b3.priceText) && /25 บาท\/ก้อน/.test(b3.priceText), 'partners see every material and its unit');

const mk = get({ api: 'v1', endpoint: 'market', refresh: '1' }).data;
const g = (k) => mk.groups.find((x) => x.key === k);
check(g('rice').buy.buyers === 2 && g('sugarcane').buy.buyers === 2, 'the 3-material point counts under each material it buys: ' + g('rice').buy.buyers + '/' + g('sugarcane').buy.buyers);
check(g('rice').buy.priceByUnit.ton.min === 800 && g('rice').buy.priceByUnit.rai.min === 500 && g('rice').buy.priceMin === 500, 'prices kept per unit; priceMin stays บาท/ไร่');
check(g('sugarcane').buy.priceByUnit.bale.min === 25 && g('sugarcane').buy.priceByUnit.rai.min === 300, 'บาท/ก้อน kept apart');

const rep = api.marketReport_('62');
const rice = rep.materials.find((x) => x.code === 'rice'), cane = rep.materials.find((x) => x.code === 'sugarcane');
const rate = g('rice').residueTRai;
check(rice.avgPriceBahtPerRai === Math.round((500 + 800 * rate) / 2), 'report: บาท/ตัน × ตัน/ไร่ joins the บาท/ไร่ average: ' + rice.avgPriceBahtPerRai);
check(cane.avgPriceBahtPerRai === 300, 'report: บาท/ก้อน is not averaged: ' + cane.avgPriceBahtPerRai);
{ const fs = require('fs'), path = require('path'); const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8'); const mk = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'market.js'), 'utf8');
  check(html.includes("['ton', 'บาท/ตัน'], ['bale', 'บาท/ก้อน']") && html.includes('function addOffer') && html.includes('payload.offers = offers') && !html.includes('ราคารับซื้อ (บาท/ไร่)'), 'buyer card: several materials, unit select, no fixed บาท/ไร่ label');
  check(mk.includes('function unitPrices') && mk.includes("bale: 'บาท/ก้อน'"), 'market shows prices per unit'); }
console.log('PASS: ' + n + ' checks — 4.3.0 buyers: several materials, price per unit');
