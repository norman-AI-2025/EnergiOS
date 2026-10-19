const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScript(name, extra = {}) {
  const context = {
    window: { location: { hostname: '127.0.0.1', protocol: 'http:' } },
    document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, ...extra,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', name), 'utf8'), context);
  return context;
}

test('weather HTTP error is preserved without retrying fallback origins', async () => {
  let requests = 0;
  const context = loadScript('api.js', {
    fetch: async () => {
      requests += 1;
      return { ok: false, status: 503, json: async () => ({ detail: 'Weather forecast is temporarily unavailable' }) };
    },
  });
  await assert.rejects(context.window.apiClient.getSolarGridRecommendation({ asset_id: 'bdg2' }),
    /Weather forecast is temporarily unavailable/);
  assert.equal(requests, 1);
});

test('recommendation queues AI cards and keeps the standalone result hidden', () => {
  let queued;
  const result = { classList: { add(value) { assert.equal(value, 'hidden'); } } };
  const context = loadScript('digital_twin_app.js');
  context.document.getElementById = () => result;
  context.window.dispatchPlans = { enqueue(data) { queued = data; return 0; } };
  context.window.twinApp.restoreAiChat = () => { throw Error('duplicate must not reopen panel'); };
  const engineResult = { recommendation_id: 'engine-calculated-id', transitions: [] };
  context.window.twinApp.renderSolarGridRecommendation(engineResult);
  assert.equal(queued, engineResult);
});

test('failed calculation keeps the inputs and re-enables retry', async () => {
  const status = { textContent: '' };
  const button = { disabled: false, textContent: '' };
  const elements = { 'solar-grid-form': {}, 'solar-grid-status': status,
    'solar-grid-run': button, 'solar-grid-result': { classList: { add() {} } } };
  const context = loadScript('digital_twin_app.js', {
    FormData: class { get(key) { return key === 'asset_id' ? 'selected-bdg2-id' : ''; } },
  });
  context.document.getElementById = (id) => elements[id];
  context.window.apiClient = { getSolarGridRecommendation: async (payload) => {
    assert.equal(payload.asset_id, 'selected-bdg2-id');
    throw new Error('Weather unavailable');
  } };
  await context.window.twinApp.runSolarGridScenario();
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /Weather unavailable/);
  assert.match(status.textContent, /inputs are kept/);
});
