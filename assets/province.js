/* Green Gain Hub 3.0.0 — the province the page is showing ("Green Gain Hub: จังหวัด …").
 *
 * Before sign-in: the province picked on the page (remembered on this device), else กำแพงเพชร.
 * After sign-in: the user's own province (chosen at registration) — set by index.html setupUI.
 * Everything that names the province listens here: the top bar, the market title, the sign-in popup, the footer.
 *
 * Boundaries (geo/provinces.json, geo/p/<code>.json) come from the QA-checked dataset "1. ขอบเขตพื้นที่รายจังหวัด"
 * (tools/geo/build.py); where() tells which province / district / subdistrict a point is in, the same way the server does.
 */
(function () {
  'use strict';
  const KEY = 'ggh_province';
  const DEFAULT = { code: '62', name: 'กำแพงเพชร' };
  const GEO = (window.GGH_CONFIG && window.GGH_CONFIG.GEO_BASE) || 'geo/';
  const V = (window.GGH_CONFIG && window.GGH_CONFIG.BUILD_VERSION) || '3';
  const listeners = [];
  const files = {};
  let current = DEFAULT;
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && /^\d{2}$/.test(s.code) && s.name) current = s; } catch (e) { /* private mode */ }

  function file(name) {
    if (!files[name]) files[name] = fetch(GEO + name + '?v=' + V).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch((err) => { delete files[name]; throw err; });
    return files[name];
  }
  const list = () => file('provinces.json').then((d) => d.provinces);
  const province = (code) => file('p/' + code + '.json');

  function paint() {
    document.querySelectorAll('[data-province]').forEach((el) => { el.textContent = current.name; });
    document.querySelectorAll('[data-province-seal]').forEach((el) => { el.hidden = el.dataset.provinceSeal !== current.code; });
    document.querySelectorAll('select[data-province-select]').forEach((sel) => { if (sel.value !== current.code && sel.querySelector(`option[value="${current.code}"]`)) sel.value = current.code; });
    document.title = 'Green Gain Hub: จังหวัด' + current.name;
  }

  /** set({code, name}) — save: remember on this device (the page picker), not for a signed-in user's own province */
  function set(p, opts) {
    if (!p || !/^\d{2}$/.test(String(p.code))) return;
    const next = { code: String(p.code), name: p.name || current.name };
    const changed = next.code !== current.code || next.name !== current.name;
    current = next;
    if (!opts || opts.save !== false) { try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (e) { /* ignore */ } }
    paint();
    if (changed) listeners.forEach((fn) => { try { fn(current); } catch (e) { console.warn(e); } });
  }

  /** fills a <select data-province-select> with the 77 provinces (Thai alphabetical) */
  function fillSelect(sel, opts) {
    return list().then((ps) => {
      const keep = sel.value;
      sel.innerHTML = (opts && opts.placeholder ? `<option value="">${opts.placeholder}</option>` : '') +
        ps.map((p) => `<option value="${p.code}">${p.name}</option>`).join('');
      sel.value = (opts && opts.value) || keep || (opts && opts.placeholder ? '' : current.code);
      return ps;
    });
  }

  /* point in polygon (same rule as the server, Code.gs pointInGeometry_) */
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inGeom(x, y, g) {
    if (!g) return false;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polys.some((rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h)));
  }
  const nearest = (lat, lng, xs) => xs.reduce((best, x) => {
    if (!x.center) return best;
    const d = (x.center[0] - lat) ** 2 + ((x.center[1] - lng) * Math.cos(lat * Math.PI / 180)) ** 2;
    return !best || d < best.d ? { d, x } : best;
  }, null)?.x || null;

  /** where(lat, lng) → Promise<{ provinceCode, province, districtCode, district, subdistrictCode, subdistrict } | null> */
  function where(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng)) return Promise.resolve(null);
    return file('provinces.json').then((idx) => {
      const boxed = idx.provinces.filter((p) => lng >= p.bbox[0] - 0.02 && lng <= p.bbox[2] + 0.02 && lat >= p.bbox[1] - 0.02 && lat <= p.bbox[3] + 0.02);
      if (!boxed.length) return null;
      const prov = boxed.find((p) => inGeom(lng, lat, p.geometry)) || nearest(lat, lng, boxed);
      return province(prov.code).then((P) => {
        const d = P.districts.find((x) => inGeom(lng, lat, x.geometry)) || nearest(lat, lng, P.districts);
        const s = P.subdistricts.filter((x) => !d || x.districtCode === d.code).find((x) => inGeom(lng, lat, x.geometry));
        return { provinceCode: prov.code, province: prov.name, districtCode: d ? d.code : '', district: d ? d.name : '', subdistrictCode: s ? s.code : '', subdistrict: s ? s.name : '' };
      });
    });
  }
  const label = (loc) => (loc ? [loc.subdistrict && 'ต.' + loc.subdistrict, loc.district && 'อ.' + loc.district, 'จ.' + loc.province].filter(Boolean).join(' ') : '');

  window.GGH_PROVINCE = {
    get code() { return current.code; }, get name() { return current.name; },
    set, list, province, fillSelect, where, label, paint,
    onChange(fn) { listeners.push(fn); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();
})();
