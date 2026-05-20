import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import * as XLSX from 'xlsx'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})
const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

// ── Department classification ─────────────────────────────
const LIQUOR_KEYWORDS = [
  'beer','wine','whisky','whiskey','vodka','rum','gin','tequila','brandy',
  'champagne','scotch','bourbon','ale','lager','cider','sake','mead','port',
  'liquor','spirits','pint','draft','draught','feni','arrack','toddy','sangria',
  'kingfisher','corona','budweiser','heineken','bacardi','smirnoff','absolut',
  'jack daniel','jameson','old monk','mcdownell','royal stag','imperial blue',
  'teachers','blenders','black dog','black label','red label','green label',
  'shot','peg','quarter','half bottle','full bottle','liit','long island'
]

const BEVERAGE_KEYWORDS = [
  'mocktail','juice','lassi','shake','smoothie','soda','water','mineral water',
  'cold drink','soft drink','tea','coffee','lemonade','buttermilk','chaas',
  'nimbu pani','coconut water','virgin','cold coffee','milkshake','frappe',
  'pepsi','coke','cola','sprite','limca','maaza','frooti','thums up','7up',
  'cold bev','bev','beverage','drink','mojito','cooler','squash','iced tea'
]

const BAKERY_KEYWORDS = [
  'bread','bun','naan','roti','paratha','chapati','puri','bhatura','kulcha',
  'bread basket','garlic bread','toast','sandwich','burger','pizza','pasta',
  'cake','pastry','muffin','cookie','biscuit','croissant','waffle','pancake',
  'dessert','ice cream','gulab jamun','halwa','kheer','pudding','brownie',
  'rasgulla','jalebi','ladoo','barfi','mithai','sweet'
]

const getDepartment = (name = '') => {
  const lower = name.toLowerCase()
  if (LIQUOR_KEYWORDS.some(k => lower.includes(k))) return 'Liquor'
  if (BEVERAGE_KEYWORDS.some(k => lower.includes(k))) return 'Beverage'
  if (BAKERY_KEYWORDS.some(k => lower.includes(k))) return 'Bakery'
  return 'Kitchen'
}

const DEPT_COLORS = {
  Kitchen:  { bg: 'bg-orange-50',  border: 'border-orange-200', text: 'text-orange-600',  badge: 'bg-orange-100 text-orange-700',  icon: '🍳' },
  Bakery:   { bg: 'bg-yellow-50',  border: 'border-yellow-200', text: 'text-yellow-600',  badge: 'bg-yellow-100 text-yellow-700',  icon: '🥖' },
  Beverage: { bg: 'bg-blue-50',    border: 'border-blue-200',   text: 'text-blue-600',    badge: 'bg-blue-100 text-blue-700',      icon: '🥤' },
  Liquor:   { bg: 'bg-purple-50',  border: 'border-purple-200', text: 'text-purple-600',  badge: 'bg-purple-100 text-purple-700',  icon: '🍺' },
}

const ORDER_SELECT = `
  id, payment_type, is_paid, paid_at,
  subtotal, service_charge_pct, service_charge_amt,
  discount_type, discount_value, discount_amt, discount_reason,
  final_amount, table_name_snapshot,
  order_items(quantity, price_at_order, food_items(name))
`

const groupOrdersIntoBills = (orders) => {
  const map = {}
  orders.forEach((order) => {
    const minuteKey = order.paid_at ? order.paid_at.substring(0, 16) : order.id
    const key = `${order.table_name_snapshot || ''}__${minuteKey}`
    if (!map[key]) {
      map[key] = {
        _orderIds: [order.id], _key: key, id: order.id,
        payment_type: order.payment_type, paid_at: order.paid_at,
        table_name_snapshot: order.table_name_snapshot,
        subtotal: order.subtotal || 0,
        service_charge_pct: order.service_charge_pct || 0,
        service_charge_amt: order.service_charge_amt || 0,
        discount_type: order.discount_type,
        discount_value: order.discount_value || 0,
        discount_amt: order.discount_amt || 0,
        discount_reason: order.discount_reason || '',
        final_amount: order.final_amount || 0,
        order_items: [...(order.order_items || [])],
      }
    } else {
      map[key]._orderIds.push(order.id)
      map[key].order_items = [...map[key].order_items, ...(order.order_items || [])]
    }
  })
  return Object.values(map)
}

// Build department breakdown from bills
const buildDeptStats = (bills) => {
  const depts = { Kitchen: { revenue: 0, qty: 0 }, Bakery: { revenue: 0, qty: 0 }, Beverage: { revenue: 0, qty: 0 }, Liquor: { revenue: 0, qty: 0 } }
  bills.forEach(bill => {
    bill.order_items?.forEach(item => {
      const dept = getDepartment(item.food_items?.name)
      depts[dept].revenue += item.price_at_order * item.quantity
      depts[dept].qty += item.quantity
    })
  })
  return depts
}

