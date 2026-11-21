/* Green Gain Hub — google.script.run shim for GitHub Pages → Apps Script web app.
   2.9.3: requests go by fetch() WITHOUT cookies first. The old <script> (JSONP) way sends the device's Google
   cookies, and on phones/PCs signed in to other (or several) Google accounts Google answers with an error page
   even though the script already ran — the browser then shows "เชื่อมต่อไม่สำเร็จ". JSONP stays only as the
   fallback for sign-in / read calls when fetch itself is unavailable or blocked.
   2.9.2: sign-in and read calls retry a dropped request; calls that change data are never sent twice. */
(function () {
  'use strict';
  const cfg = window.GGH_CONFIG || {};
  const apiUrl = cfg.SHEETS_API_URL || cfg.WEB_APP_URL || '';
  let sessionToken = sessionStorage.getItem('ggh_session_token') || '';

  const RETRYABLE = ['loginServer', 'ssoLoginServer', 'ssoProvisionServer', 'getUserProfileServer', 'getMatchingDataServer', 'getApiInfoServer'];
  const TOKEN_METHODS = ['loginServer', 'registerServer', 'ssoLoginServer'];
  const RETRY_DELAYS = cfg.RETRY_DELAYS_MS || [800, 2000];
  const TIMEOUT_MS = cfg.REQUEST_TIMEOUT_MS || 30000;
  const NET_ERROR = 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง';
  const SLOW_ERROR = 'เซิร์ฟเวอร์ตอบช้าเกินไป กรุณาลองใหม่อีกครั้ง';

  function netError(msg) { const e = new Error(msg || NET_ERROR); e.network = true; return e; }

  function rpc(method, args) {
    const retryable = RETRYABLE.indexOf(method) >= 0;
    const retries = retryable ? RETRY_DELAYS : [];
    return (function attempt(n) {
      return rpcOnce(method, args, retryable).catch(function (err) {
        if (!err || !err.network || n >= retries.length) throw err;
        return new Promise(function (r) { setTimeout(r, retries[n]); }).then(function () { return attempt(n + 1); });
      });
    })(0);
  }

  function query(method, args, callback) {
    const q = new URLSearchParams({ action: 'rpc', method: method, args: JSON.stringify(args || []) });
    if (callback) q.set('callback', callback);
    if (sessionToken) q.set('token', sessionToken);
    return apiUrl + (apiUrl.includes('?') ? '&' : '?') + q.toString();
  }

  function settle(method, payload) {
    if (!payload || payload.ok === false) throw new Error(payload && payload.error || 'ระบบตอบกลับไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    const result = payload.result;
    if (TOKEN_METHODS.indexOf(method) >= 0 && result && result.token) {
      sessionToken = result.token;
      sessionStorage.setItem('ggh_session_token', sessionToken);
    }
    return result;
  }

  function rpcOnce(method, args, retryable) {
    if (!apiUrl || apiUrl.includes('PUT_YOUR')) return Promise.reject(new Error('กรุณากำหนด SHEETS_API_URL ใน assets/config.js'));
    if (typeof fetch !== 'function') return viaJsonp(method, args);
    return viaFetch(method, args).catch(function (err) {
      // fetch blocked / failed on the way: a sign-in or read may try the old way once; data changes never go twice.
      if (err && err.network && err.fetchFailed && retryable) return viaJsonp(method, args);
      throw err;
    });
  }

  function viaFetch(method, args) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(query(method, args, ''), { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw netError();
        return res.text().then(function (text) {
          let payload;
          try { payload = JSON.parse(text); } catch (e) { throw netError(); }
          return settle(method, payload);
        });
      }, function (err) {
        if (err && err.name === 'AbortError') throw new Error(SLOW_ERROR);
        const e = netError(); e.fetchFailed = true; throw e;
      })
      .finally(function () { clearTimeout(timer); });
  }

  function viaJsonp(method, args) {
    return new Promise(function (resolve, reject) {
      const callback = '__ggh_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timeout = setTimeout(function () { cleanup(); reject(new Error(SLOW_ERROR)); }, TIMEOUT_MS);
      function cleanup() { clearTimeout(timeout); delete window[callback]; script.remove(); }
      window[callback] = function (payload) {
        cleanup();
        try { resolve(settle(method, payload)); } catch (e) { reject(e); }
      };
      script.src = query(method, args, callback);
      script.onerror = function () { cleanup(); reject(netError()); };
      document.head.appendChild(script);
    });
  }

  function runner(success, failure) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return runner(fn, failure); };
        if (prop === 'withFailureHandler') return function (fn) { return runner(success, fn); };
        return function () {
          rpc(String(prop), Array.prototype.slice.call(arguments))
            .then(success || function () {})
            .catch(failure || function (err) { console.error(err); });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', { get: function () { return runner(); } });
  window.GGH_API = { logout: function () { sessionToken = ''; sessionStorage.removeItem('ggh_session_token'); } };
})();
