/* 2.4.0–2.6.0 central identity (SSO) for farmers and buyers: ticket redeem, existing-user provisioning, SSO_MODE.
   2.6.0: officers sign in at ABM (tested there); an officer number here is simply a person without a market account.
   Agri-Risk is replaced by a small in-test identity service with the same id_redeem / id_register contract. */
const { load, Sheet, HEADERS } = require('./helpers/gas-mock');
function assert(v, m) { if (!v) throw new Error(m); }
let n = 0; const check = (v, m) => { n++; assert(v, m); };

/* ---- stand-in for Agri-Risk Identity.gs ---- */
const idp = { people: {}, tickets: {}, used: new Set(), calls: [] };
const issue = (phone, aud) => { const t = 't' + Math.random().toString(36).slice(2) + '.sig'; idp.tickets[t] = { phone, aud, exp: Date.now() + 120e3 }; return t; };
const urlFetch = { fetch: (url, opts) => {
  const b = JSON.parse(opts.payload); idp.calls.push(b.action);
  let out;
  if (b.action === 'id_redeem') {
    const t = idp.tickets[b.ticket];
    if (!t) out = { ok: false, error: 'ตั๋วไม่ถูกต้อง' };
    else if (idp.used.has(b.ticket)) out = { ok: false, error: 'ตั๋วนี้ถูกใช้แล้ว' };
    else if (t.aud !== b.aud) out = { ok: false, error: 'ตั๋วนี้ไม่ได้ออกให้ระบบนี้' };
    else { idp.used.add(b.ticket); const p = idp.people[t.phone]; out = p.status === 'active' ? { ok: true, person: p } : { ok: false, error: 'บัญชีถูกระงับหรือไม่พบตัวตน' }; }
  } else if (b.action === 'id_register') {
    if (idp.people[b.phone]) out = { ok: false, error: 'หมายเลขนี้ลงทะเบียนแล้ว กรุณาเข้าสู่ระบบ' };
    else { idp.people[b.phone] = { phone: b.phone, fullName: b.fullName, position: b.position, affiliation: b.affiliation, provinceCode: b.provinceCode, districtName: b.districtName || '', status: 'active', consent: b.consent, system: b.system }; out = { ok: true, token: 'x' }; }
  } else out = { ok: false, error: 'unknown' };
  return { getContentText: () => JSON.stringify(out), getResponseCode: () => 200 };
} };

const env = load({ urlFetch, sheets: { Config: new Sheet('Config', [HEADERS.Config]) } });
const { post, get, sheets, api, props } = env;
console.log = () => {};
api.setupSystem();
const ok = (r, m) => { assert(r.ok, m + ': ' + r.error); return r.result; };
const bad = (r, re, m) => { n++; assert(!r.ok && re.test(r.error), m + ': ' + JSON.stringify(r)); };
const rpc = (method, arg) => get({ action: 'rpc', method, args: JSON.stringify([arg]), callback: '' });

/* existing GGH accounts */
sheets.users.rows.push(['0811111111', '', 'farmer', 'สมชาย ขายฟาง', false, true, '', '', ''], ['0822222222', '', 'buyer', 'มาลี รับซื้อ', false, true, '', '', '']);

/* 1. first sign-in of an existing farmer: identity created from the GGH record, nobody registers twice */
let r = rpc('ssoProvisionServer', { phone: '081-111-1111' });
check(r.ok && r.result.status === 'provisioned', 'existing farmer provisioned: ' + JSON.stringify(r));
const pf = idp.people['0811111111'];
check(pf.fullName === 'สมชาย ขายฟาง' && pf.position === 'เกษตรกร' && pf.provinceCode === '62' && pf.consent === true && pf.system === 'GGH', 'identity from GGH data: ' + JSON.stringify(pf));
check(rpc('ssoProvisionServer', { phone: '0811111111' }).result.status === 'exists', 'second provision says exists');
check(rpc('ssoProvisionServer', { phone: '0899999999' }).result.status === 'none', 'unknown numbers are never sent to Agri-Risk');
check(idp.calls.filter((a) => a === 'id_register').length === 2, 'only GGH numbers reached Agri-Risk');

