/**
 * Green Gain Hub 2.2.0 — GHG Calculation Engine v1.0 (agricultural residue burning).
 *
 * Reference: IPCC (2006) Vol.4 Ch.2 — Equation 2.27, Table 2.4 (biomass consumed),
 * Table 2.5 (emission factors), Table 2.6 (combustion factors); GWP100 from IPCC AR5
 * WG1 Ch.8 Table 8.7. Parameters live in the ghg_params / ghg_crops sheets so the
 * reporting standard can change without touching the formulas.
 *
 * In this system the result is reported as GHG AVOIDED: the CH4 + N2O that burning
 * the managed area would have released (gross, in-field only — see GHG_BOUNDARY).
 *
 *   Eq.1  Btotal_i     = A_i × Bburned_i                          kg dry matter burnt
 *         Mode A (standard): Bburned_i = Biomass consumed (Table 2.4) — Cf is NOT applied again
 *         Mode B (custom):   Bburned_i = MB_i × Cf_i (MB = dry; fresh × DMF when only fresh weight is known)
 *   Eq.2  CH4_t_i      = Btotal_i × EF_CH4 / 1,000,000;  CH4_CO2e_i = CH4_t_i × GWP_CH4
 *   Eq.3  N2O_t_i      = Btotal_i × EF_N2O / 1,000,000;  N2O_CO2e_i = N2O_t_i × GWP_N2O
 *   Eq.4  L_fire_i     = CH4_CO2e_i + N2O_CO2e_i                   tCO2e
 *   Eq.7  GHG_per_rai  = L_fire_i × 1,000 / A_i                    kgCO2e/rai (n/a when A_i = 0)
 *   Total = Σ CH4_CO2e_i + Σ N2O_CO2e_i (tonnes of CH4 and N2O are never added together)
 */

