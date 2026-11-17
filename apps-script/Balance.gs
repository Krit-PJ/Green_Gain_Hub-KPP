/**
 * Green Gain Hub 2.2.0 — residue balance (สมดุลวัสดุเหลือใช้ทางการเกษตร): links the two subsystems.
 *
 * Per district × crop for one fiscal year (1 Oct – 30 Sep):
 *   ① potential    = harvested rai in the fiscal year (farmer registry import) × residue (t/rai)
 *   ② removable    = ① × removable share (%) of the crop — residue that may leave the field without harming the soil
 *   ③ listed       = open marketplace plots harvested in the fiscal year (rai, t)
 *   ④ buyers       = active buyers of that residue in the district (count, t/day as entered by buyers)
 *   ⑤ managed      = officer records (rai, t, tonnes actually sold, rai linked to a marketplace buyer)
 *   ⑥ at risk      = ① rai − ⑤ rai (not below 0): harvested area without a management record
 *
 * Nothing here changes targets, the GHG formula or the value formula; the marketplace is never added to ⑤,
 * so no tonne is counted twice. Output is aggregate only (no names, phones or plot coordinates).
 */

const BALANCE_CACHE_SECONDS = 300;
const BALANCE_LOW_SHARE = 20; // % of harvested area with a management record below which a district is flagged

function balanceCacheKey_(fy, district) { return 'balance:v1:' + fy + ':' + (district || 'all'); }

function invalidateBalance_() {
  try {
    const c = CacheService.getScriptCache();
    const fy = currentFiscalYear_();
    const keys = [];
    [fy - 1, fy, fy + 1].forEach(function (y) {
      keys.push(balanceCacheKey_(y, ''));
      Object.keys(residueDistrictNames_()).forEach(function (d) { keys.push(balanceCacheKey_(y, d)); });
    });
    c.removeAll(keys);
  } catch (err) { /* best effort */ }
}

/** Gregorian yyyymm range of a Buddhist-Era fiscal year: 2570 → 202510 … 202609. */
function fiscalMonthRange_(fy) {
  const y = fy - 543;
  return { from: (y - 1) * 100 + 10, to: y * 100 + 9 };
}

function fiscalMonths_(fy) {
  const r = fiscalMonthRange_(fy);
  const out = [];
  for (let m = r.from; m <= r.to; m = addMonth_(m, 1)) out.push(m);
  return out;
}

/** Residue name of a buyer's material → crop key of ghg_crops. */
function materialGroupOf_(material) {
  const m = String(material || '');
  if (m.indexOf('ฟาง') >= 0 && m.indexOf('สาลี') < 0) return 'rice';
  if (m.indexOf('อ้อย') >= 0) return 'sugarcane';
  if (m.indexOf('ข้าวโพด') >= 0 || m.indexOf('ซัง') >= 0) return 'maize';
  if (m.indexOf('มันสำปะหลัง') >= 0) return 'cassava';
  return 'other';
}

function residueBalance_(fy, district) {
  fy = Number(fy) || currentFiscalYear_();
  district = district || '';
  const cache = CacheService.getScriptCache();
  const key = balanceCacheKey_(fy, district);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const out = buildResidueBalance_(fy, district);
  try { cache.put(key, JSON.stringify(out), BALANCE_CACHE_SECONDS); } catch (err) { /* too large */ }
  return out;
}

