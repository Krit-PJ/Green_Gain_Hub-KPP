/**
 * Green Gain Hub 1.6.0 — crop area import (ทะเบียนเกษตรกร) and public crop summary.
 *
 * Source: DOAE farmer-registry report exported per crop, grouped by expected
 * harvest month: rows of province (62-00) / district (62-01) / sub-district
 * (62-01-04) × month (yyyymm) with households, plots and area (rai).
 *
 * Model (per crop + season):
 *   planted area      = sum of every harvest month
 *   harvested by month = value of that month
 *   remaining as of M  = planted − harvested in months ≤ M (M = last full month)
 *
 * Re-importing the same crop + season REPLACES the previous import (snapshot),
 * so registry corrections can raise or lower the totals without double counting.
 */

const CROP_PROVINCE_CODE = '62';
const CROP_MONTH_TYPES = { harvest: 'เดือนที่คาดว่าจะเก็บเกี่ยว' };
const CROP_SHEETS = {
  crop_types: ['Crop', 'Material', 'Active', 'Sort_Order', 'Updated_At'],
  crop_imports: ['Import_ID', 'Crop', 'Season', 'Month_Type', 'File_Name', 'Rows', 'Total_Rai', 'Periods', 'Status', 'Imported_At', 'Imported_By', 'Replaced_By', 'Note'],
  crop_stats: ['Import_ID', 'Crop', 'Season', 'Month_Type', 'Period', 'Level', 'Code', 'Name', 'Households', 'Plots', 'Area_Rai']
};
const DEFAULT_CROP_TYPES = [
  ['ข้าวนาปี', 'ฟางข้าว', true, 1],
  ['ข้าวนาปรัง', 'ฟางข้าว', true, 2],
  ['อ้อยโรงงาน', 'ใบอ้อย', true, 3],
  ['ข้าวโพดเลี้ยงสัตว์', 'ซังและต้นข้าวโพด', true, 4],
  ['มันสำปะหลัง', 'เหง้ามันสำปะหลัง', true, 5]
];
const CROP_SUMMARY_CACHE_KEY = 'crops:v1:1.6.0'; // literal: Apps Script evaluates files in creation order
const CROP_MAX_ROWS = 6000;

function ensureCropSchema_() {
  Object.keys(CROP_SHEETS).forEach(function (n) { ensureSheet_(n, CROP_SHEETS[n]); });
  const types = sheetByName_('crop_types');
  if (types.getLastRow() < 2) {
    const now = new Date();
    types.getRange(2, 1, DEFAULT_CROP_TYPES.length, 5).setValues(DEFAULT_CROP_TYPES.map(function (r) { return r.concat([now]); }));
  }
  sheetByName_('crop_stats').getRange('E:G').setNumberFormat('@');
  sheetByName_('crop_imports').getRange('A:A').setNumberFormat('@');
  return 'PASS: crop_types, crop_imports and crop_stats sheets are ready';
}

function truthyCell_(v) {
  return v === true || /^(true|yes|1|ใช่)$/i.test(String(v).trim());
}

/* ------------------------------ crop types ------------------------------ */

function cropTypesList_(includeInactive) {
  return dataRows_(sheetByName_('crop_types')).map(function (r) {
    return { crop: text_(r[0]), material: text_(r[1]), active: truthyCell_(r[2]), sortOrder: Number(r[3]) || 99 };
  }).filter(function (t) { return t.crop && (includeInactive || t.active); })
    .sort(function (a, b) { return a.sortOrder - b.sortOrder || a.crop.localeCompare(b.crop, 'th'); });
}

