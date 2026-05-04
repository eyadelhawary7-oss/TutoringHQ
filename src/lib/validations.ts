import { z } from 'zod';

// Egyptian phone: 01XXXXXXXXX, +201XXXXXXXXX, or 1XXXXXXXXX - all normalize to 10 digits
function normalizeEgyptianPhone(v: string): string {
  const cleaned = v.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return cleaned.slice(1);
  if (cleaned.startsWith('20')) return cleaned.slice(2);
  return cleaned;
}
const egyptianPhone = z
  .string()
  .refine(
    (v) => {
      const normalized = normalizeEgyptianPhone(v);
      return normalized.length === 10 && /^1[0125]\d{8}$/.test(normalized);
    },
    'رقم الهاتف يجب أن يكون 11 رقم ويبدأ بـ 01'
  )
  .optional()
  .nullable();

export const egyptianPhoneRequired = z
  .string()
  .refine(
    (v) => {
      const normalized = normalizeEgyptianPhone(v);
      return normalized.length === 10 && /^1[0125]\d{8}$/.test(normalized);
    },
    'رقم الهاتف يجب أن يكون 11 رقم ويبدأ بـ 01'
  );

/** Public signup form (/api/signup) - strict validation to prevent injection/XSS */
export const signupSchema = z.object({
  centerName: z
    .string()
    .min(2, 'Center name must be at least 2 characters')
    .max(100, 'Center name too long')
    .regex(/^[a-zA-Z0-9\s\u0600-\u06FF]+$/, 'Invalid characters in center name'),
  phone: z.string().refine(
    (v) => /^\d{10,15}$/.test(v.replace(/\D/g, '')),
    'Invalid phone number format (10-15 digits)'
  ),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  plan: z
    .string()
    .transform((v) => (typeof v === 'string' ? v.toUpperCase() : v))
    .pipe(z.enum(['NANO', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE', 'TOP_CENTERS'])),
  referralCode: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ?? '').trim().toUpperCase())
    .refine((v) => v === '' || /^[A-Z0-9]{8}$/.test(v), 'Referral code must be 8 alphanumeric characters'),
});

export const onboardingSchema = z.object({
  centerName: z.string().min(1, 'Center name is required').max(200),
  referralCode: z.string().max(8).optional().or(z.literal('')),
});

export const reminderSettingsSchema = z.object({
  day5_enabled: z.boolean().optional().default(true),
  day10_enabled: z.boolean().optional().default(true),
  day15_enabled: z.boolean().optional().default(true),
  day5: z.number().int().min(1).max(31).optional().default(5),
  day10: z.number().int().min(1).max(31).optional().default(10),
  day15: z.number().int().min(1).max(31).optional().default(15),
});

export const whatsappSendSchema = z.object({
  to: z.string().min(1, 'Phone number is required').max(20),
  centerId: z.string().uuid('Invalid center ID'),
  type: z.enum(['text', 'template']).optional().default('text'),
  text: z.string().max(4000).optional(),
  template: z
    .object({
      name: z.string(),
      language: z.string().optional(),
      components: z.array(z.unknown()).optional(),
    })
    .optional(),
}).refine(
  (data) => (data.template != null) || (typeof data.text === 'string' && data.text.length > 0),
  { message: 'Either template or text is required' }
);

export const paymentSchema = z.object({
  student_id: z.string().uuid('Invalid student ID'),
  amount: z.number().min(0, 'Amount must be non-negative').max(100000),
  method: z.enum(['cash', 'instapay', 'vodacash', 'orange', 'fawry', 'bank'], {
    message: 'Invalid payment method',
  }),
  payment_date: z.string().datetime().optional(),
});

/** Student create/update - strict validation */
export const studentSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name too long')
    .regex(/^[a-zA-Z\s\u0600-\u06FF]+$/, 'Invalid characters in name'),
  phone: z
    .string()
    .refine((v) => !v || v === '' || /^\d{10,15}$/.test(v.replace(/\D/g, '')), 'Invalid phone number')
    .optional()
    .or(z.literal('')),
});

export const studentImportRowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  phone: egyptianPhone,
  parent_phone: egyptianPhone,
  subject: z.string().optional().nullable(),
  monthly_fee: z.number().min(0).optional().default(0),
});

