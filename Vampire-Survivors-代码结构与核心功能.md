# Vampire Survivors 代码结构与核心功能导读

> 本文是《Vampire-Survivors-架构分析.md》的代码级配套文档。  
> 目标：回答“代码分成哪些模块、核心类各自做什么、对象怎样协作、应该按什么顺序读”。  
> 分析对象：当前下载的 Windows IL2CPP 版本，而非早期 Phaser 版本或网络流传的简化复刻。

## 0. 阅读结论

这个项目的代码不能简单归类为 MVC、ECS 或纯数据驱动。更准确的说法是：

```text
Unity 场景和 prefab 提供对象组合
Zenject 负责大部分服务依赖连接
状态机负责应用和单局流程
DataManager 负责配置读取、合并和类型转换
Factory 负责类型 ID 到 prefab 的映射
Facade/Manager 协调具体玩法
Weapon/Projectile/CharacterController 等继承体系实现运行行为
ObjectPool、ArcadePhysics 和局部 Jobs/Burst 支撑高频运行
```

理解整个项目最快的方式不是从几百个武器子类开始，而是读通四条垂直链路：

1. **创建对局**：GameManager → CharacterFactory → CharacterController → Stage。
2. **武器装备与攻击**：WeaponsFacade → EquipmentManager → Weapon → BulletPool → Projectile。
3. **升级**：GameStateMachine → GameManager → LevelUpFactory → LevelUpPage → WeaponsFacade。
4. **敌人死亡**：EnemyController → 奖励/表现 → 清理信号 → ObjectPool。

---

## 1. 代码还原程度与注意事项

原安装包没有 `.cs` 源文件和原始仓库目录。本报告使用三层证据：

- **资源证据**：场景中的组件、ScriptableObject、JSON TextAsset、Addressables 包。
- **类型证据**：IL2CPP 恢复的程序集、命名空间、字段、继承、接口和方法签名。
- **定向调用证据**：对关键 IL2CPP 原生方法做反汇编，并映射其中的直接调用目标。

因此本文会区分：

- **已验证调用**：在关键方法的原生代码中直接观察到。
- **接口关系**：能确认对象提供或被注入什么能力，但部分调用是虚调用、泛型实例或回调。
- **逻辑目录**：按命名空间和职责重建，不声称是开发者电脑上的原始文件夹。

特别说明：部分泛型名称会因 IL2CPP 类型擦除而显得奇怪，部分虚调用也无法仅靠直接 `call` 指令确定最终子类。因此本文不会伪造原始 C# 方法体。

---

## 2. 程序集结构：先看哪些，跳过哪些

### 2.1 `Assembly-CSharp.dll`

恢复出的约 8000 个可见顶层类型中，约 8034 个属于：

```text
Coherence.Generated
```

它们主要是多人同步所需的生成代码，包括同步配置、Provider、Instantiator、命令和实体桥接。

**阅读建议：** 研究单机核心玩法时先跳过。只有研究“伤害由谁执行、对象如何同步、联机命令怎样发送”时再进入。

该程序集还含少量 VFX、UI/插件适配类型，但不是主要玩法代码所在地。

### 2.2 `VampireSurvivors.Runtime.dll`

这是核心程序集。恢复出约 5824 个类型，其中约 3004 个是不含编译器生成嵌套名称的可见顶层类型。后者包括类、结构、接口和枚举，不等于源文件数量。

主要命名空间按规模排列：

| 命名空间 | 可见顶层类型约数 | 主要内容 |
|---|---:|---|
| `Objects.Projectiles` | 596 | 各种弹道及辅助逻辑 |
| `Objects.Weapons` | 534 | 武器、被动及其特殊行为 |
| `Objects.Characters` | 388 | 角色、修正、技能卡、追随者 |
| `UI` | 243 | 对局及通用 UI |
| `VampireSurvivors` 根空间 | 218 | 状态机、页面、应用级协调 |
| `Objects.Characters.Enemies` | 162 | 特殊敌人和 Boss |
| `Data` | 69 | 数据管理、通用类型 ID、配置对象 |
| `Objects.Stages` | 68 | 地图、背景和特殊关卡 |
| `Objects.Items` | 64 | 拾取物、宝箱、武器和遗物 |
| `Framework` | 53 | 单局协调、工厂、外观服务和核心管理器 |

**数量多的命名空间不等于应该最先读。** 大量类型是内容扩展，框架入口反而在类型较少的命名空间里。

### 2.3 其他重要程序集

| 程序集/库 | 在项目中的作用 |
|---|---|
| `PhaserPort` | Phaser 风格 Sprite、World、Body、Group、ArcadePhysics |
| `Zenject` | DiContainer、Installer、Inject、SignalBus |
| `QFSW.MOP2` | Unity 对象池实现 |
| `UniTask` | 部分异步初始化和任务流程 |
| `Newtonsoft.Json` | JObject/JArray 配置读取和转换 |
| `Sirenix.OdinInspector` | 序列化字典、ScriptableObject 和编辑器支持 |
| `Rewired` | 输入抽象与多人输入 |
| `DOTween` / 自有 PhaserTweens | 表现动画和补间 |
| `Doozy` | UI 页面、视图与导航 |
| `ProCamera2D` | 相机、目标、震动和像素效果 |
| `MasterAudio` | 音乐与音效 |
| `Coherence` | 多人同步 |
| `Addressables` | 分包资源加载 |

