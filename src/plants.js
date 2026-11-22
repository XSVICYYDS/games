/**
 * plants.js
 * 植物支撑、随机刻生长、作物成熟度与树苗成树。
 * 只跟踪仍会生长的活动植株，每批处理有限数量，避免每帧遍历世界方块。
 */
(function (Voxel) {
  'use strict';

  const Blocks = Voxel.Blocks;
  const BY_KEY = Blocks.BY_KEY;
  const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const SOIL_KEYS = [
    'grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium',
    'dirt_path', 'moss_block', 'mud', 'farmland'
  ];
  const SAPLING_TREES = {
    oak_sapling: ['oak_log', 'oak_leaves', 4, 6],
    birch_sapling: ['birch_log', 'birch_leaves', 5, 7],
    spruce_sapling: ['spruce_log', 'spruce_leaves', 5, 8],
    jungle_sapling: ['jungle_log', 'jungle_leaves', 5, 8],
    acacia_sapling: ['acacia_log', 'acacia_leaves', 4, 7],
    dark_oak_sapling: ['dark_oak_log', 'dark_oak_leaves', 5, 7],
    cherry_sapling: ['cherry_log', 'cherry_leaves', 4, 7],
    mangrove_propagule: ['mangrove_log', 'mangrove_leaves', 4, 7]
  };
  const COLUMN_LIMITS = { sugar_cane: 3, cactus: 3, bamboo: 12, kelp: 8 };

  /**
   * 按不带命名空间的注册名取得方块 ID
   * @param {string} key 注册名
   * @returns {number} 方块 ID，不存在返回 0
   */
  function idOf(key) {
    return BY_KEY['minecraft:' + key] || 0;
  }

  /**
   * 读取方块不带命名空间的注册名
   * @param {number} id 方块 ID
   * @returns {string} 注册名
   */
  function keyOf(id) {
    const def = Blocks.DEF[id];
    return def && def.key ? def.key.replace(/^minecraft:/, '') : '';
  }

  /**
   * 判断注册名是否属于可种植土壤
   * @param {number} id 方块 ID
   * @returns {boolean} 是否适宜普通花草与树苗
   */
  function isSoil(id) {
    const key = keyOf(id);
    return SOIL_KEYS.indexOf(key) >= 0;
  }

  /**
   * 判断方块是否是水
   * @param {number} id 方块 ID
   * @returns {boolean} 是否为水
   */
  function isWater(id) {
    return id === Blocks.ID.WATER || keyOf(id) === 'water';
  }

  /**
   * 活动植物管理器：每个维度一个实例，存档仅保存阶段与活动索引
   */
  class PlantManager {
    /**
     * @param {Voxel.World} world 所属世界
     * @param {object} info 地形生成信息
     */
    constructor(world, info) {
      this.world = world;
      this.info = info;
      this.active = new Map();
      this.tickTimer = 0;
      this.cursor = 0;
      this.batchSize = 32;
      this.onDrop = null;
      this.onNotice = null;
      this.restore(null);
    }

    /**
     * 返回植物的生长规则类型；空字符串表示静态植物或非植物
     * @param {number} id 方块 ID
     * @returns {string} 生长规则
     */
    ruleFor(id) {
      const def = Blocks.DEF[id];
      const key = keyOf(id);
      if (!def) return '';
      if (def.crop) return 'crop';
      if (key === 'pumpkin_stem' || key === 'melon_stem') return 'stem';
      if (SAPLING_TREES[key]) return 'sapling';
      if (COLUMN_LIMITS[key]) return 'column';
      if (key === 'vine') return 'vine';
      if (key === 'nether_wart') return 'wart';
      if (key === 'cocoa') return 'cocoa';
      return '';
    }

    /**
     * 判断方块是否需要植物支撑或附着检查
     * @param {number} id 方块 ID
     * @returns {boolean} 是否按植物处理
     */
    isPlant(id) {
      const def = Blocks.DEF[id];
      const key = keyOf(id);
      return !!(def && (def.cross || def.shape === 'lily' || key === 'cactus'));
    }

    /**
     * 检查耕地附近四格内是否有水，决定作物是否暂停生长
     * @param {number} x 作物坐标 x
     * @param {number} y 作物坐标 y
     * @param {number} z 作物坐标 z
     * @returns {boolean} 是否已灌溉
     */
    hasWater(x, y, z) {
      for (let dy = -1; dy <= 0; dy++) {
        for (let dz = -4; dz <= 4; dz++) {
          for (let dx = -4; dx <= 4; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > 6) continue;
            if (isWater(this.world.getBlock(x + dx, y + dy, z + dz))) return true;
          }
        }
      }
      return false;
    }

    /**
     * 检查目标位置能否放置所选植物，并给出玩家可读的原因
     * @param {number} id 待放置方块 ID
     * @param {number} x 目标坐标 x
     * @param {number} y 目标坐标 y
     * @param {number} z 目标坐标 z
     * @returns {{ok:boolean,reason:string}} 检查结果
     */
    canPlace(id, x, y, z) {
      if (!this.isPlant(id)) return { ok: true, reason: '' };
      const key = keyOf(id);
      const below = this.world.getBlock(x, y - 1, z);
      const above = this.world.getBlock(x, y + 1, z);
      const here = this.world.getBlock(x, y, z);
      const belowKey = keyOf(below);
      const ok = function () { return { ok: true, reason: '' }; };
      const fail = function (reason) { return { ok: false, reason: reason }; };

      if (Blocks.DEF[id].crop) {
        return belowKey === 'farmland' ? ok() : fail('作物只能种在耕地上');
      }
      if (key === 'nether_wart') {
        return belowKey === 'soul_sand' ? ok() : fail('下界疣只能种在灵魂沙上');
      }
      if (key === 'pumpkin_stem' || key === 'melon_stem') {
        return belowKey === 'farmland' ? ok() : fail('南瓜茎与西瓜茎需要耕地');
      }
      if (SAPLING_TREES[key]) {
        return isSoil(below) ? ok() : fail('树苗需要草方块、泥土或灰化土');
      }
      if (key === 'cactus') {
        if (below === id) return ok();
        return belowKey === 'sand' || belowKey === 'red_sand' ? ok() : fail('仙人掌只能种在沙子或红沙上');
      }
      if (key === 'sugar_cane') {
        if (below === id) return ok();
        if (!isSoil(below) && belowKey !== 'sand' && belowKey !== 'red_sand') {
          return fail('甘蔗需要泥土、草方块或沙子');
        }
        const hydrated = DIRS4.some(function (d) {
          return isWater(this.world.getBlock(x + d[0], y - 1, z + d[1])) ||
            isWater(this.world.getBlock(x + d[0], y, z + d[1]));
        }, this);
        return hydrated ? ok() : fail('甘蔗必须紧邻水源');
      }
      if (key === 'bamboo') {
        if (below === id) return ok();
        return isSoil(below) || belowKey === 'sand' || belowKey === 'gravel' ? ok() : fail('竹子需要土壤、沙子或沙砾');
      }
      if (key === 'kelp') {
        if (!isWater(here) && !isWater(below) && below !== id) return fail('海带必须放在水中');
        return isWater(below) || below === id ? ok() : fail('海带需要从水底向上生长');
      }
      if (key === 'seagrass' || key === 'tall_seagrass' || /coral_fan$/.test(key)) {
        return isWater(here) || isWater(below) ? ok() : fail('海草与珊瑚扇需要水');
      }
      if (key === 'lily_pad') {
        return isWater(below) || isWater(here) ? ok() : fail('睡莲只能放在水面');
      }
      if (key === 'cocoa') {
        const attached = DIRS4.some(function (d) {
          return keyOf(this.world.getBlock(x + d[0], y, z + d[1])) === 'jungle_log';
        }, this);
        return attached ? ok() : fail('可可豆需要附着在丛林原木侧面');
      }
      if (key === 'vine' || key === 'glow_lichen') {
        if (below === id || above === id) return ok();
        const attached = DIRS6.some(function (d) {
          return this.world.isSolidAt(x + d[0], y + d[1], z + d[2]);
        }, this);
        return attached ? ok() : fail('藤蔓与发光地衣需要附着面');
      }
      if (key === 'hanging_roots' || key === 'spore_blossom' || key === 'cave_vines') {
        return this.world.isSolidAt(x, y + 1, z) ? ok() : fail('这种植物需要悬挂在方块下方');
      }
      if (key === 'dead_bush') {
        return belowKey === 'sand' || belowKey === 'red_sand' || belowKey === 'terracotta' || isSoil(below)
          ? ok() : fail('枯灌木需要沙子、陶瓦或泥土');
      }
      if (/mushroom$/.test(key)) {
        return this.world.isOpaque(x, y - 1, z) || belowKey === 'mycelium' || belowKey === 'podzol'
          ? ok() : fail('蘑菇需要坚实的地面');
      }
      if (/fungus|roots|nether_sprouts/.test(key)) {
        return /nylium|netherrack|soul_soil/.test(belowKey) ? ok() : fail('下界植物需要菌岩、下界岩或灵魂土');
      }
      if (/chorus/.test(key)) {
        return belowKey === 'end_stone' || below === id ? ok() : fail('紫颂植物需要末地石');
      }
      return isSoil(below) ? ok() : fail('花草需要草方块或泥土等适宜支撑');
    }

    /**
     * 将仍会生长的植株加入活动集合
     * @param {number} x 坐标 x
     * @param {number} y 坐标 y
     * @param {number} z 坐标 z
     * @returns {object|null} 活动记录
     */
    track(x, y, z) {
      const id = this.world.getBlock(x, y, z);
      if (!this.ruleFor(id)) return null;
      const key = this.world.keyOf(x, y, z);
      const rec = { key: key, x: x, y: y, z: z, id: id };
      this.active.set(key, rec);
      return rec;
    }

    /**
     * 停止跟踪指定位置
     * @param {number} key 世界方块索引
     */
    untrack(key) {
      this.active.delete(key);
    }

    /**
     * 放置后初始化作物阶段并登记活动植株
     * @param {number} x 坐标 x
     * @param {number} y 坐标 y
     * @param {number} z 坐标 z
     * @param {number} id 方块 ID
     */
    onPlaced(x, y, z, id) {
      const def = Blocks.DEF[id];
      if (def && def.stageTiles) this.world.setPlantStage(x, y, z, 0);
      this.track(x, y, z);
      if (def && def.crop) this.world.setPlantDry(x, y, z, !this.hasWater(x, y, z));
    }

    /**
     * 计算破坏植物后的简化掉落物
     * @param {number} x 坐标 x
     * @param {number} y 坐标 y
     * @param {number} z 坐标 z
     * @param {number} id 方块 ID
     * @returns {Array<{name:string,count:number}>} 掉落列表
     */
    getDrops(x, y, z, id) {
      const def = Blocks.DEF[id];
      const key = keyOf(id);
      const stage = this.world.plantStages.get(this.world.keyOf(x, y, z)) || 0;
      if (def && def.crop) {
        if (stage < 7) return [{ name: def.name + '种子', count: 1 }];
        if (key === 'wheat') return [{ name: '小麦', count: 1 }, { name: '小麦种子', count: 1 }];
        if (key === 'carrots') return [{ name: '胡萝卜', count: 2 }];
        if (key === 'potatoes') return [{ name: '马铃薯', count: 2 }];
        return [{ name: '甜菜根', count: 1 }, { name: '甜菜种子', count: 1 }];
      }
      if (key === 'pumpkin_stem') return [{ name: '南瓜种子', count: 1 }];
      if (key === 'melon_stem') return [{ name: '西瓜种子', count: 1 }];
      return [{ name: def ? def.name : '植物', count: 1 }];
    }

    /**
     * 支撑消失时让植物自然破坏并掉落，避免留下悬空花草
     * @param {number} x 坐标 x
     * @param {number} y 坐标 y
     * @param {number} z 坐标 z
     */
    breakNaturally(x, y, z) {
      const id = this.world.getBlock(x, y, z);
      if (!this.isPlant(id)) return;
      const drops = this.getDrops(x, y, z, id);
      this.world.setBlock(x, y, z, Blocks.ID.AIR);
      this.untrack(this.world.keyOf(x, y, z));
      if (typeof this.onDrop === 'function') this.onDrop(drops, { x: x, y: y, z: z });
      this.onBlockBroken(x, y, z);
    }

    /**
     * 方块破坏后清除活动记录，并检查相邻附着植物与上方植物
     * @param {number} x 被破坏方块坐标 x
     * @param {number} y 被破坏方块坐标 y
     * @param {number} z 被破坏方块坐标 z
     */
    onBlockBroken(x, y, z) {
      this.untrack(this.world.keyOf(x, y, z));
      for (let i = 0; i < DIRS6.length; i++) {
        const d = DIRS6[i];
        const nx = x + d[0];
        const ny = y + d[1];
        const nz = z + d[2];
        const id = this.world.getBlock(nx, ny, nz);
        if (this.isPlant(id) && !this.canPlace(id, nx, ny, nz).ok) this.breakNaturally(nx, ny, nz);
      }
    }

    /**
     * 用动态树木替换树苗；所有修改通过 setBlock 写入增量并触发区块重建
     * @param {object} rec 树苗活动记录
     * @param {object} tree 原木、树叶与高度配置
     * @returns {boolean} 是否成功成树
     */
    growTree(rec, tree) {
      const logId = idOf(tree[0]) || Blocks.ID.WOOD;
      const leafId = idOf(tree[1]) || Blocks.ID.LEAVES;
      const height = tree[2] + Math.floor(Math.random() * (tree[3] - tree[2] + 1));
      if (rec.y + height + 2 >= this.world.H) return false;
      for (let y = rec.y + 1; y <= rec.y + height + 1; y++) {
        const id = this.world.getBlock(rec.x, y, rec.z);
        if (id !== Blocks.ID.AIR && !Blocks.DEF[id].cross) return false;
      }
      this.world.setBlock(rec.x, rec.y, rec.z, Blocks.ID.AIR);
      for (let i = 0; i < height; i++) this.world.setBlock(rec.x, rec.y + i, rec.z, logId);
      for (let layer = 0; layer < 3; layer++) {
        const radius = layer === 2 ? 1 : 2;
        const y = rec.y + height - 2 + layer;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && Math.random() < 0.45) continue;
            const x = rec.x + dx;
            const z = rec.z + dz;
            if (this.world.getBlock(x, y, z) === Blocks.ID.AIR) this.world.setBlock(x, y, z, leafId);
          }
        }
      }
      if (this.world.getBlock(rec.x, rec.y + height, rec.z) === Blocks.ID.AIR) {
        this.world.setBlock(rec.x, rec.y + height, rec.z, leafId);
      }
      this.untrack(rec.key);
      if (typeof this.onNotice === 'function') this.onNotice(Blocks.DEF[rec.id].name + ' 长成了树');
      return true;
    }

    /**
     * 推进一株活动植物；force 供自动化测试和调试直接触发一次随机刻
     * @param {object} rec 活动记录
     * @param {boolean} [force] 是否必定推进可生长阶段
     */
    tick(rec, force) {
      const id = this.world.getBlock(rec.x, rec.y, rec.z);
      if (id !== rec.id) {
        this.untrack(rec.key);
        return;
      }
      if (!this.canPlace(id, rec.x, rec.y, rec.z).ok) {
        this.breakNaturally(rec.x, rec.y, rec.z);
        return;
      }
      const rule = this.ruleFor(id);
      const key = keyOf(id);
      if (rule === 'sapling') {
        this.growTree(rec, SAPLING_TREES[key]);
        return;
      }
      if (rule === 'crop' || rule === 'stem' || rule === 'wart' || rule === 'cocoa') {
        const maxStage = Blocks.DEF[id].maxStage || (rule === 'crop' ? 7 : 3);
        const stage = this.world.plantStages.get(rec.key) || 0;
        if (rule === 'crop') {
          const dry = !this.hasWater(rec.x, rec.y, rec.z);
          this.world.setPlantDry(rec.x, rec.y, rec.z, dry);
          if (dry) return;
        }
        if (stage < maxStage) {
          this.world.setPlantStage(rec.x, rec.y, rec.z, stage + 1);
          return;
        }
        if (rule === 'crop' || rule === 'wart' || rule === 'cocoa') {
          this.untrack(rec.key);
          return;
        }
        const fruitId = idOf(key === 'pumpkin_stem' ? 'pumpkin' : 'melon');
        const dirs = DIRS4.slice().sort(function () { return Math.random() - 0.5; });
        for (let i = 0; i < dirs.length; i++) {
          const x = rec.x + dirs[i][0];
          const z = rec.z + dirs[i][1];
          const ground = this.world.getBlock(x, rec.y - 1, z);
          if (this.world.getBlock(x, rec.y, z) === Blocks.ID.AIR && (isSoil(ground) || keyOf(ground) === 'farmland')) {
            this.world.setBlock(x, rec.y, z, fruitId);
            break;
          }
        }
        return;
      }
      if (rule === 'column') {
        if (this.world.getBlock(rec.x, rec.y - 1, rec.z) === id) return;
        let height = 1;
        let topY = rec.y;
        while (height < COLUMN_LIMITS[key] && this.world.getBlock(rec.x, topY + 1, rec.z) === id) {
          topY++;
          height++;
        }
        if (height >= COLUMN_LIMITS[key]) return;
        const above = this.world.getBlock(rec.x, topY + 1, rec.z);
        if (above === Blocks.ID.AIR || (key === 'kelp' && isWater(above))) {
          this.world.setBlock(rec.x, topY + 1, rec.z, id);
        }
        return;
      }
      if (rule === 'vine') {
        if (this.world.getBlock(rec.x, rec.y + 1, rec.z) === id) return;
        let bottom = rec.y;
        let height = 1;
        while (height < 8 && this.world.getBlock(rec.x, bottom - 1, rec.z) === id) {
          bottom--;
          height++;
        }
        if (height < 8 && this.world.getBlock(rec.x, bottom - 1, rec.z) === Blocks.ID.AIR) {
          this.world.setBlock(rec.x, bottom - 1, rec.z, id);
        }
      }
    }

    /**
     * 分批执行随机刻，每批最多 32 株，并采用轮转游标保证所有植株都有机会
     * @param {number} dt 游戏时间增量（秒）
     */
    update(dt) {
      this.tickTimer += dt;
      if (this.tickTimer < 0.8 || this.active.size === 0) return;
      this.tickTimer = 0;
      const list = Array.from(this.active.values());
      this.cursor %= list.length;
      const count = Math.min(this.batchSize, list.length);
      for (let i = 0; i < count; i++) {
        const rec = list[(this.cursor + i) % list.length];
        if (Math.random() < 0.38) this.tick(rec, false);
      }
      this.cursor = (this.cursor + count) % Math.max(1, this.active.size);
    }

    /**
     * 自动化验证接口：立即推进指定坐标的一次生长
     * @param {number} x 坐标 x
     * @param {number} y 坐标 y
     * @param {number} z 坐标 z
     * @returns {boolean} 是否找到活动植株
     */
    growNow(x, y, z) {
      const key = this.world.keyOf(x, y, z);
      const rec = this.active.get(key) || this.track(x, y, z);
      if (!rec) return false;
      this.tick(rec, true);
      return true;
    }

    /**
     * 序列化活动植株、作物阶段与缺水状态，保持版本 2 存档向后兼容
     * @returns {{active:number[],stages:number[][]}} 植物快照
     */
    serialize() {
      const stages = [];
      this.world.plantStages.forEach(function (stage, key) {
        stages.push([key, stage, this.world.plantDry.has(key) ? 1 : 0]);
      }, this);
      return { active: Array.from(this.active.keys()), stages: stages };
    }

    /**
     * 恢复自然农田与存档植株；旧存档没有 plants 字段时只恢复自然农田
     * @param {object|null} snap 植物快照
     */
    restore(snap) {
      this.active.clear();
      this.world.plantStages.clear();
      this.world.plantDry.clear();
      const natural = this.info && this.info.plants ? this.info.plants : [];
      natural.forEach(function (p) {
        const id = this.world.getBlock(p.x, p.y, p.z);
        if (!this.ruleFor(id)) return;
        this.track(p.x, p.y, p.z);
        if (Blocks.DEF[id].stageTiles) this.world.setPlantStage(p.x, p.y, p.z, p.stage || 0);
      }, this);
      if (!snap) return;
      (snap.stages || []).forEach(function (row) {
        if (!Array.isArray(row) || row.length < 2) return;
        const p = this.world.decodeKey(row[0]);
        const id = this.world.getBlock(p.x, p.y, p.z);
        if (!Blocks.DEF[id] || !Blocks.DEF[id].stageTiles) return;
        this.world.setPlantStage(p.x, p.y, p.z, row[1]);
        this.world.setPlantDry(p.x, p.y, p.z, !!row[2]);
      }, this);
      (snap.active || []).forEach(function (key) {
        const p = this.world.decodeKey(key);
        this.track(p.x, p.y, p.z);
      }, this);
    }
  }

  Voxel.PlantManager = PlantManager;
  Voxel.PlantRules = { idOf: idOf, keyOf: keyOf, isSoil: isSoil, SAPLING_TREES: SAPLING_TREES };
})(window.Voxel = window.Voxel || {});
