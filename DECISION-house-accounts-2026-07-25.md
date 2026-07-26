# Decision: marketing-sourced signups are house accounts

**Decided 25 July 2026.** Amends `05-COMMISSION_SYSTEM.md`, section 6 (Guards) and section 9
(Assignment and disputes). Everything else in that document stands.

---

## 1. What changes

The locked rule read:

> Inbound with no rep is a full close for whoever is assigned it.

It is replaced by:

> **A center that arrives through marketing is a house account.** It pays no commission and it
> does not count toward any rep's close count for the month.

A house account is still a customer like any other. It is only the commission treatment that changes.

---

## 2. What decides it

Ad source is evidence. **The claim is the verdict.**

| At the moment of first payment | Treatment |
|---|---|
| A live, unexpired claim on that center by a rep | That rep's close. Counts for pay and for the rate ladder. |
| No live claim | House account. Pays nothing, counts for nothing. |

This is deliberate. An owner can click an ad in June, forget it, meet a rep in August, then sign up
by typing the address directly. The ad source will say marketing and the rep will say it was his,
and both will be telling the truth. Only the claim can settle it, and the claim already exists in
the design.

It also means the rep controls his own outcome. If he is working a center, he claims it. If he did
not bother to claim it, he was not working it.

---

## 3. Why

Under the old rule, free closes did two kinds of damage.

The first is obvious: commission paid on revenue that cost no sales effort.

The second is larger and was not visible. **Free closes push the rep up the rate ladder, which
reprices the deals he did work.** A rep who works 6 centers while 6 more arrive on their own was
counted at 12, landing him in the 30% tier instead of 20%. The 6 he earned were paid at the higher
rate, funded by the 6 he did not.

One month, one city, at an average center of 6,073.68 revenue and a quota of 10:

| | Closes counted | Rate | That cohort, over its life |
|---|---|---|---|
| Old rule | 12 | 30% + 1% | 30,611 EGP |
| House accounts | 6 | 20% + 0% | 7,288 EGP |

A 23,323 EGP difference from a single month in a single city.

---

## 4. The consequence: quota now measures something different

Quota 10 was set while inbound counted. Removing inbound makes 10 a harder number without anyone
changing it.

Same rep, same 12 centers signing up in his city:

| Marketing brings | He worked | Tier he lands in |
|---|---|---|
| 0% | 12 | quota, 30% |
| 25% | 9 | below, 20% |
| 50% | 6 | below, 20% |
| 60% | 5 | punish, 10% |

**The cliff is at 25%.** Once marketing carries a quarter of signups, a rep closing 12 centers a
month can no longer reach a quota of 10 on his own work.

### 4a. Until quota exists, the rate is flat

**Decided 25 July 2026. There is no quota number and no ladder until reps have run a couple of real
months.** Until then every close pays the base: **30% close rate, 1% loyalty.**

The ladder is suspended, not deleted. It switches on when the quota is set from real closes.

This is the same reasoning already on file for the firing rule. You cannot grade a rep against an
unvalidated target during the exact window meant to validate it. 30% is the middle of the ladder, so
it neither punishes a slow start nor overpays a fast one.

**The part that is not temporary.** Rates stamp for life. Every customer closed during the interim
carries 30% and 1% forever, including after the ladder turns on. So the interim rate is a bet that
quota lands at or below what reps actually deliver.

Two reps, three months, six closes each per month, 36 customers stamped:

| If quota lands at | Ladder would have paid | Interim pays | Permanent difference |
|---|---|---|---|
| 4 or 6 | 30% | 91,834 | 0 |
| 8 or 10 | 20% | 91,834 | 48,104 |
| 12 or 15 | 10% | 91,834 | 69,969 |

The exposure is bounded because the first cohort is small, and it buys something real: reps who are
not being measured against a number nobody has validated. **Set the quota from the contact logs and
close counts once a couple of months exist, not from a calendar date.**

---

## 4b. The lead form creates a claim automatically

**Decided 25 July 2026.** Submitting the lead capture form at `/talk-to-us` automatically creates a
claim for the rep who owns that area.