function cropTypeSave_(input, s) {
  input = input || {};
  const crop = cleanText_(input.crop, 60);
  const material = cleanText_(input.material, 80);
  if (!crop) throw new Error('กรุณากรอกชื่อพืช');
  if (!material) throw new Error('กรุณากรอกชนิดเศษวัสดุ');
  const active = input.active !== false;
  const sortOrder = Math.max(1, Math.min(999, Number(input.sortOrder) || 99));
  const sh = sheetByName_('crop_types');
  const rows = dataRows_(sh);
  const idx = rows.findIndex(function (r) { return text_(r[0]) === crop; });
  const values = [crop, material, active, sortOrder, new Date()];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, 5).setValues([values]); else sh.appendRow(values);
  invalidateCropSummary_();
  adminAudit_(s, 'crop_type_save', crop + ' / ' + material + (active ? '' : ' (ปิด)'));
  return { status: 'success', types: cropTypesList_(true) };
}

/* ------------------------------ validation ------------------------------ */

function cropLevel_(code) {
  const parts = code.split('-');
  if (parts.length === 2) return parts[1] === '00' ? 'province' : 'district';
  return 'subdistrict';
}

/** Server-side validation shared by the preview check and the commit. */
function validateCropImport_(input) {
  input = input || {};
  const crop = cleanText_(input.crop, 60);
  const types = cropTypesList_(false);
  const type = types.find(function (t) { return t.crop === crop; });
  if (!type) throw new Error('กรุณาเลือกชนิดพืชที่เปิดใช้งานก่อนนำเข้า');
  const season = cleanText_(input.season, 12);
  if (!/^\d{4}(\/\d{2})?$/.test(season)) throw new Error('ปีการผลิตต้องเป็นรูปแบบ 2569 หรือ 2569/70');
  const monthType = String(input.monthType || 'harvest');
  if (!CROP_MONTH_TYPES[monthType]) throw new Error('รุ่นนี้รองรับเฉพาะข้อมูลแยกตามเดือนที่คาดว่าจะเก็บเกี่ยว');
  const raw = Array.isArray(input.rows) ? input.rows : [];
  if (!raw.length) throw new Error('ไม่พบข้อมูลในไฟล์');
  if (raw.length > CROP_MAX_ROWS) throw new Error('ข้อมูลมากเกิน ' + CROP_MAX_ROWS + ' แถว');

  const seen = {};
  const rows = raw.map(function (r, i) {
    const line = 'แถวที่ ' + (Number(r && r.line) || i + 1) + ': ';
    const code = String(r && r.code || '').trim();
    if (!/^\d{2}-\d{2}(-\d{2})?$/.test(code)) throw new Error(line + 'รหัสพื้นที่ไม่ถูกต้อง (' + cleanText_(code, 20) + ')');
    if (code.slice(0, 2) !== CROP_PROVINCE_CODE) throw new Error(line + 'ข้อมูลไม่ใช่จังหวัดกำแพงเพชร (รหัส ' + code + ')');
    const period = String(r.period || '').trim();
    const m = period.match(/^(\d{4})(\d{2})$/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(line + 'ปีเดือนไม่ถูกต้อง (' + cleanText_(period, 10) + ')');
    const area = Number(r.area);
    if (!isFinite(area) || area < 0) throw new Error(line + 'เนื้อที่ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    const key = code + '|' + period;
    if (seen[key]) throw new Error(line + 'ข้อมูลซ้ำ ' + code + ' เดือน ' + period);
    seen[key] = true;
    return {
      code: code, level: cropLevel_(code), name: cleanText_(String(r.name || '').replace(/ /g, ' '), 80), period: period,
      households: Math.max(0, Math.round(Number(r.households) || 0)), plots: Math.max(0, Math.round(Number(r.plots) || 0)), area: round_(area, 2)
    };
  });

  // Consistency: district sum = province, sub-district sum = district (per month).
  const errors = [];
  const warnings = [];
  const periods = {};
  rows.forEach(function (r) { (periods[r.period] = periods[r.period] || { province: null, district: 0, sub: {}, districtArea: {} }); });
  rows.forEach(function (r) {
    const p = periods[r.period];
    if (r.level === 'province') p.province = r.area;
    else if (r.level === 'district') { p.district += r.area; p.districtArea[r.code] = r.area; }
    else { const d = r.code.slice(0, 5); p.sub[d] = (p.sub[d] || 0) + r.area; }
  });
  const tol = function (v) { return Math.max(1, Math.abs(v) * 0.001); };
  Object.keys(periods).sort().forEach(function (per) {
    const p = periods[per];
    if (!Object.keys(p.districtArea).length) errors.push('เดือน ' + per + ': ไม่มีข้อมูลระดับอำเภอ');
    if (p.province !== null && Math.abs(p.province - p.district) > tol(p.province)) {
      errors.push('เดือน ' + per + ': ผลรวมอำเภอ ' + round_(p.district, 2) + ' ไม่ตรงกับยอดจังหวัด ' + p.province);
    }
    if (p.province === null) warnings.push('เดือน ' + per + ': ไม่มีแถวยอดรวมจังหวัด ระบบใช้ผลรวมอำเภอแทน');
    Object.keys(p.sub).forEach(function (d) {
      const dist = p.districtArea[d];
      if (dist === undefined) errors.push('เดือน ' + per + ': มีตำบลของ ' + d + ' แต่ไม่มีแถวอำเภอ');
      else if (Math.abs(dist - p.sub[d]) > tol(dist)) errors.push('เดือน ' + per + ': ผลรวมตำบลของ ' + d + ' (' + round_(p.sub[d], 2) + ') ไม่ตรงกับยอดอำเภอ ' + dist);
    });
  });
  if (errors.length) throw new Error('ข้อมูลไม่สอดคล้องกัน: ' + errors.slice(0, 5).join(' | ') + (errors.length > 5 ? ' และอีก ' + (errors.length - 5) + ' รายการ' : ''));

  const byPeriod = Object.keys(periods).sort().map(function (per) {
    const p = periods[per];
    return { period: per, areaRai: round_(p.province !== null ? p.province : p.district, 2) };
  });
  return {
    crop: crop, material: type.material, season: season, monthType: monthType, rows: rows, warnings: warnings, byPeriod: byPeriod,
    totalRai: round_(byPeriod.reduce(function (s, x) { return s + x.areaRai; }, 0), 2),
    districts: Object.keys(rows.reduce(function (o, r) { if (r.level === 'district') o[r.code] = 1; return o; }, {})).length,
    subdistricts: Object.keys(rows.reduce(function (o, r) { if (r.level === 'subdistrict') o[r.code] = 1; return o; }, {})).length
  };
}

function activeImportFor_(crop, season, monthType) {
  return dataRows_(sheetByName_('crop_imports')).map(cropImportRecord_).filter(function (x) {
    return x.status === 'active' && x.crop === crop && x.season === season && x.monthType === monthType;
  });
}

function cropImportRecord_(r) {
  return { importId: text_(r[0]), crop: text_(r[1]), season: text_(r[2]), monthType: text_(r[3]), fileName: text_(r[4]),
    rows: Number(r[5]) || 0, totalRai: Number(r[6]) || 0, periods: text_(r[7]), status: text_(r[8]),
    importedAt: dateTime_(r[9]), importedBy: text_(r[10]), replacedBy: text_(r[11]), note: text_(r[12]) };
}

/** Dry run for the preview step: validates and reports what would be replaced. Nothing is written. */
function cropImportCheck_(input) {
  const v = validateCropImport_(input);
  const existing = activeImportFor_(v.crop, v.season, v.monthType);
  return { status: 'success', crop: v.crop, material: v.material, season: v.season, monthType: v.monthType,
    rows: v.rows.length, totalRai: v.totalRai, byPeriod: v.byPeriod, districts: v.districts, subdistricts: v.subdistricts,
    warnings: v.warnings, replaces: existing.map(function (x) { return { importId: x.importId, importedAt: x.importedAt, totalRai: x.totalRai, fileName: x.fileName }; }) };
}

function cropImportCommit_(input, s) {
  const v = validateCropImport_(input);
  const fileName = cleanText_(input && input.fileName, 150);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const importId = 'CI' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const stats = sheetByName_('crop_stats');
    const values = v.rows.map(function (r) {
      return [importId, v.crop, v.season, v.monthType, r.period, r.level, r.code, r.name, r.households, r.plots, r.area];
    });
    const start = stats.getLastRow() + 1;
    stats.getRange(start, 1, values.length, values[0].length).setValues(values);

    const imports = sheetByName_('crop_imports');
    const rows = dataRows_(imports);
    let replaced = 0;
    rows.forEach(function (r, i) {
      if (text_(r[8]) === 'active' && text_(r[1]) === v.crop && text_(r[2]) === v.season && text_(r[3]) === v.monthType) {
        imports.getRange(i + 2, 9).setValue('replaced');
        imports.getRange(i + 2, 12).setValue(importId);
        replaced++;
      }
    });
    imports.appendRow([importId, v.crop, v.season, v.monthType, fileName, values.length, v.totalRai,
      v.byPeriod[0].period + '-' + v.byPeriod[v.byPeriod.length - 1].period, 'active', new Date(), s.name + ' (' + s.phone + ')', '', v.warnings.join(' | ')]);
    imports.getRange(imports.getLastRow(), 1).setNumberFormat('@');
    invalidateCropSummary_();
    adminAudit_(s, 'crop_import', v.crop + ' ' + v.season + ': ' + values.length + ' แถว, ' + v.totalRai + ' ไร่' + (replaced ? ' (แทนที่ ' + replaced + ' ชุด)' : '') + (fileName ? ' จาก ' + fileName : ''));
    return { status: 'success', importId: importId, crop: v.crop, season: v.season, rows: values.length, totalRai: v.totalRai, replaced: replaced,
      message: 'นำเข้าข้อมูล ' + v.crop + ' ปี ' + v.season + ' แล้ว ' + values.length + ' แถว' + (replaced ? ' และแทนที่ข้อมูลชุดเดิม' : '') };
  } finally {
    lock.releaseLock();
  }
}

function cropImportsList_() {
  return dataRows_(sheetByName_('crop_imports')).map(cropImportRecord_).reverse();
}

/** Soft delete: the rows stay in crop_stats for audit but no longer count. */
function cropImportDelete_(input, s) {
  const id = cleanText_(input && input.importId, 40);
  const sh = sheetByName_('crop_imports');
  const rows = dataRows_(sh);
  const idx = rows.findIndex(function (r) { return text_(r[0]) === id; });
  if (idx < 0) throw new Error('ไม่พบชุดข้อมูลนี้');
  if (text_(rows[idx][8]) === 'deleted') throw new Error('ชุดข้อมูลนี้ถูกลบแล้ว');
  sh.getRange(idx + 2, 9).setValue('deleted');
  invalidateCropSummary_();
  adminAudit_(s, 'crop_import_delete', id + ' ' + text_(rows[idx][1]) + ' ' + text_(rows[idx][2]));
  return { status: 'success', message: 'ลบชุดข้อมูลแล้ว ข้อมูลชุดนี้จะไม่แสดงบนหน้าแรก' };
}

function invalidateCropSummary_() {
  const c = CacheService.getScriptCache();
  try { c.remove(CROP_SUMMARY_CACHE_KEY); c.remove(SUMMARY_CACHE_KEY); } catch (err) { /* best effort */ }
  try { PropertiesService.getScriptProperties().setProperty('CROP_DATA_VERSION', String(Date.now())); } catch (err) { /* best effort */ }
}

/* ------------------------------ public summary ------------------------------ */

function getCropSummary_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const hit = cache.get(CROP_SUMMARY_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  }
  let out;
  try {
    out = buildCropSummary_(new Date());
  } catch (err) {
    out = { ok: false, error: cleanText_(err && err.message || err, 200), crops: [] };
  }
  try { cache.put(CROP_SUMMARY_CACHE_KEY, JSON.stringify(out), SUMMARY_CACHE_SECONDS); } catch (err) { /* too large to cache */ }
  return out;
}