/** Students table insert - fee comes from group, NOT from students table. Strips fee/monthly_fee. */
export const studentInsertSchema = z.object({
  center_id: z.string().uuid(),
  name: z.string().min(2, 'Name must be at least 2 characters').max(200),
  phone: z.string().optional().nullable(),
  parent_phone: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  payment_status: z.enum(['paid', 'unpaid', 'pending']).optional().default('unpaid'),
  parent_pack_opted_in: z.boolean().optional(),
  parent_consent_given: z.boolean().optional(),
  parent_consent_at: z.string().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).optional().nullable(),
}).transform((data) => {
  const { fee: _f, monthly_fee: _m, ...rest } = data as Record<string, unknown> & { fee?: unknown; monthly_fee?: unknown };
  return rest;
});

/** Partial update for students (via /api/db) — no required fields. */
export const studentUpdateSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(200).optional(),
    phone: z.string().optional().nullable(),
    parent_phone: z.string().optional().nullable(),
    subject: z.string().optional().nullable(),
    payment_status: z.enum(['paid', 'unpaid', 'pending']).optional(),
    parent_pack_opted_in: z.boolean().optional(),
    parent_consent_given: z.boolean().optional(),
    parent_consent_at: z.string().nullable().optional(),
    qr_code: z.string().optional().nullable(),
    sibling_family_id: z.string().uuid().nullable().optional(),
  })
  .transform((data) => {
    const { fee: _f, monthly_fee: _m, ...rest } = data as Record<string, unknown> & { fee?: unknown; monthly_fee?: unknown };
    return rest;
  });

export const whatsappSettingsSchema = z.object({
  individual_alerts_enabled: z.boolean(),
});

export const billingPeriodSchema = z.object({
  billing_period: z.enum(['monthly', 'quarterly', 'annual']),
});

/** Demo request (public, no auth) */
export const demoRequestSchema = z.object({
  name: z.string().min(2, 'Name required').max(100).regex(/^[a-zA-Z\s\u0600-\u06FF]+$/, 'Invalid characters'),
  phone: z.string().refine((v) => /^\d{10,15}$/.test(v.replace(/\D/g, '')), 'Invalid phone'),
  email: z.string().email().optional().or(z.literal('')),
  centerName: z.string().max(200).optional().or(z.literal('')),
});

/** Invite team member */
export const inviteUserSchema = z.object({
  name: z.string().max(100).regex(/^[a-zA-Z\s\u0600-\u06FF]*$/, 'Invalid characters').optional().default(''),
  phone: egyptianPhoneRequired,
  role: z.enum(['assistant', 'teacher', 'admin']),
  teacher_group_ids: z.array(z.string().uuid()).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
});

/** Admin team - add member */
export const adminTeamAddSchema = z.object({
  name: z.string().min(2).max(100).regex(/^[a-zA-Z\s\u0600-\u06FF]+$/, 'Invalid characters'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().refine((v) => /^\d{10,15}$/.test(v.replace(/\D/g, '')), 'Invalid phone'),
  role: z.enum(['internal_viewer', 'internal_admin', 'sales_rep', 'support_agent', 'accountant', 'custom']),
  custom_permissions: z.array(z.string()).optional().default([]),
});

/** Admin team - update role */
export const adminTeamUpdateSchema = z.object({
  memberId: z.string().uuid('Invalid member ID'),
  role: z.enum(['internal_viewer', 'internal_admin', 'sales_rep', 'support_agent', 'accountant', 'custom']),
  custom_permissions: z.array(z.string()).optional(),
  password: z.string().optional(), // Required for sensitive action
});

/** Admin team - remove member */
export const adminTeamRemoveSchema = z.object({
  memberId: z.string().uuid('Invalid member ID'),
});

/** Admin billing - record payment */
export const adminBillingRecordSchema = z.object({
  center_id: z.string().uuid('Invalid center ID'),
  amount: z.number().positive().max(1000000),
  billing_period: z
    .enum(['monthly', 'quarterly', 'annual', 'semi_annual'])
    .optional()
    .default('quarterly'),
  period_start: z.string().optional(),
  period_end: z.string().optional(),
  notes: z.string().max(500).optional().nullable(),
});

/** Admin billing - invoice action */
export const adminBillingInvoiceSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID'),
  action: z.enum(['approve', 'reject']),
  password: z.string().optional(), // Required for approve when amount > 50,000 EGP
});

