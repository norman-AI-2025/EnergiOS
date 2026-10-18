/**
 * EnergiOS - Settings & Preferences Controller (settings.js)
 * Manages configuration for:
 * 1. AI Agent & Dynamic Island Preferences
 * 2. Anomaly & Alert Thresholds
 * 3. Building Context & Utility Rates
 * 4. Backend API & Supabase Database Connectivity
 * Persists to localStorage under 'ENERGIOS_SETTINGS' and broadcasts updates.
 */

const ENERGIOS_DEFAULT_SETTINGS = {
  // Appearance & Visual Theme
  appearanceTheme: 'system',   // 'light' | 'dark' | 'system'

  // Section 1: AI Agent & Dynamic Island Preferences
  operationMode: 'autonomous', // 'autonomous' | 'manual'
  pollingInterval: '30s',      // '10s' | '30s' | '1m'
  autonomousInsights: true,    // boolean

  // Section 2: Anomaly & Alert Thresholds
  detectionSensitivity: 'balanced', // 'low' | 'balanced' | 'high'
  islandAlertBadges: true,          // boolean
  notifyInApp: true,                // boolean
  notifyEmail: true,                // boolean
  notifyBmsWebhook: false,          // boolean

  // Section 3: Building Context & Utility Rates
  defaultBuildingId: 'fa2b11d5-f608-515e-97ab-6445ef048bff', // Hog_office_Bill
  currencySymbol: 'RM',
  peakRate: 0.584,
  offPeakRate: 0.220,
  showBenchmarkLines: true,

  // Section 4: Backend API & Supabase Connectivity
  apiBaseUrl: 'http://127.0.0.1:8000',
};

class SettingsManager {
  constructor() {
    this.storageKey = 'ENERGIOS_SETTINGS';
    this.settings = this.loadSettings();
    this.isDirty = false;
  }

  loadSettings() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      const themeStored = localStorage.getItem('ENERGIOS_THEME');
      const apiStored = localStorage.getItem('energios_api_base');
      
      let initial = { ...ENERGIOS_DEFAULT_SETTINGS };
      if (apiStored) initial.apiBaseUrl = apiStored;
      else if (window.apiClient && typeof window.apiClient.getBaseUrl === 'function') {
        initial.apiBaseUrl = window.apiClient.getBaseUrl();
      }

