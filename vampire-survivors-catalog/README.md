# Vampire Survivors 武器与怪物数据图鉴

## 打开方式

直接用浏览器打开 `index.html` 即可。页面不需要构建工具或后端服务，也不需要联网；`data/catalog.js` 以脚本方式内置数据，避免 `file://` 下的 JSON 跨域限制。

也可以在本目录启动本地服务：

```bash
python -m http.server 8766 --bind 127.0.0.1
```

然后访问 `http://127.0.0.1:8766/`。

## 内容范围

- 当前安装包的 Unity 版本：`6000.0.62f1`。
- 仅使用基础游戏 `WEAPON_DATA`、`ENEMY_DATA` 与 `STAGE_DATA`，**未合并 DLC JSON**。
- 武器与强化：153 个类型，687 条等级配置。
- 怪物：579 个类型，每个类型一条基础配置。
- 地图：24 个关卡配置、535 条逐分钟配置，其中 17 个声明循环地图，2 个带详细地图。
- 角色：70 张世界贴图与 65 张已配置肖像，覆盖率均为 100%。
- 物品：106 张物品图标；107 个非空帧中 1 个未匹配，另有 2 个通用空帧，均明确记录。
- 图片：153 张武器/强化 Sprite、579 张怪物 Sprite、24 张关卡图标、24 张图鉴背景、2 张详细地图，全部按图集和帧名匹配成功，无占位图。

类型还包含进化、被动、特殊、隐藏、非图鉴、测试及子弹类 ID。页面提供筛选，不把这些不同含义混称为“普通可用武器”或“普通怪物”。

## 数值口径

### 武器升级补丁与累计值

原始 JSON 中，武器后续等级通常是补丁：只写本等级新增或修改的字段，而且经常没有 `level` 字段。

已验证游戏内 `DataHelper.UpgradeJsonData` 对数值字段执行加法。因此：

- 页面“累计生效数值”和 `weapons.csv` 按数组顺序逐级累加数值字段；非数值字段使用新值。
- 显示等级按数组顺序编号为 1、2、3……。
- “本级原始补丁字段”和 `weapon-level-patches.csv` 保留未合并的源数据。

例如 WHIP 的累计结果为：2 级 Amount 2；8 级 Power 4、Area 1.2、Amount 2。

### 原始配置不等于最终结果

数值未叠加角色、被动、Arcana、难度和局内修正。`power`、`maxHp`、`speed` 等保留游戏自己的数值尺度，不直接解释为最终伤害或物理单位。

`interval`、`duration`、`repeatInterval` 和 `hitBoxDelay` 以毫秒数值展示。缺失显示为“—”，与显式配置的 0 不同。

怪物的 `BOSS 前缀` 只表示 ID 以 `BOSS` 开头，不是完整的 Boss 行为分类；未声明 `skills` 或 `res_*` 字段也不代表没有定制行为。

## 文件说明

```text
index.html                    图鉴入口
styles.css                   响应式页面样式
app.js                       搜索、筛选、排序、等级和详情交互
assets/weapons/              153 张武器/强化 PNG
assets/enemies/              579 张怪物 PNG
assets/characters/           70 张角色贴图与 65 张肖像
assets/items/                106 张物品 PNG
assets/stages/               关卡图标、背景和 2 张详细地图
assets/fonts/                本地 IBM Plex 字体与许可
data/catalog.json            完整结构化原始数据
data/catalog.js              供 file:// 页面直接加载的同一份数据
data/characters.json         角色原始配置
data/items.json              物品原始配置
data/manifest.json           数量、图片尺寸与覆盖信息
weapons.csv                  武器逐等级累计数值
weapon-level-patches.csv     武器未合并的原始升级补丁
enemies.csv                  怪物基础数值
characters.csv               角色基础属性
items.csv                    物品权重与解锁数据
stages.csv                   关卡基础数值
stage-schedules.csv          全部关卡逐分钟配置
stage-unlocks.csv            地图解锁条件
forest-spawn-schedule.csv     Mad Forest 逐分钟刷怪配置
downloads/                   6 个独立 ZIP 资源包及 SHA-256 清单
```

## 独立素材资源包

图鉴的“素材资源包”栏目提供以下 ZIP：

- `weapons.zip`：153 张武器图与逐等级数据；
- `enemies.zip`：579 张怪物图与基础数据；
- `characters.zip`：70 张角色图、65 张肖像及属性；
- `items.zip`：106 张物品图与权重/解锁数据；
- `maps.zip`：24 张图标、24 张背景、2 张详细地图与全部关卡数据；
- `research.zip`：完整 JSON、CSV 和研究报告。

每包均有 `manifest.json`，记录图片数量、文件大小、SHA-256 与来源说明；总清单为 `downloads/manifest.json`。不包含可执行文件、完整原始资源包或音频。

## 素材与许可

游戏数据与 Sprite 提取自用户本地安装的 Vampire Survivors，仅用于学习和架构研究；相关游戏内容权利归原作者及发行方。这里不包含游戏可执行文件或完整资源包。

页面使用 IBM Plex Sans 与 IBM Plex Mono，字体按 SIL Open Font License 分发，详见 `assets/fonts/OFL.txt`。
