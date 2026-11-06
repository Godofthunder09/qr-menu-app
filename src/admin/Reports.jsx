import { Fragment, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

// ═════════════════════════════════════════════════════════════════════
// REPORTS — every tab is built from ONE shared loader (fetchBills →
// normalizeBills), so Today / Date Range / Category / Table-wise /
// Discounts / Settlement can never disagree with each other.
//
// How bills are stored (see Dashboard.jsx + TodayReport.jsx):
//   • Print & Save   → is_paid=true, settlement_status='pending', payment_type='pending'
//   • Settle Payment → payment_type = cash | upi | card  (+ split_payment {cash,upi,card})
//   • Complimentary  → payment_type='complimentary', final_amount=0,
//                      discount_amt = subtotal + service charge (the amount waived)
//
// Because a complimentary bill is stored as a "discount", we separate it
// here: a bill's REAL discount excludes complimentary, and the waived
// value is reported as its own "Complimentary" number.
//
// Money identity used on every screen:
//   Gross + Service Charge − Discounts − Complimentary = Grand Total
//   Grand Total = Cash + UPI + Card + Pending (not yet settled)
// ═════════════════════════════════════════════════════════════════════

// ── date / format helpers ────────────────────────────────────────────
const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})
const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const addDays = (dateStr, days) => {
  const d = new Date(dateStr); d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}
const toRange = (from, to) => ({
  startISO: new Date(from + 'T00:00:00+05:30').toISOString(),
  endISO:   new Date(to   + 'T23:59:59.999+05:30').toISOString(),
})
const diffMinutes = (start, end) => {
  if (!start || !end) return null
  const diff = Math.round((new Date(end) - new Date(start)) / 60000)
  return diff >= 0 ? diff : null
}
const formatDuration = (mins) => {
  if (mins === null || mins === undefined) return '—'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60); const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
const r2  = (n) => Math.round((Number(n) || 0) * 100) / 100
const inr = (n) => r2(n).toLocaleString('en-IN')
const pctOf = (part, whole) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : '0.0')

const downloadCSV = (rows, filename) => {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

// ── departments ──────────────────────────────────────────────────────
// food_items.department (Kitchen / Tandoor / Beverage / Liquor) is the
// source of truth. The keyword guess below is ONLY a fallback for old
// items that have no department set yet.
const LIQUOR_KEYWORDS = [
  'beer','wine','whisky','whiskey','vodka','rum','gin','tequila','brandy',
  'champagne','scotch','bourbon','ale','lager','cider','sake','mead',
  'liquor','spirits','pint','draft','draught','feni','arrack','toddy','sangria',
  'kingfisher','corona','budweiser','heineken','bacardi','smirnoff','absolut',
  'jack daniel','jameson','old monk','mcdownell','royal stag','imperial blue',
  'teachers','blenders','black dog','black label','red label','green label',
  'shot','peg','half bottle','full bottle','liit','long island'
]
const BEVERAGE_KEYWORDS = [
  'mocktail','juice','lassi','shake','smoothie','soda','water','mineral water',
  'cold drink','soft drink','tea','coffee','lemonade','buttermilk','chaas',
  'nimbu pani','coconut water','virgin','cold coffee','milkshake','frappe',
  'pepsi','coke','cola','sprite','limca','maaza','frooti','thums up','7up',
  'cold bev','beverage','drink','mojito','cooler','squash','iced tea'
]
const BAKERY_KEYWORDS = [
  'bread','bun','naan','roti','paratha','chapati','puri','bhatura','kulcha',
  'garlic bread','toast','sandwich','burger','pizza','pasta',
  'cake','pastry','muffin','cookie','biscuit','croissant','waffle','pancake',
  'dessert','ice cream','gulab jamun','halwa','kheer','pudding','brownie',
  'rasgulla','jalebi','ladoo','barfi','mithai','sweet'
]
const guessDept = (name = '') => {
  const l = name.toLowerCase()
  if (LIQUOR_KEYWORDS.some(k => l.includes(k))) return 'Liquor'
  if (BEVERAGE_KEYWORDS.some(k => l.includes(k))) return 'Beverage'
  if (BAKERY_KEYWORDS.some(k => l.includes(k))) return 'Bakery'
  return 'Kitchen'
}

const DEPT_COLORS = {
  Kitchen:  { badge: 'bg-orange-100 text-orange-700', icon: '🍳', card: 'bg-orange-50 border-orange-200', text: 'text-orange-600' },
  Tandoor:  { badge: 'bg-red-100 text-red-700',       icon: '🔥', card: 'bg-red-50 border-red-200',       text: 'text-red-600' },
  Bakery:   { badge: 'bg-yellow-100 text-yellow-700', icon: '🥖', card: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700' },
  Beverage: { badge: 'bg-blue-100 text-blue-700',     icon: '🥤', card: 'bg-blue-50 border-blue-200',     text: 'text-blue-600' },
  Liquor:   { badge: 'bg-purple-100 text-purple-700', icon: '🍺', card: 'bg-purple-50 border-purple-200', text: 'text-purple-600' },
}
const DEPT_ORDER = ['Kitchen', 'Tandoor', 'Bakery', 'Beverage', 'Liquor']
const deptStyle = (d) => DEPT_COLORS[d] || DEPT_COLORS.Kitchen

const resolveDept = (dbDept, name) => (dbDept && DEPT_COLORS[dbDept] ? dbDept : guessDept(name))
// Open items are saved by Dashboard with dept 'Food' | 'Beverage' | 'Liquor'
const openItemDept = (oi) => {
  if (oi.dept === 'Food') return 'Kitchen'
  if (oi.dept && DEPT_COLORS[oi.dept]) return oi.dept
  return guessDept(oi.name)
}

// ── payments ─────────────────────────────────────────────────────────
const PAY_LABEL = {
  cash: '💵 Cash', upi: '📱 UPI', card: '💳 Card',
  complimentary: '🎁 Complimentary', pending: '⏳ Pending',
}
const PAY_COLOR = {
  cash: 'bg-green-100 text-green-700',
  upi:  'bg-blue-100 text-blue-700',
  card: 'bg-purple-100 text-purple-700',
  complimentary: 'bg-pink-100 text-pink-700',
  pending: 'bg-yellow-100 text-yellow-700',
}
const payIcon = (k) => (k === 'cash' ? '💵' : k === 'upi' ? '📱' : '💳')

// cash / upi / card actually received for ONE bill.
// Complimentary and still-pending bills have received nothing.
const getEffectivePayment = (bill) => {
  if (bill.isComp || bill.isPending) return { cash: 0, upi: 0, card: 0 }
  if (bill.split_payment) {
    return {
      cash: bill.split_payment.cash || 0,
      upi:  bill.split_payment.upi  || 0,
      card: bill.split_payment.card || 0,
    }
  }
  const amt = bill.final_amount || 0
  return {
    cash: bill.payment_type === 'cash' ? amt : 0,
    upi:  bill.payment_type === 'upi'  ? amt : 0,
    card: bill.payment_type === 'card' ? amt : 0,
  }
}

const splitText = (sp, sep = ' + ') =>
  Object.entries(sp || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}=Rs.${v}`).join(sep)

const payText = (b) => {
  if (b.isComp) return 'Complimentary'
  if (b.isPending) return 'Pending'
  if (b.split_payment) return `Split: ${splitText(b.split_payment, ', ')}`
  return b.payment_type || '—'
}

// ── bill normalisation ───────────────────────────────────────────────
// Rule: key = table + EXACT paid_at. Only order rows that were printed
// together (same timestamp) are merged into one bill. Never a minute bucket.
const compReasonOf = (reason = '') => reason.replace(/^Complimentary:\s*/i, '').trim()

const mergeLines = (lines) => {
  const map = {}
  lines.forEach(l => {
    const k = `${l.foodItemId || 'open:' + l.name}@${l.rate}`
    if (!map[k]) map[k] = { ...l }
    else { map[k].qty += l.qty; map[k].amount += l.amount }
  })
  return Object.values(map)
}

const normalizeBills = (orders = []) => {
  const map = {}
  orders.forEach(o => {
    const key = `${o.table_name_snapshot || 'Unknown'}__${o.paid_at || o.id}`
    const rowIsComp = o.payment_type === 'complimentary'
    const rowSub = o.subtotal || 0
    const rowSc  = o.service_charge_amt || 0

    const lines = [
      ...(o.order_items || [])
        .filter(i => (i.quantity || 0) > 0)               // 0-qty = removed item
        .map(i => {
          const fi = i.food_items || {}
          const name = fi.name || 'Unknown'
          const rate = i.price_at_order || 0
          return {
            foodItemId: i.food_item_id || null, name, qty: i.quantity, rate,
            amount: rate * i.quantity,
            dept: resolveDept(fi.department, name),
            categoryId: fi.category_id || null, subcategoryId: fi.subcategory_id || null,
            isOpen: false,
          }
        }),
      ...(o.open_items_json || []).map(oi => ({
        foodItemId: null, name: oi.name || 'Open item', qty: oi.qty || 0, rate: oi.price || 0,
        amount: (oi.price || 0) * (oi.qty || 0), dept: openItemDept(oi),
        categoryId: null, subcategoryId: null, isOpen: true,
      })),
    ]

    if (!map[key]) {
      map[key] = {
        key, ids: [], table_name_snapshot: o.table_name_snapshot || 'Unknown',
        created_at: o.created_at || o.paid_at, paid_at: o.paid_at,
        payment_type: o.payment_type, split_payment: null,
        settlement_status: o.settlement_status,
        subtotal: 0, service_charge_pct: o.service_charge_pct || 0, service_charge_amt: 0,
        discount_amt: 0, rawDiscount: 0,
        discount_type: o.discount_type, discount_value: 0, discount_reason: '',
        final_amount: 0, compValue: 0, compSub: 0, comp_reason: '',
        isComp: false, anyPending: false, items: [],
      }
    }
    const b = map[key]
    b.ids.push(o.id)
    b.subtotal += rowSub
    b.service_charge_amt += rowSc
    b.final_amount += o.final_amount || 0
    b.rawDiscount += o.discount_amt || 0
    b.items.push(...lines)

    if (rowIsComp) {
      b.isComp = true
      b.compValue += rowSub + rowSc      // everything waived
      b.compSub   += rowSub
      b.comp_reason = compReasonOf(o.discount_reason) || b.comp_reason
    } else {
      b.discount_amt += o.discount_amt || 0   // REAL discount only
      b.discount_value += o.discount_value || 0
      if (o.discount_reason) b.discount_reason = o.discount_reason
    }
    if (o.settlement_status === 'pending' || o.payment_type === 'pending') b.anyPending = true
    if (o.created_at && new Date(o.created_at) < new Date(b.created_at)) b.created_at = o.created_at
    if (o.paid_at && new Date(o.paid_at) > new Date(b.paid_at)) b.paid_at = o.paid_at
    if (o.split_payment) {
      const s = b.split_payment || { cash: 0, upi: 0, card: 0 }
      b.split_payment = {
        cash: s.cash + (o.split_payment.cash || 0),
        upi:  s.upi  + (o.split_payment.upi  || 0),
        card: s.card + (o.split_payment.card || 0),
      }
    }
  })

  return Object.values(map).map(b => ({
    ...b,
    isPending: !b.isComp && b.anyPending,
    payment_type: b.isComp ? 'complimentary' : b.payment_type,
    split_payment: b.isComp ? null : b.split_payment,
    items: mergeLines(b.items),
  }))
}

// ── ONE loader used by every tab ─────────────────────────────────────
const orderSelect = (withDept) => `id, payment_type, split_payment, is_paid, created_at, paid_at,
  settlement_status, subtotal, service_charge_pct, service_charge_amt,
  discount_type, discount_value, discount_amt, discount_reason, final_amount,
  table_name_snapshot, open_items_json,
  order_items(id, food_item_id, quantity, price_at_order,
    food_items(name, category_id, subcategory_id${withDept ? ', department' : ''}))`

const fetchBills = async (from, to) => {
  const { startISO, endISO } = toRange(from, to)
  const run = (withDept) => supabase.from('orders').select(orderSelect(withDept))
    .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
    .order('paid_at', { ascending: false })
  let { data, error } = await run(true)
  if (error) {
    // Safety net: if food_items.department does not exist yet, retry without it.
    console.warn('fetchBills (with department) failed, retrying:', error.message)
    ;({ data, error } = await run(false))
    if (error) { console.error('fetchBills:', error.message); return [] }
  }
  return normalizeBills(data || [])
}

// Totals for any list of bills. Same numbers on every tab.
const summarizeBills = (bills) => {
  const s = {
    count: bills.length, gross: 0, sc: 0, disc: 0, compCount: 0, compValue: 0, compSub: 0,
    pendingCount: 0, pendingAmt: 0, grand: 0,
    cash: 0, upi: 0, card: 0, cashCount: 0, upiCount: 0, cardCount: 0, splitCount: 0,
  }
  bills.forEach(b => {
    s.gross += b.subtotal || 0
    s.sc += b.service_charge_amt || 0
    s.disc += b.discount_amt || 0
    s.grand += b.final_amount || 0
    if (b.isComp) { s.compCount++; s.compValue += b.compValue; s.compSub += b.compSub }
    if (b.isPending) { s.pendingCount++; s.pendingAmt += b.final_amount || 0 }
    if (b.split_payment && !b.isComp && !b.isPending) s.splitCount++
    const ep = getEffectivePayment(b)
    s.cash += ep.cash; s.upi += ep.upi; s.card += ep.card
    if (ep.cash > 0) s.cashCount++
    if (ep.upi > 0) s.upiCount++
    if (ep.card > 0) s.cardCount++
  })
  s.collected = s.cash + s.upi + s.card
  s.paidCount = s.count - s.compCount
  return s
}

const MODE_STYLE = {
  cash:          { label: '💵 Cash',          box: 'bg-green-50 border-green-200',   text: 'text-green-600',  ring: 'ring-2 ring-green-500' },
  upi:           { label: '📱 UPI',           box: 'bg-blue-50 border-blue-200',     text: 'text-blue-600',   ring: 'ring-2 ring-blue-500' },
  card:          { label: '💳 Card',          box: 'bg-purple-50 border-purple-200', text: 'text-purple-600', ring: 'ring-2 ring-purple-500' },
  complimentary: { label: '🎁 Complimentary', box: 'bg-pink-50 border-pink-200',     text: 'text-pink-600',   ring: 'ring-2 ring-pink-500' },
  pending:       { label: '⏳ Pending',       box: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700', ring: 'ring-2 ring-yellow-500' },
}
const MODE_ORDER = ['cash', 'upi', 'card', 'complimentary', 'pending']

const billMatchesMode = (b, mode) => {
  if (mode === 'complimentary') return b.isComp
  if (mode === 'pending') return b.isPending
  return (getEffectivePayment(b)[mode] || 0) > 0
}

const TABS = [
  { id: 'today',      label: '📅 Today' },
  { id: 'range',      label: '📆 Date Range' },
  { id: 'category',   label: '📊 Category' },
  { id: 'tables',     label: '🪑 Table-wise' },
  { id: 'discounts',  label: '🎁 Discounts' },
  { id: 'settlement', label: '💰 Settlement' },
]

// Group normalised bills by table for the Table-wise tab.
const buildTableGroups = (bills) => {
  const byTable = {}
  bills.forEach(b => {
    if (!byTable[b.table_name_snapshot]) byTable[b.table_name_snapshot] = []
    byTable[b.table_name_snapshot].push(b)
  })
  return Object.entries(byTable).map(([name, list]) => {
    const sorted = [...list].sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at))
    const activatedAt = sorted.reduce((min, b) => (!min || new Date(b.created_at) < new Date(min) ? b.created_at : min), null)
    const paidAt = sorted.reduce((max, b) => (!max || new Date(b.paid_at) > new Date(max) ? b.paid_at : max), null)
    const bills2 = sorted.map((b, idx) => ({ ...b, billSerial: idx + 1, billId: b.ids[0] }))
    return {
      name, activatedAt, paidAt, duration: diffMinutes(activatedAt, paidAt), bills: bills2,
      tableRevenue:  bills2.reduce((s, b) => s + b.final_amount, 0),
      tableSubtotal: bills2.reduce((s, b) => s + b.subtotal, 0),
      tableDiscount: bills2.reduce((s, b) => s + b.discount_amt, 0),
      tableComp:     bills2.reduce((s, b) => s + b.compValue, 0),
      tableSC:       bills2.reduce((s, b) => s + b.service_charge_amt, 0),
      totalItems:    bills2.reduce((s, b) => s + b.items.reduce((x, i) => x + i.qty, 0), 0),
    }
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

// ── small UI pieces (module level so inputs never remount while typing) ──
const PayBadge = ({ bill }) => {
  if (bill.isComp) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-pink-100 text-pink-700">🎁 Complimentary</span>
  if (bill.isPending) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700">⏳ Pending</span>
  if (bill.split_payment) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">🔀 Split</span>
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAY_COLOR[bill.payment_type] || 'bg-gray-100 text-gray-500'}`}>{PAY_LABEL[bill.payment_type] || bill.payment_type || '—'}</span>
}

