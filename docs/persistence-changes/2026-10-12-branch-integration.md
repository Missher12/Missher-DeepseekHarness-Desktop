---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-branch-integration

English | [中文](2026-10-12-branch-integration.zh.md)

## Summary

Acknowledges the combined schema after joining the plugin-references and working-directory-attribution forks (title root continuing from title-reasoning-effort) on the four shared event roots, without changing the session format version.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-branch-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    merges: ["2026-09-28-plugin-references"]
    after: "61676628dea74fc1fee30bf7f357e5d8e7b369c103184e99334dfd8bd007129e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    merges: ["2026-09-28-plugin-references"]
    after: "92b6ba802d01799eb67bbc3004c64ed7b0d603b99b88ea8f94679ca4b02e846f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    merges: ["2026-09-28-plugin-references"]
    after: "558d3265089ea23554d911e2fc8f3a2e61b7b2c759592e2a1b93cc73bba08cc0"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    merges: ["2026-09-28-plugin-references"]
    after: "8169b6cf5e576fc51a3da911e24729c72db9b79319ae274808753fc2d56dc964"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both acknowledged parent versions remain readable; the merge keeps every published acknowledgement byte-identical and only records the combined current schema under one same-version record.

<a id="verification"></a>
## Verification

scripts/persistence-changes.spec.ts passes all 87 tests, including the explicit persistence merges suite covering fork join, unchanged published records, duplicate/missing parents and cycles, --update successor protection for either parent edge, and a real-CLI multi-root multi-merge run; pnpm run persistence-changes --check reports roots match afterwards.

<a id="dev-note"></a>
## Dev Note

None.
