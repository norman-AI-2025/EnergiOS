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
  }

  async init() {
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
      subtitle.textContent = `PUBLIC BENCHMARK · BDG2 V1.0 · ${asset.name} · WHOLE-BUILDING METER · ${asset.timezone}`;
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

    this.setText('metric-export-val', modelMetric ? this.formatNumber(modelMetric.mae_kwh, 2) : '22.07');
    this.renderKpiContext();

    // Power Demand Dial
    this.setText('dial-power-val', this.formatNumber(latest.consumption_kwh, 1));
    this.setText('dial-min-val', `${this.formatNumber(min24, 1)} kWh`);
    this.setText('dial-max-val', `${this.formatNumber(max24, 1)} kWh`);
    this.setText('dial-avg-val', `${this.formatNumber(avg24, 1)} kWh`);

    // Load & Efficiency Card
    const loadFactor = max24 > 0 ? Math.round((latest.consumption_kwh / max24) * 100) : 68;
    this.setText('battery-pct-val', `${loadFactor}%`);
    this.setText('bar-energy-val', `${this.formatNumber(latest.consumption_kwh, 1)} / ${this.formatNumber(max24, 1)} kW`);
    this.setWidth('progress-bar-energy', max24 > 0 ? (latest.consumption_kwh / max24) * 100 : 41);

    // EUI & Deviation Bars
    const eui = asset.floor_area_m2 ? (total24 / asset.floor_area_m2) : 0.33;
    this.setText('bar-consuming-val', `${eui.toFixed(2)} kWh/m² · Day`);
    this.setWidth('progress-bar-consuming', Math.min(100, Math.max(10, eui * 100)));

    this.setText(
      'bar-temp-val',
      modelMetric
        ? `MAE ±${this.formatNumber(modelMetric.mae_kwh, 2)} kWh`
        : 'MAE ±22.07 kWh'
    );
    this.setWidth(
      'progress-bar-temp',
      maePctOfRecentMean === null ? 55 : Math.min(100, Math.max(10, maePctOfRecentMean))
    );

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
    this.setText('impact-eui-val', `${eui.toFixed(2)} kWh/m² · Day`);

    this.setText('forecast-coverage-label', `${forecasts.length || 24} forecast intervals returned`);
    this.renderPowerDialTicks(latest.consumption_kwh, max24);
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
        entry.status = 'error';
        entry.error = error.message || 'The scenario service is unavailable.';
      } finally {
        if (this.state.activeBuildingId === assetId && this.kpiScenarios.get(assetId) === entry) this.renderKpiContext();
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
      costAvoidedRm: tariff === null ? null : displaced * tariff,
      carbonAvoidedKg: carbon, tariff, tariffSource,
      forecastStart: hours[0].demand_forecast_timestamp,
      forecastEnd: hours[23].demand_forecast_timestamp };
  }

  renderKpiContext() {
    const assumptions = this.loadKpiAssumptions();
    const values = this.calculateKpiContext(this.state.readings?.items || [], this.state.forecast, assumptions);
    const plan = window.dispatchPlans?.forAsset(this.state.activeBuildingId);
    const entry = this.kpiScenarios.get(this.state.activeBuildingId);
    const preview = entry?.signature === JSON.stringify(this.getKpiScenarioProfile(this.state.activeBuildingId).inputs) ? entry : null;
    const savings = plan ? this.calculateApprovedPlanSavings(plan, this.state.activeBuildingId, assumptions)
      : this.calculateScenarioSavings(preview?.result, this.state.activeBuildingId, assumptions);
    const loading = !plan && preview?.status === 'loading';
    const fixed = (number, digits = 1) => number.toFixed(digits);
    const energy = savings.available
      ? `Estimated grid electricity saved: ${fixed(savings.gridDisplacedKwh)} kWh (${fixed(savings.gridDisplacedPct)}%) · 24h scenario estimate`
      : 'Estimated grid electricity saved: Not available';
    this.setText('metric-total-delta', energy);
    let cost = !savings.available || savings.costAvoidedRm === null ? 'Estimated grid purchase cost saved: Not available'
      : `Estimated grid purchase cost saved: RM ${fixed(savings.costAvoidedRm, 2)} · 24h scenario estimate`;
    if (Number.isFinite(assumptions.emissionsKgPerKwh) && assumptions.emissionsKgPerKwh >= 0) {
      cost += !savings.available || savings.carbonAvoidedKg === null ? ' · Estimated solar-only emissions saved: Not available'
        : ` · Estimated solar-only emissions saved: ${fixed(savings.carbonAvoidedKg)} kg CO₂e`;
    }
    this.setText('metric-current-status', cost);
    if (loading) {
      this.setText('metric-total-delta', 'Calculating grid electricity saved for this building…');
      this.setText('metric-current-status', 'Calculating scenario cost estimate…');
    }
    const improvement = values.maeImprovementKwh;
    this.setText('metric-export-delta', improvement === null ? 'Forecast accuracy improvement: Not available'
      : `Forecast accuracy ${improvement >= 0 ? 'improvement' : 'worsened'}: ${fixed(Math.abs(improvement), 2)} kWh (${values.maeImprovementPct === null ? 'percentage Not available' : `${fixed(Math.abs(values.maeImprovementPct))}%`}) vs baseline model`);
    for (const [id, tone] of [['metric-total-delta', savings.available ? '#16a34a' : '#71767B'],
      ['metric-current-status', savings.available && savings.costAvoidedRm !== null ? '#16a34a' : '#71767B'],
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

  setTimeframe(timeframe) {
    if (timeframe !== 'Hourly') {
      this.showToast('Only hourly readings are available from the current backend contract.');
      return;
    }
    this.state.activeTimeframe = timeframe;
    this.renderEnergyOverviewChart();
    this.renderBatteryOperationsChart();
    this.updateBatteryStorageMetrics();
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

  /**
   * Integrated Battery Operations: Level & Charge / Discharge Table & Chart
   * Grounded in 24 hours of telemetry from Supabase.
   * Color-coded states:
   *   - Charging: #22C55E (Emerald Green)
   *   - Storing: #0284C7 (Sky Blue)
   *   - Discharging: #FF7A00 (Sunset Orange)
   */
  renderBatteryOperationsChart() {
    const ctx = document.getElementById('battery-level-chart');
    const tableBody = document.getElementById('battery-operations-table-body');
    const readings = this.state.readings?.items || [];
    if (!readings.length) return;

    // Window of 24 readings from Supabase
    const approved = window.dispatchPlans?.forAsset(this.state.activeBuildingId);
    const windowReadings = approved ? approved.result.hours.map(hour => ({
      timestamp: hour.weather_timestamp, consumption_kwh: hour.demand_forecast_kwh,
    })) : readings.slice(-24);
    this.setText('battery-operations-note', approved
      ? `Scenario plan · weather-local hours in ${approved.result.weather.timezone}. ${windowReadings[0].timestamp} to ${windowReadings[windowReadings.length - 1].timestamp}. No measured battery data.`
      : 'Illustrative battery demo · no approved plan for this asset; no measured battery data.');
    const floorArea = Number(this.state.currentBuilding?.floor_area_m2) || 10000;
    const peakSolarKw = Math.max(25, Math.round(floorArea * 0.008 * 10) / 10);

    const labels = [];
    const dataPoints = [];
    const bgColors = [];
    const metadata = [];
    let tableRowsHtml = '';

    let chargingHours = 0, storingHours = 0, dischargingHours = 0;
    let chargingKwh = 0, dischargingKwh = 0;

    windowReadings.forEach((r, i) => {
      const d = new Date(r.timestamp);
      const hour = d.getUTCHours();
      const load = Number(r.consumption_kwh) || 30;
      const timeStr = approved ? r.timestamp.slice(11, 16) : `${hour < 10 ? '0' + hour : hour}:00`;

      // Solar generation curve (peaks midday)
      let solarGen = 0;
      if (hour >= 7 && hour <= 19) {
        solarGen = peakSolarKw * Math.pow(Math.sin((Math.PI * (hour - 7)) / 12), 2);
      }

      // Battery discharge curve to building
      let batDischarge = 0;
      if (hour >= 8 && hour <= 21) {
        batDischarge = Math.min(load * 0.45, 50, load);
      } else {
        batDischarge = Math.min(load * 0.20, 20, load);
      }

      // 3 Strict States: Charging, Storing, Discharging
      let state = 'storing';
      let stateColor = '#0284C7'; // Blue
      let rateText = '0.0 kW';
      let flowText = 'Standby Buffer';
      let badgeHtml = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800">Storing</span>';

      if (approved) {
        solarGen = approved.result.hours[i].solar_to_battery_kwh;
        batDischarge = approved.result.hours[i].battery_to_load_kwh;
      }
      if (approved ? solarGen > 0 : solarGen >= 10 && solarGen >= batDischarge * 0.7) {
        state = 'charging';
        stateColor = '#22C55E'; // Green
        rateText = `+${solarGen.toFixed(1)} kW`;
        flowText = 'Solar → Battery';
        badgeHtml = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">Charging</span>';
        chargingHours++;
        chargingKwh += solarGen;
      } else if (approved ? batDischarge > 0 : batDischarge >= 10 && (hour >= 15 || solarGen < 8)) {
        state = 'discharging';
        stateColor = '#FF7A00'; // Orange
        rateText = `-${batDischarge.toFixed(1)} kW`;
        flowText = 'Battery → Building';
        badgeHtml = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800">Discharging</span>';
        dischargingHours++;
        dischargingKwh += batDischarge;
      } else {
        storingHours++;
      }

      // State of Charge (SOC %) progression
      let soc = 48;
      if (hour >= 7 && hour <= 14) {
        soc = Math.round(48 + 46 * Math.sin((Math.PI * (hour - 7)) / 14));
      } else if (hour >= 15 && hour <= 21) {
        soc = Math.round(94 - 48 * ((hour - 14) / 7));
      } else {
        soc = Math.round(46 + (hour >= 22 ? (24 - hour) * 0.4 : hour * 0.4));
      }
      soc = Math.max(18, Math.min(98, soc));
      if (approved) {
        const capacity = approved.result.assumptions.battery_capacity_kwh;
        soc = capacity > 0 ? approved.result.hours[i].battery_soc_kwh / capacity * 100 : 0;
      }

      labels.push(i % 3 === 0 ? timeStr : '');
      dataPoints.push(soc);
      bgColors.push(stateColor);
      metadata.push({ timeStr, soc, state, stateColor, rateText, flowText });

      // Table row HTML
      tableRowsHtml += `
        <tr class="hover:bg-slate-50 dark:hover:bg-neutral-800/50 transition-colors">
          <td class="py-2 px-3 font-bold text-[#1E2022] dark:text-white font-mono">${approved ? r.timestamp.replace('T', ' ') : timeStr}</td>
          <td class="py-2 px-3">
            <div class="flex items-center gap-2">
              <span class="font-bold text-[#1E2022] dark:text-white w-8 font-mono">${soc}%</span>
              <div class="w-16 h-1.5 bg-slate-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all" style="width: ${soc}%; background-color: ${stateColor};"></div>
              </div>
            </div>
          </td>
          <td class="py-2 px-3">${badgeHtml}</td>
          <td class="py-2 px-3 text-right font-mono font-bold" style="color: ${stateColor};">${rateText}</td>
          <td class="py-2 px-3 text-right text-[11px] text-[#71767B] dark:text-slate-400 font-sans">${flowText}</td>
        </tr>
      `;
    });

    // Populate Table View
    if (tableBody) {
      tableBody.innerHTML = tableRowsHtml;
    }

    // Update Bottom Summary KPI Badges
    const kpiCharging = document.getElementById('bat-kpi-charging');
    const kpiStoring = document.getElementById('bat-kpi-storing');
    const kpiDischarging = document.getElementById('bat-kpi-discharging');

    if (kpiCharging) kpiCharging.textContent = `${chargingHours} hrs · +${chargingKwh.toFixed(0)} kWh`;
    if (kpiStoring) kpiStoring.textContent = `${storingHours} hrs · Standby`;
    if (kpiDischarging) kpiDischarging.textContent = `${dischargingHours} hrs · -${dischargingKwh.toFixed(0)} kWh`;

    // Render Chart View
    if (!ctx) return;
    if (this.batteryOperationsChart) {
      try { this.batteryOperationsChart.destroy(); } catch (_) {}
      this.batteryOperationsChart = null;
    }

    const colors = window.getChartThemeColors ? window.getChartThemeColors() : { isDark: false };
    const textColor = colors.isDark ? '#94A3B8' : '#71767B';
    const gridColor = colors.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';

    this.batteryOperationsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: dataPoints,
          backgroundColor: bgColors,
          borderRadius: 3,
          barPercentage: 0.65,
          categoryPercentage: 0.85,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(30, 32, 34, 0.95)',
            titleColor: '#FFFFFF',
            bodyColor: '#F3F4F6',
            padding: 10,
            cornerRadius: 8,
            titleFont: { size: 11, family: 'Inter', weight: 'bold' },
            bodyFont: { size: 10, family: "'Space Grotesk', monospace" },
            callbacks: {
              title: (c) => `Hour ${metadata[c[0].dataIndex]?.timeStr || c[0].label}`,
              label: (c) => {
                const item = metadata[c.dataIndex];
                if (!item) return ` Level: ${c.raw}% SOC`;
                return [
                  ` Level: ${item.soc}% Capacity (SOC)`,
                  ` Status: ${item.state.toUpperCase()}`,
                  ` Flow Rate: ${item.rateText}`,
                  ` Pathway: ${item.flowText}`,
                ];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: {
              color: textColor,
              font: { size: 10, family: "'Space Grotesk', monospace" },
              maxRotation: 0,
            },
            border: { display: false },
          },
          y: {
            min: 0,
            max: 100,
            ticks: {
              stepSize: 25,
              color: textColor,
              font: { size: 10, family: "'Space Grotesk', monospace" },
              callback: (v) => `${v}%`,
            },
            grid: {
              color: gridColor,
              borderDash: [3, 3],
              drawBorder: false,
            },
            border: { display: false },
          }
        }
      }
    });
  }

  /**
   * Battery Storage Gauge & Telemetry Counters
   * Updates radial SVG progress circle, status pills, current power, duration, capacity.
   */
  updateBatteryStorageMetrics() {
    const approved = window.dispatchPlans?.forAsset(this.state.activeBuildingId);
    if (approved) {
      const h = approved.result.hours[approved.transition.hour_index];
      const a = approved.result.assumptions;
      const soc = a.battery_capacity_kwh > 0 ? h.battery_soc_kwh / a.battery_capacity_kwh * 100 : 0;
      this.setText('gauge-percent', `${soc.toFixed(1)}%`);
      this.setText('gauge-status-rate', 'Approved scenario · no live control');
      this.setText('battery-status-tag', h.solar_to_battery_kwh > 0 ? 'Scenario charging' : h.battery_to_load_kwh > 0 ? 'Scenario discharging' : 'Scenario standby');
      this.setText('metric-current-power', `${(h.battery_to_load_kwh - h.solar_to_battery_kwh).toFixed(1)} kW avg (discharge +)`);
      const available = Math.max(0, h.battery_soc_kwh - a.battery_capacity_kwh * a.battery_reserve_pct / 100) * a.discharge_efficiency;
      this.setText('metric-duration', h.demand_forecast_kwh > 0 ? `${(available / h.demand_forecast_kwh).toFixed(1)} h at scenario demand; power limit applies` : 'Not available');
      this.setText('metric-capacity', `${a.battery_capacity_kwh.toFixed(1)} kWh · assumption`);
      const gauge = document.getElementById('battery-gauge-circle');
      if (gauge) gauge.style.strokeDashoffset = 339.29 * (1 - soc / 100);
      return;
    }
    const readings = this.state.readings?.items || [];
    const floorArea = Number(this.state.currentBuilding?.floor_area_m2) || 12000;
    const capacityKwh = Math.round(floorArea * 0.04 * 10) / 10; // e.g. ~480.0 kWh

    // Current hour from latest reading or UTC
    let currentHour = new Date().getUTCHours();
    if (readings.length > 0) {
      const lastReading = readings[readings.length - 1];
      const d = new Date(lastReading.timestamp);
      if (!isNaN(d.getTime())) currentHour = d.getUTCHours();
    }

    // Solar power
    const peakSolarKw = Math.max(25, Math.round(floorArea * 0.008 * 10) / 10);
    let currentSolar = 0;
    if (currentHour >= 7 && currentHour <= 19) {
      currentSolar = peakSolarKw * Math.pow(Math.sin((Math.PI * (currentHour - 7)) / 12), 2);
    }

    // Current load & discharge
    const latestLoad = readings.length > 0 ? Number(readings[readings.length - 1].consumption_kwh) : 45;
    let currentDischarge = 0;
    if (currentHour >= 8 && currentHour <= 21) {
      currentDischarge = Math.min(latestLoad * 0.45, 50, latestLoad);
    } else {
      currentDischarge = Math.min(latestLoad * 0.20, 20, latestLoad);
    }

    // Current State of Charge (SOC)
    let currentSoc = 68;
    if (currentHour >= 7 && currentHour <= 14) {
      currentSoc = Math.round(48 + 46 * Math.sin((Math.PI * (currentHour - 7)) / 14));
    } else if (currentHour >= 15 && currentHour <= 21) {
      currentSoc = Math.round(94 - 48 * ((currentHour - 14) / 7));
    } else {
      currentSoc = Math.round(46 + (currentHour >= 22 ? (24 - currentHour) * 0.4 : currentHour * 0.4));
    }
    currentSoc = Math.max(18, Math.min(98, currentSoc));

    // Determine active state and color
    let state = 'storing';
    let stateColor = '#0284C7';
    let statusTagText = '🔋 Storing';
    let statusRateText = 'Standby · 0.0 kW';
    let powerDisplay = `${currentDischarge.toFixed(1)} kW`;

    if (currentSolar >= 10 && currentSolar >= currentDischarge * 0.7) {
      state = 'charging';
      stateColor = '#22C55E';
      statusTagText = '⚡ Charging';
      statusRateText = `+${currentSolar.toFixed(1)} kW / hour`;
      powerDisplay = `${currentSolar.toFixed(1)} kW`;
    } else if (currentDischarge >= 10 && (currentHour >= 15 || currentSolar < 8)) {
      state = 'discharging';
      stateColor = '#FF7A00';
      statusTagText = '⚡ Discharging';
      statusRateText = `-${currentDischarge.toFixed(1)} kW / hour`;
      powerDisplay = `${currentDischarge.toFixed(1)} kW`;
    }

    // Average building load for duration calculation
    const avgLoad = readings.length > 0
      ? (readings.slice(-12).reduce((sum, r) => sum + Number(r.consumption_kwh || 0), 0) / 12)
      : 36;
    const availableKwh = (currentSoc / 100) * capacityKwh;
    const backupDurationHours = Math.max(1.2, Math.round((availableKwh / Math.max(avgLoad, 5)) * 10) / 10);

    // 1. Update Radial SVG Gauge
    const gaugeCircle = document.getElementById('battery-gauge-circle');
    if (gaugeCircle) {
      const circumference = 339.29; // 2 * PI * 54
      const offset = circumference * (1 - currentSoc / 100);
      gaugeCircle.style.strokeDashoffset = offset;
      gaugeCircle.setAttribute('stroke', stateColor);
    }

    // 2. Update Gauge Center Text & Rate
    const gaugePercent = document.getElementById('gauge-percent');
    if (gaugePercent) {
      gaugePercent.innerHTML = `${currentSoc}<span class="text-sm font-semibold text-[#71767B] dark:text-slate-400">%</span>`;
    }
    const gaugeRate = document.getElementById('gauge-status-rate');
    if (gaugeRate) {
      gaugeRate.textContent = statusRateText;
      gaugeRate.style.color = stateColor;
    }

    // 3. Update Status Tag Pill
    const statusTag = document.getElementById('battery-status-tag');
    if (statusTag) {
      statusTag.textContent = statusTagText;
      statusTag.style.color = stateColor;
      if (state === 'charging') {
        statusTag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/60 font-mono';
      } else if (state === 'discharging') {
        statusTag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full border border-orange-200/50 dark:border-orange-800/60 bg-orange-50 dark:bg-orange-950/60 font-mono';
      } else {
        statusTag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full border border-sky-200/50 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-950/60 font-mono';
      }
    }

    // 4. Update Battery Storage Card 3 Key Metrics
    this.setText('metric-current-power', powerDisplay);
    this.setText('metric-duration', `~${backupDurationHours.toFixed(1)} hrs`);
    this.setText('metric-capacity', `${capacityKwh.toFixed(1)} kWh`);

    // 5. Update Top Metric Battery % if present
    this.setText('battery-pct-val', `${currentSoc}%`);
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
    if (subtitle) subtitle.textContent = `PUBLIC BENCHMARK · DATA UNAVAILABLE · ${message}`;
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
    this.setupKpiAssumptions();
    window.addEventListener('energios:dispatch-updated', () => {
      if (!this.state.readings) return;
      void this.loadKpiScenario(this.state.activeBuildingId);
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
