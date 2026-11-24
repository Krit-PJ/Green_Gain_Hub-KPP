/* 2.5.1: server-to-server feed for ABM. Only the SHA-256 of ABM's key is in Config; wrong/missing key refused; rows as in the sheet. */
const crypto = require('crypto');
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
const env = load({ sheets: { Config: new Sheet('Config', [HEADERS.Config]) } });
const { api, sheets } = env;
const feed = (body) => { api.doPost({ postData: { contents: JSON.stringify(body) } }); return JSON.parse(env.out().body); };

let r = feed({ action: 'abm_feed', key: 'x'.repeat(64) });
assert(!r.ok && /not configured/.test(r.error), 'no hash in Config → refused: ' + JSON.stringify(r));
const key = crypto.randomBytes(32).toString('hex');
sheets.Config.rows.push(['abm_feed_key_sha256', crypto.createHash('sha256').update(key).digest('hex'), 'sha256', 'ABM']);
sheets.farmers.rows.push(['F1', new Date('2026-11-01T03:00:00Z'), 'สมศรี', 'ขายฟาง', '0811111111', 'ข้าวนาปี', '2026-08-01', '2026-11-20', '30', 16.07, 99.89, 'Open', '0811111111', 'ฟางข้าว', '', '', '', '']);
sheets.buyers.rows.push(['B1', new Date(), 'โรงอัดฟาง', 'เมือง', '0862222222', 16.47, 99.51, 'ฟางข้าว', 'ดี', 500, '15 ตัน/วัน', 'Active', '0862222222', 'ฟางข้าว', '', new Date(), 'ALL']);
r = feed({ action: 'abm_feed', key: key.slice(0, -1) + (key.endsWith('0') ? '1' : '0') });
assert(!r.ok && /Invalid feed key/.test(r.error) && !JSON.stringify(r).includes('สมศรี'), 'wrong key refused, nothing leaked');
assert(!feed({ action: 'abm_feed' }).ok, 'missing key refused');
r = feed({ action: 'abm_feed', key });
assert(r.ok && r.data.apiVersion === '3.1.0' && r.data.farmers.headers[0] === 'ID' && r.data.farmers.rows.length === 1 && r.data.buyers.rows.length === 1, 'feed: ' + JSON.stringify(r).slice(0, 200));
assert(r.data.farmers.rows[0][2] === 'สมศรี' && r.data.farmers.rows[0][1] === '2026-11-01T03:00:00.000Z' && r.data.farmers.rows[0].length === HEADERS.farmers.length, 'rows keep the sheet column order; dates as ISO');
// 2.9.0: farmer/buyer phone numbers as SHA-256 only (ABM refuses them as officers)
sheets.users.rows.push(['0811111111', '', 'farmer', 'สมศรี', false, true, '', '', ''], ['086-222-2222', '', 'buyer', 'โรงอัดฟาง', false, true, '', '', '']);
r = feed({ action: 'abm_feed', key });
const sha = (x) => crypto.createHash('sha256').update(x, 'utf8').digest('hex');
assert(Array.isArray(r.data.marketPhones) && r.data.marketPhones.length === 2 && r.data.marketPhones.includes(sha('0811111111')) && r.data.marketPhones.includes(sha('0862222222')),
  'marketPhones = SHA-256 of normalized phones: ' + JSON.stringify(r.data.marketPhones));
assert(!JSON.stringify(r.data.marketPhones).includes('0811111111'), 'no raw numbers in marketPhones');
// 3.0.0: ABM is Kamphaeng Phet's officers' system — a plot in another province is not in its feed
sheets.farmers.rows.push(['F2', new Date(), 'เชียงใหม่', '', '0833333333', 'ข้าวนาปี', '', '2026-11-20', '10', 18.79, 98.99, 'Open', '0833333333', 'ฟางข้าว', '', '', '', '', '50', 'เชียงใหม่', '5001', 'เมืองเชียงใหม่', '', '']);
r = feed({ action: 'abm_feed', key });
assert(r.data.province === '62' && r.data.farmers.rows.length === 1 && r.data.farmers.rows[0][2] === 'สมศรี', '3.0.0: ABM feed has only its province');
assert(feed({ action: 'abm_feed', key, province: '50' }).data.farmers.rows[0][2] === 'เชียงใหม่', '3.0.0: a feed can ask for another province');
const pub = env.get({ api: 'v1', endpoint: 'market' });
assert(pub.ok && !JSON.stringify(pub).includes('สมศรี'), 'public market endpoint unchanged (aggregate only)');
const t = env.post('adminLoginServer', [{ username: 'nobody', password: 'x' }]);
assert(!t.ok, 'admin API still works next to the feed');
console.info('PASS: 2.5.1–3.0.0 ABM feed — province only, hash-only key check, refusals, rows in sheet order, market phones as SHA-256, public endpoints unchanged');
