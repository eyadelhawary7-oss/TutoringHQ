/** Arabic numeral digits (٠-٩) */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Converts a number to Arabic-Indic numeral string.
 * e.g. 4000 -> "٤٬٠٠٠", 1500 -> "١٬٥٠٠"
 */
export function toAr(n: number): string {
  const s = n.toLocaleString('en-US');
  return s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]).replace(/,/g, '٬');
}
