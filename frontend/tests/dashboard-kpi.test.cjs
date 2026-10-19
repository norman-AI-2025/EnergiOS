const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const storage = new Map();
  const elements = {};
  const context = {
    window: { addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {}, getElementById(id) { return elements[id] || null; } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    console, setTimeout, clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/velora_app.js'), 'utf8'), context);
  return { app: context.window.veloraApp, storage, elements, context };
}

function readings(prior = 100, current = 80) {
  return Array.from({ length: 48 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2017, 0, 1, i)).toISOString(),
    consumption_kwh: i < 24 ? prior : current, interval_minutes: 60,
    label: 'observed', quality_status: 'observed',
  }));
}
function forecast(model = 20, baseline = 25) {
  return { items: [], test_metrics: {
    model: { n: 100, mae_kwh: model }, baseline: { n: 100, mae_kwh: baseline },
  } };
}

function approvedPlan(price = null) {
  return { appliedAt: '2026-10-19T01:00:00Z', result: {
    asset_id: 'test-asset', result_type: 'simulated_solar_grid_recommendation',
    assumptions: { grid_available: true },
    estimated_grid_cost: price === null ? null : { currency: 'MYR', price_per_kwh: price },
    hours: Array.from({ length: 24 }, (_, i) => ({
      demand_forecast_timestamp: new Date(Date.UTC(2018, 0, 1, i)).toISOString(),
      demand_forecast_kwh: 100, solar_to_load_kwh: 20, battery_to_load_kwh: 10,
      grid_to_load_kwh: 70, unmet_demand_kwh: 0,
    })),
  } };
}

test('matched 24-hour windows calculate reductions, optional impacts and model improvement', () => {
  const { app } = load();
  const result = app.calculateKpiContext(readings(), forecast(), { tariffRmPerKwh: 0.5, emissionsKgPerKwh: 0.6 });
  assert.equal(result.energySavedKwh, 480);
  assert.equal(result.energySavedPct, 20);
  assert.equal(result.costAvoidedRm, 240);
  assert.equal(result.carbonAvoidedKg, 288);
  assert.equal(result.maeImprovementKwh, 5);
  assert.equal(result.maeImprovementPct, 20);
});

test('missing, nonnumeric or negative assumptions never acquire default rates; explicit zero works', () => {
  const { app } = load();
  for (const assumptions of [{}, { tariffRmPerKwh: null, emissionsKgPerKwh: '' },
    { tariffRmPerKwh: -1, emissionsKgPerKwh: NaN }]) {
    const result = app.calculateKpiContext(readings(), forecast(), assumptions);
    assert.equal(result.costAvoidedRm, null);
    assert.equal(result.carbonAvoidedKg, null);
  }
  assert.equal(app.calculateKpiContext(readings(), forecast(), { tariffRmPerKwh: 0 }).costAvoidedRm, 0);
});

test('gaps, duplicates, partial windows, bad values and nonobserved intervals invalidate savings', () => {
  const { app } = load();
  const cases = [readings().slice(1), readings(0, 80)];
  for (const change of [row => { row.timestamp = 'invalid'; }, row => { row.consumption_kwh = null; },
    row => { row.consumption_kwh = -1; }, row => { row.interval_minutes = 30; },
    row => { row.quality_status = 'missing'; }, row => { row.label = 'forecast'; },
    row => { row.timestamp = readings()[24].timestamp; }]) {
    const rows = readings(); change(rows[25]); cases.push(rows);
  }
  for (const rows of cases) {
    const result = app.calculateKpiContext(rows, forecast(), { tariffRmPerKwh: 0.5 });
    assert.equal(result.energySavedKwh, null);
    assert.equal(result.costAvoidedRm, null);
    assert.equal(result.maeImprovementKwh, 5);
  }
});

test('increased consumption and worse forecasts do not become positive savings or improvements', () => {
  const { app } = load();
  const result = app.calculateKpiContext(readings(80, 100), forecast(30, 25), {
    tariffRmPerKwh: 0.5, emissionsKgPerKwh: 0.6,
  });
  assert.equal(result.energySavedKwh, -480);
  assert.equal(result.energySavedPct, -25);
  assert.equal(result.costAvoidedRm, 0);
  assert.equal(result.carbonAvoidedKg, 0);
  assert.equal(result.maeImprovementKwh, -5);
  assert.equal(result.maeImprovementPct, -20);
});

