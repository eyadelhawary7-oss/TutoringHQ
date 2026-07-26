# TutoringHQ - Design change record

**Session of 24 to 25 July 2026. Claude Design only. Nothing here was built in code.**

This is the complete list of what changed in the design system, what was added, what was removed,
and what was decided. The companion document `CLAUDE-CODE-HANDOFF.md` turns this into work items.

Authoritative file inventory: `MERGED-FILE-MAP.md`.

---

## 1. Features added

### 1.1 Show the PIN (new)

Both PIN entry surfaces now carry an eye toggle that reveals the digits.

| Surface | Where | Fields |
|---|---|---|
| Account PIN | `Screen-Public-Auth` | set PIN, confirm PIN, login, wrong PIN |
| App lock PIN | `Screen-Lifecycle-Access` | set PIN |

The icon is borderless and muted, sits clear of the field, and turns teal while the PIN is showing.
Masked state shows dots; revealed state shows the digits. Both states are drawn in both languages.

**Why it exists:** a six digit PIN typed one handed with no visible feedback produces typos that
look like failed logins, and a locked account is a support call.

### 1.2 Self enrollment by one time code (new screen)

`Screen-Public-Enroll` at `/join/g/[groupId]`. Eight frames.

A student opens a group link, gives name plus their own mobile plus the parent mobile, receives a
six digit code on WhatsApp, and is in the group immediately. No center approval step.

This is the **second** join path and does not replace the first. `/j/[code]` still exists and still
waits for the center to approve.

Rules the design fixes in place:

- The parent number is required, not optional. The parent receives every receipt and alert, and a student cannot opt his own parent out of that.
- The code lasts ten minutes and only the newest code works.
- The screen states plainly that this is the only code ever sent for joining, and that attendance and fees never ask for a code. This is anti-phishing copy and should not be trimmed.
- Nothing is billed before the first session.

Needs the WhatsApp template `chq_enrollment_otp`, which is already on the template list and not yet created.

### 1.3 Lead capture (new screen)

`Screen-Public-Lead` at `/talk-to-us`. Four frames.

Five fields: name, mobile, center name, **area**, rough student count. Then a call back within one
working day.

**Area is the load bearing field.** It is what routes the lead to the rep who owns that territory
and what a claim attaches to. Everything else is conversation.

The submitted state keeps "Start free trial now" in front of the person, because waiting for a call
is the most expensive thing that can happen to a warm lead.

This sits beside Start free as a second door. WhatsApp remains as a third door for owners who will
not fill in anything at all.

### 1.4 Referral landing (new screen)

`Screen-Public-Referral` at `/refer/[code]`. Four frames. Names the inviter, states the reward,
drops into the free trial rather than a signup wall.

Distinct from the staff invite in `Merged-Lifecycle`, which is a different thing entirely.

### 1.5 Offline fallback (new screen)

`Screen-Public-Offline`. Four frames. States that the page needs a connection, and that attendance
already taken is saved on the device and syncs when the signal returns.

### 1.6 Legal surface (new screen)

`Screen-Public-Legal`. Fourteen frames. An index, a reader for each of the four documents
(Privacy Policy, Terms and Conditions, Cookie Policy, Data Processing Agreement), the PDPL data
rights form, and its submitted state.

The form sends students and parents to their center first, because the center is the controller and
the platform is only the processor. **It never asks for a PIN and says so on screen.** Thirty day
window, no charge, both stated up front.

This closed three footer links that previously went nowhere.

---

## 2. Rules changed

### 2.1 PIN length is 6, everywhere

`Screen-Lifecycle-Access` said "choose a 4-digit PIN" and drew four dots. Everything else, including
the privacy policy, said six.

**Now 6 across the board.** Text, dot count, and both languages. Swept afterwards: no file claims a
four digit PIN.

### 2.2 Marketing sourced signups are house accounts

Recorded in full in `DECISION-house-accounts-2026-07-25.md`. Amends the commission system.

- A center that arrives through marketing pays no commission and does not count toward any rep's close count.
- **The claim decides attribution, not the ad source.** Live claim at first payment means it is that rep's close. No claim means house account.
- No quota and no ladder yet. Every close pays a flat 30% + 1% until reps have run a couple of real months. Quota is then set from real close counts, against outbound only.

Cost of the old rule, one month one city: 23,323 EGP.

Still open: a cap on open claims per rep, to stop blanket claiming.

---

## 3. Removed on purpose

Five planned pages were dropped because **nothing on the public surface links to them.** Building
them would have created dead ends rather than closing them.

- `/blog` (coming soon stub)
- `/features/qr-attendance`
- `/features/student-management`
- `/features/whatsapp-notifications`
- `/compare/spreadsheets`

Also removed:

- **The persona splash at `/`.** Killed in an earlier session; the tracker still listed it.
- **`/demo-request` as a screen.** It is not a demo booking. It became the WhatsApp link plus, now, the lead capture form.

---

## 4. Structure changed

### 4.1 A merge bug was found and fixed

The original merge **silently dropped CSS rules.** `Merged-Public` lost the entire `body` rule for
the Landing and Pricing screens, so they lost their padding, font, text colour and background inside
the merged file.

Rebuilt with a corrected engine that preserves every rule. Proof: each screen now renders **pixel
for pixel identical** to its standalone original. Rule counts match exactly on every screen.

Audited the other 24 files. **Only Public was affected.** The rest were clean.

### 4.2 Every file is now dark mode safe

The files never declared themselves light only. On a phone in dark mode the viewer darkened the
canvas while the text stayed dark, so the text disappeared.

Two lines added to all 26 files: a `color-scheme: light` meta tag, and a real light background on
the root element. Verified by rendering every file in a dark mode engine.

### 4.3 Public split into three files

Public was one 83,000 token file, too large for an implementer to open and still have room to work.
Now Marketing, App, and Legal, each around 45,000 tokens.

### 4.4 Marketing pages moved into phone frames

Landing, Audience and Pricing were plain columns. They now sit in 412px phone bezels with a 748px
screen and the page scrolling inside, matching every other screen in the set.

Known trade off, accepted: at rest you see the top of each page rather than the whole argument.
Pricing is 5.3 screenfuls tall, so checking the full price ladder in one pass now requires scrolling.

### 4.5 Reader header on every file

Every merged file opens with a comment block naming itself, listing its screens with their source
filenames, and giving seven rules for implementation. The critical one is that `.mgdN` is scoping
bookkeeping and must be stripped.

### 4.6 The portals were deliberately not combined

Combining the nine Center files into one produces a **257,000 token** file, past the point where an
implementer can read it at all. Tested and rejected.

---

## 5. Where things stand

| | |
|---|---|
| Merged files | 26 |
| Screens | 103 |
| Screens with no design | 0 |
| Public routes that go nowhere | 0 |
| Largest file | ~56,000 tokens |

**The design is complete.** Every route has a screen, every link has a destination, and every file
opens on a phone.

---

## 6. Documents that are now wrong

`TutoringHQ-Screen-Tracker.md` is stale in roughly 26 places. It lists as unbuilt: login, signup,
forgot password, pricing, the teacher pages, legal, the PDPL form, referral, offline, join by link,
and pay while locked. **All of these are built.** It also still lists the killed persona splash and
the five dropped pages.

It should be rewritten or retired. Until then it will actively mislead anyone implementing from it.
