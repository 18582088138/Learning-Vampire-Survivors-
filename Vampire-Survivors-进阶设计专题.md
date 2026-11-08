# Vampire Survivors 进阶设计专题：玩法、反馈与生产管线

> 本文补充《架构分析》和《代码结构与核心功能导读》中未充分展开的设计。
> 重点不是继续罗列类名，而是分析：**解决什么问题、怎样实现、为什么有效、哪些部分不宜照搬。**

## 0. 最值得补充学习的内容

除了状态机、数据驱动、武器基类、工厂和对象池，这个项目还有以下值得研究的设计：

1. 属性修正与永久强化分层；
2. 进化条件、构筑控制和特殊能力钩子；
3. 成就、解锁、退款与平台奖励；
4. 关卡变体和事件调度；
5. 掉落、磁吸与经验宝石压缩；
6. 打击停顿、音效限流和表现预算；
7. 独立随机流与可复现性；
8. 循环地图、包裹坐标和视野裁剪；
9. 内容校验、运行时导入与稳定 ID；
10. 联机权威、模拟帧与配置快照；
11. 自动化输入和性能测试支撑。

**先给 Robber&Dungeon 的结论：** 当前 P0 仍处于“技术原型完成，待真人体验验收”，不应因为这些设计有趣就立刻扩张玩法。现在最值得吸收的是低成本工程原则：随机流分离、属性来源分离、表现与规则分离、引用校验和自动化入口。

---

## 1. 属性修正：不要让每个系统直接覆盖最终数值

### 1.1 VS 的实现

`ModifierStats` 把可修正属性集中起来，包括：

- Power、Area、Speed、Duration、Cooldown、Amount；
- MaxHp、Armor、Regen、MoveSpeed；
- Growth、Luck、Greed、Curse；
- Revivals、Rerolls、Skips、Banish；
- Thorns、Shields、Fever 等特殊属性。

它提供：

- `ResetStats()`
- `Upgrade(ModifierStats other, bool multiplicativeMaxHp = false)`
- 整体乘法运算符

`PlayerModifierStats` 在此基础上增加 `Set(...)` 和局内属性存储。`CharacterController.PlayerStatsUpgrade(...)` 已验证会调用：

```text
PlayerModifierStats.Upgrade
→ MagnetZone.RefreshSize
```

最后一项很重要：属性变化后，依赖该属性的磁铁范围也要刷新。最终属性不是只用于 UI 展示，而要同步到实际行为对象。

永久强化则有另一条路径：

```text
GameManager.ApplyPurchasedPowerUpData
→ PlayerStats.GetOwnedPowerUps
→ GameManager.ApplyPlayerStat
```

### 1.2 保留修正来源，而不只是一个总和

`EggFloat` 和 `EggDouble` 内部同时保存：

```text
_val      普通值
_eggVal   Golden Egg 带来的特殊修正值
```

并提供加减乘除、隐式取值和上限处理。

这里最值得学习的不是 Egg 类型本身，而是**来源分离**：如果永久强化、局内装备、临时增益、特殊收藏品全部直接加进同一个 float，后续退款、移除装备、重开和结算时就很难正确还原。

可以把概念模型理解为：

```text
最终属性 = f（角色基础值, 永久强化, 局内装备, 临时效果, 特殊规则）
```

这只是学习用模型，不是原游戏的具体公式。不同属性的加法、乘法、上下限和计算顺序可能不同；`Upgrade` 对 MaxHp 单独提供乘法参数，也说明不能假设所有属性采用同一种算法。

### 1.3 为什么值得学

- 装备移除时可以按来源撤销；
- 重开一局时可以只清局内修正；
- 退款和重置永久强化不会误删角色基础值；
- 特殊规则可以有明确优先级和上下限；
- UI 能解释“这个数值为什么变成这样”。

### 1.4 对你的建议

**现在：** 不需要立即建立几十种属性的通用 Stats 框架。只需避免 `WeaponDefinition` 在运行时被直接改写，把静态定义和局内修正分开。

**以后增加升级时：** 再引入明确的 Modifier 列表和重算入口，并测试：

