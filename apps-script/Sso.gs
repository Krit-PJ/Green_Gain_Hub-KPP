/**
 * Green Gain Hub 2.6.0 (since 2.4.0) — farmer/buyer sign-in through the central identity (SSO) shared with Agri-Risk Map,
 * KPP Smart Agri-Materials and ABM. Officers sign in at ABM since 19 Nov 2026 (aud ABM there).
 *
 * Who signs in how (decided 18 Nov 2026; 21 Nov 2026: farmers and buyers use Green Gain Hub only):
 *   - farmers and buyers: phone number only; registered here = identity scope "market" at Agri-Risk (Green Gain Hub only)
 *   - officers, Mini Super Admin and Super Admin: ABM (since 19 Nov 2026)
 *
 * Agri-Risk Map holds the identity ("this person owns this phone"). Rights stay here: the users sheet
 * decides farmer/buyer. The browser gets a one-use ticket from
 * Agri-Risk (2 minutes, for GGH only) and this script redeems it server-side (id_redeem) — no shared
 * secret is copied between systems.
 *
 * Script Properties (optional):
 *   SSO_MODE    = off | optional (default) | required — required closes the old phone-only sign-in
 *   SSO_IDP_URL = Agri-Risk web app /exec URL (default below)
 *   SSO_PROVINCE_CODE = province code for identities created from this system (default 62)
 */
const SSO_IDP_DEFAULT = 'https://script.google.com/macros/s/AKfycbzAgSOxgQsaOx9bqBYM53KXFzk1QKsop46HZeINgtUzLXkaZTYYaZH3RZu0l-HDlN8TKA/exec';
const SSO_AUD = 'GGH';

function ggSsoMode_() {
  const m = String(PropertiesService.getScriptProperties().getProperty('SSO_MODE') || 'optional').toLowerCase();
  return ['off', 'optional', 'required'].indexOf(m) >= 0 ? m : 'optional';
}
function ggSsoIdp_() { return PropertiesService.getScriptProperties().getProperty('SSO_IDP_URL') || SSO_IDP_DEFAULT; }
/** The old phone-only sign-in is closed when SSO is required. */
function ssoGuardLegacy_() {
  if (ggSsoMode_() === 'required') throw new Error('SSO_REQUIRED: กรุณาเข้าสู่ระบบด้วยเบอร์โทรผ่านตัวตนกลาง (โหลดหน้าเว็บใหม่แล้วลองอีกครั้ง)');
}

function ssoIdpCall_(body) {
  const res = UrlFetchApp.fetch(ggSsoIdp_(), { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(body), muteHttpExceptions: true, followRedirects: true });
  let data;
  try { data = JSON.parse(res.getContentText()); } catch (e) { throw new Error('เชื่อมต่อระบบตัวตนกลางไม่สำเร็จ กรุณาลองใหม่'); }
  return data;
}
/** Redeems a ticket at Agri-Risk → person { phone, fullName, ... } */
function ssoRedeem_(ticket) {
  if (ggSsoMode_() === 'off') throw new Error('ระบบตัวตนกลางปิดใช้งานชั่วคราว กรุณาเข้าสู่ระบบด้วยวิธีเดิม');
  if (!/^[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+$/.test(String(ticket || ''))) throw new Error('ตั๋วเข้าสู่ระบบไม่ถูกต้อง');
  const r = ssoIdpCall_({ action: 'id_redeem', ticket: String(ticket), aud: SSO_AUD });
  if (!r || !r.ok || !r.person) throw new Error(String(r && r.error || 'ยืนยันตัวตนไม่สำเร็จ'));
  const phone = normalizePhone_(r.person.phone);
  if (!/^0\d{9}$/.test(phone)) throw new Error('เบอร์โทรของตัวตนกลางไม่ถูกต้อง');
  r.person.phone = phone;
  return r.person;
}

function ssoMarketSession_(phone, role, name) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const session = { phone: phone, role: role, name: cleanText_(name, 150) };
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(session), sessionTtlSeconds_());
  return { status: 'success', success: true, token: token, phone: phone, role: role, name: session.name, via: 'sso' };
}

/**
 * Farmer/buyer sign-in with a ticket. { ticket, role?, consent? }
 *   - phone is in users → signed in
 *   - phone not in users and no role given → { status: 'need_register', phone, name } (page asks farmer or buyer)
 *   - role given → a users row is created from the identity (consent required) and signed in
 */
function ssoLoginServer(input) {
  input = input || {};
  const person = ssoRedeem_(input.ticket);
  const phone = person.phone;
  const found = dataRows_(sheet_('users')).find(function (r) { return normalizePhone_(r[0]) === phone; });
  if (found) return ssoMarketSession_(phone, normalizeRole_(found[2]), found[3] || person.fullName);
  if (!input.role) return { status: 'need_register', phone: phone, name: cleanText_(person.fullName, 150) };
  if (input.consent !== true && input.consent !== 'true') throw new Error('กรุณาอ่านและติ๊กยินยอมการใช้ข้อมูลส่วนบุคคล (PDPA) ก่อนลงทะเบียน');
  const role = normalizeRole_(input.role);
  const name = cleanText_(input.name || person.fullName, 150);
  if (!name) throw new Error('กรุณากรอกชื่อ');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('users');
    ensureSheetDataFormats_();
    if (!dataRows_(sh).some(function (r) { return normalizePhone_(r[0]) === phone; })) {
      const now = new Date();
      sh.appendRow([phone, '', role, name, false, true, now, now, now]);
    }
  } finally {
    lock.releaseLock();
  }
  const out = ssoMarketSession_(phone, role, name);
  out.message = 'ลงทะเบียนสำเร็จ เข้าใช้งานได้ทันที';
  return out;
}

/**
 * First sign-in of an existing GGH user: creates the central identity from the GGH record, so nobody registers twice.
 * { phone } → { status: 'provisioned' | 'exists' | 'none' }. Only numbers already in this system are sent to Agri-Risk.
 */
function ssoProvisionServer(input) {
  if (ggSsoMode_() === 'off') return { status: 'off' };
  const phone = normalizePhone_(input && input.phone);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  const prov = PropertiesService.getScriptProperties().getProperty('SSO_PROVINCE_CODE') || '62';
  let body = null;
  const u = dataRows_(sheet_('users')).find(function (r) { return normalizePhone_(r[0]) === phone; });
  if (u) {
    body = { fullName: cleanText_(u[3], 120), position: normalizeRole_(u[2]) === 'buyer' ? 'ผู้รับซื้อ' : 'เกษตรกร', affiliation: '' };
  }
  if (!body) return { status: 'none' };
  // Consent: users gave PDPA consent when registering in GGH.
  const r = ssoIdpCall_(Object.assign({ action: 'id_register', phone: phone, provinceCode: prov, consent: true, system: SSO_AUD, device: 'Green Gain Hub (ย้ายบัญชีเดิม)' }, body));
  if (r && r.ok) return { status: 'provisioned' };
  if (r && /ลงทะเบียนแล้ว/.test(String(r.error || ''))) return { status: 'exists' };
  throw new Error(String(r && r.error || 'สร้างตัวตนกลางไม่สำเร็จ'));
}
