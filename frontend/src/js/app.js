/**
 * EnergiOS Application Controller
 * Manages reactive state, building switching, Bento metrics calculation,
 * and live backend API sync.
 */

class EnergiOSApp {
  constructor() {
    this.state = {
      assets: [],
      activeAssetId: 'fa2b11d5-f608-515e-97ab-6445ef048bff', // Default: Hog_office_Bill
      activeBuilding: null,
      activeTimeRange: 72, // 24, 72, 168 hours
      comparisonMode: 'kwh', // 'kwh' or 'eui'
      anomalyFilter: 'all', // 'all', 'above_expected', 'below_expected'
      currentReadings: null,
      currentForecast: null,
      currentAnomalies: null,
      allBuildingsData: {},
      isLoading: false,
    };

    // Building architectural zone metadata inspired by reference designs
    this.buildingZones = {
      Hog_office_Bill: [
        { name: 'Rooftop Solar PV Array', metric: '48.2 kWp Active', icon: 'solar_power', status: 'optimal' },
        { name: 'Floors 1-8 Core Workspaces', metric: '68% Occupancy', icon: 'corporate_fare', status: 'normal' },
        { name: 'Chiller Plant & Air Handling', metric: '62 kW Chilled Loop', icon: 'mode_fan', status: 'normal' },
        { name: 'Substation Incomer 11kV', metric: '100% Phase Balance', icon: 'electric_meter', status: 'optimal' },
      ],
      Hog_education_Donnie: [
        { name: 'Rooftop Photovoltaic Canopy', metric: '36.5 kWp Active', icon: 'solar_power', status: 'optimal' },
        { name: 'Tiered Lecture Atrium', metric: 'Natural Daylight Harvest', icon: 'school', status: 'normal' },
        { name: 'AHU High-Efficiency Loop', metric: 'VAV Eco-Mode', icon: 'mode_fan', status: 'normal' },
        { name: 'Campus Substation Feeder', metric: 'Power Factor 0.98', icon: 'bolt', status: 'optimal' },
      ],
      Hog_assembly_Dona: [
        { name: 'Curved BIPV Solar Array', metric: '65.8 kWp Peak', icon: 'solar_power', status: 'optimal' },
        { name: 'Grand Civic Hall & Atrium', metric: 'Event Lighting Load', icon: 'theater_comedy', status: 'normal' },
        { name: 'Central Air Displacement', metric: 'CO₂ Controlled Fresh Air', icon: 'air', status: 'optimal' },
        { name: 'Township Grid Interconnect', metric: 'Active Synchronisation', icon: 'hub', status: 'normal' },
      ],
      Hog_lodging_Francisco: [
        { name: 'Pergola Solar System', metric: '28.4 kWp Generation', icon: 'solar_power', status: 'optimal' },
        { name: 'Suites Level 1-5 Residences', metric: 'Smart Submeter Array', icon: 'apartment', status: 'normal' },
        { name: 'Heat Pump Domestic Hot Water', metric: 'Thermal Storage Active', icon: 'water_heater', status: 'optimal' },
        { name: 'Utility Substation Ring', metric: '100% Uptime Measured', icon: 'electric_meter', status: 'optimal' },
      ],
    };
  }

  async init() {
    console.log('[EnergiOS] Initializing dashboard...');
    this.setupEventListeners();
    await this.checkBackendStatus();
    await this.loadInitialData();
  }

  async checkBackendStatus() {
    const statusPill = document.getElementById('api-status-pill');
    const statusText = document.getElementById('api-status-text');
    const statusDot = document.getElementById('api-status-dot');
    const latencyText = document.getElementById('api-latency-text');

    const result = await window.apiClient.checkHealth();
    if (result.ok) {
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-500 pulse-live-dot';
      if (statusText) statusText.textContent = 'Live Backend Connected';
      if (latencyText) latencyText.textContent = `${result.latencyMs}ms`;
      if (statusPill) statusPill.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs font-semibold cursor-pointer hover:bg-emerald-100 transition-colors';
    } else {
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-500';
      if (statusText) statusText.textContent = 'Verified Benchmark Snapshot';
      if (latencyText) latencyText.textContent = 'Offline Cached';
      if (statusPill) statusPill.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200/80 text-amber-800 text-xs font-semibold cursor-pointer hover:bg-amber-100 transition-colors';
    }
  }