- 添加和移除是否可逆；
- 重复应用是否幂等；
- 计算顺序是否固定；
- 重开后临时修正是否清零；
- 修改 Magnet 等属性后，实际行为组件是否刷新。

---

## 2. 构筑设计：进化图、随机控制和特殊能力钩子

### 2.1 进化不是简单的“满级换 prefab”

`WeaponData` 中包含多类关系字段：

- `evoInto`、`evolvesFrom`、`evolutionLine`；
- `evoSynergy`；
- `requires`、`requiresMax`；
- `hasUniqueRequirements`；
- `addEvolvedWeapon`、`addNormalWeapon`、`excludeWeapon`；
- `skipRemovingBaseWeapon`。

`LevelUpFactory` 提供：

- `GetAvailableEquipmentForEvolution`
- `HasPotentialEvolution`
- `HasEvolutionRequirements`
- `CheckUniqueRequirements`
- `PullEvolution`

这形成了一个**构筑规则图**：

```text
当前武器等级
+ 指定被动/其他武器
+ 是否满级
+ 特殊条件
+ 是否保留或替换原装备
= 是否允许进化、进化成什么
```

普通条件交给数据，真正特殊的条件由命名明确的代码处理。这比“所有规则写死”容易扩展，也比过早发明一套复杂规则 DSL 更务实。

### 2.2 用玩家控制降低纯随机的挫败感

`LevelUpFactory` 同时支持：

- Reroll：重抽；
- Banish：从后续候选中排除；
- Seal：封存特定内容；
- Skip：跳过；
- 已有装备和新装备的权重调整；
- 满级、解锁、多人限制和进化条件过滤。

`WeaponsFacade.AddWeapon` 已验证会在装备变化后调用 `CalculateWeights()`，说明候选池不是开局算一次就不变，而是随构筑变化更新。

**设计价值：** 随机提供变化，Banish/Reroll 等机制提供主动权。玩家不是只被动接受随机结果，而是在管理本局的概率空间。

### 2.3 特殊能力通过领域事件钩子插入

`ArcanaManager` 有统一入口：

- `OnWeaponFired`
- `OnFoodPickedUp`
- `OnPlayerLevelUp`
- `OnPlayerHPRecovery`
- `OnPlayerHPDamage`
- `OnPlayerLastBreath`
- `OnPlayerCriticalHPTreshold`

`CharacterSkillCard_Base` 也把特殊能力拆成可覆盖方法：

- `InitialActivate`
- `OnOwnerLevelUp`
- `OnOwnerGetDamaged`
- `OnOwnerRevived`
- `OnOwnerLastBreath`
- `OnOwnerWeaponMadeLevelOne`
- `Update`

这比每个武器、敌人和 UI 都直接知道每张卡的效果更容易扩展。

### 2.4 不应照搬的部分

`ArcanaManager` 同时持有许多具体武器字段、静态数值和特殊规则，说明“统一钩子”也可能演变成新的大型耦合点。

**更好的迁移方式：**

```text
会话提供少量明确领域事件
每个特殊能力实现自己的处理器
能力注册/注销与单局生命周期一致
```

不要让所有特殊能力继续注册到一个永久全局事件总线，也不要预先设计几十种“也许以后有用”的钩子。等第一种真实能力出现时，再定义它需要的事件。

---

## 3. 元进度：成就、解锁、奖励和退款

### 3.1 永久强化是一项独立服务

`PlayerStats` 负责：

- `GetOwnedPowerUps`
- `GetAllPowerUps`
- `GetPrice`
- `GetRefundAmount`
- `GetTotalPrice`
- `ApplyMarkup`
- `ResetPowerUps`

`PowerUpData` 包含价格、解锁阶位、是否可解锁等配置。

**设计价值：** 购买价格、退款和价格增长不是按钮里的计算公式，而是可以独立验证的规则。

### 3.2 成就数据把三种关系放在一起

`ACHIEVEMENT_DATA` 中有 213 个条目。以 `ReachLV5` 为例，它包含：

