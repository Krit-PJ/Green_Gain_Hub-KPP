/* 3.1.0: 6-digit PIN (register, first-time set for old accounts, lockout, ABM reset), "ขายแล้ว" records, maize material,
   and the retired central-identity RPCs (a ticket must not skip the PIN). Replaces sso.test.js. */
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

/* register: PIN required, too-simple PINs refused, stored only as a salted hash */
bad(rpc('registerServer', { role: 'farmer', name: 'ใหม่', phone: '0861111111', provinceCode: '62' }), /PIN/, 'PIN required at registration');
bad(rpc('registerServer', { role: 'farmer', name: 'ใหม่', phone: '0861111111', provinceCode: '62', pin: '123456' }), /ง่ายเกินไป/, 'sequence refused');
bad(rpc('registerServer', { role: 'farmer', name: 'ใหม่', phone: '0861111111', provinceCode: '62', pin: '777777' }), /ง่ายเกินไป/, 'same digits refused');
bad(rpc('registerServer', { role: 'farmer', name: 'ใหม่', phone: '0861111111', provinceCode: '62', pin: '12a456' }), /6 หลัก/, '6 digits only');
const reg = rpc('registerServer', { role: 'farmer', name: 'สมใจ ปลูกข้าว', phone: '0861111111', provinceCode: '62', pin: '408215' });
check(reg.ok && reg.result.token, 'registered and signed in');
const urow = sheets.users.rows.find((r) => r[0] === '0861111111');
check(/^pin1\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(urow[1]) && !JSON.stringify(sheets.users.rows).includes('408215'), 'PIN stored as salted SHA-256 only');

/* sign in needs the PIN */
check(rpc('loginServer', { username: '0861111111' }).result.status === 'pin_required', 'phone alone asks for the PIN');
bad(rpc('loginServer', { username: '0861111111', pin: '000001' }), /PIN ไม่ถูกต้อง \(ลองได้อีก 4 ครั้ง\)/, 'wrong PIN counted');
const ok = rpc('loginServer', { username: '0861111111', pin: '408215' });
check(ok.ok && ok.result.status === 'success' && /^[0-9a-f]{64}$/.test(ok.result.token), 'right PIN signs in');
for (let i = 0; i < 5; i++) rpc('loginServer', { username: '0861111111', pin: '000002' });
bad(rpc('loginServer', { username: '0861111111', pin: '408215' }), /รอ 15 นาที/, 'locked after 5 wrong PINs, even with the right one');
cache.delete('pinfail:0861111111');

/* accounts from before 3.1.0: choose a PIN once, then it is needed */
sheets.users.rows.push(['0872222222', '', 'buyer', 'โรงอัดฟาง เดิม', false, true, '', '', '', '62', 'กำแพงเพชร']);
check(rpc('loginServer', { username: '0872222222' }).result.status === 'need_pin', 'old account without PIN: asked to set one');
check(!rpc('loginServer', { username: '0872222222' }).result.token, 'no session before the PIN is set');
const set = rpc('setPinServer', { phone: '0872222222', pin: '590314' });
check(set.ok && set.result.token && set.result.role === 'buyer', 'PIN set → signed in');
bad(rpc('setPinServer', { phone: '0872222222', pin: '111222' }), /ตั้ง PIN แล้ว/, 'cannot overwrite an existing PIN');
check(rpc('loginServer', { username: '0872222222', pin: '590314' }).result.status === 'success', 'then signs in with it');

/* ABM Super Admin clears a forgotten PIN (feed key only) */
const key = crypto.randomBytes(32).toString('hex');
sheets.Config.rows.push(['abm_feed_key_sha256', crypto.createHash('sha256').update(key).digest('hex'), 'sha256', 'ABM']);
const post = (body) => { api.doPost({ postData: { contents: JSON.stringify(body) } }); return JSON.parse(env.out().body); };
check(!post({ action: 'abm_pin_reset', key: 'x'.repeat(64), phone: '0872222222' }).ok, 'reset needs the ABM key');
const rs = post({ action: 'abm_pin_reset', key, phone: '0872222222', by: 'super' });
check(rs.ok && rs.data.reset && rs.data.phone === '087xxxx222', 'reset (masked number in the answer)');
check(rpc('loginServer', { username: '0872222222' }).result.status === 'need_pin', 'after reset the user sets a new PIN');

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

console.log('PASS: ' + n + ' checks — 3.1.0 PIN (register, lockout, first-time set, ABM reset), SSO retired, maize, ขายแล้ว');
