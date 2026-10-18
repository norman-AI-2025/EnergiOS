/**
 * EnergiOS - Theme & Visual Appearance Manager (theme.js)
 * Manages Dark Mode (Velora Obsidian) & Light Mode (Velora Warm Sand).
 * Syncs seamlessly with localStorage ('ENERGIOS_THEME') and system OS preferences.
 * Broadcasts 'energios:theme-changed' custom events for charts, 3D scene, and floorplans.
 */

(function () {
  const THEME_KEY = 'ENERGIOS_THEME';

  class ThemeManager {
    constructor() {
      this.theme = this.getStoredPreference() || 'system';
      this.init();
    }

    getStoredPreference() {
      try {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          return stored;
        }
        // Fallback check in ENERGIOS_SETTINGS
        const settings = localStorage.getItem('ENERGIOS_SETTINGS');
        if (settings) {
          const parsed = JSON.parse(settings);
          if (parsed.appearanceTheme) return parsed.appearanceTheme;
        }
      } catch (e) {
        console.warn('[EnergiOS Theme] Failed to read stored theme:', e);
      }
      return null;
    }

    init() {
      // 1. Apply theme immediately on script execution (prevents flash of unstyled theme)
      this.applyTheme(this.theme, false);

      // 2. Listen to system preference changes when in 'system' mode
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          if (this.theme === 'system') {
            this.applyTheme('system', true);
          }
        });
      }

      // 3. Sync UI buttons once DOM is loaded
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.syncUI());
      } else {
        this.syncUI();
      }
    }

    isDark() {
      if (this.theme === 'dark') return true;
      if (this.theme === 'light') return false;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    getTheme() {
      return this.theme;
    }

    setTheme(mode) {
      if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return;
      this.theme = mode;
      try {
        localStorage.setItem(THEME_KEY, mode);
        // Also update ENERGIOS_SETTINGS if present
        const settingsRaw = localStorage.getItem('ENERGIOS_SETTINGS');
        if (settingsRaw) {
          const settings = JSON.parse(settingsRaw);
          settings.appearanceTheme = mode;
          localStorage.setItem('ENERGIOS_SETTINGS', JSON.stringify(settings));
        }
      } catch (e) {
        console.warn('[EnergiOS Theme] Failed to store theme:', e);
      }

      this.applyTheme(mode, true);
      this.syncUI();

      // Show toast if notification toast is present
      const isDark = this.isDark();
      const toastMsg = isDark ? 'Dark Mode (Obsidian) enabled' : 'Light Mode (Warm Sand) enabled';
      if (window.settingsManager && window.settingsManager.showToast) {
        window.settingsManager.showToast(toastMsg);
      } else if (window.veloraApp && window.veloraApp.showToast) {
        window.veloraApp.showToast(toastMsg);
      } else if (window.energyApp && window.energyApp.showToast) {
        window.energyApp.showToast(toastMsg);
      }
    }

    toggle() {
      const next = this.isDark() ? 'light' : 'dark';
      this.setTheme(next);
      return next;
    }

    applyTheme(mode, notify = true) {
      const isDark = (mode === 'dark') || (mode === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      
      const root = document.documentElement;
      if (isDark) {
        root.classList.add('dark');
        root.style.colorScheme = 'dark';
      } else {
        root.classList.remove('dark');
        root.style.colorScheme = 'light';
      }

      if (notify) {
        window.dispatchEvent(new CustomEvent('energios:theme-changed', {
          detail: { isDark, theme: mode }
        }));
      }
    }

    syncUI() {
      const isDark = this.isDark();

      // Update Header Theme Toggle Button Icons
      document.querySelectorAll('#theme-toggle-btn').forEach((btn) => {
        const moon = btn.querySelector('.theme-icon-moon');
        const sun = btn.querySelector('.theme-icon-sun');
        if (moon && sun) {
          if (isDark) {
            moon.classList.add('hidden');
            sun.classList.remove('hidden');
            btn.setAttribute('title', 'Switch to Light Mode');
          } else {
            moon.classList.remove('hidden');
            sun.classList.add('hidden');
            btn.setAttribute('title', 'Switch to Dark Mode');
          }
        }
      });

      // Update Settings Page Appearance Option Cards
      document.querySelectorAll('.theme-option-btn').forEach((btn) => {
        const btnVal = btn.getAttribute('data-theme');
        const isSelected = btnVal === this.theme;
        btn.classList.toggle('ring-2', isSelected);
        btn.classList.toggle('ring-[#FF7A00]', isSelected);
        btn.classList.toggle('border-[#FF7A00]', isSelected);
        const checkIcon = btn.querySelector('.theme-check-icon');
        if (checkIcon) {
          checkIcon.classList.toggle('hidden', !isSelected);
        }
      });
    }
  }

  window.themeManager = new ThemeManager();

  // Helper for Chart.js theme colors
  window.getChartThemeColors = function () {
    const isDark = window.themeManager ? window.themeManager.isDark() : false;
    return {
      isDark,
      gridColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      textColor: isDark ? '#94A3B8' : '#71767B',
      tooltipBg: isDark ? '#1E293B' : 'rgba(15, 23, 42, 0.94)',
      tooltipText: '#F8FAFC',
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    };
  };
})();
