import { z } from 'zod';

// Egyptian phone: 01XXXXXXXXX (11 digits)
const egyptianPhone = z
  .string()
  .regex(/^01\d{9}$/, 'رقم الهاتف يجب أن يكون 11 رقم ويبدأ بـ 01')
  .optional()
  .nullable();

export const onboardingSchema = z.object({
  centerName: z.string().min(1, 'Center name is required').max(200),
});

export const reminderSettingsSchema = z.object({
  day5_enabled: z.boolean().optional().default(true),
  day10_enabled: z.boolean().optional().default(true),
  day15_enabled: z.boolean().optional().default(true),
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
  amount: z.number().min(0, 'Amount must be non-negative'),
  method: z.enum(['cash', 'instapay', 'vodacash', 'orange', 'fawry', 'bank'], {
    message: 'Invalid payment method',
  }),
  payment_date: z.string().datetime().optional(),
});

export const studentImportRowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  phone: egyptianPhone,
  parent_phone: egyptianPhone,
  subject_name: z.string().optional().nullable(),
  monthly_fee: z.number().min(0).optional().default(0),
});

export const whatsappSettingsSchema = z.object({
  individual_alerts_enabled: z.boolean(),
});