const GHG_DEFAULT_PARAMS = {
  EF_CH4: 2.7, EF_N2O: 0.07, GWP_CH4: 28, GWP_N2O: 265, GWP_SET: 'AR5', HA_TO_RAI: 6.25, DEFAULT_MODE: 'standard',
  REF_EF: 'IPCC 2006 Vol.4 Ch.2 Table 2.5 (agricultural residues)',
  REF_GWP: 'IPCC AR5 WG1 Ch.8 Table 8.7 (GWP100)'
};
// Preset GWP100 sets: a total is always computed with ONE set, never a mix.
const GHG_GWP_SETS = {
  AR4: { GWP_CH4: 25, GWP_N2O: 298, ref: 'IPCC AR4 WG1 Ch.2 Table 2.14 (GWP100)' },
  AR5: { GWP_CH4: 28, GWP_N2O: 265, ref: 'IPCC AR5 WG1 Ch.8 Table 8.7 (GWP100)' },
  AR6: { GWP_CH4: 27, GWP_N2O: 273, ref: 'IPCC AR6 WG1 Ch.7 Table 7.15 (GWP100, non-fossil CH4)' }
};
const GHG_PARAM_META = {
  EF_CH4: ['g/kg dry matter burnt', 'Emission Factor ของ CH4'],
  EF_N2O: ['g/kg dry matter burnt', 'Emission Factor ของ N2O'],
  GWP_CH4: ['kgCO2e/kg gas', 'Global Warming Potential ของ CH4'],
  GWP_N2O: ['kgCO2e/kg gas', 'Global Warming Potential ของ N2O'],
  GWP_SET: ['', 'ชุดค่า GWP (AR4 / AR5 / AR6 / CUSTOM)'],
  HA_TO_RAI: ['ไร่/เฮกตาร์', 'ตัวแปลงหน่วยพื้นที่'],
  DEFAULT_MODE: ['', 'standard = ชีวมวลที่เผาไหม้ IPCC Table 2.4, residue = เศษวัสดุต่อไร่ (ข้อมูลในประเทศ) × Cf'],
  REF_EF: ['', 'แหล่งอ้างอิง EF'],
  REF_GWP: ['', 'แหล่งอ้างอิง GWP'],
  PARAM_VERSION: ['', 'เลขชุดค่า เพิ่มทุกครั้งที่แก้ไข'],
  UPDATED_AT: ['', 'แก้ไขล่าสุด'],
  UPDATED_BY: ['', 'แก้ไขโดย']
};
// key, name, consumed (t dm/ha, Table 2.4), Cf (Table 2.6), residue (t/rai), residue name, residue reference, IPCC reference/note, active, order
const GHG_DEFAULT_CROPS = [
  ['rice', 'ข้าว', 5.5, 0.80, 0.75, 'ฟางข้าว', 'สกว. (อัตราชีวมวลฟางข้าว 0.75 ตัน/ไร่)', 'IPCC 2006 Table 2.4 (rice straw) / Table 2.6 Cf 0.80', true, 1],
  ['sugarcane', 'อ้อย', 6.5, 0.80, 0.23, 'ใบอ้อย', 'สกว. (อัตราชีวมวลใบอ้อย 0.23 ตัน/ไร่)', 'IPCC 2006 Table 2.4 (sugarcane, เผาก่อนเก็บเกี่ยว) / Table 2.6 Cf 0.80 — การเผาใบอ้อยหลังเก็บเกี่ยวควรใช้ค่าจากพื้นที่จริง', true, 2],
  ['maize', 'ข้าวโพด', 10.0, 0.80, 0.83, 'ต้นและซังข้าวโพด', 'สกว. (อัตราชีวมวลต้นข้าวโพด 0.83 ตัน/ไร่)', 'IPCC 2006 Table 2.4 (maize) / Table 2.6 Cf 0.80', true, 3],
  ['cassava', 'มันสำปะหลัง', '', '', '', 'เหง้ามันสำปะหลัง', '', 'IPCC ไม่มีค่าเริ่มต้น ต้องกรอกค่าพร้อมแหล่งอ้างอิง', true, 4],
  ['wheat', 'ข้าวสาลี', 4.0, 0.90, '', 'ฟางข้าวสาลี', '', 'IPCC 2006 Table 2.4 (wheat) / Table 2.6 Cf 0.90', false, 5],
  ['other', 'พืชอื่น', '', '', '', 'เศษวัสดุอื่น', '', 'ไม่มีค่าเริ่มต้น ต้องกรอกค่าพร้อมแหล่งอ้างอิง', true, 9]
];
const GHG_SHEETS = {
  ghg_params: ['Key', 'Value', 'Unit', 'Description'],
  ghg_crops: ['Crop_Key', 'Crop_Name', 'Consumed_t_ha', 'Cf', 'Residue_t_rai', 'Residue_Name', 'Residue_Reference', 'IPCC_Reference', 'Active', 'Sort_Order', 'Updated_At', 'Updated_By',
    'Price_baht_kg', 'Price_Reference', 'Use_Global_Price', 'Removable_Pct', 'Removable_Reference']
};
// 2.2.0: one province-wide price (ราคากลาง) used by every crop that ticks "ใช้ราคากลาง"; a crop may still
// carry its own price. Changing the central price changes the value of every such crop at once.
const RESIDUE_DEFAULT_PRICE = 0.8;
const RESIDUE_DEFAULT_PRICE_REF = 'ราคากลางเริ่มต้น 0.8 บาท/กก. (ราคาตลาดฟางและใบอ้อยโดยประมาณ)';
const RESIDUE_PRICE_KEYS = {
  PRICE_BAHT_KG: ['บาท/กก.', 'ราคากลางเศษวัสดุ ใช้กับทุกพืชที่เลือก "ใช้ราคากลาง"'],
  PRICE_REF: ['', 'แหล่งที่มาของราคากลาง'],
  PRICE_VERSION: ['', 'เลขชุดราคา เพิ่มทุกครั้งที่แก้ไข'],
  PRICE_UPDATED_AT: ['', 'แก้ไขราคากลางล่าสุด'],
  PRICE_UPDATED_BY: ['', 'แก้ไขราคากลางโดย']
};
// 2.2.0: share of the residue that can leave the field without harming the soil (residue balance step 2).
// key: [percent, reference]; crops without a default stay blank until a value with a source is entered.
const RESIDUE_REMOVABLE_DEFAULTS = {
  rice: [45, 'ค่าเริ่มต้น: งานวิเคราะห์อภิมาน (meta-analysis) ในจีน เสนอการนำฟางข้าวออกไม่เกินราว 45%; IRRI เตือนการสูญเสียโพแทสเซียมเมื่อนำฟางออกทั้งหมด'],
  maize: [42, 'ค่าเริ่มต้น: งานวิเคราะห์อภิมาน (meta-analysis) ในจีน เสนอการนำต้นและซังข้าวโพดออกไม่เกินราว 42%'],
  sugarcane: [40, 'ค่าเริ่มต้นเชิงอนุรักษ์ ยังไม่มีค่าเฉพาะพื้นที่ ควรปรับเมื่อมีข้อมูลในประเทศ']
};
// Thai units shown to users (2.2.0): tCO2e → ตันคาร์บอนไดออกไซด์เทียบเท่า.
const GHG_UNIT_T = 'ตันคาร์บอนไดออกไซด์เทียบเท่า';
const GHG_UNIT_KG = 'กิโลกรัมคาร์บอนไดออกไซด์เทียบเท่า';
const GHG_UNIT_G = 'กรัมคาร์บอนไดออกไซด์เทียบเท่า';
const GHG_BOUNDARY = [
  'ก๊าซเรือนกระจกที่ลดได้ = มีเทน (CH4) และไนตรัสออกไซด์ (N2O) ที่จะเกิดหากเผาเศษวัสดุในพื้นที่ที่จัดการ คิดเป็นตันคาร์บอนไดออกไซด์เทียบเท่า (ประมาณการ, ขั้นต้น/gross)',
  'ไม่นับ CO2 ชีวภาพในบัญชีการปล่อยสุทธิ ตามสมมติฐานสมดุลคาร์บอนของพืชล้มลุกของ IPCC แต่ไม่ได้หมายความว่าการเผาไม่ปล่อย CO2',
  'ไม่รวม CH4 จากนาข้าวระหว่างเพาะปลูก (การไถกลบฟางในนาน้ำขังอาจเพิ่ม CH4) ปุ๋ย การขนส่ง เครื่องจักร หรือการใช้เศษวัสดุนอกแปลง',
  'พื้นที่มาจากการบันทึกของเจ้าหน้าที่ ไม่ได้ใช้จุดความร้อน (Hotspot) หรือคะแนนความเสี่ยงแทนพื้นที่',
  'ไม่ใช่ปริมาณคาร์บอนเครดิตที่ได้รับการรับรอง'
];

/* ------------------------------ engine (pure) ------------------------------ */

function GhgError_(code, message) { const e = new Error(message); e.ghgCode = code; return e; }

function ghgNum_(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return isFinite(n) ? n : NaN;
}

