/**
 * Green Gain Hub 1.6.0 — API-only bridge from GitHub Pages to Google Sheets.
 * Files: Code.gs (this), Districts.gs (boundaries), Admin.gs (Super Admin/Admin, doPost),
 *        Crops.gs (crop area import + crop summary).
 * Database: Google Sheets / file storage: Google Drive.
 *
 * Endpoints (same /exec URL):
 *   ?action=rpc&method=...            JSONP RPC used by the logged-in app (unchanged)
 *   ?api=v1&endpoint=summary[&key=]   Public, aggregate-only dashboard data (JSON or JSONP)
 *   ?api=v1&endpoint=crop&crop=&season=&district=   Public sub-district crop breakdown
 *   ?api=v1&endpoint=health           Public version check
 *   POST {method,args,token}          Admin API (Admin.gs)
 */
const APP_VERSION = '1.6.0';
// Database 1.5.0: "Green Gain Hub KPP — Database (v1.5.0)" in Drive folder "7. Green Gain Hub".
// Script Property SPREADSHEET_ID overrides this value when set.
const DEFAULT_SPREADSHEET_ID = '1TU2kC7kzJbb9JZzo4m7D3eOmcW8Ra_osic33rolE-Hw';
const SUMMARY_CACHE_SECONDS = 300;
const SUMMARY_CACHE_KEY = 'summary:v1:' + APP_VERSION;
// KPP Smart Agri-Materials (รายงานการจัดการเศษวัสดุรายอำเภอ) — อ่านผ่าน Data API v1 ฝั่ง Server
// API Key เก็บใน Script Property SMART_AGRI_API_KEY เท่านั้น (ไม่อยู่ใน GitHub/หน้าเว็บ)
const SMART_AGRI_DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbxoo4VuAomjDPaDPXgEF6y0CFVxBfor-4OmIi3bQVik7FCgAx_7XghYmeav7BHDbpLcaw/exec';
const SMART_AGRI_CACHE_KEY = 'smartagri:v1:' + APP_VERSION;
const SMART_AGRI_ITEMS = 'agri';
const DEFAULT_SESSION_TTL_SECONDS = 21600; // 6 hours
const MATERIAL_TYPES = ['ฟางข้าว', 'ใบอ้อย', 'เหง้ามันสำปะหลัง', 'อื่นๆ'];
const CROP_MATERIAL_MAP = {
  'ข้าวนาปี': 'ฟางข้าว',
  'ข้าวนาปรัง': 'ฟางข้าว',
  'อ้อยโรงงาน': 'ใบอ้อย',
  'มันสำปะหลัง': 'เหง้ามันสำปะหลัง'
};
const PUBLIC_METHODS = ['loginServer', 'registerServer', 'getApiInfoServer'];
const PRIVATE_METHODS = ['getUserProfileServer', 'saveDataServer', 'deleteDataServer', 'getMatchingDataServer'];

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
    getApiInfoServer: function () { return getApiInfoServer(); },
    getUserProfileServer: function (args, session) { return getUserProfileServer(session); },
    saveDataServer: function (args, session) { return saveDataServer(args[0], session); },
    deleteDataServer: function (args, session) { return deleteDataServer(args[0], session); },
    getMatchingDataServer: function (args, session) { return getMatchingDataServer(session); }
  };
}

