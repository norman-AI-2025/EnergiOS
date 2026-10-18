/**
 * EnergiOS - Township 3D Microgrid Digital Twin Scene
 * Photorealistic Modern Architectural Three.js Controller with:
 * - High-end Architectural Materials (Titanium, Terrazzo, Smoked Tinted Glass, Aluminum Mullions)
 * - Non-cartoon realistic urban landscape (Granite Curbs, Asphalt Markings, Natural Turf, Modern Pavilions)
 * - 100% Clickable & Expandable Levels across all 4 buildings (Bull Tower, Fox Hub, Bear Centre, Hog Arena)
 * - 3-Stage Cinematic Smooth Camera Navigation (Township Overview -> Exploded Stack -> Floor Inspection)
 * - Real-time 3D Anomaly Pin Projection for 2D leader-line callout on Fox Hub Level 2
 * - Day / Twilight Night Mode Architectural Lighting
 */

class Township3DScene {
  constructor(options = {}) {
    this.container = options.container;
    this.onSelectBuilding = options.onSelectBuilding || (() => {});
    this.onSelectFloor = options.onSelectFloor || (() => {});
    this.onUpdateAlertPins = options.onUpdateAlertPins || null;
    this.data = window.BUILDINGS_DATA || {};

    // State
    this.selectedBuildingId = null;
    this.selectedFloorId = null;
    this.showEnergyFlow = true;
    this.isNightMode = false;
    this.wireframeMode = false;

    // Three.js Core Objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.animFrameId = null;

    // Dynamic & Interactive Elements
    this.buildingGroups = {};
    this.interactiveMeshes = [];
    this.flowCurves = [];
    this.pulseMarkers = [];
    this.airflowStreams = [];
    this.alertFlags = [];
    this.windowMeshes = [];
    this.waterSurfaces = [];
    this.streetLights = [];
    this.vehicleLights = [];
    this.bessLedBars = [];
    this.beaconLights = [];

    // Lighting References
    this.dirLight = null;
    this.hemiLight = null;
    this.rimLight = null;

    // Texture Cache
    this.textures = {};

    // Camera Targets
    this.cameraTargetPos = new THREE.Vector3(0, 240, 310);
    this.cameraLookTarget = new THREE.Vector3(0, 0, 0);

    // Bindings
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onClick = this._onClick.bind(this);
    this._handleResize = this._handleResize.bind(this);
    this._animate = this._animate.bind(this);

    if (this.container) {
      this.init();
    }
  }

  // ==========================================
  // 1. PROCEDURAL ARCHITECTURAL TEXTURES
  // ==========================================

