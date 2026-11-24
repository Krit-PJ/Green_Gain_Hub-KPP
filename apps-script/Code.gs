/**
 * Green Gain Hub 3.0.0 — ศูนย์กลางเชื่อมโยงการซื้อ-ขายวัสดุเหลือใช้ทางการเกษตร สำหรับเกษตรกรและผู้รับซื้อ ทุกจังหวัด
 * (API-only bridge from GitHub Pages to Google Sheets).
 *
 * 3.1.0: 6-digit PIN for every account, "ขายแล้ว" records (sales sheet) and maize (ซังข้าวโพด) as a material — Pin.gs.
 * 3.0.0: all 77 provinces. Every plot / buyer point carries Province…Subdistrict decided by the server from its pin
 * (Geo.gs, farmers S:X, buyers R:W), every user a province (users J:K, chosen at registration). The public market,
 * the signed-in map and the district table are per province; ABM (Kamphaeng Phet officers) reads only its province.
 *
 * 19 Nov 2026: the officer side moved to ABM — ระบบบริหารจัดการวัสดุเหลือใช้ทางการเกษตร
 * (records, GHG, value, targets, reports, crop data, officer accounts, executive dashboard):
 *   https://krit-pj.github.io/KPP-Agri-Byproduct-Management/
 * This system keeps what farmers and buyers use and own: their accounts, plots for sale, buyers, the matching map.
 * ABM reads plots and buyers through the server-to-server feed below (abmFeed_); it never copies them.
 *
 * Files: Code.gs (this), Market.gs (public matching map), Sso.gs (farmer/buyer sign-in through the central identity),
 *        Abm.gs (link to ABM: residue rates, managed area, helpers), Counter.gs (visit counter), Geo.gs (77 provinces:
 *        which province / district / subdistrict a pin is in), Districts.gs (Kamphaeng Phet only — fallback before 3.0.0).
 * Database: Google Sheets (users, farmers, buyers, Config, visit_stats). The officer sheets that used to live in the same
 * file stay there untouched as an archive (ABM has its own database since 19 Nov 2026).
 *
 * Endpoints (same /exec URL):
 *   ?action=rpc&method=...            JSONP RPC used by the logged-in market app (unchanged)
 *   ?api=v1&endpoint=market           Public matching map (aggregate grid, no personal data; 2.7.0 + harvest timing, districts)
 *   ?api=v1&endpoint=hit | visits     Visit counter (count once per session | read)
 *   ?api=v1&endpoint=health           Public version check
 *   POST {action:'abm_feed', key}     Server-to-server feed for ABM (2.5.1; 2.8.0 + market listing rule)
 *   POST {action:'abm_config', key}   ABM officers set how long a plot stays on the market after harvest (2.8.0)
 *
 * 2.9.0: farmers and buyers use Green Gain Hub only (Agri-Risk identity scope "market"); the ABM feed carries SHA-256 of
 * their phone numbers so ABM can refuse them as officers.
 * 2.8.0: a plot is shown until N days after its harvest date (Market.gs farmerListing_, Config hide_after_harvest_days,
 * default 20, set in ABM). A harvest date is required when saving. "ยังมีวัสดุอยู่" (renewFarmerServer) shows it N more days.
 */
const APP_VERSION = '3.1.0';
// Database 1.5.0: "Green Gain Hub KPP — Database (v1.5.0)" in Drive folder "7. Green Gain Hub".
// Script Property SPREADSHEET_ID overrides this value when set.
const DEFAULT_SPREADSHEET_ID = '1TU2kC7kzJbb9JZzo4m7D3eOmcW8Ra_osic33rolE-Hw';
const DEFAULT_SESSION_TTL_SECONDS = 21600; // 6 hours
const MATERIAL_TYPES = ['ฟางข้าว', 'ใบอ้อย', 'ซังข้าวโพด', 'เหง้ามันสำปะหลัง', 'อื่นๆ'];   // 3.1.0 + ซังข้าวโพด
const CROP_MATERIAL_MAP = {
  'ข้าวนาปี': 'ฟางข้าว',
  'ข้าวนาปรัง': 'ฟางข้าว',
  'อ้อยโรงงาน': 'ใบอ้อย',
  'ข้าวโพดเลี้ยงสัตว์': 'ซังข้าวโพด',
  'มันสำปะหลัง': 'เหง้ามันสำปะหลัง'
};
// 3.1.0: ssoLoginServer / ssoProvisionServer retired (unused since 2.9.3) — a central-identity ticket must not skip the PIN.
const PUBLIC_METHODS = ['loginServer', 'registerServer', 'setPinServer', 'getApiInfoServer'];
const PRIVATE_METHODS = ['getUserProfileServer', 'saveDataServer', 'deleteDataServer', 'getMatchingDataServer', 'renewFarmerServer', 'markSoldServer'];

/** JSONP endpoint used by the static GitHub Pages frontend. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(p.callback || '') ? p.callback : '';
  if (p.api) return publicApiResponse_(p, callback);
  let payload;
  try {
    if (p.action !== 'rpc') throw new Error('Invalid action');
    const method = String(p.method || '');
    const args = p.args ? JSON.parse(p.args) : [];
    if (!Array.isArray(args)) throw new Error('Invalid arguments');
    if (PUBLIC_METHODS.indexOf(method) < 0 && PRIVATE_METHODS.indexOf(method) < 0) {
      throw new Error('Method not allowed');
    }
    const session = PRIVATE_METHODS.indexOf(method) >= 0 ? requireSession_(p.token) : null;
    payload = { ok: true, result: apiMethods_()[method](args, session) };
  } catch (err) {
    payload = { ok: false, error: publicError_(err) };
  }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const body = callback ? callback + '(' + json + ');' : json;
  return ContentService.createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function apiMethods_() {
  return {
    loginServer: function (args) { return loginServer(args[0]); },
    registerServer: function (args) { return registerServer(args[0]); },
    setPinServer: function (args) { return setPinServer(args[0]); },
    markSoldServer: function (args, session) { return markSoldServer(args[0], session); },
    getApiInfoServer: function () { return getApiInfoServer(); },
    ssoLoginServer: function (args) { return ssoLoginServer(args[0]); },
    ssoProvisionServer: function (args) { return ssoProvisionServer(args[0]); },
    getUserProfileServer: function (args, session) { return getUserProfileServer(session); },
    saveDataServer: function (args, session) { return saveDataServer(args[0], session); },
    deleteDataServer: function (args, session) { return deleteDataServer(args[0], session); },
    getMatchingDataServer: function (args, session) { return getMatchingDataServer(session, args[0]); },
    renewFarmerServer: function (args, session) { return renewFarmerServer(args[0], session); }
  };
}

/** Public, non-sensitive deployment check used to detect a stale Apps Script version. */
function getApiInfoServer() {
  return {
    status: 'success',
    success: true,
    apiVersion: APP_VERSION,
    feature: 'MARKET_ONLY'
  };
}

