/**
 * `Merged-Public-Legal` §01 — the single source of copy for every public legal
 * surface: the index, the four document readers, the data-rights form and its
 * confirmation.
 *
 * WHY THIS FILE AND NOT `messages/*.json`
 * ---------------------------------------
 * There were two conventions in the tree: `/legal/*` kept bilingual copy inline
 * in the component, while `/privacy` and `/terms` read the `legal.*` message
 * namespace. The design's prose is roughly 20x the old placeholder volume, so
 * this picks one and applies it everywhere on this surface.
 *
 * A `{ en, ar }` tuple makes a missing translation a TypeScript error at compile
 * time — strictly stronger than `scripts/check-i18n.ts` key parity, which only
 * checks that a key exists in both files, not that anyone filled it in. It also
 * keeps ~200 legal strings out of the parity gate. `admin.privacyQueue.*` is app
 * UI, not legal copy, and stays in `messages/`.
 *
 * INLINE BOLD is written as `**…**` and parsed by `renderInline` in
 * `LegalDoc.tsx` — never `dangerouslySetInnerHTML`. Under Arabic, Latin runs
 * (TutoringHQ, Paymob, PostHog, Sentry, Adsero, plan names) are isolated in
 * `<bdi>` by that same renderer so they do not reorder against adjacent
 * punctuation in RTL.
 *
 * TEN SECTIONS HAVE NO BODY COPY. The design's contents lists name 23 sections
 * across the four documents but draws prose for only 13. Those ten carry an
 * empty `blocks` array and render one explicit "Pending Adsero draft." line.
 * Inventing PDPL commitments counsel has not drafted would be fabrication, and
 * unlike a wrong number a wrong legal sentence is binding. They become real copy
 * with an edit to this file and nothing else.
 */

export type Bilingual = { en: string; ar: string };

/** A body block. `p` is a paragraph, `li` is the design's `.rli` dotted item. */
export type LegalBlock = { kind: 'p' | 'li' } & Bilingual;

export type LegalSection = {
  title: Bilingual;
  /** Empty = no drafted prose; the reader renders the pending-draft line. */
  blocks: LegalBlock[];
};

export type LegalSlug = 'privacy' | 'terms' | 'cookie' | 'dpa';

export type LegalDocument = {
  slug: LegalSlug;
  title: Bilingual;
  /** Meta line on the index row. */
  meta: Bilingual;
  /**
   * When set, replaces the whole computed "Version 2.0 · Updated …" line in the
   * reader header. The DPA is versioned by audience, not by number.
   */
  versionLineOverride?: Bilingual;
  sections: LegalSection[];
};

/** Drives the index rows and the reader's "N of 4 documents" counter. */
export const DOC_ORDER: readonly LegalSlug[] = ['privacy', 'terms', 'cookie', 'dpa'] as const;

/**
 * The version line on Privacy, Terms and Cookie. L-09 in
 * design/LEGAL-CHANGE-LEDGER.md, answered by Eyad on 4 August 2026.
 *
 * The number stays 2 and does NOT bump, because version 2.0 was never
 * published. Until this ships, production serves interim placeholder copy
 * reading "interim copy applies until 9 May 2026" — a self-declared expiry
 * that lapsed nearly three months ago. So this is FIRST PUBLICATION, not a
 * version bump, and 2 is the number the drafts already carry with Adsero;
 * renumbering would only desynchronise that thread. The next change after
 * publication is the first real bump.
 *
 * The date is publication day, not the design's 22 June: L-05 removed two
 * false claims from the Privacy policy after that date, so 22 June would have
 * been wrong the moment it rendered.
 */
export const DOC_VERSION = { version: 2, date: '2026-08-04' } as const;

/* ── Chrome, index and shared strings ───────────────────────────────────── */