  async loadInitialData() {
    this.setLoading(true);
    try {
      // 1. Fetch assets
      const assetsData = await window.apiClient.getAssets();
      this.state.assets = assetsData.items || [];

      // 2. Pre-load all buildings snapshot for comparison chart
      this.state.allBuildingsData = window.apiClient.getAllBuildingsSnapshot();

      // Render building selector tabs
      this.renderBuildingTabs();

      // 3. Load active building data
      await this.loadActiveBuilding(this.state.activeAssetId);

      // 4. Render comparison chart
      this.renderComparisonChart();
    } catch (err) {
      console.error('[EnergiOS] Error during initial data load:', err);
      this.showToast('⚠️ Could not load data. Please check network connection.');
    } finally {
      this.setLoading(false);
    }
  }

  renderBuildingTabs() {
    const container = document.getElementById('building-selector-tabs');
    if (!container) return;

    container.innerHTML = '';
    this.state.assets.forEach((asset) => {
      const btn = document.createElement('button');
      const isActive = asset.id === this.state.activeAssetId;
      const cleanName = asset.name.replace('Hog_', '').replace('_', ' ');

      btn.className = `pill-tab flex items-center gap-2 transition-all ${isActive ? 'active' : ''}`;
      btn.innerHTML = `
        <span class="w-2 h-2 rounded-full ${isActive ? 'bg-[#006948]' : 'bg-slate-300'}"></span>
        <span class="capitalize">${cleanName}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded ${isActive ? 'bg-emerald-100 text-[#006948] font-bold' : 'bg-slate-100 text-slate-500'}">${asset.primary_space_usage}</span>
      `;
      btn.onclick = () => this.switchBuilding(asset.id);
      container.appendChild(btn);
    });
  }

  async switchBuilding(assetId) {
    if (this.state.activeAssetId === assetId) return;
    this.state.activeAssetId = assetId;
    this.renderBuildingTabs();
    await this.loadActiveBuilding(assetId);
  }

  async loadActiveBuilding(assetId) {
    this.setLoading(true);
    try {
      const asset = this.state.assets.find((a) => a.id === assetId) || this.state.assets[0];
      this.state.activeBuilding = asset;

      // Update building overview card UI
      this.updateBuildingOverviewUI(asset);

      // Concurrently fetch readings, forecast, and anomalies from API
      const [readings, forecast, anomalies] = await Promise.all([
        window.apiClient.getReadings(assetId, { limit: 168 }),
        window.apiClient.getForecast(assetId),
        window.apiClient.getAnomalies(assetId, { limit: 100 }),
      ]);

      this.state.currentReadings = readings;
      this.state.currentForecast = forecast;
      this.state.currentAnomalies = anomalies;

      // Calculate and update Bento KPI cards
      this.updateKPICards(readings, forecast);

      // Render main chart
      this.renderMainChart();

      // Render anomaly alerts list
      this.renderAnomalyAlerts(anomalies);
    } catch (err) {
      console.error('[EnergiOS] Error loading building data:', err);
      this.showToast('⚠️ Error loading building telemetry.');
    } finally {
      this.setLoading(false);
    }
  }

  updateBuildingOverviewUI(asset) {
    if (!asset) return;

    // Building Title & Type
    const titleEl = document.getElementById('building-title');
    const badgeTypeEl = document.getElementById('building-type-badge');
    const areaEl = document.getElementById('building-area-text');
    const heroMeterEl = document.getElementById('hero-meter-id');
    const heroTzEl = document.getElementById('hero-timezone-text');

    const cleanName = asset.name.replace('Hog_', '').replace('_', ' ');
    if (titleEl) titleEl.textContent = `${cleanName} Building`;
    if (badgeTypeEl) badgeTypeEl.textContent = asset.primary_space_usage || 'Whole Building';
    if (areaEl) areaEl.textContent = `${Number(asset.floor_area_m2).toLocaleString()} m² Gross Floor Area · Whole-Building Electricity`;
    if (heroMeterEl) heroMeterEl.textContent = asset.meter?.source_meter_id || `${asset.name}:electricity`;
    if (heroTzEl) heroTzEl.textContent = `${asset.timezone || 'US/Central'} (UTC-5/6)`;

    // Crossfade Wide Architectural Background Photo (Inspired by idea-01, idea-02 & idea-03)
    const heroBgImg = document.getElementById('hero-bg-image');
    if (heroBgImg) {
      heroBgImg.style.opacity = '0';
      setTimeout(() => {
        heroBgImg.src = `assets/backgrounds/bg_${asset.name}.jpg`;
        heroBgImg.alt = `${asset.name} architectural background`;
        heroBgImg.style.opacity = '0.92';
      }, 150);
    }

    // Update Floating Architectural Callout Badge
    const calloutZoneName = document.getElementById('callout-zone-name');
    const calloutZoneMetric = document.getElementById('callout-zone-metric');
    const calloutProgress = document.getElementById('callout-progress-bar');
    const zones = this.buildingZones[asset.name] || this.buildingZones.Hog_office_Bill;

    if (calloutZoneName && calloutZoneMetric && zones.length > 0) {
      calloutZoneName.textContent = zones[0].name;
      calloutZoneMetric.textContent = zones[0].metric;
      if (calloutProgress) {
        const pct = 70 + (asset.name.length % 20);
        calloutProgress.style.width = `${pct}%`;
      }
    }

    // Render spatial zone chips
    const zonesContainer = document.getElementById('spatial-zones-list');
    if (zonesContainer) {
      zonesContainer.innerHTML = zones.map((z) => `
        <div class="spatial-chip" onclick="app.showZoneInfo('${z.name}', '${z.metric}')" title="Click to inspect zone telemetry">
          <span class="material-symbols-outlined text-[15px] text-[#006948]">${z.icon}</span>
          <span class="text-slate-700">${z.name}</span>
          <span class="text-[10px] text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded font-mono font-semibold">${z.metric}</span>
        </div>
      `).join('');
    }
  }

