import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Arabic/English UI. English text is the key, so code stays readable and untranslated text
// falls back to English instead of breaking. Arabic wording should be reviewed by the store owner.
// {0}, {1}… are filled from the extra arguments of t().

export type Lang = 'en' | 'ar';

const AR: Record<string, string> = {
  // navigation
  Sell: 'البيع',
  Stock: 'المخزون',
  Products: 'المنتجات',
  Reports: 'التقارير',
  Shift: 'الوردية',
  Admin: 'الإدارة',
  'Log out': 'تسجيل الخروج',
  'Log in': 'تسجيل الدخول',
  'Backup not set up': 'النسخ الاحتياطي غير مُعد',
  'No backup yet': 'لا توجد نسخة احتياطية بعد',
  'Backup {0}h ago (local only)': 'آخر نسخة قبل {0} ساعة (محلية فقط)',
  'Backup less than 1h ago (local only)': 'آخر نسخة قبل أقل من ساعة (محلية فقط)',
  // login / setup
  'First-time setup: create the owner account': 'الإعداد الأول: أنشئ حساب المالك',
  Username: 'اسم المستخدم',
  'Display name': 'الاسم الظاهر',
  'PIN (4–8 digits)': 'الرمز السري (4–8 أرقام)',
  'Create owner': 'إنشاء المالك',
  "Replacing a computer? Restore the store's data instead of starting fresh.": 'تستبدل الجهاز؟ استعد بيانات المتجر بدلاً من البدء من جديد.',
  // sell
  'Open shift': 'فتح الوردية',
  'Opening cash float (SAR)': 'النقدية الافتتاحية (ريال)',
  Item: 'الصنف',
  Qty: 'الكمية',
  Price: 'السعر',
  Discount: 'الخصم',
  Amount: 'المبلغ',
  'Held bills:': 'الفواتير المعلقة:',
  'Scan, or type barcode / PLU / SKU and press Enter': 'امسح الباركود أو اكتب الباركود / رمز PLU / رمز الصنف ثم اضغط Enter',
  'Wait until the payment is saved, then add the item.': 'انتظر حتى يتم حفظ الدفع ثم أضف الصنف.',
  'Card part of a split payment (optional)': 'جزء البطاقة عند تقسيم الدفع (اختياري)',
  'No matching products': 'لا توجد منتجات مطابقة',
  'Searching…': 'جارٍ البحث…',
  'Customer phone (optional)': 'جوال العميل (اختياري)',
  'Customer:': 'العميل:',
  'Excl. VAT': 'قبل الضريبة',
  VAT: 'ضريبة القيمة المضافة',
  SAR: 'ريال',
  'A discount is larger than its line amount.': 'يوجد خصم أكبر من قيمة السطر.',
  'Discount needs a supervisor:': 'الخصم يحتاج موافقة المشرف:',
  'Supervisor username': 'اسم المستخدم للمشرف',
  PIN: 'الرمز السري',
  'Cash received (blank = exact)': 'النقد المستلم (فارغ = المبلغ بالضبط)',
  Cash: 'نقداً',
  Card: 'بطاقة',
  'Hold bill': 'تعليق الفاتورة',
  'Clear bill': 'إلغاء الفاتورة',
  'Clear the whole bill?': 'إلغاء الفاتورة بالكامل؟',
  'Reprint last receipt (copy)': 'إعادة طباعة آخر إيصال (نسخة)',
  'SAVED {0}. Change: {1} SAR.': 'تم الحفظ {0}. الباقي: {1} ريال.',
  ' Stock went below zero for some items.': ' المخزون أصبح أقل من صفر لبعض الأصناف.',
  'SAVED {0}. Change: {1}. Printing failed: {2}. Use Reprint.': 'تم الحفظ {0}. الباقي: {1}. فشلت الطباعة: {2}. استخدم إعادة الطباعة.',
  'NOT SAVED: {0}': 'لم يتم الحفظ: {0}',
  'Not found: {0}': 'غير موجود: {0}',
  '{0} is sold by weight. Scan the scale label.': '{0} يُباع بالوزن. امسح ملصق الميزان.',
  '{0} was scanned twice very quickly. Add it again?': 'تم مسح {0} مرتين بسرعة. هل تريد إضافته مرة أخرى؟',
  'Cash amount is not a valid number': 'مبلغ النقد غير صحيح',
  'Held: {0}. Discounts are not kept on held bills.': 'تم التعليق: {0}. الخصومات لا تُحفظ في الفواتير المعلقة.',
  'Finish or hold the current bill first.': 'أكمل الفاتورة الحالية أو علّقها أولاً.',
  'Removed, but the removal could not be logged: {0}': 'تم الحذف، لكن تعذر تسجيله: {0}',
  // stock
  'Receive goods': 'استلام بضاعة',
  Supplier: 'المورد',
  '— choose —': '— اختر —',
  'Supplier invoice / delivery note no.': 'رقم فاتورة المورد / سند التسليم',
  'Add product': 'إضافة منتج',
  'Search name or SKU': 'ابحث بالاسم أو رمز الصنف',
  Product: 'المنتج',
  'Unit cost excl. VAT': 'تكلفة الوحدة قبل الضريبة',
  'Save receipt': 'حفظ الاستلام',
  'Received {0}': 'تم الاستلام {0}',
  'Stock on hand': 'المخزون الحالي',
  'Only at or below reorder level': 'فقط عند حد إعادة الطلب أو أقل',
  'Reorder at': 'حد إعادة الطلب',
  'Avg cost': 'متوسط التكلفة',
  // products
  'New product': 'منتج جديد',
  'Name (Arabic)': 'الاسم (عربي)',
  'Name (English)': 'الاسم (إنجليزي)',
  'Sold by': 'يُباع بـ',
  Piece: 'الحبة',
  'Weight (kg)': 'الوزن (كجم)',
  'Shelf price incl. VAT (SAR)': 'سعر الرف شامل الضريبة (ريال)',
  'Shelf price incl. VAT (SAR per kg)': 'سعر الرف شامل الضريبة (ريال للكيلو)',
  'VAT %': 'نسبة الضريبة %',
  'Barcode (optional)': 'الباركود (اختياري)',
  'PLU (optional, needed for scale labels)': 'رمز PLU (اختياري، مطلوب لملصقات الميزان)',
  'Save product': 'حفظ المنتج',
  'Saved {0}': 'تم حفظ {0}',
  'Search products': 'ابحث في المنتجات',
  Name: 'الاسم',
  piece: 'حبة',
  kg: 'كجم',
  'Save price': 'حفظ السعر',
  'Other names for search (comma-separated)': 'أسماء أخرى للبحث (مفصولة بفواصل)',
  'Save names': 'حفظ الأسماء',
  'Deactivate product': 'إيقاف المنتج',
  Close: 'إغلاق',
  Deactivate: 'إيقاف',
  Reactivate: 'إعادة تفعيل',
  'Activity by cashier': 'النشاط حسب الكاشير',
  'Facts for review, not accusations: high numbers can have innocent reasons.': 'معلومات للمراجعة وليست اتهاماً: الأرقام المرتفعة قد يكون لها أسباب بريئة.',
  Discounts: 'الخصومات',
  Removed: 'المحذوف',
  Reprints: 'إعادة الطباعة',
  'Cash out': 'سحب نقدي',
  'Over / short': 'زيادة / عجز',
  'WARNING: the audit log has been altered outside the app (first bad record #{0}). Keep a copy of the database and contact support.': 'تحذير: تم تعديل سجل التدقيق خارج البرنامج (أول سجل غير صحيح رقم {0}). احتفظ بنسخة من قاعدة البيانات وتواصل مع الدعم.',
  'The price of {0} changed. Check the new price with the customer.': 'تغير سعر {0}. راجع السعر الجديد مع العميل.',
  // reports
  From: 'من',
  To: 'إلى',
  Sales: 'المبيعات',
  'Total incl. VAT': 'الإجمالي شامل الضريبة',
  'Total excl. VAT': 'الإجمالي قبل الضريبة',
  'Discounts given': 'الخصومات الممنوحة',
  'Cash (net of change)': 'النقد (بعد الباقي)',
  'By day': 'حسب اليوم',
  Day: 'اليوم',
  Total: 'الإجمالي',
  'Top products': 'الأكثر مبيعاً',
  'Items removed before payment ({0})': 'أصناف حُذفت قبل الدفع ({0})',
  Time: 'الوقت',
  User: 'المستخدم',
  Invoice: 'الفاتورة',
  'Not paid': 'لم تُدفع',
  'Bill cleared': 'إلغاء الفاتورة',
  'Line removed': 'حذف صنف',
  Type: 'النوع',
  Items: 'الأصناف',
  Value: 'القيمة',
  // shift
  'No open shift. Open one from the Sell tab.': 'لا توجد وردية مفتوحة. افتح وردية من شاشة البيع.',
  'Shift #{0}': 'الوردية رقم {0}',
  'Opening float': 'النقدية الافتتاحية',
  'Sales ({0})': 'المبيعات ({0})',
  'Cash sales': 'المبيعات النقدية',
  'Card sales': 'مبيعات البطاقة',
  'Cash in / out': 'إيداع / سحب نقدي',
  'Expected cash in drawer': 'النقد المتوقع في الدرج',
  Out: 'سحب',
  In: 'إيداع',
  Reason: 'السبب',
  Record: 'تسجيل',
  Recorded: 'تم التسجيل',
  'Close shift': 'إغلاق الوردية',
  'Counted cash in drawer (SAR)': 'النقد المعدود في الدرج (ريال)',
  'Shift closed': 'تم إغلاق الوردية',
  'Shift closed. Expected {0}, counted {1}, difference {2}.': 'تم إغلاق الوردية. المتوقع {0}، المعدود {1}، الفرق {2}.',
  // admin
  Backup: 'النسخ الاحتياطي',
  'Last verified local backup:': 'آخر نسخة محلية تم التحقق منها:',
  never: 'لا يوجد',
  'Last failure {0}: {1}': 'آخر فشل {0}: {1}',
  'Off-site (cloud) backup is not set up yet. Local backups are on this computer only: copy the backups folder to a USB drive regularly.':
    'النسخ الاحتياطي الخارجي (السحابي) غير مُعد بعد. النسخ المحلية على هذا الجهاز فقط: انسخ مجلد النسخ الاحتياطية إلى ذاكرة USB بانتظام.',
  'Set up backup key': 'إعداد مفتاح النسخ الاحتياطي',
  'An administrator must set up the backup key.': 'يجب على المدير إعداد مفتاح النسخ الاحتياطي.',
  'Back up now': 'نسخ احتياطي الآن',
  'Backup saved: {0}': 'تم حفظ النسخة: {0}',
  'Write this recovery code on paper and keep it somewhere safe, away from this computer.': 'اكتب رمز الاسترداد هذا على ورقة واحفظه في مكان آمن بعيداً عن هذا الجهاز.',
  'It is shown only once. Without it, backups cannot be restored on another computer.': 'يظهر مرة واحدة فقط. بدونه لا يمكن استعادة النسخ على جهاز آخر.',
  'I have written it down': 'لقد كتبته',
  'Restore from backup': 'الاستعادة من نسخة احتياطية',
  'Recovery code (needed on a new computer)': 'رمز الاسترداد (مطلوب على جهاز جديد)',
  'Choose backup file and check it': 'اختر ملف النسخة وافحصه',
  'Backup from {0} is valid. Last invoice: {1}. Sales: {2}, products: {3}.': 'النسخة بتاريخ {0} سليمة. آخر فاتورة: {1}. المبيعات: {2}، المنتجات: {3}.',
  none: 'لا يوجد',
  'Restore this backup': 'استعادة هذه النسخة',
  'Replace ALL current data with this backup? The current data is kept in a side file, not deleted. The app will restart.':
    'استبدال جميع البيانات الحالية بهذه النسخة؟ البيانات الحالية تُحفظ في ملف جانبي ولا تُحذف. سيُعاد تشغيل البرنامج.',
  Users: 'المستخدمون',
  Role: 'الدور',
  Cashier: 'كاشير',
  Supervisor: 'مشرف',
  Administrator: 'مدير',
  'Add user': 'إضافة مستخدم',
  Suppliers: 'الموردون',
  Phone: 'الجوال',
  'VAT number': 'الرقم الضريبي',
  'Payment terms (days)': 'مدة السداد (أيام)',
  'Add supplier': 'إضافة مورد',
  'Import from CSV': 'استيراد من ملف CSV',
  'Check file (nothing is saved)': 'افحص الملف (لن يُحفظ شيء)',
  '{0} rows: {1} ready, {2} problems, {3} warnings.': '{0} صف: {1} جاهز، {2} مشكلة، {3} تحذير.',
  'Row {0}, {1}: {2}': 'الصف {0}، {1}: {2}',
  'I have checked the warnings': 'لقد راجعت التحذيرات',
  'Import {0} rows': 'استيراد {0} صف',
  'Imported {0} {1}.': 'تم استيراد {0} {1}.',
  // messages from the app core (DomainError text)
  'Wrong username or PIN': 'اسم المستخدم أو الرمز السري غير صحيح',
  'Account locked after failed attempts. Try again later.': 'تم قفل الحساب بعد محاولات فاشلة. حاول لاحقاً.',
  'Please log in': 'يرجى تسجيل الدخول',
  'Open a shift before selling': 'افتح وردية قبل البيع',
  'Payment is less than the total': 'المبلغ المدفوع أقل من الإجمالي',
  'Card amount is more than the bill': 'مبلغ البطاقة أكبر من الفاتورة',
  'Discount needs supervisor approval': 'الخصم يحتاج موافقة المشرف',
  'Sale NOT saved. Nothing was recorded. Try again.': 'لم يتم حفظ البيع. لم يُسجل أي شيء. حاول مرة أخرى.',
  'Lost contact with the app core. Try again.': 'انقطع الاتصال بنواة البرنامج. حاول مرة أخرى.',
  'Invalid request data': 'بيانات الطلب غير صحيحة',
  'A shift is already open': 'توجد وردية مفتوحة بالفعل',
  'No open shift': 'لا توجد وردية مفتوحة',
};

export function translate(lang: Lang, key: string, ...args: (string | number)[]): string {
  const text = lang === 'ar' ? (AR[key] ?? key) : key;
  return text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}

/** Exposed for the dictionary test. */
export const ARABIC_KEYS = Object.keys(AR);

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, ...args: (string | number)[]) => string;
}

const Ctx = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (k, ...a) => translate('en', k, ...a) });

function savedLang(): Lang {
  try {
    return localStorage.getItem('pos.lang') === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(savedLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('pos.lang', l); // per-till preference only
    } catch {
      /* storage unavailable: language resets on restart */
    }
  };
  return <Ctx.Provider value={{ lang, setLang, t: (k, ...a) => translate(lang, k, ...a) }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label="language">
      {lang === 'ar' ? 'English' : 'العربية'}
    </button>
  );
}

/** Product name in the UI language first, the other language underneath. */
export function ProductName({ en, ar }: { en: string; ar: string }) {
  const { lang } = useI18n();
  const [main, sub, subDir] = lang === 'ar' ? [ar, en, 'ltr'] : [en, ar, 'rtl'];
  return (
    <>
      {main}
      <div className="ar" dir={subDir}>{sub}</div>
    </>
  );
}
