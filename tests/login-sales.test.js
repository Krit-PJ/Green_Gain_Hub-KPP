/* 3.3.0: phone-number-only sign-in and registration (the 3.1.0 PIN removed, old hashes blanked), "ขายแล้ว" records,
   maize material and the retired central-identity RPCs. Was pin.test.js (3.1.0). */
const crypto = require('crypto');
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };

const env = load({ sheets: { Config: new Sheet('Config', [HEADERS.Config]) } });
const { get, sheets, api, cache } = env;
const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
quiet(() => api.setupSystem());
const rpc = (method, arg, token) => get({ action: 'rpc', method, args: JSON.stringify([arg]), callback: '', token: token || '' });
const bad = (r, re, m) => { n++; assert(!r.ok && re.test(r.error), m + ': ' + JSON.stringify(r)); };

/* 3.3.0: register and sign in with the phone number only — no PIN anywhere */
const reg = rpc('registerServer', { role: 'farmer', name: 'สมใจ ปลูกข้าว', phone: '0861111111', provinceCode: '62' });
check(reg.ok && reg.result.token && reg.result.province.code === '62', 'registered with phone, name, province → signed in');
const urow = sheets.users.rows.find((r) => r[0] === '0861111111');
check(urow[1] === '', 'nothing stored in the old password column');
bad(rpc('registerServer', { role: 'farmer', name: 'ซ้ำ', phone: '0861111111', provinceCode: '62' }), /ลงทะเบียนแล้ว/, 'a number registers once');
const ok = rpc('loginServer', { username: '0861111111' });
check(ok.ok && ok.result.status === 'success' && /^[0-9a-f]{64}$/.test(ok.result.token), 'phone alone signs in');
check(rpc('loginServer', { username: '0861111111', pin: '000001' }).result.status === 'success', 'a PIN sent by an old page is ignored');
bad(rpc('loginServer', { username: '0899999990' }), /ไม่พบหมายเลข/, 'unknown number → register');
bad(rpc('setPinServer', { phone: '0861111111', pin: '408215' }), /Method not allowed/, 'setPinServer removed');

/* accounts that set a PIN under 3.1.0: the hash is blanked once at the next sign-in, and they sign in by phone */
delete env.props.PIN_REMOVED;
sheets.users.rows.push(['0872222222', 'pin1$0123456789abcdef$' + 'a'.repeat(64), 'buyer', 'โรงอัดฟาง เดิม', false, true, '', '', '', '62', 'กำแพงเพชร']);
const set = rpc('loginServer', { username: '0872222222' });
check(set.ok && set.result.token && set.result.role === 'buyer', 'old PIN account signs in by phone');
check(!JSON.stringify(sheets.users.rows).includes('pin1$') && env.props.PIN_REMOVED === '3.3.0', 'PIN hashes blanked once');

/* ABM PIN reset retired */
const key = crypto.randomBytes(32).toString('hex');
sheets.Config.rows.push(['abm_feed_key_sha256', crypto.createHash('sha256').update(key).digest('hex'), 'sha256', 'ABM']);
const post = (body) => { api.doPost({ postData: { contents: JSON.stringify(body) } }); return JSON.parse(env.out().body); };
check(!post({ action: 'abm_pin_reset', key, phone: '0872222222' }).ok, 'abm_pin_reset removed');

/* retired central identity: a ticket cannot open a session */
bad(rpc('ssoLoginServer', { ticket: 'abc.def' }), /Method not allowed/, 'ssoLoginServer retired');
bad(rpc('ssoProvisionServer', { phone: '0861111111' }), /Method not allowed/, 'ssoProvisionServer retired');

/* maize: a crop and a material */
const tok = ok.result.token;
const sv = rpc('saveDataServer', { role: 'farmer', fname: 'สมใจ', phone: '0861111111', crop: 'ข้าวโพดเลี้ยงสัตว์', plantDate: '2026-08-01', harvestDate: '2026-11-19', area: '12 ไร่ 0 งาน 0 ตร.ว.', lat: 16.48, lng: 99.52 }, tok);
check(sv.ok, 'maize plot saved: ' + JSON.stringify(sv));
const plot = sheets.farmers.rows.at(-1);
check(plot[13] === 'ซังข้าวโพด', 'ข้าวโพดเลี้ยงสัตว์ → ซังข้าวโพด');
const mk = get({ api: 'v1', endpoint: 'market', refresh: '1' }).data;
check(mk.groups.find((g) => g.key === 'maize').sell.plots === 1, 'maize on the market');

/* ขายแล้ว */
const id = plot[0];
bad(rpc('markSoldServer', { id, quantityTon: -1 }, tok), /ปริมาณที่ขาย/, 'negative tonnes refused');
bad(rpc('markSoldServer', { id, soldDate: '2099-01-01' }, tok), /ไม่เกินวันนี้/, 'future sale date refused');
const sold = rpc('markSoldServer', { id, quantityTon: 9.5, amountBaht: 5700, buyerName: 'โรงงานอาหารสัตว์', soldDate: '2026-11-20' }, tok);
check(sold.ok && plot[11] === 'Sold', 'plot marked Sold');
const sale = sheets.sales.rows.at(-1);
check(sheets.sales.rows[0][0] === 'ID' && sale[2] === id && sale[3] === '0861111111' && sale[5] === 'ซังข้าวโพด' && sale[6] === 12 && sale[7] === 9.5 && sale[8] === 5700 && sale[10] === '62' && sale[13], 'sales row: plot, material, area, tonnes, baht, province, district');
bad(rpc('markSoldServer', { id }, tok), /ไม่ได้ประกาศขาย/, 'cannot sell twice');
check(get({ api: 'v1', endpoint: 'market' }).data.groups.find((g) => g.key === 'maize').sell.plots === 0, 'sold plot leaves the market');
const prof = rpc('getUserProfileServer', {}, tok).result;
check(prof.sales.length === 1 && prof.sales[0].amountBaht === 5700 && prof.farmers.find((f) => f.id === id).recordStatus === 'Sold', 'profile lists the sale');
const bt = set.result.token;
bad(rpc('markSoldServer', { id }, bt), /ไม่มีสิทธิ์/, 'a buyer cannot mark plots sold');
const feed = post({ action: 'abm_feed', key });
check(feed.ok && feed.data.sales.rows.length === 1 && feed.data.sales.rows[0][7] === 5700 && !JSON.stringify(feed.data.sales).includes('0861111111') && !JSON.stringify(feed.data.sales).includes('โรงงานอาหารสัตว์'), 'ABM feed carries sales without phones or buyer names');

console.log('PASS: ' + n + ' checks — 3.3.0 phone-only sign-in (PIN removed), SSO retired, maize, ขายแล้ว');