function buildResidueBalance_(fy, district) {
  const range = fiscalMonthRange_(fy);
  const months = fiscalMonths_(fy);
  const names = residueDistrictNames_();
  const crops = {};
  ghgCrops_(true).forEach(function (c) { crops[c.key] = c; });
  const ctx = residueCtx_();
  const cells = {};
  const monthly = {};
  months.forEach(function (m) { monthly[m] = { month: m, harvestedRai: 0, managedRai: 0 }; });
  const cell = function (d, c) {
    const k = d + '|' + c;
    return cells[k] || (cells[k] = { district: d, crop: c, harvestedRai: 0, listedRai: 0, listedPlots: 0, buyers: 0, capacityTonPerDay: 0,
      managedRai: 0, managedTon: 0, soldTon: 0, linkedRai: 0, records: 0, ghg: 0 });
  };
  const want = function (d) { return names[d] && (!district || d === district); };
  const sources = [];

  // ① harvested area from the active registry imports, months inside the fiscal year
  try {
    const data = activeCropRows_();
    data.imports.forEach(function (imp) {
      const group = cropGroupOf_(imp.crop);
      let used = false;
      (data.rows[imp.importId] || []).forEach(function (r) {
        if (r.level !== 'district' || r.period < range.from || r.period > range.to) return;
        const d = r.code.replace('-', '');
        if (!want(d)) return;
        cell(d, group).harvestedRai += r.area;
        if (monthly[r.period]) monthly[r.period].harvestedRai += r.area;
        used = true;
      });
      if (used) sources.push(imp.crop + ' ' + imp.season);
    });
  } catch (err) { /* no registry data yet */ }

  // ③ ④ marketplace (aggregate only)
  const districts = districtList_();
  const inFy = function (v) {
    const d = toDate_(v);
    if (!d) return false;
    const ym = yyyymm_(d);
    return ym >= range.from && ym <= range.to;
  };
  try {
    dataRows_(sheet_('farmers')).forEach(function (r) {
      if (String(r[11] || '').trim().toLowerCase() !== 'open' || !inFy(r[7]) || !hasCoordinates_(r[9], r[10])) return;
      const d = districtForPoint_(Number(r[9]), Number(r[10]), districts);
      if (!d || !want(d.code)) return;
      const x = cell(d.code, cropGroupOf_(r[5]));
      x.listedRai += parseAreaRai_(r[8]);
      x.listedPlots++;
    });
    dataRows_(sheet_('buyers')).forEach(function (r) {
      if (String(r[11] || '').trim().toLowerCase() !== 'active' || !hasCoordinates_(r[5], r[6])) return;
      const d = districtForPoint_(Number(r[5]), Number(r[6]), districts);
      if (!d || !want(d.code)) return;
      const x = cell(d.code, materialGroupOf_(resolvedMaterial_(r[13], r[14], r[7])));
      x.buyers++;
      x.capacityTonPerDay += leadingNumber_(r[10]);
    });
  } catch (err) { /* marketplace sheets missing */ }

  // ⑤ officer records
  residueRecords_({ fy: fy, district: district }).forEach(function (r) {
    const v = residueCompute_(r, ctx);
    const x = cell(r.district, r.crop);
    x.records++;
    x.managedRai += r.area;
    if (v.tonnes !== null) x.managedTon += v.tonnes;
    if (r.soldTonnes !== null) x.soldTon += r.soldTonnes;
    if (r.buyerId) x.linkedRai += r.area;
    if (v.ghg !== null) x.ghg += v.ghg;
    const ym = Number(String(r.date).slice(0, 4) + String(r.date).slice(5, 7));
    if (monthly[ym]) monthly[ym].managedRai += r.area;
  });

  const rows = Object.keys(cells).sort().map(function (k) { return balanceRow_(cells[k], crops[cells[k].crop], names); })
    .filter(function (x) { return x.harvestedRai || x.managedRai || x.listedRai || x.buyers; });
  return {
    ok: true, fy: fy, fyRange: fiscalRangeText_(fy), district: district, districtName: names[district] || '', generatedAt: new Date().toISOString(),
    rows: rows, byDistrict: balanceByDistrict_(rows, names, district), totals: balanceTotals_(rows),
    months: months.map(function (m) { const x = monthly[m]; return { month: m, harvestedRai: round_(x.harvestedRai, 2), managedRai: round_(x.managedRai, 2) }; }),
    crops: Object.keys(crops).map(function (k) { const c = crops[k]; return { key: k, name: c.name, residueTRai: c.residueTRai === '' ? null : c.residueTRai, removablePct: c.removablePct === '' ? null : c.removablePct }; }),
    sources: { registry: sources, note: 'พื้นที่เก็บเกี่ยวจากทะเบียนเกษตรกร (ค่าคาดการณ์ตามเดือนที่คาดว่าจะเก็บเกี่ยว) ช่วง ' + fiscalRangeText_(fy) },
    lowShare: BALANCE_LOW_SHARE
  };
}

