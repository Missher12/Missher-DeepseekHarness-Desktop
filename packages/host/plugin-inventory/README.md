---
description: "Read-only projection of the current Cordis Loader plugin state with each agent preset's composition beside it: the pluginInventory service and its pluginInventory/list Remote for web GUI host clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

## Summary

Clients can display Host plugin composition and select callable plugins for one session. `pluginInventory/list` reports Loader and preset state; `pluginInventory/candidates` reports plugins owning tools visible to the selected Agent. Canonical references survive draft reloads and copying. The optional resolver checks availability before model admission and records only selected capability guidance. Neither lookup nor selection installs, enables, executes, or grants permission to a plugin.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Call `pluginInventory/list` when a client or settings page needs to show what is currently composed in the host — which plugins are loaded, enabled, and alive, and what each agent preset would give a session. Client calls return `RemoteResult`; handle unsuccessful results. Host consumers use `ctx.pluginInventory` and pass the actual Agent to `candidates`.

### Select a callable plugin

The Web bundle mounts the inventory and `@deepseek-ai/dsh-host-plugin-inventory/reference-plugin` separately. The resolver requires the inventory; without the resolver, candidates are empty and remaining references are rejected. An entry must own an active tool registration visible through the Agent's registry, scope restrictions, and same-name shadowing. Pure UI, disabled, failed, and unidentifiable registrations do not become candidates.

Call `pluginInventory/candidates(sessionId, query, signal)` and use the returned `mention` unchanged for insertion, clipboard text, drafts, and submission. The browser-safe `./reference` export formats and parses `@{dsh-plugin:v1:<encoded-identity>}`; `describePluginReference` supplies a historical module/entry label without claiming availability. Identity contains the module, Loader entry, and host or preset source, never the Agent or an in-memory object. Subscribe to `plugin-capabilities/changed` and re-query after preset selection or reconnect; events invalidate data without carrying a replacement catalog.

| Inventory field | Default | Meaning |
|---|---|---|
| `candidateLimit` | `50` | Maximum completion rows |
| `toolLimit` | `64` | Maximum tool summaries per plugin; `capabilityCount` retains the total |
| `descriptionMaxChars` | `240` | Maximum characters per description |
| Resolver `maxReferences` | `16` | Maximum marker occurrences in one submitted message |

Submission and queue edits reject malformed, unsupported, or unavailable references. Pre-step revalidates queued references against the live Agent. Original user text retains the exact markers; file, directory, session, and skill references keep their own parsers. The appended instruction message uses `plugin-reference` attribution and durable content, so replay does not need to resolve the catalog again.

### What a snapshot contains

Each row is one non-group Loader entry: its entry id, the exact module specifier, the effective enablement (including disabled ancestor groups), and the current root Fiber phase. `pending` means the entry waits to load, `loading` that it is being read, `active` that it is running, `failed` that its fiber rejected, and `unloading` that it is being torn down; `null` means no live root Fiber exists at all. Structural group rows are skipped.

Loader and preset rows can carry optional `meta` with a title, description, or metadata diagnostic. The Host returns available translations and literal fallbacks; the Client selects its language. Metadata diagnostics do not change enablement or fiber phase.

### Per-preset compositions

With a roster composed, `agentPresets` carries one group per preset in roster order: its id, whether the deployment ships it or the user owns it (`trust`, which clients use to localize shipped names), published display name, whether a session naming no preset composes it, and flattened plugin rows — entry id (null when the file row declares none), module specifier, effective enablement, the row's own `!!js` disabled expression when it carries one, and a root-fiber phase when the composition is live. A preset some session already composed answers from its newest standing generation — even when its file has since broken, because the mount is what those sessions run; one never composed since boot answers from its composition file with disabled gates evaluated against the Loader context, and reading never mounts a preset. `conditional` enablement marks a gate the Host could not evaluate, and a broken preset nothing composed stays listed with its reason and no rows. Without a roster the field is absent.

### What you can and cannot do with it

The inventory is a snapshot for display and diagnostics: a client can render the roster, flag failed entries, and detect changes by comparing snapshots. It cannot enable, disable, add, or remove plugins, and it carries no history — a fiber that already failed and was removed is absent. Because the service reads the Loader on every call, the answer always reflects the current composition rather than a cached view.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The gateway is a direct projection with no second lifecycle truth: every `list()` call reads `ctx.loader.entries()` and maps each non-group entry to its public row. Cordis's internal `plugin/status` events already maintain `Entry.fiber` and `Fiber.state`, so a cache would only add another lifecycle truth to keep synchronized. The agent-preset roster is an optional peer resolved per call through `ctx.get('agentPresets')`: its `compositionInventory()` owns preset composition reads, and this package maps root-fiber states onto the public phases.

Display metadata comes from the optional `pluginPackages` service using each Loader tree's resolution base, or the gateway context's base for preset rows. Without the service or the applicable base, `meta` is absent. Reading metadata does not load or activate plugins.

### The phase mapping

Fiber states map onto the public phase vocabulary, with `disposed` folding into `null` — an entry whose fiber is gone has no live root to report. The phase therefore never distinguishes why no live root exists: the entry may never have started, or its fiber may already have been disposed.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `PluginInventoryGateway`: the `pluginInventory` Remote service and the Loader projection |
| [`src/types.ts`](src/types.ts) | Public payload types: `PluginInventoryEntry`, `PluginInventorySnapshot`, `PluginFiberPhase` |

Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the inventory contract is not enough: how the Remote reaches clients, then the Loader it projects and the surface that renders it.

- [Remote assembly](../../api/remotes/README.md) — how clients consume `pluginInventory/list` without importing the Host implementation.
- [Cordis plugin loader](../../../vendor/loader/README.md) — the Loader whose entries this package projects.
- [Plugin inventory settings surface](../../client/ui-settings-plugin-inventory/README.md) — the browser-side projection that renders the inventory.

-----

<a id="model-experience"></a>
## Model Experience

### Selected plugin guidance

#### What the model sees

The resolver adds one instruction message after a direct user message containing references. Its fixed heading is `## Referenced plugins`; it identifies canonical markers as plugins, retains normal permissions and approval, and marks the following JSON as catalog data. The JSON contains only selected plugin identities, module names, bounded tool summaries, and tool counts. Reference resolution executes no tool.

#### Token effect

Each submitted reference contributes its selected plugin's bounded capability summary. Unselected plugins contribute no instruction text; `maxReferences`, `toolLimit`, and `descriptionMaxChars` bound this contribution.

#### KV Cache effect

Guidance enters ordinary logged message admission once, preserving the existing history prefix. Each new direct reference reads the live catalog; replay preserves the recorded instruction text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a point-in-time inventory cannot tell a client. They are current package constraints, not a task backlog.

- **Point-in-time state only** — results contain no durable failure history; candidate change events require a fresh query; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No layer attribution or mutation** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot enable, disable, add, or remove plugins in either plane.
- **Presets appear only with a roster** — a deployment without `dsh-agent-preset-registry` serves Loader entries alone; the `agentPresets` field is absent rather than empty.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