```json
{
  "description": "Reach Level 5.",
  "weaponToUnlock": "MOVESPEED",
  "UnlockConditions": [
    {
      "AchievementUnlockType": "ReachedXLevel",
      "RequiredLevel": 5
    }
  ],
  "PlatformsData": [
    { "Platfrom": "Steam", "Data": "ReachLV5" },
    { "Platfrom": "GameCore", "Data": "1" }
  ]
}
```

这一条数据同时描述：

1. **游戏内条件**：达到 5 级；
2. **游戏内奖励**：解锁 MOVESPEED；
3. **平台成就映射**：Steam、GameCore 等平台使用什么 ID。

`AchievementManager` 则分别处理：

- 条件检查：等级、击杀、生存时间、角色、武器、物品等；
- `UnlockAchievementsAndGiveRewards`；
- 启动时成就检查；
- 秘密与收藏进度。

### 3.3 为什么值得学

- 新增成就主要增加数据，而不是修改多个 UI 和存档类；
- 游戏内解锁与平台成就可以共享条件，但奖励处理分开；
- 启动检查能补救历史存档中“条件已满足但尚未解锁”的情况；
- 解锁入口可以集中做幂等和存档处理。

### 3.4 对你的建议

这类系统适合在核心循环已经证明有趣之后研究。你的“夺回武器”首先应验证情绪价值，不应靠成就和永久强化来弥补核心交互尚不明确的问题。

---

## 4. 关卡变体和事件调度

### 4.1 用修饰器复用同一关卡

`StageData` 同时包含：

- `mods`
- `hyper`
- `inverse`

它们使用 `StageModifiers` 描述时间、速度、生命、金币、经验和其他变化。

**设计价值：** Hyper/Inverse 不必复制整张地图和完整刷怪表，而是在共同内容之上叠加变化。

类似思路也可用于：

- 角色皮肤共享控制器，但覆盖数据和表现；
- 武器进化共享基础行为，但覆盖数值或少量差异；
- 挑战模式共享关卡，附加规则修饰。

**注意：** 修饰器越多，叠加顺序越重要。应在文档和测试中明确基础值、模式修正、临时修正的优先级。

### 4.2 关卡事件是“调度数据 + 行为脚本”

`Event` 数据包含：

- `eventType`
- `delay`
- `repeat`
- `moreX`
- `moreY`
- `moreZ`
- `minPlayersNeeded`

`Stage.UpdateMinuteData()` 已验证会调用 `PlayEvents()`。`StageEventManager.TriggerEvent(...)` 会解析事件类型、进入 `TriggerSwitchEvent(...)` 并注册计时器。

事件实现既有通用模式：

- 圆形、包围、方向生成；
- 普通敌人群和 Boss；
- 清除敌人、生成物品；

也有带协程和回调的特殊事件。

### 4.3 资源预加载也考虑事件依赖

`StageEventManager` 提供：

- `ResolveAndWarmEnemyType`
- `CollectSpawnableEnemyTypes`

`EnemyLoader` 也会从 StageEvent 中收集敌人。

这是很重要的生产设计：**事件运行时才需要某个敌人，不代表可以那时才加载它。** 在加载阶段分析未来事件依赖，可以避免战斗中突然加载资源造成卡顿。

### 4.4 不建议复制弱类型参数

`moreX/moreY/moreZ` 很灵活，但调用者难以从名字知道含义，`object moreY` 还需要运行时转换。

你的 Godot 事件配置更适合：

- 一个小型 `StageEventData : Resource` 基类；
- 或按事件类型使用明确字段；
- 至少使用 `enemy_type`、`count`、`duration`、`pattern` 等有语义的名称。

学习“调度与执行分离”，不要复制模糊参数名。

---

## 5. 掉落与经验经济：掉落表、磁吸和宝石压缩

### 5.1 掉落表是独立规则

`LootManager` 支持：

- 默认掉落表；
- 添加物品；
- 重新计算权重；
- 自定义掉落表；
- `GetRandomWeightedItem(Nullable<Random> rng)`。

最后一项还表明，调用方可以传入特定随机数生成器，而不是只能使用一个不可替换的全局随机源。

