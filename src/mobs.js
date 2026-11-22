/**
 * mobs.js
 * 方块风格生物（球形世界版）：主世界的猪/牛/羊/鸡/僵尸/村民，
 * 下界的猪灵/烈焰人/恶魂/岩浆怪，末地的末影人/潜影贝。
 * 生物沿星球径向贴地、朝向跟随局部法线，模型仍由简单立方体拼装。
 */
(function (Voxel) {
  'use strict';

  const UP = new THREE.Vector3(0, 1, 0);

  /** 生物属性表 */
  const DEFS = {
    pig: { name: '猪', height: 1.05, width: 0.9, health: 10, speed: 1.5, hostile: false, food: 2, kind: 'quad' },
    cow: { name: '牛', height: 1.25, width: 1.0, health: 12, speed: 1.3, hostile: false, food: 3, kind: 'quad' },
    sheep: { name: '羊', height: 1.2, width: 1.0, health: 8, speed: 1.4, hostile: false, food: 2, kind: 'quad' },
    chicken: { name: '鸡', height: 0.8, width: 0.55, health: 4, speed: 1.8, hostile: false, food: 1, kind: 'quad' },
    zombie: { name: '僵尸', height: 1.85, width: 0.62, health: 20, speed: 2.3, hostile: true, damage: 3, kind: 'humanoid' },
    villager: { name: '村民', height: 1.85, width: 0.6, health: 20, speed: 1.1, hostile: false, kind: 'humanoid' },
    piglin: { name: '僵尸猪灵', height: 1.9, width: 0.62, health: 16, speed: 1.4, hostile: false, kind: 'piglin' },
    blaze: { name: '烈焰人', height: 1.5, width: 0.7, health: 12, speed: 1.9, hostile: true, damage: 3, kind: 'blaze', flying: true, hover: 2.4 },
    ghast: { name: '恶魂', height: 2.4, width: 1.8, health: 10, speed: 1.2, hostile: true, damage: 4, kind: 'ghast', flying: true, hover: 6 },
    magma: { name: '岩浆怪', height: 0.9, width: 0.9, health: 10, speed: 1.1, hostile: true, damage: 2, kind: 'magma' },
    enderman: { name: '末影人', height: 2.7, width: 0.55, health: 22, speed: 2.6, hostile: true, damage: 4, kind: 'enderman' },
    shulker: { name: '潜影贝', height: 1.1, width: 1.0, health: 16, speed: 0, hostile: true, damage: 3, kind: 'shulker' }
  };

  /**
   * 创建受光材质
   * @param {number} color 十六进制颜色
   * @returns {THREE.MeshLambertMaterial} 材质
   */
  function lambert(color) {
    return new THREE.MeshLambertMaterial({ color: color });
  }

  /**
   * 创建一个方块部件
   * @param {number} w 宽
   * @param {number} h 高
   * @param {number} d 深
   * @param {number} color 颜色
   * @param {number} x 局部 x
   * @param {number} y 局部 y
   * @param {number} z 局部 z
   * @returns {THREE.Mesh} 方块网格
   */
  function part(w, h, d, color, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  }

  /**
   * 创建眼睛（贴在面部 -Z 方向）
   * @param {number} y 眼睛高度
   * @param {number} z 面部 z
   * @param {number} spread 两眼间距的一半
   * @param {number} [color] 眼睛颜色
   * @returns {THREE.Group} 眼睛组
   */
  function eyes(y, z, spread, color) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: color || 0x11161a });
    [-spread, spread].forEach(function (x) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), mat);
      eye.position.set(x, y, z);
      group.add(eye);
    });
    return group;
  }

  /**
   * 构建四足动物模型（猪/牛/羊/鸡）
   * @param {string} type 生物类型
   * @returns {{group:THREE.Group,legs:THREE.Mesh[],arms:THREE.Mesh[]}} 模型
   */
  function buildQuad(type) {
    const group = new THREE.Group();
    const legs = [];

    if (type === 'pig') {
      group.add(part(0.78, 0.58, 1.1, 0xf0a7b4, 0, 0.62, 0));
      group.add(part(0.52, 0.48, 0.44, 0xf0a7b4, 0, 0.72, -0.72));
      group.add(part(0.32, 0.2, 0.12, 0xe08c9c, 0, 0.64, -0.97));
      group.add(eyes(0.78, -0.94, 0.13));
      group.add(part(0.1, 0.1, 0.16, 0xe08c9c, 0, 0.74, 0.58));
      [[-0.26, -0.36], [0.26, -0.36], [-0.26, 0.36], [0.26, 0.36]].forEach(function (p) {
        const leg = part(0.16, 0.42, 0.16, 0xe08c9c, p[0], 0.21, p[1]);
        group.add(leg);
        legs.push(leg);
      });
    } else if (type === 'cow') {
      group.add(part(0.86, 0.66, 1.24, 0xf2efe6, 0, 0.78, 0));
      group.add(part(0.9, 0.34, 0.4, 0x2c2f33, 0, 0.82, 0.12));
      group.add(part(0.9, 0.3, 0.3, 0x2c2f33, 0, 0.66, -0.36));
      group.add(part(0.54, 0.5, 0.46, 0xf2efe6, 0, 0.92, -0.82));
      group.add(part(0.34, 0.22, 0.1, 0xd9b9a2, 0, 0.84, -1.06));
      group.add(eyes(0.98, -1.04, 0.14));
      [[-0.28, -0.42], [0.28, -0.42], [-0.28, 0.42], [0.28, 0.42]].forEach(function (p) {
        const leg = part(0.17, 0.46, 0.17, 0xe6e2d6, p[0], 0.23, p[1]);
        group.add(leg);
        legs.push(leg);
      });
    } else if (type === 'sheep') {
      group.add(part(0.94, 0.78, 1.08, 0xf4f1e8, 0, 0.8, 0));
      group.add(part(0.5, 0.46, 0.46, 0xd9c9ae, 0, 0.88, -0.68));
      group.add(eyes(0.94, -0.9, 0.12));
      [[-0.28, -0.34], [0.28, -0.34], [-0.28, 0.34], [0.28, 0.34]].forEach(function (p) {
        const leg = part(0.17, 0.44, 0.17, 0xd9c9ae, p[0], 0.22, p[1]);
        group.add(leg);
        legs.push(leg);
      });
    } else {
      group.add(part(0.4, 0.38, 0.5, 0xf7f4ea, 0, 0.44, 0));
      group.add(part(0.26, 0.3, 0.26, 0xf7f4ea, 0, 0.7, -0.24));
      group.add(part(0.12, 0.08, 0.14, 0xf2b23c, 0, 0.66, -0.42));
      group.add(part(0.1, 0.12, 0.1, 0xd64b3c, 0, 0.88, -0.3));
      group.add(eyes(0.76, -0.38, 0.08));
      [[-0.11, 0], [0.11, 0]].forEach(function (p) {
        const leg = part(0.07, 0.26, 0.07, 0xe8a53a, p[0], 0.13, p[1]);
        group.add(leg);
        legs.push(leg);
      });
    }
    return { group: group, legs: legs, arms: [] };
  }

  /**
   * 构建人形生物模型（僵尸/村民）
   * @param {string} type 生物类型
   * @returns {{group:THREE.Group,legs:THREE.Mesh[],arms:THREE.Mesh[]}} 模型
   */
  function buildHumanoid(type) {
    const group = new THREE.Group();
    const legs = [];
    const arms = [];
    const isZombie = type === 'zombie';
    const skin = isZombie ? 0x6e9a5a : 0xc9a07a;
    const cloth = isZombie ? 0x3f5c72 : 0x7a5233;
    const legColor = isZombie ? 0x2f4457 : 0x5b3d27;

    [[-0.14, 0], [0.14, 0]].forEach(function (p) {
      const leg = part(0.2, 0.78, 0.22, legColor, p[0], 0.39, p[1]);
      group.add(leg);
      legs.push(leg);
    });
    group.add(part(0.54, 0.72, 0.32, cloth, 0, 1.1, 0));
    [[-0.37, 0], [0.37, 0]].forEach(function (p) {
      const arm = part(0.15, 0.66, 0.17, isZombie ? skin : cloth, p[0], 1.12, 0);
      group.add(arm);
      arms.push(arm);
    });
    group.add(part(0.42, 0.42, 0.42, skin, 0, 1.66, 0));
    group.add(eyes(1.7, -0.23, 0.1));
    if (isZombie) {
      arms.forEach(function (arm) { arm.rotation.x = -1.25; });
    } else {
      group.add(part(0.13, 0.16, 0.14, 0xb98a63, 0, 1.62, -0.26));
      group.add(part(0.4, 0.3, 0.06, 0x5a3a22, 0, 0.92, -0.19));
    }
    return { group: group, legs: legs, arms: arms };
  }

  /**
   * 构建下界 / 末地生物模型
   * @param {string} type 生物类型
   * @returns {{group:THREE.Group,legs:THREE.Mesh[],arms:THREE.Mesh[]}} 模型
   */
  function buildSpecial(type) {
    const group = new THREE.Group();
    const legs = [];
    const arms = [];

    if (type === 'piglin') {
      [[-0.14, 0], [0.14, 0]].forEach(function (p) {
        const leg = part(0.2, 0.8, 0.22, 0x4b3a2a, p[0], 0.4, 0);
        group.add(leg);
        legs.push(leg);
      });
      group.add(part(0.56, 0.74, 0.34, 0xc9a227, 0, 1.12, 0));
      [[-0.38, 0], [0.38, 0]].forEach(function (p) {
        const arm = part(0.16, 0.68, 0.18, 0xdc9a86, p[0], 1.14, 0);
        group.add(arm);
        arms.push(arm);
      });
      group.add(part(0.46, 0.44, 0.46, 0xdc9a86, 0, 1.72, 0));
      group.add(part(0.22, 0.16, 0.16, 0xb87363, 0, 1.62, -0.28));
      group.add(part(0.14, 0.14, 0.1, 0xdc9a86, -0.28, 1.9, 0));
      group.add(part(0.14, 0.14, 0.1, 0xdc9a86, 0.28, 1.9, 0));
      group.add(eyes(1.78, -0.24, 0.11));
      group.add(part(0.1, 0.1, 0.26, 0x2a2620, 0.34, 0.95, 0.16)); // 金剑
    } else if (type === 'blaze') {
      group.add(part(0.62, 0.62, 0.62, 0xf2c94c, 0, 1.0, 0));
      group.add(eyes(1.06, -0.32, 0.13, 0x2b1a06));
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const rod = part(0.1, 0.62, 0.1, 0xffb03a,
          Math.cos(angle) * 0.44, 1.0, Math.sin(angle) * 0.44);
        group.add(rod);
      }
      group.add(part(0.14, 0.5, 0.14, 0xffb03a, 0, 0.55, 0));
      group.add(part(0.14, 0.42, 0.14, 0xffb03a, 0, 1.5, 0));
    } else if (type === 'ghast') {
      group.add(part(1.7, 1.5, 1.7, 0xf0eee7, 0, 1.5, 0));
      group.add(eyes(1.62, -0.87, 0.32));
      group.add(part(0.28, 0.1, 0.12, 0x9a968c, 0, 1.28, -0.88));
      [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(function (p) {
        const leg = part(0.16, 0.95, 0.16, 0xd8d4c9, p[0], 0.45, p[1]);
        group.add(leg);
        legs.push(leg);
      });
    } else if (type === 'magma') {
      group.add(part(0.86, 0.6, 0.86, 0x3a2320, 0, 0.52, 0));
      group.add(part(0.5, 0.1, 0.5, 0xff8b2e, 0, 0.84, 0));
      group.add(part(0.18, 0.12, 0.18, 0xff8b2e, -0.24, 0.82, 0.24));
      group.add(part(0.18, 0.12, 0.18, 0xff8b2e, 0.26, 0.82, -0.22));
      group.add(eyes(0.58, -0.44, 0.14, 0xffd05a));
      [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].forEach(function (p) {
        const leg = part(0.16, 0.22, 0.16, 0x2a1a17, p[0], 0.11, p[1]);
        group.add(leg);
        legs.push(leg);
      });
    } else if (type === 'enderman') {
      [[-0.13, 0], [0.13, 0]].forEach(function (p) {
        const leg = part(0.14, 1.25, 0.16, 0x181020, p[0], 0.63, 0);
        group.add(leg);
        legs.push(leg);
      });
      group.add(part(0.44, 0.92, 0.28, 0x1d1428, 0, 1.72, 0));
      [[-0.3, 0], [0.3, 0]].forEach(function (p) {
        const arm = part(0.12, 1.15, 0.14, 0x1d1428, p[0], 1.72, 0);
        group.add(arm);
        arms.push(arm);
      });
      group.add(part(0.44, 0.44, 0.44, 0x140e1c, 0, 2.45, 0));
      group.add(eyes(2.48, -0.24, 0.11, 0xd38cff));
      // 末影粒子感：头顶两个小角
      group.add(part(0.06, 0.18, 0.06, 0x2a1f3a, -0.12, 2.72, 0));
      group.add(part(0.06, 0.18, 0.06, 0x2a1f3a, 0.12, 2.72, 0));
    } else {
      // 潜影贝：紫色外壳 + 盖子
      group.add(part(1.0, 0.7, 1.0, 0x8b5e91, 0, 0.35, 0));
      group.add(part(0.82, 0.32, 0.82, 0xa878ae, 0, 0.82, 0));
      group.add(eyes(0.86, -0.42, 0.16, 0x2a1a2e));
      group.add(part(0.16, 0.16, 0.16, 0x6f4774, -0.34, 0.5, -0.34));
      group.add(part(0.16, 0.16, 0.16, 0x6f4774, 0.34, 0.5, 0.34));
    }

    return { group: group, legs: legs, arms: arms };
  }

  /**
   * 构建指定类型的生物模型
   * @param {string} type 生物类型
   * @returns {{group:THREE.Group,legs:THREE.Mesh[],arms:THREE.Mesh[]}} 模型
   */
  function buildModel(type) {
    const kind = DEFS[type].kind;
    if (kind === 'humanoid') return buildHumanoid(type);
    if (kind === 'quad') return buildQuad(type);
    return buildSpecial(type);
  }

  /**
   * 射线与轴对齐包围盒求交（slab 方法）
   * @returns {number|null} 命中距离
   */
  function rayBox(origin, dir, minX, maxX, minY, maxY, minZ, maxZ) {
    let tmin = 0;
    let tmax = Infinity;
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    const lo = [minX, minY, minZ];
    const hi = [maxX, maxY, maxZ];

    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-8) {
        if (o[i] < lo[i] || o[i] > hi[i]) return null;
        continue;
      }
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    return tmin;
  }

  class MobManager {
    /**
     * @param {THREE.Scene} scene 场景
     * @param {Voxel.World} world 世界
     * @param {object} cfg 世界配置
     * @param {object} blocks 方块注册表
     * @param {Voxel.Player} player 玩家
     */
    constructor(scene, world, cfg, blocks, player) {
      this.scene = scene;
      this.world = world;
      this.cfg = cfg;
      this.blocks = blocks;
      this.player = player;

      /** 当前维度键 */
      this.dimension = 'overworld';
      /** 星球球心 */
      this.center = new THREE.Vector3(cfg.worldWidth * 0.5, cfg.worldHeight * 0.5, cfg.worldDepth * 0.5);

      /** @type {Array<object>} 存活生物 */
      this.mobs = [];
      /** 夜间 / 异界刷怪计时器 */
      this.spawnTimer = 3;
      /** 玩家受伤回调 */
      this.onPlayerDamage = null;
      /** 生物死亡回调 */
      this.onMobKilled = null;
      /** 寻地时复用的局部上方向 */
      this._groundUp = new THREE.Vector3(0, 1, 0);
    }

    /**
     * 生成一只生物
     * @param {string} type 生物类型
     * @param {number} x 世界 x
     * @param {number} z 世界 z
     * @param {number} [y] 脚底高度，省略时自动落地
     * @returns {object|null} 生物对象
     */
    spawn(type, x, z, y) {
      const def = DEFS[type];
      if (!def) return null;
      if (this.mobs.length >= 40) return null;

      const model = buildModel(type);
      const ground = typeof y === 'number'
        ? { x: x, y: y, z: z }
        : (this.groundAt(x, this.player.pos.y + 4, z) || { x: x, y: this.player.pos.y, z: z });

      const mob = {
        type: type,
        def: def,
        group: model.group,
        legs: model.legs,
        arms: model.arms,
        x: ground.x,
        y: ground.y,
        z: ground.z,
        targetY: ground.y,
        homeX: ground.x,
        homeZ: ground.z,
        health: def.health,
        maxHealth: def.health,
        dirX: 0,
        dirZ: 1,
        moving: false,
        wanderTimer: Math.random() * 2,
        walkPhase: Math.random() * 6,
        attackCd: 0,
        fleeTimer: 0,
        hitPulse: 0,
        up: new THREE.Vector3(0, 1, 0),
        hoverPhase: Math.random() * Math.PI * 2
      };

      model.group.position.set(mob.x, mob.y, mob.z);
      model.group.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(model.group);
      this.mobs.push(mob);
      return mob;
    }

    /**
     * 按地形信息放置初始生物
     * @param {object} info Terrain.generate 的返回值
     */
    spawnInitial(info) {
      const list = info.mobSpawns || info.animalSpawns || [];
      list.forEach((s) => {
        this.spawn(s.type, s.x, s.z, s.y);
      });
    }

    /**
     * 沿局部重力方向寻找脚底附近的地面；只向上探测一级台阶，避免把屋顶吸作地面
     * @param {number} x 参考 x
     * @param {number} y 参考 y（脚底附近）
     * @param {number} z 参考 z
     * @returns {{x:number,y:number,z:number,nx:number,ny:number,nz:number}|null} 地面点
     */
    groundAt(x, y, z) {
      const up = this.player.getUpAt(x, y, z, this._groundUp);
      const ox = x + up.x * 1.15;
      const oy = y + up.y * 1.15;
      const oz = z + up.z * 1.15;
      // 目标已经位于墙体等实体内部时拒绝这次寻地，避免生物逐帧被顶到屋顶
      if (this.world.isSolidAt(Math.floor(ox), Math.floor(oy), Math.floor(oz))) return null;
      const step = 0.15;
      let airT = 0;

      for (let t = step; t <= 48; t += step) {
        const px = ox - up.x * t;
        const py = oy - up.y * t;
        const pz = oz - up.z * t;
        if (this.world.isSolidAt(Math.floor(px), Math.floor(py), Math.floor(pz))) {
          // 二分细化空气与实体的交界，脚底只保留极小间隙，不再悬浮半格
          let solidT = t;
          for (let j = 0; j < 6; j++) {
            const mid = (airT + solidT) * 0.5;
            const mx = ox - up.x * mid;
            const my = oy - up.y * mid;
            const mz = oz - up.z * mid;
            if (this.world.isSolidAt(Math.floor(mx), Math.floor(my), Math.floor(mz))) solidT = mid;
            else airT = mid;
          }
          const footT = Math.max(0, airT - 0.015);
          return {
            x: ox - up.x * footT,
            y: oy - up.y * footT,
            z: oz - up.z * footT,
            nx: up.x, ny: up.y, nz: up.z
          };
        }
        airT = t;
      }
      return null;
    }

    /**
     * 在玩家附近尝试刷怪（按维度选择生物）
     * @param {THREE.Vector3} playerPos 玩家位置
     * @param {boolean} isNight 是否夜晚
     */
    trySpawnHostile(playerPos, isNight) {
      let hostiles = 0;
      for (let i = 0; i < this.mobs.length; i++) {
        if (this.mobs[i].def.hostile) hostiles++;
      }
      if (hostiles >= (this.dimension === 'overworld' ? 7 : 9)) return;

      let types;
      if (this.dimension === 'overworld') {
        if (!isNight) return;
        types = ['zombie'];
      } else if (this.dimension === 'nether') {
        types = ['piglin', 'blaze', 'magma', 'ghast'];
      } else {
        types = ['enderman', 'enderman', 'shulker'];
      }

      const c = this.center;
      let n = new THREE.Vector3(playerPos.x - c.x, playerPos.y - c.y, playerPos.z - c.z);
      if (n.lengthSq() < 1) n.set(0, 1, 0);
      n.normalize();
      // 在切平面上随机取方向
      const useZ = Math.abs(n.y) > 0.9;
      const ref = useZ ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const east = new THREE.Vector3().crossVectors(n, ref).normalize();
      const north = new THREE.Vector3().crossVectors(east, n).normalize();
      const angle = Math.random() * Math.PI * 2;
      const radius = 16 + Math.random() * 10;
      const ox = east.x * Math.cos(angle) * radius + north.x * Math.sin(angle) * radius;
      const oy = east.y * Math.cos(angle) * radius + north.y * Math.sin(angle) * radius;
      const oz = east.z * Math.cos(angle) * radius + north.z * Math.sin(angle) * radius;

      const x = playerPos.x + ox;
      const y = playerPos.y + oy;
      const z = playerPos.z + oz;
      if (x < 3 || z < 3 || x >= this.cfg.worldWidth - 3 || z >= this.cfg.worldDepth - 3) return;

      const type = types[Math.floor(Math.random() * types.length)];
      const flying = !!DEFS[type].flying;
      const ground = this.groundAt(x, y + 2, z);
      if (!ground) return;
      if (this.world.getBlock(Math.floor(ground.x), Math.floor(ground.y) - 1, Math.floor(ground.z)) === this.blocks.ID.WATER) return;

      this.spawn(type, ground.x, ground.z, flying ? ground.y + (DEFS[type].hover || 4) : ground.y);
    }

    /**
     * 每帧更新所有生物
     * @param {number} dt 帧间隔（秒）
     * @param {object} opts { isNight, gameMode, playerAlive }
     */
    update(dt, opts) {
      const isNight = !!opts.isNight;
      const gameMode = opts.gameMode || 'survival';
      const playerPos = this.player.pos;
      const canHurt = gameMode === 'survival' && opts.playerAlive !== false;
      const c = this.center;

      // 按维度决定刷怪节奏：主世界只在夜晚，下界 / 末地全天
      const shouldSpawn = this.dimension !== 'overworld' || isNight;
      if (shouldSpawn && canHurt) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = this.dimension === 'overworld' ? 4 + Math.random() * 3 : 9 + Math.random() * 5;
          this.trySpawnHostile(playerPos, isNight);
        }
      }

      for (let i = this.mobs.length - 1; i >= 0; i--) {
        const m = this.mobs[i];

        if (m.hitPulse > 0) {
          m.hitPulse = Math.max(0, m.hitPulse - dt * 4);
          m.group.scale.setScalar(1 + m.hitPulse * 0.16);
        }

        const dx = playerPos.x - m.x;
        const dy = playerPos.y - m.y;
        const dz = playerPos.z - m.z;
        const dist = Math.hypot(dx, dy, dz) || 0.001;

        // 主世界白天僵尸消散；所有生物离玩家太远时移除，控制数量
        if ((m.def.hostile && this.dimension === 'overworld' && !isNight &&
          (dist > 14 || Math.random() < dt * 0.25)) || dist > 90) {
          this.removeAt(i);
          continue;
        }

        if (m.attackCd > 0) m.attackCd -= dt;
        if (m.fleeTimer > 0) m.fleeTimer -= dt;

        // 与玩家共用局部上方向：平台上竖直，离开平台后平滑过渡到径向
        this.player.getUpAt(m.x, m.y, m.z, m.up);
        const nx = m.up.x;
        const ny = m.up.y;
        const nz = m.up.z;

        let mx = 0;
        let mz = 0;
        let speed = m.def.speed;
        let moving = false;

        if (m.def.hostile && dist < 20 && gameMode !== 'spectator' && m.def.kind !== 'shulker') {
          mx = dx / dist;
          mz = dz / dist;
          speed = Math.min(3.4, m.def.speed + 0.8);
          moving = true;
          if (dist < 2.4 && m.attackCd <= 0 && canHurt) {
            m.attackCd = 1.3;
            if (typeof this.onPlayerDamage === 'function') this.onPlayerDamage(m.def.damage || 2, m);
          }
        } else if (!m.def.hostile && m.fleeTimer > 0) {
          mx = -dx / dist;
          mz = -dz / dist;
          speed = 3.2;
          moving = true;
        } else if (m.def.speed > 0) {
          m.wanderTimer -= dt;
          if (m.wanderTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            m.dirX = Math.cos(angle);
            m.dirZ = Math.sin(angle);
            m.wanderTimer = 1.6 + Math.random() * 2.8;
            m.moving = Math.random() > 0.3;
          }
          if (m.moving) {
            mx = m.dirX;
            mz = m.dirZ;
            moving = true;
          }
          const hx = m.x - m.homeX;
          const hz = m.z - m.homeZ;
          if (hx * hx + hz * hz > 144) {
            const l = Math.hypot(hx, hz) || 1;
            mx = -hx / l;
            mz = -hz / l;
            moving = true;
          }
        }

        // 把水平意图投影到球面切平面
        let dirX = mx;
        let dirY = 0;
        let dirZ = mz;
        const dot = dirX * nx + dirY * ny + dirZ * nz;
        dirX -= nx * dot;
        dirY -= ny * dot;
        dirZ -= nz * dot;
        const dl = Math.hypot(dirX, dirY, dirZ);
        if (dl > 1e-4) { dirX /= dl; dirY /= dl; dirZ /= dl; }

        const flying = !!m.def.flying;

        if (flying) {
          // 飞行生物：保持距地面悬浮高度，缓慢靠近玩家
          const ground = this.groundAt(m.x, m.y, m.z);
          const hover = (m.def.hover || 4) + Math.sin(m.hoverPhase) * 0.4;
          m.hoverPhase += dt * 1.3;
          let tx = m.x;
          let ty = m.y;
          let tz = m.z;
          if (moving) {
            tx += dirX * speed * dt;
            ty += dirY * speed * dt;
            tz += dirZ * speed * dt;
          }
          const g2 = this.groundAt(tx, ty + hover, tz);
          if (g2) {
            tx = g2.x;
            ty = g2.y + hover;
            tz = g2.z;
          }
          const k = Math.min(1, dt * 3);
          m.x += (tx - m.x) * k;
          m.y += (ty - m.y) * k;
          m.z += (tz - m.z) * k;
          m.targetY = m.y;
          if (moving) m.walkPhase += dt * speed * 2.2;
        } else if (moving && dl > 1e-4) {
          const step = speed * dt;
          const tx = m.x + dirX * step;
          const ty = m.y + dirY * step;
          const tz = m.z + dirZ * step;
          const ground = this.groundAt(tx, ty, tz);
          if (ground && Math.abs(ground.y - m.y) <= 1.6) {
            m.x = ground.x;
            m.y = ground.y;
            m.z = ground.z;
            m.targetY = ground.y;
            m.walkPhase += dt * speed * 3.4;
          } else {
            m.wanderTimer = 0;
            m.moving = false;
          }
        } else {
          const ground = this.groundAt(m.x, m.y, m.z);
          if (ground) {
            m.targetY = ground.y;
            m.y += (ground.y - m.y) * Math.min(1, dt * 10);
          }
        }

        m.group.position.set(m.x, m.y, m.z);

        // 朝向：先把模型的 Y 轴对齐到径向，再绕径向旋转到移动方向
        const qAlign = new THREE.Quaternion().setFromUnitVectors(UP, m.up);
        if (moving && dl > 1e-4) {
          const heading = Math.atan2(-dirX, -dirZ);
          const qHeading = new THREE.Quaternion().setFromAxisAngle(m.up, heading);
          m.group.quaternion.copy(qHeading).multiply(qAlign);
        } else {
          m.group.quaternion.copy(qAlign);
        }

        const swing = moving ? Math.sin(m.walkPhase) * 0.55 : 0;
        for (let l = 0; l < m.legs.length; l++) {
          m.legs[l].rotation.x = swing * (l % 2 === 0 ? 1 : -1);
        }
        for (let a = 0; a < m.arms.length; a++) {
          const base = m.def.hostile && m.def.kind === 'humanoid' ? -1.25 : 0;
          m.arms[a].rotation.x = base + swing * -0.8 * (a % 2 === 0 ? 1 : -1);
        }
      }
    }

    /**
     * 射线拾取最近的生物
     * @param {THREE.Vector3} origin 起点
     * @param {THREE.Vector3} dir 单位方向
     * @param {number} maxDistance 最大距离
     * @returns {{mob:object,distance:number}|null} 命中结果
     */
    pick(origin, dir, maxDistance) {
      let best = null;
      for (let i = 0; i < this.mobs.length; i++) {
        const m = this.mobs[i];
        const half = m.def.width * 0.5 + 0.08;
        const t = rayBox(
          origin, dir,
          m.x - half, m.x + half,
          m.y + 0.05, m.y + m.def.height + 0.08,
          m.z - half, m.z + half
        );
        if (t === null || t < 0 || t > maxDistance) continue;
        if (!best || t < best.distance) best = { mob: m, distance: t };
      }
      return best;
    }

    /**
     * 对生物造成伤害
     * @param {object} mob 生物
     * @param {number} damage 伤害值
     * @returns {boolean} 是否击杀
     */
    hit(mob, damage) {
      if (!mob) return false;
      mob.health -= damage;
      mob.hitPulse = 1;
      if (!mob.def.hostile) mob.fleeTimer = 4;
      if (mob.health <= 0) {
        const def = mob.def;
        this.removeMob(mob);
        if (typeof this.onMobKilled === 'function') this.onMobKilled(def, mob);
        return true;
      }
      return false;
    }

    /**
     * 移除指定生物并释放资源
     * @param {object} mob 生物对象
     */
    removeMob(mob) {
      const index = this.mobs.indexOf(mob);
      if (index >= 0) this.removeAt(index);
    }

    /**
     * 按下标移除生物
     * @param {number} index 下标
     */
    removeAt(index) {
      const mob = this.mobs[index];
      if (!mob) return;
      this.scene.remove(mob.group);
      mob.group.traverse(function (obj) {
        if (obj.isMesh) {
          obj.geometry.dispose();
          if (obj.material && obj.material.dispose) obj.material.dispose();
        }
      });
      this.mobs.splice(index, 1);
    }

    /**
     * 统计指定类型的存活数量
     * @param {string} type 生物类型
     * @returns {number} 数量
     */
    countType(type) {
      let n = 0;
      for (let i = 0; i < this.mobs.length; i++) {
        if (this.mobs[i].type === type) n++;
      }
      return n;
    }
  }

  Voxel.MobManager = MobManager;
  Voxel.MOB_DEFS = DEFS;
})(window.Voxel = window.Voxel || {});