function ghgValidateParams_(p) {
  ['EF_CH4', 'EF_N2O'].forEach(function (k) { if (!(ghgNum_(p[k]) >= 0)) throw GhgError_('PARAM', k + ' ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'); });
  ['GWP_CH4', 'GWP_N2O', 'HA_TO_RAI'].forEach(function (k) { if (!(ghgNum_(p[k]) > 0)) throw GhgError_('PARAM', k + ' ต้องเป็นตัวเลขมากกว่า 0'); });
  const set = GHG_GWP_SETS[p.GWP_SET];
  if (set && (Number(p.GWP_CH4) !== set.GWP_CH4 || Number(p.GWP_N2O) !== set.GWP_N2O)) {
    throw GhgError_('PARAM', 'ค่า GWP ไม่ตรงกับชุด ' + p.GWP_SET + ' (CH4 ' + set.GWP_CH4 + ', N2O ' + set.GWP_N2O + ') ห้ามผสมค่าต่างชุดกัน');
  }
  if (['standard', 'residue'].indexOf(p.DEFAULT_MODE) < 0) throw GhgError_('PARAM', 'DEFAULT_MODE ต้องเป็น standard หรือ residue');
  return p;
}

/** Combined factor gCO2e per kg dry matter burnt, e.g. (2.7×28)+(0.07×265) = 94.15. */
function ghgCombinedEf_(p) { return Number(p.EF_CH4) * Number(p.GWP_CH4) + Number(p.EF_N2O) * Number(p.GWP_N2O); }

/** Table 2.4 biomass consumed in kg dry matter per rai, or null when the crop has no default. */
function ghgConsumedKgRai_(crop, p) {
  const t = ghgNum_(crop && crop.consumedTHa);
  return t === null || isNaN(t) ? null : t * 1000 / Number(p.HA_TO_RAI);
}

/**
 * One crop line. item: { crop, area, mode: 'standard'|'custom', mb, cf, fresh, dmf, reference, dataStatus }.
 * crop: { key, name, consumedTHa, cf, reference }. Throws GhgError_ on any invalid or missing input.
 */