/* 2. farmer signs in with a ticket → GGH session, same shape as loginServer */
r = rpc('ssoLoginServer', { ticket: issue('0811111111', 'GGH') });
check(r.ok && r.result.status === 'success' && r.result.role === 'farmer' && /^[0-9a-f]{64}$/.test(r.result.token) && r.result.via === 'sso', 'farmer session: ' + JSON.stringify(r));
const prof = get({ action: 'rpc', method: 'getUserProfileServer', args: '[]', callback: '', token: r.result.token });
check(prof.ok && prof.result.role === 'farmer', 'SSO session works for the market app');
const t1 = issue('0811111111', 'GGH'); rpc('ssoLoginServer', { ticket: t1 });
bad(rpc('ssoLoginServer', { ticket: t1 }), /ถูกใช้แล้ว/, 'ticket used once');
bad(rpc('ssoLoginServer', { ticket: issue('0811111111', 'SAM') }), /ไม่ได้ออกให้ระบบนี้/, 'ticket for another system refused');
bad(rpc('ssoLoginServer', { ticket: 'not a ticket' }), /ไม่ถูกต้อง/, 'malformed ticket refused before calling Agri-Risk');

/* 3. identity from another system but no GGH account → need_register, then register with a role (consent required) */
idp.people['0844444444'] = { phone: '0844444444', fullName: 'ประภา จากอากรีริสก์', provinceCode: '62', status: 'active' };
r = rpc('ssoLoginServer', { ticket: issue('0844444444', 'GGH') });
check(r.ok && r.result.status === 'need_register' && r.result.name === 'ประภา จากอากรีริสก์' && !r.result.token, 'need_register: ' + JSON.stringify(r));
bad(rpc('ssoLoginServer', { ticket: issue('0844444444', 'GGH'), role: 'buyer' }), /PDPA/, 'consent required to create the GGH account');
r = rpc('ssoLoginServer', { ticket: issue('0844444444', 'GGH'), role: 'buyer', consent: true });
check(r.ok && r.result.role === 'buyer' && sheets.users.rows.some((x) => x[0] === '0844444444' && x[2] === 'buyer' && x[5] === true), 'buyer created from identity');

/* 4. 2.6.0: no officer accounts here — an officer number is provisioned only if it has a market account */
check(rpc('ssoProvisionServer', { phone: '0833333333' }).result.status === 'none', 'officer-only numbers are not sent from Green Gain Hub');
idp.people['0833333333'] = { phone: '0833333333', fullName: 'วิชัย เกษตรอำเภอ', status: 'active' };
r = rpc('ssoLoginServer', { ticket: issue('0833333333', 'GGH') });
check(r.ok && r.result.status === 'need_register', 'an officer identity without a market account may register as farmer/buyer: ' + JSON.stringify(r));
bad(rpc('ssoLoginServer', { ticket: issue('0833333333', 'ABM') }), /ไม่ได้ออกให้ระบบนี้/, 'an ABM ticket is refused here');

/* 6. suspended in Agri-Risk ("not me") → refused here at once */
idp.people['0811111111'].status = 'suspended';
bad(rpc('ssoLoginServer', { ticket: issue('0811111111', 'GGH') }), /ระงับ/, 'suspended identity refused');

/* 7. SSO_MODE */
check(rpc('loginServer', { username: '0822222222' }).ok, 'optional: old phone sign-in still works');
props.SSO_MODE = 'required';
check(rpc('loginServer', { username: '0822222222' }).ok, '2.9.3 required: market phone sign-in stays open (GGH-only users)');
check(rpc('registerServer', { role: 'farmer', name: 'ลงทะเบียน ใหม่', phone: '0877777777' }).ok, 'required: new registration still possible (no takeover)');
props.SSO_MODE = 'off';
bad(rpc('ssoLoginServer', { ticket: issue('0822222222', 'GGH') }), /ปิดใช้งาน/, 'off: SSO closed');
check(rpc('loginServer', { username: '0822222222' }).ok, 'off: old sign-in works');
check(rpc('ssoProvisionServer', { phone: '0822222222' }).result.status === 'off', 'off: nothing sent to Agri-Risk');
check(api.doGet && JSON.parse((api.doGet({ parameter: { api: 'v1', endpoint: 'health' } }), env.out().body)).feature === 'MARKET_ONLY', 'health shows the current feature flag');

console.info('PASS: ' + n + ' checks — GGH 2.6.0 farmer/buyer central identity (SSO)');
