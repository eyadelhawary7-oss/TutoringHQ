# Claude Code handoff

**Rewritten 6 August 2026.** The previous version described a model that no longer exists.

Read `design/NEW-MODEL.md` first. Then this.

---

## Before anything else

**The model changed on 6 August.** Verification, online collection, platform payouts, the 90/10
split and the percentage markup are all gone. Work merged against them is invalid.

Your first job is not building. It is telling Eyad **what already merged is now invalid and what
still stands**. Do that before writing another line.

---

## The one rule that matters most

**Verify against reality, never against a report.**

This has been violated repeatedly and cost real time each occasion:

- A file was reported "5/5 complete" when the design file had never been opened. Two of five sections were absent.
- Two greps returned "no matches" and were wrong both times; the same grep found matches on a rerun.
- The GitHub API showed a merged PR as unmerged; `git log` showed the truth.
- A migration was recorded as applied while its rows were gone.
- An agent died silently mid-run and the workflow gave no signal; only file timestamps revealed it.

So: read the live catalog, not migration files. Read `git log`, not the API field. Open the design
file, never infer from a prior survey. After every agent wave, confirm every agent that started
actually finished.

**Never cite a count you did not just run.** Every figure must come from a command run this session,
and per-part figures must sum to the total beside them. A right conclusion resting on invented
evidence is still a failure.

---

## Standing rules

**Never fabricate data to fill a design.** If a design shows a figure the platform cannot produce,
omit it and log why. A plausible fake number is worse than a visible gap, because nobody questions
it afterwards.

**Omission is for missing DATA, never missing effort.** Before omitting anything, check the catalog
to confirm the data genuinely does not exist. This is the failure that produced a 15% screen
reported as done.

**Visually identical means identical.** Not equivalent, not structurally complete. Sections the
design lacks get removed, not kept alongside. Sections the design has appear in the design's order.

**Report fractions, never "done."** "Done" is the word that concealed a 15% screen.

**Money and auth changes** get the largest available model and adversarial review.

**Migrations are proposed, never applied by an agent.** Eyad approves and applies; he has direct
Supabase access.

---

## The six protected files

Never auto-merge. Every PR comes to Eyad regardless of size.

`Merged-Public-App` · `Merged-Center-Money` · `Merged-Teacher-Money` · `Merged-Admin-Money` ·
`Merged-Lifecycle` · `Merged-Design-Patterns`

`Merged-Verification-Payouts` was the seventh. It is deleted.

---

## Agent concurrency, measured not assumed

| Layer | Limit |
|---|---|
| Total concurrent | 10 |
| Build agents | 1 per FILE, 18 max |
| Diff agents | fills remaining, read-only |
| Audit agents | fills remaining, read-only |

**One build agent per file, never per screen.** Center-Money holds 13 screens in one file. That is
one writer.

Claim-file mutex per file. Worktree isolation on every write agent, **verified active before
release, not assumed**. It was missing once and survived on luck.

The mutex is per-session and cannot see across sessions. **Only one session runs the pipeline.**

---

## The pipeline, per file

| Agent | Role |
|---|---|
| DIFF | Opens the merged HTML and the live page. Compares as rendered output. Separates visual gaps from feature gaps. Writes no code. |
| FEATURE | Builds the missing features the diff found. Real data, real logic. |
| BUILD | Applies the design once features exist. Sole writer for that file. |
| AUDIT ×2 | Independent, neither sees the other. Re-diffs fresh. Writes no code. |
| ADJUDICATOR | Reconciles the two audits, rules on disagreements, passes or fails. |

Only FEATURE and BUILD write, never simultaneously on the same file.

---

## Stop and ask when

- A backlog entry contradicts itself
- The design contradicts a decision already made
- The same fix is needed in more than three files, which means it belongs in foundations
- A screen needs a new column, table or write
- The file touches money, auth or account state
- A shared primitive cannot do what a screen needs
- You are about to omit a section and are not certain the data is missing

---

## Reporting

Per file: the visual difference count before and after, feature gaps found versus built, what was
omitted and the exact reason, and which agent produced each finding.

**Never report "done."**

Report only when a file completes, a PR opens or merges, or you hit a stop condition. If nothing has
moved, say nothing.

---

## What is authoritative

`design/NEW-MODEL.md` for what the product is.
`SPEC-instapay-fee-collection.md` for fee collection mechanics.
`MERGED-FILE-MAP.md` for what lives where.
`TOKEN-SPEC.md` for the design scale.
The 25 merged design files for what screens look like.

Everything else is commentary. Where they disagree, ask.

---

## Starting a session

Paste this at the top of a fresh session:

```
Read design/README.md, design/NEW-MODEL.md, design/NEW-FEATURES.md, and
CLAUDE-CODE-HANDOFF.md before anything else.

The model changed on 6 August. Verification, online collection, platform payouts,
the 90/10 split and the percentage markup are all gone. Work merged against them
is invalid.

Your first job is not building. Tell me what already merged is now invalid and
what still stands. BUILD-ROADMAP.md Stage 0 has the two buckets.

Do not start Stage 1 until I have that list.
```

For a session resuming mid-build:

```
Read BUILD-ROADMAP.md. Tell me which stage we are in, what is merged, what is
open, and what is blocked on me.

Report a fraction per file, never "done".
```

---

## The documents, and which is authoritative

| | |
|---|---|
| `design/NEW-MODEL.md` | What the product is. Wins over anything older. |
| `design/NEW-FEATURES.md` | What to build, with logic and build order. |
| `SPEC-instapay-fee-collection.md` | Fee collection mechanics. |
| `design/MERGED-FILE-MAP.md` | Which screens live in which file. |
| `design/TOKEN-SPEC.md` | The design scale. |
| `BUILD-ROADMAP.md` | Stages and what gates launch. |
| `STATE-OF-PLAY.md` | Live faults, dated items, what is not started. |
| `WORKING-RULES.md` | Database rules, money rules, failure patterns. |
| `LEGAL-STATUS.md` | What is stale and what is open. |
| The 25 merged files | What screens look like. |

Where any two disagree, ask. Do not pick.