  _getAsphaltTexture() {
    if (this.textures.asphalt) return this.textures.asphalt;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Deep architectural asphalt slate
    ctx.fillStyle = '#1c222a';
    ctx.fillRect(0, 0, 512, 512);

    // Fine mineral speckles
    const imgData = ctx.getImageData(0, 0, 512, 512);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const noise = (Math.random() - 0.5) * 22;
      d[i] = Math.min(255, Math.max(0, d[i] + noise));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + noise));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 32);
    this.textures.asphalt = tex;
    return tex;
  }

  _getRoadMarkingsTexture() {
    if (this.textures.roadMarkings) return this.textures.roadMarkings;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1a1f26';
    ctx.fillRect(0, 0, 512, 1024);

    // Outer white shoulder lines
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(32, 0); ctx.lineTo(32, 1024);
    ctx.moveTo(480, 0); ctx.lineTo(480, 1024);
    ctx.stroke();

    // Center double yellow lines
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(250, 0); ctx.lineTo(250, 1024);
    ctx.moveTo(262, 0); ctx.lineTo(262, 1024);
    ctx.stroke();

    // Dashed white lane dividers
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 8;
    ctx.setLineDash([60, 48]);
    ctx.beginPath();
    ctx.moveTo(140, 0); ctx.lineTo(140, 1024);
    ctx.moveTo(372, 0); ctx.lineTo(372, 1024);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pedestrian Zebra Crosswalks
    ctx.fillStyle = '#ffffff';
    for (let y = 140; y <= 260; y += 28) {
      ctx.fillRect(45, y, 422, 16);
    }
    for (let y = 760; y <= 880; y += 28) {
      ctx.fillRect(45, y, 422, 16);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    this.textures.roadMarkings = tex;
    return tex;
  }

  _getPaversTexture() {
    if (this.textures.pavers) return this.textures.pavers;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, 512, 512);

    const tileSize = 64;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;

    for (let x = 0; x < 512; x += tileSize) {
      for (let y = 0; y < 512; y += tileSize) {
        const grad = ctx.createLinearGradient(x, y, x + tileSize, y + tileSize);
        grad.addColorStop(0, '#f8fafc');
        grad.addColorStop(1, '#e2e8f0');
        ctx.fillStyle = grad;
        ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
        ctx.strokeRect(x, y, tileSize, tileSize);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    this.textures.pavers = tex;
    return tex;
  }

  _getCurtainWallTexture(isWarmLight = false) {
    const key = `curtain_${isWarmLight ? 'night' : 'day'}`;
    if (this.textures[key]) return this.textures[key];

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    if (isWarmLight) {
      // Warm office interior glow
      const grad = ctx.createRadialGradient(256, 256, 40, 256, 256, 320);
      grad.addColorStop(0, '#fef08a');
      grad.addColorStop(0.5, '#f59e0b');
      grad.addColorStop(1, '#78350f');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);
    } else {
      // Sleek smoked architectural glass reflection
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#cbd5e1');
      grad.addColorStop(0.4, '#e2e8f0');
      grad.addColorStop(1, '#94a3b8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);
    }

    // Modern dark aluminum mullions (window frames)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 14;

    const cols = 4;
    const rows = 4;
    const w = 512 / cols;
    const h = 512 / rows;

    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * w, 0); ctx.lineTo(c * w, 512);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * h); ctx.lineTo(512, r * h);
      ctx.stroke();
    }

    // Mullion metallic bevel highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    for (let c = 0; c < cols; c++) {
      ctx.strokeRect(c * w + 7, 7, w - 14, 498);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 2);
    this.textures[key] = tex;
    return tex;
  }

  _getSolarCellTexture() {
    if (this.textures.solar) return this.textures.solar;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0b1626';
    ctx.fillRect(0, 0, 512, 512);

    const cellW = 512 / 4;
    const cellH = 512 / 4;

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const cx = i * cellW;
        const cy = j * cellH;

        const grad = ctx.createLinearGradient(cx, cy, cx + cellW, cy + cellH);
        grad.addColorStop(0, '#0f2744');
        grad.addColorStop(1, '#071322');
        ctx.fillStyle = grad;
        ctx.fillRect(cx + 3, cy + 3, cellW - 6, cellH - 6);

        // Fine silver busbars
        ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
        ctx.lineWidth = 1;
        for (let y = cy + 12; y < cy + cellH - 6; y += 10) {
          ctx.beginPath();
          ctx.moveTo(cx + 4, y); ctx.lineTo(cx + cellW - 4, y);
          ctx.stroke();
        }

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx + cellW * 0.25, cy + 3); ctx.lineTo(cx + cellW * 0.25, cy + cellH - 3);
        ctx.moveTo(cx + cellW * 0.50, cy + 3); ctx.lineTo(cx + cellW * 0.50, cy + cellH - 3);
        ctx.moveTo(cx + cellW * 0.75, cy + 3); ctx.lineTo(cx + cellW * 0.75, cy + cellH - 3);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, 512, 512);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    this.textures.solar = tex;
    return tex;
  }

  _getNaturalGrassTexture() {
    if (this.textures.grass) return this.textures.grass;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Natural landscape turf (muted, non-cartoon)
    ctx.fillStyle = '#2c4731';
    ctx.fillRect(0, 0, 512, 512);

    for (let x = 0; x < 512; x += 64) {
      ctx.fillStyle = (x / 64) % 2 === 0 ? 'rgba(52, 88, 59, 0.18)' : 'rgba(32, 56, 37, 0.18)';
      ctx.fillRect(x, 0, 64, 512);
    }

    const imgData = ctx.getImageData(0, 0, 512, 512);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() - 0.5) * 24;
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + v));
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    this.textures.grass = tex;
    return tex;
  }

  _getContactShadowTexture() {
    if (this.textures.shadow) return this.textures.shadow;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 124);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.70)');
    grad.addColorStop(0.4, 'rgba(15, 23, 42, 0.35)');
    grad.addColorStop(0.8, 'rgba(15, 23, 42, 0.10)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const tex = new THREE.CanvasTexture(canvas);
    this.textures.shadow = tex;
    return tex;
  }

  // ==========================================
  // 2. SCENE INITIALIZATION & LIGHTING
  // ==========================================

  init() {
    if (!this.container) return;
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 560;

    // 1. Scene
    this.scene = new THREE.Scene();
    const daylightSky = 0xe4ebf2;
    this.scene.background = new THREE.Color(daylightSky);
    this.scene.fog = new THREE.FogExp2(daylightSky, 0.0013);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 2, 2200);
    this.camera.position.set(0, 250, 320);

    // 3. Renderer with ACESFilmic tone mapping & soft PCF shadows
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.30;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // 4. OrbitControls
    const ControlsClass = THREE.OrbitControls || window.OrbitControls;
    if (ControlsClass) {
      this.controls = new ControlsClass(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.maxPolarAngle = Math.PI / 2.04;
      this.controls.minDistance = 25;
      this.controls.maxDistance = 680;
    }

    // 5. Realistic Architectural Lighting Setup
    this.hemiLight = new THREE.HemisphereLight(0xe2e8f0, 0x64748b, 1.10);
    this.hemiLight.position.set(0, 300, 0);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffbf2, 2.0);
    this.dirLight.position.set(220, 320, 180);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 15;
    this.dirLight.shadow.camera.far = 900;
    const d = 340;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0002;
    this.dirLight.shadow.radius = 2.0;
    this.scene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight(0xcfd8dc, 0.65);
    this.rimLight.position.set(-180, 200, -140);
    this.scene.add(this.rimLight);

    // 6. Build High-Fidelity 3D Virtual Township
    this._buildTerrain();
    this._buildBuildings();
    this._buildSolarFarm();
    this._buildBessSubstation();
    this._buildEcoVillas();
    this._buildEnergyConduits();

    // 7. Raycasting & Events
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    window.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('click', this._onClick);
    window.addEventListener('resize', this._handleResize);

    // Start 60fps render loop
    this._animate();
  }

  // ==========================================
  // 3. TERRAIN, ROADS, WATER & LANDSCAPE
  // ==========================================

  _addContactShadow(x, z, radiusX, radiusZ) {
    const shadowGeo = new THREE.PlaneGeometry(radiusX * 2, radiusZ * 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this._getContactShadowTexture(),
      transparent: true,
      opacity: 0.60,
      depthWrite: false
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(x, 0.16, z);
    this.scene.add(shadowMesh);
  }

  _buildTerrain() {
    const groundGeo = new THREE.PlaneGeometry(800, 800);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xedf2f7,
      roughness: 0.88,
      metalness: 0.04
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(700, 35, 0x006948, 0xd0dbe5);
    grid.position.y = 0.18;
    this.scene.add(grid);

    // Realistic Grand Boulevards with Asphalt & Markings
    const createAvenue = (w, len, x, z, rotY = 0) => {
      const roadGroup = new THREE.Group();
      roadGroup.position.set(x, 0.28, z);
      roadGroup.rotation.y = rotY;

      const roadGeo = new THREE.PlaneGeometry(w, len);
      const roadMat = new THREE.MeshStandardMaterial({
        map: this._getAsphaltTexture(),
        roughness: 0.82,
        metalness: 0.12
      });
      const road = new THREE.Mesh(roadGeo, roadMat);
      road.rotation.x = -Math.PI / 2;
      road.receiveShadow = true;
      roadGroup.add(road);

      const markGeo = new THREE.PlaneGeometry(w * 0.96, len);
      const markMat = new THREE.MeshStandardMaterial({
        map: this._getRoadMarkingsTexture(),
        transparent: true,
        roughness: 0.5,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });
      const markMesh = new THREE.Mesh(markGeo, markMat);
      markMesh.rotation.x = -Math.PI / 2;
      markMesh.position.y = 0.04;
      roadGroup.add(markMesh);

      const curbGeo = new THREE.BoxGeometry(0.8, 0.45, len);
      const curbMat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.7 });

      const curbL = new THREE.Mesh(curbGeo, curbMat);
      curbL.position.set(-w / 2 - 0.4, 0.22, 0);
      curbL.receiveShadow = true;
      roadGroup.add(curbL);

      const curbR = new THREE.Mesh(curbGeo, curbMat);
      curbR.position.set(w / 2 + 0.4, 0.22, 0);
      curbR.receiveShadow = true;
      roadGroup.add(curbR);

      const walkW = 8.0;
      const walkGeo = new THREE.PlaneGeometry(walkW, len);
      const walkMat = new THREE.MeshStandardMaterial({
        map: this._getPaversTexture(),
        roughness: 0.75,
        metalness: 0.05
      });

      const walkL = new THREE.Mesh(walkGeo, walkMat);
      walkL.rotation.x = -Math.PI / 2;
      walkL.position.set(-w / 2 - 0.8 - walkW / 2, 0.24, 0);
      walkL.receiveShadow = true;
      roadGroup.add(walkL);

      const walkR = new THREE.Mesh(walkGeo, walkMat);
      walkR.rotation.x = -Math.PI / 2;
      walkR.position.set(w / 2 + 0.8 + walkW / 2, 0.24, 0);
      walkR.receiveShadow = true;
      roadGroup.add(walkR);

      this.scene.add(roadGroup);
    };

    createAvenue(26, 620, 0, 10, 0);
    createAvenue(26, 620, 10, 0, Math.PI / 2);

    // Natural Landscape Lawns
    const createLawn = (w, d, x, z) => {
      const lawnGeo = new THREE.BoxGeometry(w, 0.75, d);
      const lawnMat = new THREE.MeshStandardMaterial({
        map: this._getNaturalGrassTexture(),
        roughness: 0.9,
        metalness: 0.02
      });
      const lawn = new THREE.Mesh(lawnGeo, lawnMat);
      lawn.position.set(x, 0.38, z);
      lawn.receiveShadow = true;
      this.scene.add(lawn);

      const borderGeo = new THREE.BoxGeometry(w + 1.2, 0.5, d + 1.2);
      const borderMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });
      const border = new THREE.Mesh(borderGeo, borderMat);
      border.position.set(x, 0.25, z);
      this.scene.add(border);
    };

    createLawn(92, 72, -80, -40);
    createLawn(88, 82, 75, -50);
    createLawn(82, 72, -65, 75);
    createLawn(98, 88, 75, 70);

    // Eco Lake with Timber Boardwalk
    const lakeGroup = new THREE.Group();
    lakeGroup.position.set(-10, 0, -135);
    this.scene.add(lakeGroup);

    const basinGeo = new THREE.CylinderGeometry(46, 48, 2.0, 48);
    const basinMat = new THREE.MeshStandardMaterial({ color: 0x0f2438, roughness: 0.9 });
    const basin = new THREE.Mesh(basinGeo, basinMat);
    basin.position.y = 0.5;
    lakeGroup.add(basin);

    const boulderMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 });
    for (let a = 0; a < Math.PI * 2; a += 0.35) {
      const r = 46.5 + (Math.sin(a * 4) * 1.5);
      const bx = Math.cos(a) * r;
      const bz = Math.sin(a) * r;
      const bSize = 1.6 + Math.random() * 1.2;
      const bMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(bSize, 1), boulderMat);
      bMesh.position.set(bx, 0.9, bz);
      bMesh.scale.set(1.2, 0.7, 1.0);
      bMesh.castShadow = true;
      lakeGroup.add(bMesh);
    }

    const waterGeo = new THREE.CylinderGeometry(44.8, 44.8, 1.6, 48);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0369a1,
      roughness: 0.08,
      metalness: 0.92,
      transparent: true,
      opacity: 0.88
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0.95;
    lakeGroup.add(water);
    this.waterSurfaces.push(water);

    const pierGeo = new THREE.BoxGeometry(10, 0.45, 28);
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x452311, roughness: 0.75 });
    const pier = new THREE.Mesh(pierGeo, pierMat);
    pier.position.set(0, 1.4, 34);
    pier.castShadow = true;
    pier.receiveShadow = true;
    lakeGroup.add(pier);

    // Architectural Trees
    const createArchitecturalTree = (tx, tz, scale = 1.0, type = 'deciduous') => {
      const treeGroup = new THREE.Group();
      treeGroup.position.set(tx, 0, tz);
      treeGroup.scale.setScalar(scale);

      this._addContactShadow(tx, tz, 4.5 * scale, 4.5 * scale);

      const trunkGeo = new THREE.CylinderGeometry(0.45, 0.85, 4.8, 8);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9 });
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 2.4;
      trunk.castShadow = true;
      treeGroup.add(trunk);

      if (type === 'cypress') {
        const cGeo = new THREE.ConeGeometry(2.2, 14, 10);
        const cMat = new THREE.MeshStandardMaterial({ color: 0x143e26, roughness: 0.8 });
        const cMesh = new THREE.Mesh(cGeo, cMat);
        cMesh.position.y = 8.5;
        cMesh.castShadow = true;
        treeGroup.add(cMesh);
      } else {
        const canopyMat1 = new THREE.MeshStandardMaterial({ color: 0x22422b, roughness: 0.82 });
        const canopyMat2 = new THREE.MeshStandardMaterial({ color: 0x2d5237, roughness: 0.82 });
        const canopyMat3 = new THREE.MeshStandardMaterial({ color: 0x3b6644, roughness: 0.82 });

        const s1 = new THREE.Mesh(new THREE.DodecahedronGeometry(3.6, 1), canopyMat1);
        s1.position.set(0, 6.2, 0);
        s1.castShadow = true;
        treeGroup.add(s1);

        const s2 = new THREE.Mesh(new THREE.DodecahedronGeometry(2.8, 1), canopyMat2);
        s2.position.set(1.4, 8.0, 0.8);
        s2.castShadow = true;
        treeGroup.add(s2);

        const s3 = new THREE.Mesh(new THREE.DodecahedronGeometry(2.6, 1), canopyMat3);
        s3.position.set(-1.2, 7.5, -0.9);
        s3.castShadow = true;
        treeGroup.add(s3);
      }

      this.scene.add(treeGroup);
    };

    const treePositions = [
      [-32, -88, 1.1, 'deciduous'], [-22, -96, 0.9, 'deciduous'], [4, -92, 1.2, 'deciduous'],
      [24, -102, 1.0, 'deciduous'], [-36, -132, 1.1, 'deciduous'], [28, -132, 1.0, 'deciduous'],
      [-16, 26, 0.95, 'cypress'], [-16, 48, 0.95, 'cypress'], [-16, 70, 0.95, 'cypress'],
      [36, 26, 0.95, 'cypress'], [36, 48, 0.95, 'cypress'], [36, 70, 0.95, 'cypress'],
      [-115, -12, 1.05, 'deciduous'], [-115, 12, 1.05, 'deciduous'],
      [125, -12, 1.1, 'deciduous'], [125, 12, 1.1, 'deciduous']
    ];
    treePositions.forEach(([x, z, s, t]) => createArchitecturalTree(x, z, s, t));

    // Modern Streetlights
    const createStreetLight = (lx, lz, rotY = 0) => {
      const poleGroup = new THREE.Group();
      poleGroup.position.set(lx, 0.25, lz);
      poleGroup.rotation.y = rotY;

      const poleGeo = new THREE.CylinderGeometry(0.2, 0.28, 9.5, 8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.2 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4.75;
      pole.castShadow = true;
      poleGroup.add(pole);

      const armGeo = new THREE.BoxGeometry(0.3, 0.3, 3.2);
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.set(0, 9.4, 1.4);
      poleGroup.add(arm);

      const headGeo = new THREE.BoxGeometry(0.8, 0.22, 1.8);
      const headMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, 9.35, 2.6);
      poleGroup.add(head);

      const lensGeo = new THREE.PlaneGeometry(0.7, 1.6);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 9.22, 2.6);
      poleGroup.add(lens);

      const spotLight = new THREE.SpotLight(0xffedd5, 0, 42, Math.PI / 4, 0.45, 1.2);
      spotLight.position.set(0, 9.2, 2.6);
      spotLight.target.position.set(0, 0, 2.6);
      poleGroup.add(spotLight);
      poleGroup.add(spotLight.target);

      this.scene.add(poleGroup);
      this.streetLights.push({ lens, spotLight, headMat });
    };

    const lightCoords = [
      [-17, 35, 0], [-17, 85, 0], [-17, -35, 0], [-17, -85, 0],
      [37, 35, Math.PI], [37, 85, Math.PI], [37, -35, Math.PI], [37, -85, Math.PI]
    ];
    lightCoords.forEach(([lx, lz, r]) => createStreetLight(lx, lz, r));

    // Electric Vehicles (Boulevard Traffic)
    const createVehicle = (vx, vz, colorHex, rotY = 0) => {
      const vGroup = new THREE.Group();
      vGroup.position.set(vx, 0.35, vz);
      vGroup.rotation.y = rotY;

      this._addContactShadow(vx, vz, 3.5, 6.0);

      const bodyGeo = new THREE.BoxGeometry(4.2, 1.5, 8.4);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        metalness: 0.85,
        roughness: 0.2
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 1.1;
      body.castShadow = true;
      vGroup.add(body);

      const cabinGeo = new THREE.BoxGeometry(3.8, 1.2, 4.8);
      const cabinMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.05,
        metalness: 0.95
      });
      const cabin = new THREE.Mesh(cabinGeo, cabinMat);
      cabin.position.set(0, 2.3, -0.4);
      cabin.castShadow = true;
      vGroup.add(cabin);

      const wheelGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.6, 16);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
      const wheelPositions = [
        [-2.1, 0.8, 2.6], [2.1, 0.8, 2.6],
        [-2.1, 0.8, -2.6], [2.1, 0.8, -2.6]
      ];
      wheelPositions.forEach(([wx, wy, wz]) => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, wy, wz);
        wheel.castShadow = true;
        vGroup.add(wheel);
      });

      const hLightGeo = new THREE.BoxGeometry(0.9, 0.3, 0.2);
      const hLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const hl1 = new THREE.Mesh(hLightGeo, hLightMat);
      hl1.position.set(-1.4, 1.2, 4.22);
      vGroup.add(hl1);
      const hl2 = new THREE.Mesh(hLightGeo, hLightMat);
      hl2.position.set(1.4, 1.2, 4.22);
      vGroup.add(hl2);

      const tLightGeo = new THREE.BoxGeometry(0.9, 0.25, 0.2);
      const tLightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const tl1 = new THREE.Mesh(tLightGeo, tLightMat);
      tl1.position.set(-1.4, 1.2, -4.22);
      vGroup.add(tl1);
      const tl2 = new THREE.Mesh(tLightGeo, tLightMat);
      tl2.position.set(1.4, 1.2, -4.22);
      vGroup.add(tl2);

      this.scene.add(vGroup);
      this.vehicleLights.push({ hl1, hl2, tl1, tl2 });
    };

    createVehicle(6.5, 45, 0x334155, 0);        // Graphite Slate Sedan
    createVehicle(-6.5, -60, 0x0284c7, Math.PI); // Executive Blue EV
    createVehicle(6.5, -120, 0xf8fafc, 0);       // Pearl White EV
  }

  // ==========================================
  // 4. ARCHITECTURAL BUILDINGS (100% EXPANDABLE LEVELS)
  // ==========================================

  _buildBuildings() {
    this.interactiveMeshes = [];
    this.buildingGroups = {};

    Object.values(this.data).forEach((bData) => {
      const bGroup = new THREE.Group();
      bGroup.position.set(bData.position[0], bData.position[1], bData.position[2]);
      bGroup.userData = { isBuildingGroup: true, buildingId: bData.id, bData };
      this.scene.add(bGroup);
      this.buildingGroups[bData.id] = bGroup;

      const bw = bData.dimensions.width;
      const bd = bData.dimensions.depth;

      this._addContactShadow(bData.position[0], bData.position[2], bw * 0.75, bd * 0.75);

      // Layered Architectural Plaza Podium with Stepped Stairs
      const plinthGeo = new THREE.BoxGeometry(bw + 8, 2.6, bd + 8);
      const plinthMat = new THREE.MeshStandardMaterial({
        color: 0xedf2f7,
        roughness: 0.55,
        metalness: 0.1
      });
      const plinth = new THREE.Mesh(plinthGeo, plinthMat);
      plinth.position.y = 1.3;
      plinth.receiveShadow = true;
      bGroup.add(plinth);

      // Recessed LED under-podium accent strip
      const stripGeo = new THREE.BoxGeometry(bw + 8.2, 0.25, bd + 8.2);
      const stripMat = new THREE.MeshBasicMaterial({ color: 0x006948 });
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.y = 0.2;
      bGroup.add(strip);

      const floorCount = bData.floors.length;
      const floorHeight = 7.0;
      const sortedFloors = [...bData.floors].sort((a, b) => a.levelNumber - b.levelNumber);

      sortedFloors.forEach((floor, idx) => {
        const floorGroup = new THREE.Group();
        floorGroup.position.y = 2.6 + idx * floorHeight;
        floorGroup.userData = {
          isFloor: true,
          floorId: floor.id,
          buildingId: bData.id,
          baseY: 2.6 + idx * floorHeight,
          explodedY: 2.6 + idx * 14.5
        };
        bGroup.add(floorGroup);

        const isRoof = floor.id === 'roof';
        const isGround = floor.id === 'g';
        const widthTaper = isRoof ? 0.90 : 1.0 - (floorCount - 1 - idx) * 0.02;
        const depthTaper = isRoof ? 0.90 : 1.0 - (floorCount - 1 - idx) * 0.02;
        const w = bw * widthTaper;
        const d = bd * depthTaper;
        const h = isRoof ? 4.2 : floorHeight - 1.0;

        // 1. Authoritative Solid Architectural Slabs (Titanium Slate Fascia)
        const slabGeo = new THREE.BoxGeometry(w + 0.8, 1.3, d + 0.8);
        const slabMat = new THREE.MeshStandardMaterial({
          color: 0x1e2632,
          roughness: 0.35,
          metalness: 0.65
        });
        const slabMesh = new THREE.Mesh(slabGeo, slabMat);
        slabMesh.position.y = 0.65;
        slabMesh.castShadow = true;
        slabMesh.receiveShadow = true;
        slabMesh.userData = {
          isFloorClickable: true,
          floorId: floor.id,
          buildingId: bData.id,
          originalColor: 0x1e2632
        };
        floorGroup.add(slabMesh);
        this.interactiveMeshes.push(slabMesh);

        // 2. Structural Corner Perimeter Columns
        if (!isRoof) {
          const colGeo = new THREE.BoxGeometry(1.6, h, 1.6);
          const colMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4 });
          const colOffsets = [
            [-w / 2 + 1.0, h / 2, -d / 2 + 1.0],
            [w / 2 - 1.0, h / 2, -d / 2 + 1.0],
            [-w / 2 + 1.0, h / 2, d / 2 - 1.0],
            [w / 2 - 1.0, h / 2, d / 2 - 1.0]
          ];
          colOffsets.forEach(([cx, cy, cz]) => {
            const col = new THREE.Mesh(colGeo, colMat);
            col.position.set(cx, cy, cz);
            col.castShadow = true;
            col.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
            floorGroup.add(col);
            this.interactiveMeshes.push(col);
          });
        }

        // 3. Interior Floor Partitions, Workstations & HVAC Detailing
        const interiorGroup = new THREE.Group();
        interiorGroup.userData = { isInteriorDetail: true };
        floorGroup.add(interiorGroup);

        if (!isRoof) {
          // Central Service Core
          const coreGeo = new THREE.BoxGeometry(w * 0.26, h, d * 0.28);
          const coreMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65, metalness: 0.2 });
          const coreMesh = new THREE.Mesh(coreGeo, coreMat);
          coreMesh.position.y = h / 2;
          interiorGroup.add(coreMesh);

          // Stainless Steel Elevator Doors
          const doorGeo = new THREE.PlaneGeometry(3.6, 4.6);
          const doorMat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, metalness: 0.9, roughness: 0.15 });
          const doorMesh = new THREE.Mesh(doorGeo, doorMat);
          doorMesh.position.set(0, 2.3, d * 0.141);
          interiorGroup.add(doorMesh);

          // Thermostat Screen
          const statBackGeo = new THREE.BoxGeometry(1.0, 1.4, 0.15);
          const statBackMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
          const statBack = new THREE.Mesh(statBackGeo, statBackMat);
          statBack.position.set(3.0, 2.8, d * 0.142);
          interiorGroup.add(statBack);

          const statScreenGeo = new THREE.PlaneGeometry(0.8, 0.8);
          const statScreenMat = new THREE.MeshBasicMaterial({ color: floor.anomaly ? 0xf43f5e : 0x0284c7 });
          const statScreen = new THREE.Mesh(statScreenGeo, statScreenMat);
          statScreen.position.set(3.0, 2.9, d * 0.144);
          interiorGroup.add(statScreen);

          // Meeting Room Partitions
          const wallGeoX = new THREE.BoxGeometry(w * 0.72, h * 0.75, 0.35);
          const wallGeoZ = new THREE.BoxGeometry(0.35, h * 0.75, d * 0.65);
          const wallMat = new THREE.MeshStandardMaterial({
            color: 0xbae6fd,
            transparent: true,
            opacity: 0.40,
            roughness: 0.15,
            metalness: 0.5
          });

          const partition1 = new THREE.Mesh(wallGeoX, wallMat);
          partition1.position.set(0, h * 0.38, -d * 0.2);
          interiorGroup.add(partition1);

          const partition2 = new THREE.Mesh(wallGeoZ, wallMat);
          partition2.position.set(w * 0.22, h * 0.38, 0);
          interiorGroup.add(partition2);

          // AHU Mechanical Enclosure Assembly
          const ahuX = -w * 0.30;
          const ahuZ = d * 0.24;
          const ahuW = w * 0.22;
          const ahuD = d * 0.22;
          const ahuH = h * 0.68;

          const isolatorGeo = new THREE.BoxGeometry(ahuW * 0.95, 0.35, ahuD * 0.95);
          const isolatorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
          const isolator = new THREE.Mesh(isolatorGeo, isolatorMat);
          isolator.position.set(ahuX, 0.18, ahuZ);
          interiorGroup.add(isolator);

          const ahuGeo = new THREE.BoxGeometry(ahuW, ahuH, ahuD);
          const ahuMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.75, roughness: 0.3 });
          const ahu = new THREE.Mesh(ahuGeo, ahuMat);
          ahu.position.set(ahuX, ahuH / 2 + 0.35, ahuZ);
          interiorGroup.add(ahu);

          const blowerGeo = new THREE.CylinderGeometry(1.6, 1.8, 1.5, 16);
          const blowerMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.25 });
          const blower = new THREE.Mesh(blowerGeo, blowerMat);
          blower.rotation.z = Math.PI / 2;
          blower.position.set(ahuX + ahuW * 0.15, ahuH + 0.9, ahuZ);
          interiorGroup.add(blower);

          // Chilled Water Piping Loop
          const chwsPipeGeo = new THREE.CylinderGeometry(0.38, 0.38, Math.abs(ahuX) + 1.2, 12);
          const chwsPipeMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.5, roughness: 0.2 });
          const chwsPipe = new THREE.Mesh(chwsPipeGeo, chwsPipeMat);
          chwsPipe.rotation.z = Math.PI / 2;
          chwsPipe.position.set(ahuX / 2, 2.1, ahuZ - 1.2);
          interiorGroup.add(chwsPipe);

          const chwrPipeGeo = new THREE.CylinderGeometry(0.38, 0.38, Math.abs(ahuX) + 1.2, 12);
          const chwrPipeMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, metalness: 0.5, roughness: 0.2 });
          const chwrPipe = new THREE.Mesh(chwrPipeGeo, chwrPipeMat);
          chwrPipe.rotation.z = Math.PI / 2;
          chwrPipe.position.set(ahuX / 2, 2.9, ahuZ - 1.2);
          interiorGroup.add(chwrPipe);

          // Air Ducts & Diffusers
          const ductY = h * 0.82;
          const trunkLen = w * 0.70;
          const ductGeo = new THREE.BoxGeometry(trunkLen, 1.1, 1.5);
          const ductMat = new THREE.MeshStandardMaterial({ color: 0xa1a1aa, metalness: 0.85, roughness: 0.2 });
          const trunkDuct = new THREE.Mesh(ductGeo, ductMat);
          trunkDuct.position.set(0, ductY, ahuZ);
          interiorGroup.add(trunkDuct);

          const branchDepth = d * 0.36;
          const branchGeo = new THREE.BoxGeometry(1.0, 0.85, branchDepth);
          const branch1 = new THREE.Mesh(branchGeo, ductMat);
          branch1.position.set(w * 0.22, ductY - 0.1, ahuZ - branchDepth / 2);
          interiorGroup.add(branch1);

          const branch2 = new THREE.Mesh(branchGeo, ductMat);
          branch2.position.set(-w * 0.05, ductY - 0.1, ahuZ - branchDepth / 2);
          interiorGroup.add(branch2);

          const diffuserCoords = [
            [w * 0.22, ductY - 0.45, ahuZ - branchDepth + 1.2, 0],
            [-w * 0.05, ductY - 0.45, ahuZ - branchDepth + 1.2, 1.5],
            [w * 0.22, ductY - 0.45, ahuZ + branchDepth - 2.0, 3.0]
          ];

          const diffuserBezelGeo = new THREE.BoxGeometry(2.4, 0.18, 2.4);
          const diffuserBezelMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 });

          diffuserCoords.forEach(([dx, dy, dz, phaseOffset]) => {
            const bezel = new THREE.Mesh(diffuserBezelGeo, diffuserBezelMat);
            bezel.position.set(dx, dy, dz);
            interiorGroup.add(bezel);

            const breezeConeGeo = new THREE.ConeGeometry(2.1, 3.2, 12, 1, true);
            const breezeMat = new THREE.MeshBasicMaterial({
              color: 0x38bdf8,
              transparent: true,
              opacity: 0.28,
              side: THREE.DoubleSide,
              depthWrite: false
            });
            const breezeMesh = new THREE.Mesh(breezeConeGeo, breezeMat);
            breezeMesh.position.set(dx, dy - 1.6, dz);
            interiorGroup.add(breezeMesh);

            this.airflowStreams.push({
              mesh: breezeMesh,
              phase: phaseOffset,
              buildingId: bData.id,
              floorId: floor.id
            });
          });

          // Modular Office Workstations
          const deskGeo = new THREE.BoxGeometry(4.2, 0.18, 2.4);
          const deskMat = new THREE.MeshStandardMaterial({ color: 0xf1ebe1, roughness: 0.5 });
          const monitorGeo = new THREE.BoxGeometry(1.6, 1.1, 0.14);
          const monitorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 });
          const screenGeo = new THREE.PlaneGeometry(1.5, 1.0);
          const screenMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

          const createWorkstation = (wx, wz) => {
            const wsGroup = new THREE.Group();
            wsGroup.position.set(wx, 1.3, wz);
            const desk = new THREE.Mesh(deskGeo, deskMat);
            desk.position.y = 1.3;
            desk.castShadow = true;
            wsGroup.add(desk);

            const mon = new THREE.Mesh(monitorGeo, monitorMat);
            mon.position.set(0, 2.2, -0.4);
            wsGroup.add(mon);

            const scr = new THREE.Mesh(screenGeo, screenMat);
            scr.position.set(0, 2.2, -0.32);
            wsGroup.add(scr);

            interiorGroup.add(wsGroup);
          };

          createWorkstation(w * 0.22, ahuZ - branchDepth + 1.2);
          createWorkstation(-w * 0.05, ahuZ - branchDepth + 1.2);

          // Floor Zone Tile (Clickable)
          const zoneTileGeo = new THREE.PlaneGeometry(w * 0.82, d * 0.80);
          const zoneTileMat = new THREE.MeshStandardMaterial({
            color: floor.anomaly ? 0xfff1f2 : 0xf8fafc,
            roughness: 0.9,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
          });
          const zoneTile = new THREE.Mesh(zoneTileGeo, zoneTileMat);
          zoneTile.rotation.x = -Math.PI / 2;
          zoneTile.position.set(0, 1.32, 0);
          zoneTile.receiveShadow = true;
          zoneTile.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          interiorGroup.add(zoneTile);
          this.interactiveMeshes.push(zoneTile);
        }

        // 4. Photorealistic Curtain Wall Facade Glazing (Clickable)
        if (!isRoof) {
          const glassGroup = new THREE.Group();
          glassGroup.userData = { isFacadeGlass: true };
          floorGroup.add(glassGroup);

          const curtainTexDay = this._getCurtainWallTexture(false);
          const curtainTexNight = this._getCurtainWallTexture(true);

          const glassWallMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: curtainTexDay,
            roughness: 0.08,
            metalness: 0.88,
            transparent: true,
            opacity: 0.65,
            depthWrite: false,
            side: THREE.DoubleSide
          });

          const glassH = h * 0.74;
          const glassY = h / 2;
          const gw = w + 0.4;
          const gd = d + 0.4;

          const fbGeo = new THREE.PlaneGeometry(gw, glassH);
          const fGlass = new THREE.Mesh(fbGeo, glassWallMat);
          fGlass.position.set(0, glassY, gd / 2);
          fGlass.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          glassGroup.add(fGlass);
          this.interactiveMeshes.push(fGlass);

          const bGlass = new THREE.Mesh(fbGeo, glassWallMat);
          bGlass.position.set(0, glassY, -gd / 2);
          bGlass.rotation.y = Math.PI;
          bGlass.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          glassGroup.add(bGlass);
          this.interactiveMeshes.push(bGlass);

          const lrGeo = new THREE.PlaneGeometry(gd, glassH);
          const lGlass = new THREE.Mesh(lrGeo, glassWallMat);
          lGlass.position.set(-gw / 2, glassY, 0);
          lGlass.rotation.y = -Math.PI / 2;
          lGlass.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          glassGroup.add(lGlass);
          this.interactiveMeshes.push(lGlass);

          const rGlass = new THREE.Mesh(lrGeo, glassWallMat);
          rGlass.position.set(gw / 2, glassY, 0);
          rGlass.rotation.y = Math.PI / 2;
          rGlass.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          glassGroup.add(rGlass);
          this.interactiveMeshes.push(rGlass);

          this.windowMeshes.push({
            mat: glassWallMat,
            dayTex: curtainTexDay,
            nightTex: curtainTexNight
          });
        }

        // Ground Floor Entrance Canopy & Glass Portico
        if (isGround) {
          const canopyGeo = new THREE.BoxGeometry(20, 0.9, 11);
          const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.85 });
          const canopy = new THREE.Mesh(canopyGeo, canopyMat);
          canopy.position.set(0, h * 0.75, d / 2 + 5.5);
          canopy.castShadow = true;
          canopy.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          floorGroup.add(canopy);
          this.interactiveMeshes.push(canopy);

          const spotGeo = new THREE.CircleGeometry(0.8, 12);
          const spotMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
          for (let sx = -7; sx <= 7; sx += 7) {
            const spot = new THREE.Mesh(spotGeo, spotMat);
            spot.rotation.x = Math.PI / 2;
            spot.position.set(sx, h * 0.75 - 0.46, d / 2 + 5.5);
            floorGroup.add(spot);
          }
        }

        // Rooftop Architecture
        if (isRoof) {
          const parapetGeo = new THREE.BoxGeometry(w + 0.6, 1.8, d + 0.6);
          const parapetMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 });
          const parapet = new THREE.Mesh(parapetGeo, parapetMat);
          parapet.position.y = 0.9;
          parapet.castShadow = true;
          parapet.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          floorGroup.add(parapet);
          this.interactiveMeshes.push(parapet);

          // Rooftop PV Panels (Clickable)
          for (let sx = -w / 2 + 6; sx <= w / 2 - 6; sx += 9.5) {
            for (let sz = -d / 2 + 6; sz <= d / 2 - 12; sz += 9.5) {
              const panelGeo = new THREE.BoxGeometry(7.6, 0.38, 6.6);
              const panelMat = new THREE.MeshStandardMaterial({
                map: this._getSolarCellTexture(),
                roughness: 0.12,
                metalness: 0.95
              });
              const panel = new THREE.Mesh(panelGeo, panelMat);
              panel.position.set(sx, 1.8, sz);
              panel.rotation.x = -0.24;
              panel.castShadow = true;
              panel.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
              floorGroup.add(panel);
              this.interactiveMeshes.push(panel);
            }
          }

          // Rooftop Chillers (Clickable)
          const chillerGeo = new THREE.BoxGeometry(9.5, 3.8, 6.2);
          const chillerMat = new THREE.MeshStandardMaterial({ color: 0x006948, metalness: 0.6, roughness: 0.35 });
          const chiller1 = new THREE.Mesh(chillerGeo, chillerMat);
          chiller1.position.set(-w * 0.22, 3.0, d * 0.20);
          chiller1.castShadow = true;
          chiller1.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          floorGroup.add(chiller1);
          this.interactiveMeshes.push(chiller1);

          const chiller2 = new THREE.Mesh(chillerGeo, chillerMat);
          chiller2.position.set(w * 0.22, 3.0, d * 0.20);
          chiller2.castShadow = true;
          chiller2.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          floorGroup.add(chiller2);
          this.interactiveMeshes.push(chiller2);

          const crownGeo = new THREE.BoxGeometry(11, 5.5, 11);
          const crownMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 });
          const crown = new THREE.Mesh(crownGeo, crownMat);
          crown.position.set(0, 3.9, 0);
          crown.castShadow = true;
          crown.userData = { isFloorClickable: true, floorId: floor.id, buildingId: bData.id };
          floorGroup.add(crown);
          this.interactiveMeshes.push(crown);

          const mastGeo = new THREE.CylinderGeometry(0.3, 0.8, 12, 8);
          const mastMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 });
          const mast = new THREE.Mesh(mastGeo, mastMat);
          mast.position.set(0, 12.5, 0);
          floorGroup.add(mast);

          const beaconGeo = new THREE.SphereGeometry(1.2, 16, 16);
          const beaconMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
          const beacon = new THREE.Mesh(beaconGeo, beaconMat);
          beacon.position.set(0, 18.5, 0);
          floorGroup.add(beacon);
          this.beaconLights.push(beacon);
        }

        // Pulsing Warning Beacon Ring on Anomaly Floor (Level 2 Fox Hub)
        if (floor.anomaly) {
          const ringGeo = new THREE.TorusGeometry(3.6, 0.22, 16, 32);
          const ringMat = new THREE.MeshBasicMaterial({
            color: 0xee2222,
            transparent: true,
            opacity: 0.85
          });
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.rotation.x = Math.PI / 2;
          ringMesh.position.set(w * 0.44, 3.5, d * 0.44);
          floorGroup.add(ringMesh);

          this.alertFlags.push({
            ring: ringMesh,
            buildingId: bData.id,
            floorId: floor.id,
            anomaly: floor.anomaly
          });
        }
      });
    });
  }

  // ==========================================
  // 5. UTILITY SOLAR FARM
  // ==========================================

  _buildSolarFarm() {
    const solarFarmGroup = new THREE.Group();
    solarFarmGroup.position.set(160, 0, -140);
    this.scene.add(solarFarmGroup);

    const sfPlinthGeo = new THREE.BoxGeometry(94, 1.6, 74);
    const sfPlinthMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.65,
      metalness: 0.08
    });
    const sfPlinth = new THREE.Mesh(sfPlinthGeo, sfPlinthMat);
    sfPlinth.position.y = 0.8;
    sfPlinth.receiveShadow = true;
    solarFarmGroup.add(sfPlinth);

    this._addContactShadow(160, -140, 52, 42);

    const solarTex = this._getSolarCellTexture();
    const pMat = new THREE.MeshStandardMaterial({
      map: solarTex,
      roughness: 0.1,
      metalness: 0.95
    });

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8 });

    for (let px = -36; px <= 36; px += 18) {
      for (let pz = -24; pz <= 24; pz += 16) {
        const pGeo = new THREE.BoxGeometry(15, 0.42, 9.5);
        const panel = new THREE.Mesh(pGeo, pMat);
        panel.position.set(px, 4.4, pz);
        panel.rotation.x = -0.34;
        panel.castShadow = true;
        solarFarmGroup.add(panel);

        const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.8, 8), poleMat);
        pole1.position.set(px - 5, 2.0, pz - 1.5);
        solarFarmGroup.add(pole1);

        const pole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 8), poleMat);
        pole2.position.set(px + 5, 1.3, pz + 1.5);
        solarFarmGroup.add(pole2);
      }
    }

    const invGeo = new THREE.BoxGeometry(10, 6, 8);
    const invMat = new THREE.MeshStandardMaterial({ color: 0x006948, roughness: 0.35 });
    const inverter = new THREE.Mesh(invGeo, invMat);
    inverter.position.set(0, 3.8, 0);
    inverter.castShadow = true;
    solarFarmGroup.add(inverter);
  }

  // ==========================================
  // 6. MODULAR BESS BATTERY SUBSTATION
  // ==========================================

  _buildBessSubstation() {
    const bessGroup = new THREE.Group();
    bessGroup.position.set(-150, 0, -100);
    this.scene.add(bessGroup);

    const bPlinthGeo = new THREE.BoxGeometry(68, 1.6, 48);
    const bPlinthMat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.85 });
    const bPlinth = new THREE.Mesh(bPlinthGeo, bPlinthMat);
    bPlinth.position.y = 0.8;
    bPlinth.receiveShadow = true;
    bessGroup.add(bPlinth);

    this._addContactShadow(-150, -100, 38, 28);

    for (let c = -18; c <= 18; c += 18) {
      const boxGeo = new THREE.BoxGeometry(14, 9.5, 26);
      const boxMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.25,
        metalness: 0.75
      });
      const containerBox = new THREE.Mesh(boxGeo, boxMat);
      containerBox.position.set(c, 4.8, 0);
      containerBox.castShadow = true;
      bessGroup.add(containerBox);

      const topChillerGeo = new THREE.BoxGeometry(11, 1.5, 8);
      const topChillerMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
      const topChiller = new THREE.Mesh(topChillerGeo, topChillerMat);
      topChiller.position.set(c, 10.2, 0);
      bessGroup.add(topChiller);

      const ledGeo = new THREE.BoxGeometry(0.4, 6.5, 1.2);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(c + 7.1, 5.0, 8);
      bessGroup.add(led);
      this.bessLedBars.push(led);
    }

    const txGeo = new THREE.BoxGeometry(8, 7, 8);
    const txMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.3 });
    const transformer = new THREE.Mesh(txGeo, txMat);
    transformer.position.set(24, 4.3, 0);
    transformer.castShadow = true;
    bessGroup.add(transformer);

    const bushGeo = new THREE.CylinderGeometry(0.3, 0.5, 2.5, 8);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.2 });
    for (let bx = 22; bx <= 26; bx += 2) {
      const bush = new THREE.Mesh(bushGeo, bushMat);
      bush.position.set(bx, 9.0, 0);
      bessGroup.add(bush);
    }
  }

  // ==========================================
  // 7. CONTEMPORARY MINIMALIST ECO-VILLAS
  // ==========================================

  _buildEcoVillas() {
    const resGroup = new THREE.Group();
    resGroup.position.set(-130, 0, 70);
    this.scene.add(resGroup);

    this._addContactShadow(-130, 70, 36, 32);

    for (let vx = -25; vx <= 25; vx += 25) {
      for (let vz = -20; vz <= 20; vz += 22) {
        // Modern Cantilever Pavilion Villa
        const villaGeo = new THREE.BoxGeometry(16, 7.5, 14);
        const villaMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
        const villa = new THREE.Mesh(villaGeo, villaMat);
        villa.position.set(vx, 3.75, vz);
        villa.castShadow = true;
        resGroup.add(villa);

        // Ground Floor Timber Louver Accent
        const louverGeo = new THREE.BoxGeometry(6.0, 3.2, 0.2);
        const louverMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
        const louver = new THREE.Mesh(louverGeo, louverMat);
        louver.position.set(vx - 4, 2.2, vz + 7.1);
        resGroup.add(louver);

        // Picture Glass Window
        const winGeo = new THREE.PlaneGeometry(6.5, 4.8);
        const winMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          roughness: 0.08,
          metalness: 0.9
        });
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set(vx + 3.2, 4.2, vz + 7.02);
        resGroup.add(win);

        // Modern Flat Architectural Roof with Integrated Solar
        const roofGeo = new THREE.BoxGeometry(16.8, 0.6, 14.8);
        const roofMat = new THREE.MeshStandardMaterial({
          map: this._getSolarCellTexture(),
          roughness: 0.15,
          metalness: 0.85
        });
        const vRoof = new THREE.Mesh(roofGeo, roofMat);
        vRoof.position.set(vx, 7.8, vz);
        vRoof.castShadow = true;
        resGroup.add(vRoof);
      }
    }
  }

  // ==========================================
  // 8. ENERGY FLOW CONDUITS
  // ==========================================

  _buildEnergyConduits() {
    this.flowCurves = [];
    this.pulseMarkers = [];

    const createConduit = (start, end, colorHex) => {
      const mid = new THREE.Vector3(
        (start.x + end.x) / 2,
        Math.max(start.y, end.y) + 24,
        (start.z + end.z) / 2
      );
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(36);
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.45,
        linewidth: 2
      });
      const line = new THREE.Line(geom, mat);
      this.scene.add(line);
      this.flowCurves.push(curve);

      const pulseGeo = new THREE.SphereGeometry(1.6, 12, 12);
      const pulseMat = new THREE.MeshBasicMaterial({ color: colorHex });
      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      this.scene.add(pulseMesh);
      this.pulseMarkers.push({ mesh: pulseMesh, curve, t: Math.random() });
    };

    createConduit(new THREE.Vector3(160, 6, -140), new THREE.Vector3(-150, 7, -100), 0x0284c7);
    createConduit(new THREE.Vector3(-150, 7, -100), new THREE.Vector3(-80, 12, -40), 0x006948);
    createConduit(new THREE.Vector3(160, 6, -140), new THREE.Vector3(75, 12, -50), 0x006948);
    createConduit(new THREE.Vector3(-150, 7, -100), new THREE.Vector3(75, 12, 70), 0x006948);
  }

  // ==========================================
  // 9. INTERACTION, RAYCASTING & EVENTS
  // ==========================================

  _onPointerMove(e) {
    if (!this.container || !this.renderer || !this.camera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactiveMeshes, false);
    if (intersects.length > 0) {
      this.container.style.cursor = 'pointer';
    } else {
      this.container.style.cursor = 'default';
    }
  }

  _onClick(e) {
    if (!this.container || !this.renderer || !this.camera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactiveMeshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const bId = hit.userData.buildingId;
      const fId = hit.userData.floorId;

      if (bId) {
        if (this.selectedBuildingId !== bId) {
          // Switch to clicked building and expand clicked floor
          this.selectBuilding(bId);
          if (fId) {
            setTimeout(() => this.selectFloor(fId), 260);
          }
        } else {
          // Already in active building: toggle/expand this floor!
          if (this.selectedFloorId === fId) {
            this.selectFloor(null); // Click expanded floor to collapse to whole building stack
          } else {
            this.selectFloor(fId);
          }
        }
      }
    }
  }

  _handleResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    this.animFrameId = requestAnimationFrame(this._animate);

    if (this.camera && this.controls) {
      this.camera.position.lerp(this.cameraTargetPos, 0.08);
      this.controls.target.lerp(this.cameraLookTarget, 0.08);
      this.controls.update();
    }

    const time = performance.now() * 0.003;

    // Diffusers Airflow animation
    this.airflowStreams.forEach((stream) => {
      const pulse = Math.sin(time * 2.8 + stream.phase);
      if (stream.mesh && stream.mesh.material) {
        stream.mesh.scale.set(1.0 + pulse * 0.09, 1.0 + pulse * 0.12, 1.0 + pulse * 0.09);
        stream.mesh.material.opacity = 0.22 + pulse * 0.08;
      }
    });

    // Energy conduits pulses
    if (this.showEnergyFlow) {
      this.pulseMarkers.forEach((p) => {
        p.t += 0.007;
        if (p.t > 1) p.t = 0;
        const pos = p.curve.getPoint(p.t);
        p.mesh.position.copy(pos);
        p.mesh.visible = true;
      });
    } else {
      this.pulseMarkers.forEach((p) => (p.mesh.visible = false));
    }

    // Water Surface Wave Ripples
    this.waterSurfaces.forEach((wMesh) => {
      if (wMesh.material) {
        wMesh.position.y = 0.95 + Math.sin(time * 1.5) * 0.04;
      }
    });

    // Aviation Beacon Lights Flashing
    const beaconFlash = (Math.sin(time * 5.0) + 1) * 0.5;
    this.beaconLights.forEach((b) => {
      b.visible = beaconFlash > 0.45;
    });

    // Pulse 3D Alert Rings
    if (this.alertFlags && this.alertFlags.length) {
      const pulse = (Math.sin(time * 3.5) + 1) * 0.5;
      this.alertFlags.forEach((item) => {
        if (item.ring) {
          item.ring.scale.setScalar(1.0 + pulse * 0.35);
          item.ring.material.opacity = 0.4 + (1 - pulse) * 0.6;
        }
      });
    }

    // Update screen-projected 2D HTML markers and SVG leader lines
    if (typeof this.onUpdateAlertPins === 'function') {
      this.onUpdateAlertPins(this.alertFlags || []);
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
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

  getBuildingApexScreenPosition(buildingId) {
    const resolvedId = this._resolveBuildingId(buildingId);
    const targetGroup = this.buildingGroups[resolvedId];
    if (!targetGroup || !this.camera || !this.container) return null;

    let roofChild = targetGroup.children.find(
      (c) => c.userData.isFloor && c.userData.floorId === 'roof'
    );
    if (!roofChild) {
      const floors = targetGroup.children.filter((c) => c.userData.isFloor);
      if (floors.length) {
        floors.sort((a, b) => b.position.y - a.position.y);
        roofChild = floors[0];
      }
    }
    if (!roofChild) return null;

    const vec = new THREE.Vector3();
    roofChild.getWorldPosition(vec);

    // Height offset to float right above the rooftop mast and flashing beacon
    vec.y += 21.0;

    vec.project(this.camera);
    if (vec.z > 1) return null; // Behind camera

    const rect = this.container.getBoundingClientRect();
    const x = (vec.x * 0.5 + 0.5) * rect.width;
    const y = (-(vec.y * 0.5) + 0.5) * rect.height;

    if (x < 15 || x > rect.width - 15 || y < 15 || y > rect.height - 15) {
      return null;
    }

    return { x, y };
  }

  getFloorScreenPosition(buildingId, floorId) {
    const resolvedId = this._resolveBuildingId(buildingId);
    const targetGroup = this.buildingGroups[resolvedId];
    if (!targetGroup || !this.camera || !this.container) return null;
    const floorChild = targetGroup.children.find(
      (c) => c.userData.isFloor && c.userData.floorId === floorId
    );
    if (!floorChild) return null;

    const vec = new THREE.Vector3();
    floorChild.getWorldPosition(vec);

    // Anchor directly at the vertical center of the floor slab
    vec.y += 3.2;

    vec.project(this.camera);
    if (vec.z > 1) return null; // Behind camera

    const rect = this.container.getBoundingClientRect();
    const x = (vec.x * 0.5 + 0.5) * rect.width;
    const y = (-(vec.y * 0.5) + 0.5) * rect.height;

    if (x < 15 || x > rect.width - 15 || y < 15 || y > rect.height - 15) {
      return null;
    }

    return { x, y };
  }

  // ==========================================
  // 10. PUBLIC API METHODS
  // ==========================================

  selectBuilding(buildingId) {
    const resolvedId = this._resolveBuildingId(buildingId);
    this.selectedBuildingId = resolvedId;
    this.selectedFloorId = null;
    this._updateCameraAndStages();
    this.onSelectBuilding(resolvedId);
  }

  selectFloor(floorId) {
    this.selectedFloorId = floorId;
    this._updateCameraAndStages();
    this.onSelectFloor(floorId);
  }

  resetView() {
    this.selectedBuildingId = null;
    this.selectedFloorId = null;
    this._updateCameraAndStages();
    this.onSelectBuilding(null);
    this.onSelectFloor(null);
  }

  toggleEnergyFlow(bool) {
    this.showEnergyFlow = bool !== undefined ? bool : !this.showEnergyFlow;
    return this.showEnergyFlow;
  }

  toggleNightMode(bool) {
    this.isNightMode = bool !== undefined ? bool : !this.isNightMode;
    if (!this.scene || !this.dirLight || !this.hemiLight) return this.isNightMode;

    if (this.isNightMode) {
      const nightSky = 0x0a101f;
      this.scene.background = new THREE.Color(nightSky);
      this.scene.fog = new THREE.FogExp2(nightSky, 0.0020);

      this.dirLight.color = new THREE.Color(0x38bdf8);
      this.dirLight.intensity = 0.65;
      this.hemiLight.color = new THREE.Color(0x1e293b);
      this.hemiLight.groundColor = new THREE.Color(0x020617);
      this.hemiLight.intensity = 0.40;

      this.windowMeshes.forEach((w) => {
        w.mat.map = w.nightTex;
        w.mat.opacity = 0.85;
        w.mat.needsUpdate = true;
      });

      this.streetLights.forEach((sl) => {
        sl.spotLight.intensity = 1.4;
        sl.lens.material.color = new THREE.Color(0xffedd5);
      });

      this.vehicleLights.forEach((vl) => {
        vl.hl1.material.color = new THREE.Color(0xffedd5);
        vl.hl2.material.color = new THREE.Color(0xffedd5);
        vl.tl1.material.color = new THREE.Color(0xff0000);
        vl.tl2.material.color = new THREE.Color(0xff0000);
      });
    } else {
      const daylightSky = 0xe4ebf2;
      this.scene.background = new THREE.Color(daylightSky);
      this.scene.fog = new THREE.FogExp2(daylightSky, 0.0013);

      this.dirLight.color = new THREE.Color(0xfffbf2);
      this.dirLight.intensity = 2.0;
      this.hemiLight.color = new THREE.Color(0xe2e8f0);
      this.hemiLight.groundColor = new THREE.Color(0x64748b);
      this.hemiLight.intensity = 1.10;

      this.windowMeshes.forEach((w) => {
        w.mat.map = w.dayTex;
        w.mat.opacity = 0.65;
        w.mat.needsUpdate = true;
      });

      this.streetLights.forEach((sl) => {
        sl.spotLight.intensity = 0;
        sl.lens.material.color = new THREE.Color(0x94a3b8);
      });
    }
    return this.isNightMode;
  }

  toggleWireframe(bool) {
    this.wireframeMode = bool !== undefined ? bool : !this.wireframeMode;
    this.interactiveMeshes.forEach((mesh) => {
      if (mesh.material) {
        mesh.material.wireframe = this.wireframeMode;
      }
    });
    return this.wireframeMode;
  }

  _updateCameraAndStages() {
    const buildingGroups = this.buildingGroups;
    if (!buildingGroups) return;

    const setGlassOpacity = (glassObj, op) => {
      if (!glassObj) return;
      if (glassObj.material) {
        glassObj.material.opacity = op;
        glassObj.material.transparent = true;
      }
      if (glassObj.children) {
        glassObj.children.forEach((c) => {
          if (c.material) {
            c.material.opacity = op;
            c.material.transparent = true;
          }
        });
      }
    };

    if (this.selectedBuildingId && this.data[this.selectedBuildingId]) {
      const bData = this.data[this.selectedBuildingId];
      const bx = bData.position[0];
      const by = bData.position[1];
      const bz = bData.position[2];
      const targetBuildingGroup = buildingGroups[this.selectedBuildingId];

      let activeFloorY = 25;

      if (this.selectedFloorId && targetBuildingGroup) {
        // STAGE 3: FOCUSED ON A SPECIFIC EXPANDED FLOOR
        const activeFloorChild = targetBuildingGroup.children.find(
          (c) => c.userData.isFloor && c.userData.floorId === this.selectedFloorId
        );
        if (activeFloorChild) {
          activeFloorY = activeFloorChild.userData.explodedY;
        }

        this.cameraTargetPos.set(bx + 38, activeFloorY + 36, bz + 46);
        this.cameraLookTarget.set(bx, activeFloorY + 1.5, bz);

        Object.entries(buildingGroups).forEach(([bId, group]) => {
          const isTarget = bId === this.selectedBuildingId;
          group.children.forEach((child) => {
            if (child.userData.isFloor) {
              const isSelectedFloor = isTarget && child.userData.floorId === this.selectedFloorId;
              const isFloorAbove = isTarget && child.userData.explodedY > activeFloorY;
              const isFloorBelow = isTarget && child.userData.explodedY < activeFloorY;

              if (isSelectedFloor) {
                child.position.y = activeFloorY;
                child.visible = true;

                const interior = child.children.find((c) => c.userData.isInteriorDetail);
                if (interior) interior.visible = true;

                const glass = child.children.find((c) => c.userData.isFacadeGlass);
                setGlassOpacity(glass, 0.05);

                const slab = child.children.find((c) => c.userData.isFloorClickable);
                if (slab && slab.material) {
                  slab.material.color = new THREE.Color(0xffffff);
                  slab.material.emissive = new THREE.Color(0x003322);
                  slab.material.opacity = 1.0;
                }
              } else if (isFloorAbove) {
                child.position.y = child.userData.explodedY + 38;
                const interior = child.children.find((c) => c.userData.isInteriorDetail);
                if (interior) interior.visible = false;

                const slab = child.children.find((c) => c.userData.isFloorClickable);
                if (slab && slab.material) {
                  slab.material.color = new THREE.Color(0xcbd5e1);
                  slab.material.emissive = new THREE.Color(0x000000);
                  slab.material.opacity = 0.12;
                }
              } else if (isFloorBelow) {
                child.position.y = child.userData.explodedY;
                const interior = child.children.find((c) => c.userData.isInteriorDetail);
                if (interior) interior.visible = false;

                const slab = child.children.find((c) => c.userData.isFloorClickable);
                if (slab && slab.material) {
                  slab.material.color = new THREE.Color(0x94a3b8);
                  slab.material.emissive = new THREE.Color(0x000000);
                  slab.material.opacity = 0.25;
                }
              } else {
                child.position.y = child.userData.baseY;
                const slab = child.children.find((c) => c.userData.isFloorClickable);
                if (slab && slab.material) {
                  slab.material.color = new THREE.Color(0x94a3b8);
                  slab.material.opacity = 0.18;
                }
              }
            }
          });
        });
      } else {
        // STAGE 2: WHOLE BUILDING EXPLODED STACK (ALL FLOORS SEPARATED)
        this.cameraTargetPos.set(bx + 52, by + 42, bz + 64);
        this.cameraLookTarget.set(bx, by + 22, bz);

        Object.entries(buildingGroups).forEach(([bId, group]) => {
          const isTarget = bId === this.selectedBuildingId;
          group.children.forEach((child) => {
            if (child.userData.isFloor) {
              const targetY = isTarget ? child.userData.explodedY : child.userData.baseY;
              child.position.y = targetY;
              child.visible = true;

              const interior = child.children.find((c) => c.userData.isInteriorDetail);
              if (interior) interior.visible = isTarget;

              const glass = child.children.find((c) => c.userData.isFacadeGlass);
              setGlassOpacity(glass, this.isNightMode ? 0.85 : 0.65);

              const slab = child.children.find((c) => c.userData.isFloorClickable);
              if (slab && slab.material) {
                if (isTarget) {
                  slab.material.color = new THREE.Color(slab.userData.originalColor);
                  slab.material.emissive = new THREE.Color(0x000000);
                  slab.material.opacity = 0.95;
                } else {
                  slab.material.color = new THREE.Color(0x94a3b8);
                  slab.material.emissive = new THREE.Color(0x000000);
                  slab.material.opacity = 0.22;
                }
              }
            }
          });
        });
      }
    } else {
      // STAGE 1: TOWNSHIP OVERVIEW
      this.cameraTargetPos.set(0, 240, 310);
      this.cameraLookTarget.set(0, 0, 0);

      Object.values(buildingGroups).forEach((group) => {
        group.children.forEach((child) => {
          if (child.userData.isFloor) {
            child.position.y = child.userData.baseY;
            child.visible = true;

            const interior = child.children.find((c) => c.userData.isInteriorDetail);
            if (interior) interior.visible = false;

            const glass = child.children.find((c) => c.userData.isFacadeGlass);
            setGlassOpacity(glass, this.isNightMode ? 0.85 : 0.65);

            const slab = child.children.find((c) => c.userData.isFloorClickable);
            if (slab && slab.material) {
              slab.material.color = new THREE.Color(slab.userData.originalColor);
              slab.material.emissive = new THREE.Color(0x000000);
              slab.material.opacity = 0.95;
            }
          }
        });
      });
    }
  }

  destroy() {
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('resize', this._handleResize);
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.removeEventListener('click', this._onClick);
    }
    if (this.renderer) this.renderer.dispose();
    if (this.controls) this.controls.dispose();
  }
}

window.Township3DScene = Township3DScene;
