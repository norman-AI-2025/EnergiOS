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
    assumptions: { grid_available: true, battery_capacity_kwh: 400, battery_initial_soc_pct: 60, charge_efficiency: 0.92 },
    estimated_grid_cost: price === null ? null : { currency: 'MYR', price_per_kwh: price },
    hours: Array.from({ length: 24 }, (_, i) => ({
      demand_forecast_timestamp: new Date(Date.UTC(2018, 0, 1, i)).toISOString(),
      demand_forecast_kwh: 100, solar_to_load_kwh: 20, battery_to_load_kwh: 10,
      grid_to_load_kwh: 70, unmet_demand_kwh: 0, battery_soc_kwh: 240,
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

test('matching-period savings account for depleted battery inventory and never credit load shifting', () => {
  const { app } = load(), plan = approvedPlan(0.5);
  plan.result.hours[23].battery_soc_kwh = 148;
  const r = app.calculateApprovedPlanSavings(plan, 'test-asset');
  assert.equal(r.replenishmentKwh, 100);
  assert.equal(r.optimisedGridKwh, 1780);
  assert.equal(r.netGridSavedKwh, 620);
  assert.equal(r.costAvoidedRm, 310);
  assert.equal(r.baselineCostRm, 1200);
  assert.equal(r.optimisedCostRm, 890);
  assert.equal(r.costSavedPct, 620 / 2400 * 100);
  assert.equal(r.consumptionSavedKwh, 0);
  assert.equal(r.maximumDemandSavings, null);
  delete plan.result.assumptions.charge_efficiency;
  assert.equal(app.calculateApprovedPlanSavings(plan, 'test-asset').netGridSavedKwh, 480);
  for (const h of plan.result.hours) { h.solar_to_load_kwh = 0; h.battery_to_load_kwh = 0; h.grid_to_load_kwh = 100; }
  assert.equal(app.calculateApprovedPlanSavings(plan, 'test-asset').netGridSavedKwh, 0);
  assert.equal(app.calculateApprovedPlanSavings(plan, 'test-asset', {tariffRmPerKwh:0}).costSavedPct, null);
});

test('daily and monthly controls load calendar summaries and retain retryable errors', async () => {
  const { app, context, elements } = load();
  context.document.querySelectorAll = () => [];
  elements['history-coverage'] = {textContent:''};
  app.state.activeBuildingId='test-asset';
  app.renderEnergyOverviewChart=()=>{};
  const calls=[];
  context.window.apiClient={getReadingSummary:async(id,period)=>{
    calls.push([id,period]);
    return {asset_id:id,timezone:'US/Central',items:[{period:period === 'daily' ? '2017-12-25' : '2017-12',observed_kwh:123,
      observed_intervals:168,expected_intervals:744}]};
  }};
  await app.setTimeframe('Daily');
  await app.setTimeframe('Monthly');
  assert.equal(calls[0][1],'daily');
  assert.equal(calls[1][1],'monthly');
  assert.match(elements['history-coverage'].textContent,/168\/744/);
  assert.match(elements['history-coverage'].textContent,/partial/);
  context.window.apiClient.getReadingSummary=async()=>{throw new Error('offline');};
  await app.setTimeframe('Monthly');
  assert.match(elements['history-coverage'].textContent,/again to retry/);
});

test('historical views trim empty edges, preserve internal gaps and do not present totals as forecasts', () => {
  const { app } = load();
  const b=(period,count)=>({period,observed_intervals:count,expected_intervals:24,observed_kwh:count ? count*10 : null});
  const daily=app.historyPresentation({timezone:'US/Central',items:[b('2017-12-24',0),b('2017-12-25',24),b('2017-12-26',0),b('2017-12-27',24),b('2017-12-28',0)]},'Daily');
  assert.equal(daily.items.length,3);
  assert.equal(daily.items[1].observed_kwh,null);
  assert.equal(daily.labels[0],'25 Dec');
  assert.match(daily.coverage,/48\/72 hours/);
  assert.match(daily.coverage,/Next 24h forecast in Hourly/);
  const monthly=app.historyPresentation({timezone:'US/Central',items:[{...b('2017-12',168),expected_intervals:744,first_observed_date:'2017-12-25',last_observed_date:'2017-12-31'}]},'Monthly');
  assert.equal(monthly.labels[0],'Dec 2017');
  assert.match(monthly.coverage,/2017-12-25.*2017-12-31/);
  assert.match(monthly.coverage,/168\/744/);
  assert.equal(app.historyPresentation({timezone:'UTC',items:[b('2017-12-01',0)]},'Daily').items.length,0);
});

test('calendar charts keep observed and 24h forecasts separate and identify the connecting anchor', () => {
  const { app }=load();
  const summary={timezone:'US/Central',items:[{period:'2017-12',observed_kwh:700,observed_intervals:168,expected_intervals:744}],
    forecast:{horizon_hours:24,items:[{period:'2018-01',forecast_kwh:100,forecast_intervals:24,expected_intervals:744,status:'partial'}]}};
  const original=JSON.stringify(summary), view=app.historyPresentation(summary,'Monthly');
  assert.equal(view.labels.join(','),'Dec 2017,Jan 2018');
  assert.equal(view.observedValues[0],700);
  assert.equal(view.observedValues[1],null);
  assert.equal(view.forecastValues[0],700); // explicitly identified observed anchor, never a predicted total
  assert.equal(view.forecastValues[1],100);
  assert.equal(view.anchor,0);
  assert.match(view.coverage,/next 24 forecast hours/);
  assert.match(view.coverage,/partial-month subtotal/);
  assert.equal(JSON.stringify(summary),original);
});

test('demand cards use selected observed periods, true load factor and no invented area or daily MAE', () => {
  const {app,elements}=load();
  app.state.currentBuilding={timezone:'UTC',floor_area_m2:100};
  app.state.readings={items:readings(10,20)};
  app.state.readings.items[47].consumption_kwh=40;
  app.state.forecast=forecast();
  for(const id of ['dial-power-val','bar-consuming-val','bar-temp-val','battery-pct-val','demand-period-note']) elements[id]={textContent:''};
  app.state.activeTimeframe='Hourly';app.updatePeriodCards();
  assert.equal(elements['dial-power-val'].textContent,'40');
  assert.equal(app.periodEvidence().total,500);
  assert.equal(app.periodEvidence().factor,500/24/40*100);
  app.state.activeTimeframe='Daily';app.updatePeriodCards();
  assert.equal(elements['dial-power-val'].textContent,'20.8');
  assert.match(elements['bar-consuming-val'].textContent,/5.00 kWh/);
  app.state.activeTimeframe='Monthly';
  app.state.readingSummary={items:[{period:'2017-01',expected_intervals:744}]};
  app.updatePeriodCards();
  assert.equal(elements['dial-power-val'].textContent,'15.4');
  assert.match(elements['demand-period-note'].textContent,/48\/744/);
  assert.match(elements['bar-temp-val'].textContent,/Hourly MAE 20/);
  delete app.state.currentBuilding.floor_area_m2;
  app.updatePeriodCards();assert.equal(elements['bar-consuming-val'].textContent,'Area not available');
  app.state.readings.items[0].consumption_kwh=NaN;
  assert.equal(app.periodEvidence().rows.length,47);
  app.state.readingSummary={items:[{period:'2017-01',observed_kwh:2000,observed_intervals:100,
    expected_intervals:744,min_hourly_kw:10,max_hourly_kw:50,latest_hourly_kw:45}]};
  assert.equal(app.periodEvidence().total,2000); // full backend period, not the truncated dashboard reading window
  assert.equal(app.periodEvidence().mean,20);
  assert.equal(app.periodEvidence().factor,40);
});

test('complete dashboard refresh retains EUI and all period card calculations', () => {
  const {app,elements}=load();
  app.state.currentBuilding={timezone:'UTC',floor_area_m2:100};
  app.state.readings={items:readings(10,20)};app.state.forecast=forecast();
  elements['impact-eui-val']={textContent:''};elements['dial-power-val']={textContent:''};
  assert.doesNotThrow(()=>app.updateProjectReadings());
  assert.equal(elements['impact-eui-val'].textContent,'4.80 kWh/m² · Day');
  assert.equal(elements['dial-power-val'].textContent,'20');
});

test('battery period grouping preserves engine energy, final SOC, reserve and preview provenance', () => {
  const {app,context,elements}=load();
  let soc=500;
  const hours=Array.from({length:24},(_,i)=>{
    const charge=i<6?10:0,discharge=i>=12?5:0;soc+=charge-discharge;
    return {weather_timestamp:`2026-10-19T${String(i).padStart(2,'0')}:00`,solar_to_battery_kwh:charge,
      battery_to_load_kwh:discharge,battery_soc_kwh:soc,demand_forecast_kwh:100};
  });
  const plan={result:{asset_id:'a',weather:{timezone:'Asia/Kuala_Lumpur'},hours,
    assumptions:{battery_capacity_kwh:1000,battery_reserve_pct:20,discharge_efficiency:1,max_discharge_kw:20}},transition:{hour_index:0}};
  app.state.activeBuildingId='a';context.window.dispatchPlans={forAsset:()=>plan};
  for(const mode of ['Hourly','Daily','Monthly']) {
    app.state.activeTimeframe=mode;
    const view=app.batteryPeriodView();
    assert.equal(view.items.length,mode==='Hourly'?24:1);
    assert.equal(view.charge,60);assert.equal(view.discharge,60);
    assert.equal(view.items.at(-1).soc,50);
    assert.equal(view.charging,6);assert.equal(view.storing,6);assert.equal(view.discharging,12);
  }
  elements['gauge-percent']={textContent:''};elements['metric-duration']={textContent:''};
  app.updateBatteryStorageMetrics();
  assert.equal(elements['gauge-percent'].textContent,'50.0%');
  assert.match(elements['metric-duration'].textContent,/Power limit/);
  context.window.dispatchPlans.forAsset=()=>null;
  app.kpiScenarios.set('a',{status:'ready',result:plan.result});
  assert.equal(app.dashboardDispatch().kind,'Demo projection');
  app.kpiScenarios.clear();
  assert.equal(app.batteryPeriodView(),null);
  plan.result.hours[0].battery_soc_kwh=1001;
  assert.equal(app.batteryPeriodView(plan),null);
});

test('missing weather can use the central fixed demo profile without approving a plan', async () => {
  const {app,context}=load(); app.state.activeBuildingId='a';let fallback=0;
  context.window.apiClient={getSolarGridRecommendation:async()=>{throw new Error('weather offline');},
    getVideoDispatch:async id=>{fallback++;return {...approvedPlan().result,asset_id:id};}};
  await app.loadKpiScenario('a');
  assert.equal(fallback,1);assert.equal(app.kpiScenarios.get('a').status,'ready');
  assert.match(app.kpiScenarios.get('a').source,/Fixed demo/);
  assert.equal(app.dashboardDispatch().kind,'Demo projection');
});

test('monthly energy uses real daily detail rather than connecting unequal monthly subtotals', () => {
  const {app}=load();
  const b=(period,value)=>({period,observed_kwh:value,observed_intervals:24,expected_intervals:24});
  const r={timezone:'US/Central',items:[b('2017-12',999)],daily_detail:{timezone:'US/Central',items:[b('2017-12-30',100),b('2017-12-31',120)],
    forecast:{items:[{period:'2018-01-01',forecast_kwh:130,forecast_intervals:24,expected_intervals:24}]}}};
  const view=app.historyPresentation(r,'Monthly');
  assert.equal(view.monthlyDetail,true);
  assert.equal(view.labels.join(','),'30 Dec,31 Dec,1 Jan');
  assert.equal(view.observedValues[0],100);
  assert.equal(view.forecastValues.at(-1),130);
  assert.equal(view.observedValues.includes(999),false);
});

test('battery demo source loads grouped data without modifying an approved plan', async () => {
  const {app,context,elements}=load(), approved=approvedPlan();
  for (const h of approved.result.hours) h.solar_to_battery_kwh=0;
  context.window.dispatchPlans={forAsset:()=>approved};const before=JSON.stringify(approved);
  app.state.activeBuildingId='test-asset';app.state.activeTimeframe='Monthly';
  const h={weather_timestamp:'2026-12-31T23:00',battery_soc_kwh:160,battery_to_load_kwh:10,solar_to_battery_kwh:0,demand_forecast_kwh:100};
  const result={asset_id:'test-asset',period:'monthly',version:'demo_v1',timezone:'Asia/Kuala_Lumpur',scope:'2026',scope_hours:8760,
    assumptions:{battery_capacity_kwh:800,battery_reserve_pct:20,discharge_efficiency:.92,max_discharge_kw:100},
    storage_hour:h,items:Array.from({length:12},(_,i)=>({key:`2026-${String(i+1).padStart(2,'0')}`,count:720,charge:200+i,discharge:150+i,soc:35+i*3,min_soc:20,max_soc:90,state:'cycling'})),
    totals:{charge:2466,discharge:1866,charging:1000,discharging:2000,storing:5760,demand_kwh:876000}};
  context.window.apiClient={getBatteryDemo:async()=>result};
  elements['battery-level-chart']={};context.Chart=class {constructor(_el,config){this.data=config.data;} destroy(){}};
  app.setBatteryDataMode('demo');await app.loadBatteryDemo();
  const view=app.batteryPeriodView();
  assert.equal(view.synthetic,true);assert.equal(view.items.length,12);assert.equal(view.hourCount,8760);
  assert.equal(app.batteryOperationsChart.data.datasets[0].label,'Charge (kWh)');
  assert.equal(app.batteryOperationsChart.data.datasets[1].data[0],150);
  assert.deepEqual(Array.from(app.batteryOperationsChart.data.datasets[2].data),result.items.map(b=>b.soc));
  assert.equal(app.batteryOperationsChart.data.datasets[2].data[11],68);
  assert.equal(JSON.stringify(approved),before);
  app.setBatteryDataMode('plan');assert.equal(app.dashboardDispatch().kind,'Approved scenario');
  assert.notEqual(app.batteryPeriodView()?.synthetic,true);
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
