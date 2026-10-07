# Repository skills and portable intent

`dip init`, adoption and normal instruction setup generate four files owned through `.dip/integration.json`:

- `.agents/skills/dip/SKILL.md` for repository skill discovery.
- `.claude/skills/dip/SKILL.md` for Claude Code project skills.
- `.dip/intent-guide.md` for fallback instructions.
- `.dip/tools/portable.mjs`, a dependency-free Node 20+ intent helper.

They travel with Git. Discoverability follows the hosts' [repository skill guidance](https://developers.openai.com/blog/skills-agents-sdk) and [Claude Code skill locations](https://code.claude.com/docs/en/skills). A host still decides whether to load/use a skill. This does not install or approve machine hooks on another computer.

A fresh clone with Node, without global DIP or dependencies, can run the reviewed helper:

```text
node .dip/tools/portable.mjs list
node .dip/tools/portable.mjs get --id TASK_ID
node .dip/tools/portable.mjs create --title "Future CSV export"
node .dip/tools/portable.mjs plan --id TASK_ID --text "Review the export contract"
node .dip/tools/portable.mjs checkpoint --id TASK_ID --summary "Not started" --next "Review requirements"
```

Review cloned code before explicitly executing it. Skill discovery does not authorize execution. No npm install, network call, cloud service or extra model is required. Use at your own responsibility.

The helper writes schema-1 causal events with unique IDs and current causal parents. Normal runtime projection consumes these events directly. Divergent field writes remain conflicts; `resolve --patch JSON` records an explicit reviewed resolution. Corrupt, missing-parent or cyclic histories prevent updates. Read-only list/get return bounded text or paginated summaries. A recorded verified status is historical; the helper does not assess current source.

Supported mutations are create, update, resolve, plan and checkpoint. Future creates stay in backlog. Portable updates cannot assert `verified` or `done`, execute verification commands or acquire leases. Strict projects reject portable writes; portable reads remain available. Collaborators must coordinate independently while using the fallback. Installed DIP (Node 24+) supplies automatic capture, Markdown section/link tools, live ownership and configured verification. A long plan should remain in Markdown, with a handoff pointing to it until installed linking is available.

## Owned upgrades and removal

`dip repository` upgrades unmodified owned files and enables repository integration. Foreign files at a generated path and user edits are preserved and reported. Version plus content hashes identify ownership. To upgrade a modified generated file, review/preserve your edits and remove that file explicitly before regenerating it.

`dip repository --remove` removes only unmodified owned files, preserves all intent history and user edits, and sets `repositoryIntegration: false` in project configuration. Subsequent normal setup respects this opt-out. Existing AGENTS.md/CLAUDE.md project policy is preserved. Run `dip repository` to re-enable generated assets. Empty directories need not be removed.