---

## 3. 整个项目的逻辑代码树

下面是按命名空间和真实职责整理的代码地图，不是原仓库目录的伪造还原。

```text
VampireSurvivors.Runtime
│
├─ Installers                         【组合根】
│  ├─ CoreInstaller                   跨场景核心服务与基础配置
│  ├─ GameInstaller                   对局服务、数据、UI 和移动端绑定
│  ├─ FactoriesInstaller              各类 prefab/资源工厂绑定
│  ├─ MainMenuInstaller               主菜单服务
│  └─ MultiplayerInstaller            多人服务
│
├─ VampireSurvivors（根命名空间）      【应用与对局流程】
│  ├─ StateMachine / StateMachineState
│  ├─ AppStateMachine                 菜单、选人、选关、联网、开始游戏
│  ├─ GameStateMachine                初始化、战斗、升级、宝箱、暂停、结算
│  ├─ GameState*                      各对局状态
│  ├─ App*State                       各应用状态
│  ├─ GameplaySceneConnector
│  └─ 各类页面、输入和场景辅助
│
├─ Data                               【配置与统一 ID】
│  ├─ DataManager                     JSON 加载、合并、缓存、类型转换
│  ├─ PlayerOptionsData               可持久化的配置/进度数据
│  ├─ WeaponData                      武器和被动的每级配置
│  ├─ Characters.CharacterData        角色、皮肤、成长和表现配置
│  ├─ Enemies.EnemyData               敌人生命、速度、奖励和表现配置
│  ├─ Stage.StageData                 按分钟变化的关卡配置
│  ├─ Items.ItemData                  道具配置
│  ├─ PowerUp.PowerUpData             永久强化配置
│  └─ WeaponType / CharacterType / EnemyType / StageType / ItemType ...
│
├─ Framework                          【核心服务与协调】
│  ├─ GameManager                     单局总协调者
│  ├─ GameSessionData                 当前活动角色等少量会话引用
│  ├─ WeaponsFacade                   添加/移除武器及相关通知
│  ├─ AccessoriesFacade               添加/移除被动
│  ├─ LevelUpFactory                  升级候选池、权重、排除、进化条件
│  ├─ RewardManager                   通用奖励 DTO 生成辅助
│  ├─ TreasureFactory                 宝箱奖励生成
│  ├─ LootManager                     掉落表和权重
│  ├─ PhysicsManager                  物理分组和组间回调
│  ├─ EnemiesManager                  敌人批量移动更新
│  ├─ ArcanaManager                   Arcana 特殊规则及跨武器效果
│  ├─ WeaponFactory 等                类型 ID → prefab 的注册表
│  ├─ Loading                         对局/角色/敌人/贴图资源加载
│  ├─ Saves                           存档解析、序列化、迁移、读写
│  ├─ DLC                             内容目录、许可、版本和分包加载
│  ├─ RuntimeContent                  自定义角色等运行内容导入
│  ├─ TimerSystem                     Game/UI/Automation 计时器
│  ├─ Particles / Phaser / PhaserTweens
│  └─ Platforms                       平台适配
│
├─ Objects                            【场景中的运行对象】
│  ├─ Equipment                       装备公共基类
│  ├─ EquipmentManager                活跃、隐藏、已移除装备集合
│  ├─ CharacterWeaponsManager         武器集合更新与开关
│  ├─ CharacterAccessoriesManager     被动集合更新
│  ├─ PlayerOptions                   配置/进度服务及保存入口
│  ├─ Stage                           分钟配置、刷怪、地图、事件和裁剪
│  ├─ Destructible / MagnetZone / PetManager ...
│  │
│  ├─ Characters
│  │  ├─ CharacterController          玩家输入、移动、属性、装备、伤害、死亡
│  │  ├─ PlayerModifierStats          局内修正属性
│  │  ├─ EnemyController              敌人行为、伤害、死亡、奖励、回收
│  │  ├─ EnemyControllerBoss          Boss 通用生成与奖励能力
│  │  ├─ 特殊角色和技能卡
│  │  └─ Enemies                      特殊敌人和 Boss 子类
│  │
│  ├─ Weapons
│  │  ├─ Weapon                       自动攻击公共流程
│  │  ├─ Accessory / ActiveAccessory  被动与主动被动
│  │  ├─ EnemyWeapon                  敌方武器的另一套模型
│  │  └─ 大量具体武器/被动子类
│  │
│  ├─ Projectiles
│  │  ├─ Projectile                   弹道公共生命周期、目标与命中
│  │  ├─ EnemyProjectile              敌方弹道
│  │  └─ 大量具体弹孔子类
│  │
│  ├─ Pools                           BulletPool、EnemyBulletPool 等
│  ├─ Pickups                         Pickup 基类和 PickupManager
│  ├─ Items                           经验、金币、宝箱、武器、遗物等
│  ├─ Stages                          背景、地图和特殊关卡逻辑
│  ├─ Props                           门、车、机关等可交互物
│  └─ VFX                             表现效果
│
├─ UI                                 对局 HUD、升级、宝箱、暂停和通用页面
├─ App                                应用数据、平台服务、后端、账号和应用 UI
├─ Signals                            Gameplay/UI/Online/Automation 信号定义
├─ Achievements                       成就规则与解锁
├─ Graphics                           贴图、动画、渲染和像素效果
├─ Input                              对局/菜单输入辅助
└─ Tools                              日志、调试、作弊和通用工具
```

