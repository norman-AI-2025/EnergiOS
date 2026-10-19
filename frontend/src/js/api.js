/**
 * EnergiOS API Client
 * Connects to live backend with resilient multi-origin fallback (127.0.0.1 <-> localhost)
 * and offline/file-protocol failover to verified BDG2 snapshot (src/data/bdg2_data.js).
 */
class EnergiOSApiClient {
  constructor() {
    this.cleanStaleStorage();
    this.defaultBaseUrl = this.resolveDefaultBaseUrl();
    this.baseUrl = localStorage.getItem('energios_api_base') || this.defaultBaseUrl;
    this.fallbackCandidates = this.buildCandidateUrls();
    this.status = {
      isLive: false,
      lastPingMs: null,
      lastChecked: null,
      error: null,
      mode: 'uninitialized', // 'live' | 'snapshot_fallback'
    };
  }

  cleanStaleStorage() {
    try {
      const stored = localStorage.getItem('energios_api_base');
      if (stored) {
        // Discard any stored base that is pointing to frontend dev server ports or invalid URLs
        if (
          stored.includes(':5174') ||
          stored.includes(':5173') ||
          stored.includes(':5500') ||
          stored.includes(':3000') ||
          stored.includes('vercel.app') ||
          stored.includes('undefined') ||
          !stored.includes(':8000')
        ) {
          localStorage.removeItem('energios_api_base');
        }
      }
    } catch (_) {}
  }

  resolveDefaultBaseUrl() {
    // If served via http/https, prioritize matching hostname on port 8000
    try {
      if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
        const host = window.location.hostname || '127.0.0.1';
        return `http://${host}:8000`;
      }
    } catch (_) {}

