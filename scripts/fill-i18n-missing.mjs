import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function walkDir(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.git'].includes(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walkDir(full, files)
    else if (/\.(tsx?|jsx?)$/.test(entry)) files.push(full)
  }
  return files
}

function findMatchingBrace(s, start) {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (esc) {
      esc = false
      continue
    }
    if (c === '\\' && inStr) {
      esc = true
      continue
    }
    if (c === '"') {
      inStr = !inStr
      continue
    }
    if (!inStr) {
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return i
      }
    }
  }
  throw new Error('Unbalanced braces')
}

function extractFirstRootLandingAndStrip(text) {
  const marker = '"landing"'
  const idx = text.indexOf(marker)
  if (idx === -1) return { legacy: null, text }
  const braceStart = text.indexOf('{', idx)
  if (braceStart === -1) return { legacy: null, text }
  const end = findMatchingBrace(text, braceStart)
  const legacy = JSON.parse(text.slice(braceStart, end + 1))
  let removeEnd = end + 1
  while (removeEnd < text.length && /\s/.test(text[removeEnd])) removeEnd++
  if (text[removeEnd] === ',') removeEnd++
  const stripped = text.slice(0, idx) + text.slice(removeEnd)
  return { legacy, text: stripped }
}

function deepMerge(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return b
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

function flatten(obj, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key))
    else out[key] = v
  }
  return out
}

function setDeep(obj, parts, value) {
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    if (!(p in cur) || typeof cur[p] !== 'object' || cur[p] === null || Array.isArray(cur[p])) cur[p] = {}
    cur = cur[p]
  }
  cur[parts[parts.length - 1]] = value
}