This is consistent with the rule above rather than an exception to it. The test is not whether a
center arrived through marketing, it is **whether a person did sales work.** A lead form call is
sales work. A self serve signup is not.

It does mean the same marketing spend produces two outcomes depending on which button the visitor
presses. Start free with no claim is a house account. Have us call you is a rep close. That is
intended: the second one costs a rep an hour.

Three guards are required or this leaks worse than the rule it sits inside.

**The claim must lapse if the rep never makes contact.** A lead form claim needs its own short
contact deadline, separate from the 60 day rep initiated expiry. **Set at 5 days**, in config, as a starting number. It is provisional: once reps have run a cohort, the contact logs will show how long a lead actually takes to reach and the number moves to fit the data rather than the guess.
The rep logs contact to hold it. No contact by the deadline and the claim lapses to a house account.

Without this, a rep who works 4 centers while 8 more submit the form and are never called takes
**28,182 EGP** he did not earn in a single month in a single city, and those 8 uncalled leads push
him from the 10% band to the 30% band, repricing the 4 he did work.

**An existing live claim wins.** Never create a second claim on a center that already has one.

**An area with no rep produces a house account.** Do not fall back to the Team Leader. His bag is
capped at half quota and is his own leads only, never from the rep pool.

---

## 5. Blanket claiming: known risk, accepted for now

Reps can claim every center in their city to catch arrivals they did not work.

**Decided 25 July 2026: no cap on open claims per rep.** Revisit later if it becomes a problem.

What that leaves open, stated plainly so it is a known risk rather than a surprise. The 5 day
contact deadline covers **lead form claims only.** A rep initiated claim still sits live for 60 days
with no contact required, so a rep can claim his whole city and collect on anyone who self serves
inside that window.

| | Closes counted | Tier | That cohort |
|---|---|---|---|
| Blanket claims, 8 self serve arrivals land in them | 12 | quota, 30% + 1% | 30,611 EGP |
| Only work he actually did | 4 | punish, 10% + 0% | 2,429 EGP |

Exposure: **28,182 EGP in one month in one city.** The damage is not only the 8 free closes, it is
that they lift him from the 10% band to the 30% band, repricing the 4 he did work.

**When this is revisited, a cap is the weaker fix.** The better one is to require logged contact on
every claim, not just lead form claims, with a longer window for rep initiated claims since a rep
may legitimately claim a district before visiting it. A rep cannot log contact with 200 centers, so
the abuse dies without anyone having to pick an arbitrary cap number.

Two things make this acceptable to defer: Eyad reviews every commission before money moves, and
claims are visible to everyone, so a rep hoarding a city is at least detectable by the team leader.
Detection is not prevention, and manual review does not scale past the first cohort.

---

## 6. What the live database still needs for any of this to work

Carried from `05-COMMISSION_SYSTEM.md` section 11, unchanged and still true:

- `center_assignments` has **no unique constraint on the center identifier**, so two reps can both
  mark themselves primary on one center. That is two T1 payouts on one customer, caught only by eye.
  This is the most dangerous gap and it should be fixed first.
- There is **no claim expiry field anywhere**. The whole rule above depends on a claim having an
  expiry, so this is now load bearing rather than nice to have.
- `sourced_by` allows only `eyad`, `sm`, `sr`. There is no value for a house account, and no `tl`.
  It needs both.

---

## 7. Summary

1. Marketing sourced signups are house accounts. No commission, no ladder credit.
2. The claim decides attribution, not the ad source.
3. The lead form auto creates a claim for the territory rep.
4. That claim lapses after **5 days** without logged contact. Provisional, to be set by data.
5. An existing live claim always wins. An area with no rep produces a house account.
6. **No cap on open claims.** Known risk, sized at 28,182 EGP per city per month, accepted for now.
7. **No quota and no ladder yet.** Every close pays a flat 30% + 1% until reps have run a couple of real months. Those closes stamp at that rate for life.
8. When quota is set, it is set from real close counts and against outbound only. Not from a calendar date.

Nothing is left open in this decision. The next review point is a couple of months of real closes, not a date.
