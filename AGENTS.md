# Agent Instructions

## Roadmap

- Review `docs/roadmap.md` before planning or implementing post-MVP feature work.
- Follow the roadmap phase order unless the user explicitly changes priorities.
- Treat each roadmap phase as a separate project with its own implementation plan, tests, and documentation updates.

## Execution Style

- Prefer inline execution with review checkpoints.
- Do not use subagents by default. Use subagents only for narrow, read-only research when the user explicitly requests them or approves their use.
- Before editing feature code, inspect the current implementation and write or update a focused plan for the active phase.
- Keep changes small, tested, and independently shippable.

## Feature Notes

- The realistic Air Force example should come after leadership, taxonomy, focus sets, and YAML authoring exist.
- Use small synthetic fixtures for intermediate tests.
- Keep the existing embeddable component model; do not add backend persistence, authentication, or an editor unless the user explicitly asks for them.
