const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(value, message) { if (!value) throw new Error(message); }
const front = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(path.join(front, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(front, 'assets', 'dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(front, 'assets', 'dashboard.css'), 'utf8');
const geo = JSON.parse(fs.readFileSync(path.join(front, 'assets', 'kpp-districts.geojson'), 'utf8'));

new vm.Script(js, { filename: 'frontend/assets/dashboard.js' });

// Landing keeps the login contract used by the existing app script.
['id="loginPage"', 'id="loginPhone"', 'id="loginBtn"', 'onclick="login()"', "toggleAuth('register')", 'id="registerPage"'].forEach(s => assert(html.includes(s), 'login markup missing: ' + s));
['id="dashMap"', 'id="dashKpis"', 'id="dashHarvest"', 'id="dashMaterials"', 'id="dashTable"', 'id="dashDistrict"', 'id="dashSearch"'].forEach(s => assert(html.includes(s), 'dashboard markup missing: ' + s));
assert(html.includes('assets/dashboard.js?v=1.5.0') && html.includes('assets/dashboard.css?v=1.5.0'), 'dashboard assets are not linked');
assert(html.indexOf('assets/config.js') < html.indexOf('assets/dashboard.js'), 'config must load before the dashboard');

// Dashboard calls only the aggregate endpoint and renders no personal fields.
assert(js.includes("api: 'v1', endpoint: 'summary'"), 'dashboard must call api=v1&endpoint=summary');
assert(!/getMatchingDataServer|\.phone\b|\.lat\b|\.lng\b/.test(js), 'dashboard must not touch personal or plot-level data');

// Boundaries: 11 Kamphaeng Phet districts with attribution.
assert(geo.features.length === 11 && geo.features.every(f => f.properties.code.startsWith('62')), 'district GeoJSON must hold the 11 Kamphaeng Phet districts');
assert(/CC BY 4\.0/.test(geo.attribution) && /CC BY 4\.0/.test(js), 'boundary data attribution is missing');

assert(css.includes('prefers-reduced-motion'), 'reduced-motion rule missing');
console.log('PASS: public dashboard markup, aggregate-only API use, boundaries and attribution');
