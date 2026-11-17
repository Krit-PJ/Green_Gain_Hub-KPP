/**
 * Green Gain Hub 2.0.0 — residue management records, targets and GHG avoided.
 *
 * Admin (district recorder) records what was done instead of burning: date, crop,
 * management type, sub-district, managed area (rai), optional GPS, 1–3 photos.
 * The recorder confirms the record when saving; there is no separate approval step.
 * Admin sees and records only the district on the account; Mini Super Admin and
 * Super Admin see every district. GHG is computed on the fly from the current
 * parameter set (Ghg.gs), so one total never mixes two parameter sets.
 *
 * Fiscal year (ปีงบประมาณ) = 1 Oct – 30 Sep, in Buddhist Era (Oct 2026 → 2570).
 */

const RESIDUE_SHEETS = {
  residue_records: ['Record_ID', 'Record_Date', 'Fiscal_Year', 'District_Code', 'District_Name', 'Subdistrict_Code', 'Subdistrict_Name',
    'Crop_Key', 'Crop_Name', 'Crop_Other', 'Method', 'Method_Other', 'Area_Rai', 'Lat', 'Lng', 'Photo_IDs', 'Biomass_Mode', 'MB_kg_rai', 'Cf',
    'Fresh_kg_rai', 'DMF', 'Data_Status', 'Reference', 'Note', 'Recorded_By', 'Recorder_Name', 'Confirmed_At', 'Status', 'Created_At', 'Updated_At', 'Updated_By'],
  residue_methods: ['Method', 'Crop_Key', 'Needs_Detail', 'Active', 'Sort_Order', 'Updated_At', 'Count_Value'],
  residue_targets: ['Fiscal_Year', 'District_Code', 'District_Name', 'Method', 'Target_Rai', 'Officers', 'Note', 'Updated_At', 'Updated_By']
};
const RC = {}; // column index by header (0-based) for residue_records
RESIDUE_SHEETS.residue_records.forEach(function (h, i) { RC[h] = i; });

const RESIDUE_DEFAULT_METHODS = [
  ['ไถกลบ', '', false, true, 1], ['อัดฟางก้อน', 'rice', false, true, 2], ['อัดใบอ้อย', 'sugarcane', false, true, 3],
  ['ทำปุ๋ยหมัก', '', false, true, 4], ['เพาะเห็ด', '', false, true, 5], ['อื่น ๆ', '', true, true, 9]
];
// Ploughing-in sells nothing, so by default it does not add to the estimated value (switchable per type).
function residueDefaultCountValue_(method) { return method !== 'ไถกลบ'; }
// ไฟล์ "1.2 เป้าหมาย ปี 2570": district code, officers (นวส.), target (rai, all management types)
const RESIDUE_TARGETS_2570 = [['6201', 8, 12000], ['6202', 4, 6000], ['6203', 4, 6000], ['6204', 7, 10500], ['6205', 4, 6000], ['6206', 5, 7500],
  ['6207', 4, 6000], ['6208', 2, 3000], ['6209', 2, 3000], ['6210', 4, 6000], ['6211', 3, 4500]];
const RESIDUE_MAX_PHOTOS = 3;
const RESIDUE_MAX_PHOTO_CHARS = 1600000; // base64 ≈ 1.2 MB; the page resizes photos before upload
const RESIDUE_CACHE_SECONDS = 300;
const RESIDUE_PHOTO_FOLDER_NAME = 'GGH ภาพการจัดการเศษวัสดุ';
// 78 sub-districts of Kamphaeng Phet (DOPA codes), from the DOAE farmer-registry report.
const KPP_SUBDISTRICTS = [
  ["620101", "ในเมือง"], ["620102", "ไตรตรึงษ์"], ["620103", "อ่างทอง"], ["620104", "นาบ่อคำ"], ["620105", "นครชุม"], ["620106", "ทรงธรรม"],
  ["620107", "ลานดอกไม้"], ["620110", "หนองปลิง"], ["620111", "คณฑี"], ["620112", "นิคมทุ่งโพธิ์ทะเล"], ["620113", "เทพนคร"], ["620114", "วังทอง"],
  ["620115", "ท่าขุนราม"], ["620117", "คลองแม่ลาย"], ["620118", "ธำมรงค์"], ["620119", "สระแก้ว"], ["620201", "ไทรงาม"], ["620202", "หนองคล้า"],
  ["620203", "หนองทอง"], ["620204", "หนองไม้กอง"], ["620205", "มหาชัย"], ["620206", "พานทอง"], ["620207", "หนองแม่แตง"], ["620301", "คลองน้ำไหล"],
  ["620302", "โป่งน้ำร้อน"], ["620303", "คลองลานพัฒนา"], ["620304", "สักงาม"], ["620403", "ยางสูง"], ["620404", "ป่าพุทรา"], ["620405", "แสนตอ"],
  ["620406", "สลกบาตร"], ["620407", "บ่อถ้ำ"], ["620408", "ดอนแตง"], ["620409", "วังชะพลู"], ["620410", "โค้งไผ่"], ["620411", "ปางมะค่า"],
  ["620412", "วังหามแห"], ["620413", "เกาะตาล"], ["620501", "คลองขลุง"], ["620502", "ท่ามะเขือ"], ["620504", "ท่าพุทรา"], ["620505", "แม่ลาด"],
  ["620506", "วังยาง"], ["620507", "วังแขม"], ["620508", "หัวถนน"], ["620509", "วังไทร"], ["620513", "วังบัว"], ["620516", "คลองสมบูรณ์"],
  ["620601", "พรานกระต่าย"], ["620602", "หนองหัววัว"], ["620603", "ท่าไม้"], ["620604", "วังควง"], ["620605", "วังตะแบก"], ["620606", "เขาคีริส"],
  ["620607", "คุยบ้านโอง"], ["620608", "คลองพิไกร"], ["620609", "ถ้ำกระต่ายทอง"], ["620610", "ห้วยยั้ง"], ["620701", "ลานกระบือ"], ["620702", "ช่องลม"],
  ["620703", "หนองหลวง"], ["620704", "โนนพลวง"], ["620705", "ประชาสุขสันต์"], ["620706", "บึงทับแรต"], ["620707", "จันทิมา"], ["620801", "ทุ่งทราย"],
  ["620802", "ทุ่งทอง"], ["620803", "ถาวรวัฒนา"], ["620901", "โพธิ์ทอง"], ["620902", "หินดาต"], ["620903", "ปางตาไว"], ["621001", "บึงสามัคคี"],
  ["621002", "วังชะโอน"], ["621003", "ระหาน"], ["621004", "เทพนิมิต"], ["621101", "โกสัมพี"], ["621102", "เพชรชมภู"], ["621103", "ลานดอกไม้ตก"]
];

/* ------------------------------ setup ------------------------------ */

function ensureResidueSchema_() {
  Object.keys(RESIDUE_SHEETS).forEach(function (n) { ensureSheet_(n, RESIDUE_SHEETS[n]); });
  const now = new Date();
  const ms = sheetByName_('residue_methods');
  if (ms.getLastRow() < 2) ms.getRange(2, 1, RESIDUE_DEFAULT_METHODS.length, 7).setValues(RESIDUE_DEFAULT_METHODS.map(function (r) { return r.concat([now, residueDefaultCountValue_(r[0])]); }));
  dataRows_(ms).forEach(function (r, i) { if (text_(r[0]) && (r[6] === '' || r[6] === undefined)) ms.getRange(i + 2, 7).setValue(residueDefaultCountValue_(text_(r[0]))); });
  const ts = sheetByName_('residue_targets');
  let seeded = '';
  if (ts.getLastRow() < 2) {
    const names = residueDistrictNames_();
    ts.getRange(2, 1, RESIDUE_TARGETS_2570.length, 9).setValues(RESIDUE_TARGETS_2570.map(function (t) {
      return [2570, t[0], names[t[0]] || t[0], '', t[2], t[1], 'ไฟล์ 1.2 เป้าหมาย ปี 2570', now, 'setupSystem'];
    }));
    seeded = ', targets 2570 seeded (' + RESIDUE_TARGETS_2570.reduce(function (a, t) { return a + t[2]; }, 0) + ' rai)';
  }
  ['A:A', 'F:F', 'H:H'].forEach(function (r) { sheetByName_('residue_records').getRange(r).setNumberFormat('@'); });
  ts.getRange('B:B').setNumberFormat('@');
  ensureConfigValue_('province_name', 'กำแพงเพชร', '', 'ชื่อจังหวัดที่แสดงบนหน้าเว็บและรายงาน');
  ensureConfigValue_('office_name', 'สำนักงานเกษตรจังหวัดกำแพงเพชร', '', 'ชื่อหน่วยงานในหัวรายงาน');
  invalidateResidue_();
  return 'PASS: residue_records, residue_methods and residue_targets are ready' + seeded + '\n' + ensureResiduePhotoFolder_();
}

