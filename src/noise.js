/**
 * noise.js
 * 轻量 2D 值噪声（Value Noise）与分形叠加（fBm），用于程序化地形高度。
 * 不引入第三方噪声库，全部用整数哈希实现，结果可复现。
 */
(function (Voxel) {
  'use strict';

  /**
   * 二维整数哈希：把整数坐标映射到 [0,1) 的伪随机数
   * @param {number} ix 整数 x
   * @param {number} iy 整数 y
   * @param {number} seed 随机种子
   * @returns {number} [0,1)
   */
  function hash2i(ix, iy, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /**
   * 平滑插值曲线（smoothstep），消除网格状噪声痕迹
   * @param {number} t 0~1
   * @returns {number} 0~1
   */
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  /**
   * 二维值噪声：对整数格点哈希值做双线性平滑插值
   * @param {number} x 连续坐标 x
   * @param {number} y 连续坐标 y
   * @param {number} seed 随机种子
   * @returns {number} [0,1)
   */
  function value2(x, y, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const v00 = hash2i(x0, y0, seed);
    const v10 = hash2i(x0 + 1, y0, seed);
    const v01 = hash2i(x0, y0 + 1, seed);
    const v11 = hash2i(x0 + 1, y0 + 1, seed);
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
  }

  /**
   * 分形布朗运动：多层噪声叠加，产生自然的起伏
   * @param {number} x 坐标 x
   * @param {number} y 坐标 y
   * @param {number} seed 种子
   * @param {number} octaves 叠加层数
   * @param {number} lacunarity 每层频率倍率
   * @param {number} gain 每层振幅倍率
   * @returns {number} 归一化到 [0,1)
   */
  function fbm2(x, y, seed, octaves, lacunarity, gain) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += value2(x * freq, y * freq, seed + i * 101) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /**
   * 三维整数哈希：把整数坐标映射到 [0,1) 的伪随机数
   * @param {number} ix 整数 x
   * @param {number} iy 整数 y
   * @param {number} iz 整数 z
   * @param {number} seed 随机种子
   * @returns {number} [0,1)
   */
  function hash3i(ix, iy, iz, seed) {
    let h = Math.imul(ix | 0, 374761393) ^
      Math.imul(iy | 0, 668265263) ^
      Math.imul(iz | 0, 1440662683) ^
      Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /**
   * 三维值噪声：对 8 个格点哈希值做三线性平滑插值，用于矿脉团块
   * @param {number} x 连续坐标 x
   * @param {number} y 连续坐标 y
   * @param {number} z 连续坐标 z
   * @param {number} seed 随机种子
   * @returns {number} [0,1)
   */
  function value3(x, y, z, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const fz = smooth(z - z0);

    const v000 = hash3i(x0, y0, z0, seed);
    const v100 = hash3i(x0 + 1, y0, z0, seed);
    const v010 = hash3i(x0, y0 + 1, z0, seed);
    const v110 = hash3i(x0 + 1, y0 + 1, z0, seed);
    const v001 = hash3i(x0, y0, z0 + 1, seed);
    const v101 = hash3i(x0 + 1, y0, z0 + 1, seed);
    const v011 = hash3i(x0, y0 + 1, z0 + 1, seed);
    const v111 = hash3i(x0 + 1, y0 + 1, z0 + 1, seed);

    // 先沿 x 插值，再沿 y，最后沿 z
    const a00 = v000 + (v100 - v000) * fx;
    const a10 = v010 + (v110 - v010) * fx;
    const a01 = v001 + (v101 - v001) * fx;
    const a11 = v011 + (v111 - v011) * fx;
    const b0 = a00 + (a10 - a00) * fy;
    const b1 = a01 + (a11 - a01) * fy;
    return b0 + (b1 - b0) * fz;
  }

  /**
   * 三维分形布朗运动：多层三维值噪声叠加，用于球面上的无接缝起伏
   * @param {number} x 坐标 x
   * @param {number} y 坐标 y
   * @param {number} z 坐标 z
   * @param {number} seed 种子
   * @param {number} octaves 叠加层数
   * @param {number} lacunarity 每层频率倍率
   * @param {number} gain 每层振幅倍率
   * @returns {number} 归一化到 [0,1)
   */
  function fbm3(x, y, z, seed, octaves, lacunarity, gain) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += value3(x * freq, y * freq, z * freq, seed + i * 131) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  Voxel.Noise = {
    hash2i: hash2i,
    value2: value2,
    fbm2: fbm2,
    hash3i: hash3i,
    value3: value3,
    fbm3: fbm3
  };
})(window.Voxel = window.Voxel || {});