/* ------------------------------------------------------------------------- *
 * Public API v1 — aggregate-only. Never returns names, phone numbers,
 * record IDs or plot coordinates, so it is safe for the public landing page.
 * ------------------------------------------------------------------------- */

function publicApiResponse_(p, callback) {
  let payload;
  try {
    if (String(p.api) !== 'v1') throw new Error('Unsupported API version');
    requireSummaryKey_(p.key);
    const endpoint = String(p.endpoint || 'summary');
    if (endpoint === 'summary' || endpoint === 'residue' || endpoint === 'balance' || endpoint === 'crop') {
      // 2.6.0: these moved to ABM with the officer side — the answer says where to find them.
      payload = { ok: false, api: 'v1', endpoint: endpoint, apiVersion: APP_VERSION, moved: 'ABM', url: abmApiUrl_(),
        error: 'ย้ายไปที่ระบบบริหารจัดการวัสดุเหลือใช้ทางการเกษตร (ABM): ' + ABM_SITE_URL };
    } else if (endpoint === 'hit') {
      payload = { ok: true, api: 'v1', endpoint: endpoint, apiVersion: APP_VERSION, data: recordVisit_() };
    } else if (endpoint === 'visits') {
      payload = { ok: true, api: 'v1', endpoint: endpoint, apiVersion: APP_VERSION, data: visitCounts_(false) };
    } else if (endpoint === 'market') {
      payload = { ok: true, api: 'v1', endpoint: endpoint, apiVersion: APP_VERSION, data: getMarketPublic_(p) };
    } else if (endpoint === 'health') {
      payload = { ok: true, api: 'v1', endpoint: endpoint, apiVersion: APP_VERSION, feature: getApiInfoServer().feature, system: 'GGH',
        generatedAt: new Date().toISOString() };
    } else {
      throw new Error('Unknown endpoint');
    }
  } catch (err) {
    payload = { ok: false, api: 'v1', error: publicError_(err) };
  }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const body = callback ? callback + '(' + json + ');' : json;
  return ContentService.createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

/**
 * Optional gate. When Script Property SUMMARY_API_KEY is empty (default) the
 * summary is open. A key used by a public web page is visible to anyone, so it
 * only limits casual reuse; the real protection is that the summary is aggregate-only.
 */
function requireSummaryKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('SUMMARY_API_KEY');
  if (expected && String(key || '') !== String(expected)) throw new Error('Invalid API key');
}

/** "20 ไร่ 1 งาน 25 ตร.ว." → 20.3125 rai. A bare number is read as rai. */
function parseAreaRai_(value) {
  if (typeof value === 'number') return isFinite(value) && value > 0 ? value : 0;
  const s = String(value || '').replace(/,/g, '');
  const rai = s.match(/([\d.]+)\s*ไร่/);
  const ngan = s.match(/([\d.]+)\s*งาน/);
  const wa = s.match(/([\d.]+)\s*(?:ตร\.?\s*ว|ตารางวา)/);
  if (rai || ngan || wa) {
    return (rai ? Number(rai[1]) : 0) + (ngan ? Number(ngan[1]) / 4 : 0) + (wa ? Number(wa[1]) / 400 : 0);
  }
  const n = Number(s.trim());
  return isFinite(n) && n > 0 ? n : 0;
}

