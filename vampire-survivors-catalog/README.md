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
- 仅使用基础游戏 `WEAPON_DATA` 与 `ENEMY_DATA`，**未合并 DLC JSON**。
- 武器与强化：153 个类型，687 条等级配置。
- 怪物：579 个类型，每个类型一条基础配置。
- 图片：153 张武器/强化 Sprite、579 张怪物 Sprite，全部按图集和帧名匹配成功，无占位图。

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
assets/fonts/                本地 IBM Plex 字体与许可
data/catalog.json            完整结构化原始数据
data/catalog.js              供 file:// 页面直接加载的同一份数据
data/manifest.json           数量、图片尺寸与覆盖信息
weapons.csv                  武器逐等级累计数值
weapon-level-patches.csv     武器未合并的原始升级补丁
enemies.csv                  怪物基础数值
```

## 素材与许可

游戏数据与 Sprite 提取自用户本地安装的 Vampire Survivors，仅用于学习和架构研究；相关游戏内容权利归原作者及发行方。这里不包含游戏可执行文件或完整资源包。

页面使用 IBM Plex Sans 与 IBM Plex Mono，字体按 SIL Open Font License 分发，详见 `assets/fonts/OFL.txt`。
