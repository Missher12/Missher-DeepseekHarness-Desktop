---
description: "当前 Cordis Loader 插件状态的只读投影，并附带每个 agent preset（智能体预设）的组合：面向 web GUI 宿主客户端的 pluginInventory 服务及其 pluginInventory/list Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

## 概述

客户端可以查看 Host 的插件组合，并为单个会话选择可调用插件。`pluginInventory/list` 报告 Loader 与预设状态；`pluginInventory/candidates` 返回拥有所选 Agent 可见工具的插件。规范引用可在草稿重载和复制后保留。可选解析器在模型准入前检查可用性，并只记录所选能力指引。查询和选择都不会安装、启用、执行插件或授予权限。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当客户端或设置页需要展示宿主当前组合了什么——哪些插件已加载、已启用、是否存活，以及每个 agent preset 会给会话什么——时调用 `pluginInventory/list`。Client 调用返回 `RemoteResult`，需要处理失败结果。Host 消费端使用 `ctx.pluginInventory`，并向 `candidates` 传入实际 Agent。

### 选择可调用插件

Web Bundle 分别挂载清单与 `@deepseek-ai/dsh-host-plugin-inventory/reference-plugin`。解析器依赖清单；解析器缺席时，候选为空，残留引用会被拒绝。条目必须拥有活动工具注册，并通过 Agent 注册表、作用域限制与同名覆盖筛选。纯 UI、禁用、失败或归属不明的注册不会成为候选。

调用 `pluginInventory/candidates(sessionId, query, signal)`，插入、剪贴板、草稿和提交原样使用返回的 `mention`。浏览器安全的 `./reference` 导出格式化并解析 `@{dsh-plugin:v1:<encoded-identity>}`；`describePluginReference` 提供历史模块/条目标签，不声明可用性。身份包含模块、Loader 条目及 host 或 preset 来源，不含 Agent 或内存对象。订阅 `plugin-capabilities/changed`，并在预设选择或重连后重新查询；事件只使数据失效，不携带替代目录。

| 清单字段 | 默认值 | 含义 |
|---|---|---|
| `candidateLimit` | `50` | 最大补全行数 |
| `toolLimit` | `64` | 每插件最大工具摘要数；`capabilityCount` 保留总数 |
| `descriptionMaxChars` | `240` | 每段描述的最大字符数 |
| 解析器 `maxReferences` | `16` | 单条提交消息中允许的最大标记出现次数 |

提交和队列编辑拒绝畸形、不支持或不可用的引用。pre-step 按当前 Agent 再次校验排队引用。原用户文本保留完整标记；文件、目录、会话和技能引用继续使用各自解析器。附加指令消息采用 `plugin-reference` 归因并作为正文持久化，回放无需重新解析目录。

### 快照包含什么

每一行是一个非组 Loader 条目：其条目 id、精确模块标识、有效启用状态（含被禁用的祖先组）与当前根 Fiber 阶段。`pending` 表示条目等待加载，`loading` 表示正在读取，`active` 表示正在运行，`failed` 表示其 fiber 被拒绝，`unloading` 表示正在拆除；`null` 表示完全不存在存活的根 Fiber。结构性的 group 行会被跳过。

Loader 行与预设行可以携带可选的 `meta`，其中包含标题、描述或元信息诊断。Host 返回可用翻译与字面回退文本，由 Client 选择语言。元信息诊断不改变启停状态或 fiber 阶段。

### 每个预设的组合

组合了 roster 时，`agentPresets` 按 roster 顺序携带每个预设一组：其 id、随部署内置还是用户自建（`trust`，客户端据此本地化内置预设名）、发布的显示名、未指名预设的会话是否组合它，以及压平后的插件行——条目 id（文件行未声明时为 null）、模块标识、有效启用状态、行自带的 `!!js` disabled 表达式（如有），以及组合存活时的根 Fiber 阶段。已有会话组合过的预设由其最新仍存续的世代作答——即使其文件事后损坏也是如此，因为挂载才是这些会话实际运行的组合；开机以来从未被组合的预设由其组合文件作答，disabled 门用 Loader 上下文求值，且读取从不挂载预设。`conditional` 表示宿主无法求值的门；无人组合的坏预设保留在列表中，携带原因且没有行。没有 roster 时该字段缺席。