const SplitStrip = ({ bill }) => {
  if (!bill.split_payment || bill.isComp || bill.isPending) return null
  return (
    <div className="bg-indigo-50 rounded-lg px-3 py-2 mb-2 flex gap-4 flex-wrap">
      {Object.entries(bill.split_payment).filter(([, v]) => v > 0).map(([k, v]) => (
        <span key={k} className="text-xs text-indigo-600 font-medium">{PAY_LABEL[k]}: ₹{inr(v)}</span>
      ))}
    </div>
  )
}

const DateFilter = ({ from, to, onFrom, onTo, onFetch, btnText = 'View' }) => (
  <div className="bg-white rounded-2xl shadow p-5 mb-4">
    <div className="flex gap-3 flex-wrap items-end">
      <div><label className="text-xs text-gray-500 block mb-1">From</label>
        <input type="date" value={from} onChange={e => onFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
      <div><label className="text-xs text-gray-500 block mb-1">To</label>
        <input type="date" value={to} onChange={e => onTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
      <button onClick={onFetch} className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">{btnText}</button>
    </div>
  </div>
)

const Empty = ({ icon, text }) => (
  <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-2">{icon}</div><p>{text}</p></div>
)

const PrintCSVBar = ({ onPrint, onCSV }) => (
  <div className="flex gap-2 mb-4 justify-end print:hidden">
    <button onClick={onPrint} className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600">🖨️ Print Preview</button>
    <button onClick={onCSV}   className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-600">📊 Export CSV</button>
  </div>
)

const PrintModal = ({ show, onClose, title, onPrint, onCSV, children }) => {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="font-bold text-gray-800">🖨️ {title}</h2>
          <div className="flex gap-2">
            <button onClick={onPrint} className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">🖨️ Print</button>
            <button onClick={onCSV}   className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">📊 CSV</button>
            <button onClick={onClose} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 font-mono text-sm">{children}</div>
      </div>
    </div>
  )
}

export default function Reports() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('today')

  // Today
  const [todayLoading, setTodayLoading] = useState(true)
  const [todayBills, setTodayBills] = useState([])
  const [todayStats, setTodayStats] = useState(null)
  const [showTodayOrders, setShowTodayOrders] = useState(false)
  const [showTodayPrint, setShowTodayPrint] = useState(false)

  // Date range
  const [rangeFrom, setRangeFrom] = useState(todayIST())
  const [rangeTo, setRangeTo] = useState(todayIST())
  const [rangeLoading, setRangeLoading] = useState(false)
  const [rangeDataA, setRangeDataA] = useState(null)
  const [rangeDataB, setRangeDataB] = useState(null)
  const [rangeLabelA, setRangeLabelA] = useState('')
  const [rangeLabelB, setRangeLabelB] = useState('')
  const [showRangePrint, setShowRangePrint] = useState(false)

  // Category / item sales
  const [catFrom, setCatFrom] = useState(todayIST())
  const [catTo, setCatTo] = useState(todayIST())
  const [catLoading, setCatLoading] = useState(false)
  const [catData, setCatData] = useState(null)
  const [showCatPrint, setShowCatPrint] = useState(false)
  const [catSearch, setCatSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [catSort, setCatSort] = useState('revenue')
  const [showZero, setShowZero] = useState(false)
  const [catExpanded, setCatExpanded] = useState({})

  // Table-wise
  const [tblFrom, setTblFrom] = useState(todayIST())
  const [tblTo, setTblTo] = useState(todayIST())
  const [tblLoading, setTblLoading] = useState(false)
  const [tblData, setTblData] = useState([])
  const [tblFetched, setTblFetched] = useState(false)
  const [tblExpanded, setTblExpanded] = useState({})
  const [showTblPrint, setShowTblPrint] = useState(false)

  // Discounts + complimentary audit
  const [discFrom, setDiscFrom] = useState(todayIST())
  const [discTo, setDiscTo] = useState(todayIST())
  const [discLoading, setDiscLoading] = useState(false)
  const [discData, setDiscData] = useState(null)
  const [discFetched, setDiscFetched] = useState(false)
  const [showDiscPrint, setShowDiscPrint] = useState(false)

  // Settlement
  const [settlFrom, setSettlFrom] = useState(todayIST())
  const [settlTo, setSettlTo] = useState(todayIST())
  const [settlLoading, setSettlLoading] = useState(true)
  const [settlData, setSettlData] = useState(null)
  const [settlSort, setSettlSort] = useState('time')
  const [settlModes, setSettlModes] = useState([])      // [] = show everything
  const [settlSearch, setSettlSearch] = useState('')
  const [settlExpanded, setSettlExpanded] = useState({})
  const [showSettlPrint, setShowSettlPrint] = useState(false)

  // ── TODAY ────────────────────────────────────────────────────────────
  const computeTodayStats = (bills) => {
    if (!bills.length) { setTodayStats(null); return }
    const s = summarizeBills(bills)
    const discBase = s.gross - s.compSub
    const discPct = discBase > 0 ? ((s.disc / discBase) * 100).toFixed(1) : '0.0'

    const hourMap = {}
    bills.forEach(b => {
      const hr = new Date(b.paid_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })
      hourMap[hr] = (hourMap[hr] || 0) + 1
    })
    const hours = Object.entries(hourMap).sort((a, b) => b[1] - a[1])

    const itemMap = {}; const deptRev = {}
    bills.forEach(b => b.items.forEach(i => {
      itemMap[i.name] = (itemMap[i.name] || 0) + i.qty
      if (!b.isComp) deptRev[i.dept] = (deptRev[i.dept] || 0) + i.amount
    }))
    const topItem = Object.entries(itemMap).sort((a, b) => b[1] - a[1])[0]

    setTodayStats({
      ...s,
      aov: s.paidCount > 0 ? Math.round(s.grand / s.paidCount) : 0,
      discPct, discWarning: parseFloat(discPct) > 10,
      busiestHour: hours[0] ? `${hours[0][0]}:00 (${hours[0][1]} orders)` : '—',
      quietestHour: hours.length > 1 ? `${hours[hours.length - 1][0]}:00 (${hours[hours.length - 1][1]} orders)` : '—',
      topItem: topItem ? `${topItem[0]} (${topItem[1]} sold)` : '—',
      deptRev,
    })
  }

  const fetchToday = async () => {
    setTodayLoading(true)
    const bills = await fetchBills(todayIST(), todayIST())
    setTodayBills(bills)
    computeTodayStats(bills)
    setTodayLoading(false)
  }
  useEffect(() => { fetchToday() }, [])

  // ── DATE RANGE ───────────────────────────────────────────────────────
  const fetchRangePeriod = async (from, to) => {
    const bills = await fetchBills(from, to)
    const s = summarizeBills(bills)
    const itemMap = {}
    bills.forEach(b => b.items.forEach(i => { itemMap[i.name] = (itemMap[i.name] || 0) + i.qty }))
    const top3 = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const dayMap = {}
    bills.forEach(b => {
      const day = new Date(b.paid_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      dayMap[day] = (dayMap[day] || 0) + (b.final_amount || 0)
    })
    const bestDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0]
    return {
      ...s, totalRevenue: s.grand, totalOrders: s.count,
      aov: s.paidCount > 0 ? Math.round(s.grand / s.paidCount) : 0, top3, bestDay,
    }
  }

  const runRangeFetch = async (from, to) => {
    setRangeLoading(true)
    const diffDays = Math.round((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24))
    const prevFrom = addDays(from, -(diffDays + 1)); const prevTo = addDays(from, -1)
    const [a, b] = await Promise.all([fetchRangePeriod(from, to), fetchRangePeriod(prevFrom, prevTo)])
    setRangeDataA(a); setRangeDataB(b)
    setRangeLabelA(`${formatDate(from)} → ${formatDate(to)}`)
    setRangeLabelB(`${formatDate(prevFrom)} → ${formatDate(prevTo)}`)
    setRangeLoading(false)
  }

  const applyRangePreset = (preset) => {
    const today = todayIST(); let from, to
    if (preset === '7d') { from = addDays(today, -6); to = today }
    else if (preset === '30d') { from = addDays(today, -29); to = today }
    else if (preset === 'thisMonth') { const d = new Date(); from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; to = today }
    else {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
      from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
    }
    setRangeFrom(from); setRangeTo(to); runRangeFetch(from, to)
  }
  const rangePct = (a, b) => (b === 0 ? null : (((a - b) / b) * 100).toFixed(1))

  // ── CATEGORY / ITEM SALES ────────────────────────────────────────────
  // Loads EVERY category + subcategory + menu item (same tables the Menu page
  // uses), then overlays the sales for the chosen dates. Items and categories
  // with no sales stay in the data so they can be searched / listed as zero.
  const fetchCategory = async () => {
    setCatLoading(true)
    const [bills, catRes, itemRes] = await Promise.all([
      fetchBills(catFrom, catTo),
      supabase.from('categories').select('*').order('created_at'),
      supabase.from('food_items').select('*'),
    ])
    const allCats = catRes.data || []
    const topCats = allCats.filter(c => !c.is_subcategory)
    const nameById = {}; allCats.forEach(c => { nameById[c.id] = c.name })
    const menuItems = itemRes.data || []

    const itemMap = {}
    menuItems.forEach(fi => {
      itemMap[fi.id] = {
        key: fi.id, id: fi.id, name: fi.name, price: fi.price || 0,
        categoryId: fi.category_id, subcategoryId: fi.subcategory_id,
        dept: resolveDept(fi.department, fi.name), available: fi.is_available !== false, isOpen: false,
        qty: 0, revenue: 0, compQty: 0, compValue: 0, billCount: 0,
      }
    })
    bills.forEach(b => {
      const seen = new Set()
      b.items.forEach(l => {
        const k = l.foodItemId || `open:${l.name}`
        if (!itemMap[k]) {
          itemMap[k] = {
            key: k, id: l.foodItemId, name: l.name, price: l.rate,
            categoryId: l.categoryId, subcategoryId: l.subcategoryId, dept: l.dept,
            available: false, isOpen: l.isOpen,
            qty: 0, revenue: 0, compQty: 0, compValue: 0, billCount: 0,
          }
        }
        const it = itemMap[k]
        it.qty += l.qty
        if (b.isComp) { it.compQty += l.qty; it.compValue += l.amount } else { it.revenue += l.amount }
        if (!seen.has(k)) { seen.add(k); it.billCount += 1 }
      })
    })

    const items = Object.values(itemMap).map(it => ({
      ...it,
      categoryName: it.isOpen ? 'Open Items' : (nameById[it.categoryId] || 'Uncategorized'),
      subName: it.subcategoryId ? (nameById[it.subcategoryId] || '') : '',
    }))

    // Category groups in the same order as the Menu page, then extras.
    const groups = topCats.map(c => ({ id: c.id, name: c.name, items: [] }))
    const byName = {}; groups.forEach(g => { byName[g.name] = g })
    items.forEach(it => {
      if (!byName[it.categoryName]) {
        const g = { id: null, name: it.categoryName, items: [] }
        groups.push(g); byName[it.categoryName] = g
      }
      byName[it.categoryName].items.push(it)
    })
    const catStats = groups.map(g => {
      const sold = g.items.filter(i => i.qty > 0)
      const top = [...sold].sort((a, b) => b.qty - a.qty)[0]
      return {
        ...g,
        items: [...g.items].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name)),
        qty: g.items.reduce((s, i) => s + i.qty, 0),
        revenue: g.items.reduce((s, i) => s + i.revenue, 0),
        compQty: g.items.reduce((s, i) => s + i.compQty, 0),
        menuCount: g.items.filter(i => !i.isOpen).length,
        soldCount: sold.length,
        topItem: top ? [top.name, top.qty] : null,
      }
    }).sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)

    const deptStats = {}
    items.forEach(it => {
      if (!deptStats[it.dept]) deptStats[it.dept] = { qty: 0, revenue: 0, menuCount: 0 }
      deptStats[it.dept].qty += it.qty
      deptStats[it.dept].revenue += it.revenue
      if (!it.isOpen) deptStats[it.dept].menuCount += 1
    })
    const deptList = DEPT_ORDER.filter(d => deptStats[d] && (deptStats[d].revenue > 0 || deptStats[d].qty > 0 || deptStats[d].menuCount > 0))

    const zeroItems = items.filter(i => i.qty === 0 && i.available && !i.isOpen)
    const zeroGroups = catStats
      .map(g => ({ name: g.name, items: g.items.filter(i => i.qty === 0 && i.available && !i.isOpen) }))
      .filter(g => g.items.length > 0)

    const topItems = items.filter(i => i.qty > 0)
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty).slice(0, 5)

    setCatData({
      items, catStats, deptStats, deptList, zeroItems, zeroGroups, topItems,
      totalRevenue: items.reduce((s, i) => s + i.revenue, 0),
      totalQty: items.reduce((s, i) => s + i.qty, 0),
      compQty: items.reduce((s, i) => s + i.compQty, 0),
      compValue: items.reduce((s, i) => s + i.compValue, 0),
    })
    setCatLoading(false)
  }

  // Item list shown under "Item-wise Sales": search + category filter + sort.
  // Items with no sales appear ONLY when you search (so you can check one item).
  const getCatItems = () => {
    if (!catData) return []
    const q = catSearch.trim().toLowerCase()
    let list = catData.items
    if (catFilter !== 'all') list = list.filter(i => i.categoryName === catFilter)
    if (q) list = list.filter(i => i.name.toLowerCase().includes(q) || i.categoryName.toLowerCase().includes(q) || i.subName.toLowerCase().includes(q))
    else list = list.filter(i => i.qty > 0)
    const sorted = [...list]
    if (catSort === 'qty') sorted.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    else if (catSort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else sorted.sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)
    return sorted
  }

  // ── TABLE-WISE ───────────────────────────────────────────────────────
  const fetchTablewise = useCallback(async () => {
    setTblLoading(true)
    const bills = await fetchBills(tblFrom, tblTo)
    const grp = buildTableGroups(bills)
    setTblData(grp); setTblFetched(true)
    const exp = {}; grp.forEach(t => { exp[t.name] = true }); setTblExpanded(exp)
    setTblLoading(false)
  }, [tblFrom, tblTo])

  const tblSummary = tblData.reduce((s, t) => ({
    revenue: s.revenue + t.tableRevenue, sc: s.sc + t.tableSC,
    discount: s.discount + t.tableDiscount, comp: s.comp + t.tableComp,
    bills: s.bills + t.bills.length, tables: s.tables + 1,
  }), { revenue: 0, sc: 0, discount: 0, comp: 0, bills: 0, tables: 0 })

  // ── DISCOUNTS + COMPLIMENTARY ────────────────────────────────────────
  const fetchDiscounts = async () => {
    setDiscLoading(true)
    const bills = await fetchBills(discFrom, discTo)
    const discBills = bills.filter(b => b.discount_amt > 0)
    const compBills = bills.filter(b => b.isComp)
    setDiscFetched(true)
    if (!discBills.length && !compBills.length) { setDiscData(null); setDiscLoading(false); return }

    const totalDiscount = discBills.reduce((s, b) => s + b.discount_amt, 0)
    const grossRevenue = discBills.reduce((s, b) => s + b.subtotal, 0)
    const avgDiscount = discBills.length > 0 ? Math.round(totalDiscount / discBills.length) : 0
    const discPct = grossRevenue > 0 ? ((totalDiscount / grossRevenue) * 100).toFixed(1) : '0.0'
    const dayMap = {}
    discBills.forEach(b => {
      const day = new Date(b.paid_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' })
      dayMap[day] = (dayMap[day] || 0) + b.discount_amt
    })
    const topDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0]
    const largest = discBills.length ? discBills.reduce((m, b) => (b.discount_amt > m.discount_amt ? b : m), discBills[0]) : null
    const reasonMap = {}
    discBills.forEach(b => {
      const r = b.discount_reason?.trim() || 'No reason given'
      if (!reasonMap[r]) reasonMap[r] = { reason: r, count: 0, total: 0 }
      reasonMap[r].count += 1; reasonMap[r].total += b.discount_amt
    })
    const flagged = discBills.map(b => {
      const truePct = b.subtotal > 0 ? (b.discount_amt / b.subtotal) * 100 : 0
      return { ...b, truePct, flag: truePct >= 40 ? 'red' : truePct >= 20 ? 'yellow' : null }
    })
    setDiscData({
      bills: flagged, compBills,
      compValue: compBills.reduce((s, b) => s + b.compValue, 0),
      totalDiscount, grossRevenue, avgDiscount, discPct, topDay, largest,
      reasonBreakdown: Object.values(reasonMap).sort((a, b) => b.total - a.total),
      redFlags: flagged.filter(b => b.flag === 'red').length,
      yellowFlags: flagged.filter(b => b.flag === 'yellow').length,
    })
    setDiscLoading(false)
  }

  // ── SETTLEMENT ───────────────────────────────────────────────────────
  const fetchSettlement = async () => {
    setSettlLoading(true)
    const bills = await fetchBills(settlFrom, settlTo)
    if (!bills.length) { setSettlData(null); setSettlLoading(false); return }
    setSettlData({ bills, sum: summarizeBills(bills) })
    setSettlLoading(false)
  }
  useEffect(() => { fetchSettlement() }, [])

  const toggleSettlMode = (m) =>
    setSettlModes(prev => (prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]))

  const getSettlVisible = () => {
    if (!settlData) return []
    let list = settlData.bills
    if (settlModes.length) list = list.filter(b => settlModes.some(m => billMatchesMode(b, m)))
    const q = settlSearch.trim().toLowerCase()
    if (q) {
      list = list.filter(b =>
        b.table_name_snapshot.toLowerCase().includes(q) ||
        String(b.final_amount).includes(q) ||
        (b.comp_reason || '').toLowerCase().includes(q) ||
        b.items.some(i => i.name.toLowerCase().includes(q)))
    }
    const l = [...list]
    if (settlSort === 'amount')  return l.sort((a, c) => c.final_amount - a.final_amount)
    if (settlSort === 'table')   return l.sort((a, c) => a.table_name_snapshot.localeCompare(c.table_name_snapshot, undefined, { numeric: true }))
    if (settlSort === 'payment') return l.sort((a, c) => payText(a).localeCompare(payText(c)))
    return l.sort((a, c) => new Date(c.paid_at) - new Date(a.paid_at))
  }
  const settlVisible = getSettlVisible()
  const settlFiltered = settlModes.length > 0 || settlSearch.trim() !== ''

  // Amount per selected mode, counted over the bills currently visible
  const settlSelectedAmounts = settlModes.map(m => {
    let amt = 0
    settlVisible.forEach(b => {
      if (m === 'complimentary') amt += b.isComp ? b.compValue : 0
      else if (m === 'pending') amt += b.isPending ? b.final_amount : 0
      else amt += getEffectivePayment(b)[m] || 0
    })
    return [m, amt]
  })

  // Open a tab → load its data the first time
  useEffect(() => {
    if (activeTab === 'range' && !rangeDataA && !rangeLoading) runRangeFetch(rangeFrom, rangeTo)
    if (activeTab === 'category' && !catData && !catLoading) fetchCategory()
    if (activeTab === 'tables' && !tblFetched && !tblLoading) fetchTablewise()
    if (activeTab === 'discounts' && !discFetched && !discLoading) fetchDiscounts()
  }, [activeTab])

  // ── CSV EXPORTS ──────────────────────────────────────────────────────
  const itemsText = (b) => b.items.map(i => `${i.name} x${i.qty}${i.isOpen ? ' (open)' : ''}`).join(' | ')

  const exportTodayCSV = () => {
    if (!todayBills.length) return
    const s = todayStats
    const rows = [
      ['TODAY SALES REPORT', formatDate(new Date())], [],
      ['SUMMARY'],
      ['Grand Total', `Rs.${r2(s.grand)}`], ['Collected (Cash+UPI+Card)', `Rs.${r2(s.collected)}`],
      ['Total Bills', s.count], ['Avg Order Value (paid bills)', `Rs.${s.aov}`],
      ['Cash', `Rs.${r2(s.cash)}`], ['UPI', `Rs.${r2(s.upi)}`], ['Card', `Rs.${r2(s.card)}`],
      ['Pending (not settled)', `Rs.${r2(s.pendingAmt)}`, `${s.pendingCount} bill(s)`],
      ['Complimentary', `Rs.${r2(s.compValue)}`, `${s.compCount} bill(s)`],
      ...DEPT_ORDER.filter(d => s.deptRev[d]).map(d => [`${d} Revenue`, `Rs.${r2(s.deptRev[d])}`]),
      ['Service Charge', `Rs.${r2(s.sc)}`], ['Discounts', `-Rs.${r2(s.disc)} (${s.discPct}%)`],
      ['Top Item', s.topItem], ['Busiest Hour', s.busiestHour], [],
      ['BILL DETAILS'],
      ['Table', 'Date', 'Time', 'Payment', 'Subtotal', 'SC', 'Discount', 'Complimentary', 'Final', 'Items'],
    ]
    todayBills.forEach(b => rows.push([
      b.table_name_snapshot, formatDate(b.paid_at), toIST(b.paid_at), payText(b),
      b.subtotal, b.service_charge_amt, b.discount_amt, b.compValue, b.final_amount, itemsText(b),
    ]))
    downloadCSV(rows, `Today_Sales_${todayIST()}.csv`)
  }

  const exportRangeCSV = () => {
    if (!rangeDataA) return
    const A = rangeDataA, B = rangeDataB || {}
    const rows = [
      ['DATE RANGE COMPARISON REPORT'], ['Period A (This)', rangeLabelA], ['Period B (Previous)', rangeLabelB], [],
      ['Metric', 'This Period', 'Previous Period', '% Change'],
      ['Grand Total', `Rs.${r2(A.totalRevenue)}`, `Rs.${r2(B.totalRevenue)}`, (rangePct(A.totalRevenue, B.totalRevenue || 0) || '—') + '%'],
      ['Total Orders', A.totalOrders, B.totalOrders || 0, ''],
      ['Avg Order Value', `Rs.${A.aov}`, `Rs.${B.aov || 0}`, ''],
      ['Cash', `Rs.${r2(A.cash)}`, `Rs.${r2(B.cash)}`, ''],
      ['UPI', `Rs.${r2(A.upi)}`, `Rs.${r2(B.upi)}`, ''],
      ['Card', `Rs.${r2(A.card)}`, `Rs.${r2(B.card)}`, ''],
      ['Pending', `Rs.${r2(A.pendingAmt)}`, `Rs.${r2(B.pendingAmt)}`, ''],
      ['Complimentary', `Rs.${r2(A.compValue)}`, `Rs.${r2(B.compValue)}`, ''], [],
      ['TOP ITEMS (THIS PERIOD)'], ['Rank', 'Item', 'Qty Sold'],
      ...A.top3.map(([name, qty], i) => [i + 1, name, qty]),
      [], ['TOP ITEMS (PREVIOUS PERIOD)'], ['Rank', 'Item', 'Qty Sold'],
      ...(B.top3 || []).map(([name, qty], i) => [i + 1, name, qty]),
    ]
    downloadCSV(rows, `DateRange_${rangeFrom}_to_${rangeTo}.csv`)
  }

  const exportCatCSV = () => {
    if (!catData) return
    const total = catData.totalRevenue
    const rows = [
      ['CATEGORY & ITEM SALES REPORT'], ['Period', `${formatDate(catFrom)} to ${formatDate(catTo)}`], [],
      ['OVERVIEW'], ['Item Revenue (before bill discount / SC)', `Rs.${r2(total)}`], ['Items Sold', catData.totalQty],
      ['Complimentary Items', catData.compQty, `Rs.${r2(catData.compValue)}`], [],
      ['BY DEPARTMENT'], ['Department', 'Items Sold', 'Revenue', '% of Total'],
      ...catData.deptList.map(d => [d, catData.deptStats[d].qty, `Rs.${r2(catData.deptStats[d].revenue)}`, pctOf(catData.deptStats[d].revenue, total) + '%']), [],
      ['CATEGORY BREAKDOWN (ALL MENU CATEGORIES)'], ['Category', 'Items Sold', 'Revenue', '% of Total', 'Top Item'],
      ...catData.catStats.map(c => [c.name, c.qty, `Rs.${r2(c.revenue)}`, pctOf(c.revenue, total) + '%', c.topItem ? `${c.topItem[0]} (${c.topItem[1]} sold)` : '—']), [],
      ['ITEM-WISE SALES'], ['Item', 'Category', 'Subcategory', 'Department', 'Qty Sold', 'Revenue', 'Complimentary Qty', 'In Bills'],
      ...catData.items.filter(i => i.qty > 0).sort((a, b) => b.revenue - a.revenue)
        .map(i => [i.name, i.categoryName, i.subName, i.dept, i.qty, `Rs.${r2(i.revenue)}`, i.compQty, i.billCount]),
    ]
    if (catData.zeroItems.length > 0) {
      rows.push([], ['ZERO SALES ITEMS'], ['Item', 'Category'])
      catData.zeroItems.forEach(i => rows.push([i.name, i.categoryName]))
    }
    downloadCSV(rows, `Category_${catFrom}_to_${catTo}.csv`)
  }

  const exportTblCSV = () => {
    const rows = [['TABLE-WISE SALES REPORT'], ['Period', `${formatDate(tblFrom)} to ${formatDate(tblTo)}`], [],
      ['SUMMARY'], ['Total Tables', tblSummary.tables], ['Total Bills', tblSummary.bills],
      ['Net Revenue', `Rs.${r2(tblSummary.revenue)}`], ['Service Charge', `Rs.${r2(tblSummary.sc)}`],
      ['Discounts', `-Rs.${r2(tblSummary.discount)}`], ['Complimentary', `Rs.${r2(tblSummary.comp)}`], [],
      ['DETAILED BILL DATA'],
    ]
    tblData.forEach(tbl => {
      rows.push([]); rows.push([`TABLE: ${tbl.name}`, `Total: Rs.${r2(tbl.tableRevenue)}`, `${tbl.bills.length} bill(s)`, `Duration: ${formatDuration(tbl.duration)}`])
      tbl.bills.forEach(bill => {
        rows.push([`Bill #${bill.billSerial}`, payText(bill), toIST(bill.paid_at), `Rs.${r2(bill.final_amount)}`])
        rows.push(['Sr', 'Item', 'Dept', 'Qty', 'Rate', 'Amount'])
        bill.items.forEach((item, i) => rows.push([i + 1, item.name, item.dept, item.qty, `Rs.${item.rate}`, `Rs.${item.amount}`]))
        rows.push(['', 'Subtotal', '', '', '', `Rs.${r2(bill.subtotal)}`])
        if (bill.service_charge_amt > 0) rows.push(['', `Service (${bill.service_charge_pct}%)`, '', '', '', `Rs.${r2(bill.service_charge_amt)}`])
        if (bill.discount_amt > 0) rows.push(['', 'Discount', '', '', '', `-Rs.${r2(bill.discount_amt)}`])
        if (bill.isComp) rows.push(['', `Complimentary${bill.comp_reason ? ': ' + bill.comp_reason : ''}`, '', '', '', `-Rs.${r2(bill.compValue)}`])
        rows.push(['', 'BILL TOTAL', '', '', '', `Rs.${r2(bill.final_amount)}`])
      })
    })
    downloadCSV(rows, `TableWise_${tblFrom}_to_${tblTo}.csv`)
  }

  const exportDiscCSV = () => {
    if (!discData) return
    const rows = [
      ['DISCOUNT & COMPLIMENTARY AUDIT'], ['Period', `${formatDate(discFrom)} to ${formatDate(discTo)}`], [],
      ['SUMMARY'], ['Total Discounts Given', `-Rs.${r2(discData.totalDiscount)}`], ['Discount % of Revenue', discData.discPct + '%'],
      ['Bills with Discounts', discData.bills.length], ['Avg Discount per Bill', `Rs.${discData.avgDiscount}`],
      ['Red Flags (>40%)', discData.redFlags], ['Yellow Flags (20-40%)', discData.yellowFlags],
      ['Most Discounts Day', discData.topDay?.[0] || '—', `Rs.${discData.topDay?.[1] || 0}`],
      ['Largest Single Discount', `Rs.${discData.largest?.discount_amt || 0}`, discData.largest?.table_name_snapshot || ''],
      ['Complimentary Bills', discData.compBills.length, `Rs.${r2(discData.compValue)}`], [],
      ['DISCOUNT BY REASON'], ['Reason', 'No. of Bills', 'Total Discounted'],
      ...discData.reasonBreakdown.map(r => [r.reason, r.count, `Rs.${r2(r.total)}`]), [],
      ['ALL DISCOUNTED BILLS'], ['Table', 'Date', 'Time', 'Subtotal', 'Discount', 'Disc%', 'Final Amount', 'Payment', 'Reason', 'Flag'],
    ]
    discData.bills.forEach(b => rows.push([
      b.table_name_snapshot, formatDate(b.paid_at), toIST(b.paid_at),
      `Rs.${r2(b.subtotal)}`, `-Rs.${r2(b.discount_amt)}`, b.truePct.toFixed(1) + '%', `Rs.${r2(b.final_amount)}`,
      payText(b), b.discount_reason || 'No reason', b.flag === 'red' ? 'Red Flag' : b.flag === 'yellow' ? 'Yellow Flag' : 'OK',
    ]))
    rows.push([], ['COMPLIMENTARY BILLS'], ['Table', 'Date', 'Time', 'Value Given Free', 'Reason', 'Items'])
    discData.compBills.forEach(b => rows.push([
      b.table_name_snapshot, formatDate(b.paid_at), toIST(b.paid_at), `Rs.${r2(b.compValue)}`, b.comp_reason || 'No reason', itemsText(b),
    ]))
    downloadCSV(rows, `Discounts_${discFrom}_to_${discTo}.csv`)
  }

  const exportSettlCSV = () => {
    if (!settlData) return
    const s = settlData.sum
    const rows = [
      ['SETTLEMENT REPORT'], ['Period', `${formatDate(settlFrom)} to ${formatDate(settlTo)}`],
      ['Printed', `${formatDate(new Date())} ${toIST(new Date().toISOString())}`],
      ['Filter', settlModes.length ? settlModes.map(m => MODE_STYLE[m].label).join(', ') : 'All', settlSearch ? `Search: ${settlSearch}` : ''], [],
      ['PAYMENT SUMMARY (ALL BILLS IN PERIOD)'], ['Mode', 'Amount', 'Bills'],
      ['Cash', `Rs.${r2(s.cash)}`, s.cashCount], ['UPI', `Rs.${r2(s.upi)}`, s.upiCount], ['Card', `Rs.${r2(s.card)}`, s.cardCount],
      ['Complimentary (given free)', `Rs.${r2(s.compValue)}`, s.compCount],
      ['Pending (not settled)', `Rs.${r2(s.pendingAmt)}`, s.pendingCount],
      ['Split bills', s.splitCount, ''],
      ['GRAND TOTAL', `Rs.${r2(s.grand)}`, `${s.count} bills`], [],
      ['REVENUE BREAKDOWN'],
      ['Gross Revenue', `Rs.${r2(s.gross)}`], ['+ Service Charge', `Rs.${r2(s.sc)}`],
      ['- Discounts', `-Rs.${r2(s.disc)}`], ['- Complimentary', `-Rs.${r2(s.compValue)}`],
      ['Net', `Rs.${r2(s.grand)}`], [],
      [settlFiltered ? `TRANSACTIONS (FILTERED: ${settlVisible.length} of ${s.count})` : 'ALL TRANSACTIONS'],
      ['Date', 'Time', 'Table', 'Status', 'Cash', 'UPI', 'Card', 'Subtotal', 'SC', 'Discount', 'Complimentary', 'Final Amount', 'Comp Reason'],
    ]
    settlVisible.forEach(b => {
      const ep = getEffectivePayment(b)
      rows.push([
        formatDate(b.paid_at), toIST(b.paid_at), b.table_name_snapshot,
        b.isComp ? 'COMPLIMENTARY' : b.isPending ? 'PENDING' : b.split_payment ? 'SPLIT' : (b.payment_type || '—').toUpperCase(),
        ep.cash > 0 ? `Rs.${r2(ep.cash)}` : '—', ep.upi > 0 ? `Rs.${r2(ep.upi)}` : '—', ep.card > 0 ? `Rs.${r2(ep.card)}` : '—',
        `Rs.${r2(b.subtotal)}`, b.service_charge_amt > 0 ? `Rs.${r2(b.service_charge_amt)}` : '—',
        b.discount_amt > 0 ? `-Rs.${r2(b.discount_amt)}` : '—', b.isComp ? `Rs.${r2(b.compValue)}` : '—',
        `Rs.${r2(b.final_amount)}`, b.comp_reason || '',
      ])
    })
    downloadCSV(rows, `Settlement_${settlFrom}_to_${settlTo}.csv`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <button onClick={() => navigate('/admin/admin-code')} className="text-left">
            <h1 className="text-lg font-bold text-orange-500">Reports</h1>
          </button>
        </div>
        <button onClick={() => navigate('/admin/dashboard')}
          className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">← Dashboard</button>
      </div>

      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 print:hidden">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap transition flex-shrink-0
                ${activeTab === tab.id ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border hover:bg-orange-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══════════ TODAY TAB ═══════════ */}
        {activeTab === 'today' && (
          <div>
            <PrintModal show={showTodayPrint} title="Today's Sales Report"
              onClose={() => setShowTodayPrint(false)} onPrint={() => window.print()} onCSV={exportTodayCSV}>
              <div className="text-center mb-4 border-b pb-3">
                <p className="font-bold text-lg">HOTEL KHALASI SEAFOOD & BAR</p>
                <p>TODAY'S SALES SUMMARY — {formatDate(new Date())}</p>
              </div>
              {todayStats && <>
                <div className="flex justify-between font-bold text-lg border-b pb-2 mb-2"><span>GRAND TOTAL</span><span>Rs.{inr(todayStats.grand)}</span></div>
                <div className="flex justify-between mb-1"><span>Total Bills</span><span>{todayStats.count}</span></div>
                <div className="flex justify-between mb-3"><span>Avg Order Value</span><span>Rs.{inr(todayStats.aov)}</span></div>
                <p className="font-bold mb-1 border-t pt-2">Payment Split</p>
                <div className="flex justify-between"><span>💵 Cash (incl. split)</span><span>Rs.{inr(todayStats.cash)}</span></div>
                <div className="flex justify-between"><span>📱 UPI (incl. split)</span><span>Rs.{inr(todayStats.upi)}</span></div>
                <div className="flex justify-between"><span>💳 Card (incl. split)</span><span>Rs.{inr(todayStats.card)}</span></div>
                <div className="flex justify-between"><span>⏳ Pending ({todayStats.pendingCount})</span><span>Rs.{inr(todayStats.pendingAmt)}</span></div>
                <div className="flex justify-between mb-3"><span>🎁 Complimentary ({todayStats.compCount})</span><span>Rs.{inr(todayStats.compValue)}</span></div>
                <p className="font-bold mb-1 border-t pt-2">By Department</p>
                {DEPT_ORDER.filter(d => todayStats.deptRev[d]).map(d => (
                  <div key={d} className="flex justify-between"><span>{deptStyle(d).icon} {d}</span><span>Rs.{inr(todayStats.deptRev[d])}</span></div>
                ))}
                <p className="font-bold mb-1 border-t pt-2 mt-3">Charges</p>
                <div className="flex justify-between"><span>Service Charge</span><span>Rs.{inr(todayStats.sc)}</span></div>
                <div className="flex justify-between mb-3"><span>Discounts</span><span>-Rs.{inr(todayStats.disc)} ({todayStats.discPct}%)</span></div>
                <p className="font-bold mb-2 border-t pt-2">Bills ({todayBills.length})</p>
                {todayBills.map((b, i) => (
                  <div key={i} className="border-b pb-2 mb-2 text-xs">
                    <div className="flex justify-between font-medium">
                      <span>{b.table_name_snapshot} · {formatDate(b.paid_at)} {toIST(b.paid_at)}</span>
                      <span>Rs.{inr(b.final_amount)}</span>
                    </div>
                    <div className="text-gray-400 ml-2">{payText(b)}{b.isComp && b.comp_reason ? ` — ${b.comp_reason}` : ''}</div>
                    {b.items.map((item, j) => (
                      <div key={j} className="flex justify-between text-gray-500 ml-2">
                        <span>{item.name} × {item.qty}{item.isOpen ? ' (open)' : ''}</span><span>Rs.{inr(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </>}
            </PrintModal>

            {todayLoading && <div className="text-center py-16 text-gray-400">Loading...</div>}
            {!todayLoading && !todayStats && <Empty icon="📭" text="No orders today yet." />}
            {!todayLoading && todayStats && (
              <>
                <div className="flex gap-2 mb-4 justify-between items-center print:hidden">
                  <h2 className="text-lg font-bold text-gray-700">📅 {formatDate(new Date())}</h2>
                  <div className="flex gap-2">
                    <button onClick={fetchToday} className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium">🔄 Refresh</button>
                    <button onClick={() => setShowTodayPrint(true)} className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium">🖨️ Print</button>
                    <button onClick={exportTodayCSV} className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium">📊 CSV</button>
                  </div>
                </div>
                {todayStats.discWarning && (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-center gap-3">
                    <span className="text-2xl">⚠️</span>
                    <div><p className="font-bold text-red-600">High Discount Alert</p><p className="text-sm text-red-500">Discounts are {todayStats.discPct}% of sales — above 10%</p></div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-orange-500 rounded-2xl p-4 text-white text-center shadow"><p className="text-xs opacity-80 mb-1">Revenue</p><p className="text-2xl font-bold">₹{inr(todayStats.grand)}</p></div>
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 text-center shadow"><p className="text-xs text-gray-500 mb-1">Bills</p><p className="text-2xl font-bold text-gray-800">{todayStats.count}</p></div>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center shadow"><p className="text-xs text-gray-500 mb-1">Avg/Bill</p><p className="text-2xl font-bold text-blue-600">₹{inr(todayStats.aov)}</p></div>
                </div>

                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <h3 className="font-bold text-gray-700 mb-1">💳 Payment Split</h3>
                  <p className="text-xs text-gray-400 mb-3">Split payments are counted per method. Open the Settlement tab to filter bills by method.</p>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {['cash', 'upi', 'card'].map(m => (
                      <div key={m} className={`${MODE_STYLE[m].box} border rounded-xl p-3 text-center`}>
                        <p className="text-xs text-gray-500">{MODE_STYLE[m].label}</p>
                        <p className={`text-xl font-bold ${MODE_STYLE[m].text}`}>₹{inr(todayStats[m])}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className={`${MODE_STYLE.pending.box} border rounded-xl p-3 text-center`}>
                      <p className="text-xs text-gray-500">⏳ Pending settlement</p>
                      <p className={`text-lg font-bold ${MODE_STYLE.pending.text}`}>₹{inr(todayStats.pendingAmt)}</p>
                      <p className="text-xs text-gray-400">{todayStats.pendingCount} bill{todayStats.pendingCount !== 1 ? 's' : ''}</p>
                    </div>
                    <div className={`${MODE_STYLE.complimentary.box} border rounded-xl p-3 text-center`}>
                      <p className="text-xs text-gray-500">🎁 Complimentary</p>
                      <p className={`text-lg font-bold ${MODE_STYLE.complimentary.text}`}>₹{inr(todayStats.compValue)}</p>
                      <p className="text-xs text-gray-400">{todayStats.compCount} bill{todayStats.compCount !== 1 ? 's' : ''} given free</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {DEPT_ORDER.filter(d => todayStats.deptRev[d]).map(d => {
                    const tot = Object.values(todayStats.deptRev).reduce((a, b) => a + b, 0)
                    return (
                      <div key={d} className={`border rounded-2xl p-4 ${deptStyle(d).card}`}>
                        <p className="text-xs text-gray-500 mb-1">{deptStyle(d).icon} {d}</p>
                        <p className={`text-2xl font-bold ${deptStyle(d).text}`}>₹{inr(todayStats.deptRev[d])}</p>
                        <p className="text-xs text-gray-400">{pctOf(todayStats.deptRev[d], tot)}%</p>
                      </div>
                    )
                  })}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-white border border-gray-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Service Charge</p>
                    <p className="text-xl font-bold text-gray-700">₹{inr(todayStats.sc)}</p>
                  </div>
                  <div className={`border rounded-2xl p-4 ${todayStats.discWarning ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">Discounts {todayStats.discWarning ? '⚠️' : ''}</p>
                    <p className={`text-xl font-bold ${todayStats.discWarning ? 'text-red-600' : 'text-gray-700'}`}>-₹{inr(todayStats.disc)}</p>
                    <p className="text-xs text-gray-400">{todayStats.discPct}% of sales (complimentary not included)</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">🏆 Top Item</p>
                    <p className="text-sm font-bold text-orange-600 leading-tight">{todayStats.topItem}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">⏰ Busiest Hour</p>
                    <p className="text-sm font-bold text-gray-700">{todayStats.busiestHour}</p>
                    <p className="text-xs text-gray-400 mt-1">Quiet: {todayStats.quietestHour}</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow">
                  <button onClick={() => setShowTodayOrders(!showTodayOrders)} className="w-full p-5 flex justify-between items-center">
                    <h3 className="font-bold text-gray-700">All Bills ({todayBills.length})</h3>
                    <span className="text-gray-400">{showTodayOrders ? '▲' : '▼'}</span>
                  </button>
                  {showTodayOrders && (
                    <div className="px-5 pb-5 space-y-3 border-t pt-4">
                      {todayBills.map((bill, i) => (
                        <div key={i} className={`border rounded-xl p-3 ${bill.isComp ? 'border-pink-200 bg-pink-50' : 'border-gray-100'}`}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="font-semibold text-gray-700">{bill.table_name_snapshot}</p>
                              <p className="text-xs text-gray-400">{formatDate(bill.paid_at)} · {toIST(bill.paid_at)}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-orange-500">₹{inr(bill.final_amount)}</p>
                              <PayBadge bill={bill} />
                            </div>
                          </div>
                          <SplitStrip bill={bill} />
                          {bill.isComp && (
                            <p className="text-xs text-pink-700 mb-2">🎁 ₹{inr(bill.compValue)} given free{bill.comp_reason ? ` — ${bill.comp_reason}` : ''}</p>
                          )}
                          <div className="space-y-0.5">
                            {bill.items.map((item, j) => (
                              <div key={j} className={`flex justify-between text-xs ${item.isOpen ? 'text-purple-500' : 'text-gray-500'}`}>
                                <span>{deptStyle(item.dept).icon} {item.name} × {item.qty}{item.isOpen && <span className="opacity-60"> (open)</span>}</span>
                                <span>₹{inr(item.amount)}</span>
                              </div>
                            ))}
                          </div>
                          {(bill.service_charge_amt > 0 || bill.discount_amt > 0) && (
                            <div className="border-t mt-2 pt-1 space-y-0.5">
                              {bill.service_charge_amt > 0 && <div className="flex justify-between text-xs text-gray-400"><span>Service Charge</span><span>+₹{inr(bill.service_charge_amt)}</span></div>}
                              {bill.discount_amt > 0 && <div className="flex justify-between text-xs text-green-600"><span>Discount</span><span>-₹{inr(bill.discount_amt)}</span></div>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════ DATE RANGE TAB ═══════════ */}
        {activeTab === 'range' && (
          <div>
            <PrintModal show={showRangePrint} title="Date Range Comparison Report"
              onClose={() => setShowRangePrint(false)} onPrint={() => window.print()} onCSV={exportRangeCSV}>
              <div className="text-center mb-4 border-b pb-2">
                <p className="font-bold">HOTEL KHALASI — DATE RANGE COMPARISON</p>
                <p className="text-xs text-gray-500">{rangeLabelA} vs {rangeLabelB}</p>
              </div>
              {rangeDataA && [
                ['Grand Total', rangeDataA.totalRevenue, rangeDataB?.totalRevenue],
                ['Total Bills', rangeDataA.totalOrders, rangeDataB?.totalOrders],
                ['Avg Bill Value', rangeDataA.aov, rangeDataB?.aov],
                ['Cash', rangeDataA.cash, rangeDataB?.cash],
                ['UPI', rangeDataA.upi, rangeDataB?.upi],
                ['Card', rangeDataA.card, rangeDataB?.card],
                ['Pending', rangeDataA.pendingAmt, rangeDataB?.pendingAmt],
                ['Complimentary', rangeDataA.compValue, rangeDataB?.compValue],
              ].map(([label, a, b]) => (
                <div key={label} className="flex justify-between border-b py-1"><span>{label}</span><span className="font-bold">Rs.{inr(a)} <span className="text-gray-400 text-xs">(prev Rs.{inr(b)})</span></span></div>
              ))}
            </PrintModal>
            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <div className="flex gap-2 flex-wrap mb-4">
                {[['7d', 'Last 7 Days'], ['30d', 'Last 30 Days'], ['thisMonth', 'This Month'], ['lastMonth', 'Last Month']].map(([k, l]) => (
                  <button key={k} onClick={() => applyRangePreset(k)} className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">{l}</button>
                ))}
              </div>
              <div className="flex gap-3 flex-wrap items-end">
                <div><label className="text-xs text-gray-500 block mb-1">From</label><input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
                <div><label className="text-xs text-gray-500 block mb-1">To</label><input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
                <button onClick={() => runRangeFetch(rangeFrom, rangeTo)} className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">Compare</button>
              </div>
            </div>
            {rangeLoading && <div className="text-center py-8 text-gray-400">Loading...</div>}
            {!rangeLoading && !rangeDataA && <Empty icon="📆" text="Select a date range and click Compare" />}
            {!rangeLoading && rangeDataA && (
              <>
                <PrintCSVBar onPrint={() => setShowRangePrint(true)} onCSV={exportRangeCSV} />
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center"><p className="text-xs font-bold text-orange-600">📅 This Period</p><p className="text-xs text-gray-500">{rangeLabelA}</p></div>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center"><p className="text-xs font-bold text-gray-600">📅 Previous</p><p className="text-xs text-gray-500">{rangeLabelB}</p></div>
                </div>
                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <h3 className="font-bold text-gray-700 mb-2">Performance vs Previous Period</h3>
                  {[['Grand Total', rangeDataA.totalRevenue, rangeDataB?.totalRevenue || 0, '₹'], ['Total Bills', rangeDataA.totalOrders, rangeDataB?.totalOrders || 0, ''], ['Avg Bill Value', rangeDataA.aov, rangeDataB?.aov || 0, '₹']].map(([label, a, b, prefix]) => {
                    const change = rangePct(a, b)
                    return (
                      <div key={label} className="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">
                        <p className="text-sm text-gray-600">{label}</p>
                        <div className="flex items-center gap-4">
                          <p className="text-xs text-gray-400">{prefix}{inr(b)} prev</p>
                          <div className="text-right min-w-[80px]">
                            <p className="font-bold text-gray-800">{prefix}{inr(a)}</p>
                            {change !== null && <p className={`text-xs font-bold ${parseFloat(change) >= 0 ? 'text-green-600' : 'text-red-500'}`}>{parseFloat(change) >= 0 ? '▲' : '▼'} {Math.abs(change)}%</p>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <h3 className="font-bold text-gray-700 mb-3">Payment Split</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center text-sm">
                    {[['💵 Cash', 'cash', 'text-green-600'], ['📱 UPI', 'upi', 'text-blue-600'], ['💳 Card', 'card', 'text-purple-600'], ['⏳ Pending', 'pendingAmt', 'text-yellow-700'], ['🎁 Complimentary', 'compValue', 'text-pink-600']].map(([label, k, cls]) => (
                      <div key={label} className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs text-gray-500 mb-1">{label}</p>
                        <p className={`font-bold ${cls}`}>₹{inr(rangeDataA[k])}</p>
                        <p className="text-xs text-gray-400">vs ₹{inr(rangeDataB?.[k])}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="font-bold text-gray-700 mb-2 text-sm">🏆 Top Items (This)</p>
                    {rangeDataA.top3.map(([name, qty], i) => <p key={i} className="text-xs text-gray-600">{i + 1}. {name} — {qty} sold</p>)}
                    {rangeDataA.bestDay && <p className="text-xs text-orange-500 mt-2">📈 Best: {formatDate(rangeDataA.bestDay[0])}</p>}
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="font-bold text-gray-700 mb-2 text-sm">🏆 Top Items (Prev)</p>
                    {rangeDataB?.top3.map(([name, qty], i) => <p key={i} className="text-xs text-gray-600">{i + 1}. {name} — {qty} sold</p>)}
                    {rangeDataB?.bestDay && <p className="text-xs text-gray-500 mt-2">📈 Best: {formatDate(rangeDataB.bestDay[0])}</p>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════ CATEGORY & ITEM SALES TAB ═══════════ */}
        {activeTab === 'category' && (() => {
          const items = getCatItems()
          const searching = catSearch.trim() !== ''
          const matchQty = items.reduce((s, i) => s + i.qty, 0)
          const matchRev = items.reduce((s, i) => s + i.revenue, 0)
          const catNames = catData ? catData.catStats.map(c => c.name) : []
          return (
            <div>
              <PrintModal show={showCatPrint} title="Category Sales Report" onClose={() => setShowCatPrint(false)} onPrint={() => window.print()} onCSV={exportCatCSV}>
                <div className="text-center mb-4 border-b pb-2"><p className="font-bold">HOTEL KHALASI — CATEGORY REPORT</p><p className="text-xs text-gray-500">{formatDate(catFrom)} to {formatDate(catTo)}</p></div>
                {catData && <>
                  {catData.deptList.map(d => (
                    <div key={d} className="flex justify-between font-bold border-b pb-1 mb-1"><span>{deptStyle(d).icon} {d}</span><span>Rs.{inr(catData.deptStats[d].revenue)}</span></div>
                  ))}
                  <div className="flex justify-between font-bold border-b pb-2 mb-3 mt-2"><span>TOTAL</span><span>Rs.{inr(catData.totalRevenue)}</span></div>
                  {catData.catStats.map(cat => (<div key={cat.name} className="flex justify-between border-b py-1 text-xs"><span>{cat.name} ({cat.qty} sold)</span><span className="font-bold">Rs.{inr(cat.revenue)}</span></div>))}
                  {catData.zeroItems.length > 0 && <>
                    <p className="font-bold mt-4 mb-1">Zero Sales Items ({catData.zeroItems.length})</p>
                    {catData.zeroGroups.map(g => (
                      <div key={g.name} className="mb-1">
                        <p className="text-xs font-semibold">{g.name}</p>
                        {g.items.map(i => <p key={i.key} className="text-xs text-gray-500 ml-2">• {i.name}</p>)}
                      </div>
                    ))}
                  </>}
                </>}
              </PrintModal>

              <DateFilter from={catFrom} to={catTo} onFrom={setCatFrom} onTo={setCatTo} onFetch={fetchCategory} />
              {catLoading && <div className="text-center py-8 text-gray-400">Loading...</div>}
              {!catLoading && !catData && <Empty icon="📊" text="Select date range and click View" />}
              {!catLoading && catData && (
                <>
                  <PrintCSVBar onPrint={() => setShowCatPrint(true)} onCSV={exportCatCSV} />

                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-orange-500 rounded-2xl p-4 text-white text-center shadow"><p className="text-xs opacity-80 mb-1">Item Sales</p><p className="text-2xl font-bold">₹{inr(catData.totalRevenue)}</p></div>
                    <div className="bg-white border border-gray-200 rounded-2xl p-4 text-center shadow"><p className="text-xs text-gray-500 mb-1">Items Sold</p><p className="text-2xl font-bold text-gray-800">{catData.totalQty}</p></div>
                    <div className="bg-pink-50 border border-pink-200 rounded-2xl p-4 text-center shadow"><p className="text-xs text-gray-500 mb-1">🎁 Free Items</p><p className="text-2xl font-bold text-pink-600">{catData.compQty}</p><p className="text-xs text-gray-400">₹{inr(catData.compValue)}</p></div>
                  </div>
                  <p className="text-xs text-gray-400 -mt-2 mb-4">Item sales are the menu price × quantity, before bill-level discount and service charge. Complimentary items are counted as sold but not as revenue.</p>

                  {/* Departments */}
                  {catData.deptList.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {catData.deptList.map(d => (
                        <div key={d} className={`border rounded-2xl p-4 ${deptStyle(d).card}`}>
                          <p className="text-xs text-gray-500 mb-1">{deptStyle(d).icon} {d}</p>
                          <p className={`text-2xl font-bold ${deptStyle(d).text}`}>₹{inr(catData.deptStats[d].revenue)}</p>
                          <p className="text-xs text-gray-400">{pctOf(catData.deptStats[d].revenue, catData.totalRevenue)}% · {catData.deptStats[d].qty} sold</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Top sellers */}
                  {catData.topItems.length > 0 && (
                    <div className="bg-white rounded-2xl shadow p-5 mb-4">
                      <h3 className="font-bold text-gray-700 mb-3">🏆 Top Sellers</h3>
                      <div className="space-y-2">
                        {catData.topItems.map((it, i) => (
                          <div key={it.key} className="flex justify-between items-center text-sm">
                            <span className="text-gray-700"><span className="text-gray-400 mr-2">{i + 1}.</span>{it.name} <span className="text-xs text-gray-400">· {it.categoryName}</span></span>
                            <span className="text-gray-500 text-xs">{it.qty} sold · <span className="font-bold text-orange-500 text-sm">₹{inr(it.revenue)}</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Category breakdown — every category from the Menu page */}
                  <div className="bg-white rounded-2xl shadow p-5 mb-4">
                    <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                      <h3 className="font-bold text-gray-700">Category Breakdown <span className="text-xs font-normal text-gray-400">({catData.catStats.length} categories)</span></h3>
                      <div className="flex gap-2 print:hidden">
                        <button onClick={() => setCatExpanded(Object.fromEntries(catNames.map(n => [n, true])))} className="border border-gray-200 text-gray-600 px-2.5 py-1 rounded-lg text-xs">Expand all</button>
                        <button onClick={() => setCatExpanded({})} className="border border-gray-200 text-gray-600 px-2.5 py-1 rounded-lg text-xs">Collapse all</button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b">
                          <th className="text-left py-2 text-xs text-gray-500">Category</th>
                          <th className="text-right py-2 text-xs text-gray-500">Sold</th>
                          <th className="text-right py-2 text-xs text-gray-500">Revenue</th>
                          <th className="text-right py-2 text-xs text-gray-500">Share</th>
                          <th className="text-right py-2 text-xs text-gray-500">Top Item</th>
                        </tr></thead>
                        <tbody>
                          {catData.catStats.map(cat => {
                            const open = !!catExpanded[cat.name]
                            const noSales = cat.qty === 0
                            return (
                              <Fragment key={cat.name}>
                                <tr onClick={() => setCatExpanded(p => ({ ...p, [cat.name]: !p[cat.name] }))}
                                  className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${noSales ? 'opacity-50' : ''}`}>
                                  <td className="py-2 font-medium text-gray-700"><span className="text-gray-300 text-xs mr-1">{open ? '▼' : '▶'}</span>{cat.name} <span className="text-xs text-gray-400 font-normal">({cat.soldCount}/{cat.menuCount || cat.items.length} items sold)</span></td>
                                  <td className="py-2 text-right text-gray-500">{cat.qty}</td>
                                  <td className="py-2 text-right font-bold text-orange-500">₹{inr(cat.revenue)}</td>
                                  <td className="py-2 text-right text-gray-400">{pctOf(cat.revenue, catData.totalRevenue)}%</td>
                                  <td className="py-2 text-right text-gray-400 text-xs truncate max-w-[110px]">{cat.topItem?.[0] || '—'}</td>
                                </tr>
                                {open && (
                                  <tr className="bg-gray-50">
                                    <td colSpan={5} className="px-3 py-2">
                                      {cat.items.filter(i => i.qty > 0).length === 0 ? (
                                        <p className="text-xs text-gray-400 py-1">No sales in this category for the selected dates.</p>
                                      ) : cat.items.filter(i => i.qty > 0).map(i => (
                                        <div key={i.key} className="flex justify-between text-xs py-1 border-b border-gray-100 last:border-0">
                                          <span className="text-gray-700">{i.name}{i.subName && <span className="text-gray-400"> · {i.subName}</span>}{i.compQty > 0 && <span className="ml-1 text-pink-600">🎁{i.compQty}</span>}</span>
                                          <span className="text-gray-500">{i.qty} sold · <span className="font-semibold text-orange-500">₹{inr(i.revenue)}</span></span>
                                        </div>
                                      ))}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Item search + item-wise sales */}
                  <div className="bg-white rounded-2xl shadow p-5 mb-4">
                    <h3 className="font-bold text-gray-700 mb-3">🔎 Item-wise Sales</h3>
                    <div className="flex gap-2 flex-wrap mb-3">
                      <div className="relative flex-1 min-w-[180px]">
                        <input type="text" value={catSearch} onChange={e => setCatSearch(e.target.value)}
                          placeholder="Search any item (e.g. prawns, beer)…"
                          className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                        {catSearch && <button onClick={() => setCatSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">✕</button>}
                      </div>
                      <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                        <option value="all">All categories</option>
                        {catNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-1 mb-3 items-center">
                      <span className="text-xs text-gray-400 mr-1">Sort:</span>
                      {[['revenue', 'Revenue'], ['qty', 'Qty'], ['name', 'A–Z']].map(([k, l]) => (
                        <button key={k} onClick={() => setCatSort(k)} className={`px-2 py-1 rounded text-xs font-medium ${catSort === k ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{l}</button>
                      ))}
                    </div>

                    {searching && (
                      <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 mb-3 text-sm text-orange-700">
                        {items.length === 0 ? <>No item matches “{catSearch}”.</> : <><b>{items.length}</b> item{items.length !== 1 ? 's' : ''} matched · <b>{matchQty}</b> sold · <b>₹{inr(matchRev)}</b> revenue</>}
                      </div>
                    )}

                    {items.length === 0 && !searching ? (
                      <p className="text-sm text-gray-400 py-4 text-center">No items sold in this selection.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b">
                            <th className="text-left py-2 text-xs text-gray-500">Item</th>
                            <th className="text-right py-2 text-xs text-gray-500">Qty</th>
                            <th className="text-right py-2 text-xs text-gray-500">Revenue</th>
                            <th className="text-right py-2 text-xs text-gray-500">Bills</th>
                            <th className="text-right py-2 text-xs text-gray-500">Share</th>
                          </tr></thead>
                          <tbody>
                            {items.map(i => (
                              <tr key={i.key} className="border-b border-gray-50 hover:bg-gray-50">
                                <td className="py-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${deptStyle(i.dept).badge}`}>{deptStyle(i.dept).icon}</span>
                                    <div>
                                      <p className="text-gray-700 font-medium">{i.name}{i.isOpen && <span className="text-xs text-purple-500 ml-1">(open)</span>}</p>
                                      <p className="text-xs text-gray-400">{i.categoryName}{i.subName ? ` › ${i.subName}` : ''}{i.price ? ` · ₹${inr(i.price)}` : ''}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2 text-right text-gray-600">
                                  {i.qty === 0 ? <span className="text-xs text-red-400">No sales</span> : i.qty}
                                  {i.compQty > 0 && <div className="text-xs text-pink-600">🎁 {i.compQty} free</div>}
                                </td>
                                <td className="py-2 text-right font-bold text-orange-500">₹{inr(i.revenue)}</td>
                                <td className="py-2 text-right text-gray-400 text-xs">{i.billCount}</td>
                                <td className="py-2 text-right text-gray-400 text-xs">{pctOf(i.revenue, catData.totalRevenue)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Zero sales — collapsed dropdown */}
                  {catData.zeroItems.length > 0 && (
                    <div className="bg-red-50 border border-red-100 rounded-2xl overflow-hidden">
                      <button onClick={() => setShowZero(!showZero)} className="w-full p-5 flex justify-between items-center text-left">
                        <div>
                          <h3 className="font-bold text-red-600">💀 Zero Sales ({catData.zeroItems.length} items)</h3>
                          <p className="text-xs text-gray-500">Available on the menu, but no orders in this period</p>
                        </div>
                        <span className="text-red-400">{showZero ? '▲' : '▼'}</span>
                      </button>
                      {showZero && (
                        <div className="px-5 pb-5 space-y-3 border-t border-red-100 pt-4">
                          {catData.zeroGroups.map(g => (
                            <div key={g.name}>
                              <p className="text-xs font-bold text-gray-600 mb-1">{g.name} <span className="font-normal text-gray-400">({g.items.length})</span></p>
                              <div className="flex flex-wrap gap-2">
                                {g.items.map(i => <span key={i.key} className="bg-white border border-red-100 text-red-500 text-xs px-2 py-1 rounded-full">{i.name}</span>)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })()}

        {/* ═══════════ TABLE-WISE TAB ═══════════ */}
        {activeTab === 'tables' && (
          <div>
            <PrintModal show={showTblPrint} title="Table-wise Sales Report" onClose={() => setShowTblPrint(false)} onPrint={() => window.print()} onCSV={exportTblCSV}>
              <div className="text-center mb-4 border-b pb-2"><p className="font-bold">HOTEL KHALASI — TABLE-WISE</p><p className="text-xs text-gray-500">{formatDate(tblFrom)} → {formatDate(tblTo)}</p></div>
              {tblData.map(tbl => (
                <div key={tbl.name} className="mb-4 border rounded-xl p-3">
                  <p className="font-bold mb-1">{tbl.name} — Rs.{inr(tbl.tableRevenue)}</p>
                  <p className="text-xs text-gray-500 mb-2">🟢 {tbl.activatedAt ? toIST(tbl.activatedAt) : '—'} → 🔴 {tbl.paidAt ? toIST(tbl.paidAt) : '—'} · ⏱ {formatDuration(tbl.duration)}</p>
                  {tbl.bills.map(bill => (
                    <div key={bill.key} className="text-xs border-b pb-2 mb-2">
                      <div className="flex justify-between font-medium"><span>Bill #{bill.billSerial} · {bill.isComp ? '🎁 Complimentary' : bill.isPending ? '⏳ Pending' : bill.split_payment ? '🔀 Split' : (PAY_LABEL[bill.payment_type] || bill.payment_type)}</span><span>Rs.{inr(bill.final_amount)}</span></div>
                      {bill.items.map((item, i) => (<div key={i} className="flex justify-between text-gray-500 ml-2"><span>{item.name} ×{item.qty}</span><span>Rs.{inr(item.amount)}</span></div>))}
                      {bill.isComp && <div className="flex justify-between text-pink-600 ml-2"><span>Complimentary{bill.comp_reason ? ` — ${bill.comp_reason}` : ''}</span><span>-Rs.{inr(bill.compValue)}</span></div>}
                    </div>
                  ))}
                </div>
              ))}
            </PrintModal>
            <DateFilter from={tblFrom} to={tblTo} onFrom={setTblFrom} onTo={setTblTo} onFetch={fetchTablewise} btnText="View Report" />
            {tblLoading && <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-2 animate-pulse">🪑</div><p>Loading…</p></div>}
            {!tblLoading && tblFetched && tblData.length === 0 && <Empty icon="📭" text="No paid orders in this period." />}
            {!tblLoading && !tblFetched && <Empty icon="🪑" text="Select a date range and click View Report" />}
            {!tblLoading && tblData.length > 0 && (
              <>
                <div className="flex gap-2 justify-end mb-4 print:hidden">
                  <button onClick={() => setTblExpanded(Object.fromEntries(tblData.map(t => [t.name, true])))} className="border border-gray-200 bg-white text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium">Expand All</button>
                  <button onClick={() => setTblExpanded(Object.fromEntries(tblData.map(t => [t.name, false])))} className="border border-gray-200 bg-white text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium">Collapse All</button>
                  <button onClick={() => setShowTblPrint(true)} className="bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium">🖨️ Print</button>
                  <button onClick={exportTblCSV} className="bg-green-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium">📊 CSV</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4"><p className="text-xs text-gray-500 mb-1">Net Revenue</p><p className="text-2xl font-bold text-orange-600">₹{inr(tblSummary.revenue)}</p></div>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4"><p className="text-xs text-gray-500 mb-1">Tables Active</p><p className="text-2xl font-bold text-blue-600">{tblSummary.tables}</p></div>
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4"><p className="text-xs text-gray-500 mb-1">Total Bills</p><p className="text-2xl font-bold text-gray-700">{tblSummary.bills}</p></div>
                  <div className="bg-white border border-gray-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">SC / Disc / Free</p>
                    <p className="text-sm font-bold text-gray-700">₹{inr(tblSummary.sc)} / -₹{inr(tblSummary.discount)} / <span className="text-pink-600">🎁₹{inr(tblSummary.comp)}</span></p>
                  </div>
                </div>
                <div className="space-y-4">
                  {tblData.map(tbl => {
                    const isOpen = !!tblExpanded[tbl.name]
                    return (
                      <div key={tbl.name} className="bg-white rounded-2xl shadow overflow-hidden">
                        <button onClick={() => setTblExpanded(p => ({ ...p, [tbl.name]: !p[tbl.name] }))} className="w-full text-left px-5 py-4 flex justify-between items-start hover:bg-gray-50 transition">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm flex-shrink-0">🪑</div>
                            <div>
                              <p className="font-bold text-gray-800 text-base">{tbl.name}</p>
                              <div className="flex flex-wrap gap-2 mt-1">
                                <span className="text-xs text-gray-400">🟢 {tbl.activatedAt ? toIST(tbl.activatedAt) : '—'} → 🔴 {tbl.paidAt ? toIST(tbl.paidAt) : '—'}</span>
                                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⏱ {formatDuration(tbl.duration)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0 ml-3">
                            <p className="font-bold text-orange-500 text-xl">₹{inr(tbl.tableRevenue)}</p>
                            <p className="text-xs text-gray-400">{tbl.bills.length} bill{tbl.bills.length !== 1 ? 's' : ''}</p>
                            <p className="text-xs text-gray-300 mt-1">{isOpen ? '▲' : '▼'}</p>
                          </div>
                        </button>
                        {isOpen && (
                          <div className="border-t border-gray-100 divide-y divide-gray-50">
                            {tbl.bills.map(bill => (
                              <div key={bill.key} className="px-5 py-4">
                                <div className="flex justify-between items-center mb-3">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="bg-gray-800 text-white text-xs px-2 py-0.5 rounded-full font-bold">Bill #{bill.billSerial}</span>
                                    <PayBadge bill={bill} />
                                  </div>
                                  <span className="text-xs text-gray-400">{formatDate(bill.paid_at)} {toIST(bill.paid_at)}</span>
                                </div>
                                <SplitStrip bill={bill} />
                                <div className="rounded-xl border border-gray-100 overflow-hidden mb-3">
                                  <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="text-left px-3 py-2 text-xs text-gray-400 w-8">Sr</th>
                                        <th className="text-left px-3 py-2 text-xs text-gray-400">Item</th>
                                        <th className="text-right px-3 py-2 text-xs text-gray-400 w-12">Qty</th>
                                        <th className="text-right px-3 py-2 text-xs text-gray-400 w-16">Rate</th>
                                        <th className="text-right px-3 py-2 text-xs text-gray-400 w-20">Amt</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {bill.items.map((item, i) => (
                                        <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                                          <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                                          <td className="px-3 py-2"><div className="flex items-center gap-2"><span className={`text-xs px-1.5 py-0.5 rounded font-medium ${deptStyle(item.dept).badge}`}>{deptStyle(item.dept).icon}</span><span className="text-gray-700 text-sm">{item.name}{item.isOpen && <span className="text-xs text-purple-500 ml-1">(open)</span>}</span></div></td>
                                          <td className="px-3 py-2 text-right text-sm text-gray-700">×{item.qty}</td>
                                          <td className="px-3 py-2 text-right text-sm text-gray-500">₹{inr(item.rate)}</td>
                                          <td className="px-3 py-2 text-right text-sm font-medium text-gray-700">₹{inr(item.amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                                  <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>₹{inr(bill.subtotal)}</span></div>
                                  {bill.service_charge_amt > 0 && <div className="flex justify-between text-gray-400 text-xs"><span>Service Charge ({bill.service_charge_pct}%)</span><span>₹{inr(bill.service_charge_amt)}</span></div>}
                                  {bill.discount_amt > 0 && <div className="flex justify-between text-green-600 text-xs"><span>Discount {bill.discount_reason ? `— ${bill.discount_reason}` : ''}</span><span>-₹{inr(bill.discount_amt)}</span></div>}
                                  {bill.isComp && <div className="flex justify-between text-pink-600 text-xs"><span>🎁 Complimentary{bill.comp_reason ? ` — ${bill.comp_reason}` : ''}</span><span>-₹{inr(bill.compValue)}</span></div>}
                                  <div className="flex justify-between font-bold text-gray-800 border-t pt-1.5"><span>Bill Total</span><span className="text-orange-500">₹{inr(bill.final_amount)}</span></div>
                                </div>
                              </div>
                            ))}
                            <div className="bg-orange-50 px-5 py-3 flex justify-between items-center">
                              <div className="text-sm text-orange-700"><span className="font-bold">{tbl.name} Total</span><span className="text-xs ml-2 opacity-70">· {tbl.bills.length} bill{tbl.bills.length !== 1 ? 's' : ''} · {tbl.totalItems} items</span></div>
                              <div className="text-right"><p className="font-bold text-orange-600 text-lg">₹{inr(tbl.tableRevenue)}</p>{tbl.tableDiscount > 0 && <p className="text-xs text-green-600">Disc: -₹{inr(tbl.tableDiscount)}</p>}{tbl.tableComp > 0 && <p className="text-xs text-pink-600">Free: ₹{inr(tbl.tableComp)}</p>}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════ DISCOUNTS & COMPLIMENTARY TAB ═══════════ */}
        {activeTab === 'discounts' && (
          <div>
            <PrintModal show={showDiscPrint} title="Discount & Complimentary Audit" onClose={() => setShowDiscPrint(false)} onPrint={() => window.print()} onCSV={exportDiscCSV}>
              <div className="text-center mb-4 border-b pb-2"><p className="font-bold">HOTEL KHALASI — DISCOUNT AUDIT</p><p className="text-xs text-gray-500">{formatDate(discFrom)} to {formatDate(discTo)}</p></div>
              {discData && <>
                <div className="space-y-1 mb-4">
                  <div className="flex justify-between"><span>Total Discounts</span><span className="font-bold">Rs.{inr(discData.totalDiscount)} ({discData.discPct}%)</span></div>
                  <div className="flex justify-between"><span>Bills Discounted</span><span>{discData.bills.length}</span></div>
                  <div className="flex justify-between text-red-600"><span>🚨 Red Flags (&gt;40%)</span><span>{discData.redFlags}</span></div>
                  <div className="flex justify-between text-pink-600"><span>🎁 Complimentary</span><span>{discData.compBills.length} · Rs.{inr(discData.compValue)}</span></div>
                </div>
                {discData.reasonBreakdown.length > 0 && <p className="font-bold mb-1">By Reason</p>}
                {discData.reasonBreakdown.map(r => (<div key={r.reason} className="flex justify-between text-xs border-b py-1"><span>{r.reason} ({r.count})</span><span>Rs.{inr(r.total)}</span></div>))}
                {discData.bills.length > 0 && <p className="font-bold mt-3 mb-1">All Discounted Bills</p>}
                {discData.bills.map((b, i) => (
                  <div key={i} className={`text-xs border-b py-1 ${b.flag === 'red' ? 'text-red-600' : b.flag === 'yellow' ? 'text-yellow-600' : ''}`}>
                    <div className="flex justify-between"><span>{b.table_name_snapshot} · {toIST(b.paid_at)}</span><span>-Rs.{inr(b.discount_amt)} ({b.truePct.toFixed(0)}%){b.flag ? ' ⚠️' : ''}</span></div>
                    {b.discount_reason && <p className="text-gray-500 ml-2">Reason: {b.discount_reason}</p>}
                  </div>
                ))}
                {discData.compBills.length > 0 && <p className="font-bold mt-3 mb-1">Complimentary Bills</p>}
                {discData.compBills.map((b, i) => (
                  <div key={i} className="text-xs border-b py-1 text-pink-700">
                    <div className="flex justify-between"><span>{b.table_name_snapshot} · {toIST(b.paid_at)}</span><span>Rs.{inr(b.compValue)}</span></div>
                    <p className="text-gray-500 ml-2">Reason: {b.comp_reason || 'No reason'}</p>
                  </div>
                ))}
              </>}
            </PrintModal>
            <DateFilter from={discFrom} to={discTo} onFrom={setDiscFrom} onTo={setDiscTo} onFetch={fetchDiscounts} />
            {discLoading && <div className="text-center py-8 text-gray-400">Loading...</div>}
            {!discLoading && !discData && <Empty icon="🎁" text="No discounts or complimentary bills in this period" />}
            {!discLoading && discData && (
              <>
                <PrintCSVBar onPrint={() => setShowDiscPrint(true)} onCSV={exportDiscCSV} />

                {discData.bills.length > 0 && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <div className={`border rounded-2xl p-4 ${parseFloat(discData.discPct) > 10 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                        <p className="text-xs text-gray-500 mb-1">Total Discounts</p>
                        <p className={`text-2xl font-bold ${parseFloat(discData.discPct) > 10 ? 'text-red-600' : 'text-green-600'}`}>₹{inr(discData.totalDiscount)}</p>
                        <p className="text-xs text-gray-400">{discData.discPct}% of discounted bills</p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-2xl p-4"><p className="text-xs text-gray-500 mb-1">Bills Discounted</p><p className="text-2xl font-bold text-gray-700">{discData.bills.length}</p><p className="text-xs text-gray-400">avg ₹{inr(discData.avgDiscount)}/bill</p></div>
                      <div className={`border rounded-2xl p-4 ${discData.redFlags > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}><p className="text-xs text-gray-500 mb-1">🚨 Red Flags</p><p className={`text-2xl font-bold ${discData.redFlags > 0 ? 'text-red-600' : 'text-gray-400'}`}>{discData.redFlags}</p><p className="text-xs text-gray-400">Disc &gt;40%</p></div>
                      <div className={`border rounded-2xl p-4 ${discData.yellowFlags > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-200'}`}><p className="text-xs text-gray-500 mb-1">⚠️ Yellow</p><p className={`text-2xl font-bold ${discData.yellowFlags > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{discData.yellowFlags}</p><p className="text-xs text-gray-400">Disc 20–40%</p></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-white rounded-2xl shadow p-4"><p className="text-xs text-gray-500 mb-1">📅 Most Discounts Day</p><p className="font-bold text-gray-700">{discData.topDay?.[0] || '—'}</p><p className="text-xs text-gray-400">₹{inr(discData.topDay?.[1] || 0)}</p></div>
                      <div className="bg-white rounded-2xl shadow p-4"><p className="text-xs text-gray-500 mb-1">💸 Largest Discount</p><p className="font-bold text-gray-700">₹{inr(discData.largest?.discount_amt || 0)}</p><p className="text-xs text-gray-400">{discData.largest?.table_name_snapshot} · {discData.largest ? toIST(discData.largest.paid_at) : '—'}</p></div>
                    </div>
                    <div className="bg-white rounded-2xl shadow p-5 mb-4">
                      <h3 className="font-bold text-gray-700 mb-3">By Reason</h3>
                      <div className="space-y-2">
                        {discData.reasonBreakdown.map(r => (<div key={r.reason} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl"><div><p className="font-medium text-gray-700 text-sm">{r.reason}</p><p className="text-xs text-gray-400">{r.count} bill(s)</p></div><p className="font-bold text-red-500">-₹{inr(r.total)}</p></div>))}
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl shadow p-5 mb-4">
                      <h3 className="font-bold text-gray-700 mb-3">All Discounted Bills</h3>
                      <div className="space-y-2">
                        {discData.bills.map((bill, i) => (
                          <div key={i} className={`rounded-xl p-3 border ${bill.flag === 'red' ? 'bg-red-50 border-red-200' : bill.flag === 'yellow' ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-100'}`}>
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-gray-700 text-sm">{bill.table_name_snapshot}</p>
                                  {bill.flag === 'red' && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">🚨 {bill.truePct.toFixed(0)}%</span>}
                                  {bill.flag === 'yellow' && <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full">⚠️ {bill.truePct.toFixed(0)}%</span>}
                                </div>
                                <p className="text-xs text-gray-400">{formatDate(bill.paid_at)} · {toIST(bill.paid_at)}</p>
                                {bill.discount_reason && <p className="text-xs text-gray-500 mt-0.5">📝 {bill.discount_reason}</p>}
                              </div>
                              <div className="text-right"><p className="font-bold text-red-500">-₹{inr(bill.discount_amt)}</p><p className="text-xs text-gray-400">₹{inr(bill.subtotal)} → ₹{inr(bill.final_amount)}</p></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {discData.compBills.length > 0 && (
                  <div className="bg-pink-50 border-2 border-pink-200 rounded-2xl p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-pink-700">🎁 Complimentary Bills ({discData.compBills.length})</h3>
                        <p className="text-xs text-gray-500">Given free — not counted as discounts above</p>
                      </div>
                      <p className="font-bold text-pink-600 text-xl">₹{inr(discData.compValue)}</p>
                    </div>
                    <div className="space-y-2">
                      {discData.compBills.map((bill, i) => (
                        <div key={i} className="bg-white rounded-xl p-3 border border-pink-100">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-semibold text-gray-700 text-sm">{bill.table_name_snapshot}</p>
                              <p className="text-xs text-gray-400">{formatDate(bill.paid_at)} · {toIST(bill.paid_at)}</p>
                              <p className="text-xs text-pink-700 mt-0.5">📝 {bill.comp_reason || 'No reason given'}</p>
                            </div>
                            <p className="font-bold text-pink-600">₹{inr(bill.compValue)}</p>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{bill.items.map(it => `${it.name} ×${it.qty}`).join(', ')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══════════ SETTLEMENT TAB ═══════════ */}
        {activeTab === 'settlement' && (
          <div>
            <PrintModal show={showSettlPrint} title="Settlement Slip"
              onClose={() => setShowSettlPrint(false)} onPrint={() => window.print()} onCSV={exportSettlCSV}>
              <div className="text-center mb-4">
                <p className="font-bold text-lg">HOTEL KHALASI</p>
                <p>SETTLEMENT REPORT</p>
                <p className="text-gray-500 text-xs">{formatDate(settlFrom)}{settlFrom !== settlTo ? ` to ${formatDate(settlTo)}` : ''}</p>
                <p className="text-gray-400 text-xs">Printed: {formatDate(new Date())} {toIST(new Date().toISOString())}</p>
                {settlFiltered && <p className="text-indigo-600 text-xs mt-1">Filter: {settlModes.length ? settlModes.map(m => MODE_STYLE[m].label).join(' + ') : 'All'}{settlSearch ? ` · “${settlSearch}”` : ''} — {settlVisible.length} of {settlData?.sum.count} bills in the CSV</p>}
              </div>
              {settlData && <>
                <div className="border-t border-b border-dashed py-3 mb-3 space-y-2">
                  <div className="flex justify-between text-lg font-bold"><span>💵 CASH (incl. split)</span><span>Rs.{inr(settlData.sum.cash)}</span></div>
                  <div className="flex justify-between text-lg font-bold"><span>📱 UPI (incl. split)</span><span>Rs.{inr(settlData.sum.upi)}</span></div>
                  <div className="flex justify-between text-lg font-bold"><span>💳 CARD (incl. split)</span><span>Rs.{inr(settlData.sum.card)}</span></div>
                  <div className="flex justify-between text-base font-bold text-pink-600"><span>🎁 COMPLIMENTARY ({settlData.sum.compCount})</span><span>Rs.{inr(settlData.sum.compValue)}</span></div>
                  <div className="flex justify-between text-base font-bold text-yellow-700"><span>⏳ PENDING ({settlData.sum.pendingCount})</span><span>Rs.{inr(settlData.sum.pendingAmt)}</span></div>
                  {settlData.sum.splitCount > 0 && <div className="flex justify-between text-sm text-indigo-600"><span>🔀 Split bills</span><span>{settlData.sum.splitCount}</span></div>}
                </div>
                <div className="flex justify-between text-xl font-bold border-b border-dashed pb-3 mb-3"><span>TOTAL</span><span>Rs.{inr(settlData.sum.grand)}</span></div>
                <div className="space-y-1 text-xs text-gray-600 mb-4">
                  <div className="flex justify-between"><span>Total Bills</span><span>{settlData.sum.count}</span></div>
                  <div className="flex justify-between"><span>Collected (Cash+UPI+Card)</span><span>Rs.{inr(settlData.sum.collected)}</span></div>
                  <div className="flex justify-between"><span>Service Charge</span><span>Rs.{inr(settlData.sum.sc)}</span></div>
                  <div className="flex justify-between"><span>Discounts Given</span><span>-Rs.{inr(settlData.sum.disc)}</span></div>
                  <div className="flex justify-between"><span>Complimentary Given</span><span>-Rs.{inr(settlData.sum.compValue)}</span></div>
                </div>
                <div className="border-t border-dashed pt-4 text-xs text-gray-400 space-y-3">
                  <div className="flex justify-between"><span>Cash in Drawer:</span><span>_______________</span></div>
                  <div className="flex justify-between"><span>Authorized By:</span><span>_______________</span></div>
                  <div className="flex justify-between"><span>Signature:</span><span>_______________</span></div>
                </div>
              </>}
            </PrintModal>

            <DateFilter from={settlFrom} to={settlTo} onFrom={setSettlFrom} onTo={setSettlTo} onFetch={fetchSettlement} />
            {settlLoading && <div className="text-center py-8 text-gray-400">Loading...</div>}
            {!settlLoading && !settlData && <Empty icon="💰" text="No transactions found" />}
            {!settlLoading && settlData && (() => {
              const s = settlData.sum
              const tiles = {
                cash: [s.cash, s.cashCount, 'incl. split'],
                upi: [s.upi, s.upiCount, 'incl. split'],
                card: [s.card, s.cardCount, 'incl. split'],
                complimentary: [s.compValue, s.compCount, 'given free'],
                pending: [s.pendingAmt, s.pendingCount, 'not settled yet'],
              }
              return (
                <>
                  <PrintCSVBar onPrint={() => setShowSettlPrint(true)} onCSV={exportSettlCSV} />

                  {s.splitCount > 0 && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3 mb-4 flex items-center gap-3">
                      <span className="text-xl">🔀</span>
                      <p className="text-sm text-indigo-700"><span className="font-bold">{s.splitCount} split payment bill{s.splitCount > 1 ? 's' : ''}</span> — each part is counted under its own payment mode below</p>
                    </div>
                  )}

                  {/* Tap a tile to filter the transactions below */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-2">
                    {MODE_ORDER.map(m => {
                      const [amt, cnt, note] = tiles[m]
                      const on = settlModes.includes(m)
                      const st = MODE_STYLE[m]
                      return (
                        <button key={m} onClick={() => toggleSettlMode(m)}
                          className={`border rounded-2xl p-4 text-center transition active:scale-95 ${st.box} ${on ? st.ring + ' shadow-md' : 'opacity-90 hover:opacity-100'}`}>
                          <p className="text-xs text-gray-500">{st.label} {on && '✓'}</p>
                          <p className={`text-xl font-bold ${st.text}`}>₹{inr(amt)}</p>
                          <p className="text-xs text-gray-400">{cnt} bill{cnt !== 1 ? 's' : ''} · {note}</p>
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex justify-between items-center mb-4 min-h-[24px]">
                    <p className="text-xs text-gray-400">Tap a tile to see only those settlements. Tap more than one to combine (e.g. Cash + Card).</p>
                    {settlModes.length > 0 && <button onClick={() => setSettlModes([])} className="text-xs text-orange-600 font-medium flex-shrink-0 ml-2">Clear filter ✕</button>}
                  </div>

                  <div className="bg-orange-500 rounded-2xl p-5 text-white mb-4 flex justify-between items-center">
                    <div>
                      <p className="text-sm opacity-80">Grand Total</p>
                      <p className="text-4xl font-bold">₹{inr(s.grand)}</p>
                      <p className="text-sm opacity-80 mt-1">{s.count} bills</p>
                    </div>
                    <div className="text-right text-sm opacity-90 space-y-1">
                      <p>SC: +₹{inr(s.sc)}</p>
                      <p>Disc: -₹{inr(s.disc)}</p>
                      <p>Free: -₹{inr(s.compValue)}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl shadow p-5 mb-4 space-y-2 text-sm">
                    <div className="flex justify-between text-gray-600"><span>Gross Revenue</span><span>₹{inr(s.gross)}</span></div>
                    <div className="flex justify-between text-gray-600"><span>+ Service Charge</span><span>₹{inr(s.sc)}</span></div>
                    <div className="flex justify-between text-green-600"><span>- Discounts</span><span>-₹{inr(s.disc)}</span></div>
                    <div className="flex justify-between text-pink-600"><span>- Complimentary ({s.compCount})</span><span>-₹{inr(s.compValue)}</span></div>
                    <div className="flex justify-between font-bold text-gray-800 border-t pt-2"><span>Net Total</span><span>₹{inr(s.grand)}</span></div>
                    <div className="flex justify-between text-xs text-gray-500"><span>Collected (Cash + UPI + Card)</span><span>₹{inr(s.collected)}</span></div>
                    {s.pendingAmt > 0 && <div className="flex justify-between text-xs text-yellow-700"><span>Pending settlement</span><span>₹{inr(s.pendingAmt)}</span></div>}
                  </div>

                  {/* Transactions */}
                  <div className="bg-white rounded-2xl shadow p-5">
                    <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                      <h3 className="font-bold text-gray-700">
                        Transactions ({settlVisible.length}{settlFiltered ? ` of ${s.count}` : ''})
                      </h3>
                      <div className="flex gap-1">
                        {['time', 'amount', 'table', 'payment'].map(k => (
                          <button key={k} onClick={() => setSettlSort(k)}
                            className={`px-2 py-1 rounded text-xs font-medium ${settlSort === k ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                            {k}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="relative mb-3">
                      <input type="text" value={settlSearch} onChange={e => setSettlSearch(e.target.value)}
                        placeholder="Search table, item, amount or complimentary reason…"
                        className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                      {settlSearch && <button onClick={() => setSettlSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">✕</button>}
                    </div>

                    {settlModes.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {settlSelectedAmounts.map(([m, amt]) => (
                          <span key={m} className={`text-xs font-semibold px-3 py-1 rounded-full border ${MODE_STYLE[m].box} ${MODE_STYLE[m].text}`}>
                            {MODE_STYLE[m].label}: ₹{inr(amt)}
                          </span>
                        ))}
                        {settlSelectedAmounts.filter(([m]) => m !== 'complimentary' && m !== 'pending').length > 1 && (
                          <span className="text-xs font-bold px-3 py-1 rounded-full bg-gray-800 text-white">
                            Combined: ₹{inr(settlSelectedAmounts.filter(([m]) => m !== 'complimentary' && m !== 'pending').reduce((a, [, v]) => a + v, 0))}
                          </span>
                        )}
                      </div>
                    )}

                    {settlVisible.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No bills match this filter.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b">
                            <th className="text-left py-2 text-xs text-gray-500">Date & Time</th>
                            <th className="text-left py-2 text-xs text-gray-500">Table</th>
                            <th className="text-left py-2 text-xs text-gray-500">Payment</th>
                            <th className="text-right py-2 text-xs text-gray-500">Subtotal</th>
                            <th className="text-right py-2 text-xs text-gray-500">SC</th>
                            <th className="text-right py-2 text-xs text-gray-500">Disc / Free</th>
                            <th className="text-right py-2 text-xs text-gray-500">Total</th>
                          </tr></thead>
                          <tbody>
                            {settlVisible.map(bill => {
                              const open = !!settlExpanded[bill.key]
                              return (
                                <Fragment key={bill.key}>
                                  <tr onClick={() => setSettlExpanded(p => ({ ...p, [bill.key]: !p[bill.key] }))}
                                    className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${bill.isComp ? 'bg-pink-50/50' : ''}`}>
                                    <td className="py-2 text-xs text-gray-400">
                                      <div>{formatDate(bill.paid_at)}</div>
                                      <div>{toIST(bill.paid_at)}</div>
                                    </td>
                                    <td className="py-2 font-medium text-gray-700 text-xs">{bill.table_name_snapshot}</td>
                                    <td className="py-2">
                                      <PayBadge bill={bill} />
                                      {bill.split_payment && !bill.isComp && !bill.isPending && (
                                        <div className="mt-0.5 space-y-0.5">
                                          {Object.entries(bill.split_payment).filter(([, v]) => v > 0).map(([k, v]) => (
                                            <div key={k} className="text-xs text-gray-400">{payIcon(k)} ₹{inr(v)}</div>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2 text-right text-gray-600 text-xs">₹{inr(bill.subtotal)}</td>
                                    <td className="py-2 text-right text-gray-400 text-xs">{bill.service_charge_amt > 0 ? `₹${inr(bill.service_charge_amt)}` : '—'}</td>
                                    <td className="py-2 text-right text-xs">
                                      {bill.isComp ? <span className="text-pink-600">🎁 ₹{inr(bill.compValue)}</span>
                                        : bill.discount_amt > 0 ? <span className="text-green-600">-₹{inr(bill.discount_amt)}</span> : '—'}
                                    </td>
                                    <td className="py-2 text-right font-bold text-orange-500 text-xs">₹{inr(bill.final_amount)}</td>
                                  </tr>
                                  {open && (
                                    <tr className="bg-gray-50">
                                      <td colSpan={7} className="px-3 py-3">
                                        <SplitStrip bill={bill} />
                                        {bill.isComp && <p className="text-xs text-pink-700 mb-2">🎁 Complimentary{bill.comp_reason ? ` — ${bill.comp_reason}` : ''}</p>}
                                        {!bill.isComp && bill.discount_amt > 0 && bill.discount_reason && <p className="text-xs text-green-700 mb-2">📝 Discount: {bill.discount_reason}</p>}
                                        {bill.items.map((it, j) => (
                                          <div key={j} className="flex justify-between text-xs text-gray-600 py-0.5">
                                            <span>{deptStyle(it.dept).icon} {it.name} × {it.qty}{it.isOpen && <span className="text-purple-500"> (open)</span>}</span>
                                            <span>₹{inr(it.amount)}</span>
                                          </div>
                                        ))}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })}
                          </tbody>
                          <tfoot><tr className="border-t-2">
                            <td colSpan={6} className="py-2 font-bold text-gray-700 text-xs">{settlFiltered ? 'Total (filtered bills)' : 'Total'}</td>
                            <td className="py-2 text-right font-bold text-orange-500">₹{inr(settlVisible.reduce((a, b) => a + b.final_amount, 0))}</td>
                          </tr></tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        )}

      </div>
    </div>
  )
}
