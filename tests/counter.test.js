const { load, Sheet, HEADERS } = require('./helpers/gas-mock');

function assert(value, message) { if (!value) throw new Error(message); }

const farmers = new Sheet('farmers', [HEADERS.farmers,
  ['f1', '', 'สมชาย', 'ใจดี', '0841157666', 'ข้าวนาปี', '', '2026-11-20', '20 ไร่ 1 งาน 25 ตร.ว.', 16.073426, 99.891172, 'Open', '0841157666', 'ฟางข้าว', ''],
  ['f2', '', 'ลบ', 'แล้ว', '0811111111', 'ข้าวนาปี', '', '', '5 ไร่', 16.07, 99.89, 'Deleted', '0811111111', 'ฟางข้าว', '']]);
const buyers = new Sheet('buyers', [HEADERS.buyers,
  ['b1', '', 'ศูนย์อัดฟาง', 'ขาณุ', '0625419987', 16.075923, 99.885041, 'ฟางข้าว', 'แห้ง', 30, '45', 'Active', '0625419987', 'ฟางข้าว', '']]);
const config = new Sheet('Config', [HEADERS.Config, ['visit_count', 1, 'ครั้ง', 'จำนวนครั้งที่มีการเข้าใช้งานเว็บไซต์']]);
const env = load({ sheets: { farmers, buyers, Config: config } });
const { get, sheets } = env;
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


/* ---------- 2.6.0: officer endpoints moved to ABM, the answer says where ---------- */
['summary', 'residue', 'balance', 'crop'].forEach((ep) => {
  const r = get({ api: 'v1', endpoint: ep });
  assert(!r.ok && r.moved === 'ABM' && /KPP-Agri-Byproduct-Management/.test(r.error), ep + ' points to ABM: ' + JSON.stringify(r));
});
const h = get({ api: 'v1', endpoint: 'health' });
assert(h.ok && h.apiVersion === '4.2.0' && h.feature === 'MARKET_ONLY' && h.system === 'GGH', 'health 4.2.0: ' + JSON.stringify(h));
env.api.doPost({ postData: { contents: JSON.stringify({ method: 'adminLoginServer', args: [{}] }) } });
const pr = JSON.parse(env.out().body);
assert(!pr.ok && /ชื่อผู้ใช้และรหัสผ่าน/.test(pr.error), '4.0.0: officers sign in to Green Gain Hub itself again: ' + JSON.stringify(pr));
assert(/ABM residue rates unavailable, defaults used|PASS: ABM residue rates/.test(setup) && /ABM feed key/.test(setup), 'setup reports the ABM link: ' + setup);

console.info('PASS: visit counter (session hits, daily rows, Config total) · 2.6.0 moved endpoints point to ABM · health');
