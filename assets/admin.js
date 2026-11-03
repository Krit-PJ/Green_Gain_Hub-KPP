/* Green Gain Hub 1.6.0 — admin page (Super Admin / Admin). */
(function () {
  'use strict';

  const cfg = window.GGH_CONFIG || {};
  const API = cfg.SHEETS_API_URL || '';
  const TOKEN_KEY = 'ggh_admin_token';
  const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const fmt = (n, d = 0) => (n === null || n === undefined || !isFinite(n) ? '–' : new Intl.NumberFormat('th-TH', { maximumFractionDigits: d }).format(n));
  const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthLabel = (ym) => { const y = Math.floor(ym / 100), m = ym % 100; return `${TH_MONTHS[m - 1]} ${String(y + 543).slice(-2)}`; };
  const STATUS_TH = { active: 'ใช้งาน', replaced: 'ถูกแทนที่', deleted: 'ลบแล้ว', disabled: 'ระงับ' };
  const ACTION_TH = { login: 'เข้าสู่ระบบ', crop_import: 'นำเข้าข้อมูลเพาะปลูก', crop_import_delete: 'ลบชุดข้อมูล', crop_type_save: 'บันทึกชนิดพืช',
    settings_save: 'แก้ไขการเชื่อมต่อ API', admin_create: 'เพิ่มผู้ดูแล', admin_update: 'แก้ไขผู้ดูแล', password_change: 'เปลี่ยนรหัสผ่าน',
    password_reset: 'ตั้งรหัสผ่านใหม่ให้ผู้ดูแล', super_bootstrap: 'สร้าง Super Admin', cache_clear: 'อัปเดตหน้าแรก' };

  const state = { token: sessionStorage.getItem(TOKEN_KEY) || '', me: null, types: [], crop: '', file: null, parsed: null, check: null };

  /* ---------------- API ---------------- */
  async function call(method, ...args) {
    if (!API) throw new Error('ยังไม่ได้ตั้งค่า SHEETS_API_URL ใน assets/config.js');
    const res = await fetch(API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method, args, token: state.token }) });
    if (!res.ok) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ' + res.status + ')');
    const data = await res.json();
    if (!data.ok) {
      if (data.error === 'ADMIN_SESSION_EXPIRED') { signOut('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'); throw new Error('เซสชันหมดอายุ'); }
      throw new Error(data.error || 'เกิดข้อผิดพลาด');
    }
    return data.result;
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function setResult(id, msg, ok) {
    const el = $(id); el.textContent = msg || ''; el.className = 'adm-result' + (msg ? (ok ? ' is-ok' : ' is-error') : '');
  }
  async function busy(btn, label, fn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }

  /* ---------------- auth ---------------- */
  function signOut(msg) {
    state.token = ''; state.me = null; sessionStorage.removeItem(TOKEN_KEY);
    $('viewApp').classList.add('hidden'); $('admUser').classList.add('hidden'); $('viewLogin').classList.remove('hidden');
    $('loginError').textContent = msg || '';
  }

  async function enterApp(me) {
    state.me = me;
    $('viewLogin').classList.add('hidden'); $('viewApp').classList.remove('hidden'); $('admUser').classList.remove('hidden');
    $('admUserName').textContent = me.name;
    $('admUserRole').textContent = me.role === 'super' ? 'Super Admin' : 'Admin';
    document.querySelectorAll('[data-role="super"]').forEach((b) => b.classList.toggle('hidden', me.role !== 'super'));
    show('import');
    await loadCropTypes();
  }

  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = $('loginUsername').value.trim().toLowerCase(), password = $('loginPassword').value;
    if (!username || !password) { $('loginError').textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'; return; }
    busy($('loginBtn'), 'กำลังตรวจสอบ…', async () => {
      try {
        const r = await call('adminLoginServer', { username, password });
        state.token = r.token; sessionStorage.setItem(TOKEN_KEY, r.token);
        $('loginPassword').value = ''; $('loginError').textContent = '';
        await enterApp(r);
      } catch (err) { $('loginError').textContent = err.message; }
    });
  });
  $('admLogout').addEventListener('click', async () => { try { await call('adminLogoutServer'); } catch (e) { /* ignore */ } signOut(); });

  /* ---------------- navigation ---------------- */
  const loaders = { history: loadHistory, crops: loadCropTypesTable, api: loadApi, admins: loadAdmins, log: loadLog };
  function show(view) {
    document.querySelectorAll('.adm-nav [data-view]').forEach((b) => { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== view));
    if (loaders[view]) loaders[view]().catch((err) => toast(err.message));
  }
  document.querySelectorAll('.adm-nav [data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  /* ---------------- import wizard ---------------- */
  async function loadCropTypes() {
    state.types = await call('cropTypesListServer');
    const box = $('cropChoices');
    const active = state.types.filter((t) => t.active);
    box.innerHTML = active.map((t) => `<button type="button" role="radio" aria-checked="${t.crop === state.crop}" data-crop="${esc(t.crop)}">${esc(t.crop)}<small>${esc(t.material)}</small></button>`).join('')
      || '<p class="adm-muted">ยังไม่มีชนิดพืชที่เปิดใช้งาน เพิ่มได้ที่เมนู "ชนิดพืช"</p>';
    box.querySelectorAll('[data-crop]').forEach((b) => b.addEventListener('click', () => chooseCrop(b.dataset.crop)));
  }

  function chooseCrop(crop) {
    state.crop = crop;
    $('cropChoices').querySelectorAll('[data-crop]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.crop === crop)));
    $('step1').classList.add('is-done');
    $('step2').classList.remove('is-locked');
    $('fileInput').disabled = false;
    $('dropText').textContent = `ลากไฟล์รายงาน ${crop} มาวาง หรือคลิกเพื่อเลือกไฟล์`;
    if (state.parsed) runCheck();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.XLSX) return resolve();
      const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('โหลดตัวอ่านไฟล์ Excel ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'));
      document.head.appendChild(s);
    });
  }

  async function readFile(file) {
    if (!state.crop) { toast('กรุณาเลือกชนิดพืชก่อน'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน 10 MB'); return; }
    state.file = file; state.parsed = null; state.check = null;
    $('step3').classList.remove('is-locked');
    $('previewBox').innerHTML = '<p class="adm-muted">กำลังอ่านไฟล์…</p>';
    setResult('commitResult', '');
    try {
      await loadScript(SHEETJS);
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      state.parsed = window.GGH_CROP_IMPORT.parse(aoa);
      state.season = state.parsed.suggestedSeason;
      $('step2').classList.add('is-done');
      $('dropText').textContent = `ไฟล์: ${file.name} (เลือกไฟล์อื่นได้)`;
      await runCheck();
    } catch (err) {
      $('previewBox').innerHTML = `<div class="adm-note is-error">${esc(err.message)}</div>`;
    }
  }

  async function runCheck() {
    const p = state.parsed;
    state.check = null;
    lockCommit();
    renderPreview(null, null);
    if (!p.ok) return;
    try {
      state.check = await call('cropImportCheckServer', payload());
      renderPreview(state.check, null);
      $('step3').classList.add('is-done');
      $('step4').classList.remove('is-locked');
      $('commitBtn').disabled = false;
      $('commitBtn').textContent = `นำเข้าข้อมูล ${state.crop} ปี ${state.season}` + (state.check.replaces.length ? ' (แทนที่ชุดเดิม)' : '');
    } catch (err) {
      renderPreview(null, err.message);
    }
  }

  function payload() {
    return { crop: state.crop, season: state.season, monthType: 'harvest', fileName: state.file ? state.file.name : '',
      rows: state.parsed.rows.map((r) => ({ line: r.line, code: r.code, name: r.name, period: r.period, households: r.households, plots: r.plots, area: r.area })) };
  }

  function lockCommit() {
    $('step4').classList.add('is-locked'); $('step3').classList.remove('is-done');
    $('commitBtn').disabled = true; $('commitBtn').textContent = 'นำเข้าข้อมูล';
  }

  function renderPreview(check, serverError) {
    const p = state.parsed;
    if (!p) return;
    const max = Math.max(1, ...p.byPeriod.map((x) => x.areaRai));
    const months = p.byPeriod.map((x) => `<div class="adm-month"><span>${monthLabel(Number(x.period))}</span><i style="width:${(x.areaRai / max * 100).toFixed(1)}%"></i><span>${fmt(x.areaRai, 2)} ไร่</span></div>`).join('');
    const issues = p.errors.length
      ? `<div class="adm-note is-error"><strong>นำเข้าไม่ได้ ไฟล์มีปัญหา</strong><ul>${p.errors.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
    const warns = (check ? check.warnings : p.warnings).length
      ? `<div class="adm-note"><ul>${(check ? check.warnings : p.warnings).slice(0, 6).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
    const replace = check && check.replaces.length
      ? `<div class="adm-note"><strong>จะแทนที่ข้อมูลชุดเดิม</strong> ${check.replaces.map((r) => `${esc(r.fileName || r.importId)} (${fmt(r.totalRai, 2)} ไร่ นำเข้าเมื่อ ${esc(r.importedAt)})`).join(', ')}</div>`
      : (check ? '<div class="adm-note is-ok">ตรวจสอบผ่าน ผลรวมตำบล อำเภอ และจังหวัดตรงกันทุกเดือน ยังไม่มีข้อมูลชุดเดิมของพืชและปีนี้</div>' : '');
    const server = serverError ? `<div class="adm-note is-error"><strong>เซิร์ฟเวอร์ไม่รับข้อมูล</strong> ${esc(serverError)}</div>` : '';
    $('previewBox').innerHTML = `
      ${p.title ? `<p class="adm-muted">แหล่งข้อมูล: ${esc(p.title)}</p>` : ''}
      <div class="adm-stats">
        <div class="adm-stat"><b>${fmt(p.totalRai, 2)}</b><span>ไร่ พื้นที่ปลูกทั้งหมด</span></div>
        <div class="adm-stat"><b>${p.periods.length}</b><span>เดือน (${p.periods.length ? monthLabel(p.periods[0]) + ' – ' + monthLabel(p.periods[p.periods.length - 1]) : '–'})</span></div>
        <div class="adm-stat"><b>${p.districts}</b><span>อำเภอ</span></div>
        <div class="adm-stat"><b>${p.subdistricts}</b><span>ตำบล</span></div>
        <div class="adm-stat"><b>${fmt(p.rows.length)}</b><span>แถวข้อมูล</span></div>
      </div>
      <div class="adm-fields">
        <label>ชนิดพืช<span class="adm-fixed">${esc(state.crop)}</span></label>
        <label>ปีการผลิต<input id="seasonInput" value="${esc(state.season)}" pattern="\\d{4}(/\\d{2})?" maxlength="7" inputmode="numeric"></label>
        <label>ข้อมูลแยกตาม<span class="adm-fixed">เดือนที่คาดว่าจะเก็บเกี่ยว</span></label>
      </div>
      <div><h3>พื้นที่เก็บเกี่ยวรายเดือน</h3><div class="adm-months">${months}</div></div>
      ${issues}${server}${warns}${replace}`;
    const season = $('seasonInput');
    if (season) season.addEventListener('change', () => {
      const v = season.value.trim();
      if (!/^\d{4}(\/\d{2})?$/.test(v)) { toast('ปีการผลิตต้องเป็นรูปแบบ 2569 หรือ 2569/70'); season.value = state.season; return; }
      state.season = v; runCheck();
    });
  }

  const drop = $('dropZone');
  $('fileInput').addEventListener('change', (e) => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); if (state.crop) drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  drop.addEventListener('click', (e) => { if (!state.crop) { e.preventDefault(); toast('กรุณาเลือกชนิดพืชก่อน'); } });

  $('commitBtn').addEventListener('click', () => {
    if (!state.check) return;
    const msg = `ยืนยันนำเข้า ${state.crop} ปี ${state.season} จำนวน ${fmt(state.parsed.totalRai, 2)} ไร่` + (state.check.replaces.length ? '\nข้อมูลชุดเดิมของพืชและปีนี้จะถูกแทนที่' : '');
    if (!window.confirm(msg)) return;
    busy($('commitBtn'), 'กำลังนำเข้า…', async () => {
      try {
        const r = await call('cropImportCommitServer', payload());
        setResult('commitResult', r.message + ' หน้าแรกอัปเดตแล้ว', true);
        $('step4').classList.add('is-done');
        state.check = null;
        $('commitBtn').disabled = true;
        toast('นำเข้าข้อมูลสำเร็จ');
      } catch (err) { setResult('commitResult', err.message, false); }
    }).then(() => { $('commitBtn').disabled = !state.check; });
  });

  $('resetBtn').addEventListener('click', () => {
    Object.assign(state, { crop: '', file: null, parsed: null, check: null });
    ['step1', 'step2', 'step3', 'step4'].forEach((id, i) => { $(id).classList.remove('is-done'); $(id).classList.toggle('is-locked', i > 0); });
    $('fileInput').disabled = true; $('previewBox').innerHTML = ''; setResult('commitResult', '');
    $('dropText').textContent = 'เลือกชนิดพืชก่อน แล้วลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์';
    $('commitBtn').disabled = true; $('commitBtn').textContent = 'นำเข้าข้อมูล';
    loadCropTypes().catch((err) => toast(err.message));
  });

  /* ---------------- history ---------------- */
  async function loadHistory() {
    const list = await call('cropImportsListServer');
    $('histBody').innerHTML = list.map((x) => `<tr>
      <td>${esc(x.crop)}</td><td>${esc(x.season)}</td><td class="num">${fmt(x.totalRai, 2)}</td><td>${esc(rangeLabel(x.periods))}</td>
      <td><span class="adm-badge ${esc(x.status)}">${esc(STATUS_TH[x.status] || x.status)}</span></td>
      <td>${esc(x.importedAt)}</td><td>${esc(x.importedBy)}</td>
      <td>${x.status === 'active' ? `<button type="button" class="danger" data-del="${esc(x.importId)}">ลบชุดนี้</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="8" class="adm-muted">ยังไม่มีการนำเข้าข้อมูล</td></tr>';
    $('histBody').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm('ลบชุดข้อมูลนี้ออกจากหน้าแรก? (ข้อมูลยังเก็บเป็นประวัติ)')) return;
      try { toast((await call('cropImportDeleteServer', { importId: b.dataset.del })).message); loadHistory(); } catch (err) { toast(err.message); }
    }));
  }
  function rangeLabel(p) {
    const m = String(p || '').match(/^(\d{6})-(\d{6})$/);
    return m ? `${monthLabel(Number(m[1]))} – ${monthLabel(Number(m[2]))}` : p;
  }
  $('cacheBtn').addEventListener('click', async () => { try { toast((await call('cacheClearServer')).message); } catch (err) { toast(err.message); } });

  /* ---------------- crop types ---------------- */
  async function loadCropTypesTable() {
    state.types = await call('cropTypesListServer');
    $('cropTypesBody').innerHTML = state.types.map((t) => `<tr><td>${esc(t.crop)}</td><td>${esc(t.material)}</td><td class="num">${t.sortOrder}</td>
      <td><span class="adm-badge ${t.active ? 'active' : 'disabled'}">${t.active ? 'เปิดใช้งาน' : 'ปิด'}</span></td>
      <td><button type="button" data-edit="${esc(t.crop)}">แก้ไข</button></td></tr>`).join('');
    $('cropTypesBody').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const t = state.types.find((x) => x.crop === b.dataset.edit); const f = $('cropTypeForm');
      f.crop.value = t.crop; f.material.value = t.material; f.sortOrder.value = t.sortOrder; f.active.checked = t.active; f.material.focus();
    }));
  }
  $('cropTypeForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      await call('cropTypeSaveServer', { crop: f.crop.value, material: f.material.value, sortOrder: Number(f.sortOrder.value), active: f.active.checked });
      toast('บันทึกชนิดพืชแล้ว'); f.reset(); f.active.checked = true; loadCropTypesTable(); loadCropTypes();
    } catch (err) { toast(err.message); }
  });

  /* ---------------- API links (super) ---------------- */
  async function loadApi() {
    const s = await call('settingsGetServer');
    $('apiStatus').innerHTML = `<h3>สถานะ</h3><dl class="adm-kv">
      <dt>Green Gain Hub API</dt><dd>รุ่น ${esc(s.apiVersion)}</dd>
      <dt>ฐานข้อมูล</dt><dd><a href="https://docs.google.com/spreadsheets/d/${esc(s.spreadsheetId)}/edit" target="_blank" rel="noopener">Google Sheet</a></dd>
      <dt>Smart Agri URL</dt><dd>${esc(s.smartAgri.url)}${s.smartAgri.urlIsDefault ? ' (ค่าเริ่มต้น)' : ''}</dd>
      <dt>Smart Agri API Key</dt><dd>${s.smartAgri.keySet ? 'บันทึกไว้แล้ว (' + esc(s.smartAgri.keyHint) + ')' : '<strong>ยังไม่ได้ตั้งค่า</strong>'}</dd></dl>`;
    $('apiForm').smartAgriUrl.value = s.smartAgri.url;
    $('apiEndpoints').innerHTML = s.publicEndpoints.map((p) => `<li><code>${esc(API + p)}</code></li>`).join('');
  }
  $('apiForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const input = { smartAgriUrl: f.smartAgriUrl.value.trim() };
    if (f.smartAgriKey.value.trim()) input.smartAgriKey = f.smartAgriKey.value.trim();
    if (f.clearSmartAgriKey.checked) input.clearSmartAgriKey = true;
    try {
      const r = await call('settingsSaveServer', input);
      f.smartAgriKey.value = ''; f.clearSmartAgriKey.checked = false;
      setResult('apiResult', 'บันทึกแล้ว: ' + (r.changed.join(', ') || 'ไม่มีการเปลี่ยนแปลง'), true); loadApi();
    } catch (err) { setResult('apiResult', err.message, false); }
  });
  $('apiTestBtn').addEventListener('click', () => busy($('apiTestBtn'), 'กำลังทดสอบ…', async () => {
    try { const r = await call('smartAgriTestServer'); setResult('apiResult', r.result, /^PASS/.test(r.result)); } catch (err) { setResult('apiResult', err.message, false); }
  }));

  /* ---------------- admins (super) ---------------- */
  async function loadAdmins() {
    const list = await call('adminsListServer');
    $('adminsBody').innerHTML = list.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.username)}</td><td>${esc(a.phone || '–')}</td><td>${a.role === 'super' ? 'Super Admin' : 'Admin'}</td>
      <td><span class="adm-badge ${esc(a.status)}">${esc(STATUS_TH[a.status] || a.status)}</span></td><td>${esc(a.lastLogin || '–')}</td>
      <td><button type="button" data-edit-admin="${esc(a.username)}">แก้ไข</button><button type="button" data-reset="${esc(a.username)}">ตั้งรหัสผ่านใหม่</button></td></tr>`).join('');
    $('adminsBody').querySelectorAll('[data-edit-admin]').forEach((b) => b.addEventListener('click', () => {
      const a = list.find((x) => x.username === b.dataset.editAdmin); const f = $('adminForm');
      f.name.value = a.name; f.username.value = a.username; f.username.readOnly = true; f.phone.value = a.phone || ''; f.role.value = a.role; f.status.value = a.status;
      $('adminPwLabel').classList.add('hidden'); $('adminFormTitle').textContent = 'แก้ไขผู้ดูแล ' + a.name; f.name.focus();
    }));
    $('adminsBody').querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
      const pw = window.prompt('รหัสผ่านใหม่สำหรับ ' + b.dataset.reset + ' (อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข)');
      if (!pw) return;
      try { toast((await call('adminResetPasswordServer', { username: b.dataset.reset, password: pw })).message); } catch (err) { toast(err.message); }
    }));
  }
  function resetAdminForm() {
    const f = $('adminForm'); f.reset(); f.username.readOnly = false; $('adminPwLabel').classList.remove('hidden'); $('adminFormTitle').textContent = 'เพิ่มผู้ดูแล'; setResult('adminResult', '');
  }
  $('adminFormReset').addEventListener('click', resetAdminForm);
  $('adminForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const input = { name: f.name.value, username: f.username.value.trim().toLowerCase(), phone: f.phone.value.replace(/\D/g, ''), role: f.role.value, status: f.status.value };
    if (!f.username.readOnly) input.password = f.password.value;
    try { const r = await call('adminSaveServer', input); resetAdminForm(); setResult('adminResult', r.message, true); loadAdmins(); }
    catch (err) { setResult('adminResult', err.message, false); }
  });

  /* ---------------- log (super) ---------------- */
  async function loadLog() {
    const list = await call('adminLogServer');
    $('logBody').innerHTML = list.map((l) => `<tr><td>${esc(l.time)}</td><td>${esc(l.name)}<br><span class="adm-muted">${esc(l.username)}</span></td>
      <td>${esc(ACTION_TH[l.action] || l.action)}</td><td>${esc(l.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="adm-muted">ยังไม่มีบันทึก</td></tr>';
  }

  /* ---------------- account ---------------- */
  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.next.value !== f.confirm.value) { setResult('pwResult', 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน', false); return; }
    try { const r = await call('adminChangePasswordServer', { current: f.current.value, next: f.next.value }); f.reset(); setResult('pwResult', r.message, true); }
    catch (err) { setResult('pwResult', err.message, false); }
  });

  /* ---------------- start ---------------- */
  if (state.token) {
    call('adminMeServer').then(enterApp).catch(() => signOut());
  }
})();
