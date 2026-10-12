# DSH plugin directory

English | [中文](README.zh.md)

[Repository home](../README.md) · [Install](../docs/cookbook/install-cordis-plugins.md) · [Develop](../docs/cookbook/build-cordis-plugins.md)

This is the common directory for the current Missher projects: eight public DSH plugins and two private projects. Every project name opens its own repository. Public DSH plugins have independent builds, packages, settings and installation; none requires a separate common compatibility plugin. Model-row settings, image uploads and composer references also use the Desktop features described below.

<a id="public-plugins"></a>

## Public plugins

| Plugin | What it does | Open in DSH | Links |
| --- | --- | --- | --- |
| [Context Manager](https://github.com/Missher12/Missher-DSH-Context-Manager) | Pre-request compaction, current context, content, per-reply changes and session totals | Conversation → Context; Settings → Context Management | [Bundle download](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2-missher.20261012.1) |
| [Usage Statistics](https://github.com/Missher12/Missher-DSH-Usage-Statistics) | Cross-session usage, activity and model/tool/skill rankings | Settings → Usage Statistics | [Bundle download](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2-missher.20261012.1) |
| [Output Renderer](https://github.com/Missher12/Missher-DSH-Output-Renderer) | Four single-column layouts, full reasoning, tool details and streaming effects | Settings → Output Appearance | [Bundle download](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2-missher.20261012.1) |
| [Session Bridge](https://github.com/Missher12/Missher-DSH-Session-Bridge) | Session IDs, cross-session messages, scratch workspaces and archived-session deletion | Sidebar session menu; New Session → workspace selector | [Bundle download](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2-missher.20261012.1) |
| [Reasoning Effort](https://github.com/Missher12/Missher-DSH-Reasoning-Effort) | Reasoning slider, colors and per-model levels | Model settings; reasoning control | [Bundle download](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2-missher.20261012.1) |
| [Project Ops](https://github.com/Missher12/Missher-DSH-Project-Ops) | Project tasks, PLAN.md development plans and READY.md delivery records | Session header → Project Ops | [Bundle download](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2-missher.20261012.1) |
| [MSE Learning](https://github.com/Missher12/Missher-MSE-Learning) | Scoped learning, recall and review | MSE settings and commands | [Bundle download](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2-missher.20261012.1) |
| [Computer Browser](https://github.com/Missher12/Missher-DSH-Computer-Browser) | Browser and computer controls; development is paused | Browser sidebar and Computer tools | [Releases](https://github.com/Missher12/Missher-DSH-Computer-Browser/releases) |

Use the [seven-plugin set and package list](https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-alpha.2-missher.20261012.1) for this Desktop release. Each package has an exact version and checksum; install the plugins you need. Separate plugin Releases pages can lag behind this set. See MSE's [delivery notes](https://github.com/Missher12/Missher-MSE-Learning/blob/main/PUBLICATION.md) for accepted checks and remaining limits. Computer Browser is excluded: its paused native workflows have not been accepted for the new Host.

The repository's [older plugin-set record](../distribution/plugin-set.json) and [repository record](../cordis-repositories.json) retain an earlier release; use the package list attached to the selected release for installation.

## Private and independent projects

| Project | What it does | Install in |
| --- | --- | --- |
| [Media@Missher](https://github.com/Missher12/Missher-Media) | Chrome CDP collection, evidence and selected exports | DSH, with repository access |
| [Independent Obsidian Memory](https://github.com/Missher12/Missher-Obsidian-Memory) | Markdown memory, search, review and optional AI inside your Vault | Obsidian; not a DSH plugin |

Both repositories stay private. Sign in with an authorized GitHub account; a 404 does not prove the project was deleted. The retired DSH Obsidian bundle is not part of the current install set. Removing that bundle does not authorize deleting the independent Obsidian plugin, source, Vaults or notes. MSE publishes product code only; private learning records are excluded.

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
