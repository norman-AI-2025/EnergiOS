const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const memory = new Map(), elements = {};
  const storage = { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v) };
  const c = { localStorage: storage, window: { addEventListener() {}, dispatchEvent() {} },
    document: { readyState: 'loading', addEventListener() {}, getElementById: id => elements[id] || null,
      querySelectorAll: () => [] }, CustomEvent: class {}, console };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/dispatch_plans.js'), 'utf8'), c);
  return { store: c.window.dispatchPlans, ui: c.window.dispatchPlanUI, c, elements };
}
function result() {
  return { result_type: 'simulated_solar_grid_recommendation', recommendation_id: 'b'.repeat(64),
    asset_id: 'real-bdg2-id', asset_name: 'Hog_office_Bill',
    weather: { timezone: 'Asia/Kuala_Lumpur', retrieved_at_utc: '2026-10-19', uncertainty: 'Indicative' },
    location: { name: 'Separate demo location' }, demand_basis: 'Historical BDG2 forecast and demo weather are independent timelines.',
    assumptions: { battery_capacity_kwh: 100, battery_reserve_pct: 20, pv_capacity_kwp: 50, dispatch_policy: 'Solar first; retain reserve.' },
    estimated_grid_cost: null, source_mix_kwh: { solar_to_load_kwh: 120, battery_to_load_kwh: 20 },
    hours: [{ demand_forecast_kwh: 100, solar_to_load_kwh: 50, battery_to_load_kwh: 10,
      grid_to_load_kwh: 40, unmet_demand_kwh: 0, battery_soc_kwh: 30, solar_to_battery_kwh: 0,
      curtailed_solar_kwh: 0, weather_timestamp: '2026-10-19T10:00' }],
    transitions: [{ id: 'a'.repeat(24), hour_index: 0, direction: 'Grid → Solar', at: '2026-10-19T10:00',
      from: 'grid', to: 'mixed', note: 'Mixed supply remains mixed.',
      reasons: ['Use weather-estimated solar first.', 'Grid supplies the remaining load.'],
      source_mix_kwh: { solar_to_load_kwh: 50, battery_to_load_kwh: 10, grid_to_load_kwh: 40, unmet_demand_kwh: 0 } }] };
}

function videoResult() {
  const r = result();
  r.video_demo = { version: 'video_v1', profile_hash: 'profile-hash', review_id: 'r'.repeat(32),
    after_hour: 0, current_source: 'grid', expires_at_utc: new Date(Date.now() + 600000).toISOString() };
  r.hours = Array.from({length:24}, (_, i) => ({ ...r.hours[0],
    solar_to_load_kwh: i === 10 ? 100 : 0, battery_to_load_kwh: 0,
    grid_to_load_kwh: i === 10 ? 0 : 100, battery_soc_kwh: 20,
    demand_forecast_timestamp: `2018-01-01T${String(i).padStart(2,'0')}:00:00Z`,
    weather_timestamp: `2026-10-19T${String(i).padStart(2,'0')}:00` }));
  r.transitions[0] = { ...r.transitions[0], hour_index: 10, to: 'solar',
    source_mix_kwh: { solar_to_load_kwh:100, battery_to_load_kwh:0, grid_to_load_kwh:0, unmet_demand_kwh:0 } };
  return r;
}

function videoReceipt(r) {
  return { valid:true, recommendation_id:r.recommendation_id, transition_id:r.transitions[0].id,
    review_id:r.video_demo.review_id, profile_hash:r.video_demo.profile_hash,
    expires_at_utc:r.video_demo.expires_at_utc };
}

test('fixed demo approval requires fresh server review; dismissal never applies the plan', () => {
  const {store} = load(); const r = videoResult();
  store.enqueue(r); assert.equal(store.decide(r.transitions[0].id,'approved'),false);
  const expired = {...videoReceipt(r), expires_at_utc:'2000-01-01T00:00:00Z'};
  assert.equal(store.decide(r.transitions[0].id,'approved',expired),false);
  assert.equal(store.active(),null);
  assert.equal(store.decide(r.transitions[0].id,'dismissed'),true);
  assert.equal(store.active(),null);
  assert.equal(store.enqueue(r),0);
});

