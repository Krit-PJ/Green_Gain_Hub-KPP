/* Green Gain Hub 2.6.0 (since 2.5.0) — front page for farmers and buyers (ตลาดวัสดุเหลือใช้ทางการเกษตร).
 *
 * ?api=v1&endpoint=market gives grid cells (~5.5 km) with residue offered (sell) and bought (buy) per material.
 * Public = aggregate only: cell centres, counts, area, price range — no names, phones or real coordinates.
 * Exact pins and phone numbers are in the signed-in market (unchanged), reached through the two doors.
 *
 * 2.6.0: the results page and officer sign-in moved to ABM (ระบบบริหารจัดการวัสดุเหลือใช้ทางการเกษตร).
 *   Old links #performance #overview #crops #market #staff #staff-register open ABM (same view).
 */
(function () {
  'use strict';

  const cfg = window.GGH_CONFIG || {};
  const API_BASE = cfg.SUMMARY_API_URL || cfg.SHEETS_API_URL || '';
  const API_KEY = cfg.SUMMARY_API_KEY || '';
  const TIMEOUT = Number(cfg.REQUEST_TIMEOUT_MS) || 30000;
  const CACHE_KEY = 'ggh_market_v1';
  const GEO_URL = 'assets/kpp-districts.geojson?v=1.5.0';
  const ABM_URL = cfg.ABM_URL || 'https://krit-pj.github.io/KPP-Agri-Byproduct-Management/';
  const ABM_API = cfg.ABM_API_URL || '';
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

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const fmt = (n, d) => (n === null || n === undefined || !isFinite(n) ? '–' : new Intl.NumberFormat('th-TH', { maximumFractionDigits: d ?? 0 }).format(n));
  const thDate = (iso) => { const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }); };

  const state = { data: null, results: null, geo: null, mat: 'all', side: 'all', district: '', view: 'map', me: null, map: null, layer: null, outline: null, markers: {} };

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
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (c && c.data) { state.data = c.data; state.results = c.results || null; render(); } } catch (e) { /* ignore */ }
    if (!API_BASE) { stats('ยังไม่ได้ตั้งค่า API ใน assets/config.js', true); return; }
    call({ api: 'v1', endpoint: 'market' }).then((p) => {
      if (!p || !p.ok || !p.data || !p.data.ok) throw new Error((p && p.error) || 'ระบบยังไม่รองรับแผนที่ตลาด');
      state.data = p.data; render(); save();
    }).catch((err) => {
      console.warn('[GGH market]', err);
      if (!state.data) { stats('โหลดข้อมูลตลาดไม่สำเร็จ ', true, true); renderList(); }
    });
    // the one number that says "this works": area managed without burning (officer records, current fiscal year)
    // 2.6.0: officer records live in ABM — its public residue endpoint (aggregate only)
    if (ABM_API) getJson(ABM_API + '?api=v1&endpoint=residue').then((p) => {
      if (p && p.ok && p.data && p.data.ok) { state.results = { areaRai: p.data.totals.areaRai, value: p.data.totals.value, fy: p.data.fy }; renderStats(); save(); }
    }).catch(() => { /* optional */ });
  }
  function save() { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: state.data, results: state.results })); } catch (e) { /* ignore */ } }

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
  function renderStats() {
    const d = state.data; if (!d) return;
    const t = d.totals;
    const parts = [];
    parts.push(`<span><b>${fmt(t.buyers)}</b> จุดรับซื้อ</span>`);
    parts.push(`<span><b>${fmt(t.plots)}</b> แปลงประกาศขาย · ${fmt(t.areaRai, 1)} ไร่${t.ton ? ' (~' + fmt(t.ton, 0) + ' ตัน)' : ''}</span>`);
    if (state.results && state.results.areaRai) parts.push(`<span><b>${fmt(state.results.areaRai, 0)}</b> ไร่ จัดการแล้วไม่เผา (ปีงบ ${state.results.fy})</span>`);
    const el = $('mkStats'); el.classList.remove('is-error'); el.innerHTML = parts.join('');
  }
  function renderMats() {
    const box = $('mkMats'); if (!box || !state.data) return;
    const chip = (key, name, ico, sell, buy) => `<button type="button" data-mat="${key}" aria-pressed="${state.mat === key}"${key !== 'all' && !sell && !buy ? ' class="is-empty"' : ''}>${ico ? `<span class="ggh-mk-ico">${ico}</span>` : ''}<span>${esc(name)}</span>` +
      (key === 'all' ? '' : `<small>ขาย ${fmt(sell)} · ซื้อ ${fmt(buy)}</small>`) + '</button>';
    box.innerHTML = chip('all', 'ทุกวัสดุ', '', 0, 0) + groups().map((g) => chip(g.key, g.label, icon(g.key), g.sell.plots, g.buy.buyers)).join('');
  }
  function renderDistricts() {
    const sel = $('mkDistrict'); if (!sel || sel.options.length > 1) return;
    const names = {};
    if (state.geo) state.geo.features.forEach((f) => { names[f.properties.code] = f.properties.name; });
    if (!Object.keys(names).length && state.data) state.data.cells.forEach((c) => { if (c.district) names[c.district] = c.districtName; });
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
      attribution: '&copy; OpenStreetMap contributors · ขอบเขตอำเภอ: OpenGISData-Thailand (CC BY 4.0)'
    }).addTo(state.map);
    state.map.setView([16.3, 99.6], 9);
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
    renderStats(); renderMats(); renderDistricts(); renderList(); renderMap();
    const pv = $('mkPrivacy'); if (pv && state.data && state.data.notes) pv.textContent = state.data.notes.privacy;
  }

  /* ---------------- interaction ---------------- */
  function bind() {
    $('mkMats').addEventListener('click', (e) => { const b = e.target.closest('[data-mat]'); if (!b) return; state.mat = b.dataset.mat; render(); });
    $('mkSide').addEventListener('click', (e) => {
      const b = e.target.closest('[data-side]'); if (!b) return; state.side = b.dataset.side;
      $('mkSide').querySelectorAll('[data-side]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderList(); renderMap();
    });
    $('mkDistrict').addEventListener('change', (e) => { state.district = e.target.value; renderList(); renderMap(); if (!state.district && state.outline) state.map.fitBounds(state.outline.getBounds(), { padding: [8, 8] }); });
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
    fetch(GEO_URL).then((r) => r.json()).then((geo) => { state.geo = geo; renderDistricts(); renderMap(); }).catch(() => { /* boundaries optional */ });
    load();
    window.GGH_MARKET = { state, route, reload: load };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
