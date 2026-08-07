# SPEC: InstaPay Fee Collection

**Date:** 5 August 2026
**Status:** Approved for build. Held branch. Nothing merges without Eyad's review.
**Model requirement:** This touches money. Largest available model, adversarial review before PR.

---

## 1. What this is, and what it is not

This lets a parent pay tuition by InstaPay straight to the center's own account, upload the receipt, and have the payment recorded automatically against the right student.

**The platform never touches the money.** Tuition goes from the parent's account to the center's account directly. TutoringHQ records, matches, and proves. It does not collect, hold, or transfer tuition at any point.

This is the reason the feature exists in this shape. Because money never enters a platform account, there is no VAT on tuition, no withholding obligation, no expense deductibility problem, and no payment licensing question. It also works for unregistered individual centers today, which nothing else does.

**Never describe this as verifying payments.** The system reads an image and compares it to an invoice. It does not confirm that money moved. Only the center can do that, by looking at their own account. Every piece of copy, in the app and in the terms, must say the center confirms receipt.

---

## 2. Settings

Per center, in settings, a payment methods toggle:

- Cash (default on)
- InstaPay (default off until the center enters their InstaPay details)

A center must enter their InstaPay account details before the InstaPay method can be switched on. Store the IPA and the registered phone number. Both are needed for the recipient check.

**Changing the InstaPay account** is a protected settings action. When it changes, auto-matching pauses and every incoming receipt is flagged for manual review until the center confirms the new account is correct. Same principle as the payout destination rule.

---

## 3. The attendance flow

At attendance, after marking a student present, the staff member sees two buttons: **Cash** and **InstaPay**. Only methods enabled in settings appear. If only one is enabled, no choice is shown.

**Cash** behaves exactly as it does today. Amount entered, payment recorded immediately, receipt issued. No fee is charged on cash payments.

**InstaPay** creates an invoice and sends the WhatsApp message described below. The payment does not exist yet. It is created when a receipt arrives.

The center can also trigger the InstaPay flow before the lesson rather than after, if they prefer. Same behaviour, different timing.

---

## 4. The invoice

An InstaPay invoice contains:

| Line | Example |
|---|---|
| Session or monthly fee | 400.00 |
| رسوم خدمة | 10.00 |
| **Total** | **410.00** |

The service fee line is always shown. It is 10 EGP flat per invoice, no cap, no tier.

The 10 EGP is TutoringHQ's revenue, collected by the center on TutoringHQ's behalf and billed back to the center monthly. See section 10.

---

## 5. The WhatsApp message

One utility template message to the parent's registered number when the invoice is created. It contains:

- Student name and what the payment is for
- The total amount to pay
- The center's InstaPay details
- A link to the upload page

The link is a short-lived, revokable token tied to that one invoice. Same mechanism as the parent portal tokens. Expiry follows whatever the child safety work settles on.

**The link carries the identity.** Because it belongs to one invoice for one student, anything uploaded through it is already tied to the right person. Do not attempt to identify the student from the receipt contents.

---

## 6. The upload page

A single page. Shows the amount due and an upload box. The parent uploads a screenshot of their InstaPay receipt.

On upload, the image goes to the reader (section 7) and the parent gets an answer within seconds, in Egyptian Arabic:

| Result | Response |
|---|---|
| Not an InstaPay receipt | Reject. Ask for the correct screenshot. |
| Status is not Successful | Reject. Explain the transfer did not go through. |
| Recipient is not this center | Reject. Tell them the money went to the wrong account. |
| Reference already recorded | Do not reject to the parent. Send to the center as a conflict (section 9). |
| Amount less than due | Accept as partial. Show the remaining balance. Invite another upload for the rest. |
| Amount more than due | Accept and flag. May cover a sibling or a future month. |
| Amount matches, all checks pass | Accept. Tell them the center will confirm. |
| Image unreadable or low confidence | Do not reject. Send to the center to look at. |