function yyyymm_(d) { return d.getFullYear() * 100 + d.getMonth() + 1; }
function addMonth_(ym, n) {
  const y = Math.floor(ym / 100), m = ym % 100 - 1 + n;
  return (y + Math.floor(m / 12)) * 100 + ((m % 12) + 12) % 12 + 1;
}

/** Rows of the active imports, grouped by import id. */
function activeCropRows_() {
  const ss = spreadsheet_();
  if (!ss.getSheetByName('crop_imports') || !ss.getSheetByName('crop_stats')) return { imports: [], rows: {} };
  const imports = dataRows_(sheetByName_('crop_imports')).map(cropImportRecord_).filter(function (x) { return x.status === 'active'; });
  const ids = {};
  imports.forEach(function (x) { ids[x.importId] = []; });
  dataRows_(sheetByName_('crop_stats')).forEach(function (r) {
    const id = text_(r[0]);
    if (ids[id]) ids[id].push({ period: Number(text_(r[4])), level: text_(r[5]), code: text_(r[6]), name: text_(r[7]),
      households: Number(r[8]) || 0, plots: Number(r[9]) || 0, area: Number(r[10]) || 0 });
  });
  return { imports: imports, rows: ids };
}

function buildCropSummary_(now) {
  const data = activeCropRows_();
  const meta = { ok: true, generatedAt: now.toISOString(), source: 'ระบบฐานข้อมูลทะเบียนเกษตรกรกลาง กรมส่งเสริมการเกษตร',
    note: 'พื้นที่เก็บเกี่ยวเป็นค่าคาดการณ์จากวันที่คาดว่าจะเก็บเกี่ยวในทะเบียนเกษตรกร' };
  if (!data.imports.length) { meta.crops = []; return meta; }
  const types = {};
  if (spreadsheet_().getSheetByName('crop_types')) cropTypesList_(true).forEach(function (t) { types[t.crop] = t; });
  const refs = researchRefs_();
  const asOf = addMonth_(yyyymm_(now), -1);
  const current = yyyymm_(now);

  const crops = data.imports.map(function (imp) {
    const rows = data.rows[imp.importId] || [];
    const periods = {};
    rows.forEach(function (r) {
      const p = periods[r.period] || (periods[r.period] = { province: null, district: 0, households: 0, plots: 0, hhDistrict: 0, plotsDistrict: 0 });
      if (r.level === 'province') { p.province = r.area; p.households = r.households; p.plots = r.plots; }
      else if (r.level === 'district') { p.district += r.area; p.hhDistrict += r.households; p.plotsDistrict += r.plots; }
    });
    const months = Object.keys(periods).map(Number).sort().map(function (per) {
      const p = periods[per];
      return { month: per, areaRai: round_(p.province !== null ? p.province : p.district, 2),
        households: p.province !== null ? p.households : p.hhDistrict, plots: p.province !== null ? p.plots : p.plotsDistrict };
    });
    const total = months.reduce(function (s, m) { return s + m.areaRai; }, 0);
    const harvested = months.filter(function (m) { return m.month <= asOf; }).reduce(function (s, m) { return s + m.areaRai; }, 0);
    const monthArea = function (ym) { const m = months.find(function (x) { return x.month === ym; }); return m ? m.areaRai : 0; };

    const dmap = {};
    rows.filter(function (r) { return r.level === 'district'; }).forEach(function (r) {
      const code = r.code.replace('-', '');
      const d = dmap[code] || (dmap[code] = { code: code, name: r.name, totalRai: 0, months: {} });
      d.months[r.period] = round_((d.months[r.period] || 0) + r.area, 2);
      d.totalRai += r.area;
    });
    const byDistrict = Object.keys(dmap).sort().map(function (code) {
      const d = dmap[code];
      const h = Object.keys(d.months).filter(function (k) { return Number(k) <= asOf; }).reduce(function (s, k) { return s + d.months[k]; }, 0);
      return { code: code, name: d.name, totalRai: round_(d.totalRai, 2), harvestedRai: round_(h, 2), remainingRai: round_(d.totalRai - h, 2),
        currentMonthRai: round_(d.months[current] || 0, 2), months: d.months };
    });

    const type = types[imp.crop] || { material: '', sortOrder: 99 };
    const ref = type.material ? refs[type.material] : null;
    const bio = ref && ref.bioRate !== null ? ref.bioRate : null;
    return {
      crop: imp.crop, season: imp.season, material: type.material, sortOrder: type.sortOrder, monthType: imp.monthType,
      monthTypeLabel: CROP_MONTH_TYPES[imp.monthType] || imp.monthType,
      importId: imp.importId, importedAt: imp.importedAt, fileName: imp.fileName,
      asOfMonth: asOf, currentMonth: current,
      totalRai: round_(total, 2), harvestedRai: round_(harvested, 2), remainingRai: round_(total - harvested, 2),
      currentMonthRai: round_(monthArea(current), 2), nextMonthRai: round_(monthArea(addMonth_(current, 1)), 2),
      firstMonth: months.length ? months[0].month : null, lastMonth: months.length ? months[months.length - 1].month : null,
      months: months, byDistrict: byDistrict,
      residue: bio === null ? null : { material: type.material, bioRateTonPerRai: bio,
        harvestedTon: round_(harvested * bio, 1), remainingTon: round_((total - harvested) * bio, 1), currentMonthTon: round_(monthArea(current) * bio, 1) }
    };
  }).sort(function (a, b) { return a.sortOrder - b.sortOrder || String(b.season).localeCompare(String(a.season)); });

  meta.crops = crops;
  return meta;
}

