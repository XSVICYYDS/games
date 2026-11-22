/**
 * ui.js
 * 游戏 HUD、9 格快捷栏与 1001 方块背包。
 * 背包按 45 格分页渲染，避免一次创建大量 DOM；支持分类、中文名/编号搜索与详情预览。
 */
(function (Voxel) {
  'use strict';

  class UI {
    /**
     * @param {object} blocks Voxel.Blocks 方块注册表
     */
    constructor(blocks) {
      this.blocks = blocks;
      this.pageSize = blocks.PAGE_SIZE || 9;
      this.invPageSize = 45;
      this.page = 0;
      this.invPage = 0;
      this.selected = 0;
      this.category = '全部';
      this.query = '';
      this.filtered = [];
      this.invItems = [];
      this.slots = [];
      this.onPick = null;
      this.onClose = null;
      /** 交互面板关闭回调（由 main.js 设置） */
      this.onInteractClose = null;
      this.toastTimer = null;

      const ids = [
        'overlay', 'overlay-title', 'overlay-sub', 'loading', 'loading-bar', 'loading-text',
        'start-btn', 'error-box', 'hud-pos', 'hud-fps', 'hud-block', 'hotbar',
        'hotbar-name', 'hotbar-page', 'inventory', 'inventory-grid', 'inventory-search',
        'inventory-count', 'inventory-categories', 'inventory-prev', 'inventory-next',
        'inventory-page', 'inventory-close', 'inventory-equip', 'inventory-preview',
        'inventory-selected-name', 'inventory-selected-meta', 'inventory-selected-desc',
        'inventory-selected-stats', 'dig-progress', 'toast',
        'hud-mode', 'hud-time', 'hud-health', 'hud-dim', 'hud-biome', 'mode-select',
        'interact', 'interact-title', 'interact-desc', 'interact-resources',
        'interact-body', 'interact-actions', 'interact-close',
        'save-btn', 'load-btn', 'save-status',
        'hand-bar', 'hand-switch', 'hand-label', 'hand-durability', 'hand-arrows', 'bow-charge'
      ];
      this.el = {};
      ids.forEach((id) => {
        const key = id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
        this.el[key] = document.getElementById(id);
      });

      this.buildHotbar();
      this.buildInventory();

      // 交互面板：关闭按钮与点击遮罩都交回 main.js 处理（需要重新锁定鼠标）
      this.el.interactClose.addEventListener('click', () => {
        if (typeof this.onInteractClose === 'function') this.onInteractClose();
      });
      this.el.interact.addEventListener('click', (e) => {
        if (e.target === this.el.interact && typeof this.onInteractClose === 'function') {
          this.onInteractClose();
        }
      });
      this.setHealth(20, 20);
    }

    /**
     * 创建固定 9 格快捷栏，翻页时只更新图标而不重复创建节点
     */
    buildHotbar() {
      this.el.hotbar.innerHTML = '';
      for (let i = 0; i < this.pageSize; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = String(i + 1);
        slot.appendChild(img);
        slot.appendChild(num);
        this.el.hotbar.appendChild(slot);
        this.slots.push(slot);
      }
    }

    /**
     * 初始化背包的分类按钮、搜索框和分页按钮事件
     */
    buildInventory() {
      const categories = ['全部'].concat(this.blocks.CATEGORIES);
      this.el.inventoryCategories.innerHTML = '';
      categories.forEach((name) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-btn';
        const count = name === '全部' ? this.blocks.HOTBAR.length :
          this.blocks.HOTBAR.filter((id) => this.blocks.DEF[id].category === name).length;
        button.textContent = name + ' ' + count;
        button.dataset.category = name;
        button.addEventListener('click', () => {
          this.category = name;
          this.invPage = 0;
          this.renderInventory();
        });
        this.el.inventoryCategories.appendChild(button);
      });

      this.el.inventorySearch.addEventListener('input', (e) => {
        this.query = e.target.value.trim().toLowerCase();
        this.invPage = 0;
        this.renderInventory();
      });
      this.el.inventoryPrev.addEventListener('click', () => this.flipInventory(-1));
      this.el.inventoryNext.addEventListener('click', () => this.flipInventory(1));
      this.el.inventoryClose.addEventListener('click', () => {
        if (typeof this.onClose === 'function') this.onClose();
      });
      this.el.inventoryEquip.addEventListener('click', () => {
        if (typeof this.onClose === 'function') this.onClose();
      });
    }

    /**
     * 按当前分类和搜索词计算过滤后的完整方块下标列表
     * @returns {number[]} HOTBAR 下标数组
     */
    getFilteredIndices() {
      const query = this.query;
      const result = [];
      for (let index = 0; index < this.blocks.HOTBAR.length; index++) {
        const id = this.blocks.HOTBAR[index];
        const def = this.blocks.DEF[id];
        if (this.category !== '全部' && def.category !== this.category) continue;
        if (query) {
          const numeric = query.replace(/^#/, '');
          const official = (def.official || '').toLowerCase();
          const key = (def.key || '').toLowerCase();
          const match = def.name.toLowerCase().includes(query) ||
            official.includes(query) || key.includes(query) ||
            def.category.toLowerCase().includes(query) ||
            (def.tool || '').includes(query) ||
            String(id) === numeric;
          if (!match) continue;
        }
        result.push(index);
      }
      return result;
    }

    /**
     * 渲染当前背包页的 45 个方块格子及分页状态
     */
    renderInventory() {
      this.filtered = this.getFilteredIndices();
      const pageCount = Math.max(1, Math.ceil(this.filtered.length / this.invPageSize));
      this.invPage = Math.max(0, Math.min(this.invPage, pageCount - 1));
      const start = this.invPage * this.invPageSize;
      const visible = this.filtered.slice(start, start + this.invPageSize);
      const grid = this.el.inventoryGrid;
      grid.innerHTML = '';
      this.invItems = [];

      const fragment = document.createDocumentFragment();
      visible.forEach((index) => {
        const id = this.blocks.HOTBAR[index];
        const def = this.blocks.DEF[id];
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'inv-item';
        item.dataset.index = String(index);
        item.title = '#' + String(id).padStart(3, '0') + ' ' + def.name;

        const number = document.createElement('span');
        number.className = 'inv-id';
        number.textContent = String(id).padStart(3, '0');
        const img = document.createElement('img');
        img.src = this.blocks.getIconDataURL(def.tiles.side);
        img.alt = def.name;
        img.draggable = false;
        const label = document.createElement('span');
        label.className = 'inv-label';
        label.textContent = def.name;

        item.appendChild(number);
        item.appendChild(img);
        item.appendChild(label);
        // 发光方块在格子左上角显示一个小亮点，方便快速识别灯具与矿物
        if (def.light > 0) {
          const badge = document.createElement('span');
          badge.className = 'inv-glow-dot';
          badge.title = '发光亮度 ' + def.light;
          item.appendChild(badge);
        }
        item.addEventListener('click', () => {
          if (typeof this.onPick === 'function') this.onPick(index);
          this.updateInventorySelection();
        });
        item.addEventListener('dblclick', () => {
          if (typeof this.onClose === 'function') this.onClose();
        });
        fragment.appendChild(item);
        this.invItems.push(item);
      });

      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'inv-empty';
        empty.textContent = '没有匹配的方块，请更换分类或搜索词';
        fragment.appendChild(empty);
      }
      grid.appendChild(fragment);

      this.el.inventoryCount.textContent = '找到 ' + this.filtered.length + ' 种';
      this.el.inventoryPage.textContent = '第 ' + (this.invPage + 1) + ' / ' + pageCount + ' 页';
      this.el.inventoryPrev.disabled = this.invPage <= 0;
      this.el.inventoryNext.disabled = this.invPage >= pageCount - 1;
      Array.from(this.el.inventoryCategories.children).forEach((button) => {
        button.classList.toggle('active', button.dataset.category === this.category);
      });
      this.updateInventorySelection();
    }

    /**
     * 背包向前或向后翻页
     * @param {number} direction +1 下一页，-1 上一页
     */
    flipInventory(direction) {
      const pageCount = Math.max(1, Math.ceil(this.filtered.length / this.invPageSize));
      const next = Math.max(0, Math.min(this.invPage + direction, pageCount - 1));
      if (next === this.invPage) return;
      this.invPage = next;
      this.renderInventory();
      this.el.inventoryGrid.scrollTop = 0;
    }

    /**
     * 根据方块硬度推算徒手挖掘耗时（与 main.js 的规则保持一致）
     * @param {object} def 方块定义
     * @returns {number} 秒数；不可破坏返回 Infinity
     */
    digSeconds(def) {
      if (!def.breakable) return Infinity;
      return Math.min(2.6, 0.12 + Math.max(0, def.hardness || 0) * 0.22);
    }

    /**
     * 生成详情区的属性标签文本
     * @param {object} def 方块定义
     * @returns {string[]} 标签文本列表
     */
    buildStats(def) {
      const stats = [];
      if (def.breakable) {
        stats.push('硬度 ' + (def.hardness === undefined ? 1 : def.hardness));
        stats.push('徒手 ' + this.digSeconds(def).toFixed(2).replace(/0$/, '') + ' 秒');
        stats.push('工具 ' + def.tool);
      } else {
        stats.push('不可破坏');
      }
      if (def.light > 0) stats.push('发光 ' + def.light);
      stats.push(def.transparentInfo ? '透明' : '不透明');
      if (def.official && def.official !== def.name) stats.push('官方名 ' + def.official);
      return stats;
    }

    /**
     * 根据方块属性生成背包详情说明
     * @param {object} def 方块定义
     * @returns {string} 简短说明
     */
    describeBlock(def) {
      if (def.liquid) return '半透明液体 · 可进入游泳 · 不可直接挖掘';
      if (!def.breakable) return '世界边界方块 · 坚不可摧';
      if (def.id === this.blocks.ID.TNT) return '右键点燃 · 延时爆炸 · 可连锁引爆';
      if (def.id === this.blocks.ID.REDSTONE) return '右键激活/熄灭 · 相邻红石最多联动 12 格';
      if (def.toggleable) return '可切换功能器件 · 右键切换熄灭/激活纹理';
      if (def.light > 0) return '自发光方块 · 发出亮度 ' + def.light + ' 的光 · 可放置可挖掘';
      if (def.layer === 'glass') return '半透明固体 · 可放置 · 可挖掘';
      if (def.drops) return '矿物方块 · 挖掘显示掉落：' + def.drops.map(function (d) { return d.name + ' ×' + d.count; }).join('，');
      return (def.solid ? '固体方块' : '非阻挡方块') + ' · 可放置 · 可挖掘';
    }

    /**
     * 设置准星下方的挖掘进度条
     * @param {number} value 进度 0~1
     * @param {boolean} visible 是否显示
     */
    setDigProgress(value, visible) {
      const bar = this.el.digProgress;
      if (!bar) return;
      bar.classList.toggle('visible', !!visible);
      const fill = bar.firstElementChild;
      if (fill) fill.style.width = Math.round(Math.min(1, Math.max(0, value)) * 100) + '%';
    }

    /**
     * 更新背包右侧的当前选中方块预览与属性
     */
    updateInventorySelection() {
      const id = this.blocks.HOTBAR[this.selected];
      const def = this.blocks.DEF[id];
      if (!def) return;
      this.el.inventoryPreview.src = this.blocks.getIconDataURL(def.tiles.side);
      this.el.inventoryPreview.alt = def.name;
      this.el.inventorySelectedName.textContent = def.name;
      this.el.inventorySelectedMeta.textContent = '#' + String(id).padStart(4, '0') + ' · ' + def.category +
        (def.key ? ' · ' + def.key : '');
      this.el.inventorySelectedDesc.textContent = this.describeBlock(def);
      if (this.el.inventorySelectedStats) {
        this.el.inventorySelectedStats.innerHTML = '';
        this.buildStats(def).forEach((text) => {
          const chip = document.createElement('span');
          chip.className = 'inv-stat';
          chip.textContent = text;
          this.el.inventorySelectedStats.appendChild(chip);
        });
      }
      this.invItems.forEach((item) => {
        item.classList.toggle('active', Number(item.dataset.index) === this.selected);
      });
    }

    /**
     * 刷新快捷栏当前 9 格及选中高亮
     * @param {number} index 完整方块下标 0~359
     */
    renderPage(index) {
      const total = this.blocks.HOTBAR.length;
      const page = Math.floor(index / this.pageSize);
      const pageCount = Math.ceil(total / this.pageSize);
      const start = page * this.pageSize;
      this.page = page;

      this.slots.forEach((slot, i) => {
        const full = start + i;
        const img = slot.querySelector('img');
        if (full >= total) {
          slot.style.visibility = 'hidden';
          slot.classList.remove('active');
          return;
        }
        const def = this.blocks.DEF[this.blocks.HOTBAR[full]];
        slot.style.visibility = 'visible';
        img.src = this.blocks.getIconDataURL(def.tiles.side);
        img.alt = def.name;
        slot.title = def.name + '（数字键 ' + (i + 1) + '）';
        slot.classList.toggle('active', full === index);
      });

      const id = this.blocks.HOTBAR[index];
      const def = this.blocks.DEF[id];
      const number = String(id).padStart(3, '0');
      this.el.hudBlock.textContent = '#' + number + ' ' + def.name;
      this.el.hotbarName.textContent = def.name + ' · ' + def.category;
      const mobile = document.body.classList.contains('mobile-mode');
      this.el.hotbarPage.textContent = number + ' / ' + total + ' · 第 ' + (page + 1) + ' / ' + pageCount +
        (mobile ? ' 页 · 点按选择 · 点这里翻页' : ' 页 · Tab 翻页 · E 全部方块');
      this.updateInventorySelection();
    }

    /**
     * 设置当前选中方块
     * @param {number} index 完整方块下标
     */
    setSelected(index) {
      this.selected = index;
      this.renderPage(index);
    }

    /**
     * 以武器模式刷新 9 格快捷栏：低耐久显示红条，弓显示箭矢数
     * @param {Array<object>} items 武器定义列表
     * @param {number} index 当前选中的武器下标
     */
    renderItems(items, index) {
      const total = items.length;
      const page = Math.floor(index / this.pageSize);
      const pageCount = Math.ceil(total / this.pageSize);
      const start = page * this.pageSize;
      this.page = page;

      this.slots.forEach((slot, i) => {
        const full = start + i;
        const img = slot.querySelector('img');
        const num = slot.querySelector('.num');
        const oldBar = slot.querySelector('.dur-bar');
        if (oldBar) oldBar.remove();
        if (full >= total) {
          slot.style.visibility = 'hidden';
          slot.classList.remove('active');
          return;
        }
        const def = items[full];
        slot.style.visibility = 'visible';
        img.src = def.icon;
        img.alt = def.name;
        slot.title = def.name + '（数字键 ' + (i + 1) + '）';
        slot.classList.toggle('active', full === index);
        if (num) num.textContent = String(i + 1);
        // 武器耐久不足 35% 时在格子底部显示红色耐久条
        const ratio = def.durability > 0 ? (this.durability ? this.durability(def.key) : 1) : 1;
        if (def.durability && ratio < 0.35) {
          const bar = document.createElement('span');
          bar.className = 'dur-bar';
          bar.style.width = Math.max(8, Math.round(ratio * 100)) + '%';
          slot.appendChild(bar);
        }
      });

      const def = items[index];
      const pageCountSafe = Math.max(1, pageCount);
      this.el.hotbarName.textContent = def.name + ' · ' + (def.kind === 'bow' ? '远程' : def.kind === 'axe' ? '斧' : '剑');
      this.el.hotbarPage.textContent = '武器 ' + (index + 1) + ' / ' + total +
        ' · 第 ' + (page + 1) + ' / ' + pageCountSafe + ' 页 · Q 切回方块';
      this.el.hudBlock.textContent = def.name + ' · 伤害 ' + def.damage;
    }

    /**
     * 切换快捷栏的方块 / 武器模式外观
     * @param {'block'|'item'} mode 当前手持模式
     */
    setHandMode(mode) {
      const itemMode = mode === 'item';
      document.body.classList.toggle('item-mode', itemMode);
      if (this.el.handSwitch) {
        this.el.handSwitch.textContent = itemMode ? '武器模式' : '方块模式';
        this.el.handSwitch.classList.toggle('item', itemMode);
      }
      if (this.el.handArrows) this.el.handArrows.hidden = !itemMode;
    }

    /**
     * 更新手持信息：名称、耐久与箭矢数量
     * @param {{label:string,durability:number,maxDurability:number,arrows:number,itemMode:boolean}} info 手持状态
     */
    setHandStatus(info) {
      if (this.el.handLabel) this.el.handLabel.textContent = info.label;
      if (this.el.handDurability) {
        if (info.maxDurability > 0) {
          const ratio = Math.max(0, info.durability / info.maxDurability);
          this.el.handDurability.hidden = false;
          this.el.handDurability.firstElementChild.style.width = Math.round(ratio * 100) + '%';
          this.el.handDurability.dataset.level = ratio > 0.5 ? 'ok' : ratio > 0.2 ? 'warn' : 'low';
          this.el.handDurability.title = '耐久 ' + info.durability + ' / ' + info.maxDurability;
        } else {
          this.el.handDurability.hidden = true;
        }
      }
      if (this.el.handArrows) {
        this.el.handArrows.textContent = '箭 ' + info.arrows;
        this.el.handArrows.hidden = !info.itemMode;
      }
    }

    /**
     * 更新弓的蓄力条
     * @param {number} ratio 0~1 的蓄力比例
     * @param {boolean} visible 是否显示
     */
    setBowCharge(ratio, visible) {
      if (!this.el.bowCharge) return;
      this.el.bowCharge.classList.toggle('visible', !!visible);
      this.el.bowCharge.classList.toggle('full', ratio >= 0.999);
      this.el.bowCharge.firstElementChild.style.width = Math.round(ratio * 100) + '%';
    }

    /**
     * 打开背包，并尽量把当前方块定位到可见页
     */
    showInventory() {
      const filtered = this.getFilteredIndices();
      const position = filtered.indexOf(this.selected);
      if (position >= 0) this.invPage = Math.floor(position / this.invPageSize);
      this.renderInventory();
      this.el.inventory.classList.add('visible');
    }

    /** 隐藏背包面板 */
    hideInventory() {
      this.el.inventory.classList.remove('visible');
      this.el.inventorySearch.blur();
    }

    /**
     * 更新加载进度
     * @param {number} ratio 0~1
     * @param {string} text 进度文本
     */
    setProgress(ratio, text) {
      this.el.loadingBar.style.width = Math.round(ratio * 100) + '%';
      if (text) this.el.loadingText.textContent = text;
    }

    /** 世界加载完成后启用开始按钮 */
    setReady() {
      this.el.loading.classList.add('done');
      this.el.startBtn.disabled = false;
      this.el.startBtn.textContent = '进入方块世界';
    }

    /** 显示暂停遮罩 */
    showPaused() {
      const mobile = document.body.classList.contains('mobile-mode');
      this.el.overlayTitle.textContent = '已暂停';
      this.el.overlaySub.textContent = mobile ? '点击下方按钮继续，右侧滑动转动视角' : '鼠标已释放，点击下方按钮继续建造';
      this.el.startBtn.textContent = '继续游戏';
      this.el.startBtn.disabled = false;
      this.el.overlay.classList.remove('hidden');
      document.body.classList.remove('playing');
    }

    /**
     * 显示维度穿越 / 读档的加载遮罩
     * @param {string} title 标题
     * @param {string} sub 副标题
     */
    showTravel(title, sub) {
      this.el.overlayTitle.textContent = title;
      this.el.overlaySub.textContent = sub;
      this.el.loading.classList.remove('done');
      this.el.loadingBar.style.width = '0%';
      this.el.loadingText.textContent = '正在构建星球表面…';
      this.el.startBtn.disabled = true;
      this.el.startBtn.textContent = '正在穿越…';
      this.el.overlay.classList.remove('hidden');
      document.body.classList.remove('playing');
    }

    /**
     * 更新穿越进度
     * @param {number} ratio 0~1
     * @param {string} text 进度文本
     */
    setTravelProgress(ratio, text) {
      this.el.loadingBar.style.width = Math.round(ratio * 100) + '%';
      if (text) this.el.loadingText.textContent = text;
    }

    /** 结束穿越加载状态 */
    hideTravel() {
      this.el.loading.classList.add('done');
      this.el.loadingBar.style.width = '100%';
      this.el.startBtn.disabled = false;
    }

    /**
     * 更新 HUD 的维度与群系标签
     * @param {string} name 维度中文名
     * @param {string} key 维度键
     */
    setDimension(name, key) {
      if (this.el.hudDim) {
        this.el.hudDim.textContent = name;
        this.el.hudDim.dataset.dimension = key;
      }
    }

    /**
     * 更新 HUD 的群系名称
     * @param {string} name 群系中文名
     */
    setBiome(name) {
      if (this.el.hudBiome) this.el.hudBiome.textContent = name;
    }

    /** 隐藏遮罩并显示游戏 HUD */
    hideOverlay() {
      this.el.overlay.classList.add('hidden');
      document.body.classList.add('playing');
    }

    /**
     * 显示启动或指针锁定错误
     * @param {string} message 错误文本
     */
    setError(message) {
      this.el.errorBox.hidden = false;
      this.el.errorBox.textContent = message;
    }

    /**
     * 更新 HUD 中的游戏模式与生命显示
     * @param {string} mode 模式键：survival/creative/adventure/spectator
     * @param {string} name 模式中文名
     */
    setMode(mode, name) {
      if (this.el.hudMode) {
        this.el.hudMode.textContent = name + '模式';
        this.el.hudMode.dataset.mode = mode;
      }
      if (this.el.hudHealth) {
        // 创造与旁观模式不显示生命值
        this.el.hudHealth.style.display = (mode === 'creative' || mode === 'spectator') ? 'none' : 'flex';
      }
    }

    /**
     * 渲染 10 颗心形生命值（每颗心代表 2 点）
     * @param {number} hp 当前生命
     * @param {number} max 最大生命
     */
    setHealth(hp, max) {
      if (!this.el.hudHealth) return;
      const total = 10;
      const filled = Math.max(0, Math.min(total, Math.ceil((hp / (max || 20)) * total)));
      let html = '';
      for (let i = 0; i < total; i++) {
        html += '<span class="heart' + (i < filled ? '' : ' empty') + '">♥</span>';
      }
      this.el.hudHealth.innerHTML = html;
      this.el.hudHealth.classList.toggle('low', hp <= 6);
    }

    /**
     * 更新 HUD 顶部的时间与昼夜状态
     * @param {string} text 时间文本，如 “06:00 · 白天”
     * @param {boolean} night 是否夜晚
     */
    setTime(text, night) {
      if (!this.el.hudTime) return;
      this.el.hudTime.textContent = text;
      this.el.hudTime.classList.toggle('night', !!night);
    }

    /**
     * 渲染随身物资标签
     * @param {object} pouch 物资名 -> 数量
     */
    setPouch(pouch) {
      const box = this.el.interactResources;
      if (!box) return;
      box.innerHTML = '';
      const names = Object.keys(pouch || {}).filter(function (key) {
        return pouch[key] > 0;
      });
      if (names.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'pouch-empty';
        empty.textContent = '随身物资为空 · 挖掘方块与搜刮箱子可获得物资';
        box.appendChild(empty);
        return;
      }
      names.forEach(function (name) {
        const chip = document.createElement('span');
        chip.className = 'pouch-chip';
        chip.textContent = name + ' ' + pouch[name];
        box.appendChild(chip);
      });
    }

    /**
     * 打开交互面板
     * @param {object} config { title, desc, lines, buttons, pouch }
     */
    showInteract(config) {
      if (!this.el.interact) return;
      const cfg = config || {};
      this.el.interactTitle.textContent = cfg.title || '交互';
      this.el.interactDesc.textContent = cfg.desc || '';
      this.setPouch(cfg.pouch || {});

      const body = this.el.interactBody;
      body.innerHTML = '';
      (cfg.lines || []).forEach(function (line) {
        const row = document.createElement('div');
        row.className = 'interact-line';
        row.textContent = line;
        body.appendChild(row);
      });

      const actions = this.el.interactActions;
      actions.innerHTML = '';
      (cfg.buttons || []).forEach(function (btn) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'interact-btn' + (btn.primary ? ' primary' : '');
        button.textContent = btn.label;
        if (btn.disabled) button.disabled = true;
        if (typeof btn.onClick === 'function') {
          button.addEventListener('click', btn.onClick);
        }
        actions.appendChild(button);
      });

      this.el.interact.classList.add('visible');
    }

    /** 关闭交互面板 */
    hideInteract() {
      if (this.el.interact) this.el.interact.classList.remove('visible');
    }

    /**
     * 更新坐标与帧率 HUD
     * @param {{x:number,y:number,z:number}} pos 玩家坐标
     * @param {number} fps 帧率
     * @param {number} faces 渲染面数
     * @param {object} [extra] 模式、时间与生命信息
     */
    updateHud(pos, fps, faces, extra) {
      this.el.hudPos.textContent = 'X ' + pos.x.toFixed(1) + '  Y ' + pos.y.toFixed(1) + '  Z ' + pos.z.toFixed(1);
      this.el.hudFps.textContent = 'FPS ' + fps.toFixed(0) + ' · 面 ' + (faces / 1000).toFixed(0) + 'k';
      if (extra) {
        if (typeof extra.health === 'number') this.setHealth(extra.health, extra.maxHealth || 20);
        if (extra.time) this.setTime(extra.time, extra.night);
        if (extra.dimension) this.setDimension(extra.dimension, extra.dimensionKey || '');
        if (extra.biome) this.setBiome(extra.biome);
      }
    }

    /**
     * 显示短时浮动提示
     * @param {string} message 提示内容
     */
    toast(message) {
      const el = this.el.toast;
      el.textContent = message;
      el.classList.add('show');
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
    }
  }

  Voxel.UI = UI;
})(window.Voxel = window.Voxel || {});