**Never tell a parent they did not pay.** A failed read is a system problem, not an accusation. When in doubt, route to the center.

**Cap uploads at four attempts per invoice.** After that, the invoice goes to the center for manual handling. This stops one confused parent burning fifty reads.

The parent sees confirmation in the parent portal, not by WhatsApp. No confirmation message is sent.

---

## 7. The reader

**Model: Gemini Flash-Lite.** Paid tier only. Do not use the free tier under any circumstances, because its data usage terms would mean parents' names and banking details are used by the provider. This is personal financial data and PDPL applies.

Send the full screenshot. Cropping saves about 3% of total cost and is not worth the engineering.

**The reader extracts these fields and returns them as structured data. Nothing else.**

- Transfer amount
- Currency
- Reference number
- Date and time
- Sender name
- Sender IPA
- Recipient identifier (may be an IPA or a phone number, handle both)
- Note field
- Direction (Send Money or Received Money)
- Status

**The reader does not compare anything.** All comparison against invoices, existing references, and center details happens in the database. Never send database contents to the model. Comparison is a query: instant, free, and always correct.

**Build it so the model can be swapped.** One function, image in, structured data out. Switching provider should be a one line change. This field moves fast and there is no reason to be locked in.

**Before shipping:** collect at least 50 real InstaPay screenshots, including deliberately bad ones, blurry, cropped, dark mode, photographed off another screen, and both sender and receiver layouts. Measure how many return every field correctly. Test Flash-Lite against at least one alternative. Pick on measured accuracy, not on price.

**Low confidence on any field means route to the center.** Do not guess at a number that will become a financial record.

---

## 8. Two upload paths, one record

There are two ways evidence arrives. **Whichever arrives first creates the payment record. The second matches into it.**

**Path A, the parent's receipt**, through the invoice link. Carries reference number, note, and full detail. Identity is certain because the link belongs to one invoice.

**Path B, the center's batch list.** The center filters their InstaPay transactions to a date range, screenshots the list, and uploads it in the app. One screenshot covers many payments. The list shows amount, sender name, sender IPA, and timestamp for each row. **It does not show reference numbers or notes.**

For batch rows, uniqueness is sender IPA plus timestamp plus amount. If the same combination already exists, do not create a second record.

When both sides exist for the same payment, the record is **two-sided** and is the strongest form of evidence. When only one side exists, the record is **single-sided** and is still fully confirmable by the center.

**Do not require both sides.** Most payments will only ever have one. Not every parent will upload, and not every center will do the batch list.

---

## 9. Confirmation, states, and flags

**Nothing becomes a real payment without the center pressing confirm.** No auto-approval. No timeout that approves on its own. Silently recording money that did not arrive is the worst failure this system can produce.

States:

| State | Meaning | Who acts |
|---|---|---|
| Awaiting parent | Invoice sent, no receipt yet | Chase the parent, send a reminder |
| Awaiting center | Receipt received, not yet confirmed | Center reviews and confirms |
| Confirmed | Center has confirmed receipt | Done. Fee accrues. |
| Flagged | Something needs a human decision | Center resolves |

**Center side pending means the parent is late.** Surface it as a reminder prompt.
**Parent side pending means the center has not confirmed.** Surface it in the center's dashboard and in the parent portal, so it does not sit invisible.

Every payment awaiting confirmation gets a **View then Confirm** action. View shows the uploaded receipt image, the extracted fields, and the invoice it is matched to. Confirm posts the payment. The center never has to do a batch list to confirm a parent upload.

**What gets flagged rather than auto-matched:**

- Amount does not match any open invoice
- Amount could cover more than one invoice, or more than one child
- Reference already recorded against a different invoice
- Recipient does not match the center's registered account
- Sender name is unfamiliar and amount is ambiguous
- Image confidence low on any field
- Timestamp older than a set window
- Center's InstaPay account was recently changed

