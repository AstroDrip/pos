// Text normalisation used ONLY for search keys. Stored product names are never changed.
// Arabic: removes harakat/tatweel, unifies alef forms, alef maqsura → ya, ta marbuta → ha, hamza seats → base letter,
// and converts Arabic-Indic digits, so "أرز" finds "ارز" and "مُوز" finds "موز".

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g; // harakat, Quranic marks, tatweel
const MAP: Record<string, string> = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
  'ى': 'ي', 'ئ': 'ي', 'ة': 'ه', 'ؤ': 'و',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱىئةؤ٠-٩۰-۹]/g, (c) => MAP[c] ?? c)
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // punctuation becomes a word break
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokens(text: string): string[] {
  const n = normalizeForSearch(text);
  return n ? n.split(' ') : [];
}

export const hasArabic = (text: string) => /[؀-ۿ]/.test(text);

/** Minimum characters before name suggestions appear: 3 for Latin text, 2 for Arabic (short words). Codes have no minimum. */
export function minNameChars(text: string): number {
  return hasArabic(text) ? 2 : 3;
}
