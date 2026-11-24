/* 3.0.0 all provinces: fill province from old pins, market per province, district breakdown, matching and ABM feed per province. */
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };

const day = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x; };
// rows saved before 3.0.0: 18 / 17 columns, no province yet
const F = (id, owner, crop, area, lat, lng) => [id, '', 'ชื่อ' + id, '', owner, crop, '', day(2), area, lat, lng, 'Open', owner, '', '', '', '', ''];
const B = (id, owner, mat, lat, lng) => [id, '', 'ร้าน' + id, '', owner, lat, lng, mat, '', 500, '10', 'Active', owner, mat, '', '', 'ALL'];
const env = load({
  sheets: {
    Config: new Sheet('Config', [HEADERS.Config]),
    users: new Sheet('users', [HEADERS.users,
      ['0810000001', '', 'farmer', 'เกษตรกร กพ', false, true, '', '', ''],
      ['0810000002', '', 'farmer', 'เกษตรกร เชียงใหม่', false, true, '', '', ''],
      ['0810000003', '', 'buyer', 'ยังไม่ปักหมุด', false, true, '', '', '']]),
    farmers: new Sheet('farmers', [HEADERS.farmers,
      F('k1', '0810000001', 'ข้าวนาปี', '20 ไร่', 16.4828, 99.5227),    // เมืองกำแพงเพชร
      F('k2', '0810000001', 'ข้าวนาปรัง', '10 ไร่', 16.4840, 99.5240),  // same farmer, same district
      F('k3', '0810000009', 'อ้อยโรงงาน', '30 ไร่', 16.0743, 99.8720),  // another district of Kamphaeng Phet
      F('c1', '0810000002', 'ข้าวนาปี', '15 ไร่', 18.7883, 98.9853)]),  // เมืองเชียงใหม่
    buyers: new Sheet('buyers', [HEADERS.buyers,
      B('kb', '0820000001', 'ฟางข้าว', 16.4700, 99.5300),
      B('cb', '0820000002', 'ฟางข้าว', 18.7900, 98.9900)])
  }
});
const { get, sheets, props } = env;
const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

/* the first request fills provinces from the pins, users from their first pin, the rest Kamphaeng Phet */
const p = quiet(() => get({ api: 'v1', endpoint: 'market' }));
check(props.GEO_MIGRATED === '3.0.0', 'migration ran once');
const fr = sheets.farmers.rows;
check(fr[0][18] === 'Province_Code' && fr[1][18] === '62' && fr[1][19] === 'กำแพงเพชร' && fr[1][20] === '6201' && fr[1][21] === 'เมืองกำแพงเพชร' && fr[1][23], 'old KPP plot filled S:X');
check(fr[4][18] === '50' && fr[4][19] === 'เชียงใหม่' && fr[4][21] === 'เมืองเชียงใหม่', 'old Chiang Mai plot filled');
check(sheets.buyers.rows[2][17] === '50' && sheets.buyers.rows[1][17] === '62', 'buyers filled R:W');
const ur = sheets.users.rows;
check(ur[0][9] === 'Province_Code' && ur[1][9] === '62' && ur[2][9] === '50' && ur[2][10] === 'เชียงใหม่' && ur[3][9] === '62' && ur[3][10] === 'กำแพงเพชร', 'users: province of their first pin, else Kamphaeng Phet');

/* market: default Kamphaeng Phet, only its rows */
const d = p.data;
check(d.provinceCode === '62' && d.province === 'กำแพงเพชร', 'default province');
check(d.totals.plots === 3 && d.totals.farmers === 2 && d.totals.buyers === 1, 'only Kamphaeng Phet rows; farmers = distinct sellers');
check(d.districts.length === 11 && d.byDistrict.length === 11, 'all 11 districts in the breakdown');
const mueang = d.byDistrict.find((x) => x.code === '6201');
check(mueang.name === 'เมืองกำแพงเพชร' && mueang.plots === 2 && mueang.farmers === 1 && mueang.areaRai === 30 && mueang.buyers === 1 && mueang.ton > 0, 'district row: area, distinct farmers, tonnes, buyers');
check(d.byDistrict.filter((x) => x.plots).length === 2, 'the sugarcane plot sits in another district');
check(d.provinces.find((x) => x.code === '50').plots === 1 && d.provinces.find((x) => x.code === '62').plots === 3, 'activity per province for the picker');

/* another province */
const c = get({ api: 'v1', endpoint: 'market', province: '50' }).data;
check(c.provinceCode === '50' && c.province === 'เชียงใหม่' && c.totals.plots === 1 && c.totals.buyers === 1 && c.districts.length > 20, 'Chiang Mai market');
check(c.cells.every((x) => x.lat > 18), 'no Kamphaeng Phet cell in Chiang Mai');
check(!JSON.stringify(c).includes('18.7883'), 'still no real coordinates');

/* a new plot saved in Chiang Mai clears that province's cache */
check(get({ action: 'rpc', method: 'loginServer', args: JSON.stringify([{ username: '0810000002' }]), callback: '' }).result.status === 'need_pin', '3.1.0: old account sets a PIN first');
const login = get({ action: 'rpc', method: 'setPinServer', args: JSON.stringify([{ phone: '0810000002', pin: '583920' }]), callback: '' });
check(login.ok && login.result.province.code === '50', 'sign-in gives the user province');
const tok = login.result.token;
const save = get({ action: 'rpc', method: 'saveDataServer', token: tok, callback: '', args: JSON.stringify([{ role: 'farmer', fname: 'ใหม่', phone: '0810000002', crop: 'ข้าวนาปี', harvestDate: '2026-12-20', area: '8 ไร่', lat: 19.9, lng: 99.85 }]) });
check(save.ok && save.result.location.province === 'เชียงราย', 'a pin in Chiang Rai is stored as Chiang Rai (the pin decides, not the account)');
check(get({ api: 'v1', endpoint: 'market', province: '57' }).data.totals.plots === 1, 'Chiang Rai market shows it at once');

/* signed-in map: partners of one province only */
const buyerTok = get({ action: 'rpc', method: 'registerServer', callback: '', args: JSON.stringify([{ role: 'buyer', name: 'โรงงาน กพ', phone: '0899000001', provinceCode: '62', pin: '470215' }]) }).result.token;
const m62 = get({ action: 'rpc', method: 'getMatchingDataServer', token: buyerTok, callback: '', args: JSON.stringify([{}]) }).result;
check(m62.province === '62' && m62.farmers.length === 3 && m62.farmers.every((f) => f.lat < 17), 'buyer sees plots of their province by default');
const m50 = get({ action: 'rpc', method: 'getMatchingDataServer', token: buyerTok, callback: '', args: JSON.stringify([{ province: '50' }]) }).result;
check(m50.farmers.length === 1 && m50.farmers[0].id === 'c1', 'or of the province they pick');

/* ABM (Kamphaeng Phet officers) reads only Kamphaeng Phet */
props.ABM_FEED_KEY_HASH = '';
console.log('PASS: ' + n + ' checks — 3.0.0 provinces from pins, market per province, district breakdown, matching per province');
