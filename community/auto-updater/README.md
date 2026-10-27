# Intel Mac 自动更新器

这条通道解决的是：**Intel Mac 上官方 x64 更新源停在 `0.2.1-rc.1`，官方 `rc.3` 只有 arm64 和 Windows，社区 unsigned 包又无法使用官方签名自动更新。**

它做两件事：

1. `.github/workflows/missher-intel-auto-release.yml` 每 6 小时检查一次官方上游 `deepseek-ai/deepseek-harness` 的 `dsh-v*` Release；
2. 发现新版本后，在社区基线分支（默认 `codex/desktop-rc2-20261017`）上合并上游 tag，调用 `missher-macos-intel-desktop.yml` 构建 Intel x64 DMG，并发布 `desktop-v*` Release；
3. 本机 `launchd` 每 2 小时检查社区 Release，下载 DMG、校验 `SHA256SUMS`、替换 `/Applications/DeepSeek Harness.app` 并重启。

CI 只由 `schedule` 和手动 `workflow_dispatch` 触发，不使用 `pull_request` 等不可信触发。

如果上游 tag 与社区基线分支在同一文件上冲突，构建会在 merge 步骤失败并列出冲突文件；这时需要先把社区补丁整理到基线分支，下一次定时任务继续自动构建。合并成功后，工作流只在该次运行的临时工作区里构建，不会把 merge 提交推回仓库。

## 构建版本规则

- 上游版本是预发布（例如 `0.2.1-rc.3`）：构建版本为 `0.2.1-rc.3.YYYYMMDD.1`，允许同一上游版本重试构建。
- 上游版本是稳定版（例如 `0.2.1`）：构建版本就是 `0.2.1`，不追加四段版本号。
- 同一个上游版本已经有 `desktop-v<version>` Release 时，定时任务跳过，不重复构建。

## 本机安装

```sh
cd community/auto-updater
./install.sh
```

安装后：

- 更新器：`~/Library/Application Support/dsh-community-updater/update.sh`
- LaunchAgent：`~/Library/LaunchAgents/com.missher.dsh-community-updater.plist`
- 日志：`~/Library/Logs/dsh-community-updater.log`
- launchd 日志：`~/Library/Logs/dsh-community-updater.launchd.log`
- 间隔：7200 秒；加载时立即运行一次

手动检查（不安装）：

```sh
DSH_UPDATER_DRY_RUN=1 "$HOME/Library/Application Support/dsh-community-updater/update.sh"
tail -n 100 "$HOME/Library/Logs/dsh-community-updater.log"
```

## 卸载

```sh
"$HOME/Library/Application Support/dsh-community-updater/uninstall.sh"
```

或从本目录运行 `./uninstall.sh`。日志会保留。

## 行为与边界

- 只接受同时带 `*-mac-x64-unsigned.dmg` 和 `SHA256SUMS` 的非 draft Release。
- 版本比较使用 SemVer；不会降级。
- SHA-256 不匹配、下载失败、挂载失败、替换失败时保留旧 App。
- 替换前会终止正在运行的 App；会话数据在 `~/Library/Application Support/@deepseek-ai/dsh-desktop`，不会被删除。
- 新包未签名，首次安装可能需要在“系统设置 → 隐私与安全性”中放行。
- 更新器不使用 `sudo`；要求当前用户对 `/Applications` 有写权限。
- SHA-256 只能证明下载内容与 Release 中声明的一致；如果 GitHub 账号或 Release 被篡改，它不能提供密码学签名保证。

## 手工触发 CI

构建但不发布：

```sh
gh workflow run missher-macos-intel-desktop.yml \
  -R Missher12/Missher-DeepseekHarness-Desktop \
  -f build_version=0.2.1-rc.3.20261027.1
```

构建并发布：

```sh
gh workflow run missher-macos-intel-desktop.yml \
  -R Missher12/Missher-DeepseekHarness-Desktop \
  -f build_version=0.2.1-rc.3.20261027.1 \
  -f upstream_version=0.2.1-rc.3 \
  -f publish=true
```

立即运行一次自动任务：

```sh
gh workflow run missher-intel-auto-release.yml \
  -R Missher12/Missher-DeepseekHarness-Desktop
```

## 排障

- `another updater run is active`：上一次运行未退出；确认没有 `update.sh` 进程后可删除 `~/Library/Application Support/dsh-community-updater/lock`。
- `cannot fetch release list`：GitHub API 网络或限流；更新器每 2 小时重试。
- `SHA-256 mismatch`：Release 资产被替换或下载损坏；不会安装。
- `cannot stop running app`：App 未响应 SIGTERM/SIGKILL；检查是否有卡住的 Electron 进程。
- 更新后 App 无法启动：从对应 Release 手动下载 DMG 覆盖安装；用户数据不受影响。
