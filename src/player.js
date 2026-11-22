/**
 * player.js
 * 第一人称控制器（球形世界版）：重力指向星球球心，玩家可以绕球面行走、跳跃与飞行。
 * 移动使用「径向切平面输入 + 世界坐标 AABB 碰撞」：碰撞盒仍然轴对齐，
 * 但上方向每帧由玩家位置与球心的连线决定，因此可以走遍整颗星球。
 */
(function (Voxel) {
  'use strict';

  /** 玩家碰撞盒参数（单位：方块） */
  const HALF_WIDTH = 0.3;
  const HEIGHT = 1.78;
  const EYE_HEIGHT = 1.62;

  /** 运动参数 */
  const WALK_SPEED = 4.6;
  const SPRINT_SPEED = 7.6;
  const JUMP_SPEED = 8.6;
  const GRAVITY = 26;
  const MAX_FALL_SPEED = 55;
  /** 自动上台阶的最大高度（球面阶梯靠它走上去） */
  const STEP_HEIGHT = 1.05;

  const UP = new THREE.Vector3(0, 1, 0);

  class Player {
    /**
     * @param {THREE.PerspectiveCamera} camera 主相机
     * @param {Voxel.World} world 世界对象
     * @param {object} config 世界配置
     */
    constructor(camera, world, config) {
      this.camera = camera;
      this.world = world;
      this.cfg = config;

      /** 星球球心（连续坐标） */
      this.center = new THREE.Vector3(
        config.worldWidth * 0.5,
        config.worldHeight * 0.5,
        config.worldDepth * 0.5
      );

      /** 脚底中心坐标 */
      this.pos = new THREE.Vector3(0, 0, 0);
      /** 速度（方块/秒，世界坐标） */
      this.vel = new THREE.Vector3(0, 0, 0);
      /** 当前“上”方向：出生平台内竖直，平台外逐渐转为径向 */
      this.up = new THREE.Vector3(0, 1, 0);
      /** 当前维度的出生平台参数，由主程序在切换维度时同步 */
      this.plateau = null;
      /** 视角（弧度，相对于局部切平面） */
      this.yaw = 0;
      this.pitch = 0;
      this.onGround = false;
      this.inWater = false;
      this.enabled = false;
      /** 下蹲状态：降低移动速度与视点，飞行时仍作为下降输入 */
      this.crouching = false;

      /** 创造模式飞行开关 */
      this.flying = false;
      /** 旁观模式穿墙 */
      this.noclip = false;
      /** 落地回调（参数为落地瞬间的径向速度） */
      this.onLand = null;
      /** 复活点（掉出世界时使用） */
      this.spawnPoint = new THREE.Vector3(0, 0, 0);

      /** 复用的临时向量，避免每帧分配 */
      this._basis = {
        forward: new THREE.Vector3(),
        right: new THREE.Vector3(),
        up: new THREE.Vector3(0, 1, 0)
      };
      this._tmp = new THREE.Vector3();
    }

    /**
     * 计算任意位置的上方向，供玩家与生物共用，避免平台上出现两套重力方向
     * @param {number} x 世界 x
     * @param {number} y 世界 y
     * @param {number} z 世界 z
     * @param {THREE.Vector3} target 输出向量
     * @returns {THREE.Vector3} 单位上方向
     */
    getUpAt(x, y, z, target) {
      const up = target || new THREE.Vector3();
      up.set(x - this.center.x, y - this.center.y, z - this.center.z);
      if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
      else up.normalize();

      const p = this.plateau;
      if (p) {
        const dx = x - (p.x + 0.5);
        const dz = z - (p.z + 0.5);
        const distance = Math.hypot(dx, dz);
        const outer = p.radius + 8;

        // 平台范围内权重为 1；平台外 8 格内用 smoothstep 降至 0，避免方向突然跳变
        let horizontal = 0;
        if (distance <= p.radius) {
          horizontal = 1;
        } else if (distance < outer) {
          const t = (distance - p.radius) / 8;
          horizontal = 1 - t * t * (3 - 2 * t);
        }

        // 仅影响平台顶部附近，防止星球背面错误地使用世界 Y 向上
        const verticalT = Math.max(0, Math.min(1, (y - (p.topY - 8)) / 9));
        const vertical = verticalT * verticalT * (3 - 2 * verticalT);
        const plateauWeight = horizontal * vertical;
        if (plateauWeight > 0) up.lerp(UP, plateauWeight).normalize();
      }
      return up;
    }

    /**
     * 根据玩家当前位置刷新“上”方向
     */
    updateUp() {
      return this.getUpAt(this.pos.x, this.pos.y, this.pos.z, this.up);
    }

    /**
     * 构造局部切平面基：北（yaw=0 朝向）与东（右手方向）
     * @returns {{forward:THREE.Vector3,right:THREE.Vector3,up:THREE.Vector3}} 局部基
     */
    tangentBasis() {
      const up = this.up;
      const useZ = Math.abs(up.y) > 0.9;
      const rx = 0;
      const ry = useZ ? 0 : 1;
      const rz = useZ ? 1 : 0;

      const east = this._basis.right;
      east.set(
        up.y * rz - up.z * ry,
        up.z * rx - up.x * rz,
        up.x * ry - up.y * rx
      );
      if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
      east.normalize();

      const north = this._basis.forward;
      north.crossVectors(east, up).normalize();

      const cos = Math.cos(this.yaw);
      const sin = Math.sin(this.yaw);
      const forward = new THREE.Vector3()
        .addScaledVector(north, cos)
        .addScaledVector(east, sin);
      // 右手方向 = 前向 × 上方向；这里直接展开，避免每帧叉乘
      const right = new THREE.Vector3()
        .addScaledVector(north, sin)
        .addScaledVector(east, -cos);

      this._basis.up.copy(up);
      this._basis.forward.copy(forward);
      this._basis.right.copy(right);
      return this._basis;
    }

    /**
     * 当前视线方向（世界坐标）
     * @returns {THREE.Vector3} 单位方向
     */
    viewDirection() {
      const basis = this.tangentBasis();
      const cosPitch = Math.cos(this.pitch);
      return new THREE.Vector3()
        .addScaledVector(basis.forward, cosPitch)
        .addScaledVector(this.up, Math.sin(this.pitch))
        .normalize();
    }

    /**
     * 把玩家传送到指定脚底坐标，并初始化上方向与复活点
     * @param {{x:number,y:number,z:number}} point 脚底坐标
     * @param {number} [yaw] 朝向
     * @param {number} [pitch] 俯仰
     */
    placeAt(point, yaw, pitch) {
      this.pos.set(point.x, point.y, point.z);
      this.vel.set(0, 0, 0);
      this.updateUp();
      this.yaw = typeof yaw === 'number' ? yaw : 0;
      this.pitch = typeof pitch === 'number' ? pitch : -0.12;
      this.onGround = true;
      this.spawnPoint.copy(this.pos);
      this.syncCamera();
    }

    /**
     * 兼容旧接口：从指定列自上而下找到可站立位置
     * @param {number} x 整数坐标
     * @param {number} z 整数坐标
     */
    spawnAt(x, z) {
      let y = this.cfg.worldHeight - 2;
      while (y > 0 && !this.world.isSolidAt(x, y, z)) y--;
      this.placeAt({ x: x + 0.5, y: y + 1.001, z: z + 0.5 });
    }

    /**
     * 处理鼠标位移，更新第一人称视角
     * @param {number} dx 横向像素位移
     * @param {number} dy 纵向像素位移
     */
    look(dx, dy) {
      const sensitivity = 0.0022;
      this.yaw -= dx * sensitivity;
      this.pitch -= dy * sensitivity;
      const limit = Math.PI / 2 - 0.02;
      if (this.pitch > limit) this.pitch = limit;
      if (this.pitch < -limit) this.pitch = -limit;
    }

    /**
     * 把玩家位置与视角同步到相机（相机 up 跟随径向，绕球时不会颠倒）
     */
    syncCamera() {
      const eyeHeight = this.crouching ? EYE_HEIGHT - 0.28 : EYE_HEIGHT;
      this.camera.position.copy(this.pos).addScaledVector(this.up, eyeHeight);
      this.camera.up.copy(this.up);
      const target = this._tmp.copy(this.camera.position).add(this.viewDirection());
      this.camera.lookAt(target);
    }

    /**
     * 判断给定脚底位置是否与固体方块重叠
     * @param {number} x 脚底中心 x
     * @param {number} y 脚底 y
     * @param {number} z 脚底中心 z
     * @returns {boolean} 是否被阻挡
     */
    overlapsAt(x, y, z) {
      const eps = 1e-3;
      const minX = Math.floor(x - HALF_WIDTH + eps);
      const maxX = Math.floor(x + HALF_WIDTH - eps);
      const minY = Math.floor(y + eps);
      const maxY = Math.floor(y + HEIGHT - eps);
      const minZ = Math.floor(z - HALF_WIDTH + eps);
      const maxZ = Math.floor(z + HALF_WIDTH - eps);
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          for (let bx = minX; bx <= maxX; bx++) {
            if (this.world.isSolidAt(bx, by, bz)) return true;
          }
        }
      }
      return false;
    }

    /**
     * 当前位置是否卡在方块里
     * @returns {boolean} 是否重叠
     */
    overlapsSolid() {
      return this.overlapsAt(this.pos.x, this.pos.y, this.pos.z);
    }

    /**
     * 解决 AABB 与体素的重叠：沿穿透最浅的世界轴推出，并同步速度与落地状态
     */
    resolveCollisions() {
      const eps = 1e-3;
      for (let iter = 0; iter < 4; iter++) {
        const minX = Math.floor(this.pos.x - HALF_WIDTH + eps);
        const maxX = Math.floor(this.pos.x + HALF_WIDTH - eps);
        const minY = Math.floor(this.pos.y + eps);
        const maxY = Math.floor(this.pos.y + HEIGHT - eps);
        const minZ = Math.floor(this.pos.z - HALF_WIDTH + eps);
        const maxZ = Math.floor(this.pos.z + HALF_WIDTH - eps);
        let found = false;
        let axis = '';
        let sign = 0;
        let hitX = 0;
        let hitY = 0;
        let hitZ = 0;

        for (let by = minY; by <= maxY && !found; by++) {
          for (let bz = minZ; bz <= maxZ && !found; bz++) {
            for (let bx = minX; bx <= maxX && !found; bx++) {
              if (!this.world.isSolidAt(bx, by, bz)) continue;
              hitX = bx;
              hitY = by;
              hitZ = bz;

              const pxNeg = (this.pos.x + HALF_WIDTH) - bx;
              const pxPos = (bx + 1) - (this.pos.x - HALF_WIDTH);
              const pyNeg = (this.pos.y + HEIGHT) - by;
              const pyPos = (by + 1) - this.pos.y;
              const pzNeg = (this.pos.z + HALF_WIDTH) - bz;
              const pzPos = (bz + 1) - (this.pos.z - HALF_WIDTH);
              const ox = Math.min(pxNeg, pxPos);
              const oy = Math.min(pyNeg, pyPos);
              const oz = Math.min(pzNeg, pzPos);

              if (ox <= oy && ox <= oz) {
                axis = 'x';
                sign = pxNeg < pxPos ? -1 : 1;
              } else if (oy <= oz) {
                axis = 'y';
                sign = pyNeg < pyPos ? -1 : 1;
              } else {
                axis = 'z';
                sign = pzNeg < pzPos ? -1 : 1;
              }
              found = true;
            }
          }
        }

        if (!found) return;

        // 精确求出该轴上的穿透深度，再沿法线推出
        let push = 0;
        if (axis === 'x') {
          push = sign < 0
            ? (this.pos.x + HALF_WIDTH) - hitX
            : (hitX + 1) - (this.pos.x - HALF_WIDTH);
        } else if (axis === 'y') {
          push = sign < 0
            ? (this.pos.y + HEIGHT) - hitY
            : (hitY + 1) - this.pos.y;
        } else {
          push = sign < 0
            ? (this.pos.z + HALF_WIDTH) - hitZ
            : (hitZ + 1) - (this.pos.z - HALF_WIDTH);
        }

        this.pos[axis] += sign * (push + eps);
        if (axis === 'y') this.vel.y = 0;
        else this.vel[axis] = 0;

        // 推离方向与径向“上”接近时视为站在地面
        const normalY = axis === 'y' ? sign : 0;
        const normalX = axis === 'x' ? sign : 0;
        const normalZ = axis === 'z' ? sign : 0;
        if (normalX * this.up.x + normalY * this.up.y + normalZ * this.up.z > 0.35) {
          this.onGround = true;
        }
      }
    }

    /**
     * 按帧位移前进，并分步解决碰撞（避免高速穿模）
     * @param {number} dt 帧间隔（秒）
     */
    moveWithCollisions(dt) {
      const distance = this.vel.length() * dt;
      const steps = Math.max(1, Math.min(10, Math.ceil(distance / 0.22)));
      const sub = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.pos.addScaledVector(this.vel, sub);
        this.resolveCollisions();
      }
    }

    /**
     * 自动上台阶：球面上的地形是一级级方块，向前被挡住时尝试沿径向抬高
     */
    tryStepUp() {
      if (!this.onGround || this.flying) return;
      const up = this.up;
      const vn = this.vel.dot(up);
      const flatX = this.vel.x - up.x * vn;
      const flatY = this.vel.y - up.y * vn;
      const flatZ = this.vel.z - up.z * vn;
      const speed = Math.hypot(flatX, flatY, flatZ);
      if (speed < 0.6) return;

      const step = 0.55 / speed;
      const aheadX = this.pos.x + flatX * step;
      const aheadY = this.pos.y + flatY * step;
      const aheadZ = this.pos.z + flatZ * step;
      if (!this.overlapsAt(aheadX, aheadY, aheadZ)) return;

      const liftX = aheadX + up.x * STEP_HEIGHT;
      const liftY = aheadY + up.y * STEP_HEIGHT;
      const liftZ = aheadZ + up.z * STEP_HEIGHT;
      if (this.overlapsAt(liftX, liftY, liftZ)) return;

      // 抬高后的落点必须紧邻实体台阶，否则只是悬空跨过障碍，会造成反复抬升和下落
      const supportX = liftX - up.x * 0.18;
      const supportY = liftY - up.y * 0.18;
      const supportZ = liftZ - up.z * 0.18;
      if (!this.world.isSolidAt(Math.floor(supportX), Math.floor(supportY), Math.floor(supportZ))) return;

      this.pos.addScaledVector(up, STEP_HEIGHT);
      this.vel.y = Math.max(this.vel.y, 0);
    }

    /**
     * 每帧更新：输入 -> 切向速度 -> 径向重力 -> 分步碰撞 -> 相机
     * @param {number} dt 帧间隔（秒）
     * @param {object} input 按键状态
     */
    update(dt, input) {
      if (!this.enabled) {
        this.syncCamera();
        return;
      }

      this.updateUp();
      this.crouching = !!input.down && !this.flying && !this.noclip;
      const up = this.up;
      const basis = this.tangentBasis();
      const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
      const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);

      // 旁观模式：沿视线自由飞行，跳过所有碰撞与重力
      if (this.noclip) {
        const speed = input.sprint ? 21 : 12;
        const dir = this.viewDirection();
        const wish = new THREE.Vector3()
          .addScaledVector(dir, fwd)
          .addScaledVector(basis.right, strafe)
          .addScaledVector(up, (input.jump ? 1 : 0) - (input.down ? 1 : 0));
        if (wish.lengthSq() > 1) wish.normalize();
        this.pos.addScaledVector(wish, speed * dt);
        const margin = 0.6;
        this.pos.x = Math.max(margin, Math.min(this.cfg.worldWidth - margin, this.pos.x));
        this.pos.y = Math.max(margin, Math.min(this.cfg.worldHeight - margin, this.pos.y));
        this.pos.z = Math.max(margin, Math.min(this.cfg.worldDepth - margin, this.pos.z));
        this.vel.set(0, 0, 0);
        this.updateUp();
        this.syncCamera();
        return;
      }

      // 水中判定：脚部或身体中段任意一处是水
      const foot = this._tmp.copy(this.pos).addScaledVector(up, 0.25);
      const body = this.pos.clone().addScaledVector(up, 1.1);
      this.inWater = this.world.isLiquidAt(Math.floor(foot.x), Math.floor(foot.y), Math.floor(foot.z)) ||
        this.world.isLiquidAt(Math.floor(body.x), Math.floor(body.y), Math.floor(body.z));

      const speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) *
        (this.inWater ? 0.62 : 1) * (this.flying ? 1.7 : 1) * (this.crouching ? 0.42 : 1);

      const wish = new THREE.Vector3()
        .addScaledVector(basis.forward, fwd)
        .addScaledVector(basis.right, strafe);
      if (wish.lengthSq() > 1) wish.normalize();

      // 切向速度平滑逼近目标速度：地面响应快，空中弱，水里迟钝
      const accel = this.inWater ? 8 : this.onGround ? 16 : 4;
      const k = 1 - Math.exp(-accel * dt);
      const vnBefore = this.vel.dot(up);
      const tangentVel = new THREE.Vector3()
        .addScaledVector(this.vel, 1)
        .addScaledVector(up, -vnBefore);
      tangentVel.lerp(wish.multiplyScalar(speed), k);
      this.vel.copy(tangentVel).addScaledVector(up, vnBefore);

      if (this.flying) {
        const vertical = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
        const vn = this.vel.dot(up);
        this.vel.addScaledVector(up, (vertical * 7.5 - vn) * k);
        this.onGround = false;
        this.moveWithCollisions(dt);
        this.syncCamera();
        return;
      }

      if (this.inWater) {
        // 水中：空格持续上浮，松开缓慢下沉
        const vn = this.vel.dot(up);
        const target = input.jump ? 3.6 : -1.8;
        this.vel.addScaledVector(up, (target - vn) * (1 - Math.exp(-6 * dt)));
      } else {
        if (input.jump && this.onGround) {
          this.vel.addScaledVector(up, JUMP_SPEED);
          this.onGround = false;
        }
        this.vel.addScaledVector(up, -GRAVITY * dt);

        // 径向限速，避免高速坠落导致穿模
        const vn = this.vel.dot(up);
        if (vn < -MAX_FALL_SPEED) {
          this.vel.addScaledVector(up, -MAX_FALL_SPEED - vn);
        }
      }

      // 记录落地前的径向速度，用于坠落伤害
      const impact = this.vel.dot(up);
      if (this.onGround) this.tryStepUp();
      this.onGround = false;
      this.moveWithCollisions(dt);

      if (this.onGround && impact < -12 && !this.inWater && typeof this.onLand === 'function') {
        this.onLand(impact);
      }

      // 掉出世界或飞出星球时回到复活点
      const toCenter = this._tmp.copy(this.pos).sub(this.center);
      if (this.pos.y < -8 || toCenter.length() > this.cfg.worldHeight * 0.95) {
        this.placeAt(this.spawnPoint);
      }

      this.syncCamera();
    }

    /**
     * 体素射线检测（Amanatides & Woo 步进算法）
     * @param {number} maxDistance 最大检测距离（方块）
     * @returns {{x:number,y:number,z:number,normal:number[]}|null} 命中信息
     */
    raycast(maxDistance) {
      const origin = this.camera.position;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

      let x = Math.floor(origin.x);
      let y = Math.floor(origin.y);
      let z = Math.floor(origin.z);

      const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
      const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
      const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

      const absX = Math.abs(dir.x);
      const absY = Math.abs(dir.y);
      const absZ = Math.abs(dir.z);

      const tDeltaX = stepX !== 0 ? 1 / absX : Infinity;
      const tDeltaY = stepY !== 0 ? 1 / absY : Infinity;
      const tDeltaZ = stepZ !== 0 ? 1 / absZ : Infinity;

      let tMaxX = stepX !== 0 ? (stepX > 0 ? x + 1 - origin.x : origin.x - x) / absX : Infinity;
      let tMaxY = stepY !== 0 ? (stepY > 0 ? y + 1 - origin.y : origin.y - y) / absY : Infinity;
      let tMaxZ = stepZ !== 0 ? (stepZ > 0 ? z + 1 - origin.z : origin.z - z) / absZ : Infinity;

      let t = 0;
      let normal = [0, 0, 0];

      while (t <= maxDistance) {
        const id = this.world.getBlock(x, y, z);
        if (id !== 0 && id !== Voxel.Blocks.ID.WATER) {
          return { x: x, y: y, z: z, normal: normal };
        }
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
          x += stepX;
          t = tMaxX;
          tMaxX += tDeltaX;
          normal = [-stepX, 0, 0];
        } else if (tMaxY < tMaxZ) {
          y += stepY;
          t = tMaxY;
          tMaxY += tDeltaY;
          normal = [0, -stepY, 0];
        } else {
          z += stepZ;
          t = tMaxZ;
          tMaxZ += tDeltaZ;
          normal = [0, 0, -stepZ];
        }
      }
      return null;
    }

    /**
     * 判断某个方块是否与玩家碰撞盒重叠（放置方块时用）
     * @param {number} bx 方块 x
     * @param {number} by 方块 y
     * @param {number} bz 方块 z
     * @returns {boolean} 是否重叠
     */
    intersectsBlock(bx, by, bz) {
      const minX = this.pos.x - HALF_WIDTH;
      const maxX = this.pos.x + HALF_WIDTH;
      const minY = this.pos.y;
      const maxY = this.pos.y + HEIGHT;
      const minZ = this.pos.z - HALF_WIDTH;
      const maxZ = this.pos.z + HALF_WIDTH;
      return (
        bx + 1 > minX && bx < maxX &&
        by + 1 > minY && by < maxY &&
        bz + 1 > minZ && bz < maxZ
      );
    }
  }

  Voxel.Player = Player;
  Voxel.PLAYER_SIZE = { HALF_WIDTH: HALF_WIDTH, HEIGHT: HEIGHT, EYE_HEIGHT: EYE_HEIGHT };
})(window.Voxel = window.Voxel || {});
