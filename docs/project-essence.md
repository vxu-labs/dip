# Project essence

The project essence is DIP's README for a project: one Markdown file, `.dip-essence.md` at the project root,
that keeps the vision, principles, systems and open ideas behind the work. It is written for both the agent
and the developer, so either can follow the project's intent across sessions and workstations.

It complements the other DIP layers:

| Layer | Holds |
|---|---|
| Essence (`.dip-essence.md`) | Why the project exists and where it is going; ideas that are not tasks yet |
| Tasks | Concrete, deliverable work with acceptance and verification |
| Knowledge (`.dip-knowledge.json`) | Indexed project documents and instructions |

A good rule when capturing a long brief: every concrete item becomes a task; every general idea, principle or
vision goes into the essence, under the section it belongs to.

## Commands

```sh
dip essence                     # read the whole essence
dip essence read --heading "Open ideas"
dip essence init [--title NAME] # template with Vision, Core experience, Principles, Systems, Open ideas, Glossary
dip essence set --input essence.md
dip essence set --heading "Open ideas" --input section.md   # replace or append one section
```

MCP: `project_essence_read` (optional `heading`) and `project_essence_set` (`content`, optional `heading`,
optional `expectedHash` from a previous read, or `absent` for a new file, to avoid overwriting a concurrent
edit).

The dashboard has an **Essence** view. Prompt hooks add a pointer (path and section names, never the content)
when the file exists. The file is Git-tracked like any project document, limited to 256 KB, and never followed
through a symbolic link.