### 5.2 磁吸是行为切换，不是每帧让所有道具找玩家

`MagnetZone` 持有目标角色和 `Radius`。`PhysicsManager` 配置磁铁与拾取物的重叠回调。

`Pickup` 则有：

- `_goToPlayer`
- `_targetPlayer`
- `_vacuumTween`
- `Vacuum(...)`
- `GoToThePlayer()`

可以把它理解为：

```text
进入磁吸范围
→ 标记目标并启动吸附行为
→ 只有被激活的 Pickup 需要向玩家移动
→ 到达后执行拾取和回收
```

全屏吸取和局部磁吸也应区分：一个是临时效果，一个是持续范围规则。

### 5.3 经验宝石有专门的数量压缩机制

`GameManager` 中有：

- `_gemPool`
- `SpawnGems()`
- `CondenseGems(int maxGems = 400)`
- `MakeGemIgnoreAllTheLimits(...)`
- `ReturnGem(...)`

已验证：

- `SpawnGems()` 会调用 `CondenseGems()`；
- `CondenseGems()` 会按距离排序并调用 `Gem.SetValue(...)`；
- `SpawnGems()` 还会处理最远对象、从池中取对象并重新设置价值；
- `ReturnGem()` 最终调用 `ObjectPool.Release()`。

这说明它不只是限制生成数量，还会**重新分配宝石所承载的经验价值**。设计意图是控制同屏 Pickup 数量，同时尽量避免经验经济被简单的数量上限破坏。

具体求和和舍入规则仍需完整方法体才能逐条证明，但“数量压缩 + 价值重写 + 池复用”的组合是明确存在的。

### 5.4 对你的建议

P0 不需要提前实现宝石压缩。未来经验物过多时，应按以下顺序处理：

1. 先测量主要成本来自节点、物理、脚本还是渲染；
2. 再限制不必要的屏外更新；
3. 然后考虑池化；
4. 最后才做经验合并，并用测试证明经验总量和拾取结果符合设计。

---

## 6. 打击感：时间、音效和表现都需要预算

### 6.1 Hit Stop 必须有独立的结束时间

`GameManager.FrameFreeze(...)` 默认时长为 120ms，并允许选择是否暂停 Tween。

其实现中有：

- `_frameFreezeTimer`
- `_frameFreezeRealEndTime`
- `_frameFreezeActive`
- `EndFrameFreeze()`

已验证 `FrameFreeze()` 使用 `TimerHelper.RegisterMillisUI(...)` 注册结束计时，而 `EndFrameFreeze()` 调用 `PauseSystem.RunThenResume(...)`。

**关键设计：** 如果战斗暂停后，结束停顿的计时器也一起暂停，游戏可能永远无法恢复。因此停顿结束需要独立于战斗暂停的时间通道。

### 6.2 音效需要限流

`SoundManager.PlaySoundNonAlloc(...)` 提供：

- `maxInstances`，默认 10；
- 音量、Rate、Detune；
- Loop、Delay；
- `HandlePlaybackSkipping(...)`。

它还处理音效加载、播放计数、计时器和音高。

**设计价值：** 大量敌人同时受击时，如果每个命中都无限制播放音效，不但成本高，还会变成难以分辨的噪声。实例上限和播放跳过同时服务于性能与听感。

### 6.3 表现与规则分离

`DamageNumberManager.CreateDamageNumber(...)` 通过事件通知表现层；`ParticleManager` 注册粒子并维护暂停列表。

**建议采用的处理顺序：**

```text
规则层确认伤害/死亡/拾取已发生
→ 发出带必要上下文的表现事件
→ 音效、数字、震动、Tween 自行决定如何呈现
→ 表现随机不得改变玩法随机序列
```

VS 仍有静态事件和规则层直接调用 UI 的情况，所以应学习其反馈拆分意识，而不是复制所有调用方式。

### 6.4 对你的建议

P0 可以优先保证“武器被捡走、精英反用、杀回夺回”有清楚可区分的反馈。先让玩家理解发生了什么，再讨论更复杂的震屏、顿帧和粒子。

---

## 7. 随机数：按用途拆分随机流