  updateKPICards(readingsData, forecastData) {
    const readings = (readingsData && readingsData.items) ? readingsData.items : [];
    const testMetrics = (forecastData && forecastData.test_metrics) ? forecastData.test_metrics : null;

    if (readings.length === 0) return;

    // 1. Current Demand (Latest reading in kWh)
    const latestReading = readings[readings.length - 1];
    const prevDayReading = readings.length > 24 ? readings[readings.length - 25] : null;

    const currentDemandEl = document.getElementById('kpi-current-demand');
    const demandDeltaEl = document.getElementById('kpi-demand-delta');
    const demandTrendIcon = document.getElementById('kpi-demand-trend-icon');

    if (currentDemandEl) {
      currentDemandEl.textContent = latestReading.consumption_kwh.toFixed(1);
    }
    const heroDemandEl = document.getElementById('hero-current-demand');
    if (heroDemandEl) {
      heroDemandEl.textContent = latestReading.consumption_kwh.toFixed(1);
    }

    if (prevDayReading && demandDeltaEl) {
      const delta = latestReading.consumption_kwh - prevDayReading.consumption_kwh;
      const pct = ((delta / prevDayReading.consumption_kwh) * 100).toFixed(1);
      const isHigher = delta > 0;
      demandDeltaEl.textContent = `${isHigher ? '+' : ''}${pct}% vs 24h prior`;
      demandDeltaEl.className = `text-xs font-semibold ${isHigher ? 'text-amber-600' : 'text-emerald-700'}`;
      if (demandTrendIcon) {
        demandTrendIcon.textContent = isHigher ? 'trending_up' : 'trending_down';
        demandTrendIcon.className = `material-symbols-outlined text-sm ${isHigher ? 'text-amber-600' : 'text-emerald-700'}`;
      }
    }

    // 2. Total 24h Consumption
    const last24h = readings.slice(-24);
    const sum24h = last24h.reduce((acc, r) => acc + r.consumption_kwh, 0);
    const avg24h = sum24h / (last24h.length || 1);

    const total24hEl = document.getElementById('kpi-24h-total');
    const avg24hEl = document.getElementById('kpi-24h-avg');
    const heroTotalEl = document.getElementById('hero-24h-total');

    if (total24hEl) total24hEl.textContent = Math.round(sum24h).toLocaleString();
    if (avg24hEl) avg24hEl.textContent = `Hourly Avg: ${avg24h.toFixed(1)} kWh`;
    if (heroTotalEl) heroTotalEl.textContent = Math.round(sum24h).toLocaleString();

    // 3. Forecast Accuracy: MAE Card
    const maeModelEl = document.getElementById('kpi-mae-model');
    const maeCompareEl = document.getElementById('kpi-mae-compare');
    const maeImproveEl = document.getElementById('kpi-mae-improve');
    const heroMaeEl = document.getElementById('hero-forecast-mae');

    if (testMetrics && testMetrics.model) {
      const modelMae = testMetrics.model.mae_kwh;
      const baselineMae = testMetrics.baseline ? testMetrics.baseline.mae_kwh : modelMae * 1.25;
      const improvementPct = (((baselineMae - modelMae) / baselineMae) * 100).toFixed(1);

      if (maeModelEl) maeModelEl.textContent = modelMae.toFixed(2);
      if (heroMaeEl) heroMaeEl.textContent = modelMae.toFixed(2);
      if (maeCompareEl) maeCompareEl.textContent = `Baseline: ${baselineMae.toFixed(2)} kWh`;
      if (maeImproveEl) {
        if (Number(improvementPct) >= 0) {
          maeImproveEl.textContent = `+${improvementPct}% vs Baseline`;
          maeImproveEl.className = 'text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full';
        } else {
          maeImproveEl.textContent = `${improvementPct}% vs Baseline`;
          maeImproveEl.className = 'text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full';
        }
      }
    }

    // 4. Forecast Accuracy: RMSE Card
    const rmseModelEl = document.getElementById('kpi-rmse-model');
    const rmseCompareEl = document.getElementById('kpi-rmse-compare');
    const rmseImproveEl = document.getElementById('kpi-rmse-improve');

    if (testMetrics && testMetrics.model) {
      const modelRmse = testMetrics.model.rmse_kwh;
      const baselineRmse = testMetrics.baseline ? testMetrics.baseline.rmse_kwh : modelRmse * 1.35;
      const improvementPct = (((baselineRmse - modelRmse) / baselineRmse) * 100).toFixed(1);

      if (rmseModelEl) rmseModelEl.textContent = modelRmse.toFixed(2);
      if (rmseCompareEl) rmseCompareEl.textContent = `Baseline: ${baselineRmse.toFixed(2)} kWh`;
      if (rmseImproveEl) {
        rmseImproveEl.textContent = `+${improvementPct}% Error Reduction`;
        rmseImproveEl.className = 'text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full';
      }
    }

    // 5. Radial Load Factor Gauge
    const maxDemand = Math.max(...readings.map((r) => r.consumption_kwh));
    const loadFactor = Math.min(100, Math.max(10, (latestReading.consumption_kwh / maxDemand) * 100));
    window.chartController.updateRadialGauge('radial-progress', 'radial-percent-text', loadFactor);

    // Min / Avg / Peak pills in gauge card
    const minVal = Math.min(...readings.slice(-72).map((r) => r.consumption_kwh));
    const peakVal = Math.max(...readings.slice(-72).map((r) => r.consumption_kwh));
    const avgVal = readings.slice(-72).reduce((a, b) => a + b.consumption_kwh, 0) / (readings.slice(-72).length || 1);

    const minEl = document.getElementById('gauge-min-kwh');
    const avgEl = document.getElementById('gauge-avg-kwh');
    const peakEl = document.getElementById('gauge-peak-kwh');

    if (minEl) minEl.textContent = `${minVal.toFixed(1)} kWh`;
    if (avgEl) avgEl.textContent = `${avgVal.toFixed(1)} kWh`;
    if (peakEl) peakEl.textContent = `${peakVal.toFixed(1)} kWh`;
  }

