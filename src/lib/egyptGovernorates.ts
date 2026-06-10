export type EgyptGovernorateOption = {
  value: string;
  labelAr: string;
  labelEn: string;
};

/** All 27 Egyptian governorates - values match `bostaShippingRates` keys / `centers.governorate`. */
export const EGYPT_GOVERNORATES: EgyptGovernorateOption[] = [
  { value: 'cairo', labelAr: 'القاهرة', labelEn: 'Cairo' },
  { value: 'giza', labelAr: 'الجيزة', labelEn: 'Giza' },
  { value: 'alexandria', labelAr: 'الإسكندرية', labelEn: 'Alexandria' },
  { value: 'port_said', labelAr: 'بورسعيد', labelEn: 'Port Said' },
  { value: 'suez', labelAr: 'السويس', labelEn: 'Suez' },
  { value: 'asyut', labelAr: 'أسيوط', labelEn: 'Asyut' },
  { value: 'aswan', labelAr: 'أسوان', labelEn: 'Aswan' },
  { value: 'beheira', labelAr: 'البحيرة', labelEn: 'Beheira' },
  { value: 'beni_suef', labelAr: 'بني سويف', labelEn: 'Beni Suef' },
  { value: 'damietta', labelAr: 'دمياط', labelEn: 'Damietta' },
  { value: 'faiyum', labelAr: 'الفيوم', labelEn: 'Faiyum' },
  { value: 'gharbia', labelAr: 'الغربية', labelEn: 'Gharbia' },
  { value: 'ismailia', labelAr: 'الإسماعيلية', labelEn: 'Ismailia' },
  { value: 'kafr_el_sheikh', labelAr: 'كفر الشيخ', labelEn: 'Kafr El Sheikh' },
  { value: 'luxor', labelAr: 'الأقصر', labelEn: 'Luxor' },
  { value: 'matrouh', labelAr: 'مطروح', labelEn: 'Matrouh' },
  { value: 'minya', labelAr: 'المنيا', labelEn: 'Minya' },
  { value: 'monufia', labelAr: 'المنوفية', labelEn: 'Monufia' },
  { value: 'new_valley', labelAr: 'الوادي الجديد', labelEn: 'New Valley' },
  { value: 'north_sinai', labelAr: 'شمال سيناء', labelEn: 'North Sinai' },
  { value: 'qalyubia', labelAr: 'القليوبية', labelEn: 'Qalyubia' },
  { value: 'qena', labelAr: 'قنا', labelEn: 'Qena' },
  { value: 'red_sea', labelAr: 'البحر الأحمر', labelEn: 'Red Sea' },
  { value: 'sharqia', labelAr: 'الشرقية', labelEn: 'Sharqia' },
  { value: 'sohag', labelAr: 'سوهاج', labelEn: 'Sohag' },
  { value: 'south_sinai', labelAr: 'جنوب سيناء', labelEn: 'South Sinai' },
  { value: 'dakahlia', labelAr: 'الدقهلية', labelEn: 'Dakahlia' },
];

export function governorateLabel(g: EgyptGovernorateOption, locale: 'en' | 'ar'): string {
  if (locale === 'ar') return g.labelAr;
  return g.labelEn;
}