---

## 4. 四种代码形态必须分清

这个项目里的“类”并不都处于同一层。

| 代码形态 | 代表类型 | 主要职责 |
|---|---|---|
| 纯配置/DTO | `WeaponData`、`CharacterData`、`StageData` | 承载数值、ID、展示和内容关系 |
| 普通 C# 服务 | `DataManager`、`LevelUpFactory`、`LootManager` | 规则计算、缓存、候选选择、生命周期接口 |
| ScriptableObject 注册表 | `WeaponFactory`、`EnemyFactory`、`ProjectileFactory` | 保存类型到 prefab/池的序列化映射 |
| Unity 场景行为 | `GameManager`、`CharacterController`、`Weapon`、`Projectile` | 实际运行、更新、碰撞、表现和对象生命周期 |

`WeaponFactory` 不是 `Weapon` 的基类，`WeaponData` 也不是 `Weapon` 的运行实例。

可以按下面的方式理解：

```text
WeaponData       = 这把武器在某等级“应该是什么数值”
WeaponFactory    = 这个 WeaponType “应该创建哪个 prefab”
Weapon           = 运行中“何时攻击、怎样生成弹道”
Projectile       = 这次攻击生成后“怎样运动、命中和消失”
EquipmentManager = 这个角色“当前拥有哪些装备对象”
```

---

## 5. 核心继承结构

### 5.1 装备和武器

```text
GameMonoBehaviour
└─ Equipment（抽象）
   ├─ Weapon
   │  ├─ WeaponSelector
   │  ├─ WhipWeapon / KnifeWeapon / AxeWeapon ...
   │  └─ 其他具体武器和特殊武器基类
   └─ Accessory
      └─ ActiveAccessory
         └─ 具体主动/特殊被动
```

`Equipment` 统一了：

- `WeaponType Type`
- `Level` 和 `LevelsNumber`
- `CharacterController Owner`
- 当前等级 JSON 数据
- `LevelUp()`、`MakeLevelOne()`、`GetDataForLevel()`
- `InternalUpdate()` 和 `Cleanup()`

**设计意义：** 武器和被动共享“类型、拥有者、等级、升级、数据获取”的概念，但运行行为分别扩展。

### 5.2 角色、敌人和可伤害对象

```text
ArcadeSprite
├─ CharacterController : IDamageable
├─ Projectile : IDamageable
└─ BasePoolableSpriteBehaviour : IPoolable
   ├─ EnemyController : IDamageable
   │  ├─ EnemyControllerBoss
   │  └─ 特殊敌人
   ├─ Pickup : IDamageable
   │  └─ 经验、金币、宝箱、武器、遗物等
   └─ Destructible : IDamageable
```

`IDamageable` 把受伤、死亡状态、生命、回收和奖励抽成公共接口，因此武器不必知道目标的所有具体类型。

**注意：** 这是接口统一，不代表所有对象有相同生命周期。角色、弹道、池化敌人和拾取物的创建/回收路径不同。

### 5.3 状态机

```text
StateMachine : MonoBehaviour
├─ AppStateMachine
└─ GameStateMachine

StateMachineState : MonoBehaviour
├─ AppStateMachineState
│  └─ 各菜单/选人/选关状态
└─ GameStateMachineState
   └─ Initializing / Playing / LevelUp / Paused / GameOver ...
```

基类持有状态实例缓存和转换表，通过 `FireEvent(string)` 触发转换，并用 Zenject 容器创建状态实例。

**设计意义：** 状态是有 `OnEnter/OnExit` 生命周期的对象，不只是 UI 页面上的一个枚举。

---

## 6. 组合根和对象创建方式

### 6.1 Installer 负责连接服务

`FactoriesInstaller` 绑定武器、弹道、角色、被动、敌人、可破坏物、拾取物、图块、字体和表现工厂。

`GameInstaller` 则把安装拆成：

- `Install()`
- `InstallData()`
- `InstallUI()`
- `InstallMobile()`

这体现了“在场景组合根统一连接依赖”的思路，避免每个玩法对象都自行寻找所有服务。

### 6.2 不是所有对象都用同一种创建方式

可以观察到至少四种创建/获取路径：

```text
普通服务：Zenject 创建并注入
角色/武器 prefab：Factory 提供模板，再实例化、InjectGameObject、初始化
高频弹道/敌人/拾取物：从 ObjectPool 取出并重置
状态对象：StateMachine 通过 DiContainer 创建并缓存
```

例如，角色创建的已验证直接调用链为：

```text
GameManager.GeneratePlayerCharacter
  → CharacterFactory.GetCharacterPrefab
  → UnityEngine.Object.Instantiate
  → GameSessionData.ActiveCharacter = 新角色
  → DiContainer.InjectGameObject
  → GameManager.InitPlayerPhysics
  → CharacterController.InitCharacter
  → 加入物理 Group
  → 应用永久强化、 ascension 和皮肤修正
```

**关键设计点：** prefab 实例化并不等于初始化完成。依赖注入、数据初始化、物理注册和永久进度修正都在后续步骤中完成。

---

## 7. 核心协调类到底负责什么

### 7.1 `GameManager`：单局总协调者，而非单纯工具类

主要功能可分成七组：

1. **对局生命周期**  
   `InitializeGame`、`InitializeGameSession`、`InitializeGameSessionPostLoad`、`ResetGameSession`、`Cleanup`。