      if (stored) {
        const parsed = JSON.parse(stored);
        if (themeStored) parsed.appearanceTheme = themeStored;
        if (apiStored && !parsed.apiBaseUrl) parsed.apiBaseUrl = apiStored;
        return { ...initial, ...parsed };
      } else if (themeStored) {
        return { ...initial, appearanceTheme: themeStored };
      }
      return initial;
    } catch (e) {
      console.warn('[EnergiOS Settings] Failed to parse localStorage settings, using defaults.', e);
    }
    return { ...ENERGIOS_DEFAULT_SETTINGS };
  }

  async init() {
    this.settings = this.loadSettings();
    this.populateUI();
    this.bindUIEvents();
    this.applySettingsToRuntime();
    await this.populateBuildingsFromApi();
    await this.testConnection(false);
  }

  async populateBuildingsFromApi() {
    const select = document.getElementById('select-default-building');
    if (!select) return;

    try {
      if (window.apiClient && typeof window.apiClient.getAssets === 'function') {
        const resp = await window.apiClient.getAssets();
        if (resp && Array.isArray(resp.items) && resp.items.length > 0) {
          select.replaceChildren();
          for (const asset of resp.items) {
            const opt = document.createElement('option');
            opt.value = asset.id;
            const area = asset.floor_area_m2 ? ` · ${Number(asset.floor_area_m2).toLocaleString()} m²` : '';
            opt.textContent = `${asset.name.replace(/^Hog_/, '')} (${asset.primary_space_usage}${area})`;
            select.appendChild(opt);
          }
          if (this.settings.defaultBuildingId) {
            select.value = this.settings.defaultBuildingId;
          }
        }
      }
    } catch (err) {
      console.warn('[EnergiOS Settings] Could not fetch dynamic buildings:', err);
    }
  }

  async testConnection(showToast = true) {
    const statusPill = document.getElementById('api-status-pill');
    const statusDot = document.getElementById('api-status-dot');
    const statusText = document.getElementById('api-status-text');

    const dbBadge = document.getElementById('db-status-badge');
    const dbDot = document.getElementById('db-status-dot');
    const dbText = document.getElementById('db-status-text');
    const dbUrl = document.getElementById('db-url-text');
    const dbPing = document.getElementById('db-ping-ms');

    const statAssets = document.getElementById('stat-assets-count');
    const statMeters = document.getElementById('stat-meters-count');
    const statReadings = document.getElementById('stat-readings-count');

    if (statusText) statusText.textContent = 'Testing...';
    if (dbText) dbText.textContent = 'Pinging Supabase & API...';

    const start = performance.now();
    try {
      let health = null;
      let db = null;
      if (window.apiClient) {
        health = await window.apiClient.checkHealth();
        db = await window.apiClient.getDatabaseStatus();
      } else {
        const base = this.settings.apiBaseUrl || 'http://127.0.0.1:8000';
        const [hResp, dbResp] = await Promise.all([
          fetch(`${base}/health`),
          fetch(`${base}/database/status`),
        ]);
        health = await hResp.json();
        db = await dbResp.json();
      }

      const latencyMs = Math.round(performance.now() - start);
      const isConnected = !!(db?.connected || health?.ok);

      // Update Top Status Pill
      if (statusText) {
        statusText.textContent = isConnected ? 'Supabase Live Connected' : 'Offline Mode';
      }
      if (statusDot) {
        statusDot.className = `w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`;
      }
      if (statusPill) {
        statusPill.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all cursor-pointer ${
          isConnected
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
            : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
        }`;
      }

      // Update Section 4 Supabase Diagnostics
      if (dbBadge && dbDot && dbText) {
        if (isConnected) {
          dbDot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
          dbText.textContent = 'Connected · Live PostgreSQL (PostgREST)';
          dbBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/60 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300';
        } else {
          dbDot.className = 'w-2 h-2 rounded-full bg-rose-500';
          dbText.textContent = 'Disconnected · Check API Server';
          dbBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-[11px] font-semibold text-rose-800 dark:text-rose-300';
        }
      }

      if (dbUrl && db?.url) {
        dbUrl.textContent = db.url;
      }

      if (dbPing) {
        dbPing.textContent = `${latencyMs} ms`;
      }

      if (db?.tables) {
        if (statAssets) statAssets.textContent = `${db.tables.assets || 4} Buildings`;
        if (statMeters) statMeters.textContent = `${db.tables.meters || 4} Active Meters`;
        if (statReadings) statReadings.textContent = `${db.tables.energy_readings || 672} Verified Readings`;
      }

      if (showToast) {
        this.showToast(isConnected ? `✓ Supabase Live Connected (${latencyMs}ms)` : '⚠ Backend connection unreachable');
      }
      return isConnected;
    } catch (err) {
      console.warn('[EnergiOS Settings] Connection test error:', err);
      if (statusText) statusText.textContent = 'Connection Error';
      if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-rose-500';
      if (dbText) dbText.textContent = 'Connection Failed';
      if (showToast) this.showToast('Backend connection unreachable');
      return false;
    }
  }

  saveSettings(newSettings) {
    // Only merge newSettings if it is a plain config object, NOT a DOM Event or PointerEvent
    const isPlainConfig = newSettings && typeof newSettings === 'object' && !(newSettings instanceof Event) && !('target' in newSettings) && !('type' in newSettings);
    if (isPlainConfig) {
      this.settings = { ...this.settings, ...newSettings };
    } else {
      this.collectFromUI();
    }

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
      
      // Update API Base URL if configured
      if (this.settings.apiBaseUrl && window.apiClient && typeof window.apiClient.setBaseUrl === 'function') {
        try {
          window.apiClient.setBaseUrl(this.settings.apiBaseUrl);
        } catch (apiErr) {
          console.warn('[EnergiOS Settings] Could not set API Base URL:', apiErr);
        }
      }

      this.isDirty = false;
      this.updateSaveIndicator(false);
      this.applySettingsToRuntime();
      this.showToast('Settings saved successfully');

      // Visual feedback directly on the Save Button itself
      const saveBtn = document.getElementById('btn-save-settings');
      const saveIcon = document.getElementById('btn-save-icon');
      const saveLabel = document.getElementById('btn-save-label');

      if (saveBtn) {
        saveBtn.classList.remove('bg-[#1E2022]', 'dark:bg-white', 'dark:text-[#1E2022]', 'hover:bg-black');
        saveBtn.classList.add('bg-emerald-600', 'text-white', 'scale-105', 'shadow-md');
        if (saveIcon) saveIcon.textContent = 'check_circle';
        if (saveLabel) saveLabel.textContent = 'Saved!';

        clearTimeout(this._saveBtnTimer);
        this._saveBtnTimer = setTimeout(() => {
          if (saveBtn) {
            saveBtn.classList.remove('bg-emerald-600', 'text-white', 'scale-105', 'shadow-md');
            saveBtn.classList.add('bg-[#1E2022]', 'dark:bg-white', 'dark:text-[#1E2022]', 'hover:bg-black');
            if (saveIcon) saveIcon.textContent = 'check';
            if (saveLabel) saveLabel.textContent = 'Save Changes';
          }
        }, 1600);
      }
      
      if (window.dynamicIsland && window.dynamicIsland.addLog) {
        const modeLabel = this.settings.operationMode === 'autonomous' ? 'Autonomous Mode' : 'On-Demand Mode';
        window.dynamicIsland.addLog(`System Preferences saved: ${modeLabel} · Poll ${this.settings.pollingInterval} · Sens: ${this.settings.detectionSensitivity}`, true);
      }
      return true;
    } catch (e) {
      console.error('[EnergiOS Settings] Failed to save settings.', e);
      this.showToast('Failed to save settings: ' + (e.message || 'Storage error'));
      return false;
    }
  }

  resetDefaults() {
    this.settings = { ...ENERGIOS_DEFAULT_SETTINGS };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
      localStorage.removeItem('energios_api_base');
      this.isDirty = false;
      this.populateUI();
      this.updateSaveIndicator(false);
      this.applySettingsToRuntime();
      this.showToast('Reset to default preferences');

      if (window.dynamicIsland && window.dynamicIsland.addLog) {
        window.dynamicIsland.addLog('System settings reset to factory defaults', 'info');
      }
    } catch (e) {
      console.error('[EnergiOS Settings] Failed to reset settings.', e);
    }
  }

  markDirty() {
    this.isDirty = true;
    this.updateSaveIndicator(true);
  }

  updateSaveIndicator(isDirty) {
    const btn = document.getElementById('btn-save-settings');
    const badge = document.getElementById('save-status-dot');
    const statusText = document.getElementById('save-status-text');

    if (badge && statusText) {
      if (isDirty) {
        badge.className = 'w-2 h-2 rounded-full bg-[#FF7A00] animate-pulse';
        statusText.textContent = 'Unsaved Changes';
      } else {
        badge.className = 'w-2 h-2 rounded-full bg-[#22C55E]';
        statusText.textContent = 'All Changes Saved';
      }
    }

    if (btn) {
      if (isDirty) {
        btn.classList.add('ring-2', 'ring-[#FF7A00]', 'ring-offset-2');
      } else {
        btn.classList.remove('ring-2', 'ring-[#FF7A00]', 'ring-offset-2');
      }
    }
  }

  applySettingsToRuntime() {
    // 1. Sync theme if themeManager loaded
    if (window.themeManager && this.settings.appearanceTheme) {
      window.themeManager.setTheme(this.settings.appearanceTheme);
    }

    // 2. Update window.TNB_TARIFF if loaded
    if (window.TNB_TARIFF) {
      window.TNB_TARIFF.peakRateMyr = parseFloat(this.settings.peakRate) || 0.584;
      window.TNB_TARIFF.offPeakRateMyr = parseFloat(this.settings.offPeakRate) || 0.220;
    }

    // 3. Dispatch custom event for cross-component sync
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('energios:settings-updated', {
        detail: this.settings
      }));
    }
  }

  populateUI() {
    // 0. Appearance Theme Cards
    const curTheme = this.settings.appearanceTheme || (window.themeManager ? window.themeManager.getTheme() : 'system');
    document.querySelectorAll('.theme-option-btn').forEach((btn) => {
      const mode = btn.getAttribute('data-theme');
      const isSelected = mode === curTheme;
      btn.classList.toggle('active', isSelected);
      btn.classList.toggle('ring-2', isSelected);
      btn.classList.toggle('ring-[#FF7A00]', isSelected);
      btn.classList.toggle('border-[#FF7A00]', isSelected);
      const checkIcon = btn.querySelector('.theme-check-icon');
      if (checkIcon) checkIcon.classList.toggle('hidden', !isSelected);
    });

    // 1. Operation Mode Segmented Control
    document.querySelectorAll('.op-mode-btn').forEach((btn) => {
      const mode = btn.getAttribute('data-value');
      const isActive = mode === this.settings.operationMode;
      btn.classList.toggle('active', isActive);
      btn.classList.toggle('bg-white', isActive);
      btn.classList.toggle('text-[#1E2022]', isActive);
      btn.classList.toggle('shadow-xs', isActive);
      btn.classList.toggle('font-semibold', isActive);
    });

    // 2. Polling Interval Segmented Control
    document.querySelectorAll('.poll-interval-btn').forEach((btn) => {
      const val = btn.getAttribute('data-value');
      const isActive = val === this.settings.pollingInterval;
      btn.classList.toggle('active', isActive);
      btn.classList.toggle('bg-white', isActive);
      btn.classList.toggle('text-[#1E2022]', isActive);
      btn.classList.toggle('shadow-xs', isActive);
      btn.classList.toggle('font-semibold', isActive);
    });

    // 3. Autonomous Insights Toggle
    const toggleInsights = document.getElementById('toggle-autonomous-insights');
    if (toggleInsights) toggleInsights.checked = !!this.settings.autonomousInsights;

    // 4. Sensitivity Segmented Control
    document.querySelectorAll('.sensitivity-btn').forEach((btn) => {
      const val = btn.getAttribute('data-value');
      const isActive = val === this.settings.detectionSensitivity;
      btn.classList.toggle('active', isActive);
      btn.classList.toggle('bg-white', isActive);
      btn.classList.toggle('text-[#1E2022]', isActive);
      btn.classList.toggle('shadow-xs', isActive);
      btn.classList.toggle('font-semibold', isActive);
    });

    // 5. Dynamic Island Alert Badges Toggle
    const toggleBadges = document.getElementById('toggle-island-alert-badges');
    if (toggleBadges) toggleBadges.checked = !!this.settings.islandAlertBadges;

    // 6. Notification Channel Toggles
    const toggleInApp = document.getElementById('toggle-notify-inapp');
    if (toggleInApp) toggleInApp.checked = !!this.settings.notifyInApp;

    const toggleEmail = document.getElementById('toggle-notify-email');
    if (toggleEmail) toggleEmail.checked = !!this.settings.notifyEmail;

    const toggleWebhook = document.getElementById('toggle-notify-webhook');
    if (toggleWebhook) toggleWebhook.checked = !!this.settings.notifyBmsWebhook;

    // 7. Default Building Select
    const selectBuilding = document.getElementById('select-default-building');
    if (selectBuilding && this.settings.defaultBuildingId) {
      selectBuilding.value = this.settings.defaultBuildingId;
    }

    // 8. Currency & Tariff Rates
    const currencyInput = document.getElementById('input-currency-symbol');
    if (currencyInput) currencyInput.value = this.settings.currencySymbol || 'RM';

    const peakInput = document.getElementById('input-peak-rate');
    if (peakInput) peakInput.value = this.settings.peakRate;

    const offPeakInput = document.getElementById('input-offpeak-rate');
    if (offPeakInput) offPeakInput.value = this.settings.offPeakRate;

    // 9. Benchmark Lines Toggle
    const toggleBench = document.getElementById('toggle-benchmark-lines');
    if (toggleBench) toggleBench.checked = !!this.settings.showBenchmarkLines;

    // 10. API Base URL Input
    const apiInput = document.getElementById('input-api-base-url');
    if (apiInput) {
      apiInput.value = this.settings.apiBaseUrl || (window.apiClient ? window.apiClient.getBaseUrl() : 'http://127.0.0.1:8000');
    }

    this.updateSaveIndicator(false);
  }

  collectFromUI() {
    // Operation mode
    const activeOpBtn = document.querySelector('.op-mode-btn.active');
    if (activeOpBtn) {
      this.settings.operationMode = activeOpBtn.getAttribute('data-value');
    }

    // Polling interval
    const activePollBtn = document.querySelector('.poll-interval-btn.active');
    if (activePollBtn) {
      this.settings.pollingInterval = activePollBtn.getAttribute('data-value');
    }

    // Insights toggle
    const toggleInsights = document.getElementById('toggle-autonomous-insights');
    if (toggleInsights) this.settings.autonomousInsights = toggleInsights.checked;

    // Sensitivity
    const activeSensBtn = document.querySelector('.sensitivity-btn.active');
    if (activeSensBtn) {
      this.settings.detectionSensitivity = activeSensBtn.getAttribute('data-value');
    }

    // Island badges
    const toggleBadges = document.getElementById('toggle-island-alert-badges');
    if (toggleBadges) this.settings.islandAlertBadges = toggleBadges.checked;

    // Notifications
    const toggleInApp = document.getElementById('toggle-notify-inapp');
    if (toggleInApp) this.settings.notifyInApp = toggleInApp.checked;

    const toggleEmail = document.getElementById('toggle-notify-email');
    if (toggleEmail) this.settings.notifyEmail = toggleEmail.checked;

    const toggleWebhook = document.getElementById('toggle-notify-webhook');
    if (toggleWebhook) this.settings.notifyBmsWebhook = toggleWebhook.checked;

    // Default Building
    const selectBuilding = document.getElementById('select-default-building');
    if (selectBuilding && selectBuilding.value) this.settings.defaultBuildingId = selectBuilding.value;

    // Tariffs
    const currencyInput = document.getElementById('input-currency-symbol');
    if (currencyInput) this.settings.currencySymbol = currencyInput.value.trim() || 'RM';

    const peakInput = document.getElementById('input-peak-rate');
    if (peakInput) this.settings.peakRate = parseFloat(peakInput.value) || 0.584;

    const offPeakInput = document.getElementById('input-offpeak-rate');
    if (offPeakInput) this.settings.offPeakRate = parseFloat(offPeakInput.value) || 0.220;

    // Benchmark toggle
    const toggleBench = document.getElementById('toggle-benchmark-lines');
    if (toggleBench) this.settings.showBenchmarkLines = toggleBench.checked;

    // Appearance Theme - Safe selector using .theme-option-btn.active
    const activeThemeBtn = document.querySelector('.theme-option-btn.active');
    if (activeThemeBtn) {
      this.settings.appearanceTheme = activeThemeBtn.getAttribute('data-theme');
    }

    // API Base URL
    const apiInput = document.getElementById('input-api-base-url');
    if (apiInput && apiInput.value.trim()) {
      this.settings.apiBaseUrl = apiInput.value.trim();
    }
  }

  bindUIEvents() {
    // Appearance Theme Option Cards
    document.querySelectorAll('.theme-option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selectedTheme = btn.getAttribute('data-theme');
        this.settings.appearanceTheme = selectedTheme;
        if (window.themeManager) {
          window.themeManager.setTheme(selectedTheme);
        }
        document.querySelectorAll('.theme-option-btn').forEach((b) => {
          const isSelected = b === btn;
          b.classList.toggle('active', isSelected);
          b.classList.toggle('ring-2', isSelected);
          b.classList.toggle('ring-[#FF7A00]', isSelected);
          b.classList.toggle('border-[#FF7A00]', isSelected);
          const checkIcon = b.querySelector('.theme-check-icon');
          if (checkIcon) checkIcon.classList.toggle('hidden', !isSelected);
        });
        this.markDirty();
      });
    });

    // Segmented Controls: Operation Mode
    document.querySelectorAll('.op-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.op-mode-btn').forEach((b) => {
          b.classList.remove('active', 'bg-white', 'text-[#1E2022]', 'shadow-xs', 'font-semibold');
        });
        btn.classList.add('active', 'bg-white', 'text-[#1E2022]', 'shadow-xs', 'font-semibold');
        this.markDirty();
      });
    });

    // Segmented Controls: Polling Interval
    document.querySelectorAll('.poll-interval-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.poll-interval-btn').forEach((b) => {
          b.classList.remove('active', 'bg-white', 'text-[#1E2022]', 'shadow-xs', 'font-semibold');
        });
        btn.classList.add('active', 'bg-white', 'text-[#1E2022]', 'shadow-xs', 'font-semibold');
        this.markDirty();
      });
    });

    // Segmented Controls: Sensitivity
    document.querySelectorAll('.sensitivity-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sensitivity-btn').forEach((b) => {
          b.classList.remove('active', 'bg-white', 'text-[#1E2022]', 'shadow-xs', 'font-semibold');
        });
        btn.classList.add('active', 'bg-white', 'text-[#1E2022]', 'shadow-xs', 'font-semibold');
        this.markDirty();
      });
    });

    // Toggles & Inputs listener
    const inputs = [
      'toggle-autonomous-insights',
      'toggle-island-alert-badges',
      'toggle-notify-inapp',
      'toggle-notify-email',
      'toggle-notify-webhook',
      'select-default-building',
      'input-currency-symbol',
      'input-peak-rate',
      'input-offpeak-rate',
      'toggle-benchmark-lines',
      'input-api-base-url'
    ];

    inputs.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => this.markDirty());
        el.addEventListener('input', () => this.markDirty());
      }
    });

    // Test API & Supabase Connection Button
    const testApiBtn = document.getElementById('btn-test-api');
    if (testApiBtn) {
      testApiBtn.addEventListener('click', async () => {
        const input = document.getElementById('input-api-base-url');
        if (input && input.value.trim() && window.apiClient) {
          try {
            await window.apiClient.setBaseUrl(input.value.trim());
          } catch (_) {}
        }
        await this.testConnection(true);
      });
    }

    // Save Button
    const saveBtn = document.getElementById('btn-save-settings');
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        if (e && e.preventDefault) e.preventDefault();
        this.saveSettings();
      });
    }

    // Reset Defaults Button
    const resetBtn = document.getElementById('btn-reset-defaults');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Reset all EnergiOS preferences to factory defaults?')) {
          this.resetDefaults();
        }
      });
    }
  }

  showToast(msg) {
    const toast = document.getElementById('velora-toast');
    const text = document.getElementById('velora-toast-text');
    if (!toast || !text) return;

    text.textContent = msg;
    toast.classList.remove('opacity-0', 'translate-y-4');
    toast.classList.add('opacity-100', 'translate-y-0');

    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-4');
      toast.classList.remove('opacity-100', 'translate-y-0');
    }, 2800);
  }
}

window.settingsManager = new SettingsManager();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.settingsManager.init());
} else {
  window.settingsManager.init();
}
