// Bosta shipping fees — locked May 3, 2026
// Includes: Bosta base rate + 14% VAT + 2.6% Paymob fee, rounded up to nearest 5
export const BOSTA_SHIPPING_FEES: Record<string, number> = {
  // Cairo zone — 115 EGP
  cairo: 115,
  giza: 115,
  sixth_october: 115,
  '6th_october': 115,
  sheikh_zayed: 115,
  new_cairo: 115,
  heliopolis: 115,
  nasr_city: 115,
  maadi: 115,
  zamalek: 115,
  downtown: 115,
  shubra: 115,
  ain_shams: 115,

  // Alexandria zone — 120 EGP
  alexandria: 120,
  alex: 120,

  // Delta / Canal zone — 130 EGP
  mansoura: 130,
  tanta: 130,
  zagazig: 130,
  ismailia: 130,
  port_said: 130,
  suez: 130,
  damietta: 130,
  kafr_el_sheikh: 130,
  gharbia: 130,
  sharqia: 130,
  dakahlia: 130,
  beheira: 130,
  monufia: 130,
  qalyubia: 130,

  // Upper Egypt / Red Sea zone — 165 EGP
  aswan: 165,
  luxor: 165,
  assiut: 165,
  asyut: 165,
  sohag: 165,
  qena: 165,
  hurghada: 165,
  red_sea: 165,
  minya: 165,
  beni_suef: 165,
  fayoum: 165,
  faiyum: 165,
  south_sinai: 165,
  north_sinai: 165,
  matrouh: 165,
  new_valley: 165,
  /** Settings "Other (Upper Egypt)" */
  other_upper_egypt: 165,
}

export const DEFAULT_SHIPPING_FEE = 165 // highest zone if city unknown

export function getShippingFee(governorate: string | null | undefined): number {
  if (!governorate) return DEFAULT_SHIPPING_FEE
  const key = governorate.toLowerCase().trim().replace(/\s+/g, '_')
  return BOSTA_SHIPPING_FEES[key] ?? DEFAULT_SHIPPING_FEE
}

export function getShippingZone(governorate: string | null | undefined): string {
  const fee = getShippingFee(governorate)
  if (fee === 115) return 'Cairo'
  if (fee === 120) return 'Alexandria'
  if (fee === 130) return 'Delta / Canal'
  return 'Upper Egypt / Red Sea'
}

const SHIPPING_ZONE_LABELS: Record<string, { en: string; ar: string }> = {
  Cairo: { en: 'Cairo', ar: 'القاهرة' },
  Alexandria: { en: 'Alexandria', ar: 'الإسكندرية' },
  'Delta / Canal': { en: 'Delta / Canal', ar: 'الدلتا / القناة' },
  'Upper Egypt / Red Sea': { en: 'Upper Egypt / Red Sea', ar: 'صعيد مصر / البحر الأحمر' },
}

/** Localized shipping zone label for UI (AdminOrdersClient, etc.). */
export function formatShippingZoneForLocale(zone: string, locale: string): string {
  const row = SHIPPING_ZONE_LABELS[zone]
  if (!row) return zone
  return locale === 'ar' ? row.ar : row.en
}
