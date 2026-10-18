/**
 * EnergiOS - 2D Architectural CAD Floorplan Component (floorplan_2d.js)
 * Procedurally generated 2D CAD blueprint exactly matching the 3D microgrid model:
 * Service Core, AHU Mechanical Assemblies, Hydronic CHWS/CHWR Loops,
 * Galvanized Supply Ducts, Diffusers with animated air ripples, and Zoned Thermal Telemetry.
 */

class Floorplan2DView {
  constructor(options = {}) {
    this.container = options.container;
    this.onInspectZone = options.onInspectZone || (() => {});
    this.theme = options.theme || 'blueprint'; // 'blueprint' (dark) | 'architectural' (light)

    // State
    this.buildingId = 'commercial-mall';
    this.floorId = 'l3';
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };

    // Layers
    this.layers = {
      hvac: true,
      heatmap: true,
      furniture: true,
      sensors: true,
      dimensions: true
    };

    this.selectedZoneId = null;

    if (this.container) {
      this.init();
    }
  }

  init() {
    this.render();
    this._attachEvents();
  }

  setBuildingAndFloor(buildingId, floorId) {
    this.buildingId = buildingId || 'commercial-mall';
    this.floorId = floorId || (this.buildingId === 'commercial-mall' ? 'l3' : 'l1');
    this.render();
  }

  setTheme(theme) {
    this.theme = theme;
    this.render();
  }

  toggleLayer(layerKey) {
    if (this.layers[layerKey] !== undefined) {
      this.layers[layerKey] = !this.layers[layerKey];
      this.render();
    }
  }

  zoomIn() {
    this.scale = Math.min(this.scale + 0.15, 2.5);
    this.render();
  }

  zoomOut() {
    this.scale = Math.max(this.scale - 0.15, 0.6);
    this.render();
  }

  resetPanZoom() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.render();
  }

  render() {
    if (!this.container) return;

    const bData = window.BUILDINGS_DATA?.[this.buildingId] || window.BUILDINGS_DATA?.['commercial-mall'];
    const activeFloor = bData?.floors?.find((f) => f.id === this.floorId) || bData?.floors?.[0] || {
      id: 'l3',
      name: 'Level 3: Executive Suites & Offices',
      demandKw: 88.5,
      hvac: {
        ahuTag: 'AHU-03-EXEC',
        status: 'RUNNING - NORMAL',
        spaceTempC: 22.1,
        setpointC: 22.0,
        supplyTempC: 14.0,
        returnTempC: 23.4,
        chwSupplyC: 6.8,
        chwReturnC: 12.2,
        chwDeltaTC: 5.4,
        airflowCfm: 3800,
        chwValvePercent: 64,
        fanSpeedPercent: 72,
        rhPercent: 51,
        co2Ppm: 510
      }
    };

    const isRoof = this.floorId === 'roof';
    const isGround = this.floorId === 'g';
    const isDark = this.theme === 'blueprint';

    // Theme color palette
    const colors = isDark ? {
      bg: '#0B111E',
      grid: 'rgba(56, 189, 248, 0.08)',
      wallOuter: '#38BDF8',
      wallFill: '#1E293B',
      wallInner: '#475569',
      glass: 'rgba(56, 189, 248, 0.35)',
      core: '#1E293B',
      coreText: '#94A3B8',
      ductTrunk: '#64748B',
      ductFill: 'rgba(100, 116, 139, 0.35)',
      chws: '#0284C7',
      chwr: '#7C3AED',
      ahuFill: '#1E293B',
      ahuStroke: '#10B981',
      diffuser: '#F8FAFC',
      diffuserAir: 'rgba(56, 189, 248, 0.35)',
      furniture: '#334155',
      furnitureStroke: '#64748B',
      dimLine: '#475569',
      dimText: '#94A3B8',
      titleBg: 'rgba(15, 23, 42, 0.92)',
      titleBorder: 'rgba(51, 65, 85, 0.8)',
      titleText: '#F8FAFC',
    } : {
      bg: '#FAF8F5',
      grid: 'rgba(0, 0, 0, 0.05)',
      wallOuter: '#1E2022',
      wallFill: '#F4F0E8',
      wallInner: '#CBD5E1',
      glass: 'rgba(2, 132, 199, 0.25)',
      core: '#E2E8F0',
      coreText: '#475569',
      ductTrunk: '#71767B',
      ductFill: 'rgba(226, 232, 240, 0.7)',
      chws: '#0284C7',
      chwr: '#7C3AED',
      ahuFill: '#FFFFFF',
      ahuStroke: '#006948',
      diffuser: '#1E2022',
      diffuserAir: 'rgba(2, 132, 199, 0.25)',
      furniture: '#EBE7DF',
      furnitureStroke: '#94A3B8',
      dimLine: '#94A3B8',
      dimText: '#71767B',
      titleBg: 'rgba(255, 255, 255, 0.95)',
      titleBorder: '#EBE7DF',
      titleText: '#1E2022',
    };

    // Calculate canvas geometry
    const bW = bData?.dimensions?.width || 50;
    const bD = bData?.dimensions?.depth || 40;
    const aspect = bW / bD;

    // ViewBox in CAD coordinates
    const vbW = 1000;
    const vbH = 750;
    const originX = 140;
    const originY = 100;
    const planW = 720;
    const planH = Math.round(planW / aspect);

    // Thermal Heatmap zone color
    const hasAnomaly = !!activeFloor.anomaly;
    const zoneHeatColor = hasAnomaly ? 'rgba(244, 63, 94, 0.18)' : 'rgba(34, 197, 94, 0.12)';
    const zoneHeatStroke = hasAnomaly ? 'rgba(244, 63, 94, 0.5)' : 'rgba(34, 197, 94, 0.35)';

    // Generate Layout Components
    const svgContent = `
      <svg id="cad-floorplan-svg" width="100%" height="100%" viewBox="0 0 ${vbW} ${vbH}" class="select-none transition-transform" style="transform: translate(${this.panX}px, ${this.panY}px) scale(${this.scale}); transform-origin: center center;">
        <defs>
          <!-- Grid Pattern -->
          <pattern id="cad-subgrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${colors.grid}" stroke-width="0.75"/>
          </pattern>
          <pattern id="cad-majorgrid" width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill="url(#cad-subgrid)"/>
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="${colors.grid}" stroke-width="1.5"/>
          </pattern>

          <!-- Wall Hatch Pattern -->
          <pattern id="wall-hatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="8" stroke="${isDark ? '#334155' : '#D1D5DB'}" stroke-width="1.2" />
          </pattern>

          <!-- Duct Hatch -->
          <pattern id="duct-seams" width="16" height="16" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="16" y2="0" stroke="${colors.ductTrunk}" stroke-width="0.8" opacity="0.5" />
          </pattern>
        </defs>

        <!-- Background & CAD Drafting Grid -->
        <rect width="${vbW}" height="${vbH}" fill="${colors.bg}"/>
        <rect width="${vbW}" height="${vbH}" fill="url(#cad-majorgrid)"/>

        <!-- ======================================================== -->
        <!-- LAYER 0: DIMENSION STRINGS & STRUCTURAL GRID BUBBLES     -->
        <!-- ======================================================== -->
        ${this.layers.dimensions ? `
          <!-- Horizontal Grid Axes: A, B, C, D -->
          <g class="cad-dimensions" font-family="'Space Grotesk', monospace" font-size="11" fill="${colors.dimText}">
            ${[0, 0.33, 0.66, 1].map((pct, i) => {
              const gx = originX + planW * pct;
              const label = String.fromCharCode(65 + i);
              return `
                <line x1="${gx}" y1="${originY - 45}" x2="${gx}" y2="${originY + planH + 20}" stroke="${colors.dimLine}" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>
                <circle cx="${gx}" cy="${originY - 55}" r="12" fill="${colors.bg}" stroke="${colors.dimLine}" stroke-width="1.5"/>
                <text x="${gx}" y="${originY - 51}" text-anchor="middle" font-weight="bold">${label}</text>
              `;
            }).join('')}

            <!-- Vertical Grid Axes: 1, 2, 3, 4 -->
            ${[0, 0.33, 0.66, 1].map((pct, i) => {
              const gy = originY + planH * pct;
              const label = i + 1;
              return `
                <line x1="${originX - 45}" y1="${gy}" x2="${originX + planW + 20}" y2="${gy}" stroke="${colors.dimLine}" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>
                <circle cx="${originX - 55}" cy="${gy}" r="12" fill="${colors.bg}" stroke="${colors.dimLine}" stroke-width="1.5"/>
                <text x="${originX - 55}" y="${gy + 4}" text-anchor="middle" font-weight="bold">${label}</text>
              `;
            }).join('')}

            <!-- Dimension Annotations -->
            <line x1="${originX}" y1="${originY - 20}" x2="${originX + planW}" y2="${originY - 20}" stroke="${colors.dimLine}" stroke-width="1.2"/>
            <path d="M ${originX} ${originY - 25} L ${originX} ${originY - 15} M ${originX + planW} ${originY - 25} L ${originX + planW} ${originY - 15}" stroke="${colors.dimLine}" stroke-width="1.5"/>
            <text x="${originX + planW / 2}" y="${originY - 24}" text-anchor="middle" font-weight="bold">${bW.toFixed(1)} m (OVERALL SPAN)</text>

            <line x1="${originX - 20}" y1="${originY}" x2="${originX - 20}" y2="${originY + planH}" stroke="${colors.dimLine}" stroke-width="1.2"/>
            <path d="M ${originX - 25} ${originY} L ${originX - 15} ${originY} M ${originX - 25} ${originY + planH} L ${originX - 15} ${originY + planH}" stroke="${colors.dimLine}" stroke-width="1.5"/>
            <text x="${originX - 24}" y="${originY + planH / 2}" text-anchor="middle" font-weight="bold" transform="rotate(-90 ${originX - 24} ${originY + planH / 2})">${bD.toFixed(1)} m (DEPTH)</text>
          </g>
        ` : ''}

        <!-- ======================================================== -->
        <!-- LAYER 1: THERMAL COMFORT HEATMAP ZONING                  -->
        <!-- ======================================================== -->
        ${this.layers.heatmap && !isRoof ? `
          <g class="cad-heatmap">
            <!-- Zone 1: West Wing (Executive & Mechanical) -->
            <rect x="${originX + 10}" y="${originY + 10}" width="${planW * 0.42}" height="${planH - 20}" rx="14" fill="${zoneHeatColor}" stroke="${zoneHeatStroke}" stroke-width="1.5" stroke-dasharray="6,4"/>
            <text x="${originX + 24}" y="${originY + 32}" font-family="'Space Grotesk', monospace" font-size="10" font-weight="bold" fill="${hasAnomaly ? '#F43F5E' : (isDark ? '#34D399' : '#047857')}">
              ${hasAnomaly ? '⚠️ THERMAL DEVIATION ZONE (+3.9°C)' : 'ZONE 1: OPTIMAL (22.1°C • 51% RH)'}
            </text>

            <!-- Zone 2: East Wing (Open Coworking & Boardroom) -->
            <rect x="${originX + planW * 0.44}" y="${originY + 10}" width="${planW * 0.54}" height="${planH - 20}" rx="14" fill="rgba(56, 189, 248, 0.08)" stroke="rgba(56, 189, 248, 0.3)" stroke-width="1.5" stroke-dasharray="6,4"/>
            <text x="${originX + planW * 0.46}" y="${originY + 32}" font-family="'Space Grotesk', monospace" font-size="10" font-weight="bold" fill="${isDark ? '#38BDF8' : '#0284C7'}">
              ZONE 2: PRIMARY WORKSPACE (22.4°C • 52% RH)
            </text>
          </g>
        ` : ''}

        <!-- ======================================================== -->
        <!-- LAYER 2: STRUCTURAL ENVELOPE WALLS & CURTAIN GLAZING     -->
        <!-- ======================================================== -->
        <!-- Outer Concrete Structural Slab -->
        <rect x="${originX}" y="${originY}" width="${planW}" height="${planH}" rx="18" fill="none" stroke="${colors.wallOuter}" stroke-width="4.5" />
        <rect x="${originX + 6}" y="${originY + 6}" width="${planW - 12}" height="${planH - 12}" rx="14" fill="none" stroke="${colors.wallInner}" stroke-width="1.5" stroke-dasharray="8,6" opacity="0.6"/>

        <!-- Curtain Wall Glazing Mullions along Perimeter -->
        ${[0.15, 0.30, 0.45, 0.60, 0.75, 0.90].map((pct) => `
          <line x1="${originX + planW * pct}" y1="${originY}" x2="${originX + planW * pct}" y2="${originY + 6}" stroke="${colors.wallOuter}" stroke-width="3"/>
          <line x1="${originX + planW * pct}" y1="${originY + planH - 6}" x2="${originX + planW * pct}" y2="${originY + planH}" stroke="${colors.wallOuter}" stroke-width="3"/>
        `).join('')}

        <!-- Entrance Canopy Projection (Ground Floor Only) -->
        ${isGround ? `
          <g class="cad-canopy">
            <rect x="${originX + planW * 0.38}" y="${originY + planH}" width="${planW * 0.24}" height="40" fill="rgba(15, 23, 42, 0.85)" stroke="${colors.wallOuter}" stroke-width="2" rx="4"/>
            <text x="${originX + planW * 0.5}" y="${originY + planH + 24}" font-family="'Space Grotesk', monospace" font-size="11" fill="#FFFFFF" font-weight="bold" text-anchor="middle">
              MAIN ATRIUM REVOLVING ENTRY
            </text>
          </g>
        ` : ''}

        <!-- ======================================================== -->
        <!-- LAYER 3: CENTRAL SERVICE CORE (LIFTS, RISERS, STAIRS)    -->
        <!-- ======================================================== -->
        ${!isRoof ? `
          <g id="cad-zone-core" class="cad-core cursor-pointer" onclick="floorplanView.inspectZone('Central Service Core')">
            <!-- Core Structural Concrete Envelope -->
            <rect x="${originX + planW * 0.38}" y="${originY + planH * 0.30}" width="${planW * 0.24}" height="${planH * 0.40}" rx="6" fill="${colors.core}" stroke="${colors.wallOuter}" stroke-width="2.5"/>
            <rect x="${originX + planW * 0.38}" y="${originY + planH * 0.30}" width="${planW * 0.24}" height="${planH * 0.40}" fill="url(#wall-hatch)" opacity="0.35"/>

            <!-- Lift Shaft 1 -->
            <rect x="${originX + planW * 0.40}" y="${originY + planH * 0.33}" width="${planW * 0.09}" height="${planH * 0.15}" fill="${colors.bg}" stroke="${colors.wallInner}" stroke-width="1.5"/>
            <line x1="${originX + planW * 0.40}" y1="${originY + planH * 0.33}" x2="${originX + planW * 0.49}" y2="${originY + planH * 0.48}" stroke="${colors.wallInner}" stroke-width="1"/>
            <line x1="${originX + planW * 0.49}" y1="${originY + planH * 0.33}" x2="${originX + planW * 0.40}" y2="${originY + planH * 0.48}" stroke="${colors.wallInner}" stroke-width="1"/>
            <text x="${originX + planW * 0.445}" y="${originY + planH * 0.42}" font-family="'Space Grotesk', monospace" font-size="9" fill="${colors.coreText}" font-weight="bold" text-anchor="middle">LIFT 01</text>

            <!-- Lift Shaft 2 -->
            <rect x="${originX + planW * 0.51}" y="${originY + planH * 0.33}" width="${planW * 0.09}" height="${planH * 0.15}" fill="${colors.bg}" stroke="${colors.wallInner}" stroke-width="1.5"/>
            <line x1="${originX + planW * 0.51}" y1="${originY + planH * 0.33}" x2="${originX + planW * 0.60}" y2="${originY + planH * 0.48}" stroke="${colors.wallInner}" stroke-width="1"/>
            <line x1="${originX + planW * 0.60}" y1="${originY + planH * 0.33}" x2="${originX + planW * 0.51}" y2="${originY + planH * 0.48}" stroke="${colors.wallInner}" stroke-width="1"/>
            <text x="${originX + planW * 0.555}" y="${originY + planH * 0.42}" font-family="'Space Grotesk', monospace" font-size="9" fill="${colors.coreText}" font-weight="bold" text-anchor="middle">LIFT 02</text>

            <!-- Emergency Fire Stairwell with steps -->
            <rect x="${originX + planW * 0.40}" y="${originY + planH * 0.51}" width="${planW * 0.10}" height="${planH * 0.16}" fill="${colors.bg}" stroke="${colors.wallInner}" stroke-width="1.5"/>
            ${[0.53, 0.56, 0.59, 0.62, 0.65].map((yPct) => `
              <line x1="${originX + planW * 0.40}" y1="${originY + planH * yPct}" x2="${originX + planW * 0.50}" y2="${originY + planH * yPct}" stroke="${colors.wallInner}" stroke-width="1"/>
            `).join('')}
            <text x="${originX + planW * 0.45}" y="${originY + planH * 0.60}" font-family="'Space Grotesk', monospace" font-size="8" fill="${colors.coreText}" font-weight="bold" text-anchor="middle">FIRE STAIR</text>

            <!-- MEP & Electrical Vertical Riser Shaft -->
            <rect x="${originX + planW * 0.52}" y="${originY + planH * 0.51}" width="${planW * 0.08}" height="${planH * 0.16}" fill="${isDark ? '#064E3B' : '#ECFDF5'}" stroke="#10B981" stroke-width="1.5"/>
            <text x="${originX + planW * 0.56}" y="${originY + planH * 0.58}" font-family="'Space Grotesk', monospace" font-size="8" fill="#10B981" font-weight="bold" text-anchor="middle">MEP RISER</text>
            <text x="${originX + planW * 0.56}" y="${originY + planH * 0.62}" font-family="'Space Grotesk', monospace" font-size="7" fill="${colors.coreText}" text-anchor="middle">CHW / ELEC</text>

            <!-- Core Label -->
            <text x="${originX + planW * 0.50}" y="${originY + planH * 0.32}" font-family="'Space Grotesk', monospace" font-size="9" font-weight="bold" fill="${colors.coreText}" text-anchor="middle">SERVICE CORE A-1</text>
          </g>
        ` : ''}

        <!-- ======================================================== -->
        <!-- LAYER 4: ROOF DECK CHILLER PLANT & SOLAR ARRAYS (ROOF)   -->
        <!-- ======================================================== -->
        ${isRoof ? `
          <g class="cad-roof-deck">
            <!-- Central Mechanical Penthouse -->
            <rect x="${originX + planW * 0.38}" y="${originY + planH * 0.32}" width="${planW * 0.24}" height="${planH * 0.36}" fill="${colors.core}" stroke="${colors.wallOuter}" stroke-width="2.5" rx="6"/>
            <text x="${originX + planW * 0.50}" y="${originY + planH * 0.51}" font-family="'Space Grotesk', monospace" font-size="12" font-weight="bold" fill="#F8FAFC" text-anchor="middle">MECHANICAL PENTHOUSE</text>
            <text x="${originX + planW * 0.50}" y="${originY + planH * 0.56}" font-family="'Space Grotesk', monospace" font-size="9" fill="#94A3B8" text-anchor="middle">ELEVATOR MACHINE ROOM & BMS</text>

            <!-- Rooftop Chiller #1 (West) -->
            <g class="cad-chiller cursor-pointer" onclick="floorplanView.inspectZone('Central Chiller Plant #1')">
              <rect x="${originX + planW * 0.12}" y="${originY + planH * 0.25}" width="${planW * 0.18}" height="${planH * 0.22}" rx="8" fill="${isDark ? '#064E3B' : '#ECFDF5'}" stroke="#10B981" stroke-width="2"/>
              <circle cx="${originX + planW * 0.17}" cy="${originY + planH * 0.36}" r="18" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="4,3"/>
              <circle cx="${originX + planW * 0.25}" cy="${originY + planH * 0.36}" r="18" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="4,3"/>
              <text x="${originX + planW * 0.21}" y="${originY + planH * 0.31}" font-family="'Space Grotesk', monospace" font-size="10" font-weight="bold" fill="#10B981" text-anchor="middle">CHILLER PLANT #01</text>
              <text x="${originX + planW * 0.21}" y="${originY + planH * 0.44}" font-family="'Space Grotesk', monospace" font-size="8" fill="${colors.coreText}" text-anchor="middle">500 RT Magnetic Bearing (COP 6.4)</text>
            </g>

            <!-- Rooftop Chiller #2 (East) -->
            <g class="cad-chiller cursor-pointer" onclick="floorplanView.inspectZone('Central Chiller Plant #2')">
              <rect x="${originX + planW * 0.70}" y="${originY + planH * 0.25}" width="${planW * 0.18}" height="${planH * 0.22}" rx="8" fill="${isDark ? '#064E3B' : '#ECFDF5'}" stroke="#10B981" stroke-width="2"/>
              <circle cx="${originX + planW * 0.75}" cy="${originY + planH * 0.36}" r="18" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="4,3"/>
              <circle cx="${originX + planW * 0.83}" cy="${originY + planH * 0.36}" r="18" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="4,3"/>
              <text x="${originX + planW * 0.79}" y="${originY + planH * 0.31}" font-family="'Space Grotesk', monospace" font-size="10" font-weight="bold" fill="#10B981" text-anchor="middle">CHILLER PLANT #02</text>
              <text x="${originX + planW * 0.79}" y="${originY + planH * 0.44}" font-family="'Space Grotesk', monospace" font-size="8" fill="${colors.coreText}" text-anchor="middle">500 RT Variable Speed Centrifugal</text>
            </g>

            <!-- Solar PV Racks (North & South Arrays) -->
            ${[0.10, 0.65].map((yPct, rowIdx) => `
              <g class="cad-solar-array">
                ${[0.08, 0.24, 0.40, 0.56, 0.72].map((xPct) => `
                  <rect x="${originX + planW * xPct}" y="${originY + planH * yPct}" width="${planW * 0.14}" height="${planH * 0.16}" rx="4" fill="${isDark ? '#082F49' : '#E0F2FE'}" stroke="#0284C7" stroke-width="1.5"/>
                  <line x1="${originX + planW * xPct}" y1="${originY + planH * (yPct + 0.08)}" x2="${originX + planW * (xPct + 0.14)}" y2="${originY + planH * (yPct + 0.08)}" stroke="#0284C7" stroke-width="1" stroke-dasharray="3,3"/>
                  <text x="${originX + planW * (xPct + 0.07)}" y="${originY + planH * (yPct + 0.09)}" font-family="'Space Grotesk', monospace" font-size="8" fill="#0284C7" font-weight="bold" text-anchor="middle">PV STRING ${rowIdx + 1}</text>
                `).join('')}
              </g>
            `).join('')}
          </g>
        ` : ''}

        <!-- ======================================================== -->
        <!-- LAYER 5: INTERIOR OFFICE PARTITIONS & FURNITURE          -->
        <!-- ======================================================== -->
        ${this.layers.furniture && !isRoof ? `
          <g class="cad-furniture">
            <!-- Glass Partition Walls (Executive Offices & Conference) -->
            <line x1="${originX + 18}" y1="${originY + planH * 0.30}" x2="${originX + planW * 0.34}" y2="${originY + planH * 0.30}" stroke="${colors.glass}" stroke-width="3"/>
            <line x1="${originX + planW * 0.64}" y1="${originY + planH * 0.30}" x2="${originX + planW - 18}" y2="${originY + planH * 0.30}" stroke="${colors.glass}" stroke-width="3"/>
            <line x1="${originX + planW * 0.64}" y1="${originY + planH * 0.70}" x2="${originX + planW - 18}" y2="${originY + planH * 0.70}" stroke="${colors.glass}" stroke-width="3"/>

            <!-- Boardroom Conference Suite (East Wing) -->
            <g class="cad-conference cursor-pointer" onclick="floorplanView.inspectZone('East Wing Executive Boardroom')">
              <rect x="${originX + planW * 0.68}" y="${originY + planH * 0.08}" width="${planW * 0.28}" height="${planH * 0.20}" rx="6" fill="${colors.furniture}" stroke="${colors.furnitureStroke}" stroke-width="1"/>
              <!-- Oval Boardroom Table -->
              <ellipse cx="${originX + planW * 0.82}" cy="${originY + planH * 0.18}" rx="65" ry="24" fill="${isDark ? '#1E293B' : '#FFFFFF'}" stroke="${colors.furnitureStroke}" stroke-width="1.5"/>
              <text x="${originX + planW * 0.82}" y="${originY + planH * 0.19}" font-family="'Space Grotesk', monospace" font-size="9" font-weight="bold" fill="${colors.coreText}" text-anchor="middle">BOARDROOM (16 PAX)</text>
            </g>

            <!-- 4-Pod Workstation Clusters (South Open Workspace) -->
            ${[0.10, 0.24, 0.68, 0.82].map((xPct) => `
              <g class="cad-workstation-pod cursor-pointer" onclick="floorplanView.inspectZone('Open Coworking Desking Pod')">
                <rect x="${originX + planW * xPct}" y="${originY + planH * 0.74}" width="${planW * 0.10}" height="${planH * 0.16}" rx="4" fill="${colors.furniture}" stroke="${colors.furnitureStroke}" stroke-width="1"/>
                <line x1="${originX + planW * (xPct + 0.05)}" y1="${originY + planH * 0.74}" x2="${originX + planW * (xPct + 0.05)}" y2="${originY + planH * 0.90}" stroke="${colors.glass}" stroke-width="2"/>
                <line x1="${originX + planW * xPct}" y1="${originY + planH * 0.82}" x2="${originX + planW * (xPct + 0.10)}" y2="${originY + planH * 0.82}" stroke="${colors.glass}" stroke-width="2"/>
                <!-- Monitors -->
                <rect x="${originX + planW * (xPct + 0.02)}" y="${originY + planH * 0.81}" width="16" height="3" fill="#38BDF8"/>
                <rect x="${originX + planW * (xPct + 0.06)}" y="${originY + planH * 0.81}" width="16" height="3" fill="#38BDF8"/>
              </g>
            `).join('')}
          </g>
        ` : ''}

        <!-- ======================================================== -->
        <!-- LAYER 6: HVAC MECHANICAL DUCTS, AHU & HYDRONIC LOOPS     -->
        <!-- ======================================================== -->
        ${this.layers.hvac && !isRoof ? `
          <g class="cad-hvac-system">
            
            <!-- A. AHU Mechanical Enclosure (West Core) -->
            <g id="cad-zone-ahu" class="cursor-pointer" onclick="floorplanView.inspectZone('AHU Mechanical Room')">
              <rect x="${originX + planW * 0.08}" y="${originY + planH * 0.35}" width="${planW * 0.18}" height="${planH * 0.30}" rx="6" fill="${colors.ahuFill}" stroke="${colors.ahuStroke}" stroke-width="2.5"/>
              
              <!-- Filter Grille Intake -->
              <rect x="${originX + planW * 0.08}" y="${originY + planH * 0.40}" width="6" height="${planH * 0.20}" fill="#0F172A"/>

              <!-- Centrifugal Supply Blower Fan Symbol -->
              <circle cx="${originX + planW * 0.17}" cy="${originY + planH * 0.50}" r="22" fill="none" stroke="${colors.ahuStroke}" stroke-width="2"/>
              <circle cx="${originX + planW * 0.17}" cy="${originY + planH * 0.50}" r="8" fill="${colors.ahuStroke}"/>
              <path d="M ${originX + planW * 0.17 - 16} ${originY + planH * 0.50 - 16} L ${originX + planW * 0.17 + 16} ${originY + planH * 0.50 + 16} M ${originX + planW * 0.17 - 16} ${originY + planH * 0.50 + 16} L ${originX + planW * 0.17 + 16} ${originY + planH * 0.50 - 16}" stroke="${colors.ahuStroke}" stroke-width="1.5"/>

              <!-- AHU Tag & Live Status -->
              <text x="${originX + planW * 0.17}" y="${originY + planH * 0.39}" font-family="'Space Grotesk', monospace" font-size="11" font-weight="extrabold" fill="${hasAnomaly ? '#F43F5E' : colors.ahuStroke}" text-anchor="middle">
                ${activeFloor.hvac?.ahuTag || 'AHU-CORE-01'}
              </text>
              <text x="${originX + planW * 0.17}" y="${originY + planH * 0.62}" font-family="'Space Grotesk', monospace" font-size="8.5" font-weight="bold" fill="${colors.coreText}" text-anchor="middle">
                ${activeFloor.hvac?.status || 'OPTIMAL RUNNING'}
              </text>
            </g>

            <!-- B. Hydronic Chilled Water Piping (CHWS & CHWR Loop from Riser) -->
            <!-- CHWS (Chilled Water Supply - 6.8°C Cyan Line) -->
            <path d="M ${originX + planW * 0.52} ${originY + planH * 0.55} L ${originX + planW * 0.26} ${originY + planH * 0.55}" fill="none" stroke="${colors.chws}" stroke-width="4.5" stroke-linecap="round"/>
            <!-- CHWR (Chilled Water Return - 12.4°C Violet Line) -->
            <path d="M ${originX + planW * 0.52} ${originY + planH * 0.58} L ${originX + planW * 0.26} ${originY + planH * 0.58}" fill="none" stroke="${colors.chwr}" stroke-width="4.5" stroke-linecap="round"/>

            <!-- 2-Way Modulating Control Valve & Actuator -->
            <g class="cad-valve cursor-pointer" onclick="floorplanView.inspectZone('Hydronic 2-Way Control Valve')">
              <polygon points="${originX + planW * 0.32},${originY + planH * 0.53} ${originX + planW * 0.36},${originY + planH * 0.57} ${originX + planW * 0.32},${originY + planH * 0.57} ${originX + planW * 0.36},${originY + planH * 0.53}" fill="#D97706" stroke="#B45309" stroke-width="1.5"/>
              <circle cx="${originX + planW * 0.34}" cy="${originY + planH * 0.55}" r="3.5" fill="#0F172A"/>
              <text x="${originX + planW * 0.34}" y="${originY + planH * 0.51}" font-family="'Space Grotesk', monospace" font-size="8" font-weight="bold" fill="#D97706" text-anchor="middle">
                MOD VALVE (${activeFloor.hvac?.chwValvePercent || 64}%)
              </text>
            </g>

            <!-- CHW Pipe Flow Labels -->
            <text x="${originX + planW * 0.44}" y="${originY + planH * 0.54}" font-family="'Space Grotesk', monospace" font-size="8" font-weight="bold" fill="${colors.chws}">
              CHWS 6.8°C →
            </text>
            <text x="${originX + planW * 0.44}" y="${originY + planH * 0.62}" font-family="'Space Grotesk', monospace" font-size="8" font-weight="bold" fill="${colors.chwr}">
              ← CHWR 12.4°C (ΔT 5.6°C)
            </text>

            <!-- C. Galvanized Air Supply Ductwork System -->
            <!-- Main Spine Trunk Duct -->
            <rect x="${originX + planW * 0.26}" y="${originY + planH * 0.47}" width="${planW * 0.52}" height="${planH * 0.06}" rx="3" fill="${colors.ductFill}" stroke="${colors.ductTrunk}" stroke-width="2.5"/>
            <rect x="${originX + planW * 0.26}" y="${originY + planH * 0.47}" width="${planW * 0.52}" height="${planH * 0.06}" fill="url(#duct-seams)"/>
            <text x="${originX + planW * 0.52}" y="${originY + planH * 0.51}" font-family="'Space Grotesk', monospace" font-size="9" font-weight="bold" fill="${colors.diffuser}" text-anchor="middle">
              SUPPLY AIR MAIN TRUNK [1200×450 mm • ${activeFloor.hvac?.airflowCfm || 3800} CFM]
            </text>

            <!-- Branch Duct 1 (North Conference Branch) -->
            <rect x="${originX + planW * 0.72}" y="${originY + planH * 0.28}" width="${planW * 0.05}" height="${planH * 0.19}" fill="${colors.ductFill}" stroke="${colors.ductTrunk}" stroke-width="2"/>
            
            <!-- Branch Duct 2 (South Workstations Branch) -->
            <rect x="${originX + planW * 0.42}" y="${originY + planH * 0.53}" width="${planW * 0.05}" height="${planH * 0.22}" fill="${colors.ductFill}" stroke="${colors.ductTrunk}" stroke-width="2"/>
            
            <!-- Branch Duct 3 (East Workstations Branch) -->
            <rect x="${originX + planW * 0.72}" y="${originY + planH * 0.53}" width="${planW * 0.05}" height="${planH * 0.22}" fill="${colors.ductFill}" stroke="${colors.ductTrunk}" stroke-width="2"/>

            <!-- VAV Terminal Boxes on Branches -->
            ${[
              { x: originX + planW * 0.72, y: originY + planH * 0.34, label: 'VAV-01' },
              { x: originX + planW * 0.42, y: originY + planH * 0.60, label: 'VAV-02' },
              { x: originX + planW * 0.72, y: originY + planH * 0.60, label: 'VAV-03' },
            ].map((vav) => `
              <rect x="${vav.x - 4}" y="${vav.y}" width="${planW * 0.05 + 8}" height="14" rx="2" fill="${colors.wallOuter}" stroke="${colors.wallInner}" stroke-width="1.5"/>
              <text x="${vav.x + (planW * 0.05) / 2}" y="${vav.y + 10}" font-family="'Space Grotesk', monospace" font-size="7.5" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${vav.label}</text>
            `).join('')}

            <!-- D. 4-Way Swirl Ceiling Air Diffusers (Vents) with Cool Air Delivery -->
            ${[
              { x: originX + planW * 0.745, y: originY + planH * 0.25, name: 'North Diffuser' },
              { x: originX + planW * 0.445, y: originY + planH * 0.75, name: 'Southwest Diffuser' },
              { x: originX + planW * 0.745, y: originY + planH * 0.75, name: 'Southeast Diffuser' },
              { x: originX + planW * 0.260, y: originY + planH * 0.25, name: 'West Executive Diffuser' }
            ].map((d) => `
              <g class="cad-diffuser cursor-pointer" onclick="floorplanView.inspectZone('${d.name}')">
                <!-- Cool Air Delivery Vector Ripples -->
                <circle cx="${d.x}" cy="${d.y}" r="26" fill="${colors.diffuserAir}" opacity="0.4">
                  <animate attributeName="r" values="18;30;18" dur="3s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.6;0.1;0.6" dur="3s" repeatCount="indefinite"/>
                </circle>
                <!-- Diffuser Face Bezel -->
                <rect x="${d.x - 12}" y="${d.y - 12}" width="24" height="24" rx="3" fill="${isDark ? '#1E293B' : '#FFFFFF'}" stroke="${colors.wallOuter}" stroke-width="2"/>
                <!-- 4-Way Cross Blades -->
                <line x1="${d.x - 10}" y1="${d.y - 10}" x2="${d.x + 10}" y2="${d.y + 10}" stroke="${colors.wallOuter}" stroke-width="1.5"/>
                <line x1="${d.x - 10}" y1="${d.y + 10}" x2="${d.x + 10}" y2="${d.y - 10}" stroke="${colors.wallOuter}" stroke-width="1.5"/>
                <circle cx="${d.x}" cy="${d.y}" r="3" fill="#38BDF8"/>
              </g>
            `).join('')}
          </g>
        ` : ''}

        <!-- ======================================================== -->
        <!-- LAYER 7: TELEMETRY SENSOR BEACONS & LIVE PULSES          -->
        <!-- ======================================================== -->
        ${this.layers.sensors ? `
          <g class="cad-sensors">
            <!-- Sensor 1: Space Temperature & Setpoint Node -->
            <g class="cursor-pointer" onclick="floorplanView.inspectZone('Smart Space Thermostat')">
              <circle cx="${originX + planW * 0.38 + 12}" cy="${originY + planH * 0.30 - 12}" r="14" fill="${hasAnomaly ? 'rgba(244, 63, 94, 0.25)' : 'rgba(16, 185, 129, 0.25)'}">
                <animate attributeName="r" values="12;20;12" dur="2s" repeatCount="indefinite"/>
              </circle>
              <circle cx="${originX + planW * 0.38 + 12}" cy="${originY + planH * 0.30 - 12}" r="8" fill="${hasAnomaly ? '#F43F5E' : '#10B981'}" stroke="#FFFFFF" stroke-width="2"/>
              <text x="${originX + planW * 0.38 + 26}" y="${originY + planH * 0.30 - 8}" font-family="'Space Grotesk', monospace" font-size="10" font-weight="extrabold" fill="${hasAnomaly ? '#F43F5E' : colors.titleText}">
                ${activeFloor.hvac?.spaceTempC || 22.1}°C
              </text>
            </g>

            <!-- Sensor 2: Supply Airflow CFM Telemetry -->
            <g class="cursor-pointer" onclick="floorplanView.inspectZone('Supply Air VAV Feeder')">
              <circle cx="${originX + planW * 0.745}" cy="${originY + planH * 0.50}" r="8" fill="#0284C7" stroke="#FFFFFF" stroke-width="2"/>
              <text x="${originX + planW * 0.745 + 14}" y="${originY + planH * 0.50 + 4}" font-family="'Space Grotesk', monospace" font-size="10" font-weight="extrabold" fill="#0284C7">
                ${activeFloor.hvac?.airflowCfm || 3800} CFM
              </text>
            </g>

            <!-- Sensor 3: Power Feeder Node -->
            <g class="cursor-pointer" onclick="floorplanView.inspectZone('Floor Power Feeder')">
              <circle cx="${originX + planW - 35}" cy="${originY + 35}" r="8" fill="#FF7A00" stroke="#FFFFFF" stroke-width="2"/>
              <text x="${originX + planW - 35}" y="${originY + 54}" font-family="'Space Grotesk', monospace" font-size="10" font-weight="extrabold" fill="#FF7A00" text-anchor="middle">
                ${activeFloor.demandKw || bData.demandKw} kW
              </text>
            </g>
          </g>
        ` : ''}

        <!-- ======================================================== -->
        <!-- LAYER 8: ARCHITECTURAL CAD TITLE BLOCK (BOTTOM-RIGHT)    -->
        <!-- ======================================================== -->
        <g class="cad-title-block" transform="translate(${vbW - 340}, ${vbH - 120})">
          <rect width="320" height="105" rx="12" fill="${colors.titleBg}" stroke="${colors.titleBorder}" stroke-width="1.5" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.15))"/>
          
          <path d="M 0 35 L 320 35" stroke="${colors.titleBorder}" stroke-width="1"/>
          <path d="M 0 70 L 320 70" stroke="${colors.titleBorder}" stroke-width="1"/>
          <path d="M 160 35 L 160 105" stroke="${colors.titleBorder}" stroke-width="1"/>

          <!-- Row 1: Drawing Title -->
          <text x="14" y="20" font-family="'Inter', sans-serif" font-size="8.5" font-weight="bold" fill="${colors.dimText}" letter-spacing="0.5">PROJECT & ASSET IDENTITY</text>
          <text x="14" y="32" font-family="'Space Grotesk', monospace" font-size="11" font-weight="extrabold" fill="${colors.titleText}">${bData.name}</text>

          <!-- Row 2 Left: Floor & Drawing -->
          <text x="14" y="48" font-family="'Inter', sans-serif" font-size="7.5" font-weight="bold" fill="${colors.dimText}">FLOOR PLATE</text>
          <text x="14" y="62" font-family="'Space Grotesk', monospace" font-size="10" font-weight="bold" fill="${isDark ? '#38BDF8' : '#0284C7'}">${activeFloor.name.split(':')[0].toUpperCase()}</text>

          <!-- Row 2 Right: Scale -->
          <text x="174" y="48" font-family="'Inter', sans-serif" font-size="7.5" font-weight="bold" fill="${colors.dimText}">CAD SCALE</text>
          <text x="174" y="62" font-family="'Space Grotesk', monospace" font-size="10" font-weight="bold" fill="${colors.titleText}">1:100 (METRIC mm)</text>

          <!-- Row 3 Left: Discipline -->
          <text x="14" y="83" font-family="'Inter', sans-serif" font-size="7.5" font-weight="bold" fill="${colors.dimText}">DISCIPLINE</text>
          <text x="14" y="96" font-family="'Space Grotesk', monospace" font-size="9" font-weight="bold" fill="${colors.titleText}">HVAC BIM & SCADA</text>

          <!-- Row 3 Right: SCADA Status -->
          <text x="174" y="83" font-family="'Inter', sans-serif" font-size="7.5" font-weight="bold" fill="${colors.dimText}">TELEMETRY STATUS</text>
          <text x="174" y="96" font-family="'Space Grotesk', monospace" font-size="9" font-weight="bold" fill="#10B981">● LIVE VERIFIED (12ms)</text>
        </g>

        <!-- North Arrow Compass -->
        <g class="cad-north-arrow" transform="translate(${originX + planW + 40}, ${originY + 20})">
          <circle cx="0" cy="0" r="18" fill="${colors.titleBg}" stroke="${colors.titleBorder}" stroke-width="1.5"/>
          <polygon points="0,-14 6,12 0,6 -6,12" fill="${colors.wallOuter}"/>
          <text x="0" y="-18" font-family="'Space Grotesk', monospace" font-size="10" font-weight="extrabold" fill="${colors.titleText}" text-anchor="middle">N</text>
        </g>
      </svg>
    `;

    // Render CAD Control Toolbar and Canvas Frame
    this.container.innerHTML = `
      <div class="relative w-full h-full flex flex-col ${isDark ? 'bg-[#0B111E]' : 'bg-[#FAF8F5]'} overflow-hidden select-none">
        
        <!-- Top CAD Toolbar: Layer Toggles, Mode, Zoom -->
        <div class="z-20 px-4 py-2.5 flex items-center justify-between border-b ${isDark ? 'border-slate-800 bg-slate-950/80' : 'border-[#EBE7DF] bg-white/90'} backdrop-blur-md text-xs">
          
          <!-- Left: Floor & Building Identity Badges -->
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${bData.accentColor}"></span>
            <span class="font-mono font-bold ${isDark ? 'text-white' : 'text-[#1E2022]'}">
              ${bData.shortName} › ${activeFloor.id.toUpperCase()} CAD Blueprint
            </span>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold ${isDark ? 'bg-sky-950 text-sky-400 border border-sky-800' : 'bg-sky-50 text-sky-800 border border-sky-200'}">
              ${bData.dimensions.width}m × ${bData.dimensions.depth}m
            </span>
          </div>

          <!-- Center: Layer Toggles -->
          <div class="hidden lg:flex items-center gap-1.5">
            <button onclick="floorplanView.toggleLayer('hvac')" class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${this.layers.hvac ? (isDark ? 'bg-emerald-950 text-emerald-400 border border-emerald-700' : 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold') : 'opacity-50 hover:opacity-100'}">
              HVAC & Ducts
            </button>
            <button onclick="floorplanView.toggleLayer('heatmap')" class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${this.layers.heatmap ? (isDark ? 'bg-emerald-950 text-emerald-400 border border-emerald-700' : 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold') : 'opacity-50 hover:opacity-100'}">
              Thermal Heatmap
            </button>
            <button onclick="floorplanView.toggleLayer('furniture')" class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${this.layers.furniture ? (isDark ? 'bg-sky-950 text-sky-400 border border-sky-700' : 'bg-sky-50 text-sky-800 border border-sky-200 font-bold') : 'opacity-50 hover:opacity-100'}">
              Interior Layout
            </button>
            <button onclick="floorplanView.toggleLayer('sensors')" class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${this.layers.sensors ? (isDark ? 'bg-amber-950 text-amber-400 border border-amber-700' : 'bg-amber-50 text-amber-800 border border-amber-200 font-bold') : 'opacity-50 hover:opacity-100'}">
              Telemetry Beacons
            </button>
          </div>

          <!-- Right: CAD Mode & Zoom Controls -->
          <div class="flex items-center gap-1.5">
            <!-- Theme Toggle: Dark Blueprint vs Architectural Light -->
            <button onclick="floorplanView.setTheme('${isDark ? 'architectural' : 'blueprint'}')" class="p-1.5 rounded-lg border ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-[#EBE7DF] text-[#1E2022] hover:bg-[#F4F0E8]'} transition-colors" title="${isDark ? 'Switch to Architectural Light Paper' : 'Switch to Dark Blueprint'}">
              <span class="material-symbols-outlined text-[17px]">${isDark ? 'light_mode' : 'dark_mode'}</span>
            </button>

            <!-- Zoom In -->
            <button onclick="floorplanView.zoomIn()" class="p-1.5 rounded-lg border ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-[#EBE7DF] text-[#1E2022] hover:bg-[#F4F0E8]'} transition-colors" title="Zoom In">
              <span class="material-symbols-outlined text-[17px]">zoom_in</span>
            </button>

            <!-- Zoom Out -->
            <button onclick="floorplanView.zoomOut()" class="p-1.5 rounded-lg border ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-[#EBE7DF] text-[#1E2022] hover:bg-[#F4F0E8]'} transition-colors" title="Zoom Out">
              <span class="material-symbols-outlined text-[17px]">zoom_out</span>
            </button>

            <!-- Reset Fit -->
            <button onclick="floorplanView.resetPanZoom()" class="p-1.5 rounded-lg border ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-[#EBE7DF] text-[#1E2022] hover:bg-[#F4F0E8]'} transition-colors" title="Fit to Screen">
              <span class="material-symbols-outlined text-[17px]">fit_screen</span>
            </button>
          </div>
        </div>

        <!-- Main Interactive SVG Viewport -->
        <div id="cad-viewport-wrapper" class="relative flex-1 w-full h-full overflow-hidden cursor-grab active:cursor-grabbing">
          ${svgContent}
        </div>

        <!-- Bottom CAD Telemetry Legend -->
        <div class="absolute bottom-3 left-4 z-20 hidden sm:flex items-center gap-3 px-3.5 py-1.5 rounded-xl ${isDark ? 'bg-slate-900/90 text-slate-300 border-slate-700' : 'bg-white/95 text-[#1E2022] border-[#EBE7DF]'} border shadow-lg text-[10px] font-mono backdrop-blur-md">
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-[#0284C7]"></span>
            <span>CHWS 6.8°C</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-[#7C3AED]"></span>
            <span>CHWR 12.4°C</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2 rounded bg-slate-500"></span>
            <span>Supply Air Trunk</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span>AHU Swirl Diffuser</span>
          </div>
        </div>

      </div>
    `;
  }

  _attachEvents() {
    const wrapper = document.getElementById('cad-viewport-wrapper');
    if (!wrapper) return;

    wrapper.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStart.x;
      this.panY = e.clientY - this.dragStart.y;
      const svg = document.getElementById('cad-floorplan-svg');
      if (svg) {
        svg.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      this.scale = Math.min(Math.max(this.scale + delta, 0.5), 2.5);
      const svg = document.getElementById('cad-floorplan-svg');
      if (svg) {
        svg.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
      }
    });
  }

  inspectZone(zoneName) {
    this.selectedZoneId = zoneName;
    if (window.twinApp && window.twinApp.showToast) {
      window.twinApp.showToast(`CAD Inspection: ${zoneName}`);
    }
    if (window.dynamicIsland && window.dynamicIsland.addLog) {
      window.dynamicIsland.addLog(`CAD Node Inspected: ${zoneName} synchronized with SCADA`, 'normal');
    }
    this.onInspectZone(zoneName);
  }
}

window.Floorplan2DView = Floorplan2DView;
