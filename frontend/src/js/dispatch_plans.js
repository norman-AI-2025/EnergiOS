/** Shared browser-local dispatch scenarios. Approval never calls a control API. */
class DispatchPlanStore {
  constructor(storage, notify = () => {}) {
    this.storage = storage;
    this.notify = notify;
    this.key = 'ENERGIOS_DISPATCH_PLANS_V1';
  }
  read() {
    try {
      const saved = JSON.parse(this.storage.getItem(this.key) || 'null');
      if (saved?.version === 1 && Array.isArray(saved.cards) && saved.approved) return saved;
    } catch (_) {}
    return { version: 1, cards: [], approved: {}, activeAssetId: null, audit: [] };
  }
  save(state) {
    this.storage.setItem(this.key, JSON.stringify(state));
    this.notify();
  }
  planToken(assetId) {
    const plan = this.forAsset(assetId);
    return plan ? `${plan.appliedAt}|${plan.result.recommendation_id}|${plan.transition.id}` : '';
  }
  resetVideoDemo(assetId) {
    const state = this.read();
    state.cards = state.cards.filter(card => !(card.result.asset_id === assetId && card.result.video_demo));
    if (state.approved[assetId]?.result.video_demo) {
      const backup = state.videoBackups?.[assetId];
      if (backup) state.approved[assetId] = backup; else delete state.approved[assetId];
    }
    if (state.videoBackups) delete state.videoBackups[assetId];
    if (state.videoNotices) delete state.videoNotices[assetId];
    if (!state.approved[state.activeAssetId]) state.activeAssetId = Object.keys(state.approved)[0] || null;
    state.audit = [...(state.audit || []), { action: 'restart_fixed_demo', assetId,
      at: new Date().toISOString(), label: 'Scenario only; previous non-video plan restored when available' }].slice(-100);
    this.save(state);
  }
  enqueue(result) {
    if (result?.result_type !== 'simulated_solar_grid_recommendation' || !result.recommendation_id) return 0;
    const state = this.read();
    let added = 0;
    const currentIds = new Set((result.transitions || []).map(item => item.id));
    for (const card of state.cards) {
      if (card.result.asset_id === result.asset_id && card.status === 'pending' && !currentIds.has(card.id)) {
        card.status = 'superseded';
      }
    }
    for (const transition of result.transitions || []) {
      if (!/^[a-f0-9]{24}$/.test(transition.id) || !result.hours[transition.hour_index]) continue;
      const card = state.cards.find(item => item.id === transition.id);
      if (card) {
        // Refresh pending facts, but never overwrite an approved or dismissed decision.
        if (card.status === 'pending') { card.result = result; card.transition = transition;
          if (result.video_demo) card.baselineToken = this.planToken(result.asset_id); }
      } else {
        state.cards.push({ id: transition.id, status: 'pending', result, transition,
          baselineToken: result.video_demo ? this.planToken(result.asset_id) : null });
        if (!result.video_demo) added++;
        else {
          state.videoNotices ||= {};
          if (Date.now() - (state.videoNotices[result.asset_id] || 0) >= 15000) {
            added++; state.videoNotices[result.asset_id] = Date.now();
          }
        }
      }
    }
    state.cards = state.cards.slice(-24);
    this.save(state);
    return added;
  }
  decide(id, action, review = null) {
    if (!['approved', 'dismissed'].includes(action)) return false;
    const state = this.read();
    const card = state.cards.find(item => item.id === id);
    if (!card || card.status !== 'pending') return false;
    if (action === 'approved') {
      if (card.result.video_demo) {
        const demo = card.result.video_demo;
        if (card.result.hours.length !== 24 || card.result.hours.some(h =>
          ['demand_forecast_kwh', 'solar_to_load_kwh', 'battery_to_load_kwh', 'grid_to_load_kwh', 'unmet_demand_kwh']
            .some(key => !Number.isFinite(h[key]) || h[key] < 0)
          || h.unmet_demand_kwh > 0 || Math.abs(h.demand_forecast_kwh - h.solar_to_load_kwh - h.battery_to_load_kwh - h.grid_to_load_kwh) > .01)) return false;
        if (!review?.valid || review.recommendation_id !== card.result.recommendation_id
          || review.transition_id !== id || review.review_id !== demo.review_id
          || review.profile_hash !== demo.profile_hash
          || !Number.isFinite(Date.parse(review.expires_at_utc)) || Date.parse(review.expires_at_utc) <= Date.now()
          || this.planToken(card.result.asset_id) !== card.baselineToken) return false;
        state.videoBackups ||= {};
        if (!(card.result.asset_id in state.videoBackups)) state.videoBackups[card.result.asset_id] = state.approved[card.result.asset_id] || null;
      }
      const hour = card.result.hours[card.transition.hour_index];
      if (!hour || Math.abs(hour.demand_forecast_kwh - hour.solar_to_load_kwh
        - hour.battery_to_load_kwh - hour.grid_to_load_kwh - hour.unmet_demand_kwh) > 0.01) return false;
      state.approved[card.result.asset_id] = { result: card.result, transition: card.transition,
        appliedAt: new Date().toISOString() };
      state.activeAssetId = card.result.asset_id;
    }
    card.status = action;
    state.audit = [...(state.audit || []), { id, action, assetId: card.result.asset_id,
      at: new Date().toISOString(), label: 'Scenario estimate — no live control' }].slice(-100);
    this.save(state);
    return true;
  }
  forAsset(assetId) { return this.read().approved[assetId] || null; }
  active() { const state = this.read(); return state.approved[state.activeAssetId] || null; }
  impact(plan) {
    const result = plan.result;
    const displaced = result.source_mix_kwh.solar_to_load_kwh + result.source_mix_kwh.battery_to_load_kwh;
    const cost = result.estimated_grid_cost;
    return { displacedKwh: displaced, costAvoided: cost ? displaced * cost.price_per_kwh : null,
      currency: cost?.currency || '', gridCost: cost?.value ?? null };
  }
}

