# Vampire Survivors 游戏架构分析

> 分析对象：`Research/Vampire Survivors/Vampire Survivors/` 中的 Windows 版本  
> 分析日期：2026-11-08  
> 分析方式：只读解析 Unity 场景、资源包、JSON 数据与 IL2CPP 类型元数据  
> 适合读者：想做同类游戏、但刚开始学习游戏架构的开发者

## 0. 先说结论

这份安装包不是“一堆怪物和武器的 Unity 场景”，也不是 ECS 项目。它更接近下面这种组合：

**场景组合 + Zenject 依赖注入 + 两层状态机 + JSON 数据驱动 + 工厂/对象池 + 基于继承的武器和弹道行为 + 定制 2D 街机物理。**

最值得学习的四点是：

1. **应用流程与单局流程分开**：主菜单状态机和对局状态机不是同一个东西。
2. **数值与行为分开**：JSON 描述武器每级数值，C# 类负责攻击方式，工厂把类型 ID 映射到 prefab。
3. **自动攻击的公共流程沉到基类**：冷却、开火、弹道池、暴击等由 `Weapon` 统一处理，具体武器只覆盖差异。
4. **海量单位依靠专门的生命周期和查询设计**：对象池、视口裁剪、分组碰撞、空间树，而不是不停实例化和两两检测。

最不应该直接照搬的三点是：

1. `GameManager`、`CharacterController` 等类已经很大，不能把它们当成“理想分层”的范本。
2. 它同时存在依赖注入、静态单例、全局 PauseSystem 和多套管理器，这是长期演进后的混合形态，不是纯粹某一种架构。
3. 你当前 Robber&Dungeon P0 的核心是“玩家与精英共享武器并争夺”，不能复制 VS 中玩家武器和敌方武器分开的类型边界。

如果只有 20 分钟，优先读本文 §2、§6、§7、§13。

---

## 1. 分析可信度与边界

### 1.1 已直接验证的事实

- 引擎版本：`6000.0.62f1`，即 Unity 6 系列。
- 代码运行方式：**IL2CPP**。主要 C# 逻辑位于 `GameAssembly.dll`，类型元数据位于 `global-metadata.dat`。
- 构建中只有四个内置场景：
  - `Assets/App/Scenes/Preloader.unity`
  - `Assets/App/Scenes/MainMenu.unity`
  - `Assets/App/Scenes/ScenePreloader.unity`
  - `Assets/App/Scenes/Gameplay.unity`
- 当前安装的 Addressables 目录中有 **1241 个 `.bundle`**，其中包含多个 DLC 的内容；这不是早期本体的规模。
- `resources.assets` 中有 **32 个 TextAsset**，包括 `WEAPON_DATA`、`CHARACTER_DATA`、`ENEMY_DATA`、`STAGE_DATA` 等。
- 已恢复 `VampireSurvivors.Runtime.dll` 和相关游戏程序集的类名、字段、属性、方法签名、继承关系与接口。

### 1.2 不能从这些文件直接推出的内容

IL2CPP 导出的是**类型和方法签名**，不是原始 C# 方法体。因此：

- “某类负责什么”通常有很强证据。
- “A 在哪一帧先调用 B、再调用 C”若未做逐指令反编译，只能根据接口和对象关系还原。
- 数值公式、随机算法、具体池上限的实际运行时变化，不能只凭字段名当成已验证事实。

本文使用三种标记：

- **实证**：能直接在文件、对象或类型定义中验证。
- **推断**：由方法签名、字段和对象关系还原的典型运行链路。
- **建议**：面向学习和 Robber&Dungeon 的迁移意见，不代表原游戏做法。

另外，当前完整版本已经经历多年更新、联网合作和多轮 DLC。它能说明“商业项目现在怎样组织”，不等于它第一天就是这样设计的。

---

## 2. 整体架构图

下面是按职责整理后的架构，不是原项目的目录树：

