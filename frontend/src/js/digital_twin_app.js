/**
 * EnergiOS - Spatial 3D Digital Twin, Live Energy & AI Copilot Controller
 * Unifies:
 *  1. 50% 3D Digital Twin with interactive in-scene Alert Flags on anomaly floors (e.g. Level 2)
 *  2. 50% Right column: Live SCADA Energy Usage (explicit Solar vs Grid balance) & AI Copilot Chatbot
 *  3. Modular ML Model Integration Hook (window.energiosML) for upcoming user ML model file upload.
 */

// Modular ML Integration Hook ready for user model upload
window.energiosML = {
  isLoaded: false,
  modelName: 'Built-in BDG2-XGBoost Anomaly Triage v2.4',
  modelFile: null,
  async predict(features) {
    console.log('[EnergiOS ML] Running inference with model:', this.modelName, features);
    // User will plug in their custom inference script/weights here
    return {
      anomalyScore: 0.942,
      confidence: 0.98,
      predictedBaselineKw: 85.6,
      rootCause: 'AHU chilled water 2-way valve stuck 98% open',
      suggestedAction: 'hvac_valve_override_60pct',
      estimatedSavingsKw: 28.4
    };
  },
  loadModel(file) {
    this.modelFile = file;
    this.modelName = file.name;
    this.isLoaded = true;
  }
};

class EnergiOSTwinApp {
  constructor() {
    this.buildingsData = window.BUILDINGS_DATA || {};
    this.townshipSummary = window.TOWNSHIP_SUMMARY || {};
    this.tnbTariff = window.TNB_TARIFF || { peakRateMyr: 0.584, offPeakRateMyr: 0.220, gridFactorKgCo2PerKwh: 0.658 };

    this.state = {
      selectedBuildingId: null, // Start at Township Overview so the 2D static alert sign is visible right at overview
      selectedFloorId: null,
      isNightMode: false,
      chatMessages: [],
      isChatTyping: false,
      liveTelemetry: {
        totalDemandKw: 186.4,
        solarGenKw: 92.0,
        gridImportKw: 94.4,
        bessPowerKw: 0.0,
        solarSharePct: 49.4,
        gridSharePct: 50.6,
        costRateMyr: 55.13,
        costAvoidedMyr: 53.73,
        carbonRateKg: 62.1,
      },
      buildingSources: {
        'commercial-mall': 'grid',
        'innovation-hub': 'solar',
        'fox-hub': 'solar',
        'community-center': 'grid',
        'bear-center': 'grid',
        'sports-arena': 'solar',
        'hog-arena': 'solar'
      },
      aiViewMode: 'chat', // 'chat' or 'log'
      agentLogFilter: 'all' // 'all', 'doing', or 'done'
    };

    this.scene3d = null;
    this._liveTickerTimer = null;
    this._isMorphing = false;
    this.agentTasksDoing = [];
    this.agentTasksDone = [];
    this._initAgentLogs();
  }

  async init() {
    console.log('[EnergiOS Twin] Initializing Spatial 3D Digital Twin, Live Energy & AI Copilot...');

    // 1. Initialize 3D Scene in Left Half
    const canvasContainer = document.getElementById('township-3d-container');
    if (canvasContainer && window.Township3DScene && window.THREE) {
      this.scene3d = new window.Township3DScene({
        container: canvasContainer,
        onSelectBuilding: (bId) => this.handle3DSelectBuilding(bId),
        onSelectFloor: (fId) => this.handle3DSelectFloor(fId),
        onUpdateAlertPins: (flags) => this.updateAlertPinPositions(flags),
      });
    }

    // 2. Render Top Selectors & Controls (Start at Township Overview)
    this.renderBuildingPicker();
    this.renderFloorPicker();

    // 4. Initialize Live Energy Usage & Start Telemetry Loop
    this.updateLiveEnergyUsage();
    this.renderBuildingPowerDials();
    this.startLiveTelemetryLoop();

    // 5. Initialize AI Copilot Chatbot & Agent Log
    this.initChatbot();
    this.renderAgentLogs();
    this._startAgentLogLoop();

    // 6. Theme change listener
    window.addEventListener('energios:theme-changed', (e) => {
      const isDark = e.detail ? e.detail.isDark : (window.themeManager ? window.themeManager.isDark() : false);
      if (this.scene3d) {
        this.scene3d.toggleNightMode(isDark);
        this.state.isNightMode = isDark;
      }
      this.renderBuildingPowerDials();
    });
  }

  // ==========================================
  // 3D Navigation & Floor Selection
  // ==========================================

  renderBuildingPicker() {
    const container = document.getElementById('building-picker-container');
    if (!container) return;

    // Exactly four buildings: Bull Tower, Fox Hub, Bear Centre, Hog Arena
    const buildingList = [
      { id: 'commercial-mall', name: 'Bull Tower' },
      { id: 'innovation-hub', name: 'Fox Hub' },
      { id: 'community-center', name: 'Bear Centre' },
      { id: 'sports-arena', name: 'Hog Arena' }
    ];

    let html = '';
    buildingList.forEach((item) => {
      const b = this.buildingsData[item.id] || {};
      const isSelected = this.state.selectedBuildingId === item.id;
      const hasAnomaly = b.floors?.some((f) => !!f.anomaly);
      const accent = b.accentColor || '#006948';

      html += `
        <button onclick="twinApp.handleBuildingTabClick('${item.id}')" class="velora-pill flex items-center gap-1.5 ${isSelected ? 'active' : ''}">
          <span class="w-2 h-2 rounded-full" style="background-color: ${accent}"></span>
          <span>${item.name}</span>
          ${hasAnomaly ? '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-600 text-white font-mono animate-pulse flex items-center gap-1 shadow-xs"><svg viewBox="0 0 200 180" class="w-2.5 h-2.5 shrink-0" fill="none"><path d="M 90.5 17.5 C 94.8 9.8 105.2 9.8 109.5 17.5 L 191.5 146.5 C 196.2 153.9 190.8 163.5 182.0 163.5 L 18.0 163.5 C 9.2 163.5 3.8 153.9 8.5 146.5 Z" fill="#FFFFFF"/><path d="M 100 55 L 100 105" stroke="#EE272C" stroke-width="20" stroke-linecap="round"/><circle cx="100" cy="132" r="10" fill="#EE272C"/></svg> ALERT</span>' : ''}
        </button>
      `;
    });

    container.innerHTML = html;
  }

  handleBuildingTabClick(buildingId) {
    const resolvedId = this._resolveBuildingId(buildingId);
    if (this.state.selectedBuildingId === resolvedId) {
      // Toggle back to overview
      this.resetView();
    } else {
      this.selectBuilding(resolvedId);
    }
  }

