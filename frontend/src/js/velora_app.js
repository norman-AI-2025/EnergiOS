/**
 * EnergiOS dashboard controller using only the read-only backend API.
 */
class EnergiOSDashboard {
  constructor() {
    this.state = {
      activeTimeframe: 'Hourly',
      activeBuildingId: null,
      assets: [],
      currentBuilding: null,
      readings: null,
      forecast: null,
      anomalies: null,
    };
    this.energyChart = null;
    this.batteryOperationsChart = null;
    this.batteryActiveView = 'chart';
    this.kpiScenarios = new Map();
    this.selectionSequence = 0;
    this.batteryDataMode = 'plan';
    this.batteryDemos = new Map();
  }

  async init() {
    this.batteryDataMode = localStorage.getItem('ENERGIOS_BATTERY_VIEW') === 'plan' ? 'plan' : 'demo';
    const source=document.getElementById('battery-data-source');
    if (source) source.value=this.batteryDataMode;
    this.setupEventListeners();
    await this.loadData();
  }

  setApiStatus(healthy, message) {
    const pill = document.getElementById('api-status-pill');
    const dot = document.getElementById('api-status-dot');
    const text = document.getElementById('api-status-text');
    if (!pill || !dot || !text) return;

    text.textContent = message;
    const isLive = window.apiClient?.status?.isLive;
    if (healthy) {
      dot.className = `w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`;
      pill.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all cursor-pointer ${
        isLive
          ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
          : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200/80 dark:border-amber-800/60 text-amber-800 dark:text-amber-300'
      }`;
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-rose-500';
      pill.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 cursor-pointer';
    }
  }

  async loadData() {
    this.setApiStatus(true, 'Connecting...');
    this.setLoading(true);
    try {
      await window.apiClient.checkHealth().catch(() => null);
      const response = await window.apiClient.getAssets();
      if (!Array.isArray(response?.items)) throw new Error('The backend returned an invalid asset list.');
      this.state.assets = response.items;
      this.renderBuildingPicker();

      // Check stored user settings for default building if activeBuildingId is unset
      let targetBuildingId = this.state.activeBuildingId;
      if (!targetBuildingId) {
        try {
          const stored = localStorage.getItem('ENERGIOS_SETTINGS');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.defaultBuildingId) targetBuildingId = parsed.defaultBuildingId;
          }
        } catch (_) {}
      }

      const initialAsset = this.state.assets.find((asset) => asset.id === targetBuildingId)
        || this.state.assets[0];
      if (!initialAsset) {
        this.setUnavailable('No assets are available in the verified public benchmark cohort.');
        return;
      }
      await this.selectBuilding(initialAsset.id);
      for (const asset of this.state.assets) {
        if (asset.id !== initialAsset.id) void this.loadKpiScenario(asset.id);
      }
    } catch (error) {
      console.warn('[EnergiOS Dashboard] Load error:', error);
      this.setApiStatus(false, 'Data unavailable');
      this.setUnavailable(error.message);
    } finally {
      this.setLoading(false);
    }
  }

  renderBuildingPicker() {
    const container = document.getElementById('building-picker-container');
    if (!container) return;
    container.replaceChildren();

    for (const asset of this.state.assets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
        asset.id === this.state.activeBuildingId
          ? 'bg-[#1E2022] text-white shadow-xs font-semibold'
          : 'bg-white text-slate-500 hover:text-slate-800 border border-slate-200/60'
      }`;
      button.textContent = asset.name.replace(/^Hog_/, '').replaceAll('_', ' ');
      button.addEventListener('click', () => this.selectBuilding(asset.id));
      container.append(button);
    }
  }

  async selectBuilding(assetId) {
    const selection = ++this.selectionSequence;
    this.state.activeBuildingId = assetId;
    this.renderBuildingPicker();
    this.setLoading(true);

    try {
      const asset = this.state.assets.find((candidate) => candidate.id === assetId) || this.state.assets[0];
      if (!asset) throw new Error('The selected asset is not in the backend catalogue.');

      this.activeBuilding = asset.name;

      const [readings, forecast, anomalies] = await Promise.all([
        window.apiClient.getReadings(asset.id, { limit: 168 }),
        window.apiClient.getForecast(asset.id),
        window.apiClient.getAnomalies(asset.id, { limit: 100 }),
      ]);
      if (selection !== this.selectionSequence) return;
      if (!Array.isArray(readings?.items) || !Array.isArray(forecast?.items) || !Array.isArray(anomalies?.items)) {
        throw new Error('The backend returned an unexpected analytics response.');
      }

      this.state.currentBuilding = asset;
      this.state.readings = readings;
      this.state.forecast = forecast;
      this.state.anomalies = anomalies;
      this.state.readingSummary = null;
      this.updateAssetLabels(asset);
      this.updateProjectReadings();

      try {
        this.renderEnergyOverviewChart();
      } catch (chartError) {
        console.warn('[EnergiOS Dashboard] Chart render warning:', chartError);
      }

      try {
        this.renderBatteryOperationsChart();
        this.updateBatteryStorageMetrics();
      } catch (batteryError) {
        console.warn('[EnergiOS Dashboard] Battery operations render warning:', batteryError);
      }

      try {
        this.renderForecastHeatmap();
      } catch (heatmapError) {
        console.warn('[EnergiOS Dashboard] Heatmap render warning:', heatmapError);
      }

      const isLive = window.apiClient?.status?.isLive;
      const dbStatus = window.apiClient?.status?.database;
      const isSupabase = dbStatus?.connected || readings?.provenance?.label?.includes('Supabase');
      const statusLabel = isSupabase
        ? 'Supabase Live Connected'
        : isLive
          ? 'Live API Connected'
          : 'Public Benchmark Snapshot';
      this.setApiStatus(true, statusLabel);
      void this.loadKpiScenario(asset.id);
      if (this.batteryDataMode === 'demo') void this.loadBatteryDemo();
      if (this.state.activeTimeframe !== 'Hourly') void this.setTimeframe(this.state.activeTimeframe);
    } catch (error) {
      if (selection !== this.selectionSequence) return;
      console.warn('[EnergiOS Dashboard] selectBuilding error:', error);
      this.state.currentBuilding = null;
      this.state.readings = null;
      this.state.forecast = null;
      this.state.anomalies = null;
      this.setApiStatus(false, 'Data unavailable');
      this.setUnavailable(error.message);
    } finally {
      if (selection === this.selectionSequence) this.setLoading(false);
    }
  }

  updateAssetLabels(asset) {
    const subtitle = document.getElementById('site-subtitle-tag');
    if (subtitle) {
      subtitle.textContent = `${asset.name.replaceAll('_', ' ')} · Public benchmark`;
    }

    const timezone = document.getElementById('asset-timezone-label');
    if (timezone) timezone.textContent = asset.timezone;

    const photo = document.getElementById('hero-building-photo');
    if (photo) {
      photo.alt = `Illustrative building visualization for ${asset.name}; not a source photograph`;
    }
  }

