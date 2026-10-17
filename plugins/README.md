# DSH plugin directory

English | [中文](README.zh.md)

[Repository home](../README.md) · [Install](../docs/cookbook/install-cordis-plugins.md) · [Develop](../docs/cookbook/build-cordis-plugins.md)

This is the common directory for the current Missher projects: eight public DSH plugins, open-source independent Obsidian Memory, and private Media. Every project name opens its own repository. Public DSH plugins have independent builds, packages, settings and installation; none requires a separate common compatibility plugin. Model-row settings, image uploads and composer references also use the Desktop features described below.

<a id="public-plugins"></a>

## Public plugins

| Plugin | What it does | Open in DSH | Links |
| --- | --- | --- | --- |
| [Context Manager](https://github.com/Missher12/Missher-DSH-Context-Manager) | Pre-request compaction, current context, content, per-reply changes and session totals | Conversation → Context; Settings → Context Management | [Latest release](https://github.com/Missher12/Missher-DSH-Context-Manager/releases/latest) · [Bundle snapshot](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [Usage Statistics](https://github.com/Missher12/Missher-DSH-Usage-Statistics) | Cross-session usage, activity and model/tool/skill rankings | Settings → Usage Statistics | [Latest release](https://github.com/Missher12/Missher-DSH-Usage-Statistics/releases/latest) · [Bundle snapshot](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [Output Renderer](https://github.com/Missher12/Missher-DSH-Output-Renderer) | Four single-column layouts, full reasoning, tool details and streaming effects | Settings → Output Appearance | [Latest release](https://github.com/Missher12/Missher-DSH-Output-Renderer/releases/latest) · [Bundle snapshot](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [Session Bridge](https://github.com/Missher12/Missher-DSH-Session-Bridge) | Session IDs, cross-session messages, scratch workspaces and archived-session deletion | Sidebar session menu; New Session → workspace selector | [Latest release](https://github.com/Missher12/Missher-DSH-Session-Bridge/releases/latest) · [Bundle snapshot](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [Reasoning Effort](https://github.com/Missher12/Missher-DSH-Reasoning-Effort) | Reasoning slider, colors and per-model levels | Model settings; reasoning control | [Latest release](https://github.com/Missher12/Missher-DSH-Reasoning-Effort/releases/latest) · [Bundle snapshot](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [Project Ops](https://github.com/Missher12/Missher-DSH-Project-Ops) | Project tasks, PLAN.md development plans and READY.md delivery records | Session header → Project Ops | [Latest release](https://github.com/Missher12/Missher-DSH-Project-Ops/releases/latest) · [Bundle snapshot](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [MSE Learning](https://github.com/Missher12/Missher-MSE-Learning) | Scoped learning, recall and review | MSE settings and commands | [Latest release](https://github.com/Missher12/Missher-MSE-Learning/releases/latest) · [Bundle snapshot](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) |
| [Computer Browser](https://github.com/Missher12/Missher-DSH-Computer-Browser) | Browser and computer controls; development is paused | Browser sidebar and Computer tools | [Releases](https://github.com/Missher12/Missher-DSH-Computer-Browser/releases) |

Each “Latest release” link above opens the newest accepted regular Release for that maintained plugin. The [seven-plugin set and package list](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2.20261014.1) preserves the versions frozen for that Desktop release; download later plugin updates from their own repositories. Bundle versions do not restrict plugins to a single Host version. Check the selected Release’s checksums, minimum capabilities and verified targets before installation. See MSE's [delivery notes](https://github.com/Missher12/Missher-MSE-Learning/blob/main/PUBLICATION.md) for accepted checks and remaining limits. Computer Browser is excluded: its paused native workflows have not been accepted for the new Host.

The repository's [older plugin-set record](../distribution/plugin-set.json) and [repository record](../cordis-repositories.json) retain an earlier release; use the package list attached to the selected release for installation.

## Plugin previews

These screenshots show the real interfaces of the listed plugin releases in isolated test profiles with synthetic data. Select an image for installation instructions, more screenshots and compatibility details in its repository.

|  |  |
| --- | --- |
| **Usage Statistics 0.2.2**<br>[![Usage Statistics](https://raw.githubusercontent.com/Missher12/Missher-DSH-Usage-Statistics/4b82f3b5214ebff88d383d1633220a6031b5058e/docs/images/usage-0.2.2-light.png)](https://github.com/Missher12/Missher-DSH-Usage-Statistics) | **Reasoning Effort 0.7.6**<br>[![Reasoning Effort](https://raw.githubusercontent.com/Missher12/Missher-DSH-Reasoning-Effort/317271f1eaa3d268f8d91c7c86b468ca8cbac67b/docs/images/reasoning-slider-alpha5.png)](https://github.com/Missher12/Missher-DSH-Reasoning-Effort) |
| **Output Renderer 0.1.3**<br>[![Output Renderer](https://raw.githubusercontent.com/Missher12/Missher-DSH-Output-Renderer/ff979cfb33081183915bb285e4095a52542d0d5c/docs/images/output-process-alpha5.png)](https://github.com/Missher12/Missher-DSH-Output-Renderer) | **Project Ops 0.4.0**<br>[![Project Ops](https://raw.githubusercontent.com/Missher12/Missher-DSH-Project-Ops/a283f8ee1e5324253e55ce69d48f6fbfd3fed260/docs/images/task-panel-0.4.0.jpg)](https://github.com/Missher12/Missher-DSH-Project-Ops) |
| **MSE Learning 0.10.0**<br>[![MSE Learning](https://raw.githubusercontent.com/Missher12/Missher-MSE-Learning/50a26bca5dc63222bd5e98bd6197f45cf98e7ce0/docs/images/official-alpha5-zh-r11.png)](https://github.com/Missher12/Missher-MSE-Learning) | **Session Bridge 0.1.3**<br>[![Session Bridge](https://raw.githubusercontent.com/Missher12/Missher-DSH-Session-Bridge/6a0017fae8aa1e8f46c76695aa33208661a0aceb/docs/images/header-full-alpha2.png)](https://github.com/Missher12/Missher-DSH-Session-Bridge) |

## Private and independent projects

| Project | What it does | Install in |
| --- | --- | --- |
| [Media@Missher](https://github.com/Missher12/Missher-Media) | Chrome CDP collection, evidence and selected exports | DSH, with repository access |
| [Independent Obsidian Memory](https://github.com/Missher12/Missher-Obsidian-Memory) | Markdown memory, search, review and optional AI inside your Vault | Obsidian; not a DSH plugin |

Only Media stays private and requires an authorized GitHub account. Independent Obsidian Memory is public under MIT; personal Vaults and notes are excluded. The retired DSH Obsidian bundle is not part of the current install set. Removing that bundle does not authorize deleting the independent Obsidian plugin, source, Vaults or notes. MSE publishes product code only; private learning records are excluded.

<a id="release-and-version-compatibility"></a>

## Release and version compatibility

Accepted community deliveries use regular Releases. Existing tag names and package versions preserve their build identity, including an upstream alpha or rc identifier. Maintained plugins aim to support a reasonable range of Host versions and keep pace with the latest release. Compatibility depends on required API capabilities and justified version ranges; a tested version records the validation baseline, not the only usable version. Each release documents its minimum requirements, verified targets and known limitations. New or older versions outside that evidence still require validation.

## Confirm an update

Compare the selected release with the app version, each plugin's installed version and its load status in the active profile. Restart only after active tasks and queued work are safely handled, then check the entry point you use. A Git push, package on disk or loader check alone does not establish that the running application and all plugin workflows are current. Desktop and plugin packages update separately; exact checksums and platform limits belong to each release.

## Choose the right owner

| Requirement | Owner |
| --- | --- |
| Image uploads and limits; composer `@plugin` references | Host [attachments](../packages/attachment/) and [client](../packages/client/) |
| Supported reasoning levels in model settings | Host [model directory](../packages/client/ui-settings-models/) |
| Current-session context and cumulative usage | Context Manager |
| Usage aggregated across sessions | Usage Statistics |
| Assistant output appearance | Output Renderer |
| Session identity, messaging, and scratch workspaces | Session Bridge |
| Project tasks, development plans and delivery records | Project Ops |

Composer references list callable capabilities. A plugin that only adds a settings page or renderer does not become an `@` command merely because it is installed.

## Separate projects

[OpenViking](https://github.com/volcengine/OpenViking) is a third-party memory service with an optional DSH plugin; configure its service and embedding model separately. It is not one of the Missher-developed plugins above. See [ownership and privacy](../CORDIS.md#独立项目).

## Next steps

Follow [installation](../docs/cookbook/install-cordis-plugins.md) to enable a built plugin, or [development](../docs/cookbook/build-cordis-plugins.md) to build and package it. Continue plugin development in its linked independent repository; this host repository retains its import history.