function ghgCalcItem_(item, crop, p) {
  item = item || {};
  if (!crop) throw GhgError_('CROP', 'ไม่พบชนิดพืช ' + cleanText_(item.crop, 40));
  const area = ghgNum_(item.area);
  if (area === null) throw GhgError_('MISSING', crop.name + ': ไม่มีข้อมูลพื้นที่เผา');
  if (isNaN(area) || area < 0) throw GhgError_('AREA', crop.name + ': พื้นที่ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  const mode = item.mode === 'custom' ? 'custom' : 'standard';
  let mb = null, cf = null, bburned, reference;
  if (mode === 'standard') {
    bburned = ghgConsumedKgRai_(crop, p);
    if (bburned === null) throw GhgError_('NO_STANDARD', crop.name + ': ไม่มีค่ามาตรฐาน IPCC ต้องใช้ Custom Mode และระบุแหล่งอ้างอิง');
    reference = crop.reference || 'IPCC 2006 Table 2.4';
  } else {
    mb = ghgNum_(item.mb);
    const fresh = ghgNum_(item.fresh), dmf = ghgNum_(item.dmf);
    if (mb === null && fresh !== null) {
      if (isNaN(fresh) || fresh < 0) throw GhgError_('BIOMASS', crop.name + ': น้ำหนักสดต้องไม่ติดลบ');
      if (dmf === null || isNaN(dmf) || dmf <= 0 || dmf > 1) throw GhgError_('DMF', crop.name + ': ต้องระบุสัดส่วนน้ำหนักแห้ง (0–1) เพื่อแปลงน้ำหนักสดเป็นน้ำหนักแห้ง');
      mb = fresh * dmf;
    }
    if (mb === null) throw GhgError_('MISSING', crop.name + ': ไม่มีข้อมูลปริมาณเศษวัสดุแห้งก่อนเผา');
    if (isNaN(mb) || mb < 0) throw GhgError_('BIOMASS', crop.name + ': ปริมาณชีวมวลต้องไม่ติดลบ');
    cf = ghgNum_(item.cf);
    if (cf === null) cf = ghgNum_(crop.cf);
    if (cf === null) throw GhgError_('MISSING', crop.name + ': ไม่มีค่า Combustion Factor');
    if (isNaN(cf) || cf < 0 || cf > 1) throw GhgError_('CF', crop.name + ': Combustion Factor ต้องอยู่ระหว่าง 0 ถึง 1');
    reference = cleanText_(item.reference, 200) || cleanText_(crop.residueReference, 200);
    if (!reference) throw GhgError_('REFERENCE', crop.name + ': Custom Mode ต้องระบุแหล่งอ้างอิงของค่าชีวมวล');
    bburned = mb * cf;
  }
  const btotal = area * bburned;
  const ch4 = btotal * Number(p.EF_CH4) / 1e6;
  const n2o = btotal * Number(p.EF_N2O) / 1e6;
  const ch4e = ch4 * Number(p.GWP_CH4);
  const n2oe = n2o * Number(p.GWP_N2O);
  const lfire = ch4e + n2oe;
  return {
    crop: crop.key, cropName: crop.name, area: area, mode: mode,
    biomassBefore: mode === 'custom' ? mb : null, // N/A in standard mode: not derived from assumptions
    cf: mode === 'custom' ? cf : null,
    bburned: bburned, btotal: btotal,
    ch4: ch4, n2o: n2o, ch4e: ch4e, n2oe: n2oe, lfire: lfire,
    perRai: area > 0 ? lfire * 1000 / area : null,
    reference: reference,
    dataStatus: ['Estimated', 'Measured', 'Scenario'].indexOf(item.dataStatus) >= 0 ? item.dataStatus : (mode === 'custom' ? 'Measured' : 'Estimated')
  };
}

/** Dynamic multi-crop total. Strict: any invalid line → { ok:false, errors } and no totals (no misleading output). */
function ghgCalculate_(items, crops, p) {
  ghgValidateParams_(p);
  const byKey = {};
  crops.forEach(function (c) { byKey[c.key] = c; });
  const results = [], errors = [];
  (items || []).forEach(function (it, i) {
    try { results.push(ghgCalcItem_(it, byKey[it && it.crop], p)); }
    catch (err) { errors.push({ index: i, code: err.ghgCode || 'ERROR', message: err.message }); }
  });
  if (!items || !items.length) errors.push({ index: -1, code: 'EMPTY', message: 'ยังไม่มีรายการพืช' });
  if (errors.length) return { ok: false, errors: errors };
  const sum = function (k) { return results.reduce(function (a, r) { return a + r[k]; }, 0); };
  const totals = { area: sum('area'), btotal: sum('btotal'), ch4: sum('ch4'), n2o: sum('n2o'), ch4e: sum('ch4e'), n2oe: sum('n2oe') };
  totals.ghg = totals.ch4e + totals.n2oe;
  return { ok: true, items: results, totals: totals, params: ghgParamLabel_(p) };
}

function ghgParamLabel_(p) {
  return { gwpSet: p.GWP_SET, efCh4: Number(p.EF_CH4), efN2o: Number(p.EF_N2O), gwpCh4: Number(p.GWP_CH4), gwpN2o: Number(p.GWP_N2O),
    combinedEf: round_(ghgCombinedEf_(p), 4), mode: p.DEFAULT_MODE, version: Number(p.PARAM_VERSION) || 1, updatedAt: p.UPDATED_AT || '',
    refEf: p.REF_EF || '', refGwp: p.REF_GWP || '',
    label: 'IPCC 2006 + ' + p.GWP_SET + ' (EF ' + round_(ghgCombinedEf_(p), 2) + ' ' + GHG_UNIT_G + '/กก.)' };
}

/* ------------------------------ validation suite (prompt §10) ------------------------------ */

function ghgDefaultCropObjects_() {
  return GHG_DEFAULT_CROPS.map(function (r) {
    return { key: r[0], name: r[1], consumedTHa: r[2], cf: r[3], residueTRai: r[4], residueName: r[5], residueReference: r[6], reference: r[7], active: r[8], sortOrder: r[9],
      priceBahtKg: RESIDUE_DEFAULT_PRICE, priceReference: RESIDUE_DEFAULT_PRICE_REF, ownPriceBahtKg: '', useGlobalPrice: true,
      removablePct: RESIDUE_REMOVABLE_DEFAULTS[r[0]] ? RESIDUE_REMOVABLE_DEFAULTS[r[0]][0] : '', removableReference: RESIDUE_REMOVABLE_DEFAULTS[r[0]] ? RESIDUE_REMOVABLE_DEFAULTS[r[0]][1] : '' };
  });
}

/** Runs the five validation cases with the IPCC 2006 + AR5 defaults; PASS/FAIL comes from the actual calculation. */
function ghgValidationSuite_() {
  const p = Object.assign({}, GHG_DEFAULT_PARAMS);
  const crops = ghgDefaultCropObjects_();
  const near = function (a, b) { return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)) || Math.abs(round_(a, 6) - b) < 5e-7; };
  const out = [];
  const add = function (name, expected, actual, pass) { out.push({ name: name, expected: expected, actual: actual, pass: !!pass }); };

  const t1 = ghgCalculate_([{ crop: 'rice', area: 100 }, { crop: 'maize', area: 100 }, { crop: 'sugarcane', area: 100 }], crops, p);
  const it = function (k) { return t1.items.find(function (x) { return x.crop === k; }); };
  add('TC1 ข้าว 100 ไร่ (Standard)', '8.2852 tCO2e', t1.ok ? round_(it('rice').lfire, 6) : t1.errors, t1.ok && near(it('rice').lfire, 8.2852));
  add('TC1 ข้าวโพด 100 ไร่', '15.0640 tCO2e', t1.ok ? round_(it('maize').lfire, 6) : '', t1.ok && near(it('maize').lfire, 15.064));
  add('TC1 อ้อย 100 ไร่', '9.7916 tCO2e', t1.ok ? round_(it('sugarcane').lfire, 6) : '', t1.ok && near(it('sugarcane').lfire, 9.7916));
  add('TC1 Total Biomass Consumed', '352,000 kg', t1.ok ? t1.totals.btotal : '', t1.ok && near(t1.totals.btotal, 352000));
  add('TC1 CH4 Emissions', '0.9504 t CH4', t1.ok ? round_(t1.totals.ch4, 6) : '', t1.ok && near(t1.totals.ch4, 0.9504));
  add('TC1 N2O Emissions', '0.02464 t N2O', t1.ok ? round_(t1.totals.n2o, 6) : '', t1.ok && near(t1.totals.n2o, 0.02464));
  add('TC1 CH4 CO2e', '26.6112 tCO2e', t1.ok ? round_(t1.totals.ch4e, 6) : '', t1.ok && near(t1.totals.ch4e, 26.6112));
  add('TC1 N2O CO2e', '6.5296 tCO2e', t1.ok ? round_(t1.totals.n2oe, 6) : '', t1.ok && near(t1.totals.n2oe, 6.5296));
  add('TC1 GHG Total', '33.1408 tCO2e', t1.ok ? round_(t1.totals.ghg, 6) : '', t1.ok && near(t1.totals.ghg, 33.1408));
  add('Combined EF', '94.15 gCO2e/kg', round_(ghgCombinedEf_(p), 6), near(ghgCombinedEf_(p), 94.15));

  const t2 = ghgCalculate_([{ crop: 'rice', area: 100, mode: 'custom', mb: 1100, cf: 0.8, reference: 'TC2' }], crops, p);
  add('TC2 Custom MB 1,100 × Cf 0.80', '8.2852 tCO2e (= Standard)', t2.ok ? round_(t2.items[0].lfire, 6) : t2.errors, t2.ok && near(t2.items[0].lfire, 8.2852));

  const t3 = ghgCalculate_([{ crop: 'rice', area: 0 }], crops, p);
  add('TC3 พื้นที่ 0 ไร่', 'L_fire 0, GHG per Rai = N/A', t3.ok ? t3.items[0].lfire + ' / ' + t3.items[0].perRai : t3.errors,
    t3.ok && t3.items[0].lfire === 0 && t3.items[0].perRai === null);

  const t4 = ghgCalculate_([{ crop: 'rice', area: 100 }, { crop: 'maize', area: 100 }, { crop: 'sugarcane', area: 100 },
    { crop: 'cassava', area: 50, mode: 'custom', mb: 500, cf: 0.8, reference: 'ข้อมูลทดสอบ' }], crops, p);
  const add4 = 50 * 500 * 0.8 * 94.15 / 1e6;
  add('TC4 เพิ่มพืชชนิดที่ 4 (Custom + Reference)', round_(33.1408 + add4, 6) + ' tCO2e', t4.ok ? round_(t4.totals.ghg, 6) : t4.errors, t4.ok && near(t4.totals.ghg, 33.1408 + add4));

  const bad = [
    ['พื้นที่ติดลบ', { crop: 'rice', area: -1 }, 'AREA'],
    ['ชีวมวลติดลบ', { crop: 'rice', area: 10, mode: 'custom', mb: -5, cf: 0.8, reference: 'x' }, 'BIOMASS'],
    ['Cf มากกว่า 1', { crop: 'rice', area: 10, mode: 'custom', mb: 100, cf: 1.2, reference: 'x' }, 'CF'],
    ['Cf น้อยกว่า 0', { crop: 'rice', area: 10, mode: 'custom', mb: 100, cf: -0.1, reference: 'x' }, 'CF'],
    ['ไม่มีข้อมูลพื้นที่', { crop: 'rice' }, 'MISSING'],
    ['ไม่มีค่าชีวมวล (Custom)', { crop: 'rice', area: 10, mode: 'custom', cf: 0.8, reference: 'x' }, 'MISSING'],
    ['มันสำปะหลังเลือก Standard', { crop: 'cassava', area: 10 }, 'NO_STANDARD']
  ];
  bad.forEach(function (b) {
    const r = ghgCalculate_([{ crop: 'rice', area: 100 }, b[1]], crops, p);
    add('TC5 ' + b[0], 'แจ้งข้อผิดพลาด ' + b[2] + ' และไม่แสดงผลรวม', r.ok ? 'คำนวณได้ (ผิด)' : r.errors.map(function (e) { return e.code; }).join(','),
      !r.ok && !r.totals && r.errors.some(function (e) { return e.code === b[2]; }));
  });
  return { status: 'success', passed: out.filter(function (x) { return x.pass; }).length, total: out.length, cases: out };
}