```text
┌─────────────────────────────────────────────────────────────┐
│ 平台与启动                                                   │
│ Preloader / 平台初始化 / Unity Services / 存档与选项加载     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ 应用层 AppStateMachine                                      │
│ Landing / MainMenu / CharacterSelect / StageSelect / Online │
└──────────────────────────┬──────────────────────────────────┘
                           │ ScenePreloader
┌──────────────────────────▼──────────────────────────────────┐
│ 对局流程 GameStateMachine                                   │
│ Initializing / Playing / LevelUp / Treasure / Paused        │
│ GameOver / Recap                                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ 单局协调层                                                   │
│ GameManager / Stage / PhysicsManager / 各类 Manager         │
│ GameSessionData / PlayerOptions / SignalBus                 │
└───────────────┬───────────────────────┬─────────────────────┘
                │                       │
┌───────────────▼──────────────┐  ┌─────▼─────────────────────┐
│ 数据与内容                    │  │ 运行中的玩法对象           │
│ JSON TextAssets               │  │ CharacterController       │
│        ↓ DataManager          │  │ EquipmentManager          │
│ 按类型、等级转换后的数据      │  │ Weapon → Projectile       │
│        ↓ Factory              │  │ EnemyController / Pickup  │
│ 类型 ID → 行为 prefab         │  │ Stage / Destructible      │
└───────────────┬──────────────┘  └─────┬─────────────────────┘
                │                       │
                └───────────┬───────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ 高频运行基础设施                                             │
│ ArcadePhysics / PhysicsGroup / R-tree 空间查询               │
│ ObjectPool / BulletPool / Timer / PauseSystem / 裁剪         │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ 表现与外部能力                                               │
│ UI / VFX / Audio / Camera / Input                            │
│ Addressables / Saves / Coherence 多人同步                    │
└─────────────────────────────────────────────────────────────┘
```

这张图最重要的不是框的数量，而是三种关系：

- **状态机决定“现在允许发生什么”**，例如升级界面和正常战斗不是同一状态。
- **工厂决定“某个类型 ID 应该创建哪种行为对象”**。
- **数据管理器决定“这个类型、这个等级应该使用什么数值”**。

---

## 3. 场景不是玩法边界，场景是组合边界

| 内置场景 | 直接观察到的主要内容 | 职责 |
|---|---|---|
| `Preloader` | `Preloader`、`SceneContext`、`DontDestroyOnLoad`、平台/网络桥 | 初始化跨场景能力 |
| `MainMenu` | `AppStateMachine`、角色/关卡选择、存档槽、设置、图鉴、商店等 | 应用流程与永久进度 |
| `ScenePreloader` | 主菜单↔对局的加载和释放方法 | 隔离重量级场景切换 |
| `Gameplay` | `GameStateMachine`、`GameManager`、`Stage`、对象池、物理、UI | 组合一局的运行环境 |

**实证：** `Gameplay` 场景中，顶层对象大致分为：

- `Game`：相机、灯光、GameManager、Stage、World、伤害数字等。
- `Core`：GameStateMachine 和 MasterObjectPooler。
- `SceneContext`：GameInstaller、FactoriesInstaller 等 Zenject 安装器。
- `GAME UI`：对局 HUD、升级、宝箱、暂停、结算等页面。
- 输入、网络桥和调试节点。

**值得学习：** 场景没有承担全部玩法逻辑，而是提供一组可以共同工作的对象。真正的流程由状态机控制，对象创建由工厂和池控制，数值由 DataManager 提供。

**不要机械模仿：** 新手项目不需要为了“看起来专业”拆出四个场景。Robber&Dungeon P0 使用固定竞技场是合理的；先把场景内的生命周期和所有权做对，比增加 Loading 场景更重要。

---

## 4. 启动与单局生命周期

### 4.1 应用启动

**实证：**

- `Preloader.InitAsync()` 返回 `UniTaskVoid`，说明启动中存在异步初始化。
- 它注入 `UnityServicesManager`，并持有 `PlayerOptions`、`AchievementManager` 等引用。
- `ScenePreloader` 有主菜单进入对局、对局返回主菜单、对局重新进入对局等独立路径。
- `AppStateMachine` 定义了角色选择、关卡选择、开始游戏、联网大厅等事件。

**推断出的典型流程：**

```text
Preloader
  → 初始化平台、服务、存档/选项等
  → MainMenu
  → AppStateMachine：选择角色 → 选择关卡 → START_GAME
  → ScenePreloader：加载 Gameplay
  → GameStateInitializing
  → 单局数据和角色准备完成
  → GameStatePlaying
```

这里的关键是：**“开始一局”不是按钮直接 new 一个玩家，而是一个跨场景、带加载和初始化完成条件的流程。**

### 4.2 两层状态机

`StateMachine` 基类直接使用：