### 7.1 VS 中的独立种子和 Random

`OnlineStageManager` 分别保存：

- `RandomEventsSeed`
- `MinorArcanasSeed`
- `SurvarotsSeed`
- `UiPageSeed`
- `ShopSeed`

并为部分用途维护独立 `Random`：

- `_minorArcanasRng`
- `_survarotsRng`
- `_uiPageRng`
- `_shopRng`

其他例子：

- `CharacterController.RandomEnemyPickerSeed`
- `CharacterController.FollowerLevelUpShuffleSeed`
- `EnemyController._deathSeed` / `_deathRng`
- `EnemyControllerBoss._damagingZoneSeed`
- `Destructible._deathSeed` / `_deathRng`

### 7.2 为什么随机流要分开

如果所有系统共用一个 Random：

```text
商店多抽一次
→ 后续升级随机结果改变
→ 敌人掉落也改变
→ 同一个种子无法稳定复现原问题
```

独立随机流能降低这种无意耦合：

```text
LootRng       只影响掉落
UpgradeRng    只影响升级候选
SpawnRng      只影响刷怪
ShopRng       只影响商店
VisualRng     只影响粒子、音效变化等表现
```

这样对某一系统增加一次随机调用，不一定会改变另一个系统的结果，也更容易做回归测试和联机同步。

### 7.3 VS 自身也并非完全统一

定向调用中可以观察到 `StageEventManager.TriggerSwitchEvent(...)` 直接使用 `UnityEngine.Random.value`。

因此不能把这个项目描述成“全游戏严格可复现”。正确学习方式是吸收其独立种子设计，同时在自己的核心玩法中执行得更一致。

### 7.4 对你的建议

这是**当前就值得坚持**的原则，与你项目已有约束完全一致：

- 每个玩法域使用可注入的 `RandomNumberGenerator`；
- 会话记录必要种子；
- 表现随机与玩法随机分离；
- 测试可以固定种子复现；
- 不要为了随机感在规则代码中到处调用全局 `randf()`。

P0 不需要联网级种子同步协议，但可以保留清晰的随机边界。

---

## 8. 连续地图：Tiling、Wrapped 查询与裁剪

### 8.1 地图不是无限创建下去

`TilingTileset` 包含：

- `GenerateMaps()`
- `ProcessTiling()`
- `UpdateHorizontalTilesetOnTeleport(...)`
- `UpdateVerticalTilesetOnTeleport(...)`
- `UpdatePhaserTilemapBounds()`
- `IsPointWithinCollisionLayerWrapped(...)`

`ProcessTiling()` 已验证会根据玩家/多人状态处理横向、纵向更新，并刷新物理地图边界。

`TilingBackground` 则根据相机中心设置滚动偏移。

### 8.2 地图循环必须与玩法对象配合

相关接口还包括：

- `Stage.UpdateCulling()`
- `EnemyController.OnTeleportOnCull()`
- `Pickup.SafeXYWrapped()`
- `TilingTileset.IsPointWithinCollisionLayerWrapped(...)`

这说明“无限地图”不是单纯让背景重复，而是一组协同规则：

```text
地图块循环
+ 敌人/道具裁剪或重定位
+ 碰撞查询使用包裹坐标
+ 物理边界同步更新
+ 生成位置避免墙体和无效区域
```

### 8.3 不要误解为浮动原点方案

这些证据支持 tiling 和包裹坐标，不足以证明它采用了完整的 Floating Origin 浮点精度方案。两者解决的问题不同：

- Tiling：让世界看起来连续；
- Floating Origin：避免远离世界原点后的浮点精度问题。

### 8.4 对你的建议

P0 固定竞技场完全不需要这一层。未来若做连续地图，先明确：

- 哪些对象循环，哪些对象必须全图唯一；
- 被夺武器是否允许被传到地图另一侧；
- 玩家追踪目标在包裹坐标中如何计算最近方向；
- 物理、AI、UI 小地图是否使用同一套坐标规则。

你的“夺回目标”玩法会使循环地图的归属与指引更复杂，不能只复制背景 tiling。

---