  updateProjectReadings() {
    const readings = this.state.readings?.items || [];
    const forecasts = this.state.forecast?.items || [];
    const anomalies = this.state.anomalies || { count: 0, items: [] };
    const asset = this.state.currentBuilding || this.state.assets[0] || {};

    if (!readings.length) {
      this.setUnavailable('The backend returned no observed readings.');
      return;
    }

    const latest = readings[readings.length - 1];
    const last24 = readings.slice(-24);
    const latestTime = Date.parse(latest.timestamp);
    const observationsIn24h = readings.filter((row) => {
      const timestamp = Date.parse(row.timestamp);
      return timestamp >= latestTime - (23 * 60 * 60 * 1000) && timestamp <= latestTime;
    });

    const currentWindow = this.getCompleteHourlyWindow(readings, readings.length - 1)
      || (last24.length >= 24 ? last24 : readings);
    const total24 = currentWindow.reduce((sum, row) => sum + row.consumption_kwh, 0);
    const max24 = Math.max(...last24.map((row) => row.consumption_kwh), latest.consumption_kwh);
    const min24 = Math.min(...last24.map((row) => row.consumption_kwh), latest.consumption_kwh);
    const avg24 = last24.length ? last24.reduce((sum, row) => sum + row.consumption_kwh, 0) / last24.length : latest.consumption_kwh;

    const modelMetric = this.state.forecast?.test_metrics?.model;
    const maePctOfRecentMean = modelMetric && avg24 > 0 ? (modelMetric.mae_kwh / avg24) * 100 : null;

    // Hero 3 Metrics
    this.setText('metric-total-val', this.formatNumber(total24, 0));

    this.setText('metric-current-val', this.formatNumber(latest.consumption_kwh, 1));

    this.setText('metric-export-val', modelMetric ? this.formatNumber(modelMetric.mae_kwh, 2) : '—');
    this.renderKpiContext();

    // Demand, intensity and model evidence are refreshed for the selected period below.

    // Anomaly Alerts Tag
    this.setText('alerts-count-tag', `${anomalies.count || anomalies.items?.length || 0} Flags`);
    const ruleVersion = anomalies.rule?.version || 'validation_residual_mad_v1';
    const ruleDesc = anomalies.rule?.description
      || this.state.forecast?.method?.anomaly_rule_description
      || '6× Validation MAD threshold';
    this.setText('anomaly-rule-summary', `${ruleVersion}: ${ruleDesc}`);

    // Forecast Method Description
    const method = this.state.forecast?.method;
    if (method) {
      this.setText(
        'forecast-method-description',
        `${method.model_version}: ${method.description}. Baseline: ${method.baseline_description}.`
      );
    }

    const split = this.state.forecast?.split;
    if (split?.test_start) {
      this.setText(
        'forecast-evaluation-period',
        `Held-out test: ${this.formatDate(split.test_start)} to ${this.formatDate(split.test_end_exclusive || split.test_start)} (end exclusive).`
      );
    }

    const limitations = document.getElementById('forecast-limitations');
    if (limitations && Array.isArray(this.state.forecast?.limitations)) {
      limitations.replaceChildren();
      for (const limitation of this.state.forecast.limitations) {
        const item = document.createElement('li');
        item.textContent = limitation;
        limitations.append(item);
      }
    }

    // Cost & Carbon Impact (Dynamic utility rates from settings)
    let settings = {};
    try {
      settings = JSON.parse(localStorage.getItem('ENERGIOS_SETTINGS') || '{}');
    } catch (_) {}
    const currency = settings.currencySymbol || 'RM';
    const rate = typeof settings.peakRate === 'number' ? settings.peakRate : 0.365;
    const estCost = total24 * rate;
    this.setText('impact-cost-val', `${currency} ${this.formatNumber(estCost, 2)}`);
    const estCarbon = total24 * 0.65;
    this.setText('impact-carbon-val', `${this.formatNumber(estCarbon, 0)} kg CO₂e`);
    this.setText('impact-eui-val', Number.isFinite(asset.floor_area_m2) && asset.floor_area_m2>0
      ? `${(total24/asset.floor_area_m2).toFixed(2)} kWh/m² · Day` : 'Area not available');

    this.setText('forecast-coverage-label', `${forecasts.length || 24} forecast intervals returned`);
    this.renderPowerDialTicks(latest.consumption_kwh, max24);
    this.updatePeriodCards();
  }