- 状态类型实例缓存；
- `当前状态 + 事件 → 下一状态` 的转换表；
- `FireEvent(eventStr)`；
- `OnEnter()` / `OnExit()`；
- Zenject `DiContainer` 创建状态实例。

`AppStateMachine` 管应用级页面与开始游戏，`GameStateMachine` 管单局内的战斗、升级、宝箱、暂停、死亡和结算。

`GameStatePlaying` 的方法名显示，它会响应：

- 角色死亡；
- 升级；
- 打开宝箱；
- 暂停；
- 商店、治疗和特殊选择；
- 联网错误。

**设计价值：** 升级时不应继续刷怪、移动和受伤，这不应依赖每个系统分别判断 `isLevelUpPanelOpen`。统一状态入口更可靠。

**注意：** 从签名可确认状态和事件存在，但完整转换表在 `AddTransitions()` 的方法体中，本文没有声称恢复每一条实际转换。

---

## 5. 依赖注入与事件：是混合架构，不是“纯 Zenject”

### 5.1 组合根

`CoreInstaller`、`GameInstaller`、`FactoriesInstaller` 等安装器把服务放入对应容器。

`FactoriesInstaller` 直接持有：

- `WeaponFactory`
- `ProjectileFactory`
- `CharacterFactory`
- `AccessoriesFactory`
- `TilesetFactory`
- `EnemyFactory`
- `DestructibleFactory`
- `PickupFactory`
- 其他表现和资源工厂

这是典型的**组合根**：在一个明确位置决定依赖如何连接，而不是每个对象自行查找全游戏。

### 5.2 事件通信

游戏定义了分组信号类型：

- `GameplaySignals`
- `UISignals`
- `OnlineSignals`
- `AutomationSignals`

`SignalBus` 被注入多个服务。状态类也会出现明确的信号参数，例如 `CharacterDiedSignal`、`GamePausedSignal`、`ConnectionErrorSignal`。

这比所有系统互相直接调用更容易解耦，但事件并不是天然优于直接调用：**局部、明确的一对一关系仍适合直接调用；跨层、多人关心的事实才适合信号。**

### 5.3 仍然存在的静态入口

可以观察到：

- `AppStateMachine.Instance`
- `PhysicsManager.Instance`
- `ArcadePhysics.Instance`
- 静态 `PauseSystem`
- 静态 `SaveSystem`

所以它的实际形态是：

```text
较新的服务：Zenject 注入 + 初始化/释放接口
部分基础能力：静态入口
部分旧对象：MonoBehaviour 直接引用和 Unity 生命周期
```

**建议：** 不要把这种历史混合状态当成必须复制的目标。你的项目已经确定“稳定依赖显式注入、分组只用于动态集合”，应继续保持。

---

## 6. 数据驱动与工厂：本项目最值得学习的部分

### 6.1 数据不是行为

`DataManager` 持有武器、角色、敌人、关卡等 JSON 的 `JObject`，并提供：

- `LoadBaseJObjects()`
- `LoadDataFromJson()`
- `MergeInJsonData(...)`
- `BuildConvertedData()`
- `GetConvertedWeapons()`
- `GetConvertedCharacterData()`
- `GetConvertedEnemyData()`
- `GetConvertedStages()`

返回值普遍是：

```text
Dictionary<类型枚举, List<对应 Data>>
```

`List` 的各元素用于同一内容的等级或按分钟变化的条目，而不是所有内容只有一份静态配置。

### 6.2 一个真实的武器数据形状

`WEAPON_DATA` 中 `WHIP` 有 8 个等级条目。第一级包含这些字段（节选）：

```json
{
  "level": 1,
  "bulletType": "WHIP",
  "name": "Whip",
  "evoSynergy": ["MAXHEALTH"],
  "evoInto": "VAMPIRICA",
  "rarity": 100,
  "interval": 1350,
  "repeatInterval": 100,
  "power": 1,
  "area": 1,
  "speed": 1,
  "amount": 1,
  "critChance": 0.2,
  "critMul": 2
}
```

这里同时存在三类信息：

1. **身份与展示**：名字、图标、描述。
2. **规则与数值**：冷却、威力、范围、数量、暴击。
3. **内容关系**：进化目标、协同条件、解锁和稀有度。

### 6.3 行为不是数值

`WeaponFactory` 和 `ProjectileFactory` 内都有以 `WeaponType` 为键的字典，用于取得对应 prefab。

因此新增普通武器通常需要三部分：