test('absent or unmatched evaluation metrics have no fabricated improvement', () => {
  const { app } = load();
  const mismatched = forecast(); mismatched.test_metrics.baseline.n = 99;
  for (const value of [null, {}, mismatched, forecast(null, 25), forecast(20, NaN)]) {
    assert.equal(app.calculateKpiContext(readings(), value).maeImprovementKwh, null);
  }
  const zero = app.calculateKpiContext(readings(), forecast(0, 0));
  assert.equal(zero.maeImprovementKwh, 0);
  assert.equal(zero.maeImprovementPct, null);
});

test('rendering preserves main values and hides carbon until explicitly configured', () => {
  const { app, elements, storage, context } = load();
  for (const id of ['metric-total-val', 'metric-current-val', 'metric-export-val',
    'metric-total-delta', 'metric-current-status', 'metric-export-delta']) elements[id] = { textContent: 'unchanged' };
  app.state.readings = { items: readings() }; app.state.forecast = forecast();
  // Existing settings contain a peak rate without its schedule. It is not a flat price.
  storage.set('ENERGIOS_SETTINGS', JSON.stringify({ peakRate: 0.584 }));
  app.renderKpiContext();
  assert.equal(elements['metric-total-delta'].textContent, 'Estimated grid electricity saved: Not available');
  assert.equal(elements['metric-current-status'].textContent, 'Estimated grid purchase cost saved: Not available');
  assert.match(elements['metric-export-delta'].textContent, /improvement: 5.00 kWh \(20.0%\)/);
  for (const id of ['metric-total-val', 'metric-current-val', 'metric-export-val']) assert.equal(elements[id].textContent, 'unchanged');
  app.state.activeBuildingId = 'test-asset';
  context.window.dispatchPlans = { forAsset: () => approvedPlan() };
  storage.set('ENERGIOS_KPI_ASSUMPTIONS_V1', JSON.stringify({ tariffRmPerKwh: 0.5, emissionsKgPerKwh: 0.6 }));
  app.renderKpiContext();
  assert.match(elements['metric-total-delta'].textContent, /720.0 kWh \(30.0%\)/);
  assert.match(elements['metric-current-status'].textContent, /RM 360.00.*solar-only emissions saved: 288.0 kg CO₂e/);
  app.state.activeBuildingId = 'different-building';
  app.state.readings = { items: [] }; app.state.forecast = null; app.renderKpiContext();
  assert.match(elements['metric-total-delta'].textContent, /Not available/);
  assert.match(elements['metric-export-delta'].textContent, /Not available/);
  assert.doesNotMatch(elements['metric-current-status'].textContent, /360|288/);
});

test('editing and clearing assumption fields persists explicit inputs and refreshes subtitles', () => {
  const { app, elements, storage, context } = load();
  for (const id of ['kpi-tariff', 'kpi-emissions']) {
    elements[id] = { value: '', addEventListener(name, callback) { this[name] = callback; } };
  }
  elements['metric-current-status'] = { textContent: '' };
  app.state.readings = { items: readings() }; app.state.forecast = forecast();
  app.state.activeBuildingId = 'test-asset';
  context.window.dispatchPlans = { forAsset: () => approvedPlan() };
  app.setupKpiAssumptions();
  elements['kpi-tariff'].value = '0.5'; elements['kpi-tariff'].input();
  assert.match(elements['metric-current-status'].textContent, /RM 360.00/);
  elements['kpi-tariff'].value = ''; elements['kpi-tariff'].input();
  assert.equal(elements['metric-current-status'].textContent, 'Estimated grid purchase cost saved: Not available');
  assert.deepEqual(JSON.parse(storage.get('ENERGIOS_KPI_ASSUMPTIONS_V1')), {});
});