2. **角色创建与注册**  
   `GeneratePlayerCharacter`、`AddMainCharacter`、`AddLocalCharacter`、`AddFollower`、远程角色初始化。

3. **关卡协调**  
   `StageInit`、`PostStageInit`、在线关卡加载、相机和灯光设置。

4. **升级流程**  
   `HandleLevelUp`、`GetLevelUpChoices`、`FinishLevelUp`、`FinishLevelUpActions`、`LevelWeaponUp`。

5. **掉落与奖励创建**  
   `MakeGem`、`MakeCoin`、`MakeTreasure`、`MakePickup`、`MakeExplosion`。

6. **暂停、时间和 UI**  
   `PauseGame`、`ResumeGame`、Ticker、XP 更新、玩家 UI 和相机更新。

7. **多人分支**  
   权威、远程角色、在线升级、在线暂停、命令与连接错误。

其 `Construct(...)` 注入了二十多个服务，说明它是跨子系统协调点。

**评价：** 入口清晰，但职责明显过多。可以把它视为“单局应用服务 + 部分领域服务 + 部分表现协调”的混合体，而不是理想的纯领域模型。

### 7.2 `Stage`：关卡运行器

主要负责：

- 当前关卡和分钟数据：`InitStage`、`UpdateAllData`、`GetStageDataForMinute`、`UpdateMinuteData`。
- 刷怪：`HandleSpawning`、`SpawnEnemiesInOuterRect`、`SpawnEnemyUnit`、`SpawnBoss`。
- 敌人池：`UpdateEnemyPools`、`UpdateNormalEnemyPoolsOnly`。
- 地图和空间：`InitRects`、`UpdateRectPositions`、Tiled/Tiling 地图。
- 可破坏物和特殊物件：随机位置、视野外、指定位置生成。
- 事件和计时器：`StartTimers`、`UpdateTimers`、`PlayEvents`。
- 裁剪和资源：`UpdateCulling`、`PreloadAssets`、`UnloadAssets`、`Cleanup`。

`StageEventManager` 单独处理更复杂的关卡事件，避免所有事件脚本继续塞进 `Stage`。

### 7.3 `GameSessionData` 并没有装下整局状态

在当前版本中，这个类直接暴露的核心字段是 `ActiveCharacter`，并附带初始化/释放接口。

因此不要误以为“所有局内状态都在 GameSessionData”。实际状态分散在：

- `GameManager`：对局流程、角色集合、计时器和奖励创建；
- `CharacterController`：HP、XP、属性、装备和死亡；
- `Stage`：关卡时间、刷怪和地图；
- `PlayerOptions`：配置、永久进度和部分局内金币；
- 各 Manager：候选池、掉落表、Arcana 等。

这是理解代码时很重要的一点：**类名表达了意图，但不一定是完整的状态边界。**

---

## 8. 武器装备与自动攻击：完整代码链

### 8.1 `WeaponsFacade` 是装备操作入口

已验证 `WeaponsFacade.AddWeapon(...)` 中的关键调用包括：

```text
CharacterWeaponsManager.GetWeaponByType   查找已有武器
Equipment.IsMaxLevel                      检查满级等情况
LevelUpFactory.RemoveFromStore            从候选池处理
WeaponFactory.GetWeaponPrefab             获取行为 prefab
EquipmentManager.AddEquipment             加入角色装备集合
SignalBus.InternalFire                    发出装备变化信号
LevelUpFactory.CalculateWeights           重算升级候选权重
ArcanaManager.CheckSilent                 检查特殊规则
```

`RemoveWeapon(...)` 则查找武器并调用 `EquipmentManager.RemoveEquipment(...)`。

**Facade 的价值：** 调用方不需要分别操作工厂、角色集合、候选池、信号和 Arcana。

### 8.2 `EquipmentManager` 只负责集合，不负责所有装备规则

基类维护四份列表：

- `ActiveEquipment`
- `HiddenEquipment`
- `RemovedHiddenEquipment`
- `RemovedEquipment`

提供添加、移除、查找和批量升级。

`CharacterWeaponsManager` 额外负责：

- 武器更新；
- 武器启用/禁用和显示；
- 最大活跃/隐藏数量；
- 持有者升级通知；
- 按类型查找。

`CharacterAccessoriesManager` 负责被动的更新和多人死亡情况下的处理。

### 8.3 `Weapon` 是自动攻击公共模板

它把公共流程集中在基类：

- 当前等级数据；
- 开火/重复开火计时器；
- `Fire()` 和 `FireOneProjectile()`；
- 弹道池和已生成弹道；
- 暴击、穿透、反弹、范围、速度、持续时间；
- 对敌人、玩家、可破坏物和墙的命中回调；
- 伤害、进化、Limit Break、Arcana。

`Weapon.InitWeapon(...)` 中可以直接观察到 `BulletPool` 的创建。

`Weapon.InternalUpdate()` 直接读取 `PauseSystem.DeltaTime`，说明武器计时与自定义暂停时间体系相连。

### 8.4 从开火到回收的已验证链路