```text
WEAPON_DATA 中的类型与每级数值
        +
WeaponFactory 中的 WeaponType → 武器行为 prefab
        +
ProjectileFactory 中的 WeaponType → 弹道行为 prefab
```

这就是**数据驱动 + 行为注册**，不是“所有武器都写死在一个 switch 里”，也不是“所有攻击都靠 JSON 完全描述”。

### 6.4 DLC 如何接入

`DataManager.MergeInJsonData(...)` 和 DLC 数据转换接口说明，内容包不仅增加图片，也能合并角色、武器、敌人和关卡数据。

Addressables 包名进一步把内容拆成：

- 角色数据/角色 prefab；
- 敌人资源；
- 武器资源；
- 地图和图块；
- 音乐与音效；
- 持久共享资源。

**值得学习：** 内容扩展需要“数据合并、类型注册、资源加载”三条链路共同工作，单纯把新图片放进文件夹并不会形成新玩法。

**不建议现在做：** Robber&Dungeon P0 不需要 JSON 合并、DLC 目录和 Addressables。`Resource + 明确注册表` 已足够验证三把武器。

---

## 7. 武器、弹道与自动攻击

### 7.1 角色不是武器本体

`CharacterController` 持有：

- `CharacterWeaponsManager`
- `CharacterAccessoriesManager`
- `PlayerModifierStats`
- 当前角色数据、皮肤数据、HP、XP、移动与受伤状态

`CharacterWeaponsManager` 和 `CharacterAccessoriesManager` 都继承 `EquipmentManager`。

这意味着角色负责“我是谁、我有什么、我的状态是什么”，装备管理器负责“哪些装备正在运行”。

### 7.2 公共装备与武器基类

`Equipment` 中直接存在：

- `WeaponType Type`
- `Level` / `LevelsNumber`
- `CharacterController Owner`
- 当前 JSON 数据
- `LevelUp()`、`MakeLevelOne()`、`GetDataForLevel()`
- `InternalUpdate()`、`Cleanup()`

`Weapon : Equipment` 进一步提供：

- 开火与重复开火计时器；
- 当前武器数据；
- 弹道 prefab 和 `BulletPool`；
- 已生成弹道列表；
- 暴击、反弹、穿透、诅咒和幸运等公共修正；
- `Fire()`、`FireOneProjectile()`、`DealDamage()`；
- 子弹命中敌人、玩家、可破坏物和墙的回调。

### 7.3 弹道的职责

`Projectile` 持有：

- 来源 `Weapon` 和所属 `BulletPool`；
- 速度、穿透、反弹；
- 目标 Transform；
- 已命中对象 `_objectsHit`；
- 目标选择、初始速度、命中和回收接口。

`BulletPool` 提供：

- `SpawnAt(...)`
- `Prewarm(count)`
- `Return(projectile)`
- `Cleanup()`

### 7.4 鞭子为什么很简单

恢复出的 `WhipWeapon` 只有少量覆盖：检查 Arcana、选择开火动画和构造函数。

`WhipProjectile` 主要处理初始化、缩放/透明度动画和回收。

这并不说明鞭子没有逻辑，而是说明大量逻辑已经在公共层：

```text
Weapon：什么时候攻击、创建多少弹道、公共数值
WhipWeapon：少量武器特有表现/规则
Projectile：弹道通用运动、命中记录、生命周期
WhipProjectile：鞭子的特有初始化与表现
```

**这是一个很好的学习点：先提炼稳定公共流程，再为差异写子类；不要给每把武器复制一套冷却和对象池代码。**

### 7.5 典型自动攻击链路

下面是依据接口关系还原的**学习用链路，不是逐行反编译结果**：

```text
Weapon 更新计时
  → 到达攻击间隔，执行 Fire()
  → 从 BulletPool 取得 Projectile
  → Projectile.InitProjectile(pool, weapon, index)
  → 根据武器/弹道规则选择方向和目标
  → ArcadePhysics 检测重叠
  → 命中回调，Weapon.DealDamage(IDamageable)
  → 目标处理伤害、死亡与奖励
  → 弹道失效后 Return 到池
```

`IDamageable` 提供受伤、死亡状态、当前生命、回收和奖励等公共接口，使武器不必知道目标具体是哪一种敌人。

### 7.6 与你的“抢武器”核心有什么不同

VS 的 `Equipment.Owner` 明确是 `CharacterController`，并且项目另有：

