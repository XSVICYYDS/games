/**
 * biomes.js
 * 生物群系采样：主世界、下界、末地三套群系，全部基于「球面方向」的三维噪声，
 * 因此球形世界背面不会出现接缝。只负责判断某个方向属于哪个群系，
 * 具体地表方块与植被由 terrain.js 决定。
 */
(function (Voxel) {
  'use strict';

  const Noise = Voxel.Noise;

  /** 主世界群系 */
  const OVERWORLD = {
    dimension: 'overworld',
    name: '主世界',
    CODES: { PLAINS: 0, FOREST: 1, DESERT: 2, SNOWY: 3, MOUNTAIN: 4 },
    NAMES: ['平原', '森林', '沙漠', '雪原', '山地'],
    KEYS: ['plains', 'forest', 'desert', 'snowy', 'mountain']
  };

  /** 下界群系 */
  const NETHER = {
    dimension: 'nether',
    name: '下界',
    CODES: { WASTES: 0, SOUL_VALLEY: 1, CRIMSON: 2, WARPED: 3, BASALT: 4 },
    NAMES: ['下界荒地', '灵魂沙峡谷', '绯红森林', '诡异森林', '玄武岩三角洲'],
    KEYS: ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas']
  };

  /** 末地群系 */
  const END = {
    dimension: 'end',
    name: '末地',
    CODES: { HIGHLANDS: 0, BARRENS: 1, PURPUR: 2, WASTES: 3 },
    NAMES: ['末地高地', '末地荒原', '紫珀森林', '末地荒地'],
    KEYS: ['end_highlands', 'end_barrens', 'purpur_forest', 'end_wastes']
  };

  const TABLES = { overworld: OVERWORLD, nether: NETHER, end: END };

  /**
   * 采样某一列的生物群系（保留旧的平面接口，供兼容代码使用）
   * @param {number} x 世界坐标 x（整数）
   * @param {number} z 世界坐标 z（整数）
   * @param {number} h 该列地表高度
   * @param {object} cfg 世界配置（至少包含 seed）
   * @returns {number} 群系编码
   */
  function sample(x, z, h, cfg) {
    if (h >= 32) return OVERWORLD.CODES.MOUNTAIN;

    const temperature = Noise.fbm2(x * 0.016, z * 0.016, cfg.seed + 6101, 3, 2, 0.5);
    const humidity = Noise.fbm2(x * 0.021, z * 0.021, cfg.seed + 6203, 3, 2, 0.5);

    if (temperature < 0.4) return OVERWORLD.CODES.SNOWY;
    if (temperature > 0.57 && humidity < 0.48) return OVERWORLD.CODES.DESERT;
    if (humidity > 0.55) return OVERWORLD.CODES.FOREST;
    return OVERWORLD.CODES.PLAINS;
  }

  /**
   * 按球面方向采样群系
   * @param {string} dimension 维度键：overworld / nether / end
   * @param {number} nx 方向 x（单位向量）
   * @param {number} ny 方向 y（单位向量）
   * @param {number} nz 方向 z（单位向量）
   * @param {number} elevation 相对基准半径的起伏，约 -1~1
   * @param {object} cfg 世界配置（含 seed）
   * @returns {number} 群系编码
   */
  function sampleSphere(dimension, nx, ny, nz, elevation, cfg) {
    const seed = cfg.seed;
    const px = nx * 1.9;
    const py = ny * 1.9;
    const pz = nz * 1.9;

    if (dimension === 'nether') {
      const t = Noise.fbm3(px, py, pz, seed + 7101, 3, 2, 0.5);
      const h = Noise.fbm3(nx * 2.7, ny * 2.7, nz * 2.7, seed + 7203, 3, 2, 0.5);
      if (t < 0.41) return NETHER.CODES.SOUL_VALLEY;
      if (t > 0.6 && h < 0.47) return NETHER.CODES.BASALT;
      if (h > 0.57) return NETHER.CODES.CRIMSON;
      if (h < 0.43) return NETHER.CODES.WARPED;
      return NETHER.CODES.WASTES;
    }

    if (dimension === 'end') {
      if (elevation > 0.3) return END.CODES.HIGHLANDS;
      const h = Noise.fbm3(px * 1.15, py * 1.15, pz * 1.15, seed + 8101, 3, 2, 0.5);
      if (h > 0.57) return END.CODES.PURPUR;
      if (h < 0.43) return END.CODES.WASTES;
      return END.CODES.BARRENS;
    }

    // 主世界：高处优先判为山地，保证球面雪峰不会被森林覆盖
    if (elevation > 0.62) return OVERWORLD.CODES.MOUNTAIN;

    const temperature = Noise.fbm3(px * 0.9, py * 0.9, pz * 0.9, seed + 6101, 3, 2, 0.5);
    const humidity = Noise.fbm3(nx * 1.25, ny * 1.25, nz * 1.25, seed + 6203, 3, 2, 0.5);

    if (temperature < 0.4) return OVERWORLD.CODES.SNOWY;
    if (temperature > 0.57 && humidity < 0.48) return OVERWORLD.CODES.DESERT;
    if (humidity > 0.55) return OVERWORLD.CODES.FOREST;
    return OVERWORLD.CODES.PLAINS;
  }

  /**
   * 取得群系的展示信息
   * @param {string} dimension 维度键
   * @param {number} code 群系编码
   * @returns {{code:number,name:string,key:string}} 展示信息
   */
  function info(dimension, code) {
    const table = TABLES[dimension] || OVERWORLD;
    return {
      code: code,
      name: table.NAMES[code] || table.NAMES[0],
      key: table.KEYS[code] || table.KEYS[0]
    };
  }

  Voxel.Biomes = {
    OVERWORLD: OVERWORLD,
    NETHER: NETHER,
    END: END,
    TABLES: TABLES,
    CODES: OVERWORLD.CODES,
    NAMES: OVERWORLD.NAMES,
    KEYS: OVERWORLD.KEYS,
    sample: sample,
    sampleSphere: sampleSphere,
    info: info
  };
})(window.Voxel = window.Voxel || {});
