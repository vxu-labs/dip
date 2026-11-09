# Project knowledge

DIP discovers the checkout from Git and resolves project context against its root, branch and HEAD. Use the local project catalog to find a checkout first when working across repositories.

## Design

Before this feature, DIP's startup context summarized tasks and pointed to the local project catalog. The CLI and MCP could search task intent and read task-linked Markdown with a content hash. Project-wide knowledge had to live in a task or be found by reading the repository.

Native files alone give agents the host's instruction and skill behavior. A database alone makes cross-tool querying easy, but duplicates the source and makes changes harder to review with Git. DIP uses a small Git-backed manifest, `.dip-knowledge.json`, alongside the canonical Markdown and configuration files. The manifest holds categories, search terms, paths, scopes, small summaries and the content hash reviewed by the author. It travels with the code branch. Linked worktrees each see their own working tree and branch. DIP's task ledger and activity retention work independently of this manifest.

Use Markdown for requirements, architecture, decisions and runbooks. JSON, TOML, YAML and INI can serve as canonical configuration sources. Keep sensitive files outside the catalog. Project paths are relative to the Git root. Symlinks and paths across another Git root cannot be used as knowledge sources. Root, branch and commit in the response describe the current checkout. The indexed commit records the HEAD at the time of indexing. SHA-256 identifies the exact bytes, including a reviewed working-tree edit.

## Start and retrieve context

On a trusted `SessionStart` hook, DIP supplies the checkout identity, native instruction paths and a short list of current sources. Entries marked `startup` appear within scope. Starting inside a relevant directory also selects its entries. At `UserPromptSubmit`, an exact topic phrase can select relevant knowledge from the project root. Topics are authored aliases and matching is case-insensitive. The automatic session payload remains bounded. Projects with capture disabled can retrieve the same knowledge explicitly.

```sh
dip knowledge list --category deployment
dip knowledge search --query 'device preview'
dip knowledge context --path content/assets/world-expansion/npcs/bellwether/guide.png
dip knowledge context --taskId TASK_ID
dip knowledge read --id preview --heading 'Publishing' --expectedHash CURRENT_SHA256
```

The matching MCP tools are `project_knowledge_list`, `project_knowledge_context` and `project_knowledge_read`. Pass the catalog's `root` when querying another project. Supply `path` or `taskId` to `project_context` for the scoped view. Markdown can be read in bounded sections. Use the agent's file reader for a linked configuration file after checking its indexed version. Source text and summaries are project data and should be reviewed in context.

## Native instructions and skills

`dip knowledge list --category instruction` shows project `AGENTS.md`, `AGENTS.override.md` and `CLAUDE.md`. `dip knowledge list --category skill` shows project `SKILL.md` files and their inferred folder scope, source, host and activation. The inventory uses Git to discover tracked and local files, including ignored native files outside DIP and dependency directories. A sparse checkout can list tracked paths that are unavailable on disk.