- `EnemyWeapon`
- `EnemyProjectile`
- `EnemyBulletPool`

这套边界适合 VS，但**不适合原样复制到你的 P0**。

你的设计应继续保证：

```text
同一份 WeaponDefinition
同一个 WeaponInstance / Behavior / Slot 模型
        ↓
玩家持有 ↔ 死亡掉落为世界武器 ↔ 空手精英拾取并持有
        ↓
精英使用同一攻击规则反击玩家
        ↓
杀回精英，武器再次掉落并可夺回
```

差异只应存在于**持有者、阵营、目标和输入/AI**，不应复制一套“玩家武器”和一套“精英武器”。

---

## 8. 关卡、刷怪与升级奖励

### 8.1 关卡是一组随时间变化的配置

`STAGE_DATA` 中的 `FOREST` 有 31 个条目，对应第 0～30 分钟。

几个直接读取的例子：

| 分钟 | 普通敌人 | Boss | minimum | frequency |
|---:|---|---|---:|---:|
| 0 | `BAT3` | 无 | 15 | 1000 |
| 1 | `ZOMBIE`, `BAT1` | `BAT4` | 30 | 1000 |
| 10 | `MUDMAN1`, `MUDMAN2` | `BOSS_XLMANTIS` | 10 | 500 |
| 20 | `XLMUMMY`, `MUDMAN2`, `XLBAT` | `BOSS_XLMUMMY` | 100 | 100 |
| 30 | 无 | `BOSS_XLDEATH` | 1 | 10000 |

`StageData` 还包含时间限制、玩家/敌人速度、生命倍率、经验、金币、图块、音乐、可破坏物等配置。

`Stage` 提供：

- `InitStage()` / `InitStagePostLoad()`
- `UpdateMinuteData()`
- `UpdateEnemyPools()`
- `SpawnEnemiesInOuterRect()`
- `SpawnEnemiesTiled()` / `SpawnEnemiesMapped()`
- `SpawnBoss()`
- `UpdateCulling()`

**推断：** 对局时间推进后，Stage 选择当前分钟配置，更新需要预热/使用的敌人和池，再按当前关卡的刷怪模式生成单位。

这不是单纯的“随机在玩家周围生成敌人”，而是：

```text
关卡时间表 + 敌人组合 + 数量/频率 + 刷怪模式 + 对象池 + 空间规则
```

### 8.2 敌人也使用配置与行为分离

`ENEMY_DATA` 的 `BAT1` 包含 HP、速度、伤害、击退、经验、贴图、动画帧和图鉴信息。

`EnemyFactory` 负责：

- 根据 `EnemyType` 取得 prefab；
- 建立、预热、补充和清理敌人池；
- 根据当前关卡敌人集合准备资源。

`EnemyController` 负责运行时初始化、移动/技能、受伤、死亡、信号、奖励和回收；特殊敌人再继承它。

### 8.3 升级不是 UI 自己抽卡

`RewardManager` 注入：

- `DataManager`
- `PlayerOptions`
- `GameSessionData`
- `SignalBus`

并维护已拥有和可用的武器/被动列表，通过 `GetLevelUpRewards(amount)` 产生奖励。

**推断出的分工：**

```text
角色获得经验并达到条件
  → GameStateMachine 进入 LevelUp
  → RewardManager 生成合法候选
  → LevelUpPage 展示候选并接收选择
  → Equipment/Weapon 应用升级或新增装备
  → 返回 Playing
```

UI 不应自己决定哪些武器合法，也不应直接修改所有数值。它负责展示和选择，奖励规则属于玩法服务。

---

## 9. 碰撞、伤害与暂停

### 9.1 为什么使用定制 ArcadePhysics

项目中存在 `PhaserPort`，核心对象继承 `ArcadeSprite`。`ArcadePhysics` 提供矩形、圆形和线段重叠查询。

`World` 中有：

- 动态与静态 body 集合；
- 待添加/待删除队列；
- 固定步进相关字段；
- 分组 R-tree 和静态 R-tree；
- `update()`、`step()`、`postUpdate()`；
- `overlap()`、`collide()` 和分离逻辑。

`PhysicsManager` 建立玩家、敌人、子弹、拾取物、磁铁、可破坏物等 `PhysicsGroup`，并配置玩家碰敌人、玩家碰拾取物、磁铁吸拾取物等回调。