### 你能用它做什么、不能做什么

该清单是供展示与诊断的快照：客户端可以渲染名单、标出失败条目，并通过比较快照检测变化。它不能启用、停用、添加或移除插件，也不携带历史——已经失败并被移除的 fiber 缺席。由于服务每次调用都读取 Loader，答案总是反映当前组合，而不是缓存视图。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

网关是一层没有第二个生命周期真源的直接投影：每次 `list()` 调用都读取 `ctx.loader.entries()`，并把每个非组条目映射为公共行。Cordis 内部的 `plugin/status` 事件已经维护了 `Entry.fiber` 与 `Fiber.state`，因此再加缓存只会多出一个需要同步的生命周期真源。agent preset roster 是每次调用经 `ctx.get('agentPresets')` 解析的可选伙伴：预设组合读取由它的 `compositionInventory()` 负责，本包把根 Fiber 状态映射到公共阶段。

展示元信息来自可选的 `pluginPackages` 服务：Loader 行使用其所属树的解析基准，预设行使用网关上下文的基准。服务或对应基准不存在时，`meta` 缺席。读取元信息不会加载或激活插件。

### 阶段映射

Fiber 状态映射到公共阶段词汇，其中 `disposed` 折叠为 `null`——fiber 已消失的条目没有可报告的存活根。因此阶段从不区分为什么没有存活根：条目可能从未启动，也可能其 fiber 已被释放。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `PluginInventoryGateway`：`pluginInventory` Remote 服务与 Loader 投影 |
| [`src/types.ts`](src/types.ts) | 公共 payload 类型：`PluginInventoryEntry`、`PluginInventorySnapshot`、`PluginFiberPhase` |

Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当清单约定不够用时阅读以下内容：先看 Remote 如何到达客户端，再看它所投影的 Loader 与渲染它的界面。

- [Remote 组合](../../api/remotes/README.zh.md)——客户端如何在不导入 Host 实现的情况下消费 `pluginInventory/list`。
- [Cordis 插件 loader](../../../vendor/loader/README.md)——本包所投影条目的那个 Loader。
- [插件清单设置界面](../../client/ui-settings-plugin-inventory/README.zh.md)——渲染该清单的浏览器侧投影。

-----

<a id="model-experience"></a>
## 模型体验

### 所选插件指引

#### 模型看到什么

解析器在含引用的直接用户消息之后增加一条指令消息。固定标题为 `## Referenced plugins`；正文说明规范标记代表插件，保留原有权限与审批，并将后续 JSON 标为目录数据。JSON 只包含所选插件身份、模块名、有界工具摘要与工具数。引用解析不执行工具。

#### Token 影响

每个提交的引用贡献其所选插件的有界能力摘要。未选插件不贡献指令文本；`maxReferences`、`toolLimit` 和 `descriptionMaxChars` 限制这部分输入。

#### KV Cache 影响

指引经普通日志消息准入进入一次，保留既有历史前缀。每次新的直接引用读取实时目录；回放保留记录下来的指令文本。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明即时清单无法向客户端提供哪些信息。它们是当前包约束，不是任务积压。

- **仅表示调用当下**——结果不包含持久失败历史；候选变更事件需要重新查询；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **不标识引入层，也不修改插件**——服务不识别条目由哪个 bundle、profile 或 override 引入，也不能在任一平面启用、停用、添加或移除插件。
- **预设仅随 roster 出现**——未装 `dsh-agent-preset-registry` 的部署只提供 Loader 条目；`agentPresets` 字段缺席而非为空。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