test('approved forecast dispatch estimates grid displacement without claiming a reduction in building demand', () => {
  const { app } = load(); const plan = approvedPlan(0.5); const original = JSON.stringify(plan);
  const result = app.calculateApprovedPlanSavings(plan, 'test-asset');
  assert.equal(result.available, true);
  assert.equal(result.demandKwh, 2400);
  assert.equal(result.gridDisplacedKwh, 720);
  assert.equal(result.gridDisplacedPct, 30);
  assert.equal(result.costAvoidedRm, 360);
  assert.equal(result.carbonAvoidedKg, null);
  assert.equal(JSON.stringify(plan), original);
  assert.equal('savingsProbability' in result, false);
});

test('outage, unmet demand, missing intervals, invalid values and other assets cannot produce savings', () => {
  const { app } = load();
  const cases = [null, { result: approvedPlan().result }];
  for (const mutate of [p => { p.result.hours.pop(); }, p => { p.result.hours[2] = null; },
    p => { p.result.hours[2].demand_forecast_timestamp = p.result.hours[1].demand_forecast_timestamp; },
    p => { p.result.hours[2].solar_to_load_kwh = NaN; },
    p => { p.result.hours[2].battery_to_load_kwh = -1; },
    p => { p.result.hours[2].grid_to_load_kwh = 10; },
    p => { p.result.hours[2].unmet_demand_kwh = 1; p.result.hours[2].grid_to_load_kwh = 69; },
    p => { p.result.assumptions.grid_available = false; }, p => { p.result.asset_id = 'other-building'; }]) {
    const plan = approvedPlan(); mutate(plan); cases.push(plan);
  }
  for (const plan of cases) assert.equal(app.calculateApprovedPlanSavings(plan, 'test-asset').available, false);
});

test('RM tariff sources are explicit, zero is valid, other currencies are never silently converted', () => {
  const { app } = load(); const plan = approvedPlan(0.5);
  assert.equal(app.calculateApprovedPlanSavings(plan, 'test-asset', { tariffRmPerKwh: 0 }).costAvoidedRm, 0);
  plan.result.estimated_grid_cost.currency = 'USD';
  assert.equal(app.calculateApprovedPlanSavings(plan, 'test-asset').costAvoidedRm, null);
  assert.equal(app.calculateApprovedPlanSavings(plan, 'test-asset', { tariffRmPerKwh: 0.25 }).costAvoidedRm, 180);
  plan.result.estimated_grid_cost = null;
  assert.equal(app.calculateApprovedPlanSavings(plan, 'test-asset').costAvoidedRm, null);
  const result = app.calculateApprovedPlanSavings(plan, 'test-asset', { emissionsKgPerKwh: 0.6 });
  assert.equal(result.carbonAvoidedKg, 288); // 480 solar kWh; never credit unverified battery charging.
});

test('other buildings request their own forecast scenario using disclosed shared inputs without approval', async () => {
  const { app, context, storage } = load();
  const approved = approvedPlan(0.5);
  approved.result.asset_name = 'Template building';
  approved.result.location = { name: 'Demo coordinates', latitude: 3.139, longitude: 101.6869 };
  approved.result.assumptions = { grid_available: true, pv_capacity_kwp: 75, battery_initial_soc_pct: 60 };
  const before = JSON.stringify(approved), calls = [];
  context.window.dispatchPlans = { forAsset: () => null, active: () => approved };
  context.window.apiClient = { async getSolarGridRecommendation(inputs) {
    calls.push(inputs);
    const result = approvedPlan(0.5).result;
    result.asset_id = inputs.asset_id;
    // Different asset demand remains different under the same equipment assumptions.
    if (inputs.asset_id === 'building-b') for (const h of result.hours) {
      h.demand_forecast_kwh = 200; h.grid_to_load_kwh = 170;
    }
    return result;
  } };
  app.state.activeBuildingId = 'building-a';
  await app.loadKpiScenario('building-a');
  await app.loadKpiScenario('building-b');
  const a = app.calculateScenarioSavings(app.kpiScenarios.get('building-a').result, 'building-a');
  const b = app.calculateScenarioSavings(app.kpiScenarios.get('building-b').result, 'building-b');
  assert.equal(a.gridDisplacedPct, 30); assert.equal(b.gridDisplacedPct, 15);
  assert.equal(calls[0].asset_id, 'building-a'); assert.equal(calls[1].asset_id, 'building-b');
  assert.equal(calls[1].battery_soc_pct, 60); assert.equal(calls[1].pv_capacity_kwp, 75);
  assert.equal(calls[1].grid_price_per_kwh, 0.5); assert.equal(calls[1].grid_price_currency, 'MYR');
  assert.match(app.kpiScenarios.get('building-b').source, /not approved/);
  assert.equal(JSON.stringify(approved), before); assert.equal(storage.size, 0);
});

