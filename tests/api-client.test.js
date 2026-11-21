// 2.9.3: requests go by fetch() without cookies (devices signed in to other Google accounts got an error page
// through the old <script> way). Sign-in / read calls retry and may fall back to JSONP; data changes are sent once.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'api-client.js'), 'utf8');
const OK = { ok: true, result: { status: 'success', token: 't1' } };

/** fetchPlan: per call → 'ok' | 'throw' (network/CORS) | 'html' (Google error page) | 'http500'; jsonpFail: JSONP onerror count */
function makeEnv({ fetchPlan = [], noFetch = false, jsonpFail = 0 } = {}) {
  const log = [];
  const win = { GGH_CONFIG: { SHEETS_API_URL: 'https://example.test/exec', REQUEST_TIMEOUT_MS: 5000, RETRY_DELAYS_MS: [1, 1] } };
  const store = {};
  let jsonpCalls = 0;
  const ctx = {
    window: win, Date, Math, JSON, Promise, Proxy, Object, Array, String, Error, URLSearchParams, AbortController,
    setTimeout, clearTimeout, console,
    sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    document: {
      createElement: () => ({ remove() {} }),
      head: {
        appendChild(s) {
          const q = new URLSearchParams(s.src.split('?')[1]);
          log.push('jsonp:' + q.get('method'));
          jsonpCalls++;
          setTimeout(() => (jsonpCalls <= jsonpFail ? s.onerror() : win[q.get('callback')](OK)), 0);
        }
      }
    }
  };
  if (!noFetch) {
    let i = 0;
    ctx.fetch = (url, opts) => {
      const q = new URLSearchParams(url.split('?')[1]);
      log.push('fetch:' + q.get('method') + (q.get('callback') ? ':cb' : '') + ':' + opts.credentials);
      const step = fetchPlan[i++] || 'ok';
      if (step === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
      const body = step === 'html' ? '<html>Sorry, unable to open the file at this time.</html>' : JSON.stringify(OK);
      return Promise.resolve({ ok: step !== 'http500', status: step === 'http500' ? 500 : 200, text: () => Promise.resolve(body) });
    };
  }
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { win, log, store };
}

function run(env, method, arg) {
  return new Promise((resolve, reject) => {
    env.win.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](arg);
  });
}

(async () => {
  // normal sign-in: one fetch, no cookies, no JSONP callback; token kept
  let env = makeEnv();
  assert.strictEqual((await run(env, 'loginServer', { username: '0800000000' })).status, 'success');
  assert.deepStrictEqual(env.log, ['fetch:loginServer:omit']);
  assert.strictEqual(env.store.ggh_session_token, 't1');

  // Google error page instead of JSON → sign-in retried and succeeds
  env = makeEnv({ fetchPlan: ['html'] });
  assert.strictEqual((await run(env, 'loginServer', {})).status, 'success');
  assert.deepStrictEqual(env.log, ['fetch:loginServer:omit', 'fetch:loginServer:omit']);

  // fetch blocked → sign-in falls back to JSONP
  env = makeEnv({ fetchPlan: ['throw'] });
  assert.strictEqual((await run(env, 'getUserProfileServer')).status, 'success');
  assert.deepStrictEqual(env.log, ['fetch:getUserProfileServer:omit', 'jsonp:getUserProfileServer']);

  // old browser without fetch → JSONP
  env = makeEnv({ noFetch: true });
  assert.strictEqual((await run(env, 'registerServer', {})).status, 'success');
  assert.deepStrictEqual(env.log, ['jsonp:registerServer']);

  // everything fails → plain Thai message, no "API" jargon, bounded attempts
  env = makeEnv({ fetchPlan: Array(9).fill('throw'), jsonpFail: 9 });
  await assert.rejects(run(env, 'loginServer', {}), (e) => /เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ/.test(e.message) && !/API/.test(e.message));
  assert.strictEqual(env.log.length, 6);

  // data-changing calls: sent once, never retried, never re-sent by JSONP
  for (const m of ['saveDataServer', 'deleteDataServer', 'registerServer', 'renewFarmerServer']) {
    for (const plan of ['throw', 'html', 'http500']) {
      env = makeEnv({ fetchPlan: [plan] });
      await assert.rejects(run(env, m, {}));
      assert.deepStrictEqual(env.log, ['fetch:' + m + ':omit'], m + ' ' + plan + ' must be sent once');
    }
  }
  console.log('api-client.test.js: ok');
})().catch((e) => { console.error(e); process.exit(1); });
