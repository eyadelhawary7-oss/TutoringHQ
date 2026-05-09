# WhatsApp (Meta) templates — registry

Project rule: delivery uses Meta-approved templates only. This table is the working checklist; wire locations live next to WhatsApp send helpers and admin tooling.

| Template name | Status | Body preview | Variables | Wired in code | Trigger | How to test |
|---------------|--------|--------------|-----------|---------------|---------|-------------|
| *(stub rows)* | ACTIVE / PENDING | … | … | see `src` WhatsApp send layer | … | Sandbox number + Meta tester |

## Explicit exceptions (audit lock-in)

- **`chq_parent_welcome`** — Registered & **APPROVED**, intentionally **not** auto-sent on student approval; enable manual send when ops ready.
- **`chq_pin_delivery`** — **Stub / blocked** until Vodafone postpaid SIM + SMS fallback; do not live-test PIN blast before SIM.

Fill remaining rows from Meta Business Manager **Messaging → Templates** (≈30 active templates per Prompt 6 audit); keep status column in sync with Meta review state.
