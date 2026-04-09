/**
 * Submit dormancy WhatsApp templates to Meta Graph API (WABA message_templates edge).
 *
 * Required env:
 *   WHATSAPP_TOKEN
 *   WHATSAPP_BUSINESS_ACCOUNT_ID  (WhatsApp Business Account ID, not phone number ID)
 *
 * Optional:
 *   WHATSAPP_GRAPH_VERSION (default v18.0)
 *
 * Run: node scripts/submit-dormancy-wa-templates.mjs
 */

const VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v18.0';
const token = process.env.WHATSAPP_TOKEN;
const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

const templates = [
  {
    name: 'chq_dormancy_notice',
    language: 'ar_EG',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'مرحباً {{1}}، تم إيقاف حسابك مؤقتاً بتاريخ {{2}} بسبب تأخر السداد.\nبياناتك محفوظة لمدة 12 شهراً. أعد التفعيل الآن: {{3}}',
        example: {
          body_text: [['مركز تجريبي', '2026-01-15', 'https://centerhq.app/ar/settings/billing']],
        },
      },
    ],
  },
  {
    name: 'chq_reactivation_warning_90',
    language: 'ar_EG',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'تنبيه {{1}}: بياناتك ستُحذف في {{2}} إذا لم تُعد تفعيل حسابك.\nتواصل معنا الآن لإعادة التفعيل والاحتفاظ ببياناتك.',
        example: {
          body_text: [['مركز تجريبي', '15 يناير 2027']],
        },
      },
    ],
  },
  {
    name: 'chq_reactivation_warning_30',
    language: 'ar_EG',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'تنبيه أخير {{1}}: 30 يوماً فقط قبل حذف بياناتك نهائياً في {{2}}.\nأعد التفعيل الآن لتجنب فقدان بياناتك.',
        example: {
          body_text: [['مركز تجريبي', '15 يناير 2027']],
        },
      },
    ],
  },
  {
    name: 'chq_data_deletion_notice',
    language: 'ar_EG',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '{{1}}، تم حذف بيانات حسابك بتاريخ {{2}} بعد 12 شهراً من الإيقاف.\nإذا أردت العودة، يمكنك التسجيل كمركز جديد. نتمنى لك التوفيق.',
        example: {
          body_text: [['مركز تجريبي', '15 يناير 2027']],
        },
      },
    ],
  },
];

async function main() {
  if (!token || !wabaId) {
    console.error(
      'Missing WHATSAPP_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID. Set both to submit templates to Meta.',
    );
    process.exit(1);
  }

  const url = `https://graph.facebook.com/${VERSION}/${wabaId}/message_templates`;

  for (const body of templates) {
    const payload = {
      name: body.name,
      language: body.language,
      category: body.category,
      allow_category_change: true,
      components: body.components,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[${body.name}] FAILED`, res.status, JSON.stringify(json));
    } else {
      console.log(`[${body.name}] OK`, JSON.stringify(json));
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