/** Admin centers - create */
export const adminCentersCreateSchema = z.object({
  name: z.string().min(2).max(200).regex(/^[a-zA-Z0-9\s\u0600-\u06FF]+$/, 'Invalid characters'),
  ownerPhone: z.string().refine((v) => /^\d{10,15}$/.test(v.replace(/\D/g, '')), 'Invalid phone'),
  plan: z.enum(['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers', 'payg']).optional().default('starter'),
});

/** Admin centers - update (PUT) */
export const adminCentersUpdateSchema = z.object({
  centerId: z.string().uuid('Invalid center ID'),
  action: z.enum(['approve', 'reject', 'change_plan', 'suspend', 'reactivate', 'delete', 'update_billing']),
  newPlan: z.enum(['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers', 'payg']).optional(),
  confirmName: z.string().optional(),
  billing_period: z.string().optional(),
  next_payment_due: z.string().optional(),
  password: z.string().optional(), // Required for delete, suspend
});

/** Permissions update */
export const permissionsUpdateSchema = z.object({
  targetUserId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  permissionKey: z.string().optional(),
  enabled: z.boolean().optional(),
  permission: z.string().optional(),
  value: z.boolean().optional(),
  password: z.string().optional(), // Required when changing another admin's permissions
}).refine((d) => d.targetUserId || d.userId, { message: 'targetUserId or userId required' });

/** Settings billing - payment proof (PUT) */
export const settingsBillingPutSchema = z.object({
  action: z.enum(['request_change', 'cancel_change', 'submit_payment_proof', 'submit_payment_reference']),
  new_plan: z.enum(['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers', 'payg']).optional(),
  new_billing_type: z.string().max(50).optional(),
  reference: z.string().min(1).max(200).optional(),
  amount: z.number().positive().max(1000000).optional(),
  proof_url: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
});

/** Settings billing POST */
export const settingsBillingPostSchema = z.object({
  amount: z.number().positive().max(1000000),
  reference: z.string().min(1, 'Reference required').max(200),
  proofUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
  proof_url: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
  paymentMethod: z.string().max(50).optional(),
});

/** Plan request */
export const planRequestSchema = z.object({
  requested_plan: z.enum(['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers', 'payg']),
});

/** Admin approve payment */
export const adminApprovePaymentSchema = z.object({
  centerId: z.string().uuid('Invalid center ID'),
  action: z.enum(['approve', 'reject']),
});

/** Referral validate */
export const referralValidateSchema = z.object({
  code: z.string().max(20),
});

/** Admin plan requests - approve/reject */
export const adminPlanRequestsSchema = z.object({
  requestId: z.string().uuid('Invalid request ID'),
  action: z.enum(['approve', 'reject']),
  notes: z.string().max(500).optional().nullable(),
});

/** PAYG calculate */
export const paygCalculateSchema = z.object({
  centerId: z.string().uuid().optional(),
});

/** Student group create/update */
export const studentGroupSchema = z.object({
  name: z.string().min(2).max(100).regex(/^[a-zA-Z0-9\s\u0600-\u06FF]+$/, 'Invalid characters'),
  center_id: z.string().uuid().optional(),
  subject: z.string().optional().nullable(),
  fee: z.number().optional(),
  max_capacity: z.number().int().min(1).max(9999).optional().nullable(),
}).passthrough();

/** Card order student entry */
const cardOrderStudentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  student_number: z.string().optional(),
  qr_code: z.string().optional().nullable(),
});

/** DB route - table-specific validation for insert/update */
export const dbInsertSchemas: Record<string, z.ZodType> = {
  students: studentInsertSchema,
  student_groups: studentGroupSchema,
  payments: paymentSchema.extend({ center_id: z.string().uuid().optional() }),
  card_orders: z.object({
    center_id: z.string().uuid(),
    created_by: z.string().uuid(),
    students: z.array(cardOrderStudentSchema),
    quantity: z.number().int().min(0),
    price_per_card: z.number().min(0).optional().default(62),
    card_style: z.enum(['dark', 'light']).optional().nullable(),
    delivery_fee: z.number().min(0).optional().default(0),
    shipping_zone: z.string().optional().nullable(),
    total_amount: z.number().min(0),
    status: z
      .enum([
        'pending_payment',
        'pending',
        'paid',
        'confirmed',
        'printing',
        'ready_for_pickup',
        'shipped',
        'delivered',
      ])
      .optional()
      .default('pending_payment'),
    payment_status: z
      .enum(['pending_payment', 'unpaid', 'paid', 'failed'])
      .optional()
      .default('pending_payment'),
    delivery_address: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
};
