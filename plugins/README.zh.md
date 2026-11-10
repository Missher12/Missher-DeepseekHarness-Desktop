# DSH 插件目录

[English](README.md) | 中文

[仓库首页](../README.zh.md) · [安装指南](../docs/cookbook/install-cordis-plugins.zh.md) · [开发指南](../docs/cookbook/build-cordis-plugins.zh.md)

![DSH 推荐插件 · 品牌插画](../docs/images/plugins-cover.png)

这里有 **13 个独立插件：12 个公开、1 个私有**。推荐安装包含全部 12 个公开插件；私有的 Media@Missher Ego 单独安装。记忆系统使用当前 Memory Native。

<a id="install-recommended-plugins"></a>

## 一段指令，安装整套推荐插件

把主仓链接和下面这段话交给 Agent，即可在同一个会话中依次安装。使用[公开安装清单](install-set.json)中的 Release `.tgz` 包，保留现有插件实例、配置和数据。

```text
请读取 https://github.com/Missher12/Missher-DeepseekHarness-Desktop/blob/main/plugins/install-set.json，
在我当前使用的 DSH 中，一次完成清单内全部 12 个公开插件的安装或更新。
先查询各仓库最新已发布的 Release；有兼容新版且包含正确包名的 `.tgz` 时优先使用新版，
否则使用清单中已核对的安装包。核对包名、版本和宿主兼容性；Memory 沿用当前原生发行系列。
优先使用宿主原生插件管理接口，在原插件实例上更新，保留配置、会话、记忆和学习数据。
已安装同版或更新版本的插件保留，不重复安装或降级；不要安装私有的 Media@Missher Ego。
按宿主要求加载更新，不强退正在工作的应用。完成后逐项列出安装版本、启用及加载状态；
缺少能力、安装失败和需要重启的项目单独说明。
```

可在下表先了解各插件用途。Guard 支持 Windows 与 macOS；Linux 宿主会跳过它的运行功能。

<!-- plugin-visual-guide -->
## 看图选择插件

![12 个公开插件：记忆、会话、执行与观察的分工](../docs/images/plugin-map.svg)

上图按用途分组，不表示插件之间存在运行依赖。私有 Media@Missher Ego 单独安装。第一次使用可以先从当前任务需要的功能入手，再逐步调整其他设置。

| 想完成的事 | 从哪里开始 | 接着看什么 |
| --- | --- | --- |
| 长会话继续开发，同时保留跨会话背景 | Context Manager 整理本轮历史，Memory Native 管理长期事实与来源 | 展开摘要或记忆原句，确认目标、范围与当前事实 |
| 把明确任务交给独立会话 | Superagent 选真实工作区并派单，Focus 提供按需工作方法 | 看成员活动和结果，再用 Project Ops 定位实际交付文件 |
| 处理文件并核对执行情况 | Guard 先检查执行器、目录和输入清单 | 核对逐项回执，保留失败与未解决项 |
| 改善阅读并了解使用情况 | Output Renderer 调布局，Reasoning Effort 选模型支持档位 | Usage Statistics 看长期活动，Dashboard 定位需关注会话 |

例如：“交给 Superagent 只读分析当前项目，列出入口和依据，不改文件。”任务完成后，回到真实会话核对结论，用 Project Ops 打开实际产物。插件各司其职，工作台状态和图表颜色不能单独代替任务验收。

下方每个插件的仓库首页都有“图解使用流程”，包含操作步骤、具体示例、结果检查点与设置建议。流程图和场景插画明确标为示意；已有界面截图保留版本说明。
<!-- /plugin-visual-guide -->

<a id="public-plugins"></a>

## 推荐插件（12 个公开）

