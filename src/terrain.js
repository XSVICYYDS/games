/**
 * terrain.js
 * 球形世界地形生成：主世界、下界、末地三个维度都是「实心球体星球」，
 * 地表由球面方向上的三维噪声决定，因此可以从任意方向环游整颗星球。
 * 三个维度共用同一套半径场 / 分层 / 装饰框架，差异体现在方块调色板与群系。
 */
(function (Voxel) {
  'use strict';

  const Noise = Voxel.Noise;
  const ID = Voxel.Blocks.ID;
  const Biomes = Voxel.Biomes;

  /** 半径场的采样网格边长（越小越精细，越大越快） */
  const CELL = 8;

  /** 三个维度的星球参数 */
  const DIMS = {
    overworld: {
      name: '主世界', radius: 86, amp: 7, seaOffset: -2.5,
      plateauRadius: 26, mountain: true
    },
    nether: {
      name: '下界', radius: 74, amp: 6, seaOffset: -5,
      plateauRadius: 22, mountain: false
    },
    end: {
      name: '末地', radius: 78, amp: 4.5, seaOffset: null,
      plateauRadius: 20, mountain: false
    }
  };

  /** 方块名 -> ID 缓存（地形生成时按名称取装饰方块） */
  let NAME_CACHE = null;

  /**
   * 按中文名查找方块 ID
   * @param {string} name 方块中文名
   * @returns {number} 方块 ID，找不到返回空气
   */
  function blockId(name) {
    if (!NAME_CACHE) {
      NAME_CACHE = {};
      Voxel.Blocks.HOTBAR.forEach(function (id) {
        NAME_CACHE[Voxel.Blocks.DEF[id].name] = id;
      });
    }
    const id = NAME_CACHE[name];
    return typeof id === 'number' ? id : 0;
  }

  /** 常用方块 ID 缓存（首次生成时填充） */
  let B = null;

  /**
   * 取得并缓存地形用到的方块 ID
   * @returns {object} 方块 ID 表
   */
  function ids() {
    if (B) return B;
    B = {
      grass: ID.GRASS,
      dirt: ID.DIRT,
      stone: ID.STONE,
      sand: ID.SAND,
      snow: ID.SNOW,
      water: ID.WATER,
      leaves: ID.LEAVES,
      wood: ID.WOOD,
      plank: ID.PLANK,
      glass: ID.GLASS,
      bedrock: ID.BEDROCK,
      deepslate: blockId('深板岩') || ID.STONE,
      sandstone: blockId('砂岩') || ID.SAND,
      spruceLeaves: blockId('云杉树叶') || ID.LEAVES,
      cactus: blockId('仙人掌'),
      cobblestone: blockId('圆石') || ID.STONE,
      workbench: blockId('工作台'),
      furnace: blockId('熔炉'),
      lantern: blockId('灯笼') || blockId('南瓜灯'),
      chest: blockId('箱子'),
      bell: blockId('钟'),
      lectern: blockId('讲台'),
      pumpkin: blockId('南瓜'),
      melon: blockId('西瓜'),
      farmland: Voxel.Blocks.BY_KEY['minecraft:farmland'] || blockId('耕地'),
      wheat: Voxel.Blocks.BY_KEY['minecraft:wheat'],
      carrots: Voxel.Blocks.BY_KEY['minecraft:carrots'],
      potatoes: Voxel.Blocks.BY_KEY['minecraft:potatoes'],
      beetroots: Voxel.Blocks.BY_KEY['minecraft:beetroots'],
      hay: blockId('干草捆'),
      composter: blockId('堆肥桶'),
      obsidian: blockId('黑曜石') || ID.STONE,
      cryingObsidian: blockId('哭泣的黑曜石') || blockId('黑曜石') || ID.STONE,
      netherrack: blockId('下界岩') || ID.STONE,
      soulSand: blockId('灵魂沙') || ID.SAND,
      soulSoil: blockId('灵魂土') || ID.DIRT,
      magma: blockId('岩浆块') || ID.STONE,
      glowstone: blockId('荧石'),
      crimsonNylium: blockId('绯红菌岩') || blockId('下界岩') || ID.STONE,
      warpedNylium: blockId('诡异菌岩') || blockId('下界岩') || ID.STONE,
      crimsonStem: blockId('绯红菌柄') || ID.WOOD,
      warpedStem: blockId('诡异菌柄') || ID.WOOD,
      netherWart: blockId('下界疣块') || blockId('绯红菌岩') || ID.STONE,
      warpedWart: blockId('诡异疣块') || blockId('诡异菌岩') || ID.STONE,
      basalt: blockId('玄武岩') || ID.STONE,
      blackstone: blockId('黑石') || ID.STONE,
      shroomlight: blockId('菌光体') || blockId('荧石'),
      endStone: blockId('末地石') || ID.STONE,
      endStoneBrick: blockId('末地石砖') || blockId('末地石') || ID.STONE,
      purpur: blockId('紫珀块') || blockId('末地石') || ID.STONE,
      purpurPillar: blockId('紫珀柱') || blockId('紫珀块') || ID.STONE,
      amethyst: blockId('紫水晶块') || blockId('紫珀块') || ID.STONE,
      amethystBud: blockId('紫水晶母岩') || blockId('紫水晶块') || ID.STONE,
      netherBrick: blockId('下界砖块') || blockId('下界岩') || ID.STONE,
      bone: blockId('骨块') || ID.STONE
    };
    return B;
  }

  /**
   * 直接向世界数组写入方块（越界自动忽略）
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {number} x 坐标
   * @param {number} y 坐标
   * @param {number} z 坐标
   * @param {number} id 方块 ID
   */
  function setRaw(data, cfg, x, y, z, id) {
    if (x < 0 || x >= cfg.worldWidth || y < 0 || y >= cfg.worldHeight ||
      z < 0 || z >= cfg.worldDepth) return;
    data[(y * cfg.worldDepth + z) * cfg.worldWidth + x] = id;
  }

  /**
   * 读取世界数组中已有方块（越界返回空气）
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {number} x 坐标
   * @param {number} y 坐标
   * @param {number} z 坐标
   * @returns {number} 方块 ID
   */
  function getRaw(data, cfg, x, y, z) {
    if (x < 0 || x >= cfg.worldWidth || y < 0 || y >= cfg.worldHeight ||
      z < 0 || z >= cfg.worldDepth) return ID.AIR;
    return data[(y * cfg.worldDepth + z) * cfg.worldWidth + x];
  }

  /**
   * 只把空气替换成指定方块（避免装饰覆盖已有结构）
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {number} x 坐标
   * @param {number} y 坐标
   * @param {number} z 坐标
   * @param {number} id 方块 ID
   */
  function setIfAir(data, cfg, x, y, z, id) {
    if (id === 0) return;
    if (getRaw(data, cfg, x, y, z) !== ID.AIR) return;
    setRaw(data, cfg, x, y, z, id);
  }

  /**
   * 球形半径场：在粗网格上采样三维噪声，再对每个体素做三线性插值，
   * 用极小的噪声代价得到光滑、无接缝的球面起伏。
   */
  class RadiusField {
    /**
     * @param {object} cfg 世界配置
     * @param {object} opts 维度参数
     */
    constructor(cfg, opts) {
      this.cell = CELL;
      this.gx = Math.ceil(cfg.worldWidth / CELL) + 2;
      this.gy = Math.ceil(cfg.worldHeight / CELL) + 2;
      this.gz = Math.ceil(cfg.worldDepth / CELL) + 2;
      this.values = new Float32Array(this.gx * this.gy * this.gz);

      const cx = cfg.worldWidth * 0.5;
      const cy = cfg.worldHeight * 0.5;
      const cz = cfg.worldDepth * 0.5;
      const seed = cfg.seed;

      for (let iz = 0; iz < this.gz; iz++) {
        for (let iy = 0; iy < this.gy; iy++) {
          for (let ix = 0; ix < this.gx; ix++) {
            const dx = ix * CELL + 0.5 - cx;
            const dy = iy * CELL + 0.5 - cy;
            const dz = iz * CELL + 0.5 - cz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
            const nx = dx / d;
            const ny = dy / d;
            const nz = dz / d;

            const base = Noise.fbm3(nx * 1.7, ny * 1.7, nz * 1.7, seed + 4101, 4, 2, 0.5);
            const detail = Noise.fbm3(nx * 5.5, ny * 5.5, nz * 5.5, seed + 4201, 2, 2, 0.5);
            let r = opts.radius + (base - 0.5) * 2 * opts.amp + (detail - 0.5) * 2.4;

            if (opts.mountain) {
              const ridge = Noise.fbm3(nx * 2.4, ny * 2.4, nz * 2.4, seed + 3301, 3, 2, 0.5);
              const mask = Math.max(0, (ridge - 0.6) / 0.4);
              r += mask * mask * 9;
            }

            this.values[(iz * this.gy + iy) * this.gx + ix] = r;
          }
        }
      }
    }

    /**
     * 三线性插值取得任意体素位置的星球半径
     * @param {number} x 体素坐标 x
     * @param {number} y 体素坐标 y
     * @param {number} z 体素坐标 z
     * @returns {number} 该方向的地表半径
     */
    at(x, y, z) {
      const fx = x / CELL;
      const fy = y / CELL;
      const fz = z / CELL;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const z0 = Math.floor(fz);
      const tx = fx - x0;
      const ty = fy - y0;
      const tz = fz - z0;
      const gx = this.gx;
      const gy = this.gy;
      const v = this.values;
      const i000 = (z0 * gy + y0) * gx + x0;
      const i100 = i000 + 1;
      const i010 = i000 + gx;
      const i110 = i010 + 1;
      const i001 = i000 + gx * gy;
      const i101 = i001 + 1;
      const i011 = i001 + gx;
      const i111 = i011 + 1;

      const a00 = v[i000] + (v[i100] - v[i000]) * tx;
      const a10 = v[i010] + (v[i110] - v[i010]) * tx;
      const a01 = v[i001] + (v[i101] - v[i001]) * tx;
      const a11 = v[i011] + (v[i111] - v[i011]) * tx;
      const b0 = a00 + (a10 - a00) * ty;
      const b1 = a01 + (a11 - a01) * ty;
      return b0 + (b1 - b0) * tz;
    }
  }

  /**
   * 构建某一维度的方块调色板
   * @param {string} dimension 维度键
   * @returns {object} 调色板
   */
  function buildPalette(dimension) {
    const b = ids();

    if (dimension === 'nether') {
      return {
        deep: b.netherrack,
        stone: b.netherrack,
        plateauTop: b.netherrack,
        plateauSub: b.netherrack,
        liquid: b.magma,
        /**
         * 下界地表方块
         * @param {number} code 群系编码
         * @param {number} x 坐标
         * @param {number} y 坐标
         * @param {number} z 坐标
         * @returns {number} 方块 ID
         */
        surface: function (code, x, y, z) {
          const pick = Noise.hash3i(x, y, z, 9137);
          if (code === Biomes.NETHER.CODES.SOUL_VALLEY) {
            return pick < 0.55 ? b.soulSand : b.soulSoil;
          }
          if (code === Biomes.NETHER.CODES.CRIMSON) return b.crimsonNylium;
          if (code === Biomes.NETHER.CODES.WARPED) return b.warpedNylium;
          if (code === Biomes.NETHER.CODES.BASALT) {
            return pick < 0.55 ? b.basalt : b.blackstone;
          }
          return b.netherrack;
        },
        /**
         * 下界地下方块
         * @returns {number} 方块 ID
         */
        subsurface: function () { return b.netherrack; }
      };
    }

    if (dimension === 'end') {
      return {
        deep: b.endStone,
        stone: b.endStone,
        plateauTop: b.endStoneBrick,
        plateauSub: b.endStone,
        liquid: 0,
        /**
         * 末地地表方块
         * @param {number} code 群系编码
         * @param {number} x 坐标
         * @param {number} y 坐标
         * @param {number} z 坐标
         * @returns {number} 方块 ID
         */
        surface: function (code, x, y, z) {
          const pick = Noise.hash3i(x, y, z, 8219);
          if (code === Biomes.END.CODES.PURPUR) {
            return pick < 0.55 ? b.purpur : b.endStone;
          }
          if (code === Biomes.END.CODES.HIGHLANDS) {
            return pick < 0.32 ? b.endStoneBrick : b.endStone;
          }
          if (code === Biomes.END.CODES.WASTES) {
            return pick < 0.14 ? b.obsidian : b.endStone;
          }
          return b.endStone;
        },
        /**
         * 末地地下方块
         * @returns {number} 方块 ID
         */
        subsurface: function () { return b.endStone; }
      };
    }

    return {
      deep: b.deepslate,
      stone: b.stone,
      plateauTop: b.grass,
      plateauSub: b.dirt,
      liquid: b.water,
      /**
       * 主世界地表方块
       * @param {number} code 群系编码
       * @param {number} x 坐标
       * @param {number} y 坐标
       * @param {number} z 坐标
       * @param {number} rSurf 地表半径
       * @param {number|null} seaR 海洋半径
       * @param {number} elevation 相对起伏
       * @returns {number} 方块 ID
       */
      surface: function (code, x, y, z, rSurf, seaR, elevation) {
        const beach = seaR !== null && rSurf < seaR + 1.2;
        if (code === Biomes.OVERWORLD.CODES.DESERT) return b.sand;
        if (code === Biomes.OVERWORLD.CODES.SNOWY) return b.snow;
        if (code === Biomes.OVERWORLD.CODES.MOUNTAIN) {
          return elevation > 0.45 ? b.snow : b.stone;
        }
        return beach ? b.sand : b.grass;
      },
      /**
       * 主世界地表以下 1~4 格方块
       * @param {number} code 群系编码
       * @param {number} rSurf 地表半径
       * @param {number|null} seaR 海洋半径
       * @returns {number} 方块 ID
       */
      subsurface: function (code, rSurf, seaR) {
        if (code === Biomes.OVERWORLD.CODES.DESERT) return b.sandstone;
        if (seaR !== null && rSurf < seaR + 1.2) return b.sand;
        if (code === Biomes.OVERWORLD.CODES.MOUNTAIN) return b.stone;
        return b.dirt;
      }
    };
  }

  /**
   * 填充一颗实心星球：内部为深层岩，外壳按群系铺地表，低洼处注水/岩浆
   * @param {string} dimension 维度键
   * @param {Uint16Array} data 世界方块数组
   * @param {object} cfg 世界配置
   * @param {object} opts 维度参数
   * @returns {object} 生成统计（地表点、群系计数）
   */
  function fillPlanet(dimension, data, cfg, opts) {
    const W = cfg.worldWidth;
    const H = cfg.worldHeight;
    const D = cfg.worldDepth;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const cz = D * 0.5;

    const field = new RadiusField(cfg, opts);
    const palette = buildPalette(dimension);
    const seaR = opts.seaOffset === null ? null : opts.radius + opts.seaOffset;
    const inner = opts.radius - opts.amp - 4;
    const outer = opts.radius + opts.amp + 12;
    const inner2 = inner * inner;
    const outer2 = outer * outer;
    const tables = Biomes.TABLES[dimension];
    const counts = new Int32Array(tables.NAMES.length);
    const surfacePoints = [];

    // 整颗星球包在立方体内部，低层统一填深层岩可以省掉大量噪声计算
    for (let y = 0; y < H; y++) {
      const dy = y + 0.5 - cy;
      const dy2 = dy * dy;
      for (let z = 0; z < D; z++) {
        const dz = z + 0.5 - cz;
        const ring = dy2 + dz * dz;
        const rowBase = (y * D + z) * W;
        for (let x = 0; x < W; x++) {
          const dx = x + 0.5 - cx;
          const d2 = ring + dx * dx;
          const i = rowBase + x;

          if (d2 < inner2) {
            data[i] = palette.deep;
            continue;
          }
          if (d2 > outer2) continue;

          const d = Math.sqrt(d2) || 1e-6;
          const rSurf = field.at(x + 0.5, y + 0.5, z + 0.5);
          const depth = rSurf - d;

          if (depth <= 0) {
            // 地表以上：低洼处填充液体（海洋 / 岩浆湖）
            if (seaR !== null && d <= seaR && rSurf < seaR - 0.8) data[i] = palette.liquid;
            continue;
          }

          if (depth > 5) {
            data[i] = depth > 34 ? palette.deep : palette.stone;
            continue;
          }

          const inv = 1 / d;
          const nx = dx * inv;
          const ny = dy * inv;
          const nz = dz * inv;
          const elevation = (rSurf - opts.radius) / opts.amp;
          const code = Biomes.sampleSphere(dimension, nx, ny, nz, elevation, cfg);

          if (depth < 1.05) {
            data[i] = palette.surface(code, x, y, z, rSurf, seaR, elevation);
            counts[code]++;
            surfacePoints.push({
              x: x, y: y, z: z, nx: nx, ny: ny, nz: nz, code: code
            });
          } else {
            data[i] = palette.subsurface(code, rSurf, seaR, elevation);
          }
        }
      }
    }

    return { surfacePoints: surfacePoints, counts: counts, palette: palette, seaR: seaR };
  }

  /**
   * 在出生点削出一块平台：上方清空、下方补实，让村庄与传送门保持水平
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {object} opts 维度参数
   * @param {object} palette 调色板
   * @returns {{x:number,z:number,topY:number,feetY:number,radius:number}} 平台信息
   */
  function buildPlateau(data, cfg, opts, palette) {
    const W = cfg.worldWidth;
    const H = cfg.worldHeight;
    const D = cfg.worldDepth;
    const cx = Math.floor(W * 0.5);
    const cy = H * 0.5;
    const cz = Math.floor(D * 0.5);
    const pr = opts.plateauRadius;
    const topY = Math.floor(cy + Math.sqrt(Math.max(0, opts.radius * opts.radius - pr * pr))) - 2;

    for (let dz = -pr; dz <= pr; dz++) {
      for (let dx = -pr; dx <= pr; dx++) {
        if (dx * dx + dz * dz > pr * pr) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || x >= W || z < 0 || z >= D) continue;
        for (let y = 0; y <= topY; y++) {
          let id = palette.stone;
          if (y === topY) id = palette.plateauTop;
          else if (y >= topY - 2) id = palette.plateauSub;
          data[(y * D + z) * W + x] = id;
        }
        for (let y = topY + 1; y < H; y++) {
          data[(y * D + z) * W + x] = ID.AIR;
        }
      }
    }

    return { x: cx, z: cz, topY: topY, feetY: topY + 1, radius: pr };
  }

  // ---------------------------------------------------------------- 村庄（平台上的平面建筑）
  /**
   * 建造一栋村民房屋
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {number} x0 最小角 x
   * @param {number} z0 最小角 z
   * @param {number} w 宽
   * @param {number} d 深
   * @param {number} baseY 地面高度
   * @param {string} door 门朝向
   * @returns {{x:number,z:number,y:number,chest:object}} 房屋信息
   */
  function buildHouse(data, cfg, x0, z0, w, d, baseY, door) {
    const b = ids();
    const wallTop = baseY + 3;
    const midX = x0 + Math.floor(w / 2);
    const midZ = z0 + Math.floor(d / 2);

    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const x = x0 + dx;
        const z = z0 + dz;
        setRaw(data, cfg, x, baseY, z, b.plank);

        const edgeX = dx === 0 || dx === w - 1;
        const edgeZ = dz === 0 || dz === d - 1;
        if (!edgeX && !edgeZ) continue;

        const corner = edgeX && edgeZ;
        for (let y = baseY + 1; y <= wallTop; y++) {
          let id = corner ? b.wood : b.plank;
          if (!corner && y === baseY + 2) {
            const along = (edgeZ ? dx : dz);
            if (along % 3 === 1) id = b.glass;
          }
          setRaw(data, cfg, x, y, z, id);
        }
      }
    }

    const doorCell = {
      north: { x: midX, z: z0 },
      south: { x: midX, z: z0 + d - 1 },
      west: { x: x0, z: midZ },
      east: { x: x0 + w - 1, z: midZ }
    }[door];
    if (doorCell) {
      setRaw(data, cfg, doorCell.x, baseY + 1, doorCell.z, ID.AIR);
      setRaw(data, cfg, doorCell.x, baseY + 2, doorCell.z, ID.AIR);
      setRaw(data, cfg, doorCell.x, baseY + 3, doorCell.z, b.wood);
    }

    for (let dz = -1; dz <= d; dz++) {
      for (let dx = -1; dx <= w; dx++) {
        setRaw(data, cfg, x0 + dx, baseY + 4, z0 + dz, b.plank);
      }
    }
    for (let dz = 1; dz < d - 1; dz++) {
      for (let dx = 1; dx < w - 1; dx++) {
        setRaw(data, cfg, x0 + dx, baseY + 5, z0 + dz, b.wood);
      }
    }

    const chest = { x: x0 + 1, y: baseY + 1, z: z0 + 1 };
    setIfAir(data, cfg, chest.x, chest.y, chest.z, b.chest);
    setIfAir(data, cfg, x0 + w - 2, baseY + 1, z0 + 1, b.workbench);
    setIfAir(data, cfg, x0 + 1, baseY + 1, z0 + d - 2, b.furnace);
    setIfAir(data, cfg, midX, baseY + 3, midZ, b.lantern);

    if (doorCell) {
      const outX = door === 'west' ? doorCell.x - 1 : door === 'east' ? doorCell.x + 1 : doorCell.x;
      const outZ = door === 'north' ? doorCell.z - 1 : door === 'south' ? doorCell.z + 1 : doorCell.z;
      setIfAir(data, cfg, outX, baseY + 3, outZ, b.lantern);
    }

    return { x: x0, z: z0, y: baseY, w: w, d: d, chest: chest };
  }

  /**
   * 建造村庄中心的水井
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {number} cx 中心 x
   * @param {number} cz 中心 z
   * @param {number} baseY 地面高度
   */
  function buildWell(data, cfg, cx, cz, baseY) {
    const b = ids();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) {
          setRaw(data, cfg, cx, baseY + 1, cz, ID.WATER);
          setRaw(data, cfg, cx, baseY, cz, b.cobblestone);
        } else {
          setRaw(data, cfg, cx + dx, baseY + 1, cz + dz, b.cobblestone);
        }
      }
    }
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) {
      setRaw(data, cfg, cx + c[0], baseY + 1, cz + c[1], b.wood);
      setRaw(data, cfg, cx + c[0], baseY + 2, cz + c[1], b.wood);
    });
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        setRaw(data, cfg, cx + dx, baseY + 3, cz + dz, b.plank);
      }
    }
    setIfAir(data, cfg, cx, baseY + 2, cz, b.lantern);
  }

  /**
   * 村庄小农田
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {number} x0 起始 x
   * @param {number} z0 起始 z
   * @param {number} baseY 地面高度
   */
  function buildFarm(data, cfg, x0, z0, baseY) {
    const b = ids();
    const w = 5;
    const d = 4;
    const crops = [];
    const cropIds = [b.wheat, b.carrots, b.potatoes, b.beetroots];
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const border = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
        if (border) {
          setRaw(data, cfg, x0 + dx, baseY, z0 + dz, b.plank);
        } else if (dx === 2 && dz === 1) {
          // 中央水渠灌溉整块农田，作物随机刻不会因缺水暂停
          setRaw(data, cfg, x0 + dx, baseY, z0 + dz, b.water);
        } else {
          setRaw(data, cfg, x0 + dx, baseY, z0 + dz, b.farmland || b.dirt);
          const crop = cropIds[(dx + dz * 2) % cropIds.length];
          if (crop) {
            const x = x0 + dx;
            const y = baseY + 1;
            const z = z0 + dz;
            setIfAir(data, cfg, x, y, z, crop);
            crops.push({ x: x, y: y, z: z, stage: (dx + dz) % 5 });
          }
        }
      }
    }
    setIfAir(data, cfg, x0, baseY + 1, z0, b.hay);
    setIfAir(data, cfg, x0, baseY + 2, z0, b.hay);
    setIfAir(data, cfg, x0 + w - 1, baseY + 1, z0 + d - 1, b.composter);
    return crops;
  }

  /**
   * 道路旁的路灯
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {number} x 坐标
   * @param {number} z 坐标
   * @param {number} baseY 地面高度
   */
  function buildLampPost(data, cfg, x, z, baseY) {
    const b = ids();
    setRaw(data, cfg, x, baseY + 1, z, b.wood);
    setRaw(data, cfg, x, baseY + 2, z, b.wood);
    setIfAir(data, cfg, x, baseY + 3, z, b.lantern);
  }

  /**
   * 生成村庄：十字道路、水井、四栋房屋、农田与路灯
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {{x:number,z:number,topY:number}} site 村庄中心
   * @returns {object} 村庄信息
   */
  function buildVillage(data, cfg, site) {
    const b = ids();
    const cx = site.x;
    const cz = site.z;
    const baseY = site.topY;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -11; dx <= 11; dx++) {
        setRaw(data, cfg, cx + dx, baseY, cz + dz, b.cobblestone);
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -11; dz <= 11; dz++) {
        setRaw(data, cfg, cx + dx, baseY, cz + dz, b.cobblestone);
      }
    }

    buildWell(data, cfg, cx, cz, baseY);

    const houses = [];
    houses.push(buildHouse(data, cfg, cx - 11, cz - 7, 7, 6, baseY, 'south'));
    houses.push(buildHouse(data, cfg, cx + 5, cz - 7, 6, 6, baseY, 'south'));
    houses.push(buildHouse(data, cfg, cx - 11, cz + 2, 7, 6, baseY, 'north'));
    houses.push(buildHouse(data, cfg, cx + 6, cz + 2, 5, 6, baseY, 'north'));

    const farmPlants = buildFarm(data, cfg, cx + 3, cz + 8, baseY);

    buildLampPost(data, cfg, cx - 5, cz - 1, baseY);
    buildLampPost(data, cfg, cx + 5, cz + 1, baseY);
    buildLampPost(data, cfg, cx - 1, cz - 5, baseY);
    buildLampPost(data, cfg, cx + 1, cz + 5, baseY);

    if (b.bell) setIfAir(data, cfg, cx - 2, baseY + 1, cz + 2, b.bell);
    if (b.lectern) setIfAir(data, cfg, cx + 2, baseY + 1, cz - 2, b.lectern);

    const spawns = [
      { x: cx + 2.5, y: baseY + 1, z: cz + 1.5 },
      { x: cx - 2.5, y: baseY + 1, z: cz - 2.5 },
      { x: cx + 2.5, y: baseY + 1, z: cz - 4.5 },
      { x: cx - 4.5, y: baseY + 1, z: cz + 2.5 }
    ];

    return {
      x: cx, z: cz, y: baseY, radius: 13,
      houses: houses,
      chests: houses.map(function (h) { return h.chest; }),
      spawns: spawns,
      plants: farmPlants
    };
  }

  // ---------------------------------------------------------------- 传送门
  /**
   * 建造一座传送门：由框架方块围出 3 宽 × 4 高的门面，内部铺满传送门方块
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {number} x0 左柱 x
   * @param {number} z 门面 z
   * @param {number} baseY 地面高度
   * @param {number} frameId 框架方块
   * @param {number} coreId 门面方块
   * @param {string} target 目标维度键
   * @param {string} name 展示名称
   * @returns {{target:string,name:string,x:number,y:number,z:number,frameId:number}} 传送门信息
   */
  function buildPortal(data, cfg, x0, z, baseY, frameId, coreId, target, name) {
    const width = 3;
    const height = 4;
    for (let dy = 0; dy <= height + 1; dy++) {
      for (let dx = 0; dx <= width + 1; dx++) {
        const edge = dx === 0 || dx === width + 1 || dy === 0 || dy === height + 1;
        const x = x0 + dx;
        const y = baseY + dy;
        if (edge) setRaw(data, cfg, x, y, z, frameId);
        else setRaw(data, cfg, x, y, z, coreId);
      }
    }
    return {
      target: target,
      name: name,
      x: x0 + Math.floor((width + 1) / 2),
      y: baseY + 2,
      z: z,
      frameId: frameId
    };
  }

  // ---------------------------------------------------------------- 球面装饰
  /**
   * 由球面法线构造局部切平面基
   * @param {number} nx 法线 x
   * @param {number} ny 法线 y
   * @param {number} nz 法线 z
   * @returns {{ex:number,ey:number,ez:number,ux:number,uy:number,uz:number}} 东/北方向
   */
  function basisFromNormal(nx, ny, nz) {
    const useZ = Math.abs(ny) > 0.9;
    const rx = 0;
    const ry = useZ ? 0 : 1;
    const rz = useZ ? 1 : 0;

    let ex = ny * rz - nz * ry;
    let ey = nz * rx - nx * rz;
    let ez = nx * ry - ny * rx;
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el; ey /= el; ez /= el;

    return {
      ex: ex, ey: ey, ez: ez,
      ux: ey * nz - ez * ny,
      uy: ez * nx - ex * nz,
      uz: ex * ny - ey * nx
    };
  }

  /**
   * 在以球面点为原点的局部坐标系里写入方块
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {object} p 地表点（含法线）
   * @param {object} basis 局部基
   * @param {number} lx 切向偏移 x
   * @param {number} ly 径向偏移（0 为地表上方一格）
   * @param {number} lz 切向偏移 z
   * @param {number} id 方块 ID
   * @param {boolean} [onlyAir] 是否只替换空气
   */
  function writeLocal(data, cfg, p, basis, lx, ly, lz, id, onlyAir) {
    if (!id) return;
    const x = Math.floor(p.x + 0.5 + p.nx * (ly + 1) + basis.ex * lx + basis.ux * lz);
    const y = Math.floor(p.y + 0.5 + p.ny * (ly + 1) + basis.ey * lx + basis.uy * lz);
    const z = Math.floor(p.z + 0.5 + p.nz * (ly + 1) + basis.ez * lx + basis.uz * lz);
    if (onlyAir) setIfAir(data, cfg, x, y, z, id);
    else setRaw(data, cfg, x, y, z, id);
  }

  /**
   * 在球面上种一棵树（树干沿法线生长，树冠沿切平面展开）
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {object} p 地表点
   * @param {number} leafId 树叶方块
   * @param {number} logId 原木方块
   */
  function plantRadialTree(data, cfg, p, leafId, logId) {
    const basis = basisFromNormal(p.nx, p.ny, p.nz);
    const rand = Noise.hash3i(p.x, p.y, p.z, cfg.seed + 373);
    const height = 4 + Math.floor(rand * 3);

    for (let i = 0; i < height; i++) {
      writeLocal(data, cfg, p, basis, 0, i, 0, logId, false);
    }

    for (let layer = 0; layer < 3; layer++) {
      const radius = layer < 2 ? 2 : 1;
      const ly = height - 2 + layer;
      for (let lz = -radius; lz <= radius; lz++) {
        for (let lx = -radius; lx <= radius; lx++) {
          const corner = Math.abs(lx) === radius && Math.abs(lz) === radius;
          if (corner && Noise.hash3i(p.x + lx * 7, p.z + lz * 13, p.y + layer, cfg.seed + 911) > 0.45) continue;
          writeLocal(data, cfg, p, basis, lx, ly, lz, leafId, true);
        }
      }
    }
    writeLocal(data, cfg, p, basis, 0, height, 0, leafId, true);
  }

  /**
   * 球面仙人掌
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {object} p 地表点
   */
  function plantRadialCactus(data, cfg, p) {
    const cactus = ids().cactus;
    if (!cactus) return;
    const basis = basisFromNormal(p.nx, p.ny, p.nz);
    const height = 1 + Math.floor(Noise.hash3i(p.x, p.y, p.z, cfg.seed + 451) * 3);
    for (let i = 0; i < height; i++) {
      writeLocal(data, cfg, p, basis, 0, i, 0, cactus, true);
    }
  }

  /**
   * 球面光柱 / 石柱（下界玄武岩柱、末地黑曜石柱共用）
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {object} p 地表点
   * @param {number} block 方块 ID
   * @param {number} minH 最小高度
   * @param {number} maxH 最大高度
   * @param {number} [capId] 顶部方块
   */
  function plantRadialPillar(data, cfg, p, block, minH, maxH, capId) {
    const basis = basisFromNormal(p.nx, p.ny, p.nz);
    const rand = Noise.hash3i(p.x, p.y, p.z, cfg.seed + 823);
    const height = minH + Math.floor(rand * (maxH - minH + 1));
    for (let i = 0; i < height; i++) {
      writeLocal(data, cfg, p, basis, 0, i, 0, block, false);
    }
    if (capId) writeLocal(data, cfg, p, basis, 0, height, 0, capId, false);
  }

  /**
   * 球面荧石簇（下界装饰）
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {object} p 地表点
   */
  function plantGlowCluster(data, cfg, p) {
    const glow = ids().glowstone;
    if (!glow) return;
    const basis = basisFromNormal(p.nx, p.ny, p.nz);
    const base = 1 + Math.floor(Noise.hash3i(p.x, p.y, p.z, cfg.seed + 127) * 4);
    for (let lz = -1; lz <= 1; lz++) {
      for (let lx = -1; lx <= 1; lx++) {
        if (Math.abs(lx) + Math.abs(lz) > 1) continue;
        writeLocal(data, cfg, p, basis, lx, base, lz, glow, true);
      }
    }
    writeLocal(data, cfg, p, basis, 0, base + 1, 0, glow, true);
    writeLocal(data, cfg, p, basis, 0, base - 1, 0, glow, true);
  }

  /**
   * 按群系撒装饰：主世界树木/仙人掌，下界菌类/荧石/玄武岩，末地黑曜石柱/紫珀塔
   * @param {string} dimension 维度键
   * @param {Uint16Array} data 世界数据
   * @param {object} cfg 世界配置
   * @param {object[]} points 地表点列表
   * @returns {{trees:number,features:number}} 装饰统计
   */
  function decorate(dimension, data, cfg, points) {
    const b = ids();
    let trees = 0;
    let features = 0;
    let plants = 0;
    const plantId = function (key) {
      return Voxel.PlantRules ? Voxel.PlantRules.idOf(key) : 0;
    };

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      // 出生平台上不生成装饰，避免挡住村庄与传送门
      if (p.ny > 0.94) continue;

      const pick = Noise.hash3i(p.x, p.y, p.z, cfg.seed + 55);

      if (dimension === 'overworld') {
        if (p.code === Biomes.OVERWORLD.CODES.DESERT) {
          if (pick > 0.997) { plantRadialCactus(data, cfg, p); features++; }
          else if (pick > 0.985) {
            writeLocal(data, cfg, p, basisFromNormal(p.nx, p.ny, p.nz), 0, 0, 0, plantId('dead_bush'), true);
            plants++;
          }
        } else if (p.code === Biomes.OVERWORLD.CODES.FOREST) {
          if (pick > 0.988) { plantRadialTree(data, cfg, p, b.leaves, b.wood); trees++; }
          else if (pick > 0.952) {
            const herbs = ['grass', 'fern', 'poppy', 'dandelion', 'cornflower', 'lily_of_the_valley'];
            const herb = herbs[Math.floor(Noise.hash3i(p.z, p.x, p.y, cfg.seed + 551) * herbs.length)];
            writeLocal(data, cfg, p, basisFromNormal(p.nx, p.ny, p.nz), 0, 0, 0, plantId(herb), true);
            plants++;
          }
        } else if (p.code === Biomes.OVERWORLD.CODES.SNOWY) {
          if (pick > 0.994) { plantRadialTree(data, cfg, p, b.spruceLeaves, b.wood); trees++; }
          else if (pick > 0.986) {
            writeLocal(data, cfg, p, basisFromNormal(p.nx, p.ny, p.nz), 0, 0, 0, plantId('fern'), true);
            plants++;
          }
        } else if (p.code === Biomes.OVERWORLD.CODES.PLAINS) {
          if (pick > 0.996) { plantRadialTree(data, cfg, p, b.leaves, b.wood); trees++; }
          else if (pick > 0.962) {
            const herbs = ['grass', 'dandelion', 'poppy', 'azure_bluet', 'oxeye_daisy', 'tall_grass'];
            const herb = herbs[Math.floor(Noise.hash3i(p.z, p.x, p.y, cfg.seed + 557) * herbs.length)];
            writeLocal(data, cfg, p, basisFromNormal(p.nx, p.ny, p.nz), 0, 0, 0, plantId(herb), true);
            plants++;
          }
        }
      } else if (dimension === 'nether') {
        if (p.code === Biomes.NETHER.CODES.CRIMSON) {
          if (pick > 0.992) {
            plantRadialPillar(data, cfg, p, b.crimsonStem, 3, 5, b.netherWart);
            features++;
          } else if (pick > 0.972) {
            const herb = pick > 0.982 ? 'crimson_fungus' : 'crimson_roots';
            writeLocal(data, cfg, p, basisFromNormal(p.nx, p.ny, p.nz), 0, 0, 0, plantId(herb), true);
            plants++;
          }
        } else if (p.code === Biomes.NETHER.CODES.WARPED) {
          if (pick > 0.992) {
            plantRadialPillar(data, cfg, p, b.warpedStem, 3, 5, b.warpedWart);
            features++;
          } else if (pick > 0.972) {
            const herb = pick > 0.982 ? 'warped_fungus' : 'warped_roots';
            writeLocal(data, cfg, p, basisFromNormal(p.nx, p.ny, p.nz), 0, 0, 0, plantId(herb), true);
            plants++;
          }
        } else if (p.code === Biomes.NETHER.CODES.BASALT) {
          if (pick > 0.994) {
            plantRadialPillar(data, cfg, p, b.basalt, 3, 7);
            features++;
          }
        } else if (p.code === Biomes.NETHER.CODES.SOUL_VALLEY) {
          if (pick > 0.997) {
            plantRadialPillar(data, cfg, p, b.bone, 2, 4);
            features++;
          }
        } else if (pick > 0.996) {
          plantGlowCluster(data, cfg, p);
          features++;
        }
      } else {
        if (p.code === Biomes.END.CODES.PURPUR) {
          if (pick > 0.991) {
            plantRadialPillar(data, cfg, p, b.purpurPillar, 3, 6, b.purpur);
            features++;
          }
        } else if (pick > 0.9992) {
          plantRadialPillar(data, cfg, p, b.obsidian, 6, 11, b.amethyst);
          features++;
        }
      }
    }

    return { trees: trees, features: features, plants: plants };
  }

  // ---------------------------------------------------------------- 对外入口
  /**
   * 生成指定维度的球形世界
   * @param {string} dimension 维度键：overworld / nether / end
   * @param {Uint16Array} data 世界方块数组（长度 = W*H*D）
   * @param {object} cfg 世界配置
   * @returns {object} 维度信息（出生点、群系、村庄、传送门、生物出生点）
   */
  function generate(dimension, data, cfg) {
    const opts = DIMS[dimension];
    if (!opts) throw new Error('未知维度：' + dimension);

    const fill = fillPlanet(dimension, data, cfg, opts);
    const plateau = buildPlateau(data, cfg, opts, fill.palette);
    const b = ids();

    // 出生平台上建造设施
    let village = null;
    const portals = [];
    if (dimension === 'overworld') {
      village = buildVillage(data, cfg, plateau);
      const left = buildPortal(data, cfg, plateau.x - 21, plateau.z,
        plateau.topY, b.obsidian, b.amethyst, 'nether', '下界传送门');
      const right = buildPortal(data, cfg, plateau.x + 21, plateau.z,
        plateau.topY, b.endStoneBrick, b.purpur, 'end', '末地传送门');
      portals.push(left, right);
    } else {
      // 下界 / 末地各留一座返回主世界的传送门
      const ret = buildPortal(data, cfg, plateau.x, plateau.z + 14,
        plateau.topY,
        dimension === 'nether' ? b.obsidian : b.endStoneBrick,
        dimension === 'nether' ? b.amethyst : b.purpur,
        'overworld', '返回主世界');
      portals.push(ret);
    }

    const deco = decorate(dimension, data, cfg, fill.surfacePoints);

    // 生物出生点
    const mobSpawns = [];
    const spawnX = plateau.x + 0.5;
    const spawnZ = plateau.z + Math.min(19.5, plateau.radius - 4);
    const feetY = plateau.feetY;

    if (dimension === 'overworld') {
      const animalTypes = ['pig', 'cow', 'sheep', 'chicken'];
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 + 0.4;
        const radius = 19 + (i % 3) * 2.2;
        const x = plateau.x + Math.round(Math.cos(angle) * radius) + 0.5;
        const z = plateau.z + Math.round(Math.sin(angle) * radius) + 0.5;
        mobSpawns.push({ type: animalTypes[i % animalTypes.length], x: x, y: feetY, z: z });
      }
      if (village) {
        village.spawns.forEach(function (s) {
          mobSpawns.push({ type: 'villager', x: s.x, y: s.y, z: s.z });
        });
      }
    } else if (dimension === 'nether') {
      const types = ['piglin', 'blaze', 'piglin', 'ghast', 'magma', 'blaze'];
      for (let i = 0; i < types.length; i++) {
        const angle = (i / types.length) * Math.PI * 2;
        const radius = 7 + (i % 2) * 4;
        const flying = types[i] === 'ghast' || types[i] === 'blaze';
        mobSpawns.push({
          type: types[i],
          x: plateau.x + Math.round(Math.cos(angle) * radius) + 0.5,
          y: feetY + (flying ? 4 : 0),
          z: plateau.z + Math.round(Math.sin(angle) * radius) + 0.5
        });
      }
    } else {
      const types = ['enderman', 'shulker', 'enderman', 'enderman', 'shulker', 'enderman'];
      for (let i = 0; i < types.length; i++) {
        const angle = (i / types.length) * Math.PI * 2 + 0.25;
        const radius = 8 + (i % 3) * 3;
        mobSpawns.push({
          type: types[i],
          x: plateau.x + Math.round(Math.cos(angle) * radius) + 0.5,
          y: feetY,
          z: plateau.z + Math.round(Math.sin(angle) * radius) + 0.5
        });
      }
    }

    return {
      dimension: dimension,
      name: opts.name,
      radius: opts.radius,
      center: { x: cfg.worldWidth * 0.5, y: cfg.worldHeight * 0.5, z: cfg.worldDepth * 0.5 },
      seaRadius: fill.seaR,
      plateauRadius: opts.plateauRadius,
      spawn: { x: spawnX, y: feetY + 0.001, z: spawnZ },
      spawnX: Math.floor(spawnX),
      spawnZ: Math.floor(spawnZ),
      plateau: plateau,
      village: village,
      portals: portals,
      mobSpawns: mobSpawns,
      animalSpawns: mobSpawns,
      plants: village && village.plants ? village.plants : [],
      plantCount: deco.plants + (village && village.plants ? village.plants.length : 0),
      trees: deco.trees,
      features: deco.features,
      biomes: {
        dimension: dimension,
        counts: Array.from(fill.counts),
        names: Biomes.TABLES[dimension].NAMES
      }
    };
  }

  Voxel.Terrain = {
    DIMS: DIMS,
    generate: generate,
    blockId: blockId,
    plantRadialTree: plantRadialTree
  };
})(window.Voxel = window.Voxel || {});