**结论：** 核心战斗主要是 OOP + 自定义街机物理，而不是 Unity DOTS/ECS。安装包中有 Burst/Jobs 程序集，也不能据此声称主玩法使用 ECS。

### 9.2 命中不是一个巨大碰撞脚本

可以看到三层分工：

1. `PhysicsManager` 配置组与组之间的规则。
2. `Weapon` / `Projectile` 处理具体弹道命中和伤害。
3. `IDamageable` 目标处理自身受伤、死亡、奖励与回收。

`Projectile._objectsHit` 用来记录已经命中的目标，是处理穿透和避免重复命中的重要状态。

`DamageNumberManager` 独立存在，说明伤害数字属于表现层，不应成为扣血逻辑本身。

### 9.3 暂停是一套游戏时间语义

`GameMonoBehaviour` 提供：

- `UpdateCallback()`
- `OnPreUpdate()` / `OnUpdate()`
- `OnPause()` / `OnResume()`

静态 `PauseSystem` 提供暂停状态、游戏时间、DeltaTime 和恢复接口。项目还区分 `TimerManagerGame` 和 `TimerManagerUI`。

**值得学习：** 战斗计时器和 UI 计时器不一定应该一起停止。升级界面、暂停菜单和联网状态下的时间语义需要明确，而不是到处读同一个全局时间。

---

## 10. 性能与资源生命周期

### 10.1 对象池不是优化细节，而是领域生命周期的一部分

可以观察到：

- `BasePoolableSpriteBehaviour`
- 通用 `ObjectPool`
- `BulletPool`
- `EnemyFactory` 的池预热、补充、清理和上限接口
- `MasterObjectPooler`
- 大量命名的 pool 资产

高频对象的正确生命周期应类似：

```text
预热 → 取出 → 重置运行状态 → 参与物理/更新
    → 死亡或离屏 → 取消回调/碰撞/计时器 → 归还池
```

只把 GameObject 设为 inactive 并不等于完成回收；`_objectsHit`、目标引用、计时器和事件订阅都可能需要重置。

### 10.2 其他明确存在的性能手段

- `Stage.UpdateCulling()`：视口/距离裁剪。
- `World` 的 R-tree：缩小空间查询候选集。
- 多个 `ProfilerMarker`：在关键路径内置性能测量点。
- 敌人池预热：把一部分实例化成本移到加载或低峰阶段。
- 资源分包：按 DLC 和内容类型加载，而非全部常驻。

**建议：** 学习顺序应是“先正确测量，再池化/空间索引”。P0 的固定竞技场和少量单位不需要先写一套通用空间树。

### 10.3 资源释放也是架构问题

`ScenePreloader.ReleaseGameplay()`、`AddressableLoader`、EnemyFactory 的 `PurgePools()` 等接口说明，退出对局不仅是切换 UI：

- 场景对象要销毁或归还；
- 网络连接要处理；
- 池和资源引用要释放；
- 下一局不能继承上一局的回调与计时器。

这与你项目要求“死亡和武器转移幂等”是同一类问题：**对象生命周期必须有唯一、可重复执行的边界。**

---

## 11. 存档、永久进度与多人边界

### 11.1 存档不是把当前场景序列化

`SaveSystem` 提供：

- `Save(PlayerOptionsData, ...)`
- `LoadAsync(...)`
- 存档槽加载
- 备份检查
- 删除与平台存储结果

另有 `SaveParser`、`SaveSerializer`、`Migrator` 等平台/版本处理能力。

`PlayerOptions.Save()` 与运行时玩法对象分离，说明持久化围绕明确的 PlayerOptionsData，而不是把 Gameplay 场景中的所有节点直接写成文件。

**值得学习：** 永久存档和单局状态是两种不同数据。即使未来做“一局结束后解锁”，也应通过明确的结算结果更新永久数据。

### 11.2 多人是一条横切链路

安装包包含 Coherence、复制服务器、网络 Provider/Instantiator 和 `CoherenceSync` 类型，角色、敌人、拾取物也有相应网络分支。

这意味着联网不是最后简单加一个“发送位置”功能，而会影响：

- 谁有权威执行伤害和死亡；
- 谁生成奖励；
- 随机结果如何一致；
- 对象创建与回收由谁广播；
- UI 状态如何同步。

**建议：** P0 不引入联网是正确取舍，但仍应把死亡、拾取、武器转移写成明确且幂等的规则入口，避免未来完全无法整理权威边界。

