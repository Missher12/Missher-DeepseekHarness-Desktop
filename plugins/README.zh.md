# DSH 插件目录

[English](README.md) | 中文

[仓库首页](../README.zh.md) · [安装指南](../docs/cookbook/install-cordis-plugins.zh.md) · [开发指南](../docs/cookbook/build-cordis-plugins.zh.md)

![DSH 工作区、工具与独立插件功能示意](../docs/images/overview.svg)

按需要选择独立插件。当前记忆系统使用 Memory Native，媒体采集使用 Media-Missher-Ego；各项目分别维护源码、发布、配置和安装。

<a id="public-plugins"></a>

## 日常插件

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
| [Focus · 执行增强](https://github.com/Missher12/Missher-DSH-Focus) | 规划、实施、调试、检查与交付 | 公开 |
| [MSE · 持久学习](https://github.com/Missher12/Missher-MSE-Learning) | 长期纠错、失败经验与学习整理 | 私有 |

## Media@Missher

[Media-Missher-Ego](https://github.com/Missher12/Media-Missher-Ego) 是当前媒体采集入口，仓库保持私有。它基于 ego lite 处理 Bilibili、小红书、抖音、微博和 X，支持增量汇总、断点续采、历史对比和本地导出。DSH 接入与安装方式以该项目的交付说明为准。

## 可选扩展

| 项目 | 用途 | 仓库 |
| --- | --- | --- |
| [Windows Guard](https://github.com/Missher12/dsh-windows-guard) | 原生 Windows 执行器与工具可用性检查 | 私有；Windows 专用 |

## 社区插件目录

[Plugin Catalog](https://github.com/Missher12/Missher-DSH-Plugin-Catalog) 是社区插件目录的协作副本，用于发现与提交插件条目。当前 Missher 项目以上述入口为准。

<a id="current-source-snapshots"></a>
<a id="release-and-version-compatibility"></a>

## 版本与安装

<a id="download-all-plugins-with-an-agent"></a>

### 交给 Agent 下载全部插件

[机器可读清单](catalog.json)列出 12 个独立 Missher 插件，其中 9 个公开、3 个私有。桌面宿主和社区目录是另外两个项目。Windows Guard 仅适用于 Windows；能下载源码不代表适合在其他系统安装。

把本仓库链接交给 Agent，可以直接说：“读取 `plugins/catalog.json`，按各项的 `sourceRef` 将全部插件克隆到一个新目录，报告下载的分支与提交。保留已有安装、配置和数据；无法访问的仓库单独列出，不能把部分下载说成全部完成。”Agent 需要 Git，并有权读取 MSE、Media-Missher-Ego 和 Windows Guard。

这会下载源码仓库。可安装包按各项目的构建或 Release 说明获取；较新的开发分支不代表已有同版本的 Release 安装包。清单记录分支而不固定版本，实际版本以下载后的 `package.json` 为准。

从各项目的发布记录和安装说明选择版本。开发分支、已发布安装包和当前应用中的已加载版本分别记录；源码更新不会自动替换日常 DSH 中的插件。最低宿主能力、已验证范围和限制以对应项目说明为准。

MSE、Media-Missher-Ego 和 Windows Guard 需要有访问权限的 GitHub 账号。配置、会话、记忆、学习库和采集数据保存在各自运行环境中。

[旧合集清单](../distribution/plugin-set.json)和[早期仓库记录](../cordis-repositories.json)保留原发布时的版本与校验信息；当前插件选择以上述项目为准。