const buildSummary = (bills) => {
  const totalRevenue = bills.reduce((s, b) => s + (b.final_amount || 0), 0)
  const cashRev = bills.filter(b => b.payment_type === 'cash').reduce((s, b) => s + (b.final_amount || 0), 0)
  const upiRev = bills.filter(b => b.payment_type === 'upi').reduce((s, b) => s + (b.final_amount || 0), 0)
  const cardRev = bills.filter(b => b.payment_type === 'card').reduce((s, b) => s + (b.final_amount || 0), 0)
  const scTotal = bills.reduce((s, b) => s + (b.service_charge_amt || 0), 0)
  const discountTotal = bills.reduce((s, b) => s + (b.discount_amt || 0), 0)
  return { totalRevenue, cashRev, upiRev, cardRev, scTotal, discountTotal, totalOrders: bills.length }
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function Reports() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('today')
  const [loading, setLoading] = useState(false)

  // Today
  const [todayOrders, setTodayOrders] = useState([])
  const [todayReport, setTodayReport] = useState(null)
  const [todayDepts, setTodayDepts] = useState(null)

  // Date Range
  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate, setToDate] = useState(todayIST())
  const [rangeOrders, setRangeOrders] = useState([])
  const [rangeReport, setRangeReport] = useState(null)
  const [rangeDepts, setRangeDepts] = useState(null)

  // Item Search
  const [itemFromDate, setItemFromDate] = useState(todayIST())
  const [itemToDate, setItemToDate] = useState(todayIST())
  const [itemStats, setItemStats] = useState([])
  const [itemSearchQuery, setItemSearchQuery] = useState('')

  // Category
  const [catFromDate, setCatFromDate] = useState(todayIST())
  const [catToDate, setCatToDate] = useState(todayIST())
  const [catStats, setCatStats] = useState([])

  // Table-wise
  const [tableFromDate, setTableFromDate] = useState(todayIST())
  const [tableToDate, setTableToDate] = useState(todayIST())
  const [tableStats, setTableStats] = useState([])

  // Monthly — last 4 months only
  const [monthlyData, setMonthlyData] = useState([])
  const [monthlyDepts, setMonthlyDepts] = useState([])
  const [monthlyLoaded, setMonthlyLoaded] = useState(false)

  // Discounts
  const [discFromDate, setDiscFromDate] = useState(todayIST())
  const [discToDate, setDiscToDate] = useState(todayIST())
  const [discData, setDiscData] = useState(null)

  // Settlement
  const [settlFromDate, setSettlFromDate] = useState(todayIST())
  const [settlToDate, setSettlToDate] = useState(todayIST())
  const [settlData, setSettlData] = useState(null)

  // Print Preview Modal
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [printData, setPrintData] = useState(null)

  useEffect(() => { fetchToday() }, [])

  const toRange = (from, to) => ({
    startISO: new Date(from + 'T00:00:00+05:30').toISOString(),
    endISO: new Date(to + 'T23:59:59+05:30').toISOString(),
  })

  // ── Fetch Today ───────────────────────────────────────────
  const fetchToday = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(todayIST(), todayIST())
    const { data: orders, error } = await supabase
      .from('orders').select(ORDER_SELECT)
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchToday:', error.message)
    const bills = groupOrdersIntoBills(orders || [])
    setTodayOrders(bills)
    setTodayReport(bills.length > 0 ? buildSummary(bills) : null)
    setTodayDepts(bills.length > 0 ? buildDeptStats(bills) : null)
    setLoading(false)
  }

  // ── Fetch Range ───────────────────────────────────────────
  const fetchRange = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(fromDate, toDate)
    const { data: orders, error } = await supabase
      .from('orders').select(ORDER_SELECT)
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchRange:', error.message)
    const bills = groupOrdersIntoBills(orders || [])
    setRangeOrders(bills)
    setRangeReport(bills.length > 0 ? buildSummary(bills) : null)
    setRangeDepts(bills.length > 0 ? buildDeptStats(bills) : null)
    setLoading(false)
  }

  // ── Fetch Item Stats ──────────────────────────────────────
  const fetchItemStats = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(itemFromDate, itemToDate)
    const { data: items, error } = await supabase
      .from('order_items')
      .select('quantity, price_at_order, food_items(name), orders!inner(is_paid, paid_at)')
      .eq('orders.is_paid', true)
      .gte('orders.paid_at', startISO).lte('orders.paid_at', endISO)
    if (error) console.error('fetchItemStats:', error.message)
    const map = {}
    items?.forEach(i => {
      const name = i.food_items?.name || 'Unknown'
      const dept = getDepartment(name)
      if (!map[name]) map[name] = { name, qty: 0, revenue: 0, dept }
      map[name].qty += i.quantity
      map[name].revenue += i.price_at_order * i.quantity
    })
    setItemStats(Object.values(map).sort((a, b) => b.qty - a.qty))
    setLoading(false)
  }

  // ── Fetch Category ────────────────────────────────────────
  const fetchCategoryStats = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(catFromDate, catToDate)
    const { data: items, error: itemErr } = await supabase
      .from('order_items')
      .select('quantity, price_at_order, food_items(name, category_id), orders!inner(is_paid, paid_at)')
      .eq('orders.is_paid', true)
      .gte('orders.paid_at', startISO).lte('orders.paid_at', endISO)
    if (itemErr) console.error('fetchCategoryStats items:', itemErr.message)
    const { data: cats } = await supabase.from('categories').select('id, name').eq('is_subcategory', false)
    const catMap = {}
    cats?.forEach(c => { catMap[c.id] = c.name })
    const map = {}
    items?.forEach(i => {
      const catId = i.food_items?.category_id
      const catName = catId ? (catMap[catId] || 'Uncategorized') : 'Uncategorized'
      if (!map[catName]) map[catName] = { name: catName, qty: 0, revenue: 0 }
      map[catName].qty += i.quantity
      map[catName].revenue += i.price_at_order * i.quantity
    })
    setCatStats(Object.values(map).sort((a, b) => b.revenue - a.revenue))
    setLoading(false)
  }

  // ── Fetch Table Stats ─────────────────────────────────────
  const fetchTableStats = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(tableFromDate, tableToDate)
    const { data: orders, error } = await supabase
      .from('orders')
      .select('table_name_snapshot, final_amount, paid_at, payment_type')
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
    if (error) console.error('fetchTableStats:', error.message)
    const bills = groupOrdersIntoBills(orders || [])
    const map = {}
    bills.forEach(b => {
      const tbl = b.table_name_snapshot || 'Unknown'
      if (!map[tbl]) map[tbl] = { name: tbl, bills: 0, revenue: 0, lastVisit: b.paid_at }
      map[tbl].bills += 1
      map[tbl].revenue += b.final_amount || 0
      if (b.paid_at > map[tbl].lastVisit) map[tbl].lastVisit = b.paid_at
    })
    setTableStats(Object.values(map).sort((a, b) => b.revenue - a.revenue))
    setLoading(false)
  }

  // ── Fetch Monthly — last 4 months ─────────────────────────
  const fetchMonthly = async () => {
    setLoading(true)
    // Calculate last 4 months
    const now = new Date()
    const months4 = []
    for (let i = 3; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months4.push({ year: d.getFullYear(), month: d.getMonth(), name: MONTH_NAMES[d.getMonth()] })
    }
    const startISO = new Date(`${months4[0].year}-${String(months4[0].month + 1).padStart(2,'0')}-01T00:00:00+05:30`).toISOString()
    const lastM = months4[3]
    const lastDay = new Date(lastM.year, lastM.month + 1, 0).getDate()
    const endISO = new Date(`${lastM.year}-${String(lastM.month + 1).padStart(2,'0')}-${lastDay}T23:59:59+05:30`).toISOString()

    const { data: orders, error } = await supabase
      .from('orders').select(ORDER_SELECT)
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
    if (error) console.error('fetchMonthly:', error.message)

    const bills = groupOrdersIntoBills(orders || [])

    // Build per-month data
    const mData = months4.map(m => ({
      ...m, revenue: 0, bills: 0, cash: 0, upi: 0, card: 0,
      serviceCharge: 0, discounts: 0,
      depts: { Kitchen: { revenue: 0, qty: 0 }, Bakery: { revenue: 0, qty: 0 }, Beverage: { revenue: 0, qty: 0 }, Liquor: { revenue: 0, qty: 0 } }
    }))

    bills.forEach(b => {
      const dateStr = new Date(b.paid_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const bYear = parseInt(dateStr.split('-')[0])
      const bMonth = parseInt(dateStr.split('-')[1]) - 1
      const mIdx = mData.findIndex(m => m.year === bYear && m.month === bMonth)
      if (mIdx < 0) return
      mData[mIdx].revenue += b.final_amount || 0
      mData[mIdx].bills += 1
      mData[mIdx].serviceCharge += b.service_charge_amt || 0
      mData[mIdx].discounts += b.discount_amt || 0
      if (b.payment_type === 'cash') mData[mIdx].cash += b.final_amount || 0
      if (b.payment_type === 'upi') mData[mIdx].upi += b.final_amount || 0
      if (b.payment_type === 'card') mData[mIdx].card += b.final_amount || 0
      // Department breakdown
      b.order_items?.forEach(item => {
        const dept = getDepartment(item.food_items?.name)
        mData[mIdx].depts[dept].revenue += item.price_at_order * item.quantity
        mData[mIdx].depts[dept].qty += item.quantity
      })
    })

    setMonthlyData(mData)
    setMonthlyLoaded(true)
    setLoading(false)
  }

  // ── Fetch Discounts ───────────────────────────────────────
  const fetchDiscounts = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(discFromDate, discToDate)
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, payment_type, paid_at, table_name_snapshot, subtotal, discount_type, discount_value, discount_amt, discount_reason, service_charge_pct, service_charge_amt, final_amount, order_items(quantity, price_at_order, food_items(name))')
      .eq('is_paid', true).gt('discount_amt', 0)
      .gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchDiscounts:', error.message)
    if (!orders || orders.length === 0) { setDiscData(null); setLoading(false); return }
    const bills = groupOrdersIntoBills(orders)
    const discountedBills = bills.filter(b => b.discount_amt > 0)
    const totalDiscount = discountedBills.reduce((s, b) => s + (b.discount_amt || 0), 0)
    const grossRevenue = discountedBills.reduce((s, b) => s + (b.subtotal || 0), 0)
    const reasonMap = {}
    discountedBills.forEach(b => {
      const r = b.discount_reason?.trim() || 'No reason given'
      if (!reasonMap[r]) reasonMap[r] = { reason: r, count: 0, total: 0 }
      reasonMap[r].count += 1
      reasonMap[r].total += b.discount_amt || 0
    })
    setDiscData({ bills: discountedBills, totalDiscount, grossRevenue, reasonBreakdown: Object.values(reasonMap).sort((a, b) => b.total - a.total) })
    setLoading(false)
  }

  // ── Fetch Settlement ──────────────────────────────────────
  const fetchSettlement = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(settlFromDate, settlToDate)
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, payment_type, paid_at, table_name_snapshot, subtotal, service_charge_pct, service_charge_amt, discount_type, discount_value, discount_amt, final_amount, order_items(quantity, price_at_order, food_items(name))')
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchSettlement:', error.message)
    if (!orders || orders.length === 0) { setSettlData(null); setLoading(false); return }
    const bills = groupOrdersIntoBills(orders)
    const cash = bills.filter(b => b.payment_type === 'cash')
    const upi = bills.filter(b => b.payment_type === 'upi')
    const card = bills.filter(b => b.payment_type === 'card')
    setSettlData({
      bills,
      cash: { count: cash.length, total: cash.reduce((s, b) => s + (b.final_amount || 0), 0) },
      upi: { count: upi.length, total: upi.reduce((s, b) => s + (b.final_amount || 0), 0) },
      card: { count: card.length, total: card.reduce((s, b) => s + (b.final_amount || 0), 0) },
      grandTotal: bills.reduce((s, b) => s + (b.final_amount || 0), 0),
      serviceTotal: bills.reduce((s, b) => s + (b.service_charge_amt || 0), 0),
      discountTotal: bills.reduce((s, b) => s + (b.discount_amt || 0), 0)
    })
    setLoading(false)
  }

  // ── Print Preview ─────────────────────────────────────────
  const openPrintPreview = (type) => {
    let data = null
    if (type === 'today' && todayReport) {
      data = { type: 'today', title: `Today — ${formatDate(new Date())}`, summary: todayReport, depts: todayDepts, bills: todayOrders }
    } else if (type === 'range' && rangeReport) {
      data = { type: 'range', title: `${formatDate(fromDate)} → ${formatDate(toDate)}`, summary: rangeReport, depts: rangeDepts, bills: rangeOrders }
    } else if (type === 'monthly' && monthlyLoaded) {
      data = { type: 'monthly', title: 'Monthly Summary (Last 4 Months)', monthlyData }
    }
    if (!data) return
    setPrintData(data)
    setShowPrintPreview(true)
  }

  const doPrint = () => {
    window.print()
  }

  // ── Excel Export ──────────────────────────────────────────
  // Replace: import * as XLSX from 'xlsx'
