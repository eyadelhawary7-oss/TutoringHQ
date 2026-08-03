# Wave 1 notes — design-parity-build-wave1 (workflow `wf_5d2c5083-a24`)

Claims taken 3 Aug for five of the six files in the wave. Adopting the existing
protocol in `README.md` rather than inventing a second one.

## Design-Patterns is deliberately NOT claimed, and will not be released

`README.md` says shared components under `src/components/patterns/` and
`src/components/ui/` are **never claimed, because they are never written**.
`Merged-Design-Patterns` is precisely a pattern-library file — its 34
confirmed-buildable differences are primitive adoption, and the natural way for
an agent to close them is to edit the primitives.

That is the one thing the protocol forbids outright, and for a good reason: every
other pipeline in flight depends on those primitives, so a change there is a
change to every screen at once, with no single claim that could cover it.

**Its build output will not be pushed.** It is reported to Eyad instead. The
legitimate form of that work is *screens adopting existing primitives* — which
belongs to each screen's own claim — not the primitives themselves changing.

## Two files held out of the wave entirely

`Center-Attendance` and `Teacher-Groups` both depend on the `sessions` migration,
which is unapproved (PR #307) and whose first draft was wrong in a way that would
have double-charged students. Neither is claimed and neither is being built.

## Scope guard applied to every wave-1 agent

No agent may add a column, table, constraint, enum value or RPC. `supabase/migrations/**`
is out of bounds; a schema need stops that item and is reported. Four routes are
already broken in production because someone read a column that does not exist
(F26) — the agents are told so explicitly, by name.
