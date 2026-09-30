---
name: update-docs
description: Bring Formwork's living documents (the Functional Specification and the PRD artifacts) up to date with what has changed in the app. FS = Functional Specification. Use whenever the user asks, in any wording, to update these documents, above all "update PRD and FS" (or "update FS and PRD", "update the PRD", "update the FS"), and also "update docs with changes", "update the docs", "update docs with today's changes", "update the artifacts", "update the spec", "update the PRD", "update both documents", "bring the docs up to date" or "/update-docs". Also use after a change that alters a rule the documents describe.
---

# Update Formwork's living documents

The user's phrase for this is **"update PRD and FS"**. When they say it, run every step below for both documents, without asking first.

Formwork has two living documents on claude.ai (Claude Docs). They are the master copies; `docs/FUNCTIONAL_SPEC.md` and `docs/PRD.md` are snapshots exported from them. Never edit the snapshots by hand.

| Document | Link | Doc (project) id | Tab (file) id | Body (node) id | Status enum |
| --- | --- | --- | --- | --- | --- |
| Formwork — Functional Specification | https://claude.ai/code/artifact/659cca3b-399b-425f-bb5f-8b23577d5714 | `659cca3b-399b-425f-bb5f-8b23577d5714` | `658d7c0d-127b` | `d2ee4686-a673` | `053b58f0-8d13` (Known issues: Open / Decided: keep / Fixing / Fixed) |
| Formwork — Product Requirements (PRD) | https://claude.ai/code/artifact/d7ffd5d9-797b-4db0-b4b9-01f122498f7b | `d7ffd5d9-797b-4db0-b4b9-01f122498f7b` | `4c90d7b8-bffd` | `2ab1a08e-25b5` | `d3ae0355-5055` (Not started / In progress / Done / Won't do) |

The Claude Docs connector must be on in the session (tools `mcp__Claude_Docs__*`, found with ToolSearch). Load the `anthropic-skills:docs` skill before any docs call. If the connector isn't available, say so; don't fall back to editing the snapshots.

## Steps

1. **Find what changed.** The spec's section 1 says "database migrations up to N". Run `git fetch origin main`, then list `migrations/` on `origin/main` above N and `git log` since the last snapshot commit (`git log -1 -- docs/FUNCTIONAL_SPEC.md`). Read each new migration's header comment and the pages it touched. Read the "why" in the headers, and the matching CLAUDE.md conventions; don't guess from names.
2. **Read the docs first.** Read each doc's outline (`read` on the body node, `{"projection":"outline"}`). People edit these docs directly (the principal changes requirement statuses, for example). Their words win: never overwrite text or a status someone else set, and quote text as it stands now.
3. **Update the Functional Specification:**
   - Add or change requirements in the module they belong to (FR-n.m numbering; append new ids, never renumber existing ones). Tag each [DB] (database-enforced) or [Page] (page only).
   - Section 19, Audit trail: add any new logged area, log table or screen.
   - Known issues: add new ones as table rows with a Status dropdown (enum above), and change the count in the section's lead sentence. Mark an issue Fixed only when a migration or commit really fixes it.
   - Section 1: update "as built on <date> (database migrations up to N)".
   - If sections are added, renumber the headings after them and the cross-references ("section 21, Known issues", "See section 20.").
4. **Update the PRD:**
   - "What is live today": area descriptions and open-issue counts.
   - Requirements: when a change delivers one, say so to the user and ask before setting its Status to Done (the principal owns statuses). New gaps become new requirement rows.
   - Keep the Summary and "Where the data came from" consistent with the spec. That section is the principal's own wording: all data came from SIMS, as a subset. It left behind SIMS's history of changes and class and subject-choice changes. Medical details were never in SIMS, tuckshop records were on a separate system, and fees were worked out on the bursar's spreadsheet.
5. **Refresh the snapshots.** Export each doc's tab as markdown (`mcp__Claude_Docs__export`, `format: "markdown"`). A large result is saved to a file; decode `data.bytes_b64` from it with Python. Write the result to `docs/FUNCTIONAL_SPEC.md` / `docs/PRD.md`, keeping the snapshot comment at the top of each file.
6. **Also check `docs/SYSTEM_RULES.md`**, the earlier plain-English rules summary. If a change alters a rule it states, update it too.
7. **Commit and open a PR** (CLAUDE.md: PR after committing, never merge without the user's go-ahead). In the reply, give both doc links and a short list of what changed in each.

## Writing style for these docs

Plain English for school leaders. Lead with the point, short sentences, numbers and names over adjectives. Use UK spelling and Lagos time. Name roles as the app does (smt, school_office…) in tables, and in words in prose.