```text
Weapon.Fire / FireOneProjectile
  → BulletPool.SpawnAt
      → ObjectPool.GetObject / GetObjectComponent
      → 加入物理 Group
  → Projectile.InitProjectile
      → World.enableBody
      → 加入 Group
      → SpriteTrail.Reset
  → 子类设置运动方向、帧、缩放和音效
  → Weapon.OnBulletOverlapsEnemy
      → Projectile.HasAlreadyHitObject
      → 后续伤害调用（部分为虚调用）
  → Projectile.Despawn
      → 移出 Group 和活跃列表
      → ObjectPool.Release
```

这条链说明“池化”分布在几层：

- `BulletPool` 决定如何取弹和数量管理；
- `ObjectPool` 负责 Unity 对象复用；
- `Projectile` 负责自身物理、目标、命中记录和表现重置；
- `Weapon` 仍持有活跃弹道相关信息。

### 8.5 具体武器只覆盖差异

`KnifeWeapon` 本身很薄，主要差异位于 `KnifeProjectile.InitProjectile(...)`。该方法已验证会：

```text
调用 Projectile.InitProjectile 基类初始化
→ setFrame
→ SetScaleToArea
→ ApplyPlayerFacingVelocity
→ 播放音效
```

`WhipProjectile` 则额外设置缩放/透明度 Tween、翻转、排序和音效。

**核心设计：** 不要把 `Weapon` 子类薄理解为“没有逻辑”。很多公共逻辑在 `Weapon`，很多个性化逻辑又下沉到了 `Projectile`。

### 8.6 `Accessory` 的复用方式

`Accessory` 同样继承 `Equipment`，持有 `ModifierStats` 和当前 `WeaponData`，通过：

- `Init(...)`
- `Apply()`
- `ApplyToCharacter(...)`
- `LevelUp()`
- `Cleanup()`

把数值修正应用到角色。

**设计意义：** `WeaponType` 是统一装备 ID 空间，武器和被动可以共用升级候选、装备集合和数据结构；代价是该 ID 类型承载的含义较宽，不能看到 `WeaponType` 就认定它一定是主动武器。

---

## 9. 升级流程：规则、状态、UI 和应用选择

### 9.1 状态进入与退出

已验证：

```text
GameStateLevelUp.OnEnter
  → 订阅相关信号
  → GameManager.PauseGame
  → 播放音效及处理特殊 UI

GameStateLevelUp.OnExit
  → 取消信号订阅
  → GameManager.ResumeGame
```

因此“升级时暂停战斗”是状态生命周期的一部分，而不是按钮顺带调用。

### 9.2 候选生成由 LevelUpFactory 主导

`LevelUpFactory` 负责：

- 解锁内容进入候选池；
- 已拥有/新装备/满级判断；
- 权重计算与随机抽取；
- Reroll、Banish、Seal 和排除；
- 进化条件；
- 多人限制；
- 特殊武器条件。

`GameManager.GetLevelUpChoices(...)` 已验证直接调用：

- `LevelUpFactory.HasPowerupsInStore`
- `LevelUpFactory.GetLevelUpItems`
- `LevelUpFactory.GetLevelUpPowerups`
- `LevelUpFactory.FindFriendshipAmuletTargets`
- `LimitBreakManager` 的候选接口

`GetLevelUpPowerups()` 内部又直接调用：

- `GetRandomExistingWeapon`
- `CalculateWeights`
- `GetRandomWeightedWeapon`
- `GetRandomWeightedWeaponOrPowerUp`

**结论：** 主升级链的规则中心是 `LevelUpFactory`，不是 UI。

项目中另有 `RewardManager.GetLevelUpRewards()`，它可生成包含装备、食物和金币的 `Reward` DTO 列表；但在本次验证的主要本地升级链中，直接协调者是 `GameManager + LevelUpFactory`。不要把所有奖励相关类强行串成唯一一条调用链。

### 9.3 UI 负责展示与交互

`LevelUpPage` 持有 `LevelUpFactory`、`DataManager`、`GameSessionData` 等服务引用。

`Populate()` 已验证会调用：

- `PickItemLevelUps`
- `PickRandomLevelUps`
- `SpawnWeapon`
- `SpawnItem`
- `SpawnLimitBreak`

`SelectWeapon(...)` 会锁定选择控件，并根据离线/在线情况：

- 离线：进入 `GameManager.FinishLevelUpActions(...)`；
- 在线：通过 Coherence 发送命令。

### 9.4 最终应用装备

已验证：

```text
LevelUpPage.SelectWeapon
  → GameManager.FinishLevelUpActions
      → GameManager.LevelWeaponUp
          ├─ AccessoriesFacade.AddAccessory
          └─ WeaponsFacade.AddWeapon
      → 播放音效
```

所以完整分工是：

```text
GameStateMachine：现在进入/退出升级流程
GameManager：协调候选、完成和联机分支
LevelUpFactory：合法候选与权重规则
LevelUpPage：展示、按钮和玩家选择
WeaponsFacade / AccessoriesFacade：应用装备变化
CharacterController / Equipment：属性和等级变化
```

`CharacterController.LevelUp()` 本身还会获取当前等级角色数据、应用属性成长，并通知 `CharacterWeaponsManager.NotifyOwnerLevelUp()`。

---

## 10. 敌人、关卡与死亡奖励

### 10.1 分钟更新是数据到运行的固定转换点

`Stage.UpdateMinuteData()` 的已验证调用顺序包括：

```text
ResetStageDataForUpdate
→ GetValidUnlockedStages
→ GetStageDataForMinute
→ JSON 转换为当前配置对象
→ UpdateEnemyPools
→ UpdateTimers
→ PlayEvents
```