/* ------------------------------ sheets ------------------------------ */

function ensureGhgSchema_() {
  Object.keys(GHG_SHEETS).forEach(function (n) { ensureSheet_(n, GHG_SHEETS[n]); });
  const ps = sheetByName_('ghg_params');
  const have = {};
  dataRows_(ps).forEach(function (r) { have[text_(r[0])] = true; });
  const now = new Date();
  const defaults = Object.assign({}, GHG_DEFAULT_PARAMS, { PARAM_VERSION: 1, UPDATED_AT: now, UPDATED_BY: 'setupSystem' });
  Object.keys(GHG_PARAM_META).forEach(function (k) {
    if (!have[k]) ps.appendRow([k, defaults[k], GHG_PARAM_META[k][0], GHG_PARAM_META[k][1]]);
  });
  const cs = sheetByName_('ghg_crops');
  const ck = {};
  dataRows_(cs).forEach(function (r) { ck[text_(r[0])] = true; });
  GHG_DEFAULT_CROPS.forEach(function (r) {
    if (ck[r[0]]) return;
    const rem = RESIDUE_REMOVABLE_DEFAULTS[r[0]] || ['', ''];
    cs.appendRow(r.concat([now, 'setupSystem', '', '', true, rem[0], rem[1]]));
  });
  const priceNote = ensureResiduePrice_();
  // 2.2.0 migration (once): every crop follows the central price; known crops get the removable share.
  const props = PropertiesService.getScriptProperties();
  let migrated = '';
  if (!props.getProperty('GGH_MIGRATION_220')) {
    dataRows_(cs).forEach(function (r, i) {
      const key = text_(r[0]);
      if (!key) return;
      if (r[14] === '' || r[14] === undefined) cs.getRange(i + 2, 15).setValue(true);
      const rem = RESIDUE_REMOVABLE_DEFAULTS[key];
      if (rem && (r[15] === '' || r[15] === undefined)) cs.getRange(i + 2, 16, 1, 2).setValues([[rem[0], rem[1]]]);
    });
    props.setProperty('GGH_MIGRATION_220', new Date().toISOString());
    migrated = '; 2.2.0 migration: every crop now uses the central price';
  }
  const p = ghgParams_();
  const v = ghgValidationSuite_();
  return 'PASS: ghg_params (' + p.GWP_SET + ', EF ' + round_(ghgCombinedEf_(p), 2) + ' gCO2e/kg) and ghg_crops are ready; ' + priceNote + migrated + '; validation ' +
    v.passed + '/' + v.total + (v.passed === v.total ? ' PASS' : ' FAIL');
}

