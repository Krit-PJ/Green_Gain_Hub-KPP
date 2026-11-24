/**
 * Green Gain Hub 3.0.0 — which province / district / subdistrict a pin is in (all 77 provinces).
 *
 * Boundaries are the QA-checked dataset "1. ขอบเขตพื้นที่รายจังหวัด" (Thailand Agri-Risk Map Burning), simplified by
 * tools/geo/build.py and published with the web page (GitHub Pages):
 *   geo/provinces.json   77 provinces — code, name, bbox, outline
 *   geo/p/<code>.json    one province — districts and subdistricts (codes, names, outlines)
 * The server reads the same files the page uses (UrlFetchApp, cached 6 hours in chunks), so both always agree.
 * Script Property GEO_BASE_URL overrides the address (default: the live GitHub Pages site).
 *
 * The server decides the location of every saved plot / buyer point from its coordinates (geoLocate_) — the page
 * only shows it — and fills the province of records saved before 3.0.0 once (geoMigrate_).
 */
const GEO_BASE_DEFAULT = 'https://krit-pj.github.io/Green_Gain_Hub-KPP/geo/';
const GEO_CACHE = 'geo:v1:';
const GEO_CACHE_SECONDS = 21600;
const GEO_CHUNK = 90000;
const DEFAULT_PROVINCE_CODE = '62';   // กำแพงเพชร — where Green Gain Hub started; records without a pin belong here
const GEO_MIGRATION_PROP = 'GEO_MIGRATED';
const GEO_MIGRATION_VERSION = '3.0.0';
let GEO_MEMO_ = {};

function geoBaseUrl_() {
  const v = String(PropertiesService.getScriptProperties().getProperty('GEO_BASE_URL') || GEO_BASE_DEFAULT).trim();
  return v.charAt(v.length - 1) === '/' ? v : v + '/';
}

