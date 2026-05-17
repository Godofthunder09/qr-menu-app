import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'   // ✅ FIX 1: was 'react-router-exist'
import { supabase } from '../supabase/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

const toIST = (d) =>
  new Date(d).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
  })

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  })

const todayIST = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

// ── SELECT string (used by Today + Range tabs) ─────────────────────────────

const ORDER_SELECT = `
  id, payment_type, is_paid, paid_at,
  subtotal, service_charge_pct, service_charge_amt,
  discount_type, discount_value, discount_amt, discount_reason,
  final_amount, table_name_snapshot,
  order_items(quantity, price_at_order, food_items(name))
`

// ── FIX 2: groupOrdersIntoBills now correctly ACCUMULATES final_amount,
//    subtotal, service_charge_amt, discount_amt when merging orders.
//    Previously only the first order's amounts were kept; all others were lost.
// ─────────────────────────────────────────────────────────────────────────────

const groupOrdersIntoBills = (orders) => {
  const map = {}
  orders.forEach((order) => {
    const minuteKey = order.paid_at
      ? order.paid_at.substring(0, 16)
      : order.id
    const key = `${order.table_name_snapshot || ''}__${minuteKey}`

    if (!map[key]) {
      map[key] = {
        _orderIds: [order.id],
        _key: key,
        id: order.id,
        payment_type: order.payment_type,
        paid_at: order.paid_at,
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
      // ✅ FIX 2: accumulate ALL monetary fields, not just order_items
      map[key]._orderIds.push(order.id)
      map[key].subtotal += order.subtotal || 0
      map[key].service_charge_amt += order.service_charge_amt || 0
      map[key].discount_amt += order.discount_amt || 0
      map[key].final_amount += order.final_amount || 0
      map[key].order_items = [
        ...map[key].order_items,
        ...(order.order_items || []),
      ]
    }
  })
  return Object.values(map)
}

// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const buildSummary = (bills) => {
  const totalRevenue = bills.reduce((s, b) => s + (b.final_amount || 0), 0)
  const cashRev = bills
    .filter((b) => b.payment_type === 'cash')
    .reduce((s, b) => s + (b.final_amount || 0), 0)
  const upiRev = bills
    .filter((b) => b.payment_type === 'upi')
    .reduce((s, b) => s + (b.final_amount || 0), 0)
  const cardRev = bills
    .filter((b) => b.payment_type === 'card')
    .reduce((s, b) => s + (b.final_amount || 0), 0)
  const scTotal = bills.reduce((s, b) => s + (b.service_charge_amt || 0), 0)
  const discountTotal = bills.reduce((s, b) => s + (b.discount_amt || 0), 0)
  return {
    totalRevenue, cashRev, upiRev, cardRev,
    scTotal, discountTotal, totalOrders: bills.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Reports() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('today')
  const [loading, setLoading] = useState(false)

  // today
  const [todayOrders, setTodayOrders] = useState([])
  const [todayReport, setTodayReport] = useState(null)

  // range
  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate, setToDate] = useState(todayIST())
  const [rangeOrders, setRangeOrders] = useState([])
  const [rangeReport, setRangeReport] = useState(null)

  // items
  const [itemFromDate, setItemFromDate] = useState(todayIST())
  const [itemToDate, setItemToDate] = useState(todayIST())
  const [itemStats, setItemStats] = useState([])
  const [itemSearchQuery, setItemSearchQuery] = useState('')

  // category
  const [catFromDate, setCatFromDate] = useState(todayIST())
  const [catToDate, setCatToDate] = useState(todayIST())
  const [catStats, setCatStats] = useState([])

  // tables
  const [tableFromDate, setTableFromDate] = useState(todayIST())
  const [tableToDate, setTableToDate] = useState(todayIST())
  const [tableStats, setTableStats] = useState([])

  // monthly
  const [monthlyYear, setMonthlyYear] = useState(new Date().getFullYear())
  const [monthlyData, setMonthlyData] = useState([])

  // discounts
  const [discFromDate, setDiscFromDate] = useState(todayIST())
  const [discToDate, setDiscToDate] = useState(todayIST())
  const [discData, setDiscData] = useState(null)

  // settlement
  const [settlFromDate, setSettlFromDate] = useState(todayIST())
  const [settlToDate, setSettlToDate] = useState(todayIST())
  const [settlData, setSettlData] = useState(null)

  useEffect(() => { fetchToday() }, [])

  const toRange = (from, to) => ({
    startISO: new Date(from + 'T00:00:00+05:30').toISOString(),
    endISO: new Date(to + 'T23:59:59+05:30').toISOString(),
  })

  // ── Fetch: Today ────────────────────────────────────────────────────────────

  const fetchToday = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(todayIST(), todayIST())
    const { data: orders, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchToday:', error.message)
    const bills = groupOrdersIntoBills(orders || [])
    setTodayOrders(bills)
    setTodayReport(bills.length > 0 ? buildSummary(bills) : null)
    setLoading(false)
  }

  // ── Fetch: Date Range ───────────────────────────────────────────────────────

  const fetchRange = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(fromDate, toDate)
    const { data: orders, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchRange:', error.message)
    const bills = groupOrdersIntoBills(orders || [])
    setRangeOrders(bills)
    setRangeReport(bills.length > 0 ? buildSummary(bills) : null)
    setLoading(false)
  }

  // ── FIX 3: Item Stats — inner join avoids .in() URL-length limit ───────────
  //   Old approach: fetch order IDs → .in(order_id, [...ids])
  //   Problem: Supabase encodes this in the URL; 200+ orders silently truncates.
  //   New approach: join order_items → orders directly with filters on orders.
  // ─────────────────────────────────────────────────────────────────────────────

  const fetchItemStats = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(itemFromDate, itemToDate)

    const { data: items, error } = await supabase
      .from('order_items')
      .select(`
        quantity,
        price_at_order,
        food_items(name),
        orders!inner(is_paid, paid_at)
      `)
      .eq('orders.is_paid', true)
      .gte('orders.paid_at', startISO)
      .lte('orders.paid_at', endISO)

    if (error) console.error('fetchItemStats:', error.message)

    const map = {}
    items?.forEach((i) => {
      const name = i.food_items?.name || 'Unknown'
      if (!map[name]) map[name] = { name, qty: 0, revenue: 0 }
      map[name].qty += i.quantity
      map[name].revenue += i.price_at_order * i.quantity
    })
    setItemStats(Object.values(map).sort((a, b) => b.qty - a.qty))
    setLoading(false)
  }

  // ── FIX 4: Category Stats — same inner-join fix ───────────────────────────

  const fetchCategoryStats = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(catFromDate, catToDate)

    const { data: items, error: itemErr } = await supabase
      .from('order_items')
      .select(`
        quantity,
        price_at_order,
        food_items(name, category_id),
        orders!inner(is_paid, paid_at)
      `)
      .eq('orders.is_paid', true)
      .gte('orders.paid_at', startISO)
      .lte('orders.paid_at', endISO)

    if (itemErr) console.error('fetchCategoryStats items:', itemErr.message)

    const { data: cats, error: catErr } = await supabase
      .from('categories')
      .select('id, name')
      .eq('is_subcategory', false)

    if (catErr) console.error('fetchCategoryStats cats:', catErr.message)

    const catMap = {}
    cats?.forEach((c) => { catMap[c.id] = c.name })

    const map = {}
    items?.forEach((i) => {
      const catId = i.food_items?.category_id
      const catName = catId ? (catMap[catId] || 'Uncategorized') : 'Uncategorized'
      if (!map[catName]) map[catName] = { name: catName, qty: 0, revenue: 0 }
      map[catName].qty += i.quantity
      map[catName].revenue += i.price_at_order * i.quantity
    })
    setCatStats(Object.values(map).sort((a, b) => b.revenue - a.revenue))
    setLoading(false)
  }

  // ── Fetch: Table Stats ──────────────────────────────────────────────────────

  const fetchTableStats = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(tableFromDate, tableToDate)
    const { data: orders, error } = await supabase
      .from('orders')
      .select('table_name_snapshot, final_amount, paid_at, payment_type')
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
    if (error) console.error('fetchTableStats:', error.message)

    const map = {}
    orders?.forEach((o) => {
      const tbl = o.table_name_snapshot || 'Unknown'
      if (!map[tbl]) map[tbl] = { name: tbl, bills: 0, revenue: 0, lastVisit: o.paid_at }
      map[tbl].bills += 1
      map[tbl].revenue += o.final_amount || 0
      if (o.paid_at > map[tbl].lastVisit) map[tbl].lastVisit = o.paid_at
    })
    setTableStats(Object.values(map).sort((a, b) => b.revenue - a.revenue))
    setLoading(false)
  }

  // ── Fetch: Monthly ──────────────────────────────────────────────────────────

  const fetchMonthly = async () => {
    setLoading(true)
    const startISO = new Date(`${monthlyYear}-01-01T00:00:00+05:30`).toISOString()
    const endISO = new Date(`${monthlyYear}-12-31T23:59:59+05:30`).toISOString()
    const { data: orders, error } = await supabase
      .from('orders')
      .select('paid_at, final_amount, payment_type, service_charge_amt, discount_amt')
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
    if (error) console.error('fetchMonthly:', error.message)

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i, name: MONTH_NAMES[i],
      revenue: 0, bills: 0, cash: 0, upi: 0, card: 0,
      serviceCharge: 0, discounts: 0,
    }))
    orders?.forEach((o) => {
      const dateStr = new Date(o.paid_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const monthIdx = parseInt(dateStr.split('-')[1]) - 1
      if (monthIdx >= 0 && monthIdx < 12) {
        months[monthIdx].revenue += o.final_amount || 0
        months[monthIdx].bills += 1
        months[monthIdx].serviceCharge += o.service_charge_amt || 0
        months[monthIdx].discounts += o.discount_amt || 0
        if (o.payment_type === 'cash') months[monthIdx].cash += o.final_amount || 0
        if (o.payment_type === 'upi') months[monthIdx].upi += o.final_amount || 0
        if (o.payment_type === 'card') months[monthIdx].card += o.final_amount || 0
      }
    })
    setMonthlyData(months)
    setLoading(false)
  }

  // ── FIX 5: Discounts — added order_items to SELECT so bill cards show items ─
  //   Previously select had no order_items, so groupOrdersIntoBills always
  //   produced empty order_items arrays. Silent data loss.
  // ─────────────────────────────────────────────────────────────────────────────

  const fetchDiscounts = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(discFromDate, discToDate)
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, payment_type, paid_at, table_name_snapshot,
        subtotal, discount_type, discount_value, discount_amt, discount_reason,
        service_charge_pct, service_charge_amt, final_amount,
        order_items(quantity, price_at_order, food_items(name))
      `)
      .eq('is_paid', true)
      .gt('discount_amt', 0)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchDiscounts:', error.message)

    if (!orders || orders.length === 0) {
      setDiscData(null)
      setLoading(false)
      return
    }

    const bills = groupOrdersIntoBills(orders)
    const discountedBills = bills.filter((b) => b.discount_amt > 0)
    const totalDiscount = discountedBills.reduce((s, b) => s + (b.discount_amt || 0), 0)
    const grossRevenue = discountedBills.reduce((s, b) => s + (b.subtotal || 0), 0)

    const reasonMap = {}
    discountedBills.forEach((b) => {
      const r = b.discount_reason?.trim() || 'No reason given'
      if (!reasonMap[r]) reasonMap[r] = { reason: r, count: 0, total: 0 }
      reasonMap[r].count += 1
      reasonMap[r].total += b.discount_amt || 0
    })

    setDiscData({
      bills: discountedBills,
      totalDiscount,
      grossRevenue,
      reasonBreakdown: Object.values(reasonMap).sort((a, b) => b.total - a.total),
    })
    setLoading(false)
  }

  // ── FIX 6: Settlement — added order_items to SELECT (same reason as above) ─

  const fetchSettlement = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(settlFromDate, settlToDate)
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, payment_type, paid_at, table_name_snapshot,
        subtotal, service_charge_pct, service_charge_amt,
        discount_type, discount_value, discount_amt, final_amount,
        order_items(quantity, price_at_order, food_items(name))
      `)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchSettlement:', error.message)

    if (!orders || orders.length === 0) {
      setSettlData(null)
      setLoading(false)
      return
    }

    const bills = groupOrdersIntoBills(orders)
    const cash = bills.filter((b) => b.payment_type === 'cash')
    const upi = bills.filter((b) => b.payment_type === 'upi')
    const card = bills.filter((b) => b.payment_type === 'card')

    setSettlData({
      bills,
      cash: { count: cash.length, total: cash.reduce((s, b) => s + (b.final_amount || 0), 0) },
      upi: { count: upi.length, total: upi.reduce((s, b) => s + (b.final_amount || 0), 0) },
      card: { count: card.length, total: card.reduce((s, b) => s + (b.final_amount || 0), 0) },
      grandTotal: bills.reduce((s, b) => s + (b.final_amount || 0), 0),
      serviceTotal: bills.reduce((s, b) => s + (b.service_charge_amt || 0), 0),
      discountTotal: bills.reduce((s, b) => s + (b.discount_amt || 0), 0),
    })
    setLoading(false)
  }

  // ── Reusable UI Components ─────────────────────────────────────────────────

  const PayBadge = ({ type }) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
      ${type === 'cash'  ? 'bg-green-100 text-green-600'
      : type === 'upi'  ? 'bg-blue-100 text-blue-600'
      : type === 'card' ? 'bg-purple-100 text-purple-600'
      : 'bg-gray-100 text-gray-500'}`}>
      {type === 'cash' ? '💵 Cash' : type === 'upi' ? '📱 UPI' : type === 'card' ? '💳 Card' : type || '—'}
    </span>
  )

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
        {data.discountTotal > 0 && (
          <p className="text-xs text-green-600 mt-1">Disc: -₹{data.discountTotal}</p>
        )}
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <p className="text-xs text-gray-500 mb-2">By Payment</p>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-green-600">💵 Cash</span>
            <span className="font-bold">₹{data.cashRev}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-600">📱 UPI</span>
            <span className="font-bold">₹{data.upiRev}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-purple-600">💳 Card</span>
            <span className="font-bold">₹{data.cardRev}</span>
          </div>
        </div>
      </div>
    </div>
  )

  const OrderCard = ({ bill, showDate = false }) => (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-700">{bill.table_name_snapshot || 'Table'}</span>
          <PayBadge type={bill.payment_type} />
        </div>
        <div className="text-right">
          <p className="font-bold text-orange-500">₹{bill.final_amount}</p>
          <p className="text-xs text-gray-400">
            {showDate ? `${formatDate(bill.paid_at)} ` : ''}{toIST(bill.paid_at)}
          </p>
        </div>
      </div>
      <div className="space-y-1 mb-2">
        {bill.order_items?.map((item, j) => (
          <div key={j} className="flex justify-between text-xs text-gray-500">
            <span>{item.food_items?.name} × {item.quantity}</span>
            <span>₹{item.price_at_order * item.quantity}</span>
          </div>
        ))}
      </div>
      <div className="border-t pt-2 space-y-0.5">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Subtotal</span><span>₹{bill.subtotal || 0}</span>
        </div>
        {bill.service_charge_amt > 0 && (
          <div className="flex justify-between text-xs text-gray-400">
            <span>Service ({bill.service_charge_pct}%)</span>
            <span>₹{bill.service_charge_amt}</span>
          </div>
        )}
        {bill.discount_amt > 0 && (
          <div className="flex justify-between text-xs text-green-600">
            <span>
              Discount{' '}
              {bill.discount_type === 'percent'
                ? `(${bill.discount_value}%)`
                : `(₹${bill.discount_value} flat)`}
            </span>
            <span>-₹{bill.discount_amt}</span>
          </div>
        )}
        <div className="flex justify-between text-xs font-bold text-gray-700 pt-1 border-t">
          <span>Final</span>
          <span className="text-orange-500">₹{bill.final_amount}</span>
        </div>
      </div>
    </div>
  )

  const DateRangeFilter = ({ from, to, onFrom, onTo, onFetch, btnText = 'View Report' }) => (
    <div className="bg-white rounded-2xl shadow p-5 mb-4">
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="text-xs text-gray-500 block mb-1">From</label>
          <input
            type="date" value={from}
            onChange={(e) => onFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">To</label>
          <input
            type="date" value={to}
            onChange={(e) => onTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <button
          onClick={onFetch}
          className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600"
        >
          {btnText}
        </button>
      </div>
    </div>
  )

  const EmptyState = ({ icon, text }) => (
    <div className="text-center py-12 text-gray-400">
      <div className="text-4xl mb-2">{icon}</div>
      <p>{text}</p>
    </div>
  )

  const TABS = [
    { id: 'today',      label: '📅 Today' },
    { id: 'range',      label: '📆 Date Range' },
    { id: 'items',      label: '🔍 Item Search' },
    { id: 'category',   label: '📊 Category' },
    { id: 'tables',     label: '🪑 Table-wise' },
    { id: 'monthly',    label: '📅 Monthly' },
    { id: 'discounts',  label: '🎁 Discounts' },
    { id: 'settlement', label: '💰 Settlement' },
  ]

  const filteredItems = itemSearchQuery.trim()
    ? itemStats.filter((i) =>
        i.name.toLowerCase().includes(itemSearchQuery.toLowerCase())
      )
    : itemStats

  const maxMonthRevenue = Math.max(...monthlyData.map((m) => m.revenue), 1)
  const yearTotal = monthlyData.reduce((s, m) => s + m.revenue, 0)
  const yearBills = monthlyData.reduce((s, m) => s + m.bills, 0)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <h1 className="text-lg font-bold text-orange-500">Reports</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200"
          >
            🖨️ Print
          </button>
          <button
            onClick={() => navigate('/admin/dashboard')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200"
          >
            ← Dashboard
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-5xl mx-auto">

        {/* Tab Bar */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 print:hidden">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap transition flex-shrink-0
                ${activeTab === tab.id
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-500 border hover:bg-orange-50'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && <div className="text-center py-8 text-gray-400">Loading...</div>}

        {/* ── TODAY ── */}
        {activeTab === 'today' && !loading && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-700">
                📅 Today — {formatDate(new Date())}
              </h2>
              <button
                onClick={fetchToday}
                className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200"
              >
                🔄 Refresh
              </button>
            </div>
            {!todayReport
              ? <EmptyState icon="📭" text="No paid orders today yet." />
              : <>
                  <ReportSummary data={todayReport} />
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">
                      Bill Details ({todayOrders.length})
                    </h3>
                    <div className="space-y-3">
                      {todayOrders.map((bill) => (
                        <OrderCard key={bill._key} bill={bill} />
                      ))}
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* ── DATE RANGE ── */}
        {activeTab === 'range' && !loading && (
          <div>
            <DateRangeFilter
              from={fromDate} to={toDate}
              onFrom={setFromDate} onTo={setToDate}
              onFetch={fetchRange}
            />
            {!rangeReport
              ? <EmptyState icon="📊" text="Select a date range and click View Report" />
              : <>
                  <h2 className="text-lg font-bold text-gray-700 mb-4">
                    {formatDate(fromDate)} → {formatDate(toDate)}
                  </h2>
                  <ReportSummary data={rangeReport} />
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">
                      All Bills ({rangeOrders.length})
                    </h3>
                    <div className="space-y-3">
                      {rangeOrders.map((bill) => (
                        <OrderCard key={bill._key} bill={bill} showDate />
                      ))}
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* ── ITEM SEARCH ── */}
        {activeTab === 'items' && !loading && (
          <div>
            <DateRangeFilter
              from={itemFromDate} to={itemToDate}
              onFrom={setItemFromDate} onTo={setItemToDate}
              onFetch={fetchItemStats} btnText="Search Items"
            />
            {itemStats.length > 0 && (
              <div className="bg-white rounded-2xl shadow p-4 mb-4">
                <input
                  type="text"
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  placeholder="🔍 Search item e.g. Ice Cream, Chicken Tikka..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
                />
                {itemSearchQuery && (
                  <p className="text-xs text-gray-400 mt-2">
                    Showing {filteredItems.length} of {itemStats.length} items
                  </p>
                )}
              </div>
            )}
            {itemStats.length === 0
              ? <EmptyState icon="🔍" text="Select date range and click Search Items" />
              : filteredItems.length === 0
                ? <EmptyState icon="😕" text={`No item found for "${itemSearchQuery}"`} />
                : <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-4">
                      {itemSearchQuery
                        ? `Results for "${itemSearchQuery}"`
                        : `🏆 All Items (${filteredItems.length})`}
                    </h3>
                    <div className="space-y-3">
                      {filteredItems.map((item, index) => (
                        <div key={item.name} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
                          <span className="text-lg font-bold w-8 text-center flex-shrink-0">
                            {!itemSearchQuery
                              ? index === 0 ? '🥇'
                                : index === 1 ? '🥈'
                                : index === 2 ? '🥉'
                                : `#${index + 1}`
                              : '🔍'}
                          </span>
                          <div className="flex-1">
                            <p className="font-semibold text-gray-700">{item.name}</p>
                            <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                              <div
                                className="bg-orange-400 h-1.5 rounded-full"
                                style={{
                                  width: `${Math.min(
                                    (item.qty / (itemStats[0]?.qty || 1)) * 100, 100
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-bold text-orange-500">{item.qty} sold</p>
                            <p className="text-xs text-gray-400">₹{item.revenue}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
            }
          </div>
        )}

        {/* ── CATEGORY ── */}
        {activeTab === 'category' && !loading && (
          <div>
            <DateRangeFilter
              from={catFromDate} to={catToDate}
              onFrom={setCatFromDate} onTo={setCatToDate}
              onFetch={fetchCategoryStats} btnText="View Categories"
            />
            {catStats.length === 0
              ? <EmptyState icon="📊" text="Select date range and click View Categories" />
              : <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    {catStats.map((cat) => (
                      <div key={cat.name} className="bg-white border border-gray-200 rounded-2xl p-4">
                        <p className="text-xs text-gray-500 mb-1 truncate">{cat.name}</p>
                        <p className="text-xl font-bold text-orange-600">₹{cat.revenue}</p>
                        <p className="text-xs text-gray-400">{cat.qty} items sold</p>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                          <div
                            className="bg-orange-400 h-1.5 rounded-full"
                            style={{
                              width: `${Math.min(
                                (cat.revenue / (catStats[0]?.revenue || 1)) * 100, 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">Category Breakdown</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 text-xs text-gray-500">Category</th>
                          <th className="text-right py-2 text-xs text-gray-500">Items Sold</th>
                          <th className="text-right py-2 text-xs text-gray-500">Revenue</th>
                          <th className="text-right py-2 text-xs text-gray-500">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catStats.map((cat) => {
                          const total = catStats.reduce((s, c) => s + c.revenue, 0)
                          const share = total > 0
                            ? ((cat.revenue / total) * 100).toFixed(1)
                            : 0
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

        {/* ── TABLE-WISE ── */}
        {activeTab === 'tables' && !loading && (
          <div>
            <DateRangeFilter
              from={tableFromDate} to={tableToDate}
              onFrom={setTableFromDate} onTo={setTableToDate}
              onFetch={fetchTableStats} btnText="View Tables"
            />
            {tableStats.length === 0
              ? <EmptyState icon="🪑" text="Select date range and click View Tables" />
              : <div className="bg-white rounded-2xl shadow p-5">
                  <h3 className="font-bold text-gray-700 mb-4">
                    Table Performance ({tableStats.length} tables)
                  </h3>
                  <div className="space-y-3">
                    {tableStats.map((tbl, i) => (
                      <div key={tbl.name} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
                        <span className="text-lg font-bold w-8 text-center flex-shrink-0">
                          {i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                        </span>
                        <div className="flex-1">
                          <p className="font-bold text-gray-700">{tbl.name}</p>
                          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                            <div
                              className="bg-orange-400 h-1.5 rounded-full"
                              style={{
                                width: `${Math.min(
                                  (tbl.revenue / (tableStats[0]?.revenue || 1)) * 100, 100
                                )}%`,
                              }}
                            />
                          </div>
                          <p className="text-xs text-gray-400 mt-1">
                            Last visit: {formatDate(tbl.lastVisit)}
                          </p>
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

        {/* ── MONTHLY ── */}
        {activeTab === 'monthly' && !loading && (
          <div>
            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <div className="flex gap-3 items-end flex-wrap">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Year</label>
                  <select
                    value={monthlyYear}
                    onChange={(e) => setMonthlyYear(Number(e.target.value))}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  >
                    {[2024, 2025, 2026, 2027].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={fetchMonthly}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600"
                >
                  View Year
                </button>
              </div>
            </div>
            {monthlyData.length === 0
              ? <EmptyState icon="📅" text="Select a year and click View Year" />
              : <>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Year {monthlyYear} Revenue</p>
                      <p className="text-3xl font-bold text-orange-600">₹{yearTotal}</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Total Bills</p>
                      <p className="text-3xl font-bold text-blue-600">{yearBills}</p>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-5 mb-4">
                    <h3 className="font-bold text-gray-700 mb-4">Monthly Revenue</h3>
                    <div className="flex items-end gap-1" style={{ height: '140px' }}>
                      {monthlyData.map((m) => (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-end" style={{ height: '110px' }}>
                            <div
                              className="w-full bg-orange-400 rounded-t-lg hover:bg-orange-500 transition cursor-pointer"
                              style={{
                                height: `${(m.revenue / maxMonthRevenue) * 100}%`,
                                minHeight: m.revenue > 0 ? '4px' : '0',
                              }}
                              title={`${m.name}: ₹${m.revenue}`}
                            />
                          </div>
                          <p className="text-xs text-gray-500">{m.name}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">Month-by-Month</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 text-xs text-gray-500">Month</th>
                            <th className="text-right py-2 text-xs text-gray-500">Bills</th>
                            <th className="text-right py-2 text-xs text-gray-500">Revenue</th>
                            <th className="text-right py-2 text-xs text-gray-500">Cash</th>
                            <th className="text-right py-2 text-xs text-gray-500">UPI</th>
                            <th className="text-right py-2 text-xs text-gray-500">Card</th>
                            <th className="text-right py-2 text-xs text-gray-500">SC</th>
                            <th className="text-right py-2 text-xs text-gray-500">Disc</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyData.map((m) => (
                            <tr
                              key={m.month}
                              className={`border-b border-gray-50 hover:bg-gray-50 ${m.revenue === 0 ? 'opacity-40' : ''}`}
                            >
                              <td className="py-2 font-medium text-gray-700">{m.name} {monthlyYear}</td>
                              <td className="py-2 text-right text-gray-500">{m.bills}</td>
                              <td className="py-2 text-right font-bold text-orange-500">₹{m.revenue}</td>
                              <td className="py-2 text-right text-green-600">₹{m.cash}</td>
                              <td className="py-2 text-right text-blue-600">₹{m.upi}</td>
                              <td className="py-2 text-right text-purple-600">₹{m.card}</td>
                              <td className="py-2 text-right text-gray-400">
                                {m.serviceCharge > 0 ? `₹${m.serviceCharge}` : '—'}
                              </td>
                              <td className="py-2 text-right text-green-600">
                                {m.discounts > 0 ? `-₹${m.discounts}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-200 font-bold">
                            <td className="py-2 text-gray-700">Total</td>
                            <td className="py-2 text-right text-gray-700">{yearBills}</td>
                            <td className="py-2 text-right text-orange-500">₹{yearTotal}</td>
                            <td className="py-2 text-right text-green-600">
                              ₹{monthlyData.reduce((s, m) => s + m.cash, 0)}
                            </td>
                            <td className="py-2 text-right text-blue-600">
                              ₹{monthlyData.reduce((s, m) => s + m.upi, 0)}
                            </td>
                            <td className="py-2 text-right text-purple-600">
                              ₹{monthlyData.reduce((s, m) => s + m.card, 0)}
                            </td>
                            <td className="py-2 text-right text-gray-400">
                              ₹{monthlyData.reduce((s, m) => s + m.serviceCharge, 0)}
                            </td>
                            <td className="py-2 text-right text-green-600">
                              -₹{monthlyData.reduce((s, m) => s + m.discounts, 0)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* ── DISCOUNTS ── */}
        {activeTab === 'discounts' && !loading && (
          <div>
            <DateRangeFilter
              from={discFromDate} to={discToDate}
              onFrom={setDiscFromDate} onTo={setDiscToDate}
              onFetch={fetchDiscounts} btnText="View Discounts"
            />
            {!discData
              ? <EmptyState icon="🎁" text="Select date range and click View Discounts" />
              : <>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Total Discounts Given</p>
                      <p className="text-3xl font-bold text-green-600">₹{discData.totalDiscount}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {discData.bills.length} bills had discount
                      </p>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Gross Before Discount</p>
                      <p className="text-3xl font-bold text-orange-600">₹{discData.grossRevenue}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {discData.grossRevenue > 0
                          ? `${((discData.totalDiscount / discData.grossRevenue) * 100).toFixed(1)}% given away`
                          : ''}
                      </p>
                    </div>
                  </div>
                  {discData.reasonBreakdown.length > 0 && (
                    <div className="bg-white rounded-2xl shadow p-5 mb-4">
                      <h3 className="font-bold text-gray-700 mb-3">By Reason</h3>
                      <div className="space-y-2">
                        {discData.reasonBreakdown.map((r) => (
                          <div key={r.reason} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
                            <div>
                              <p className="font-medium text-gray-700 text-sm">{r.reason}</p>
                              <p className="text-xs text-gray-400">{r.count} bill(s)</p>
                            </div>
                            <p className="font-bold text-green-600">-₹{r.total}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">All Discounted Bills</h3>
                    <div className="space-y-3">
                      {discData.bills.map((bill) => (
                        <div key={bill._key} className="border border-green-100 rounded-xl p-4 bg-green-50">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="font-semibold text-gray-700">
                                {bill.table_name_snapshot || 'Table'}
                              </p>
                              <p className="text-xs text-gray-400">
                                {formatDate(bill.paid_at)} • {toIST(bill.paid_at)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-green-600 font-bold text-lg">-₹{bill.discount_amt}</p>
                              <p className="text-xs text-gray-400">
                                {bill.discount_type === 'percent'
                                  ? `${bill.discount_value}% off`
                                  : `₹${bill.discount_value} flat`}
                              </p>
                            </div>
                          </div>
                          <div className="bg-white rounded-lg px-3 py-2 mb-2">
                            <p className="text-xs text-gray-700">
                              <span className="font-medium">📝 Reason: </span>
                              {bill.discount_reason || (
                                <span className="text-gray-400 italic">No reason given</span>
                              )}
                            </p>
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

        {/* ── SETTLEMENT ── */}
        {activeTab === 'settlement' && !loading && (
          <div>
            <DateRangeFilter
              from={settlFromDate} to={settlToDate}
              onFrom={setSettlFromDate} onTo={setSettlToDate}
              onFetch={fetchSettlement} btnText="View Settlement"
            />
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
                    <div className="flex justify-between text-gray-600">
                      <span>Service Charges Collected</span>
                      <span className="font-bold">₹{settlData.serviceTotal}</span>
                    </div>
                    {settlData.discountTotal > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Total Discounts Given</span>
                        <span className="font-bold">-₹{settlData.discountTotal}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-gray-600 border-t pt-2 font-bold">
                      <span>Net (excl. service charge)</span>
                      <span>₹{settlData.grandTotal - settlData.serviceTotal}</span>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">All Transactions</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 text-xs text-gray-500">Time</th>
                            <th className="text-left py-2 text-xs text-gray-500">Table</th>
                            <th className="text-left py-2 text-xs text-gray-500">Payment</th>
                            <th className="text-right py-2 text-xs text-gray-500">Subtotal</th>
                            <th className="text-right py-2 text-xs text-gray-500">SC</th>
                            <th className="text-right py-2 text-xs text-gray-500">Disc</th>
                            <th className="text-right py-2 text-xs text-gray-500">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {settlData.bills.map((bill) => (
                            <tr key={bill._key} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2 text-xs text-gray-400">
                                {formatDate(bill.paid_at)}<br />{toIST(bill.paid_at)}
                              </td>
                              <td className="py-2 font-medium text-gray-700">
                                {bill.table_name_snapshot || 'Table'}
                              </td>
                              <td className="py-2"><PayBadge type={bill.payment_type} /></td>
                              <td className="py-2 text-right text-gray-600">₹{bill.subtotal || 0}</td>
                              <td className="py-2 text-right text-gray-400">
                                {bill.service_charge_amt > 0 ? `₹${bill.service_charge_amt}` : '—'}
                              </td>
                              <td className="py-2 text-right text-green-600">
                                {bill.discount_amt > 0 ? `-₹${bill.discount_amt}` : '—'}
                              </td>
                              <td className="py-2 text-right font-bold text-orange-500">
                                ₹{bill.final_amount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-200">
                            <td colSpan={6} className="py-2 font-bold text-gray-700">Grand Total</td>
                            <td className="py-2 text-right font-bold text-orange-500 text-lg">
                              ₹{settlData.grandTotal}
                            </td>
                          </tr>
                        </tfoot>
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