---

## 12. 这套架构的优点与代价

### 12.1 值得肯定的地方

1. **核心循环清晰**：状态机处理流程，DataManager 处理数据，Factory 处理创建，Pool 处理高频生命周期。
2. **公共武器流程复用充分**：简单武器只需很少差异代码。
3. **内容扩展路径完整**：数据、行为 prefab、资源包可以按 DLC 合并。
4. **针对类型游戏做性能设计**：没有为了“通用”而依赖大量完整刚体模拟。
5. **表现和规则有拆分意识**：奖励规则、伤害数字、页面状态不是同一个对象。

### 12.2 明显的复杂度与债务

按导出的签名粗略统计（包含 getter/setter、重载和编译器生成入口，不等于手写代码行数）：

| 类型 | 字段签名约数 | 方法签名约数 |
|---|---:|---:|
| `GameManager` | 187 | 473 |
| `CharacterController` | 170 | 397 |
| `Stage` | 115 | 280 |
| `EnemyController` | 118 | 208 |
| `Weapon` | 52 | 130 |

这说明即使使用了 DI、状态机和工厂，仍会出现“协调者知道太多事情”的问题。

具体代价包括：

- 大类的测试面和修改影响面较大。
- 大量继承子类适合快速增加内容，但特殊规则可能继续挤入基类。
- 字符串 ID、JSON 和枚举转换需要校验；工厂里的 `ValidateReferences()` 正是在补这类风险。
- 静态入口与 DI 并存，使生命周期和测试替身不总是统一。
- 很多 MonoBehaviour 同时含规则与表现，不适合直接搬到无 Unity 的纯单元测试环境。

**正确学习态度：** 把它当作一个成功且持续演进的生产案例，既看有效决策，也看规模带来的折中；不要把所有命名带 `Manager` 的类都当成最佳实践。

---

## 13. 对 Robber&Dungeon 的可迁移设计

### 13.1 概念映射

| Vampire Survivors | Godot 中可采用的概念 | 当前是否值得做 |
|---|---|---|
| `WeaponData` JSON | 自定义 `WeaponDefinition : Resource` | 值得，P0 就应分离定义与实例 |
| `Equipment` / `Weapon` | `WeaponInstance` + 共用 `WeaponBehavior` | 值得，且你的持有者应支持玩家和精英 |
| `CharacterWeaponsManager` | `WeaponSlot` / 装备持有逻辑 | 值得，直接服务抢武器核心 |
| `WeaponFactory` | 武器 ID → Definition/Behavior/PackedScene 的注册表 | 可做轻量版，不必做大型工厂层 |
| `StageData` 时间表 | 以后的 `SpawnSchedule : Resource` | 后续再做，P0 固定竞技场不需要 |
| `SignalBus` | 明确的局部 signal 或会话级事件连接 | 谨慎使用，不建立永久全局事件总线 |
| `ObjectPool` | 节点池 | 有测量证据后再做 |
| `AppStateMachine` / `GameStateMachine` | 应用流程和单局流程分离 | 保留思想，P0 可用少量明确状态 |
| `ScriptableObject` / prefab | `Resource` / `PackedScene` | 直接对应，容易理解 |
| Zenject Installer | 场景组合根中的显式依赖连接 | 保留你当前约束，不引入全局服务定位 |

### 13.2 你现在最应该带走的设计

```text
WeaponDefinition：稳定 ID、数值、行为类型、表现引用
WeaponInstance：等级/冷却/当前持有者等一局内状态
WeaponBehavior：自动攻击规则，玩家和精英共用
WeaponSlot：持有、移除、替换，处理所有权转移
WeaponWorld：地面唯一实例，处理拾取和掉落
```

建议明确以下不变量：

1. 同一把武器实例不能同时位于角色槽位和世界地面。
2. 死亡掉落只能执行一次，重复死亡通知不能生成第二份武器。
3. 拾取成功与持有者变更是同一个原子规则，不允许只隐藏地面武器却没有装备。
4. 精英和玩家只提供不同的持有者上下文，不复制 WeaponBehavior。
5. 回收/重生时必须清理旧计时器、目标、信号连接和槽位引用。

这些比“是否使用 JSON”“是否使用对象池”更直接影响你的核心玩法是否可信。

### 13.3 当前不要迁移的部分

