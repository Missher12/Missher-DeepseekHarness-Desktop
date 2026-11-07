# Missher DeepSeek Harness Desktop

本仓库维护当前桌面与公共 Host 源码，保留上游历史。各插件在[独立仓库](plugins/README.zh.md)开发、构建、安装和卸载，不增加共同兼容包。

## 源码入口

桌面源码在 apps/desktop，公共 Host 和界面模块在 packages。[插件目录](plugins/README.zh.md)维护当前项目入口；原插件导入历史继续保留，业务源码由对应独立仓库维护。

## 当前项目

记忆系统使用 [Memory Native](https://github.com/Missher12/Missher-DSH-Memory-Native)，媒体采集使用 [Media-Missher-Ego](https://github.com/Missher12/Media-Missher-Ego)。[MSE Learning](https://github.com/Missher12/Missher-MSE-Learning) 与 Media-Missher-Ego 保持私有；其他项目的访问要求见插件目录。

会话、凭据、附件、个人记忆、学习库、采集数据和生产 profile 由各自运行环境保管。源码发布、应用安装和真实模型验收分别记录。

## 上游与发布记录

社区桌面在本仓库维护，官方上游是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。仓库中的 cordis-repositories.json 与 distribution/plugin-set.json 保留早期发布身份；当前项目选择与下载入口以插件目录和各项目的发布说明为准。

## 平台

桌面安装包见本仓库 Releases。每个版本实际提供的平台、架构、签名和验证范围以该版本的资产及发布说明为准。

根 LICENSE、THIRD_PARTY_NOTICES.md 与独立插件许可证继续保留。