  calculateKpiContext(readings, forecast, assumptions = {}) {
    const result = { energySavedKwh: null, energySavedPct: null, costAvoidedRm: null,
      carbonAvoidedKg: null, maeImprovementKwh: null, maeImprovementPct: null };
    // Rolling windows must contain the same 24 hourly positions, without gaps or fills.
    const rows = [...readings].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-48);
    const valid = rows.length === 48 && rows.every((row, i) => (
      Number.isFinite(Date.parse(row.timestamp)) && Number.isFinite(row.consumption_kwh)
      && row.consumption_kwh >= 0 && row.interval_minutes === 60
      && row.label === 'observed' && row.quality_status === 'observed'
      && (i === 0 || Date.parse(row.timestamp) - Date.parse(rows[i - 1].timestamp) === 3600000)
    ));
    if (valid) {
      const baseline = rows.slice(0, 24).reduce((sum, row) => sum + row.consumption_kwh, 0);
      const current = rows.slice(24).reduce((sum, row) => sum + row.consumption_kwh, 0);
      if (baseline > 0) {
        result.energySavedKwh = baseline - current;
        result.energySavedPct = result.energySavedKwh / baseline * 100;
        const avoided = Math.max(0, result.energySavedKwh);
        if (Number.isFinite(assumptions.tariffRmPerKwh) && assumptions.tariffRmPerKwh >= 0) {
          result.costAvoidedRm = avoided * assumptions.tariffRmPerKwh;
        }
        if (Number.isFinite(assumptions.emissionsKgPerKwh) && assumptions.emissionsKgPerKwh >= 0) {
          result.carbonAvoidedKg = avoided * assumptions.emissionsKgPerKwh;
        }
      }
    }
    const model = forecast?.test_metrics?.model;
    const baseline = forecast?.test_metrics?.baseline;
    if (Number.isFinite(model?.mae_kwh) && model.mae_kwh >= 0
      && Number.isFinite(baseline?.mae_kwh) && baseline.mae_kwh >= 0
      && Number.isInteger(model.n) && model.n > 0 && model.n === baseline.n) {
      result.maeImprovementKwh = baseline.mae_kwh - model.mae_kwh;
      if (baseline.mae_kwh > 0) result.maeImprovementPct = result.maeImprovementKwh / baseline.mae_kwh * 100;
    }
    return result;
  }

  loadKpiAssumptions() {
    try { return JSON.parse(localStorage.getItem('ENERGIOS_KPI_ASSUMPTIONS_V1') || '{}') || {}; }
    catch (_) { return {}; }
  }

  calculateApprovedPlanSavings(plan, assetId, assumptions = {}) {
    if (!plan?.appliedAt) return { available: false, reason: 'Approve a solar/battery plan for the selected building in the Township AI panel.' };
    return { ...this.calculateScenarioSavings(plan.result, assetId, assumptions), appliedAt: plan.appliedAt };
  }

  getKpiScenarioProfile(assetId) {
    const template = window.dispatchPlans?.active?.()?.result;
    const inputs = { asset_id: assetId };
    if (!template) return { inputs, source: 'Existing engine demo defaults; editable in the Township scenario inputs. No building equipment or location is measured.' };
    const a = template.assumptions || {}, location = template.location || {};
    for (const key of ['pv_capacity_kwp', 'pv_performance_ratio', 'temperature_coefficient_per_c',
      'reference_temperature_c', 'battery_capacity_kwh', 'battery_reserve_pct', 'max_charge_kw',
      'max_discharge_kw', 'charge_efficiency', 'discharge_efficiency', 'grid_available']) {
      if (a[key] !== undefined) inputs[key] = a[key];
    }
    if (a.battery_initial_soc_pct !== undefined) inputs.battery_soc_pct = a.battery_initial_soc_pct;
    for (const key of ['latitude', 'longitude']) if (location[key] !== undefined) inputs[key] = location[key];
    if (location.name) inputs.location_name = location.name;
    if (template.estimated_grid_cost) {
      inputs.grid_price_per_kwh = template.estimated_grid_cost.price_per_kwh;
      inputs.grid_price_currency = template.estimated_grid_cost.currency;
    }
    return { inputs, source: `Shared scenario assumptions from ${template.asset_name || 'the active approved plan'}, applied to this building's own forecast. This preview is not approved; equipment and demo weather location are assumptions.` };
  }

  async loadKpiScenario(assetId, force = false) {
    if (!assetId || window.dispatchPlans?.forAsset(assetId)) { this.renderKpiContext(); return; }
    const profile = this.getKpiScenarioProfile(assetId), signature = JSON.stringify(profile.inputs);
    const cached = this.kpiScenarios.get(assetId);
    if (!force && cached?.signature === signature && Date.now() - cached.at < 15 * 60 * 1000) return cached.promise;
    const entry = { signature, source: profile.source, status: 'loading', at: Date.now() };
    this.kpiScenarios.set(assetId, entry);
    if (this.state.activeBuildingId === assetId) this.renderKpiContext();
    entry.promise = (async () => {
      try {
        const result = await window.apiClient.getSolarGridRecommendation(profile.inputs);
        if (result?.asset_id !== assetId) throw new Error('The scenario response belongs to a different building.');
        entry.result = result;
        entry.status = 'ready';
      } catch (error) {
        if (typeof window.apiClient.getVideoDispatch === 'function') {
          try {
            const fallback = await window.apiClient.getVideoDispatch(assetId,0);
            if (fallback?.asset_id !== assetId) throw new Error('Demo profile belongs to a different building');
            entry.result=fallback; entry.status='ready';
            entry.source='Fixed demo battery/PV profile, calculated with this building’s BDG2 demand. Not approved.';
          } catch (_) { entry.status='error'; entry.error='The forecast scenario is unavailable. Retry the calculation.'; }
        } else { entry.status = 'error'; entry.error = error.message || 'The scenario service is unavailable.'; }
      } finally {
        this.renderTownshipSavings();
        if (this.state.activeBuildingId === assetId && this.kpiScenarios.get(assetId) === entry) {
          this.renderKpiContext(); this.renderBatteryOperationsChart(); this.updateBatteryStorageMetrics();
        }
      }
    })();
    return entry.promise;
  }

  calculateScenarioSavings(r, assetId, assumptions = {}) {
    const unavailable = reason => ({ available: false, reason });
    if (!r || r.asset_id !== assetId
      || r.result_type !== 'simulated_solar_grid_recommendation') {
      return unavailable('A calculated solar/battery scenario for the selected building is required.');
    }
    if (r.assumptions?.grid_available !== true) {
      return unavailable('An all-grid comparison is unavailable while the scenario grid is unavailable.');
    }
    const hours = r.hours;
    if (!Array.isArray(hours) || hours.length !== 24) return unavailable('A complete 24-hour dispatch forecast is required.');
    const keys = ['demand_forecast_kwh', 'solar_to_load_kwh', 'battery_to_load_kwh', 'grid_to_load_kwh', 'unmet_demand_kwh'];
    for (let i = 0; i < hours.length; i++) {
      const h = hours[i];
      if (!h || typeof h !== 'object') return unavailable('The plan contains an invalid interval.');
      const time = Date.parse(h.demand_forecast_timestamp);
      if (!Number.isFinite(time) || (i > 0 && time - Date.parse(hours[i - 1].demand_forecast_timestamp) !== 3600000)
        || keys.some(key => !Number.isFinite(h[key]) || h[key] < 0)
        || Math.abs(h.demand_forecast_kwh - h.solar_to_load_kwh - h.battery_to_load_kwh - h.grid_to_load_kwh - h.unmet_demand_kwh) > 0.01
        || h.unmet_demand_kwh > 0) return unavailable('The plan has missing, invalid or unserved demand; no savings estimate is shown.');
    }
    const sum = key => hours.reduce((total, h) => total + h[key], 0);
    const demand = sum('demand_forecast_kwh');
    if (!Number.isFinite(demand) || demand <= 0) return unavailable('A finite positive forecast demand baseline is required.');
    const solar = sum('solar_to_load_kwh'), battery = sum('battery_to_load_kwh');
    const displaced = Math.min(demand, solar + battery);
    // Restore the initial battery inventory before crediting grid-purchase savings.
    // Unknown charging provenance receives no battery savings credit.
    const a = r.assumptions || {};
    const initial = a.battery_capacity_kwh * a.battery_initial_soc_pct / 100;
    const final = hours[23].battery_soc_kwh;
    const inventoryKnown = Number.isFinite(initial) && initial >= 0 && Number.isFinite(final) && final >= 0
      && Number.isFinite(a.charge_efficiency) && a.charge_efficiency > 0 && a.charge_efficiency <= 1;
    const replenishment = inventoryKnown ? Math.max(0, initial - final) / a.charge_efficiency : battery;
    const grid = sum('grid_to_load_kwh');
    const optimisedGrid = grid + replenishment;
    const netSaved = demand - optimisedGrid;
    let tariff = null, tariffSource = 'Not configured';
    if (Number.isFinite(assumptions.tariffRmPerKwh) && assumptions.tariffRmPerKwh >= 0) {
      tariff = assumptions.tariffRmPerKwh;
      tariffSource = 'User-entered KPI flat tariff assumption (valuation override only)';
    } else if (typeof r.estimated_grid_cost?.currency === 'string'
      && ['RM', 'MYR'].includes(r.estimated_grid_cost.currency.trim().toUpperCase())
      && Number.isFinite(r.estimated_grid_cost?.price_per_kwh) && r.estimated_grid_cost.price_per_kwh >= 0) {
      tariff = r.estimated_grid_cost.price_per_kwh;
      tariffSource = 'Price assumption captured in this scenario';
    }
    const carbon = Number.isFinite(assumptions.emissionsKgPerKwh) && assumptions.emissionsKgPerKwh >= 0
      ? solar * assumptions.emissionsKgPerKwh : null;
    return { available: true, demandKwh: demand, gridDisplacedKwh: displaced,
      gridDisplacedPct: displaced / demand * 100, solarKwh: solar, batteryKwh: battery,
      netGridSavedKwh: netSaved, netGridSavedPct: netSaved / demand * 100,
      optimisedGridKwh: optimisedGrid, replenishmentKwh: replenishment, inventoryKnown,
      baselineConsumptionKwh: demand, optimisedConsumptionKwh: demand, consumptionSavedKwh: 0,
      baselineCostRm: tariff === null ? null : demand * tariff,
      optimisedCostRm: tariff === null ? null : optimisedGrid * tariff,
      costSavedPct: tariff === null || tariff === 0 ? null : netSaved / demand * 100,
      maximumDemandSavings: null,
      costAvoidedRm: tariff === null ? null : netSaved * tariff,
      carbonAvoidedKg: carbon, tariff, tariffSource,
      forecastStart: hours[0].demand_forecast_timestamp,
      forecastEnd: hours[23].demand_forecast_timestamp };
  }

  periodSavingsFor(results) {
    const assumptions = this.loadKpiAssumptions();
    const timezoneByAsset = Object.fromEntries(this.state.assets.map(asset => [asset.id, asset.timezone || 'UTC']));
    const zones = [...new Set(results.map(plan => timezoneByAsset[plan.result.asset_id] || 'UTC'))];
    const reportingTimezone = zones.length === 1 ? zones[0] : 'UTC';
    return window.dispatchPlans?.periodSavings?.(results, this.state.activeTimeframe, {
      tariffRmPerKwh: assumptions.tariffRmPerKwh, timezoneByAsset, reportingTimezone,
    });
  }

  renderTownshipSavings() {
    const host = document.getElementById('township-savings');
    if (!host || !this.state.assets.length) return;
    const results = this.state.assets.map(asset => {
      const approved = window.dispatchPlans?.forAsset(asset.id);
      if (approved) return approved;
      const entry = this.kpiScenarios.get(asset.id);
      const signature = JSON.stringify(this.getKpiScenarioProfile(asset.id).inputs);
      return entry?.status === 'ready' && entry.signature === signature
        ? {result:entry.result, status:'preview'} : null;
    }).filter(Boolean);
    const report = this.periodSavingsFor(results);
    const count = report?.includedBuildings || 0;
    const approvedCount = results.filter(plan => plan.appliedAt).length;
    const previewCount = results.length - approvedCount;
    const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const number = value => Number(value).toLocaleString(undefined,{maximumFractionDigits:1});
    const rows = report?.periods || [];
    host.innerHTML = `<div class="flex flex-wrap items-start justify-between gap-2"><div><h2 class="text-lg font-bold">Township savings overview</h2><p class="text-xs text-slate-500">Projected ${esc(this.state.activeTimeframe.toLowerCase())} comparison · ${count}/${this.state.assets.length} building forecasts · ${approvedCount} approved plans, ${previewCount} unapproved previews · ${esc(report?.reportingTimezone || 'UTC')} · no live equipment control</p></div><p class="text-xs text-slate-500">Measured post-action savings: Not available</p></div>
      ${rows.length ? `<div class="overflow-x-auto max-h-96 overflow-y-auto mt-3"><table class="w-full text-xs text-left"><thead class="sticky top-0 bg-white dark:bg-[#171e2b]"><tr class="border-b"><th class="py-2">Period</th><th>Baseline grid</th><th>Optimised grid</th><th>Grid electricity saved</th><th>Purchase cost saved</th><th>Concurrent peak*</th><th>Coverage</th></tr></thead><tbody>${rows.map(row => `<tr class="border-b border-slate-100 dark:border-slate-800"><td class="py-2">${esc(row.period)}</td><td>${number(row.baselineKwh)} kWh</td><td>${number(row.optimisedGridKwh)} kWh</td><td>${number(row.gridSavedKwh)} kWh (${row.gridSavedPct === null ? 'N/A' : number(row.gridSavedPct)+'%'})</td><td>${row.costSavedRm === null ? 'Not available' : 'RM '+number(row.costSavedRm)+' ('+(row.costSavedPct === null ? 'percentage unavailable' : number(row.costSavedPct)+'%')+')'}</td><td>${number(row.baselinePeakKw)} → ${number(row.optimisedPeakKw)} kW</td><td>${row.complete && count === this.state.assets.length ? 'Complete' : 'Partial'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="text-sm mt-3">Savings estimate: Not available while forecast scenarios load.</p>'}
      <p class="text-xs text-slate-500 mt-2">These four BDG2 buildings are separate public benchmarks; their combined forecast is a portfolio scenario, not a measured physical township or utility account. Solar/grid switching changes purchases, not building consumption, so projected consumption reduction is 0 kWh. No monthly extrapolation is used; partial periods and missing buildings are not filled. *Peak is the maximum simultaneous one-hour average across included buildings, not a billed maximum. Demand-charge savings remain unavailable without a verified shared-account or per-meter structure, complete billing-period measurements at the tariff interval, and an applicable RM/kW rate.</p>`;
  }

  renderKpiContext() {
    const assumptions = this.loadKpiAssumptions();
    const values = this.calculateKpiContext(this.state.readings?.items || [], this.state.forecast, assumptions);
    const plan = window.dispatchPlans?.forAsset(this.state.activeBuildingId);
    const entry = this.kpiScenarios.get(this.state.activeBuildingId);
    const preview = entry?.signature === JSON.stringify(this.getKpiScenarioProfile(this.state.activeBuildingId).inputs) ? entry : null;
    const savings = plan ? this.calculateApprovedPlanSavings(plan, this.state.activeBuildingId, assumptions)
      : this.calculateScenarioSavings(preview?.result, this.state.activeBuildingId, assumptions);
    const periodReport = this.periodSavingsFor(plan ? [plan] : preview?.result ? [{result:preview.result, status:'preview'}] : []);
    let periodRow = periodReport?.periods.at(-1);
    if (this.state.activeTimeframe === 'Hourly' && periodReport?.periods.length === 24) {
      const rows = periodReport.periods;
      const baselineKwh = rows.reduce((sum, row) => sum + row.baselineKwh, 0);
      const gridSavedKwh = rows.reduce((sum, row) => sum + row.gridSavedKwh, 0);
      const priced = rows.every(row => row.costSavedRm !== null);
      const baselineCostRm = rows.reduce((sum, row) => sum + row.baselineCostRm, 0);
      const costSavedRm = priced ? rows.reduce((sum, row) => sum + row.costSavedRm, 0) : null;
      periodRow = {period:'next 24h', complete:true, gridSavedKwh,
        gridSavedPct:baselineKwh > 0 ? 100 * gridSavedKwh / baselineKwh : null,
        costSavedRm, costSavedPct:priced && baselineCostRm > 0 ? 100 * costSavedRm / baselineCostRm : null,
        solarToLoadKwh:rows.reduce((sum, row) => sum + row.solarToLoadKwh, 0)};
    }
    const periodNote = periodRow ? `${periodRow.period}${periodRow.complete ? '' : ' · partial period'} · ${plan ? 'approved-plan projection' : 'unapproved preview'} · no extrapolation` : '';
    const loading = !plan && preview?.status === 'loading';
    const fixed = (number, digits = 1) => number.toFixed(digits);
    const energy = periodRow
      ? `Estimated grid electricity saved: ${fixed(periodRow.gridSavedKwh)} kWh (${periodRow.gridSavedPct === null ? 'percentage Not available' : fixed(periodRow.gridSavedPct)+'%'}) · ${periodNote}`
      : savings.available
      ? `Estimated grid electricity saved: ${fixed(savings.netGridSavedKwh)} kWh (${fixed(savings.netGridSavedPct)}%) · 24h scenario estimate`
      : 'Estimated grid electricity saved: Not available';
    this.setText('metric-total-delta', energy);
    let cost = periodRow ? periodRow.costSavedRm === null ? 'Estimated grid purchase cost saved: Not available — configure an RM tariff'
      : `Estimated grid purchase cost saved: RM ${fixed(periodRow.costSavedRm, 2)} (${periodRow.costSavedPct === null ? 'percentage Not available' : fixed(periodRow.costSavedPct)+'%'}) · ${periodNote}`
      : !savings.available || savings.costAvoidedRm === null ? 'Estimated grid purchase cost saved: Not available'
      : `Estimated grid purchase cost saved: RM ${fixed(savings.costAvoidedRm, 2)} (${savings.costSavedPct === null ? 'percentage Not available' : `${fixed(savings.costSavedPct)}%`}) · 24h scenario estimate`;
    if (Number.isFinite(assumptions.emissionsKgPerKwh) && assumptions.emissionsKgPerKwh >= 0) {
      const solarKwh = periodRow?.solarToLoadKwh ?? savings.solarKwh;
      cost += !savings.available || !Number.isFinite(solarKwh) ? ' · Estimated solar-only emissions saved: Not available'
        : ` · Estimated solar-only emissions saved: ${fixed(solarKwh * assumptions.emissionsKgPerKwh)} kg CO₂e`;
    }
    this.setText('metric-current-status', cost);
    this.setText('kpi-period-comparison', !savings.available ? 'Matching-period savings comparison: Not available.'
      : `${plan ? 'Approved demo plan' : 'Unapproved demo preview'} · Same 24 forecast hours: baseline grid ${fixed(savings.demandKwh)} kWh → optimised grid ${fixed(savings.optimisedGridKwh)} kWh, including ${fixed(savings.replenishmentKwh)} kWh battery replenishment allowance. Building consumption: ${fixed(savings.demandKwh)} → ${fixed(savings.demandKwh)} kWh; total energy saved 0.0 kWh (0.0%). Supply switching or shifting does not reduce consumption. ${savings.tariff === null ? 'Energy-cost comparison: Not available — configure RM/kWh.' : `Energy cost: RM ${fixed(savings.baselineCostRm, 2)} → RM ${fixed(savings.optimisedCostRm, 2)}.`} ${savings.inventoryKnown ? 'Battery inventory restored using the scenario charge efficiency.' : 'Battery charging origin/state incomplete: battery discharge receives no savings credit.'}`);
    this.setText('kpi-demand-savings', 'Maximum-demand savings: Not available — requires complete billing-period demand measurements at the tariff billing interval and an applicable RM/kW demand rate. Hourly forecast peaks are not billing-grade demand.');
    if (loading) {
      this.setText('metric-total-delta', 'Calculating grid electricity saved for this building…');
      this.setText('metric-current-status', 'Calculating scenario cost estimate…');
    }
    const improvement = values.maeImprovementKwh;
    this.setText('metric-export-delta', improvement === null ? 'Forecast accuracy improvement: Not available'
      : `Forecast accuracy ${improvement >= 0 ? 'improvement' : 'worsened'}: ${fixed(Math.abs(improvement), 2)} kWh (${values.maeImprovementPct === null ? 'percentage Not available' : `${fixed(Math.abs(values.maeImprovementPct))}%`}) vs baseline model`);
    for (const [id, tone] of [['metric-total-delta', periodRow || savings.available ? '#16a34a' : '#71767B'],
      ['metric-current-status', periodRow ? periodRow.costSavedRm !== null ? '#16a34a' : '#71767B'
        : savings.available && savings.costAvoidedRm !== null ? '#16a34a' : '#71767B'],
      ['metric-export-delta', improvement === null ? '#71767B' : improvement < 0 ? '#e11d48' : '#16a34a']]) {
      const el = document.getElementById(id);
      if (el?.style) el.style.color = tone;
    }
    const retry = document.getElementById('kpi-scenario-retry');
    if (retry) { retry.disabled = loading; retry.textContent = loading ? 'Calculating…' : 'Refresh selected building estimate'; }
    const appliedInputs = document.getElementById('kpi-scenario-inputs');
    const r = plan?.result || preview?.result;
    if (appliedInputs) appliedInputs.textContent = r ? JSON.stringify({ location: r.location, weather: r.weather, assumptions: r.assumptions }, null, 2) : 'Inputs will appear after a successful scenario calculation.';
    const evidence = document.getElementById('kpi-estimate-evidence');
    if (evidence) {
      evidence.textContent = loading ? 'Calculating this building’s own forecast scenario; no plan is being approved.'
        : !savings.available ? `Savings estimate: Not available — ${preview?.error || savings.reason} Use Refresh to retry.`
        : `${plan ? `Approved plan ${savings.appliedAt}.` : `Unapproved preview. ${preview.source}`} ML demand forecast baseline: ${fixed(savings.demandKwh)} kWh, ${savings.forecastStart} to ${savings.forecastEnd} (24 hourly intervals). Solar to load: ${fixed(savings.solarKwh)} kWh; battery to load: ${fixed(savings.batteryKwh)} kWh. Tariff: ${savings.tariff === null ? 'Not configured — enter a flat RM/kWh assumption below to calculate cost saved' : `RM ${savings.tariff}/kWh (${savings.tariffSource})`}. Historical BDG2 forecast and demo-location weather have independent timelines.`;
    }
    this.setText('kpi-observed-comparison', values.energySavedKwh === null ? 'Observed prior-day comparison: Not available.'
      : `Observed prior-day change: ${fixed(-values.energySavedKwh)} kWh (${fixed(-values.energySavedPct)}%). This is a historical usage change, not intervention savings.`);
    this.renderTownshipSavings();
  }

  setupKpiAssumptions() {
    document.getElementById('kpi-scenario-retry')?.addEventListener('click', () => this.loadKpiScenario(this.state.activeBuildingId, true));
    const fields = [['kpi-tariff', 'tariffRmPerKwh'], ['kpi-emissions', 'emissionsKgPerKwh']];
    const saved = this.loadKpiAssumptions();
    for (const [id, key] of fields) {
      const input = document.getElementById(id);
      if (!input) continue;
      input.value = Number.isFinite(saved[key]) && saved[key] >= 0 ? saved[key] : '';
      input.addEventListener('input', () => {
        const assumptions = {};
        for (const [fieldId, fieldKey] of fields) {
          const raw = document.getElementById(fieldId)?.value.trim() || '';
          const value = Number(raw);
          if (raw !== '' && Number.isFinite(value) && value >= 0) assumptions[fieldKey] = value;
        }
        try { localStorage.setItem('ENERGIOS_KPI_ASSUMPTIONS_V1', JSON.stringify(assumptions)); }
        catch (_) { this.showToast('Could not save estimate assumptions in this browser.'); }
        this.renderKpiContext();
      });
    }
    window.addEventListener('storage', (event) => {
      if (event.key === 'ENERGIOS_KPI_ASSUMPTIONS_V1' || event.key === null) this.renderKpiContext();
    });
  }

  getCompleteHourlyWindow(readings, endIndex) {
    const window = readings.slice(endIndex - 23, endIndex + 1);
    if (window.length !== 24) return null;

    for (let index = 1; index < window.length; index++) {
      const previousTime = Date.parse(window[index - 1].timestamp);
      const currentTime = Date.parse(window[index].timestamp);
      if (currentTime - previousTime !== 60 * 60 * 1000) return null;
    }
    return window;
  }

  renderPowerDialTicks(currentKwh, maxKwh) {
    const container = document.getElementById('power-dial-ticks');
    if (!container) return;

    const totalTicks = 42;
    const radius = 58;
    const cx = 70;
    const cy = 70;
    const ratio = Math.min(1, Math.max(0, currentKwh / (maxKwh || 1)));
    const filledTicks = Math.round(ratio * totalTicks);
    let svgContent = '';

    for (let i = 0; i < totalTicks; i++) {
      const angle = ((135 + (i / (totalTicks - 1)) * 270) * Math.PI) / 180;
      const innerX = cx + (radius - 8) * Math.cos(angle);
      const innerY = cy + (radius - 8) * Math.sin(angle);
      const outerX = cx + radius * Math.cos(angle);
      const outerY = cy + radius * Math.sin(angle);
      const strokeColor = i < filledTicks ? '#FF7A00' : '#E2E8F0';
      const strokeWidth = i % 5 === 0 ? 2 : 1.2;
      svgContent += `<line x1="${innerX.toFixed(1)}" y1="${innerY.toFixed(1)}" x2="${outerX.toFixed(1)}" y2="${outerY.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
    }
    container.innerHTML = svgContent;
  }

  historyPresentation(summary, timeframe) {
    const monthlyDetail = timeframe === 'Monthly' && summary.daily_detail;
    const monthCoverage=monthlyDetail ? `${summary.items.reduce((n,b)=>n+b.observed_intervals,0)}/${summary.items.reduce((n,b)=>n+b.expected_intervals,0)} hours in month · daily detail` : null;
    if (monthlyDetail) summary=summary.daily_detail;
    const first = summary.items.findIndex(b => b.observed_intervals > 0);
    const last = summary.items.reduce((index,b,i) => b.observed_intervals > 0 ? i : index,-1);
    // Only trim unavailable edges. Missing periods inside the observed range stay gaps.
    const items = first < 0 ? [] : summary.items.slice(first,last+1);
    const monthly = timeframe === 'Monthly' && !monthlyDetail;
    const forecast = summary.forecast?.items || [];
    const periods = [...new Set([...items.map(b=>b.period), ...forecast.map(b=>b.period)])].sort();
    const plotItems = periods.map(period => ({period, observed:items.find(b=>b.period===period), forecast:forecast.find(b=>b.period===period)}));
    const labels = plotItems.map(b => new Intl.DateTimeFormat('en-GB', monthly
      ? {month:'short',year:'numeric',timeZone:'UTC'}
      : {day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(b.period + (monthly ? '-01' : '') + 'T12:00:00Z')));
    const count = items.reduce((n,b) => n+b.observed_intervals,0);
    const expected = items.reduce((n,b) => n+b.expected_intervals,0);
    const range = items.length ? `${items[0].first_observed_date || items[0].period} – ${items.at(-1).last_observed_date || items.at(-1).period}` : 'No recorded history';
    const observedValues = plotItems.map(b=>b.observed?.observed_kwh ?? null);
    const forecastValues = plotItems.map(b=>b.forecast?.forecast_kwh ?? null);
    const firstForecast = forecastValues.findIndex(v=>v !== null);
    let anchor = -1;
    if (firstForecast > 0 && observedValues[firstForecast-1] !== null) {
      anchor = firstForecast-1;
      forecastValues[anchor] = observedValues[anchor];
    }
    return {items,labels,plotItems,observedValues,forecastValues,anchor,monthlyDetail:!!monthlyDetail,
      coverage:`Observed · ${range} · ${monthCoverage || `${count}/${expected} hours${count < expected ? ' · partial' : ''}`} · ${summary.timezone}. ${forecast.length ? `Dashed: next 24 forecast hours${monthly ? ' (partial-month subtotal; different coverage)' : ''}.` : 'Next 24h forecast in Hourly view.'}`};
  }

  renderEnergyOverviewChart() {
    const canvas = document.getElementById('energy-overview-chart');
    if (!canvas || !this.state.readings || !this.state.forecast || typeof Chart === 'undefined') return;

    try {
      const existing = Chart.getChart(canvas);
      if (existing) existing.destroy();
    } catch (_) {}

    if (this.energyChart) {
      try {
        this.energyChart.destroy();
      } catch (_) {}
      this.energyChart = null;
    }

    const observed = this.state.readings.items;
    if (this.state.activeTimeframe !== 'Hourly') {
      const summary = this.state.readingSummary;
      if (!summary) return;
      const view = this.historyPresentation(summary,this.state.activeTimeframe);
      const monthly = this.state.activeTimeframe === 'Monthly' && !view.monthlyDetail;
      this.energyChart = new Chart(canvas, {type:'line', data:{
        labels:view.labels, datasets:[{label:monthly ? 'Observed monthly subtotal (kWh)' : 'Observed daily energy (kWh)',
          data:view.observedValues, backgroundColor:'transparent',
          borderColor:'#FF7A00',borderWidth:2.2,spanGaps:false,
          tension:0.2,pointRadius:3},
          {label:'Forecast subtotal · next 24h (kWh)',data:view.forecastValues,backgroundColor:'transparent',
            borderColor:'#22C55E',borderWidth:2.2,borderDash:[5,5],spanGaps:false,tension:0.2,pointRadius:3}]}, options:{
        responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true,position:'bottom'},
          tooltip:{callbacks:{label:item => `${item.datasetIndex === 1 && item.dataIndex === view.anchor ? 'Observed anchor' : item.dataset.label}: ${Number(item.raw).toLocaleString(undefined,{maximumFractionDigits:2})} kWh`,
            afterLabel: item => {const entry=view.plotItems[item.dataIndex];
              const b=item.datasetIndex === 1 && item.dataIndex !== view.anchor ? entry.forecast : entry.observed;
              return b ? `${b.observed_intervals ?? b.forecast_intervals}/${b.expected_intervals} hours · ${b.status} · ${summary.timezone}` : '';}}}},
        scales:{x:{grid:{display:false},ticks:{maxRotation:0}},y:{beginAtZero:true,title:{display:true,text:'Energy (kWh)'}}}}});
      return;
    }
    const forecast = this.state.forecast.items;
    const ordered = [...observed, ...forecast].sort(
      (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
    );
    const timeline = [];
    ordered.forEach((item, index) => {
      if (index > 0) {
        const previousTime = Date.parse(ordered[index - 1].timestamp);
        const currentTime = Date.parse(item.timestamp);
        if (currentTime - previousTime > 60 * 60 * 1000) {
          timeline.push({ timestamp: new Date(previousTime + 60 * 60 * 1000).toISOString() });
        }
      }
      timeline.push(item);
    });
    const labels = timeline.map((item) => this.formatDate(item.timestamp, true));
    const observedValues = timeline.map((item) => (
      item.consumption_kwh !== undefined && item.consumption_kwh !== null ? Number(item.consumption_kwh.toFixed(1)) : null
    ));
    const forecastValues = timeline.map((item) => (
      item.forecast_kwh !== undefined && item.forecast_kwh !== null ? Number(item.forecast_kwh.toFixed(1)) : null
    ));

    this.energyChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Observed interval energy (kWh)',
            data: observedValues,
            borderColor: '#FF7A00',
            backgroundColor: 'transparent',
            borderWidth: 2.2,
            tension: 0.2,
            spanGaps: false,
            pointRadius: 0,
            pointHoverRadius: 5,
          },
          {
            label: 'Forecast interval energy (kWh)',
            data: forecastValues,
            borderColor: '#22C55E',
            backgroundColor: 'transparent',
            borderWidth: 2.2,
            borderDash: [5, 5],
            tension: 0.2,
            spanGaps: false,
            pointRadius: 0,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: {
            callbacks: {
              title: (items) => {
                const row = timeline[items[0]?.dataIndex];
                return row ? this.formatDate(row.timestamp) : '';
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 8, color: '#71767B', font: { size: 10 } },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Interval energy (kWh)' },
            ticks: { color: '#71767B', font: { size: 10 } },
            grid: { color: 'rgba(0, 0, 0, 0.05)' },
          },
        },
      },
    });
  }

  renderForecastHeatmap() {
    const forecasts = this.state.forecast?.items || [];
    const containerA = document.getElementById('heatmap-row-a');
    const containerB = document.getElementById('heatmap-row-b');
    if (!containerA || !containerB) return;
    const maxForecast = Math.max(...forecasts.map((item) => item.forecast_kwh), 1);

    const renderCells = (items) => items.map((item) => {
      const ratio = item.forecast_kwh / maxForecast;
      const colorClass = ratio > 0.88
        ? 'bg-[#FF7A00]'
        : ratio > 0.65
          ? 'bg-[#FACC15]'
          : 'bg-[#FEF08A]';
      return `<div class="heatmap-cell ${colorClass}" title="${this.formatDate(item.timestamp)}: ${this.formatNumber(item.forecast_kwh, 1)} kWh forecast"></div>`;
    }).join('');

    containerA.innerHTML = renderCells(forecasts.slice(0, 12));
    containerB.innerHTML = renderCells(forecasts.slice(12, 24));
  }

  async setTimeframe(timeframe) {
    if (!['Hourly','Daily','Monthly'].includes(timeframe)) return;
    const assetId = this.state.activeBuildingId, sequence = (this.summarySequence || 0) + 1;
    this.summarySequence = sequence;
    this.state.activeTimeframe = timeframe;
    this.renderKpiContext();
    this.setText('chart-series-label', timeframe === 'Hourly' ? 'Observed (kWh) · 24h Forecast' : `Observed ${timeframe.toLowerCase()} totals (kWh)`);
    document.querySelectorAll('.timeframe-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.timeframe === timeframe);
      b.setAttribute('aria-pressed', String(b.dataset.timeframe === timeframe));
    });
    if (timeframe !== 'Hourly') {
      this.state.readingSummary = null;
      if (this.energyChart) { this.energyChart.destroy(); this.energyChart = null; }
      this.setText('history-coverage','Loading observed history…');
      try {
        const result = await window.apiClient.getReadingSummary(assetId,timeframe.toLowerCase());
        if (sequence !== this.summarySequence || assetId !== this.state.activeBuildingId) return;
        if (result.asset_id !== assetId || !Array.isArray(result.items)) throw new Error('History response could not be verified');
        this.state.readingSummary = result;
        this.setText('history-coverage',this.historyPresentation(result,timeframe).coverage);
        this.setText('chart-series-label',timeframe === 'Monthly' ? 'Monthly view · daily detail · 24h forecast' : 'Observed · 24h forecast subtotal');
      } catch (error) {
        if (sequence === this.summarySequence && assetId === this.state.activeBuildingId) {
          this.setText('history-coverage',`History unavailable. Select ${timeframe} again to retry.`);
          this.updatePeriodCards(); this.renderBatteryOperationsChart(); this.updateBatteryStorageMetrics();
        }
        return;
      }
    } else this.setText('history-coverage','Observed hourly BDG2 readings and calculated 24-hour forecast.');
    this.renderEnergyOverviewChart();
    this.updatePeriodCards();
    this.renderBatteryOperationsChart();
    this.updateBatteryStorageMetrics();
    if (this.batteryDataMode === 'demo') void this.loadBatteryDemo();
  }

  /**
   * View Switcher for Battery Operations Card: Chart vs Table
   */
  setBatteryView(view) {
    this.batteryActiveView = view;
    const chartContainer = document.getElementById('battery-view-chart-container');
    const tableContainer = document.getElementById('battery-view-table-container');
    const btnChart = document.getElementById('btn-battery-view-chart');
    const btnTable = document.getElementById('btn-battery-view-table');

    if (btnChart && btnTable) {
      btnChart.classList.toggle('active', view === 'chart');
      btnTable.classList.toggle('active', view === 'table');
    }
    if (chartContainer && tableContainer) {
      if (view === 'chart') {
        chartContainer.classList.remove('hidden');
        tableContainer.classList.add('hidden');
        if (this.batteryOperationsChart) {
          this.batteryOperationsChart.resize();
        }
      } else {
        chartContainer.classList.add('hidden');
        tableContainer.classList.remove('hidden');
      }
    }
  }

  periodEvidence() {
    const timezone = this.state.currentBuilding?.timezone || 'UTC';
    const localDate = stamp => new Intl.DateTimeFormat('sv-SE', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
    const seen = new Set();
    let rows = [...(this.state.readings?.items || [])].filter(r => {
      const time=Date.parse(r.timestamp);
      if (!Number.isFinite(time) || seen.has(time) || !Number.isFinite(r.consumption_kwh) || r.consumption_kwh < 0 || r.interval_minutes !== 60
        || r.label !== 'observed' || r.quality_status !== 'observed') return false;
      seen.add(time); return true;
    }).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
    if (!rows.length) return null;
    const last=rows.at(-1), date=localDate(last.timestamp), mode=this.state.activeTimeframe;
    const key=mode === 'Monthly' ? date.slice(0,7) : date;
    if (mode === 'Hourly') rows=rows.filter(r=>Date.parse(r.timestamp)>Date.parse(last.timestamp)-86400000);
    else rows=rows.filter(r=>mode === 'Monthly' ? localDate(r.timestamp).slice(0,7)===key : localDate(r.timestamp)===key);
    const calendar=this.state.readingSummary?.items?.find(b=>b.period===key);
    const expected=mode === 'Monthly' ? calendar?.expected_intervals : mode === 'Daily' ? calendar?.expected_intervals || 24 : 24;
    if (mode !== 'Hourly' && calendar?.observed_intervals > 0 && [calendar.observed_kwh,calendar.min_hourly_kw,calendar.max_hourly_kw,calendar.latest_hourly_kw].every(Number.isFinite)) {
      const mean=calendar.observed_kwh/calendar.observed_intervals;
      return {rows,total:calendar.observed_kwh,peak:calendar.max_hourly_kw,min:calendar.min_hourly_kw,mean,
        latest:calendar.latest_hourly_kw,factor:calendar.max_hourly_kw>0 ? mean/calendar.max_hourly_kw*100 : null,
        period:key,expected,coverage:`${calendar.observed_intervals}/${expected} observed hours`,mode};
    }
    const total=rows.reduce((n,r)=>n+r.consumption_kwh,0), peak=Math.max(...rows.map(r=>r.consumption_kwh));
    return {rows,total,peak,min:Math.min(...rows.map(r=>r.consumption_kwh)),mean:total/rows.length,
      latest:last.consumption_kwh, factor:peak>0 ? total/rows.length/peak*100 : null,
      period:mode === 'Hourly' ? 'Latest 24 hours' : key, expected,
      coverage:`${rows.length}/${expected ?? '?'} observed hours`, mode};
  }

  updatePeriodCards() {
    const m=this.periodEvidence();
    if (!m) {
      for (const id of ['dial-power-val','dial-min-val','dial-max-val','dial-avg-val','bar-energy-val','bar-consuming-val','battery-pct-val']) this.setText(id,'Not available');
      return;
    }
    const n=v=>this.formatNumber(v,1);
    this.setText('demand-period-note',`${m.period} · ${m.coverage}`);
    this.setText('dial-period-label',m.mode === 'Hourly' ? 'Latest hourly avg' : `${m.mode} average`);
    this.setText('dial-power-val',n(m.mode === 'Hourly' ? m.latest : m.mean));
    this.setText('dial-min-val',`${n(m.min)} kW`);
    this.setText('dial-max-val',`${n(m.peak)} kW`);
    this.setText('dial-avg-val',`${n(m.mean)} kW`);
    this.setText('battery-pct-val',m.factor === null ? '—' : `${n(m.factor)}%`);
    this.setText('bar-energy-val',`${n(m.mean)} / ${n(m.peak)} kW`);
    this.setWidth('progress-bar-energy',m.factor ?? 0);
    const area=this.state.currentBuilding?.floor_area_m2;
    const eui=Number.isFinite(area) && area>0 ? m.total/area : null;
    this.setText('bar-consuming-val',eui === null ? 'Area not available' : `${eui.toFixed(2)} kWh/m² · shown period`);
    this.setWidth('progress-bar-consuming',eui === null ? 0 : Math.min(100,eui*100));
    const mae=this.state.forecast?.test_metrics?.model?.mae_kwh;
    this.setText('bar-temp-val',Number.isFinite(mae) ? `Hourly MAE ${this.formatNumber(mae,2)} kWh` : 'Not available');
    this.setWidth('progress-bar-temp',Number.isFinite(mae) && m.mean>0 ? Math.min(100,mae/m.mean*100) : 0);
    const forecasts=this.state.forecast?.items || [];
    this.setText('load-period-note',`Observed · ${m.period} · load factor = mean / peak hourly demand`);
    this.setText('period-forecast-note',forecasts.length === 24 ? `ML forecast: next 24h ${n(forecasts.reduce((sum,r)=>sum+r.forecast_kwh,0))} kWh. Model MAE keeps its hourly evaluation basis.` : '24h forecast unavailable.');
    this.renderPowerDialTicks(m.mode === 'Hourly' ? m.latest : m.mean,m.peak);
  }

  setBatteryDataMode(mode) {
    if (!['demo','plan'].includes(mode)) return;
    this.batteryDataMode=mode;
    localStorage.setItem('ENERGIOS_BATTERY_VIEW',mode);
    this.renderBatteryOperationsChart();this.updateBatteryStorageMetrics();
    if (mode === 'demo') void this.loadBatteryDemo();
  }

  async loadBatteryDemo(force=false) {
    const asset=this.state.activeBuildingId, period=this.state.activeTimeframe.toLowerCase();
    if (!asset || this.batteryDataMode !== 'demo') return;
    const key=`${asset}:${period}`, cached=this.batteryDemos.get(key);
    if (!force && cached) return cached.promise;
    const entry={status:'loading'};this.batteryDemos.set(key,entry);
    entry.promise=(async()=>{
      try {
        const result=await window.apiClient.getBatteryDemo(asset,period);
        if (result.asset_id!==asset || result.period!==period || !Array.isArray(result.items)) throw new Error('Demo data could not be verified');
        entry.result=result;entry.status='ready';
      } catch(error) {entry.status='error';entry.error='Battery demo unavailable. Use Retry.';}
      if (this.state.activeBuildingId===asset && this.state.activeTimeframe.toLowerCase()===period && this.batteryDataMode==='demo') {
        this.renderBatteryOperationsChart();this.updateBatteryStorageMetrics();
      }
    })();
    return entry.promise;
  }

  dashboardDispatch() {
    const approved=window.dispatchPlans?.forAsset(this.state.activeBuildingId);
    if (approved) return {...approved,kind:'Approved scenario'};
    const entry=this.kpiScenarios.get(this.state.activeBuildingId);
    if (entry?.status === 'ready' && entry.result?.asset_id === this.state.activeBuildingId) return {result:entry.result,kind:'Demo projection'};
    return null;
  }

  batteryPeriodView(plan=this.dashboardDispatch()) {
    if (arguments.length===0 && this.batteryDataMode==='demo') {
      const demo=this.batteryDemos.get(`${this.state.activeBuildingId}:${this.state.activeTimeframe.toLowerCase()}`)?.result;
      if (!demo) return null;
      const items=demo.items.map(b=>({...b,label:this.state.activeTimeframe==='Hourly' ? b.key.slice(11,16) : b.key,
        color:b.state==='cycling' ? '#8B5CF6' : b.state==='charging' ? '#22C55E' : b.state==='discharging' ? '#FF7A00' : '#0284C7'}));
      return {synthetic:true,plan:{kind:'Demo battery cycle',result:{hours:[demo.storage_hour],weather:{timezone:demo.timezone},assumptions:demo.assumptions}},
        items,capacity:demo.assumptions.battery_capacity_kwh,...demo.totals,hourCount:demo.scope_hours,
        storageHour:demo.storage_hour,demandKwh:demo.totals.demand_kwh,metadata:demo};
    }
    if (!plan?.result?.hours?.length) return null;
    const r=plan.result, capacity=r.assumptions.battery_capacity_kwh;
    if (!Number.isFinite(capacity) || capacity<0 || typeof r.weather?.timezone!=='string') return null;
    const groups=new Map(), mode=this.state.activeTimeframe;
    let charging=0,discharging=0,storing=0;
    for (const h of r.hours) {
      if (typeof h.weather_timestamp!=='string') return null;
      if (![h.solar_to_battery_kwh,h.battery_to_load_kwh,h.battery_soc_kwh].every(v=>Number.isFinite(v)&&v>=0) || h.battery_soc_kwh>capacity) return null;
      const key=mode === 'Monthly' ? h.weather_timestamp.slice(0,7) : mode === 'Daily' ? h.weather_timestamp.slice(0,10) : h.weather_timestamp;
      const b=groups.get(key)||{key,count:0,charge:0,discharge:0};
      b.count++; b.charge+=h.solar_to_battery_kwh; b.discharge+=h.battery_to_load_kwh;
      b.soc=capacity>0 ? h.battery_soc_kwh/capacity*100 : 0; b.hour=h;
      groups.set(key,b);
      if (h.solar_to_battery_kwh>0) charging++; else if (h.battery_to_load_kwh>0) discharging++; else storing++;
    }
    const items=[...groups.values()].map(b=>({...b,label:mode === 'Hourly' ? b.key.slice(11,16) : b.key,
      state:b.charge>0 && b.discharge>0 ? 'cycling' : b.charge>0 ? 'charging' : b.discharge>0 ? 'discharging' : 'storing',
      color:b.charge>0 && b.discharge>0 ? '#8B5CF6' : b.charge>0 ? '#22C55E' : b.discharge>0 ? '#FF7A00' : '#0284C7'}));
    return {plan,items,capacity,charging,discharging,storing,
      charge:items.reduce((n,b)=>n+b.charge,0),discharge:items.reduce((n,b)=>n+b.discharge,0)};
  }

  renderBatteryOperationsChart() {
    const ctx=document.getElementById('battery-level-chart'), table=document.getElementById('battery-operations-table-body');
    const view=this.batteryPeriodView();
    const retry=document.getElementById('battery-demo-retry');
    if (retry) retry.hidden=this.batteryDataMode!=='demo';
    if (this.batteryOperationsChart) {this.batteryOperationsChart.destroy();this.batteryOperationsChart=null;}
    if (!view) {
      const pending=this.batteryDemos.get(`${this.state.activeBuildingId}:${this.state.activeTimeframe.toLowerCase()}`);
      this.setText('battery-operations-note',pending?.status==='error' ? pending.error : 'Preparing battery demo from this building’s demand forecast…');
      if (table) table.innerHTML='';
      for (const id of ['bat-kpi-charging','bat-kpi-storing','bat-kpi-discharging']) this.setText(id,'—');
      return;
    }
    const r=view.plan.result, mode=this.state.activeTimeframe;
    const count=view.hourCount ?? r.hours.length, grouped=mode!=='Hourly';
    this.setText('battery-operations-note',view.synthetic
      ? `Demo battery assumptions · ${view.metadata.scope} · ${count} hours · ${r.weather.timezone}`
      : `${view.plan.kind} · ${mode} · ${count}h forecast only · ${r.weather.timezone} · ${mode === 'Hourly' ? 'Hourly SOC' : 'Period-end SOC'} · demo battery inputs`);
    this.setText('battery-demo-sources',view.synthetic ? JSON.stringify({version:view.metadata.version,sources:view.metadata.sources,
      assumptions:view.metadata.assumptions,formulas:view.metadata.formulas,limitations:view.metadata.limitations},null,2)
      : 'This view uses the existing approved plan or forecast preview. A reserve-only plan correctly stays in standby.');
    this.setText('bat-kpi-charging',`${view.charging} hrs · +${view.charge.toFixed(1)} kWh`);
    this.setText('bat-kpi-storing',`${view.storing} hrs · Standby`);
    this.setText('bat-kpi-discharging',`${view.discharging} hrs · -${view.discharge.toFixed(1)} kWh`);
    if (table) table.innerHTML=view.items.map(b=>`<tr><td class="p-3">${b.key.replace('T',' ')}</td><td class="p-3">${b.soc.toFixed(1)}%${grouped && Number.isFinite(b.min_soc) ? ` end · ${b.min_soc.toFixed(1)}–${b.max_soc.toFixed(1)}% range` : ''}</td><td class="p-3 capitalize">${b.state}</td><td class="p-3">${((b.discharge-b.charge)/b.count).toFixed(1)} kW avg</td><td class="p-3">+${b.charge.toFixed(1)} / -${b.discharge.toFixed(1)} kWh · ${b.count}h scenario</td></tr>`).join('');
    if (!ctx || typeof Chart === 'undefined') return;
    const datasets=grouped ? [
      {label:'Charge (kWh)',data:view.items.map(b=>b.charge),backgroundColor:'#22C55E',maxBarThickness:22},
      {label:'Discharge (kWh)',data:view.items.map(b=>b.discharge),backgroundColor:'#FF7A00',maxBarThickness:22},
      {type:'line',label:'End SOC (%)',data:view.items.map(b=>b.soc),borderColor:'#0284C7',backgroundColor:'transparent',yAxisID:'soc',pointRadius:2}
    ] : [{label:'Scenario SOC (%)',data:view.items.map(b=>b.soc),backgroundColor:view.items.map(b=>b.color),maxBarThickness:42,borderRadius:3}];
    this.batteryOperationsChart=new Chart(ctx,{type:'bar',data:{labels:view.items.map(b=>b.label),datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:grouped,position:'bottom'},tooltip:{callbacks:{afterLabel:item=>{const b=view.items[item.dataIndex];return [`${b.state} · ${b.count} scenario hours`,`Charge ${b.charge.toFixed(1)} / discharge ${b.discharge.toFixed(1)} kWh`];}}}},scales:{y:grouped ? {beginAtZero:true,title:{display:true,text:'Energy (kWh)'}} : {min:0,max:100,ticks:{callback:v=>`${v}%`}},...(grouped ? {soc:{position:'right',min:0,max:100,grid:{drawOnChartArea:false},ticks:{callback:v=>`${v}%`}}} : {}),x:{grid:{display:false},ticks:{maxTicksLimit:8,maxRotation:0}}}}});
  }

  updateBatteryStorageMetrics() {
    const view=this.batteryPeriodView();
    if (!view) {
      for (const id of ['gauge-percent','metric-current-power','metric-duration','metric-capacity']) this.setText(id,'—');
      this.setText('gauge-status-rate','Waiting for forecast scenario');
      this.setText('battery-status-tag','Demo battery');
      const gauge=document.getElementById('battery-gauge-circle');
      if (gauge) gauge.style.strokeDashoffset=339.29;
      return;
    }
    const {plan,capacity}=view, r=plan.result, a=r.assumptions;
    const hourly=this.state.activeTimeframe==='Hourly';
    const h=view.storageHour || (hourly ? r.hours[plan.transition?.hour_index ?? 0] : r.hours.at(-1));
    const soc=capacity>0 ? h.battery_soc_kwh/capacity*100 : 0;
    const count=view.hourCount ?? r.hours.length;
    const net=hourly ? h.battery_to_load_kwh-h.solar_to_battery_kwh : (view.discharge-view.charge)/count;
    const available=Number.isFinite(a.discharge_efficiency) && Number.isFinite(a.battery_reserve_pct)
      ? Math.max(0,h.battery_soc_kwh-capacity*a.battery_reserve_pct/100)*a.discharge_efficiency : null;
    const load=hourly ? h.demand_forecast_kwh : (view.demandKwh ?? r.hours.reduce((n,row)=>n+row.demand_forecast_kwh,0))/count;
    this.setText('gauge-percent',`${soc.toFixed(1)}%`);
    this.setText('gauge-status-rate',`${plan.kind} · ${hourly ? 'selected hour' : 'period end'}`);
    this.setText('battery-status-tag',!hourly && view.charge>0 && view.discharge>0 ? 'Scenario cycling' : Math.abs(net)<0.0001 ? 'Scenario standby' : net>0 ? 'Scenario discharging' : 'Scenario charging');
    this.setText('metric-current-power',`${net.toFixed(1)} kW avg (discharge +)`);
    this.setText('metric-duration',available === null ? 'Reserve/efficiency not configured' : available<=0 ? '0.0 h · reserve held' : !Number.isFinite(a.max_discharge_kw) ? 'Power limit not configured' : a.max_discharge_kw<load ? 'Power limit below building demand' : load>0 ? `${(available/load).toFixed(1)} h at forecast load` : 'No forecast load');
    this.setText('metric-capacity',`${capacity.toFixed(1)} kWh · assumption`);
    this.setText('battery-storage-note',`${view.synthetic ? 'Demo battery assumptions' : this.state.activeTimeframe} · ${count}h · reserve ${a.battery_reserve_pct}%`);
    const gauge=document.getElementById('battery-gauge-circle');
    if (gauge) gauge.style.strokeDashoffset=339.29*(1-soc/100);
  }

  openAlertDetails() {
    this.showToast('Anomaly alerts triage active · Thresholds nominal');
  }

  closeAlertDetails() {
    // Safe stub
  }

  clearMetrics() {
    const placeholders = [
      'metric-total-val',
      'metric-current-val',
      'metric-export-val',
      'dial-power-val',
      'dial-min-val',
      'dial-max-val',
      'dial-avg-val',
      'battery-pct-val',
      'bar-energy-val',
      'bar-consuming-val',
      'bar-temp-val',
      'impact-cost-val',
      'impact-carbon-val',
      'impact-eui-val',
      'gauge-percent','metric-current-power','metric-duration','metric-capacity',
    ];
    placeholders.forEach((id) => this.setText(id, '—'));
    this.setText('metric-total-delta', 'Estimated grid electricity saved: Not available');
    this.setText('metric-current-status', 'Estimated grid purchase cost saved: Not available');
    this.setText('metric-export-delta', 'Forecast accuracy improvement: Not available');
    this.setText('kpi-estimate-evidence', 'Savings estimate: Not available — dashboard data is unavailable.');
    this.setText('kpi-observed-comparison', 'Observed prior-day comparison: Not available.');
    this.setText('alerts-count-tag', 'Unavailable');
    this.setText('anomaly-rule-summary', 'Rule evidence unavailable · whole-building meter');
    this.setText('forecast-method-description', 'Method details unavailable.');
    this.setText('forecast-evaluation-period', 'Evaluation period unavailable.');
    document.getElementById('forecast-limitations')?.replaceChildren();
    ['progress-bar-energy', 'progress-bar-consuming', 'progress-bar-temp'].forEach((id) => this.setWidth(id, 0));
    ['heatmap-row-a', 'heatmap-row-b'].forEach((id) => document.getElementById(id)?.replaceChildren());
    this.energyChart?.destroy();
    this.energyChart = null;
    this.batteryOperationsChart?.destroy();
    this.batteryOperationsChart = null;
  }

  setUnavailable(message) {
    this.clearMetrics();
    const subtitle = document.getElementById('site-subtitle-tag');
    if (subtitle) subtitle.textContent = `Public benchmark · Data unavailable · ${message}`;
    this.showToast(`Backend data unavailable: ${message}`);
  }

  setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  setWidth(id, value) {
    const element = document.getElementById(id);
    if (element) element.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }

  setLoading(isLoading) {
    document.body.classList.toggle('api-loading', isLoading);
  }

  formatNumber(value, digits = 2) {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  formatDate(value, compact = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    const timezone = this.state.currentBuilding?.timezone || 'UTC';
    try {
      return new Intl.DateTimeFormat(undefined, compact
        ? { hour: 'numeric', minute: '2-digit', timeZone: timezone }
        : { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }
      ).format(date);
    } catch (_) {
      try {
        return new Intl.DateTimeFormat(undefined, compact
          ? { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }
          : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }
        ).format(date);
      } catch (_) {
        return date.toISOString().replace('T', ' ').substring(0, 16);
      }
    }
  }

  showToast(message) {
    const toast = document.getElementById('velora-toast');
    const text = document.getElementById('velora-toast-text');
    if (!toast || !text) return;
    text.textContent = message;
    toast.classList.remove('opacity-0', 'translate-y-4');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-4');
      toast.classList.remove('opacity-100', 'translate-y-0');
    }, 4000);
  }

  setupEventListeners() {
    document.getElementById('battery-data-source')?.addEventListener('change',event=>this.setBatteryDataMode(event.target.value));
    document.getElementById('battery-demo-retry')?.addEventListener('click',()=>this.loadBatteryDemo(true));
    this.setupKpiAssumptions();
    window.addEventListener('energios:dispatch-updated', () => {
      if (!this.state.readings) return;
      for (const asset of this.state.assets) void this.loadKpiScenario(asset.id);
      this.renderKpiContext();
      this.renderBatteryOperationsChart();
      this.updateBatteryStorageMetrics();
    });
    document.getElementById('alerts-card-trigger')?.addEventListener('click', () => this.openAlertDetails());
    document.getElementById('api-status-pill')?.addEventListener('click', () => this.loadData());
    window.addEventListener('energios:theme-changed', () => {
      const colors = window.getChartThemeColors?.();
      if (colors && this.energyChart) {
        this.energyChart.options.scales.x.ticks.color = colors.textColor;
        this.energyChart.options.scales.y.grid.color = colors.gridColor;
        this.energyChart.options.scales.y.ticks.color = colors.textColor;
        this.energyChart.update();
      }
      if (this.batteryOperationsChart) {
        this.renderBatteryOperationsChart();
      }
    });
    window.addEventListener('energios:settings-updated', (event) => {
      const newSettings = event.detail;
      if (newSettings?.defaultBuildingId && newSettings.defaultBuildingId !== this.state.activeBuildingId) {
        this.selectBuilding(newSettings.defaultBuildingId);
      } else if (this.state.readings && this.state.forecast) {
        this.updateProjectReadings();
      }
    });
  }
}

window.veloraApp = new EnergiOSDashboard();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.veloraApp.init());
} else {
  window.veloraApp.init();
}
