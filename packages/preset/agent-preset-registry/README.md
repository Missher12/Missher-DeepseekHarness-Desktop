---
description: "Choose an Agent’s tools, prompt sections and skills through declarative presets. One process can run several compositions. Failed definitions remain visible, while existing Agents retain the composition they already use."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-preset-registry

English | [中文](README.zh.md)

## Summary

Choose an Agent’s tools, prompt sections and skills through declarative presets. One process can run several compositions. Failed definitions remain visible, while existing Agents retain the composition they already use.

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

### Minimal configuration

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    plugins: []
```

| Field | Default | Meaning |
|---|---|---|
| `default` | required | Preset ID used when none is requested |

The Web definitions come from the `dsh-web-app` bundle. Definitions are ordinary plugin rows; the registry neither scans directories nor accepts preset paths. The `selectedDefault` volatile field of the `agent-preset-registry` entry retains the user default, which new sessions resolve over the deployment `default`. A profile patch may still carry the retired `modeSelectionEnabled` field; the registry declares no such field and neither reads nor rewrites it.

The registry writes no declarations. The `read` Remote renders one declaration’s child list back as entry-list YAML (`!!js` conditions included) so a client can show what a preset composes; nothing accepts YAML back. A new preset or an override of a shipped one is a bundle patch: an `insert` of a `@deepseek-ai/dsh-agent-preset` row, or a patch keyed by that row’s id, installed into the profile with `plugin_manager`; Creator mode authors such bundles in conversation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each declaration eagerly creates a registry-owned scope and an in-memory Loader tree. Updating or removing a declaration retires its previous revision. Agents, children and temporary historical reads retain references; releasing the final reference disposes the retired tree. Plugin registrations inherit the preset scope, and the Agent scope’s parent link controls visibility. The Host continues to share the Agent loop.

`register(definition, identity)` takes the declaring row's real Loader identity. `entryId` is the hierarchical id the Loader composes from its containing trees and includes, `patchId` is the id patch layers target, and `fiber` is the declaring plugin's own fiber. Every field is optional and compared by identity; none is derived from another, so a replacement row is never mistaken for the declaration it replaces.

An optional `compactionProvider` replaces exactly one recursively nested `@deepseek-ai/dsh-compaction-basic` row before child plugins load. The replacement preserves its group, isolation settings and sibling order. Missing, duplicate or competing compaction providers reject activation; omitting the field mounts the declared child list unchanged.

A preset service provider and its consumers must share one `cordis:group` isolation realm. Entry-local isolation does not propagate through the Agent registration scope: ordinary Context lookup outside the group, including `agent.ctx`, still selects the Host realm. `agentPresets.serviceFor()` explicitly inspects the retained composition; it does not change ordinary service lookup.

Activation auditing checks imports, missing services and globally leaked services. Import failures, activation failures and leaks reject the mount. A row waiting for a Host service stays mounted, and every read and binding re-audits it after the Host Loader tree settles, so startup order does not decide the outcome. Failure prevents new bindings to that definition. Session logs retain the preset ID and blank-session selections; recovery after restart uses the current definition of that ID and rejects a missing definition.

`inspectCompositions()` reads all revisions retained by this registry; passing an Agent context selects its exact revision, or returns an empty list when it has no binding here. Each `AgentPresetInspection` contains a preset ID, detached active-module references with their resolution bases, and leaked-service names. Inspectors query the runtime service rather than a module-local mount table; the results contain no Loader trees or fibers. [composition-inventory.ts](src/composition-inventory.ts) defines these records.

| File | Responsibility |
|---|---|
| [index.ts](src/index.ts) | Registration, revisions and Agent bindings |
| [mount.ts](src/mount.ts) | Scoped plugin trees and activation auditing |

`presetForTree(agent.ctx, tree)` identifies the owner only when a registration tree belongs to the exact preset revision joined by that Agent; it does not enumerate unrelated retained revisions. Plugin reference consumers use this identity when projecting scoped tool registrations.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scope](../../core/scope/README.md) — Registration isolation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Cordis](../../../docs/cordis-primer.md) — Plugin configuration and lifecycle.

<a id="model-experience"></a>
## Model Experience

### Preset selection

#### What the model sees

Nothing directly: the selected preset’s `plugins` own the model-visible tools and prompt sections.

#### Token effect

None from this package; each mounted `plugins` row declares its own tools and sections.

#### KV Cache effect

Existing Agents retain their plugins and prompts. New Agents build their prefixes from the current definition.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Presets are not security sandboxes: YAML and plugins can execute Host code. A user override replaces the complete child list and does not automatically merge future changes to the builtin list. Old revision implementations are not retained across process restarts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

## Context host contract

The registry exposes `ctx.agentPresets.compactionHost`, whose contract version is `COMPACTION_HOST_VERSION`; a consumer that requires another version treats the Host as read-only instead of negotiating a partial contract.

`register(owner, registration)` names the provider module, the registering plugin's own context, a revision string, the preset ids the registration selects, and the Host rows or modules the provider needs; the selection governs only the revisions activated afterwards, and unloading the registering plugin withdraws it. The same owner, origin and module may register again to replace their own selection with a newer revision; a different origin or module must `revoke()` first, because a live selection is never overwritten by another integration.

`bindingFor(ctx)` reports the revision an Agent actually bound: its preset, declaring owner, generation ordinal, whether the owners it depends on are still active, whether it can still serve that Agent, whether a new binding would select it, and which registration supplied its provider. A revision a registration enhanced depends on its declaring row, the registering plugin and the Host nodes that registration named; a revision running the declaration's own rows is held by the registry's own scope, so it keeps serving its Agents after that row is unloaded. An unavailable revision keeps reporting its own source and provider rather than the declaration's rows.

`revoke()` returns future bindings to the declaration they came from, while revisions already bound keep the provider they mounted, so an old Agent, a sub-Agent and a cold reader are never rewritten by a later selection.