// With this pure JS CSV export — no package needed:

const exportToExcel = (type) => {
  const downloadCSV = (rows, filename) => {
    const csv = rows.map(r =>
      r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  if (type === 'today' || type === 'range') {
    const data = type === 'today'
      ? { summary: todayReport, depts: todayDepts, bills: todayOrders, title: `Today_${formatDate(new Date())}` }
      : { summary: rangeReport, depts: rangeDepts, bills: rangeOrders, title: `${formatDate(fromDate)}_to_${formatDate(toDate)}` }
    if (!data.summary) return

    const rows = [
      ['Sales Summary', data.title],
      [],
      ['Total Revenue', data.summary.totalRevenue],
      ['Total Bills', data.summary.totalOrders],
      ['Cash', data.summary.cashRev],
      ['UPI', data.summary.upiRev],
      ['Card', data.summary.cardRev],
      ['Service Charge', data.summary.scTotal],
      ['Discounts', data.summary.discountTotal],
      [],
      ['Department Breakdown'],
      ['Department', 'Revenue', 'Items Sold'],
    ]
    if (data.depts) {
      Object.entries(data.depts).forEach(([dept, d]) => {
        rows.push([dept, d.revenue, d.qty])
      })
    }
    rows.push([], ['Bill Details'])
    rows.push(['Table', 'Date', 'Time', 'Payment', 'Subtotal', 'Service Charge', 'Discount', 'Final Amount', 'Items'])
    data.bills.forEach(bill => {
      const itemStr = bill.order_items?.map(i => `${i.food_items?.name} x${i.quantity}`).join(' | ') || ''
      rows.push([
        bill.table_name_snapshot || 'Table',
        formatDate(bill.paid_at),
        toIST(bill.paid_at),
        bill.payment_type,
        bill.subtotal,
        bill.service_charge_amt,
        bill.discount_amt,
        bill.final_amount,
        itemStr
      ])
    })
    downloadCSV(rows, `Report_${data.title.replace(/[^a-zA-Z0-9]/g, '_')}.csv`)

  } else if (type === 'monthly') {
    if (!monthlyLoaded) return
    const rows = [
      ['Monthly Sales Summary — Last 4 Months'],
      [],
      ['Month', 'Bills', 'Revenue', 'Cash', 'UPI', 'Card', 'Service Charge', 'Discounts', 'Kitchen', 'Bakery', 'Beverage', 'Liquor']
    ]
    monthlyData.forEach(m => {
      rows.push([
        `${m.name} ${m.year}`, m.bills, m.revenue, m.cash, m.upi, m.card,
        m.serviceCharge, m.discounts,
        m.depts.Kitchen.revenue, m.depts.Bakery.revenue,
        m.depts.Beverage.revenue, m.depts.Liquor.revenue
      ])
    })
    rows.push([
      'TOTAL',
      monthlyData.reduce((s, m) => s + m.bills, 0),
      monthlyData.reduce((s, m) => s + m.revenue, 0),
      monthlyData.reduce((s, m) => s + m.cash, 0),
      monthlyData.reduce((s, m) => s + m.upi, 0),
      monthlyData.reduce((s, m) => s + m.card, 0),
      monthlyData.reduce((s, m) => s + m.serviceCharge, 0),
      monthlyData.reduce((s, m) => s + m.discounts, 0),
      monthlyData.reduce((s, m) => s + m.depts.Kitchen.revenue, 0),
      monthlyData.reduce((s, m) => s + m.depts.Bakery.revenue, 0),
      monthlyData.reduce((s, m) => s + m.depts.Beverage.revenue, 0),
      monthlyData.reduce((s, m) => s + m.depts.Liquor.revenue, 0),
    ])
    downloadCSV(rows, 'Monthly_Summary.csv')
  }
}

  // ── Reusable Components ───────────────────────────────────

  const PayBadge = ({ type }) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
      ${type === 'cash' ? 'bg-green-100 text-green-600'
        : type === 'upi' ? 'bg-blue-100 text-blue-600'
        : type === 'card' ? 'bg-purple-100 text-purple-600'
        : 'bg-gray-100 text-gray-500'}`}>
      {type === 'cash' ? '💵 Cash' : type === 'upi' ? '📱 UPI' : type === 'card' ? '💳 Card' : type || '—'}
    </span>
  )

  const DeptBreakdown = ({ depts }) => {
    if (!depts) return null
    const totalRevenue = Object.values(depts).reduce((s, d) => s + d.revenue, 0)
    return (
      <div className="bg-white rounded-2xl shadow p-5 mb-4">
        <h3 className="font-bold text-gray-700 mb-3">🏭 Department Breakdown</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(depts).map(([dept, d]) => {
            const c = DEPT_COLORS[dept]
            const pct = totalRevenue > 0 ? ((d.revenue / totalRevenue) * 100).toFixed(1) : 0
            return (
              <div key={dept} className={`${c.bg} border ${c.border} rounded-2xl p-4`}>
                <p className="text-xs text-gray-500 mb-1">{c.icon} {dept}</p>
                <p className={`text-xl font-bold ${c.text}`}>₹{d.revenue}</p>
                <p className="text-xs text-gray-400">{d.qty} items · {pct}%</p>
                <div className="w-full bg-white rounded-full h-1.5 mt-2">
                  <div className={`h-1.5 rounded-full ${dept === 'Kitchen' ? 'bg-orange-400' : dept === 'Bakery' ? 'bg-yellow-400' : dept === 'Beverage' ? 'bg-blue-400' : 'bg-purple-400'}`}
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const ReportSummary = ({ data }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
        <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
        <p className="text-2xl font-bold text-orange-600">₹{data.totalRevenue}</p>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
        <p className="text-xs text-gray-500 mb-1">Total Bills</p>
        <p className="text-2xl font-bold text-blue-600">{data.totalOrders}</p>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
        <p className="text-xs text-gray-500 mb-1">Service Charge</p>
        <p className="text-2xl font-bold text-gray-600">₹{data.scTotal}</p>
        {data.discountTotal > 0 && <p className="text-xs text-green-600 mt-1">Disc: -₹{data.discountTotal}</p>}
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <p className="text-xs text-gray-500 mb-2">By Payment</p>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-green-600">💵 Cash</span><span className="font-bold">₹{data.cashRev}</span></div>
          <div className="flex justify-between"><span className="text-blue-600">📱 UPI</span><span className="font-bold">₹{data.upiRev}</span></div>
          <div className="flex justify-between"><span className="text-purple-600">💳 Card</span><span className="font-bold">₹{data.cardRev}</span></div>
        </div>
      </div>
    </div>
  )

  const OrderCard = ({ bill, showDate = false }) => (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2"><span className="font-semibold text-gray-700">{bill.table_name_snapshot || 'Table'}</span><PayBadge type={bill.payment_type} /></div>
        <div className="text-right">
          <p className="font-bold text-orange-500">₹{bill.final_amount}</p>
          <p className="text-xs text-gray-400">{showDate ? `${formatDate(bill.paid_at)} ` : ''}{toIST(bill.paid_at)}</p>
        </div>
      </div>
      <div className="space-y-1 mb-2">
        {bill.order_items?.map((item, j) => (
          <div key={j} className="flex justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className={`text-xs px-1 rounded ${DEPT_COLORS[getDepartment(item.food_items?.name)]?.badge}`}>
                {DEPT_COLORS[getDepartment(item.food_items?.name)]?.icon}
              </span>
              {item.food_items?.name} × {item.quantity}
            </span>
            <span>₹{item.price_at_order * item.quantity}</span>
          </div>
        ))}
      </div>
      <div className="border-t pt-2 space-y-0.5">
        <div className="flex justify-between text-xs text-gray-400"><span>Subtotal</span><span>₹{bill.subtotal || 0}</span></div>
        {bill.service_charge_amt > 0 && <div className="flex justify-between text-xs text-gray-400"><span>Service ({bill.service_charge_pct}%)</span><span>₹{bill.service_charge_amt}</span></div>}
        {bill.discount_amt > 0 && <div className="flex justify-between text-xs text-green-600"><span>Discount {bill.discount_type === 'percent' ? `(${bill.discount_value}%)` : `(₹${bill.discount_value} flat)`}</span><span>-₹{bill.discount_amt}</span></div>}
        <div className="flex justify-between text-xs font-bold text-gray-700 pt-1 border-t"><span>Final</span><span className="text-orange-500">₹{bill.final_amount}</span></div>
      </div>
    </div>
  )

  const DateRangeFilter = ({ from, to, onFrom, onTo, onFetch, btnText = 'View Report' }) => (
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

  const EmptyState = ({ icon, text }) => (
    <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-2">{icon}</div><p>{text}</p></div>
  )

  const PrintExportBar = ({ type, hasData }) => (
    hasData ? (
      <div className="flex gap-2 mb-4 justify-end print:hidden">
        <button onClick={() => openPrintPreview(type)}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 flex items-center gap-2">
          🖨️ Print Preview
        </button>
        <button onClick={() => exportToExcel(type)}
          className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-600 flex items-center gap-2">
          📊 Export Excel
        </button>
      </div>
    ) : null
  )

  const TABS = [
    { id: 'today', label: '📅 Today' },
    { id: 'range', label: '📆 Date Range' },
    { id: 'items', label: '🔍 Item Search' },
    { id: 'category', label: '📊 Category' },
    { id: 'tables', label: '🪑 Table-wise' },
    { id: 'monthly', label: '📅 Monthly' },
    { id: 'discounts', label: '🎁 Discounts' },
    { id: 'settlement', label: '💰 Settlement' },
  ]

  const filteredItems = itemSearchQuery.trim()
    ? itemStats.filter(i => i.name.toLowerCase().includes(itemSearchQuery.toLowerCase()))
    : itemStats

  const monthlyMaxRevenue = Math.max(...monthlyData.map(m => m.revenue), 1)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Print Preview Modal */}
      {showPrintPreview && printData && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center">
              <div>
                <h2 className="font-bold text-gray-800 text-lg">🖨️ Print Preview</h2>
                <p className="text-xs text-gray-400">{printData.title}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={doPrint}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-600">
                  🖨️ Print
                </button>
                <button onClick={() => exportToExcel(printData.type)}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-600">
                  📊 Export Excel
                </button>
                <button onClick={() => setShowPrintPreview(false)}
                  className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium">
                  ✕ Close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 print:block" id="print-content">
              {/* Header */}
              <div className="text-center mb-4 border-b pb-3">
                <p className="font-bold text-xl">HOTEL KHALASI SEAFOOD & BAR</p>
                <p className="text-sm text-gray-500">DETAILED SALES SUMMARY</p>
                <p className="text-xs text-gray-400">{printData.title}</p>
                <p className="text-xs text-gray-400">Print Date: {formatDate(new Date())} {toIST(new Date().toISOString())}</p>
              </div>

              {/* Summary / Monthly */}
              {(printData.type === 'today' || printData.type === 'range') && printData.summary && (
                <>
                  <div className="mb-4">
                    <p className="font-bold text-sm border-b pb-1 mb-2">Sales Details</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span>Total Bills</span><span className="font-bold">{printData.summary.totalOrders}</span></div>
                      <div className="flex justify-between"><span>Total Revenue</span><span className="font-bold">Rs.{printData.summary.totalRevenue}</span></div>
                      <div className="flex justify-between text-gray-500"><span>Service Charge</span><span>Rs.{printData.summary.scTotal}</span></div>
                      {printData.summary.discountTotal > 0 && <div className="flex justify-between text-green-600"><span>Discounts Given</span><span>-Rs.{printData.summary.discountTotal}</span></div>}
                    </div>
                  </div>
                  <div className="mb-4">
                    <p className="font-bold text-sm border-b pb-1 mb-2">Payment Breakdown</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span>💵 Cash</span><span className="font-bold">Rs.{printData.summary.cashRev}</span></div>
                      <div className="flex justify-between"><span>📱 UPI / Online</span><span className="font-bold">Rs.{printData.summary.upiRev}</span></div>
                      <div className="flex justify-between"><span>💳 Card</span><span className="font-bold">Rs.{printData.summary.cardRev}</span></div>
                    </div>
                  </div>
                  {printData.depts && (
                    <div className="mb-4">
                      <p className="font-bold text-sm border-b pb-1 mb-2">Department Breakdown</p>
                      <div className="space-y-1 text-sm">
                        {Object.entries(printData.depts).map(([dept, d]) => {
                          const total = Object.values(printData.depts).reduce((s, x) => s + x.revenue, 0)
                          const pct = total > 0 ? ((d.revenue / total) * 100).toFixed(0) : 0
                          return (
                            <div key={dept} className="flex justify-between">
                              <span>{DEPT_COLORS[dept].icon} {dept}</span>
                              <span className="font-bold">Rs.{d.revenue} ({pct}%)</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <div className="mb-4">
                    <p className="font-bold text-sm border-b pb-1 mb-2">Bill Details ({printData.bills.length})</p>
                    <div className="space-y-2">
                      {printData.bills.map(bill => (
                        <div key={bill._key} className="text-xs border-b pb-2">
                          <div className="flex justify-between font-medium">
                            <span>{bill.table_name_snapshot} · {toIST(bill.paid_at)}</span>
                            <span>Rs.{bill.final_amount} ({bill.payment_type})</span>
                          </div>
                          {bill.order_items?.map((item, j) => (
                            <div key={j} className="flex justify-between text-gray-500 ml-2">
                              <span>{item.food_items?.name} × {item.quantity}</span>
                              <span>Rs.{item.price_at_order * item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {printData.type === 'monthly' && (
                <div>
                  <p className="font-bold text-sm border-b pb-1 mb-3">Monthly Summary (Last 4 Months)</p>
                  {printData.monthlyData.map(m => (
                    <div key={`${m.year}-${m.month}`} className="mb-4 border rounded-xl p-3">
                      <p className="font-bold text-sm mb-2">{m.name} {m.year}</p>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div className="flex justify-between"><span>Bills</span><span className="font-bold">{m.bills}</span></div>
                        <div className="flex justify-between"><span>Revenue</span><span className="font-bold">Rs.{m.revenue}</span></div>
                        <div className="flex justify-between"><span>Cash</span><span>Rs.{m.cash}</span></div>
                        <div className="flex justify-between"><span>UPI</span><span>Rs.{m.upi}</span></div>
                        <div className="flex justify-between"><span>Card</span><span>Rs.{m.card}</span></div>
                        <div className="flex justify-between"><span>Service Charge</span><span>Rs.{m.serviceCharge}</span></div>
                      </div>
                      <div className="mt-2 pt-2 border-t text-xs">
                        <p className="font-medium mb-1">Department</p>
                        {Object.entries(m.depts).map(([dept, d]) => (
                          <div key={dept} className="flex justify-between">
                            <span>{DEPT_COLORS[dept].icon} {dept}</span>
                            <span className="font-bold">Rs.{d.revenue}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <h1 className="text-lg font-bold text-orange-500">Reports</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/admin/dashboard')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
            ← Dashboard
          </button>
        </div>
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

        {loading && <div className="text-center py-8 text-gray-400">Loading...</div>}

        {/* TODAY */}
        {activeTab === 'today' && !loading && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-700">📅 Today — {formatDate(new Date())}</h2>
              <button onClick={fetchToday}
                className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
                🔄 Refresh
              </button>
            </div>
            {!todayReport
              ? <EmptyState icon="📭" text="No paid orders today yet." />
              : <>
                  <PrintExportBar type="today" hasData={!!todayReport} />
                  <ReportSummary data={todayReport} />
                  <DeptBreakdown depts={todayDepts} />
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">Bill Details ({todayOrders.length})</h3>
                    <div className="space-y-3">
                      {todayOrders.map(bill => <OrderCard key={bill._key} bill={bill} />)}
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* DATE RANGE */}
        {activeTab === 'range' && !loading && (
          <div>
            <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} onFetch={fetchRange} />
            {!rangeReport
              ? <EmptyState icon="📊" text="Select a date range and click View Report" />
              : <>
                  <h2 className="text-lg font-bold text-gray-700 mb-4">{formatDate(fromDate)} → {formatDate(toDate)}</h2>
                  <PrintExportBar type="range" hasData={!!rangeReport} />
                  <ReportSummary data={rangeReport} />
                  <DeptBreakdown depts={rangeDepts} />
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">All Bills ({rangeOrders.length})</h3>
                    <div className="space-y-3">
                      {rangeOrders.map(bill => <OrderCard key={bill._key} bill={bill} showDate />)}
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* ITEM SEARCH */}
        {activeTab === 'items' && !loading && (
          <div>
            <DateRangeFilter from={itemFromDate} to={itemToDate} onFrom={setItemFromDate} onTo={setItemToDate} onFetch={fetchItemStats} btnText="Search Items" />
            {itemStats.length > 0 && (
              <div className="bg-white rounded-2xl shadow p-4 mb-4">
                <input type="text" value={itemSearchQuery} onChange={e => setItemSearchQuery(e.target.value)}
                  placeholder="🔍 Search item e.g. Ice Cream, Chicken Tikka..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50" />
                {itemSearchQuery && <p className="text-xs text-gray-400 mt-2">Showing {filteredItems.length} of {itemStats.length} items</p>}
              </div>
            )}
            {itemStats.length === 0
              ? <EmptyState icon="🔍" text="Select date range and click Search Items" />
              : filteredItems.length === 0
                ? <EmptyState icon="😕" text={`No item found for "${itemSearchQuery}"`} />
                : <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-4">
                      {itemSearchQuery ? `Results for "${itemSearchQuery}"` : `🏆 All Items (${filteredItems.length})`}
                    </h3>
                    <div className="space-y-3">
                      {filteredItems.map((item, index) => {
                        const c = DEPT_COLORS[item.dept]
                        return (
                          <div key={item.name} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
                            <span className="text-lg font-bold w-8 text-center flex-shrink-0">
                              {!itemSearchQuery ? (index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`) : '🔍'}
                            </span>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-semibold text-gray-700">{item.name}</p>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.badge}`}>{c.icon} {item.dept}</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div className="bg-orange-400 h-1.5 rounded-full"
                                  style={{ width: `${Math.min((item.qty / (itemStats[0]?.qty || 1)) * 100, 100)}%` }} />
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-bold text-orange-500">{item.qty} sold</p>
                              <p className="text-xs text-gray-400">₹{item.revenue}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
            }
          </div>
        )}

        {/* CATEGORY */}
        {activeTab === 'category' && !loading && (
          <div>
            <DateRangeFilter from={catFromDate} to={catToDate} onFrom={setCatFromDate} onTo={setCatToDate} onFetch={fetchCategoryStats} btnText="View Categories" />
            {catStats.length === 0
              ? <EmptyState icon="📊" text="Select date range and click View Categories" />
              : <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    {catStats.map(cat => (
                      <div key={cat.name} className="bg-white border border-gray-200 rounded-2xl p-4">
                        <p className="text-xs text-gray-500 mb-1 truncate">{cat.name}</p>
                        <p className="text-xl font-bold text-orange-600">₹{cat.revenue}</p>
                        <p className="text-xs text-gray-400">{cat.qty} items sold</p>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                          <div className="bg-orange-400 h-1.5 rounded-full"
                            style={{ width: `${Math.min((cat.revenue / (catStats[0]?.revenue || 1)) * 100, 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">Category Breakdown</h3>
                    <table className="w-full text-sm">
                      <thead><tr className="border-b">
                        <th className="text-left py-2 text-xs text-gray-500">Category</th>
                        <th className="text-right py-2 text-xs text-gray-500">Items Sold</th>
                        <th className="text-right py-2 text-xs text-gray-500">Revenue</th>
                        <th className="text-right py-2 text-xs text-gray-500">Share</th>
                      </tr></thead>
                      <tbody>
                        {catStats.map(cat => {
                          const total = catStats.reduce((s, c) => s + c.revenue, 0)
                          const share = total > 0 ? ((cat.revenue / total) * 100).toFixed(1) : 0
                          return (
                            <tr key={cat.name} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2 font-medium text-gray-700">{cat.name}</td>
                              <td className="py-2 text-right text-gray-500">{cat.qty}</td>
                              <td className="py-2 text-right font-bold text-orange-500">₹{cat.revenue}</td>
                              <td className="py-2 text-right text-gray-400">{share}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
            }
          </div>
        )}

        {/* TABLE-WISE */}
        {activeTab === 'tables' && !loading && (
          <div>
            <DateRangeFilter from={tableFromDate} to={tableToDate} onFrom={setTableFromDate} onTo={setTableToDate} onFetch={fetchTableStats} btnText="View Tables" />
            {tableStats.length === 0
              ? <EmptyState icon="🪑" text="Select date range and click View Tables" />
              : <div className="bg-white rounded-2xl shadow p-5">
                  <h3 className="font-bold text-gray-700 mb-4">Table Performance ({tableStats.length} tables)</h3>
                  <div className="space-y-3">
                    {tableStats.map((tbl, i) => (
                      <div key={tbl.name} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
                        <span className="text-lg font-bold w-8 text-center flex-shrink-0">
                          {i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                        </span>
                        <div className="flex-1">
                          <p className="font-bold text-gray-700">{tbl.name}</p>
                          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                            <div className="bg-orange-400 h-1.5 rounded-full"
                              style={{ width: `${Math.min((tbl.revenue / (tableStats[0]?.revenue || 1)) * 100, 100)}%` }} />
                          </div>
                          <p className="text-xs text-gray-400 mt-1">Last visit: {formatDate(tbl.lastVisit)}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-orange-500">₹{tbl.revenue}</p>
                          <p className="text-xs text-gray-400">{tbl.bills} bills</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
            }
          </div>
        )}

        {/* MONTHLY — Last 4 Months */}
        {activeTab === 'monthly' && !loading && (
          <div>
            <div className="bg-white rounded-2xl shadow p-5 mb-4 flex justify-between items-center flex-wrap gap-3">
              <div>
                <p className="font-bold text-gray-700">Last 4 Months Summary</p>
                <p className="text-xs text-gray-400">Auto-calculated from today going back 4 months</p>
              </div>
              <button onClick={fetchMonthly}
                className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                Load Summary
              </button>
            </div>

            {!monthlyLoaded
              ? <EmptyState icon="📅" text="Click Load Summary to view last 4 months" />
              : <>
                  <PrintExportBar type="monthly" hasData={monthlyLoaded} />

                  {/* Overall totals */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">4-Month Total Revenue</p>
                      <p className="text-3xl font-bold text-orange-600">₹{monthlyData.reduce((s, m) => s + m.revenue, 0)}</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Total Bills</p>
                      <p className="text-3xl font-bold text-blue-600">{monthlyData.reduce((s, m) => s + m.bills, 0)}</p>
                    </div>
                  </div>

                  {/* Bar chart */}
                  <div className="bg-white rounded-2xl shadow p-5 mb-4">
                    <h3 className="font-bold text-gray-700 mb-4">Revenue Chart</h3>
                    <div className="flex items-end gap-3" style={{ height: '140px' }}>
                      {monthlyData.map(m => (
                        <div key={`${m.year}-${m.month}`} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-end" style={{ height: '110px' }}>
                            <div className="w-full bg-orange-400 rounded-t-lg hover:bg-orange-500 transition cursor-pointer"
                              style={{ height: `${(m.revenue / monthlyMaxRevenue) * 100}%`, minHeight: m.revenue > 0 ? '4px' : '0' }}
                              title={`${m.name} ${m.year}: ₹${m.revenue}`} />
                          </div>
                          <p className="text-xs text-gray-500">{m.name}</p>
                          <p className="text-xs font-bold text-orange-500">₹{m.revenue}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Per month cards with dept breakdown */}
                  <div className="space-y-4 mb-4">
                    {monthlyData.map(m => (
                      <div key={`${m.year}-${m.month}`} className="bg-white rounded-2xl shadow p-5">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="font-bold text-gray-700 text-lg">{m.name} {m.year}</h3>
                          <div className="text-right">
                            <p className="font-bold text-orange-500 text-xl">₹{m.revenue}</p>
                            <p className="text-xs text-gray-400">{m.bills} bills</p>
                          </div>
                        </div>

                        {/* Dept breakdown */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                          {Object.entries(m.depts).map(([dept, d]) => {
                            const c = DEPT_COLORS[dept]
                            const totalDept = Object.values(m.depts).reduce((s, x) => s + x.revenue, 0)
                            const pct = totalDept > 0 ? ((d.revenue / totalDept) * 100).toFixed(0) : 0
                            return (
                              <div key={dept} className={`${c.bg} border ${c.border} rounded-xl p-3`}>
                                <p className="text-xs text-gray-500">{c.icon} {dept}</p>
                                <p className={`font-bold ${c.text}`}>₹{d.revenue}</p>
                                <p className="text-xs text-gray-400">{pct}%</p>
                              </div>
                            )
                          })}
                        </div>

                        {/* Payment + SC */}
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="bg-green-50 rounded-lg p-2 text-center">
                            <p className="text-gray-500">💵 Cash</p>
                            <p className="font-bold text-green-600">₹{m.cash}</p>
                          </div>
                          <div className="bg-blue-50 rounded-lg p-2 text-center">
                            <p className="text-gray-500">📱 UPI</p>
                            <p className="font-bold text-blue-600">₹{m.upi}</p>
                          </div>
                          <div className="bg-purple-50 rounded-lg p-2 text-center">
                            <p className="text-gray-500">💳 Card</p>
                            <p className="font-bold text-purple-600">₹{m.card}</p>
                          </div>
                        </div>
                        {(m.serviceCharge > 0 || m.discounts > 0) && (
                          <div className="flex justify-between text-xs text-gray-500 mt-2 pt-2 border-t">
                            {m.serviceCharge > 0 && <span>SC: ₹{m.serviceCharge}</span>}
                            {m.discounts > 0 && <span className="text-green-600">Disc: -₹{m.discounts}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Summary table */}
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">Comparison Table</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b">
                          <th className="text-left py-2 text-xs text-gray-500">Month</th>
                          <th className="text-right py-2 text-xs text-gray-500">Bills</th>
                          <th className="text-right py-2 text-xs text-gray-500">Revenue</th>
                          <th className="text-right py-2 text-xs text-gray-500">🍳 Kitchen</th>
                          <th className="text-right py-2 text-xs text-gray-500">🥖 Bakery</th>
                          <th className="text-right py-2 text-xs text-gray-500">🥤 Bev</th>
                          <th className="text-right py-2 text-xs text-gray-500">🍺 Liquor</th>
                        </tr></thead>
                        <tbody>
                          {monthlyData.map(m => (
                            <tr key={`${m.year}-${m.month}`} className={`border-b border-gray-50 hover:bg-gray-50 ${m.revenue === 0 ? 'opacity-40' : ''}`}>
                              <td className="py-2 font-medium text-gray-700">{m.name} {m.year}</td>
                              <td className="py-2 text-right text-gray-500">{m.bills}</td>
                              <td className="py-2 text-right font-bold text-orange-500">₹{m.revenue}</td>
                              <td className="py-2 text-right text-orange-600">₹{m.depts.Kitchen.revenue}</td>
                              <td className="py-2 text-right text-yellow-600">₹{m.depts.Bakery.revenue}</td>
                              <td className="py-2 text-right text-blue-600">₹{m.depts.Beverage.revenue}</td>
                              <td className="py-2 text-right text-purple-600">₹{m.depts.Liquor.revenue}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot><tr className="border-t-2 border-gray-200 font-bold">
                          <td className="py-2 text-gray-700">Total</td>
                          <td className="py-2 text-right">{monthlyData.reduce((s, m) => s + m.bills, 0)}</td>
                          <td className="py-2 text-right text-orange-500">₹{monthlyData.reduce((s, m) => s + m.revenue, 0)}</td>
                          <td className="py-2 text-right text-orange-600">₹{monthlyData.reduce((s, m) => s + m.depts.Kitchen.revenue, 0)}</td>
                          <td className="py-2 text-right text-yellow-600">₹{monthlyData.reduce((s, m) => s + m.depts.Bakery.revenue, 0)}</td>
                          <td className="py-2 text-right text-blue-600">₹{monthlyData.reduce((s, m) => s + m.depts.Beverage.revenue, 0)}</td>
                          <td className="py-2 text-right text-purple-600">₹{monthlyData.reduce((s, m) => s + m.depts.Liquor.revenue, 0)}</td>
                        </tr></tfoot>
                      </table>
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* DISCOUNTS */}
        {activeTab === 'discounts' && !loading && (
          <div>
            <DateRangeFilter from={discFromDate} to={discToDate} onFrom={setDiscFromDate} onTo={setDiscToDate} onFetch={fetchDiscounts} btnText="View Discounts" />
            {!discData
              ? <EmptyState icon="🎁" text="Select date range and click View Discounts" />
              : <>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Total Discounts Given</p>
                      <p className="text-3xl font-bold text-green-600">₹{discData.totalDiscount}</p>
                      <p className="text-xs text-gray-400 mt-1">{discData.bills.length} bills had discount</p>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Gross Before Discount</p>
                      <p className="text-3xl font-bold text-orange-600">₹{discData.grossRevenue}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {discData.grossRevenue > 0 ? `${((discData.totalDiscount / discData.grossRevenue) * 100).toFixed(1)}% given away` : ''}
                      </p>
                    </div>
                  </div>
                  {discData.reasonBreakdown.length > 0 && (
                    <div className="bg-white rounded-2xl shadow p-5 mb-4">
                      <h3 className="font-bold text-gray-700 mb-3">By Reason</h3>
                      <div className="space-y-2">
                        {discData.reasonBreakdown.map(r => (
                          <div key={r.reason} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
                            <div><p className="font-medium text-gray-700 text-sm">{r.reason}</p><p className="text-xs text-gray-400">{r.count} bill(s)</p></div>
                            <p className="font-bold text-green-600">-₹{r.total}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">All Discounted Bills</h3>
                    <div className="space-y-3">
                      {discData.bills.map(bill => (
                        <div key={bill._key} className="border border-green-100 rounded-xl p-4 bg-green-50">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="font-semibold text-gray-700">{bill.table_name_snapshot || 'Table'}</p>
                              <p className="text-xs text-gray-400">{formatDate(bill.paid_at)} • {toIST(bill.paid_at)}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-green-600 font-bold text-lg">-₹{bill.discount_amt}</p>
                              <p className="text-xs text-gray-400">{bill.discount_type === 'percent' ? `${bill.discount_value}% off` : `₹${bill.discount_value} flat`}</p>
                            </div>
                          </div>
                          <div className="bg-white rounded-lg px-3 py-2 mb-2">
                            <p className="text-xs text-gray-700"><span className="font-medium">📝 Reason: </span>{bill.discount_reason || <span className="text-gray-400 italic">No reason given</span>}</p>
                          </div>
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>Subtotal: ₹{bill.subtotal}</span>
                            <span className="text-orange-500 font-bold">Final: ₹{bill.final_amount}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* SETTLEMENT */}
        {activeTab === 'settlement' && !loading && (
          <div>
            <DateRangeFilter from={settlFromDate} to={settlToDate} onFrom={setSettlFromDate} onTo={setSettlToDate} onFetch={fetchSettlement} btnText="View Settlement" />
            {!settlData
              ? <EmptyState icon="💰" text="Select date range and click View Settlement" />
              : <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 col-span-2 md:col-span-1">
                      <p className="text-xs text-gray-500 mb-1">Grand Total</p>
                      <p className="text-3xl font-bold text-orange-600">₹{settlData.grandTotal}</p>
                      <p className="text-xs text-gray-400 mt-1">{settlData.bills.length} bills</p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">💵 Cash</p>
                      <p className="text-2xl font-bold text-green-600">₹{settlData.cash.total}</p>
                      <p className="text-xs text-gray-400">{settlData.cash.count} bills</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">📱 UPI</p>
                      <p className="text-2xl font-bold text-blue-600">₹{settlData.upi.total}</p>
                      <p className="text-xs text-gray-400">{settlData.upi.count} bills</p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">💳 Card</p>
                      <p className="text-2xl font-bold text-purple-600">₹{settlData.card.total}</p>
                      <p className="text-xs text-gray-400">{settlData.card.count} bills</p>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-5 mb-4 space-y-2 text-sm">
                    <div className="flex justify-between text-gray-600"><span>Service Charges Collected</span><span className="font-bold">₹{settlData.serviceTotal}</span></div>
                    {settlData.discountTotal > 0 && <div className="flex justify-between text-green-600"><span>Total Discounts Given</span><span className="font-bold">-₹{settlData.discountTotal}</span></div>}
                    <div className="flex justify-between text-gray-600 border-t pt-2 font-bold"><span>Net (excl. service charge)</span><span>₹{settlData.grandTotal - settlData.serviceTotal}</span></div>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">All Transactions</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b">
                          <th className="text-left py-2 text-xs text-gray-500">Time</th>
                          <th className="text-left py-2 text-xs text-gray-500">Table</th>
                          <th className="text-left py-2 text-xs text-gray-500">Payment</th>
                          <th className="text-right py-2 text-xs text-gray-500">Subtotal</th>
                          <th className="text-right py-2 text-xs text-gray-500">SC</th>
                          <th className="text-right py-2 text-xs text-gray-500">Disc</th>
                          <th className="text-right py-2 text-xs text-gray-500">Total</th>
                        </tr></thead>
                        <tbody>
                          {settlData.bills.map(bill => (
                            <tr key={bill._key} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2 text-xs text-gray-400">{formatDate(bill.paid_at)}<br />{toIST(bill.paid_at)}</td>
                              <td className="py-2 font-medium text-gray-700">{bill.table_name_snapshot || 'Table'}</td>
                              <td className="py-2"><PayBadge type={bill.payment_type} /></td>
                              <td className="py-2 text-right text-gray-600">₹{bill.subtotal || 0}</td>
                              <td className="py-2 text-right text-gray-400">{bill.service_charge_amt > 0 ? `₹${bill.service_charge_amt}` : '—'}</td>
                              <td className="py-2 text-right text-green-600">{bill.discount_amt > 0 ? `-₹${bill.discount_amt}` : '—'}</td>
                              <td className="py-2 text-right font-bold text-orange-500">₹{bill.final_amount}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot><tr className="border-t-2 border-gray-200">
                          <td colSpan={6} className="py-2 font-bold text-gray-700">Grand Total</td>
                          <td className="py-2 text-right font-bold text-orange-500 text-lg">₹{settlData.grandTotal}</td>
                        </tr></tfoot>
                      </table>
                    </div>
                  </div>
                </>
            }
          </div>
        )}
      </div>
    </div>
  )
}