function humanizeKeyPath(key) {
  const last = key.split('.').pop()
  const spaced = last
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Egyptian business Arabic: token hints (unknown tokens keep English for visibility). */
const WORD_AR = {
  the: '',
  a: '',
  an: '',
  to: 'إلى',
  of: 'من',
  for: 'لـ',
  and: 'و',
  or: 'أو',
  in: 'في',
  on: 'على',
  at: 'في',
  is: 'هو',
  are: '',
  be: '',
  by: 'بواسطة',
  with: 'مع',
  from: 'من',
  all: 'الكل',
  no: 'لا',
  yes: 'نعم',
  new: 'جديد',
  add: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
  save: 'حفظ',
  cancel: 'إلغاء',
  confirm: 'تأكيد',
  close: 'إغلاق',
  back: 'رجوع',
  next: 'التالي',
  done: 'تم',
  title: 'عنوان',
  subtitle: 'وصف',
  name: 'الاسم',
  names: 'الأسماء',
  status: 'الحالة',
  active: 'نشط',
  pending: 'قيد الانتظار',
  paid: 'مدفوع',
  overdue: 'متأخر',
  suspended: 'موقوف',
  cancelled: 'ملغى',
  amount: 'المبلغ',
  total: 'الإجمالي',
  center: 'السنتر',
  centers: 'السناتر',
  plan: 'الباقة',
  billing: 'الفوترة',
  payment: 'الدفع',
  payments: 'المدفوعات',
  student: 'طالب',
  students: 'الطلاب',
  group: 'مجموعة',
  groups: 'المجموعات',
  room: 'قاعة',
  rooms: 'القاعات',
  branch: 'فرع',
  branches: 'الفروع',
  team: 'الفريق',
  member: 'عضو',
  members: 'الأعضاء',
  owner: 'المالك',
  phone: 'الهاتف',
  email: 'البريد',
  notes: 'ملاحظات',
  note: 'ملاحظة',
  date: 'التاريخ',
  time: 'الوقت',
  day: 'يوم',
  days: 'أيام',
  month: 'شهر',
  monthly: 'شهري',
  annual: 'سنوي',
  quarterly: 'ربع سنوي',
  annualy: 'سنوياً',
  summary: 'ملخص',
  details: 'التفاصيل',
  view: 'عرض',
  download: 'تحميل',
  export: 'تصدير',
  import: 'استيراد',
  search: 'بحث',
  select: 'اختيار',
  submit: 'إرسال',
  loading: 'جاري التحميل',
  error: 'خطأ',
  success: 'نجاح',
  required: 'مطلوب',
  optional: 'اختياري',
  general: 'عام',
  settings: 'الإعدادات',
  financial: 'مالي',
  financials: 'مالية',
  admin: 'إدارة',
  referral: 'إحالة',
  referrals: 'الإحالات',
  commission: 'عمولة',
  commissions: 'العمولات',
  withdrawal: 'سحب',
  withdrawals: 'السحوبات',
  credits: 'رصيد',
  credit: 'رصيد',
  invoice: 'فاتورة',
  invoices: 'الفواتير',
  renewal: 'تجديد',
  renewals: 'التجديدات',
  subscription: 'الاشتراك',
  pack: 'الباقة',
  whatsapp: 'واتساب',
  message: 'رسالة',
  messages: 'الرسائل',
  scanner: 'الماسح',
  attendance: 'الحضور',
  schedule: 'الجدول',
  session: 'حصة',
  sessions: 'الحصص',
  holiday: 'عطلة',
  holidays: 'العطل',
  period: 'فترة',
  periods: 'الفترات',
  subject: 'مادة',
  subjects: 'المواد',
  teacher: 'معلم',
  assistant: 'مساعد',
  role: 'الدور',
  permissions: 'الصلاحيات',
  invite: 'دعوة',
  invited: 'مدعو',
  remove: 'إزالة',
  removed: 'تمت الإزالة',
  activate: 'تفعيل',
  activated: 'مفعّل',
  deactivate: 'إيقاف',
  deactivated: 'موقوف',
  login: 'تسجيل الدخول',
  logout: 'تسجيل الخروج',
  register: 'التسجيل',
  password: 'كلمة السر',
  pin: 'الرمز السري',
  district: 'المنطقة',
  city: 'المدينة',
  governorate: 'المحافظة',
  address: 'العنوان',
  landmark: 'معلم',
  building: 'عمارة',
  street: 'شارع',
  apartment: 'شقة',
  delivery: 'التوصيل',
  fee: 'رسوم',
  fees: 'الرسوم',
  cost: 'التكلفة',
  price: 'السعر',
  rate: 'السعر',
  limit: 'الحد',
  reached: 'تم الوصول',
  empty: 'فارغ',
  available: 'متاح',
  unavailable: 'غير متاح',
  balance: 'الرصيد',
  outstanding: 'مستحق',
  unpaid: 'غير مدفوع',
  method: 'الطريقة',
  reference: 'المرجع',
  type: 'النوع',
  number: 'الرقم',
  order: 'طلب',
  orders: 'الطلبات',
  card: 'بطاقة',
  cards: 'البطاقات',
  vendor: 'المورد',
  vendors: 'الموردون',
  health: 'الصحة',
  score: 'النتيجة',
  actions: 'الإجراءات',
  action: 'إجراء',
  alert: 'تنبيه',
  alerts: 'التنبيهات',
  pipeline: 'مسار المبيعات',
  lead: 'عميل محتمل',
  trial: 'تجربة',
  demo: 'عرض',
  lost: 'خسارة',
  closed: 'مغلق',
  ops: 'العمليات',
  control: 'التحكم',
  ceo: 'المدير',
  hero: 'البطل',
  stats: 'إحصائيات',
  features: 'المزايا',
  pricing: 'الأسعار',
  landing: 'الصفحة',
  nav: 'التنقل',
  common: 'عام',
  heatmap: 'خريطة الحضور',
  upgrade: 'ترقية',
  downgrade: 'تخفيض',
  reactivation: 'إعادة التفعيل',
  withdrawal: 'سحب',
  history: 'السجل',
  cohort: 'الفئة',
  churn: 'الانسحاب',
  revenue: 'الإيرادات',
  mrr: 'MRR',
  arr: 'ARR',
  cash: 'التحصيل',
  collection: 'التحصيل',
  overdue: 'متأخر',
  due: 'مستحق',
  soon: 'قريباً',
  annual: 'سنوي',
  quarterly: 'ربع سنوي',
  yearly: 'سنوي',
  weekly: 'أسبوعي',
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'أسبوع',
  this: 'هذا',
  last: 'آخر',
  net: 'صافي',
  gross: 'إجمالي',
  profit: 'ربح',
  margin: 'هامش',
  fixed: 'ثابت',
  variable: 'متغير',
  costs: 'التكاليف',
  salaries: 'الرواتب',
  rent: 'الإيجار',
  utilities: 'مرافق',
  income: 'الدخل',
  expenses: 'المصروفات',
  pnl: 'الأرباح والخسائر',
  term: 'الفصل',
  waitlist: 'قائمة الانتظار',
  capacity: 'السعة',
  max: 'أقصى',
  min: 'أدنى',
  custom: 'مخصص',
  default: 'افتراضي',
  mode: 'الوضع',
  summer: 'صيفي',
  daily: 'يومي',
  individual: 'فردي',
  global: 'عام',
  notices: 'إشعارات',
  opted: 'الموافقة',
  schedule: 'الجدول',
  start: 'بداية',
  end: 'نهاية',
  hour: 'ساعة',
  request: 'طلب',
  requests: 'الطلبات',
  approve: 'موافقة',
  approved: 'تمت الموافقة',
  reject: 'رفض',
  rejected: 'مرفوض',
  blacklist: 'القائمة السوداء',
  reason: 'السبب',
  copy: 'نسخ',
  copied: 'تم النسخ',
  payout: 'صرف',
  reward: 'مكافأة',
  held: 'محجوز',
  withdrawable: 'قابل للسحب',
  forfeited: 'ملغى',
  mark: 'تسجيل',
  filter: 'تصفية',
  quarter: 'ربع',
  month: 'شهر',
  year: 'سنة',
  table: 'جدول',
  row: 'صف',
  col: '',
  column: 'عمود',
  open: 'مفتوح',
  leads: 'العملاء المحتملين',
  signup: 'التسجيل',
  created: 'تاريخ الإنشاء',
  step: 'خطوة',
  steps: 'الخطوات',
  complete: 'مكتمل',
  profile: 'الملف',
  scan: 'مسح',
  onboarding: 'التأهيل',
  reminder: 'تذكير',
  auto: 'تلقائي',
  suspend: 'إيقاف',
  snooze: 'تأجيل',
  resolve: 'حل',
  whatsapp: 'واتساب',
  revenue: 'إيراد',
  risk: 'خطر',
  priority: 'أولوية',
  none: 'لا شيء',
  low: 'منخفض',
  medium: 'متوسط',
  high: 'مرتفع',
  critical: 'حرج',
  excellent: 'ممتاز',
  good: 'جيد',
  average: 'متوسط',
  not: 'غير',
  calculated: 'محسوب',
  expired: 'منتهي',
  renewal: 'تجديد',
  scans: 'عمليات المسح',
  collected: 'المُحصّل',
  hint: 'تلميح',
  pack: 'الباقة',
  mtd: 'الشهر حتى اليوم',
  banner: 'شريط',
  announcement: 'إعلان',
  toggle: 'تبديل',
  maintenance: 'صيانة',
  service: 'خدمة',
  state: 'الحالة',
  checked: 'آخر فحص',
  dangerous: 'خطير',
  unlock: 'فتح',
  wrong: 'غلط',
  disable: 'تعطيل',
  pause: 'إيقاف مؤقت',
  read: 'قراءة',
  only: 'فقط',
  panel: 'لوحة',
  emergency: 'طوارئ',
  warning: 'تحذير',
  affect: 'يؤثر',
  immediately: 'فوراً',
  undo: 'تراجع',
  hard: 'صعب',
  confirm: 'تأكيد',
  body: 'النص',
  title: 'العنوان',
  subtitle: 'وصف',
  signup: 'تسجيل',
  get: 'احصل',
  started: 'ابدأ',
  free: 'مجاناً',
  card: 'بطاقة',
  setup: 'إعداد',
  direct: 'مباشر',
  support: 'الدعم',
  made: 'صُنع',
  egypt: 'مصر',
  rights: 'الحقوق',
  reserved: 'محفوظة',
  tagline: 'الشعار',
  founders: 'المؤسسين',
  offer: 'عرض',
  off: 'خصم',
  run: 'شغّل',
  smarter: 'بذكاء',
  easier: 'أسهل',
  all: 'كل',
  one: 'واحد',
  place: 'مكان',
  built: 'مبني',
  tutoring: 'دروس',
  private: 'خاص',
  instant: 'فوري',
  reports: 'تقارير',
  kpi: 'مؤشرات',
  dashboard: 'لوحة التحكم',
  sales: 'المبيعات',
  activation: 'التفعيل',
  operations: 'العمليات',
  follow: 'متابعة',
  up: 'لاحق',
  field: 'حقل',
  source: 'المصدر',
  stage: 'المرحلة',
  next: 'التالي',
  save: 'حفظ',
  add: 'إضافة',
  lead: 'عميل محتمل',
  stages: 'المراحل',
  lost: 'خسران',
  closed: 'مغلق',
  onboarding: 'التأهيل',
  col: '',
  center: 'سنتر',
  plan: 'باقة',
  payment: 'دفع',
  all: 'كل',
  time: 'الوقت',
  created: 'أنشئ',
  not: 'لم',
  started: 'يبدأ',
  profile: 'ملف',
  students: 'طلاب',
  qr: 'QR',
  scanner: 'ماسح',
  complete: 'اكتمال',
  renewal: 'تجديد',
  district: 'منطقة',
  score: 'نتيجة',
  today: 'اليوم',
  actions: 'إجراءات',
  excellent: 'ممتاز',
  good: 'كويس',
  average: 'متوسط',
  critical: 'حرج',
  not: 'مش',
  calculated: 'محسوبة',
  expired: 'منتهية',
  days: 'أيام',
  suspend: 'إيقاف',
  are: '',
  you: 'انت',
  sure: 'متأكد',
  collected: 'المتحصل',
  quarter: 'الربع',
  within: 'خلال',
  total: 'إجمالي',
  hint: 'تلميح',
  pending: 'معلق',
  failed: 'فشل',
  sending: 'إرسال',
  platform: 'المنصة',
  config: 'إعدادات',
  keys: 'مفاتيح',
  mode: 'وضع',
  read: 'قراءة',
  only: 'فقط',
  cron: 'مهام مجدولة',
  jobs: 'مهام',
  announcement: 'إعلان',
  banner: 'بانر',
  wa: 'واتساب',
  service: 'خدمة',
  state: 'حالة',
  last: 'آخر',
  check: 'فحص',
  emergency: 'طوارئ',
  control: 'تحكم',
  these: 'دي',
  affect: 'بتأثر',
  centers: 'سناتر',
  immediately: 'فوراً',
  unlock: 'فتح',
  password: 'كلمة السر',
  incorrect: 'غلط',
  enable: 'تفعيل',
  dangerous: 'خطير',
  hard: 'صعب',
  undo: 'تراجع',
  view: 'عرض',
  resolve: 'حل',
  snooze: 'تأجيل',
  cancel: 'إلغاء',
  at: 'عند',
  risk: 'خطر',
  no: 'مفيش',
  alerts: 'تنبيهات',
  summary: 'ملخص',
  priority: 'أولوية',
  financial: 'مالي',
  intelligence: 'ذكاء',
  fetch: 'تحميل',
  retry: 'إعادة',
  button: 'زر',
  load: 'تحميل',
  data: 'بيانات',
  revenue: 'إيرادات',
  mix: 'مزيج',
  growth: 'نمو',
  vs: 'مقابل',
  worst: 'أسوأ',
  best: 'أفضل',
  current: 'حالي',
  year: 'سنة',
  chart: 'مخطط',
  window: 'نافذة',
  sold: 'مباع',
  all: 'كل',
  time: 'الوقت',
  profit: 'ربح',
  calculator: 'حاسبة',
  negative: 'سالب',
  below: 'أقل',
  costs: 'تكاليف',
  month: 'الشهر',
  projected: 'متوقع',
  dip: 'هدوء',
  season: 'موسم',
  june: 'يونيو',
  through: 'حتى',
  august: 'أغسطس',
  variable: 'متغير',
  print: 'طباعة',
  per: 'لكل',
  note: 'ملاحظة',
  formula: 'معادلة',
  equals: 'يساوي',
  minus: 'ناقص',
  donut: 'دائري',
  months: 'شهور',
  section: 'قسم',
  header: 'رأس',
  breakdown: 'تفصيل',
  subscriptions: 'اشتراكات',
  parent: 'ولي أمر',
  parents: 'أولياء الأمور',
  opted: 'الموافقون',
  label: 'تسمية',
  worst: 'أسوأ',
  pack: 'باقة',
  mrr: 'إيراد شهري متكرر',
  arr: 'إيراد سنوي متوقع',
  orders: 'طلبات',
  paid: 'مدفوع',
  badge: 'شارة',
  donut: 'رسم دائري',
  gross: 'إجمالي',
  margin: 'هامش',
  calculator: 'حاسبة',
  negative: 'سالب',
  warning: 'تحذير',
  below: 'أقل',
  costs: 'تكاليف',
  this: 'ده',
  month: 'الشهر',
  projected: 'متوقع',
  note: 'ملاحظة',
  current: 'حالي',
  times: 'مرات',
  twelve: 'اثني عشر',
  last: 'آخر',
  growth: 'نمو',
  neutral: 'محايد',
  decline: 'تراجع',
  down: 'هبوط',
  up: 'صعود',
  formula: 'معادلة',
  equals: 'يساوي',
  minus: 'ناقص',
  fixed: 'ثابت',
  costs: 'تكاليف',
  variable: 'متغير',
  sum: 'مجموع',
  total: 'إجمالي',
  revenue: 'إيرادات',
  mix: 'مزيج',
  donut: 'دائري',
  title: 'عنوان',
  section: 'قسم',
  header: 'رأس',
  subscriptions: 'اشتراكات',
  breakdown: 'تفصيل',
  whatsapp: 'واتساب',
  panel: 'لوحة',
  worst: 'أسوأ',
  best: 'أفضل',
  month: 'شهر',
  sold: 'مباع',
  cards: 'بطاقات',
  all: 'كل',
  time: 'الوقت',
  current: 'حالي',
  year: 'سنة',
  window: 'نافذة',
  chart: 'مخطط',
  months: 'شهور',
  data: 'بيانات',
  yet: 'لسه',
  no: 'لا',
  fetch: 'جلب',
  error: 'خطأ',
  retry: 'إعادة',
  button: 'زر',
  load: 'تحميل',
  financial: 'مالي',
  intelligence: 'ذكاء',
}

function tokensToAr(en) {
  const words = en.split(/\s+/).filter(Boolean)
  const out = []
  for (const w of words) {
    const key = w.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (!key) continue
    const tr = WORD_AR[key]
    if (tr === '') continue
    if (tr) out.push(tr)
    else out.push(w)
  }
  return out.length ? out.join(' ') : en
}

function collectKeys() {
  const srcFiles = walkDir(join(ROOT, 'src'))
  const keySet = new Set()
  for (const file of srcFiles) {
    const src = readFileSync(file, 'utf8')
    const namespaces = [...src.matchAll(/useTranslations\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
    const tMatches = [...src.matchAll(/\bt\(['"]([^'"]+)['"]/g)]
    for (const m of tMatches) {
      const key = m[1]
      if (key.includes('.')) keySet.add(key)
      else {
        for (const ns of namespaces) keySet.add(`${ns}.${key}`)
        keySet.add(key)
      }
    }
  }
  return keySet
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const explicit = loadJson(join(__dirname, 'i18n-explicit-overrides.json'))

function fillMessages(path, locale) {
  const raw = readFileSync(path, 'utf8')
  let data
  if (path.endsWith('en.json') && raw.split('"landing"').length > 2) {
    const { legacy, text } = extractFirstRootLandingAndStrip(raw)
    data = JSON.parse(text)
    if (legacy && data.landing) data.landing = deepMerge(legacy, data.landing)
    else if (legacy && !data.landing) data.landing = legacy
  } else {
    data = JSON.parse(raw)
  }

  const flat = flatten(data)
  const keys = collectKeys()
  const missing = [...keys].filter((k) => flat[k] === undefined).sort((a, b) => {
    const da = a.split('.').length
    const db = b.split('.').length
    if (db !== da) return db - da
    return a.localeCompare(b)
  })

  function getParentAndLeaf(obj, parts) {
    let cur = obj
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur == null || typeof cur !== 'object') return { parent: null, leaf: parts[parts.length - 1] }
      cur = cur[parts[i]]
    }
    return { parent: cur, leaf: parts[parts.length - 1] }
  }

  for (const key of missing) {
    // Never replace an existing messages namespace object with a string (e.g. bare key "admin").
    if (!key.includes('.')) {
      const v = data[key]
      if (v && typeof v === 'object' && !Array.isArray(v)) continue
    }
    const parts = key.split('.')
    if (parts.length > 0) {
      const { parent, leaf } = getParentAndLeaf(data, parts)
      if (parent && typeof parent === 'object' && leaf in parent) {
        const existing = parent[leaf]
        if (existing && typeof existing === 'object' && !Array.isArray(existing)) continue
      }
    }
    const ex = explicit[key]
    const enStr = ex ? ex.en : humanizeKeyPath(key)
    const arStr = ex ? ex.ar : tokensToAr(enStr)
    const val = locale === 'en' ? enStr : arStr
    setDeep(data, parts, val)
  }

  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return missing.length
}

const enPath = join(ROOT, 'messages', 'en.json')
const arPath = join(ROOT, 'messages', 'ar.json')

const nEn = fillMessages(enPath, 'en')
const nAr = fillMessages(arPath, 'ar')

console.log(`Filled missing keys — en: ${nEn}, ar: ${nAr}`)