test('scenario previews cache per asset and inputs, never overwrite a newly selected building', async () => {
  const { app, context } = load(); const pending = {}, calls = [], rendered = [];
  context.window.dispatchPlans = { forAsset: () => null };
  context.window.apiClient = { getSolarGridRecommendation(inputs) {
    calls.push(inputs); return new Promise(resolve => { pending[inputs.asset_id] = resolve; });
  } };
  app.renderKpiContext = () => rendered.push(app.state.activeBuildingId);
  app.state.activeBuildingId = 'a'; const a = app.loadKpiScenario('a');
  const repeated = app.loadKpiScenario('a');
  app.state.activeBuildingId = 'b'; const b = app.loadKpiScenario('b');
  const response = asset => ({ ...approvedPlan().result, asset_id: asset });
  pending.b(response('b')); await b;
  const before = rendered.length;
  pending.a(response('a')); await a; await repeated;
  assert.equal(rendered.length, before); assert.equal(calls.length, 2);
  await app.loadKpiScenario('a'); assert.equal(calls.length, 2);
  let pv = 80;
  context.window.dispatchPlans.active = () => ({ result: { assumptions: { pv_capacity_kwp: pv } } });
  const changed = app.loadKpiScenario('a'); pending.a(response('a')); await changed;
  assert.equal(calls.length, 3); assert.equal(calls[2].pv_capacity_kwp, 80);
});

test('failed scenarios keep real metrics usable, retry safely, and missing tariffs remain unavailable', async () => {
  const { app, context, elements } = load(); let fail = true;
  app.state.activeBuildingId = 'b'; app.state.readings = { items: readings() };
  app.state.forecast = forecast(30, 25);
  for (const id of ['metric-total-delta', 'metric-current-status', 'metric-export-delta', 'kpi-estimate-evidence']) {
    elements[id] = { textContent: '', style: {} };
  }
  context.window.apiClient = { async getSolarGridRecommendation() {
    if (fail) throw new Error('Weather unavailable');
    return { ...approvedPlan().result, asset_id: 'b' };
  } };
  await app.loadKpiScenario('b');
  assert.match(elements['kpi-estimate-evidence'].textContent, /Weather unavailable.*retry/);
  assert.match(elements['metric-export-delta'].textContent, /worsened: 5.00 kWh/);
  assert.equal(elements['metric-export-delta'].style.color, '#e11d48');
  fail = false; await app.loadKpiScenario('b', true);
  assert.match(elements['metric-total-delta'].textContent, /720.0 kWh \(30.0%\)/);
  assert.equal(elements['metric-current-status'].textContent, 'Estimated grid purchase cost saved: Not available');
  assert.equal(elements['metric-current-status'].style.color, '#71767B');
  assert.match(elements['kpi-estimate-evidence'].textContent, /Unapproved preview.*enter a flat RM\/kWh/);
});

test('preview refresh validates returned asset and never recalculates or approves an existing approved plan', async () => {
  const { app, context } = load(); let approved = null, calls = 0;
  context.window.dispatchPlans = { forAsset: () => approved };
  context.window.apiClient = { async getSolarGridRecommendation() { calls++; return approvedPlan().result; } };
  app.state.activeBuildingId = 'different'; await app.loadKpiScenario('different');
  assert.equal(app.kpiScenarios.get('different').status, 'error');
  assert.match(app.kpiScenarios.get('different').error, /different building/);
  approved = approvedPlan(); app.state.activeBuildingId = 'test-asset';
  await app.loadKpiScenario('test-asset', true); assert.equal(calls, 1);
});