export const LEGAL_CHROME = {
  indexTitle: { en: 'Legal', ar: 'القانوني' },
  indexSubtitle: { en: 'Policies and your rights', ar: 'السياسات وحقوقك' },
  indexIntro: {
    en: 'The agreements that govern your use of TutoringHQ. Each shows when it was last updated. All are governed by Egyptian law and pending final review by Adsero.',
    ar: 'الاتفاقيات اللي بتحكم استخدامك لـ TutoringHQ. كل واحدة مكتوب عليها آخر تحديث. وكلها خاضعة للقانون المصري وتحت المراجعة النهائية من Adsero.',
  },
  askTitle: {
    en: 'Want your data accessed, corrected or deleted?',
    ar: 'عايز توصل لبياناتك أو تصححها أو تمسحها؟',
  },
  askBody: {
    en: 'Students and parents: ask your center first, they hold your records. Everyone else can use the request form.',
    ar: 'الطلاب وأولياء الأمور: اسألوا السنتر الأول، هو اللي ماسك سجلاتكم. أي حد تاني يقدر يستخدم النموذج.',
  },
  openForm: { en: 'Open data rights form', ar: 'افتح نموذج حقوق البيانات' },
  backToAll: { en: 'Back to all documents', ar: 'ارجع لكل المستندات' },
  backToLegal: { en: 'Back to legal', ar: 'ارجع للقانوني' },
  onThisPage: { en: 'On this page', ar: 'في الصفحة دي' },
  /** F3: the ten contents entries the design lists but does not draft. */
  pendingDraft: { en: 'Pending Adsero draft.', ar: 'تحت الصياغة من Adsero.' },
  /**
   * F2: the readers are linked directly from the signup consent checkboxes, so
   * a user can tick "I agree" without ever passing the index where the design
   * states the draft status once. Appended to the version line the design
   * already draws, rather than restoring the removed amber banner.
   *
   * KEPT DELIBERATELY — Eyad, 4 August 2026, answering L-09: "Keep the
   * 'pending Adsero review' suffix. The consent checkboxes deep-link past the
   * index where draft status is stated."
   *
   * This is a known, recorded deviation from the design, which draws the
   * version line bare. Do not "restore design parity" by deleting it. It comes
   * off in the commit that records Adsero's sign-off, and at that point the
   * customers get told once (also Eyad's L-09 answer: no notification before
   * sign-off, then one).
   */
  pendingReview: { en: ' · pending Adsero review', ar: ' · تحت مراجعة Adsero' },
  ofDocuments: { en: 'of 4 documents', ar: 'من ٤ مستندات' },
} as const;

/** Reader version line, EN/AR, for the three numbered documents. */
export const VERSION_LINE = {
  versionLabel: { en: 'Version', ar: 'النسخة' },
  updatedLabel: { en: 'Updated', ar: 'آخر تحديث' },
} as const;

/* ── The four documents ─────────────────────────────────────────────────── */