/** "20 ตัน/วัน" → 20 */
function leadingNumber_(value) {
  if (typeof value === 'number') return isFinite(value) && value > 0 ? value : 0;
  const m = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function round_(n, digits) {
  const f = Math.pow(10, digits || 0);
  return Math.round((Number(n) || 0) * f) / f;
}

/** District list from Districts.gs; empty when that file is not installed. */
function districtList_() {
  if (typeof KPP_DISTRICTS === 'undefined' || !KPP_DISTRICTS.features) return [];
  return KPP_DISTRICTS.features.map(function (f) {
    return { code: f.properties.code, name: f.properties.name, geometry: f.geometry };
  });
}

function districtForPoint_(lat, lng, districts) {
  for (let i = 0; i < districts.length; i++) {
    if (pointInGeometry_(lng, lat, districts[i].geometry)) return districts[i];
  }
  return null;
}

function pointInGeometry_(x, y, geometry) {
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(function (rings) {
    if (!pointInRing_(x, y, rings[0])) return false;
    for (let h = 1; h < rings.length; h++) if (pointInRing_(x, y, rings[h])) return false;
    return true;
  });
}

function pointInRing_(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------------- *
 * KPP Smart Agri-Materials reports (read-only proxy).
 * Calls the external Data API v1 server-side so the API key never reaches
 * the browser. Failures return { ok:false } and never break the GGH summary.
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * 2.5.1 — feed for ABM (ระบบบริหารจัดการวัสดุเหลือใช้ทางการเกษตร), server-to-server only.
 * ABM keeps its own officer data and reads the market registry from here instead of copying it.
 * POST {action:'abm_feed', key} → farmers + buyers rows (sheet column order). ABM made the key by code and wrote only its
 * SHA-256 to Config (abm_feed_key_sha256); the key itself is never stored in this project or its sheet.
 * ------------------------------------------------------------------------- */
const ABM_FEED_HASH_PARAM = 'abm_feed_key_sha256';

function abmSha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function abmCheckKey_(body) {
  const expected = String(setting_(ABM_FEED_HASH_PARAM, '') || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('Feed not configured');
  const key = String((body && body.key) || '');
  if (key.length < 32 || abmSha256Hex_(key) !== expected) throw new Error('Invalid feed key');
}

/** 2.8.0: the listing rule and which Open plots are not shown on the market today (ids only). */
function marketListingInfo_() {
  const rule = marketHideRule_();
  const today = startOfDay_(new Date());
  const hidden = [];
  let listed = 0;
  dataRows_(sheet_('farmers')).forEach(function (r) {
    if (String(r[11] || '').trim().toLowerCase() !== 'open') return;
    const l = farmerListing_(r, rule, today);
    if (l.listed) listed++; else hidden.push({ id: text_(r[0]), reason: l.reason });
  });
  return { hideAfterHarvestDays: rule.days, startDate: rule.start ? dateInput_(rule.start) : '', listedPlots: listed, hiddenPlots: hidden.length, hidden: hidden };
}

/** 2.8.0: ABM (Super/Mini Super Admin) sets N. Turning the rule on again counts listed plots from today. */
function abmConfig_(body) {
  abmCheckKey_(body);
  if (body.hideAfterHarvestDays !== undefined) {
    const days = hideDaysValid_(body.hideAfterHarvestDays);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const before = marketHideRule_();
      const start = days > 0 && (!before.days || !before.start) ? dateInput_(new Date()) : (before.start ? dateInput_(before.start) : '');
      hideRuleWrite_(days, start);
      settingWrite_('hide_after_harvest_updated', new Date(), 'วันที่', 'แก้ไขล่าสุดโดย ABM: ' + cleanText_(body.by || '', 80));
    } finally { lock.releaseLock(); }
    invalidateSummary_();
  }
  return marketListingInfo_();
}

function abmFeed_(body) {
  abmCheckKey_(body);
  // 3.0.0: ABM is the officers' system of one province (default กำแพงเพชร) — it reads only that province's rows
  const province = text_(body.province) || DEFAULT_PROVINCE_CODE;
  geoMigrateSafe_();
  const pack = function (kind) {
    const sh = sheet_(kind);
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    const rows = lastRow >= 2 && lastCol ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
    return {
      headers: lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [],
      rows: rows.filter(function (r) { return (rowProvince_(r, kind) || DEFAULT_PROVINCE_CODE) === province; })
    };
  };
  // 2.9.0: farmers and buyers use Green Gain Hub only — ABM refuses these numbers as officers (SHA-256 only, never the numbers)
  const marketPhones = dataRows_(sheet_('users')).map(function (r) { return normalizePhone_(r[0]); })
    .filter(function (p) { return /^0\d{9}$/.test(p); }).map(abmSha256Hex_);
  return { apiVersion: APP_VERSION, generatedAt: new Date().toISOString(), province: province, farmers: pack('farmers'), buyers: pack('buyers'), market: marketListingInfo_(),
    marketPhones: marketPhones, sales: salesForFeed_(province) };   // 3.1.0: real sales (no phones / buyer names)
}

/** 2.6.0: the only POSTs are from ABM (the officer/admin API moved there): the feed and, 2.8.0, the market listing rule. */
function doPost(e) {
  let payload;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'abm_feed') payload = { ok: true, data: abmFeed_(body) };
    else if (body.action === 'abm_config') payload = { ok: true, data: abmConfig_(body) };
    else if (body.action === 'abm_pin_reset') payload = { ok: true, data: abmPinReset_(body) };   // 3.1.0
    else throw new Error('หน้าเจ้าหน้าที่ย้ายไปที่ระบบบริหารจัดการวัสดุเหลือใช้ทางการเกษตร (ABM): ' + ABM_SITE_URL);
  } catch (err) {
    payload = { ok: false, error: publicError_(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

/** Saves change the dashboard immediately instead of waiting for the cache to expire. */
function invalidateSummary_() {
  // 2.8.0 fix: 2.7.0 renamed the market cache (market:v2) but this still removed the old name, so saves waited up to 5 min
  // 3.0.0: one cache per province — clear every one that was built
  try { const c = CacheService.getScriptCache(); c.removeAll([MARKET_CACHE_PREFIX + APP_VERSION].concat(marketCacheKeys_())); } catch (err) { /* best effort */ }
}

function loginServer(input) {
  input = input || {};
  // 2.9.3: farmers and buyers use Green Gain Hub only — phone sign-in here is always open (SSO_MODE no longer closes it).
  const phone = normalizePhone_(input.phone || input.telephone || input.username || input);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  geoMigrateSafe_();
  const rows = dataRows_(sheet_('users'));
  const found = rows.find(function (r) { return normalizePhone_(r[0]) === phone; });
  if (!found) throw new Error('ไม่พบหมายเลขโทรศัพท์นี้ในระบบ กรุณาลงทะเบียน');
  // 3.1.0: the PIN is needed; an account from before 3.1.0 chooses one first (setPinServer)
  if (!hasPin_(found)) return { status: 'need_pin', success: true, phone: phone, message: 'บัญชีนี้ยังไม่มี PIN กรุณาตั้ง PIN 6 หลัก (ครั้งเดียว)' };
  if (!String(input.pin || '').trim()) return { status: 'pin_required', success: true, phone: phone, message: 'กรุณาใส่ PIN 6 หลัก' };
  pinCheck_(phone, found, String(input.pin).trim());
  return newSession_(phone, found);
}

function registerServer(input) {
  input = input || {};
  const phone = normalizePhone_(input.phone || input.telephone);
  const role = normalizeRole_(input.role || input.status);
  const name = cleanText_(input.name, 150);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  if (!name) throw new Error('กรุณากรอกชื่อ');
  const province = registerProvince_(input.provinceCode || input.province);   // 3.0.0: required
  const pin = pinValid_(input.pin);   // 3.1.0: required
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('users');
    ensureSheetDataFormats_();
    if (dataRows_(sh).some(function (r) { return normalizePhone_(r[0]) === phone; })) {
      throw new Error('หมายเลขโทรศัพท์นี้ลงทะเบียนแล้ว');
    }
    const now = new Date();
    ensureGeoColumns_();
    // A:I = Telephone, Password(legacy/unused), Role, Name, System, Consent, Consent_Timestamp, Created_At, Updated_At
    // J:K (3.0.0) = Province_Code, Province
    sh.appendRow([phone, pinRecord_(pin), role, name, false, true, now, now, now, province.code, province.name]);
  } finally {
    lock.releaseLock();
  }
  // 2.2.1: signed in at once (same session as loginServer), so a new farmer or buyer goes straight to the form.
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('session:' + token, JSON.stringify({ phone: phone, role: role, name: name, province: province.code }), sessionTtlSeconds_());
  return { status: 'success', success: true, token: token, phone: phone, role: role, name: name, province: province, message: 'ลงทะเบียนสำเร็จ เข้าใช้งานได้ทันที' };
}

/** 3.0.0: { code, name } of a registered user (users J:K), กำแพงเพชร for rows not filled yet. */
function userProvince_(row) {
  const code = text_(row[USER_GEO_COL - 1]) || DEFAULT_PROVINCE_CODE;
  let name = text_(row[USER_GEO_COL]);
  if (!name) { try { const p = geoProvinceByCode_(code); name = p ? p.name : ''; } catch (e) { /* offline */ } }
  return { code: code, name: name || (code === DEFAULT_PROVINCE_CODE ? 'กำแพงเพชร' : '') };
}

function registerProvince_(code) {
  code = text_(code);
  if (!code) throw new Error('กรุณาเลือกจังหวัด');
  const p = geoProvinceByCode_(code);
  if (!p) throw new Error('กรุณาเลือกจังหวัดจากรายการ');
  return { code: p.code, name: p.name };
}

/** Fills provinces once after 3.0.0 is deployed; never stops the request that triggered it. */
function geoMigrateSafe_() {
  try {
    if (PropertiesService.getScriptProperties().getProperty(GEO_MIGRATION_PROP) === GEO_MIGRATION_VERSION) return;
    console.log(geoMigrate_(false));
  } catch (err) { console.warn('geoMigrate_: ' + err); }
}

function getUserProfileServer(session) {
  const user = dataRows_(sheet_('users')).find(function (r) { return normalizePhone_(r[0]) === session.phone; });
  const province = user ? userProvince_(user) : { code: session.province || DEFAULT_PROVINCE_CODE, name: '' };
  if (session.role === 'farmer') {
    const farmers = farmerRecords_(session.phone);
    return { status: farmers.length ? 'success' : 'not_found', success: true, role: 'farmer', name: session.name, province: province, farmers: farmers, sales: salesOf_(session.phone),
      message: farmers.length ? '' : 'ยังไม่มีข้อมูลแปลง กรุณาเพิ่มข้อมูล' };
  }
  const buyers = buyerRecords_(session.phone);
  return { status: buyers.length ? 'success' : 'not_found', success: true, role: 'buyer', name: session.name, province: province, buyers: buyers,
    message: buyers.length ? '' : 'ยังไม่มีข้อมูลการรับซื้อ กรุณาเพิ่มข้อมูล' };
}

function saveDataServer(data, session) {
  data = data || {};
  const requestedRole = normalizeRole_(data.role || session.role);
  if (requestedRole !== session.role) throw new Error('ไม่มีสิทธิ์บันทึกข้อมูลของบทบาทนี้');
  return requestedRole === 'farmer' ? saveFarmer_(data, session) : saveBuyer_(data, session);
}

function deleteDataServer(input, session) {
  input = input || {};
  const id = cleanText_(typeof input === 'object' ? input.id : input, 100);
  const role = normalizeRole_(typeof input === 'object' ? (input.role || session.role) : session.role);
  if (!id || role !== session.role) throw new Error('ไม่มีสิทธิ์ลบข้อมูลนี้');
  const sh = sheet_(role === 'farmer' ? 'farmers' : 'buyers');
  const ownerColumn = 13;
  const statusColumn = role === 'farmer' ? 12 : 12;
  const row = findOwnedRow_(sh, id, session.phone, ownerColumn);
  if (!row) throw new Error('ไม่พบข้อมูล หรือคุณไม่มีสิทธิ์แก้ไขข้อมูลนี้');
  sh.getRange(row, statusColumn).setValue('Deleted');
  sh.getRange(row, role === 'farmer' ? 18 : 16).setValue(new Date());
  invalidateSummary_();
  return { status: 'success', success: true, message: 'ลบข้อมูลแล้ว' };
}

/** 2.8.0 "ยังมีวัสดุอยู่": the owner shows an Open plot on the market for N more days from today. */
function renewFarmerServer(input, session) {
  if (session.role !== 'farmer') throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
  const id = cleanText_(typeof input === 'object' && input ? input.id : input, 100);
  const sh = sheet_('farmers');
  const row = id ? findOwnedRow_(sh, id, session.phone, 13) : 0;
  if (!row) throw new Error('ไม่พบข้อมูล หรือคุณไม่มีสิทธิ์แก้ไขข้อมูลนี้');
  const r = sh.getRange(row, 1, 1, 18).getValues()[0];
  if (String(r[11] || '').trim().toLowerCase() !== 'open') throw new Error('แปลงนี้ไม่ได้ประกาศขายอยู่');
  if (!toDate_(r[7])) throw new Error('กรุณาระบุวันเก็บเกี่ยวแล้วกดบันทึกก่อน');
  const rule = marketHideRule_();
  if (!rule.days) return { status: 'success', success: true, listed: true, listedUntil: '', message: 'ตลาดแสดงทุกแปลงอยู่แล้ว' };
  const until = new Date(startOfDay_(new Date()).getTime() + rule.days * 86400000);
  sh.getRange(row, 16).setValue(dateInput_(until));
  sh.getRange(row, 18).setValue(new Date());
  invalidateSummary_();
  return { status: 'success', success: true, listed: true, listedUntil: dateInput_(until),
    message: 'แสดงแปลงบนตลาดต่อถึงวันที่ ' + dateInput_(until) };
}

function getMatchingDataServer(session, input) {
  // Enforce partner-only visibility at the API layer. Empty arrays are retained
  // for backward compatibility with the existing Frontend response structure.
  // 3.0.0: partners of one province (asked for, else the user's own) — contacts are never sent for the whole country.
  const isFarmer = session.role === 'farmer';
  const province = text_(input && input.province) || session.province || DEFAULT_PROVINCE_CODE;
  const inProvince = function (kind) { return function (r) { return (rowProvince_(r, kind) || DEFAULT_PROVINCE_CODE) === province; }; };
  const farmers = isFarmer ? [] : openFarmersWithCoordinates_().filter(inProvince('farmers')).map(farmerPublic_);
  const buyers = isFarmer ? activeBuyersWithCoordinates_().filter(inProvince('buyers')).map(buyerPublic_) : [];
  const ownPlots = isFarmer ? ownFarmerPlotsWithCoordinates_(session.phone).map(farmerPublic_) : [];
  return {
    status: 'success',
    success: true,
    apiVersion: APP_VERSION,
    province: province,
    viewerRole: session.role,
    visibleRole: isFarmer ? 'buyer' : 'farmer',
    farmers: farmers,
    buyers: buyers,
    ownPlots: ownPlots,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Single source of truth for the buyer's "ALL" option: Open plots with coordinates that are on the market today
 * (2.8.0 farmerListing_: until N days after harvest, or the "ยังมีวัสดุอยู่" date). Map_Visible is not used.
 */
function openFarmersWithCoordinates_() {
  const rule = marketHideRule_();
  const today = startOfDay_(new Date());
  return dataRows_(sheet_('farmers')).filter(function (r) {
    return String(r[11] || '').trim().toLowerCase() === 'open' &&
      hasCoordinates_(r[9], r[10]) && farmerListing_(r, rule, today).listed;
  });
}

/** Returns only Active buyers with valid coordinates. */
function activeBuyersWithCoordinates_() {
  return dataRows_(sheet_('buyers')).filter(function (r) {
    return String(r[11] || '').trim().toLowerCase() === 'active' &&
      hasCoordinates_(r[5], r[6]);
  });
}

/** Every non-deleted plot owned by the logged-in farmer that has coordinates. */
function ownFarmerPlotsWithCoordinates_(phone) {
  return dataRows_(sheet_('farmers')).filter(function (r) {
    return isOwned_(r, phone, 12) &&
      String(r[11] || '').trim().toLowerCase() !== 'deleted' &&
      hasCoordinates_(r[9], r[10]);
  });
}

function saveFarmer_(data, session) {
  const sh = sheet_('farmers');
  ensureSheetDataFormats_();
  const crop = cleanText_(data.crop, 150);
  const material = farmerMaterialForCrop_(crop, data.materialType, data.materialOther);
  const harvest = parseDate_(data.harvestDate || data.havestDate, 'วันเก็บเกี่ยว');
  if (!harvest) throw new Error('กรุณาระบุวันเก็บเกี่ยว');   // 2.8.0: required (the market shows a plot until N days after it)
  const plant = parseDate_(data.plantDate, 'วันเพาะปลูก');
  if (plant && harvest && plant.getTime() > harvest.getTime()) throw new Error('วันเก็บเกี่ยวต้องไม่ก่อนวันเพาะปลูก');
  const id = cleanText_(data.id, 100) || newId_();
  const now = new Date();
  const rowValues = [
    id, now, cleanText_(data.fname, 100), cleanText_(data.lname, 100),
    normalizeContactPhone_(data.phone || session.phone), crop, plant || '', harvest || '',
    cleanText_(data.area, 80), numberInRange_(data.lat, -90, 90, 'ละติจูด'),
    numberInRange_(data.lng, -180, 180, 'ลองจิจูด'), 'Open', session.phone, material.type, material.other,
    '', '', now
  ];
  requireFields_(rowValues, [[2, 'ชื่อ'], [4, 'โทรศัพท์'], [5, 'ชนิดพืช'], [8, 'พื้นที่']]);
  const loc = locationForSave_(rowValues[9], rowValues[10]);   // 3.0.0: S:X province…subdistrict from the pin
  geoRowValues_(loc).forEach(function (v) { rowValues.push(v); });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let row = data.id ? findOwnedRow_(sh, id, session.phone, 13) : 0;
    const occupiedRow = data.id ? findIdRow_(sh, id) : 0;
    if (occupiedRow && !row) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
    if (row) {
      rowValues[1] = sh.getRange(row, 2).getValue() || now;
      rowValues[15] = sh.getRange(row, 16).getValue() || '';   // 2.8.0: keep "ยังมีวัสดุอยู่" (shown-until date)
      sh.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sh.appendRow(rowValues);
      row = sh.getLastRow();
    }
    formatFarmerRow_(sh, row);
    setFarmerFormulas_(sh, row);
  } finally {
    lock.releaseLock();
  }
  invalidateSummary_();
  return { status: 'success', success: true, id: id, location: loc || null, message: 'บันทึกข้อมูลเกษตรกรสำเร็จ' };
}

/** 3.0.0: where the pin is (server-side, from the boundary files). Outside Thailand → error; files unreadable → blanks. */
function locationForSave_(lat, lng) {
  ensureGeoColumns_();
  const loc = geoLocateSafe_(lat, lng);
  if (loc === null) throw new Error('ตำแหน่งที่ปักหมุดอยู่นอกประเทศไทย กรุณาปักหมุดใหม่');
  return loc || null;
}

function saveBuyer_(data, session) {
  const sh = sheet_('buyers');
  ensureSheetDataFormats_();
  const material = validateMaterial_(data.materialType || data.material, data.materialOther);
  const id = cleanText_(data.id, 100) || newId_();
  const now = new Date();
  const rowValues = [
    id, now, cleanText_(data.fname, 100), cleanText_(data.lname, 100),
    normalizeContactPhone_(data.phone || session.phone), numberInRange_(data.lat, -90, 90, 'ละติจูด'),
    numberInRange_(data.lng, -180, 180, 'ลองจิจูด'), material.resolved,
    cleanText_(data.quality, 100), nonNegative_(data.price, 'ราคา'), cleanText_(data.capacity, 80),
    'Active', session.phone, material.type, material.other, now, 'ALL'
  ];
  requireFields_(rowValues, [[2, 'ชื่อ'], [4, 'โทรศัพท์'], [8, 'คุณภาพ'], [10, 'ปริมาณ']]);
  const loc = locationForSave_(rowValues[5], rowValues[6]);   // 3.0.0: R:W province…subdistrict from the pin
  geoRowValues_(loc).forEach(function (v) { rowValues.push(v); });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let row = data.id ? findOwnedRow_(sh, id, session.phone, 13) : 0;
    const occupiedRow = data.id ? findIdRow_(sh, id) : 0;
    if (occupiedRow && !row) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
    if (row) {
      rowValues[1] = sh.getRange(row, 2).getValue() || now;
      sh.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sh.appendRow(rowValues);
      row = sh.getLastRow();
    }
    formatBuyerRow_(sh, row);
  } finally {
    lock.releaseLock();
  }
  invalidateSummary_();
  return { status: 'success', success: true, id: id, location: loc || null, message: 'บันทึกข้อมูลผู้ซื้อสำเร็จ' };
}

function farmerRecords_(phone) {
  const rule = marketHideRule_();
  const today = startOfDay_(new Date());
  return dataRows_(sheet_('farmers')).filter(function (r) {
    return isOwned_(r, phone, 12) && String(r[11]) !== 'Deleted';
  }).map(function (r) {
    const l = farmerListing_(r, rule, today);
    return {
      listed: l.listed, listedUntil: l.until ? dateInput_(l.until) : '', hiddenReason: l.reason, hideAfterHarvestDays: rule.days,
      id: text_(r[0]), timestamp: dateTime_(r[1]), fname: text_(r[2]), lname: text_(r[3]), phone: displayPhone_(r[4]),
      crop: text_(r[5]), plantDate: dateInput_(r[6]), harvestDate: dateInput_(r[7]), area: text_(r[8]),
      lat: maybeNumber_(r[9]), lng: maybeNumber_(r[10]), recordStatus: text_(r[11]), materialType: text_(r[13]), materialOther: text_(r[14]),
      location: recordLocation_(r, FARMER_GEO_COL)
    };
  });
}

function buyerRecords_(phone) {
  return dataRows_(sheet_('buyers')).filter(function (r) {
    return isOwned_(r, phone, 12) && String(r[11]) !== 'Deleted';
  }).map(function (r) {
    return {
      id: text_(r[0]), timestamp: dateTime_(r[1]), fname: text_(r[2]), lname: text_(r[3]), phone: displayPhone_(r[4]),
      lat: maybeNumber_(r[5]), lng: maybeNumber_(r[6]), material: text_(r[7]), quality: text_(r[8]), price: maybeNumber_(r[9]), capacity: text_(r[10]),
      recordStatus: text_(r[11]), materialType: text_(r[13]), materialOther: text_(r[14]),
      location: recordLocation_(r, BUYER_GEO_COL)
    };
  });
}

/** 3.0.0 { province, district, subdistrict } names of a row ('' when not filled). */
function recordLocation_(r, col) {
  return { provinceCode: text_(r[col - 1]), province: text_(r[col]), district: text_(r[col + 2]), subdistrict: text_(r[col + 4]) };
}

function farmerPublic_(r) {
  return {
    id: text_(r[0]), name: (text_(r[2]) + ' ' + text_(r[3])).trim(), fname: text_(r[2]), lname: text_(r[3]),
    phone: displayPhone_(r[4]), crop: text_(r[5]), harvest: dateInput_(r[7]), harvestDate: dateInput_(r[7]), area: text_(r[8]), lat: Number(r[9]), lng: Number(r[10]),
    materialType: text_(r[13]), materialOther: text_(r[14]), material: resolvedMaterial_(r[13], r[14], r[5])
  };
}

function buyerPublic_(r) {
  return {
    id: text_(r[0]), name: (text_(r[2]) + ' ' + text_(r[3])).trim(), fname: text_(r[2]), lname: text_(r[3]),
    phone: displayPhone_(r[4]), lat: Number(r[5]), lng: Number(r[6]),
    material: resolvedMaterial_(r[13], r[14], r[7]), quality: text_(r[8]), price: maybeNumber_(r[9]), capacity: text_(r[10])
  };
}

/** Legacy compatibility entry point. Farmer records no longer expire by harvest date. */
function autoExpireFarmers() {
  return 'SKIPPED: harvest-date expiry is disabled';
}

/** Removes every legacy trigger so old deployments cannot expire records later. */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'autoExpireFarmers';
  }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return 'PASS: legacy expiry trigger removed';
}

/** Run before deployment to verify the new database and required columns. */
function verifyDatabaseSchema() {
  const expected = {
    users: ['Telephone','Password','Status','Name','System','Consent','Consent_Timestamp','Created_At','Updated_At'],
    farmers: ['ID','Timestamp','Name','Surname','Phone','Crop','Plant_Date','Havest_Date','Area (ไร่-งาน-ตร.ว.)','Lat','Lng','Stasus','Owner_Telephone','Material_Type','Material_Other','Map_Expire_Date','Map_Visible','Updated_At'],
    buyers: ['ID','Timestamp','Name','Surname','Phone','Lat','Lng','Material','Quality','Price','Capacity','Status','Owner_Telephone','Material_Type','Material_Other','Updated_At','Purchase_After_Harvest_Days'],
    settings: ['Parameter','Value','Unit','Description']
  };
  Object.keys(expected).forEach(function (kind) {
    const sh = sheet_(kind);
    const headers = sh.getRange(1, 1, 1, expected[kind].length).getDisplayValues()[0];
    expected[kind].forEach(function (name, i) {
      if (headers[i] !== name) throw new Error(kind + ': expected ' + name + ' in column ' + (i + 1));
    });
  });
  return 'PASS: users, farmers, buyers and settings schema are ready';
}

/** One-time administrator setup after pasting this code into a new project. */
function setupSystem() {
  const migration = ensureBuyerHarvestDaysColumn_();
  const formats = ensureSheetDataFormats_();
  const normalized = normalizeLegacySheetData_();
  const schema = verifyDatabaseSchema();
  const restored = restoreLegacyExpiredFarmers_();
  const trigger = setupDailyTrigger();
  const visits = ensureVisitSchema_();
  invalidateSummary_();
  const abm = verifyAbmLink();
  let geo;   // 3.0.0: province columns, then fill provinces from pins (needs the boundary files on GitHub Pages)
  try { geo = ensureGeoColumns_() + '\n' + geoMigrate_(false) + '\n' + verifyGeo(); } catch (err) { geo = 'INFO: provinces not filled yet — ' + err; }
  const out = [migration, formats, normalized, schema, restored, trigger, visits, abm, geo].join('\n');
  console.log(out);
  return out;
}

/**
 * Run from the Apps Script editor after setupSystem().
 * The returned count must match Open farmer rows with valid Lat/Lng in farmers!A:R.
 */
function verifyLiveMatchingData() {
  const rows = openFarmersWithCoordinates_();
  const rule = marketHideRule_();
  return 'PASS: API ' + APP_VERSION + ' returns ' + rows.length +
    ' Open farmer record(s) with coordinates on the market (' + (rule.days ? 'until ' + rule.days + ' days after harvest' : 'no harvest limit') + ')';
}

/** Adds the new buyers column without moving or rewriting any existing column. */
function ensureBuyerHarvestDaysColumn_() {
  const sh = sheet_('buyers');
  const cell = sh.getRange(1, 17);
  const current = String(cell.getValue() || '').trim();
  if (!current) cell.setValue('Purchase_After_Harvest_Days');
  if (current && current !== 'Purchase_After_Harvest_Days') {
    throw new Error('buyers: column Q is already used by ' + current);
  }
  return 'PASS: buyers column Q is ready';
}

/**
 * Preserve the legacy schema while making future Sheet display and writes
 * consistent: phone values are text and farmer dates use ISO yyyy-mm-dd.
 */
function ensureSheetDataFormats_() {
  const users = sheet_('users');
  const farmers = sheet_('farmers');
  const buyers = sheet_('buyers');
  users.getRange('A:A').setNumberFormat('@');
  farmers.getRange('E:E').setNumberFormat('@');
  farmers.getRange('M:M').setNumberFormat('@');
  farmers.getRange('G:H').setNumberFormat('yyyy-mm-dd');
  buyers.getRange('E:E').setNumberFormat('@');
  buyers.getRange('M:M').setNumberFormat('@');
  return 'PASS: phone columns are text and farmer dates use yyyy-mm-dd';
}

function formatFarmerRow_(sh, row) {
  sh.getRange(row, 5).setNumberFormat('@');
  sh.getRange(row, 7, 1, 2).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, 13).setNumberFormat('@');
}