这说明分钟切换不是只改一个刷怪数字，它会同时影响敌人池、计时器和关卡事件。

### 10.2 敌人取得和初始化

`Stage.SpawnEnemyUnit(...)` 已验证会：

- 处理在线/离线分支；
- `ObjectPool.GetObject` / `GetObjectComponent`；
- 检查池总量并按需 `Populate`；
- 在特定失败路径 `Release` 对象。

`EnemyFactory` 负责按 `EnemyType` 建立和维护池，`EnemyController.InitEnemy(...)` 负责运行时初始化。

### 10.3 普通敌人和 Boss 的扩展方式

`EnemyController` 提供通用：

- 数据初始化、技能和移动；
- 受伤、击退和表现；
- 死亡、奖励和死亡动画；
- 冻结、减速和复活类状态；
- 回收与网络权威。

`EnemyControllerBoss` 在此基础上增加：

- 周期生成子弹、随从、包围圈和波次；
- 伤害区域；
- 武器、道具、遗物和宝箱掉落；
- Boss 死亡表现。

特殊 Boss 再继承 Boss 基类。

### 10.4 受伤、死亡、奖励和回收是不同阶段

已验证：

```text
EnemyController.GetDamaged
  → DamageNumberManager.CreateDamageNumber
  → PlayHitSfx
  → GameManager.ShowHitVfxAt
  → 后续伤害处理（含虚调用）
```

`EnemyController.Die_param(...)` 直接调用：

```text
GiveReward
→ PlayDeathAnimation
```

`GiveReward(...)` 直接连接：

- `GameManager.MakeGem`
- `GameManager.MakeCoin`
- `GameManager.MakeTreasure`
- `GameManager.MakeFrozenSoul`
- `PlayerOptions.TrackEnemyKill`
- `MainGamePage.UpdateKills`
- 最近击杀记录

最终 `EnemyController.Despawn()` 会：

```text
杀死 Tween
→ 移出物理 Group
→ 销毁 Body
→ 取消 Timer
→ 处理渲染状态
→ FireKilledSignal
→ ObjectPool.Release
```

**设计价值：** 奖励生成、死亡表现和最终回池分开，避免“死亡动画还没结束，对象就被拿去复用”。

**设计代价：** `GiveReward` 直接更新 `MainGamePage`，说明规则层与表现层仍有耦合，不是严格的分层架构。

---

## 11. 碰撞、拾取和高频更新

### 11.1 `PhysicsManager` 管组间规则

它维护玩家、敌人、子弹、拾取物、磁铁、可破坏物、门等 `PhysicsGroup`，并配置：

- 玩家与敌人重叠；
- 玩家与拾取物重叠；
- 磁铁与拾取物重叠；
- 子弹与门重叠；
- 敌人之间碰撞开关。

已验证玩家碰到拾取物时：

```text
PhysicsManager.OnPlayerOverlapsPickup
  → PhysicsManager.TakePickup
```

具体拾取效果部分通过虚调用和具体 `Pickup` 子类完成。

### 11.2 `PickupManager` 是静态外观 + 注入工厂

`PickupManager` 自身接收 `PickupFactory`，但大量公开方法是静态：

- `CreatePickup`
- `ReturnPickup`
- `RemovePickup`
- `AddPickup`
- `Cleanup`
- `GetPool`
- 查询世界中的武器/遗物/道具

`GameManager.MakePickup(...)` 已验证会调用 `PickupManager.CreatePickup(...)`，并针对 `PickupWeapon`、`PickupRelic` 等设置具体类型。

这是一种生产项目常见的混合设计：依赖注入负责初始化，静态外观方便大量旧代码调用。它方便，但会增加测试隔离和生命周期追踪难度。

### 11.3 敌人移动局部使用 Jobs/Burst

`EnemiesManager` 内部存在：

```text
[BurstCompile]
EnemyVelocityCalcJob : IJobParallelFor
```

输入使用 `NativeArray` 保存：

- 位置；
- 速度；
- 移速；
- 固定方向；
- 当前方向；
- 目标；
- 暂停状态。

`RunMovementJob()` 中可观察到 `IJobParallelFor` 初始化。

**准确结论：**

- 敌人仍是 `EnemyController` 等 Unity 对象；
- 游戏规则仍主要由普通 C# 和 MonoBehaviour 实现；
- 批量移动这个热点被单独转成 Jobs/Burst；
- 这不是“全项目 ECS”，而是**对象模型上的局部数据并行优化**。

### 11.4 空间查询和池共同减少成本

`ArcadePhysics / World` 提供：

- 矩形、圆形、线段重叠；
- Group 间碰撞；
- 动态/静态 Body；
- 分组 R-tree 和静态 R-tree；
- `update / step / postUpdate`。

对象池减少创建销毁，空间树减少候选数量，Jobs 加速批量移动，Stage 裁剪减少视野外工作。它们是不同层面的优化，不能互相替代。

---

## 12. 数据、资源、存档和异步设计

### 12.1 数据加载链

```text
DataManagerSettings 持有 TextAsset 引用
→ DataManager 读取 JSON 为 JObject / JArray
→ 合并基础游戏、DLC 或自定义数据
→ 转换为 Dictionary<类型 ID, List<Data>>
→ Gameplay / Factory / Reward 等系统使用
```

`BuildConvertedData()` 已验证会触发：

