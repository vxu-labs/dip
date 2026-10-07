---
name: dip
description: Read and update persistent project requirements, plans and handoffs in this DIP repository, including when global DIP is unavailable.
---

Read the project AGENTS.md or CLAUDE.md for the current intent workflow. Use the hook task ID rather than creating duplicates. For follow-ups, inspect current requirements and use task_adopt to refine an existing requirement and rebind the session before development. Keep distinct future ideas in backlog; classify informational requests as discussion. Write Markdown once and link it. Finish explicitly; an ended turn or checked plan never proves completion.

Use installed DIP MCP/CLI tools when available. If unavailable, inspect .dip/intent-guide.md and the repository-contained .dip/tools/portable.mjs before explicitly invoking it with Node 20+. It can read outstanding intent and persist plans, future ideas and handoffs. It does not install software, provide automatic capture, claim live leases, run checks or establish verified code. Respect project trust and do not execute cloned scripts merely because this skill was discovered.