/** Public, non-sensitive deployment check used to detect a stale Apps Script version. */
function getApiInfoServer() {
  return {
    status: 'success',
    success: true,
    apiVersion: APP_VERSION,
    feature: 'CROP_IMPORT_ADMIN'
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
    if (endpoint === 'summary') {
      const data = getPublicSummary_(p.refresh === '1');
      data.reports = getSmartAgriReports_(p.refresh === '1');
      data.crops = getCropSummary_(p.refresh === '1');
      payload = { ok: true, api: 'v1', endpoint: endpoint, apiVersion: APP_VERSION, data: data };
    } else if (endpoint === 'crop') {
      payload = { ok: true, api: 'v1', endpoint: endpoint, apiVersion: APP_VERSION, data: getCropDetail_(p) };
    } else if (endpoint === 'health') {
      payload = { ok: true, api: 'v1', endpoint: endpoint, apiVersion: APP_VERSION, feature: getApiInfoServer().feature,
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

function getPublicSummary_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get(SUMMARY_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  }
  const summary = buildPublicSummary_(new Date());
  try { cache.put(SUMMARY_CACHE_KEY, JSON.stringify(summary), SUMMARY_CACHE_SECONDS); } catch (err) { /* >100KB: skip cache */ }
  return summary;
}

function buildPublicSummary_(now) {
  const farmers = dataRows_(sheet_('farmers')).filter(function (r) {
    return String(r[11] || '').trim().toLowerCase() === 'open';
  });
  const buyers = dataRows_(sheet_('buyers')).filter(function (r) {
    return String(r[11] || '').trim().toLowerCase() === 'active';
  });
  const refs = researchRefs_();
  const districts = districtList_();
  const byDistrict = {};
  districts.forEach(function (d) { byDistrict[d.code] = emptyDistrictStat_(d); });
  const outside = emptyDistrictStat_({ code: 'OTHER', name: 'นอกเขต/ไม่ระบุพิกัด' });
  const byMaterial = {};
  const byCrop = {};
  const owners = {};
  const today = startOfDay_(now);
  const months = harvestMonthWindow_(today, 6, 6);
  const monthIndex = {};
  months.forEach(function (m, i) { monthIndex[m.month] = i; });
  const upcoming = { days30: { plots: 0, areaRai: 0 }, days60: { plots: 0, areaRai: 0 } };
  let totalArea = 0;
  let withCoordinates = 0;

  buyers.forEach(function (r) {
    const material = resolvedMaterial_(r[13], r[14], r[7]) || 'ไม่ระบุ';
    const capacity = leadingNumber_(r[10]);
    const price = maybeNumber_(r[9]);
    const district = hasCoordinates_(r[5], r[6]) ? districtForPoint_(Number(r[5]), Number(r[6]), districts) : null;
    const target = district ? byDistrict[district.code] : outside;
    target.buyers++;
    target.capacityTonPerDay += capacity;
    const m = materialStat_(byMaterial, material);
    m.buyers++;
    m.capacityTonPerDay += capacity;
    if (price !== '' && price > 0) { m.priceSum += price; m.priceCount++; }
  });

  farmers.forEach(function (r) {
    const area = parseAreaRai_(r[8]);
    const material = resolvedMaterial_(r[13], r[14], r[5]) || 'ไม่ระบุ';
    const crop = text_(r[5]) || 'ไม่ระบุ';
    const owner = normalizePhone_(r[12]) || normalizePhone_(r[4]);
    if (owner) owners[owner] = true;
    totalArea += area;
    let district = null;
    if (hasCoordinates_(r[9], r[10])) {
      withCoordinates++;
      district = districtForPoint_(Number(r[9]), Number(r[10]), districts);
    }
    const target = district ? byDistrict[district.code] : outside;
    target.plots++;
    target.areaRai += area;
    if (owner) target.owners[owner] = true;
    target.materials[material] = (target.materials[material] || 0) + area;

    const m = materialStat_(byMaterial, material);
    m.plots++;
    m.areaRai += area;
    const c = byCrop[crop] || (byCrop[crop] = { crop: crop, material: material, plots: 0, areaRai: 0 });
    c.plots++;
    c.areaRai += area;

    const harvest = toDate_(r[7]);
    if (harvest) {
      const key = Utilities.formatDate(harvest, Session.getScriptTimeZone(), 'yyyy-MM');
      if (key in monthIndex) {
        months[monthIndex[key]].plots++;
        months[monthIndex[key]].areaRai += area;
      }
      const days = Math.round((startOfDay_(harvest).getTime() - today.getTime()) / 86400000);
      if (days >= 0 && days <= 30) { upcoming.days30.plots++; upcoming.days30.areaRai += area; }
      if (days >= 0 && days <= 60) { upcoming.days60.plots++; upcoming.days60.areaRai += area; }
    }
  });

  const materialList = Object.keys(byMaterial).map(function (k) {
    const m = byMaterial[k];
    const ref = refs[k] || null;
    const avgPrice = m.priceCount ? m.priceSum / m.priceCount : null;
    return {
      material: k,
      plots: m.plots,
      areaRai: round_(m.areaRai, 2),
      buyers: m.buyers,
      capacityTonPerDay: round_(m.capacityTonPerDay, 1),
      avgBuyerPriceBahtPerRai: avgPrice === null ? null : round_(avgPrice, 2),
      potentialValueBaht: avgPrice === null ? null : Math.round(m.areaRai * avgPrice),
      bioRateTonPerRai: ref && ref.bioRate !== null ? ref.bioRate : null,
      residueTon: ref && ref.bioRate !== null ? round_(m.areaRai * ref.bioRate, 1) : null
    };
  }).sort(function (a, b) { return b.areaRai - a.areaRai || b.buyers - a.buyers; });

  const valueKnown = materialList.filter(function (m) { return m.potentialValueBaht !== null; });
  const residueKnown = materialList.filter(function (m) { return m.residueTon !== null; });
  const allBuyerPrices = buyers.map(function (r) { return maybeNumber_(r[9]); }).filter(function (v) { return v !== '' && v > 0; });

  const districtList = districts.map(function (d) { return finalizeDistrictStat_(byDistrict[d.code], refs); });
  if (outside.plots || outside.buyers) districtList.push(finalizeDistrictStat_(outside, refs));

  return {
    generatedAt: now.toISOString(),
    province: 'กำแพงเพชร',
    cacheSeconds: SUMMARY_CACHE_SECONDS,
    totals: {
      farmerPlots: farmers.length,
      farmers: Object.keys(owners).length,
      plotsWithCoordinates: withCoordinates,
      areaRai: round_(totalArea, 2),
      buyers: buyers.length,
      capacityTonPerDay: round_(buyers.reduce(function (s, r) { return s + leadingNumber_(r[10]); }, 0), 1),
      avgBuyerPriceBahtPerRai: allBuyerPrices.length ? round_(allBuyerPrices.reduce(function (s, v) { return s + v; }, 0) / allBuyerPrices.length, 2) : null,
      potentialValueBaht: valueKnown.length ? valueKnown.reduce(function (s, m) { return s + m.potentialValueBaht; }, 0) : null,
      residueTon: residueKnown.length ? round_(residueKnown.reduce(function (s, m) { return s + m.residueTon; }, 0), 1) : null,
      districtsCovered: districtList.filter(function (d) { return d.code !== 'OTHER' && (d.plots || d.buyers); }).length,
      districtsTotal: districts.length
    },
    upcomingHarvest: {
      days30: { plots: upcoming.days30.plots, areaRai: round_(upcoming.days30.areaRai, 2) },
      days60: { plots: upcoming.days60.plots, areaRai: round_(upcoming.days60.areaRai, 2) }
    },
    byDistrict: districtList,
    byMaterial: materialList,
    byCrop: Object.keys(byCrop).map(function (k) {
      return { crop: k, material: byCrop[k].material, plots: byCrop[k].plots, areaRai: round_(byCrop[k].areaRai, 2) };
    }).sort(function (a, b) { return b.areaRai - a.areaRai; }),
    harvestByMonth: months.map(function (m) { return { month: m.month, plots: m.plots, areaRai: round_(m.areaRai, 2), isCurrent: m.isCurrent }; }),
    goals: activeGoals_(),
    notes: {
      area: 'พื้นที่แปลง (ไร่) แปลงจากรูปแบบ ไร่-งาน-ตร.ว. ของแบบฟอร์ม',
      price: 'ราคารับซื้อเป็นค่าเฉลี่ยที่ผู้รับซื้อสถานะ Active ระบุ (บาท/ไร่)',
      residue: residueKnown.length ? 'ปริมาณเศษวัสดุประมาณจาก BioRate (ตัน/ไร่) ในชีต Research_Refs'
        : 'ยังไม่ได้กำหนด BioRate (ตัน/ไร่) ในชีต Research_Refs จึงยังไม่ประมาณปริมาณเศษวัสดุ',
      privacy: 'ข้อมูลสรุปเชิงสถิติเท่านั้น ไม่มีชื่อ เบอร์โทร หรือพิกัดรายแปลง'
    }
  };
}

function emptyDistrictStat_(d) {
  return { code: d.code, name: d.name, plots: 0, areaRai: 0, buyers: 0, capacityTonPerDay: 0, owners: {}, materials: {} };
}

function finalizeDistrictStat_(d, refs) {
  let residue = 0;
  let residueKnown = false;
  const materials = Object.keys(d.materials).map(function (k) {
    const ref = refs[k];
    if (ref && ref.bioRate !== null) { residue += d.materials[k] * ref.bioRate; residueKnown = true; }
    return { material: k, areaRai: round_(d.materials[k], 2) };
  }).sort(function (a, b) { return b.areaRai - a.areaRai; });
  return {
    code: d.code, name: d.name, plots: d.plots, farmers: Object.keys(d.owners).length,
    areaRai: round_(d.areaRai, 2), buyers: d.buyers, capacityTonPerDay: round_(d.capacityTonPerDay, 1),
    residueTon: residueKnown ? round_(residue, 1) : null, materials: materials
  };
}

function materialStat_(map, material) {
  return map[material] || (map[material] = { plots: 0, areaRai: 0, buyers: 0, capacityTonPerDay: 0, priceSum: 0, priceCount: 0 });
}

/** Research_Refs: Type = ชนิดเศษวัสดุ, BioRate = ตัน/ไร่ (optional). */
function researchRefs_() {
  const out = {};
  try {
    const sh = spreadsheet_().getSheetByName('Research_Refs');
    if (!sh || sh.getLastRow() < 2) return out;
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    const iType = head.indexOf('Type');
    const iRate = head.indexOf('BioRate');
    if (iType < 0) return out;
    dataRows_(sh).forEach(function (r) {
      const type = text_(r[iType]);
      if (!type) return;
      const rate = iRate >= 0 ? Number(r[iRate]) : NaN;
      out[type] = { bioRate: isFinite(rate) && rate > 0 && String(r[iRate]).trim() !== '' ? rate : null };
    });
  } catch (err) { /* optional sheet */ }
  return out;
}

/** Goals: ID, Icon, Title, Description, SortOrder, Active — shown on the landing page when present. */
function activeGoals_() {
  try {
    const sh = spreadsheet_().getSheetByName('Goals');
    if (!sh || sh.getLastRow() < 2) return [];
    return dataRows_(sh).filter(function (r) {
      const active = String(r[5]).trim().toLowerCase();
      return text_(r[2]) && (active === 'true' || active === 'yes' || active === '1' || r[5] === true);
    }).map(function (r) {
      return { icon: cleanText_(r[1], 40), title: cleanText_(r[2], 120), description: cleanText_(r[3], 400), sortOrder: Number(r[4]) || 0 };
    }).sort(function (a, b) { return a.sortOrder - b.sortOrder; }).slice(0, 8);
  } catch (err) {
    return [];
  }
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

function harvestMonthWindow_(today, before, after) {
  const out = [];
  const tz = Session.getScriptTimeZone();
  for (let i = -before; i <= after; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    out.push({ month: Utilities.formatDate(d, tz, 'yyyy-MM'), plots: 0, areaRai: 0, isCurrent: i === 0 });
  }
  return out;
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

function getSmartAgriReports_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const hit = cache.get(SMART_AGRI_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  }
  const reports = fetchSmartAgriReports_();
  // Cache failures briefly so a broken upstream is retried soon without hammering it.
  try { cache.put(SMART_AGRI_CACHE_KEY, JSON.stringify(reports), reports.ok ? SUMMARY_CACHE_SECONDS : 60); } catch (err) { /* too large */ }
  return reports;
}

function fetchSmartAgriReports_() {
  const props = PropertiesService.getScriptProperties();
  const key = String(props.getProperty('SMART_AGRI_API_KEY') || '').trim();
  const base = String(props.getProperty('SMART_AGRI_API_URL') || SMART_AGRI_DEFAULT_URL).trim();
  const source = { name: 'KPP Smart Agri-Materials', office: '', title: '' };
  if (!key) return { ok: false, configured: false, source: source, error: 'ยังไม่ได้ตั้งค่า SMART_AGRI_API_KEY ใน Script Properties' };
  try {
    const url = function (endpoint) {
      return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'api=v1&endpoint=' + endpoint +
        '&items=' + SMART_AGRI_ITEMS + '&key=' + encodeURIComponent(key);
    };
    const responses = UrlFetchApp.fetchAll(['summary', 'districts', 'timeseries', 'meta'].map(function (endpoint) {
      return { url: url(endpoint), muteHttpExceptions: true, followRedirects: true };
    }));
    const bodies = responses.map(function (res) {
      if (res.getResponseCode() !== 200) throw new Error('Smart Agri API HTTP ' + res.getResponseCode());
      const body = JSON.parse(res.getContentText());
      if (!body || body.ok === false) throw new Error('Smart Agri API: ' + (body && (body.error || body.code) || 'error'));
      return body;
    });
    return normalizeSmartAgri_(bodies[0], bodies[1], bodies[2], bodies[3]);
  } catch (err) {
    return { ok: false, configured: true, source: source, error: cleanText_(err && err.message || err, 200) };
  }
}

/** Reshape the external API into the compact, district-keyed form used by the dashboard. */
function normalizeSmartAgri_(summaryBody, districtsBody, seriesBody, metaBody) {
  const s = summaryBody.data || {};
  const d = (districtsBody && districtsBody.data) || {};
  const ts = (seriesBody && seriesBody.data) || {};
  const meta = (metaBody && metaBody.data) || {};
  const items = (s.items || []).map(function (it) {
    return { id: text_(it.id), code: text_(it.code), label: text_(it.label), unit: text_(it.unit),
      week: numOrNull_(it.week), cumulative: numOrNull_(it.cumulative), districtsYes: Number(it.districts_reporting_yes) || 0 };
  });
  const byDistrict = (d.districts || []).map(function (x) {
    const values = {};
    Object.keys(x.items || {}).forEach(function (id) {
      values[id] = { week: numOrNull_(x.items[id].week), cumulative: numOrNull_(x.items[id].cumulative) };
    });
    return { code: text_(x.amp_code), sourceCode: text_(x.code), name: text_(x.name), status: text_(x.status) || 'none',
      counted: !!x.counted, late: !!x.late, items: values };
  });
  const series = (ts.series || []).map(function (r) {
    const values = {};
    Object.keys(r.values || {}).forEach(function (id) {
      values[id] = { week: numOrNull_(r.values[id].week), cumulative: numOrNull_(r.values[id].cumulative) };
    });
    return { round: Number(r.round) || 0, label: text_(r.label), start: text_(r.start), end: text_(r.end), reported: Number(r.reported) || 0, values: values };
  });
  const round = s.round || {};
  return {
    ok: true,
    configured: true,
    source: { name: text_(meta.site) || 'KPP Smart Agri-Materials', office: text_(meta.office), title: text_(meta.title), season: text_(meta.season) },
    generatedAt: text_(summaryBody.generated_at),
    round: { round: Number(round.round) || 0, label: text_(round.label), start: text_(round.start), end: text_(round.end), due: text_(round.due) },
    districtsTotal: Number(s.districts_total) || byDistrict.length,
    reportedCount: s.reported ? Number(s.reported.count) || 0 : 0,
    statusCounts: s.status_counts || {},
    items: items,
    byDistrict: byDistrict,
    series: series
  };
}

function numOrNull_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/** Run from the editor after setting SMART_AGRI_API_KEY to confirm the connection. */
function verifySmartAgriConnection() {
  CacheService.getScriptCache().remove(SMART_AGRI_CACHE_KEY);
  const r = fetchSmartAgriReports_();
  if (!r.ok) return (r.configured ? 'FAIL: ' : 'INFO: ') + r.error;
  return 'PASS: Smart Agri-Materials — round ' + r.round.round + ' (' + r.round.label + '), ' + r.reportedCount + '/' +
    r.districtsTotal + ' district(s) reported, ' + r.items.length + ' indicator(s)';
}

/** Saves change the dashboard immediately instead of waiting for the cache to expire. */
function invalidateSummary_() {
  try { CacheService.getScriptCache().remove(SUMMARY_CACHE_KEY); } catch (err) { /* best effort */ }
}

/** Run from the editor after deployment to preview the public summary. */
function verifyPublicSummary() {
  const s = buildPublicSummary_(new Date());
  return 'PASS: summary ' + APP_VERSION + ' — ' + s.totals.farmerPlots + ' plot(s), ' + s.totals.areaRai + ' rai, ' +
    s.totals.buyers + ' buyer(s), ' + s.totals.districtsCovered + '/' + s.totals.districtsTotal + ' district(s) covered';
}

function loginServer(input) {
  input = input || {};
  const phone = normalizePhone_(input.phone || input.telephone || input.username || input);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  const rows = dataRows_(sheet_('users'));
  const found = rows.find(function (r) { return normalizePhone_(r[0]) === phone; });
  if (!found) throw new Error('ไม่พบหมายเลขโทรศัพท์นี้ในระบบ กรุณาลงทะเบียน');
  const role = normalizeRole_(found[2]);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const session = { phone: phone, role: role, name: cleanText_(found[3], 150) };
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(session), sessionTtlSeconds_());
  return { status: 'success', success: true, token: token, phone: phone, role: role, name: session.name };
}

function registerServer(input) {
  input = input || {};
  const phone = normalizePhone_(input.phone || input.telephone);
  const role = normalizeRole_(input.role || input.status);
  const name = cleanText_(input.name, 150);
  if (!/^0\d{9}$/.test(phone)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
  if (!name) throw new Error('กรุณากรอกชื่อ');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('users');
    ensureSheetDataFormats_();
    if (dataRows_(sh).some(function (r) { return normalizePhone_(r[0]) === phone; })) {
      throw new Error('หมายเลขโทรศัพท์นี้ลงทะเบียนแล้ว');
    }
    const now = new Date();
    // A:I = Telephone, Password(legacy/unused), Role, Name, System,
    // Consent, Consent_Timestamp, Created_At, Updated_At
    sh.appendRow([phone, '', role, name, false, true, now, now, now]);
  } finally {
    lock.releaseLock();
  }
  return { status: 'success', success: true, message: 'ลงทะเบียนสำเร็จ กรุณาเข้าสู่ระบบ' };
}

function getUserProfileServer(session) {
  if (session.role === 'farmer') {
    const farmers = farmerRecords_(session.phone);
    return { status: farmers.length ? 'success' : 'not_found', success: true, role: 'farmer', name: session.name, farmers: farmers,
      message: farmers.length ? '' : 'ยังไม่มีข้อมูลแปลง กรุณาเพิ่มข้อมูล' };
  }
  const buyers = buyerRecords_(session.phone);
  return { status: buyers.length ? 'success' : 'not_found', success: true, role: 'buyer', name: session.name, buyers: buyers,
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

function getMatchingDataServer(session) {
  // Enforce partner-only visibility at the API layer. Empty arrays are retained
  // for backward compatibility with the existing Frontend response structure.
  const isFarmer = session.role === 'farmer';
  const farmers = isFarmer ? [] : openFarmersWithCoordinates_().map(farmerPublic_);
  const buyers = isFarmer ? activeBuyersWithCoordinates_().map(buyerPublic_) : [];
  const ownPlots = isFarmer ? ownFarmerPlotsWithCoordinates_(session.phone).map(farmerPublic_) : [];
  return {
    status: 'success',
    success: true,
    apiVersion: APP_VERSION,
    viewerRole: session.role,
    visibleRole: isFarmer ? 'buyer' : 'farmer',
    farmers: farmers,
    buyers: buyers,
    ownPlots: ownPlots,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Single source of truth for the buyer's "ALL" option.
 * Deliberately ignores Havest_Date, Map_Expire_Date and Map_Visible.
 */
function openFarmersWithCoordinates_() {
  return dataRows_(sheet_('farmers')).filter(function (r) {
    return String(r[11] || '').trim().toLowerCase() === 'open' &&
      hasCoordinates_(r[9], r[10]);
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
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let row = data.id ? findOwnedRow_(sh, id, session.phone, 13) : 0;
    const occupiedRow = data.id ? findIdRow_(sh, id) : 0;
    if (occupiedRow && !row) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
    if (row) {
      rowValues[1] = sh.getRange(row, 2).getValue() || now;
      sh.getRange(row, 1, 1, 18).setValues([rowValues]);
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
  return { status: 'success', success: true, id: id, message: 'บันทึกข้อมูลเกษตรกรสำเร็จ' };
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
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let row = data.id ? findOwnedRow_(sh, id, session.phone, 13) : 0;
    const occupiedRow = data.id ? findIdRow_(sh, id) : 0;
    if (occupiedRow && !row) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
    if (row) {
      rowValues[1] = sh.getRange(row, 2).getValue() || now;
      sh.getRange(row, 1, 1, 17).setValues([rowValues]);
    } else {
      sh.appendRow(rowValues);
      row = sh.getLastRow();
    }
    formatBuyerRow_(sh, row);
  } finally {
    lock.releaseLock();
  }
  invalidateSummary_();
  return { status: 'success', success: true, id: id, message: 'บันทึกข้อมูลผู้ซื้อสำเร็จ' };
}

function farmerRecords_(phone) {
  return dataRows_(sheet_('farmers')).filter(function (r) {
    return isOwned_(r, phone, 12) && String(r[11]) !== 'Deleted';
  }).map(function (r) {
    return {
      id: text_(r[0]), timestamp: dateTime_(r[1]), fname: text_(r[2]), lname: text_(r[3]), phone: displayPhone_(r[4]),
      crop: text_(r[5]), plantDate: dateInput_(r[6]), harvestDate: dateInput_(r[7]), area: text_(r[8]),
      lat: maybeNumber_(r[9]), lng: maybeNumber_(r[10]), recordStatus: text_(r[11]), materialType: text_(r[13]), materialOther: text_(r[14])
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
      recordStatus: text_(r[11]), materialType: text_(r[13]), materialOther: text_(r[14])
    };
  });
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
  invalidateSummary_();
  const summary = verifyPublicSummary();
  const reports = verifySmartAgriConnection();
  const adminSchema = ensureAdminSchema_();
  const cropSchema = ensureCropSchema_();
  const superAdmin = ensureSuperAdmin_();
  invalidateCropSummary_();
  const out = [migration, formats, normalized, schema, restored, trigger, summary, reports, adminSchema, cropSchema, superAdmin].join('\n');
  console.log(out);
  return out;
}

/**
 * Run from the Apps Script editor after setupSystem().
 * The returned count must match Open farmer rows with valid Lat/Lng in farmers!A:R.
 */
function verifyLiveMatchingData() {
  const rows = openFarmersWithCoordinates_();
  return 'PASS: API ' + APP_VERSION + ' returns ' + rows.length +
    ' Open farmer record(s) with coordinates; harvest expiry and Map_Visible are ignored';
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
      sh.getRange(row, 16).setValue('');
      sh.getRange(row, 17).setFormula('=L' + row + '="Open"');
    }
  });
  return 'PASS: restored ' + restored + ' legacy Expired farmer record(s) to Open';
}

function setFarmerFormulas_(sh, row) {
  // Keep the existing P/Q columns for schema compatibility, but do not expire by harvest date.
  sh.getRange(row, 16).setValue('');
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
  if (MATERIAL_TYPES.indexOf(type) < 0) throw new Error('กรุณาเลือกชนิดเศษวัสดุ');
  if (type === 'อื่นๆ' && !other) throw new Error('กรุณาระบุชนิดเศษวัสดุอื่นๆ');
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