  renderFloorPicker() {
    const container = document.getElementById('floor-picker-container');
    if (!container) return;

    if (!this.state.selectedBuildingId) {
      container.innerHTML = `
        <div class="velora-pill-container bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 shadow-2xs">
          <button class="velora-pill active text-[11px] py-0.5 px-2.5">All Buildings</button>
        </div>
      `;
      return;
    }

    const building = this.buildingsData[this.state.selectedBuildingId];
    if (!building) return;

    let html = `
      <div class="velora-pill-container bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 shadow-2xs">
        <button onclick="twinApp.selectFloor(null)" class="velora-pill text-[11px] py-0.5 px-2.5 ${!this.state.selectedFloorId ? 'active' : ''}">
          Whole Building
        </button>
    `;

    // Render sorted floors from Roof down to Ground
    const reversedFloors = [...building.floors].sort((a, b) => b.levelNumber - a.levelNumber);
    reversedFloors.forEach((f) => {
      const isSelected = this.state.selectedFloorId === f.id;
      const hasAnomaly = !!f.anomaly;
      const label = f.id === 'roof' ? 'Roof ☀️' : (f.id === 'g' ? 'Ground' : `L${f.levelNumber}`);
      html += `
        <button onclick="twinApp.selectFloor('${f.id}')" class="velora-pill text-[11px] py-0.5 px-2.5 flex items-center gap-1 ${isSelected ? 'active' : ''} ${hasAnomaly ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}">
          <span>${label}</span>
          ${hasAnomaly ? '<span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>' : ''}
        </button>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;
  }

  _resolveBuildingId(buildingId) {
    if (!buildingId) return null;
    const map = {
      'fox-hub': 'innovation-hub',
      'fox': 'innovation-hub',
      'innovation-hub': 'innovation-hub',
      'bear-center': 'community-center',
      'bear': 'community-center',
      'community-center': 'community-center',
      'hog-arena': 'sports-arena',
      'hog': 'sports-arena',
      'sports-arena': 'sports-arena',
      'commercial-mall': 'commercial-mall',
      'bull-tower': 'commercial-mall',
      'bull': 'commercial-mall'
    };
    return map[buildingId] || buildingId;
  }

  selectBuilding(buildingId) {
    const resolvedId = this._resolveBuildingId(buildingId);
    this.state.selectedBuildingId = resolvedId;
    this.state.selectedFloorId = null;

    if (this.scene3d) {
      this.scene3d.selectBuilding(resolvedId);
    }

    this.renderBuildingPicker();
    this.renderFloorPicker();
    this.updateLiveEnergyUsage();
    this.renderBuildingPowerDials();
    this.hideFloorAlertCallout();

    const b = this.buildingsData[resolvedId] || this.buildingsData[buildingId];
    if (b) {
      const bName = b.shortName || b.name;
      this.showToast(`Zoomed in on ${bName} in 3D`);
      this.updateActiveBuildingTitle(bName);
    }
  }

  selectFloor(floorId) {
    this.state.selectedFloorId = floorId;

    if (this.scene3d) {
      this.scene3d.selectFloor(floorId);
    }

    this.renderFloorPicker();

    if (floorId && this.state.selectedBuildingId) {
      const b = this.buildingsData[this.state.selectedBuildingId];
      const floor = b.floors.find((fl) => fl.id === floorId);
      if (floor) {
        this.showToast(`Expanded ${floor.name} in 3D`);
        if (floor.anomaly) {
          this.showFloorAlertCallout(b, floor);
        } else {
          this.hideFloorAlertCallout();
        }
      }
    } else {
      this.hideFloorAlertCallout();
    }
  }

  resetView() {
    this.state.selectedBuildingId = null;
    this.state.selectedFloorId = null;

    if (this.scene3d) {
      this.scene3d.resetView();
    }

    this.renderBuildingPicker();
    this.renderFloorPicker();
    this.updateLiveEnergyUsage();
    this.renderBuildingPowerDials();
    this.hideFloorAlertCallout();
    this.updateActiveBuildingTitle('Township Central Core Microgrid');
    this.showToast('Reset camera to Township Overview');
  }

  handle3DSelectBuilding(buildingId) {
    this.state.selectedBuildingId = buildingId;
    this.renderBuildingPicker();
    this.renderFloorPicker();
    this.updateLiveEnergyUsage();
    this.renderBuildingPowerDials();
    const b = this.buildingsData[buildingId];
    if (b) {
      const bName = b.shortName || b.name;
      this.updateActiveBuildingTitle(bName);
      this.showToast(`Zoomed in on ${bName} in 3D`);
    }
  }

  handle3DSelectFloor(floorId) {
    this.state.selectedFloorId = floorId;
    this.renderFloorPicker();
    if (floorId && this.state.selectedBuildingId) {
      const b = this.buildingsData[this.state.selectedBuildingId];
      const floor = b?.floors?.find((fl) => fl.id === floorId);
      if (floor) {
        this.showToast(`Expanded ${floor.name} in 3D`);
        if (floor.anomaly) {
          this.showFloorAlertCallout(b, floor);
        } else {
          this.hideFloorAlertCallout();
        }
      }
    } else {
      this.hideFloorAlertCallout();
    }
  }

  toggleNightMode() {
    if (!this.scene3d) return;
    this.state.isNightMode = !this.state.isNightMode;
    this.scene3d.toggleNightMode(this.state.isNightMode);
    const icon = document.getElementById('icon-night-mode');
    if (icon) {
      icon.textContent = this.state.isNightMode ? 'light_mode' : 'dark_mode';
    }
    this.showToast(this.state.isNightMode ? 'Night mode scene lighting' : 'Daylight architectural lighting');
  }

  // ==========================================
  // 3D In-Scene Multi-Tower Alert System
  // ==========================================

  updateAlertPinPositions(alertFlags) {
    const isAtOverview = !this.state.selectedBuildingId;
    const markersContainer = document.getElementById('alert-markers-container');
    const leaderGroup = document.getElementById('anomaly-leader-paths-group');

    if (!markersContainer || !this.scene3d) return;

    // Track active marker element IDs in this frame to clean up obsolete ones
    const activeMarkerIds = new Set();
    let leaderSvgHtml = '';

    if (isAtOverview) {
      // ==============================================================
      // 1. OVERVIEW MODE: Render 2D Alert Icon above EVERY tower with an anomaly
      // ==============================================================
      const canonicalBuildings = ['commercial-mall', 'innovation-hub', 'community-center', 'sports-arena'];

      canonicalBuildings.forEach((bId) => {
        const b = this.buildingsData[bId];
        if (!b) return;

        const anomalousFloors = b.floors?.filter((f) => !!f.anomaly) || [];
        if (anomalousFloors.length === 0) return;

        const pos = this.scene3d.getBuildingApexScreenPosition(bId);
        if (!pos) return;

        const pinId = `overview-pin-${bId}`;
        activeMarkerIds.add(pinId);

        let pin = document.getElementById(pinId);
        if (!pin) {
          pin = document.createElement('div');
          pin.id = pinId;
          pin.className = 'pointer-events-auto absolute cursor-pointer -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-110 active:scale-95 group select-none z-20';
          pin.onclick = (e) => {
            e.stopPropagation();
            twinApp.handleOverviewAlertClick(bId);
          };
          const bName = b.shortName || b.name;
          pin.innerHTML = `
            <div class="w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/50 border-2 border-white flex items-center justify-center relative cursor-pointer" title="${bName} • Alert detected (Click to inspect tower)">
              <svg viewBox="0 0 200 180" class="w-3.5 h-3.5" fill="none">
                <path d="M 90.5 17.5 C 94.8 9.8 105.2 9.8 109.5 17.5 L 191.5 146.5 C 196.2 153.9 190.8 163.5 182.0 163.5 L 18.0 163.5 C 9.2 163.5 3.8 153.9 8.5 146.5 Z" fill="#FFFFFF" />
                <path d="M 100 55 L 100 105" stroke="#EE272C" stroke-width="20" stroke-linecap="round" />
                <circle cx="100" cy="132" r="10" fill="#EE272C" />
              </svg>
              <span class="absolute -inset-1 rounded-full bg-red-500/35 animate-ping pointer-events-none"></span>
            </div>
            <!-- Tooltip Hover Pill -->
            <div class="hidden group-hover:flex absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2.5 py-1 rounded-lg bg-neutral-900/95 text-white text-[10px] whitespace-nowrap shadow-xl border border-white/10 font-sans pointer-events-none z-30">
              <span class="font-bold text-white">${bName}</span>
              <span class="text-neutral-400 mx-1">•</span>
              <span class="text-red-400 font-mono font-semibold">${anomalousFloors.length} Alert</span>
            </div>
          `;
          markersContainer.appendChild(pin);
        }

        pin.style.left = `${pos.x}px`;
        pin.style.top = `${pos.y}px`;
        pin.style.display = 'block';
      });

      if (leaderGroup) leaderGroup.innerHTML = '';
    } else {
      // ==============================================================
      // 2. WHOLE BUILDING / FLOOR MODE: Render Alert on Respective Level(s) with Connected Line
      // ==============================================================
      const activeBId = this._resolveBuildingId(this.state.selectedBuildingId);
      const b = this.buildingsData[activeBId];

      if (b && b.floors) {
        const anomalousFloors = b.floors.filter((f) => !!f.anomaly);
        const containerW = this.scene3d.container?.clientWidth || 700;

        anomalousFloors.forEach((floor) => {
          const pos = this.scene3d.getFloorScreenPosition(activeBId, floor.id);
          if (!pos) return;

          const badgeId = `level-badge-${activeBId}-${floor.id}`;
          activeMarkerIds.add(badgeId);

          const badgeOffset = 70;
          const badgeX = Math.min(pos.x + badgeOffset, containerW - 145);
          const badgeY = Math.max(pos.y - 12, 25);
          const elbowX = Math.min(pos.x + 22, badgeX - 8);

          // SVG leader line connecting floor anchor to right-side badge
          leaderSvgHtml += `
            <path d="M ${pos.x} ${pos.y} L ${elbowX} ${badgeY} L ${badgeX} ${badgeY}" fill="none" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-red)" />
            <circle cx="${pos.x}" cy="${pos.y}" r="3.8" fill="#ef4444" stroke="#ffffff" stroke-width="1.8" />
            <circle cx="${pos.x}" cy="${pos.y}" r="7.5" fill="none" stroke="#ef4444" stroke-width="1.4" opacity="0.6" class="animate-ping" />
          `;

          let badge = document.getElementById(badgeId);
          if (!badge) {
            badge = document.createElement('div');
            badge.id = badgeId;
            badge.className = 'pointer-events-auto absolute cursor-pointer transition-transform hover:scale-105 active:scale-95 select-none z-20';
            badge.onclick = (e) => {
              e.stopPropagation();
              twinApp.handleLevelAlertClick(activeBId, floor.id);
            };
            const fLabel = floor.id === 'roof' ? 'Roof' : (floor.id === 'g' ? 'Ground' : `L${floor.levelNumber}`);
            const deltaShort = floor.anomaly.deltaKwh ? floor.anomaly.deltaKwh.split(' ')[0] : 'Alert';

            badge.innerHTML = `
              <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900/95 dark:bg-black/95 text-white text-[11px] font-mono border border-red-500/80 shadow-xl backdrop-blur-md hover:border-red-400">
                <div class="w-3.5 h-3.5 rounded-full bg-red-600 flex items-center justify-center shrink-0">
                  <span class="text-[9px] font-bold text-white leading-none">!</span>
                </div>
                <span class="font-sans font-bold text-white text-[10.5px]">${fLabel}</span>
                <span class="text-[9.5px] text-red-400 font-mono">${deltaShort}</span>
                <span class="material-symbols-outlined text-[13px] text-neutral-400">chevron_right</span>
              </div>
            `;
            markersContainer.appendChild(badge);
          }

          badge.style.left = `${badgeX}px`;
          badge.style.top = `${badgeY}px`;
          badge.style.transform = 'translateY(-50%)';
          badge.style.display = 'block';
        });

        if (leaderGroup) leaderGroup.innerHTML = leaderSvgHtml;
      }
    }

    // Clean up markers that are no longer active in the current scene mode
    Array.from(markersContainer.children).forEach((child) => {
      if (!activeMarkerIds.has(child.id)) {
        child.remove();
      }
    });
  }

  handleOverviewAlertClick(buildingId) {
    const resolvedId = this._resolveBuildingId(buildingId);
    const b = this.buildingsData[resolvedId];
    const bName = b ? (b.shortName || b.name) : 'Building';

    // 1. Zoom into the specific tower in whole building mode (exploded stack view)
    this.selectBuilding(resolvedId);
    this.showToast(`Inspecting ${bName} • Explore level alerts`);
  }

  handleLevelAlertClick(buildingId, floorId) {
    const resolvedId = this._resolveBuildingId(buildingId);
    const b = this.buildingsData[resolvedId];
    if (!b) return;

    const floor = b.floors?.find((fl) => fl.id === floorId);
    if (!floor || !floor.anomaly) return;

    // 1. Select and focus this level in 3D
    this.selectFloor(floorId);

    // 2. Display the problem callout with "Ask EnergiOS AI" button
    this.showFloorAlertCallout(b, floor);
  }

  // ==========================================
  // AI Copilot Mode Switcher (Chat vs Agent Log)
  // ==========================================

  setAiViewMode(mode) {
    this.state.aiViewMode = mode;
    const btnChat = document.getElementById('ai-mode-btn-chat');
    const btnLog = document.getElementById('ai-mode-btn-log');
    const chipsContainer = document.getElementById('chat-chips-container');
    const chatContainer = document.getElementById('chat-messages-container');
    const inputForm = document.getElementById('chat-input-form');
    const logContainer = document.getElementById('agent-log-container');

    if (mode === 'chat') {
      if (btnChat) {
        btnChat.className = 'px-2.5 py-1 rounded-full text-[11px] font-bold transition-all bg-white dark:bg-neutral-900 text-[#1E2022] dark:text-white shadow-2xs cursor-pointer flex items-center gap-1.5';
      }
      if (btnLog) {
        btnLog.className = 'px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white cursor-pointer flex items-center gap-1.5';
      }
      if (chipsContainer) chipsContainer.classList.remove('hidden');
      if (chatContainer) chatContainer.classList.remove('hidden');
      if (inputForm) inputForm.classList.remove('hidden');
      if (logContainer) logContainer.classList.add('hidden');
    } else {
      if (btnLog) {
        btnLog.className = 'px-2.5 py-1 rounded-full text-[11px] font-bold transition-all bg-white dark:bg-neutral-900 text-[#1E2022] dark:text-white shadow-2xs cursor-pointer flex items-center gap-1.5';
      }
      if (btnChat) {
        btnChat.className = 'px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white cursor-pointer flex items-center gap-1.5';
      }
      if (chipsContainer) chipsContainer.classList.add('hidden');
      if (chatContainer) chatContainer.classList.add('hidden');
      if (inputForm) inputForm.classList.add('hidden');
      if (logContainer) logContainer.classList.remove('hidden');
      this.renderAgentLogs();
    }
  }

  _formatTime(d = new Date()) {
    return d.toTimeString().split(' ')[0];
  }

  setAgentLogFilter(filter) {
    this.state.agentLogFilter = filter;

    const btnAll = document.getElementById('agent-filter-btn-all');
    const btnDoing = document.getElementById('agent-filter-btn-doing');
    const btnDone = document.getElementById('agent-filter-btn-done');

    const activeClass = 'px-2.5 py-1 rounded-full bg-[#1E2022] text-white dark:bg-white dark:text-neutral-900 font-bold transition-all shadow-2xs flex items-center gap-1 cursor-pointer';
    const inactiveClass = 'px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-600 dark:text-neutral-300 transition-all flex items-center gap-1 cursor-pointer';

    if (btnAll) btnAll.className = filter === 'all' ? activeClass : inactiveClass;
    if (btnDoing) btnDoing.className = filter === 'doing' ? activeClass : inactiveClass;
    if (btnDone) btnDone.className = filter === 'done' ? activeClass : inactiveClass;

    this.renderAgentLogs();
  }

  _initAgentLogs() {
    const now = new Date();
    const fmt = (offsetSec) => {
      const d = new Date(now.getTime() - offsetSec * 1000);
      return this._formatTime(d);
    };

    // WHAT AGENT IS DOING (Active tasks / in-flight operations)
    this.agentTasksDoing = [
      {
        id: 'task-d1',
        time: fmt(8),
        content: 'Polling 1,420 SCADA telemetry registers across Bull Tower, Fox Hub, Bear Centre, Hog Arena (12ms loop)'
      },
      {
        id: 'task-d2',
        time: fmt(24),
        content: 'Computing BESS battery peak shaving dispatch schedule for 15:00-17:00 TNB commercial window'
      },
      {
        id: 'task-d3',
        time: fmt(45),
        content: 'Tracking chilled water 2-way valve oscillation on Fox Hub Level 2 AHU-02 to prevent coil freeze'
      }
    ];

    // WHAT AGENT HAS DONE (Completed actions / resolved triage)
    this.agentTasksDone = [
      {
        id: 'task-done-1',
        time: fmt(65),
        content: 'Synchronized 1,420 BMS telemetry registers with BDG2 energy baseline model'
      },
      {
        id: 'task-done-2',
        time: fmt(95),
        content: 'Detected +28.4 kW HVAC surge on Fox Hub Level 2 (AHU-02 valve stuck at 98% during off-peak)'
      },
      {
        id: 'task-done-3',
        time: fmt(130),
        content: 'Isolated mall entrance air curtain pressure surge on Bull Tower Level 1 (+22.4 kWh envelope leak)'
      },
      {
        id: 'task-done-4',
        time: fmt(175),
        content: 'Dispatched 4.15 MW clean solar power supplying 49.3% of active township demand'
      },
      {
        id: 'task-done-5',
        time: fmt(225),
        content: 'Flagged thermostat setpoint drift on Bear Centre Level 1 (over-cooled to 19.8°C vs 23.0°C policy)'
      },
      {
        id: 'task-done-6',
        time: fmt(280),
        content: 'Flagged auxiliary lighting baseload drift on Hog Arena Ground Floor (+11.2 kWh post-event)'
      },
      {
        id: 'task-done-7',
        time: fmt(350),
        content: 'Completed cell balancing cycle on 5 MWh BESS battery storage system at 84% SOC'
      },
      {
        id: 'task-done-8',
        time: fmt(430),
        content: 'Calculated TNB C1 commercial tariff mitigation savings schedule (est. RM 284/day net reduction)'
      }
    ];
  }

  renderAgentLogs() {
    const list = document.getElementById('agent-log-list');
    if (!list) return;

    const countAll = document.getElementById('agent-filter-count-all');
    const countDoing = document.getElementById('agent-filter-count-doing');
    const countDone = document.getElementById('agent-filter-count-done');

    const totalDoing = this.agentTasksDoing.length;
    const totalDone = this.agentTasksDone.length;

    if (countAll) countAll.textContent = `(${totalDoing + totalDone})`;
    if (countDoing) countDoing.textContent = `(${totalDoing})`;
    if (countDone) countDone.textContent = `(${totalDone})`;

    const filter = this.state.agentLogFilter || 'all';
    let html = '';

    // Render "WHAT AGENT IS DOING"
    if (filter === 'all' || filter === 'doing') {
      html += `
        <div class="mb-3">
          <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-amber-500/20 text-[10.5px]">
            <span class="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400 font-sans tracking-wide">
              <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              <span>WHAT AGENT IS DOING (${totalDoing})</span>
            </span>
            <span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              IN PROGRESS
            </span>
          </div>
          <div class="space-y-1.5">
      `;

      if (this.agentTasksDoing.length === 0) {
        html += `<div class="py-2 px-3 text-slate-400 dark:text-neutral-500 font-mono text-[11px] italic">No active background tasks running.</div>`;
      } else {
        this.agentTasksDoing.forEach((task) => {
          html += `
            <div class="py-2 px-2.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-[11px] leading-relaxed flex items-start gap-2 hover:border-amber-300 dark:hover:border-amber-800 transition-colors">
              <span class="font-mono font-bold text-amber-600 dark:text-amber-400 shrink-0 select-text">${task.time}</span>
              <span class="font-mono text-amber-500 font-bold shrink-0">-</span>
              <span class="font-mono text-[#1E2022] dark:text-neutral-200 flex-1 select-text">${task.content}</span>
            </div>
          `;
        });
      }

      html += `
          </div>
        </div>
      `;
    }

    // Render "WHAT AGENT HAS DONE"
    if (filter === 'all' || filter === 'done') {
      html += `
        <div>
          <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-emerald-500/20 text-[10.5px]">
            <span class="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400 font-sans tracking-wide">
              <span class="material-symbols-outlined text-[13px] text-emerald-500">check_circle</span>
              <span>WHAT AGENT HAS DONE (${totalDone})</span>
            </span>
            <span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              COMPLETED
            </span>
          </div>
          <div class="space-y-1.5">
      `;

      if (this.agentTasksDone.length === 0) {
        html += `<div class="py-2 px-3 text-slate-400 dark:text-neutral-500 font-mono text-[11px] italic">No completed actions yet.</div>`;
      } else {
        this.agentTasksDone.forEach((task) => {
          html += `
            <div class="py-2 px-2.5 rounded-xl bg-slate-50/70 dark:bg-[#161F30]/50 border border-slate-200/70 dark:border-neutral-800 text-[11px] leading-relaxed flex items-start gap-2 hover:border-slate-300 dark:hover:border-neutral-700 transition-colors">
              <span class="font-mono font-semibold text-slate-500 dark:text-neutral-400 shrink-0 select-text">${task.time}</span>
              <span class="font-mono text-slate-400 font-bold shrink-0">-</span>
              <span class="font-mono text-[#1E2022] dark:text-neutral-200 flex-1 select-text">${task.content}</span>
            </div>
          `;
        });
      }

      html += `
          </div>
        </div>
      `;
    }

    list.innerHTML = html;
  }

  triggerInstantDiagnosticScan() {
    const time = this._formatTime();
    const activeScanTask = {
      id: `audit-${Date.now()}`,
      time: time,
      content: 'Running comprehensive 1,420-point BMS register diagnostic audit across Bull Tower, Fox Hub, Bear Centre, Hog Arena...'
    };

    // 1. Add to Doing (What agent is doing)
    this.agentTasksDoing.unshift(activeScanTask);
    this.renderAgentLogs();
    this.showToast('Diagnostic audit started • Agent analyzing 1,420 registers');

    // 2. Complete and move to Done after brief real-time processing
    setTimeout(() => {
      // Remove from Doing
      this.agentTasksDoing = this.agentTasksDoing.filter((t) => t.id !== activeScanTask.id);

      // Add to Done (What agent has done)
      this.agentTasksDone.unshift({
        id: `done-${Date.now()}`,
        time: this._formatTime(),
        content: 'Completed autonomous diagnostic audit: verified 4 active anomalies across 4 towers, load shed readiness 100%'
      });

      this.renderAgentLogs();
      this.showToast('Diagnostic audit completed • 4 active anomalies verified');
    }, 1400);
  }

  _startAgentLogLoop() {
    setInterval(() => {
      if (Math.random() > 0.45) {
        const time = this._formatTime();
        const actionPool = [
          'Polled 1,420 BMS telemetry registers. Grid import 4.26 MW • Solar yield 4.15 MW (49.3%)',
          'Synchronized chiller plant VAV static pressure loops with outdoor ambient temperature (31.4°C)',
          'Evaluated BESS battery storage state of charge: 84% SOC healthy, ready for peak shaving discharge',
          'Verified solar inverter harmonic distortion within IEEE 519 thresholds (THD < 2.8%)',
          'Audited energy sub-meters across 17 township zones: zero communication dropouts detected'
        ];
        const chosen = actionPool[Math.floor(Math.random() * actionPool.length)];

        this.agentTasksDone.unshift({
          id: `done-${Date.now()}`,
          time: time,
          content: chosen
        });

        if (this.agentTasksDone.length > 25) {
          this.agentTasksDone.pop();
        }

        if (this.state.aiViewMode === 'log') {
          this.renderAgentLogs();
        }
      }
    }, 16000);
  }

  // ==========================================
  // Minimised Township Alerts Tab
  // ==========================================

  renderAlertsTabList() {
    const list = document.getElementById('alerts-tab-list');
    const badge = document.getElementById('alerts-count-badge');
    if (!list) return;

    const canonicalBuildings = ['commercial-mall', 'innovation-hub', 'community-center', 'sports-arena'];
    const allAlerts = [];

    canonicalBuildings.forEach((bId) => {
      const b = this.buildingsData[bId];
      if (!b || !b.floors) return;
      b.floors.forEach((floor) => {
        if (floor.anomaly) {
          allAlerts.push({ bId, b, floor });
        }
      });
    });

    if (badge) {
      badge.textContent = `${allAlerts.length} Active`;
    }

    let html = '';
    allAlerts.forEach(({ bId, b, floor }) => {
      const bName = b.shortName || b.name;
      const fLabel = floor.id === 'roof' ? 'Rooftop Plant' : (floor.id === 'g' ? 'Ground Floor' : `Level ${floor.levelNumber}`);
      const isHigh = floor.anomaly.severity === 'HIGH';

      html += `
        <div class="p-3.5 rounded-2xl border border-slate-200/90 dark:border-neutral-800 bg-slate-50/70 dark:bg-[#161F30]/60 flex flex-col gap-2 hover:border-slate-300 dark:hover:border-neutral-700 transition-all select-none">
          <div class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-1.5 font-bold text-xs text-[#1E2022] dark:text-white">
              <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${b.accentColor || '#ef4444'}"></span>
              <span>${bName} • ${fLabel}</span>
            </span>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${isHigh ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300'} font-mono uppercase">
              ${floor.anomaly.severity || 'ALERT'}
            </span>
          </div>
          
          <div class="flex items-center justify-between gap-2 text-[11px] font-mono">
            <span class="font-bold text-rose-600 dark:text-rose-400">${floor.anomaly.type}</span>
            <span class="text-rose-600 dark:text-rose-400 font-bold">${floor.anomaly.deltaKwh}</span>
          </div>

          <p class="text-[11px] text-neutral-600 dark:text-neutral-300 leading-snug">
            ${floor.anomaly.detail}
          </p>

          <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-neutral-800/80">
            <button onclick="twinApp.selectBuilding('${bId}'); twinApp.selectFloor('${floor.id}')" class="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 hover:bg-slate-100 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-neutral-700 text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer">
              <span class="material-symbols-outlined text-[13px]">view_in_ar</span>
              <span>Inspect in 3D</span>
            </button>
            <button onclick="twinApp.askAiFromAlertTab('${bId}', '${floor.id}')" class="px-3 py-1.5 rounded-lg bg-[#FF7A00] hover:bg-[#ea6d00] text-white text-[11px] font-bold flex items-center gap-1.5 shadow-xs transition-transform active:scale-95 cursor-pointer" title="Ask EnergiOS AI to solve this anomaly">
              <span class="material-symbols-outlined text-[13px]">smart_toy</span>
              <span>Ask AI</span>
            </button>
          </div>
        </div>
      `;
    });

    list.innerHTML = html;
  }

  askAiFromAlertTab(bId, floorId) {
    const resolvedId = this._resolveBuildingId(bId);
    const b = this.buildingsData[resolvedId];
    if (!b) return;

    const floor = b.floors?.find((fl) => fl.id === floorId);
    if (!floor || !floor.anomaly) return;

    // 1. Focus building and floor in 3D
    this.selectBuilding(resolvedId);
    setTimeout(() => {
      this.selectFloor(floorId);
    }, 280);

    // 2. Restore AI Chat with morph transition!
    this.restoreAiChat();

    // 3. Switch to Chat mode
    this.setAiViewMode('chat');

    // 4. Send query to Copilot
    const bName = b.shortName || b.name;
    const prompt = `Why is ${bName} ${floor.name} (${floor.anomaly.id}: ${floor.anomaly.type}) surging by ${floor.anomaly.deltaKwh}? Analyze the root cause and provide an immediate load mitigation plan.`;
    this.sendUserMessage(prompt);
  }

  // ==========================================
  // AI Copilot Morph Transition (Minimise / Restore)
  // ==========================================

  minimizeAiChat() {
    const chatCard = document.getElementById('twin-ai-chat-card');
    const alertsTab = document.getElementById('twin-ai-alerts-tab');
    const island = document.getElementById('dynamic-island');
    const collapsed = document.getElementById('island-collapsed');
    const liveUsage = document.getElementById('twin-live-usage-card');
    const proxy = document.getElementById('ai-chat-morph-proxy');

    if (!chatCard || this._isMorphing) return;
    this._isMorphing = true;

    // Measure starting position of AI chat card
    const chatRect = chatCard.getBoundingClientRect();

    // Calculate target resting position of Dynamic Island at top center
    const islandWidth = 160;
    const islandHeight = 36;
    const islandTop = 14;
    const islandLeft = Math.round((window.innerWidth - islandWidth) / 2);

    const isDarkMode = document.documentElement.classList.contains('dark');

    if (proxy) {
      // 1. Position proxy precisely over chatCard
      proxy.style.transition = 'none';
      proxy.style.left = `${chatRect.left}px`;
      proxy.style.top = `${chatRect.top}px`;
      proxy.style.width = `${chatRect.width}px`;
      proxy.style.height = `${chatRect.height}px`;
      proxy.style.borderRadius = '24px';
      proxy.style.background = isDarkMode ? '#121824' : '#ffffff';
      proxy.style.borderColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
      proxy.style.opacity = '1';
      proxy.classList.remove('hidden');

      const morphContent = document.getElementById('morph-island-content');
      if (morphContent) morphContent.style.opacity = '0';

      // 2. Hide chatCard
      chatCard.style.opacity = '0';
      chatCard.style.pointerEvents = 'none';

      // 3. Trigger fluid morph animation to Dynamic Island coordinates
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          proxy.style.transition = 'all 420ms cubic-bezier(0.16, 1, 0.3, 1)';
          proxy.style.left = `${islandLeft}px`;
          proxy.style.top = `${islandTop}px`;
          proxy.style.width = `${islandWidth}px`;
          proxy.style.height = `${islandHeight}px`;
          proxy.style.borderRadius = '9999px';
          proxy.style.background = '#000000';
          proxy.style.borderColor = 'rgba(255, 255, 255, 0.15)';
          if (morphContent) morphContent.style.opacity = '1';
        });
      });

      // 4. On animation completion, swap to real Dynamic Island and show Alerts tab
      setTimeout(() => {
        proxy.classList.add('hidden');
        proxy.style.opacity = '0';

        chatCard.classList.add('hidden');
        chatCard.style.opacity = '';
        chatCard.style.pointerEvents = '';

        if (alertsTab) {
          alertsTab.classList.remove('hidden');
          this.renderAlertsTabList();
        }

        if (island && collapsed) {
          island.classList.remove('hidden');
          collapsed.classList.remove('hidden');
          const expanded = document.getElementById('island-expanded');
          if (expanded) expanded.classList.add('hidden');

          island.animate(
            [
              { transform: 'translate(-50%, 0) scale(1.06)' },
              { transform: 'translate(-50%, 0) scale(1)' }
            ],
            { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
          );
        }

        this._isMorphing = false;
        this.showToast('AI Copilot minimised • Showing active alerts tab');
      }, 420);
    } else {
      chatCard.classList.add('hidden');
      if (alertsTab) {
        alertsTab.classList.remove('hidden');
        this.renderAlertsTabList();
      }
      if (island) island.classList.remove('hidden');
      this._isMorphing = false;
    }
  }

  restoreAiChat() {
    const chatCard = document.getElementById('twin-ai-chat-card');
    const alertsTab = document.getElementById('twin-ai-alerts-tab');
    const island = document.getElementById('dynamic-island');
    const proxy = document.getElementById('ai-chat-morph-proxy');

    if (!chatCard || this._isMorphing) return;
    this._isMorphing = true;

    // Hide alerts tab
    if (alertsTab) alertsTab.classList.add('hidden');

    // Get current Dynamic Island position
    const islandRect = island ? island.getBoundingClientRect() : {
      left: Math.round((window.innerWidth - 160) / 2),
      top: 14,
      width: 160,
      height: 36
    };

    // Temporarily lay out chatCard to get target destination rect
    chatCard.classList.remove('hidden');
    chatCard.style.visibility = 'hidden';

    const targetRect = chatCard.getBoundingClientRect();
    chatCard.style.visibility = '';
    chatCard.style.opacity = '0';
    chatCard.style.pointerEvents = 'none';

    // Hide real island immediately
    if (island) island.classList.add('hidden');

    const isDarkMode = document.documentElement.classList.contains('dark');

    if (proxy) {
      // 1. Position proxy at island location
      proxy.style.transition = 'none';
      proxy.style.left = `${islandRect.left}px`;
      proxy.style.top = `${islandRect.top}px`;
      proxy.style.width = `${islandRect.width}px`;
      proxy.style.height = `${islandRect.height}px`;
      proxy.style.borderRadius = '9999px';
      proxy.style.background = '#000000';
      proxy.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      proxy.style.opacity = '1';
      proxy.classList.remove('hidden');

      const morphContent = document.getElementById('morph-island-content');
      if (morphContent) morphContent.style.opacity = '1';

      // 2. Animate morph down to right column
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          proxy.style.transition = 'all 420ms cubic-bezier(0.16, 1, 0.3, 1)';
          proxy.style.left = `${targetRect.left}px`;
          proxy.style.top = `${targetRect.top}px`;
          proxy.style.width = `${targetRect.width}px`;
          proxy.style.height = `${targetRect.height}px`;
          proxy.style.borderRadius = '24px';
          proxy.style.background = isDarkMode ? '#121824' : '#ffffff';
          proxy.style.borderColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
          if (morphContent) morphContent.style.opacity = '0';
        });
      });

      // 3. Handoff to real chatCard
      setTimeout(() => {
        proxy.classList.add('hidden');
        proxy.style.opacity = '0';

        chatCard.style.opacity = '1';
        chatCard.style.pointerEvents = '';
        chatCard.animate(
          [
            { transform: 'scale(0.98)' },
            { transform: 'scale(1)' }
          ],
          { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        );

        this._isMorphing = false;
        this.showToast('AI Copilot restored');
      }, 420);
    } else {
      chatCard.style.opacity = '1';
      chatCard.style.pointerEvents = '';
      this._isMorphing = false;
    }
  }

  showFloorAlertCallout(building, floor) {
    const callout = document.getElementById('floor-alert-callout');
    if (!callout || !floor.anomaly) return;

    const floorNameEl = document.getElementById('callout-floor-name');
    const titleEl = document.getElementById('callout-anomaly-title');
    const detailEl = document.getElementById('callout-anomaly-detail');
    const impactEl = document.getElementById('callout-anomaly-impact');
    const idEl = document.getElementById('callout-anomaly-id');

    const bName = building.shortName || building.name;
    if (floorNameEl) floorNameEl.textContent = `${bName} • ${floor.name}`;
    if (titleEl) titleEl.textContent = floor.anomaly.type;
    if (idEl) idEl.textContent = floor.anomaly.id;
    if (detailEl) detailEl.textContent = floor.anomaly.detail;
    if (impactEl) impactEl.textContent = `${floor.anomaly.deltaKwh} surge`;

    callout.classList.remove('hidden', 'opacity-0', 'translate-y-2');
    callout.classList.add('opacity-100', 'translate-y-0');
  }

  hideFloorAlertCallout() {
    const callout = document.getElementById('floor-alert-callout');
    if (!callout) return;
    callout.classList.remove('opacity-100', 'translate-y-0');
    callout.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      callout.classList.add('hidden');
    }, 220);
  }

  askCopilotAboutFloorAlert() {
    // If AI chat is currently minimised, restore it with morph transition!
    const chatCard = document.getElementById('twin-ai-chat-card');
    if (chatCard && chatCard.classList.contains('hidden')) {
      this.restoreAiChat();
    }

    const activeBId = this._resolveBuildingId(this.state.selectedBuildingId || 'innovation-hub');
    const b = this.buildingsData[activeBId];
    const floor = (this.state.selectedFloorId ? b?.floors?.find((fl) => fl.id === this.state.selectedFloorId) : null) ||
                  b?.floors?.find((fl) => !!fl.anomaly);

    if (floor?.anomaly) {
      const bName = b ? (b.shortName || b.name) : 'Building';
      this.sendUserMessage(`Why is ${bName} ${floor.name} (${floor.anomaly.id}: ${floor.anomaly.type}) surging by ${floor.anomaly.deltaKwh}? What is the root cause and recommended remediation?`);
    } else {
      this.sendUserMessage('What anomalies or equipment issues are currently active in this building?');
    }
  }

  updateActiveBuildingTitle(title) {
    const el = document.getElementById('active-building-name-label');
    if (el) el.textContent = title;
  }

  // ==========================================
  // Current Live Energy Usage (Grid vs Solar)
  // ==========================================

  updateLiveEnergyUsage() {
    const bId = this._resolveBuildingId(this.state.selectedBuildingId);
    let totalDemand = 186.4;
    let solarGen = 92.0;

    if (bId && this.buildingsData[bId]) {
      const b = this.buildingsData[bId];
      totalDemand = b.demandKw || 186.4;
      // Roof solar generation from building or proportional capacity
      const roofFloor = b.floors.find((f) => f.id === 'roof');
      solarGen = roofFloor ? Math.min(totalDemand * 0.75, (roofFloor.solarGenKwh / 24) * 2.2) : totalDemand * 0.48;
      solarGen = Math.round(solarGen * 10) / 10;
    } else {
      // Township Macro
      totalDemand = 842.0;
      solarGen = 415.0;
    }

    // Grid Import is the remaining net demand from the grid
    const gridImport = Math.max(0, Math.round((totalDemand - solarGen) * 10) / 10);
    const solarShare = Math.min(100, Math.round((solarGen / Math.max(totalDemand, 0.1)) * 1000) / 10);
    const gridShare = Math.min(100, Math.round((gridImport / Math.max(totalDemand, 0.1)) * 1000) / 10);

    // Cost rate under TNB Commercial C1 Peak Rate (RM 0.584/kWh)
    const costRate = Math.round(gridImport * this.tnbTariff.peakRateMyr * 100) / 100;
    const costAvoided = Math.round(solarGen * this.tnbTariff.peakRateMyr * 100) / 100;
    const carbonRate = Math.round(gridImport * this.tnbTariff.gridFactorKgCo2PerKwh * 10) / 10;

    this.state.liveTelemetry = {
      totalDemandKw: totalDemand,
      solarGenKw: solarGen,
      gridImportKw: gridImport,
      solarSharePct: solarShare,
      gridSharePct: gridShare,
      costRateMyr: costRate,
      costAvoidedMyr: costAvoided,
      carbonRateKg: carbonRate,
    };

    // Update DOM Telemetry Cards
    this.setText('live-total-demand', `${totalDemand.toFixed(1)} kW`);
    this.setText('live-solar-val', `${solarGen.toFixed(1)}`);
    this.setText('live-solar-share', `${solarShare}% of building load`);
    this.setText('live-grid-val', `${gridImport.toFixed(1)}`);
    this.setText('live-grid-share', `${gridShare}% of building load`);
    this.setText('live-cost-rate', `RM ${costRate.toFixed(2)} / hr`);
    this.setText('live-avoided-rate', `-RM ${costAvoided.toFixed(2)} / hr`);
    this.setText('live-carbon-rate', `${carbonRate.toFixed(1)} kg CO₂/hr`);
    this.setText('live-self-sufficiency-tag', `☀️ ${solarShare}% Solar · ⚡ ${gridShare}% Grid`);

    // Prominent Status Pill: what energy is being used right now
    const sourceStatus = solarShare >= 70
      ? `☀️ PRIMARILY ROOFTOP SOLAR (${solarShare}%)`
      : (gridShare >= 70 ? `⚡ PRIMARILY UTILITY GRID (${gridShare}%)` : `☀️ ${solarShare}% SOLAR · ⚡ ${gridShare}% GRID`);
    this.setText('live-active-status-text', sourceStatus);

    const mixLabel = solarShare >= 70
      ? '100% CLEAN SOLAR'
      : (gridShare >= 70 ? 'TNB GRID IMPORT' : 'HYBRID DUAL-SOURCE');
    this.setText('live-source-status-text', mixLabel);

    // Update Proportional Segmented Balance Bar
    const solarBar = document.getElementById('live-solar-bar');
    const gridBar = document.getElementById('live-grid-bar');
    if (solarBar) solarBar.style.width = `${solarShare}%`;
    if (gridBar) gridBar.style.width = `${gridShare}%`;
  }

  // ==========================================
  // Four Building Power Demand Speedometer Dials (Follows index.html Design 100%)
  // Each block strictly uses EITHER Solar OR Grid
  // ==========================================

  toggleBuildingEnergySource(buildingId, event) {
    if (event) event.stopPropagation();
    if (!this.state.buildingSources) this.state.buildingSources = {};
    const resolvedId = this._resolveBuildingId(buildingId);
    const current = this.state.buildingSources[resolvedId] || this.state.buildingSources[buildingId] || (resolvedId === 'innovation-hub' || resolvedId === 'sports-arena' ? 'solar' : 'grid');
    const next = current === 'solar' ? 'grid' : 'solar';
    this.setBuildingEnergySource(buildingId, next, event);
  }

  setBuildingEnergySource(buildingId, source, event) {
    if (event) event.stopPropagation();
    if (!this.state.buildingSources) this.state.buildingSources = {};
    const resolvedId = this._resolveBuildingId(buildingId);
    this.state.buildingSources[buildingId] = source;
    this.state.buildingSources[resolvedId] = source;
    
    const b = this.buildingsData[resolvedId] || this.buildingsData[buildingId];
    const bName = b ? (b.shortName || b.name) : buildingId;
    const sourceLabel = source === 'solar' ? '☀️ Clean Solar (Green)' : '⚡ Utility Grid (Blue)';
    this.showToast(`${bName} set to ${sourceLabel}`);
    
    this.renderBuildingPowerDials();
    this.updateLiveEnergyUsage();
  }

  renderBuildingPowerDials() {
    const container = document.getElementById('four-buildings-dials-grid');
    if (!container) return;

    if (!this.state.buildingSources) {
      this.state.buildingSources = {
        'commercial-mall': 'grid',
        'innovation-hub': 'solar',
        'fox-hub': 'solar',
        'community-center': 'grid',
        'bear-center': 'grid',
        'sports-arena': 'solar',
        'hog-arena': 'solar'
      };
    }

    const buildings = [
      { id: 'commercial-mall', code: 'BDG2-BULL', name: 'Bull Tower', demandKw: 412.5, minKw: 248.0, peakKw: 489.2, maxKw: 520, accent: '#006948' },
      { id: 'innovation-hub', code: 'BDG2-FOX', name: 'Fox Hub', demandKw: 186.4, minKw: 112.5, peakKw: 228.6, maxKw: 260, accent: '#FF7A00', anomaly: true },
      { id: 'community-center', code: 'BDG2-BEAR', name: 'Bear Center', demandKw: 345.8, minKw: 210.0, peakKw: 395.0, maxKw: 450, accent: '#0284C7' },
      { id: 'sports-arena', code: 'BDG2-HOG', name: 'Hog Arena', demandKw: 278.0, minKw: 140.0, peakKw: 320.5, maxKw: 380, accent: '#8B5CF6' }
    ];

    let html = '';
    buildings.forEach((b) => {
      const isSelected = this._resolveBuildingId(this.state.selectedBuildingId) === b.id;
      const isSolar = (this.state.buildingSources[b.id] || 
                       this.state.buildingSources[this._resolveBuildingId(b.id)] || 
                       (b.id === 'innovation-hub' || b.id === 'sports-arena' ? 'solar' : 'grid')) === 'solar';

      let currentDemand = b.demandKw;
      if (isSelected && this.state.liveTelemetry?.totalDemandKw && (b.id === 'innovation-hub' || b.id === 'fox-hub')) {
        currentDemand = this.state.liveTelemetry.totalDemandKw;
      }

      html += `
        <div onclick="twinApp.selectBuilding('${b.id}')" class="p-3 lg:p-3.5 rounded-2xl bg-white dark:bg-[#162030] border ${isSelected ? 'border-[#FF7A00] ring-2 ring-[#FF7A00]/40 shadow-lg bg-orange-50/20 dark:bg-orange-950/25 scale-[1.01]' : 'border-slate-200/80 dark:border-neutral-800'} hover:border-[#FF7A00] dark:hover:border-[#FF7A00] cursor-pointer transition-all flex flex-col justify-between shadow-2xs group min-w-0" title="Click meter to zoom in ${b.name} on 3D">
          
          <!-- Top: Building Name & Anomaly Alert -->
          <div class="flex items-center justify-between gap-1 pb-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${b.accent}"></span>
              <h3 class="text-xs lg:text-sm font-bold text-[#1E2022] dark:text-white font-sans truncate">${b.name}</h3>
            </div>
            ${b.anomaly ? '<span class="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white font-mono animate-pulse shrink-0 flex items-center gap-1 shadow-xs"><svg viewBox="0 0 200 180" class="w-2.5 h-2.5 shrink-0" fill="none"><path d="M 90.5 17.5 C 94.8 9.8 105.2 9.8 109.5 17.5 L 191.5 146.5 C 196.2 153.9 190.8 163.5 182.0 163.5 L 18.0 163.5 C 9.2 163.5 3.8 153.9 8.5 146.5 Z" fill="#FFFFFF"/><path d="M 100 55 L 100 105" stroke="#EE272C" stroke-width="20" stroke-linecap="round"/><circle cx="100" cy="132" r="10" fill="#EE272C"/></svg> ALERT</span>' : ''}
          </div>

          <!-- Middle: Circular Speedometer Radial Tick Dial & Number Inside -->
          <div class="relative w-full flex items-center justify-center my-1 flex-1">
            <svg class="w-28 h-28 lg:w-32 lg:h-32 transition-transform duration-300 group-hover:scale-105" viewBox="0 0 140 140">
              <g id="dial-ticks-${b.id}"></g>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span class="text-[10px] text-[#71767B] dark:text-slate-400 font-medium uppercase tracking-wider font-mono">Demand</span>
              <span class="text-xl lg:text-2xl font-extrabold text-[#1E2022] dark:text-white mt-0.5 tracking-tight font-mono leading-none">${currentDemand.toFixed(1)}</span>
              <span class="text-[9px] text-[#71767B] dark:text-slate-400 font-medium font-mono">kW</span>
            </div>
          </div>

          <!-- Below: Grid / Solar Indicator (Positioned Below the Meter Dial) -->
          <div class="flex items-center justify-center pt-1.5 mt-auto" onclick="event.stopPropagation()">
            <button onclick="twinApp.toggleBuildingEnergySource('${b.id}', event)" class="px-2.5 py-1 rounded-full text-[10px] font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs ${isSolar ? 'bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60' : 'bg-blue-50 dark:bg-blue-950/80 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60'}" title="Click to toggle between Solar & Grid">
              <span class="w-1.5 h-1.5 rounded-full ${isSolar ? 'bg-[#22C55E] animate-pulse' : 'bg-[#2563EB] animate-pulse'}"></span>
              <span>${isSolar ? '☀️ Solar' : '⚡ Grid'}</span>
            </button>
          </div>

        </div>
      `;
    });

    container.innerHTML = html;

    // Render radial speedometer ticks for each building (42 ticks, matching index.html 100%)
    buildings.forEach((b) => {
      let currentDemand = b.demandKw;
      if (this._resolveBuildingId(this.state.selectedBuildingId) === b.id && this.state.liveTelemetry?.totalDemandKw && (b.id === 'innovation-hub' || b.id === 'fox-hub')) {
        currentDemand = this.state.liveTelemetry.totalDemandKw;
      }
      const isSolar = (this.state.buildingSources[b.id] || 
                       this.state.buildingSources[this._resolveBuildingId(b.id)] || 
                       (b.id === 'innovation-hub' || b.id === 'sports-arena' ? 'solar' : 'grid')) === 'solar';
      this.renderPowerDialTicksForBuilding(`dial-ticks-${b.id}`, currentDemand, b.maxKw, isSolar ? 'solar' : 'grid');
    });
  }

  renderPowerDialTicksForBuilding(svgId, currentKw, maxKw, source) {
    const container = document.getElementById(svgId);
    if (!container) return;

    // 100% exact copy of index.html renderPowerDialTicks math:
    const totalTicks = 42;
    const radius = 58;
    const cx = 70;
    const cy = 70;
    const ratio = Math.min(1, Math.max(0, currentKw / (maxKw || 1)));
    const filledTicks = Math.round(ratio * totalTicks);
    const isDark = window.themeManager ? window.themeManager.isDark() : false;
    const unfilledColor = isDark ? '#334155' : '#E2E8F0';
    // User requirement: if solar, make meter color green; if grid, make it blue
    const activeColor = source === 'solar' ? '#22C55E' : (isDark ? '#3B82F6' : '#2563EB');
    let svgContent = '';

    for (let i = 0; i < totalTicks; i++) {
      const angle = ((135 + (i / (totalTicks - 1)) * 270) * Math.PI) / 180;
      const innerX = cx + (radius - 8) * Math.cos(angle);
      const innerY = cy + (radius - 8) * Math.sin(angle);
      const outerX = cx + radius * Math.cos(angle);
      const outerY = cy + radius * Math.sin(angle);
      const strokeColor = i < filledTicks ? activeColor : unfilledColor;
      const strokeWidth = i % 5 === 0 ? 2.2 : 1.2;
      svgContent += `<line x1="${innerX.toFixed(1)}" y1="${innerY.toFixed(1)}" x2="${outerX.toFixed(1)}" y2="${outerY.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
    }
    container.innerHTML = svgContent;
  }

  startLiveTelemetryLoop() {
    if (this._liveTickerTimer) clearInterval(this._liveTickerTimer);
    this._liveTickerTimer = setInterval(() => {
      // Simulate micro-fluctuations in SCADA irradiance and HVAC demand
      if (!this.state.selectedFloorId) {
        const delta = (Math.random() - 0.48) * 1.5;
        this.state.liveTelemetry.totalDemandKw = Math.max(20, Math.round((this.state.liveTelemetry.totalDemandKw + delta) * 10) / 10);
        this.updateLiveEnergyUsage();
        this.renderBuildingPowerDials();
      }
    }, 4500);
  }

  // ==========================================
  // AI Copilot Chatbot Engine
  // ==========================================

  initChatbot() {
    this.state.chatMessages = [
      {
        sender: 'copilot',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `Hello! I'm monitoring the 3D Digital Twin and live SCADA microgrid. 

I've detected a **High-Severity Anomaly** on **Fox Hub Level 2** (AHU Chilled Water Valve stuck 98% open, drawing **+28.4 kW** above expected baseline). 

Clean on-site **Solar Generation** is currently supplying **49.4%** of building load, with the remaining **50.6%** drawn from the **TNB Grid**.

You can ask me to analyze the anomaly, execute a peak-load shed, or upload your custom ML model file anytime.`
      }
    ];

    this.renderChatMessages();
  }

  renderChatMessages() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    let html = '';
    this.state.chatMessages.forEach((msg) => {
      const isUser = msg.sender === 'user';
      if (isUser) {
        html += `
          <div class="flex items-start justify-end gap-3">
            <div class="max-w-[85%] bg-[#181A1D] text-white p-4 rounded-[22px] rounded-tr-xs text-[13.5px] font-sans shadow-sm leading-relaxed">
              ${this.escapeHtml(msg.text)}
              <span class="block text-[10px] opacity-60 text-right mt-1.5 font-mono">${msg.time}</span>
            </div>
            <div class="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
              ME
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="flex items-start gap-3.5">
            <!-- Sparkle Avatar Circle Matching Photo -->
            <div class="w-9 h-9 rounded-full bg-[#FFF5EC] dark:bg-amber-950/60 border border-[#FED7AA] dark:border-amber-700/60 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
              <svg viewBox="0 0 24 24" class="w-4 h-4 text-[#D96B27]" fill="currentColor">
                <path d="M12 2L14.2 9.8L22 12L14.2 14.2L12 22L9.8 14.2L2 12L9.8 9.8Z"/>
              </svg>
            </div>

            <!-- Message Card Bubble Matching Photo -->
            <div class="flex-1 bg-[#F4F6F9] dark:bg-[#18202F] border border-[#E5E9F0] dark:border-neutral-800/90 p-5 rounded-[24px] text-[13.5px] font-sans text-[#1F2937] dark:text-neutral-200 leading-relaxed space-y-3 shadow-2xs">
              ${this.formatMarkdownText(msg.text)}
              ${msg.actionHtml ? `<div class="pt-2 border-t border-slate-200 dark:border-neutral-700/60">${msg.actionHtml}</div>` : ''}
              <div class="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono text-right pt-1">${msg.time}</div>
            </div>
          </div>
        `;
      }
    });

    if (this.state.isChatTyping) {
      html += `
        <div class="flex items-start gap-3.5">
          <div class="w-9 h-9 rounded-full bg-[#FFF5EC] dark:bg-amber-950/60 border border-[#FED7AA] dark:border-amber-700/60 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
            <svg viewBox="0 0 24 24" class="w-4 h-4 text-[#D96B27]" fill="currentColor">
              <path d="M12 2L14.2 9.8L22 12L14.2 14.2L12 22L9.8 14.2L2 12L9.8 9.8Z"/>
            </svg>
          </div>
          <div class="bg-[#F4F6F9] dark:bg-[#18202F] border border-[#E5E9F0] dark:border-neutral-800/90 px-5 py-3.5 rounded-[24px] flex items-center gap-2 shadow-2xs">
            <span class="w-2 h-2 rounded-full bg-[#D96B27] animate-bounce"></span>
            <span class="w-2 h-2 rounded-full bg-[#D96B27] animate-bounce [animation-delay:0.2s]"></span>
            <span class="w-2 h-2 rounded-full bg-[#D96B27] animate-bounce [animation-delay:0.4s]"></span>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  sendPresetPrompt(promptText) {
    this.sendUserMessage(promptText);
  }

  handleChatFormSubmit(event) {
    event.preventDefault();
    const input = document.getElementById('chat-user-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    this.sendUserMessage(text);
  }

  sendUserMessage(text) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.state.chatMessages.push({ sender: 'user', time: timeStr, text });
    this.state.isChatTyping = true;
    this.renderChatMessages();

    // Generate intelligent AI response after short realistic reasoning delay
    setTimeout(() => {
      const response = this.generateAIResponse(text);
      this.state.isChatTyping = false;
      this.state.chatMessages.push({
        sender: 'copilot',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: response.text,
        actionHtml: response.actionHtml
      });
      this.renderChatMessages();
    }, 750);
  }

  generateAIResponse(query) {
    const q = query.toLowerCase();
    const bId = this.state.selectedBuildingId || 'fox-hub';
    const b = this.buildingsData[bId];
    const solarKw = this.state.liveTelemetry.solarGenKw;
    const gridKw = this.state.liveTelemetry.gridImportKw;
    const isCustomModel = window.energiosML.isLoaded;
    const modelTag = isCustomModel ? `🧠 *Inference via uploaded model (${window.energiosML.modelName})*:\n\n` : '';

    if (q.includes('level 2') || q.includes('2nd floor') || q.includes('valve') || q.includes('surge') || q.includes('anomaly')) {
      return {
        text: `${modelTag}**Diagnostic Report: Fox Hub Level 2 Anomaly (ANOM-7421)**

• **Equipment**: AHU-02-TECH Chilled Water 2-Way Modulating Valve
• **Telemetry**: Space temp has drifted to **22.8°C** (+0.3°C), with valve actuator command locked at **98% open**.
• **Energy Impact**: Interval draw is **114.0 kW** vs model expected baseline **85.6 kW** (+**28.4 kW** surge / +42.1%).
• **TNB C1 Cost Impact**: Generating **+RM 16.59/hour** in avoidable grid utility spend during the commercial peak tariff window.

**Recommendation**:
Force valve override to **60%**, step setpoint to **24.0°C**, and verify differential pressure transducer feedback.`,
        actionHtml: `
          <div class="flex flex-wrap gap-2 pt-1">
            <button onclick="twinApp.selectFloor('l2')" class="px-3 py-1 rounded-xl bg-orange-100 dark:bg-orange-950 text-[#FF7A00] hover:bg-orange-200 border border-orange-300 dark:border-orange-800 text-[11px] font-semibold flex items-center gap-1 transition-colors">
              <span class="material-symbols-outlined text-[14px]">view_in_ar</span> Focus Level 2 in 3D
            </button>
            <button onclick="twinApp.applySetback('l2', 24.0)" class="px-3 py-1 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200 border border-emerald-300 dark:border-emerald-800 text-[11px] font-semibold flex items-center gap-1 transition-colors">
              <span class="material-symbols-outlined text-[14px]">thermostat</span> Override Valve to 60%
            </button>
          </div>
        `
      };
    }

    if (q.includes('solar') || q.includes('grid') || q.includes('balance') || q.includes('maximize')) {
      return {
        text: `${modelTag}**Live Solar vs Grid Balance Strategy**:

• **Current Solar Output**: **${solarKw} kW** (49.4% clean renewable share).
• **Grid Draw**: **${gridKw} kW** under TNB C1 Peak Rate (RM 0.584 / kWh).
• **Self-Sufficiency Index**: Currently at **49.4%**. 

**Optimization Opportunities**:
1. Pre-cool Level 1 & Level 3 zones during peak solar generation (12:00 - 14:30 MYT) to build thermal storage before afternoon grid peak.
2. Divert 15 kW of surplus PV generation into BESS storage to avoid exporting zero-feed-in tariff energy.`,
        actionHtml: `
          <div class="flex flex-wrap gap-2 pt-1">
            <button onclick="twinApp.showToast('Solar peak self-consumption protocol activated')" class="px-3 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 text-[11px] font-semibold">
              ⚡ Activate Solar Priority Mode
            </button>
          </div>
        `
      };
    }

    if (q.includes('cost') || q.includes('tariff') || q.includes('saving') || q.includes('tnb')) {
      return {
        text: `${modelTag}**TNB C1 Commercial Tariff Breakdown**:

• **Current Grid Tariff**: **RM 0.584 per kWh** (Peak Band: 08:00 - 22:00).
• **Current Grid Cost Rate**: **RM ${this.state.liveTelemetry.costRateMyr.toFixed(2)} / hour**.
• **Clean Solar Savings Rate**: Avoided **RM ${this.state.liveTelemetry.costAvoidedMyr.toFixed(2)} / hour** by generating ${solarKw} kW clean solar.
• **Projected Daily Avoided Cost**: ~**RM 6,482.40** across monitored township assets.`,
        actionHtml: ''
      };
    }

    if (q.includes('shed') || q.includes('setback') || q.includes('mitigate')) {
      return {
        text: `${modelTag}**Load Shedding Simulation**:

Initiating a **25.0 kW** demand curtailment on Level 2 will drop grid import from **${gridKw} kW** to **${(gridKw - 25).toFixed(1)} kW**, eliminating the anomaly flag and saving **RM 14.60 / hour** under peak tariff rates.`,
        actionHtml: `
          <button onclick="twinApp.applySetback('l2', 24.5)" class="px-3 py-1 rounded-xl bg-orange-100 dark:bg-orange-950 text-[#FF7A00] border border-orange-300 text-[11px] font-semibold">
            Execute 25 kW Shedding on L2
          </button>
        `
      };
    }

    return {
      text: `${modelTag}I've analyzed your telemetry request for **${b?.name || 'the microgrid'}**.

• **Total Power**: **${this.state.liveTelemetry.totalDemandKw.toFixed(1)} kW** (Solar: **${solarKw} kW** · Grid: **${gridKw} kW**).
• **Active Anomaly**: Fox Hub Level 2 valve passing (+28.4 kW surge).
• **Machine Learning Model**: ${window.energiosML.modelName}.

How would you like to proceed? You can ask me to inspect specific floors, analyze tariff rates, or upload a custom ML file.`,
      actionHtml: ''
    };
  }

  applySetback(floorId, targetC) {
    this.showToast(`Applied emergency setback to ${targetC}°C on Level 2`);
    this.state.liveTelemetry.totalDemandKw = Math.max(30, this.state.liveTelemetry.totalDemandKw - 28.4);
    this.updateLiveEnergyUsage();
    this.hideFloorAlertCallout();

    this.state.chatMessages.push({
      sender: 'copilot',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `✅ **Setback Executed**:
• Valve override dispatched to AHU-02-TECH.
• Floor 2 demand reduced by **28.4 kW**.
• Total grid demand dropped to **${this.state.liveTelemetry.gridImportKw.toFixed(1)} kW**.
• Anomaly flag cleared and nominal baseline restored.`,
      actionHtml: ''
    });
    this.renderChatMessages();
  }

  // ==========================================
  // Machine Learning Model File Upload Hook
  // ==========================================

  handleMLFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    window.energiosML.loadModel(file);

    // Update UI Badge
    const badge = document.getElementById('ml-model-status-badge');
    if (badge) {
      badge.textContent = `🧠 Model: ${file.name} Active`;
      badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 shadow-2xs';
    }

    this.showToast(`Loaded ML Model: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    // Add Copilot announcement message
    this.state.chatMessages.push({
      sender: 'copilot',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `🎉 **Custom ML Model Successfully Loaded!**
• **File**: \`${file.name}\` (${(file.size / 1024).toFixed(1)} KB)
• **Inference Hook**: \`window.energiosML.predict()\` is now wired to your custom model parameters.
• **Active Pipeline**: Ready to run building load predictions, HVAC fault classification, and tariff-optimized load shedding directly on this Digital Twin!`,
      actionHtml: `
        <button onclick="twinApp.askCopilotAboutFloorAlert()" class="px-3 py-1 rounded-xl bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300 text-[11px] font-semibold">
          Run ${file.name} Inference on Level 2
        </button>
      `
    });
    this.renderChatMessages();
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
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
    }, 3500);
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  formatMarkdownText(str) {
    if (!str) return '';
    // Split by double newline into clean paragraphs
    const paragraphs = str.split(/\n\s*\n/);
    return paragraphs
      .map((p) => {
        let text = this.escapeHtml(p.trim());
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-[#111827] dark:text-white">$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');
        text = text.replace(/`(.*?)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-neutral-800 font-mono text-xs text-[#D96B27]">$1</code>');
        text = text.replace(/\n• /g, '<br>• ');
        text = text.replace(/\n/g, '<br>');
        return `<p class="leading-relaxed">${text}</p>`;
      })
      .join('');
  }
}

// Global initialization
window.twinApp = new EnergiOSTwinApp();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.twinApp.init());
} else {
  window.twinApp.init();
}