## 9. 内容生产管线：校验、稳定 ID 和运行时导入

### 9.1 工厂自带引用校验

多个工厂实现 `IValidateReferences.ValidateReferences()`，包括武器、弹道、角色、敌人和池工厂。

**设计价值：** 内容增加后，最常见的问题往往不是算法，而是：

- 类型 ID 存在但没有 prefab；
- prefab 引用丢失；
- 数据存在但工厂没注册；
- DLC 引用了基础游戏没有的内容。

把校验放在工厂附近，可以在开发阶段尽早报告“哪个注册项不完整”，而不是等玩家选择该内容时才报错。

### 9.2 GenericPoolFactory 复用池注册和 DLC 合并

`GenericPoolFactory<T>` 统一了：

- 池初始化；
- 按类型获取池；
- 获取全部池；
- DLC 工厂合并；
- 池清理；
- 引用校验。

这是泛型用得比较合理的地方：操作结构相同，只是类型 ID 不同。

### 9.3 运行时角色导入不只是加载 JSON

`RuntimeCharacterRegistry` 处理：

- 外部 `ulong itemId` 与内部 `CharacterType` 的映射；
- 保留 ID 范围；
- 已分配和已加载状态；
- 控制器名称；
- `MixHash` 辅助分配。

另外还有独立模块：

- `RuntimeCharacterCompatibility`：不兼容内容的原因；
- `RuntimeCharacterLocalization`：角色和皮肤本地化；
- `RuntimeCharacterImporter`：数据、皮肤和加载流程。

**设计价值：** 一个可导入内容包实际上需要：

```text
稳定身份 + 数据 + 行为引用 + 素材 + 本地化 + 兼容性 + 错误报告
```

不是把文件放进 StreamingAssets 就完成了。

### 9.4 对你的建议

小项目不需要哈希分配内部枚举。更简单的方案是：

- 使用稳定字符串 ID；
- 启动时检查注册表重复项和空引用；
- 报错必须包含内容 ID 和缺失引用；
- 让测试覆盖“每个定义都能创建对应行为”。

运行时 Mod、Workshop 和兼容性管线属于很后面的能力。

---

## 10. 联机设计：权威、模拟帧和配置快照

### 10.1 权威不是只有位置同步

可以观察到：

- `EnemyController.KilledByAuthority`
- `CoherenceSync.HasStateAuthority`
- `OnlineKill`
- `GameManager.IsStageHost`
- 各系统 Online/Remote 分支

这说明死亡、掉落和奖励不能简单地让所有客户端各自执行，否则会出现重复奖励和状态分歧。

### 10.2 命令携带模拟帧

`OnlineStageManager` 的升级、宝箱、复活、暂停、选择等命令大量带有：

```text
startingSimFrame
```

`CharacterController` 的在线升级、复活和报告等接口也带有类似参数。

**设计价值：** 联机玩法不仅要知道“发生了什么”，还要知道它属于哪个模拟时序，避免延迟命令与本地新状态错误组合。

### 10.3 开局配置快照

`PlayerOptions` 中同时存在：

- `_mainGameConfig`
- `_hostGameConfig`
- `_hostGameConfigAtRunStart`
- `_onlineClientWithRunDataConfig`

这些字段体现了对局配置与联机主机配置、开局快照之间的区分。

**可迁移原则：** 一局开始后，不应让某个玩家中途修改永久选项，意外改变所有玩家的基础规则。需要明确本局采用哪份配置快照。

### 10.4 对你的建议

P0 不做联网完全正确，但你的死亡、掉落、拾取和武器转移仍应写成明确、幂等的规则入口。这样未来才容易回答“谁有权执行这次转移”，而不是从多个节点回调里猜状态。

---

## 11. 自动化与性能工程：把测试入口做进游戏

### 11.1 安装包中可见的自动化支撑

可以观察到：

- `AutomationVirtualGamepad`：虚拟手柄轴和按钮；
- `AutomationButtonsMainMenu / Gameplay`：按枚举定位真实 UI 按钮；
- `AutomationSignals`：自动化观察信号；
- `TimerManagerAutomation`：独立计时通道；
- `EnemyPerformanceTestingInstaller`：敌人性能测试组合；
- `PerformanceTestRunInfo` 等配置；
- `PerformanceWrecker`、Cheats、ActivityLogger 等调试支持。