/* ------------------------------ central price (ราคากลาง) ------------------------------ */

function ensureResiduePrice_() {
  const ps = sheetByName_('ghg_params');
  const have = {};
  dataRows_(ps).forEach(function (r) { have[text_(r[0])] = true; });
  const init = { PRICE_BAHT_KG: RESIDUE_DEFAULT_PRICE, PRICE_REF: RESIDUE_DEFAULT_PRICE_REF, PRICE_VERSION: 1, PRICE_UPDATED_AT: new Date(), PRICE_UPDATED_BY: 'setupSystem' };
  Object.keys(RESIDUE_PRICE_KEYS).forEach(function (k) {
    if (!have[k]) ps.appendRow([k, init[k], RESIDUE_PRICE_KEYS[k][0], RESIDUE_PRICE_KEYS[k][1]]);
  });
  const g = residuePriceGlobal_();
  return 'central price ' + g.price + ' baht/kg (set ' + g.version + ')';
}

function residuePriceGlobal_() {
  const out = { price: RESIDUE_DEFAULT_PRICE, reference: RESIDUE_DEFAULT_PRICE_REF, version: 1, updatedAt: '', updatedBy: '' };
  const sh = spreadsheet_().getSheetByName('ghg_params');
  if (sh) dataRows_(sh).forEach(function (r) {
    const k = text_(r[0]);
    if (k === 'PRICE_BAHT_KG') { const n = ghgNum_(r[1]); if (n !== null && !isNaN(n)) out.price = n; }
    else if (k === 'PRICE_REF') out.reference = text_(r[1]) || out.reference;
    else if (k === 'PRICE_VERSION') out.version = Number(r[1]) || 1;
    else if (k === 'PRICE_UPDATED_AT') out.updatedAt = dateTime_(r[1]);
    else if (k === 'PRICE_UPDATED_BY') out.updatedBy = text_(r[1]);
  });
  return out;
}

/** Mini Super Admin / Super Admin: one price for every crop that uses the central price. Versioned and audited. */
function residuePriceSave_(input, s) {
  input = input || {};
  const price = ghgNum_(input.price);
  if (price === null || isNaN(price) || price <= 0 || price > 100) throw new Error('ราคากลางต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 100 บาท/กก.');
  const reference = cleanText_(input.reference, 200);
  if (!reference) throw new Error('กรุณาระบุแหล่งที่มาของราคากลาง');
  const cur = residuePriceGlobal_();
  if (price === cur.price && reference === cur.reference) return { status: 'success', message: 'ไม่มีการเปลี่ยนแปลง', settings: ghgSettingsGet_() };
  ensureResiduePrice_();
  const next = { PRICE_BAHT_KG: price, PRICE_REF: reference, PRICE_VERSION: cur.version + 1, PRICE_UPDATED_AT: new Date(), PRICE_UPDATED_BY: s.name + ' (' + s.username + ')' };
  const sh = sheetByName_('ghg_params');
  const rows = dataRows_(sh);
  Object.keys(next).forEach(function (k) {
    const i = rows.findIndex(function (r) { return text_(r[0]) === k; });
    sh.getRange(i + 2, 2).setValue(next[k]);
  });
  invalidateResidue_();
  const users = ghgCrops_(true).filter(function (c) { return c.useGlobalPrice; }).map(function (c) { return c.name; });
  adminAudit_(s, 'residue_price_save', 'ราคากลางชุดที่ ' + next.PRICE_VERSION + ': ' + cur.price + ' → ' + price + ' บาท/กก. (' + reference + ') ใช้กับ ' + users.join(', '));
  return { status: 'success', message: 'บันทึกราคากลาง ' + price + ' บาท/กก. แล้ว ใช้กับ ' + users.length + ' ชนิดพืช', settings: ghgSettingsGet_() };
}

function ghgParams_() {
  const p = Object.assign({}, GHG_DEFAULT_PARAMS, { PARAM_VERSION: 1, UPDATED_AT: '', UPDATED_BY: '' });
  const sh = spreadsheet_().getSheetByName('ghg_params');
  if (sh) dataRows_(sh).forEach(function (r) {
    const k = text_(r[0]);
    if (!(k in GHG_PARAM_META)) return;
    const n = ghgNum_(r[1]);
    p[k] = ['GWP_SET', 'DEFAULT_MODE', 'REF_EF', 'REF_GWP', 'UPDATED_BY'].indexOf(k) >= 0 ? text_(r[1]) : (k === 'UPDATED_AT' ? dateTime_(r[1]) : (n === null || isNaN(n) ? p[k] : n));
  });
  return p;
}