const PRIVACY: LegalDocument = {
  slug: 'privacy',
  title: { en: 'Privacy Policy', ar: 'سياسة الخصوصية' },
  meta: { en: '', ar: '' }, // computed from DOC_VERSION
  sections: [
    {
      title: { en: 'What data we record', ar: 'البيانات اللي بنسجّلها' },
      blocks: [
        {
          kind: 'p',
          en: 'We record what you give us: names, phone numbers, billing address, and a 6-digit PIN stored only as a secure hash, never in plain text. Center owners and staff also enter student and parent contact details on behalf of their center.',
          ar: 'بنسجّل اللي إنت بتديهولنا: الأسماء وأرقام الموبايل وعنوان الفوترة، ورقم سري من ٦ أرقام بيتخزن مشفّر بس، من غير ما يتحفظ كنص واضح أبدًا. أصحاب السناتر والموظفين كمان بيدخّلوا بيانات الطلاب وأولياء الأمور نيابةً عن السنتر.',
        },
        {
          kind: 'p',
          en: 'We do **not** process sensitive data, and we do **not** collect anything from third parties. Card details are handled entirely by Paymob, never stored by us.',
          ar: 'إحنا **مابنعالجش** بيانات حسّاسة، و**مابنجمعش** أي حاجة من أطراف تانية. بيانات الكارت بيتعامل معاها Paymob بالكامل، وإحنا مابنخزّنهاش.',
        },
      ],
    },
    { title: { en: 'How we use it', ar: 'بنستخدمها إزاي' }, blocks: [] },
    {
      title: { en: 'Who controls your data', ar: 'مين المتحكم في بياناتك' },
      blocks: [
        {
          kind: 'p',
          en: 'If you are a **student or a parent**, your tutoring center is the controller of your data. TutoringHQ only processes it on the center’s instructions, as its processor. For access, correction or deletion, contact your center first.',
          ar: 'لو إنت **طالب أو ولي أمر**، السنتر بتاعك هو المتحكم في بياناتك. TutoringHQ بيعالجها بس بناءً على تعليمات السنتر، بصفته المعالِج. للوصول أو التصحيح أو المسح، كلّم السنتر الأول.',
        },
        {
          kind: 'p',
          en: 'If your center has closed or cannot help, you may contact us directly using the data rights form.',
          ar: 'لو السنتر قفل أو مش قادر يساعد، تقدر تتواصل معانا مباشرة من خلال نموذج حقوق البيانات.',
        },
      ],
    },
    { title: { en: 'How long we keep it', ar: 'بنحتفظ بيها قد إيه' }, blocks: [] },
    {
      title: { en: 'Your rights under the PDPL', ar: 'حقوقك تحت القانون' },
      blocks: [
        {
          kind: 'p',
          en: 'Under Egypt’s Law No. 151 of 2020, you may request access, correction, deletion, restriction, portability, or object to processing. We act on verified requests within **30 days**, at no charge, and we will never ask for your PIN to verify you.',
          ar: 'تحت القانون المصري رقم ١٥١ لسنة ٢٠٢٠، تقدر تطلب الوصول أو التصحيح أو المسح أو التقييد أو النقل، أو تعترض على المعالجة. بنرد على الطلبات الموثّقة خلال **٣٠ يوم**، بدون رسوم، ومش هنطلب منك الرقم السري أبدًا عشان نتأكد منك.',
        },
        {
          kind: 'p',
          en: 'Some data may be kept where the law requires it, or to defend a legal claim, or because it sits in a backup that is purged on its next cycle.',
          ar: 'ممكن نحتفظ ببعض البيانات لو القانون بيطلب كده، أو للدفاع عن حق قانوني، أو لأنها في نسخة احتياطية بتتمسح في دورتها الجاية.',
        },
      ],
    },
    { title: { en: 'Contact our DPO', ar: 'تواصل مع مسؤول البيانات' }, blocks: [] },
  ],
};

const TERMS: LegalDocument = {
  slug: 'terms',
  title: { en: 'Terms and Conditions', ar: 'الشروط والأحكام' },
  meta: { en: '', ar: '' },
  sections: [
    {
      title: { en: 'Subscription plans', ar: 'باقات الاشتراك' },
      blocks: [
        {
          kind: 'p',
          en: 'TutoringHQ is a subscription service, billed in Egyptian Pounds monthly or annually. Center plans run from Solo to Enterprise. Teachers have Standard, Pro and Scale, each with a 14-day free trial. Prices may change with at least 30 days’ notice.',
          ar: 'TutoringHQ خدمة بالاشتراك، بتتحاسب بالجنيه المصري شهري أو سنوي. باقات السناتر من Solo لـ Enterprise. المدرّسين عندهم Standard وPro وScale، وكل واحدة بتجربة مجانية ١٤ يوم. الأسعار ممكن تتغيّر بإخطار قبلها بـ ٣٠ يوم على الأقل.',
        },
      ],
    },
    {
      // F1: the live /terms route rendered a config-driven processing-fee
      // disclosure that the design's single Terms document has no equivalent
      // for. Deleting that route without porting the block would silently drop
      // a money disclosure the billing rules require, so `LegalDoc` appends it
      // here from the same `resolveProcessingFeeAmount()` source, on the same
      // `> 0` gate.
      title: { en: 'Payment and Paymob', ar: 'الدفع وباي موب' },
      blocks: [
        {
          kind: 'p',
          en: 'All payments are processed by Paymob, our authorized Egyptian processor. We never collect or store your card details. Completing a payment authorizes Paymob to charge the applicable fees on our behalf.',
          ar: 'كل المدفوعات بتتم من خلال Paymob، معالج الدفع المصري المعتمد بتاعنا. إحنا مابنجمعش ولا بنخزّن بيانات كارتك أبدًا. إتمام الدفع بيخوّل Paymob إنه يحصّل الرسوم نيابةً عننا.',
        },
      ],
    },
    {
      title: { en: 'Grace period and suspension', ar: 'فترة السماح والإيقاف' },
      blocks: [
        {
          kind: 'p',
          en: 'If a payment fails, your account enters a grace period and may drop to read-only. After it expires the account is suspended, and cannot reach any data or features. Accounts left suspended too long may be blacklisted.',
          ar: 'لو الدفع فشل، حسابك بيدخل فترة سماح وممكن يبقى قراءة بس. بعد ما تخلص، الحساب بيتوقف ومش هيقدر يوصل لأي بيانات أو مزايا. الحسابات اللي بتفضل متوقفة مدة طويلة ممكن تتحظر.',
        },
      ],
    },
    {
      title: { en: 'Refunds', ar: 'الاسترجاع' },
      blocks: [
        {
          kind: 'p',
          en: 'Subscription fees are non-refundable, except where Egyptian consumer law requires it or where we have materially failed to provide the service. If something is wrong, contact us and we will work it out.',
          ar: 'رسوم الاشتراك غير قابلة للاسترجاع، إلا لو قانون حماية المستهلك المصري بيطلب كده أو لو إحنا قصّرنا فعليًا في تقديم الخدمة. لو في حاجة غلط، كلّمنا وهنحلّها.',
        },
      ],
    },
    { title: { en: 'Acceptable use', ar: 'الاستخدام المقبول' }, blocks: [] },
    { title: { en: 'Liability', ar: 'المسؤولية' }, blocks: [] },
  ],
};

