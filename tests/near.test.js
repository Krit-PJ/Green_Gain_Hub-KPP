/* 4.1.0: "รวมคู่ค้าต่างจังหวัดในรัศมี 50 กม." — partners of other provinces within 50 km of the user's own pins. */
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };
const day = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x; };
const F = (id, owner, lat, lng) => [id, '', 'ชื่อ' + id, '', owner, 'ข้าวนาปี', '', day(2), '10 ไร่', lat, lng, 'Open', owner, '', '', '', '', ''];
const B = (id, owner, lat, lng) => [id, '', 'ร้าน' + id, '', owner, lat, lng, 'ฟางข้าว', '', 500, '10', 'Active', owner, 'ฟางข้าว', '', '', 'ALL'];
const env = load({
  sheets: {
    Config: new Sheet('Config', [HEADERS.Config]),
    users: new Sheet('users', [HEADERS.users,
      ['0810000001', '', 'farmer', 'เกษตรกร ขาณุฯ', false, true, '', '', '', '62', 'กำแพงเพชร'],
      ['0810000002', '', 'farmer', 'ยังไม่ปักหมุด', false, true, '', '', '', '62', 'กำแพงเพชร'],
      ['0820000009', '', 'buyer', 'โรงอัดฟาง นครสวรรค์', false, true, '', '', '', '60', 'นครสวรรค์']]),
    farmers: new Sheet('farmers', [HEADERS.farmers,
      F('k1', '0810000001', 16.0743, 99.8720),     // ขาณุวรลักษบุรี กำแพงเพชร (near Nakhon Sawan)
      F('n1', '0810000077', 15.98, 99.99)]),        // บรรพตพิสัย นครสวรรค์ (~16 km from k1)
    buyers: new Sheet('buyers', [HEADERS.buyers,
      B('kb', '0820000001', 16.4700, 99.5300),      // เมืองกำแพงเพชร (~50+ km from k1, same province)
      B('nb', '0820000009', 15.98, 100.00),         // นครสวรรค์ ~16 km from k1
      B('cm', '0820000002', 18.79, 98.99)])         // เชียงใหม่ — far away
  }
});
const { get } = env;
const rpc = (method, arg, token) => get({ action: 'rpc', method, args: JSON.stringify([arg]), callback: '', token: token || '' });
const farmer = rpc('loginServer', { username: '0810000001' }).result.token;

let r = rpc('getMatchingDataServer', { province: '62' }, farmer).result;
check(r.buyers.map((b) => b.id).join() === 'kb' && r.nearKm === 0, 'switch off: own province only');
r = rpc('getMatchingDataServer', { province: '62', nearKm: 50 }, farmer).result;
const ids = r.buyers.map((b) => b.id).sort().join();
check(ids === 'kb,nb' && r.nearKm === 50 && r.nearAnchors === 1, 'switch on: + Nakhon Sawan buyer within 50 km, not Chiang Mai: ' + ids);
const nb = r.buyers.find((b) => b.id === 'nb');
check(nb.crossProvince === true && nb.provinceName === 'นครสวรรค์' && !r.buyers.find((b) => b.id === 'kb').crossProvince, 'cross-province partner marked with its province');
check(rpc('getMatchingDataServer', { province: '62', nearKm: 500 }, farmer).result.nearKm === 50, '4.2.0: the page cannot choose the radius — the configured one is used');
check(rpc('getMatchingDataServer', { province: '62', near: true }, farmer).result.nearRadiusKm === 50, 'near:true uses the configured radius (default 50)');

/* 4.2.0: Super Admin sets the radius (10–100 km) */
env.props.SUPER_ADMIN_USERNAME = 'krit'; env.props.SUPER_ADMIN_PASSWORD = 'Super12345';
{ const l = console.log; console.log = () => {}; env.api.setupSystem(); console.log = l; }
const apost = (method, arg, token) => { env.api.doPost({ postData: { contents: JSON.stringify({ method, args: [arg], token: token || '' }) } }); return JSON.parse(env.out().body); };
const T = apost('adminLoginServer', { username: 'krit', password: 'Super12345' }).result.token;
[5, 101, 12.5, 'x'].forEach((v) => check(!apost('marketRuleSaveServer', { hideAfterHarvestDays: 20, nearRadiusKm: v }, T).ok, 'radius refused: ' + v));
check(apost('marketRuleSaveServer', { hideAfterHarvestDays: 20, nearRadiusKm: 10 }, T).result.nearRadiusKm === 10 && apost('marketRuleServer', undefined, T).result.nearRadiusKm === 10, 'radius saved: 10 km');
r = rpc('getMatchingDataServer', { province: '62', near: true }, farmer).result;
check(r.nearKm === 10 && !r.buyers.some((b) => b.id === 'nb'), '10 km: the Nakhon Sawan buyer (~16 km) is no longer included');
check(rpc('getUserProfileServer', {}, farmer).result.nearRadiusKm === 10, 'the page learns the radius with the profile');
check(apost('marketRuleSaveServer', { hideAfterHarvestDays: 20, nearRadiusKm: 50 }, T).ok, 'back to 50 km');

const empty = rpc('loginServer', { username: '0810000002' }).result.token;
r = rpc('getMatchingDataServer', { province: '62', nearKm: 50 }, empty).result;
check(r.nearAnchors === 0 && r.buyers.map((b) => b.id).join() === 'kb', 'no own pin → nothing across the border');

const buyer = rpc('loginServer', { username: '0820000009' }).result.token;
r = rpc('getMatchingDataServer', { province: '60', nearKm: 50 }, buyer).result;
check(r.farmers.map((f) => f.id).sort().join() === 'k1,n1' && r.farmers.find((f) => f.id === 'k1').crossProvince, 'buyer: Kamphaeng Phet plot within 50 km of the buy point');
check(rpc('getMatchingDataServer', { province: '60' }, buyer).result.farmers.map((f) => f.id).join() === 'n1', 'buyer, switch off: own province');

/* 4.2.0: the user card — profile saved once, every record follows; the login phone stays */
let p = rpc('getUserProfileServer', {}, farmer).result;
check(p.profile.loginPhone === '0810000001' && p.profile.contactPhone && p.province.code === '62', 'profile: login phone, contact phone, province');
check(!rpc('updateProfileServer', { fname: '', contactPhone: '0899999999' }, farmer).ok, 'name required');
check(!rpc('updateProfileServer', { fname: 'สมใจ', contactPhone: '12345' }, farmer).ok, 'contact phone checked');
r = rpc('updateProfileServer', { fname: 'สมใจ', lname: 'ปลูกข้าว', contactPhone: '0899999999', provinceCode: '60' }, farmer).result;
check(r.updated === 1 && r.name === 'สมใจ ปลูกข้าว' && r.province.code === '60', 'saved: name, contact phone, province');
const urow = env.sheets.users.rows.find((x) => x[0] === '0810000001'), frow = env.sheets.farmers.rows.find((x) => x[0] === 'k1');
check(urow[3] === 'สมใจ ปลูกข้าว' && urow[9] === '60' && frow[2] === 'สมใจ' && frow[3] === 'ปลูกข้าว' && frow[4] === '0899999999' && frow[12] === '0810000001', 'users + every plot updated; the owner (login phone) unchanged');
p = rpc('getUserProfileServer', {}, farmer).result;
check(p.name === 'สมใจ ปลูกข้าว' && p.profile.contactPhone === '0899999999' && p.profile.fname === 'สมใจ', 'profile reads back the new values');

console.log('PASS: ' + n + ' checks — 4.1.0/4.2.0 partners across the border (configurable radius) + 4.2.0 user profile');