function formatBuyerRow_(sh, row) {
  sh.getRange(row, 5).setNumberFormat('@');
  sh.getRange(row, 13).setNumberFormat('@');
}

/**
 * Idempotent one-time cleanup for values that Google Sheets previously coerced.
 * Ambiguous or invalid values are left unchanged.
 */
function normalizeLegacySheetData_() {
  let phoneChanges = 0;
  let dateChanges = 0;
  [
    { sh: sheet_('users'), columns: [1] },
    { sh: sheet_('farmers'), columns: [5, 13] },
    { sh: sheet_('buyers'), columns: [5, 13] }
  ].forEach(function (entry) {
    if (entry.sh.getLastRow() < 2) return;
    entry.columns.forEach(function (column) {
      const values = entry.sh.getRange(2, column, entry.sh.getLastRow() - 1, 1).getValues();
      values.forEach(function (rowValue, index) {
        const original = rowValue[0];
        const normalized = normalizePhone_(original);
        if (/^0\d{9}$/.test(normalized) && String(original) !== normalized) {
          entry.sh.getRange(index + 2, column).setValue(normalized);
          phoneChanges++;
        }
      });
    });
  });

  const farmers = sheet_('farmers');
  if (farmers.getLastRow() >= 2) {
    [7, 8].forEach(function (column) {
      const values = farmers.getRange(2, column, farmers.getLastRow() - 1, 1).getValues();
      values.forEach(function (rowValue, index) {
        const original = rowValue[0];
        if (!original || original instanceof Date) return;
        const normalized = toDate_(original);
        if (normalized) {
          farmers.getRange(index + 2, column).setValue(normalized);
          dateChanges++;
        }
      });
    });
  }
  return 'PASS: normalized ' + phoneChanges + ' legacy phone value(s) and ' +
    dateChanges + ' legacy date value(s)';
}

