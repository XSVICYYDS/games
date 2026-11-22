/**
 * items.js
 * 手持武器与投射物系统：10 种剑斧、弓与箭矢飞行命中、耐久与程序化图标。
 * 武器数值集中在本文件，主循环只负责输入、冷却与界面同步。
 */
(function (Voxel) {
  'use strict';

  /**
   * 武器定义：伤害、攻击冷却（秒）、耐久与材质主色
   * 剑攻速快、单次伤害中等；斧攻速慢、单次伤害高。
   */
  const WEAPONS = [
    { key: 'wooden_sword', name: '木剑', kind: 'sword', damage: 4, cooldown: 0.62, durability: 59, color: '#9a7248', edge: '#c9a86f' },
    { key: 'stone_sword', name: '石剑', kind: 'sword', damage: 5, cooldown: 0.62, durability: 131, color: '#8b8b8b', edge: '#bdbdbd' },
    { key: 'iron_sword', name: '铁剑', kind: 'sword', damage: 6, cooldown: 0.58, durability: 250, color: '#d3d7da', edge: '#f2f5f7' },
    { key: 'golden_sword', name: '金剑', kind: 'sword', damage: 4, cooldown: 0.55, durability: 32, color: '#e8c243', edge: '#ffe98a' },
    { key: 'diamond_sword', name: '钻石剑', kind: 'sword', damage: 7, cooldown: 0.55, durability: 1561, color: '#4fd6c8', edge: '#a8fff3' },
    { key: 'wooden_axe', name: '木斧', kind: 'axe', damage: 7, cooldown: 1.05, durability: 59, color: '#9a7248', edge: '#c9a86f' },
    { key: 'stone_axe', name: '石斧', kind: 'axe', damage: 9, cooldown: 1.05, durability: 131, color: '#8b8b8b', edge: '#bdbdbd' },
    { key: 'iron_axe', name: '铁斧', kind: 'axe', damage: 9, cooldown: 0.95, durability: 250, color: '#d3d7da', edge: '#f2f5f7' },
    { key: 'golden_axe', name: '金斧', kind: 'axe', damage: 7, cooldown: 0.9, durability: 32, color: '#e8c243', edge: '#ffe98a' },
    { key: 'diamond_axe', name: '钻石斧', kind: 'axe', damage: 9, cooldown: 0.85, durability: 1561, color: '#4fd6c8', edge: '#a8fff3' },
    { key: 'bow', name: '弓', kind: 'bow', damage: 2, cooldown: 0.35, durability: 384, color: '#b58a4f', edge: '#f0e2c4' }
  ];

  /** 弓箭参数：满蓄力时间、基础/最大伤害、初速度与最大射程 */
  const BOW = {
    chargeTime: 1.2,
    minDamage: 2,
    maxDamage: 9,
    minSpeed: 16,
    maxSpeed: 42,
    minRange: 12,
    maxRange: 46
  };

  /**
   * 按注册键查找武器
   * @param {string} key 武器键
   * @returns {object|null} 武器定义
   */
  function byKey(key) {
    for (let i = 0; i < WEAPONS.length; i++) {
      if (WEAPONS[i].key === key) return WEAPONS[i];
    }
    return null;
  }

  /**
   * 用离屏画布绘制 32×32 像素图标：剑为斜刃加护手，斧为斧头加木柄，弓为弓臂与弦
   * @param {object} def 武器定义
   * @returns {string} dataURL 图标
   */
  function drawIcon(def) {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    /** 画一个 2×2 像素块，保持像素画风格 */
    function px(x, y, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x * 2, y * 2, 2, 2);
    }

    if (def.kind === 'bow') {
      // 弓臂：右侧半圆弧，弦为直线
      for (let y = 5; y <= 27; y++) {
        const t = (y - 16) / 11;
        const x = Math.round(9 + 5 * t * t);
        px(x, y, def.color);
        px(x + 1, y, def.edge);
      }
      ctx.fillStyle = '#efe9dc';
      ctx.fillRect(18, 5, 2, 44);
      return canvas.toDataURL('image/png');
    }

    // 木柄：左下到中部的斜线
    for (let i = 0; i < 9; i++) {
      px(6 + i, 25 - i, '#6b4a2b');
      px(7 + i, 25 - i, '#8a6238');
    }
    if (def.kind === 'sword') {
      // 剑身：右上方向的长刃
      for (let i = 0; i < 12; i++) {
        px(13 + i, 19 - i, def.color);
        px(14 + i, 19 - i, def.edge);
      }
      px(24, 6, def.edge);
      px(24, 7, def.color);
      // 护手
      for (let i = 0; i < 3; i++) {
        px(11 + i, 18 - i + 2, '#5b4726');
      }
      px(14, 21, '#5b4726');
      px(15, 22, '#5b4726');
    } else {
      // 斧头：柄顶左侧的大块刃面
      for (let y = 8; y <= 16; y++) {
        for (let x = 10; x <= 20; x++) {
          if (y === 8 || y === 16 || x === 20) px(x, y, def.edge);
          else px(x, y, def.color);
        }
      }
      for (let y = 10; y <= 14; y++) px(9, y, def.edge);
    }
    return canvas.toDataURL('image/png');
  }

  // 预生成图标，避免每次刷新快捷栏重复绘制
  WEAPONS.forEach(function (def) { def.icon = drawIcon(def); });

  /**
   * 箭矢管理器：负责生成、飞行、方块与生物命中检测以及回收
   */
  class ArrowSystem {
    /**
     * @param {THREE.Scene} scene 场景
     * @param {object} world 当前世界
     * @param {object} mobs 生物管理器
     * @param {object} player 玩家
     */
    constructor(scene, world, mobs, player) {
      this.scene = scene;
      this.world = world;
      this.mobs = mobs;
      this.player = player;
      this.list = [];
      /** 回收箭矢回调（由 main.js 设置） */
      this.onRecover = null;
      this.geometry = new THREE.BoxGeometry(0.06, 0.06, 0.7);
      this.material = new THREE.MeshBasicMaterial({ color: 0xe8e2cf });
    }

    /**
     * 发射一支箭
     * @param {THREE.Vector3} origin 起点
     * @param {THREE.Vector3} dir 单位方向
     * @param {number} power 蓄力比例 0~1
     * @returns {object} 箭矢对象
     */
    shoot(origin, dir, power) {
      const p = Math.max(0, Math.min(1, power));
      const speed = BOW.minSpeed + (BOW.maxSpeed - BOW.minSpeed) * p;
      const damage = Math.round(BOW.minDamage + (BOW.maxDamage - BOW.minDamage) * p);
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.position.copy(origin);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.scene.add(mesh);
      const arrow = {
        mesh: mesh,
        vel: dir.clone().multiplyScalar(speed),
        damage: damage,
        // 重力方向取发射时玩家的径向“上”，球面上也能自然下坠
        gravity: this.player.up.clone().multiplyScalar(-9.5),
        life: 0,
        maxLife: 6,
        range: BOW.minRange + (BOW.maxRange - BOW.minRange) * p,
        traveled: 0,
        dead: false
      };
      this.list.push(arrow);
      return arrow;
    }

    /**
     * 移除一支箭，并按概率回收
     * @param {object} arrow 箭矢
     * @param {boolean} recover 是否参与回收判定
     */
    remove(arrow, recover) {
      if (arrow.dead) return;
      arrow.dead = true;
      this.scene.remove(arrow.mesh);
      const index = this.list.indexOf(arrow);
      if (index >= 0) this.list.splice(index, 1);
      if (recover && Math.random() < 0.6 && typeof this.onRecover === 'function') {
        this.onRecover(1);
      }
    }

    /**
     * 用箭矢当前位置检测生物命中
     * @param {THREE.Vector3} pos 箭矢位置
     * @returns {object|null} 命中的生物
     */
    hitMob(pos) {
      for (let i = 0; i < this.mobs.mobs.length; i++) {
        const m = this.mobs.mobs[i];
        const half = m.def.width * 0.5 + 0.2;
        if (pos.x < m.x - half || pos.x > m.x + half) continue;
        if (pos.z < m.z - half || pos.z > m.z + half) continue;
        if (pos.y < m.y - 0.1 || pos.y > m.y + m.def.height + 0.2) continue;
        return m;
      }
      return null;
    }

    /**
     * 每帧推进所有箭矢，使用小步长避免高速穿透
     * @param {number} dt 帧间隔（秒）
     */
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const arrow = this.list[i];
        if (arrow.dead) continue;
        arrow.life += dt;
        if (arrow.life > arrow.maxLife) {
          this.remove(arrow, false);
          continue;
        }
        const step = arrow.vel.clone().multiplyScalar(dt);
        const distance = step.length();
        const sub = Math.max(1, Math.ceil(distance / 0.25));
        let hit = false;
        for (let s = 0; s < sub && !hit; s++) {
          arrow.mesh.position.addScaledVector(step, 1 / sub);
          arrow.traveled += distance / sub;
          const pos = arrow.mesh.position;
          const mob = this.hitMob(pos);
          if (mob) {
            const killed = this.mobs.hit(mob, arrow.damage);
            if (!killed) {
              // 击退：沿箭矢水平方向推开生物
              const push = arrow.vel.clone().setY(0).normalize().multiplyScalar(0.55);
              mob.x += push.x;
              mob.z += push.z;
            }
            if (typeof this.onHit === 'function') {
              this.onHit(mob, arrow.damage, killed);
            }
            this.remove(arrow, true);
            hit = true;
            break;
          }
          const bx = Math.floor(pos.x);
          const by = Math.floor(pos.y);
          const bz = Math.floor(pos.z);
          if (this.world.isSolidAt(bx, by, bz)) {
            this.remove(arrow, true);
            hit = true;
            break;
          }
          if (arrow.traveled > arrow.range) {
            this.remove(arrow, false);
            hit = true;
            break;
          }
        }
        if (hit) continue;
        arrow.vel.addScaledVector(arrow.gravity, dt);
        // 箭头朝向随速度变化
        if (arrow.vel.lengthSq() > 1e-4) {
          arrow.mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            arrow.vel.clone().normalize()
          );
        }
      }
    }

    /** 清空所有箭矢（切换维度时调用） */
    clear() {
      this.list.slice().forEach((arrow) => this.remove(arrow, false));
    }
  }

  Voxel.Weapons = { LIST: WEAPONS, BOW: BOW, byKey: byKey };
  Voxel.ArrowSystem = ArrowSystem;
})(window.Voxel = window.Voxel || {});