- `GetConvertedCharacterData`
- `GetConvertedStages`
- `GetConvertedWeapons`
- `GetConvertedEnemyData`
- `GetConvertedPowerUpData`

数据类大多是普通 `[Serializable]` 类型，适合 JSON 转换；工厂则多为 `SerializedScriptableObject`，适合在 Unity 中保存 prefab 映射并执行引用校验。

### 12.2 对局资源加载由 GameplayLoader 组织

`GameplayLoader` 分为：

- `Preload(...)`：图块、角色、敌人；
- `Load(...)`：贴图、音乐、角色、视频等；
- `Release()`：释放本局资源。

它根据 `StageData` 和玩家选择决定需要哪些资源。

`CharacterLoader` 和 `EnemyLoader` 进一步根据角色、关卡、Boss 和事件收集实际需要的贴图，而不是加载所有内容。

### 12.3 AddressableCache 管句柄和释放组

缓存区分：

- PersistentOperationHandles
- DynamicOperationHandles
- DynamicLocationOperationHandles
- CustomOperationHandles
- TextureCache

并提供按自定义组、键、持久/动态类别释放的方法。

**设计意义：** Addressables 的难点不只是异步加载，而是“谁拥有句柄、何时释放、按哪一组释放”。这个项目用缓存分组明确管理生命周期。

### 12.4 存档与运行状态分开

`PlayerOptions` 是服务，持有 `PlayerOptionsData` 并提供 `Save()`；`SaveSystem` 是静态读写入口，配套：

- `SaveParser`
- `SaveSerializer`
- `Migrator`
- `SaveUtils`
- 平台存储适配

存档围绕明确的数据对象，而不是直接序列化 Gameplay 场景。

### 12.5 项目同时存在多种异步风格

可以观察到：

- Coroutine：`IEnumerator`、场景等待、部分角色初始化；
- UniTask：预加载等异步入口；
- 回调：大量 `Action onComplete`；
- `AsyncLoader`：聚合一组回调式加载任务；
- Addressables：`AsyncOperationHandle`；
- 联机命令：Coherence 命令与状态同步。

**评价：** 这是长期演进的实际项目，不是统一的异步框架范本。阅读时必须确认“完成回调在哪里执行、对象是否已释放、场景是否已切换”。

---

## 13. 这套代码设计的优点与问题

### 13.1 优点

1. **垂直链路可辨认**  
   数据、工厂、Facade、运行对象和池之间虽然类多，但链路明确。

2. **公共行为提取有效**  
   武器和弹道基类承载大量公共逻辑，使简单内容只需覆盖差异。

3. **规则不只写在 UI 上**  
   升级候选、进化、Banish、权重等有独立服务。

4. **高频生命周期考虑完整**  
   死亡表现和最终回池分开，物理、Tween、Timer、Group 都有清理路径。

5. **性能优化有针对性**  
   池、空间树、裁剪、ProfilerMarker、局部 Jobs/Burst 分别解决不同热点，没有为了潮流全量重写 ECS。

6. **内容扩展有完整路径**  
   类型 ID、JSON、工厂、资源加载、DLC 和校验共同支撑扩展。

### 13.2 主要设计债务

1. **GameManager 过大**  
   对局、角色、奖励、升级、UI、相机和联机集中在一个协调类中。

2. **Controller 职责混合**  
   `CharacterController` 同时处理输入、移动、属性、装备、伤害、死亡、表现和网络。

3. **静态入口与 DI 混合**  
   `PhysicsManager.Instance`、`PickupManager` 静态方法、`SaveSystem`、`SoundManager` 等与注入并存。

4. **规则层仍直接调用表现层**  
   例如敌人奖励直接更新 MainGamePage 的击杀数。

5. **管理器粒度不统一**  
   `LevelUpFactory` 是候选规则服务，`WeaponFactory` 是 prefab 注册表，`GameManager` 是总协调者，不能只凭后缀判断职责。

6. **状态分布广**  
   `GameSessionData` 并未统一整局状态，排错需要跨多个管理器和 Controller。

7. **继承规模带来的特殊case压力**  
   大量内容子类可以快速扩展，但特殊能力也容易不断进入公共基类，使 `Weapon` 等基类持续膨胀。

8. **异步与联网分支增加理解成本**  
   同一流程常有本地/在线两套路径，再叠加回调、Coroutine、UniTask 和命令。

---

## 14. 推荐的代码阅读顺序

### 路线 A：先理解整个游戏怎样开始

```text
CoreInstaller / GameInstaller / FactoriesInstaller
→ AppStateMachine
→ GameStateMachine
→ GameManager.InitializeGameSession
→ GameManager.GeneratePlayerCharacter
→ Stage.InitStage / InitStagePostLoad
```

目标：弄清服务在哪里连接、角色如何创建、对局何时算准备完成。

### 路线 B：读通一把武器

```text
WeaponData
→ WeaponFactory
→ WeaponsFacade.AddWeapon
→ EquipmentManager / CharacterWeaponsManager
→ Equipment
→ Weapon
→ BulletPool
→ Projectile
→ KnifeProjectile 或 WhipProjectile
→ PhysicsManager / IDamageable
```

**不要先读 `KnifeWeapon` 并期待看到完整飞刀逻辑。** 它很薄，关键在基类和 `KnifeProjectile`。

### 路线 C：读通一次升级