/** JSON file from the boundary folder: memory → CacheService (chunked, values ≤100 KB) → GitHub Pages. */
function geoFile_(name) {
  if (GEO_MEMO_[name]) return GEO_MEMO_[name];
  const cache = CacheService.getScriptCache();
  const key = GEO_CACHE + name;
  try {
    const head = cache.get(key);
    if (head) {
      const n = Number(head);
      const parts = [];
      for (let i = 0; i < n; i++) { const p = cache.get(key + ':' + i); if (p === null || p === undefined) { parts.length = 0; break; } parts.push(p); }
      if (parts.length === n && n) return (GEO_MEMO_[name] = JSON.parse(parts.join('')));
    }
  } catch (err) { /* refetch */ }
  const res = UrlFetchApp.fetch(geoBaseUrl_() + name + '?v=' + GEO_MIGRATION_VERSION, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('อ่านขอบเขตพื้นที่ไม่สำเร็จ (' + res.getResponseCode() + ')');
  const text = res.getContentText();
  const data = JSON.parse(text);
  try {
    const n = Math.ceil(text.length / GEO_CHUNK);
    for (let i = 0; i < n; i++) cache.put(key + ':' + i, text.slice(i * GEO_CHUNK, (i + 1) * GEO_CHUNK), GEO_CACHE_SECONDS);
    cache.put(key, String(n), GEO_CACHE_SECONDS);
  } catch (err) { /* best effort */ }
  return (GEO_MEMO_[name] = data);
}

/** [{ code, name, nameEn, bbox, center }] — all 77, sorted by Thai name; no outlines. */
function geoProvinces_() {
  return geoFile_('provinces.json').provinces.map(function (p) {
    return { code: p.code, name: p.name, nameEn: p.nameEn, bbox: p.bbox, center: p.center };
  });
}

function geoProvinceByCode_(code) {
  code = String(code || '').trim();
  const list = geoFile_('provinces.json').provinces;
  for (let i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
  return null;
}

/** One province: { code, name, districts:[{code,name,center,geometry}], subdistricts:[{code,name,districtCode,geometry}] }. */
function geoProvince_(code) { return geoFile_('p/' + String(code) + '.json'); }

function geoInBox_(lng, lat, b) { return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]; }

function geoNearest_(lat, lng, list) {
  let best = null, bestD = Infinity;
  list.forEach(function (x) {
    const c = x.center; if (!c) return;
    const d = Math.pow(c[0] - lat, 2) + Math.pow((c[1] - lng) * Math.cos(lat * Math.PI / 180), 2);
    if (d < bestD) { bestD = d; best = x; }
  });
  return best;
}

/**
 * { provinceCode, province, districtCode, district, subdistrictCode, subdistrict } for a point in Thailand, else null.
 * Outlines are simplified, so a pin right on a border can fall between two shapes: then the nearest one in the box wins.
 */
function geoLocate_(lat, lng) {
  lat = Number(lat); lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const all = geoFile_('provinces.json').provinces;
  const boxed = all.filter(function (p) { return geoInBox_(lng, lat, [p.bbox[0] - 0.02, p.bbox[1] - 0.02, p.bbox[2] + 0.02, p.bbox[3] + 0.02]); });
  if (!boxed.length) return null;
  let prov = null;
  for (let i = 0; i < boxed.length && !prov; i++) if (pointInGeometry_(lng, lat, boxed[i].geometry)) prov = boxed[i];
  if (!prov) prov = geoNearest_(lat, lng, boxed);
  const P = geoProvince_(prov.code);
  let d = null;
  for (let i = 0; i < P.districts.length && !d; i++) if (pointInGeometry_(lng, lat, P.districts[i].geometry)) d = P.districts[i];
  if (!d) d = geoNearest_(lat, lng, P.districts);
  const subs = P.subdistricts.filter(function (s) { return !d || s.districtCode === d.code; });
  let s = null;
  for (let i = 0; i < subs.length && !s; i++) if (pointInGeometry_(lng, lat, subs[i].geometry)) s = subs[i];
  return {
    provinceCode: prov.code, province: prov.name,
    districtCode: d ? d.code : '', district: d ? d.name : '',
    subdistrictCode: s ? s.code : '', subdistrict: s ? s.name : ''
  };
}

/** Never throws: the location, or blanks when the boundary files cannot be read (the record is still saved). */
function geoLocateSafe_(lat, lng) {
  try { return geoLocate_(lat, lng); } catch (err) { console.warn('geoLocate_: ' + err); return undefined; }
}

/* ------------------------------ sheet columns (added at the end, nothing moves) ------------------------------ */
const GEO_COLUMNS = ['Province_Code', 'Province', 'District_Code', 'District', 'Subdistrict_Code', 'Subdistrict'];
const FARMER_GEO_COL = 19;   // S..X
const BUYER_GEO_COL = 18;    // R..W
const USER_GEO_COL = 10;     // J..K (Province_Code, Province)

function ensureGeoColumns_() {
  if (GEO_MEMO_.__columns) return 'PASS: province columns are ready';
  [['farmers', FARMER_GEO_COL, GEO_COLUMNS], ['buyers', BUYER_GEO_COL, GEO_COLUMNS], ['users', USER_GEO_COL, GEO_COLUMNS.slice(0, 2)]].forEach(function (x) {
    const sh = sheet_(x[0]);
    const have = sh.getRange(1, x[1], 1, x[2].length).getValues()[0];
    x[2].forEach(function (h, i) {
      const cur = String(have[i] || '').trim();
      if (cur && cur !== h) throw new Error(x[0] + ': column ' + (x[1] + i) + ' is already used by ' + cur);
      if (!cur) sh.getRange(1, x[1] + i).setValue(h);
    });
    sh.getRange(2, x[1], Math.max(sh.getMaxRows ? sh.getMaxRows() - 1 : 1, 1), 1).setNumberFormat('@');
  });
  GEO_MEMO_.__columns = true;
  return 'PASS: province columns are ready (farmers S:X, buyers R:W, users J:K)';
}

function geoRowValues_(loc) {
  return loc ? [loc.provinceCode, loc.province, loc.districtCode, loc.district, loc.subdistrictCode, loc.subdistrict] : ['', '', '', '', '', ''];
}

/** Province code of a data row ('' when unknown). */
function rowProvince_(r, kind) { return text_(r[(kind === 'farmers' ? FARMER_GEO_COL : BUYER_GEO_COL) - 1]); }
function rowDistrict_(r, kind) { return text_(r[(kind === 'farmers' ? FARMER_GEO_COL : BUYER_GEO_COL) + 1]); }

/**
 * 3.0.0, once: fills Province…Subdistrict of every plot / buyer point from its pin, and the province of every user from
 * the first pin they own (users with no pin: กำแพงเพชร, where everyone registered before 3.0.0). Safe to run again —
 * only empty cells are filled. Runs by itself on the first request after the deployment (or from the editor).
 */
function geoMigrate_(force) {
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty(GEO_MIGRATION_PROP) === GEO_MIGRATION_VERSION) return 'SKIP: provinces already filled';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return 'SKIP: another request is filling provinces';
  try {
    if (!force && props.getProperty(GEO_MIGRATION_PROP) === GEO_MIGRATION_VERSION) return 'SKIP: provinces already filled';
    ensureGeoColumns_();
    const owners = {};
    let filled = 0, unknown = 0;
    [['farmers', FARMER_GEO_COL, 9, 10], ['buyers', BUYER_GEO_COL, 5, 6]].forEach(function (x) {
      const sh = sheet_(x[0]);
      dataRows_(sh).forEach(function (r, i) {
        const owner = normalizePhone_(r[12]) || normalizePhone_(r[4]);
        let code = text_(r[x[1] - 1]), name = text_(r[x[1]]);
        if (!code && hasCoordinates_(r[x[2]], r[x[3]])) {
          const loc = geoLocate_(r[x[2]], r[x[3]]);
          if (loc) { sh.getRange(i + 2, x[1], 1, 6).setValues([geoRowValues_(loc)]); code = loc.provinceCode; name = loc.province; filled++; } else unknown++;
        }
        if (code && owner && !owners[owner]) owners[owner] = [code, name];
      });
    });
    const def = geoProvinceByCode_(DEFAULT_PROVINCE_CODE);
    const users = sheet_('users');
    let usersFilled = 0;
    dataRows_(users).forEach(function (r, i) {
      if (text_(r[USER_GEO_COL - 1])) return;
      const p = owners[normalizePhone_(r[0])] || [DEFAULT_PROVINCE_CODE, def ? def.name : 'กำแพงเพชร'];
      users.getRange(i + 2, USER_GEO_COL, 1, 2).setValues([p]);
      usersFilled++;
    });
    props.setProperty(GEO_MIGRATION_PROP, GEO_MIGRATION_VERSION);
    invalidateSummary_();
    return 'PASS: provinces filled — ' + filled + ' plot/buyer row(s), ' + usersFilled + ' user(s)' + (unknown ? ', ' + unknown + ' pin(s) outside Thailand left blank' : '');
  } finally { lock.releaseLock(); }
}

/** Run from the editor: fills any province left empty (e.g. after importing rows by hand). */
function migrateProvinces() { const out = geoMigrate_(true); console.log(out); return out; }

/** Run from the editor: the boundary files can be read and a pin in Kamphaeng Phet city is found. */
function verifyGeo() {
  GEO_MEMO_ = {};
  const n = geoProvinces_().length;
  const loc = geoLocate_(16.4828, 99.5227);
  return 'PASS: ' + n + ' provinces · test pin → ต.' + (loc && loc.subdistrict) + ' อ.' + (loc && loc.district) + ' จ.' + (loc && loc.province);
}