function balanceRow_(x, crop, names) {
  const rate = crop && crop.residueTRai !== '' ? Number(crop.residueTRai) : null;
  const pct = crop && crop.removablePct !== '' && crop.removablePct !== undefined ? Number(crop.removablePct) : null;
  const potentialTon = rate === null ? null : x.harvestedRai * rate;
  const atRiskRai = Math.max(0, x.harvestedRai - x.managedRai);
  const share = x.harvestedRai ? x.managedRai / x.harvestedRai * 100 : null;
  const flags = [];
  if (x.listedRai > 0 && x.buyers === 0) flags.push('need_buyer');
  if (x.harvestedRai > 0 && share !== null && share < BALANCE_LOW_SHARE) flags.push('low_managed');
  return {
    district: x.district, districtName: names[x.district] || x.district, crop: x.crop, cropName: crop ? crop.name : x.crop,
    harvestedRai: round_(x.harvestedRai, 2), potentialTon: potentialTon === null ? null : round_(potentialTon, 1),
    removablePct: pct, removableTon: potentialTon === null || pct === null ? null : round_(potentialTon * pct / 100, 1),
    listedPlots: x.listedPlots, listedRai: round_(x.listedRai, 2), listedTon: rate === null ? null : round_(x.listedRai * rate, 1),
    buyers: x.buyers, capacityTonPerDay: round_(x.capacityTonPerDay, 1),
    records: x.records, managedRai: round_(x.managedRai, 2), managedTon: round_(x.managedTon, 1), soldTon: round_(x.soldTon, 1), linkedRai: round_(x.linkedRai, 2),
    ghg: round_(x.ghg, 4), managedPct: share === null ? null : round_(share, 1),
    atRiskRai: round_(atRiskRai, 2), atRiskTon: rate === null ? null : round_(atRiskRai * rate, 1), flags: flags
  };
}

function balanceTotals_(rows) {
  const sum = function (k, d) { return round_(rows.reduce(function (a, r) { return a + (Number(r[k]) || 0); }, 0), d); };
  const t = { harvestedRai: sum('harvestedRai', 2), potentialTon: sum('potentialTon', 1), removableTon: sum('removableTon', 1), listedPlots: sum('listedPlots', 0),
    listedRai: sum('listedRai', 2), listedTon: sum('listedTon', 1), buyers: sum('buyers', 0), capacityTonPerDay: sum('capacityTonPerDay', 1), records: sum('records', 0),
    managedRai: sum('managedRai', 2), managedTon: sum('managedTon', 1), soldTon: sum('soldTon', 1), linkedRai: sum('linkedRai', 2), ghg: sum('ghg', 4),
    atRiskRai: sum('atRiskRai', 2), atRiskTon: sum('atRiskTon', 1) };
  t.managedPct = t.harvestedRai ? round_(t.managedRai / t.harvestedRai * 100, 1) : null;
  t.linkedPct = t.managedRai ? round_(t.linkedRai / t.managedRai * 100, 1) : null;
  return t;
}

function balanceByDistrict_(rows, names, district) {
  return Object.keys(names).sort().filter(function (c) { return !district || c === district; }).map(function (c) {
    const list = rows.filter(function (r) { return r.district === c; });
    const t = balanceTotals_(list);
    const flags = {};
    list.forEach(function (r) { r.flags.forEach(function (f) { flags[f] = 1; }); });
    if (t.harvestedRai > 0 && t.managedPct !== null && t.managedPct < BALANCE_LOW_SHARE) flags.low_managed = 1;
    return Object.assign({ district: c, name: names[c] }, t, { flags: Object.keys(flags) });
  });
}

/** Admin API: Admin (district office) is limited to the district on the account. */
function residueBalanceServer_(input, s) {
  input = input || {};
  const district = residueScopeDistrict_(s, input.district);
  return Object.assign({ status: 'success' }, residueBalance_(Number(input.fy) || currentFiscalYear_(), district));
}

