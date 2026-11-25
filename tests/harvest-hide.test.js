/* 2.8.0: a plot leaves the market N days after harvest (Config, set by ABM). Harvest date required. "ยังมีวัสดุอยู่". */
const crypto = require('crypto');
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };

const iso = (d) => { const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const day = (k) => { const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + k); return x; };
const key = crypto.randomBytes(32).toString('hex');
const env = load({ sheets: { Config: new Sheet('Config', [HEADERS.Config,
  ['abm_feed_key_sha256', crypto.createHash('sha256').update(key).digest('hex'), 'sha256', 'ABM'],
  ['hide_after_harvest_days', 20, 'วัน', ''], ['hide_after_harvest_start', '2026-01-01', 'วันที่', '']]) } });
const { sheets, get } = env;
const post = (body) => { env.api.doPost({ postData: { contents: JSON.stringify(body) } }); return JSON.parse(env.out().body); };
const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const rpc = (method, args, token) => get({ action: 'rpc', method, args: JSON.stringify(args || []), token: token || '' });

const OWNER = '0811111111';
const F = (id, harvest, renewed, owner) => [id, new Date(), 'ชื่อ' + id, 'สกุล', owner || OWNER, 'ข้าวนาปี', '', harvest, '10 ไร่ 0 งาน 0 ตร.ว.',
  16.2483, 99.8358, 'Open', owner || OWNER, 'ฟางข้าว', '', renewed || '', '', ''];
sheets.users.rows.push([OWNER, '', 'farmer', 'เกษตรกร', false, true, '', '', ''], ['0899999999', '', 'buyer', 'ผู้รับซื้อ', false, true, '', '', '']);
sheets.farmers.rows.push(
  F('d20', day(-20)),                 // day 20 after harvest → still shown
  F('d21', day(-21)),                 // day 21 → hidden
  F('future', day(30)),               // not harvested yet → shown
  F('nodate', ''),                    // 2.8.0: legacy plot without a harvest date → hidden
  F('renewed', day(-90), iso(day(5))),// old harvest, "ยังมีวัสดุอยู่" until +5 days → shown
  F('other', day(-60), '', '0822222222'));

/* 1. public market and the buyer's view use the same rule */
let m = get({ api: 'v1', endpoint: 'market', refresh: '1' }).data;
check(m.totals.plots === 3 && m.listing.hideAfterHarvestDays === 20 && m.listing.hiddenPlots === 3, 'market: d20, future, renewed shown; d21, nodate, other hidden — ' + JSON.stringify(m.listing));
check(/20 วันหลังวันเก็บเกี่ยว/.test(m.notes.listing), 'note on the page');
const buyer = rpc('loginServer', [{ username: '0899999999' }]).result;   // 3.3.0: phone only
const seen = rpc('getMatchingDataServer', [], buyer.token).result.farmers.map((f) => f.id).sort();
check(JSON.stringify(seen) === JSON.stringify(['d20', 'future', 'renewed']), 'buyer sees only listed plots: ' + seen);

/* 2. the farmer sees every own plot, with its market status */
const farmer = rpc('loginServer', [{ username: OWNER }]).result;
const mine = Object.fromEntries(rpc('getUserProfileServer', [], farmer.token).result.farmers.map((f) => [f.id, f]));
check(mine.d20.listed && mine.d20.listedUntil === iso(day(0)) && !mine.d21.listed && mine.d21.hiddenReason === 'after_harvest', 'own plots: listed / until / reason');
check(!mine.nodate.listed && mine.nodate.hiddenReason === 'no_harvest' && mine.d20.hideAfterHarvestDays === 20, 'no harvest date → hidden, says why');