test('video approval updates shared values after revalidation and restart restores the previous plan', async () => {
  const {store,ui,c} = load(); const old = result();
  store.enqueue(old); store.decide(old.transitions[0].id,'approved');
  const before = JSON.stringify(store.active());
  const r = videoResult(); r.transitions[0].id = 'd'.repeat(24);
  store.enqueue(r);
  c.window.apiClient = { async reviewVideoDispatch(payload) {
    assert.equal(payload.current_source,'grid'); assert.equal(payload.battery_soc_kwh,20);
    assert.equal(store.active().result.video_demo,undefined);
    return videoReceipt(r);
  } };
  await ui.approveVideo(r.transitions[0].id);
  assert.equal(store.active().transition.to,'solar');
  assert.equal(store.active().result.hours[10].grid_to_load_kwh,0);
  assert.match(ui.reviews.get(r.transitions[0].id),/Approved locally/);
  ui.resetVideoFeedback(r.asset_id); store.resetVideoDemo(r.asset_id);
  assert.equal(ui.reviews.has(r.transitions[0].id),false);
  assert.equal(JSON.stringify(store.active()),before);
  assert.equal(store.read().cards.some(card=>card.result.video_demo),false);
});

test('a dismissed alert or concurrently changed state cannot be approved after the HTTP request', async () => {
  const {store,ui,c} = load(); const r = videoResult(); store.enqueue(r);
  let resolve;
  c.window.apiClient = {reviewVideoDispatch:()=>new Promise(done=>{resolve=done;})};
  const pending = ui.approveVideo(r.transitions[0].id);
  store.decide(r.transitions[0].id,'dismissed'); resolve(videoReceipt(r)); await pending;
  assert.equal(store.active(),null);
  assert.match(ui.reviews.get(r.transitions[0].id),/changed.*current plan was kept/);
});

test('server errors preserve applied state and allow approval retry', async () => {
  const {store,ui,c} = load(); const r = videoResult(); store.enqueue(r);
  c.window.apiClient = {async reviewVideoDispatch(){throw Error('Demo review expired');}};
  await ui.approveVideo(r.transitions[0].id);
  assert.equal(store.active(),null); assert.equal(ui.busy.size,0);
  assert.match(ui.reviews.get(r.transitions[0].id),/expired.*current plan was kept/);
  c.window.apiClient.reviewVideoDispatch=async()=>videoReceipt(r);
  await ui.approveVideo(r.transitions[0].id); assert.equal(store.active().transition.to,'solar');
});