/**
 * Restores rows marked Expired by versions that enforced harvest date +10 days.
 * Deleted rows and every other status are preserved.
 */
function restoreLegacyExpiredFarmers_() {
  const sh = sheet_('farmers');
  const rows = dataRows_(sh);
  let restored = 0;
  rows.forEach(function (r, i) {
    const row = i + 2;
    let status = String(r[11]).trim();
    if (status === 'Expired') {
      sh.getRange(row, 12).setValue('Open');
      sh.getRange(row, 18).setValue(new Date());
      status = 'Open';
      restored++;
    }
    if (status === 'Open') {
      // 2.8.0: P (Map_Expire_Date) now holds the "ยังมีวัสดุอยู่" date — kept
      sh.getRange(row, 17).setFormula('=L' + row + '="Open"');
    }
  });
  return 'PASS: restored ' + restored + ' legacy Expired farmer record(s) to Open';
}

function setFarmerFormulas_(sh, row) {
  // P (Map_Expire_Date) = "ยังมีวัสดุอยู่" shown-until date (2.8.0) — never cleared here; Q kept for schema compatibility.
  sh.getRange(row, 17).setFormula('=L' + row + '="Open"');
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
  return SpreadsheetApp.openById(id);
}

function sheet_(kind) {
  const props = PropertiesService.getScriptProperties();
  const names = {
    users: props.getProperty('USERS_SHEET') || 'users',
    farmers: props.getProperty('FARMERS_SHEET') || 'farmers',
    buyers: props.getProperty('BUYERS_SHEET') || 'buyers',
    settings: props.getProperty('SETTINGS_SHEET') || 'Config'
  };
  const sh = spreadsheet_().getSheetByName(names[kind]);
  if (!sh) throw new Error('ไม่พบชีต ' + names[kind]);
  return sh;
}

