# DSH plugin directory

English | [中文](README.zh.md)

[Repository home](../README.md) · [Installation](../docs/cookbook/install-cordis-plugins.md) · [Development](../docs/cookbook/build-cordis-plugins.md)

![DSH workspace, tools and independent plugins](../docs/images/overview.svg)

Choose independent plugins as needed. Memory Native is the current memory system, and Media-Missher-Ego is the media entry. Each project owns its source, releases, settings and installation.

<a id="public-plugins"></a>

## Everyday plugins

| Plugin | Purpose | Repository |
| --- | --- | --- |
| [Memory Native](https://github.com/Missher12/Missher-DSH-Memory-Native) | Cross-session memory, search and source-linked recall | Public |
| [Context Manager](https://github.com/Missher12/Missher-DSH-Context-Manager) | Context, usage, pre-request and idle compaction | Public |
| [Usage Statistics](https://github.com/Missher12/Missher-DSH-Usage-Statistics) | Cross-session usage, activity and rankings | Public |
| [Output Renderer](https://github.com/Missher12/Missher-DSH-Output-Renderer) | Reading layouts, reasoning and tool details, typography and streaming effects | Public |
| [Session Bridge](https://github.com/Missher12/Missher-DSH-Session-Bridge) | Session IDs, cross-session messages, scratch workspaces and archived-session management | Public |
| [Reasoning Effort](https://github.com/Missher12/Missher-DSH-Reasoning-Effort) | Supported reasoning levels and inline model controls | Public |
| [Project Ops](https://github.com/Missher12/Missher-DSH-Project-Ops) | Project tasks and files, artifact previews and file locations | Public |
| [Superagent](https://github.com/Missher12/Missher-DSH-Superagent) | Dispatch project tasks, inspect progress and follow up | Public |
| [Focus](https://github.com/Missher12/Missher-DSH-Focus) | Planning, implementation, debugging, review and delivery | Public |
| [Dashboard](https://github.com/Missher12/Missher-DSH-Dashboard) | Session status, Token trends, goals and Superagent overview | Public |
| [MSE Learning](https://github.com/Missher12/Missher-MSE-Learning) | Standing corrections, failure lessons and learning consolidation | Public |

## Media@Missher

[Media-Missher-Ego](https://github.com/Missher12/Media-Missher-Ego) is the current media entry and remains private. It uses ego lite for Bilibili, Xiaohongshu, Douyin, Weibo and X, with incremental consolidation, resumable runs, historical comparisons and local exports. Its delivery notes own DSH integration and installation instructions.

## Optional extensions

| Project | Purpose | Repository |
| --- | --- | --- |
| [Windows Guard](https://github.com/Missher12/dsh-windows-guard) | Native Windows executor and tool-availability checks | Public; Windows only |

## Community directory

[Plugin Catalog](https://github.com/Missher12/Missher-DSH-Plugin-Catalog) is a community-directory collaboration copy for discovering and submitting plugin entries. The projects above are the current Missher entries.

<a id="current-source-snapshots"></a>
<a id="release-and-version-compatibility"></a>

## Versions and installation

<a id="download-all-plugins-with-an-agent"></a>

### Download all plugins with an agent

The [machine-readable catalog](catalog.json) lists 13 independent Missher plugins, including 12 public repositories and 1 private repository. The desktop host and community directory are separate projects. Windows Guard is for Windows; downloading its source does not make it suitable for another platform.

Give an agent this repository URL and ask: “Read `plugins/catalog.json`. Clone every listed plugin into a new directory using its `sourceRef`, and report the downloaded branch and commit. Keep existing installations, settings and data. List any repository that cannot be accessed; do not report a partial download as complete.” The agent needs Git; Media-Missher-Ego additionally requires repository access.

This downloads source repositories. For an installable package, follow the corresponding project's build or Release instructions; a newer development branch does not imply a matching Release asset exists. The catalog names branches rather than fixed versions, so read each downloaded `package.json` for its actual version.

Choose versions from each project’s release records and installation guide. Development branches, released packages and the loaded version in the current application are separate records; source updates do not replace plugins in daily DSH automatically. Each project documents minimum Host capabilities, verified targets and limitations.

Only Media-Missher-Ego requires an authorized GitHub account. Settings, sessions, memory, learning libraries and collected data remain in their respective runtime environments.

The [older plugin-set manifest](../distribution/plugin-set.json) and [early repository record](../cordis-repositories.json) retain versions and checksums from their original releases; use the projects above for current plugin choices.