const COOKIE: LegalDocument = {
  slug: 'cookie',
  title: { en: 'Cookie Policy', ar: 'سياسة الكوكيز' },
  meta: { en: '', ar: '' },
  sections: [
    { title: { en: 'What cookies are', ar: 'يعني إيه كوكيز' }, blocks: [] },
    {
      title: { en: 'Strictly necessary', ar: 'الضرورية' },
      blocks: [
        {
          kind: 'p',
          en: 'These keep the platform working and cannot be switched off:',
          ar: 'دي بتخلّي المنصة شغّالة ومينفعش تتقفل:',
        },
        {
          kind: 'li',
          en: 'A session cookie that keeps you logged in after your phone and PIN, expiring after 24 hours.',
          ar: 'كوكي جلسة بيخلّيك مسجّل دخول بعد الموبايل والرقم السري، وبينتهي بعد ٢٤ ساعة.',
        },
        {
          kind: 'li',
          en: 'A security token that blocks cross-site request forgery.',
          ar: 'رمز أمان بيمنع تزوير الطلبات عبر المواقع.',
        },
        {
          kind: 'li',
          en: 'A cookie that remembers your language, Arabic or English.',
          ar: 'كوكي بيفتكر لغتك، عربي أو إنجليزي.',
        },
      ],
    },
    {
      title: { en: 'Analytics', ar: 'التحليلات' },
      blocks: [
        {
          kind: 'p',
          en: 'PostHog helps us see which pages are used so we can improve. Sentry catches errors. Both are aggregated, never used for advertising. You can opt out of PostHog by emailing us.',
          ar: 'PostHog بيساعدنا نشوف أنهي صفحات بتتستخدم عشان نحسّن. وSentry بيرصد الأخطاء. الاتنين مجمّعين ومابيتستخدموش في الإعلانات أبدًا. تقدر تلغي PostHog لو بعتّلنا إيميل.',
        },
      ],
    },
    {
      title: { en: 'What we never use', ar: 'اللي مابنستخدمهوش' },
      blocks: [
        {
          kind: 'p',
          en: 'No advertising cookies, no tracking pixels, no social-media cookies, and nothing that follows you across other websites.',
          ar: 'مفيش كوكيز إعلانات، ولا بكسل تتبّع، ولا كوكيز سوشيال ميديا، ولا أي حاجة بتتبعك على مواقع تانية.',
        },
      ],
    },
    { title: { en: 'How to control them', ar: 'إزاي تتحكم فيها' }, blocks: [] },
  ],
};

