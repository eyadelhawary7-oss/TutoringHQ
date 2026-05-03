export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateString(
  value: unknown,
  field: string,
  options: { minLength?: number; maxLength?: number; required?: boolean } = {},
): string {
  if (options.required && (value === undefined || value === null || value === '')) {
    throw new ValidationError(`${field} is required`, field);
  }
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`, field);
  const trimmed = value.trim();
  if (options.minLength && trimmed.length < options.minLength) {
    throw new ValidationError(`${field} must be at least ${options.minLength} characters`, field);
  }
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new ValidationError(`${field} must be at most ${options.maxLength} characters`, field);
  }
  return trimmed;
}

export function validatePhone(value: unknown, field: string = 'phone'): string {
  const phone = validateString(value, field, { maxLength: 20 });
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new ValidationError(`${field} must be a valid phone number`, field);
  }
  return phone;
}

export function validateAmount(value: unknown, field: string = 'amount'): number {
  if (typeof value === 'string') value = Number(value);
  if (typeof value !== 'number' || isNaN(value) || value < 0) {
    throw new ValidationError(`${field} must be a positive number`, field);
  }
  if (value > 1000000) throw new ValidationError(`${field} exceeds maximum allowed value`, field);
  return value;
}

export function validateUUID(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`, field);
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) throw new ValidationError(`${field} must be a valid ID`, field);
  return value;
}

export async function parseBodyWithLimit(
  request: Request,
  maxBytes: number = 65536,
): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new ValidationError('Request payload too large');
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new ValidationError('Request payload too large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError('Invalid JSON payload');
  }
}
