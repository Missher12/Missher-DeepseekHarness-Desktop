# Intel Mac 0.2.2-rc.4：保留官方界面

[English](README.md) | 中文

本社区构建将上游已发布的 `dsh-v0.2.2-rc.4` 打包为 Intel Mac 应用，保留 DeepSeek Harness 原版界面。应用采用本地 ad-hoc 签名，不是 DeepSeek 官方发行或 Apple 公证包。

## 下载与安装

在[本次 Release](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.2-rc.4.intel.1)下载应用 ZIP 和 `SHA256SUMS`。解压后，等已有任务结束、正常退出 DSH，再将 `DeepSeek Harness.app` 复制到应用程序目录。若 macOS 要求批准，核对下载后使用系统设置中的单应用批准入口，不关闭系统安全检查。

应用架构为 `x86_64`，最低系统声明为 macOS 13.0；本次运行验证使用 Intel Mac 和 macOS 15.7.4。本发布未验收 Apple Silicon 原生运行或其他 macOS 版本。

本包使用上游的 `~/.dsh` 和 `~/Library/Application Support/@deepseek-ai/dsh-desktop` 路径，不包含个人插件包、插件设置、凭据、会话、记忆数据库或运行日志。替换应用不替换这些目录。历史社区包曾使用 `~/Library/Application Support/DeepSeek Harness Intel`，本包不会自动迁移那个独立目录。

此本地构建没有官方自动更新源。以后升级宿主前需要核对现有插件兼容性；不悄悄修改、停用或移除不兼容插件。

## 复现构建

使用 Intel Mac 和官方标签对应的工具链：Node.js 24.9 或更新版本、pnpm 11.28.5，以及[上游桌面打包说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.4/apps/desktop/README.md)列出的原生构建条件。准备干净的官方 checkout，按锁文件安装依赖，将本社区仓库放在其相邻目录。

发布应用使用[上游标签](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.4)构建。本仓库的发布标签记录分发说明和脚本；复现应用应使用固定的上游标签，而不是社区仓库的源码归档。`BUILD-INFO.json` 记录准确的上游提交。

在官方源码目录里按锁文件安装依赖，再运行构建脚本：

```sh
pnpm install --frozen-lockfile
node ../Missher-DeepseekHarness-Desktop/distribution/macos/official-ui/repack-official-ui.mjs "$PWD"
```

脚本执行上游 `build:official`，打包 DSH、桌面宿主、第三方库和系统入口，再准备 Intel 运行库，对 Electron 应用进行本地打包和签名，最后运行上游的安装包检查。

脚本要求准确的上游提交和版本，并核对 `official` 客户端选项、标题和侧栏品牌注册。它还通过[限定范围的清理脚本](sanitize-runtime.mjs)去掉生成的 DevTools 区域注释中的本机构建目录前缀，再调用上游实现重新生成运行库清单，随后打包、签名。可执行 JavaScript 和上游源码保持不变。

若已具备同一准确源码版本、经过验证的官方界面运行库，可以使用本次发布重打包入口：

```sh
node ../Missher-DeepseekHarness-Desktop/distribution/macos/official-ui/repack-official-ui.mjs "$PWD" --prepared
```

复用构建副本时，用 `DSH_BUILD_ORIGINAL_SOURCE_ROOT` 指定原始源码绝对路径，以便定位生成注释中的构建路径。

生成的应用位于 `apps/desktop/.desktop-build/targets/mac-x64/unsigned-artifacts/mac/DeepSeek Harness.app`。更新到后续版本时，修改脚本中固定的标签和提交，并准备该版本的 Node、Electron 和原生依赖。

## 保留现有安装的数据与任务

只有应用及其所属后台进程正常退出后才替换。会话列表没有运行中的聊天，不代表排队消息、子代理、待批准操作、后台作业或定时任务均已空闲。无法确认安全退出时，保留候选包并等待，不强退或取消任务来更新。

安装前按候选 SDK 核对现有已启用插件。不兼容，或迁移要求移除插件、重置配置、不可逆地改变私人数据时，暂缓升级。不通过修改插件清单来强行通过宿主升级。保留上一应用，直到新版启动正常；不将旧数据快照恢复到较新的日常数据上。

构建和运行检查使用隔离配置，不让第二个测试宿主读取日常数据。替换后核对实际安装版本、正常界面、会话和已启用插件，等待插件正常初始化完成。界面检查失败不能表述为视觉验收通过。

## 验证范围

上游官方构建的 10 项构建检查已通过。生成注释清理逻辑有 3 项针对性测试；公开重打包执行上游最终运行检查，覆盖原生依赖、离线插件安装与移除、宿主启动，以及 DOCX/XLSX/PPTX 转换、渲染和重算。签名与 ZIP 完整性检查覆盖可下载产物。

已在打包文件中核对官方客户端选项和侧栏品牌。运行检查覆盖安装包及隔离宿主。第三方插件兼容性和日常配置升级需按实际安装环境另行核对。

保留上游作者与许可证，参见 [MIT](../../../LICENSE) 和[第三方声明](../../../THIRD_PARTY_NOTICES.md)。