const DPA: LegalDocument = {
  slug: 'dpa',
  title: { en: 'Data Processing Agreement', ar: 'اتفاقية معالجة البيانات' },
  meta: { en: 'For centers and teachers', ar: 'للسناتر والمدرّسين' },
  versionLineOverride: { en: 'For centers and teachers', ar: 'للسناتر والمدرّسين' },
  sections: [
    {
      title: { en: 'Who is who', ar: 'مين هو مين' },
      blocks: [
        {
          kind: 'p',
          en: 'Your center is the **controller**. TutoringHQ is the **processor**, acting only on your documented instructions for the duration of your subscription.',
          ar: 'السنتر بتاعك هو **المتحكّم**. وTutoringHQ هو **المعالِج**، بيتصرف بس بناءً على تعليماتك الموثّقة طول مدة اشتراكك.',
        },
      ],
    },
    { title: { en: 'What we process', ar: 'بنعالج إيه' }, blocks: [] },
    {
      title: { en: 'Our duties as processor', ar: 'واجباتنا كمعالِج' },
      blocks: [
        { kind: 'p', en: 'We commit to:', ar: 'إحنا بنلتزم بإننا:' },
        {
          kind: 'li',
          en: 'Process only on your instructions, unless Egyptian law requires otherwise.',
          ar: 'نعالج بس بناءً على تعليماتك، إلا لو القانون المصري بيطلب غير كده.',
        },
        {
          kind: 'li',
          en: 'Keep everyone who touches the data under confidentiality.',
          ar: 'نلزم أي حد بيتعامل مع البيانات بالسرية.',
        },
        {
          kind: 'li',
          en: 'Apply appropriate security to protect it.',
          ar: 'نطبّق أمان مناسب لحمايتها.',
        },
      ],
    },
    { title: { en: 'Sub-processors', ar: 'المعالجون الفرعيون' }, blocks: [] },
    {
      title: { en: 'Breach notice', ar: 'إخطار الاختراق' },
      blocks: [
        {
          kind: 'p',
          en: 'If a security incident hits your data, we notify you without undue delay and, where feasible, within **72 hours**, with what we know: what happened, who is affected, and what we are doing about it.',
          ar: 'لو حصل حادث أمني على بياناتك، بنخطرك من غير تأخير غير مبرّر، وكل ما أمكن خلال **٧٢ ساعة**، باللي إحنا عارفينه: حصل إيه، ومين اتأثر، وإحنا بنعمل إيه.',
        },
      ],
    },
    { title: { en: 'Deletion', ar: 'الحذف' }, blocks: [] },
  ],
};

export const LEGAL_DOCS: Record<LegalSlug, LegalDocument> = {
  privacy: PRIVACY,
  terms: TERMS,
  cookie: COOKIE,
  dpa: DPA,
};

/* ── Data-rights form + confirmation ────────────────────────────────────── */

/**
 * STORED VALUES ARE THE PDPL RIGHT-NAMES, NOT THE DESIGN'S BUTTON LABELS.
 * The design draws imperatives (Access / Correct / Delete / Restrict / Export /
 * Object); only the labels change. `deletion` in particular must not be
 * renamed — `api/admin/privacy-requests/anonymize/route.ts` gates the entire
 * erasure path on `types.includes('deletion')`.
 */