window.DispatchPlanStore = DispatchPlanStore;
window.dispatchPlans = new DispatchPlanStore(localStorage,
  () => window.dispatchEvent(new CustomEvent('energios:dispatch-updated')));

class DispatchPlanUI {
  constructor() { this.explanations = new Map(); this.reviews = new Map(); this.busy = new Set(); }
  resetVideoFeedback(assetId) {
    for (const card of window.dispatchPlans.read().cards) {
      if (card.result.asset_id === assetId && card.result.video_demo) {
        this.reviews.delete(card.id); this.explanations.delete(card.id);
      }
    }
  }
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  renderCards() {
    const host = document.getElementById('dispatch-recommendation-cards');
    if (!host) return;
    // Show the latest input revision for a building/time/direction, retaining older decisions in the local audit.
    const visible = new Map();
    const focus = window.twinApp?._latestDispatch;
    for (const card of window.dispatchPlans.read().cards) {
      if (card.status === 'superseded') continue;
      if (focus?.video_demo && (!card.result.video_demo || card.result.asset_id !== focus.asset_id)) continue;
      visible.set(`${card.result.asset_id}|${card.transition.at}|${card.transition.direction}`, card);
    }
    host.innerHTML = [...visible.values()].sort((a, b) =>
      a.transition.at.localeCompare(b.transition.at)).map(card => {
      const t = card.transition, r = card.result, mix = t.source_mix_kwh;
      const e = value => this.escape(value);
      return `<article class="bg-[#F4F6F9] dark:bg-[#18202F] border border-[#E5E9F0] dark:border-neutral-800 p-4 rounded-[24px] text-sm space-y-2" aria-label="Dispatch recommendation">
        <p class="text-xs font-bold text-emerald-700 dark:text-emerald-400">${r.video_demo ? 'Fixed video demo inputs · ' : ''}Scenario estimate — no live control</p>
        <h3 class="font-bold">Dispatch report · ${e(r.asset_name)}</h3>
        <p class="font-semibold text-[#D96B27]">${e(t.direction)} · ${e(t.at)} (${e(r.weather.timezone)})</p>
        <p class="text-xs">Engine sources: ${e(t.from)} → ${e(t.to)}. ${e(t.note)}</p>
        <p>Interval allocation: Solar ${mix.solar_to_load_kwh.toFixed(1)} · Battery ${mix.battery_to_load_kwh.toFixed(1)} · Grid ${mix.grid_to_load_kwh.toFixed(1)} · Unmet ${mix.unmet_demand_kwh.toFixed(1)} kWh</p>
        <ul class="list-disc pl-4">${t.reasons.map(reason => `<li>${e(reason)}</li>`).join('')}</ul>
        <details class="text-xs"><summary class="cursor-pointer">Inputs, sources and timelines</summary><p>${e(r.demand_basis)}</p><p>BDG2 forecast interval: ${e(r.hours[t.hour_index].demand_forecast_timestamp)}.</p><p>Demo location: ${e(r.location.name)}; weather source: ${e(r.weather.source)}; retrieved ${e(r.weather.retrieved_at_utc || 'not applicable to authored fixed inputs')}. ${e(r.weather.uncertainty)}</p><p>PV ${r.assumptions.pv_capacity_kwp} kWp; battery ${r.assumptions.battery_capacity_kwh} kWh; reserve ${r.assumptions.battery_reserve_pct}%. ${e(r.assumptions.dispatch_policy)}</p><details><summary class="cursor-pointer">All applied scenario assumptions</summary><pre class="whitespace-pre-wrap break-words">${e(JSON.stringify(r.assumptions, null, 2))}</pre></details><p>Approval previews the plan at this transition's scenario hour; it does not assert a present-day operating state.</p><a class="underline" href="https://doi.org/10.5281/zenodo.3887306" target="_blank" rel="noreferrer">BDG2 public benchmark</a>${r.video_demo ? ` · Fixed authored weather profile ${e(r.video_demo.version)}` : ' · <a class="underline" href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo</a>'}</details>
        <p class="text-xs" role="status">${e(this.explanations.get(card.id) || 'Engine reasons above. Gemini can explain these facts only.')}</p>
        <p class="text-xs" role="status">${e(this.reviews.get(card.id) || '')}</p>
        <div class="flex flex-wrap gap-2">
        ${card.status === 'pending' ? `<button data-dispatch-action="approved" data-dispatch-id="${card.id}" ${this.busy.has(card.id) ? 'disabled' : ''} class="rounded-xl px-3 py-2 bg-emerald-100 text-emerald-900 font-semibold disabled:opacity-50">${this.busy.has(card.id) ? 'Checking feasibility…' : 'Approve scenario plan'}</button><button data-dispatch-action="dismissed" data-dispatch-id="${card.id}" class="rounded-xl px-3 py-2 border border-slate-300">Dismiss</button>` : `<span class="font-semibold capitalize">${e(card.status)} · local scenario only</span>`}
        <button data-dispatch-action="explain" data-dispatch-id="${card.id}" class="rounded-xl px-3 py-2 border border-orange-200 text-[#D96B27]">Explain with Gemini / retry</button></div></article>`;
    }).join('') || '<p class="text-xs text-slate-500">No calculated transition cards yet. Refresh scenario inputs below to check the engine result.</p>';
  }
  renderSummary() {
    const plan = window.dispatchPlans.active();
    for (const host of document.querySelectorAll('[data-dispatch-summary]')) {
      if (!plan) { host.innerHTML = '<p>No approved dispatch plan. Approve an engine recommendation in the Township AI panel to preview the shared scenario.</p>'; continue; }
      const r = plan.result, hour = r.hours[plan.transition.hour_index], impact = window.dispatchPlans.impact(plan);
      host.innerHTML = `<p class="font-bold text-emerald-700 dark:text-emerald-400">Scenario estimate — no live control · Approved scenario preview</p>
        <h3 class="font-bold mt-1">${this.escape(r.asset_name)} · ${this.escape(hour.weather_timestamp)} (${this.escape(r.weather.timezone)})</h3>
        <p>Demand forecast ${hour.demand_forecast_kwh.toFixed(1)} kWh → Solar ${hour.solar_to_load_kwh.toFixed(1)} + Battery ${hour.battery_to_load_kwh.toFixed(1)} + Grid ${hour.grid_to_load_kwh.toFixed(1)} + Unmet ${hour.unmet_demand_kwh.toFixed(1)} kWh.</p>
        <p>Solar → battery ${hour.solar_to_battery_kwh.toFixed(1)} kWh · curtailed ${hour.curtailed_solar_kwh.toFixed(1)} kWh · battery state ${hour.battery_soc_kwh.toFixed(1)} / ${r.assumptions.battery_capacity_kwh} kWh.</p>
        <p>24h estimated grid electricity saved: ${impact.displacedKwh.toFixed(1)} kWh. Estimated import cost: ${impact.gridCost === null ? 'Not available' : `${this.escape(impact.currency)} ${impact.gridCost.toFixed(2)}`}; estimated grid purchase cost saved: ${impact.costAvoided === null ? 'Not available — enter a price assumption' : `${this.escape(impact.currency)} ${impact.costAvoided.toFixed(2)}`}.</p>
        <p class="text-xs mt-1">Price assumption: ${r.estimated_grid_cost ? `${this.escape(impact.currency)} ${r.estimated_grid_cost.price_per_kwh} / kWh` : 'Not configured'}. Compared with an all-grid scenario for the same served demand; excludes initial battery charging cost, CAPEX, degradation and tariff schedules. No verified savings or carbon claim. Historical BDG2 forecast and demo weather have independent timelines. Observed charts are unchanged. Sources: <a class="underline" href="https://doi.org/10.5281/zenodo.3887306">BDG2 public benchmark</a>${r.video_demo ? ` · Authored fixed demo weather (${this.escape(r.video_demo.version)})` : ' · <a class="underline" href="https://open-meteo.com/en/docs">Open-Meteo</a>'}.</p>`;
    }
  }
  async explain(id) {
    const card = window.dispatchPlans.read().cards.find(item => item.id === id);
    if (!card || this.explanations.get(id) === 'Gemini is explaining the engine result…') return;
    this.explanations.set(id, 'Gemini is explaining the engine result…'); this.renderCards();
    try {
      const result = await window.apiClient.explainSolarGrid(card.result.recommendation_id, id);
      this.explanations.set(id, `Gemini explanation: ${result.explanation} ${result.method}`);
    } catch (error) { this.explanations.set(id, `${error.message} Engine reasons remain available; retry or refresh the scenario.`); }
    this.renderCards();
  }
  async approveVideo(id) {
    if (this.busy.has(id)) return;
    const store = window.dispatchPlans, card = store.read().cards.find(item => item.id === id);
    if (!card?.result.video_demo || card.status !== 'pending') return;
    const token = store.planToken(card.result.asset_id), demo = card.result.video_demo;
    if (card.baselineToken !== token) {
      this.reviews.set(id, 'The shared demo state changed. Run the fixed demo again to review fresh inputs.'); this.renderCards(); return;
    }
    this.busy.add(id); this.reviews.set(id, 'Re-running the forecast, dispatch and feasibility checks…'); this.renderCards();
    try {
      const active = store.forAsset(card.result.asset_id);
      const hour = active?.result.video_demo ? active.transition.hour_index : demo.after_hour;
      const currentSource = active?.result.video_demo ? active.transition.to : demo.current_source;
      const battery = active?.result.video_demo ? active.result.hours[hour].battery_soc_kwh : card.result.hours[hour].battery_soc_kwh;
      const review = await window.apiClient.reviewVideoDispatch({ review_id: demo.review_id,
        recommendation_id: card.result.recommendation_id, transition_id: id,
        current_source: currentSource, current_hour: hour, battery_soc_kwh: battery });
      if (store.planToken(card.result.asset_id) !== token || !store.decide(id, 'approved', review)) {
        throw new Error('The alert or shared demo state changed during review. Refresh before approval.');
      }
      this.reviews.set(id, 'Approved locally. Township, energy flows and estimated impact now use this checked scenario.');
      await window.twinApp?.runVideoDispatch();
    } catch (error) { this.reviews.set(id, `${error.message} The current plan was kept.`); }
    finally { this.busy.delete(id); this.renderCards(); this.renderSummary(); }
  }
  init() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-dispatch-action]');
      if (!button) return;
      const id = button.dataset.dispatchId, action = button.dataset.dispatchAction;
      if (action === 'explain') { this.explain(id); return; }
      if (action === 'approved' && window.dispatchPlans.read().cards.find(c => c.id === id)?.result.video_demo) {
        this.approveVideo(id); return;
      }
      try {
        if (!window.dispatchPlans.decide(id, action)) return;
        this.renderCards(); this.renderSummary();
      } catch (_) { window.twinApp?.showToast('Browser storage unavailable; the plan was not applied.'); }
    });
    window.addEventListener('energios:dispatch-updated', () => { this.renderCards(); this.renderSummary(); });
    window.addEventListener('storage', event => {
      if (event.key === window.dispatchPlans.key || event.key === null) {
        window.dispatchEvent(new CustomEvent('energios:dispatch-updated'));
      }
    });
    this.renderCards(); this.renderSummary();
  }
}
window.dispatchPlanUI = new DispatchPlanUI();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.dispatchPlanUI.init());
else window.dispatchPlanUI.init();