function ensureConfigValue_(key, value, unit, description) {
  const sh = sheet_('settings');
  const rows = dataRows_(sh);
  if (!rows.some(function (r) { return text_(r[0]) === key; })) sh.appendRow([key, value, unit, description]);
}

function configValue_(key, fallback) {
  try {
    const r = dataRows_(sheet_('settings')).find(function (x) { return text_(x[0]) === key; });
    return r && text_(r[1]) ? text_(r[1]) : fallback;
  } catch (err) { return fallback; }
}
function provinceName_() { return configValue_('province_name', 'กำแพงเพชร'); }
function officeName_() { return configValue_('office_name', 'สำนักงานเกษตรจังหวัด' + provinceName_()); }

function setConfigValue_(key, value, description) {
  const sh = sheet_('settings');
  const rows = dataRows_(sh);
  const i = rows.findIndex(function (r) { return text_(r[0]) === key; });
  if (i >= 0) sh.getRange(i + 2, 2).setValue(value); else sh.appendRow([key, value, '', description || '']);
}

/** Private Drive folder next to the database; created once, id kept in Script Properties. */
function ensureResiduePhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('RESIDUE_PHOTO_FOLDER_ID');
  if (id) {
    try { DriveApp.getFolderById(id).getName(); return 'PASS: photo folder is ready'; } catch (err) { /* recreate below */ }
  }
  const parents = DriveApp.getFileById(spreadsheet_().getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const found = parent.getFoldersByName(RESIDUE_PHOTO_FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : parent.createFolder(RESIDUE_PHOTO_FOLDER_NAME);
  props.setProperty('RESIDUE_PHOTO_FOLDER_ID', folder.getId());
  return 'PASS: photo folder "' + RESIDUE_PHOTO_FOLDER_NAME + '" is ready (private)';
}

/* ------------------------------ reference data ------------------------------ */

function residueDistrictNames_() {
  const o = {};
  districtList_().forEach(function (d) { o[d.code] = d.name; });
  return o;
}
function residueSubdistricts_(district) {
  return KPP_SUBDISTRICTS.filter(function (t) { return !district || t[0].slice(0, 4) === district; })
    .map(function (t) { return { code: t[0], name: t[1], district: t[0].slice(0, 4) }; });
}
function residueMethods_(includeInactive) {
  const sh = spreadsheet_().getSheetByName('residue_methods');
  const rows = sh ? dataRows_(sh) : RESIDUE_DEFAULT_METHODS;
  return rows.map(function (r) {
    return { method: text_(r[0]), cropKey: text_(r[1]), needsDetail: truthyCell_(r[2]), active: truthyCell_(r[3]), sortOrder: Number(r[4]) || 99,
      countValue: r[6] === '' || r[6] === undefined ? residueDefaultCountValue_(text_(r[0])) : truthyCell_(r[6]) };
  }).filter(function (m) { return m.method && (includeInactive || m.active); }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
}

function fiscalYearOf_(d) {
  d = d instanceof Date ? d : toDate_(d);
  if (!d) return null;
  return d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0);
}
function currentFiscalYear_() { return fiscalYearOf_(new Date()); }
function fiscalRangeText_(fy) { return '1 ต.ค. ' + (fy - 1) + ' – 30 ก.ย. ' + fy; }

function cropGroupOf_(name) {
  name = String(name || '');
  if (name.indexOf('ข้าวโพด') === 0) return 'maize';
  if (name.indexOf('ข้าว') === 0) return 'rice';
  if (name.indexOf('อ้อย') >= 0) return 'sugarcane';
  if (name.indexOf('มันสำปะหลัง') >= 0) return 'cassava';
  return 'other';
}

/* ------------------------------ scope ------------------------------ */

/** District recorder (Admin of สนง.เกษตรอำเภอ) is limited to one district; everyone else may choose. */
function residueDistrictScoped_(s) { return s.role === 'admin' && s.scope !== 'province'; }

function residueScopeDistrict_(s, requested) {
  if (residueDistrictScoped_(s)) {
    if (!s.district) throw new Error('บัญชีนี้ยังไม่ได้กำหนดอำเภอ กรุณาติดต่อผู้ดูแลระบบ');
    return s.district;
  }
  const code = String(requested || '');
  if (code && !residueDistrictNames_()[code]) throw new Error('ไม่พบอำเภอ ' + cleanText_(code, 10));
  return code;
}

/* ------------------------------ records ------------------------------ */

function residueRecord_(r, row) {
  const num = function (v) { return v === '' || v === null || v === undefined ? null : Number(v); };
  return {
    row: row, id: text_(r[RC.Record_ID]), date: dateInput_(r[RC.Record_Date]), fy: Number(r[RC.Fiscal_Year]) || fiscalYearOf_(r[RC.Record_Date]),
    district: text_(r[RC.District_Code]), districtName: text_(r[RC.District_Name]), subdistrict: text_(r[RC.Subdistrict_Code]), subdistrictName: text_(r[RC.Subdistrict_Name]),
    crop: text_(r[RC.Crop_Key]), cropName: text_(r[RC.Crop_Name]), cropOther: text_(r[RC.Crop_Other]),
    method: text_(r[RC.Method]), methodOther: text_(r[RC.Method_Other]), area: Number(r[RC.Area_Rai]) || 0,
    lat: num(r[RC.Lat]), lng: num(r[RC.Lng]), photos: text_(r[RC.Photo_IDs]) ? text_(r[RC.Photo_IDs]).split(',') : [],
    biomassMode: text_(r[RC.Biomass_Mode]) || 'default', mb: num(r[RC.MB_kg_rai]), cf: num(r[RC.Cf]), fresh: num(r[RC.Fresh_kg_rai]), dmf: num(r[RC.DMF]),
    dataStatus: text_(r[RC.Data_Status]), reference: text_(r[RC.Reference]), note: text_(r[RC.Note]),
    recordedBy: text_(r[RC.Recorded_By]), recorderName: text_(r[RC.Recorder_Name]), confirmedAt: dateTime_(r[RC.Confirmed_At]),
    status: text_(r[RC.Status]) || 'active', createdAt: dateTime_(r[RC.Created_At]), createdRaw: r[RC.Created_At], updatedAt: dateTime_(r[RC.Updated_At]), updatedBy: text_(r[RC.Updated_By])
  };
}

function residueRecords_(filter) {
  filter = filter || {};
  const sh = spreadsheet_().getSheetByName('residue_records');
  if (!sh) return [];
  return dataRows_(sh).map(function (r, i) { return residueRecord_(r, i + 2); }).filter(function (x) {
    return x.id && (filter.includeDeleted || x.status === 'active') &&
      (!filter.fy || x.fy === Number(filter.fy)) && (!filter.district || x.district === filter.district) &&
      (!filter.subdistrict || x.subdistrict === filter.subdistrict) && (!filter.crop || x.crop === filter.crop) &&
      (!filter.method || x.method === filter.method) && (!filter.recordedBy || x.recordedBy === filter.recordedBy);
  });
}

/** GHG + residue tonnes of one record with the current parameter set. */
function residueCtx_() {
  const p = ghgParams_();
  const crops = {};
  ghgCrops_(true).forEach(function (c) { crops[c.key] = c; });
  const methods = {};
  residueMethods_(true).forEach(function (m) { methods[m.method] = m; });
  return { p: p, crops: crops, methods: methods, label: ghgParamLabel_(p) };
}

function residueCompute_(rec, ctx) {
  const crop = ctx.crops[rec.crop];
  const out = { ghg: null, ch4: null, n2o: null, ch4e: null, n2oe: null, btotal: null, bburned: null, mode: '', dataStatus: '', reference: '', tonnes: null, reason: '',
    value: null, valueCounted: false };
  if (!crop) { out.reason = 'ไม่พบค่าพืช'; return out; }
  let item = null;
  if (rec.biomassMode === 'custom') {
    item = { area: rec.area, mode: 'custom', mb: rec.mb, cf: rec.cf, fresh: rec.fresh, dmf: rec.dmf, reference: rec.reference, dataStatus: 'Measured' };
  } else if (ctx.p.DEFAULT_MODE === 'residue' && crop.residueTRai !== '' && crop.cf !== '') {
    item = { area: rec.area, mode: 'custom', mb: Number(crop.residueTRai) * 1000, cf: crop.cf, reference: crop.residueReference, dataStatus: 'Estimated' };
  } else {
    item = { area: rec.area, mode: 'standard', dataStatus: 'Estimated' };
  }
  try {
    const r = ghgCalcItem_(item, crop, ctx.p);
    Object.assign(out, { ghg: r.lfire, ch4: r.ch4, n2o: r.n2o, ch4e: r.ch4e, n2oe: r.n2oe, btotal: r.btotal, bburned: r.bburned,
      mode: r.mode === 'standard' ? 'Standard' : 'Custom', dataStatus: r.dataStatus, reference: r.reference });
  } catch (err) {
    out.reason = err.message;
  }
  if (rec.biomassMode === 'custom' && rec.mb !== null) out.tonnes = rec.area * rec.mb / 1000;
  else if (rec.biomassMode === 'custom' && rec.fresh !== null && rec.dmf) out.tonnes = rec.area * rec.fresh * rec.dmf / 1000;
  else if (crop.residueTRai !== '') out.tonnes = rec.area * Number(crop.residueTRai);
  // Estimated value = residue tonnes × 1,000 × baht/kg of the crop, only for types that count value.
  const m = ctx.methods && ctx.methods[rec.method];
  out.valueCounted = m ? m.countValue : residueDefaultCountValue_(rec.method);
  const price = crop.priceBahtKg === '' || crop.priceBahtKg === undefined ? null : Number(crop.priceBahtKg);
  if (out.tonnes !== null && price !== null) out.value = out.valueCounted ? out.tonnes * 1000 * price : 0;
  return out;
}

function residuePublicRecord_(rec, ctx, s) {
  const c = residueCompute_(rec, ctx);
  const own = rec.recordedBy === s.username;
  return {
    id: rec.id, date: rec.date, fy: rec.fy, district: rec.district, districtName: rec.districtName, subdistrict: rec.subdistrict, subdistrictName: rec.subdistrictName,
    crop: rec.crop, cropName: rec.cropName + (rec.cropOther ? ' (' + rec.cropOther + ')' : ''), cropOther: rec.cropOther,
    method: rec.method, methodOther: rec.methodOther, area: rec.area, lat: rec.lat, lng: rec.lng, photoCount: rec.photos.length,
    biomassMode: rec.biomassMode, mb: rec.mb, cf: rec.cf, fresh: rec.fresh, dmf: rec.dmf, reference: rec.reference, note: rec.note,
    recordedBy: rec.recordedBy, recorderName: rec.recorderName, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    ghg: c.ghg === null ? null : round_(c.ghg, 4), tonnes: c.tonnes === null ? null : round_(c.tonnes, 2), ghgNote: c.reason, dataStatus: c.dataStatus || 'Estimated',
    value: c.value === null ? null : round_(c.value, 2), valueCounted: c.valueCounted,
    canEdit: s.role !== 'admin' || (own && (!residueDistrictScoped_(s) || rec.district === s.district))
  };
}

function residueMeta_(s) {
  const names = residueDistrictNames_();
  const district = residueDistrictScoped_(s) ? s.district : '';
  const ctx = residueCtx_();
  const fy = currentFiscalYear_();
  return {
    status: 'success', province: provinceName_(), office: officeName_(), role: s.role, district: district, districtName: names[district] || '',
    districts: Object.keys(names).sort().filter(function (c) { return !district || c === district; }).map(function (c) { return { code: c, name: names[c] }; }),
    subdistricts: residueSubdistricts_(district),
    crops: ghgCrops_(false).map(function (c) { return ghgCropPublic_(c, ctx.p); }),
    methods: residueMethods_(false), fy: fy, fiscalYears: residueFiscalYears_(), maxPhotos: RESIDUE_MAX_PHOTOS, params: ctx.label,
    today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
}

function residueFiscalYears_() {
  const set = {};
  set[currentFiscalYear_()] = 1;
  residueRecords_({}).forEach(function (r) { if (r.fy) set[r.fy] = 1; });
  const ts = spreadsheet_().getSheetByName('residue_targets');
  if (ts) dataRows_(ts).forEach(function (r) { if (Number(r[0])) set[Number(r[0])] = 1; });
  return Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
}

function residueList_(input, s) {
  input = input || {};
  const district = residueScopeDistrict_(s, input.district);
  const ctx = residueCtx_();
  const list = residueRecords_({ fy: input.fy ? Number(input.fy) : null, district: district, subdistrict: cleanText_(input.subdistrict, 10),
    crop: cleanText_(input.crop, 24), method: cleanText_(input.method, 60), recordedBy: input.mine ? s.username : '' });
  const out = list.reverse().slice(0, 500).map(function (r) { return residuePublicRecord_(r, ctx, s); });
  const totals = list.reduce(function (a, r) {
    const c = residueCompute_(r, ctx);
    a.area += r.area; a.records++; if (c.ghg !== null) a.ghg += c.ghg; if (c.tonnes !== null) a.tonnes += c.tonnes; if (c.value !== null) a.value += c.value;
    return a;
  }, { area: 0, ghg: 0, tonnes: 0, records: 0, value: 0 });
  return { status: 'success', records: out, totals: { area: round_(totals.area, 2), ghg: round_(totals.ghg, 4), tonnes: round_(totals.tonnes, 2), records: totals.records, value: round_(totals.value, 2) },
    truncated: list.length > 500, params: ctx.label };
}

function residueValidate_(input, s, existing) {
  const v = {};
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  v.date = String(input.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !toDate_(v.date)) throw new Error('กรุณาเลือกวันที่ดำเนินการ');
  if (v.date > today) throw new Error('วันที่ดำเนินการต้องไม่เกินวันนี้');
  if (v.date < '2020-01-01') throw new Error('วันที่ดำเนินการไม่ถูกต้อง');
  v.fy = fiscalYearOf_(v.date);
  const names = residueDistrictNames_();
  v.district = residueDistrictScoped_(s) ? s.district : String(input.district || (existing && existing.district) || '');
  if (!names[v.district]) throw new Error(residueDistrictScoped_(s) ? 'บัญชีนี้ยังไม่ได้กำหนดอำเภอ' : 'กรุณาเลือกอำเภอ');
  v.districtName = names[v.district];
  const tambon = KPP_SUBDISTRICTS.find(function (t) { return t[0] === String(input.subdistrict || ''); });
  if (!tambon || tambon[0].slice(0, 4) !== v.district) throw new Error('กรุณาเลือกตำบลในอำเภอ' + v.districtName);
  v.subdistrict = tambon[0]; v.subdistrictName = tambon[1];
  const crops = {};
  ghgCrops_(false).forEach(function (c) { crops[c.key] = c; });
  const crop = crops[String(input.crop || '')];
  if (!crop) throw new Error('กรุณาเลือกชนิดพืช');
  v.crop = crop.key; v.cropName = crop.name; v.cropOther = cleanText_(input.cropOther, 60);
  if (crop.key === 'other' && !v.cropOther) throw new Error('กรุณาระบุชื่อพืช');
  const method = residueMethods_(false).find(function (m) { return m.method === String(input.method || ''); });
  if (!method) throw new Error('กรุณาเลือกประเภทการจัดการเศษวัสดุ');
  if (method.cropKey && method.cropKey !== crop.key) {
    throw new Error('"' + method.method + '" ใช้กับ' + ((crops[method.cropKey] || {}).name || method.cropKey) + 'เท่านั้น');
  }
  v.method = method.method; v.methodOther = cleanText_(input.methodOther, 100);
  if (method.needsDetail && !v.methodOther) throw new Error('กรุณาระบุวิธีจัดการเศษวัสดุ');
  v.area = Number(input.area);
  if (!isFinite(v.area) || v.area <= 0) throw new Error('พื้นที่ที่จัดการเศษวัสดุต้องมากกว่า 0 ไร่');
  if (v.area > 50000) throw new Error('พื้นที่ต่อรายการต้องไม่เกิน 50,000 ไร่ กรุณาตรวจสอบตัวเลข');
  v.area = round_(v.area, 2);
  v.warnings = [];
  const hasLat = input.lat !== '' && input.lat !== null && input.lat !== undefined;
  const hasLng = input.lng !== '' && input.lng !== null && input.lng !== undefined;
  v.lat = ''; v.lng = '';
  if (hasLat || hasLng) {
    const lat = Number(input.lat), lng = Number(input.lng);
    if (!hasLat || !hasLng || !isFinite(lat) || !isFinite(lng)) throw new Error('พิกัดไม่ครบหรือไม่ถูกต้อง');
    if (lat < 15.5 || lat > 17.2 || lng < 98.8 || lng > 100.3) throw new Error('พิกัดอยู่นอกจังหวัด กรุณาตรวจสอบหรือเว้นว่าง');
    v.lat = round_(lat, 6); v.lng = round_(lng, 6);
    const d = districtForPoint_(lat, lng, districtList_());
    if (d && d.code !== v.district) v.warnings.push('พิกัดอยู่ในอำเภอ' + d.name + ' แต่บันทึกเป็นอำเภอ' + v.districtName);
  }
  const custom = input.custom || null;
  v.biomassMode = 'default'; v.mb = ''; v.cf = ''; v.fresh = ''; v.dmf = ''; v.reference = ''; v.dataStatus = 'Estimated';
  if (custom && (custom.mb !== '' && custom.mb !== null && custom.mb !== undefined || custom.fresh !== '' && custom.fresh !== null && custom.fresh !== undefined)) {
    try {
      ghgCalcItem_({ area: v.area, mode: 'custom', mb: custom.mb, cf: custom.cf, fresh: custom.fresh, dmf: custom.dmf, reference: custom.reference }, crop, ghgParams_());
    } catch (err) { throw new Error(err.message); }
    v.biomassMode = 'custom';
    v.mb = ghgNum_(custom.mb) === null ? '' : Number(custom.mb);
    v.cf = ghgNum_(custom.cf) === null ? Number(crop.cf) : Number(custom.cf);
    v.fresh = ghgNum_(custom.fresh) === null ? '' : Number(custom.fresh);
    v.dmf = ghgNum_(custom.dmf) === null ? '' : Number(custom.dmf);
    v.reference = cleanText_(custom.reference, 200);
    v.dataStatus = 'Measured';
  }
  v.note = cleanText_(input.note, 300);
  if (input.confirmed !== true) throw new Error('กรุณาตรวจสอบข้อมูลและยืนยันความถูกต้องก่อนบันทึก');
  const planted = residuePlantedRai_(v.subdistrict, crop.key);
  if (planted) {
    const done = residueRecords_({ fy: v.fy, subdistrict: v.subdistrict, crop: crop.key })
      .filter(function (r) { return !existing || r.id !== existing.id; }).reduce(function (a, r) { return a + r.area; }, 0);
    if (done + v.area > planted.rai) {
      v.warnings.push('พื้นที่จัดการ' + crop.name + 'ของตำบล' + v.subdistrictName + 'ในปีงบประมาณนี้รวม ' + round_(done + v.area, 2) +
        ' ไร่ มากกว่าพื้นที่ปลูกในทะเบียนเกษตรกร (' + round_(planted.rai, 2) + ' ไร่, ' + planted.source + ') กรุณาตรวจสอบ');
    }
  }
  return v;
}

/** Planted rai of a crop group in a sub-district from the active registry imports (latest season of each crop). */
function residuePlantedRai_(subdistrict, group) {
  try {
    const data = activeCropRows_();
    const latest = {};
    data.imports.forEach(function (imp) {
      if (cropGroupOf_(imp.crop) !== group) return;
      if (!latest[imp.crop] || imp.season > latest[imp.crop].season) latest[imp.crop] = imp;
    });
    const code = subdistrict.slice(0, 2) + '-' + subdistrict.slice(2, 4) + '-' + subdistrict.slice(4, 6);
    let rai = 0;
    const src = [];
    Object.keys(latest).forEach(function (k) {
      const imp = latest[k];
      (data.rows[imp.importId] || []).forEach(function (r) { if (r.level === 'subdistrict' && r.code === code) rai += r.area; });
      src.push(imp.crop + ' ' + imp.season);
    });
    return rai > 0 ? { rai: rai, source: src.join(', ') } : null;
  } catch (err) { return null; }
}

function residuePhotoFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('RESIDUE_PHOTO_FOLDER_ID');
  if (!id) throw new Error('ยังไม่ได้เตรียมโฟลเดอร์ภาพ กรุณาให้ผู้ดูแลระบบ Run setupSystem()');
  return DriveApp.getFolderById(id);
}

function residueSavePhotos_(photos, prefix) {
  const folder = residuePhotoFolder_();
  return photos.map(function (ph, i) {
    const m = String(ph && ph.data || '').match(/^(?:data:(image\/(?:jpeg|png|webp));base64,)?([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error('ไฟล์ภาพที่ ' + (i + 1) + ' ไม่ถูกต้อง');
    if (m[2].length > RESIDUE_MAX_PHOTO_CHARS) throw new Error('ภาพที่ ' + (i + 1) + ' ใหญ่เกินไป');
    const mime = m[1] || (/^image\/(jpeg|png|webp)$/.test(String(ph.mime)) ? String(ph.mime) : 'image/jpeg');
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), mime, prefix + '_' + (i + 1) + (mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'));
    return folder.createFile(blob).getId();
  });
}

function residueFindRow_(id) {
  const recs = residueRecords_({ includeDeleted: true });
  return recs.find(function (r) { return r.id === id; }) || null;
}

function residueCanEdit_(rec, s) {
  if (!rec || rec.status !== 'active') return false;
  if (s.role !== 'admin') return true;
  return rec.recordedBy === s.username && (!residueDistrictScoped_(s) || rec.district === s.district);
}

function residueSave_(input, s) {
  input = input || {};
  const id = cleanText_(input.id, 40);
  const existing = id ? residueFindRow_(id) : null;
  if (id && !residueCanEdit_(existing, s)) throw new Error('ไม่มีสิทธิ์แก้ไขรายการนี้ หรือรายการถูกลบแล้ว');
  const v = residueValidate_(input, s, existing);
  // Photos to keep are sent as positions (0–2), so Drive file ids never leave the server.
  const keep = (Array.isArray(input.keepPhotos) ? input.keepPhotos : []).map(Number)
    .filter(function (i, k, arr) { return existing && i >= 0 && i < existing.photos.length && Math.floor(i) === i && arr.indexOf(i) === k; })
    .map(function (i) { return existing.photos[i]; });
  const newPhotos = Array.isArray(input.photos) ? input.photos : [];
  if (keep.length + newPhotos.length < 1) throw new Error('กรุณาแนบภาพถ่ายการจัดการเศษวัสดุอย่างน้อย 1 ภาพ');
  if (keep.length + newPhotos.length > RESIDUE_MAX_PHOTOS) throw new Error('แนบภาพได้ไม่เกิน ' + RESIDUE_MAX_PHOTOS + ' ภาพ');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date();
    const recId = existing ? existing.id : 'RR' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const added = newPhotos.length ? residueSavePhotos_(newPhotos, recId) : [];
    const photos = keep.concat(added);
    const sh = sheetByName_('residue_records');
    const by = s.name + ' (' + s.username + ')';
    const row = [recId, v.date, v.fy, v.district, v.districtName, v.subdistrict, v.subdistrictName, v.crop, v.cropName, v.cropOther,
      v.method, v.methodOther, v.area, v.lat, v.lng, photos.join(','), v.biomassMode, v.mb, v.cf, v.fresh, v.dmf, v.dataStatus, v.reference, v.note,
      existing ? existing.recordedBy : s.username, existing ? existing.recorderName : s.name, now, 'active',
      existing ? existing.createdRaw || now : now, now, by];
    if (existing) {
      sh.getRange(existing.row, 1, 1, row.length).setValues([row]);
      existing.photos.filter(function (p) { return photos.indexOf(p) < 0; }).forEach(function (p) {
        try { DriveApp.getFileById(p).setTrashed(true); } catch (err) { /* already gone */ }
      });
    } else {
      sh.appendRow(row);
      sh.getRange(sh.getLastRow(), 1).setNumberFormat('@');
    }
    invalidateResidue_();
    adminAudit_(s, existing ? 'residue_update' : 'residue_create', recId + ' ' + v.date + ' ต.' + v.subdistrictName + ' อ.' + v.districtName + ' ' + v.cropName + ' ' + v.method + ' ' + v.area + ' ไร่');
    const rec = residueFindRow_(recId);
    return { status: 'success', id: recId, warnings: v.warnings, record: residuePublicRecord_(rec, residueCtx_(), s),
      message: (existing ? 'แก้ไข' : 'บันทึก') + 'ข้อมูลแล้ว ' + v.area + ' ไร่ (' + v.method + ')' };
  } finally {
    lock.releaseLock();
  }
}

function residueDelete_(input, s) {
  const rec = residueFindRow_(cleanText_(input && input.id, 40));
  if (!residueCanEdit_(rec, s)) throw new Error('ไม่มีสิทธิ์ลบรายการนี้ หรือรายการถูกลบแล้ว');
  const sh = sheetByName_('residue_records');
  sh.getRange(rec.row, RC.Status + 1).setValue('deleted');
  sh.getRange(rec.row, RC.Updated_At + 1, 1, 2).setValues([[new Date(), s.name + ' (' + s.username + ')']]);
  invalidateResidue_();
  adminAudit_(s, 'residue_delete', rec.id + ' ' + rec.date + ' ต.' + rec.subdistrictName + ' ' + rec.method + ' ' + rec.area + ' ไร่');
  return { status: 'success', message: 'ลบรายการแล้ว (เก็บไว้ในประวัติ ไม่นับในยอดรวม)' };
}

function residuePhoto_(input, s) {
  input = input || {};
  const rec = residueFindRow_(cleanText_(input.id, 40));
  if (!rec || (residueDistrictScoped_(s) && rec.district !== s.district)) throw new Error('ไม่พบรายการ หรือไม่มีสิทธิ์ดูภาพ');
  const i = Math.max(0, Math.min(RESIDUE_MAX_PHOTOS - 1, Number(input.index) || 0));
  const fid = rec.photos[i];
  if (!fid) throw new Error('ไม่พบภาพ');
  const blob = DriveApp.getFileById(fid).getBlob();
  return { status: 'success', mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()), index: i, count: rec.photos.length };
}

/* ------------------------------ targets & methods (Mini Super Admin / Super Admin) ------------------------------ */

function residueTargets_(fy) {
  fy = Number(fy) || currentFiscalYear_();
  const names = residueDistrictNames_();
  const by = {};
  Object.keys(names).forEach(function (c) { by[c] = { district: c, name: names[c], total: null, officers: null, byMethod: {}, note: '' }; });
  const sh = spreadsheet_().getSheetByName('residue_targets');
  if (sh) dataRows_(sh).forEach(function (r) {
    if (Number(r[0]) !== fy) return;
    const d = by[text_(r[1])];
    if (!d) return;
    const method = text_(r[3]);
    const val = r[4] === '' ? null : Number(r[4]);
    if (method) d.byMethod[method] = val;
    else { d.total = val; d.officers = r[5] === '' ? null : Number(r[5]); d.note = text_(r[6]); }
  });
  const rows = Object.keys(by).sort().map(function (c) { return by[c]; });
  const byMethod = {};
  rows.forEach(function (d) { Object.keys(d.byMethod).forEach(function (m) { if (d.byMethod[m] !== null) byMethod[m] = (byMethod[m] || 0) + d.byMethod[m]; }); });
  const set = rows.filter(function (d) { return d.total !== null; });
  return { fy: fy, rows: rows, total: set.length ? set.reduce(function (a, d) { return a + d.total; }, 0) : null,
    officers: rows.reduce(function (a, d) { return a + (d.officers || 0); }, 0), byMethod: byMethod };
}

function residueTargetsSave_(input, s) {
  input = input || {};
  const fy = Number(input.fy);
  if (!(fy >= 2560 && fy <= 2600)) throw new Error('ปีงบประมาณไม่ถูกต้อง');
  const names = residueDistrictNames_();
  const methods = residueMethods_(true).map(function (m) { return m.method; });
  const nn = function (v, label) {
    if (v === '' || v === null || v === undefined) return '';
    const n = Number(v);
    if (!isFinite(n) || n < 0) throw new Error(label + ' ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    return n;
  };
  const values = [];
  const now = new Date(), by = s.name + ' (' + s.username + ')';
  (Array.isArray(input.rows) ? input.rows : []).forEach(function (r) {
    const code = String(r.district || '');
    if (!names[code]) throw new Error('ไม่พบอำเภอ ' + cleanText_(code, 10));
    const total = nn(r.total, 'เป้าหมายอำเภอ' + names[code]);
    const officers = nn(r.officers, 'จำนวน นวส. อำเภอ' + names[code]);
    if (total !== '' || officers !== '') values.push([fy, code, names[code], '', total, officers, cleanText_(r.note, 120), now, by]);
    Object.keys(r.byMethod || {}).forEach(function (m) {
      if (methods.indexOf(m) < 0) throw new Error('ไม่รู้จักประเภท ' + cleanText_(m, 40));
      const v = nn(r.byMethod[m], 'เป้าหมาย' + m + ' อำเภอ' + names[code]);
      if (v !== '') values.push([fy, code, names[code], m, v, '', '', now, by]);
    });
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheetByName_('residue_targets');
    const before = dataRows_(sh);
    const all = before.filter(function (r) { return r[0] !== '' && Number(r[0]) !== fy; }).map(function (r) { return r.slice(0, 9); }).concat(values);
    const blank = function () { return ['', '', '', '', '', '', '', '', '']; };
    if (before.length) sh.getRange(2, 1, before.length, 9).setValues(before.map(blank));
    if (all.length) sh.getRange(2, 1, all.length, 9).setValues(all);
    const t = residueTargets_(fy);
    invalidateResidue_();
    adminAudit_(s, 'residue_targets_save', 'ปีงบประมาณ ' + fy + ': รวม ' + (t.total === null ? '–' : t.total) + ' ไร่, นวส. ' + t.officers + ' คน');
    return { status: 'success', message: 'บันทึกเป้าหมายปีงบประมาณ ' + fy + ' แล้ว', targets: t };
  } finally {
    lock.releaseLock();
  }
}

function residueMethodSave_(input, s) {
  input = input || {};
  const method = cleanText_(input.method, 60);
  if (!method) throw new Error('กรุณากรอกชื่อประเภทการจัดการ');
  const cropKey = String(input.cropKey || '');
  if (cropKey && !ghgCrops_(true).some(function (c) { return c.key === cropKey; })) throw new Error('ไม่พบชนิดพืช ' + cleanText_(cropKey, 24));
  const sh = sheetByName_('residue_methods');
  const rows = dataRows_(sh);
  const idx = rows.findIndex(function (r) { return text_(r[0]) === method; });
  const countValue = input.countValue === undefined ? residueDefaultCountValue_(method) : !!input.countValue;
  const values = [method, cropKey, !!input.needsDetail, input.active !== false, Math.max(1, Math.min(99, Number(input.sortOrder) || 50)), new Date(), countValue];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, 7).setValues([values]); else sh.appendRow(values);
  invalidateResidue_();
  adminAudit_(s, 'residue_method_save', method + (cropKey ? ' (' + cropKey + ')' : '') + (input.active === false ? ' ปิด' : '') + (countValue ? ' นับมูลค่า' : ' ไม่นับมูลค่า'));
  return { status: 'success', methods: residueMethods_(true) };
}

function residueSettingsGet_(input) {
  const fy = Number(input && input.fy) || currentFiscalYear_();
  return { status: 'success', province: provinceName_(), office: officeName_(), fy: fy, fiscalYears: residueFiscalYears_(),
    targets: residueTargets_(fy), methods: residueMethods_(true), crops: ghgCrops_(true).map(function (c) { return { key: c.key, name: c.name }; }),
    groups: staffGroups_() };
}

function residueSiteSave_(input, s) {
  input = input || {};
  const province = cleanText_(input.province, 60);
  const office = cleanText_(input.office, 120);
  if (!province) throw new Error('กรุณากรอกชื่อจังหวัด');
  setConfigValue_('province_name', province.replace(/^จังหวัด/, ''), 'ชื่อจังหวัดที่แสดงบนหน้าเว็บและรายงาน');
  if (office) setConfigValue_('office_name', office, 'ชื่อหน่วยงานในหัวรายงาน');
  if (Array.isArray(input.groups)) {
    const groups = input.groups.map(function (g) { return cleanText_(g, 80); }).filter(Boolean).slice(0, 20);
    if (!groups.length) throw new Error('ต้องมีกลุ่มของสำนักงานเกษตรจังหวัดอย่างน้อย 1 กลุ่ม');
    setConfigValue_('staff_groups', groups.join('|'), 'กลุ่มของสำนักงานเกษตรจังหวัด (ใช้ตอนลงทะเบียนเจ้าหน้าที่)');
  }
  invalidateResidue_();
  try { CacheService.getScriptCache().remove(SUMMARY_CACHE_KEY); } catch (err) { /* ignore */ }
  adminAudit_(s, 'site_save', 'จังหวัด ' + province + (office ? ', หน่วยงาน ' + office : ''));
  return { status: 'success', message: 'บันทึกชื่อจังหวัดและหน่วยงานแล้ว' };
}

/* ------------------------------ aggregation (public + reports) ------------------------------ */

function invalidateResidue_() {
  const c = CacheService.getScriptCache();
  try {
    const fy = currentFiscalYear_();
    [fy - 2, fy - 1, fy, fy + 1, 0].forEach(function (y) { c.remove('residue:v1:' + y); });
  } catch (err) { /* best effort */ }
}

/** Sums of records: district × crop × method cells with area, residue tonnes and GHG (null-safe). */
function residueCells_(records, ctx) {
  const cells = {};
  records.forEach(function (r) {
    const k = r.district + '|' + r.crop + '|' + r.method;
    const x = cells[k] || (cells[k] = { d: r.district, c: r.crop, m: r.method, n: 0, a: 0, t: 0, g: 0, ch4: 0, n2o: 0, ch4e: 0, n2oe: 0, b: 0, x: 0, v: 0 });
    const v = residueCompute_(r, ctx);
    x.n++; x.a += r.area;
    if (v.tonnes !== null) x.t += v.tonnes;
    if (v.value !== null) x.v += v.value;
    if (v.ghg === null) x.x += r.area;
    else { x.g += v.ghg; x.ch4 += v.ch4; x.n2o += v.n2o; x.ch4e += v.ch4e; x.n2oe += v.n2oe; x.b += v.btotal; }
  });
  return Object.keys(cells).sort().map(function (k) {
    const x = cells[k];
    return { d: x.d, c: x.c, m: x.m, n: x.n, a: round_(x.a, 2), t: round_(x.t, 3), g: round_(x.g, 6), ch4: round_(x.ch4, 8), n2o: round_(x.n2o, 9),
      ch4e: round_(x.ch4e, 6), n2oe: round_(x.n2oe, 6), b: round_(x.b, 2), x: round_(x.x, 2), v: round_(x.v, 2) };
  });
}

function getResiduePublic_(p) {
  const fy = Number(p && p.fy) || currentFiscalYear_();
  const key = 'residue:v1:' + fy;
  const cache = CacheService.getScriptCache();
  if (!(p && p.refresh === '1')) {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  const ctx = residueCtx_();
  const records = residueRecords_({ fy: fy });
  const cells = residueCells_(records, ctx);
  const sum = function (k) { return cells.reduce(function (a, c) { return a + c[k]; }, 0); };
  const t = residueTargets_(fy);
  const out = {
    ok: true, generatedAt: new Date().toISOString(), fy: fy, fyRange: fiscalRangeText_(fy), fiscalYears: residueFiscalYears_(),
    province: provinceName_(), params: ctx.label,
    crops: ghgCrops_(true).map(function (c) { return ghgCropPublic_(c, ctx.p); }),
    methods: residueMethods_(true).map(function (m) { return { method: m.method, cropKey: m.cropKey, active: m.active, countValue: m.countValue }; }),
    cells: cells,
    totals: { records: sum('n'), areaRai: round_(sum('a'), 2), tonnes: round_(sum('t'), 2), ghg: round_(sum('g'), 4), ch4: round_(sum('ch4'), 6), n2o: round_(sum('n2o'), 6),
      ch4e: round_(sum('ch4e'), 4), n2oe: round_(sum('n2oe'), 4), excludedRai: round_(sum('x'), 2), value: round_(sum('v'), 2), districts: Object.keys(cells.reduce(function (o, c) { o[c.d] = 1; return o; }, {})).length },
    targets: { total: t.total, officers: t.officers, byMethod: t.byMethod,
      byDistrict: t.rows.reduce(function (o, d) { o[d.district] = { total: d.total, officers: d.officers, byMethod: d.byMethod }; return o; }, {}) },
    boundary: GHG_BOUNDARY
  };
  try { cache.put(key, JSON.stringify(out), RESIDUE_CACHE_SECONDS); } catch (err) { /* too large to cache */ }
  return out;
}

/* ------------------------------ report sections (Reports.gs) ------------------------------ */

function residueReportCtx_(input, s) {
  const fy = Number(input.fy) || currentFiscalYear_();
  const district = residueScopeDistrict_(s, input.district);
  const ctx = residueCtx_();
  const records = residueRecords_({ fy: fy, district: district });
  const names = residueDistrictNames_();
  return { fy: fy, district: district, districtName: names[district] || '', names: names, ctx: ctx, records: records,
    targets: residueTargets_(fy), computed: records.map(function (r) { return { r: r, v: residueCompute_(r, ctx) }; }) };
}

function residueScopeText_(R) {
  return 'ปีงบประมาณ ' + R.fy + ' (' + fiscalRangeText_(R.fy) + ')' + (R.district ? ' อำเภอ' + R.districtName : ' ทั้งจังหวัด' + provinceName_());
}

function residueTargetOf_(R, method) {
  const rows = R.targets.rows.filter(function (d) { return !R.district || d.district === R.district; });
  const vals = rows.map(function (d) { return method ? d.byMethod[method] : d.total; }).filter(function (v) { return v !== null && v !== undefined; });
  return vals.length ? vals.reduce(function (a, v) { return a + v; }, 0) : null;
}

function residueGroupBy_(R, keyFn) {
  const g = {};
  R.computed.forEach(function (x) {
    const k = keyFn(x.r);
    const o = g[k] || (g[k] = { n: 0, area: 0, tonnes: 0, ghg: 0, ch4: 0, n2o: 0, ch4e: 0, n2oe: 0, btotal: 0, excluded: 0, value: 0, modes: {}, status: {}, refs: {} });
    o.n++; o.area += x.r.area;
    if (x.v.tonnes !== null) o.tonnes += x.v.tonnes;
    if (x.v.value !== null) o.value += x.v.value;
    if (x.v.ghg === null) o.excluded += x.r.area;
    else {
      o.ghg += x.v.ghg; o.ch4 += x.v.ch4; o.n2o += x.v.n2o; o.ch4e += x.v.ch4e; o.n2oe += x.v.n2oe; o.btotal += x.v.btotal;
      o.modes[x.v.mode] = 1; o.status[x.v.dataStatus] = 1; if (x.v.reference) o.refs[x.v.reference] = 1;
    }
  });
  return g;
}

function residueValueNote_(R) {
  const off = Object.keys(R.ctx.methods).filter(function (m) { return !R.ctx.methods[m].countValue; });
  return 'มูลค่า (ประมาณการ) = ปริมาณเศษวัสดุ (ตัน) × 1,000 × ราคา (บาท/กก.) ของแต่ละพืช' + (off.length ? ' ไม่นับมูลค่าประเภท: ' + off.join(', ') : '');
}

function residueReportSection_(key, R, s) {
  const p = R.ctx.p;
  const scope = residueScopeText_(R);
  const label = R.ctx.label.label;
  const total = R.computed.reduce(function (a, x) { return a + x.r.area; }, 0);
  const target = residueTargetOf_(R, '');
  if (key === 'residue.summary') {
    const g = residueGroupBy_(R, function () { return 'all'; }).all || { n: 0, area: 0, tonnes: 0, ghg: 0, ch4: 0, n2o: 0, ch4e: 0, n2oe: 0, excluded: 0, value: 0 };
    return {
      subtitle: scope,
      columns: [col_('item', 'รายการ'), col_('value', 'ค่า', 'number'), col_('unit', 'หน่วย')],
      rows: [
        { item: 'พื้นที่จัดการเศษวัสดุรวม', value: round_(g.area, 2), unit: 'ไร่' },
        { item: 'เป้าหมาย', value: target === null ? '' : target, unit: target === null ? 'ยังไม่กำหนด' : 'ไร่' },
        { item: 'ร้อยละที่ดำเนินการได้', value: target ? pct_(g.area, target) : '', unit: '%' },
        { item: 'ปริมาณ GHG ที่ลดได้ (ประมาณการ)', value: round_(g.ghg, 4), unit: 'tCO2e' },
        { item: 'CH4', value: round_(g.ch4, 6), unit: 'ตัน CH4 (' + round_(g.ch4e, 4) + ' tCO2e)' },
        { item: 'N2O', value: round_(g.n2o, 6), unit: 'ตัน N2O (' + round_(g.n2oe, 4) + ' tCO2e)' },
        { item: 'ปริมาณเศษวัสดุที่จัดการ (ประมาณ)', value: round_(g.tonnes, 2), unit: 'ตัน' },
        { item: 'มูลค่าเศษวัสดุ (ประมาณการ)', value: round_(g.value, 2), unit: 'บาท' },
        { item: 'จำนวนรายการบันทึก', value: g.n, unit: 'รายการ' },
        { item: 'พื้นที่ที่ยังไม่คำนวณ GHG (ไม่มีค่ามาตรฐาน)', value: round_(g.excluded, 2), unit: 'ไร่' }
      ],
      notes: ['ชุดค่าที่ใช้: ' + label + ' ชุดที่ ' + R.ctx.label.version + ' โหมด ' + (p.DEFAULT_MODE === 'standard' ? 'Standard (IPCC Table 2.4)' : 'Residue (เศษวัสดุต่อไร่ × Cf)'),
        residueValueNote_(R)].concat(GHG_BOUNDARY.slice(0, 1))
    };
  }
  if (key === 'residue.methods') {
    const g = residueGroupBy_(R, function (r) { return r.method; });
    const methods = residueMethods_(true).map(function (m) { return m.method; });
    Object.keys(g).forEach(function (m) { if (methods.indexOf(m) < 0) methods.push(m); });
    const rows = methods.filter(function (m) { return g[m] || residueMethods_(false).some(function (x) { return x.method === m; }); }).map(function (m) {
      const x = g[m] || { n: 0, area: 0, tonnes: 0, ghg: 0, value: 0 };
      const t = residueTargetOf_(R, m);
      const mm = R.ctx.methods[m];
      return { method: m + (mm && !mm.countValue ? ' (ไม่นับมูลค่า)' : ''), n: x.n, area: round_(x.area, 2), share: pct_(x.area, total), tonnes: round_(x.tonnes, 2), value: round_(x.value, 2),
        ghg: round_(x.ghg, 4), target: t === null ? '' : t, pct: t ? pct_(x.area, t) : '' };
    });
    return {
      subtitle: scope,
      columns: [col_('method', 'ประเภทการจัดการ'), col_('n', 'รายการ', 'number'), col_('area', 'พื้นที่ (ไร่)', 'number'), col_('share', 'สัดส่วน (%)', 'number'),
        col_('tonnes', 'ปริมาณเศษวัสดุ (ตัน)', 'number'), col_('value', 'มูลค่า (บาท)', 'number'), col_('ghg', 'GHG ที่ลดได้ (tCO2e)', 'number'), col_('target', 'เป้าหมายรายประเภท (ไร่)', 'number'), col_('pct', 'ร้อยละ', 'number')],
      rows: rows,
      totals: { method: 'รวม', n: R.computed.length, area: round_(total, 2), share: total ? 100 : 0, tonnes: round_(rows.reduce(function (a, r) { return a + r.tonnes; }, 0), 2),
        value: round_(rows.reduce(function (a, r) { return a + r.value; }, 0), 2),
        ghg: round_(rows.reduce(function (a, r) { return a + r.ghg; }, 0), 4), target: target === null ? '' : target, pct: target ? pct_(total, target) : '' },
      notes: ['ร้อยละรวม = พื้นที่จัดการทุกประเภท ÷ เป้าหมาย' + (target === null ? ' (ยังไม่กำหนดเป้าหมาย)' : ''), residueValueNote_(R)]
    };
  }
  if (key === 'residue.districts' || key === 'residue.map') {
    const g = residueGroupBy_(R, function (r) { return r.district; });
    const codes = Object.keys(R.names).sort().filter(function (c) { return !R.district || c === R.district; });
    const rows = codes.map(function (c) {
      const x = g[c] || { n: 0, area: 0, tonnes: 0, ghg: 0, value: 0 };
      const d = R.targets.rows.find(function (t) { return t.district === c; }) || {};
      return { code: c, name: R.names[c], n: x.n, area: round_(x.area, 2), target: d.total === null || d.total === undefined ? '' : d.total,
        pct: d.total ? pct_(x.area, d.total) : '', tonnes: round_(x.tonnes, 2), value: round_(x.value, 2), ghg: round_(x.ghg, 4), officers: d.officers === null || d.officers === undefined ? '' : d.officers };
    });
    const sum = function (k) { return rows.reduce(function (a, r) { return a + (Number(r[k]) || 0); }, 0); };
    const out = {
      subtitle: scope,
      columns: key === 'residue.map'
        ? [col_('name', 'อำเภอ'), col_('ghg', 'GHG ที่ลดได้ (tCO2e)', 'number'), col_('area', 'พื้นที่จัดการ (ไร่)', 'number'), col_('pct', 'ร้อยละของเป้าหมาย', 'number')]
        : [col_('name', 'อำเภอ'), col_('officers', 'นวส. (คน)', 'number'), col_('n', 'รายการ', 'number'), col_('area', 'พื้นที่จัดการ (ไร่)', 'number'), col_('target', 'เป้าหมาย (ไร่)', 'number'),
          col_('pct', 'ร้อยละ', 'number'), col_('tonnes', 'เศษวัสดุ (ตัน)', 'number'), col_('value', 'มูลค่า (บาท)', 'number'), col_('ghg', 'GHG ที่ลดได้ (tCO2e)', 'number')],
      rows: rows,
      totals: { name: R.district ? 'รวม' : 'รวมทั้งจังหวัด', officers: sum('officers'), n: sum('n'), area: round_(sum('area'), 2), target: target === null ? '' : target,
        pct: target ? pct_(sum('area'), target) : '', tonnes: round_(sum('tonnes'), 2), value: round_(sum('value'), 2), ghg: round_(sum('ghg'), 4) }
    };
    if (key === 'residue.map') { out.map = { metric: 'ghg', unit: 'tCO2e', values: rows.reduce(function (o, r) { o[r.code] = r.ghg; return o; }, {}) }; out.notes = ['สีเข้ม = GHG ที่ลดได้มาก ขอบเขตอำเภอ: OpenGISData-Thailand (CC BY 4.0)']; }
    return out;
  }
  if (key === 'residue.crops') {
    const g = residueGroupBy_(R, function (r) { return r.crop; });
    const crops = ghgCrops_(true);
    const rows = crops.filter(function (c) { return g[c.key]; }).map(function (c) {
      const x = g[c.key];
      const done = x.area - x.excluded;
      return { crop: c.name, area: round_(x.area, 2), mode: Object.keys(x.modes).join('/') || '–', bburned: done ? round_(x.btotal / done, 2) : '',
        btotal: round_(x.btotal, 2), ch4: round_(x.ch4, 6), n2o: round_(x.n2o, 6), ch4e: round_(x.ch4e, 4), n2oe: round_(x.n2oe, 4), lfire: round_(x.ghg, 4),
        perRai: done ? round_(x.ghg * 1000 / done, 2) : '', excluded: round_(x.excluded, 2), status: Object.keys(x.status).join('/') || '–',
        tonnes: round_(x.tonnes, 2), price: c.priceBahtKg === '' ? '' : c.priceBahtKg, value: round_(x.value, 2),
        reference: Object.keys(x.refs).join('; ') || (x.excluded ? 'ไม่มีค่ามาตรฐาน' : '') };
    });
    const sum = function (k, d) { return round_(rows.reduce(function (a, r) { return a + (Number(r[k]) || 0); }, 0), d); };
    return {
      subtitle: scope + ' · ' + label,
      columns: [col_('crop', 'ชนิดพืช'), col_('area', 'พื้นที่ (ไร่)', 'number'), col_('mode', 'Biomass Mode'), col_('bburned', 'Biomass Consumed (kg/ไร่)', 'number'),
        col_('btotal', 'Total Biomass Consumed (kg)', 'number'), col_('ch4', 'CH4 (ตัน)', 'number'), col_('n2o', 'N2O (ตัน)', 'number'), col_('ch4e', 'CH4 (tCO2e)', 'number'),
        col_('n2oe', 'N2O (tCO2e)', 'number'), col_('lfire', 'L_fire ที่ลดได้ (tCO2e)', 'number'), col_('perRai', 'GHG ต่อไร่ (kgCO2e)', 'number'),
        col_('excluded', 'ไม่คำนวณ (ไร่)', 'number'), col_('tonnes', 'เศษวัสดุ (ตัน)', 'number'), col_('price', 'ราคา (บาท/กก.)', 'number'), col_('value', 'มูลค่า (บาท)', 'number'),
        col_('status', 'Data Status'), col_('reference', 'Reference')],
      rows: rows,
      totals: { crop: 'รวม', area: sum('area', 2), btotal: sum('btotal', 2), ch4: sum('ch4', 6), n2o: sum('n2o', 6), ch4e: sum('ch4e', 4), n2oe: sum('n2oe', 4), lfire: sum('lfire', 4), excluded: sum('excluded', 2),
        tonnes: sum('tonnes', 2), value: sum('value', 2) },
      notes: ['GHG Total = ΣCH4 CO2e + ΣN2O CO2e (ไม่รวมตัน CH4 กับตัน N2O โดยตรง)', 'Standard Mode ไม่ทราบปริมาณชีวมวลก่อนเผา จึงไม่แสดงค่า (N/A) และไม่คูณ Cf ซ้ำ']
    };
  }
  if (key === 'residue.subdistricts') {
    const g = residueGroupBy_(R, function (r) { return r.subdistrict + '|' + r.method; });
    const rows = Object.keys(g).sort().map(function (k) {
      const parts = k.split('|');
      const t = KPP_SUBDISTRICTS.find(function (x) { return x[0] === parts[0]; }) || [parts[0], parts[0]];
      const x = g[k];
      return { district: R.names[parts[0].slice(0, 4)] || '', name: t[1], code: t[0], method: parts[1], n: x.n, area: round_(x.area, 2), tonnes: round_(x.tonnes, 2), value: round_(x.value, 2), ghg: round_(x.ghg, 4) };
    });
    return {
      subtitle: scope,
      columns: [col_('district', 'อำเภอ'), col_('name', 'ตำบล'), col_('method', 'ประเภทเศษวัสดุ/การจัดการ'), col_('n', 'รายการ', 'number'), col_('area', 'พื้นที่รวม (ไร่)', 'number'),
        col_('tonnes', 'ปริมาณรวม (ตัน)', 'number'), col_('value', 'มูลค่า (บาท)', 'number'), col_('ghg', 'GHG ที่ลดได้ (tCO2e)', 'number')],
      rows: rows,
      totals: { district: 'รวม', n: R.computed.length, area: round_(total, 2), tonnes: round_(rows.reduce(function (a, r) { return a + r.tonnes; }, 0), 2),
        value: round_(rows.reduce(function (a, r) { return a + r.value; }, 0), 2), ghg: round_(rows.reduce(function (a, r) { return a + r.ghg; }, 0), 4) },
      notes: ['ปริมาณ (ตัน) = พื้นที่ × อัตราชีวมวลเศษวัสดุต่อไร่ของพืช (หรือค่าที่วัดจริงในรายการนั้น)', residueValueNote_(R)]
    };
  }
  if (key === 'residue.admins') {
    const admins = dataRows_(sheetByName_('admins')).map(function (r) {
      return { username: normalizeUsername_(r[0]), name: text_(r[1]), role: text_(r[2]), status: text_(r[3]) || 'active', district: text_(r[11]) };
    }).filter(function (a) { return a.role === 'admin' && (!R.district || a.district === R.district); });
    const g = residueGroupBy_(R, function (r) { return r.recordedBy; });
    const users = {};
    admins.forEach(function (a) { users[a.username] = a; });
    R.records.forEach(function (r) { if (!users[r.recordedBy]) users[r.recordedBy] = { username: r.recordedBy, name: r.recorderName, role: '', status: '', district: r.district }; });
    const activeCount = {};
    admins.forEach(function (a) { if (a.status === 'active') activeCount[a.district] = (activeCount[a.district] || 0) + 1; });
    const rows = Object.keys(users).map(function (u) {
      const a = users[u], x = g[u] || { n: 0, area: 0, tonnes: 0, ghg: 0 };
      const d = R.targets.rows.find(function (t) { return t.district === a.district; }) || {};
      const people = d.officers || activeCount[a.district] || 0;
      const personal = d.total && people ? round_(d.total / people, 2) : null;
      return { district: R.names[a.district] || '–', name: a.name + (a.role && a.role !== 'admin' ? ' (' + roleLabel_(a.role) + ')' : '') + (a.status === 'disabled' ? ' (ระงับ)' : ''),
        username: a.username, n: x.n, area: round_(x.area, 2), personal: personal === null ? '' : personal, pct: personal ? pct_(x.area, personal) : '',
        share: d.total ? pct_(x.area, d.total) : '', ghg: round_(x.ghg, 4) };
    }).sort(function (a, b) { return a.district.localeCompare(b.district, 'th') || b.area - a.area; });
    return {
      subtitle: scope,
      columns: [col_('district', 'อำเภอ'), col_('name', 'ผู้บันทึก (Admin)'), col_('username', 'ชื่อผู้ใช้'), col_('n', 'รายการ', 'number'), col_('area', 'พื้นที่ (ไร่)', 'number'),
        col_('personal', 'เป้าหมายต่อคน (ไร่)', 'number'), col_('pct', 'ร้อยละที่ดำเนินการ', 'number'), col_('share', 'สัดส่วนของเป้าหมายอำเภอ (%)', 'number'), col_('ghg', 'GHG ที่ลดได้ (tCO2e)', 'number')],
      rows: rows,
      notes: ['เป้าหมายต่อคน = เป้าหมายอำเภอ ÷ จำนวน นวส. ของอำเภอ (ถ้าไม่ได้กรอก นวส. ใช้จำนวน Admin ที่ใช้งานในอำเภอ) ร้อยละคำนวณเฉพาะอำเภอที่ลงทะเบียน']
    };
  }
  if (key === 'residue.records') {
    const rows = R.computed.slice().sort(function (a, b) { return a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : 0; }).map(function (x) {
      const r = x.r;
      return { date: r.date, district: r.districtName, name: r.subdistrictName, crop: r.cropName + (r.cropOther ? ' (' + r.cropOther + ')' : ''), method: r.method + (r.methodOther ? ': ' + r.methodOther : ''),
        area: r.area, tonnes: x.v.tonnes === null ? '' : round_(x.v.tonnes, 2), value: x.v.value === null ? '' : round_(x.v.value, 2), ghg: x.v.ghg === null ? '' : round_(x.v.ghg, 4), status: x.v.dataStatus || '',
        lat: r.lat === null ? '' : r.lat, lng: r.lng === null ? '' : r.lng, photos: r.photos.length, recorder: r.recorderName };
    });
    return {
      subtitle: scope,
      columns: [col_('date', 'วันที่'), col_('district', 'อำเภอ'), col_('name', 'ตำบล'), col_('crop', 'พืช'), col_('method', 'การจัดการ'), col_('area', 'ไร่', 'number'),
        col_('tonnes', 'ตัน', 'number'), col_('value', 'มูลค่า (บาท)', 'number'), col_('ghg', 'tCO2e', 'number'), col_('status', 'Data Status'), col_('lat', 'ละติจูด', 'number'), col_('lng', 'ลองจิจูด', 'number'),
        col_('photos', 'ภาพ', 'number'), col_('recorder', 'ผู้บันทึก')],
      rows: rows,
      totals: { date: 'รวม', area: round_(total, 2) }
    };
  }
  if (key === 'residue.params') {
    const crops = ghgCrops_(true).filter(function (c) { return c.active; });
    const rows = [
      { item: 'EF_CH4', value: p.EF_CH4, unit: 'g/kg dry matter burnt', ref: p.REF_EF },
      { item: 'EF_N2O', value: p.EF_N2O, unit: 'g/kg dry matter burnt', ref: p.REF_EF },
      { item: 'GWP_CH4 (' + p.GWP_SET + ')', value: p.GWP_CH4, unit: 'kgCO2e/kg', ref: p.REF_GWP },
      { item: 'GWP_N2O (' + p.GWP_SET + ')', value: p.GWP_N2O, unit: 'kgCO2e/kg', ref: p.REF_GWP },
      { item: 'EF_CO2e = EF_CH4×GWP_CH4 + EF_N2O×GWP_N2O', value: round_(ghgCombinedEf_(p), 4), unit: 'gCO2e/kg dry matter burnt', ref: 'คำนวณ' },
      { item: 'Hectare to Rai', value: p.HA_TO_RAI, unit: 'ไร่/เฮกตาร์', ref: '' },
      { item: 'โหมดคำนวณเริ่มต้น', value: '', unit: p.DEFAULT_MODE === 'standard' ? 'Standard: Bburned = Biomass consumed (Table 2.4)' : 'Residue: Bburned = เศษวัสดุต่อไร่ × Cf', ref: 'ชุดค่าที่ ' + R.ctx.label.version + ' แก้ไข ' + (p.UPDATED_AT || '–') }
    ];
    crops.forEach(function (c) {
      const pub = ghgCropPublic_(c, p);
      rows.push({ item: c.name + ': Biomass consumed', value: pub.consumedKgRai === null ? '' : pub.consumedKgRai, unit: pub.consumedKgRai === null ? 'ไม่มีค่าเริ่มต้น' : 'kg/ไร่ (' + c.consumedTHa + ' t/ha)', ref: c.reference });
      rows.push({ item: c.name + ': Combustion Factor', value: c.cf === '' ? '' : c.cf, unit: 'ratio', ref: c.reference });
      rows.push({ item: c.name + ': เศษวัสดุต่อไร่ (' + (c.residueName || '') + ')', value: c.residueTRai === '' ? '' : c.residueTRai, unit: 'ตัน/ไร่', ref: c.residueReference });
      rows.push({ item: c.name + ': ราคาเศษวัสดุ', value: c.priceBahtKg === '' ? '' : c.priceBahtKg, unit: 'บาท/กก.', ref: c.priceReference });
    });
    return {
      columns: [col_('item', 'พารามิเตอร์'), col_('value', 'ค่า', 'number'), col_('unit', 'หน่วย'), col_('ref', 'แหล่งอ้างอิง')],
      rows: rows,
      notes: ['สูตร (IPCC 2006 Eq. 2.27): Btotal = A × Bburned; CH4 = Btotal × EF_CH4 / 1,000,000; N2O = Btotal × EF_N2O / 1,000,000; L_fire = CH4 × GWP_CH4 + N2O × GWP_N2O; GHG ต่อไร่ = L_fire × 1,000 / A']
        .concat(GHG_BOUNDARY)
    };
  }
  throw new Error('ไม่รู้จักส่วนรายงาน ' + key);
}