    const metaUrl = document.querySelector('meta[name="energios-api-base-url"]')?.content?.trim();
    if (metaUrl && !metaUrl.startsWith('%') && metaUrl.length > 0) {
      return metaUrl.replace(/\/+$/, '');
    }
    return 'http://127.0.0.1:8000';
  }

  buildCandidateUrls() {
    const host = (typeof window !== 'undefined' && window.location?.hostname) || '127.0.0.1';
    const primarySameHost = `http://${host}:8000`;
    const candidates = [
      primarySameHost,
      this.baseUrl,
      'http://127.0.0.1:8000',
      'http://localhost:8000',
    ];
    return [...new Set(candidates.filter(Boolean))];
  }

  setBaseUrl(url) {
    const normalizedUrl = url.trim().replace(/\/+$/, '');
    const parsedUrl = new URL(normalizedUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.origin !== normalizedUrl) {
      throw new Error('API URL must be an HTTP(S) origin without a path.');
    }
    this.baseUrl = normalizedUrl;
    localStorage.setItem('energios_api_base', this.baseUrl);
    return this.checkHealth();
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  async request(path, options = {}) {
    const {
      timeoutMs = 8000,
      originFallback = true,
      throwHttpErrors = false,
      ...fetchOptions
    } = options;
    const errors = [];

    // Try current baseUrl first, then remaining candidates
    const urlsToTry = originFallback
      ? [this.baseUrl, ...this.fallbackCandidates.filter((u) => u !== this.baseUrl)]
      : [this.baseUrl];

    for (const targetBase of urlsToTry) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${targetBase}${path}`, {
          ...fetchOptions,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(fetchOptions.headers || {}),
          },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const detail = typeof payload.detail === 'string' ? payload.detail : `HTTP ${response.status}`;
          const httpError = new Error(detail);
          httpError.status = response.status;
          throw httpError;
        }

        const data = await response.json();
        if (targetBase !== this.baseUrl) {
          this.baseUrl = targetBase;
          localStorage.setItem('energios_api_base', this.baseUrl);
        }
        this.status.isLive = true;
        this.status.mode = 'live';
        return data;
      } catch (err) {
        clearTimeout(timeoutId);
        if (throwHttpErrors && Number.isInteger(err.status)) throw err;
        errors.push(`${targetBase}: ${err.message}`);
      }
    }

    // If all network requests failed, check for verified snapshot fallback
    const fallbackData = this.getSnapshotFallback(path, options);
    if (fallbackData !== null) {
      console.warn(`[EnergiOS API] Live API unreachable (${errors.join('; ')}). Serving verified BDG2 snapshot.`);
      this.status.isLive = false;
      this.status.mode = 'snapshot_fallback';
      return fallbackData;
    }

    throw new Error(`Backend unavailable at ${this.baseUrl} (${errors[0] || 'Network error'})`);
  }

  getSnapshotFallback(path, options = {}) {
    const snapshot = typeof window !== 'undefined' ? window.ENERGIOS_BDG2_DATA : null;
    if (!snapshot) return null;

    // Route: /health
    if (path === '/health') {
      return { status: 'ok', version: '1', note: 'local_bdg2_snapshot' };
    }

    // Route: /assets
    if (path.startsWith('/assets?') || path === '/assets') {
      return JSON.parse(JSON.stringify(snapshot.assets));
    }

    // Route: /comparison or /assets/comparison
    if (path.includes('/comparison')) {
      return this.synthesizeSnapshotComparison();
    }

    // Routes: /assets/{id}/...
    const assetMatch = path.match(/\/assets\/([^/?]+)\/(readings|forecast|anomalies|energy-flow)/);
    if (assetMatch) {
      const [, targetId, endpoint] = assetMatch;
      const decodedId = decodeURIComponent(targetId);
      const asset = snapshot.assets?.items?.find(
        (a) => a.id === decodedId || a.name === decodedId || a.source_asset_id === decodedId
      );
      if (!asset) return null;

      if (endpoint === 'energy-flow') {
        const urlObj = new URL(`http://dummy${path}`);
        const tf = urlObj.searchParams.get('timeframe') || 'hourly';
        return this.synthesizeSnapshotEnergyFlow(asset, tf);
      }

      const buildingData = snapshot.buildings?.[asset.name];
      if (!buildingData || !buildingData[endpoint]) return null;

      const result = JSON.parse(JSON.stringify(buildingData[endpoint]));
      if (endpoint === 'readings') {
        const urlObj = new URL(`http://dummy${path}`);
        const limit = Number(urlObj.searchParams.get('limit')) || 168;
        if (Array.isArray(result.items)) {
          result.items = result.items.slice(-limit);
          result.count = result.items.length;
        }
      }
      return result;
    }

    return null;
  }

  synthesizeSnapshotComparison() {
    const snapshot = typeof window !== 'undefined' ? window.ENERGIOS_BDG2_DATA : null;
    if (!snapshot?.assets?.items) return null;

    const items = snapshot.assets.items.map((asset) => {
      const bData = snapshot.buildings?.[asset.name];
      const readings = bData?.readings?.items || [];
      const last24 = readings.slice(-24);
      const totalKwh = last24.reduce((s, r) => s + r.consumption_kwh, 0);
      const peakKw = last24.length ? Math.max(...last24.map((r) => r.consumption_kwh)) : 0;
      const avgKw = last24.length ? totalKwh / last24.length : 0;
      const loadFactor = peakKw > 0 ? (avgKw / peakKw) * 100 : 0;
      const eui = asset.floor_area_m2 ? (totalKwh / asset.floor_area_m2) : 0;

      return {
        asset_id: asset.id,
        asset_name: asset.name,
        primary_space_usage: asset.primary_space_usage,
        floor_area_m2: asset.floor_area_m2,
        total_kwh: Number(totalKwh.toFixed(1)),
        peak_demand_kw: Number(peakKw.toFixed(1)),
        average_demand_kw: Number(avgKw.toFixed(1)),
        load_factor_pct: Number(loadFactor.toFixed(1)),
        eui_kwh_per_m2: Number(eui.toFixed(3)),
      };
    });

    return {
      window_hours: 24,
      buildings_count: items.length,
      items,
      provenance: snapshot.assets.items[0]?.provenance || null,
    };
  }

  synthesizeSnapshotEnergyFlow(asset, timeframe = 'hourly') {
    const snapshot = typeof window !== 'undefined' ? window.ENERGIOS_BDG2_DATA : null;
    const bData = snapshot?.buildings?.[asset.name];
    const readings = bData?.readings?.items || [];
    if (!readings.length) return null;

    const tf = (timeframe || 'hourly').toLowerCase();
    const floorArea = Number(asset.floor_area_m2) || 10000;
    const peakSolarKw = Math.max(25, Math.round(floorArea * 0.008 * 10) / 10);

    let window = [readings[readings.length - 1]];
    let multiplier = 1.0;
    if (tf === 'daily') {
      window = readings.slice(-24);
    } else if (tf === 'weekly') {
      window = readings.slice(-168);
    } else if (tf === 'monthly') {
      window = readings.slice(-168);
      multiplier = 30 / (window.length / 24);
    }

    let totS2Bat = 0, totBat2B = 0, totG2B = 0, totBld = 0;
    for (const r of window) {
      const load = Number(r.consumption_kwh);
      totBld += load;
      const hour = new Date(r.timestamp).getUTCHours();
      let solarGen = 0;
      if (hour >= 7 && hour <= 19) {
        solarGen = peakSolarKw * Math.pow(Math.sin((Math.PI * (hour - 7)) / 12), 2);
      }
      // 1. Solar exclusively charges battery
      const s2bat = solarGen;

      // 2. Battery discharges to building load
      const bat2b = (hour >= 8 && hour <= 21)
        ? Math.min(load * 0.45, 50, load)
        : Math.min(load * 0.20, 20, load);

      // 3. Grid supplies remainder of building load
      const g2b = Math.max(0, load - bat2b);

      totS2Bat += s2bat;
      totBat2B += bat2b;
      totG2B += g2b;
    }

    totS2Bat = Math.round(totS2Bat * multiplier * 10) / 10;
    totBat2B = Math.round(totBat2B * multiplier * 10) / 10;
    totBld = Math.round(totBld * multiplier * 10) / 10;
    totG2B = Math.round(Math.max(0, totBld - totBat2B) * 10) / 10;

    const solarNode = totS2Bat;
    const batNode = totBat2B;
    const gridNode = totG2B;

    return {
      result_type: 'energy_flow',
      asset_id: asset.id,
      asset_name: asset.name,
      timeframe: tf,
      timestamp: window[window.length - 1].timestamp,
      unit: 'kWh',
      flows: {
        solar_to_battery_kwh: totS2Bat,
        battery_to_building_kwh: totBat2B,
        grid_to_building_kwh: totG2B,
        solar_to_building_kwh: 0.0,
        solar_to_grid_kwh: 0.0,
        battery_to_grid_kwh: 0.0,
      },
      nodes: {
        solar_kwh: solarNode,
        battery_kwh: batNode,
        building_kwh: totBld,
        grid_kwh: gridNode,
      },
      self_sufficiency_pct: Math.min(100, Math.round((batNode / Math.max(totBld, 0.1)) * 1000) / 10),
      renewable_share_pct: Math.min(100, Math.round((solarNode / Math.max(totBld, 0.1)) * 1000) / 10),
      readings_count: window.length,
      provenance: asset.provenance || snapshot.assets.items[0]?.provenance || null,
    };
  }

  async getDatabaseStatus() {
    try {
      return await this.request('/database/status', { timeoutMs: 4000 });
    } catch (_) {
      return { configured: false, connected: false };
    }
  }

  async checkHealth() {
    const startedAt = performance.now();
    try {
      const [data, dbStatus] = await Promise.all([
        this.request('/health', { timeoutMs: 5000 }),
        this.getDatabaseStatus(),
      ]);
      this.status.isLive = this.status.mode === 'live';
      this.status.lastPingMs = Math.round(performance.now() - startedAt);
      this.status.lastChecked = new Date();
      this.status.error = null;
      this.status.database = dbStatus;
      return { ok: true, latencyMs: this.status.lastPingMs, isLive: this.status.isLive, data, database: dbStatus };
    } catch (error) {
      this.status.isLive = false;
      this.status.lastPingMs = null;
      this.status.lastChecked = new Date();
      this.status.error = error.message;
      return { ok: false, error: error.message };
    }
  }

  async getAssets() {
    return this.request('/assets?limit=100');
  }

  async getReadings(assetId, options = {}) {
    const limit = Math.min(1000, Math.max(1, Number(options.limit) || 168));
    const params = new URLSearchParams({ limit: String(limit) });
    if (options.from && options.to) {
      params.set('from', options.from);
      params.set('to', options.to);
    }
    return this.request(`/assets/${encodeURIComponent(assetId)}/readings?${params}`);
  }

  async getEnergyFlow(assetId, options = {}) {
    const timeframe = (options.timeframe || 'hourly').toLowerCase();
    return this.request(`/assets/${encodeURIComponent(assetId)}/energy-flow?timeframe=${encodeURIComponent(timeframe)}`);
  }

  async getForecast(assetId) {
    return this.request(`/assets/${encodeURIComponent(assetId)}/forecast`);
  }

  async getAnomalies(assetId, options = {}) {
    const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
    const params = new URLSearchParams({ limit: String(limit) });
    if (options.from && options.to) {
      params.set('from', options.from);
      params.set('to', options.to);
    }
    return this.request(`/assets/${encodeURIComponent(assetId)}/anomalies?${params}`);
  }

  async getComparison(windowHours = 24) {
    const hours = Math.min(168, Math.max(1, Number(windowHours) || 24));
    return this.request(`/assets/comparison?window_hours=${hours}`);
  }

  async getSolarGridRecommendation(inputs) {
    return this.request('/demo/solar-grid/recommendation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
      timeoutMs: 12000,
      originFallback: false,
      throwHttpErrors: true,
    });
  }

  async getVideoDispatch(assetId, afterHour = 0) {
    return this.request('/demo/solar-grid/video/recommendation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId, after_hour: afterHour }),
      timeoutMs: 12000, originFallback: false, throwHttpErrors: true,
    });
  }

  async reviewVideoDispatch(inputs) {
    return this.request('/demo/solar-grid/video/revalidate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs), timeoutMs: 12000,
      originFallback: false, throwHttpErrors: true,
    });
  }

  async explainSolarGrid(recommendationId, transitionId) {
    return this.request('/demo/solar-grid/explanation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendation_id: recommendationId, transition_id: transitionId }),
      timeoutMs: 15000, originFallback: false, throwHttpErrors: true,
    });
  }

  async chat(message, buildingId = null, history = []) {
    return this.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        building_id: buildingId,
        history,
      }),
    });
  }
}

window.apiClient = new EnergiOSApiClient();
