/* Green Gain Hub 1.6.0 — parser for the DOAE farmer-registry crop report (.xlsx/.csv).
 *
 * Input: array-of-arrays (SheetJS sheet_to_json(ws, {header: 1})).
 * Expected columns (header names, any order):
 *   NO | จังหวัด/อำเภอ/ตำบล | ปีเดือน/สัปดาห์(order) | ครัวเรือน | แปลง | เนื้อที่(ไร่)
 * Codes: 62-00 province, 62-01 district, 62-01-04 sub-district.
 * The server validates everything again; this parser only prepares a preview.
 */
(function (root) {
  'use strict';

  const COLS = {
    code: /^(no|รหัส)/i,
    name: /จังหวัด|อำเภอ|ตำบล|พื้นที่/,
    period: /ปีเดือน|เดือน|period/i,
    households: /ครัวเรือน|household/i,
    plots: /แปลง|plot/i,
    area: /เนื้อที่|ไร่|area/i
  };

  function clean(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    const n = Number(clean(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function findHeader(aoa) {
    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
      const cells = (aoa[i] || []).map(clean);
      const idx = {};
      Object.keys(COLS).forEach((k) => {
        // "แปลง" must not match the area column, so test exact-ish columns in a fixed order.
        idx[k] = cells.findIndex((c, j) => c && COLS[k].test(c) && !Object.values(idx).includes(j));
      });
      if (idx.code >= 0 && idx.period >= 0 && idx.area >= 0) return { row: i, idx };
    }
    return null;
  }

  function levelOf(code) {
    const parts = code.split('-');
    if (parts.length === 2) return parts[1] === '00' ? 'province' : 'district';
    return 'subdistrict';
  }

  /** Default crop year label: harvest months from May onward belong to that year's season (e.g. 2569/70). */
  function suggestSeason(periods) {
    if (!periods.length) return '';
    const first = Math.min(...periods);
    const y = Math.floor(first / 100), m = first % 100;
    const start = m >= 5 ? y : y - 1;
    return `${start + 543}/${String((start + 544) % 100).padStart(2, '0')}`;
  }

  function parse(aoa) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(aoa) || !aoa.length) return { ok: false, errors: ['ไฟล์ว่างหรืออ่านไม่ได้'], rows: [] };
    const header = findHeader(aoa);
    if (!header) {
      return { ok: false, rows: [], errors: ['ไม่พบหัวตาราง ต้องมีคอลัมน์ NO, ปีเดือน และเนื้อที่(ไร่) ตามรายงานทะเบียนเกษตรกร'] };
    }
    const title = clean((aoa.slice(0, header.row).find((r) => (r || []).some((c) => clean(c))) || []).find((c) => clean(c)));
    const { idx } = header;
    const rows = [];
    for (let i = header.row + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const code = clean(r[idx.code]);
      if (!code) continue;
      if (!/^\d{2}-\d{2}(-\d{2})?$/.test(code)) {
        if (/รวม|total/i.test(clean(r[idx.name]))) continue;
        warnings.push(`แถว ${i + 1}: ข้ามรหัส "${code}" ที่ไม่ใช่รหัสพื้นที่`);
        continue;
      }
      const period = clean(r[idx.period]).replace(/\D/g, '').slice(0, 6);
      const area = toNumber(r[idx.area]);
      if (!/^\d{6}$/.test(period)) { errors.push(`แถว ${i + 1}: ปีเดือนไม่ถูกต้อง`); continue; }
      if (!Number.isFinite(area) || area < 0) { errors.push(`แถว ${i + 1}: เนื้อที่ไม่ถูกต้อง`); continue; }
      rows.push({
        line: i + 1, code, level: levelOf(code), name: idx.name >= 0 ? clean(r[idx.name]) : '', period,
        households: idx.households >= 0 ? toNumber(r[idx.households]) || 0 : 0,
        plots: idx.plots >= 0 ? toNumber(r[idx.plots]) || 0 : 0,
        area: Math.round(area * 100) / 100
      });
    }
    if (!rows.length) errors.push('ไม่พบแถวข้อมูลพื้นที่');
    const provinces = [...new Set(rows.map((r) => r.code.slice(0, 2)))];
    if (provinces.length > 1) errors.push(`ไฟล์มีหลายจังหวัด (${provinces.join(', ')})`);

    const periods = [...new Set(rows.map((r) => Number(r.period)))].sort((a, b) => a - b);
    const byPeriod = periods.map((p) => {
      const ofP = rows.filter((r) => Number(r.period) === p);
      const prov = ofP.find((r) => r.level === 'province');
      const dist = ofP.filter((r) => r.level === 'district').reduce((s, r) => s + r.area, 0);
      return { period: String(p), areaRai: Math.round((prov ? prov.area : dist) * 100) / 100, districtSum: Math.round(dist * 100) / 100, hasProvince: !!prov };
    });
    byPeriod.forEach((p) => {
      if (p.hasProvince && Math.abs(p.areaRai - p.districtSum) > Math.max(1, p.areaRai * 0.001)) {
        errors.push(`เดือน ${p.period}: ผลรวมอำเภอ ${p.districtSum} ไม่ตรงกับยอดจังหวัด ${p.areaRai}`);
      }
    });
    const districts = new Set(rows.filter((r) => r.level === 'district').map((r) => r.code));
    const subdistricts = new Set(rows.filter((r) => r.level === 'subdistrict').map((r) => r.code));
    return {
      ok: !errors.length, errors, warnings, title, rows, periods, byPeriod,
      totalRai: Math.round(byPeriod.reduce((s, p) => s + p.areaRai, 0) * 100) / 100,
      districts: districts.size, subdistricts: subdistricts.size, provinceCode: provinces[0] || '',
      suggestedSeason: suggestSeason(periods)
    };
  }

  const api = { parse, suggestSeason, levelOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GGH_CROP_IMPORT = api;
})(typeof window !== 'undefined' ? window : this);
