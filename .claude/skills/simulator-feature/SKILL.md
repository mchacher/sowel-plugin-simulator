---
name: simulator-feature
description: |
  Implements a feature or a phase in sowel-plugin-simulator. Use when:
  - User asks to "implement", "create a feature", "do phase N"
  - User says "implémenter", "créer une feature", "faire la phase N"
  Same workflow as the Sowel core (sowel-feature): spec with gates, branch, tests, agent review, PR, explicit merge approval.
disable-model-invocation: true
argument-hint: "[description de la feature ou numéro de phase]"
---

# sowel-plugin-simulator — feature workflow

Feature request: $ARGUMENTS

Follow EVERY phase IN ORDER. Each phase has a GATE. Do NOT skip gates. Do NOT combine phases.

Conventions live in `CLAUDE.md`. The project map lives in the showroom repo:
https://github.com/mchacher/sowel-showroom/blob/main/docs/project-map.md — read the decision table before designing anything; it is not reopened here.

---

## Phase 1: Understand & Clarify

1.1 Read `CLAUDE.md`, the project map, and `specs/` (there may already be a spec for this).
1.2 Ask clarifying questions until a complete spec can be written without assumptions: what, why, scope in/out, data, API surface used, edge cases.
1.3 Search the codebase for similar patterns before inventing.

> **GATE 1**: requirements clear, existing patterns checked.

## Phase 2: Document the spec

```bash
ls specs/ | tail -1          # next number
mkdir specs/NNN-<kebab-name>
```

Write three files, in English (CI fails a new spec folder missing one):

| File              | Content                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `spec.md`         | Context, goals, non-goals, functional requirements, acceptance criteria, edge cases |
| `architecture.md` | Data, flows, contracts with Sowel's API, file changes                               |
| `plan.md`         | Implementation steps and the **test plan** (module, scenario, expected)             |

Present a summary to the user and ask: "Voulez-vous que j'implémente ?"

> **GATE 2**: three files written, test plan included, user said "oui" / "go".

## Phase 3: Branch & implement

```bash
git checkout main && git pull
git checkout -b feat/<name>      # feat/ fix/ refactor/ docs/
```

Implementation order:

1. Types and world-model modules (pure functions first, testable without Sowel)
2. Devices declared through discovery, readings published through `updateDeviceData`
3. Orders: real ones (`power`, `position`, `setpoint`…) then `sim.*` orders
4. Tests
5. `manifest.json` (settings schema, version) and README

Tests are mandatory: every scenario of the plan's test plan gets a test, next to its module, Vitest.

> **GATE 3**: on a feature branch, order followed, every planned scenario has a test.

## Phase 4: Validate

```bash
npm run validate     # typecheck, typecheck:tests, lint, format:check, test, build
```

Zero errors. This is exactly what CI runs.

> **GATE 4**: validate is green.

## Phase 5: Agent review

Spawn a review agent on `git diff main...HEAD` with the spec as intent. Checklist: correctness and edge cases, conventions in `CLAUDE.md`, scope (nothing beyond the spec), tests match the plan, no secret or weakened gate. Fix blocking findings, re-run Phase 4, summarise the outcome.

> **GATE 5**: no unresolved blocking finding.

## Phase 6: Commit & PR

Conventional commits, scopes: world, occupants, environment, thermal, energy, devices, orders, manifest, ci. Tick acceptance criteria in `spec.md` and tasks in `plan.md`.

```bash
git push -u origin feat/<name>
gh pr create --title "feat(scope): ..." --body "Summary / Changes / Test plan"
```

> **GATE 6**: PR URL shared with the user.

## Phase 7: Wait for merge approval

**Never merge without an explicit "oui" / "merge" / "go".** Then:

```bash
gh pr merge <n> --squash --delete-branch && git checkout main && git pull
```