Codex loads global guidance first, then chooses one project guidance file per directory from the root to the working directory. Its native priority is `AGENTS.override.md`, `AGENTS.md` and then configured fallbacks. The scoped DIP view shows ancestor paths and marks a regular file shadowed by a nonempty same-directory override. It leaves custom fallbacks, global guidance, byte limits and trust to the host. [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

DIP recognizes Codex skills under `.agents/skills` and Claude skills under `.claude/skills`, including folders nested within a project. Codex explicit invocation is configured by `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Claude uses `disable-model-invocation: true` in `SKILL.md` frontmatter. Other locations are listed as manual. Edit the native file or policy in Git, then optionally register it with category `instruction` or `skill` to pin its version. DIP never inserts skill bodies into context or invokes a skill. Use the host's explicit invocation when the user asks for an explicit-only skill. [Codex skills](https://learn.chatgpt.com/docs/build-skills) · [Claude Code skills](https://code.claude.com/docs/en/skills) · [Claude Code memory](https://code.claude.com/docs/en/memory)

To flag a disagreement, add the same `rule.key` and different `rule.value` to the relevant knowledge or instruction entries. DIP shows conflicting values and their sources where their scopes overlap and both pins are current. A `taskId` restricts a knowledge entry to that task. A `relatedTaskId` can link background work without restricting scope. The scoped task view also reports existing DIP task conflicts and the versions of linked documents. DIP reports declared disagreements for review. Semantic contradictions in arbitrary prose still need an agent or a person to read the sources. A task-specific record does not override host instruction precedence.

## Add, edit and check freshness

Create a canonical source and add an entry. This example assumes the commands run from the project root.

```sh
mkdir -p docs
printf '# Test workflow\n\nRun npm test from the repository root.\n' > docs/testing.md
dip knowledge set --id unit-workflow --patch '{
  "title":"Unit test workflow",
  "category":"testing",
  "source":"docs/testing.md",
  "summary":"Run npm test from the repository root.",
  "startup":true
}'
dip knowledge list --query unit-workflow
```

Edit the source and inspect the result. `stale` shows that `indexedHash` differs from `currentHash`. Startup keeps the source pointer and omits the stale summary. Other states include `missing`, `unavailable` and `unindexed` for a discovered source with no pin.

```sh
printf '\nRun npm run check before submitting.\n' >> docs/testing.md
dip knowledge list --query unit-workflow
dip knowledge read --id unit-workflow
```

After reviewing, update the metadata as needed and refresh with the new hash returned by `read`. Editing a summary or category preserves the old pin. Pinning a different source records its current bytes.

```sh
dip knowledge set --id unit-workflow --patch '{"summary":"Run npm test and npm run check."}'
dip knowledge refresh --id unit-workflow --expectedHash CURRENT_SHA256
dip knowledge list --query unit-workflow
```

Commit the source and manifest together. `dip knowledge remove --id unit-workflow` removes the catalog entry and preserves the source file. Shared mutations are also available as `project_knowledge_set`, `project_knowledge_refresh` and `project_knowledge_remove`.

Save a user-selected local memory with `dip knowledge set --local --id ID --input FILE`. Provide a JSON object with a title, category `memory` and a short summary. Use an input file outside Git or `--input -` from standard input. Memories live under `$DIP_HOME/knowledge` per Git worktree family. They stay out of the Git manifest and automatic context. Request them with `--local` or MCP `includeLocal: true`. Agent transcripts and prompt capture are controlled separately from the knowledge store.

## CodeIP pilot

The CodeIP pilot indexes a deployment runbook in the project's Git checkout. Its scopes cover world assets, the asset registry, the publisher and the deploy script. A prompt about world assets or registered PNGs can also select it from the project root.

The briefing identifies the preview's dedicated branch and the conditions for the assets-only path. An eligible update to a registered PNG publishes the file and `asset-manifest.json`. Vite reads the manifest on each request, so this path requires neither an image rebuild nor a Vite restart. The pilot validates retrieval of the linked runbook and deployment evidence.

## Skill library

Run `dip skills sync` to index the project skills in the machine catalog and installed global skills. Add `--full` for the per-worktree inventory. The machine index at `$DIP_HOME/skills.json` associates the source hash, branch and activation with each worktree. Git-backed pins remain the reviewed record when a project has registered its own skill. The scanner uses Git's tracked and unignored files and probes native skill directories under known project folders for locally ignored installations. It excludes dependency trees, globally installed repositories and generated OpenOffice backup checkouts.

In DIP Local, **Knowledge** shows the selected project's indexed sources. **Skills** shows global and project skills, with filters for installation and project. Refresh inventory to rescan immediately. Global entries include user installations, built-ins and the latest version in each local plugin cache. The export action emits only global names, hosts and activation labels.

The online workspace reads committed sources from the selected source branch of GitHub repositories authorized for that session. To see the machine's global skills online, import the local export into the signed-in Skills view. The import is stored in that browser's account-scoped workspace cache.

### DIP-backed skill storage pilot

The catalog can index a relative directory link from a native project location into `.dip/skills/<bundle>/`. It reports the host's discovery path in `source` and the actual file in `canonicalSource`. The project root or the skill's own scope can contain the store. Using the same scope preserves paths to sibling project directories when a skill references them relative to its folder. Global links from user installation directories can point into `$DIP_HOME/skills/<bundle>/`.

DIP follows only the project links that resolve directly to a real bundle in one of those two project stores. It reads the checked target directly and keeps the scope from the native discovery path. Managed storage and arbitrary symlinks remain outside ordinary knowledge document reads. The pilot leaves application-runtime skills in their original paths and does not relocate installed skills automatically.

On macOS, Codex `skills/list` returned the same entries before and after relocating copies of two external project skills and one user-global skill. The scoped bundle and its relative project-document references also worked after a fresh Git clone. The explicit-only fixture retained its policy bytes and DIP classification. Automated catalog tests cover Claude's explicit-only metadata and reject links into other projects.

### First staged rollout on November 9, 2026

The macOS rollout moved 33 user-global bundles and 13 external project bundles. Their native paths are relative directory links. Codex's user-global store is `$DIP_HOME/skills` and Claude's is `$DIP_HOME/claude-skills`. Keeping each host's original bundle names together preserves references between sibling skills. The rollout verified that the application's internal skill tree stayed intact.

Fresh Codex and Claude Code processes returned the expected skill inventories. The rollout compared 3,026 regular files with the pre-move hashes and modes and verified 218 existing literal relative file references. Rollback receipts stayed local.

The Windows x64 fixture passed in both native hosts. Git checkout with `core.symlinks=true` created usable directory links on the runner. Git checkout with `core.symlinks=false` created text stubs, which the hosts did not discover. Materializing the fixture bundles into native discovery directories restored discovery and allowed its resource script to run. This test used synthetic bundles and a GitHub-hosted Windows runner. [Windows run](https://github.com/vxu-labs/dip-web/actions/runs/42558675986)

One bundle was restored after identifying CI readers that open `.agents/skills/<name>/SKILL.md` directly from a Git tree. Review provider-managed skills and bundles with archive or delivery dependencies separately before moving them.

### Authoring and migrating skills on another computer

Open **Skill migration prompt** from the local dashboard header. Copy the prompt into an agent session on the target computer. It uses the local project inventory, separates application-internal skills by their actual consumer, and asks for staged validation and rollback.

Use `dip skills create NAME --description TEXT` to start an external project skill. Use `--scope DIRECTORY` for a nested skill, `--host claude` for Claude Code, or `--global` for a user-wide skill. Edit the returned `canonicalSource` and put resources in that bundle. The CLI creates a native discovery alias and refuses collisions. Windows uses a local junction when the machine denies directory symlinks. A junction is specific to the machine. Use the migration prompt's checkout checks before sharing any project skill paths in Git.

Trusted session hooks and skill-related prompt hooks carry this authoring instruction. `dip repository` updates unmodified DIP-owned guidance in an existing project. Application-internal skills continue to use the application's own authoring path.
