---
trigger: always_on
description: Consult GitNexus code intelligence knowledge graph for codebase navigation and impact analysis.
---

## GitNexus

This project is indexed by GitNexus.

Rules:
- For codebase or architecture questions, first use `gitnexus query "<concept>"` (CLI) or GitNexus MCP tools (`query`, `context`, `impact`, `trace`).
- Before modifying symbols, run `gitnexus impact` to analyze blast radius and caller dependencies.
- After modifying code files in this session, run `gitnexus analyze` to update the graph index.
