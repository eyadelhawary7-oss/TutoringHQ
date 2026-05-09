/** Sample {{variables}} for owner-facing Meta template previews (approximate bodies). */

export const WA_TEMPLATE_PREVIEW_SAMPLES: Record<string, string> = {
  centre: 'سنتر النخبة',
  center: 'سنتر النخبة',
  center_name: 'سنتر النخبة',
  student_name: 'أحمد محمد',
  student: 'أحمد محمد',
  amount: '100 EGP',
  owner_name: 'محمود',
  owner: 'محمود',
  body: 'تذكير وديّ بموعد الحصة غداً.',
  groups_url: 'https://centerhq.app/ar/groups',
  settings_url: 'https://centerhq.app/ar/settings',
  scan_url: 'https://centerhq.app/ar/scan',
  invite_url: 'https://centerhq.app/ar/accept-invite?token=demo',
  role_label: 'مساعد',
  track_url: 'https://bosta.co/track/demo',
  referred_center: 'سنتر النور',
  commission_amount: '250 ج.م',
  commission_total: '1٬500 ج.م',
  decision: 'تمت الموافقة',
  note: '—',
  attended: '12',
  total_sessions: '14',
  balance: '400 ج.م',
  group_name: 'صف ثالث ثانوي — أ',
  parent_count: '48',
  month_label: 'مايو 2026',
  billing_amount: '576 ج.م',
  billing_period: 'مايو 2026',
  expiry: '15 مايو 2026',
  days_late: '5',
  amount_str: '1٬200 ج.م',
  dormancy_date: '1 يونيو 2026',
  deletion_date: '1 يوليو 2026',
  courier_name: 'Bosta',
  order_ref: 'CHQ-DEMO12',
  quantity: '50',
  notes: 'لا يوجد',
  pin_code: '482910',
  code: '482910',
  active_students: '120',
  sessions_week: '340',
  revenue: '85٬000 ج.م',
  new_students: '6',
  tip: 'راجع تقرير الغياب لهذا الأسبوع.',
  payment_link: 'https://centerhq.app/ar/settings/billing',
  login_link: 'https://centerhq.app/ar/login',
}

/** Renders `{{var}}` placeholders; unknown keys stay as-is. */
export function renderWaTemplatePreviewBody(body: string, samples: Record<string, string>): string {
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim()
    return samples[key] ?? `{{${key}}}`
  })
}

/** Approximate Arabic bodies keyed by `wa_meta_templates.template_name`. */
export const WA_TEMPLATE_PREVIEW_BODIES: Record<string, string> = {
  chq_parent_welcome:
    'مرحباً {{student_name}} 👋\nنورت سنتر {{centre}}.\nلسه محتاج حاجة، إحنا معاك على الواتس.',
  chq_parent_absence:
    'أهلًا {{student_name}}، {{centre}} بيتواصل معاك:\n{{student_name}} كان غايب النهاردة من الحصة.',
  chq_parent_balance_due:
    'أهلًا {{student_name}}،\n{{centre}} يُذكّرك: الرصيد المستحق {{amount}}.',
  chq_parent_scan:
    '✅ {{student_name}} سجّل حضور في {{centre}}.\nنتمنى يوم سعيد!',
  chq_parent_announcement_promo: '📣 {{centre}}\n{{body}}',
  chq_parent_announcement_ops: '📣 {{centre}}\n{{body}}',
  chq_parent_term_summary:
    'ملخص الفترة — {{student_name}}\nالمجموعة: {{group_name}}\nالحضور: {{attended}} من {{total_sessions}}\nالرصيد: {{balance}}\n{{centre}}',
  chq_pin_delivery: 'رمز الدخول السريع لـ {{centre}}: {{pin_code}}\nاحفظه في مكان آمن.',
  chq_onboarding_step2: 'أهلًا {{owner_name}}، خطوة 2 من إعداد {{center}}:\nاضغط لترتيب المجموعات:\n{{groups_url}}',
  chq_onboarding_step3: 'أهلًا {{owner_name}}، خطوة 3:\n{{settings_url}}',
  chq_onboarding_step4: 'أهلًا {{owner_name}}، جاهز للمسح؟\n{{scan_url}}',
  chq_team_invite: 'دعوة فريق — {{center}}\n{{role_label}}\n{{invite_url}}',
  chq_order_shipped:
    'أهلًا {{owner_name}}، تم شحن طلب الكروت لـ {{center}}.\nالكمية: {{quantity}}\nالتتبع: {{track_url}}',
  chq_referral_commission:
    'عمولة إحالة — {{owner_name}}\n{{referred_center}}: {{commission_amount}}\nالإجمالي المتاح: {{commission_total}}',
  chq_vendor_new_order:
    'طلب كروت جديد — مرجع {{order_ref}}\nالكمية: {{quantity}}\nملاحظات: {{notes}}\nالشحن عبر {{courier_name}}',
  chq_payment_retry:
    'أهلًا {{owner_name}}، {{center_name}}\nالمستحق {{amount_str}}\nادفع من الرابط:\n{{payment_link}}',
  chq_weekly_summary:
    'ملخص الأسبوع — {{center_name}}\nطلاب نشطون: {{active_students}}\nجلسات: {{sessions_week}}\nإيراد تقريبي: {{revenue}}\nجدد: {{new_students}}\n{{tip}}',
}

export function previewBodyForTemplate(templateName: string): string {
  return (
    WA_TEMPLATE_PREVIEW_BODIES[templateName] ??
    `قالب ${templateName}\n(معاينة تقريبية — راجع Meta Business Manager للنص النهائي)`
  )
}
