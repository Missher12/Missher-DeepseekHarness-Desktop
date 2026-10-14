# DSH 插件目录

[English](README.md) | 中文

[仓库首页](../README.zh.md) · [安装](../docs/cookbook/install-cordis-plugins.zh.md) · [开发](../docs/cookbook/build-cordis-plugins.zh.md)

这里集中当前的 Missher 项目：八个公开 DSH 插件、公开的独立 Obsidian Memory，以及私有 Media。点击每个项目名称即可进入对应仓库。公开 DSH 插件各自构建、打包、保存设置和安装，无需额外搭配共同的兼容插件。模型行内设置、图片上传与输入框引用还使用下文列出的桌面端功能。

<a id="public-plugins"></a>

## 公开插件

| 插件 | 可以做什么 | DSH 内入口 | 快捷链接 |
| --- | --- | --- | --- |
| [上下文管理](https://github.com/Missher12/Missher-DSH-Context-Manager) | 请求前压缩、当前上下文、正文、逐次变化、本会话累计 | 会话 → 上下文；设置 → 上下文管理 | [最新正式版](https://github.com/Missher12/Missher-DSH-Context-Manager/releases/latest) · [合集快照](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [使用统计](https://github.com/Missher12/Missher-DSH-Usage-Statistics) | 跨会话用量、活动图、模型/工具/技能排行 | 设置 → 使用统计 | [最新正式版](https://github.com/Missher12/Missher-DSH-Usage-Statistics/releases/latest) · [合集快照](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [输出外观](https://github.com/Missher12/Missher-DSH-Output-Renderer) | 四种单栏布局、完整思考、工具详情及流式动效 | 设置 → 输出外观 | [最新正式版](https://github.com/Missher12/Missher-DSH-Output-Renderer/releases/latest) · [合集快照](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [会话桥接](https://github.com/Missher12/Missher-DSH-Session-Bridge) | 会话 ID、跨会话投递、临时工作区及归档会话删除 | 侧栏会话菜单；新会话 → 工作区选择器 | [最新正式版](https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/latest) · [合集快照](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [思考强度](https://github.com/Missher12/Missher-DSH-Reasoning-Effort) | 思考滑块、配色及每个模型的档位设置 | 模型设置；思考控制 | [最新正式版](https://github.com/Missher12/Missher-DSH-Reasoning-Effort/releases/latest) · [合集快照](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [Project Ops 项目任务](https://github.com/Missher12/Missher-DSH-Project-Ops) | 项目任务、PLAN.md 开发方案与 READY.md 交付记录 | 会话标题栏 → Project Ops | [最新正式版](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/latest) · [合集快照](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [MSE 持久学习](https://github.com/Missher12/Missher-MSE-Learning) | 在任务范围内学习、召回和复盘 | MSE 设置和命令 | [最新正式版](https://github.com/Missher12/Missher-MSE-Learning/releases/latest) · [合集快照](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [电脑与浏览器](https://github.com/Missher12/Missher-DSH-Computer-Browser) | 浏览器与电脑控制；开发已暂停 | 浏览器侧栏及电脑工具 | [发布与下载](https://github.com/Missher12/Missher-DSH-Computer-Browser/releases) |

上表“最新正式版”指向各维护插件的最新已验收 Release。[七插件合集及包清单](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1)保留该次桌面发布时的冻结版本，后续插件更新在各自仓库下载；合集版本不限制插件只能搭配某个宿主版本。安装前核对所选 Release 的校验值、最低能力要求和已验证范围。MSE 已通过的检查和剩余限制见其[交付说明](https://github.com/Missher12/Missher-MSE-Learning/blob/main/PUBLICATION.md)。电脑与浏览器插件未包含在合集内，其暂停中的原生流程尚未在新宿主验收。

仓库内的[旧合集记录](../distribution/plugin-set.json)和[仓库记录](../cordis-repositories.json)保留早期发布内容；安装时以所选发布页附带的包清单为准。

## 私有与独立项目

| 项目 | 可以做什么 | 安装位置 |
| --- | --- | --- |
| [Media@Missher](https://github.com/Missher12/Missher-Media) | Chrome CDP 采集、保留证据和选择导出 | DSH；需仓库访问权限 |
| [独立 Obsidian 记忆](https://github.com/Missher12/Missher-Obsidian-Memory) | Vault 内的 Markdown 记忆、搜索、复盘及可选 AI | Obsidian；不是 DSH 插件 |

只有 Media 保持私有，需要有权限的 GitHub 账号。独立 Obsidian Memory 以 MIT 许可证公开，个人 Vault 和笔记不在公开范围内。已退役的 DSH Obsidian Bundle 不属于当前安装合集，移除它不表示可以删除独立 Obsidian 插件、源码、Vault 或笔记。MSE 只公开产品代码，不公开私人学习记录。

<a id="release-and-version-compatibility"></a>

## 发布与版本兼容

已验收的社区交付采用正式 Release。已有标签和包版本保留真实构建身份，包括上游 alpha 或 rc 标识。维护中的插件以支持合理的宿主版本范围、持续适配最新版为目标。兼容性按必要接口能力和有依据的版本范围判断；已测试版本记录验证基线，不表示只有该版本能用。每次发布分别注明最低要求、已验证范围和已知限制。超出这些证据的新旧版本仍需验证。

## 怎样确认已经更新

对照所选发布版本，检查应用版本、当前配置组中各插件的已安装版本与加载状态。活动任务和排队工作妥善处理后再重启，并检查自己使用的功能入口。Git 已推送、磁盘有安装包或加载检查通过，都不能单独证明正在运行的应用及全部插件功能已更新。桌面端和插件分别更新，精确校验值与平台限制以对应发布说明为准。

## 需求归属

| 需求 | 负责人所在模块 |
| --- | --- |
| 图片上传与限额；输入框 `@插件` 引用 | 宿主[附件](../packages/attachment/)与[客户端](../packages/client/) |
| 模型设置中支持的思考档位 | 宿主[模型目录](../packages/client/ui-settings-models/) |
| 当前会话上下文与累计用量 | 上下文管理 |
| 跨会话累计用量 | 使用统计 |
| 助手输出外观 | 输出外观 |
| 会话身份、消息投递与临时工作区 | 会话桥接 |
| 项目任务、开发方案与交付记录 | Project Ops |

输入框引用展示可调用的能力。只增加设置页或渲染功能的插件，安装后不会自动成为 `@` 命令。

## 独立项目

[OpenViking](https://github.com/volcengine/OpenViking) 是第三方记忆服务，提供可选 DSH 插件，需另行配置服务及向量模型。它不属于上表的 Missher 自研插件。具体见[归属与隐私边界](../CORDIS.md#独立项目)。

## 下一步

已有构建产物时按[安装指南](../docs/cookbook/install-cordis-plugins.zh.md)启用插件，需要生成安装包时按[开发指南](../docs/cookbook/build-cordis-plugins.zh.md)操作。后续插件开发在对应独立仓库进行；宿主仓库保留原导入历史。
