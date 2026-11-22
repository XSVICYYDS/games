/**
 * blocks.js
 * 360 种方块注册表 + Canvas 2D 程序化像素纹理图集。
 * 方块 ID 固定为 1~360，原有 1~17 保持不变；0 始终表示空气。
 * 图集使用 32×16 个 32px 瓦片（1024×512），无外部图片依赖。
 */
(function (Voxel) {
  'use strict';

  const TILE_SIZE = 32;
  const ATLAS_COLS = 32;
  const ATLAS_ROWS = 40;
  const LEGACY_BLOCK_COUNT = 360;
  const Catalog = Voxel.BlockCatalog || { rows: [], stats: { new: 0 } };
  const BLOCK_COUNT = LEGACY_BLOCK_COUNT + (Catalog.stats.new || 0);
  const PAGE_SIZE = 9;

  /** 原有方块 ID：地形、物理和特殊交互继续引用这些固定值 */
  const ID = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5,
    SAND: 6, SNOW: 7, PLANK: 8, BRICK: 9, COAL_ORE: 10,
    IRON_ORE: 11, GOLD_ORE: 12, WATER: 13, GLASS: 14,
    BEDROCK: 15, TNT: 16, REDSTONE: 17
  };

  const DEF = {};
  const HOTBAR = [];
  const CATEGORIES = ['自然', '木材', '石材', '矿物', '建筑', '功能', '红石', '染色'];
  const tileKinds = {};
  let nextTile = BLOCK_COUNT;

  /**
   * 生成确定性的伪随机函数，让同一种方块每次刷新都有一致的纹理
   * @param {number} seed 随机种子
   * @returns {() => number} [0,1) 随机函数
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 调整十六进制颜色明度
   * @param {string} hex #rrggbb 颜色
   * @param {number} delta 明度增量
   * @returns {string} CSS rgb 颜色
   */
  function shadeColor(hex, delta) {
    const n = parseInt(hex.slice(1), 16);
    const clamp = function (v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; };
    return 'rgb(' + clamp((n >> 16 & 255) + delta) + ',' +
      clamp((n >> 8 & 255) + delta) + ',' + clamp((n & 255) + delta) + ')';
  }

  /**
   * 注册一个方块并分配连续 ID；默认均为可放置、可挖掘的固体完整方块
   * @param {string} name 中文名称
   * @param {string} category 背包分类
   * @param {string} base 主色
   * @param {string} accent 细节色
   * @param {string} pattern 纹理样式
   * @param {object} extra 物理、渲染与交互属性覆盖
   * @returns {object} 方块定义
   */
  function register(name, category, base, accent, pattern, extra) {
    const id = HOTBAR.length + 1;
    if (id > BLOCK_COUNT) throw new Error('方块目录超过 ' + BLOCK_COUNT + ' 种');
    const def = Object.assign({
      id: id,
      name: name,
      category: category,
      base: base,
      accent: accent,
      pattern: pattern,
      tiles: { top: id - 1, bottom: id - 1, side: id - 1 },
      solid: true,
      opaque: true,
      liquid: false,
      breakable: true,
      layer: 'opaque',
      drops: null,
      toggleable: false,
      litTile: -1,
      hardness: 1,
      tool: '徒手',
      light: 0,
      transparentInfo: false
    }, extra || {});
    DEF[id] = def;
    HOTBAR.push(id);
    return def;
  }

  /**
   * 批量注册目录行，每行格式为“名称|主色|细节色”或“名称|主色|细节色|纹理样式”
   * @param {string} category 分类
   * @param {string} pattern 默认纹理样式
   * @param {string[]} rows 目录行
   */
  function addRows(category, pattern, rows) {
    rows.forEach(function (row) {
      const p = row.split('|');
      register(p[0], category, p[1], p[2], p[3] || pattern);
    });
  }

  /**
   * 计算稳定字符串散列，供目录方块生成有细微差别的程序化颜色
   * @param {string} text 方块注册名
   * @returns {number} 非负散列值
   */
  function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * 将 HSL 颜色转换为纹理函数可继续调暗的十六进制颜色
   * @param {number} h 色相角度
   * @param {number} s 饱和度 0~1
   * @param {number} l 明度 0~1
   * @returns {string} #rrggbb 颜色
   */
  function hslHex(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = function (n) {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  /**
   * 对十六进制颜色做明度偏移并仍返回十六进制，避免嵌套调色时格式不一致
   * @param {string} hex #rrggbb 颜色
   * @param {number} delta 明度增量
   * @returns {string} #rrggbb 颜色
   */
  function offsetHex(hex, delta) {
    const n = parseInt(hex.slice(1), 16);
    const clamp = function (v) { return Math.max(0, Math.min(255, v | 0)); };
    return '#' + [clamp((n >> 16 & 255) + delta), clamp((n >> 8 & 255) + delta), clamp((n & 255) + delta)]
      .map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  /** 官方大类到现有背包分类的映射 */
  const CATEGORY_MAP = {
    '建筑与装饰方块': '建筑', '植物与作物': '植物', '功能与存储': '功能',
    '红石元件': '红石', '照明': '照明', '生活与装饰': '生活',
    '矿物与矿石': '矿物', '特殊/创造工具': '特殊', '交通轨道': '轨道'
  };

  /** 清单中需要使用双面交叉面片的植物与附着物 */
  const CROSS_KEYS = /(?:sapling|propagule|dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|wither_rose|torchflower|pitcher_plant|(?:^|_)grass|fern|dead_bush|wheat|carrots|potatoes|beetroots|pumpkin_stem|melon_stem|nether_wart|sugar_cane|bamboo$|kelp|seagrass|coral(?:_fan)?$|coral_fan|mushroom$|fungus|roots$|nether_sprouts|vine|lichen|lily_pad|cocoa|sweet_berry_bush|cave_vines|dripleaf|hanging_roots|spore_blossom|chorus_plant|chorus_flower)/;

  /**
   * 根据官方注册名推导材质族、颜色与纹样；重点名称有固定配色，其余使用稳定色相偏移
   * @param {Array} row 目录行
   * @returns {{base:string,accent:string,pattern:string,cross:boolean}} 外观规则
   */
  function catalogStyle(row) {
    const key = row[1].replace(/^minecraft:/, '');
    const hash = hashString(key);
    const cross = CROSS_KEYS.test(key) && !/(?:_block|_leaves)$/.test(key);
    const dyes = [
      ['white', '#e7ecec'], ['light_gray', '#929a9e'], ['gray', '#46515a'], ['black', '#1b2029'],
      ['brown', '#79503a'], ['red', '#b83a3d'], ['orange', '#df7925'], ['yellow', '#e8bd36'],
      ['lime', '#70aa3c'], ['green', '#39743f'], ['cyan', '#27858e'], ['light_blue', '#5d9fd2'],
      ['blue', '#3857a6'], ['purple', '#75469a'], ['magenta', '#aa469c'], ['pink', '#df8ca5']
    ];
    let base = hslHex(hash % 360, 0.28 + (hash % 17) / 100, 0.37 + (hash % 13) / 100);
    for (let i = 0; i < dyes.length; i++) {
      if (key.indexOf(dyes[i][0] + '_') === 0) { base = dyes[i][1]; break; }
    }
    const materials = [
      ['dark_oak', '#4b3323'], ['oak', '#9b7748'], ['spruce', '#675037'], ['birch', '#d2c28d'],
      ['jungle', '#9a7048'], ['acacia', '#a65e3c'], ['mangrove', '#875049'], ['cherry', '#d6a0ac'],
      ['bamboo', '#b7ae50'], ['crimson', '#85465d'], ['warped', '#337c76'],
      ['deepslate', '#4b4e53'], ['blackstone', '#37333c'], ['nether_brick', '#40262d'],
      ['netherrack', '#783a3d'], ['soul_sand', '#665044'], ['soul_soil', '#51433d'],
      ['sandstone', '#d5c18b'], ['red_sand', '#b86632'], ['sand', '#ddcc96'],
      ['stone', '#888b8c'], ['cobblestone', '#7e8281'], ['andesite', '#8f9290'],
      ['diorite', '#b8b8b3'], ['granite', '#9b6554'], ['tuff', '#6f766d'],
      ['calcite', '#d9d8ce'], ['dripstone', '#8e6b50'], ['obsidian', '#211b32'],
      ['end_stone', '#d0d197'], ['purpur', '#98699c'], ['prismarine', '#609a8e'],
      ['iron', '#c5cecd'], ['gold', '#e6ba32'], ['copper', '#b66b4c'],
      ['diamond', '#55c9c3'], ['emerald', '#36aa62'], ['lapis', '#315fa8'],
      ['redstone', '#b72c32'], ['coal', '#282a2e'], ['quartz', '#e3ddd1'],
      ['amethyst', '#8b66b3'], ['sculk', '#12343b'], ['slime', '#78a957'],
      ['honey', '#d88a22'], ['mud', '#51474a'], ['clay', '#9ca6b2'],
      ['ice', '#8bbbe4'], ['snow', '#edf5fa'], ['moss', '#587b35']
    ];
    for (let i = 0; i < materials.length; i++) {
      if (key.indexOf(materials[i][0]) !== -1) { base = materials[i][1]; break; }
    }
    let accent = offsetHex(base, (hash % 41) - 12);
    let pattern = 'stone';
    if (cross) {
      base = '#39733a';
      accent = hslHex((hash * 7) % 360, 0.58, 0.58);
      pattern = /tulip|dandelion|poppy|orchid|allium|bluet|daisy|cornflower|lily|sunflower|lilac|rose|peony|torchflower|pitcher/.test(key) ? 'flower' :
        /wheat|carrots|potatoes|beetroots|pumpkin_stem|melon_stem|nether_wart|cocoa/.test(key) ? 'crop' :
        /sapling|propagule/.test(key) ? 'sapling' :
        /kelp|seagrass/.test(key) ? 'seagrass' :
        /mushroom|fungus/.test(key) ? 'mushroom' :
        /bamboo/.test(key) ? 'bamboo' : /vine|lichen/.test(key) ? 'vine' : 'plant';
      const flowers = {
        dandelion: '#f1d449', poppy: '#c93d3d', blue_orchid: '#63a9d5', allium: '#b177c1',
        azure_bluet: '#e8eee5', cornflower: '#5579c6', lily_of_the_valley: '#f0f1e7',
        sunflower: '#f0c63d', lilac: '#b78bc4', rose_bush: '#c94048', peony: '#e794b5',
        wither_rose: '#302b35', red_tulip: '#c83e38', orange_tulip: '#e77c32',
        white_tulip: '#ecebdc', pink_tulip: '#e695b4', oxeye_daisy: '#eee9d6'
      };
      if (flowers[key]) accent = flowers[key];
      if (/wheat/.test(key)) accent = '#d8b74e';
      if (/carrots/.test(key)) accent = '#e7812f';
      if (/potatoes/.test(key)) accent = '#d8c67a';
      if (/beetroots/.test(key)) accent = '#a93443';
    } else if (/glass/.test(key)) pattern = 'glass';
    else if (/leaves/.test(key)) pattern = 'leaves';
    else if (/log$|_wood$|_stem$|_hyphae$/.test(key)) pattern = 'log';
    else if (/planks|mosaic/.test(key)) pattern = 'plank';
    else if (/brick/.test(key)) pattern = 'brick';
    else if (/tile/.test(key)) pattern = 'tile';
    else if (/ore|raw_/.test(key)) pattern = 'ore';
    else if (/wool|carpet/.test(key)) pattern = 'wool';
    else if (/concrete_powder/.test(key)) pattern = 'powder';
    else if (/concrete/.test(key)) pattern = 'concrete';
    else if (/terracotta/.test(key)) pattern = /glazed/.test(key) ? 'glazed' : 'terracotta';
    else if (/bed$/.test(key)) pattern = 'bed';
    else if (/door$/.test(key)) pattern = 'door';
    else if (/fence|wall|bars/.test(key)) pattern = 'fence';
    else if (/stairs/.test(key)) pattern = 'stairs';
    else if (/slab/.test(key)) pattern = 'slab';
    else if (/rail/.test(key)) pattern = 'rail';
    else if (/candle/.test(key)) pattern = 'candle';
    else if (/ladder|chain/.test(key)) pattern = 'ladder';
    else if (/coral/.test(key)) pattern = 'coral';
    else if (/redstone|lever|button|pressure_plate|repeater|comparator|observer|piston|tripwire/.test(key)) pattern = 'circuit';
    else if (/chest|barrel|shulker|furnace|dispenser|dropper/.test(key)) pattern = 'chest';
    else if (/pumpkin/.test(key)) pattern = 'pumpkin';
    else if (/melon/.test(key)) pattern = 'melon';
    else if (/mushroom_block|mushroom_stem/.test(key)) pattern = 'moss';
    else if (/lava/.test(key)) { base = '#d95318'; accent = '#ffd35a'; pattern = 'water'; }
    else if (row[9] > 0) pattern = 'glow';
    else if (/metal|block_of|_block$/.test(key) && /iron|gold|copper|netherite/.test(key)) pattern = 'metal';
    return { base: base, accent: accent, pattern: pattern, cross: cross };
  }

  /**
   * 将一条官方目录合并到旧方块或追加为新方块，旧硬度、工具和既有外观不被覆盖
   * @param {Array} row 官方目录行
   */
  function applyCatalogRow(row) {
    if (row[13]) return;
    const existingId = row[12];
    const category = CATEGORY_MAP[row[3]] || row[3] || '建筑';
    if (existingId) {
      const old = DEF[existingId];
      old.key = row[1]; old.officialId = row[0]; old.zh = row[2];
      old.catalogCategory = row[3]; old.category = category;
      old.resistance = row[5]; old.stackSize = row[6]; old.catalogTool = row[7];
      old.transparentInfo = !!row[8]; old.function = row[10]; old.usage = row[11];
      if (row[4] < 0 || row[5] >= 3600000) old.breakable = false;
      return;
    }
    const style = catalogStyle(row);
    const liquid = row[1] === 'minecraft:lava';
    const transparent = !!row[8] || style.cross || liquid;
    const def = register(row[2], category, style.base, style.accent, style.pattern, {
      key: row[1], officialId: row[0], zh: row[2], catalogCategory: row[3],
      hardness: row[4] < 0 ? 0 : row[4], resistance: row[5], stackSize: row[6],
      tool: row[7] && row[7] !== '无' ? row[7] : '徒手',
      transparentInfo: transparent, light: row[9] || 0,
      function: row[10], usage: row[11],
      solid: !style.cross && !liquid, opaque: !transparent,
      liquid: liquid, breakable: !liquid && row[4] >= 0 && row[5] < 3600000,
      cross: style.cross, shape: row[1] === 'minecraft:lily_pad' ? 'lily' : (style.cross ? 'cross' : 'cube'),
      layer: liquid ? 'water' : (style.cross || (transparent && !/glass/.test(row[1])) ? 'plant' : (transparent ? 'glass' : 'opaque'))
    });
    def.official = row[2];
  }

  // ---- 1~17：保留上一版的方块与行为 ----
  register('草方块', '自然', '#57943a', '#8a6a45', 'grass');
  register('泥土', '自然', '#8a6a45', '#60472f', 'dirt');
  register('石头', '石材', '#909090', '#606066', 'stone');
  register('橡木原木', '木材', '#6f5638', '#b59263', 'log');
  register('橡树树叶', '自然', '#3f7f30', '#79a64b', 'leaves');
  register('沙子', '自然', '#e3d29b', '#bca76f', 'sand');
  register('雪块', '自然', '#f3f8ff', '#c4dbef', 'snow');
  register('橡木木板', '木材', '#b98b57', '#7d5a34', 'plank');
  register('砖块', '建筑', '#a8503f', '#c3b6a5', 'brick');
  register('煤矿石', '矿物', '#909090', '#29292e', 'ore', { drops: [{ name: '煤炭', count: 1 }] });
  register('铁矿石', '矿物', '#909090', '#c98d5d', 'ore', { drops: [{ name: '铁矿石', count: 1 }] });
  register('金矿石', '矿物', '#909090', '#f2c433', 'ore', { drops: [{ name: '金矿石', count: 1 }] });
  register('水', '自然', '#3f74c4', '#8bc4ef', 'water', {
    solid: false, opaque: false, liquid: true, breakable: false, layer: 'water'
  });
  register('玻璃', '建筑', '#cfe9f4', '#f4fdff', 'glass', { opaque: false, layer: 'glass' });
  register('基岩', '自然', '#4a4a4e', '#202024', 'bedrock', { breakable: false });
  register('TNT', '红石', '#c4372c', '#f3ece1', 'tnt');
  register('红石', '红石', '#7d1b1b', '#d74432', 'circuit');

  // ---- 18~60：地表、植物与自然装饰 ----
  addRows('自然', 'dirt', [
    '砂土|#806044|#a27c56', '缠根泥土|#795a3e|#b08a5b',
    '灰化土|#5e4632|#744f2d|grass', '菌丝体|#70636f|#a797ad|grass',
    '草径|#9b794a|#c09b63|path', '泥巴|#4e4648|#71636a|mud',
    '压实泥巴|#76544b|#a77a68|packed', '黏土块|#9ca6b2|#c2ccd5|clay',
    '沙砾|#89847f|#b6aea4|gravel', '红沙|#b86632|#df9651|sand',
    '砂岩|#d8c48c|#aa9463|sandstone', '红砂岩|#a9512c|#d57c43|sandstone',
    '平滑砂岩|#dfd09f|#c0ab7a|polished', '平滑红砂岩|#b65f34|#d8874d|polished',
    '冰|#91bfe8|#d9f4ff|ice', '浮冰|#75a9d7|#b7e1f5|ice',
    '蓝冰|#579bd3|#a3dcff|ice', '细雪块|#e7f1f7|#ffffff|snow',
    '苔藓块|#587b35|#86a94a|moss', '杜鹃树叶|#4c7638|#7d9b4b|leaves',
    '盛开的杜鹃树叶|#55773c|#d889b1|leaves', '云杉树叶|#315f43|#587c4f|leaves',
    '白桦树叶|#6b8d3d|#a0b654|leaves', '丛林树叶|#39773a|#72a447|leaves',
    '金合欢树叶|#64833c|#9ba94b|leaves', '深色橡树树叶|#294f31|#527542|leaves',
    '红树树叶|#356b45|#7b9c51|leaves', '樱花树叶|#e5a8bd|#ffd3df|leaves',
    '仙人掌|#487c43|#87a957|plant', '甘蔗块|#8fb85c|#c8dc89|plant',
    '南瓜|#c87920|#eda63d|pumpkin', '雕刻南瓜|#bd6e1d|#633718|pumpkin',
    '南瓜灯|#d27c20|#ffd05a|pumpkin', '西瓜|#56863b|#a2bd4c|melon',
    '干草捆|#c7a73b|#ecd362|hay', '干海带块|#354e3d|#647355|packed',
    '海绵|#b9b94a|#e0dc68|sponge', '湿海绵|#7d9448|#b4ba63|sponge',
    '蜂蜜块|#d88a22|#ffc34e|honey', '蜜脾块|#c47727|#edae4c|honeycomb',
    '黏液块|#79a957|#b3d77b|slime', '苔石|#717b66|#91a16e|cobble',
    '圆石|#858585|#a9a9a9|cobble'
  ]);

  // ---- 61~120：石料、下界与末地材料 ----
  addRows('石材', 'stone', [
    '石砖|#858585|#b0b0b0|brick', '苔石砖|#78806e|#9ca88a|brick',
    '裂纹石砖|#7d7d7d|#4d4d50|brick', '錾制石砖|#858585|#c0c0c0|chiseled',
    '花岗岩|#9b6554|#c58a70|cobble', '磨制花岗岩|#a87662|#d19a7f|polished',
    '闪长岩|#b8b8b3|#e0dfd8|cobble', '磨制闪长岩|#c6c6c1|#eeeeea|polished',
    '安山岩|#888b89|#b5b8b5|cobble', '磨制安山岩|#999d9a|#c7cbc8|polished',
    '深板岩|#45484c|#666a70|deepslate', '深板岩圆石|#505256|#797b80|cobble',
    '磨制深板岩|#54575b|#7c8085|polished', '深板岩砖|#4d5054|#73777c|brick',
    '裂纹深板岩砖|#484a4e|#282b30|brick', '深板岩瓦|#42464b|#6b7178|tile',
    '裂纹深板岩瓦|#3e4146|#25282d|tile', '凝灰岩|#6f766d|#93998e|cobble',
    '方解石|#d9d8ce|#f5f3e9|polished', '滴水石块|#8e6b50|#bb9470|dripstone',
    '玄武岩|#49494f|#6d6d75|log', '磨制玄武岩|#55555d|#7b7b85|polished',
    '平滑玄武岩|#606068|#85858f|polished', '黑石|#353239|#5a525f|cobble',
    '磨制黑石|#403b44|#6b606e|polished', '磨制黑石砖|#3d3841|#665d69|brick',
    '裂纹磨制黑石砖|#373238|#201d23|brick', '镶金黑石|#3d3740|#d3a635|ore',
    '下界岩|#783a3d|#a95b58|netherrack', '绯红菌岩|#683344|#a74761|nylium',
    '诡异菌岩|#275f5c|#3e9385|nylium', '灵魂沙|#665044|#927664|sand',
    '灵魂土|#51433d|#796357|dirt', '岩浆块|#7d3526|#ef9b35|magma',
    '荧石|#a98144|#f4d985|glow', '下界疣块|#732f3a|#a74650|moss',
    '诡异疣块|#27675c|#3f9982|moss', '菌光体|#c65f37|#ffae62|glow',
    '末地石|#d5d69b|#aeb175|cobble', '末地石砖|#cfd096|#e7e8b4|brick',
    '紫珀块|#9b6a9c|#c695c5|brick', '紫珀柱|#9a6b9e|#d0a4d0|pillar',
    '黑曜石|#201b31|#483b66|obsidian', '哭泣的黑曜石|#251c38|#8a51b5|obsidian',
    '强化深板岩|#4d5555|#82918c|deepslate', '紫水晶块|#8b66b3|#d1a9ef|crystal',
    '紫水晶母岩|#765893|#c395e1|crystal', '石英块|#e5dfd3|#fffdf4|polished',
    '平滑石英块|#eae4d8|#ffffff|polished', '石英砖|#ddd7cb|#f8f4e9|brick',
    '石英柱|#dfd9cd|#fffaf0|pillar', '錾制石英块|#dcd6ca|#fff9ec|chiseled',
    '下界砖块|#40262d|#6c3a43|brick', '裂纹下界砖块|#392229|#21151a|brick',
    '錾制下界砖块|#40262d|#7a4650|chiseled', '红色下界砖块|#682b35|#9b4450|brick',
    '骨块|#d5d0b6|#f2eed8|pillar', '幽匿块|#102f36|#1e5960|sculk',
    '幽匿催发体|#15373a|#4a8b82|sculk', '幽匿尖啸体|#17373b|#b8d6bd|sculk'
  ]);

  // ---- 121~140：十种木质的原木与木板 ----
  addRows('木材', 'log', [
    '云杉原木|#54432d|#927147', '云杉木板|#755535|#a57b4d|plank',
    '白桦原木|#d5cfb0|#686453', '白桦木板|#d6bd82|#aa915e|plank',
    '丛林原木|#65503a|#9c784d', '丛林木板|#a4774e|#d09a62|plank',
    '金合欢原木|#67645d|#a55f38', '金合欢木板|#ad633e|#dc8b59|plank',
    '深色橡木原木|#3b2c22|#654932', '深色橡木木板|#513824|#7f5935|plank',
    '红树原木|#673d39|#a06856', '红树木板|#95544b|#c47b68|plank',
    '樱花原木|#6e4b52|#d29bab', '樱花木板|#d9a5ae|#f4c6cb|plank',
    '竹块|#9c9b45|#d2c85e', '竹板|#c6b95c|#e5d67b|plank',
    '绯红菌柄|#663343|#a45168', '绯红木板|#8d4960|#bb6b80|plank',
    '诡异菌柄|#285e60|#468c85', '诡异木板|#367c79|#5ba69b|plank'
  ]);

  // ---- 141~151：去皮原木 ----
  addRows('木材', 'log', [
    '去皮橡木原木|#a38250|#d0ad70', '去皮云杉原木|#80613e|#b18a55',
    '去皮白桦原木|#d5c797|#f0e3b6', '去皮丛林原木|#a87c4d|#d0a064',
    '去皮金合欢原木|#a76544|#d58b62', '去皮深色橡木原木|#59402d|#806044',
    '去皮红树原木|#8d5b50|#ba7c68', '去皮樱花原木|#c78f9a|#edb9c0',
    '去皮竹块|#c1b85c|#e0d479', '去皮绯红菌柄|#8c4a61|#bb6a82',
    '去皮诡异菌柄|#3d817c|#68aba0'
  ]);

  // ---- 152~166：树皮块、树根与书架 ----
  addRows('木材', 'log', [
    '橡木|#695137|#97744c', '云杉木|#4c3b29|#785b39',
    '白桦木|#c9c3a6|#eee8cb', '丛林木|#5f4935|#8e6c45',
    '金合欢木|#625e55|#928475', '深色橡木|#35281f|#58402c',
    '红树木|#5d3734|#8e5549', '樱花木|#66454c|#9e6b76',
    '竹块侧枝|#8b8a3f|#bdb654', '绯红菌核|#582c3b|#8d4257',
    '诡异菌核|#245355|#3b7773', '红树根|#795448|#a77863|roots',
    '沾泥的红树根|#62514a|#8b7465|roots', '书架|#8b623b|#d0a354|books',
    '錾制书架|#9a7043|#d6b477|books'
  ]);

  // ---- 167~201：矿石、粗矿与矿物块 ----
  addRows('矿物', 'ore', [
    '铜矿石|#909090|#c47b55', '青金石矿石|#909090|#315fa8',
    '红石矿石|#909090|#c92f36', '钻石矿石|#909090|#54d8d0',
    '绿宝石矿石|#909090|#35b96a', '下界石英矿石|#783a3d|#eee6d7',
    '下界金矿石|#783a3d|#f2c433', '远古残骸|#5b4036|#a2785c|deepslate',
    '深层煤矿石|#45484c|#202025', '深层铁矿石|#45484c|#c98d5d',
    '深层金矿石|#45484c|#f2c433', '深层铜矿石|#45484c|#c47b55',
    '深层青金石矿石|#45484c|#315fa8', '深层红石矿石|#45484c|#d9363d',
    '深层钻石矿石|#45484c|#54d8d0', '深层绿宝石矿石|#45484c|#35b96a',
    '粗铁块|#a87c5c|#dfb28b|raw', '粗铜块|#aa684c|#69a58c|raw',
    '粗金块|#c89b32|#f6d466|raw', '煤炭块|#25262b|#484a52|metal',
    '铁块|#d1d5d4|#ffffff|metal', '金块|#e8bf35|#fff083|metal',
    '铜块|#b96d4e|#e49a73|metal', '斑驳的铜块|#a66c52|#76a58b|metal',
    '锈蚀的铜块|#738d72|#5ca691|metal', '氧化的铜块|#4b9484|#79b9a2|metal',
    '切制铜块|#b96d4e|#e49a73|tile', '斑驳的切制铜块|#a66c52|#76a58b|tile',
    '锈蚀的切制铜块|#738d72|#5ca691|tile', '氧化的切制铜块|#4b9484|#79b9a2|tile',
    '青金石块|#28549a|#4c7ac4|metal', '红石块|#a5232d|#ed4b4a|metal',
    '钻石块|#55c9c2|#a5f2e9|metal', '绿宝石块|#35a95e|#78db8d|metal',
    '下界合金块|#494248|#766a70|metal'
  ]);

  // ---- 202~237：工作站、容器与光源 ----
  addRows('功能', 'functional', [
    '工作台|#9a693b|#d6a25e', '熔炉|#777a79|#343837',
    '烟熏炉|#6c6256|#302e2b', '高炉|#676d70|#272d31',
    '切石机|#858583|#c3c5c1', '砂轮|#696d70|#b4b9bc',
    '锻造台|#61564c|#a29685', '制图台|#8a6540|#d1b47c',
    '制箭台|#9c7749|#d3b16f', '织布机|#8b6545|#d4a66f',
    '铁砧|#484c51|#8d949a|metal', '开裂的铁砧|#484c51|#787f85|metal',
    '损坏的铁砧|#41454a|#686e74|metal', '附魔台|#543849|#b45c79|obsidian',
    '酿造台|#66615c|#c3a76f|functional', '炼药锅|#4a5157|#78858e|metal',
    '堆肥桶|#795738|#a9a052|plank', '木桶|#8c633a|#c29657|barrel',
    '箱子|#a66e2d|#d6a34c|chest', '陷阱箱|#a66e2d|#b84436|chest',
    '末影箱|#26393b|#59a392|chest', '唱片机|#7a4e37|#c08b5b|jukebox',
    '音符盒|#8a5a3b|#d39a64|jukebox', '讲台|#926840|#d0a265|books',
    '信标|#739a9e|#b9fff1|beacon', '潮涌核心|#376c74|#7ed4c8|beacon',
    '磁石|#3e4148|#8a6f9c|metal', '重生锚|#392d48|#9a5fc5|obsidian',
    '钟|#b58b32|#f3ce61|metal', '灯笼|#625038|#ffd76a|glow',
    '灵魂灯笼|#3e5557|#8ee8df|glow', '赭黄蛙明灯|#d2b45c|#fff0a1|glow',
    '青翠蛙明灯|#75a983|#c5f0b8|glow', '珠光蛙明灯|#b68da8|#f2d5e9|glow',
    '海晶灯|#9ac9c1|#e2fff5|glow', '潜影盒|#8b5e91|#c793ca|chest'
  ]);

  // ---- 238~254：红石器件与陶器 ----
  addRows('红石', 'circuit', [
    '拉杆|#77736b|#d0b071', '红石火把|#755440|#f04c3e',
    '红石中继器|#a09b90|#e43c35', '红石比较器|#99958b|#f06b5b',
    '侦测器|#777875|#c5c8c2|functional', '活塞|#8b6c45|#c5c3ae|functional',
    '黏性活塞|#8b6c45|#8bad58|functional', '发射器|#777875|#343735|functional',
    '投掷器|#777875|#4b4e4a|functional', '漏斗|#4c5358|#858f94|metal',
    '阳光探测器|#766043|#6193ae|functional', '标靶|#c7b99a|#c7443c|target',
    '红石灯|#8b5a31|#e6a34c|glow', '避雷针|#b66d4d|#e4a47d|pillar',
    '幽匿感测体|#173c42|#56a59e|sculk', '校频幽匿感测体|#253d49|#a179b7|sculk',
    '饰纹陶罐|#a86548|#df9c73|pot'
  ]);

  // ---- 255~264：考古、陶瓦与海生材料 ----
  addRows('自然', 'sand', [
    '可疑的沙子|#d7c58f|#9f8d61', '可疑的沙砾|#88827b|#b6aea2|gravel',
    '陶瓦|#a66d52|#c58a6c|terracotta', '海晶石|#669b8f|#8cbcac|cobble',
    '海晶石砖|#63a493|#9bd0b9|brick', '暗海晶石|#315e52|#4d8270|tile',
    '脑纹珊瑚块|#c45a91|#ef8db6|coral', '气泡珊瑚块|#7656b8|#ae87e0|coral',
    '火珊瑚块|#b6474e|#e47472|coral', '鹿角珊瑚块|#c5a946|#ebd575|coral'
  ]);

  // 将建筑加工件从原料分类中分离，避免“建筑”页只有砖块和玻璃
  const BUILDING_NAMES = new Set([
    '砂岩', '红砂岩', '平滑砂岩', '平滑红砂岩',
    '石砖', '苔石砖', '裂纹石砖', '錾制石砖',
    '磨制花岗岩', '磨制闪长岩', '磨制安山岩',
    '磨制深板岩', '深板岩砖', '裂纹深板岩砖', '深板岩瓦', '裂纹深板岩瓦',
    '磨制玄武岩', '平滑玄武岩', '磨制黑石', '磨制黑石砖', '裂纹磨制黑石砖',
    '末地石砖', '紫珀块', '紫珀柱',
    '石英块', '平滑石英块', '石英砖', '石英柱', '錾制石英块',
    '下界砖块', '红色下界砖块', '海晶石砖', '暗海晶石'
  ]);
  HOTBAR.forEach(function (id) {
    if (BUILDING_NAMES.has(DEF[id].name)) DEF[id].category = '建筑';
  });

  /** 16 色标准调色板，六组材料共用相同顺序，便于在背包中查找 */
  const COLORS = [
    ['白色', '#e8ecec', '#b8c4c5'], ['淡灰色', '#9da3a7', '#727b82'],
    ['灰色', '#46515a', '#29333b'], ['黑色', '#1b2029', '#090d13'],
    ['棕色', '#79503a', '#4c3025'], ['红色', '#b83a3d', '#78232a'],
    ['橙色', '#e67e22', '#a64a16'], ['黄色', '#f2c94c', '#b88a20'],
    ['黄绿色', '#78b843', '#47752b'], ['绿色', '#3e7f46', '#24522d'],
    ['青色', '#32939b', '#1d5e68'], ['淡蓝色', '#64a9dc', '#3975a8'],
    ['蓝色', '#3857a6', '#243671'], ['紫色', '#7b4ca0', '#4c2b6b'],
    ['品红色', '#b34da4', '#79316e'], ['粉红色', '#e795ad', '#b85c7d']
  ];

  // ---- 265~360：羊毛、混凝土、混凝土粉末、陶瓦、染色玻璃、带釉陶瓦 ----
  COLORS.forEach(function (c) { register(c[0] + '羊毛', '染色', c[1], c[2], 'wool'); });
  COLORS.forEach(function (c) { register(c[0] + '混凝土', '染色', c[1], c[2], 'concrete'); });
  COLORS.forEach(function (c) { register(c[0] + '混凝土粉末', '染色', c[1], c[2], 'powder'); });
  COLORS.forEach(function (c) { register(c[0] + '陶瓦', '染色', c[1], c[2], 'terracotta'); });
  COLORS.forEach(function (c) {
    register(c[0] + '染色玻璃', '染色', c[1], c[2], 'glass', { opaque: false, layer: 'glass' });
  });
  COLORS.forEach(function (c) { register(c[0] + '带釉陶瓦', '染色', c[1], c[2], 'glazed'); });

  // ---- 合并 1.20.1 官方属性：硬度、适配工具、发光等级与透明标记 ----
  const infoTable = Voxel.BlockInfo && Voxel.BlockInfo.INFO;
  if (infoTable) {
    HOTBAR.forEach(function (id) {
      const info = infoTable[id];
      if (!info) return;
      const def = DEF[id];
      def.official = info.official;
      def.hardness = info.hardness;
      def.tool = info.tool;
      def.light = info.light;
      def.transparentInfo = info.transparent;
      // 官方硬度 -1 表示不可破坏（基岩等），与原有特殊规则保持一致
      if (info.hardness < 0) def.breakable = false;
    });
  }

  if (HOTBAR.length !== LEGACY_BLOCK_COUNT || HOTBAR[LEGACY_BLOCK_COUNT - 1] !== LEGACY_BLOCK_COUNT) {
    throw new Error('旧方块目录必须严格保留 360 种，当前为 ' + HOTBAR.length);
  }

  // 官方清单只补充元数据或追加新 ID，不重排旧方块。
  Catalog.rows.forEach(applyCatalogRow);
  if (HOTBAR.length !== BLOCK_COUNT) {
    throw new Error('目录注册数量不符：应为 ' + BLOCK_COUNT + '，实际为 ' + HOTBAR.length);
  }
  const BY_KEY = {};
  HOTBAR.forEach(function (id) { if (DEF[id].key) BY_KEY[DEF[id].key] = id; });
  CATEGORIES.length = 0;
  ['建筑', '植物', '功能', '红石', '照明', '生活', '矿物', '特殊', '轨道', '自然', '木材', '石材', '染色'].forEach(function (name) {
    if (HOTBAR.some(function (id) { return DEF[id].category === name; })) CATEGORIES.push(name);
  });
  nextTile = HOTBAR.length;

  /**
   * 分配基础目录瓦片之外的侧面、顶面、生长阶段或激活状态瓦片
   * @param {number} id 方块 ID
   * @param {string} kind 额外瓦片类型
   * @returns {number} 新瓦片编号
   */
  function addExtraTile(id, kind) {
    const tile = nextTile++;
    if (tile >= ATLAS_COLS * ATLAS_ROWS) throw new Error('纹理图集容量不足');
    tileKinds[tile] = { id: id, kind: kind };
    return tile;
  }

  // 原木顶面使用年轮，功能器件激活时使用独立亮态纹理。
  HOTBAR.forEach(function (id) {
    const def = DEF[id];
    if (def.pattern === 'log') {
      const top = addExtraTile(id, 'logTop');
      def.tiles.top = top;
      def.tiles.bottom = top;
    }
  });
  DEF[ID.GRASS].tiles.side = addExtraTile(ID.GRASS, 'grassSide');
  const tntTop = addExtraTile(ID.TNT, 'tntTop');
  DEF[ID.TNT].tiles.top = tntTop;
  DEF[ID.TNT].tiles.bottom = tntTop;

  const toggleNames = [
    '熔炉', '烟熏炉', '高炉', '拉杆', '红石火把', '红石中继器', '红石比较器',
    '侦测器', '活塞', '黏性活塞', '发射器', '投掷器', '阳光探测器',
    '红石灯', '幽匿感测体', '校频幽匿感测体'
  ];
  toggleNames.concat(['红石']).forEach(function (name) {
    const id = HOTBAR.find(function (blockId) { return DEF[blockId].name === name; });
    if (!id) return;
    DEF[id].toggleable = true;
    DEF[id].litTile = addExtraTile(id, 'lit');
  });

  // 四种主作物使用 0~7 共八张独立贴图，世界网格按坐标阶段选瓦片。
  ['wheat', 'carrots', 'potatoes', 'beetroots'].forEach(function (key) {
    const id = BY_KEY['minecraft:' + key];
    if (!id) return;
    const def = DEF[id];
    def.crop = key;
    def.maxStage = 7;
    def.stageTiles = [def.tiles.side];
    for (let stage = 1; stage <= 7; stage++) {
      def.stageTiles.push(addExtraTile(id, 'crop' + stage));
    }
  });

  // 瓜茎有八阶段；下界疣与可可豆简化为四阶段，均复用程序化作物纹样。
  ['pumpkin_stem', 'melon_stem'].forEach(function (key) {
    const id = BY_KEY['minecraft:' + key];
    if (!id) return;
    const def = DEF[id];
    def.maxStage = 7;
    def.stageTiles = [def.tiles.side];
    for (let stage = 1; stage <= 7; stage++) def.stageTiles.push(addExtraTile(id, 'crop' + stage));
  });
  ['nether_wart', 'cocoa'].forEach(function (key) {
    const id = BY_KEY['minecraft:' + key];
    if (!id) return;
    const def = DEF[id];
    def.maxStage = 3;
    def.stageTiles = [def.tiles.side];
    for (let stage = 1; stage <= 3; stage++) def.stageTiles.push(addExtraTile(id, 'crop' + stage));
  });

  /** 兼容上一版导出及 world.js 的红石亮态贴图引用 */
  const T = Object.freeze({
    GRASS_TOP: DEF[ID.GRASS].tiles.top,
    GRASS_SIDE: DEF[ID.GRASS].tiles.side,
    DIRT: DEF[ID.DIRT].tiles.side,
    STONE: DEF[ID.STONE].tiles.side,
    WOOD_SIDE: DEF[ID.WOOD].tiles.side,
    WOOD_TOP: DEF[ID.WOOD].tiles.top,
    LEAVES: DEF[ID.LEAVES].tiles.side,
    SAND: DEF[ID.SAND].tiles.side,
    SNOW: DEF[ID.SNOW].tiles.side,
    PLANK: DEF[ID.PLANK].tiles.side,
    BRICK: DEF[ID.BRICK].tiles.side,
    COAL_ORE: DEF[ID.COAL_ORE].tiles.side,
    IRON_ORE: DEF[ID.IRON_ORE].tiles.side,
    GOLD_ORE: DEF[ID.GOLD_ORE].tiles.side,
    WATER: DEF[ID.WATER].tiles.side,
    GLASS: DEF[ID.GLASS].tiles.side,
    BEDROCK: DEF[ID.BEDROCK].tiles.side,
    TNT_SIDE: DEF[ID.TNT].tiles.side,
    TNT_TOP: DEF[ID.TNT].tiles.top,
    REDSTONE: DEF[ID.REDSTONE].tiles.side,
    REDSTONE_LIT: DEF[ID.REDSTONE].litTile
  });
  Object.freeze(ID);

  /**
   * 绘制密集颗粒底纹
   * @param {CanvasRenderingContext2D} ctx 画布
   * @param {number} ox 瓦片 x
   * @param {number} oy 瓦片 y
   * @param {string} base 基色
   * @param {() => number} rand 随机函数
   * @param {number} amount 颗粒强度
   */
  function paintGrain(ctx, ox, oy, base, rand, amount) {
    for (let y = 0; y < TILE_SIZE; y += 2) {
      for (let x = 0; x < TILE_SIZE; x += 2) {
        ctx.fillStyle = shadeColor(base, Math.round((rand() * 2 - 1) * amount));
        ctx.fillRect(ox + x, oy + y, 2, 2);
      }
    }
  }

  /**
   * 绘制砖缝网格
   * @param {CanvasRenderingContext2D} ctx 画布
   * @param {number} ox 瓦片 x
   * @param {number} oy 瓦片 y
   * @param {string} mortar 灰浆色
   * @param {boolean} tiled 是否正方形瓦片
   */
  function paintMortar(ctx, ox, oy, mortar, tiled) {
    ctx.fillStyle = mortar;
    const stepY = tiled ? 16 : 8;
    for (let y = 0; y < TILE_SIZE; y += stepY) ctx.fillRect(ox, oy + y, TILE_SIZE, 1);
    for (let row = 0; row < TILE_SIZE / stepY; row++) {
      const offset = tiled ? 0 : (row % 2 ? 8 : 0);
      for (let x = offset; x < TILE_SIZE; x += 16) {
        ctx.fillRect(ox + x, oy + row * stepY, 1, stepY);
      }
    }
  }

  /**
   * 按方块样式绘制一张完整像素纹理
   * @param {CanvasRenderingContext2D} ctx 画布
   * @param {number} tile 瓦片编号
   * @param {object} def 方块定义
   * @param {string} kind 额外瓦片类型或 base
   */
  function paintPattern(ctx, tile, def, kind) {
    const ox = (tile % ATLAS_COLS) * TILE_SIZE;
    const oy = Math.floor(tile / ATLAS_COLS) * TILE_SIZE;
    const rand = mulberry32(1013 + tile * 7919);
    const active = kind === 'lit';
    const pattern = kind === 'base' || active ? def.pattern : kind;
    const base = active ? def.accent : def.base;
    const accent = active ? '#fff0a8' : def.accent;

    ctx.clearRect(ox, oy, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = base;
    ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

    if (pattern === 'glass') {
      ctx.globalAlpha = 0.3;
      paintGrain(ctx, ox, oy, base, rand, 8);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.strokeRect(ox + 1.5, oy + 1.5, 29, 29);
      ctx.strokeStyle = 'rgba(255,255,255,.72)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox + 6, oy + 26); ctx.lineTo(ox + 26, oy + 6);
      ctx.moveTo(ox + 13, oy + 28); ctx.lineTo(ox + 28, oy + 13);
      ctx.stroke();
      return;
    }

    // 交叉植物只画不透明像素，其余区域保持透明，避免变成贴花实心方块。
    if (def.cross) {
      const stageMatch = /^crop(\d+)$/.exec(kind);
      const stage = stageMatch ? Number(stageMatch[1]) : 0;
      const stem = def.base;
      if (def.shape === 'lily') {
        ctx.fillStyle = stem;
        ctx.fillRect(ox + 4, oy + 4, 24, 24);
        ctx.clearRect(ox + 16, oy + 4, 12, 12);
        ctx.fillStyle = accent; ctx.fillRect(ox + 8, oy + 8, 4, 4);
        return;
      }
      ctx.strokeStyle = stem;
      ctx.fillStyle = stem;
      ctx.lineWidth = 2;
      if (pattern === 'flower') {
        ctx.beginPath(); ctx.moveTo(ox + 16, oy + 31); ctx.lineTo(ox + 16, oy + 10); ctx.stroke();
        ctx.fillRect(ox + 10, oy + 21, 6, 3); ctx.fillRect(ox + 16, oy + 17, 6, 3);
        ctx.fillStyle = accent;
        ctx.fillRect(ox + 11, oy + 5, 10, 10);
        ctx.fillRect(ox + 8, oy + 8, 16, 4);
        ctx.fillStyle = offsetHex(accent, 35); ctx.fillRect(ox + 14, oy + 8, 4, 4);
      } else if (pattern === 'crop') {
        const height = 8 + stage * 3;
        for (let x = 5; x <= 27; x += 5) {
          const h = Math.max(5, height - ((x * 3) % 7));
          ctx.fillRect(ox + x, oy + 31 - h, 2, h);
          if (stage >= 3) {
            ctx.fillStyle = accent;
            ctx.fillRect(ox + x - 1, oy + 27 - h, 4, Math.min(7, 2 + stage));
            ctx.fillStyle = stem;
          }
        }
        if (stage >= 6) { ctx.fillStyle = accent; ctx.fillRect(ox + 10, oy + 25, 13, 4); }
      } else if (pattern === 'sapling') {
        ctx.fillRect(ox + 15, oy + 17, 2, 15);
        ctx.fillStyle = accent;
        ctx.fillRect(ox + 9, oy + 6, 14, 12);
        ctx.fillRect(ox + 6, oy + 10, 20, 5);
        ctx.fillStyle = stem; ctx.fillRect(ox + 14, oy + 9, 4, 4);
      } else if (pattern === 'mushroom') {
        ctx.fillRect(ox + 14, oy + 16, 4, 16);
        ctx.fillStyle = accent;
        ctx.fillRect(ox + 6, oy + 9, 20, 8); ctx.fillRect(ox + 10, oy + 5, 12, 4);
        ctx.fillStyle = '#eee5d2'; ctx.fillRect(ox + 10, oy + 10, 3, 3); ctx.fillRect(ox + 20, oy + 8, 3, 3);
      } else if (pattern === 'bamboo') {
        ctx.fillStyle = '#86a84e';
        for (let x = 8; x < 28; x += 9) {
          ctx.fillRect(ox + x, oy + 2, 4, 30);
          ctx.fillStyle = '#c2cb69';
          for (let y = 7; y < 30; y += 9) ctx.fillRect(ox + x, oy + y, 4, 2);
          ctx.fillStyle = '#86a84e';
        }
      } else {
        const blades = pattern === 'seagrass' || pattern === 'vine' ? 7 : 5;
        for (let i = 0; i < blades; i++) {
          const x = 4 + i * (24 / Math.max(1, blades - 1));
          const top = 3 + ((i * 7 + tile) % 12);
          ctx.strokeStyle = i % 2 ? stem : accent;
          ctx.beginPath(); ctx.moveTo(ox + x, oy + 31);
          ctx.lineTo(ox + x + (i % 2 ? 3 : -2), oy + top); ctx.stroke();
          if (pattern === 'vine') ctx.fillRect(ox + x - 2, oy + top + 7, 5, 3);
        }
      }
      return;
    }

    paintGrain(ctx, ox, oy, base, rand,
      pattern === 'concrete' ? 4 : pattern === 'terracotta' ? 6 : 13);

    if (pattern === 'grass' || pattern === 'grassSide') {
      const side = pattern === 'grassSide';
      const dirt = side ? def.accent : def.base;
      if (side) {
        ctx.fillStyle = dirt; ctx.fillRect(ox, oy, 32, 32);
        paintGrain(ctx, ox, oy, dirt, rand, 15);
      }
      ctx.fillStyle = def.base;
      ctx.fillRect(ox, oy, 32, side ? 10 : 32);
      for (let i = 0; i < 65; i++) {
        ctx.fillStyle = shadeColor(def.base, rand() > 0.5 ? 18 : -20);
        ctx.fillRect(ox + Math.floor(rand() * 32), oy + Math.floor(rand() * (side ? 14 : 32)), 2, 2);
      }
    } else if (pattern === 'log' || pattern === 'logTop' || pattern === 'pillar') {
      if (pattern === 'logTop') {
        ctx.fillStyle = accent; ctx.fillRect(ox, oy, 32, 32);
        paintGrain(ctx, ox, oy, accent, rand, 8);
        ctx.strokeStyle = shadeColor(accent, -45); ctx.lineWidth = 2;
        [5, 10, 14].forEach(function (r) { ctx.strokeRect(ox + 16 - r, oy + 16 - r, r * 2, r * 2); });
      } else {
        for (let x = 2; x < 32; x += 6) {
          ctx.fillStyle = shadeColor(base, x % 12 ? -24 : 18);
          ctx.fillRect(ox + x, oy, 2, 32);
        }
        if (pattern === 'pillar') {
          ctx.fillStyle = accent; ctx.fillRect(ox, oy + 3, 32, 2); ctx.fillRect(ox, oy + 27, 32, 2);
        }
      }
    } else if (pattern === 'plank') {
      paintMortar(ctx, ox, oy, accent, false);
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = shadeColor(base, rand() > 0.5 ? 16 : -18);
        ctx.fillRect(ox + Math.floor(rand() * 25), oy + Math.floor(rand() * 32), 5, 1);
      }
    } else if (pattern === 'brick' || pattern === 'tile') {
      paintMortar(ctx, ox, oy, accent, pattern === 'tile');
    } else if (pattern === 'ore') {
      for (let i = 0; i < 7; i++) {
        const x = 3 + Math.floor(rand() * 25);
        const y = 3 + Math.floor(rand() * 25);
        ctx.fillStyle = accent;
        ctx.fillRect(ox + x, oy + y, 4, 4);
        ctx.fillRect(ox + x + (rand() > 0.5 ? 3 : -2), oy + y + 2, 3, 3);
        ctx.fillStyle = shadeColor(accent, 35);
        ctx.fillRect(ox + x + 1, oy + y + 1, 2, 2);
      }
    } else if (pattern === 'water') {
      for (let band = 0; band < 4; band++) {
        for (let x = 0; x < 32; x++) {
          const y = 4 + band * 8 + Math.round(Math.sin((x + band * 7) * 0.45) * 2);
          ctx.fillStyle = band % 2 ? shadeColor(base, -25) : accent;
          ctx.fillRect(ox + x, oy + y, 1, 2);
        }
      }
    } else if (pattern === 'leaves' || pattern === 'moss' || pattern === 'coral' || pattern === 'sculk') {
      for (let i = 0; i < 75; i++) {
        ctx.fillStyle = rand() > 0.55 ? accent : shadeColor(base, -25);
        const s = pattern === 'coral' ? 3 : 2;
        ctx.fillRect(ox + Math.floor(rand() * 30), oy + Math.floor(rand() * 30), s, s);
      }
    } else if (pattern === 'stone' || pattern === 'deepslate' || pattern === 'bedrock' || pattern === 'obsidian') {
      ctx.strokeStyle = shadeColor(accent, -10); ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(rand() * 28), y = Math.floor(rand() * 28);
        ctx.beginPath(); ctx.moveTo(ox + x, oy + y);
        ctx.lineTo(ox + x + rand() * 10 - 4, oy + y + rand() * 10 - 3); ctx.stroke();
      }
    } else if (pattern === 'cobble' || pattern === 'gravel') {
      ctx.strokeStyle = shadeColor(base, -28); ctx.lineWidth = 1;
      for (let y = 1; y < 32; y += 8) {
        for (let x = (y % 16 ? 1 : 5); x < 32; x += 9) {
          ctx.strokeRect(ox + x, oy + y, 7, 6);
        }
      }
    } else if (pattern === 'metal' || pattern === 'raw') {
      ctx.strokeStyle = shadeColor(base, -35); ctx.lineWidth = 2; ctx.strokeRect(ox + 1, oy + 1, 30, 30);
      ctx.fillStyle = accent;
      [[4, 4], [26, 4], [4, 26], [26, 26]].forEach(function (p) { ctx.fillRect(ox + p[0], oy + p[1], 2, 2); });
      if (pattern === 'raw') {
        for (let i = 0; i < 14; i++) ctx.fillRect(ox + Math.floor(rand() * 28), oy + Math.floor(rand() * 28), 4, 3);
      }
    } else if (pattern === 'circuit' || pattern === 'functional' || pattern === 'target') {
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(ox + 2, oy + 2, 28, 28);
      ctx.fillStyle = shadeColor(base, -35); ctx.fillRect(ox + 6, oy + 6, 20, 20);
      ctx.fillStyle = accent;
      if (pattern === 'target') {
        ctx.fillRect(ox + 9, oy + 9, 14, 14); ctx.fillStyle = base; ctx.fillRect(ox + 13, oy + 13, 6, 6);
      } else {
        ctx.fillRect(ox + 9, oy + 9, 4, 4); ctx.fillRect(ox + 19, oy + 9, 4, 4);
        ctx.fillRect(ox + 14, oy + 15, 4, 10);
        if (active) { ctx.globalAlpha = 0.35; ctx.fillRect(ox, oy, 32, 32); ctx.globalAlpha = 1; }
      }
    } else if (pattern === 'glazed') {
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.moveTo(ox + 16, oy + 2); ctx.lineTo(ox + 30, oy + 16);
      ctx.lineTo(ox + 16, oy + 30); ctx.lineTo(ox + 2, oy + 16); ctx.fill();
      ctx.fillStyle = shadeColor(base, 45);
      ctx.beginPath(); ctx.moveTo(ox + 16, oy + 8); ctx.lineTo(ox + 24, oy + 16);
      ctx.lineTo(ox + 16, oy + 24); ctx.lineTo(ox + 8, oy + 16); ctx.fill();
      ctx.fillStyle = accent; ctx.fillRect(ox + 14, oy + 14, 4, 4);
    } else if (pattern === 'wool') {
      ctx.strokeStyle = shadeColor(base, -16); ctx.lineWidth = 1;
      for (let i = -16; i < 40; i += 6) {
        ctx.beginPath(); ctx.moveTo(ox + i, oy); ctx.lineTo(ox + i + 16, oy + 32); ctx.stroke();
      }
    } else if (pattern === 'powder' || pattern === 'sand' || pattern === 'snow') {
      for (let i = 0; i < 45; i++) {
        ctx.fillStyle = rand() > 0.5 ? accent : shadeColor(base, 18);
        ctx.fillRect(ox + Math.floor(rand() * 32), oy + Math.floor(rand() * 32), 1 + (i % 2), 1);
      }
    } else if (pattern === 'ice' || pattern === 'crystal') {
      ctx.strokeStyle = accent; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const x = rand() * 32, y = rand() * 32;
        ctx.beginPath(); ctx.moveTo(ox + x, oy + y); ctx.lineTo(ox + 16, oy + 16); ctx.stroke();
      }
    } else if (pattern === 'pumpkin' || pattern === 'melon' || pattern === 'hay') {
      for (let x = 3; x < 32; x += 7) {
        ctx.fillStyle = shadeColor(base, -24); ctx.fillRect(ox + x, oy, 2, 32);
        ctx.fillStyle = accent; ctx.fillRect(ox + x + 2, oy, 1, 32);
      }
    } else if (pattern === 'honeycomb') {
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      for (let y = 4; y < 30; y += 9) for (let x = 3; x < 30; x += 10) ctx.strokeRect(ox + x, oy + y, 8, 7);
    } else if (pattern === 'books') {
      const bookColors = ['#a8433d', '#3e6e9e', '#c5a344', '#58844c', '#78528e'];
      for (let x = 2; x < 30; x += 5) {
        ctx.fillStyle = bookColors[(x / 5) % 5 | 0]; ctx.fillRect(ox + x, oy + 5, 4, 23);
        ctx.fillStyle = accent; ctx.fillRect(ox + x, oy + 8, 4, 1);
      }
    } else if (pattern === 'tnt' || pattern === 'tntTop') {
      ctx.fillStyle = '#8f2419'; ctx.fillRect(ox, oy, 32, 3); ctx.fillRect(ox, oy + 29, 32, 3);
      if (pattern === 'tnt') {
        ctx.fillStyle = '#f3ece1'; ctx.fillRect(ox, oy + 9, 32, 14);
        ctx.fillStyle = '#241a16'; ctx.font = 'bold 12px Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('TNT', ox + 16, oy + 16.5);
      } else {
        ctx.strokeStyle = '#8f2419'; ctx.lineWidth = 4; ctx.strokeRect(ox + 2, oy + 2, 28, 28);
        ctx.fillStyle = '#30241f'; ctx.fillRect(ox + 12, oy + 12, 8, 8);
      }
    } else if (pattern === 'glow' || pattern === 'magma' || pattern === 'beacon') {
      ctx.fillStyle = accent;
      for (let i = 0; i < 25; i++) ctx.fillRect(ox + Math.floor(rand() * 29), oy + Math.floor(rand() * 29), 3, 3);
      if (active) { ctx.globalAlpha = 0.4; ctx.fillRect(ox, oy, 32, 32); ctx.globalAlpha = 1; }
    } else if (pattern === 'chiseled' || pattern === 'sandstone' || pattern === 'polished') {
      ctx.strokeStyle = shadeColor(base, -22); ctx.lineWidth = 2;
      ctx.strokeRect(ox + 2, oy + 2, 28, 28);
      if (pattern === 'chiseled') { ctx.strokeRect(ox + 9, oy + 9, 14, 14); ctx.fillStyle = accent; ctx.fillRect(ox + 14, oy + 8, 4, 16); }
    } else if (pattern === 'chest' || pattern === 'barrel' || pattern === 'jukebox') {
      ctx.fillStyle = shadeColor(base, -35); ctx.fillRect(ox, oy + 13, 32, 3);
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(ox + 2, oy + 2, 28, 28);
      ctx.fillStyle = accent; ctx.fillRect(ox + 13, oy + 12, 6, 8);
    } else if (pattern === 'bed') {
      ctx.fillStyle = '#e9e4d7'; ctx.fillRect(ox + 2, oy + 3, 28, 9);
      ctx.fillStyle = base; ctx.fillRect(ox + 2, oy + 12, 28, 16);
      ctx.fillStyle = accent; ctx.fillRect(ox + 2, oy + 26, 28, 3);
    } else if (pattern === 'door') {
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(ox + 5, oy + 1, 22, 30);
      ctx.fillStyle = '#263b45'; ctx.fillRect(ox + 9, oy + 5, 14, 9);
      ctx.fillStyle = accent; ctx.fillRect(ox + 21, oy + 18, 3, 3);
    } else if (pattern === 'fence') {
      ctx.fillStyle = shadeColor(base, -28); ctx.fillRect(ox + 5, oy, 5, 32); ctx.fillRect(ox + 22, oy, 5, 32);
      ctx.fillStyle = accent; ctx.fillRect(ox, oy + 8, 32, 5); ctx.fillRect(ox, oy + 22, 32, 5);
    } else if (pattern === 'stairs') {
      ctx.fillStyle = accent;
      for (let y = 0; y < 32; y += 8) ctx.fillRect(ox, oy + y, 8 + y, 2);
    } else if (pattern === 'slab') {
      ctx.fillStyle = accent; ctx.fillRect(ox, oy + 14, 32, 3);
      ctx.fillStyle = shadeColor(base, -25); ctx.fillRect(ox, oy + 28, 32, 3);
    } else if (pattern === 'rail') {
      ctx.fillStyle = '#3b332c';
      for (let y = 3; y < 32; y += 7) ctx.fillRect(ox + 2, oy + y, 28, 3);
      ctx.fillStyle = accent; ctx.fillRect(ox + 7, oy, 3, 32); ctx.fillRect(ox + 22, oy, 3, 32);
    } else if (pattern === 'candle') {
      ctx.fillStyle = base; ctx.fillRect(ox + 10, oy + 8, 12, 23);
      ctx.fillStyle = '#f7d563'; ctx.fillRect(ox + 14, oy + 1, 4, 7);
    } else if (pattern === 'ladder') {
      ctx.fillStyle = accent; ctx.fillRect(ox + 5, oy, 4, 32); ctx.fillRect(ox + 23, oy, 4, 32);
      for (let y = 4; y < 32; y += 7) ctx.fillRect(ox + 5, oy + y, 22, 3);
    } else if (pattern === 'plant' || pattern === 'roots') {
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      for (let x = 4; x < 32; x += 7) { ctx.beginPath(); ctx.moveTo(ox + x, oy + 31); ctx.lineTo(ox + x + 2, oy + 2); ctx.stroke(); }
    }

    // 统一的像素内描边让完整体素边缘更清晰；透明玻璃已提前返回。
    ctx.strokeStyle = shadeColor(base, -22);
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, 31, 31);
  }

  // ---- 生成整张图集 ----
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = ATLAS_COLS * TILE_SIZE;
  atlasCanvas.height = ATLAS_ROWS * TILE_SIZE;
  const atlasCtx = atlasCanvas.getContext('2d');
  atlasCtx.imageSmoothingEnabled = false;
  HOTBAR.forEach(function (id) { paintPattern(atlasCtx, id - 1, DEF[id], 'base'); });
  Object.keys(tileKinds).forEach(function (key) {
    const tile = Number(key);
    const info = tileKinds[tile];
    paintPattern(atlasCtx, tile, DEF[info.id], info.kind);
  });

  const texture = new THREE.CanvasTexture(atlasCanvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;

  /**
   * 计算瓦片在图集中的 UV 范围
   * @param {number} tile 瓦片编号
   * @returns {{u0:number,u1:number,v0:number,v1:number}} UV 范围
   */
  function getTileUV(tile) {
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    const du = 1 / ATLAS_COLS;
    const dv = 1 / ATLAS_ROWS;
    return { u0: col * du, u1: (col + 1) * du, v0: 1 - (row + 1) * dv, v1: 1 - row * dv };
  }

  const iconCache = {};

  /**
   * 将图集瓦片放大为像素风 UI 图标并缓存
   * @param {number} tile 瓦片编号
   * @returns {string} PNG dataURL
   */
  function getIconDataURL(tile) {
    if (iconCache[tile]) return iconCache[tile];
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(atlasCanvas, (tile % ATLAS_COLS) * TILE_SIZE,
      Math.floor(tile / ATLAS_COLS) * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0, 0, 64, 64);
    iconCache[tile] = c.toDataURL();
    return iconCache[tile];
  }

  Voxel.Blocks = {
    ID: ID,
    TILES: T,
    DEF: DEF,
    HOTBAR: HOTBAR,
    BY_KEY: BY_KEY,
    CATEGORIES: CATEGORIES,
    COUNT: BLOCK_COUNT,
    LEGACY_COUNT: LEGACY_BLOCK_COUNT,
    CATALOG_STATS: Catalog.stats,
    PAGE_SIZE: PAGE_SIZE,
    TILE_SIZE: TILE_SIZE,
    ATLAS_COLS: ATLAS_COLS,
    ATLAS_ROWS: ATLAS_ROWS,
    tileCount: nextTile,
    texture: texture,
    atlasCanvas: atlasCanvas,
    getTileUV: getTileUV,
    getIconDataURL: getIconDataURL
  };
})(window.Voxel = window.Voxel || {});
