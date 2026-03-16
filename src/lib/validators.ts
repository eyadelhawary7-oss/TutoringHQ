import type { Validator } from '@/hooks/useFieldValidation';

const EG_PHONE_REGEX = /^(\+20|0)?1[0-2]\d{8}$/;
const PIN_REGEX = /^\d{4,6}$/;

export const validatePhone: Validator = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return null; // use required validator separately
  const normalized = s.replace(/\s/g, '').replace(/^\+/, '');
  if (!EG_PHONE_REGEX.test(normalized)) return 'phoneInvalid';
  return null;
};

export const validatePhoneRequired: Validator = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return 'phoneRequired';
  return validatePhone(value);
};

export const validatePin: Validator = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (!PIN_REGEX.test(s)) return 'pinInvalid';
  return null;
};

export const validatePinRequired: Validator = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return 'pinRequired';
  return validatePin(value);
};

export const validateName: Validator = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (s.length < 2) return 'nameMinLength';
  return null;
};

export const validateNameRequired: Validator = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return 'nameRequired';
  return validateName(value);
};
