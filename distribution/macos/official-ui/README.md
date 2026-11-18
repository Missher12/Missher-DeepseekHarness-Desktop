# Intel Mac 0.2.2-rc.4 with the upstream UI

English | [中文](README.zh.md)

This community build packages the published upstream `dsh-v0.2.2-rc.4` release for Intel Macs with the original DeepSeek Harness interface. It uses local ad-hoc signing and is not an official DeepSeek distribution or an Apple-notarized package.

## Download and install

Download the application ZIP and `SHA256SUMS` from [this release](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.2-rc.4.intel.1). Extract the ZIP, wait for existing tasks to finish, quit DSH normally, and copy `DeepSeek Harness.app` into Applications. If macOS requests approval, verify the download and use its per-app approval in System Settings; do not disable system security checks.

The application is `x86_64`; its minimum macOS declaration is 13.0, with runtime validation performed on an Intel Mac running macOS 15.7.4. Apple Silicon native execution and other macOS versions are not qualified by this release.

The package uses the upstream `~/.dsh` and `~/Library/Application Support/@deepseek-ai/dsh-desktop` locations. It contains no personal plugin packages, plugin settings, credentials, sessions, memory databases or runtime logs. Replacing the application does not replace those directories. Older community builds used `~/Library/Application Support/DeepSeek Harness Intel`; this package does not migrate that separate directory automatically.

This local build has no official automatic-update feed. Existing plugin compatibility must be checked before a future host upgrade; incompatible plugins are not silently modified, disabled or removed.

## Reproduce the build

Use an Intel Mac and the official tag's toolchain requirements: Node.js 24.9 or newer, pnpm 11.28.5, and the native build prerequisites in the [upstream desktop guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.4/apps/desktop/README.md). Use a clean official checkout with dependencies installed from its lockfile. Keep this community repository beside that checkout.

The release application is built from [the upstream tag](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.4). This repository's release tag records the distribution instructions and scripts; use the pinned upstream tag, rather than the community source archive, to reproduce the application. `BUILD-INFO.json` records its exact source commit.

From the official checkout, install the locked dependencies and run the build script:

```sh
pnpm install --frozen-lockfile
node ../Missher-DeepseekHarness-Desktop/distribution/macos/official-ui/repack-official-ui.mjs "$PWD"
```

The script runs the upstream `build:official` and packages DSH, the desktop host, vendor libraries and the system entry. It then prepares the Intel runtime, packages and signs the Electron application locally, and runs the upstream packaged-runtime check.

The wrapper requires the exact upstream commit and version. It verifies the `official` client profile, title and sidebar brand registration. It also removes machine-specific build-directory prefixes from generated DevTools region comments, using [the narrowly scoped sanitizer](sanitize-runtime.mjs), then regenerates the runtime inventory through the upstream implementation before packaging and signing. Executable JavaScript and upstream source files are unchanged.

For an already verified official-UI runtime from the same exact source version, the release repack can use:

```sh
node ../Missher-DeepseekHarness-Desktop/distribution/macos/official-ui/repack-official-ui.mjs "$PWD" --prepared
```

When reusing a copy of that build, set `DSH_BUILD_ORIGINAL_SOURCE_ROOT` to the original absolute source directory so the sanitizer can find its paths in generated comments.

The resulting application is at `apps/desktop/.desktop-build/targets/mac-x64/unsigned-artifacts/mac/DeepSeek Harness.app`. For a future version, update the script's pinned tag and commit, then prepare the Node, Electron and native dependencies for that version.

## Protect an existing installation

Only replace the application after it and its owned background processes have exited normally. A session list with no running chat does not prove that queued messages, child agents, approval waits, background jobs or scheduled work are idle. If safe shutdown cannot be established, keep the candidate package and wait; never force quit or cancel work for an update.

Check existing enabled plugins against the candidate SDK before installation. Defer an incompatible upgrade or a migration that requires removing plugins, resetting configuration or irreversibly changing private data. Do not change plugin manifests to make a host upgrade pass. Keep the previous application until startup succeeds; never restore an old data snapshot over newer live data.

Builds and smoke checks use isolated profiles. Do not start a second test host against daily data. After replacement, verify the real installed version, normal interface, sessions and enabled plugins; allow normal plugin initialization to finish. A failed UI inspection is not a successful visual check.

## Verification scope

The upstream official build completed its 10 build checks. The generated-comment sanitizer has three focused tests, and the published repack runs the official final-runtime checks for native dependencies, offline plugin installation/removal, host startup, and DOCX/XLSX/PPTX conversion, rendering and recalculation. Signature and ZIP integrity checks cover the downloadable artifact.

The official client profile and sidebar branding are checked in the packaged files. The checks cover the packaged app and an isolated host. Third-party plugin compatibility and daily-profile upgrades must be checked against the target installation.

Upstream authorship and licenses remain intact. See [MIT](../../../LICENSE) and [third-party notices](../../../THIRD_PARTY_NOTICES.md).
