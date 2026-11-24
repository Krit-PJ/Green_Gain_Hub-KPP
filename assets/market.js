/* Green Gain Hub 3.0.0 (since 2.5.0) — front page for farmers and buyers (ตลาดวัสดุเหลือใช้ทางการเกษตร).
 *
 * 3.0.0: every province. The market shows one province (GGH_PROVINCE, province.js) — picked on the page, or the user's
 *   own after sign-in. On top: area / sellers / estimated biomass. The "ทุกวัสดุ" card is gone (tap a material again to
 *   see all). The district table lists every district of the province (area, sellers, biomass, buyers) from byDistrict.
 *   District outlines come from geo/p/<code>.json (same boundary files as the server).
 *
 * ?api=v1&endpoint=market gives grid cells (~5.5 km) with residue offered (sell) and bought (buy) per material.
 * Public = aggregate only: cell centres, counts, area, price range — no names, phones or real coordinates.
 * Exact pins and phone numbers are in the signed-in market (unchanged), reached through the two doors.
 *
 * 2.6.0: the results page and officer sign-in moved to ABM (ระบบบริหารจัดการวัสดุเหลือใช้ทางการเกษตร).
 *   Old links #performance #overview #crops #market #staff #staff-register open ABM (same view).
 * 2.7.0: the page shows only market data (no officer numbers or links). On top: three key numbers.
 *   Materials are summary cards (offered tonnes, buyers and their capacity, harvest timing, price as given by buyers,
 *   a status) that still filter the map. Under the map: all 11 districts; a row filters the map.
 * 2.8.0: the server leaves out plots more than N days after harvest; the note under the map says so.
 */