**On a duplicate reference:** do not reject the second parent. Both claims go to the center with both images side by side. A parent may have shared a screenshot with another parent, and the honest one must not lose.

**On a reference conflict or a disputed payment**, the center can attach the detailed single-transaction receipt, which carries the reference number and note. That becomes permanent evidence on the record. Once a reference is stored it is never reusable.

**Split payments:** one transfer covering two children or several months is flagged, and the center allocates it across invoices manually. One fee is charged, not one per invoice.

---

## 10. The fee and billing

**10 EGP per confirmed payment.** Flat. No cap, no tiers.

**Charged only on confirmed payments.** Never on failed uploads, rejected receipts, or retries. A parent uploading four times generates one fee.

**Cash payments are free.** The fee is for the InstaPay flow only.

**Accrues to a running total** visible to the center at any time, not a surprise at month end. Show it plainly: عدد العمليات × ١٠ جنيه = المستحق.

**Billed monthly** on the center's subscription invoice as a separate line.

**Refunds and corrections:** the fee stands once a payment is confirmed. A correction becomes a credit on the center's account. Consistent with the existing no refunds policy.

Consider a free allowance on larger plans as an upgrade lever. Not required for the first build.

**Cost basis, for reference:** about 0.31 EGP per payment blended, of which roughly 0.20 is the WhatsApp message and 0.02 the image read. Worst realistic case with reminders and repeated uploads is about 0.95.

---

## 11. Anti-abuse

**Watch the cash to InstaPay ratio per center.** A center recording almost everything as cash while peers sit far lower is worth a look. The center collected the 10 EGP from the parent either way, so recording an InstaPay payment as cash means pocketing a fee that was already paid.

The service fee line on the invoice reduces this at the design level, since the fee is attached at invoice creation rather than at payment method selection. Confirm during build that the fee follows the invoice, not the button.

**Reference numbers are stored permanently and are never reusable**, per center.

---

## 12. Data and privacy

Receipt images contain full names, InstaPay addresses, and payment history for both parties. This is personal financial data.

- Store images encrypted, scoped strictly to the center
- Set a retention period and delete on schedule
- Delete on a valid erasure request, consistent with the child safety and PDPL work
- Paid AI tier only, never the free tier
- Adsero reviews this flow before it goes live

---

## 13. Copy rules

These are not suggestions.

- To parents: استلمنا الإيصال، السنتر هيأكد الاستلام
- Never: تم التأكد من الدفع، or any wording implying the platform verified a payment
- In the terms: the center confirms receipt of funds. TutoringHQ records and matches evidence, it does not verify that money moved.
- All parent and center facing copy in Egyptian colloquial Arabic

---

## 14. Not in this build

- Any flow where tuition passes through a platform account
- Automatic SMS reading. Google Play restricts it, iPhone cannot do it at all, and bank formats drift. If bank message matching is added later, it is by the center sharing the message into the app, not by reading it silently.
- Storing a parent IPA against a student as a permanent identity. Parents change banks and accounts, and a spouse or sibling may pay. Identity comes from the invoice link.
- Card payments, online checkout, or anything requiring a payment gateway

---

## 15. Build order

1. Settings, InstaPay details, method toggle
2. Invoice with service fee line, WhatsApp template, upload link
3. Reader function and the 50 image accuracy test
4. Upload page and parent responses
5. Matching, states, flags
6. Center View and Confirm screens
7. Batch list upload
8. Fee accrual, running total, monthly billing line
9. Ratio monitoring

The reader accuracy test comes before the matching work. If accuracy is not good enough on real screenshots, the design changes and it is better to know at step 3 than step 6.

---

## 16. Open before launch

- Adsero on the flow and on receipt image handling under PDPL
- Advisor confirming that billing a center a monthly software service fee, funded by the parent through the center, is straightforward
- Whether the WhatsApp template needs to be new or an existing one covers it, plus 24 to 48 hours for Meta approval
- The exact link expiry, following the child safety decision