function dataRows_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function findOwnedRow_(sh, id, phone, ownerColumn) {
  const values = dataRows_(sh);
  for (let i = 0; i < values.length; i++) {
    if (text_(values[i][0]) === id && isOwned_(values[i], phone, ownerColumn - 1)) return i + 2;
  }
  return 0;
}

function findIdRow_(sh, id) {
  const values = dataRows_(sh);
  for (let i = 0; i < values.length; i++) {
    if (text_(values[i][0]) === id) return i + 2;
  }
  return 0;
}

function isOwned_(row, phone, ownerIndex) {
  const explicitOwner = normalizePhone_(row[ownerIndex]);
  const legacyOwner = normalizePhone_(row[4]);
  return explicitOwner ? explicitOwner === phone : legacyOwner === phone;
}

function requireSession_(token) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('SESSION_EXPIRED');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('session:' + token);
  if (!raw) throw new Error('SESSION_EXPIRED');
  cache.put('session:' + token, raw, sessionTtlSeconds_());
  return JSON.parse(raw);
}

function setting_(key, fallback) {
  try {
    const sh = sheet_('settings');
    if (sh.getLastRow() < 2) return fallback;
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    const found = rows.find(function (r) { return String(r[0]).trim() === key; });
    return found ? found[1] : fallback;
  } catch (err) {
    return fallback;
  }
}