function ghgCrops_(includeInactive) {
  const sh = spreadsheet_().getSheetByName('ghg_crops');
  const global = sh ? residuePriceGlobal_() : null;
  const list = sh ? dataRows_(sh).map(function (r) {
    // Use_Global_Price blank = follow the central price (2.2.0 default).
    const useGlobal = r[14] === '' || r[14] === undefined ? true : truthyCell_(r[14]);
    const own = r[12] === '' || r[12] === undefined ? '' : Number(r[12]);
    return { key: text_(r[0]), name: text_(r[1]), consumedTHa: r[2] === '' ? '' : Number(r[2]), cf: r[3] === '' ? '' : Number(r[3]),
      residueTRai: r[4] === '' ? '' : Number(r[4]), residueName: text_(r[5]), residueReference: text_(r[6]), reference: text_(r[7]),
      active: truthyCell_(r[8]), sortOrder: Number(r[9]) || 99, updatedAt: dateTime_(r[10]), updatedBy: text_(r[11]),
      useGlobalPrice: useGlobal, ownPriceBahtKg: own, ownPriceReference: text_(r[13]),
      priceBahtKg: useGlobal ? global.price : own, priceReference: useGlobal ? 'ราคากลาง: ' + global.reference : text_(r[13]),
      removablePct: r[15] === '' || r[15] === undefined ? '' : Number(r[15]), removableReference: text_(r[16]) };
  }) : ghgDefaultCropObjects_();
  return list.filter(function (c) { return c.key && (includeInactive || c.active); })
    .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
}

function ghgCropPublic_(c, p) {
  const consumed = ghgConsumedKgRai_(c, p);
  return { key: c.key, name: c.name, residueName: c.residueName, hasStandard: consumed !== null, consumedKgRai: consumed === null ? null : round_(consumed, 2),
    cf: c.cf === '' ? null : c.cf, residueTRai: c.residueTRai === '' ? null : c.residueTRai, reference: c.reference, residueReference: c.residueReference,
    priceBahtKg: c.priceBahtKg === '' || c.priceBahtKg === undefined ? null : Number(c.priceBahtKg), priceReference: c.priceReference || '',
    useGlobalPrice: c.useGlobalPrice !== false, removablePct: c.removablePct === '' || c.removablePct === undefined ? null : Number(c.removablePct) };
}

/* ------------------------------ admin methods ------------------------------ */

function ghgSettingsGet_() {
  const p = ghgParams_();
  const crops = ghgCrops_(true);
  const sample = crops.map(function (c) {
    const out = { key: c.key, name: c.name, standard: null, residue: null };
    try { out.standard = round_(ghgCalcItem_({ area: 100 }, c, p).lfire, 4); } catch (err) { out.standard = null; }
    if (c.residueTRai !== '' && c.cf !== '') {
      try { out.residue = round_(ghgCalcItem_({ area: 100, mode: 'custom', mb: Number(c.residueTRai) * 1000, cf: c.cf, reference: c.residueReference || 'residue' }, c, p).lfire, 4); } catch (err) { out.residue = null; }
    }
    return out;
  });
  return { status: 'success', params: p, label: ghgParamLabel_(p), gwpSets: GHG_GWP_SETS, defaults: GHG_DEFAULT_PARAMS, price: residuePriceGlobal_(),
    crops: crops.map(function (c) { return Object.assign({}, c, ghgCropPublic_(c, p)); }), sample100: sample, boundary: GHG_BOUNDARY };
}

function ghgParamsSave_(input, s) {
  input = input || {};
  const cur = ghgParams_();
  const next = Object.assign({}, cur);
  ['EF_CH4', 'EF_N2O', 'GWP_CH4', 'GWP_N2O', 'HA_TO_RAI'].forEach(function (k) { if (k in input) next[k] = ghgNum_(input[k]); });
  if ('GWP_SET' in input) next.GWP_SET = String(input.GWP_SET || '').toUpperCase();
  if (['AR4', 'AR5', 'AR6', 'CUSTOM'].indexOf(next.GWP_SET) < 0) throw new Error('ชุดค่า GWP ต้องเป็น AR4, AR5, AR6 หรือ CUSTOM');
  const preset = GHG_GWP_SETS[next.GWP_SET];
  // A preset always carries its own values and reference, so a set can never be mixed.
  if (preset) { next.GWP_CH4 = preset.GWP_CH4; next.GWP_N2O = preset.GWP_N2O; }
  if ('DEFAULT_MODE' in input) next.DEFAULT_MODE = String(input.DEFAULT_MODE);
  if ('REF_EF' in input) next.REF_EF = cleanText_(input.REF_EF, 200);
  if ('REF_GWP' in input) next.REF_GWP = cleanText_(input.REF_GWP, 200);
  if (preset && (next.GWP_SET !== cur.GWP_SET || !next.REF_GWP)) next.REF_GWP = preset.ref;
  if (next.GWP_SET === 'CUSTOM' && !next.REF_GWP) throw new Error('ชุดค่า GWP แบบกำหนดเองต้องระบุแหล่งอ้างอิง');
  try { ghgValidateParams_(next); } catch (err) { throw new Error(err.message); }
  const changed = Object.keys(GHG_PARAM_META).filter(function (k) {
    return ['PARAM_VERSION', 'UPDATED_AT', 'UPDATED_BY'].indexOf(k) < 0 && String(next[k]) !== String(cur[k]);
  });
  if (!changed.length) return { status: 'success', message: 'ไม่มีการเปลี่ยนแปลง', settings: ghgSettingsGet_() };
  next.PARAM_VERSION = (Number(cur.PARAM_VERSION) || 1) + 1;
  next.UPDATED_AT = new Date();
  next.UPDATED_BY = s.name + ' (' + s.username + ')';
  const sh = sheetByName_('ghg_params');
  const rows = dataRows_(sh);
  Object.keys(GHG_PARAM_META).forEach(function (k) {
    const i = rows.findIndex(function (r) { return text_(r[0]) === k; });
    if (i >= 0) sh.getRange(i + 2, 2).setValue(next[k]); else sh.appendRow([k, next[k], GHG_PARAM_META[k][0], GHG_PARAM_META[k][1]]);
  });
  invalidateResidue_();
  adminAudit_(s, 'ghg_params_save', 'ชุดค่า ' + next.PARAM_VERSION + ': ' + changed.map(function (k) { return k + ' ' + cur[k] + ' → ' + next[k]; }).join(', '));
  return { status: 'success', message: 'บันทึกชุดค่าที่ ' + next.PARAM_VERSION + ' แล้ว ผลคำนวณทั้งหมดใช้ชุดค่านี้', settings: ghgSettingsGet_() };
}

