/* Green Gain Hub 2.4.0 (since 2.2.1) — officer sign-in by phone and self-registration, shared by the homepage popup and admin.html.
   A form uses the field names name, phone, officeType, group, district, province; the group and district fields sit
   inside elements marked data-reg="group" / data-reg="district" so they can be shown for the chosen office type. */
(function () {
  'use strict';
  const cfg = window.GGH_CONFIG || {};
  const API = cfg.SHEETS_API_URL || '';
  const TOKEN_KEY = 'ggh_admin_token';
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const digits = (v) => String(v || '').replace(/\D/g, '');
  let meta = null;

  async function call(method, arg) {
    if (!API) throw new Error('ยังไม่ได้ตั้งค่า SHEETS_API_URL ใน assets/config.js');
    const res = await fetch(API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method, args: arg === undefined ? [] : [arg], token: '' }) });
    if (!res.ok) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ' + res.status + ')');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    return data.result;
  }

  async function loadMeta() {
    if (!meta) meta = await call('staffMetaServer');
    return meta;
  }

  /** Fills the selects of a registration form and wires the office-type switch. */
  async function prepareRegister(form, listId) {
    const m = await loadMeta();
    if (form.dataset.ready) return m;
    form.officeType.innerHTML = '<option value="">เลือกหน่วยงาน</option>' + Object.entries(m.officeTypes).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    form.group.innerHTML = '<option value="">เลือกกลุ่ม</option>' + m.groups.map((g) => `<option>${esc(g)}</option>`).join('');
    form.district.innerHTML = '<option value="">เลือกอำเภอ</option>' + m.districts.map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('');
    const list = listId && document.getElementById(listId);
    if (list) list.innerHTML = m.provinces.map((p) => `<option value="${esc(p)}">`).join('');
    if (!form.province.value) form.province.value = m.province;
    form.officeType.addEventListener('change', () => syncOffice(form));
    syncOffice(form);
    form.dataset.ready = '1';
    return m;
  }

  function syncOffice(form) {
    const prov = form.officeType.value === 'province';
    form.querySelectorAll('[data-reg="group"]').forEach((el) => el.classList.toggle('hidden', !prov));
    form.querySelectorAll('[data-reg="district"]').forEach((el) => el.classList.toggle('hidden', prov));
  }

  /** Reads and checks a registration form. Returns { input, missing }. */
  function readRegister(form) {
    const input = { name: form.name.value.trim().replace(/\s+/g, ' '), phone: digits(form.phone.value), officeType: form.officeType.value,
      group: form.group.value, district: form.district.value, province: form.province.value.trim() };
    const missing = [];
    if (!/\S+\s+\S+/.test(input.name)) missing.push('ชื่อ-สกุล');
    if (!/^0\d{9}$/.test(input.phone)) missing.push('หมายเลขโทรศัพท์ 10 หลัก');
    if (!input.officeType) missing.push('หน่วยงาน');
    if (input.officeType === 'province' && !input.group) missing.push('กลุ่ม');
    if (input.officeType === 'district' && !input.district) missing.push('อำเภอ');
    if (!input.province) missing.push('จังหวัด');
    return { input, missing };
  }

  /** Signs in by phone; the session token is kept for admin.html (same tab).
      2.4.0: through the central identity (SSO) when available; the old phone sign-in is the fallback. */
  async function login(phone) {
    const p = digits(phone);
    if (!/^0\d{9}$/.test(p)) throw new Error('กรุณากรอกหมายเลขโทรศัพท์ 10 หลัก');
    const S = window.GGH_SSO;
    if (S && S.available()) {
      try {
        const { id, result } = await S.staff(p, call);
        if (result.status === 'need_register') throw new Error('ไม่พบหมายเลขนี้ กรุณาลงทะเบียนเจ้าหน้าที่ก่อน');
        sessionStorage.setItem(TOKEN_KEY, result.token);
        result.prevLogin = id && id.prevLogin;
        // shown once on the officer pages ("previous sign-in" + "not me"), also after the homepage popup redirects there
        if (result.prevLogin) sessionStorage.setItem('ggh_sso_prev', JSON.stringify(result.prevLogin)); else sessionStorage.removeItem('ggh_sso_prev');
        return result;
      } catch (err) {
        if (err.code === 'not_found') throw new Error('ไม่พบหมายเลขนี้ กรุณาลงทะเบียนเจ้าหน้าที่ก่อน');
        if (!S.fallback(err)) throw err;
      }
    }
    const r = await call('staffLoginServer', { phone: p });
    sessionStorage.setItem(TOKEN_KEY, r.token);
    return r;
  }

  async function register(input) {
    const r = await call('staffRegisterServer', input);
    sessionStorage.setItem(TOKEN_KEY, r.token);
    // 2.4.0: the new officer also gets the shared identity (Agri-Risk Map / Smart Agri)
    if (window.GGH_SSO) await window.GGH_SSO.attach(input.phone, (p) => call('ssoProvisionServer', { phone: p }));
    return r;
  }

  /** admin.html: signed in elsewhere on this device → open the officer session without typing again. */
  async function ssoAuto() {
    const S = window.GGH_SSO;
    if (!S || sessionStorage.getItem(TOKEN_KEY)) return null;
    const ticket = await S.autoTicket('ggh-staff-sso-tried');
    if (!ticket) return null;
    try { const r = await call('ssoStaffLoginServer', { ticket }); if (r && r.token) { sessionStorage.setItem(TOKEN_KEY, r.token); return r; } } catch (e) { /* not an officer here */ }
    return null;
  }

  window.GGH_STAFF = { TOKEN_KEY, call, loadMeta, prepareRegister, syncOffice, readRegister, login, register, ssoAuto, digits,
    hasSession: () => !!sessionStorage.getItem(TOKEN_KEY) };
})();