function sessionTtlSeconds_() {
  const seconds = Number(setting_('SESSION_TTL_SECONDS', DEFAULT_SESSION_TTL_SECONDS));
  return isFinite(seconds) && seconds >= 300 && seconds <= 21600 ? Math.floor(seconds) : DEFAULT_SESSION_TTL_SECONDS;
}

function validateMaterial_(type, other) {
  type = cleanText_(type, 80);
  other = cleanText_(other, 150);
  // Backward-compatible: an old free-text material becomes “อื่นๆ”.
  if (MATERIAL_TYPES.indexOf(type) < 0 && type) { other = type; type = 'อื่นๆ'; }
  if (MATERIAL_TYPES.indexOf(type) < 0) throw new Error('กรุณาเลือกชนิดวัสดุเหลือใช้ทางการเกษตร');
  if (type === 'อื่นๆ' && !other) throw new Error('กรุณาระบุชนิดวัสดุเหลือใช้ทางการเกษตรอื่นๆ');
  if (type !== 'อื่นๆ') other = '';
  return { type: type, other: other, resolved: type === 'อื่นๆ' ? other : type };
}

/**
 * Known crops always determine their residue type on the server. This prevents
 * stale Frontends or edited requests from saving an inconsistent combination.
 * "อื่นๆ" remains available for crops that are not in the fixed crop list.
 */
