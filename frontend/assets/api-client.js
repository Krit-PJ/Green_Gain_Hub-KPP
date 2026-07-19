(function () {
  'use strict';
  const cfg = window.GGH_CONFIG || {};
  const apiUrl = cfg.SHEETS_API_URL || cfg.WEB_APP_URL || '';
  let sessionToken = sessionStorage.getItem('ggh_session_token') || '';

  function rpc(method, args) {
    return new Promise(function (resolve, reject) {
      if (!apiUrl || apiUrl.includes('PUT_YOUR')) {
        reject(new Error('กรุณากำหนด SHEETS_API_URL ใน assets/config.js'));
        return;
      }
      const callback = '__ggh_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timeout = setTimeout(function () { cleanup(); reject(new Error('API timeout')); }, cfg.REQUEST_TIMEOUT_MS || 30000);
      function cleanup() { clearTimeout(timeout); delete window[callback]; script.remove(); }
      window[callback] = function (payload) {
        cleanup();
        if (!payload || payload.ok === false) {
          reject(new Error(payload && payload.error || 'API error'));
          return;
        }
        const result = payload.result;
        if (method === 'loginServer' && result && result.token) {
          sessionToken = result.token;
          sessionStorage.setItem('ggh_session_token', sessionToken);
        }
        resolve(result);
      };
      const query = new URLSearchParams({action:'rpc',method:method,args:JSON.stringify(args || []),callback:callback});
      if (sessionToken) query.set('token', sessionToken);
      script.src = apiUrl + '?' + query.toString();
      script.onerror = function () { cleanup(); reject(new Error('เชื่อมต่อ API ไม่สำเร็จ')); };
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
