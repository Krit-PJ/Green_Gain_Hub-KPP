// 2.9.2: JSONP sign-in calls retry by themselves when a request drops on the way (script onerror),
// while calls that change data never retry (no double save / delete).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'api-client.js'), 'utf8');

function makeEnv(failTimes) {
  const calls = [];
  const win = { GGH_CONFIG: { SHEETS_API_URL: 'https://example.test/exec', REQUEST_TIMEOUT_MS: 5000, RETRY_DELAYS_MS: [1, 1] } };
  const store = {};
  const ctx = {
    window: win, Date, Math, JSON, Promise, Proxy, Object, Array, String, Error, URLSearchParams,
    setTimeout, clearTimeout, console,
    sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    document: {
      createElement: () => ({ remove() {} }),
      head: {
        appendChild(s) {
          const q = new URLSearchParams(s.src.split('?')[1]);
          const method = q.get('method');
          calls.push(method);
          setTimeout(() => {
            if (calls.filter((m) => m === method).length <= failTimes) s.onerror();
            else win[q.get('callback')]({ ok: true, result: { status: 'success', token: 't1' } });
          }, 0);
        }
      }
    }
  };
  win.google = undefined;
  ctx.google = undefined;
  vm.createContext(ctx);
  vm.runInContext(SRC.replace(/window\.google/g, 'window.google'), ctx);
  return { win, calls };
}

function run(env, method, arg) {
  return new Promise((resolve, reject) => {
    env.win.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](arg);
  });
}

(async () => {
  // sign-in: one dropped request → retried and succeeds
  let env = makeEnv(1);
  const r = await run(env, 'loginServer', { username: '0800000000' });
  assert.strictEqual(r.status, 'success');
  assert.deepStrictEqual(env.calls, ['loginServer', 'loginServer']);

  // SSO ticket redeem and profile are retried too
  env = makeEnv(2);
  assert.strictEqual((await run(env, 'ssoLoginServer', { ticket: 'x' })).status, 'success');
  assert.strictEqual(env.calls.length, 3);

  // still failing after the retries → plain Thai message (no "API" jargon)
  env = makeEnv(9);
  await assert.rejects(run(env, 'getUserProfileServer'), (e) => /เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ/.test(e.message) && !/API/.test(e.message));
  assert.strictEqual(env.calls.length, 3);

  // data-changing calls are never sent twice
  for (const m of ['saveDataServer', 'deleteDataServer', 'registerServer', 'renewFarmerServer']) {
    env = makeEnv(1);
    await assert.rejects(run(env, m, {}));
    assert.strictEqual(env.calls.length, 1, m + ' must not retry');
  }
  console.log('api-client.test.js: ok');
})().catch((e) => { console.error(e); process.exit(1); });