function farmerMaterialForCrop_(crop, requestedType, requestedOther) {
  const automaticType = CROP_MATERIAL_MAP[cleanText_(crop, 150)];
  return automaticType
    ? { type: automaticType, other: '', resolved: automaticType }
    : validateMaterial_(requestedType, requestedOther);
}

function resolvedMaterial_(type, other, fallback) {
  type = text_(type);
  other = text_(other);
  return type === 'อื่นๆ' ? (other || text_(fallback)) : (type || text_(fallback));
}

function parseDate_(value, label) {
  if (value === '' || value === null || value === undefined) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(label + 'ไม่ถูกต้อง');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    throw new Error(label + 'ไม่ถูกต้อง');
  }
  return d;
}

function toDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (!v) return null;
  const value = String(v).trim();
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  let year, month, day;
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else {
    m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  }
  if (year > 2400) year -= 543;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

function numberInRange_(v, min, max, label) {
  const n = Number(v);
  if (!isFinite(n) || n < min || n > max) throw new Error(label + 'ไม่ถูกต้อง');
  return n;
}

function nonNegative_(v, label) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw new Error(label + 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  return n;
}

function maybeNumber_(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return isFinite(n) ? n : '';
}

function hasCoordinates_(lat, lng) {
  if (lat === '' || lat === null || lat === undefined || lng === '' || lng === null || lng === undefined) return false;
  const a = Number(lat), b = Number(lng);
  return isFinite(a) && isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}

function requireFields_(row, fields) {
  fields.forEach(function (f) { if (row[f[0]] === '') throw new Error('กรุณากรอก' + f[1]); });
}

function normalizeRole_(v) {
  const role = String(v || '').trim().toLowerCase();
  if (role !== 'farmer' && role !== 'buyer') throw new Error('บทบาทไม่ถูกต้อง');
  return role;
}

function normalizePhone_(v) {
  const digits = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  // A numeric Sheet cell may drop the leading zero from a Thai mobile number.
  return /^\d{9}$/.test(digits) ? '0' + digits : digits;
}

function displayPhone_(v) {
  const phone = normalizePhone_(v);
  return /^0\d{9}$/.test(phone) ? phone : text_(v);
}

function normalizeContactPhone_(v) {
  const phone = normalizePhone_(v);
  if (!/^0\d{9}$/.test(phone)) throw new Error('หมายเลขโทรศัพท์ต้องมี 10 หลัก');
  return phone;
}

function newId_() {
  return String(new Date().getTime()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

function cleanText_(v, max) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, max || 500);
}

function text_(v) { return cleanText_(v, 500); }

function dateInput_(v) {
  const d = toDate_(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

function dateTime_(v) {
  const d = toDate_(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : text_(v);
}

function publicError_(err) {
  const msg = String(err && err.message || err || 'เกิดข้อผิดพลาด');
  if (msg === 'SESSION_EXPIRED') return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  if (msg === 'ADMIN_SESSION_EXPIRED') return 'ADMIN_SESSION_EXPIRED';
  return cleanText_(msg, 300) || 'เกิดข้อผิดพลาด';
}