/** Sub-district breakdown for one district of one crop/season (public, aggregate only). */
function getCropDetail_(p) {
  const crop = cleanText_(p.crop, 60);
  const season = cleanText_(p.season, 12);
  const district = String(p.district || '').replace(/\D/g, '');
  if (!crop || !/^\d{4}$/.test(district)) throw new Error('ต้องระบุ crop และ district (เช่น 6201)');
  const verKey = PropertiesService.getScriptProperties().getProperty('CROP_DATA_VERSION') || '0';
  const ck = 'cropd:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, [verKey, crop, season, district].join('|'), Utilities.Charset.UTF_8));
  const cache = CacheService.getScriptCache();
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  const data = activeCropRows_();
  const imp = data.imports.filter(function (x) { return x.crop === crop && (!season || x.season === season); })
    .sort(function (a, b) { return String(b.season).localeCompare(String(a.season)); })[0];
  if (!imp) throw new Error('ไม่พบข้อมูลพืชนี้');
  const asOf = addMonth_(yyyymm_(new Date()), -1);
  const prefix = district.slice(0, 2) + '-' + district.slice(2) + '-';
  const tmap = {};
  (data.rows[imp.importId] || []).filter(function (r) { return r.level === 'subdistrict' && r.code.indexOf(prefix) === 0; }).forEach(function (r) {
    const code = r.code.replace(/-/g, '');
    const t = tmap[code] || (tmap[code] = { code: code, name: r.name, totalRai: 0, months: {} });
    t.months[r.period] = round_((t.months[r.period] || 0) + r.area, 2);
    t.totalRai += r.area;
  });
  const subdistricts = Object.keys(tmap).map(function (k) {
    const t = tmap[k];
    const h = Object.keys(t.months).filter(function (m) { return Number(m) <= asOf; }).reduce(function (s, m) { return s + t.months[m]; }, 0);
    return { code: t.code, name: t.name, totalRai: round_(t.totalRai, 2), harvestedRai: round_(h, 2), remainingRai: round_(t.totalRai - h, 2), months: t.months };
  }).sort(function (a, b) { return b.totalRai - a.totalRai; });
  const out = { crop: imp.crop, season: imp.season, district: district, asOfMonth: asOf, subdistricts: subdistricts };
  try { cache.put(ck, JSON.stringify(out), SUMMARY_CACHE_SECONDS); } catch (err) { /* too large */ }
  return out;
}
