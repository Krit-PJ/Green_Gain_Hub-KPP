/* Green Gain Hub 2.4.0 — sign-in through the central identity (SSO) shared with Agri-Risk Map and Smart Agri.
   Uses KPP_ID (https://krit-pj.github.io/TH-Agri-Risk-Maps-Burning/js/kpp-id.js): phone → identity → one-use ticket → this
   system's Apps Script redeems it and opens its own session as before. Existing GGH users get an identity created from
   their GGH record on first sign-in (ssoProvisionServer), so nobody registers twice.
   If the central identity is unreachable or switched off, callers fall back to the old phone sign-in (SSO_MODE optional). */
(function () {
  'use strict';
  const available = () => !!(window.KPP_ID && window.KPP_ID.login);
  /** Errors where the old sign-in should be used instead (identity service off / unreachable). */
  function fallback(err) {
    const m = String(err && err.message || '');
    return !available() || /ปิดใช้งาน|เชื่อมต่อระบบตัวตนกลาง|Failed to fetch|NetworkError|Load failed/i.test(m);
  }
  /** JSONP RPC of the market app (google.script.run shim in api-client.js). */
  function rpc(method, arg) {
    return new Promise((resolve, reject) => {
      window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](arg);
    });
  }
  /** Central identity for a phone; creates it from the GGH record the first time. */
  async function identity(phone, provision, remember) {
    try { return await window.KPP_ID.login(phone, { system: 'GGH', remember: !!remember }); }
    catch (err) {
      if (err.code !== 'not_found') throw err;
      const p = await provision(phone);
      if (p && (p.status === 'provisioned' || p.status === 'exists')) return window.KPP_ID.login(phone, { system: 'GGH', remember: !!remember });
      const e = new Error('ไม่พบหมายเลขโทรศัพท์นี้ในระบบ กรุณาลงทะเบียน'); e.code = 'not_found'; throw e;
    }
  }
  /** Farmer / buyer: returns { id, result } — result is the loginServer-shaped session or { status:'need_register' }. */
  async function market(phone) {
    const id = await identity(phone, (p) => rpc('ssoProvisionServer', { phone: p }), true);
    const t = await window.KPP_ID.ticket('GGH');
    const result = await rpc('ssoLoginServer', { ticket: t.ticket });
    return { id, result };
  }
  /** Officer: call = GGH_STAFF.call (POST admin API). */
  async function staff(phone, call) {
    const id = await identity(phone, (p) => call('ssoProvisionServer', { phone: p }), false);
    const t = await window.KPP_ID.ticket('GGH');
    const result = await call('ssoStaffLoginServer', { ticket: t.ticket });
    return { id, result };
  }
  /** After a new GGH registration: give the person the shared identity too (best effort, never blocks GGH). */
  async function attach(phone, provision) {
    if (!available()) return null;
    try { await provision(phone); return await window.KPP_ID.login(phone, { system: 'GGH', remember: false }); } catch (e) { return null; }
  }
  /** Silent sign-in when this browser already holds an identity (signed in on Agri-Risk / Smart Agri / GGH earlier). */
  async function autoTicket(flag) {
    if (!available()) return null;
    const cur = window.KPP_ID.current(); if (!cur) return null;
    try { if (sessionStorage.getItem(flag) === String(cur.at)) return null; sessionStorage.setItem(flag, String(cur.at)); } catch (e) { /* ignore */ }
    try { return (await window.KPP_ID.ticket('GGH')).ticket; } catch (e) { return null; }
  }
  /** "Previous sign-in" notice with a "not me" button, as a banner at the top of `container` (no popup can cover it).
      onSuspended runs after "not me". */
  function showPrev(prev, onSuspended, container) {
    if (!prev || !available() || !container) return;
    let box = document.getElementById('gghSsoPrev');
    if (!box) { box = document.createElement('div'); box.id = 'gghSsoPrev'; box.style.margin = '0 0 1rem'; container.prepend(box); }
    box.innerHTML = window.KPP_ID.prevHtml(prev);
    window.KPP_ID.bindPrev(box, (suspended) => { if (suspended) { if (onSuspended) onSuspended(); } else box.remove(); });
  }
  function logout() { if (available()) window.KPP_ID.logout(); }
  window.GGH_SSO = { available, fallback, rpc, market, staff, attach, autoTicket, showPrev, logout };
})();