```text
GameStatePlaying.LevelUp
→ GameStateLevelUp.OnEnter / OnExit
→ GameManager.GetLevelUpChoices
→ LevelUpFactory
→ LevelUpPage.Populate / SelectWeapon
→ GameManager.FinishLevelUpActions
→ GameManager.LevelWeaponUp
→ WeaponsFacade / AccessoriesFacade
```

目标：分清“流程状态、候选规则、UI、最终应用”四种职责。

### 路线 D：读通敌人从生成到回收

```text
StageData
→ Stage.UpdateMinuteData
→ EnemyFactory
→ Stage.SpawnEnemyUnit
→ EnemyController.InitEnemy
→ EnemyController.GetDamaged / Die_param / GiveReward / Despawn
→ PickupManager
→ ObjectPool
```

再读 `EnemiesManager.EnemyVelocityCalcJob`，理解为什么移动热点被单独批处理。

### 路线 E：最后研究支撑系统

- 资源：`GameplayLoader → CharacterLoader / EnemyLoader → AddressableCache`
- 存档：`PlayerOptions → PlayerOptionsData → SaveSystem → Migrator`
- DLC：`DlcCatalog / DlcSystem / DlcLoader / DataManager.MergeInJsonData`
- 多人：最后再进入 `Coherence.Generated` 和各 Online 分支

---

## 15. 对 Robber&Dungeon 的具体启示

### 15.1 应该吸收的结构

- `WeaponDefinition`：稳定配置，与运行实例分离。
- `WeaponsFacade` 式的明确入口：装备、移除、掉落和拾取不能散落为任意节点互改。
- `EquipmentManager` 的集合概念：但要增加你需要的原子转移规则。
- `Weapon` 公共行为：自动攻击只写一份，玩家和精英共用。
- `Projectile` 的命中与生命周期：目标、命中记录和回收边界清晰。
- `Stage` 的数据到运行转换：以后再扩展刷怪时间表，不影响 P0。
- 死亡表现与最终回收分开：避免旧对象残留引用。

### 15.2 不应照抄的边界

VS 的 `Equipment.Owner` 是 `CharacterController`，并另有 `EnemyWeapon / EnemyProjectile / EnemyBulletPool`。

你的核心需求不同：

```text
玩家和精英必须共用 WeaponDefinition / Instance / Behavior / Slot
```

因此持有者应抽象成共享的战斗持有者上下文，差异放在：

- 阵营；
- 目标选择；
- 输入或 AI；
- 表现绑定。

不要复制两套武器逻辑。

### 15.3 你的武器转移需要比 VS 装备集合更强的不变量

`EquipmentManager.Add/Remove` 的集合思路不足以直接表达“抢武器”。你的转移入口应保证：

```text
同一武器实例：
角色槽位与世界地面二选一
转移成功后才改变可见性和碰撞
重复死亡/拾取不会复制实例
旧持有者的计时器、目标和信号全部失效
新持有者使用同一行为继续运行
```

### 15.4 当前不需要引入的复杂度

- 全量 Addressables 分组；
- DLC 合并；
- Coherence 式联网；
- 自制物理和完整 ECS；
- 大量静态 Manager；
- 无测量依据的 Jobs/池化框架。

P0 的正确目标仍是验证“被抢后想夺回”，不是先建立一个能承载五百种武器的商业项目框架。

---

## 16. 核心类速查表

| 想修改什么 | 首先看这些类 |
|---|---|
| 对局开始/重开 | `GameManager`、`GameplayLoader`、`GameStateInitializing` |
| 角色生成 | `CharacterFactory`、`GameManager.GeneratePlayerCharacter`、`CharacterController.InitCharacter` |
| 武器数值 | `WeaponData`、`DataManager`、对应 JSON |
| 添加/移除武器 | `WeaponsFacade`、`CharacterWeaponsManager`、`EquipmentManager` |
| 攻击节奏 | `Weapon`、TimerSystem、PauseSystem |
| 飞刀/鞭子运动与表现 | `Projectile` 及对应具体 Projectile |
| 命中与伤害 | `PhysicsManager`、`Weapon`、`Projectile`、`IDamageable` |
| 升级候选 | `LevelUpFactory`、`GameManager.GetLevelUpChoices` |
| 升级界面 | `LevelUpPage`、`GameStateLevelUp` |
| 被动效果 | `Accessory`、`AccessoriesFacade`、`PlayerModifierStats` |
| 分钟刷怪 | `StageData`、`Stage.UpdateMinuteData`、`EnemyFactory` |
| Boss | `EnemyControllerBoss` 及具体 Boss 子类 |
| 敌人死亡奖励 | `EnemyController.Die_param / GiveReward / Despawn` |
| 掉落和拾取 | `GameManager.MakePickup`、`PickupManager`、`Pickup` |
| 批量移动性能 | `EnemiesManager.EnemyVelocityCalcJob` |
| 资源加载释放 | `GameplayLoader`、`AddressableCache`、`ScenePreloader` |
| 永久进度与存档 | `PlayerOptions`、`PlayerOptionsData`、`SaveSystem` |
| 联机 | `MultiplayerManager`、各 Online 分支、`Coherence.Generated` |

**一句话总结：** 这套代码的真正骨架不是数量庞大的武器和敌人类，而是“状态机控制流程、DataManager 提供配置、Factory 选择实现、Facade 协调变更、运行基类实现行为、Pool/Physics/Jobs 支撑高频执行”。
