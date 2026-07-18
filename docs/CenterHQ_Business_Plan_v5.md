# CenterHQ Business Plan
## Version 5.0

> POINT-IN-TIME STRATEGY DOC (dated 2026-02-17). Re-synced against live pricing on 2026-07-18. The Section 4 pricing table and every revenue projection built on it are SUPERSEDED — they do not match the live pricing catalog. See the "SUPERSEDED" note in Section 4 for current live figures, and `docs/PRICING_SPEC.md` for the source of truth. Product brand is TutoringHQ; the internal repo/Vercel names stay CenterHQ by design. Projections below are preserved as historical modeling, not current targets.

**Document Date:** February 17, 2026  
**Change Log:** v5.0: Updated pricing structure to 5-tier model with BUSINESS tier, adjusted PAYG to 30-50% premium, updated team limits and student capacities

---

## 1. Executive Summary
CenterHQ is a comprehensive management platform for private educational centers in Egypt, offering attendance tracking, scheduling, billing, and analytics.

---

## 2. Market Opportunity
[Content from previous versions]

---

## 3. Product Overview
[Content from previous versions]

---

## 4. Pricing Model

> SUPERSEDED (verified live 2026-07-18). The tiers and prices in this section are the Feb-2026 plan and no longer match the live `pricing_plans` catalog. Live monthly all-in prices (VAT-inclusive EGP): Solo 999 · Nano 1999 · Starter 4499 · Pro 7999 · Business 12999 · Enterprise 18499 · Top Centers custom (`centers.all_in_price`, code throws + Sentry on NULL). Annual = monthly × 10 ("2 months free"). Live pricing is VAT-inclusive (14%, `base = inclusive / 1.14`) with a flat 20 EGP processing fee per charge invoice; there are no per-tier setup fees of the kind tabled below. PAYG exists but its live rates are not those shown here. Treat everything below in Section 4 as historical.

### Fixed Monthly Plans

| Plan | Monthly Price | Student Limit | Team Members | Setup Fee |
|------|----------------|---------------|--------------|-----------|
| **STARTER** | EGP 2,000/month | ≤150 students | 2 team members | EGP 1,000 |
| **PRO** | EGP 4,500/month | ≤500 students | 5 team members | EGP 2,000 |
| **BUSINESS** | EGP 6,500/month | ≤1,000 students | 10 team members | EGP 3,000 |
| **ENTERPRISE** | EGP 9,000/month | ≤2,000 students | 20 team members | EGP 5,000 |
| **TOP CENTERS** | Custom | Unlimited students | Unlimited team members | Custom setup |

### Pay-As-You-Go (PAYG) Pricing

PAYG pricing is 30-50% premium over fixed plans, ideal for centers with variable attendance.

| Students/Week | Rate per Student | Premium vs Fixed |
|---------------|------------------|------------------|
| 0–150 | EGP 4/student/week | 20% premium |
| 151–500 | EGP 3/student/week | 33% premium |
| 501–1,000 | EGP 2.50/student/week | 54% premium |
| 1,001–2,000 | EGP 2/student/week | 78% premium |
| 2,001+ | EGP 1.75/student/week | Custom pricing |

---

## 5. WhatsApp Products

WhatsApp products remain as Phase 2 premium add-ons. No changes to this section.

---

## 6. Go-to-Market Strategy
[Content from previous versions]

---

## 7. Revenue Projections

### Year 1 (50 centers)

**Monthly Recurring Revenue (MRR):**
- 20 × STARTER (EGP 2,000) = EGP 40,000
- 15 × PRO (EGP 4,500) = EGP 67,500
- 8 × BUSINESS (EGP 6,500) = EGP 52,000
- 5 × ENTERPRISE (EGP 9,000) = EGP 45,000
- 2 × TOP CENTERS (avg EGP 15,000) = EGP 30,000

**Total MRR:** EGP 234,500  
**Annual Recurring Revenue (ARR):** EGP 2,814,000

**Setup Fees Year 1:**
- 20 × EGP 1,000 = EGP 20,000
- 15 × EGP 2,000 = EGP 30,000
- 8 × EGP 3,000 = EGP 24,000
- 5 × EGP 5,000 = EGP 25,000
- 2 × Custom (avg EGP 15,000) = EGP 30,000

**Total Setup Fees:** EGP 129,000

---

### Year 2 (120 centers)

**Assumed mix:**
- 45 × STARTER = EGP 90,000
- 35 × PRO = EGP 157,500
- 22 × BUSINESS = EGP 143,000
- 12 × ENTERPRISE = EGP 108,000
- 6 × TOP CENTERS (avg EGP 15,000) = EGP 90,000

**Total MRR:** EGP 588,500  
**ARR:** EGP 7,062,000

**New Setup Fees (70 new centers):**
- 25 × EGP 1,000 = EGP 25,000
- 20 × EGP 2,000 = EGP 40,000
- 14 × EGP 3,000 = EGP 42,000
- 7 × EGP 5,000 = EGP 35,000
- 4 × Custom (avg EGP 15,000) = EGP 60,000

**Total New Setup Fees:** EGP 202,000

---

### Year 3 (200 centers)

**Assumed mix:**
- 75 × STARTER = EGP 150,000
- 60 × PRO = EGP 270,000
- 38 × BUSINESS = EGP 247,000
- 20 × ENTERPRISE = EGP 180,000
- 7 × TOP CENTERS (avg EGP 15,000) = EGP 105,000

**Total MRR:** EGP 952,000  
**ARR:** EGP 11,424,000

**New Setup Fees (80 new centers):**
- 30 × EGP 1,000 = EGP 30,000
- 25 × EGP 2,000 = EGP 50,000
- 15 × EGP 3,000 = EGP 45,000
- 8 × EGP 5,000 = EGP 40,000
- 2 × Custom (avg EGP 15,000) = EGP 30,000

**Total New Setup Fees:** EGP 195,000

---

## 8. Competitive Comparison

CenterHQ now offers more granular pricing for centers of all sizes, from small operations (STARTER, ≤150 students) to large enterprises (TOP CENTERS, custom). The 5-tier fixed model plus PAYG gives flexibility that competitors lack. The BUSINESS tier (EGP 6,500, ≤1,000 students) fills the gap between PRO and ENTERPRISE, enabling mid-size centers to scale affordably.

---

## 9. Appendix
[Supporting materials]