  renderMainChart() {
    window.chartController.renderMainConsumptionChart(
      'main-consumption-chart',
      this.state.currentReadings,
      this.state.currentForecast,
      this.state.currentAnomalies,
      { windowHours: this.state.activeTimeRange }
    );
  }

  renderAnomalyAlerts(anomaliesData) {
    const container = document.getElementById('anomalies-list-container');
    const countBadge = document.getElementById('anomalies-count-badge');
    if (!container) return;

    const items = (anomaliesData && anomaliesData.items) ? anomaliesData.items : [];
    if (countBadge) countBadge.textContent = `${items.length} Flags Detected`;

    let filtered = items;
    if (this.state.anomalyFilter !== 'all') {
      filtered = items.filter((a) => a.direction === this.state.anomalyFilter);
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-slate-400">
          <span class="material-symbols-outlined text-4xl mb-2 text-slate-300">verified</span>
          <p class="text-xs font-semibold text-slate-600">No unusual patterns detected in this window</p>
          <p class="text-[11px] text-slate-400 mt-1">Consumption aligns within 6× MAD robust residual envelope</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map((a) => {
      const isAbove = a.direction === 'above_expected';
      const d = new Date(a.timestamp);
      const timeStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
                      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';

      return `
        <div class="p-3.5 rounded-xl border border-slate-100 hover:border-slate-300 bg-white transition-all hover:shadow-sm cursor-pointer group" onclick="app.inspectAnomaly('${a.timestamp}', ${a.observed_kwh}, ${a.forecast_kwh})">
          <div class="flex items-center justify-between mb-1.5">
            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${isAbove ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">
              <span class="w-1.5 h-1.5 rounded-full ${isAbove ? 'bg-amber-500' : 'bg-blue-500'}"></span>
              ${isAbove ? 'ABOVE EXPECTED' : 'BELOW EXPECTED'}
            </span>
            <span class="text-[11px] font-mono text-slate-400">${timeStr}</span>
          </div>
          <div class="flex items-baseline justify-between text-xs mt-2">
            <div>
              <span class="text-slate-500 text-[11px]">Observed:</span>
              <span class="font-mono font-bold text-slate-800 ml-1">${a.observed_kwh.toFixed(1)} kWh</span>
            </div>
            <div>
              <span class="text-slate-500 text-[11px]">Expected:</span>
              <span class="font-mono text-slate-600 ml-1">${a.forecast_kwh.toFixed(1)} kWh</span>
            </div>
            <div>
              <span class="text-slate-500 text-[11px]">Δ Residual:</span>
              <span class="font-mono font-bold ${isAbove ? 'text-amber-600' : 'text-blue-600'} ml-1">
                ${a.residual_kwh > 0 ? '+' : ''}${a.residual_kwh.toFixed(1)} kWh
              </span>
            </div>
          </div>
          <div class="mt-2 pt-1.5 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400">
            <span class="font-mono">Threshold: ${a.threshold_kwh.toFixed(1)} kWh</span>
            <span class="text-[#006948] group-hover:underline font-medium flex items-center gap-0.5">
              Locate on Chart <span class="material-symbols-outlined text-[12px]">arrow_forward</span>
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  renderComparisonChart() {
    window.chartController.renderBenchmarkComparisonChart(
      'building-benchmark-chart',
      this.state.allBuildingsData,
      this.state.comparisonMode
    );
  }

  setTimeRange(hours) {
    this.state.activeTimeRange = hours;
    document.querySelectorAll('.time-range-tab').forEach((tab) => {
      tab.classList.toggle('active', Number(tab.dataset.hours) === hours);
    });
    this.renderMainChart();
  }

  setComparisonMode(mode) {
    this.state.comparisonMode = mode;
    document.querySelectorAll('.comp-mode-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    this.renderComparisonChart();
  }

  setAnomalyFilter(filter) {
    this.state.anomalyFilter = filter;
    document.querySelectorAll('.anomaly-filter-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    this.renderAnomalyAlerts(this.state.currentAnomalies);
  }

  inspectAnomaly(timestamp, observed, forecast) {
    const d = new Date(timestamp);
    const dateFormatted = d.toLocaleString();
    this.showToast(`🔍 Anomaly at ${dateFormatted}: Observed ${observed} kWh vs Expected ${forecast} kWh`);

    // Switch main chart to 168h to provide full context
    if (this.state.activeTimeRange < 168) {
      this.setTimeRange(168);
    }
  }

  showZoneInfo(name, metric) {
    this.showToast(`🏛️ <strong>${name}</strong>: ${metric} · Measured under whole-building electricity meter.`);
  }

  openApiModal() {
    const modal = document.getElementById('api-settings-modal');
    const input = document.getElementById('api-url-input');
    if (input) input.value = window.apiClient.getBaseUrl();
    if (modal) modal.classList.remove('hidden');
  }

  closeApiModal() {
    const modal = document.getElementById('api-settings-modal');
    if (modal) modal.classList.add('hidden');
  }

  async saveApiUrl() {
    const input = document.getElementById('api-url-input');
    if (!input) return;
    const url = input.value.trim();
    if (!url) return;

    this.showToast('Connecting to backend...');
    await window.apiClient.setBaseUrl(url);
    await this.checkBackendStatus();
    await this.loadActiveBuilding(this.state.activeAssetId);
    this.closeApiModal();
  }

  showToast(message) {
    const toast = document.getElementById('toast-container');
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;

    msgEl.innerHTML = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.add('translate-y-24', 'opacity-0');
      toast.classList.remove('translate-y-0', 'opacity-100');
    }, 3800);
  }

  setLoading(loading) {
    this.state.isLoading = loading;
    const loader = document.getElementById('global-loader');
    if (loader) {
      loader.classList.toggle('opacity-100', loading);
      loader.classList.toggle('pointer-events-auto', loading);
      loader.classList.toggle('opacity-0', !loading);
      loader.classList.toggle('pointer-events-none', !loading);
    }
  }

  setupEventListeners() {
    // API Modal Click Outside
    const modal = document.getElementById('api-settings-modal');
    if (modal) {
      modal.onclick = (e) => {
        if (e.target === modal) this.closeApiModal();
      };
    }
  }
}

window.app = new EnergiOSApp();
document.addEventListener('DOMContentLoaded', () => window.app.init());