(function () {
  'use strict';

  const cfg = window.GGH_CONFIG || {};
  const API_BASE = cfg.SUMMARY_API_URL || cfg.SHEETS_API_URL || '';
  const API_KEY = cfg.SUMMARY_API_KEY || '';
  const TIMEOUT = Number(cfg.REQUEST_TIMEOUT_MS) || 30000;
  const CACHE_KEY = 'ggh_market_v3:';   // + province code
  const PROV = window.GGH_PROVINCE;
  const ABM_URL = cfg.ABM_URL || 'https://krit-pj.github.io/KPP-Agri-Byproduct-Management/';
  // old links to the results page / officer sign-in → the same place in ABM
  const MOVED = { performance: '', overview: '', crops: '#crops', market: '#market', staff: '#staff', 'staff-register': '#staff-register' };
  const NEAR_KM = 40;   // "ผู้รับซื้อใกล้สุด" is searched within this distance

  /* the same material drawings as the results page (dashboard.js) */
  const ICON = {
    rice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22V9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 9c0-3 1.6-5.4 4.5-6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><ellipse cx="16.2" cy="6.3" rx="1.3" ry="2" transform="rotate(35 16.2 6.3)"/><ellipse cx="13.6" cy="9" rx="1.3" ry="2" transform="rotate(40 13.6 9)"/><ellipse cx="17.8" cy="9.6" rx="1.3" ry="2" transform="rotate(60 17.8 9.6)"/><ellipse cx="15" cy="12.4" rx="1.3" ry="2" transform="rotate(55 15 12.4)"/><path d="M12 17c-2.5-.6-4.6-2.4-5.5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    sugarcane: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9.5" y="5" width="4" height="17" rx="1.6"/><path d="M9.5 10h4M9.5 15h4" stroke="#fff" stroke-width="1.2"/><path d="M11.5 6C10 3.6 7.4 2.6 4.5 3c1.6 2.3 4 3.6 7 3.4zM11.5 6c1.8-2.5 4.6-3.6 8-3.2-1.6 2.6-4.5 4-8 3.6z"/></svg>',
    maize: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="10" rx="3.6" ry="7.5"/><path d="M10 6.5h4M9.2 9.5h5.6M9.2 12.5h5.6M10 15.5h4" stroke="#fff" stroke-width="1"/><path d="M12 22c-2-1.5-5.5-3-7-8 2.6.6 5 2.4 6.2 5M12 22c2-1.5 5.5-3 7-8-2.6.6-5 2.4-6.2 5"/></svg>',
    cassava: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3v6M13 3.5v5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 9c-2 3.5-3.3 7.5-4.6 12 2.6-1.8 4.3-5.6 4.6-10.4zM12 9c1.6 3.7 3.6 7 6.3 10.6-2.9-.5-5.1-4.4-6.3-8.8zM12 9.5c.3 4 .1 8.2-.6 12.5 1.7-2.7 2.2-6.7.6-12.5z"/></svg>',
    other: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19C5 10 10 4.5 20 4c0 9.5-5.6 15-15 15z"/><path d="M5 19l8-8" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>'
  };
  const icon = (g) => ICON[g] || ICON.other;
  /** 3.1.0: crop / material → rice | sugarcane | maize | cassava | other (same rule as the server, Abm.gs) */
  function groupOf(crop, material) {
    const c = String(crop || ''), m = String(material || '');
    if (c.indexOf('ข้าวโพด') === 0) return 'maize';
    if (c.indexOf('ข้าว') === 0) return 'rice';
    if (c.indexOf('อ้อย') >= 0) return 'sugarcane';
    if (c.indexOf('มันสำปะหลัง') >= 0) return 'cassava';
    if (m.indexOf('ฟาง') >= 0 && m.indexOf('สาลี') < 0) return 'rice';
    if (m.indexOf('อ้อย') >= 0) return 'sugarcane';
    if (m.indexOf('ข้าวโพด') >= 0 || m.indexOf('ซัง') >= 0) return 'maize';
    if (m.indexOf('มันสำปะหลัง') >= 0) return 'cassava';
    return 'other';
  }

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const fmt = (n, d) => (n === null || n === undefined || !isFinite(n) ? '–' : new Intl.NumberFormat('th-TH', { maximumFractionDigits: d ?? 0 }).format(n));
  const thDate = (iso) => { const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }); };

  const state = { province: PROV ? PROV.code : '62', data: null, geo: null, mat: 'all', side: 'all', district: '', view: 'map', me: null, map: null, layer: null, outline: null, markers: {} };

  /* ---------------- routing between the market page and the results page ---------------- */
  function loggedIn() { const app = $('mainApp'); return app && !app.classList.contains('hidden'); }
  function route() {
    if (loggedIn()) return;
    const h = decodeURIComponent((location.hash || '').replace('#', ''));
    if (Object.prototype.hasOwnProperty.call(MOVED, h)) { location.replace(ABM_URL + MOVED[h]); return; }
    $('marketPage').classList.remove('hidden');
    document.body.classList.add('ggh-landing-on');
    if (state.map) setTimeout(() => state.map.invalidateSize(), 50);
    window.scrollTo(0, 0);
  }

  /* ---------------- data ---------------- */
  function apiUrl(params) { if (API_KEY) params.key = API_KEY; return API_BASE + (API_BASE.includes('?') ? '&' : '?') + new URLSearchParams(params).toString(); }
  function getJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    return fetch(url, { signal: ctrl.signal, redirect: 'follow' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(timer));
  }
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = '__ggh_mk_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const timer = setTimeout(() => { done(); reject(new Error('API timeout')); }, TIMEOUT);
      function done() { clearTimeout(timer); delete window[cb]; s.remove(); }
      window[cb] = (payload) => { done(); resolve(payload); };
      s.src = url + '&callback=' + cb;
      s.onerror = () => { done(); reject(new Error('เชื่อมต่อ API ไม่สำเร็จ')); };
      document.head.appendChild(s);
    });
  }
  const call = (params) => { const u = apiUrl(params); return getJson(u).catch(() => jsonp(u)); };

  function load() {
    const code = state.province;
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY + code) || 'null'); if (c && c.data && c.data.provinceCode === code) { state.data = c.data; render(); } } catch (e) { /* ignore */ }
    if (!API_BASE) { stats('ยังไม่ได้ตั้งค่า API ใน assets/config.js', true); return; }
    call({ api: 'v1', endpoint: 'market', province: code }).then((p) => {
      if (!p || !p.ok || !p.data || !p.data.ok) throw new Error((p && p.error) || 'ระบบยังไม่รองรับแผนที่ตลาด');
      if (code !== state.province) return;   // the province changed while loading
      state.data = p.data; render(); save(); renderProvincePicker();
    }).catch((err) => {
      console.warn('[GGH market]', err);
      if (!state.data) { stats('โหลดข้อมูลตลาดไม่สำเร็จ ', true, true); renderList(); }
    });
  }
  function save() { try { localStorage.setItem(CACHE_KEY + state.province, JSON.stringify({ data: state.data })); } catch (e) { /* ignore */ } }

  /* ---------------- 3.0.0 province: outlines, picker, switching ---------------- */
  function loadGeo() {
    if (!PROV) return;
    const code = state.province;
    PROV.province(code).then((P) => {
      if (code !== state.province) return;
      state.geo = { type: 'FeatureCollection', features: P.districts.map((d) => ({ type: 'Feature', properties: { code: d.code, name: d.name }, geometry: d.geometry })) };
      if (state.outline && state.map) { state.map.removeLayer(state.outline); state.outline = null; }
      renderDistricts(true); renderMap(); renderDistTable();
    }).catch(() => { /* outlines are optional */ });
  }
  /** provinces with plots or buyers first (with counts), then all 77 */
  function renderProvincePicker() {
    const sel = $('mkProvince'); if (!sel || !PROV) return;
    PROV.list().then((ps) => {
      const act = {}; ((state.data && state.data.provinces) || []).forEach((x) => { if (x.plots || x.buyers) act[x.code] = x; });
      const opt = (p) => `<option value="${p.code}">${esc(p.name)}${act[p.code] ? ` (${fmt(act[p.code].plots)} แปลง · ${fmt(act[p.code].buyers)} ผู้รับซื้อ)` : ''}</option>`;
      const active = ps.filter((p) => act[p.code]);
      sel.innerHTML = (active.length ? `<optgroup label="จังหวัดที่มีประกาศ">${active.map(opt).join('')}</optgroup>` : '') +
        `<optgroup label="ทุกจังหวัด">${ps.filter((p) => !act[p.code]).map(opt).join('')}</optgroup>`;
      sel.value = state.province;
    }).catch(() => { /* keep the single option */ });
  }
  function switchProvince(p) {
    if (!p || p.code === state.province) return;
    state.province = p.code; state.data = null; state.mat = 'all'; state.district = ''; state.me = null; state.geo = null;
    if (state.outline && state.map) { state.map.removeLayer(state.outline); state.outline = null; }
    const sel = $('mkDistrict'); if (sel) { sel.innerHTML = '<option value="">ทุกอำเภอ</option>'; sel.value = ''; }
    stats('กำลังโหลดข้อมูลตลาด…'); render(); loadGeo(); load();
    if (state.map && PROV) PROV.list().then((ps) => { const x = ps.find((q) => q.code === p.code); if (x && !state.outline) state.map.fitBounds([[x.bbox[1], x.bbox[0]], [x.bbox[3], x.bbox[2]]], { padding: [8, 8] }); }).catch(() => {});
  }

  /* ---------------- helpers on cells ---------------- */
  const groups = () => (state.data ? state.data.groups : []);
  const label = (g) => { const x = groups().find((y) => y.key === g); return x ? x.label : 'วัสดุ'; };
  const wantMat = (g) => state.mat === 'all' || state.mat === g;
  const inDistrict = (c) => !state.district || c.district === state.district;
  function km(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const kmText = (d) => (d < 1 ? 'ไม่ถึง 1 กม.' : '~' + fmt(d, d < 10 ? 1 : 0) + ' กม.');
  /** nearest cell on the other side that trades the same material */
  function nearest(cell, g, side) {
    let best = null;
    (state.data ? state.data.cells : []).forEach((c) => {
      if (c === cell || !c[side][g]) return;
      const d = km(cell, c);
      if (d <= NEAR_KM && (!best || d < best.d)) best = { d, c };
    });
    if (cell[side][g]) best = { d: 0, c: cell };
    return best;
  }

  /** flat list of items (one per cell × side × material) after the filters */
  function items() {
    const out = [];
    (state.data ? state.data.cells : []).forEach((c) => {
      if (!inDistrict(c)) return;
      ['buy', 'sell'].forEach((side) => {
        if (state.side !== 'all' && state.side !== side) return;
        Object.keys(c[side]).forEach((g) => { if (wantMat(g)) out.push({ c, side, g, v: c[side][g], dist: state.me ? km(state.me, c) : null }); });
      });
    });
    out.sort((a, b) => (a.dist !== null && b.dist !== null ? a.dist - b.dist : 0) || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1) ||
      ((b.v.areaRai || b.v.capacityTonPerDay || 0) - (a.v.areaRai || a.v.capacityTonPerDay || 0)));
    return out;
  }

  /* ---------------- text for one item (list card and map popup) ---------------- */
  function priceText(v) {
    if (v.priceMin === null || v.priceMin === undefined) return 'ราคาตกลงกัน';
    return (v.priceMin === v.priceMax ? fmt(v.priceMin) : fmt(v.priceMin) + '–' + fmt(v.priceMax)) + ' บาท/ไร่';
  }
  function itemHtml(it, inPopup) {
    const { c, side, g, v } = it;
    const where = c.districtName ? 'อ.' + esc(c.districtName) : 'นอกเขตอำเภอ';
    const dist = it.dist !== null && it.dist !== undefined ? ' · ห่างจากคุณ ' + kmText(it.dist) : '';
    let head, facts, match, door;
    if (side === 'buy') {
      head = `รับซื้อ${esc(label(g))} ${fmt(v.buyers)} ราย`;
      facts = [priceText(v), v.capacityTonPerDay ? 'รับรวม ' + fmt(v.capacityTonPerDay, 1) + ' ตัน/วัน' : '', v.afterHarvestDays !== null && v.afterHarvestDays !== undefined ? 'รับหลังเก็บเกี่ยว ' + fmt(v.afterHarvestDays) + ' วัน' : '']
        .filter(Boolean).join(' · ');
      const n = nearest(c, g, 'sell');
      match = n ? `มี${esc(label(g))}พร้อมขาย${n.d ? ' ห่าง ' + kmText(n.d) : 'ในพื้นที่นี้'} (${fmt(n.c.sell[g].areaRai, 1)} ไร่)` : '';
      door = `<button type="button" class="ggh-mk-cta is-sell" data-door="login" data-role="farmer">ดูเบอร์และตำแหน่ง (ผู้ขาย)</button>`;
    } else {
      head = `${esc(label(g))} ${fmt(v.plots)} แปลง · ${fmt(v.areaRai, 1)} ไร่`;
      facts = [v.ton !== null && v.ton !== undefined ? 'ประมาณ ' + fmt(v.ton, 1) + ' ตัน' : '', v.readyPlots ? 'พร้อมขาย ' + fmt(v.readyPlots) + ' แปลง' : '',
        v.nextHarvest ? 'แปลงถัดไปเก็บเกี่ยว ' + thDate(v.nextHarvest) : ''].filter(Boolean).join(' · ');
      const n = nearest(c, g, 'buy');
      match = n ? `ผู้รับซื้อ${esc(label(g))}${n.d ? 'ใกล้สุด ' + kmText(n.d) : 'ในพื้นที่นี้'} · ${priceText(n.c.buy[g])}` : `ยังไม่มีผู้รับซื้อ${esc(label(g))}ในรัศมี ${NEAR_KM} กม.`;
      door = `<button type="button" class="ggh-mk-cta is-buy" data-door="login" data-role="buyer">ดูแปลงและติดต่อ (ผู้รับซื้อ)</button>`;
    }
    const hasMatch = side === 'buy' ? !!nearest(c, g, 'sell') : !!nearest(c, g, 'buy');
    return `<div class="ggh-mk-item-top"><span class="ggh-mk-badge is-${side}" title="${side === 'buy' ? 'จุดรับซื้อ' : 'วัสดุพร้อมขาย'}">${side === 'buy' ? '<i class="fa-solid fa-truck" aria-hidden="true"></i>' : ''}<span class="ggh-mk-ico">${icon(g)}</span></span>
      <div><b class="ggh-mk-item-head">${head}</b><span class="ggh-mk-item-where">${where}${dist}</span></div></div>
      ${facts ? `<p class="ggh-mk-item-facts">${facts}</p>` : ''}
      ${match ? `<p class="ggh-mk-item-match${hasMatch ? ' is-ok' : ''}">${match}</p>` : ''}
      ${door}${inPopup ? '' : ''}`;
  }

  /* ---------------- render ---------------- */
  function stats(text, isError, retry) {
    const el = $('mkStats'); if (!el) return;
    el.classList.toggle('is-error', !!isError);
    el.textContent = text;
    if (retry) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ggh-retry'; b.textContent = 'ลองใหม่'; b.addEventListener('click', load); el.appendChild(b); }
  }
  /** the province's districts: from the API (2.7.0), else the boundary file, else the cells */
  function districtNames() {
    const names = {};
    if (state.data && state.data.districts && state.data.districts.length) state.data.districts.forEach((d) => { names[d.code] = d.districtName; });
    else if (state.geo) state.geo.features.forEach((f) => { names[f.properties.code] = f.properties.name; });
    else if (state.data) state.data.cells.forEach((c) => { if (c.district) names[c.district] = c.districtName; });
    return names;
  }
  /** per district, for the chosen material: area, sellers, biomass, buyers (3.0.0 byDistrict; cells for older answers) */
  function districtRows(mat) {
    const all = !mat || mat === 'all';
    const names = districtNames();
    const rows = {};
    Object.keys(names).forEach((k) => { rows[k] = { code: k, title: names[k], plots: 0, farmers: 0, rai: 0, ton: 0, buyers: 0, cap: 0 }; });
    if (state.data && state.data.byDistrict) {
      state.data.byDistrict.forEach((d) => {
        const r = rows[d.code] || (rows[d.code] = { code: d.code, title: d.name, plots: 0, farmers: 0, rai: 0, ton: 0, buyers: 0, cap: 0 });
        const s = all ? d : (d.sell[mat] || {}), b = all ? d : (d.buy[mat] || {});
        r.plots = s.plots || 0; r.farmers = s.farmers || 0; r.rai = s.areaRai || 0; r.ton = s.ton || 0; r.buyers = b.buyers || 0; r.cap = b.capacityTonPerDay || 0;
      });
      return Object.values(rows);
    }
    (state.data ? state.data.cells : []).forEach((c) => {
      if (!c.district) return;
      const r = rows[c.district] || (rows[c.district] = { code: c.district, title: c.districtName, plots: 0, farmers: 0, rai: 0, ton: 0, buyers: 0, cap: 0 });
      Object.keys(c.sell).forEach((g) => { if (!all && mat !== g) return; const v = c.sell[g]; r.plots += v.plots; r.farmers += v.plots; r.rai += v.areaRai || 0; r.ton += v.ton || 0; });
      Object.keys(c.buy).forEach((g) => { if (!all && mat !== g) return; const v = c.buy[g]; r.buyers += v.buyers; r.cap += v.capacityTonPerDay || 0; });
    });
    return Object.values(rows);
  }
  const STATUS = {   // short = phones
    both: { cls: 'is-ok', text: 'มีทั้งผู้ขายและผู้รับซื้อ', short: 'มีคู่ค้า' },
    sellOnly: { cls: 'is-warn', text: 'มีวัสดุ ยังไม่มีผู้รับซื้อ', short: 'ไม่มีผู้ซื้อ' },
    buyOnly: { cls: 'is-buy', text: 'ผู้รับซื้อรอวัสดุ', short: 'รอวัสดุ' },
    none: { cls: 'is-none', text: 'ยังไม่มีประกาศ', short: '–' }
  };
  const statusOf = (sell, buy) => STATUS[sell && buy ? 'both' : sell ? 'sellOnly' : buy ? 'buyOnly' : 'none'];

  /** 3.0.0: พื้นที่รวม · จำนวนราย · ประมาณการชีวมวล — of the province on show */
  function renderStats() {
    const d = state.data; if (!d) return;
    const t = d.totals;
    const tile = (cls, ico, value, unit, name, sub) => `<div class="ggh-mk-key-tile ${cls}"><i class="fa-solid ${ico}" aria-hidden="true"></i>
      <p class="ggh-mk-key-num"><b>${value}</b> ${unit}</p><p class="ggh-mk-key-name">${name}</p><p class="ggh-mk-key-sub">${sub}</p></div>`;
    const el = $('mkStats'); el.classList.remove('is-error');
    el.innerHTML =
      tile('is-area', 'fa-map-location-dot', fmt(t.areaRai, 0), 'ไร่', 'พื้นที่รวม', `${fmt(t.plots)} แปลงประกาศขาย`) +
      tile('is-sell', 'fa-people-group', fmt(t.farmers ?? t.plots), 'ราย', 'จำนวนเกษตรกรผู้ขาย', t.buyers ? `ผู้รับซื้อ ${fmt(t.buyers)} ราย` : 'ยังไม่มีผู้รับซื้อ') +
      tile('is-mass', 'fa-wheat-awn', t.ton ? fmt(t.ton, 0) : '–', 'ตัน', 'ประมาณการชีวมวล', 'จากพื้นที่ × อัตราวัสดุต่อไร่');
  }

  function priceLine(b) {
    if (!b.buyers) return '';
    if (b.priceMin === null || b.priceMin === undefined) return '<p class="ggh-mk-mat-price">ราคาตกลงกัน</p>';
    const v = b.priceMin === b.priceMax ? fmt(b.priceMin) : fmt(b.priceMin) + '–' + fmt(b.priceMax);
    return `<p class="ggh-mk-mat-price">ราคา ${v} บาท/ไร่ <span>ตามที่ผู้รับซื้อระบุ</span></p>`;
  }
  /** when the offered residue is available: a bar by area, and the plots in each bucket */
  function timingHtml(sell) {
    const tm = sell.timing; if (!tm || !sell.plots) return '';
    const parts = [['now', 'ตอนนี้'], ['d30', 'ใน 30 วัน'], ['d90', '31–90 วัน']];
    if (tm.later && tm.later.plots) parts.push(['later', 'หลัง 90 วัน']);
    const sum = parts.reduce((a, [k]) => a + (tm[k].areaRai || 0), 0) || 1;
    const bar = parts.filter(([k]) => tm[k].areaRai > 0).map(([k, n]) => `<span class="is-${k}" style="width:${(100 * tm[k].areaRai / sum).toFixed(1)}%" title="${n}: ${fmt(tm[k].plots)} แปลง · ${fmt(tm[k].areaRai, 1)} ไร่"></span>`).join('');
    const text = parts.map(([k, n]) => `<span class="${tm[k].plots ? '' : 'is-zero'}"><i class="is-${k}" aria-hidden="true"></i>${n} <b>${fmt(tm[k].plots)}</b></span>`).join('');
    return `<div class="ggh-mk-timing"><span class="ggh-mk-mat-k">พร้อมขายเมื่อไร (แปลง)</span><div class="ggh-mk-timing-bar">${bar}</div><p class="ggh-mk-timing-keys">${text}</p></div>`;
  }
  function renderMats() {
    const box = $('mkMats'); if (!box || !state.data) return;
    const card = (g) => {
      const s = g.sell, b = g.buy, st = statusOf(s.plots, b.buyers);
      const badge = b.buyers ? { cls: 'is-ok', text: 'มีผู้รับซื้อรอ — ประกาศขายได้เลย' } : s.plots ? { cls: 'is-warn', text: 'มีวัสดุแต่ยังไม่มีผู้รับซื้อ' } : { cls: 'is-none', text: 'ยังไม่มีประกาศ' };
      const sellBig = s.plots ? (s.ton ? `~${fmt(s.ton, 0)} <small>ตัน</small>` : `${fmt(s.areaRai, 0)} <small>ไร่</small>`) : '–';
      const sellSub = s.plots ? `${fmt(s.plots)} แปลง${s.ton ? ' · ' + fmt(s.areaRai, 0) + ' ไร่' : ''}` : 'ยังไม่มีแปลง';
      const buyBig = b.buyers ? `${fmt(b.buyers)} <small>ราย</small>` : '–';
      const buySub = b.buyers ? (b.capacityTonPerDay ? `รับได้ ${fmt(b.capacityTonPerDay, 0)} ตัน/วัน` : 'ไม่ระบุปริมาณ') : 'ยังไม่มีผู้รับซื้อ';
      return `<button type="button" class="ggh-mk-mat ${st.cls}${!s.plots && !b.buyers ? ' is-empty' : ''}" data-mat="${g.key}" aria-pressed="${state.mat === g.key}">
        <span class="ggh-mk-mat-head"><span class="ggh-mk-ico">${icon(g.key)}</span><span class="ggh-mk-mat-name">${esc(g.label)}</span></span>
        <span class="ggh-mk-mat-badge ${badge.cls}">${badge.text}</span>
        <span class="ggh-mk-mat-sides">
          <span class="is-sell"><span class="ggh-mk-mat-k">ประกาศขาย</span><span class="ggh-mk-mat-v">${sellBig}</span><span class="ggh-mk-mat-s">${sellSub}</span></span>
          <span class="is-buy"><span class="ggh-mk-mat-k"><i class="fa-solid fa-truck" aria-hidden="true"></i> ผู้รับซื้อ</span><span class="ggh-mk-mat-v">${buyBig}</span><span class="ggh-mk-mat-s">${buySub}</span></span>
        </span>
        ${timingHtml(s)}${priceLine(b)}
      </button>`;
    };
    box.innerHTML = groups().map(card).join('');
    const all = $('mkAllMats'); if (all) all.hidden = state.mat === 'all';
  }
  function renderDistTable() {
    const box = $('mkDistTable'); if (!box || !state.data) return;
    const rows = districtRows(state.mat).sort((a, b) => ((b.plots || b.buyers ? 1 : 0) - (a.plots || a.buyers ? 1 : 0)) || (b.rai - a.rai) || (b.buyers - a.buyers) || a.title.localeCompare(b.title, 'th'));
    const what = state.mat === 'all' ? 'ทุกวัสดุ' : label(state.mat);
    const hint = $('mkDistHint'); if (hint) hint.textContent = `${what} · แตะชื่ออำเภอเพื่อดูบนแผนที่`;
    const num = (v, d) => (v ? fmt(v, d) : '<span class="is-zero">–</span>');
    const sum = rows.reduce((a, r) => ({ rai: a.rai + r.rai, farmers: a.farmers + r.farmers, ton: a.ton + r.ton, buyers: a.buyers + r.buyers }), { rai: 0, farmers: 0, ton: 0, buyers: 0 });
    // a farmer with plots in two districts counts once in the province total (same number as the tile on top)
    const g = state.mat === 'all' ? null : groups().find((x) => x.key === state.mat);
    const distinct = g ? g.sell.farmers : state.data.totals.farmers;
    if (distinct !== undefined && distinct !== null) sum.farmers = distinct;
    box.innerHTML = `<table class="ggh-mk-dist-table"><thead><tr><th scope="col">อำเภอ</th><th scope="col" class="is-num">พื้นที่รวม<small>ไร่</small></th><th scope="col" class="is-num">จำนวน<small>ราย</small></th><th scope="col" class="is-num">ชีวมวล<small>ตัน (ประมาณ)</small></th><th scope="col" class="is-num">ผู้รับซื้อ<small>ราย</small></th></tr></thead><tbody>` +
      rows.map((r) => `<tr class="${state.district === r.code ? 'is-on' : ''}${r.plots || r.buyers ? '' : ' is-quiet'}"><th scope="row"><button type="button" data-district="${esc(r.code)}" aria-pressed="${state.district === r.code}">${esc(r.title)}</button></th>
          <td class="is-num">${num(r.rai, 0)}</td><td class="is-num">${num(r.farmers)}</td><td class="is-num">${num(r.ton, 0)}</td><td class="is-num">${num(r.buyers)}</td></tr>`).join('') +
      `</tbody><tfoot><tr><th scope="row">รวม</th><td class="is-num">${fmt(sum.rai, 0)}</td><td class="is-num">${fmt(sum.farmers)}</td><td class="is-num">${fmt(sum.ton, 0)}</td><td class="is-num">${fmt(sum.buyers)}</td></tr></tfoot></table>`;
  }
  function renderDistricts(force) {
    const sel = $('mkDistrict'); if (!sel) return;
    if (force) { sel.innerHTML = '<option value="">ทุกอำเภอ</option>'; }
    if (sel.options.length > 1) return;
    const names = districtNames();
    Object.keys(names).sort((a, b) => names[a].localeCompare(names[b], 'th')).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = names[k]; sel.appendChild(o); });
  }
  function renderList() {
    const box = $('mkList'); if (!box) return;
    if (!state.data) { box.innerHTML = '<p class="ggh-mk-empty">กำลังโหลด…</p>'; return; }
    const list = items();
    const what = state.side === 'buy' ? 'จุดรับซื้อ' : state.side === 'sell' ? 'วัสดุพร้อมขาย' : 'จุดรับซื้อและวัสดุพร้อมขาย';
    const head = `<p class="ggh-mk-list-head">${state.me ? 'เรียงจากใกล้คุณที่สุด' : what} · ${fmt(list.length)} รายการ</p>`;
    if (!list.length) {
      box.innerHTML = head + `<div class="ggh-mk-empty"><p>ยังไม่มี${what}${state.mat !== 'all' ? 'ของ' + esc(label(state.mat)) : ''}${state.district ? 'ในอำเภอนี้' : ''}</p>
        <p>เป็นคนแรกในพื้นที่: <button type="button" class="ggh-mk-link" data-door="login" data-role="farmer">ประกาศขายวัสดุ</button> หรือ <button type="button" class="ggh-mk-link" data-door="login" data-role="buyer">ปักจุดรับซื้อ</button></p></div>`;
      return;
    }
    box.innerHTML = head + '<ul class="ggh-mk-items">' + list.slice(0, 60).map((it, i) => `<li class="ggh-mk-item is-${it.side}" data-i="${i}" data-cell="${esc(it.c.id)}" tabindex="0">${itemHtml(it)}</li>`).join('') + '</ul>';
    box._items = list;
  }
  function pinHtml(side, g, count, multi) {
    return `<span class="ggh-mk-pin is-${side}${multi ? ' is-multi' : ''}">${side === 'buy' ? '<i class="fa-solid fa-truck" aria-hidden="true"></i>' : ''}<span class="ggh-mk-ico">${icon(g)}</span>${count > 1 ? `<b>${count}</b>` : ''}</span>`;
  }
  function ensureMap() {
    if (state.map || !window.L || !$('mkMap')) return state.map;
    state.map = L.map('mkMap', { scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 13, className: 'ggh-basemap',
      attribution: '&copy; OpenStreetMap contributors · ขอบเขตการปกครอง: ชุดข้อมูล Thailand Agri-Risk Map'
    }).addTo(state.map);
    state.map.setView([16.3, 99.6], 9);
    if (PROV) PROV.list().then((ps) => { const x = ps.find((q) => q.code === state.province); if (x && !state.outline) state.map.fitBounds([[x.bbox[1], x.bbox[0]], [x.bbox[3], x.bbox[2]]], { padding: [8, 8] }); }).catch(() => {});
    return state.map;
  }
  function renderMap() {
    const map = ensureMap(); if (!map) return;
    if (state.geo && !state.outline) {
      state.outline = L.geoJSON(state.geo, { interactive: false, style: { color: '#7d9a86', weight: 1.2, fillColor: '#ffffff', fillOpacity: 0.25 } }).addTo(map);
      map.fitBounds(state.outline.getBounds(), { padding: [8, 8] });
    }
    if (state.layer) map.removeLayer(state.layer);
    state.layer = L.layerGroup().addTo(map);
    if (!state.data) return;
    const shown = [];
    state.data.cells.forEach((c) => {
      if (!inDistrict(c)) return;
      ['buy', 'sell'].forEach((side) => {
        if (state.side !== 'all' && state.side !== side) return;
        const gs = Object.keys(c[side]).filter(wantMat);
        if (!gs.length) return;
        const main = gs.slice().sort((a, b) => (c[side][b].areaRai || c[side][b].buyers || 0) - (c[side][a].areaRai || c[side][a].buyers || 0))[0];
        const count = gs.reduce((s, g) => s + (side === 'buy' ? c[side][g].buyers : c[side][g].plots), 0);
        const both = state.side === 'all' && Object.keys(c[side === 'buy' ? 'sell' : 'buy']).some(wantMat);
        const icn = L.divIcon({ className: 'ggh-mk-divicon', html: pinHtml(side, main, count, gs.length > 1), iconSize: [44, 44], iconAnchor: both ? (side === 'buy' ? [40, 22] : [4, 22]) : [22, 22] });
        const m = L.marker([c.lat, c.lng], { icon: icn, keyboard: true, title: (side === 'buy' ? 'จุดรับซื้อ ' : 'วัสดุพร้อมขาย ') + gs.map(label).join(', ') });
        const html = gs.map((g) => `<div class="ggh-mk-pop is-${side}">${itemHtml({ c, side, g, v: c[side][g], dist: state.me ? km(state.me, c) : null }, true)}</div>`).join('');
        m.bindPopup(html, { maxWidth: 300, className: 'ggh-mk-popup' });
        m.addTo(state.layer);
        state.markers[c.id + ':' + side] = m;
        shown.push([c.lat, c.lng]);
      });
    });
    if (state.me) L.circleMarker([state.me.lat, state.me.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('ตำแหน่งของคุณ').addTo(state.layer);
    if (state.district && shown.length) map.fitBounds(shown, { padding: [40, 40], maxZoom: 11 });
  }
  function render() {
    renderStats(); renderMats(); renderDistricts(); renderList(); renderMap(); renderDistTable();
    document.querySelectorAll('[data-hide-days]').forEach((el) => {   // 2.9.0: how-to says how long a plot stays listed
      const n = state.data && state.data.listing && state.data.listing.hideAfterHarvestDays;
      if (n) el.textContent = n;
    });
    const pv = $('mkPrivacy'); if (pv && state.data && state.data.notes) pv.textContent = state.data.notes.privacy + (state.data.notes.listing ? ' · ' + state.data.notes.listing : '');
  }

  /* ---------------- interaction ---------------- */
  function bind() {
    // 3.0.0: tap a material to filter, tap it again (or "ดูทุกวัสดุ") to see all
    $('mkMats').addEventListener('click', (e) => { const b = e.target.closest('[data-mat]'); if (!b) return; state.mat = state.mat === b.dataset.mat ? 'all' : b.dataset.mat; render(); });
    const allBtn = $('mkAllMats'); if (allBtn) allBtn.addEventListener('click', () => { state.mat = 'all'; render(); });
    const provSel = $('mkProvince');
    if (provSel && PROV) provSel.addEventListener('change', () => { const o = provSel.selectedOptions[0]; PROV.set({ code: provSel.value, name: o ? o.textContent.replace(/\s*\(.*\)$/, '') : '' }); });
    if (PROV) PROV.onChange((p) => switchProvince(p));
    $('mkSide').addEventListener('click', (e) => {
      const b = e.target.closest('[data-side]'); if (!b) return; state.side = b.dataset.side;
      $('mkSide').querySelectorAll('[data-side]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderList(); renderMap();
    });
    const setDistrict = (code) => {
      state.district = code; $('mkDistrict').value = code;
      renderList(); renderMap(); renderDistTable();
      if (!state.district && state.outline) state.map.fitBounds(state.outline.getBounds(), { padding: [8, 8] });
    };
    $('mkDistrict').addEventListener('change', (e) => setDistrict(e.target.value));
    // a district row filters the map (tap again to show all); brings the map into view
    $('mkDistTable').addEventListener('click', (e) => {
      const b = e.target.closest('[data-district]'); if (!b) return;
      setDistrict(state.district === b.dataset.district ? '' : b.dataset.district);
      const top = $('mkBoardTitle'); if (top && top.scrollIntoView) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // phones: the table starts folded so the map stays near the top
    if (window.matchMedia && window.matchMedia('(max-width: 899px)').matches) $('mkDistWrap').open = false;
    $('mkView').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]'); if (!b) return; state.view = b.dataset.view; $('mkBody').dataset.view = state.view;
      $('mkView').querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (state.view === 'map' && state.map) setTimeout(() => state.map.invalidateSize(), 30);
    });
    $('mkNear').addEventListener('click', () => {
      const b = $('mkNear');
      if (!navigator.geolocation) { b.textContent = 'อุปกรณ์นี้ไม่รองรับตำแหน่ง'; return; }
      b.disabled = true; b.classList.add('is-busy');
      navigator.geolocation.getCurrentPosition((pos) => {
        state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude }; state.district = ''; $('mkDistrict').value = '';
        b.disabled = false; b.classList.remove('is-busy'); b.setAttribute('aria-pressed', 'true');
        renderList(); renderMap(); if (state.map) state.map.setView([state.me.lat, state.me.lng], 10);
      }, () => {
        b.disabled = false; b.classList.remove('is-busy');
        $('mkList').insertAdjacentHTML('afterbegin', '<p class="ggh-mk-note">ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง เลือกอำเภอของคุณแทนได้</p>');
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    });
    // a list item opens its spot on the map
    const open = (li) => {
      const id = li.dataset.cell + ':' + (li.classList.contains('is-buy') ? 'buy' : 'sell');
      const m = state.markers[id]; if (!m || !state.map) return;
      if (state.view === 'list' && window.matchMedia('(max-width: 899px)').matches) $('mkView').querySelector('[data-view="map"]').click();
      state.map.setView(m.getLatLng(), Math.max(state.map.getZoom(), 11)); m.openPopup();
    };
    $('mkList').addEventListener('click', (e) => { if (e.target.closest('button')) return; const li = e.target.closest('.ggh-mk-item'); if (li) open(li); });
    $('mkList').addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; const li = e.target.closest('.ggh-mk-item'); if (li && e.target === li) open(li); });
    // doors inside the list and the map popups use the same sign-in as the buttons on top (index.html openDoor)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('#mkList [data-door], .ggh-mk-popup [data-door]'); if (!b) return;
      const top = document.querySelector(`.ggh-mk-doors [data-role="${b.dataset.role}"]`); if (top) top.click();
    });
    window.addEventListener('hashchange', route);
  }

  function init() {
    if (!$('marketPage')) return;
    route(); bind(); render();
    loadGeo(); renderProvincePicker();
    load();
    /* 2.9.0 "ใช้งานอย่างไร": two tabs (sell / buy) — click, or arrow keys between them */
  (function howTabs() {
    const tabs = [document.getElementById('howTabSell'), document.getElementById('howTabBuy')];
    if (!tabs[0] || !tabs[1]) return;
    const pick = (t, focus) => tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) x.focus();
    });
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => pick(t));
      t.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); pick(tabs[1 - i], true); } });
    });
  })();

  window.GGH_MARKET = { state, route, reload: load };
  // 3.1.0: the signed-in pages draw their pins and card icons the same way as this page
  window.GGH_ICONS = { svg: icon, pin: pinHtml, groupOf };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