| 插件 | 用途 | 仓库 |
| --- | --- | --- |
| [Memory Native · 记忆系统](https://github.com/Missher12/Missher-DSH-Memory-Native) | 跨会话记忆、检索和来源追溯 | 公开 |
| [上下文管理](https://github.com/Missher12/Missher-DSH-Context-Manager) | 上下文、用量与请求前、空闲压缩 | 公开 |
| [使用统计](https://github.com/Missher12/Missher-DSH-Usage-Statistics) | 跨会话用量、活动和排行 | 公开 |
| [输出外观](https://github.com/Missher12/Missher-DSH-Output-Renderer) | 回答布局、思考与工具详情、字号和流式效果 | 公开 |
| [会话桥接](https://github.com/Missher12/Missher-DSH-Session-Bridge) | 会话 ID、跨会话投递、临时工作区与归档会话管理 | 公开 |
| [思考强度](https://github.com/Missher12/Missher-DSH-Reasoning-Effort) | 模型支持的思考档位与行内控制 | 公开 |
| [Project Ops · 项目工作区](https://github.com/Missher12/Missher-DSH-Project-Ops) | 项目任务与文件、产物预览和定位 | 公开 |
| [Superagent · 项目任务](https://github.com/Missher12/Missher-DSH-Superagent) | 派出项目任务，查看进度并继续跟进 | 公开 |
| [Focus · 执行增强](https://github.com/Missher12/Missher-DSH-Focus) | 研究、写作、数据、文件和应用任务，保留开发专用流程 | 公开 |
| [工作仪表盘](https://github.com/Missher12/Missher-DSH-Dashboard) | 会话状态、Token 趋势、目标进度与 Superagent 概览 | 公开 |
| [MSE · 持久学习](https://github.com/Missher12/Missher-MSE-Learning) | 长期纠错、失败经验与学习整理 | 公开 |
| [Guard](https://github.com/Missher12/Guard) | Windows/macOS shell 检查、可靠文件批处理与办公文档操作 | 公开；Windows 和 macOS |

## Media@Missher

[Media-Missher-Ego](https://github.com/Missher12/Media-Missher-Ego) 是当前媒体采集入口，仓库保持私有。它基于 ego lite 处理 Bilibili、小红书、抖音、微博和 X，支持增量汇总、断点续采、历史对比和本地导出。DSH 接入与安装方式以该项目的交付说明为准。

## 社区插件目录

[Plugin Catalog](https://github.com/Missher12/Missher-DSH-Plugin-Catalog) 是社区插件目录的协作副本，用于发现与提交插件条目。当前 Missher 项目以上述入口为准。

<a id="current-source-snapshots"></a>
<a id="release-and-version-compatibility"></a>

## 版本与安装

<a id="download-all-plugins-with-an-agent"></a>

### 只下载全部源码

[机器可读清单](catalog.json)列出 13 个独立 Missher 插件，其中 12 个公开、1 个私有。桌面宿主和社区目录是另外两个项目。Guard 支持 Windows 和 macOS；Linux 与 WSL 内的 Linux 宿主会跳过。安装前按其说明核对宿主和 Node 版本。

把本仓库链接交给 Agent，可以直接说：“读取 `plugins/catalog.json`，按各项的 `sourceRef` 将全部插件克隆到一个新目录，报告下载的分支与提交。保留已有安装、配置和数据；无法访问的仓库单独列出，不能把部分下载说成全部完成。”Agent 需要 Git；下载 Media-Missher-Ego 还需要仓库访问权限。

这段指令只下载源码；整套安装请使用上方的[推荐安装入口](#install-recommended-plugins)。可安装包按各项目的构建或 Release 说明获取；较新的开发分支不代表已有同版本的 Release 安装包。清单记录分支而不固定版本，实际版本以下载后的 `package.json` 为准。

从各项目的发布记录和安装说明选择版本。开发分支、已发布安装包和当前应用中的已加载版本分别记录；源码更新不会自动替换日常 DSH 中的插件。最低宿主能力、已验证范围和限制以对应项目说明为准。

仅 Media-Missher-Ego 需要有访问权限的 GitHub 账号。配置、会话、记忆、学习库和采集数据保存在各自运行环境中。

[旧合集清单](../distribution/plugin-set.json)和[早期仓库记录](../cordis-repositories.json)保留原发布时的版本与校验信息；当前插件选择以上述项目为准。
