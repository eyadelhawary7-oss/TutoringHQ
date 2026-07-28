# Needs design — the 22 live routes with no design

**Written 26 July 2026. Decision logged: keep every one, delete none, flag each for design.**

This is the design queue. From `INVENTORY.md` list 3a, with what each route does, who sees it, and
what it touches.

**Scrutiny tags:** `money` shows or moves amounts · `auth` credentials, PIN or permissions ·
`state` subscription, trial, verification or suspension changes what renders · `layout` none of those.

**Six carry money.** Those need the same care as the six protected merged files when they are drawn.

---

## Owner and teacher facing — 8

| # | Route | What it does | Who sees it | Touches |
|---|---|---|---|---|
| 1 | `/{locale}/pay` | The center's own invoice list — pay via Paymob, download PDF. Shared `CustomerInvoicesView` template with `/teacher/pay` | Center owner | **`money`** |
| 2 | `/{locale}/teacher/pay` | The teacher's own invoice list, same template. **Deliberately reachable while locked** — uses `requireTeacherAuth`, not the private-access gate, so a lapsed teacher can pay to restore her engine | Teacher, including lapsed | **`money` `state`** |
| 3 | `/{locale}/teacher/subscription/upgrade` | Standard → Pro upgrade. Renders `PlanComparison` with the upgrade CTA, or a "payments unavailable" banner when Paymob is off | Teacher on Standard | **`money` `state`** |
| 4 | `/{locale}/settings/money` | Center money settings — InstaPay number and the card-order opt-in. **The only place the InstaPay destination is set** | Center owner | **`money`** |
| 5 | `/{locale}/settings/referrals` | Second center referral surface. Shares `ReferralWithdrawalPanel` with `/referrals`; uniquely offers a **per-commission download** | Center owner | **`money`** |
| 6 | `/{locale}/students/print` | Printable roster. Print CSS is a documented RTL exemption | Center staff | `layout` |
| 7 | `/{locale}/privacy` | Placeholder privacy page — three interim paragraphs from `legal.privacy.placeholderBody`. Duplicate of `/legal/privacy` | Public | `layout` |
| 8 | `/{locale}/terms` | Placeholder terms page **plus the processing-fee disclosure** `/legal/terms` does not carry. Renders the live configured amount | Public | **`money`** |

**#2 and #8 carry something that must survive any consolidation** — see `DUPLICATE-ROUTES.md`.

## Parent facing — 1

| # | Route | What it does | Who sees it | Touches |
|---|---|---|---|---|
| 9 | `/parent/[token]` | Public parent portal by token — student balance, scan history, next sessions, WhatsApp the center. **Read-only, no pay action.** Outside `[locale]` | Parent, by link, no account | **`money`** (displays balance) |

**The only parent-facing authenticated surface in the product**, and the only one of the 22 seen by
someone who is not a customer. `Merged-Public-App` §04 Parent Payment is a **different** screen — a
public pay-by-link page that does not exist yet.

## Admin — 7

| # | Route | What it does | Who sees it | Touches |
|---|---|---|---|---|
| 10 | `/{locale}/admin/orders` | Admin card-order queue | Internal | **`money`** |
| 11 | `/{locale}/admin/card-orders/[orderId]` | Admin card-order detail. Gated against `internal_viewer` | Internal, not viewers | **`money` `auth`** |
| 12 | `/{locale}/admin/payouts` | **Internal staff salary payouts** — `staff_id`, `base_salary`, `period`. Not provider settlement | Internal, senior | **`money`** |
| 13 | `/{locale}/admin/commissions` | Sales-rep commission ledger. T2 eligibility window 180 days | Internal, senior | **`money`** |
| 14 | `/{locale}/admin/renewals` | Center subscription renewals, overdue filter, **manual record-payment** | Internal | **`money`** |
| 15 | `/{locale}/admin/plan-requests` | Queue of center plan-change requests | Internal | **`money` `state`** |
| 16 | `/{locale}/admin/demo-requests` | Inbound demo-request queue — pending / contacted / approved / rejected | Internal, sales | `layout` |

**#12 is easy to confuse with `Merged-Admin-Money` §02 Admin Settlement.** That design is the
biweekly *provider* payout run. This route is *our own staff's salaries*. Different money, different
audience.

**#16 is the receiving end of the lead-capture form** (`Merged-Public-Marketing` §04, feature A1).
Designing one without the other leaves the funnel half-drawn.

## Marketing — 6

| # | Route | What it does | Who sees it | Touches |
|---|---|---|---|---|
| 17 | `/{locale}/demo-request` | 55-line stub: logo, one line of copy, a **hardcoded** `wa.me/201001234567` link | Public | `layout` |
| 18 | `/{locale}/blog` | Marketing stub | Public | `layout` |
| 19 | `/{locale}/compare/spreadsheets` | Comparison page, TutoringHQ vs spreadsheets | Public | `layout` |
| 20 | `/{locale}/features/qr-attendance` | Feature page | Public | `layout` |
| 21 | `/{locale}/features/student-management` | Feature page | Public | `layout` |
| 22 | `/{locale}/features/whatsapp-notifications` | Feature page | Public | `layout` |

**#17 collides with the planned `/talk-to-us`** (feature A1). Two lead doors, one funnel — worth
deciding which is the door before designing either.

**#18–#22 were recorded as "Dropped" in `TutoringHQ-Screen-Tracker.md`.** The decision was written
down; the pages are still live and still served. Under the keep-everything decision they now need
designs instead. **The hardcoded phone number in #17 is worth checking whoever designs it.**

---

# Summary

| | Count |
|---|---|
| Total | **22** |
| Touch `money` | **11** |
| Touch `auth` or `state` | 4 |
| `layout` only | 9 |
| Seen by someone who is not a customer | 1 (`/parent/[token]`) |
| Internal only | 7 |

**Suggested design order, by exposure and risk**

1. **`/parent/[token]`** — the only parent-facing surface, and parents are the least forgiving audience.
2. **`/pay` and `/teacher/pay`** — money, and #2 is a recovery path a lapsed teacher depends on.
3. **`/settings/money`** — the only place InstaPay is configured.
4. **`/admin/renewals`, `/admin/commissions`, `/admin/payouts`** — money with manual writes; internal, so lower blast radius.
5. **The rest of admin.**
6. **Marketing.** Six pages nobody currently links to; cheapest to draw and lowest cost if they wait.

Not a decision, just the order I would take them in.