export const REQUEST_TYPES = [
  'access',
  'correction',
  'deletion',
  'restriction',
  'portability',
  'objection',
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export const RELATIONSHIPS = ['center_owner', 'staff', 'parent', 'student', 'other'] as const;

export type Relationship = (typeof RELATIONSHIPS)[number];

export const FORM_COPY = {
  title: { en: 'Data rights request', ar: 'طلب حقوق البيانات' },
  subtitle: { en: "Under Egypt's PDPL", ar: 'تحت قانون حماية البيانات' },
  calloutLead: { en: 'Student or parent?', ar: 'طالب أو ولي أمر؟' },
  calloutBody: {
    en: 'Your center holds your data, so ask them first. Use this form only if your center has closed or cannot help.',
    ar: 'السنتر هو اللي ماسك بياناتك، فاسأله الأول. استخدم النموذج ده بس لو السنتر قفل أو مش قادر يساعد.',
  },
  nameLabel: { en: 'Full name', ar: 'الاسم بالكامل' },
  namePlaceholder: { en: 'As registered with your center', ar: 'زي ما هو مسجّل عند السنتر' },
  phoneLabel: { en: 'Mobile number', ar: 'رقم الموبايل' },
  phonePlaceholder: { en: '01X XXXX XXXX', ar: '٠١× ×××× ××××' },
  emailLabel: { en: 'Email', ar: 'الإيميل' },
  emailHint: { en: 'so we can send our reply', ar: 'عشان نبعتلك الرد' },
  emailPlaceholder: { en: 'you@example.com', ar: 'you@example.com' },
  relationshipLabel: { en: 'You are a', ar: 'إنت' },
  typesLabel: { en: 'What are you asking for', ar: 'بتطلب إيه' },
  detailsLabel: { en: 'Details', ar: 'التفاصيل' },
  detailsPlaceholder: { en: 'Describe what data is involved', ar: 'اوصف البيانات المطلوبة' },
  footNote: {
    en: 'We never ask for your PIN. No charge to submit.',
    ar: 'مابنطلبش الرقم السري أبدًا. وبدون أي رسوم.',
  },
  submit: { en: 'Submit request', ar: 'إرسال الطلب' },
  submitting: { en: 'Sending…', ar: 'جارٍ الإرسال…' },
  errorGeneric: {
    en: 'Something went wrong. Please try again.',
    ar: 'حصل خطأ. حاول تاني.',
  },
  errorName: { en: 'Enter your full name.', ar: 'اكتب اسمك بالكامل.' },
  errorPhone: { en: 'Enter your mobile number.', ar: 'اكتب رقم موبايلك.' },
  errorEmail: {
    en: 'Enter a valid email so we can reply.',
    ar: 'اكتب إيميل صحيح عشان نقدر نرد عليك.',
  },
  errorTypes: {
    en: 'Pick at least one thing you are asking for.',
    ar: 'اختار حاجة واحدة على الأقل بتطلبها.',
  },
  errorRelationship: { en: 'Tell us who you are.', ar: 'قولنا إنت مين.' },
} as const;

export const RELATIONSHIP_LABELS: Record<Relationship, Bilingual> = {
  center_owner: { en: 'Center owner', ar: 'صاحب سنتر' },
  staff: { en: 'Staff', ar: 'موظّف' },
  parent: { en: 'Parent', ar: 'ولي أمر' },
  student: { en: 'Student', ar: 'طالب' },
  other: { en: 'Other', ar: 'غير ذلك' },
};

export const REQUEST_TYPE_LABELS: Record<RequestType, Bilingual> = {
  access: { en: 'Access', ar: 'وصول' },
  correction: { en: 'Correct', ar: 'تصحيح' },
  deletion: { en: 'Delete', ar: 'مسح' },
  restriction: { en: 'Restrict', ar: 'تقييد' },
  portability: { en: 'Export', ar: 'نقل' },
  objection: { en: 'Object', ar: 'اعتراض' },
};

export const DONE_COPY = {
  title: { en: 'Request sent', ar: 'اتبعت الطلب' },
  heading: { en: 'We have your request', ar: 'استلمنا طلبك' },
  /**
   * The design writes "A confirmation is on its way to your phone." That is only
   * true when the WhatsApp confirmation actually went out, which requires the
   * `privacy_request_confirmation_wa_template` config key to name an approved
   * Meta template. With the key unset the route reports `confirmationSent:false`
   * and the truthful email line renders instead — never a claim that a message
   * was sent when none was.
   */
  subtextPhone: {
    en: 'A confirmation is on its way to your phone. Here is what happens next.',
    ar: 'تأكيد في طريقه لموبايلك دلوقتي. ده اللي هيحصل بعد كده.',
  },
  subtextEmail: {
    en: 'We’ll reply to the email you gave us. Here is what happens next.',
    ar: 'هنرد على الإيميل اللي إنت دخّلته. ده اللي هيحصل بعد كده.',
  },
  step1: {
    en: 'We acknowledge your request within **5 business days**.',
    ar: 'بنأكد استلام طلبك خلال **٥ أيام عمل**.',
  },
  step2: {
    en: 'We verify who you are, using the details you gave. Never your PIN.',
    ar: 'بنتأكد من هويتك بالبيانات اللي دخّلتها. من غير الرقم السري أبدًا.',
  },
  step3: {
    en: 'We complete it within **30 days** of verifying you. No charge.',
    ar: 'بنكمّله خلال **٣٠ يوم** من التأكد منك. بدون رسوم.',
  },
} as const;

/** Pick the locale side of a bilingual tuple. */
export function pick(v: Bilingual, isAr: boolean): string {
  return isAr ? v.ar : v.en;
}

export function isArabic(locale: string): boolean {
  return locale === 'ar' || locale.startsWith('ar-');
}