test('video cards disclose authored weather, deduplicate and throttle repeat panel openings', () => {
  const {store,ui,elements} = load(); const r = videoResult();
  elements['dispatch-recommendation-cards']={innerHTML:''};
  assert.equal(store.enqueue(r),1); assert.equal(store.enqueue(r),0);
  const next = videoResult(); next.transitions[0].id='e'.repeat(24);
  assert.equal(store.enqueue(next),0); // Updated card is visible, but no rapid new popup.
  ui.renderCards(); const html=elements['dispatch-recommendation-cards'].innerHTML;
  assert.match(html,/Fixed video demo inputs/); assert.match(html,/Fixed authored weather profile/);
  assert.doesNotMatch(html,/href="https:\/\/open-meteo/);
});

test('tampered fixed-demo allocations cannot be approved even with a review-shaped response', () => {
  const {store}=load(); const r=videoResult(); r.hours[2].grid_to_load_kwh=NaN;
  store.enqueue(r); assert.equal(store.decide(r.transitions[0].id,'approved',videoReceipt(r)),false);
  assert.equal(store.active(),null);
});
test('proposal is not applied until approved; applied values come exactly from the engine', () => {
  const { store } = load(); const r = result();
  assert.equal(store.enqueue(r), 1); assert.equal(store.active(), null);
  assert.equal(store.decide(r.transitions[0].id, 'approved'), true);
  assert.equal(store.active().result.hours[0].grid_to_load_kwh, 40);
  assert.equal(store.forAsset('different-building'), null);
  assert.equal(store.read().audit.length, 1);
  assert.equal(store.impact(store.active()).costAvoided, null);
});
test('dismissal and repeated decisions preserve the applied plan, deduplication survives a new store', () => {
  const { store, c } = load(); const r = result(); store.enqueue(r); store.decide(r.transitions[0].id, 'approved');
  const original = JSON.stringify(store.read().approved);
  const next = result(); next.transitions[0].id = 'c'.repeat(24);
  store.enqueue(next); assert.equal(store.decide(next.transitions[0].id, 'dismissed'), true);
  assert.equal(JSON.stringify(store.read().approved), original);
  assert.equal(store.enqueue(next), 0);
  const reloaded = new c.window.DispatchPlanStore(c.localStorage);
  assert.equal(reloaded.enqueue(next), 0);
  assert.equal(reloaded.decide(next.transitions[0].id, 'approved'), false);
});
test('unbalanced plans cannot be approved and missing tariffs stay unavailable', () => {
  const { store } = load(); const r = result(); r.hours[0].grid_to_load_kwh = 200;
  store.enqueue(r); assert.equal(store.decide(r.transitions[0].id, 'approved'), false);
  assert.equal(store.active(), null);
});
test('impact uses the same source totals and explicit engine price', () => {
  const { store } = load(); const r = result(); r.estimated_grid_cost = { price_per_kwh: 0.5, currency: 'MYR', value: 40 };
  store.enqueue(r); store.decide(r.transitions[0].id, 'approved');
  assert.equal(store.impact(store.active()).costAvoided, 70);
  assert.equal(store.impact(store.active()).gridCost, 40);
});
test('AI cards show actual reasons, mixed allocation, independent timelines, labels and citations', () => {
  const { store, ui, elements } = load(); elements['dispatch-recommendation-cards'] = { innerHTML: '' };
  store.enqueue(result()); ui.renderCards(); const html = elements['dispatch-recommendation-cards'].innerHTML;
  for (const text of ['Grid → Solar', 'Hog_office_Bill', 'Grid supplies the remaining load.', 'mixed',
    'Scenario estimate — no live control', 'independent timelines', '10.5281/zenodo.3887306', 'https://open-meteo.com/en/docs']) assert.ok(html.includes(text));
  assert.match(html, /Approve scenario plan/); assert.match(html, /Dismiss/);
});
test('Gemini failure keeps engine reasons and never changes approved simulation state', async () => {
  const { store, ui, c } = load(); const r = result(); store.enqueue(r);
  c.window.apiClient = { explainSolarGrid: async () => { throw Error('Gemini is not configured'); } };
  await ui.explain(r.transitions[0].id);
  assert.match(ui.explanations.get(r.transitions[0].id), /Engine reasons remain available/);
  assert.equal(store.active(), null);
});

test('approved dispatch powers matching dashboard battery values without overwriting observed KPIs', () => {
  const { store, c, elements } = load(); const r = result();
  store.enqueue(r); store.decide(r.transitions[0].id, 'approved');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/velora_app.js'), 'utf8'), c);
  const app = c.window.veloraApp;
  app.state.activeBuildingId = r.asset_id;
  elements['metric-capacity'] = { textContent: '' };
  elements['gauge-percent'] = { textContent: '' };
  elements['metric-total-val'] = { textContent: 'Observed original total' };
  app.updateBatteryStorageMetrics();
  assert.match(elements['metric-capacity'].textContent, /100.0 kWh · assumption/);
  assert.equal(elements['gauge-percent'].textContent, '30.0%');
  assert.equal(elements['metric-total-val'].textContent, 'Observed original total');
});

test('battery chart and table preserve engine weather-local hours instead of converting naive times to UTC', () => {
  const { store, c, elements } = load(); const r = result();
  store.enqueue(r); store.decide(r.transitions[0].id, 'approved');
  c.Chart = class { constructor(_element, config) { this.data = config.data; } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/velora_app.js'), 'utf8'), c);
  const app = c.window.veloraApp;
  app.state.activeBuildingId = r.asset_id; app.state.readings = { items: [{ consumption_kwh: 100 }] };
  elements['battery-level-chart'] = {};
  elements['battery-operations-table-body'] = { innerHTML: '' };
  app.renderBatteryOperationsChart();
  assert.equal(app.batteryOperationsChart.data.labels[0], '10:00');
  assert.match(elements['battery-operations-table-body'].innerHTML, /2026-10-19 10:00/);
  assert.equal(app.batteryOperationsChart.data.datasets[0].data[0], 30);
});

test('a changed engine forecast retires obsolete pending cards without applying them', () => {
  const { store } = load(); const r = result(); store.enqueue(r);
  const updated = result(); updated.recommendation_id = 'd'.repeat(64); updated.transitions = [];
  store.enqueue(updated);
  assert.equal(store.read().cards[0].status, 'superseded');
  assert.equal(store.decide(r.transitions[0].id, 'approved'), false);
  assert.equal(store.active(), null);
});

test('dashboard island uses engine explanation and does not fabricate telemetry on provider failure', async () => {
  const { c, elements, store } = load(); const r = result(); store.enqueue(r);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/dynamic_island.js'), 'utf8'), c);
  const island = c.window.dynamicIsland;
  island.isExpanded = true; island.addLog = () => {}; island.getActiveBuildingId = () => r.asset_id;
  island.escapeHtml = text => String(text);
  elements['island-user-input'] = { value: 'Explain the solar switch', focus() {} };
  elements['island-agent-bubble-text'] = { innerHTML: '' };
  c.window.apiClient = { explainSolarGrid: async (recommendationId) => {
    assert.equal(recommendationId, r.recommendation_id); throw Error('Provider unavailable');
  }, chat: async () => { throw Error('Dispatch must not use the generic chatbot'); } };
  await island.handleUserSubmit({ preventDefault() {} });
  assert.match(elements['island-agent-bubble-text'].innerHTML, /Assistant unavailable/);
  assert.doesNotMatch(elements['island-agent-bubble-text'].innerHTML, /185.0|22.07|165–200/);
  assert.equal(store.active(), null);
});
