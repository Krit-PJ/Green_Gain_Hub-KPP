/**
 * Green Gain Hub 2.6.0 — link to ABM (ระบบบริหารจัดการวัสดุเหลือใช้ทางการเกษตร), which took over the officer side on 19 Nov 2026.
 *
 *   - ABM owns the residue rates (ตัน/ไร่) per crop; the market map reads them from ABM's public residue endpoint
 *     (cached 6 hours, defaults below if ABM cannot be reached) so both systems show the same tonnes.
 *   - small helpers that used to live in the officer files and are still needed here.
 *
 * Script Property (optional): ABM_API_URL — ABM web app /exec.
 */
const ABM_API_DEFAULT = 'https://script.google.com/macros/s/AKfycby7nbXMQ3_WvA7y_Mp0DTE_wMX9eyiJQbfYBlpaQBOshpUyurOFgoM7MxWMN0wLvjkdqw/exec';
const ABM_SITE_URL = 'https://krit-pj.github.io/KPP-Agri-Byproduct-Management/';
const ABM_RATES_CACHE = 'abm:rates:v1';
const ABM_RATES_SECONDS = 21600;
// Same defaults as ABM's ghg_crops (สกว. อัตราชีวมวล ตัน/ไร่); cassava has none until ABM sets one with a reference.
const ABM_DEFAULT_RATES = { rice: 0.75, sugarcane: 0.23, maize: 0.83 };

function abmApiUrl_() { return String(PropertiesService.getScriptProperties().getProperty('ABM_API_URL') || ABM_API_DEFAULT).trim(); }

/** { rice: t/rai, ... } from ABM; never throws. */
function abmResidueRates_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(ABM_RATES_CACHE);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* refetch */ } }
  let rates = null;
  try {
    const res = UrlFetchApp.fetch(abmApiUrl_() + '?api=v1&endpoint=residue', { muteHttpExceptions: true, followRedirects: true });
    const body = JSON.parse(res.getContentText());
    if (body && body.ok && body.data && Array.isArray(body.data.crops)) {
      rates = {};
      body.data.crops.forEach(function (c) { if (c && c.key && c.residueTRai !== null && c.residueTRai !== '' && isFinite(Number(c.residueTRai))) rates[c.key] = Number(c.residueTRai); });
    }
  } catch (err) { rates = null; }
  const out = rates && Object.keys(rates).length ? rates : ABM_DEFAULT_RATES;
  try { cache.put(ABM_RATES_CACHE, JSON.stringify(out), rates ? ABM_RATES_SECONDS : 600); } catch (e) { /* best effort */ }
  return out;
}

/** Run from the editor (also part of setupSystem). */
function verifyAbmLink() {
  CacheService.getScriptCache().remove(ABM_RATES_CACHE);
  const r = abmResidueRates_();
  const hash = String(setting_(ABM_FEED_HASH_PARAM, '') || '');
  return (r === ABM_DEFAULT_RATES ? 'INFO: ABM residue rates unavailable, defaults used' : 'PASS: ABM residue rates ' + JSON.stringify(r)) +
    '\n' + (/^[0-9a-f]{64}$/.test(hash) ? 'PASS: ABM feed key registered' : 'INFO: ABM feed key not registered yet (run setupSystem in ABM)');
}

/* ------------------------------ helpers kept from the officer files ------------------------------ */

function cropGroupOf_(name) {
  name = String(name || '');
  if (name.indexOf('ข้าวโพด') === 0) return 'maize';
  if (name.indexOf('ข้าว') === 0) return 'rice';
  if (name.indexOf('อ้อย') >= 0) return 'sugarcane';
  if (name.indexOf('มันสำปะหลัง') >= 0) return 'cassava';
  return 'other';
}

function materialGroupOf_(material) {
  const m = String(material || '');
  if (m.indexOf('ฟาง') >= 0 && m.indexOf('สาลี') < 0) return 'rice';
  if (m.indexOf('อ้อย') >= 0) return 'sugarcane';
  if (m.indexOf('ข้าวโพด') >= 0 || m.indexOf('ซัง') >= 0) return 'maize';
  if (m.indexOf('มันสำปะหลัง') >= 0) return 'cassava';
  return 'other';
}

function provinceName_() {
  const v = setting_('province_name', '');
  return v ? text_(v) : 'กำแพงเพชร';
}

function ensureSheet_(name, headers) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (sh.setFrozenRows) sh.setFrozenRows(1);
    return sh;
  }
  const have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  headers.forEach(function (h, i) {
    if (have[i] && have[i] !== h) throw new Error(name + ': expected ' + h + ' in column ' + (i + 1) + ' but found ' + have[i]);
    if (!have[i]) sh.getRange(1, i + 1).setValue(h);
  });
  return sh;
}

function sheetByName_(name) {
  const sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต ' + name + ' กรุณา Run setupSystem()');
  return sh;
}