/** Public endpoint (aggregate only). */
function getResidueBalancePublic_(p) {
  const fy = Number(p && p.fy) || currentFiscalYear_();
  const b = residueBalance_(fy, '');
  return { ok: true, fy: b.fy, fyRange: b.fyRange, generatedAt: b.generatedAt, byDistrict: b.byDistrict, totals: b.totals, months: b.months,
    rows: b.rows.map(function (r) { return { district: r.district, crop: r.crop, cropName: r.cropName, harvestedRai: r.harvestedRai, potentialTon: r.potentialTon,
      removableTon: r.removableTon, listedRai: r.listedRai, buyers: r.buyers, managedRai: r.managedRai, managedTon: r.managedTon, atRiskRai: r.atRiskRai, flags: r.flags }; }),
    sources: b.sources, lowShare: b.lowShare };
}

/** Report section residue.balance. */
function residueBalanceSection_(R) {
  const b = residueBalance_(R.fy, R.district);
  const FLAG = { need_buyer: 'มีแปลงประกาศขาย แต่ยังไม่มีผู้รับซื้อในอำเภอ', low_managed: 'จัดการได้ต่ำกว่า ' + b.lowShare + '% ของพื้นที่เก็บเกี่ยว' };
  const rows = b.rows.map(function (r) {
    return { name: r.districtName, crop: r.cropName, harvested: r.harvestedRai, potential: r.potentialTon === null ? '' : r.potentialTon,
      removable: r.removableTon === null ? '' : r.removableTon, listed: r.listedRai, buyers: r.buyers, managed: r.managedRai,
      pct: r.managedPct === null ? '' : r.managedPct, risk: r.atRiskRai, note: r.flags.map(function (f) { return FLAG[f]; }).join('; ') };
  });
  const t = b.totals;
  return {
    subtitle: residueScopeText_(R),
    landscape: true,
    columns: [col_('name', 'อำเภอ'), col_('crop', 'พืช'), col_('harvested', '① เก็บเกี่ยว (ไร่)', 'number'), col_('potential', '① วัสดุเหลือใช้ทางการเกษตร (ตัน)', 'number'),
      col_('removable', '② นำออกได้ (ตัน)', 'number'), col_('listed', '③ ประกาศขาย (ไร่)', 'number'), col_('buyers', '④ ผู้รับซื้อ (ราย)', 'number'),
      col_('managed', '⑤ จัดการแล้ว (ไร่)', 'number'), col_('pct', '⑤ ÷ ① (%)', 'number'), col_('risk', '⑥ ยังไม่มีบันทึก (ไร่)', 'number'), col_('note', 'ข้อสังเกต')],
    rows: rows,
    totals: { name: 'รวม', harvested: t.harvestedRai, potential: t.potentialTon, removable: t.removableTon, listed: t.listedRai, buyers: t.buyers,
      managed: t.managedRai, pct: t.managedPct === null ? '' : t.managedPct, risk: t.atRiskRai },
    notes: [b.sources.note + (b.sources.registry.length ? ' (' + b.sources.registry.join(', ') + ')' : ' — ยังไม่มีข้อมูลนำเข้า'),
      '① วัสดุเหลือใช้ทางการเกษตร = พื้นที่เก็บเกี่ยว × อัตราวัสดุเหลือใช้ทางการเกษตรต่อไร่; ② = ① × สัดส่วนที่นำออกจากแปลงได้โดยไม่กระทบดิน (ไถกลบนับเป็นการจัดการด้วย)',
      '③ ④ จากตลาดวัสดุเหลือใช้ทางการเกษตร (แปลงสถานะพร้อมขายที่เก็บเกี่ยวในปีงบประมาณ และผู้รับซื้อที่เปิดรับซื้อ) ⑤ จากการบันทึกของเจ้าหน้าที่เท่านั้น ไม่นำยอดตลาดมาบวกซ้ำ',
      'จัดการแล้วที่ระบุผู้รับซื้อในระบบ ' + t.linkedRai + ' ไร่' + (t.linkedPct === null ? '' : ' (' + t.linkedPct + '% ของพื้นที่จัดการ)') + ', ขายหรือนำออกจริง ' + t.soldTon + ' ตัน']
  };
}
