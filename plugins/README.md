# DSH plugin directory

English | [中文](README.zh.md)

[Repository home](../README.md) · [Install](../docs/cookbook/install-cordis-plugins.md) · [Develop](../docs/cookbook/build-cordis-plugins.md)

This is the common directory for the current Missher projects: eight public DSH plugins and two private projects. Every project name opens its own repository. Public DSH plugins have independent builds, packages, settings and installation; none requires a separate common compatibility plugin. Model-row settings, image uploads and composer references also use the Desktop features described below.

<a id="public-plugins"></a>

## Public plugins

| Plugin | What it does | Open in DSH | Links |
| --- | --- | --- | --- |
| [Context Manager](https://github.com/Missher12/Missher-DSH-Context-Manager) | Pre-request compaction, current context, content, per-reply changes and session totals | Conversation → Context; Settings → Context Management | [Releases](https://github.com/Missher12/Missher-DSH-Context-Manager/releases) |
| [Usage Statistics](https://github.com/Missher12/Missher-DSH-Usage-Statistics) | Cross-session usage, activity and model/tool/skill rankings | Settings → Usage Statistics | [Releases](https://github.com/Missher12/Missher-DSH-Usage-Statistics/releases) |
| [Output Renderer](https://github.com/Missher12/Missher-DSH-Output-Renderer) | Four single-column layouts, full reasoning, tool details and streaming effects | Settings → Output Appearance | [Releases](https://github.com/Missher12/Missher-DSH-Output-Renderer/releases) |
| [Session Bridge](https://github.com/Missher12/Missher-DSH-Session-Bridge) | Session IDs, cross-session messages, scratch workspaces and archived-session deletion | Sidebar session menu; New Session → workspace selector | [Releases](https://github.com/Missher12/Missher-DSH-Session-Bridge/releases) |
| [Reasoning Effort](https://github.com/Missher12/Missher-DSH-Reasoning-Effort) | Reasoning slider, colors and per-model levels | Model settings; reasoning control | [Releases](https://github.com/Missher12/Missher-DSH-Reasoning-Effort/releases) |
| [Project Ops](https://github.com/Missher12/Missher-DSH-Project-Ops) | Project tasks; the 0.4 candidate adds PLAN.md and READY.md records | Session header → Project Ops in the 0.4 candidate | [Releases](https://github.com/Missher12/Missher-DSH-Project-Ops/releases) |
| [MSE Learning](https://github.com/Missher12/Missher-MSE-Learning) | Scoped learning and recall; the current upgrade is still in development | MSE settings and commands | [Releases](https://github.com/Missher12/Missher-MSE-Learning/releases) |
| [Computer Browser](https://github.com/Missher12/Missher-DSH-Computer-Browser) | Browser and computer controls; development is paused | Browser sidebar and Computer tools | [Releases](https://github.com/Missher12/Missher-DSH-Computer-Browser/releases) |

The [release manifest](../distribution/plugin-set.json) and [repository manifest](../cordis-repositories.json) pin the already published plugin set; they are not a rolling list of unpublished candidates. A Releases link can still show an older package while development continues. Project Ops 0.4 is not yet a published release. MSE's published alpha.18 has a native persistence limitation on the new Host; its replacement is not ready. Computer Browser's paused native workflows are not accepted for the new Host. Existing checks describe their own version and scope.

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