/* 3. "ยังมีวัสดุอยู่": owner only, Open, needs a harvest date; shows N more days from today */
let r = rpc('renewFarmerServer', [{ id: 'd21' }], farmer.token);
check(r.ok && r.result.listedUntil === iso(day(20)) && sheets.farmers.rows.find((x) => x[0] === 'd21')[15] === iso(day(20)), 'renew d21 → P = today + 20');
check(get({ api: 'v1', endpoint: 'market' }).data.totals.plots === 4, '2.8.0 fix: the saved change shows at once (market cache cleared)');
check(!rpc('renewFarmerServer', [{ id: 'other' }], farmer.token).ok, "cannot renew someone else's plot");
check(/วันเก็บเกี่ยว/.test(rpc('renewFarmerServer', [{ id: 'nodate' }], farmer.token).error), 'no harvest date → asks for it');
check(!rpc('renewFarmerServer', [{ id: 'd21' }], buyer.token).ok, 'buyers cannot renew');

/* 4. harvest date required when saving; editing keeps the renewal date */
const base = { role: 'farmer', fname: 'ชื่อ', lname: 'สกุล', phone: OWNER, crop: 'ข้าวนาปี', plantDate: '', area: '5 ไร่ 0 งาน 0 ตร.ว.', lat: 16.3, lng: 99.6 };
r = rpc('saveDataServer', [Object.assign({ harvestDate: '' }, base)], farmer.token);
check(!r.ok && /กรุณาระบุวันเก็บเกี่ยว/.test(r.error), 'save without a harvest date refused on the server: ' + r.error);
r = rpc('saveDataServer', [Object.assign({ id: 'd21', harvestDate: iso(day(-21)) }, base)], farmer.token);
check(r.ok && sheets.farmers.rows.find((x) => x[0] === 'd21')[15] === iso(day(20)), 'edit keeps the "ยังมีวัสดุอยู่" date');

/* 5. 4.0.0: Super Admin of Green Gain Hub sets N; 0 = off; turning on again counts from today. ABM only reads it. */
check(!post({ action: 'abm_config', key: 'x'.repeat(64) }).ok, 'wrong key refused');
r = post({ action: 'abm_config', key });
check(r.ok && r.data.hideAfterHarvestDays === 20, 'ABM reads the rule');
check(!post({ action: 'abm_config', key, hideAfterHarvestDays: 0, by: 'krit' }).ok, 'ABM can no longer set it');
env.props.SUPER_ADMIN_USERNAME = 'krit'; env.props.SUPER_ADMIN_PASSWORD = 'Super12345';
quiet(() => env.api.setupSystem());
const T = post({ method: 'adminLoginServer', args: [{ username: 'krit', password: 'Super12345' }] }).result.token;
const rule = (d) => post({ method: 'marketRuleSaveServer', args: [{ hideAfterHarvestDays: d }], token: T });
[-1, 400, 1.5, ''].forEach((v) => check(!rule(v).ok, 'invalid days refused: ' + v));
r = rule(0);
check(r.ok && r.result.rule.hideAfterHarvestDays === 0 && r.result.rule.hiddenPlots === 0, 'off → nothing hidden');
check(get({ api: 'v1', endpoint: 'market' }).data.totals.plots === 6, 'off → every Open plot on the market');
r = rule(30);
check(r.ok && r.result.rule.hideAfterHarvestDays === 30 && r.result.rule.startDate === iso(day(0)) && r.result.rule.hiddenPlots === 1, 'on again (30) counts from today; only nodate hidden');
r = rule(25);
check(r.ok && r.result.rule.startDate === iso(day(0)), 'changing N keeps the start date');
check(sheets.Config.rows.some((x) => x[0] === 'hide_after_harvest_updated' && /krit/.test(x[3])), 'who changed it last is noted');

/* 6. feed tells ABM which plots are hidden (ids only) */
r = post({ action: 'abm_feed', key });
check(r.ok && r.data.market.hideAfterHarvestDays === 25 && r.data.market.hidden.length === 1 && r.data.market.hidden[0].id === 'nodate' &&
  r.data.market.hidden[0].reason === 'no_harvest' && !JSON.stringify(r.data.market).includes('ชื่อ'), 'feed market listing: ids and reasons only');
console.log('PASS: 2.8.0 market listing after harvest (' + n + ' checks)');