function ghgCropSave_(input, s) {
  input = input || {};
  const key = String(input.key || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,23}$/.test(key)) throw new Error('รหัสพืชต้องเป็น a–z, 0–9 หรือ _ (2–24 ตัว)');
  const name = cleanText_(input.name, 60);
  if (!name) throw new Error('กรุณากรอกชื่อพืช');
  const num = function (v, label, max) {
    const n = ghgNum_(v);
    if (n === null) return '';
    if (isNaN(n) || n < 0 || (max !== undefined && n > max)) throw new Error(label + ' ต้องเป็นตัวเลข 0' + (max !== undefined ? '–' + max : ' ขึ้นไป'));
    return n;
  };
  const consumed = num(input.consumedTHa, 'Biomass consumed (t/ha)');
  const cf = num(input.cf, 'Combustion Factor', 1);
  const residue = num(input.residueTRai, 'เศษวัสดุ (ตัน/ไร่)');
  const reference = cleanText_(input.reference, 200);
  const residueReference = cleanText_(input.residueReference, 200);
  const sh0 = sheetByName_('ghg_crops');
  const prev = dataRows_(sh0).find(function (r) { return text_(r[0]) === key; });
  // Own price (used only when the crop does not follow the central price) is kept when not sent.
  const useGlobal = 'useGlobalPrice' in input ? input.useGlobalPrice !== false : (prev && prev[14] !== '' && prev[14] !== undefined ? truthyCell_(prev[14]) : true);
  const price = 'priceBahtKg' in input ? num(input.priceBahtKg, 'ราคาเฉพาะพืช (บาท/กก.)') : (prev && prev[12] !== '' && prev[12] !== undefined ? Number(prev[12]) : '');
  const priceReference = 'priceBahtKg' in input ? cleanText_(input.priceReference, 200) : (prev ? text_(prev[13]) : '');
  if (!useGlobal && price === '') throw new Error('พืชที่ไม่ใช้ราคากลางต้องกรอกราคาเฉพาะพืช');
  if (!useGlobal && !priceReference) throw new Error('ราคาเฉพาะพืชต้องระบุแหล่งที่มา');
  const removable = 'removablePct' in input ? num(input.removablePct, 'สัดส่วนที่นำออกได้ (%)', 100) : (prev && prev[15] !== undefined ? prev[15] : '');
  const removableReference = 'removablePct' in input ? cleanText_(input.removableReference, 200) : (prev ? text_(prev[16]) : '');
  if (removable !== '' && !removableReference) throw new Error('สัดส่วนที่นำออกได้ต้องระบุแหล่งอ้างอิง');
  if (consumed !== '' && !reference) throw new Error('ค่า Biomass consumed ต้องระบุแหล่งอ้างอิง');
  if (residue !== '' && !residueReference) throw new Error('ค่าเศษวัสดุต่อไร่ต้องระบุแหล่งอ้างอิง');
  const sh = sheetByName_('ghg_crops');
  const rows = dataRows_(sh);
  const idx = rows.findIndex(function (r) { return text_(r[0]) === key; });
  const before = idx >= 0 ? rows[idx] : null;
  const values = [key, name, consumed, cf, residue, cleanText_(input.residueName, 80), residueReference, reference,
    input.active !== false, Math.max(1, Math.min(99, Number(input.sortOrder) || 50)), new Date(), s.name + ' (' + s.username + ')', price, priceReference,
    useGlobal, removable, removableReference];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, values.length).setValues([values]); else sh.appendRow(values);
  invalidateResidue_();
  adminAudit_(s, 'ghg_crop_save', key + ' ' + name + ': consumed ' + (before ? before[2] : '–') + ' → ' + consumed + ' t/ha, Cf ' + (before ? before[3] : '–') + ' → ' + cf +
    ', residue ' + (before ? before[4] : '–') + ' → ' + residue + ' t/rai, ' + (useGlobal ? 'ใช้ราคากลาง' : 'ราคาเฉพาะพืช ' + price + ' baht/kg') +
    ', removable ' + (before ? before[15] : '–') + ' → ' + removable + '%');
  return { status: 'success', message: 'บันทึกค่าพืช ' + name + ' แล้ว', settings: ghgSettingsGet_() };
}

/** Calculator for scenarios / checks. Strict validation; nothing is stored. */
function ghgCalculateServer_(input) {
  input = input || {};
  const p = ghgParams_();
  const r = ghgCalculate_(Array.isArray(input.items) ? input.items.slice(0, 50) : [], ghgCrops_(true), p);
  if (r.ok) r.items.forEach(function (x) { if (input.scenario) x.dataStatus = 'Scenario'; });
  return Object.assign({ status: 'success' }, r);
}
