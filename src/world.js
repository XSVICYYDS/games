/**
 * world.js
 * 体素世界：方块数据存储 + 区块化网格生成（面剔除 + 顶点 AO + 透明层分离）。
 * 每个区块最多拆成三份网格：不透明层、水层、玻璃层，
 * 改动方块时只重建受影响的区块，透明方块不参与 AO 与阴影投射。
 */
(function (Voxel) {
  'use strict';

  const Blocks = Voxel.Blocks;
  const ID = Blocks.ID;

  /** 区块水平边长 */
  const CHUNK_SIZE = 16;

  /** 顶点 AO 对应的亮度系数（0 最暗，3 最亮） */
  const AO_SHADE = [0.48, 0.66, 0.84, 1.0];

  /** 渲染层列表（顺序即透明层的绘制顺序） */
  const LAYERS = ['opaque', 'glow', 'plant', 'water', 'glass'];

  /**
   * 六个面的几何定义（逆时针顶点，法线朝外）
   * verts: 单位立方体的 4 个顶点偏移；uv: 对应的贴图 UV；shade: 基础明暗（增强立体感）
   */
  const FACES = [
    {
      // +X（东）
      n: [1, 0, 0],
      verts: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
      uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
      shade: 0.84
    },
    {
      // -X（西）
      n: [-1, 0, 0],
      verts: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
      uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
      shade: 0.84
    },
    {
      // +Y（顶面）
      n: [0, 1, 0],
      verts: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
      uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
      shade: 1.0
    },
    {
      // -Y（底面）
      n: [0, -1, 0],
      verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
      shade: 0.55
    },
    {
      // +Z（南）
      n: [0, 0, 1],
      verts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
      uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
      shade: 0.78
    },
    {
      // -Z（北）
      n: [0, 0, -1],
      verts: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
      uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
      shade: 0.78
    }
  ];

  /**
   * 向区块顶点桶追加一个独立四边形，用于植物交叉面片和睡莲水平面片
   * @param {object} bucket 顶点桶
   * @param {number[][]} verts 四个世界坐标顶点
   * @param {number[]} normal 面法线
   * @param {object} uvInfo 图集 UV 范围
   * @param {number} brightness 顶点亮度
   */
  function appendQuad(bucket, verts, normal, uvInfo, brightness) {
    const base = bucket.pos.length / 3;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      bucket.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      bucket.norm.push(normal[0], normal[1], normal[2]);
      bucket.uv.push(
        uvInfo.u0 + uv[i][0] * (uvInfo.u1 - uvInfo.u0),
        uvInfo.v0 + uv[i][1] * (uvInfo.v1 - uvInfo.v0)
      );
      bucket.col.push(brightness, brightness, brightness);
    }
    bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  class World {
    /**
     * @param {object} config 世界配置：worldWidth / worldHeight / worldDepth
     */
    constructor(config) {
      this.cfg = config;
      this.W = config.worldWidth;
      this.H = config.worldHeight;
      this.D = config.worldDepth;

      // 千级方块目录需要 10 位 ID，使用 16 位数组避免 Uint8 在 255 处截断
      this.data = new Uint16Array(this.W * this.H * this.D);

      this.chunksX = Math.ceil(this.W / CHUNK_SIZE);
      this.chunksZ = Math.ceil(this.D / CHUNK_SIZE);

      /** @type {Array<{cx:number,cz:number,meshes:object,dirty:boolean,faces:number}>} */
      this.chunks = [];
      /** 待重建区块队列 */
      this.dirtyQueue = [];

      /** 被激活的红石位置集合（索引见 keyOf） */
      this.powered = new Set();

      /** 作物生长阶段：只保存活动植株，渲染时按索引选择对应瓦片 */
      this.plantStages = new Map();
      /** 缺水作物集合：缺水的作物使用较暗颜色并暂停随机刻生长 */
      this.plantDry = new Set();

      /** 玩家改动过的方块：索引 -> 方块 ID（存档只记录增量，三维度共用格式） */
      this.delta = new Map();

      /** 所有区块网格挂在同一个 Group 下，便于统一处理阴影、可见性 */
      this.group = new THREE.Group();
      this.group.name = 'chunks';

      // 不透明层：受光照与阴影影响
      this.material = new THREE.MeshLambertMaterial({
        map: Blocks.texture,
        vertexColors: true
      });

      // 发光方块层：使用不受光照影响的基础材质，呈现自发光满亮效果
      this.glowMaterial = new THREE.MeshBasicMaterial({
        map: Blocks.texture,
        vertexColors: true,
        alphaTest: 0.32,
        side: THREE.DoubleSide
      });

      // 植物与镂空材质：透明像素裁切 + 双面，交叉面片不会变成实心立方体
      this.plantMaterial = new THREE.MeshLambertMaterial({
        map: Blocks.texture,
        vertexColors: true,
        alphaTest: 0.32,
        side: THREE.DoubleSide
      });

      // 水：半透明、双面（潜入水下也能看到水面）、不写深度避免排序冲突
      this.waterMaterial = new THREE.MeshBasicMaterial({
        map: Blocks.texture,
        vertexColors: true,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      // 玻璃：更淡的半透明材质，同样双面 + 不写深度
      this.glassMaterial = new THREE.MeshBasicMaterial({
        map: Blocks.texture,
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      this.stats = { builtChunks: 0 };
    }

    /**
     * 三维坐标转数据索引
     * @param {number} x 坐标
     * @param {number} y 坐标
     * @param {number} z 坐标
     * @returns {number} 索引
     */
    index(x, y, z) {
      return (y * this.D + z) * this.W + x;
    }

    /**
     * 数据索引还原成坐标
     * @param {number} key 索引
     * @returns {{x:number,y:number,z:number}} 坐标
     */
    decodeKey(key) {
      return {
        x: key % this.W,
        z: Math.floor(key / this.W) % this.D,
        y: Math.floor(key / (this.W * this.D))
      };
    }

    /**
     * 读取方块（渲染/射线用）：世界外返回空气，地下返回石头以便剔除底面
     * @param {number} x 坐标
     * @param {number} y 坐标
     * @param {number} z 坐标
     * @returns {number} 方块 ID
     */
    getBlock(x, y, z) {
      if (y < 0) return ID.STONE;
      if (y >= this.H) return ID.AIR;
      if (x < 0 || x >= this.W || z < 0 || z >= this.D) return ID.AIR;
      return this.data[(y * this.D + z) * this.W + x];
    }

    /**
     * 判断是否不透明方块（用于面剔除与顶点 AO）
     * @param {number} x 坐标
     * @param {number} y 坐标
     * @param {number} z 坐标
     * @returns {boolean} 是否不透明
     */
    isOpaque(x, y, z) {
      const id = this.getBlock(x, y, z);
      if (id === ID.AIR) return false;
      const def = Blocks.DEF[id];
      return !!(def && def.opaque);
    }

    /**
     * 判断是否阻挡玩家（世界水平边界外与地下视为固体，形成隐形墙/地板；
     * 水、玻璃等按 solid 属性处理：水不阻挡，玻璃阻挡）
     * @param {number} x 坐标
     * @param {number} y 坐标
     * @param {number} z 坐标
     * @returns {boolean} 是否阻挡
     */
    isSolidAt(x, y, z) {
      if (y < 0) return true;
      if (y >= this.H) return false;
      if (x < 0 || x >= this.W || z < 0 || z >= this.D) return true;
      const id = this.data[(y * this.D + z) * this.W + x];
      if (id === ID.AIR) return false;
      const def = Blocks.DEF[id];
      return def ? def.solid : false;
    }

    /**
     * 判断某位置是否为液体（玩家水中物理用）
     * @param {number} x 坐标
     * @param {number} y 坐标
     * @param {number} z 坐标
     * @returns {boolean} 是否液体
     */
    isLiquidAt(x, y, z) {
      return this.getBlock(x, y, z) === ID.WATER;
    }

    /**
     * 红石位置转为集合键
     * @param {number} x 坐标
     * @param {number} y 坐标
     * @param {number} z 坐标
     * @returns {number} 键
     */
    keyOf(x, y, z) {
      return this.index(x, y, z);
    }

    /**
     * 查询红石是否被激活（网格生成时选择亮/暗贴图）
     * @param {number} x 坐标
     * @param {number} y 坐标
     * @param {number} z 坐标
     * @returns {boolean} 是否点亮
     */
    isPowered(x, y, z) {
      return this.powered.has(this.keyOf(x, y, z));
    }

    /**
     * 切换单个可交互器件的激活状态，并只重建受影响的区块
     * @param {number} x 坐标 x
     * @param {number} y 坐标 y
     * @param {number} z 坐标 z
     * @param {boolean} on 是否激活
     * @returns {boolean} 状态是否发生变化
     */
    setPowered(x, y, z, on) {
      const key = this.keyOf(x, y, z);
      if (this.powered.has(key) === on) return false;
      if (on) this.powered.add(key);
      else this.powered.delete(key);
      this.markDirtyAround(x, z);
      return true;
    }

    /**
     * 设置一片相连红石的通电状态：从起点开始 BFS 传播，最多 12 格、240 个方块
     * @param {number} x 起点 x
     * @param {number} y 起点 y
     * @param {number} z 起点 z
     * @param {boolean} on 是否通电
     * @returns {number} 实际改变状态的方块数量
     */
    setRedstoneActive(x, y, z, on) {
      if (this.getBlock(x, y, z) !== ID.REDSTONE) return 0;

      const MAX_STEPS = 12;
      const MAX_CELLS = 240;
      const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

      const start = this.keyOf(x, y, z);
      const seen = new Set([start]);
      const queue = [{ x: x, y: y, z: z, step: 0 }];

      // 逐层扩散，只沿着相邻红石方块传播，避免把整片地下都点亮
      while (queue.length > 0 && seen.size < MAX_CELLS) {
        const cur = queue.shift();
        if (cur.step >= MAX_STEPS) continue;
        for (let d = 0; d < DIRS.length; d++) {
          const nx = cur.x + DIRS[d][0];
          const ny = cur.y + DIRS[d][1];
          const nz = cur.z + DIRS[d][2];
          if (this.getBlock(nx, ny, nz) !== ID.REDSTONE) continue;
          const key = this.keyOf(nx, ny, nz);
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ x: nx, y: ny, z: nz, step: cur.step + 1 });
        }
      }

      let changed = 0;
      const self = this;
      seen.forEach(function (key) {
        const p = self.decodeKey(key);
        if (on) {
          if (!self.powered.has(key)) {
            self.powered.add(key);
            changed++;
          }
        } else if (self.powered.delete(key)) {
          changed++;
        }
        self.markDirtyAround(p.x, p.z);
      });
      return changed;
    }

    /**
     * 创建所有区块占位对象（此时还没有几何体）
     * @returns {number} 区块总数
     */
    createChunks() {
      for (let cz = 0; cz < this.chunksZ; cz++) {
        for (let cx = 0; cx < this.chunksX; cx++) {
          this.chunks.push({
            cx: cx,
            cz: cz,
            meshes: { opaque: null, glow: null, water: null, glass: null },
            dirty: true,
            faces: 0
          });
        }
      }
      return this.chunks.length;
    }

    /**
     * 标记某个区块需要重建，并加入队列
     * @param {number} cx 区块 x 下标
     * @param {number} cz 区块 z 下标
     */
    markChunkDirty(cx, cz) {
      if (cx < 0 || cx >= this.chunksX || cz < 0 || cz >= this.chunksZ) return;
      const chunk = this.chunks[cz * this.chunksX + cx];
      if (!chunk || chunk.dirty) return;
      chunk.dirty = true;
      this.dirtyQueue.push(chunk);
    }

    /**
     * 修改变方块时，同时标记所在区块及其相邻区块（边界方块的 AO 会影响邻居）
     * @param {number} x 坐标
     * @param {number} z 坐标
     */
    markDirtyAround(x, z) {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      this.markChunkDirty(cx, cz);
      if (x % CHUNK_SIZE === 0) this.markChunkDirty(cx - 1, cz);
      if (x % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx + 1, cz);
      if (z % CHUNK_SIZE === 0) this.markChunkDirty(cx, cz - 1);
      if (z % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkDirty(cx, cz + 1);
    }

    /**
     * 写入方块并触发区块重建
     * @param {number} x 坐标
     * @param {number} y 坐标
     * @param {number} z 坐标
     * @param {number} id 方块 ID（0 为空气）
     * @returns {boolean} 是否真的发生了变化
     */
    setBlock(x, y, z, id) {
      if (x < 0 || x >= this.W || y < 0 || y >= this.H || z < 0 || z >= this.D) return false;
      const i = this.index(x, y, z);
      if (this.data[i] === id) return false;
      this.data[i] = id;
      this.delta.set(i, id); // 记录增量，供存档使用
      this.plantStages.delete(i);
      this.plantDry.delete(i);
      if (id === ID.AIR) {
        this.powered.delete(i); // 红石被拆掉时清除通电状态
      }
      this.markDirtyAround(x, z);
      return true;
    }

    /**
     * 更新单株作物阶段并只重建所在区块，不改动方块 ID 或扫描其他植株
     * @param {number} x 坐标 x
     * @param {number} y 坐标 y
     * @param {number} z 坐标 z
     * @param {number} stage 生长阶段
     */
    setPlantStage(x, y, z, stage) {
      const key = this.index(x, y, z);
      if (this.plantStages.get(key) === stage) return;
      this.plantStages.set(key, stage);
      this.markDirtyAround(x, z);
    }

    /**
     * 标记作物是否缺水，缺水状态会暂停生长并在网格中变暗
     * @param {number} x 坐标 x
     * @param {number} y 坐标 y
     * @param {number} z 坐标 z
     * @param {boolean} dry 是否缺水
     */
    setPlantDry(x, y, z, dry) {
      const key = this.index(x, y, z);
      if (dry) {
        if (this.plantDry.has(key)) return;
        this.plantDry.add(key);
      } else {
        if (!this.plantDry.has(key)) return;
        this.plantDry.delete(key);
      }
      this.markDirtyAround(x, z);
    }

    /**
     * 计算某个顶点处的环境光遮蔽等级
     * @param {number} x 方块坐标 x
     * @param {number} y 方块坐标 y
     * @param {number} z 方块坐标 z
     * @param {object} face 面定义
     * @param {number[]} corner 顶点在该方块内的局部偏移
     * @returns {number} 0~3，3 为完全受光
     */
    vertexAO(x, y, z, face, corner) {
      const n = face.n;
      // 找出该面所在平面的两个轴向
      const axes = [];
      for (let a = 0; a < 3; a++) if (n[a] === 0) axes.push(a);
      const i = axes[0];
      const j = axes[1];
      const si = corner[i] === 1 ? 1 : -1;
      const sj = corner[j] === 1 ? 1 : -1;

      // 把「轴 + 方向」换算成实际坐标偏移
      let dx1 = 0, dy1 = 0, dz1 = 0, dx2 = 0, dy2 = 0, dz2 = 0;
      if (i === 0) dx1 = si; else if (i === 1) dy1 = si; else dz1 = si;
      if (j === 0) dx2 = sj; else if (j === 1) dy2 = sj; else dz2 = sj;

      const px = x + n[0];
      const py = y + n[1];
      const pz = z + n[2];

      const side1 = this.isOpaque(px + dx1, py + dy1, pz + dz1) ? 1 : 0;
      const side2 = this.isOpaque(px + dx2, py + dy2, pz + dz2) ? 1 : 0;
      const cornerBlock = this.isOpaque(px + dx1 + dx2, py + dy1 + dy2, pz + dz1 + dz2) ? 1 : 0;

      if (side1 && side2) return 0;
      return 3 - (side1 + side2 + cornerBlock);
    }

    /**
     * 释放某个区块已有的三份网格
     * @param {object} chunk 区块对象
     */
    disposeChunkMeshes(chunk) {
      for (let i = 0; i < LAYERS.length; i++) {
        const mesh = chunk.meshes[LAYERS[i]];
        if (!mesh) continue;
        this.group.remove(mesh);
        mesh.geometry.dispose();
        chunk.meshes[LAYERS[i]] = null;
      }
    }

    /**
     * 为单个区块构建网格（面剔除 + AO + 透明层分离），必要时先释放旧几何体
     * @param {object} chunk 区块对象
     * @returns {number} 该区块生成的总面数
     */
    buildChunk(chunk) {
      this.disposeChunkMeshes(chunk);

      // 五种渲染层各自维护一份顶点数据
      const buckets = {
        opaque: { pos: [], norm: [], uv: [], col: [], idx: [] },
        glow: { pos: [], norm: [], uv: [], col: [], idx: [] },
        plant: { pos: [], norm: [], uv: [], col: [], idx: [] },
        water: { pos: [], norm: [], uv: [], col: [], idx: [] },
        glass: { pos: [], norm: [], uv: [], col: [], idx: [] }
      };

      const x0 = chunk.cx * CHUNK_SIZE;
      const z0 = chunk.cz * CHUNK_SIZE;
      const x1 = Math.min(x0 + CHUNK_SIZE, this.W);
      const z1 = Math.min(z0 + CHUNK_SIZE, this.D);

      for (let y = 0; y < this.H; y++) {
        for (let z = z0; z < z1; z++) {
          for (let x = x0; x < x1; x++) {
            const id = this.data[(y * this.D + z) * this.W + x];
            if (id === ID.AIR) continue;
            const def = Blocks.DEF[id];
            if (!def) continue;

            let layer = def.layer || 'opaque';
            // 主动发光的方块进入自发光层；可开关器件只在实际激活时发光
            if ((layer === 'opaque' || layer === 'plant') && def.light > 0 &&
              (!def.toggleable || this.isPowered(x, y, z))) {
              layer = 'glow';
            }
            const bucket = buckets[layer];
            const isOpaqueLayer = layer === 'opaque';
            const isGlowLayer = layer === 'glow';
            const litBlock = def.litTile >= 0 && this.isPowered(x, y, z);

            if (def.cross) {
              const plantKey = this.index(x, y, z);
              const plantShade = this.plantDry.has(plantKey) ? 0.52 : 1;
              let plantTile = litBlock ? def.litTile : def.tiles.side;
              if (def.stageTiles) {
                const stage = this.plantStages.get(plantKey) || 0;
                plantTile = def.stageTiles[Math.max(0, Math.min(def.maxStage || 7, stage))];
              }
              const plantUV = Blocks.getTileUV(plantTile);
              if (def.shape === 'lily') {
                appendQuad(bucket, [
                  [x, y + 0.04, z + 1], [x + 1, y + 0.04, z + 1],
                  [x + 1, y + 0.04, z], [x, y + 0.04, z]
                ], [0, 1, 0], plantUV, plantShade);
              } else {
                appendQuad(bucket, [
                  [x + 0.06, y, z + 0.06], [x + 0.94, y, z + 0.94],
                  [x + 0.94, y + 1, z + 0.94], [x + 0.06, y + 1, z + 0.06]
                ], [-0.7, 0, 0.7], plantUV, 0.94 * plantShade);
                appendQuad(bucket, [
                  [x + 0.94, y, z + 0.06], [x + 0.06, y, z + 0.94],
                  [x + 0.06, y + 1, z + 0.94], [x + 0.94, y + 1, z + 0.06]
                ], [0.7, 0, 0.7], plantUV, 0.86 * plantShade);
              }
              continue;
            }

            for (let f = 0; f < 6; f++) {
              const face = FACES[f];
              const nx = x + face.n[0];
              const ny = y + face.n[1];
              const nz = z + face.n[2];
              const nid = this.getBlock(nx, ny, nz);

              if (nid !== ID.AIR) {
                const ndef = Blocks.DEF[nid];
                // 邻居不透明：本面被完全遮挡
                if (ndef && ndef.opaque) continue;
                // 同种透明方块相邻：内部面隐藏（水连成一片、玻璃不留内壁）
                if (ndef && !ndef.opaque && nid === id) continue;
              }

              // 红石、熔炉、灯具等器件激活后使用各自的高亮贴图
              let tile;
              if (litBlock) tile = def.litTile;
              else tile = f === 2 ? def.tiles.top : (f === 3 ? def.tiles.bottom : def.tiles.side);
              const uvInfo = Blocks.getTileUV(tile);
              const base = bucket.pos.length / 3;

              for (let v = 0; v < 4; v++) {
                const p = face.verts[v];
                bucket.pos.push(x + p[0], y + p[1], z + p[2]);
                bucket.norm.push(face.n[0], face.n[1], face.n[2]);

                const t = face.uv[v];
                bucket.uv.push(
                  uvInfo.u0 + t[0] * (uvInfo.u1 - uvInfo.u0),
                  uvInfo.v0 + t[1] * (uvInfo.v1 - uvInfo.v0)
                );

                // 透明方块不烘焙 AO，避免出现黑面/脏边；发光层保持接近满亮
                let b;
                if (isGlowLayer) {
                  b = Math.min(1, face.shade * 0.9 + 0.18);
                } else {
                  const ao = isOpaqueLayer ? this.vertexAO(x, y, z, face, p) : 3;
                  b = face.shade * AO_SHADE[ao];
                }
                bucket.col.push(b, b, b);
              }

              bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
          }
        }
      }

      let totalFaces = 0;

      for (let i = 0; i < LAYERS.length; i++) {
        const layer = LAYERS[i];
        const bucket = buckets[layer];
        const faceCount = bucket.idx.length / 6;
        totalFaces += faceCount;
        if (faceCount === 0) continue;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.norm, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.col, 3));
        geometry.setIndex(bucket.idx);
        geometry.computeBoundingSphere();

        let mesh;
        if (layer === 'opaque') {
          mesh = new THREE.Mesh(geometry, this.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        } else if (layer === 'glow') {
          // 自发光层：投影但不受阴影影响，保证灯具等始终明亮
          mesh = new THREE.Mesh(geometry, this.glowMaterial);
          mesh.castShadow = true;
          mesh.receiveShadow = false;
        } else if (layer === 'plant') {
          mesh = new THREE.Mesh(geometry, this.plantMaterial);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
        } else {
          mesh = new THREE.Mesh(
            geometry,
            layer === 'water' ? this.waterMaterial : this.glassMaterial
          );
          mesh.castShadow = false;   // 透明方块不投影，避免阴影穿透/变黑
          mesh.receiveShadow = false;
          mesh.renderOrder = layer === 'water' ? 4 : 5; // 玻璃画在水之后
        }

        mesh.matrixAutoUpdate = false; // 区块不会移动，省掉矩阵更新
        mesh.updateMatrix();
        this.group.add(mesh);
        chunk.meshes[layer] = mesh;
      }

      chunk.faces = totalFaces;
      if (totalFaces > 0) this.stats.builtChunks++;

      return totalFaces;
    }

    /**
     * 分批构建初始区块（配合加载进度条，避免一次性卡住页面）
     * @param {number} count 本次最多构建的区块数
     * @returns {number} 本次实际构建数量
     */
    buildSomeChunks(count) {
      let built = 0;
      for (let i = 0; i < this.chunks.length && built < count; i++) {
        const chunk = this.chunks[i];
        if (!chunk.dirty) continue;
        chunk.dirty = false;
        this.buildChunk(chunk);
        built++;
      }
      return built;
    }

    /**
     * 处理方块编辑后的重建队列（每帧限量，避免卡顿）
     * @param {number} limit 本帧最多重建的区块数
     * @returns {number} 本帧重建数量
     */
    flushDirtyQueue(limit) {
      let done = 0;
      while (this.dirtyQueue.length > 0 && done < limit) {
        const chunk = this.dirtyQueue.shift();
        chunk.dirty = false;
        this.buildChunk(chunk);
        done++;
      }
      return done;
    }

    /**
     * 统计已构建完成的区块数量
     * @returns {number}
     */
    countBuiltChunks() {
      let n = 0;
      for (let i = 0; i < this.chunks.length; i++) {
        if (!this.chunks[i].dirty) n++;
      }
      return n;
    }

    /**
     * 统计当前世界中实际渲染的面数（用于 HUD 观察性能）
     * @returns {number}
     */
    getTotalFaces() {
      let total = 0;
      for (let i = 0; i < this.chunks.length; i++) {
        total += this.chunks[i].faces;
      }
      return total;
    }

    /**
     * 开关阴影：只影响不透明层（水与玻璃本来就不投影）
     * @param {boolean} enabled 是否开启
     */
    setShadowEnabled(enabled) {
      this.material.needsUpdate = true;
      for (let i = 0; i < this.chunks.length; i++) {
        const mesh = this.chunks[i].meshes.opaque;
        if (mesh) {
          mesh.castShadow = enabled;
          mesh.receiveShadow = enabled;
        }
      }
    }
  }

  Voxel.World = World;
  Voxel.CHUNK_SIZE = CHUNK_SIZE;
})(window.Voxel = window.Voxel || {});
