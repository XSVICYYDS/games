/**
 * main.js
 * 游戏入口：搭建 Three.js 场景、光照、雾效，装配世界 / 玩家 / 界面，并驱动主循环。
 */
(function (Voxel) {
  'use strict';

  /** 世界与玩法配置：三个维度共用 192×192×192 的立方体空间，星球包在立方体内部 */
  const CONFIG = {
    worldWidth: 192,
    worldDepth: 192,
    worldHeight: 192,
    seed: 20261113,
    spherical: true
  };

  /** 维度展示名称 */
  const DIM_NAMES = { overworld: '主世界', nether: '下界', end: '末地' };
  const DIM_ORDER = ['overworld', 'nether', 'end'];

  /** 天空 / 雾的颜色 */
  const SKY_TOP = 0x2f7fd0;
  const SKY_BOTTOM = 0xcfe7f7;

  const Blocks = Voxel.Blocks;
  const ID = Blocks.ID;

  /** 四种游戏模式的展示信息 */
  const MODE_INFO = {
    survival: { name: '生存', tip: '生命 · 坠落伤害 · 夜间僵尸' },
    creative: { name: '创造', tip: '飞行 · 瞬间破坏 · 免疫伤害' },
    adventure: { name: '冒险', tip: '只能探索与交互，不能破坏方块' },
    spectator: { name: '旁观', tip: '穿墙飞行 · 无法交互' }
  };

  /** 模式循环顺序（M 键） */
  const MODE_ORDER = ['survival', 'creative', 'adventure', 'spectator'];

  /** 一昼夜时长（秒） */
  const DAY_LENGTH = 240;

  /** 浏览器本地存档键与自动保存间隔（秒） */
  const SAVE_KEY = 'voxel-workshop-save-v2';
  const AUTO_SAVE_INTERVAL = 30;
  let autoSaveTimer = 0;

  /** 异界氛围：天空、雾与光照预设（主世界走昼夜循环） */
  const AMBIENCE = {
    nether: {
      top: 0x3a1009, bottom: 0x6b2416, fog: 0x4a180f,
      fogNear: 34, fogFar: 150, sun: 0.5, hemi: 0.55, ambient: 0.24
    },
    end: {
      top: 0x08040f, bottom: 0x241436, fog: 0x150c24,
      fogNear: 32, fogFar: 150, sun: 0.18, hemi: 0.32, ambient: 0.2
    }
  };

  /** 箱子战利品表 */
  const LOOT_TABLE = [
    { name: '面包', min: 1, max: 3 },
    { name: '苹果', min: 1, max: 2 },
    { name: '铁锭', min: 1, max: 2 },
    { name: '煤炭', min: 2, max: 5 },
    { name: '绿宝石', min: 1, max: 2 },
    { name: '火把', min: 2, max: 4 },
    { name: '金锭', min: 1, max: 1 }
  ];

  /** 可搜刮的容器方块名 */
  const CONTAINER_NAMES = ['箱子', '陷阱箱', '木桶', '末影箱', '潜影盒'];

  /** 熔炉类方块名 */
  const FURNACE_NAMES = ['熔炉', '烟熏炉', '高炉'];

  /** 昼夜天空颜色（白天 / 夜晚两套，运行时插值） */
  const DAY_TOP_COLOR = new THREE.Color(SKY_TOP);
  const DAY_BOTTOM_COLOR = new THREE.Color(SKY_BOTTOM);
  const NIGHT_TOP_COLOR = new THREE.Color(0x070f22);
  const NIGHT_BOTTOM_COLOR = new THREE.Color(0x16233b);
  const skyTopColor = new THREE.Color();
  const skyBottomColor = new THREE.Color();

  // ---------------------------------------------------------------- 基础对象
  const canvas = document.getElementById('game');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    document.getElementById('overlay').innerHTML =
      '<div class="panel"><h1>无法启动</h1><p class="sub">当前浏览器不支持 WebGL，请更换 Chrome / Edge 最新版。</p></div>';
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_BOTTOM, 60, 175);

  const camera = new THREE.PerspectiveCamera(
    74,
    window.innerWidth / window.innerHeight,
    0.1,
    600
  );

  // ---------------------------------------------------------------- 光照
  // 半球光提供天空/地面方向的柔和补光
  const hemiLight = new THREE.HemisphereLight(0xdcefff, 0x58663f, 0.42);
  scene.add(hemiLight);

  const ambient = new THREE.AmbientLight(0xffffff, 0.1);
  scene.add(ambient);

  // 主方向光：负责明暗关系和阴影（阴影相机必须对准世界中心，否则只有原点附近有阴影）
  const sunLight = new THREE.DirectionalLight(0xfff3d6, 0.68);
  sunLight.position.set(CONFIG.worldWidth * 0.5 - 70, 150, CONFIG.worldDepth * 0.5 + 55);
  sunLight.target.position.set(CONFIG.worldWidth * 0.5, 16, CONFIG.worldDepth * 0.5);
  sunLight.target.updateMatrixWorld();
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0009;
  sunLight.shadow.normalBias = 0.03;
  const shadowCam = sunLight.shadow.camera;
  const halfSpan = Math.max(CONFIG.worldWidth, CONFIG.worldDepth) * 0.72;
  shadowCam.left = -halfSpan;
  shadowCam.right = halfSpan;
  shadowCam.top = halfSpan;
  shadowCam.bottom = -halfSpan;
  shadowCam.near = 1;
  shadowCam.far = 480;
  shadowCam.updateProjectionMatrix();
  scene.add(sunLight);
  scene.add(sunLight.target);

  /**
   * 创建渐变天空球（跟随相机移动，永远不会被看到边缘）
   * @returns {THREE.Mesh} 天空网格
   */
  function createSky() {
    const geometry = new THREE.SphereGeometry(450, 24, 16);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(SKY_TOP) },
        bottomColor: { value: new THREE.Color(SKY_BOTTOM) },
        offset: { value: 40.0 },
        exponent: { value: 0.75 }
      },
      vertexShader: [
        'varying vec3 vWorldPosition;',
        'void main() {',
        '  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );',
        '  vWorldPosition = worldPosition.xyz;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 topColor;',
        'uniform vec3 bottomColor;',
        'uniform float offset;',
        'uniform float exponent;',
        'varying vec3 vWorldPosition;',
        'void main() {',
        '  float h = normalize( vWorldPosition + vec3( 0.0, offset, 0.0 ) ).y;',
        '  gl_FragColor = vec4( mix( bottomColor, topColor, pow( max( h, 0.0 ), exponent ) ), 1.0 );',
        '}'
      ].join('\n'),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  const sky = createSky();

  // ---------------------------------------------------------------- 游戏对象
  const ui = new Voxel.UI(Voxel.Blocks);

  /** 三个维度的记录：world 方块世界、info 地形信息、mobs/playerState 现场快照 */
  const dims = {};
  /** 读取存档时暂存、等维度首次生成后再应用的快照 */
  const pendingSnapshots = {};

  /**
   * 创建并生成一个维度的球形世界
   * @param {string} key 维度键：overworld / nether / end
   * @returns {object} 维度记录
   */
  function createDimension(key) {
    const w = new Voxel.World(CONFIG);
    w.createChunks();
    const info = Voxel.Terrain.generate(key, w.data, CONFIG);
    const record = {
      key: key,
      world: w,
      info: info,
      mobs: [],
      playerState: null,
      visited: false,
      built: false,
      looted: new Set(),
      plants: null
    };
    record.plants = new Voxel.PlantManager(w, info);
    record.plants.onDrop = function (drops) {
      const text = drops.map(function (d) {
        addPouch(d.name, d.count);
        return d.name + ' ×' + d.count;
      }).join('，');
      ui.toast('植物掉落：' + text);
    };
    record.plants.onNotice = function (text) { ui.toast(text); };
    dims[key] = record;

    // 如果读档时该维度尚未生成，这里补上地形与增量
    const snap = pendingSnapshots[key];
    if (snap) {
      delete pendingSnapshots[key];
      applyDelta(record.world, snap.delta);
      record.world.powered = new Set((snap.powered || []).filter(function (k) {
        return Number.isInteger(k) && k >= 0 && k < record.world.data.length;
      }));
      record.playerState = snap.player || null;
      record.mobs = Array.isArray(snap.mobs) ? snap.mobs : [];
      record.visited = !!snap.visited;
      record.looted = new Set((snap.looted || []).filter(function (k) {
        return Number.isInteger(k) && k >= 0 && k < record.world.data.length;
      }));
    }
    return record;
  }

  /** 当前维度（随传送切换） */
  let world = null;
  let terrainInfo = null;
  let plants = null;
  /** 当前维度的传送门：方块索引 -> 传送门信息 */
  let portalMap = new Map();
  /** 本次加载流程的来源：portal（传送门）或 load（读档），用于结束提示 */
  let travelReason = 'portal';

  /**
   * 重新建立当前维度的传送门索引
   */
  function refreshPortalMap() {
    portalMap = new Map();
    (terrainInfo.portals || []).forEach(function (p) {
      portalMap.set(world.keyOf(p.x, p.y, p.z), p);
    });
  }

  const overworldRecord = createDimension('overworld');
  world = overworldRecord.world;
  terrainInfo = overworldRecord.info;
  plants = overworldRecord.plants;
  const player = new Voxel.Player(camera, world, CONFIG);
  player.plateau = terrainInfo.plateau;
  scene.add(world.group);
  // 主世界出生时面朝村庄（-Z 方向），异界出生时面朝返回传送门
  player.placeAt(terrainInfo.spawn, terrainInfo.dimension === 'overworld' ? Math.PI : 0, -0.12);
  refreshPortalMap();


  // 视线选中的方块高亮：半透明白色罩 + 深色描边，保证任何地形上都清晰可见
  const highlight = new THREE.Group();
  highlight.add(new THREE.Mesh(
    new THREE.BoxGeometry(1.006, 1.006, 1.006),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false
    })
  ));
  highlight.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
    new THREE.LineBasicMaterial({ color: 0x0d1116, transparent: true, opacity: 0.85 })
  ));
  highlight.visible = false;
  scene.add(highlight);

  // ---------------------------------------------------------------- 状态
  const state = {
    mode: 'loading', // loading | travel | menu | playing | inventory | interact | paused
    selected: 0,
    shadowOn: true,
    digHeld: false,
    digKey: -1,
    digProgress: 0,

    /** 当前维度：overworld / nether / end */
    dimension: 'overworld',
    /** 当前游戏模式：survival / creative / adventure / spectator */
    gameMode: 'survival',
    /** 生命值（仅生存/冒险使用） */
    health: 20,
    maxHealth: 20,
    /** 昼夜相位：0 为 06:00 日出，0.25 为正午，0.5 为 18:00，0.75 为午夜 */
    timePhase: 0.02,
    isNight: false,
    clockText: '06:30 · 白天',
    /** 回血计时器 */
    regenTimer: 0,
    /** 随身物资：物资名 -> 数量（挖掘、箱子、村民交易共用） */
    pouch: { '木材': 6, '石料': 6, '煤炭': 4, '面包': 2 },
    /** 已搜刮过的箱子（世界索引） */
    looted: new Set(),
    /** 双击空格计时 */
    lastSpaceTap: 0,

    /** 手持模式：block 方块 / item 武器 */
    held: 'block',
    /** 武器模式选中的下标 */
    itemIndex: 0,
    /** 各武器剩余耐久：武器键 -> 耐久值 */
    itemDurability: {},
    /** 箭矢数量 */
    arrows: 12,
    /** 近战攻击冷却剩余时间（秒） */
    attackCd: 0,
    /** 弓是否正在蓄力 */
    bowCharging: false,
    /** 当前蓄力比例 0~1 */
    bowCharge: 0
  };

  const input = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    down: false
  };

  /** 手机输入现场：每种触点独立编号，避免移动、视角与动作互相抢占 */
  const mobile = {
    auto: navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches,
    enabled: false,
    orientationBlocked: false,
    restoreShadow: true,
    joystickPointer: null,
    joyX: 0,
    joyY: 0,
    joyRadius: 1,
    lookPointer: null,
    lookX: 0,
    lookY: 0,
    actionPointers: new Map(),
    el: {}
  };

  // ---------------------------------------------------------------- 生物
  const mobs = new Voxel.MobManager(scene, world, CONFIG, Blocks, player);
  mobs.dimension = 'overworld';
  mobs.spawnInitial(terrainInfo);
  overworldRecord.visited = true;
  mobs.onPlayerDamage = function (damage, mob) {
    applyDamage(damage, mob);
  };
  mobs.onMobKilled = function (def) {
    if (def.food) {
      addPouch('食物', def.food);
      ui.toast(def.name + ' 掉落了食物 ×' + def.food);
    } else if (def.hostile) {
      addPouch('腐肉', 1);
      ui.toast('僵尸掉落了腐肉 ×1');
    } else {
      ui.toast(def.name + ' 已被击败');
    }
  };
  // 坠落伤害：落地速度超过阈值才扣血
  player.onLand = function (speed) {
    if (state.gameMode !== 'survival') return;
    const damage = Math.min(18, Math.round((-speed - 12) * 0.85));
    if (damage > 0) applyDamage(damage);
  };

  /** 箭矢系统：负责生成、飞行、命中与回收 */
  const arrows = new Voxel.ArrowSystem(scene, world, mobs, player);
  arrows.onRecover = function (count) {
    state.arrows += count;
    ui.toast('回收箭矢 ×' + count + '（当前 ' + state.arrows + '）');
    updateHandUI();
  };
  arrows.onHit = function (mob, damage, killed) {
    if (!killed) ui.toast('箭矢命中 ' + mob.def.name + ' -' + damage);
  };

  /**
   * 向随身物资中添加物品
   * @param {string} name 物资名
   * @param {number} count 数量
   */
  function addPouch(name, count) {
    state.pouch[name] = (state.pouch[name] || 0) + count;
  }

  /**
   * 消耗随身物资
   * @param {string} name 物资名
   * @param {number} count 数量
   * @returns {boolean} 是否成功扣除
   */
  function takePouch(name, count) {
    if ((state.pouch[name] || 0) < count) return false;
    state.pouch[name] -= count;
    if (state.pouch[name] <= 0) delete state.pouch[name];
    return true;
  }

  /**
   * 清空所有按键状态（失焦 / 暂停时调用，避免"卡键"）
   */
  function resetInput() {
    for (const key in input) input[key] = false;
    resetMobileControls();
    stopBowCharge(false);
    state.attackCd = 0;
    resetDig();
  }

  /**
   * 停止挖掘并清空进度条（失焦、暂停、切换界面时调用）
   */
  function resetDig() {
    state.digHeld = false;
    state.digKey = -1;
    state.digProgress = 0;
    ui.setDigProgress(0, false);
  }

  /**
   * 根据方块硬度计算徒手挖掘所需秒数；不可破坏返回 Infinity
   * @param {object} def 方块定义
   * @returns {number} 挖掘耗时（秒）
   */
  function digTimeFor(def) {
    if (!def || !def.breakable) return Infinity;
    const hardness = Math.max(0, def.hardness || 0);
    return Math.min(2.6, 0.12 + hardness * 0.22);
  }

  /**
   * 切换方块（完整下标，自动循环并同步分页）
   * @param {number} index 方块下标
   */
  function selectSlot(index) {
    const count = Blocks.HOTBAR.length;
    state.selected = ((index % count) + count) % count;
    ui.setSelected(state.selected);
  }

  /**
   * 选择当前页的第几格（数字键 1~9）
   * @param {number} slot 页内槽位 0~8
   */
  function selectPageSlot(slot) {
    const page = Math.floor(state.selected / Blocks.PAGE_SIZE);
    const index = page * Blocks.PAGE_SIZE + slot;
    if (index < Blocks.HOTBAR.length) selectSlot(index);
  }

  /**
   * 翻页并选中新页第一格
   * @param {number} dir +1 下一页 / -1 上一页
   */
  function flipPage(dir) {
    const pages = Math.ceil(Blocks.HOTBAR.length / Blocks.PAGE_SIZE);
    const page = Math.floor(state.selected / Blocks.PAGE_SIZE);
    const next = ((page + dir) % pages + pages) % pages;
    selectSlot(next * Blocks.PAGE_SIZE);
    ui.toast('第 ' + (next + 1) + ' / ' + pages + ' 页');
  }

  // ---------------------------------------------------------------- 手持武器
  /**
   * 当前手持武器定义；方块模式返回 null
   * @returns {object|null} 武器定义
   */
  function currentWeapon() {
    if (state.held !== 'item') return null;
    return Voxel.Weapons.LIST[state.itemIndex] || null;
  }

  /**
   * 读取武器剩余耐久，未记录时视为满耐久
   * @param {object} def 武器定义
   * @returns {number} 剩余耐久
   */
  function durabilityOf(def) {
    if (!def) return 0;
    const value = state.itemDurability[def.key];
    return typeof value === 'number' ? value : def.durability;
  }

  /**
   * 消耗武器耐久；耗尽时提示失效，创造模式不消耗
   * @param {object} def 武器定义
   * @param {number} [amount] 消耗点数
   * @returns {number} 剩余耐久
   */
  function useDurability(def, amount) {
    if (!def || !def.durability) return 0;
    if (state.gameMode === 'creative') return durabilityOf(def);
    const left = Math.max(0, durabilityOf(def) - (amount || 1));
    state.itemDurability[def.key] = left;
    if (left === 0) ui.toast(def.name + ' 耐久耗尽，已无法造成有效伤害');
    return left;
  }

  /**
   * 刷新手持信息面板、快捷栏以及手机动作按钮文字
   */
  function updateHandUI() {
    const def = currentWeapon();
    if (def) {
      ui.renderItems(Voxel.Weapons.LIST, state.itemIndex);
      ui.setHandStatus({
        label: def.name,
        durability: durabilityOf(def),
        maxDurability: def.durability,
        arrows: state.arrows,
        itemMode: true
      });
    } else {
      ui.setSelected(state.selected);
      const blockDef = Blocks.DEF[Blocks.HOTBAR[state.selected]];
      ui.setHandStatus({
        label: blockDef ? blockDef.name : '空',
        durability: 0,
        maxDurability: 0,
        arrows: state.arrows,
        itemMode: false
      });
    }
    if (mobile.el && mobile.el.use && mobile.el.dig) {
      const bow = !!def && def.kind === 'bow';
      mobile.el.use.textContent = bow ? '射箭' : '交互';
      mobile.el.dig.textContent = def ? '攻击' : '挖掘';
    }
  }

  /**
   * 切换手持模式：方块 <-> 武器
   * @param {'block'|'item'} mode 目标模式
   */
  function setHeldMode(mode) {
    if (mode !== 'block' && mode !== 'item') return;
    if (mode === state.held) return;
    state.held = mode;
    resetDig();
    stopBowCharge(false);
    ui.setHandMode(mode);
    updateHandUI();
    if (mode === 'item') {
      const def = currentWeapon();
      ui.toast('武器模式：' + def.name + ' · Q / 点击按钮切回方块 · 末页有弓');
    } else {
      ui.toast('方块模式：可继续放置与挖掘');
    }
  }

  /**
   * 选择武器槽位
   * @param {number} slot 武器下标
   */
  function selectItem(slot) {
    const count = Voxel.Weapons.LIST.length;
    state.itemIndex = ((slot % count) + count) % count;
    stopBowCharge(false);
    updateHandUI();
  }

  /**
   * 武器快捷栏翻页
   * @param {number} dir +1 下一页 / -1 上一页
   */
  function flipItemPage(dir) {
    const perPage = Blocks.PAGE_SIZE;
    const count = Voxel.Weapons.LIST.length;
    const pages = Math.ceil(count / perPage);
    const page = Math.floor(state.itemIndex / perPage);
    const next = ((page + dir) % pages + pages) % pages;
    selectItem(next * perPage);
    ui.toast('武器第 ' + (next + 1) + ' / ' + pages + ' 页');
  }

  /**
   * 开始拉弓：仅武器模式、手持弓、有箭且弓未损坏时生效
   * @returns {boolean} 是否开始蓄力
   */
  function startBowCharge() {
    const def = currentWeapon();
    if (!def || def.kind !== 'bow') return false;
    if (state.arrows <= 0) {
      ui.toast('没有箭了，无法射击');
      return false;
    }
    if (durabilityOf(def) <= 0) {
      ui.toast('弓已损坏，无法使用');
      return false;
    }
    state.bowCharging = true;
    state.bowCharge = 0;
    ui.setBowCharge(0, true);
    return true;
  }

  /**
   * 结束拉弓；fire 为 true 时按当前蓄力发射箭矢
   * @param {boolean} fire 是否射出
   * @returns {boolean} 是否射出
   */
  function stopBowCharge(fire) {
    if (!state.bowCharging) return false;
    const def = currentWeapon();
    const power = state.bowCharge;
    state.bowCharging = false;
    state.bowCharge = 0;
    ui.setBowCharge(0, false);
    if (!fire || !def || def.kind !== 'bow') return false;
    if (state.arrows <= 0) return false;
    const ray = aimRay();
    const origin = camera.position.clone().addScaledVector(ray.dir, 0.6);
    arrows.shoot(origin, ray.dir, power);
    state.arrows--;
    const left = useDurability(def, 1);
    state.attackCd = Math.max(state.attackCd, def.cooldown);
    ui.toast('射箭 · 蓄力 ' + Math.round(power * 100) + '% · 伤害 ' +
      Math.round(Voxel.Weapons.BOW.minDamage +
        (Voxel.Weapons.BOW.maxDamage - Voxel.Weapons.BOW.minDamage) * power) +
      (left > 0 ? '' : ' · 弓已损坏'));
    updateHandUI();
    return true;
  }

  // ---------------------------------------------------------------- 游戏模式与昼夜
  /**
   * 切换游戏模式并同步玩家能力、HUD 与开始界面按钮
   * @param {string} mode 模式键：survival / creative / adventure / spectator
   */
  function setGameMode(mode) {
    const info = MODE_INFO[mode];
    if (!info) return;
    state.gameMode = mode;
    // 旁观：完全穿墙；创造：可双击空格开关飞行；其余模式禁止飞行
    player.noclip = mode === 'spectator';
    player.flying = false;
    if (mode !== 'survival' && mode !== 'adventure') {
      state.health = state.maxHealth;
    }
    resetDig();
    ui.setMode(mode, info.name);
    ui.setHealth(state.health, state.maxHealth);
    document.querySelectorAll('#mode-select .mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    ui.toast('已切换为' + info.name + '模式 · ' + info.tip);
  }

  /**
   * 按固定顺序循环切换模式（M 键）
   */
  function cycleGameMode() {
    const index = MODE_ORDER.indexOf(state.gameMode);
    setGameMode(MODE_ORDER[(index + 1) % MODE_ORDER.length]);
  }

  /**
   * 对玩家造成伤害（仅生存模式生效）
   * @param {number} amount 伤害值
   * @param {object} [source] 伤害来源生物
   */
  function applyDamage(amount, source) {
    if (state.gameMode !== 'survival' || state.health <= 0) return;
    const damage = Math.max(1, Math.round(amount));
    state.health = Math.max(0, state.health - damage);
    ui.setHealth(state.health, state.maxHealth);
    if (source && source.def) ui.toast('受到 ' + source.def.name + ' 攻击 -' + damage);
    else ui.toast('受到坠落伤害 -' + damage);
    if (state.health <= 0) respawnPlayer(true);
  }

  /**
   * 死亡或掉出世界后在出生点复活
   * @param {boolean} died 是否为死亡复活
   */
  function respawnPlayer(died) {
    state.health = state.maxHealth;
    state.regenTimer = 2;
    player.placeAt(terrainInfo.spawn, terrainInfo.dimension === 'overworld' ? Math.PI : 0, -0.12);
    ui.setHealth(state.health, state.maxHealth);
    ui.toast(died ? '你倒下了，已在出生点复活' : '已回到出生点');
  }

  /**
   * 生存模式自动进食回血：优先面包，其次食物
   * @param {number} dt 帧间隔（秒）
   */
  function updateSurvivalRegen(dt) {
    if (state.gameMode !== 'survival' || state.health <= 0 || state.health >= state.maxHealth) return;
    state.regenTimer -= dt;
    if (state.regenTimer > 0) return;
    if (takePouch('面包', 1)) {
      state.health = Math.min(state.maxHealth, state.health + 4);
      ui.toast('吃了一个面包，回复 4 点生命');
    } else if (takePouch('食物', 1)) {
      state.health = Math.min(state.maxHealth, state.health + 2);
    } else {
      return;
    }
    state.regenTimer = 6;
    ui.setHealth(state.health, state.maxHealth);
  }

  /**
   * 推进昼夜循环（主世界）或应用异界固定氛围
   * @param {number} dt 帧间隔（秒）
   */
  function updateDayNight(dt) {
    const cx = CONFIG.worldWidth / 2;
    const cy = CONFIG.worldHeight / 2;
    const cz = CONFIG.worldDepth / 2;

    // 下界 / 末地没有昼夜，使用固定的天空、雾与光照
    if (state.dimension !== 'overworld') {
      const amb = AMBIENCE[state.dimension] || AMBIENCE.end;
      sky.material.uniforms.topColor.value.setHex(amb.top);
      sky.material.uniforms.bottomColor.value.setHex(amb.bottom);
      scene.fog.color.setHex(amb.fog);
      scene.fog.near = amb.fogNear;
      scene.fog.far = amb.fogFar;
      sunLight.position.set(cx + 95, cy + 130, cz - 45);
      sunLight.target.position.set(cx, cy, cz);
      sunLight.target.updateMatrixWorld();
      sunLight.intensity = amb.sun;
      hemiLight.intensity = amb.hemi;
      ambient.intensity = amb.ambient;
      state.isNight = true;
      state.clockText = DIM_NAMES[state.dimension] + (state.dimension === 'nether' ? ' · 熔岩' : ' · 虚空');
      return;
    }

    state.timePhase = (state.timePhase + dt / DAY_LENGTH) % 1;
    const angle = state.timePhase * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    const daylight = Math.max(0, Math.min(1, sunHeight * 1.7 + 0.35));
    state.isNight = daylight < 0.26;

    sunLight.position.set(cx + Math.cos(angle) * 110, cy + 30 + sunHeight * 150, cz + 65);
    sunLight.target.position.set(cx, cy, cz);
    sunLight.target.updateMatrixWorld();
    sunLight.intensity = 0.08 + daylight * 0.7;
    hemiLight.intensity = 0.08 + daylight * 0.4;
    ambient.intensity = 0.05 + daylight * 0.09;

    skyTopColor.copy(NIGHT_TOP_COLOR).lerp(DAY_TOP_COLOR, daylight);
    skyBottomColor.copy(NIGHT_BOTTOM_COLOR).lerp(DAY_BOTTOM_COLOR, daylight);
    sky.material.uniforms.topColor.value.copy(skyTopColor);
    sky.material.uniforms.bottomColor.value.copy(skyBottomColor);
    scene.fog.color.copy(skyBottomColor);
    scene.fog.near = 60;
    scene.fog.far = 175;

    const hours = (6 + state.timePhase * 24) % 24;
    const hh = Math.floor(hours);
    const mm = Math.floor((hours - hh) * 60);
    state.clockText = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm +
      (state.isNight ? ' · 夜晚' : ' · 白天');
  }

  // ---------------------------------------------------------------- 本地存档
  /**
   * 把存档中的增量方块写回世界（世界数据必须已经由地形生成器重建）
   * @param {Voxel.World} w 目标世界
   * @param {number[]} delta 扁平数组 [索引, 方块ID, ...]
   */
  function applyDelta(w, delta) {
    w.delta.clear();
    if (!Array.isArray(delta)) return;
    for (let i = 0; i + 1 < delta.length; i += 2) {
      const index = delta[i];
      const id = delta[i + 1];
      if (!Number.isInteger(index) || index < 0 || index >= w.data.length) continue;
      if (id !== ID.AIR && !Blocks.DEF[id]) continue;
      w.data[index] = id;
    }
  }

  /**
   * 记录当前玩家现场（位置、视角、飞行状态），供切换维度与存档使用
   * @returns {object} 玩家快照
   */
  function snapshotPlayer() {
    return {
      pos: player.pos.toArray(),
      yaw: player.yaw,
      pitch: player.pitch,
      flying: player.flying,
      onGround: player.onGround
    };
  }

  /**
   * 恢复玩家现场；数据缺失时回到当前维度出生点
   * @param {object|null} ps 玩家快照
   */
  function restorePlayerState(ps) {
    if (ps && Array.isArray(ps.pos) && ps.pos.length === 3 && ps.pos.every(Number.isFinite)) {
      player.pos.fromArray(ps.pos);
      player.vel.set(0, 0, 0);
      player.yaw = Number.isFinite(ps.yaw) ? ps.yaw : 0;
      player.pitch = Number.isFinite(ps.pitch) ? ps.pitch : -0.12;
      player.flying = !!ps.flying && (state.gameMode === 'creative' || state.gameMode === 'spectator');
      player.updateUp();
      player.onGround = !!ps.onGround;
      player.syncCamera();
    } else {
      player.placeAt(terrainInfo.spawn, terrainInfo.dimension === 'overworld' ? Math.PI : 0, -0.12);
    }
  }

  /**
   * 把场景中的生物转换成可序列化属性，不包含 Three.js 模型对象
   * @returns {object[]} 生物存档列表
   */
  function snapshotMobs() {
    return mobs.mobs.map(function (m) {
      return {
        type: m.type, x: m.x, y: m.y, z: m.z, targetY: m.targetY,
        homeX: m.homeX, homeZ: m.homeZ, health: m.health, maxHealth: m.maxHealth,
        dirX: m.dirX, dirZ: m.dirZ, moving: m.moving, wanderTimer: m.wanderTimer,
        walkPhase: m.walkPhase, attackCd: m.attackCd, fleeTimer: m.fleeTimer,
        rotationY: m.group.rotation.y
      };
    });
  }

  /**
   * 根据存档重新创建生物模型，并恢复位置、生命与游荡状态
   * @param {object[]} list 生物存档列表
   */
  function restoreMobs(list) {
    for (let i = mobs.mobs.length - 1; i >= 0; i--) mobs.removeAt(i);
    (Array.isArray(list) ? list : []).forEach(function (saved) {
      if (!saved || !Voxel.MOB_DEFS[saved.type] ||
        !Number.isFinite(saved.x) || !Number.isFinite(saved.y) || !Number.isFinite(saved.z)) return;
      const mob = mobs.spawn(saved.type, saved.x, saved.z, saved.y);
      if (!mob) return;
      const numericFields = ['targetY', 'homeX', 'homeZ', 'health', 'maxHealth', 'dirX', 'dirZ',
        'wanderTimer', 'walkPhase', 'attackCd', 'fleeTimer'];
      numericFields.forEach(function (key) {
        if (Number.isFinite(saved[key])) mob[key] = saved[key];
      });
      mob.moving = !!saved.moving;
      if (Number.isFinite(saved.rotationY)) mob.group.rotation.y = saved.rotationY;
      mob.group.position.set(mob.x, mob.y, mob.z);
    });
  }

  /**
   * 刷新开始/暂停界面的存档按钮和时间说明
   * @param {number} [knownTime] 刚刚保存或读取的时间戳
   */
  function refreshSaveControls(knownTime) {
    let hasSave = false;
    let savedAt = Number.isFinite(knownTime) ? knownTime : 0;
    let unavailable = false;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        hasSave = true;
        if (!savedAt) savedAt = JSON.parse(raw).savedAt || 0;
      }
    } catch (err) {
      unavailable = true;
    }
    const busy = state.mode === 'loading' || state.mode === 'travel';
    ui.el.saveBtn.disabled = busy;
    ui.el.loadBtn.disabled = busy || !hasSave;
    if (unavailable) {
      ui.el.saveStatus.textContent = '本地存档不可用或格式异常，请检查浏览器存储权限';
    } else if (hasSave && savedAt > 0) {
      ui.el.saveStatus.textContent = '本地存档：' + new Date(savedAt).toLocaleString('zh-CN', { hour12: false });
    } else {
      ui.el.saveStatus.textContent = '尚无存档 · 游戏中每 30 秒自动保存';
    }
  }

  /**
   * 把某一维度的现场整理成可序列化快照
   * @param {object} record 维度记录
   * @returns {object} 维度快照
   */
  function snapshotDimension(record) {
    const delta = [];
    record.world.delta.forEach(function (id, index) { delta.push(index, id); });
    return {
      delta: delta,
      powered: Array.from(record.world.powered),
      visited: !!record.visited,
      player: record.playerState,
      mobs: record.mobs || [],
      looted: Array.from(record.looted || []),
      plants: record.plants.serialize()
    };
  }

  /**
   * 用存档快照重建某个维度的地形，并恢复方块增量、红石与现场
   * @param {object} record 维度记录
   * @param {object} snap 维度快照
   */
  function applySnapshotToRecord(record, snap) {
    record.world.data.fill(ID.AIR);
    record.info = Voxel.Terrain.generate(record.key, record.world.data, CONFIG);
    applyDelta(record.world, snap.delta);
    record.plants.info = record.info;
    record.plants.restore(snap.plants || null);
    record.world.powered = new Set((snap.powered || []).filter(function (k) {
      return Number.isInteger(k) && k >= 0 && k < record.world.data.length;
    }));
    record.playerState = snap.player || null;
    record.mobs = Array.isArray(snap.mobs) ? snap.mobs : [];
    record.visited = !!snap.visited;
    record.looted = new Set((snap.looted || []).filter(function (k) {
      return Number.isInteger(k) && k >= 0 && k < record.world.data.length;
    }));
    record.built = false;
    record.world.dirtyQueue.length = 0;
    record.world.chunks.forEach(function (chunk) {
      chunk.dirty = true;
      record.world.dirtyQueue.push(chunk);
    });
  }

  /**
   * 保存三个维度的方块增量、玩家现场与全局状态到当前浏览器
   * @param {boolean} [automatic] 是否为自动保存（成功时不弹提示）
   * @returns {boolean} 是否保存成功
   */
  function saveGame(automatic) {
    if (state.mode === 'loading' || state.mode === 'travel') return false;
    const savedAt = Date.now();

    // 当前维度的现场先写入内存快照，保证存档与画面一致
    const current = dims[state.dimension];
    if (current) {
      current.playerState = snapshotPlayer();
      current.mobs = snapshotMobs();
      current.looted = new Set(state.looted);
    }

    const dimensions = {};
    DIM_ORDER.forEach(function (key) {
      if (dims[key]) dimensions[key] = snapshotDimension(dims[key]);
    });

    const save = {
      version: 2,
      savedAt: savedAt,
      config: {
        worldWidth: CONFIG.worldWidth,
        worldHeight: CONFIG.worldHeight,
        worldDepth: CONFIG.worldDepth,
        seed: CONFIG.seed
      },
      dimension: state.dimension,
      state: {
        gameMode: state.gameMode, health: state.health, maxHealth: state.maxHealth,
        timePhase: state.timePhase, regenTimer: state.regenTimer,
        selected: state.selected, shadowOn: state.shadowOn,
        pouch: state.pouch, looted: Array.from(state.looted),
        held: state.held, itemIndex: state.itemIndex,
        itemDurability: state.itemDurability, arrows: state.arrows
      },
      dimensions: dimensions,
      mobSpawnTimer: mobs.spawnTimer
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      refreshSaveControls(savedAt);
      if (!automatic) ui.toast('世界已保存（主世界 / 下界 / 末地）');
      return true;
    } catch (err) {
      ui.toast('保存失败：浏览器存储空间不足或已被禁用');
      return false;
    }
  }

  /**
   * 读取本地存档：重建三个维度的星球，再叠加玩家改动、现场与生物
   * @returns {boolean} 是否读取成功
   */
  function loadGame() {
    if (state.mode === 'loading' || state.mode === 'travel') return false;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        ui.toast('还没有可读取的本地存档');
        return false;
      }
      const save = JSON.parse(raw);
      if (!save || save.version !== 2 || !save.config || !save.state || !save.dimensions ||
        !MODE_INFO[save.state.gameMode] ||
        save.config.worldWidth !== CONFIG.worldWidth ||
        save.config.worldDepth !== CONFIG.worldDepth ||
        save.config.worldHeight !== CONFIG.worldHeight ||
        save.config.seed !== CONFIG.seed) {
        throw new Error('存档版本或世界配置不匹配');
      }

      resetInput();
      ui.hideInventory();
      ui.hideInteract();
      document.body.classList.remove('inventory-open');
      for (let i = mobs.mobs.length - 1; i >= 0; i--) mobs.removeAt(i);
      Object.keys(pendingSnapshots).forEach(function (key) { delete pendingSnapshots[key]; });

      // 已生成的维度立即重建；尚未生成的维度等首次传送时再生成
      DIM_ORDER.forEach(function (key) {
        const snap = save.dimensions[key];
        if (!snap) return;
        const record = dims[key];
        if (!record) {
          pendingSnapshots[key] = snap;
          return;
        }
        applySnapshotToRecord(record, snap);
      });

      const target = dims[save.dimension] || pendingSnapshots[save.dimension]
        ? save.dimension : 'overworld';
      if (!dims[target]) createDimension(target);
      DIM_ORDER.forEach(function (key) {
        if (dims[key] && dims[key].world.group.parent) scene.remove(dims[key].world.group);
      });
      state.dimension = target;
      world = dims[target].world;
      terrainInfo = dims[target].info;
      plants = dims[target].plants;
      player.world = world;
      player.plateau = terrainInfo.plateau;
      mobs.world = world;
      mobs.dimension = target;
      arrows.world = world;
      arrows.clear();
      scene.add(world.group);
      refreshPortalMap();

      setGameMode(save.state.gameMode);
      state.maxHealth = Number.isFinite(save.state.maxHealth) ? Math.max(1, save.state.maxHealth) : 20;
      state.health = Number.isFinite(save.state.health) ?
        Math.max(0, Math.min(state.maxHealth, save.state.health)) : state.maxHealth;
      state.timePhase = Number.isFinite(save.state.timePhase) ?
        ((save.state.timePhase % 1) + 1) % 1 : 0;
      state.regenTimer = Number.isFinite(save.state.regenTimer) ? Math.max(0, save.state.regenTimer) : 0;
      state.lastSpaceTap = 0;
      state.pouch = {};
      const savedPouch = save.state.pouch || {};
      Object.keys(savedPouch).forEach(function (name) {
        if (Number.isFinite(savedPouch[name]) && savedPouch[name] > 0) state.pouch[name] = savedPouch[name];
      });
      const savedLooted = (save.dimensions[target] && save.dimensions[target].looted) || save.state.looted || [];
      state.looted = new Set(savedLooted.filter(function (key) {
        return Number.isInteger(key) && key >= 0 && key < world.data.length;
      }));
      if (dims[target]) dims[target].looted = new Set(state.looted);

      state.shadowOn = save.state.shadowOn !== false;
      renderer.shadowMap.enabled = state.shadowOn;
      DIM_ORDER.forEach(function (key) {
        if (dims[key]) dims[key].world.setShadowEnabled(state.shadowOn);
      });
      selectSlot(Number.isFinite(save.state.selected) ? save.state.selected : 0);
      // 武器与箭矢为可选字段，旧存档缺少时保持默认值
      state.arrows = Number.isFinite(save.state.arrows) ? Math.max(0, save.state.arrows) : state.arrows;
      state.itemDurability = {};
      const savedDur = save.state.itemDurability || {};
      Object.keys(savedDur).forEach(function (weaponKey) {
        if (Number.isFinite(savedDur[weaponKey]) && savedDur[weaponKey] >= 0) {
          state.itemDurability[weaponKey] = savedDur[weaponKey];
        }
      });
      state.itemIndex = Number.isFinite(save.state.itemIndex) ?
        Math.max(0, Math.min(Voxel.Weapons.LIST.length - 1, save.state.itemIndex)) : 0;
      state.held = save.state.held === 'item' ? 'item' : 'block';
      ui.setHandMode(state.held);
      updateHandUI();
      if (Number.isFinite(save.mobSpawnTimer)) mobs.spawnTimer = save.mobSpawnTimer;
      updateDayNight(0);
      ui.setHealth(state.health, state.maxHealth);
      ui.setPouch(state.pouch);

      // 玩家先站到存档位置，区块重建完成后再恢复可操作状态
      restorePlayerState(dims[target].playerState);
      player.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
      travelReason = 'load';
      state.mode = 'travel';
      autoSaveTimer = 0;
      ui.showTravel('正在读取存档', '正在重建' + DIM_NAMES[target] + '的星球表面…');
      refreshSaveControls(save.savedAt);
      return true;
    } catch (err) {
      refreshSaveControls();
      ui.toast('读取失败：' + (err.message || '存档已损坏'));
      return false;
    }
  }

  // ---------------------------------------------------------------- 音效与瞄准
  /** 简单 WebAudio 合成音（音符盒 / 钟） */
  let audioCtx = null;

  /**
   * 播放一个短促的合成音
   * @param {number} freq 频率（Hz）
   * @param {number} duration 时长（秒）
   * @param {string} [type] 波形
   */
  function playTone(freq, duration, type) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch (err) {
      // 浏览器禁止音频时静默降级
    }
  }

  /**
   * 取得当前视线射线
   * @returns {{origin:THREE.Vector3,dir:THREE.Vector3}} 射线
   */
  function aimRay() {
    return {
      origin: camera.position.clone(),
      dir: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    };
  }

  /**
   * 估算射线命中方块的距离
   * @param {{x:number,y:number,z:number}} hit 方块坐标
   * @returns {number} 距离
   */
  function blockDistance(hit) {
    return Math.hypot(
      hit.x + 0.5 - camera.position.x,
      hit.y + 0.5 - camera.position.y,
      hit.z + 0.5 - camera.position.z
    );
  }

  /**
   * 左键攻击：优先命中生物，被方块挡住时不攻击
   * @returns {boolean} 是否命中生物
   */
  function tryAttackMob() {
    if (state.gameMode === 'spectator') return false;
    const ray = aimRay();
    const mobHit = mobs.pick(ray.origin, ray.dir, 4.5);
    if (!mobHit) return false;
    const block = player.raycast(8);
    if (block && mobHit.distance > blockDistance(block) + 0.35) return false;
    // 攻击冷却内吞掉本次点击，避免连点绕过攻速差异
    if (state.attackCd > 0) return true;

    const weapon = currentWeapon();
    const melee = weapon && weapon.kind !== 'bow' ? weapon : null;
    let damage = 2;
    if (state.gameMode === 'creative') {
      damage = 100;
    } else if (melee) {
      damage = durabilityOf(melee) > 0 ? melee.damage : 1;
    }

    // 击退：沿视线水平方向推开被命中的生物
    const mob = mobHit.mob;
    mob.x += ray.dir.x * 0.42;
    mob.z += ray.dir.z * 0.42;
    mob.wanderTimer = 0;

    const killed = mobs.hit(mob, damage);
    if (melee) {
      useDurability(melee, 1);
      state.attackCd = melee.cooldown;
    } else {
      state.attackCd = 0.3;
    }
    if (!killed) {
      ui.toast(melee
        ? melee.name + ' 命中 ' + mob.def.name + ' -' + damage + ' · 耐久 ' + durabilityOf(melee) + '/' + melee.durability
        : '命中 ' + mob.def.name + ' -' + damage);
      updateHandUI();
    }
    return true;
  }

  /**
   * 右键与生物交互：村民打开交易面板
   * @returns {boolean} 是否拦截了本次右键
   */
  function tryInteractMob() {
    const ray = aimRay();
    const mobHit = mobs.pick(ray.origin, ray.dir, 4.5);
    if (!mobHit || mobHit.mob.type !== 'villager') return false;
    const block = player.raycast(8);
    if (block && mobHit.distance > blockDistance(block) + 0.35) return false;
    if (state.gameMode === 'spectator') {
      ui.toast('旁观模式无法与村民交易');
      return true;
    }
    showTradePanel(mobHit.mob);
    return true;
  }

  // ---------------------------------------------------------------- 交互面板
  /**
   * 打开交互面板（会释放鼠标并暂停操作）
   * @param {object} config UI.showInteract 的配置
   */
  function openInteractPanel(config) {
    if (state.mode !== 'playing' && state.mode !== 'interact') return;
    if (state.mode === 'playing') {
      state.mode = 'interact';
      resetInput();
      document.body.classList.add('inventory-open');
      if (document.pointerLockElement) document.exitPointerLock();
    }
    ui.showInteract(config);
    syncMobileUI();
  }

  /**
   * 关闭交互面板
   * @param {boolean} resume true 表示重新锁定鼠标继续游戏
   */
  function closeInteract(resume) {
    ui.hideInteract();
    document.body.classList.remove('inventory-open');
    if (resume) {
      state.mode = 'interact'; // 等待 pointerlockchange 切回 playing
      requestLock();
      setTimeout(function () {
        if (state.mode === 'interact') {
          state.mode = 'paused';
          player.enabled = false;
          ui.showPaused();
        }
      }, 500);
    } else {
      state.mode = 'paused';
      player.enabled = false;
      ui.showPaused();
    }
  }

  /**
   * 箱子 / 木桶 / 末影箱等容器：随机战利品，每只箱子只能搜刮一次
   * @param {{x:number,y:number,z:number}} hit 方块坐标
   * @param {string} name 容器名称
   */
  function showChestPanel(hit, name) {
    const key = world.keyOf(hit.x, hit.y, hit.z);
    const looted = state.looted.has(key);
    const buttons = [];
    if (!looted) {
      buttons.push({
        label: '搜刮箱子',
        primary: true,
        onClick: function () {
          const gained = [];
          for (let i = 0; i < 3; i++) {
            const item = LOOT_TABLE[Math.floor(Math.random() * LOOT_TABLE.length)];
            const count = item.min + Math.floor(Math.random() * (item.max - item.min + 1));
            addPouch(item.name, count);
            gained.push(item.name + ' ×' + count);
          }
          state.looted.add(key);
          ui.toast('获得：' + gained.join('，'));
          showChestPanel(hit, name);
        }
      });
    }
    openInteractPanel({
      title: name,
      desc: looted ? '箱子已经被搜刮一空。' : '村庄里的木箱，装着一些生活物资。',
      lines: looted
        ? ['这只箱子已经空了']
        : ['可能获得：面包、苹果、铁锭、煤炭、绿宝石、火把、金锭'],
      buttons: buttons,
      pouch: state.pouch
    });
  }

  /**
   * 熔炉类方块：把矿石熔炼成锭
   * @param {{x:number,y:number,z:number}} hit 方块坐标
   * @param {string} name 熔炉名称
   */
  function showFurnacePanel(hit, name) {
    const has = function (item, n) { return (state.pouch[item] || 0) >= n; };
    /**
     * 执行一次熔炼
     * @param {string} ore 矿石名
     * @param {string} output 产物名
     * @param {number} count 产物数量
     */
    function smelt(ore, output, count) {
      if (!has(ore, 1)) {
        ui.toast('缺少' + ore);
        return;
      }
      if (!has('煤炭', 1)) {
        ui.toast('缺少煤炭作为燃料');
        return;
      }
      takePouch(ore, 1);
      takePouch('煤炭', 1);
      addPouch(output, count);
      ui.toast('熔炼成功：' + output + ' ×' + count);
      showFurnacePanel(hit, name);
    }

    openInteractPanel({
      title: name,
      desc: '右键矿石方块可把它放进熔炉，每熔炼一次消耗 1 份煤炭。',
      lines: [
        '配方：铁矿石 + 煤炭 → 铁锭',
        '配方：金矿石 + 煤炭 → 金锭',
        '当前煤炭：' + (state.pouch['煤炭'] || 0)
      ],
      buttons: [
        {
          label: '熔炼铁锭（铁矿石 1 + 煤炭 1）',
          primary: true,
          disabled: !has('铁矿石', 1) || !has('煤炭', 1),
          onClick: function () { smelt('铁矿石', '铁锭', 1); }
        },
        {
          label: '熔炼金锭（金矿石 1 + 煤炭 1）',
          disabled: !has('金矿石', 1) || !has('煤炭', 1),
          onClick: function () { smelt('金矿石', '金锭', 1); }
        }
      ],
      pouch: state.pouch
    });
  }

  /**
   * 村民交易面板
   * @param {object} mob 村民生物
   */
  function showTradePanel(mob) {
    const has = function (item, n) { return (state.pouch[item] || 0) >= n; };
    const trade = function (costName, costCount, gainName, gainCount) {
      if (!takePouch(costName, costCount)) {
        ui.toast('物资不足：需要 ' + costName + ' ×' + costCount);
        return;
      }
      addPouch(gainName, gainCount);
      ui.toast('交易完成：' + gainName + ' ×' + gainCount);
      showTradePanel(mob);
    };

    openInteractPanel({
      title: '村民 · 交易',
      desc: '村民打量了一下你的物资，愿意做几笔交易。',
      lines: [
        '村民只认可木材、煤炭与绿宝石',
        '面包与食物可以在受伤后自动食用回血'
      ],
      buttons: [
        {
          label: '8 木材 → 1 绿宝石',
          disabled: !has('木材', 8),
          onClick: function () { trade('木材', 8, '绿宝石', 1); }
        },
        {
          label: '3 煤炭 → 1 绿宝石',
          disabled: !has('煤炭', 3),
          onClick: function () { trade('煤炭', 3, '绿宝石', 1); }
        },
        {
          label: '2 绿宝石 → 6 面包',
          disabled: !has('绿宝石', 2),
          onClick: function () { trade('绿宝石', 2, '面包', 6); }
        },
        {
          label: '5 绿宝石 → 1 铁锭',
          disabled: !has('绿宝石', 5),
          onClick: function () { trade('绿宝石', 5, '铁锭', 1); }
        }
      ],
      pouch: state.pouch
    });
  }

  // ---------------------------------------------------------------- 维度传送
  /**
   * 打开传送门面板
   * @param {object} portal 传送门信息（target / name / 坐标）
   */
  function showPortalPanel(portal) {
    const targetName = DIM_NAMES[portal.target] || portal.target;
    openInteractPanel({
      title: portal.name,
      desc: '门面泛着微光，踏入即可穿越到' + targetName + '。',
      lines: [
        '三个维度各自是一颗独立的球形星球',
        '生命、物资与游戏模式跨维度共享，方块改动各自独立',
        '抵达后在平台南侧可以找到回程传送门'
      ],
      buttons: [{
        label: '前往' + targetName,
        primary: true,
        onClick: function () {
          closeInteract(false);
          beginTravel(portal.target);
        }
      }],
      pouch: state.pouch
    });
  }

  /**
   * 记录当前维度的玩家现场与生物，准备离开
   */
  function saveCurrentDimensionState() {
    const current = dims[state.dimension];
    if (!current) return;
    current.playerState = snapshotPlayer();
    current.mobs = snapshotMobs();
    current.looted = new Set(state.looted);
    for (let i = mobs.mobs.length - 1; i >= 0; i--) mobs.removeAt(i);
  }

  /**
   * 把场景引用切换到目标维度
   * @param {string} key 维度键
   */
  function swapWorldRefs(key) {
    const target = dims[key];
    scene.remove(world.group);
    world = target.world;
    terrainInfo = target.info;
    plants = target.plants;
    player.world = world;
    player.plateau = terrainInfo.plateau;
    mobs.world = world;
    mobs.dimension = key;
    arrows.world = world;
    arrows.clear();
    scene.add(world.group);
    state.dimension = key;
    refreshPortalMap();
    updateDayNight(0);
    ui.setDimension(DIM_NAMES[key], key);
  }

  /**
   * 区块构建完成后真正进入目标维度：恢复玩家与生物
   * @param {string} key 维度键
   */
  function enterDimensionReady(key) {
    const record = dims[key];
    record.built = true;
    restorePlayerState(record.playerState);
    restoreMobs(record.mobs || []);
    if (!record.visited) {
      mobs.spawnInitial(record.info);
      record.visited = true;
    }
    record.looted = new Set(record.looted || []);
    state.looted = new Set(record.looted);
    player.spawnPoint.set(
      record.info.spawn.x, record.info.spawn.y, record.info.spawn.z
    );
    player.enabled = false;
    ui.hideTravel();
    state.mode = 'paused';
    ui.showPaused();
    if (travelReason === 'load') {
      ui.toast('存档读取成功 · 三界、玩家与生物状态已恢复');
    } else {
      ui.toast('已抵达' + DIM_NAMES[key]);
    }
    travelReason = 'portal';
    refreshSaveControls();
  }

  /**
   * 开始维度传送：必要时生成目标星球，再进入分帧构建流程
   * @param {string} key 目标维度键
   * @returns {boolean} 是否开始传送
   */
  function beginTravel(key) {
    if (state.mode === 'loading' || state.mode === 'travel') return false;
    if (!DIM_NAMES[key] || key === state.dimension) return false;

    saveCurrentDimensionState();
    if (!dims[key]) createDimension(key);
    swapWorldRefs(key);

    const record = dims[key];
    if (!record.built) {
      record.world.chunks.forEach(function (chunk) { chunk.dirty = true; });
      record.world.dirtyQueue = record.world.chunks.slice();
      player.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
      travelReason = 'portal';
      state.mode = 'travel';
      ui.showTravel('正在穿越到' + DIM_NAMES[key], '正在构建' + DIM_NAMES[key] + '的星球表面…');
      return true;
    }
    enterDimensionReady(key);
    return true;
  }

  /**
   * 右键方块交互：容器、熔炉、音符盒、钟与说明类方块
   * @param {{x:number,y:number,z:number}} hit 方块坐标
   * @returns {boolean} 是否已处理（true 时不再放置方块）
   */
  function interactBlock(hit) {
    const id = world.getBlock(hit.x, hit.y, hit.z);
    const def = Blocks.DEF[id];
    if (!def) return false;

    // 传送门优先：门面方块由地形生成时登记在 portalMap 中
    const portal = portalMap.get(world.keyOf(hit.x, hit.y, hit.z));
    if (portal) {
      showPortalPanel(portal);
      return true;
    }

    if (CONTAINER_NAMES.indexOf(def.name) >= 0) {
      showChestPanel(hit, def.name);
      return true;
    }
    if (FURNACE_NAMES.indexOf(def.name) >= 0) {
      showFurnacePanel(hit, def.name);
      return true;
    }
    if (def.name === '音符盒') {
      // 音高随方块位置变化，连续摆放能敲出旋律
      const pitch = 220 + ((hit.x * 7 + hit.y * 13 + hit.z * 17) % 12) * 40;
      playTone(pitch, 0.55, 'triangle');
      ui.toast('音符盒：叮（音高 ' + pitch + ' Hz）');
      return true;
    }
    if (def.name === '钟') {
      playTone(196, 1.2, 'sine');
      ui.toast('钟声在村庄里回荡');
      return true;
    }
    if (def.name === '工作台') {
      openInteractPanel({
        title: '工作台',
        desc: '虽然这里没有真正的合成系统，但工作台是村庄生活的中心。',
        lines: ['村民会在这里修理工具、准备食物', '你可以用随身物资与村民交易'],
        pouch: state.pouch
      });
      return true;
    }
    if (def.name === '讲台' || def.name === '书架' || def.name === '錾制书架') {
      openInteractPanel({
        title: def.name,
        desc: '泛黄的纸页记录着这座村庄的历史。',
        lines: [
          '“我们在这里种下第一棵树，也在这里迎来了第一位村民。”',
          '“夜晚不要走远，僵尸会在黑暗中出现。”',
          '“箱子里的物资留给后来的人。”'
        ],
        pouch: state.pouch
      });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 方块交互
  /** 正在燃烧的 TNT 列表：{x,y,z,t,total,mesh} */
  const tntFuses = [];
  /** 爆炸膨胀球特效列表 */
  const effects = [];

  /** TNT 闪烁罩与爆炸球的共享几何体 */
  const tntFlashGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  const blastGeo = new THREE.SphereGeometry(1, 16, 12);

  /**
   * 点燃一个 TNT 方块（同一格不会重复点燃）
   * @param {number} x 方块 x
   * @param {number} y 方块 y
   * @param {number} z 方块 z
   * @param {number} fuse 引信时间（秒）
   */
  function igniteTnt(x, y, z, fuse) {
    if (world.getBlock(x, y, z) !== ID.TNT) return;
    for (let i = 0; i < tntFuses.length; i++) {
      const f = tntFuses[i];
      if (f.x === x && f.y === y && f.z === z) return;
    }
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false
    });
    const mesh = new THREE.Mesh(tntFlashGeo, mat);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    scene.add(mesh);
    tntFuses.push({ x: x, y: y, z: z, t: fuse, total: fuse, mesh: mesh });
    ui.toast('TNT 已点燃，快躲开！');
  }

  /**
   * 生成一次爆炸：球形范围内清除方块（基岩除外），区块重建交给脏区块队列渐进处理
   * @param {number} cx 中心 x
   * @param {number} cy 中心 y
   * @param {number} cz 中心 z
   */
  function explode(cx, cy, cz) {
    const radius = 4.5;
    const r = Math.ceil(radius);
    const radiusSq = radius * radius;

    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          if (y <= 0) continue; // 最底层基岩永不破坏，防止炸穿世界
          const id = world.getBlock(x, y, z);
          if (id === ID.AIR || id === ID.BEDROCK) continue;
          if (id === ID.TNT) {
            // 连锁引爆附近的 TNT
            igniteTnt(x, y, z, 0.25 + Math.random() * 0.35);
            continue;
          }
          world.setBlock(x, y, z, ID.AIR);
        }
      }
    }

    // 爆炸视觉：橙色半透明球快速膨胀并淡出
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff9a3c, transparent: true, opacity: 0.75, depthWrite: false
    });
    const mesh = new THREE.Mesh(blastGeo, mat);
    mesh.position.set(cx + 0.5, cy + 0.5, cz + 0.5);
    mesh.scale.setScalar(0.5);
    scene.add(mesh);
    effects.push({ mesh: mesh, life: 0.45, maxLife: 0.45 });
  }

  /**
   * 每帧更新 TNT 引信闪烁与爆炸特效
   * @param {number} dt 帧间隔（秒）
   */
  function updateEffects(dt) {
    for (let i = tntFuses.length - 1; i >= 0; i--) {
      const f = tntFuses[i];
      f.t -= dt;
      const elapsed = f.total - f.t;
      f.mesh.material.color.setHex(Math.sin(elapsed * 26) > 0 ? 0xff4a3a : 0xffffff);
      f.mesh.scale.setScalar(1 + Math.sin(elapsed * 20) * 0.04);

      if (f.t <= 0) {
        scene.remove(f.mesh);
        f.mesh.material.dispose();
        tntFuses.splice(i, 1);
        world.setBlock(f.x, f.y, f.z, ID.AIR);
        explode(f.x, f.y, f.z);
      }
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.life -= dt;
      const k = 1 - Math.max(e.life, 0) / e.maxLife; // 0 -> 1
      e.mesh.scale.setScalar(0.6 + k * 5.2);
      e.mesh.material.opacity = 0.75 * (1 - k);
      if (e.life <= 0) {
        scene.remove(e.mesh);
        e.mesh.material.dispose();
        effects.splice(i, 1);
      }
    }
  }

  /**
   * 破坏指定坐标的方块并处理掉落提示
   * @param {{x:number,y:number,z:number}} hit 射线命中结果
   * @returns {boolean} 是否成功破坏
   */
  function breakBlockAt(hit) {
    const id = world.getBlock(hit.x, hit.y, hit.z);
    const def = Blocks.DEF[id];
    if (!def) return false;

    if (!def.breakable) {
      ui.toast(def.name + ' 坚不可摧，挖不动');
      return false;
    }

    const plantDrops = plants.isPlant(id) ? plants.getDrops(hit.x, hit.y, hit.z, id) : null;
    world.setBlock(hit.x, hit.y, hit.z, ID.AIR);
    plants.onBlockBroken(hit.x, hit.y, hit.z);
    // 矿石与植物掉落提示（简化的物品系统：名称与数量直接进入随身物资）
    const drops = plantDrops || def.drops;
    if (drops) {
      const text = drops.map(function (d) {
        addPouch(d.name, d.count);
        return d.name + ' ×' + d.count;
      }).join('，');
      ui.toast('掉落：' + text);
    }
    // 木材 / 石料等基础资源用于村民交易；植物使用上面的专用掉落表
    if (!plantDrops) {
      if (def.category === '木材') addPouch('木材', 1);
      else if (def.category === '石材' || def.category === '建筑') addPouch('石料', 1);
      else if (def.name.indexOf('羊毛') >= 0) addPouch('羊毛', 1);
    }
    return true;
  }

  /**
   * 立即挖掘准星指向的方块（调试与自动化接口；实际游戏使用按住进度）
   */
  function breakBlock() {
    if (state.mode !== 'playing') return;
    const hit = player.raycast(8);
    if (!hit) return;
    breakBlockAt(hit);
  }

  /**
   * 按下左键时开始挖掘：记录目标方块并重置进度
   */
  function startDigging() {
    if (state.mode !== 'playing') return;
    const hit = player.raycast(8);
    if (!hit) return;

    // 旁观者不能破坏方块；冒险模式只能探索；创造模式一次点击立即破坏
    if (state.gameMode === 'spectator') {
      ui.toast('旁观模式无法破坏方块');
      return;
    }
    if (state.gameMode === 'adventure') {
      ui.toast('冒险模式无法破坏方块');
      return;
    }
    if (state.gameMode === 'creative') {
      breakBlockAt(hit);
      return;
    }

    const def = Blocks.DEF[world.getBlock(hit.x, hit.y, hit.z)];
    if (!def) return;
    if (!def.breakable) {
      ui.toast(def.liquid ? def.name + ' 是液体，无法直接挖掘' : def.name + ' 坚不可摧，挖不动');
      return;
    }

    state.digHeld = true;
    state.digKey = world.keyOf(hit.x, hit.y, hit.z);
    state.digProgress = 0;
    ui.setDigProgress(0, true);
  }

  /**
   * 右击：点燃 TNT、联动红石、切换功能器件，或在相邻面放置选中方块
   */
  function placeBlock() {
    if (state.mode !== 'playing') return;
    const hit = player.raycast(8);
    if (!hit) return;

    // 旁观者没有任何交互能力
    if (state.gameMode === 'spectator') {
      ui.toast('旁观模式无法交互或放置方块');
      return;
    }

    const targetId = world.getBlock(hit.x, hit.y, hit.z);
    const targetDef = Blocks.DEF[targetId];

    // 右键 TNT 点燃引信
    if (targetId === ID.TNT) {
      igniteTnt(hit.x, hit.y, hit.z, 1.5);
      return;
    }

    // 右键红石切换通电状态（相邻红石一起点亮）
    if (targetId === ID.REDSTONE) {
      const on = !world.isPowered(hit.x, hit.y, hit.z);
      const changed = world.setRedstoneActive(hit.x, hit.y, hit.z, on);
      ui.toast(on
        ? ('红石激活：' + changed + ' 个相连红石点亮')
        : ('红石熄灭：' + changed + ' 个方块复位'));
      return;
    }

    // 箱子 / 熔炉 / 村民告示等方块交互
    if (interactBlock(hit)) return;

    // 熔炉、灯具、活塞等可切换器件：右键切换独立亮态纹理
    if (targetDef && targetDef.toggleable) {
      const on = !world.isPowered(hit.x, hit.y, hit.z);
      world.setPowered(hit.x, hit.y, hit.z, on);
      ui.toast(targetDef.name + (on ? '：已激活' : '：已熄灭'));
      return;
    }

    // 冒险模式只能探索与交互，不能放置方块
    if (state.gameMode === 'adventure') {
      ui.toast('冒险模式无法放置方块');
      return;
    }

    const x = hit.x + hit.normal[0];
    const y = hit.y + hit.normal[1];
    const z = hit.z + hit.normal[2];
    if (y < 0 || y >= CONFIG.worldHeight) return;
    if (x < 0 || x >= CONFIG.worldWidth || z < 0 || z >= CONFIG.worldDepth) return;

    const existing = world.getBlock(x, y, z);
    if (existing !== ID.AIR && existing !== ID.WATER) return; // 水可以被新方块替换

    const selId = Blocks.HOTBAR[state.selected];
    const selDef = Blocks.DEF[selId];
    if (selDef.solid && player.intersectsBlock(x, y, z)) return; // 不允许把固体方块放进自己身体里
    const support = plants.canPlace(selId, x, y, z);
    if (!support.ok) {
      ui.toast(support.reason);
      return;
    }

    world.setBlock(x, y, z, selId);
    plants.onPlaced(x, y, z, selId);
  }

  /**
   * 打开背包面板（释放鼠标，画面保留在当前场景）
   */
  function openInventory() {
    if (state.mode !== 'playing') return;
    state.mode = 'inventory';
    resetInput();
    ui.showInventory();
    document.body.classList.add('inventory-open');
    if (document.pointerLockElement) document.exitPointerLock();
    syncMobileUI();
  }

  /**
   * 关闭背包面板
   * @param {boolean} resume true 表示重新锁定鼠标继续游戏
   */
  function closeInventory(resume) {
    ui.hideInventory();
    document.body.classList.remove('inventory-open');
    if (resume) {
      state.mode = 'inventory'; // 等待 pointerlockchange 切回 playing
      requestLock();
      // 用户取消锁定时兜底回到暂停界面，避免状态卡死
      setTimeout(function () {
        if (state.mode === 'inventory') {
          state.mode = 'paused';
          player.enabled = false;
          ui.showPaused();
        }
      }, 500);
    } else {
      state.mode = 'paused';
      player.enabled = false;
      ui.showPaused();
    }
  }

  // ---------------------------------------------------------------- 指针锁定
  /**
   * 请求指针锁定，成功后会触发 pointerlockchange 进入游戏
   */
  function requestLock() {
    if (state.mode === 'loading') return;
    if (mobile.enabled) {
      enterPlaying();
      return;
    }
    if (!canvas.requestPointerLock) {
      ui.setError('当前浏览器不支持指针锁定 API，请使用桌面版 Chrome / Edge。');
      return;
    }
    canvas.requestPointerLock();
  }

  document.addEventListener('pointerlockchange', function () {
    const locked = document.pointerLockElement === canvas;
    if (mobile.enabled) {
      if (locked) document.exitPointerLock();
      return;
    }
    if (locked) {
      enterPlaying();
    } else if (state.mode === 'playing') {
      state.mode = 'paused';
      player.enabled = false;
      resetInput();
      ui.showPaused();
    }
  });

  document.addEventListener('pointerlockerror', function () {
    if (!mobile.enabled) {
      ui.setError('浏览器拒绝了指针锁定。请改用本地静态服务器（python -m http.server）打开，并点击页面空白处后重试。');
    }
  });

  document.getElementById('start-btn').addEventListener('click', function (e) {
    e.preventDefault();
    requestLock();
  });
  ui.el.saveBtn.addEventListener('click', function (e) {
    e.preventDefault();
    saveGame(false);
  });
  ui.el.loadBtn.addEventListener('click', function (e) {
    e.preventDefault();
    loadGame();
  });

  // ---------------------------------------------------------------- 输入事件
  document.addEventListener('keydown', function (e) {
    // 搜索框输入时不触发游戏快捷键；Escape 仍可退出背包
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (typing && e.code !== 'Escape') return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': input.forward = true; break;
      case 'KeyS': case 'ArrowDown': input.back = true; break;
      case 'KeyA': case 'ArrowLeft': input.left = true; break;
      case 'KeyD': case 'ArrowRight': input.right = true; break;
      case 'Space':
        input.jump = true;
        e.preventDefault();
        // 创造模式双击空格开关飞行
        if (state.gameMode === 'creative') {
          const now = performance.now();
          if (now - state.lastSpaceTap < 300) {
            player.flying = !player.flying;
            state.lastSpaceTap = 0;
            ui.toast(player.flying ? '创造飞行：开（空格上升 / Ctrl 下降）' : '创造飞行：关');
          } else {
            state.lastSpaceTap = now;
          }
        }
        break;
      case 'ShiftLeft': case 'ShiftRight': input.sprint = true; break;
      case 'ControlLeft': case 'ControlRight': case 'KeyC': input.down = true; break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
      case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
        if (state.held === 'item') {
          selectItem(Math.floor(state.itemIndex / Blocks.PAGE_SIZE) * Blocks.PAGE_SIZE +
            parseInt(e.code.slice(5), 10) - 1);
        } else {
          selectPageSlot(parseInt(e.code.slice(5), 10) - 1);
        }
        break;
      case 'Tab':
        if (state.mode === 'playing' || state.mode === 'inventory') {
          e.preventDefault();
          if (state.held === 'item') flipItemPage(e.shiftKey ? -1 : 1);
          else flipPage(e.shiftKey ? -1 : 1);
        }
        break;
      case 'KeyQ':
        if (state.mode === 'playing' || state.mode === 'paused' || state.mode === 'inventory') {
          setHeldMode(state.held === 'block' ? 'item' : 'block');
        }
        break;
      case 'KeyE':
        if (state.mode === 'playing') openInventory();
        else if (state.mode === 'inventory') closeInventory(true);
        break;
      case 'PageDown':
        if (state.mode === 'inventory') { e.preventDefault(); ui.flipInventory(1); }
        break;
      case 'PageUp':
        if (state.mode === 'inventory') { e.preventDefault(); ui.flipInventory(-1); }
        break;
      case 'Escape':
        if (state.mode === 'inventory') closeInventory(false);
        else if (state.mode === 'interact') closeInteract(false);
        break;
      case 'KeyM':
        if (state.mode === 'playing' || state.mode === 'paused' || state.mode === 'menu') {
          cycleGameMode();
        }
        break;
      case 'KeyF': toggleShadow(); break;
      case 'F5':
        e.preventDefault();
        saveGame(false);
        break;
      case 'F9':
        e.preventDefault();
        loadGame();
        break;
      default: break;
    }
  });

  document.addEventListener('keyup', function (e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': input.forward = false; break;
      case 'KeyS': case 'ArrowDown': input.back = false; break;
      case 'KeyA': case 'ArrowLeft': input.left = false; break;
      case 'KeyD': case 'ArrowRight': input.right = false; break;
      case 'Space': input.jump = false; break;
      case 'ShiftLeft': case 'ShiftRight': input.sprint = false; break;
      case 'ControlLeft': case 'ControlRight': case 'KeyC': input.down = false; break;
      default: break;
    }
  });

  document.addEventListener('mousemove', function (e) {
    if (state.mode !== 'playing' || document.pointerLockElement !== canvas) return;
    player.look(e.movementX || 0, e.movementY || 0);
  });

  canvas.addEventListener('mousedown', function (e) {
    if (mobile.enabled || state.mode !== 'playing') return;
    if (e.button === 0) {
      // 先尝试攻击生物，没打中再进入方块挖掘
      if (tryAttackMob()) return;
      startDigging();
    } else if (e.button === 2) {
      // 武器模式手持弓时右键拉弓，其余情况保留原交互逻辑
      if (startBowCharge()) return;
      if (tryInteractMob()) return;
      placeBlock();
    }
  });

  document.addEventListener('mouseup', function (e) {
    if (mobile.enabled) return;
    if (e.button === 0) resetDig();
    if (e.button === 2) stopBowCharge(true);
  });

  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  canvas.addEventListener('wheel', function (e) {
    if (state.mode !== 'playing' && state.mode !== 'inventory') return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    if (state.held === 'item') selectItem(state.itemIndex + dir);
    else selectSlot(state.selected + dir);
  }, { passive: false });

  window.addEventListener('blur', resetInput);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state.mode !== 'loading') saveGame(true);
  });
  window.addEventListener('beforeunload', function () {
    if (state.mode !== 'loading') saveGame(true);
  });
  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applyRenderQuality();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateOrientation();
  });

  /**
   * 切换阴影（性能不足时可关闭）
   */
  function toggleShadow() {
    state.shadowOn = !state.shadowOn;
    applyShadowState();
    syncMobileUI();
    ui.toast('阴影：' + (state.shadowOn ? '开' : '关') + (mobile.enabled ? ' · 关闭可提升手机帧率' : ''));
  }

  // ---------------------------------------------------------------- 手机模式与全屏
  /**
   * 直接进入进行中的游戏状态；手机模式无需指针锁定，桌面锁定成功也复用此路径
   */
  function enterPlaying() {
    state.mode = 'playing';
    resetInput();
    player.enabled = !mobile.orientationBlocked;
    player.syncCamera();
    ui.hideInventory();
    ui.hideInteract();
    document.body.classList.remove('inventory-open');
    ui.hideOverlay();
    syncMobileUI();
  }

  /**
   * 同步手机开关、控制层的无障碍状态与按钮高亮
   */
  function syncMobileUI() {
    if (mobile.el.toggle) {
      mobile.el.toggle.classList.toggle('active', mobile.enabled);
      mobile.el.toggle.setAttribute('aria-pressed', String(mobile.enabled));
      mobile.el.toggle.textContent = mobile.enabled ? '手机模式：开' : '手机模式';
    }
    if (mobile.el.controls) {
      const active = mobile.enabled && state.mode === 'playing' && !mobile.orientationBlocked;
      mobile.el.controls.setAttribute('aria-hidden', String(!active));
    }
    if (mobile.el.quality) mobile.el.quality.classList.toggle('active', state.shadowOn);
  }

  /**
   * 把当前阴影设置应用到渲染器和所有已生成维度
   */
  function applyShadowState() {
    renderer.shadowMap.enabled = state.shadowOn;
    DIM_ORDER.forEach(function (key) {
      if (dims[key]) dims[key].world.setShadowEnabled(state.shadowOn);
    });
  }

  /**
   * 按设备模式限制像素比，避免高像素比手机产生过多渲染开销
   */
  function applyRenderQuality() {
    const cap = mobile.enabled ? 1.25 : 1.75;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }

  /**
   * 切换手机模式；桌面可手动预览，关闭后回到原来的指针锁定流程
   * @param {boolean} enabled 是否启用手机控制层
   */
  function setMobileMode(enabled) {
    enabled = !!enabled;
    const changed = mobile.enabled !== enabled;
    if (enabled && !mobile.enabled) mobile.restoreShadow = state.shadowOn;
    mobile.enabled = enabled;
    resetInput();
    document.body.classList.toggle('mobile-mode', enabled);

    if (enabled) state.shadowOn = false;
    else if (changed) state.shadowOn = mobile.restoreShadow;
    applyShadowState();
    applyRenderQuality();

    if (changed && state.mode === 'playing') {
      if (enabled) {
        if (document.pointerLockElement) document.exitPointerLock();
        enterPlaying();
      } else {
        state.mode = 'paused';
        player.enabled = false;
        ui.showPaused();
      }
    }
    updateOrientation();
    ui.setSelected(state.selected);
    syncMobileUI();
  }

  /**
   * 竖屏时阻止操作并显示旋转提示，恢复横屏后自动继续当前状态
   */
  function updateOrientation() {
    const blocked = mobile.enabled && window.innerHeight > window.innerWidth;
    if (blocked && !mobile.orientationBlocked) resetInput();
    mobile.orientationBlocked = blocked;
    document.body.classList.toggle('orientation-blocked', blocked);
    if (state.mode === 'playing') player.enabled = !blocked;
    syncMobileUI();
  }

  /**
   * 更新全屏按钮文字，同时兼容标准与 WebKit 全屏状态
   */
  function updateFullscreenButton() {
    if (!mobile.el.fullscreen) return;
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    mobile.el.fullscreen.textContent = active ? '退出全屏' : '全屏';
    mobile.el.fullscreen.classList.toggle('active', active);
  }

  /**
   * 进入或退出全屏；手机进入后尝试锁定横屏，不支持时保留手动旋转提示
   */
  async function toggleFullscreen() {
    const root = document.documentElement;
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (active) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
        if (screen.orientation && screen.orientation.unlock) {
          try { screen.orientation.unlock(); } catch (ignore) { /* 部分浏览器不允许解锁 */ }
        }
      } else {
        const request = root.requestFullscreen || root.webkitRequestFullscreen;
        if (!request) {
          ui.toast('此浏览器不支持网页全屏，请使用浏览器菜单或系统横屏');
          return;
        }
        await request.call(root);
        if (mobile.enabled && screen.orientation && screen.orientation.lock) {
          try {
            await screen.orientation.lock('landscape');
          } catch (ignore) {
            ui.toast('已全屏；当前浏览器不允许锁定横屏，请手动旋转设备');
          }
        }
      }
    } catch (err) {
      ui.toast('浏览器未允许全屏，请再次点击或使用浏览器全屏菜单');
    }
    updateFullscreenButton();
    updateOrientation();
  }

  /**
   * 清除摇杆方向，不影响其他触点或动作按钮
   */
  function clearJoystickDirections() {
    input.forward = false;
    input.back = false;
    input.left = false;
    input.right = false;
  }

  /**
   * 释放摇杆并复位摇杆帽和方向输入
   */
  function resetJoystick() {
    mobile.joystickPointer = null;
    clearJoystickDirections();
    if (mobile.el.stick) mobile.el.stick.style.transform = 'translate(0px, 0px)';
    if (mobile.el.joystick) mobile.el.joystick.classList.remove('active');
  }

  /**
   * 清空所有手机触点及按压反馈，供暂停、背包和失焦统一调用
   */
  function resetMobileControls() {
    mobile.lookPointer = null;
    mobile.actionPointers.clear();
    resetJoystick();
    input.jump = false;
    input.down = false;
    if (mobile.el.actionButtons) {
      mobile.el.actionButtons.forEach(function (button) { button.classList.remove('pressed'); });
    }
  }

  /**
   * 根据触点位置更新八方向摇杆；中心死区内不移动，方向按 45° 吸附
   * @param {PointerEvent} e 摇杆触点事件
   */
  function updateJoystick(e) {
    if (e.pointerId !== mobile.joystickPointer) return;
    const dx = e.clientX - mobile.joyX;
    const dy = e.clientY - mobile.joyY;
    const distance = Math.hypot(dx, dy);
    const nx = distance > 0 ? dx / distance : 0;
    const ny = distance > 0 ? dy / distance : 0;
    const visualDistance = Math.min(distance, mobile.joyRadius * 0.58);
    mobile.el.stick.style.transform = 'translate(' + (nx * visualDistance) + 'px, ' + (ny * visualDistance) + 'px)';

    clearJoystickDirections();
    if (distance < mobile.joyRadius * 0.18) return;
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const x = Math.round(Math.cos(angle));
    const y = Math.round(Math.sin(angle));
    input.right = x > 0;
    input.left = x < 0;
    input.back = y > 0;
    input.forward = y < 0;
  }

  /**
   * 捕获摇杆触点并缓存中心，后续移动不再重复读取布局
   * @param {PointerEvent} e 指针按下事件
   */
  function onJoystickDown(e) {
    if (!mobile.enabled || state.mode !== 'playing' || mobile.orientationBlocked || mobile.joystickPointer !== null) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = mobile.el.joystick.getBoundingClientRect();
    mobile.joystickPointer = e.pointerId;
    mobile.joyX = rect.left + rect.width * 0.5;
    mobile.joyY = rect.top + rect.height * 0.5;
    mobile.joyRadius = rect.width * 0.5;
    mobile.el.joystick.classList.add('active');
    mobile.el.joystick.setPointerCapture(e.pointerId);
    updateJoystick(e);
  }

  /**
   * 处理摇杆拖动并阻止浏览器滚动手势
   * @param {PointerEvent} e 指针移动事件
   */
  function onJoystickMove(e) {
    if (e.pointerId !== mobile.joystickPointer) return;
    e.preventDefault();
    updateJoystick(e);
  }

  /**
   * 处理摇杆松开、取消或捕获丢失
   * @param {PointerEvent} e 指针结束事件
   */
  function onJoystickEnd(e) {
    if (e.pointerId !== mobile.joystickPointer) return;
    e.preventDefault();
    resetJoystick();
  }

  /**
   * 根据仍在按压的动作触点同步跳跃、下蹲、挖掘与按钮反馈
   */
  function syncMobileActionState() {
    let jump = false;
    let down = false;
    let digging = false;
    mobile.actionPointers.forEach(function (action) {
      if (action === 'jump') jump = true;
      else if (action === 'down') down = true;
      else if (action === 'dig') digging = true;
    });
    input.jump = jump;
    input.down = down;
    if (!digging) resetDig();
    mobile.el.actionButtons.forEach(function (button) {
      const action = button.dataset.action;
      let pressed = false;
      mobile.actionPointers.forEach(function (value) {
        if (value === action) pressed = true;
      });
      button.classList.toggle('pressed', pressed);
    });
  }

  /**
   * 动作按钮按下：跳跃/下蹲可持续，挖掘长按，交互每次触发一次
   * @param {PointerEvent} e 动作触点事件
   */
  function onMobileActionDown(e) {
    if (!mobile.enabled || state.mode !== 'playing' || mobile.orientationBlocked) return;
    e.preventDefault();
    e.stopPropagation();
    const button = e.currentTarget;
    const action = button.dataset.action;
    mobile.actionPointers.set(e.pointerId, action);
    button.setPointerCapture(e.pointerId);
    if (action === 'dig') {
      if (!tryAttackMob()) startDigging();
    } else if (action === 'use') {
      // 手持弓时按住为蓄力，其余情况保持交互/放置
      if (!startBowCharge()) {
        if (!tryInteractMob()) placeBlock();
      }
    }
    syncMobileActionState();
  }

  /**
   * 释放动作触点，只结束该触点对应的动作，不影响其他手指
   * @param {PointerEvent} e 动作结束事件
   */
  function onMobileActionEnd(e) {
    if (!mobile.actionPointers.has(e.pointerId)) return;
    const action = mobile.actionPointers.get(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
    mobile.actionPointers.delete(e.pointerId);
    if (action === 'use') stopBowCharge(true);
    syncMobileActionState();
  }

  /**
   * 在右侧空白画布按下后开始滑动视角，不触发挖掘或放置
   * @param {PointerEvent} e 画布触点事件
   */
  function onLookDown(e) {
    if (!mobile.enabled || state.mode !== 'playing' || mobile.orientationBlocked || mobile.lookPointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.clientX < window.innerWidth * 0.34) return;
    e.preventDefault();
    mobile.lookPointer = e.pointerId;
    mobile.lookX = e.clientX;
    mobile.lookY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }

  /**
   * 使用触摸偏移旋转第一人称视角，可与摇杆和动作触点并行
   * @param {PointerEvent} e 视角移动事件
   */
  function onLookMove(e) {
    if (e.pointerId !== mobile.lookPointer) return;
    e.preventDefault();
    const dx = e.clientX - mobile.lookX;
    const dy = e.clientY - mobile.lookY;
    mobile.lookX = e.clientX;
    mobile.lookY = e.clientY;
    player.look(dx * 1.2, dy * 1.2);
  }

  /**
   * 结束视角触点并等待下一次滑动
   * @param {PointerEvent} e 视角结束事件
   */
  function onLookEnd(e) {
    if (e.pointerId !== mobile.lookPointer) return;
    e.preventDefault();
    mobile.lookPointer = null;
  }

  /**
   * 绑定全屏、手机开关、摇杆、动作、视角、背包与快捷栏触摸事件
   */
  function initializeMobileControls() {
    mobile.el = {
      controls: document.getElementById('mobile-controls'),
      toggle: document.getElementById('mobile-toggle'),
      fullscreen: document.getElementById('fullscreen-btn'),
      joystick: document.getElementById('mobile-joystick'),
      stick: document.getElementById('mobile-stick'),
      inventory: document.getElementById('mobile-inventory'),
      quality: document.getElementById('mobile-quality'),
      pause: document.getElementById('mobile-pause'),
      use: document.getElementById('mobile-use'),
      dig: document.getElementById('mobile-dig'),
      actionButtons: Array.from(document.querySelectorAll('.mobile-action'))
    };

    mobile.el.toggle.addEventListener('click', function () { setMobileMode(!mobile.enabled); });
    mobile.el.fullscreen.addEventListener('click', toggleFullscreen);
    mobile.el.inventory.addEventListener('click', openInventory);
    mobile.el.quality.addEventListener('click', toggleShadow);
    ui.el.handSwitch.addEventListener('click', function () {
      setHeldMode(state.held === 'block' ? 'item' : 'block');
    });
    mobile.el.pause.addEventListener('click', function () {
      if (state.mode !== 'playing') return;
      state.mode = 'paused';
      player.enabled = false;
      resetInput();
      ui.showPaused();
      syncMobileUI();
    });

    mobile.el.joystick.addEventListener('pointerdown', onJoystickDown);
    mobile.el.joystick.addEventListener('pointermove', onJoystickMove);
    mobile.el.joystick.addEventListener('pointerup', onJoystickEnd);
    mobile.el.joystick.addEventListener('pointercancel', onJoystickEnd);
    mobile.el.joystick.addEventListener('lostpointercapture', onJoystickEnd);
    mobile.el.actionButtons.forEach(function (button) {
      button.addEventListener('pointerdown', onMobileActionDown);
      button.addEventListener('pointerup', onMobileActionEnd);
      button.addEventListener('pointercancel', onMobileActionEnd);
      button.addEventListener('lostpointercapture', onMobileActionEnd);
    });
    canvas.addEventListener('pointerdown', onLookDown);
    canvas.addEventListener('pointermove', onLookMove);
    canvas.addEventListener('pointerup', onLookEnd);
    canvas.addEventListener('pointercancel', onLookEnd);
    canvas.addEventListener('lostpointercapture', onLookEnd);

    ui.el.hotbar.addEventListener('click', function (e) {
      const slot = e.target.closest('.slot');
      if (!slot) return;
      const index = ui.slots.indexOf(slot);
      if (index < 0) return;
      if (state.held === 'item') {
        selectItem(Math.floor(state.itemIndex / Blocks.PAGE_SIZE) * Blocks.PAGE_SIZE + index);
      } else {
        selectPageSlot(index);
      }
    });
    ui.el.hotbarPage.addEventListener('click', function () {
      if (!mobile.enabled || state.mode !== 'playing') return;
      if (state.held === 'item') flipItemPage(1);
      else flipPage(1);
    });
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    window.addEventListener('orientationchange', function () { setTimeout(updateOrientation, 80); });

    setMobileMode(mobile.auto);
    updateFullscreenButton();
  }

  // ---------------------------------------------------------------- 主循环
  let lastTime = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsValue = 0;
  let hudTimer = 0;

  /**
   * 更新准星选中方块的高亮框
   */
  function updateHighlight() {
    if (state.mode !== 'playing') {
      highlight.visible = false;
      return;
    }
    const hit = player.raycast(8);
    if (!hit) {
      highlight.visible = false;
      return;
    }
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }

  /**
   * 采样玩家当前所在群系名称（HUD 显示用）
   * @returns {string} 群系中文名
   */
  function currentBiomeName() {
    const c = terrainInfo.center;
    const dx = player.pos.x - c.x;
    const dy = player.pos.y - c.y;
    const dz = player.pos.z - c.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const elevation = (d - terrainInfo.radius) / 7;
    const code = Voxel.Biomes.sampleSphere(
      state.dimension, dx / d, dy / d, dz / d, elevation, CONFIG
    );
    return Voxel.Biomes.info(state.dimension, code).name;
  }

  /**
   * 每帧调用：加载进度 / 物理 / 渲染 / HUD
   * @param {number} now requestAnimationFrame 时间戳
   */
  function animate(now) {
    requestAnimationFrame(animate);

    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0), 0.05);

    // 加载阶段：每帧构建几个区块，避免长时间白屏
    if (state.mode === 'loading') {
      world.buildSomeChunks(4);
      const total = world.chunks.length;
      const built = world.countBuiltChunks();
      ui.setProgress(built / total, '正在生成区块 ' + built + ' / ' + total);
      if (built >= total) {
        dims.overworld.built = true;
        state.mode = 'menu';
        ui.setReady();
        ui.setDimension(DIM_NAMES.overworld, 'overworld');
        refreshSaveControls();
      }
    } else if (state.mode === 'travel') {
      // 维度传送 / 读档：分帧构建目标星球，避免同步卡死
      world.buildSomeChunks(6);
      const total = world.chunks.length;
      const built = world.countBuiltChunks();
      ui.setTravelProgress(built / total, '正在构建区块 ' + built + ' / ' + total);
      updateDayNight(0);
      if (built >= total) enterDimensionReady(state.dimension);
    } else {
      // 昼夜循环始终推进，暂停时也保留环境变化
      updateDayNight(dt);

      // 按住左键挖掘：按方块硬度累积进度，目标变化或移开视线时重置
      if (state.mode === 'playing' && !mobile.orientationBlocked && state.digHeld) {
        const hit = player.raycast(8);
        const def = hit ? Blocks.DEF[world.getBlock(hit.x, hit.y, hit.z)] : null;
        const time = digTimeFor(def);
        if (!hit || !isFinite(time)) {
          resetDig();
        } else {
          const key = world.keyOf(hit.x, hit.y, hit.z);
          if (key !== state.digKey) {
            state.digKey = key;
            state.digProgress = 0;
          }
          state.digProgress += dt / time;
          if (state.digProgress >= 1) {
            breakBlockAt(hit);
            state.digKey = -1;
            state.digProgress = 0;
            ui.setDigProgress(0, false);
          } else {
            ui.setDigProgress(state.digProgress, true);
          }
        }
      }
      player.update(dt, input);
      world.flushDirtyQueue(2);
      // 生物、TNT 与回血只在游戏进行中推进，暂停/背包时不推进
      if (state.mode === 'playing' && !mobile.orientationBlocked) {
        state.attackCd = Math.max(0, state.attackCd - dt);
        // 弓蓄力：按住时逐步填满，松开由输入事件发射
        if (state.bowCharging) {
          state.bowCharge = Math.min(1, state.bowCharge + dt / Voxel.Weapons.BOW.chargeTime);
          ui.setBowCharge(state.bowCharge, true);
        }
        arrows.update(dt);
        autoSaveTimer += rawDt;
        if (autoSaveTimer >= AUTO_SAVE_INTERVAL) {
          autoSaveTimer = 0;
          saveGame(true);
        }
        mobs.update(dt, {
          isNight: state.isNight,
          gameMode: state.gameMode,
          playerAlive: state.health > 0
        });
        updateSurvivalRegen(dt);
        plants.update(dt);
        updateEffects(dt);
      }
      updateHighlight();
    }

    // 天空球跟随相机，保证始终包裹场景
    sky.position.copy(camera.position);
    renderer.render(scene, camera);

    // FPS 统计（每 0.5 秒刷新一次）
    fpsAccum += rawDt;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      fpsValue = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }

    // HUD 每 0.2 秒刷新，减少 DOM 操作
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.2;
      ui.updateHud(player.pos, fpsValue, world.getTotalFaces(), {
        health: state.health,
        maxHealth: state.maxHealth,
        time: state.clockText,
        night: state.isNight,
        dimension: DIM_NAMES[state.dimension],
        dimensionKey: state.dimension,
        biome: currentBiomeName()
      });
    }
  }

  // 初始化界面状态，然后启动循环
  initializeMobileControls();
  // 快捷栏耐久条读取当前武器剩余耐久
  ui.durability = function (weaponKey) {
    const def = Voxel.Weapons.byKey(weaponKey);
    return def && def.durability ? durabilityOf(def) / def.durability : 1;
  };
  ui.setHandMode(state.held);
  updateHandUI();
  ui.onPick = function (index) {
    selectSlot(index); // 单击只装备，保留背包便于继续浏览
  };
  ui.onClose = function () {
    closeInventory(true);
  };
  ui.onInteractClose = function () {
    closeInteract(true);
  };
  // 开始界面的四种模式按钮
  document.querySelectorAll('#mode-select .mode-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setGameMode(btn.dataset.mode);
    });
  });
  ui.setSelected(0);
  ui.setMode('survival', MODE_INFO.survival.name);
  ui.setHealth(state.health, state.maxHealth);
  refreshSaveControls();
  requestAnimationFrame(animate);

  // 暴露少量调试信息，方便自动化验证与排查
  window.VoxelGame = {
    CONFIG: CONFIG,
    state: state,
    world: world,
    player: player,
    camera: camera,
    renderer: renderer,
    blocks: Blocks,
    ui: ui,
    lights: { sun: sunLight, hemi: hemiLight, ambient: ambient },
    highlight: highlight,
    input: input,
    mobile: mobile,
    setMobileMode: setMobileMode,
    toggleFullscreen: toggleFullscreen,
    weapons: Voxel.Weapons,
    arrows: arrows,
    setHeldMode: setHeldMode,
    selectItem: selectItem,
    flipItemPage: flipItemPage,
    startBowCharge: startBowCharge,
    stopBowCharge: stopBowCharge,
    updateHandUI: updateHandUI,
    durabilityOf: durabilityOf,
    terrain: terrainInfo,
    mobs: mobs,
    MODE_INFO: MODE_INFO,
    breakBlock: breakBlock,
    placeBlock: placeBlock,
    selectSlot: selectSlot,
    selectPageSlot: selectPageSlot,
    flipPage: flipPage,
    igniteTnt: igniteTnt,
    explode: explode,
    tntFuses: tntFuses,
    effects: effects,
    openInventory: openInventory,
    closeInventory: closeInventory,
    setGameMode: setGameMode,
    cycleGameMode: cycleGameMode,
    applyDamage: applyDamage,
    respawnPlayer: respawnPlayer,
    addPouch: addPouch,
    takePouch: takePouch,
    showChestPanel: showChestPanel,
    showFurnacePanel: showFurnacePanel,
    showTradePanel: showTradePanel,
    openInteractPanel: openInteractPanel,
    closeInteract: closeInteract,
    SAVE_KEY: SAVE_KEY,
    AUTO_SAVE_INTERVAL: AUTO_SAVE_INTERVAL,
    saveGame: saveGame,
    loadGame: loadGame,
    refreshSaveControls: refreshSaveControls,
    dims: dims,
    DIM_NAMES: DIM_NAMES,
    DIM_ORDER: DIM_ORDER,
    beginTravel: beginTravel,
    enterDimensionReady: enterDimensionReady,
    interactBlock: interactBlock,
    getWorld: function () { return world; },
    getTerrain: function () { return terrainInfo; },
    getPlants: function () { return plants; },
    getDimension: function () { return state.dimension; },
    currentBiomeName: currentBiomeName
  };
})(window.Voxel = window.Voxel || {});