这些类型不能证明项目具有怎样的 CI 覆盖率，但足以说明它考虑了**从输入、UI 到性能场景的自动化入口**。

### 11.2 值得采用的三层验证

```text
规则层：
死亡、掉落、拾取、升级、解锁、种子和数值测试

交互层：
通过真实输入/按钮验证选人、暂停、升级和确认流程

渲染与压力层：
验证真实场景中的武器转移、对象数量、资源释放和性能
```

自动化按钮定位比按屏幕坐标点击更稳定；虚拟输入比直接调用最终方法更能覆盖真实交互链路。

### 11.3 对你的建议

你已经有规则断言和真实渲染夺回链路，这个方向是对的。后续最值得补充的是：

- 重复死亡和重复拾取的幂等压力测试；
- 多次“死亡 → 被抢 → 杀回 → 夺回”后的节点、信号和计时器泄漏检查；
- 固定种子的关键场景；
- 敌人增加后的帧耗时分布，而不是只看平均 FPS。

自动化验证规则，真人试玩验证乐趣，两者仍然不能互相替代。

---

## 12. 迁移优先级总表

| 设计 | 当前 P0 可吸收的原则 | 后续何时实现对应系统 |
|---|---|---|
| 属性修正 | 定义与运行修正分离，不直接污染 WeaponDefinition | 真正加入升级/被动时 |
| 进化与构筑 | 条件应集中验证，装备变化后刷新规则 | 核心夺回循环通过真人验收后 |
| 特殊能力钩子 | 使用少量明确领域事件，避免全局永久订阅 | 出现第一种真实特殊能力时 |
| 成就与永久强化 | 条件、奖励、平台映射分开，解锁幂等 | 核心玩法已证明可重复游玩 |
| 关卡修饰器 | 优先复用定义并叠加差异 | 需要新模式时 |
| 关卡事件 | 调度与执行分离，提前发现资源依赖 | 需要时间表和特殊波次时 |
| 掉落与磁吸 | 掉落规则和吸附行为分离 | 出现经验/道具经济时 |
| 宝石压缩 | 数量控制不能破坏经济总量 | 测量证明 Pickup 数量成为瓶颈后 |
| 打击反馈 | 规则事件与表现分离，停顿有独立结束通道 | P0 只做能说明核心事件的最低反馈 |
| 随机流 | 玩法 RNG 可注入、分域，表现随机独立 | 现在就保持，不必等待 |
| 连续地图 | 坐标、裁剪、物理和唯一对象必须统一规则 | P0 不做；明确需要连续世界时 |
| 内容校验 | 启动/测试时检查重复 ID 和缺失引用 | 现在即可做轻量版 |
| 运行时内容导入 | 稳定 ID、版本、兼容性和错误报告 | 很后期，不进入当前范围 |
| 联机权威 | 规则入口明确且幂等 | 不提前实现联网 |
| 自动化 | 规则、交互、渲染分层验证 | 持续完善，不等系统变大 |

---

## 13. 最推荐你带走的七条原则

1. **数值定义和运行时修正分开，修正最好保留来源。**
2. **随机结果按用途分流，表现随机绝不推进玩法随机序列。**
3. **随机候选要给玩家一定控制权，而不是把全部构筑交给运气。**
4. **特殊能力通过明确事件插入，但不要把所有效果重新堆进一个巨型管理器。**
5. **对象数量控制不能破坏玩法经济；池化、合并和裁剪解决的是不同问题。**
6. **表现反馈也要有生命周期和资源预算，尤其是顿帧结束、音效实例和粒子清理。**
7. **内容扩展不仅是增加数据，还包括注册、校验、资源依赖、兼容性和自动化验证。**

对你的当前阶段，最优策略仍然是：**保留这些设计作为学习和后续候选，先完成 P0 真人体验验收，确认“武器被抢并反用”本身足够有趣，再决定哪些系统值得真正加入。**
