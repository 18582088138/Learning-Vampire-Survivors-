(() => {
  "use strict";

  const data = window.CATALOG_DATA;
  const PAGE_SIZE = 60;
  const numberFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 });

  const el = {
    shell: document.getElementById("app-shell"),
    sidebar: document.getElementById("sidebar"),
    sidebarBackdrop: document.getElementById("sidebar-backdrop"),
    menuButton: document.getElementById("menu-button"),
    catalogView: document.getElementById("catalog-view"),
    notesView: document.getElementById("notes-view"),
    title: document.getElementById("page-title"),
    subtitle: document.getElementById("page-subtitle"),
    search: document.getElementById("global-search"),
    searchField: document.querySelector(".search-field"),
    category: document.getElementById("category-filter"),
    sort: document.getElementById("sort-order"),
    reset: document.getElementById("reset-filters"),
    emptyReset: document.getElementById("empty-reset"),
    topCsv: document.getElementById("top-csv"),
    titleCsv: document.getElementById("title-csv"),
    visibleCount: document.getElementById("visible-count"),
    thirdMetricLabel: document.getElementById("third-metric-label"),
    thirdMetric: document.getElementById("third-metric"),
    rangeLabel: document.getElementById("range-label"),
    grid: document.getElementById("result-grid"),
    empty: document.getElementById("empty-state"),
    loadMore: document.getElementById("load-more"),
    detail: document.getElementById("detail-panel"),
    detailContent: document.getElementById("detail-content"),
    detailBackdrop: document.getElementById("detail-backdrop"),
    closeDetail: document.getElementById("close-detail"),
  };

  const viewConfig = {
    weapons: {
      title: "武器与强化",
      csv: "weapons.csv",
      categories: [
        ["all", "全部类型"],
        ["weapon", "非进化武器"],
        ["powerup", "被动强化"],
        ["evolution", "进化类型"],
        ["specialOnly", "特殊获取"],
        ["alwaysHidden", "永久隐藏"],
        ["unlocked", "配置已解锁"],
        ["locked", "配置未解锁"],
      ],
      sorts: [
        ["original", "原始数据顺序"], ["name", "名称 A–Z"],
        ["power", "Power 从高到低"], ["interval", "攻击间隔从短到长"],
        ["rarity", "稀有度从低到高"],
      ],
    },
    enemies: {
      title: "怪物图鉴",
      csv: "enemies.csv",
      categories: [
        ["all", "全部怪物"], ["bestiary", "图鉴收录"], ["bossId", "BOSS 前缀 ID"],
        ["skills", "声明技能"], ["resistances", "声明抗性"],
        ["passThroughWalls", "可穿墙"], ["highlight", "图鉴高亮"],
      ],
      sorts: [
        ["original", "原始数据顺序"], ["name", "名称 A–Z"],
        ["maxHp", "Max HP 从高到低"], ["power", "Power 从高到低"],
        ["xp", "XP 从高到低"], ["bestiaryIndex", "图鉴顺序"],
      ],
    },
  };

  const categoryNames = { weapon: "武器", powerup: "被动强化", evolution: "进化" };
  const weaponFields = [
    ["level", "等级"], ["interval", "攻击间隔（ms）"], ["cooldown", "Cooldown"],
    ["duration", "持续时间（ms）"], ["repeatInterval", "重复间隔（ms）"],
    ["power", "Power"], ["secondaryPower", "Secondary power"], ["area", "Area"],
    ["speed", "Speed"], ["amount", "Amount"], ["penetrating", "穿透"],
    ["critChance", "暴击率（原始值）"], ["critMul", "暴击倍率"], ["knockback", "击退"],
    ["hitBoxDelay", "命中盒延迟（ms）"], ["rarity", "稀有度权重"], ["poolLimit", "弹道池上限"],
    ["charges", "充能"], ["hitsWalls", "命中墙体"], ["price", "价格"],
    ["maxHp", "Max HP 修正"], ["moveSpeed", "移速修正"], ["growth", "成长修正"],
    ["magnet", "磁吸修正"], ["luck", "幸运修正"], ["armor", "护甲修正"],
    ["greed", "贪婪修正"], ["regen", "恢复修正"], ["revivals", "复活修正"],
    ["rerolls", "重抽修正"], ["skips", "跳过修正"], ["curse", "诅咒修正"],
    ["fever", "Fever 修正"], ["invulTimeBonus", "无敌时间修正"],
  ];
  const enemyFields = [
    ["level", "等级"], ["maxHp", "Max HP"], ["speed", "Speed"], ["maxSpeed", "Max speed"],
    ["power", "Power"], ["xp", "XP"], ["shieldDuration", "护盾时长"],
    ["knockback", "击退"], ["maxKnockback", "最大击退"], ["deathKB", "死亡击退"],
    ["killedAmount", "击杀计数"], ["scale", "缩放"], ["alpha", "透明度"],
    ["idleFrameCount", "待机动画帧数"], ["passThroughWalls", "可穿墙"],
    ["patrolDuration", "巡逻时长"], ["feverValue", "Fever 值"], ["moreX", "More X"], ["moreY", "More Y"],
  ];
  const growthFields = [
    ["level", "Lv"], ["interval", "间隔 ms"], ["power", "Power"], ["area", "Area"],
    ["speed", "Speed"], ["amount", "数量"], ["duration", "持续 ms"],
    ["critChance", "暴击"], ["rarity", "稀有度"],
  ];

  const state = { view: "weapons", search: "", category: "all", sort: "original", visible: PAGE_SIZE, selectedId: null, level: null };

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function display(value) {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "number") return Number.isFinite(value) ? numberFormat.format(value) : String(value);
    if (Array.isArray(value)) return value.length ? value.map(display).join("、") : "—";
    if (typeof value === "object") return escapeHtml(JSON.stringify(value));
    return escapeHtml(value);
  }

  function cardTime(value) {
    if (value === undefined || value === null) return "—";
    if (Math.abs(value) >= 1000 && Math.abs(value) < 1000000) return `${numberFormat.format(value / 1000)} s`;
    return `${display(value)} ms`;
  }

  function firstLevel(item) { return item.levels[0] || {}; }
  function effectiveLevels(item) {
    let current = {};
    return item.levels.map((patch, index) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        const previous = current[key];
        next[key] = typeof value === "number" && typeof previous === "number" ? previous + value : value;
      }
      next.level = index + 1;
      current = next;
      return current;
    });
  }
  function currentItem() { return (data[state.view] || []).find(item => item.id === state.selectedId) || null; }
  function isMobileDetail() { return window.matchMedia("(max-width: 1100px)").matches; }

  function itemSearchText(item) {
    const extra = state.view === "weapons"
      ? [item.tips, item.evoInto, ...(item.evolvesFrom || []), ...(item.requires || []), ...(item.evoSynergy || []), ...(item.tags || [])]
      : [item.texture, ...(item.places || []), ...(item.variants || []), ...(item.skills || []), ...Object.keys(item.resistances || {})];
    return [item.id, item.name, item.description, ...extra].join(" ").toLowerCase();
  }

  function filteredItems() {
    const query = state.search.trim().toLowerCase();
    const items = data[state.view].filter(item => {
      if (query && !itemSearchText(item).includes(query)) return false;
      if (state.category === "all") return true;
      if (state.view === "weapons") {
        if (["weapon", "powerup", "evolution"].includes(state.category)) return item.category === state.category;
        if (state.category === "specialOnly") return item.specialOnly;
        if (state.category === "alwaysHidden") return item.alwaysHidden;
        if (state.category === "unlocked") return item.isUnlocked === true;
        if (state.category === "locked") return item.isUnlocked === false;
      } else {
        if (state.category === "bestiary") return item.bestiaryIncluded;
        if (state.category === "bossId") return item.bossId;
        if (state.category === "skills") return item.skills.length > 0;
        if (state.category === "resistances") return Object.keys(item.resistances).length > 0;
        if (state.category === "passThroughWalls") return firstLevel(item).passThroughWalls === true;
        if (state.category === "highlight") return item.highlight;
      }
      return true;
    });
    const sorted = items.map((item, index) => ({ item, index }));
    const firstNumber = (item, key) => {
      const value = firstLevel(item)[key];
      return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
    };
    sorted.sort((a, b) => {
      if (state.sort === "name") return a.item.name.localeCompare(b.item.name, "en");
      if (state.sort === "power") return firstNumber(b.item, "power") - firstNumber(a.item, "power") || a.index - b.index;
      if (state.sort === "interval") return firstNumber(a.item, "interval") - firstNumber(b.item, "interval") || a.index - b.index;
      if (state.sort === "rarity") return firstNumber(a.item, "rarity") - firstNumber(b.item, "rarity") || a.index - b.index;
      if (state.sort === "maxHp") return firstNumber(b.item, "maxHp") - firstNumber(a.item, "maxHp") || a.index - b.index;
      if (state.sort === "xp") return firstNumber(b.item, "xp") - firstNumber(a.item, "xp") || a.index - b.index;
      if (state.sort === "bestiaryIndex") return (a.item.bestiaryIndex ?? Number.POSITIVE_INFINITY) - (b.item.bestiaryIndex ?? Number.POSITIVE_INFINITY) || a.index - b.index;
      return a.index - b.index;
    });
    return sorted.map(entry => entry.item);
  }

  function populateSelect(select, options, value) {
    select.innerHTML = options.map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join("");
    select.value = value;
  }

  function render() {
    const isNotes = state.view === "notes";
    el.catalogView.hidden = isNotes;
    el.notesView.hidden = !isNotes;
    el.searchField.hidden = isNotes;
    el.topCsv.hidden = isNotes;
    document.querySelectorAll("[data-view]").forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (isNotes) {
      document.title = "数据说明 · VS 数据图鉴";
      closeDetail();
      return;
    }

    const config = viewConfig[state.view];
    document.title = `${config.title} · VS 数据图鉴`;
    el.title.textContent = config.title;
    el.topCsv.href = config.csv;
    el.titleCsv.href = config.csv;
    el.subtitle.textContent = state.view === "weapons"
      ? `${data.counts.weapons} 个类型，${data.counts.weaponLevels} 条等级配置，全部附带原始 Sprite。`
      : `${data.counts.enemies} 个类型，${data.counts.bestiaryIncluded} 个图鉴收录条目，全部附带原始 Sprite。`;
    populateSelect(el.category, config.categories, state.category);
    populateSelect(el.sort, config.sorts, state.sort);

    const items = filteredItems();
    if (!items.some(item => item.id === state.selectedId)) {
      state.selectedId = items[0]?.id || null;
      state.level = items[0] ? firstLevel(items[0]).level ?? 1 : null;
    }
    el.visibleCount.textContent = numberFormat.format(items.length);
    el.thirdMetricLabel.textContent = state.view === "weapons" ? "等级配置" : "图鉴收录";
    el.thirdMetric.textContent = numberFormat.format(state.view === "weapons"
      ? items.reduce((sum, item) => sum + item.levelCount, 0)
      : items.filter(item => item.bestiaryIncluded).length);
    renderList(items);
    renderDetail();
  }

  function cardStat(item) {
    const level = firstLevel(item);
    if (state.view === "weapons") {
      return `${categoryNames[item.category]} · ${item.levelCount} 级 · Power ${display(level.power)} · ${cardTime(level.interval)}`;
    }
    return `HP ${display(level.maxHp)} · Power ${display(level.power)} · XP ${display(level.xp)}`;
  }

  function renderList(items) {
    const shown = items.slice(0, state.visible);
    el.grid.innerHTML = shown.map(item => `
      <button class="item-card${item.id === state.selectedId ? " is-selected" : ""}" type="button" data-item-id="${escapeHtml(item.id)}" aria-label="查看 ${escapeHtml(item.name)} ${escapeHtml(item.id)}">
        <img class="item-image" src="${escapeHtml(item.image)}" alt="" width="56" height="56" loading="lazy">
        <span class="item-copy">
          <span class="item-name">${escapeHtml(item.name)}</span>
          <span class="item-id">${escapeHtml(item.id)}</span>
          <span class="item-stat">${cardStat(item)}</span>
        </span>
      </button>`).join("");
    el.empty.hidden = items.length > 0;
    el.grid.hidden = items.length === 0;
    el.rangeLabel.textContent = items.length ? `显示 1–${shown.length}，共 ${items.length} 项` : "0 项";
    el.loadMore.hidden = items.length <= shown.length || items.length === 0;
    el.loadMore.textContent = `显示更多（剩余 ${Math.max(0, items.length - shown.length)} 项）`;
  }

  function badges(item) {
    const values = [];
    if (state.view === "weapons") {
      values.push([categoryNames[item.category], true]);
      if (item.specialOnly) values.push(["特殊获取", false]);
      if (item.alwaysHidden) values.push(["永久隐藏", false]);
      if (item.isUnlocked === true) values.push(["配置已解锁", false]);
      if (item.isUnlocked === false) values.push(["配置未解锁", false]);
    } else {
      if (item.bossId) values.push(["BOSS 前缀", true]);
      values.push([item.bestiaryIncluded ? "图鉴收录" : "未收录图鉴", false]);
      if (item.highlight) values.push(["图鉴高亮", false]);
      if (firstLevel(item).passThroughWalls) values.push(["可穿墙", false]);
    }
    return values.map(([label, accent]) => `<span class="badge${accent ? " is-accent" : ""}">${escapeHtml(label)}</span>`).join("");
  }

  function statRows(level, fields, previous = null, raw = false) {
    return fields.map(([key, label]) => {
      if (!(key in level) && !raw) return "";
      const changed = previous && JSON.stringify(previous[key]) !== JSON.stringify(level[key]);
      return `<div class="stat-row${changed ? " is-changed" : ""}">
        <span class="stat-label">${escapeHtml(label)}</span>
        <span class="stat-value">${display(level[key])}</span>
      </div>`;
    }).join("");
  }

  function relatedButtons(ids, type) {
    if (!ids || !ids.length) return "<span class=\"stat-label\">—</span>";
    if (type === "stages") return `<div class="related-list">${ids.filter(Boolean).map(id => `<span class="badge">${escapeHtml(id)}</span>`).join("")}</div>`;
    return `<div class="related-list">${ids.filter(Boolean).map(id => `<button class="related-button" type="button" data-related-type="${type}" data-related-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join("")}</div>`;
  }

  function relationSection(title, ids, type) {
    return `<section class="detail-section"><h3>${escapeHtml(title)}</h3>${relatedButtons(ids, type)}</section>`;
  }

  function weaponDetail(item) {
    const effective = effectiveLevels(item);
    if (state.level === null || !effective.some(level => level.level === state.level)) state.level = effective[0]?.level ?? 1;
    const index = Math.max(0, effective.findIndex(level => level.level === state.level));
    const level = effective[index] || firstLevel(item);
    const previous = index > 0 ? effective[index - 1] : null;
    const rawLevel = item.levels[index] || {};
    const rawPrevious = index > 0 ? item.levels[index - 1] : null;
    const levelOptions = effective.map(entry => `<option value="${entry.level}"${entry.level === level.level ? " selected" : ""}>等级 ${entry.level}</option>`).join("");
    const growth = `<div class="table-responsive"><table><thead><tr>${growthFields.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${effective.map(entry => `<tr>${growthFields.map(([key]) => `<td>${display(entry[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return `
      <section class="detail-section">
        <label class="level-control">查看等级
          <select id="detail-level">${levelOptions}</select>
        </label>
        <p class="detail-tips">后续等级是升级补丁：数值字段逐级累加，非数值字段替换；面板与成长表已按此规则合并。</p>
      </section>
      <section class="detail-section"><h3>当前等级累计生效数值</h3>
        <div class="stat-list">${statRows(level, weaponFields, previous) || "<p class=\"detail-tips\">该等级没有核心数值字段，完整配置见下方。</p>"}</div>
        ${previous ? "<p class=\"detail-tips\">强调色表示与上一等级不同。</p>" : ""}
      </section>
      <section class="detail-section"><h3>逐等级成长（累计）</h3>${growth}</section>
      ${relationSection("进化目标", item.evoInto ? [item.evoInto] : [], "weapons")}
      ${relationSection("进化来源", item.evolvesFrom, "weapons")}
      ${relationSection("所需装备", item.requires, "weapons")}
      ${relationSection("满级需求", item.requiresMax, "weapons")}
      ${relationSection("进化协同", item.evoSynergy, "weapons")}
      <section class="detail-section"><h3>资源与标签</h3><div class="stat-list">
        <div class="stat-row"><span class="stat-label">图集</span><span class="stat-value">${display(item.texture)}</span></div>
        <div class="stat-row"><span class="stat-label">帧名</span><span class="stat-value">${display(item.frameName)}</span></div>
        <div class="stat-row"><span class="stat-label">标签</span><span class="stat-value">${display(item.tags)}</span></div>
      </div></section>
      <details class="detail-section raw-details"><summary>本级原始补丁字段</summary>
        <div class="stat-list">${statRows(rawLevel, Object.keys(rawLevel).map(key => [key, key]), rawPrevious, true)}</div>
      </details>`;
  }

  function enemyDetail(item) {
    const level = firstLevel(item);
    const resistances = Object.entries(item.resistances);
    return `
      <section class="detail-section"><h3>基础数值</h3>
        <div class="stat-list">${statRows(level, enemyFields) || "<p class=\"detail-tips\">没有常见基础字段。</p>"}</div>
      </section>
      <section class="detail-section"><h3>技能与抗性</h3><div class="stat-list">
        <div class="stat-row"><span class="stat-label">Skills</span><span class="stat-value">${display(item.skills)}</span></div>
        ${resistances.map(([key, value]) => `<div class="stat-row"><span class="stat-label">${escapeHtml(key)}</span><span class="stat-value">${display(value)}</span></div>`).join("")}
      </div><p class="detail-tips">未声明 skills 或 res_* 字段，不代表该怪物没有定制行为。</p></section>
      ${relationSection("出现关卡", item.places, "stages")}
      ${relationSection("图鉴变体", item.variants, "enemies")}
      <section class="detail-section"><h3>图集与图鉴</h3><div class="stat-list">
        <div class="stat-row"><span class="stat-label">图集</span><span class="stat-value">${display(item.texture)}</span></div>
        <div class="stat-row"><span class="stat-label">首帧</span><span class="stat-value">${display(item.frameName)}</span></div>
        <div class="stat-row"><span class="stat-label">引用帧数</span><span class="stat-value">${display(item.frameCount)}</span></div>
        <div class="stat-row"><span class="stat-label">图鉴索引</span><span class="stat-value">${display(item.bestiaryIndex)}</span></div>
      </div></section>
      <details class="detail-section raw-details"><summary>全部原始字段</summary>
        <div class="stat-list">${statRows(level, Object.keys(level).map(key => [key, key]), null, true)}</div>
      </details>`;
  }

  function renderDetail() {
    const item = currentItem();
    if (!item) {
      el.detailContent.innerHTML = "<p class=\"detail-tips\">从列表选择一项查看详情。</p>";
      return;
    }
    el.detailContent.innerHTML = `
      <div class="detail-hero">
        <img class="detail-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}（${escapeHtml(item.id)}）的 Sprite" width="112" height="112">
        <div class="detail-title"><h2>${escapeHtml(item.name)}</h2><div class="detail-id">${escapeHtml(item.id)}</div><div class="badge-row">${badges(item)}</div></div>
      </div>
      ${item.description ? `<p class="detail-description">${escapeHtml(item.description)}</p>` : ""}
      ${state.view === "weapons" && item.tips ? `<p class="detail-tips">${escapeHtml(item.tips)}</p>` : ""}
      ${state.view === "weapons" ? weaponDetail(item) : enemyDetail(item)}`;
  }

  function updateHash() {
    const hash = state.view === "notes" ? "#notes" : `#${state.view}/${encodeURIComponent(state.selectedId || "")}`;
    history.replaceState(null, "", hash);
  }

  function setView(view, selectedId = null) {
    state.view = view;
    state.search = "";
    state.category = "all";
    state.sort = "original";
    state.visible = PAGE_SIZE;
    state.selectedId = selectedId;
    state.level = null;
    el.search.value = "";
    closeSidebar();
    closeDetail();
    render();
    updateHash();
  }

  function selectItem(id, openOnMobile = true) {
    const item = data[state.view].find(entry => entry.id === id);
    if (!item) return;
    state.selectedId = id;
    state.level = firstLevel(item).level ?? 1;
    renderList(filteredItems());
    renderDetail();
    updateHash();
    if (openOnMobile) openDetail();
  }

  function openDetail() {
    if (!isMobileDetail() || !currentItem()) return;
    el.detail.inert = false;
    el.detail.removeAttribute("aria-hidden");
    el.detail.classList.add("is-open");
    el.detailBackdrop.hidden = false;
    el.detail.setAttribute("role", "dialog");
    el.detail.setAttribute("aria-modal", "true");
    document.body.style.overflow = "hidden";
    el.closeDetail.focus();
  }

  function closeDetail() {
    el.detail.classList.remove("is-open");
    el.detailBackdrop.hidden = true;
    el.detail.removeAttribute("role");
    el.detail.removeAttribute("aria-modal");
    if (isMobileDetail()) {
      el.detail.setAttribute("aria-hidden", "true");
      el.detail.inert = true;
    } else {
      el.detail.removeAttribute("aria-hidden");
      el.detail.inert = false;
    }
    document.body.style.overflow = "";
  }

  function openSidebar() {
    el.sidebar.inert = false;
    el.sidebar.removeAttribute("aria-hidden");
    el.shell.classList.add("sidebar-open");
    el.sidebarBackdrop.hidden = false;
    el.menuButton.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    el.shell.classList.remove("sidebar-open");
    el.sidebarBackdrop.hidden = true;
    el.menuButton.setAttribute("aria-expanded", "false");
    if (isMobileDetail()) {
      el.sidebar.setAttribute("aria-hidden", "true");
      el.sidebar.inert = true;
    } else {
      el.sidebar.removeAttribute("aria-hidden");
      el.sidebar.inert = false;
    }
  }

  function resetFilters() {
    state.search = "";
    state.category = "all";
    state.sort = "original";
    state.visible = PAGE_SIZE;
    el.search.value = "";
    render();
  }

  function parseHash() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (hash === "notes") return { view: "notes", id: null };
    const [view, id] = hash.split("/");
    if (["weapons", "enemies"].includes(view) && data[view].some(item => item.id === id)) return { view, id };
    return { view: "weapons", id: "WHIP" };
  }

  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
  el.search.addEventListener("input", () => { state.search = el.search.value; state.visible = PAGE_SIZE; render(); });
  el.category.addEventListener("change", () => { state.category = el.category.value; state.visible = PAGE_SIZE; render(); });
  el.sort.addEventListener("change", () => { state.sort = el.sort.value; state.visible = PAGE_SIZE; render(); });
  el.reset.addEventListener("click", resetFilters);
  el.emptyReset.addEventListener("click", resetFilters);
  el.loadMore.addEventListener("click", () => { state.visible += PAGE_SIZE; renderList(filteredItems()); });
  el.grid.addEventListener("click", event => {
    const button = event.target.closest("[data-item-id]");
    if (button) selectItem(button.dataset.itemId);
  });
  el.detailContent.addEventListener("change", event => {
    if (event.target.id === "detail-level") {
      state.level = Number(event.target.value);
      renderDetail();
    }
  });
  el.detailContent.addEventListener("click", event => {
    const button = event.target.closest("[data-related-id]");
    if (!button) return;
    const type = button.dataset.relatedType;
    const id = button.dataset.relatedId;
    if (type === "stages") return;
    if (type !== state.view) {
      state.view = type;
      state.search = "";
      state.category = "all";
      state.sort = "original";
      state.visible = PAGE_SIZE;
      el.search.value = "";
    }
    state.selectedId = id;
    state.level = null;
    render();
    updateHash();
    openDetail();
  });
  el.closeDetail.addEventListener("click", closeDetail);
  el.detailBackdrop.addEventListener("click", closeDetail);
  el.menuButton.addEventListener("click", () => el.shell.classList.contains("sidebar-open") ? closeSidebar() : openSidebar());
  el.sidebarBackdrop.addEventListener("click", closeSidebar);
  window.addEventListener("resize", () => { if (!isMobileDetail()) { closeDetail(); closeSidebar(); } });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { closeDetail(); closeSidebar(); } });

  console.assert(data.weapons.length === data.counts.weapons, "Weapon count mismatch");
  console.assert(data.enemies.length === data.counts.enemies, "Enemy count mismatch");
  console.assert(data.weapons.reduce((sum, item) => sum + item.levelCount, 0) === data.counts.weaponLevels, "Weapon level count mismatch");
  console.assert([...data.weapons, ...data.enemies].every(item => item.image), "Missing image path");

  const initial = parseHash();
  state.view = initial.view;
  state.selectedId = initial.id;
  if (initial.id && initial.view !== "notes") {
    const item = data[initial.view].find(entry => entry.id === initial.id);
    state.level = item ? firstLevel(item).level ?? 1 : null;
  }
  closeSidebar();
  closeDetail();
  render();
  updateHash();
})();