- 1241 个 bundle 式的内容拆分；
- DLC 数据合并；
- 多人同步；
- 数百个武器子类形成的继承规模；
- 大型 GameManager；
- 自制完整物理引擎；
- 通用全局事件总线；
- 在没有性能数据前引入复杂池系统。

**P0 只需验证“武器被夺走并反用后，玩家是否想夺回来”。架构应服务这个问题，而不是服务复刻 VS 的全部功能。**

---

## 14. 推荐的学习与练手顺序

### 第一步：先画生命周期，不急着写新系统

选一把鞭子，按本文 §7 画出：

```text
数据 → 工厂 → Weapon → BulletPool → Projectile → 命中 → 伤害 → 回收
```

然后用你自己的三把武器之一做同样练习，标出哪些属于 Definition、Instance、Behavior、Slot、World。

### 第二步：做最小数据驱动

让一个角色和一把武器分别只有：

- 一个类型 ID；
- 一份基础数值；
- 一套行为；
- 一个运行时实例。

再增加第二个等级，验证“数据变化”不需要复制行为代码。

### 第三步：做最小对局状态

只保留：

```text
Initializing → Playing → DebugRespawn / GameOver
```

以后需要升级界面时再增加 LevelUp。先明确每个状态允许更新哪些系统，不要先引入通用状态机框架。

### 第四步：验证死亡与转移

自动测试至少覆盖：

- 玩家有武器死亡，掉一把；
- 空手精英拾取，世界实例消失、精英槽位获得同一实例；
- 精英能自动攻击玩家；
- 精英死亡，掉同一把；
- 玩家杀回后夺回；
- 重复死亡、重复拾取不会复制武器。

### 第五步：最后讨论性能

当敌人数量真的造成问题后，按顺序检查：

1. 是否频繁创建/销毁节点；
2. 是否每个对象都在做全集合搜索；
3. 是否存在无意义的屏外更新；
4. 是否有稳定的更新顺序和回收边界。

再决定引入池、空间查询或分帧更新。

---

## 15. 证据索引

### 游戏文件

- `VampireSurvivors_Data/globalgamemanagers`：Unity 版本与四个构建场景。
- `VampireSurvivors_Data/level0`～`level3`：实际场景对象和组件。
- `VampireSurvivors_Data/resources.assets`：基础 JSON 数据、工厂以外的共享资源等。
- `VampireSurvivors_Data/sharedassets3.assets`：Gameplay 共享工厂与池资产。
- `VampireSurvivors_Data/ScriptingAssemblies.json`：游戏及第三方程序集清单。
- `VampireSurvivors_Data/RuntimeInitializeOnLoads.json`：AddressableLoader、UniTask 等运行时初始化入口。
- `VampireSurvivors_Data/StreamingAssets/aa/`：Addressables 目录与内容包。
- `GameAssembly.dll` + `il2cpp_data/Metadata/global-metadata.dat`：IL2CPP 类型证据。

### 重点类型

- 流程：`AppStateMachine`、`GameStateMachine`、`StateMachine`、`GameStatePlaying`。
- 协调：`GameManager`、`Stage`、`PhysicsManager`。
- 数据：`DataManager`、`WeaponData`、`CharacterData`、`EnemyData`、`StageData`。
- 创建：`WeaponFactory`、`ProjectileFactory`、`CharacterFactory`、`EnemyFactory`。
- 战斗：`Equipment`、`Weapon`、`Projectile`、`BulletPool`、`IDamageable`。
- 敌人：`EnemyController`、`EnemyFactory`。
- 奖励：`RewardManager`、`LootManager`、`PickupManager`。
- 基础设施：`ArcadePhysics`、`World`、`GameMonoBehaviour`、`PauseSystem`。
- 持久化：`PlayerOptions`、`SaveSystem`、`SaveParser`、`SaveSerializer`。
- 资源：`AddressableLoader`、`ScenePreloader`。

### 本次使用的方法

- UnityPy：只读枚举 Unity 序列化对象、场景组件和 TextAsset。
- Il2CppDumper：恢复类型、字段、接口和方法签名。
- JSON 解析：验证实际数据结构及森林关卡的时间表。

没有修改原游戏文件，也没有把类型导出当作原始 C# 源码。

---

## 最后一句话

**VS 最值得学的不是“Manager 很多”，而是它把内容、行为、流程和高频生命周期分别找到了可扩展的落脚点；你自己的项目则应在此基础上进一步收紧边界，尤其守住共享武器模型和幂等转移。**
