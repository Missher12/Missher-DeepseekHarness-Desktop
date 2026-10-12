---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-12-branch-integration

[English](2026-10-12-branch-integration.md) | 中文

## 概述

在四个共享事件根上合并 plugin-references 与 working-directory-attribution 两个分叉（title 根自 title-reasoning-effort 延续）到 current 合并 schema，不改变会话格式版本。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

两个被承认的父版本仍可读取；合并保持所有已发布 acknowledged 记录逐字节不变，仅在一条 same-version 记录中记录合并后的 current schema。

<a id="verification"></a>
## 验证

scripts/persistence-changes.spec.ts 全部 87 项测试通过，包括 explicit persistence merges 套件（分叉合流、已发布记录不变、重复/缺失父记录与环、对任一父边的 --update 后继保护、真实 CLI 多根多次 --merge）；随后 pnpm run persistence-changes --check 报告 roots match。

<a id="dev-note"></a>
## 开发备注

无。
