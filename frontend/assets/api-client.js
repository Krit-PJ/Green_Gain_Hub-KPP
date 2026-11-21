(function () {
  'use strict';
  const cfg = window.GGH_CONFIG || {};
  const apiUrl = cfg.SHEETS_API_URL || cfg.WEB_APP_URL || '';
  let sessionToken = sessionStorage.getItem('ggh_session_token') || '';

  // 2.9.2: a JSONP request can drop on the way (Google edge / mobile network) without reaching Apps Script.
  // Sign-in and read calls retry by themselves; calls that change data are never sent twice.
  const RETRYABLE = ['loginServer', 'ssoLoginServer', 'ssoProvisionServer', 'getUserProfileServer', 'getMatchingDataServer', 'getApiInfoServer'];
  const RETRY_DELAYS = cfg.RETRY_DELAYS_MS || [800, 2000];
  const NET_ERROR = 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง';

  function rpc(method, args) {
    const retries = RETRYABLE.indexOf(method) >= 0 ? RETRY_DELAYS : [];
    return (function attempt(n) {
      return rpcOnce(method, args).catch(function (err) {
        if (!err || !err.network || n >= retries.length) throw err;
        return new Promise(function (r) { setTimeout(r, retries[n]); }).then(function () { return attempt(n + 1); });
      });
    })(0);
  }

  function rpcOnce(method, args) {
    return new Promise(function (resolve, reject) {
      if (!apiUrl || apiUrl.includes('PUT_YOUR')) {
        reject(new Error('กรุณากำหนด SHEETS_API_URL ใน assets/config.js'));
        return;
      }
      const callback = '__ggh_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timeout = setTimeout(function () { cleanup(); reject(new Error('เซิร์ฟเวอร์ตอบช้าเกินไป กรุณาลองใหม่อีกครั้ง')); }, cfg.REQUEST_TIMEOUT_MS || 30000);
      function cleanup() { clearTimeout(timeout); delete window[callback]; script.remove(); }
      window[callback] = function (payload) {
        cleanup();
        if (!payload || payload.ok === false) {
          reject(new Error(payload && payload.error || 'API error'));
          return;
        }
        const result = payload.result;
        if ((method === 'loginServer' || method === 'registerServer' || method === 'ssoLoginServer') && result && result.token) {
          sessionToken = result.token;
          sessionStorage.setItem('ggh_session_token', sessionToken);
        }
        resolve(result);
      };
      const query = new URLSearchParams({action:'rpc',method:method,args:JSON.stringify(args || []),callback:callback});
      if (sessionToken) query.set('token', sessionToken);
      script.src = apiUrl + '?' + query.toString();
      script.onerror = function () { cleanup(); const e = new Error(NET_ERROR); e.network = true; reject(e); };
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
  Object.defineProperty(window.google.script, 'run', {get:function () { return runner(); }});
  window.GGH_API = {logout:function () { sessionToken='';sessionStorage.removeItem('ggh_session_token'); }};
})();
