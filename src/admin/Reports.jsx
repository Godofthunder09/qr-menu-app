import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

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
  endISO:   new Date(to   + 'T23:59:59+05:30').toISOString(),
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
const downloadCSV = (rows, filename) => {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

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
const getDept = (name = '') => {
  const l = name.toLowerCase()
  if (LIQUOR_KEYWORDS.some(k => l.includes(k))) return 'Liquor'
  if (BEVERAGE_KEYWORDS.some(k => l.includes(k))) return 'Beverage'
  if (BAKERY_KEYWORDS.some(k => l.includes(k))) return 'Bakery'
  return 'Kitchen'
}
const isLiquor = (name = '') => getDept(name) === 'Liquor'

const DEPT_COLORS = {
  Kitchen:  { badge: 'bg-orange-100 text-orange-700', icon: '🍳' },
  Bakery:   { badge: 'bg-yellow-100 text-yellow-700', icon: '🥖' },
  Beverage: { badge: 'bg-blue-100   text-blue-700',   icon: '🥤' },
  Liquor:   { badge: 'bg-purple-100 text-purple-700', icon: '🍺' },
}
const PAY_LABEL = { cash: '💵 Cash', upi: '📱 UPI', card: '💳 Card' }
const PAY_COLOR = {
  cash: 'bg-green-100 text-green-700',
  upi:  'bg-blue-100  text-blue-700',
  card: 'bg-purple-100 text-purple-700',
}

const TABS = [
  { id: 'today',      label: '📅 Today' },
  { id: 'range',      label: '📆 Date Range' },
  { id: 'category',   label: '📊 Category' },
  { id: 'tables',     label: '🪑 Table-wise' },
  { id: 'discounts',  label: '🎁 Discounts' },
  { id: 'settlement', label: '💰 Settlement' },
]

const buildTableGroups = (orders) => {
  const map = {}
  orders.forEach(o => {
    const key = o.table_name_snapshot || 'Unknown'
    if (!map[key]) map[key] = { name: key, orders: [] }
    map[key].orders.push(o)
  })
  return Object.values(map).map(tbl => {
    const sorted = [...tbl.orders].sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at))
    const activatedAt = tbl.orders.reduce((min, o) =>
      !min || new Date(o.created_at) < new Date(min) ? o.created_at : min, null)
    const paidAt = tbl.orders.reduce((max, o) =>
      !max || new Date(o.paid_at) > new Date(max) ? o.paid_at : max, null)
    const duration = diffMinutes(activatedAt, paidAt)
    const bills = sorted.map((o, idx) => ({
      billSerial: idx + 1, billId: o.id,
      payment_type: o.payment_type, paid_at: o.paid_at, created_at: o.created_at,
      subtotal: o.subtotal || 0,
      service_charge_pct: o.service_charge_pct || 0,
      service_charge_amt: o.service_charge_amt || 0,
      discount_amt: o.discount_amt || 0, discount_type: o.discount_type,
      discount_value: o.discount_value || 0, discount_reason: o.discount_reason || '',
      final_amount: o.final_amount || 0,
      items: (o.order_items || []).map(i => ({
        name: i.food_items?.name || 'Unknown', qty: i.quantity,
        rate: i.price_at_order, amount: i.price_at_order * i.quantity,
        dept: getDept(i.food_items?.name),
      })),
    }))
    return {
      name: tbl.name, activatedAt, paidAt, duration, bills,
      tableRevenue:  bills.reduce((s, b) => s + b.final_amount, 0),
      tableSubtotal: bills.reduce((s, b) => s + b.subtotal, 0),
      tableDiscount: bills.reduce((s, b) => s + b.discount_amt, 0),
      tableSC:       bills.reduce((s, b) => s + b.service_charge_amt, 0),
      totalItems:    bills.reduce((s, b) => s + b.items.reduce((x, i) => x + i.qty, 0), 0),
    }
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

export default function Reports() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('today')

  const [todayLoading, setTodayLoading] = useState(true)
  const [todayBills, setTodayBills] = useState([])
  const [todayStats, setTodayStats] = useState(null)
  const [showTodayOrders, setShowTodayOrders] = useState(false)
  const [showTodayPrint, setShowTodayPrint] = useState(false)

  const [rangeFrom, setRangeFrom] = useState(todayIST())
  const [rangeTo, setRangeTo] = useState(todayIST())
  const [rangeLoading, setRangeLoading] = useState(false)
  const [rangeDataA, setRangeDataA] = useState(null)
  const [rangeDataB, setRangeDataB] = useState(null)
  const [rangeLabelA, setRangeLabelA] = useState('')
  const [rangeLabelB, setRangeLabelB] = useState('')
  const [showRangePrint, setShowRangePrint] = useState(false)

  const [catFrom, setCatFrom] = useState(todayIST())
  const [catTo, setCatTo] = useState(todayIST())
  const [catLoading, setCatLoading] = useState(false)
  const [catData, setCatData] = useState(null)
  const [showCatPrint, setShowCatPrint] = useState(false)

  const [tblFrom, setTblFrom] = useState(todayIST())
  const [tblTo, setTblTo] = useState(todayIST())
  const [tblLoading, setTblLoading] = useState(false)
  const [tblData, setTblData] = useState([])
  const [tblFetched, setTblFetched] = useState(false)
  const [tblExpanded, setTblExpanded] = useState({})
  const [showTblPrint, setShowTblPrint] = useState(false)

  const [discFrom, setDiscFrom] = useState(todayIST())
  const [discTo, setDiscTo] = useState(todayIST())
  const [discLoading, setDiscLoading] = useState(false)
  const [discData, setDiscData] = useState(null)
  const [showDiscPrint, setShowDiscPrint] = useState(false)

  const [settlFrom, setSettlFrom] = useState(todayIST())
  const [settlTo, setSettlTo] = useState(todayIST())
  const [settlLoading, setSettlLoading] = useState(true)
  const [settlData, setSettlData] = useState(null)
  const [settlSort, setSettlSort] = useState('time')
  const [showSettlPrint, setShowSettlPrint] = useState(false)

  // ── FIXED fetchToday: now fetches open_items_json ─────
  const fetchToday = async () => {
    setTodayLoading(true)
    const { startISO, endISO } = toRange(todayIST(), todayIST())
    const { data: orders } = await supabase
      .from('orders')
      .select(`id, payment_type, paid_at, final_amount, subtotal,
        service_charge_amt, discount_amt, table_name_snapshot, open_items_json,
        order_items(quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    // Group into bills (dedup by table+minute), take open_items from first row only
    const map = {}
    orders?.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) {
        map[key] = {
          ...o,
          order_items: [...(o.order_items || [])],
          open_items: [...(o.open_items_json || [])],  // ← FIXED: from first row only
        }
      } else {
        map[key].order_items = [...map[key].order_items, ...(o.order_items || [])]
        // DO NOT merge open_items — first row already has them
      }
    })
    const grouped = Object.values(map)
    setTodayBills(grouped)
    computeTodayStats(grouped)
    setTodayLoading(false)
  }

  // ── FIXED computeTodayStats: counts open item revenue ─
  const computeTodayStats = (bills) => {
    if (!bills.length) { setTodayStats(null); return }
    const totalRevenue = bills.reduce((s, b) => s + (b.final_amount || 0), 0)
    const totalOrders = bills.length
    const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0
    const cash = bills.filter(b => b.payment_type === 'cash').reduce((s, b) => s + (b.final_amount || 0), 0)
    const upi  = bills.filter(b => b.payment_type === 'upi').reduce((s, b) => s + (b.final_amount || 0), 0)
    const card = bills.filter(b => b.payment_type === 'card').reduce((s, b) => s + (b.final_amount || 0), 0)
    const scTotal = bills.reduce((s, b) => s + (b.service_charge_amt || 0), 0)
    const discTotal = bills.reduce((s, b) => s + (b.discount_amt || 0), 0)
    const discPct = totalRevenue > 0 ? ((discTotal / totalRevenue) * 100).toFixed(1) : 0
    const hourMap = {}
    bills.forEach(b => {
      const hr = new Date(b.paid_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })
      hourMap[hr] = (hourMap[hr] || 0) + 1
    })
    const hours = Object.entries(hourMap).sort((a, b) => b[1] - a[1])

    // Item map — include open items too
    const itemMap = {}
    bills.forEach(b => {
      b.order_items?.forEach(i => {
        const name = i.food_items?.name || 'Unknown'
        itemMap[name] = (itemMap[name] || 0) + i.quantity
      })
      // ── FIXED: also count open items ──
      ;(b.open_items || []).forEach(oi => {
        itemMap[oi.name] = (itemMap[oi.name] || 0) + oi.qty
      })
    })
    const topItem = Object.entries(itemMap).sort((a, b) => b[1] - a[1])[0]

    // Food/liquor revenue — include open items
    let foodRev = 0, liquorRev = 0
    bills.forEach(b => {
      b.order_items?.forEach(i => {
        const rev = i.price_at_order * i.quantity
        if (isLiquor(i.food_items?.name)) liquorRev += rev; else foodRev += rev
      })
      // ── FIXED: open items revenue split ──
      ;(b.open_items || []).forEach(oi => {
        const rev = oi.price * oi.qty
        if (isLiquor(oi.name)) liquorRev += rev; else foodRev += rev
      })
    })

    setTodayStats({
      totalRevenue, totalOrders, aov, cash, upi, card,
      scTotal, discTotal, discPct,
      busiestHour: hours[0] ? `${hours[0][0]}:00 (${hours[0][1]} orders)` : '—',
      quietestHour: hours.length > 1 ? `${hours[hours.length-1][0]}:00 (${hours[hours.length-1][1]} orders)` : '—',
      topItem: topItem ? `${topItem[0]} (${topItem[1]} sold)` : '—',
      discWarning: parseFloat(discPct) > 10, foodRev, liquorRev
    })
  }

  useEffect(() => { fetchToday() }, [])

  const fetchRangePeriod = async (from, to) => {
    const { startISO, endISO } = toRange(from, to)
    const { data: orders } = await supabase
      .from('orders')
      .select(`id, payment_type, paid_at, final_amount, subtotal,
        service_charge_amt, discount_amt, table_name_snapshot,
        order_items(quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
    const map = {}
    orders?.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) map[key] = { ...o, order_items: [...(o.order_items || [])] }
      else map[key].order_items = [...map[key].order_items, ...(o.order_items || [])]
    })
    const bills = Object.values(map)
    const totalRevenue = bills.reduce((s, b) => s + (b.final_amount || 0), 0)
    const totalOrders = bills.length
    const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0
    const cash = bills.filter(b => b.payment_type === 'cash').reduce((s, b) => s + (b.final_amount || 0), 0)
    const upi  = bills.filter(b => b.payment_type === 'upi').reduce((s, b) => s + (b.final_amount || 0), 0)
    const card = bills.filter(b => b.payment_type === 'card').reduce((s, b) => s + (b.final_amount || 0), 0)
    const itemMap = {}
    bills.forEach(b => b.order_items?.forEach(i => {
      const name = i.food_items?.name || 'Unknown'
      itemMap[name] = (itemMap[name] || 0) + i.quantity
    }))
    const top3 = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const dayMap = {}
    bills.forEach(b => {
      const day = new Date(b.paid_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      dayMap[day] = (dayMap[day] || 0) + (b.final_amount || 0)
    })
    const bestDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0]
    return { totalRevenue, totalOrders, aov, cash, upi, card, top3, bestDay }
  }

  const applyRangePreset = (preset) => {
    const today = todayIST(); let from, to
    if (preset === '7d') { from = addDays(today, -6); to = today }
    else if (preset === '30d') { from = addDays(today, -29); to = today }
    else if (preset === 'thisMonth') {
      const d = new Date()
      from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; to = today
    } else {
      const d = new Date(); d.setMonth(d.getMonth()-1)
      from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`
      const last = new Date(d.getFullYear(), d.getMonth()+1, 0)
      to = last.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    }
    setRangeFrom(from); setRangeTo(to); runRangeFetch(from, to)
  }

  const runRangeFetch = async (from, to) => {
    setRangeLoading(true)
    const diffDays = Math.round((new Date(to) - new Date(from)) / (1000*60*60*24))
    const prevFrom = addDays(from, -(diffDays + 1))
    const prevTo = addDays(from, -1)
    const [a, b] = await Promise.all([fetchRangePeriod(from, to), fetchRangePeriod(prevFrom, prevTo)])
    setRangeDataA(a); setRangeDataB(b)
    setRangeLabelA(`${formatDate(from)} → ${formatDate(to)}`)
    setRangeLabelB(`${formatDate(prevFrom)} → ${formatDate(prevTo)}`)
    setRangeLoading(false)
  }

  const rangePct = (a, b) => b === 0 ? null : (((a - b) / b) * 100).toFixed(1)

  const fetchCategory = async () => {
    setCatLoading(true)
    const { startISO, endISO } = toRange(catFrom, catTo)
    const { data: items } = await supabase
      .from('order_items')
      .select('quantity, price_at_order, food_items(name, category_id), orders!inner(is_paid, paid_at)')
      .eq('orders.is_paid', true).gte('orders.paid_at', startISO).lte('orders.paid_at', endISO)
    const { data: allFoodItems } = await supabase.from('food_items').select('name, is_available')
    const { data: cats } = await supabase.from('categories').select('id, name').eq('is_subcategory', false)
    const catMap = {}; cats?.forEach(c => { catMap[c.id] = c.name })
    const catRevMap = {}; let foodTotal = 0, liquorTotal = 0
    items?.forEach(i => {
      const name = i.food_items?.name || 'Unknown'
      const catId = i.food_items?.category_id
      const catName = catId ? (catMap[catId] || 'Uncategorized') : 'Uncategorized'
      const rev = i.price_at_order * i.quantity
      if (!catRevMap[catName]) catRevMap[catName] = { name: catName, qty: 0, revenue: 0, items: {} }
      catRevMap[catName].qty += i.quantity; catRevMap[catName].revenue += rev
      catRevMap[catName].items[name] = (catRevMap[catName].items[name] || 0) + i.quantity
      if (isLiquor(name)) liquorTotal += rev; else foodTotal += rev
    })
    const soldNames = new Set(items?.map(i => i.food_items?.name) || [])
    const zeroItems = allFoodItems?.filter(fi => !soldNames.has(fi.name) && fi.is_available) || []
    const catStats = Object.values(catRevMap)
      .map(c => ({ ...c, topItem: Object.entries(c.items).sort((a, b) => b[1] - a[1])[0] }))
      .sort((a, b) => b.revenue - a.revenue)
    setCatData({ catStats, foodTotal, liquorTotal, zeroItems, totalRevenue: foodTotal + liquorTotal })
    setCatLoading(false)
  }

  const fetchTablewise = useCallback(async () => {
    setTblLoading(true)
    const { startISO, endISO } = toRange(tblFrom, tblTo)
    const { data: orders } = await supabase
      .from('orders')
      .select(`id, payment_type, is_paid, created_at, paid_at,
        subtotal, service_charge_pct, service_charge_amt,
        discount_type, discount_value, discount_amt, discount_reason,
        final_amount, table_name_snapshot,
        order_items(quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: true })
    const grp = buildTableGroups(orders || [])
    setTblData(grp); setTblFetched(true)
    const exp = {}; grp.forEach(t => { exp[t.name] = true }); setTblExpanded(exp)
    setTblLoading(false)
  }, [tblFrom, tblTo])

  const tblSummary = tblData.reduce((s, t) => ({
    revenue: s.revenue + t.tableRevenue, sc: s.sc + t.tableSC,
    discount: s.discount + t.tableDiscount, bills: s.bills + t.bills.length,
    tables: s.tables + 1,
  }), { revenue: 0, sc: 0, discount: 0, bills: 0, tables: 0 })

  const fetchDiscounts = async () => {
    setDiscLoading(true)
    const { startISO, endISO } = toRange(discFrom, discTo)
    const { data: orders } = await supabase
      .from('orders')
      .select('id, payment_type, paid_at, table_name_snapshot, subtotal, service_charge_amt, discount_type, discount_value, discount_amt, final_amount, discount_reason')
      .eq('is_paid', true).gt('discount_amt', 0).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (!orders || orders.length === 0) { setDiscData(null); setDiscLoading(false); return }
    const map = {}
    orders.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) map[key] = { ...o }
    })
    const bills = Object.values(map)
    const totalDiscount = bills.reduce((s, b) => s + (b.discount_amt || 0), 0)
    const grossRevenue = bills.reduce((s, b) => s + (b.subtotal || 0), 0)
    const avgDiscount = bills.length > 0 ? Math.round(totalDiscount / bills.length) : 0
    const discPct = grossRevenue > 0 ? ((totalDiscount / grossRevenue) * 100).toFixed(1) : 0
    const dayMap = {}
    bills.forEach(b => {
      const day = new Date(b.paid_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' })
      dayMap[day] = (dayMap[day] || 0) + (b.discount_amt || 0)
    })
    const topDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0]
    const largest = bills.reduce((max, b) => (b.discount_amt > max.discount_amt ? b : max), bills[0])
    const reasonMap = {}
    bills.forEach(b => {
      const r = b.discount_reason?.trim() || 'No reason given'
      if (!reasonMap[r]) reasonMap[r] = { reason: r, count: 0, total: 0 }
      reasonMap[r].count += 1; reasonMap[r].total += b.discount_amt || 0
    })
    const flaggedBills = bills.map(b => {
      const truePct = b.subtotal > 0 ? (b.discount_amt / b.subtotal) * 100 : 0
      return { ...b, truePct, flag: truePct >= 40 ? 'red' : truePct >= 20 ? 'yellow' : null }
    })
    setDiscData({
      bills: flaggedBills, totalDiscount, grossRevenue, avgDiscount, discPct, topDay, largest,
      reasonBreakdown: Object.values(reasonMap).sort((a, b) => b.total - a.total),
      redFlags: flaggedBills.filter(b => b.flag === 'red').length,
      yellowFlags: flaggedBills.filter(b => b.flag === 'yellow').length
    })
    setDiscLoading(false)
  }

  const fetchSettlement = async () => {
    setSettlLoading(true)
    const { startISO, endISO } = toRange(settlFrom, settlTo)
    const { data: orders } = await supabase
      .from('orders')
      .select('id, payment_type, paid_at, table_name_snapshot, subtotal, service_charge_amt, discount_amt, final_amount')
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (!orders || orders.length === 0) { setSettlData(null); setSettlLoading(false); return }
    const map = {}
    orders.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) map[key] = { ...o }
    })
    const bills = Object.values(map)
    const cash = bills.filter(b => b.payment_type === 'cash')
    const upi  = bills.filter(b => b.payment_type === 'upi')
    const card = bills.filter(b => b.payment_type === 'card')
    setSettlData({
      bills,
      cash: { total: cash.reduce((s, b) => s + (b.final_amount || 0), 0), count: cash.length },
      upi:  { total: upi.reduce((s, b) => s + (b.final_amount || 0), 0), count: upi.length },
      card: { total: card.reduce((s, b) => s + (b.final_amount || 0), 0), count: card.length },
      grandTotal: bills.reduce((s, b) => s + (b.final_amount || 0), 0),
      gross:      bills.reduce((s, b) => s + (b.subtotal || 0), 0),
      scTotal:    bills.reduce((s, b) => s + (b.service_charge_amt || 0), 0),
      discTotal:  bills.reduce((s, b) => s + (b.discount_amt || 0), 0),
    })
    setSettlLoading(false)
  }

  useEffect(() => { fetchSettlement() }, [])

  const sortedSettlBills = () => {
    if (!settlData) return []
    const b = [...settlData.bills]
    if (settlSort === 'time')    return b.sort((a, c) => new Date(c.paid_at) - new Date(a.paid_at))
    if (settlSort === 'amount')  return b.sort((a, c) => c.final_amount - a.final_amount)
    if (settlSort === 'table')   return b.sort((a, c) => (a.table_name_snapshot || '').localeCompare(c.table_name_snapshot || ''))
    if (settlSort === 'payment') return b.sort((a, c) => (a.payment_type || '').localeCompare(c.payment_type || ''))
    return b
  }

  // ── FIXED CSV exports — each exports its own correct data ─

  const exportTodayCSV = () => {
    if (!todayBills.length) return
    const s = todayStats
    const rows = [
      ['TODAY SALES REPORT', formatDate(new Date())], [],
      ['SUMMARY'],
      ['Total Revenue', `Rs.${s.totalRevenue}`],
      ['Total Bills', s.totalOrders],
      ['Avg Order Value', `Rs.${s.aov}`],
      ['Cash', `Rs.${s.cash}`],
      ['UPI', `Rs.${s.upi}`],
      ['Card', `Rs.${s.card}`],
      ['Food Revenue', `Rs.${s.foodRev}`],
      ['Liquor Revenue', `Rs.${s.liquorRev}`],
      ['Service Charge', `Rs.${s.scTotal}`],
      ['Discounts', `-Rs.${s.discTotal} (${s.discPct}%)`],
      ['Top Item', s.topItem],
      ['Busiest Hour', s.busiestHour], [],
      ['BILL DETAILS'],
      ['Table', 'Time', 'Payment', 'Subtotal', 'SC', 'Discount', 'Final', 'Menu Items', 'Open Items']
    ]
    todayBills.forEach(b => rows.push([
      b.table_name_snapshot,
      toIST(b.paid_at),
      b.payment_type,
      b.subtotal,
      b.service_charge_amt,
      b.discount_amt,
      b.final_amount,
      b.order_items?.map(i => `${i.food_items?.name} x${i.quantity}`).join(' | ') || '',
      (b.open_items || []).map(oi => `${oi.name} x${oi.qty} @Rs.${oi.price}`).join(' | ') || ''
    ]))
    downloadCSV(rows, `Today_Sales_${todayIST()}.csv`)
  }

  const exportRangeCSV = () => {
    if (!rangeDataA) return
    const rows = [
      ['DATE RANGE COMPARISON REPORT'],
      ['Period A (This)', rangeLabelA],
      ['Period B (Previous)', rangeLabelB], [],
      ['Metric', 'This Period', 'Previous Period', '% Change'],
      ['Total Revenue', `Rs.${rangeDataA.totalRevenue}`, `Rs.${rangeDataB?.totalRevenue || 0}`, (rangePct(rangeDataA.totalRevenue, rangeDataB?.totalRevenue || 0) || '—') + '%'],
      ['Total Orders', rangeDataA.totalOrders, rangeDataB?.totalOrders || 0, ''],
      ['Avg Order Value', `Rs.${rangeDataA.aov}`, `Rs.${rangeDataB?.aov || 0}`, ''],
      ['Cash Revenue', `Rs.${rangeDataA.cash}`, `Rs.${rangeDataB?.cash || 0}`, ''],
      ['UPI Revenue', `Rs.${rangeDataA.upi}`, `Rs.${rangeDataB?.upi || 0}`, ''],
      ['Card Revenue', `Rs.${rangeDataA.card}`, `Rs.${rangeDataB?.card || 0}`, ''], [],
      ['TOP ITEMS (THIS PERIOD)'],
      ['Rank', 'Item', 'Qty Sold'],
      ...rangeDataA.top3.map(([name, qty], i) => [i + 1, name, qty]),
      [], ['TOP ITEMS (PREVIOUS PERIOD)'],
      ['Rank', 'Item', 'Qty Sold'],
      ...(rangeDataB?.top3 || []).map(([name, qty], i) => [i + 1, name, qty]),
    ]
    downloadCSV(rows, `DateRange_${rangeFrom}_to_${rangeTo}.csv`)
  }

  const exportCatCSV = () => {
    if (!catData) return
    const total = catData.totalRevenue
    const rows = [
      ['CATEGORY SALES REPORT'],
      ['Period', `${formatDate(catFrom)} to ${formatDate(catTo)}`], [],
      ['OVERVIEW'],
      ['Food Revenue', `Rs.${catData.foodTotal}`, `${catData.totalRevenue > 0 ? ((catData.foodTotal / catData.totalRevenue) * 100).toFixed(1) : 0}%`],
      ['Liquor Revenue', `Rs.${catData.liquorTotal}`, `${catData.totalRevenue > 0 ? ((catData.liquorTotal / catData.totalRevenue) * 100).toFixed(1) : 0}%`],
      ['Total Revenue', `Rs.${catData.totalRevenue}`], [],
      ['CATEGORY BREAKDOWN'],
      ['Category', 'Items Sold', 'Revenue', '% of Total', 'Top Item'],
    ]
    catData.catStats.forEach(c => {
      const share = total > 0 ? ((c.revenue / total) * 100).toFixed(1) : 0
      rows.push([c.name, c.qty, `Rs.${c.revenue}`, share + '%', c.topItem ? `${c.topItem[0]} (${c.topItem[1]} sold)` : '—'])
    })
    if (catData.zeroItems.length > 0) {
      rows.push([], ['ZERO SALES ITEMS (available but no orders in this period)'], ['Item Name'])
      catData.zeroItems.forEach(i => rows.push([i.name]))
    }
    downloadCSV(rows, `Category_${catFrom}_to_${catTo}.csv`)
  }

  const exportTblCSV = () => {
    const rows = [
      ['TABLE-WISE SALES REPORT'],
      ['Period', `${formatDate(tblFrom)} to ${formatDate(tblTo)}`], [],
      ['SUMMARY'],
      ['Total Tables', tblSummary.tables],
      ['Total Bills', tblSummary.bills],
      ['Net Revenue', `Rs.${tblSummary.revenue}`],
      ['Service Charge', `Rs.${tblSummary.sc}`],
      ['Discounts', `-Rs.${tblSummary.discount}`], [],
      ['DETAILED BILL DATA'],
    ]
    tblData.forEach(tbl => {
      rows.push([])
      rows.push([`TABLE: ${tbl.name}`, `Total: Rs.${tbl.tableRevenue}`, `${tbl.bills.length} bill(s)`, `Duration: ${formatDuration(tbl.duration)}`])
      tbl.bills.forEach(bill => {
        rows.push([`Bill #${bill.billSerial}`, PAY_LABEL[bill.payment_type] || bill.payment_type, toIST(bill.paid_at), `Rs.${bill.final_amount}`])
        rows.push(['Sr', 'Item', 'Dept', 'Qty', 'Rate', 'Amount'])
        bill.items.forEach((item, i) => rows.push([i + 1, item.name, item.dept, item.qty, `Rs.${item.rate}`, `Rs.${item.amount}`]))
        rows.push(['', 'Subtotal', '', '', '', `Rs.${bill.subtotal}`])
        if (bill.service_charge_amt > 0) rows.push(['', `Service Charge (${bill.service_charge_pct}%)`, '', '', '', `Rs.${bill.service_charge_amt}`])
        if (bill.discount_amt > 0) rows.push(['', 'Discount', '', '', '', `-Rs.${bill.discount_amt}`])
        rows.push(['', 'BILL TOTAL', '', '', '', `Rs.${bill.final_amount}`])
      })
    })
    downloadCSV(rows, `TableWise_${tblFrom}_to_${tblTo}.csv`)
  }

  const exportDiscCSV = () => {
    if (!discData) return
    const rows = [
      ['DISCOUNT AUDIT REPORT'],
      ['Period', `${formatDate(discFrom)} to ${formatDate(discTo)}`], [],
      ['SUMMARY'],
      ['Total Discounts Given', `-Rs.${discData.totalDiscount}`],
      ['Discount % of Revenue', discData.discPct + '%'],
      ['Bills with Discounts', discData.bills.length],
      ['Avg Discount per Bill', `Rs.${discData.avgDiscount}`],
      ['Red Flags (>40%)', discData.redFlags],
      ['Yellow Flags (20-40%)', discData.yellowFlags],
      ['Most Discounts Day', discData.topDay?.[0] || '—', `Rs.${discData.topDay?.[1] || 0}`],
      ['Largest Single Discount', `Rs.${discData.largest?.discount_amt || 0}`, discData.largest?.table_name_snapshot || ''], [],
      ['DISCOUNT BY REASON'],
      ['Reason', 'No. of Bills', 'Total Discounted'],
      ...discData.reasonBreakdown.map(r => [r.reason, r.count, `Rs.${r.total}`]), [],
      ['ALL DISCOUNTED BILLS'],
      ['Table', 'Date', 'Time', 'Subtotal', 'Discount', 'Disc%', 'Final Amount', 'Payment', 'Reason', 'Flag']
    ]
    discData.bills.forEach(b => rows.push([
      b.table_name_snapshot,
      formatDate(b.paid_at),
      toIST(b.paid_at),
      `Rs.${b.subtotal}`,
      `-Rs.${b.discount_amt}`,
      b.truePct.toFixed(1) + '%',
      `Rs.${b.final_amount}`,
      b.payment_type,
      b.discount_reason || 'No reason',
      b.flag === 'red' ? '🚨 Red Flag' : b.flag === 'yellow' ? '⚠️ Yellow Flag' : 'OK'
    ]))
    downloadCSV(rows, `Discounts_${discFrom}_to_${discTo}.csv`)
  }

  const exportSettlCSV = () => {
    if (!settlData) return
    const rows = [
      ['SETTLEMENT REPORT'],
      ['Period', `${formatDate(settlFrom)} to ${formatDate(settlTo)}`],
      ['Printed', `${formatDate(new Date())} ${toIST(new Date().toISOString())}`], [],
      ['PAYMENT SUMMARY'],
      ['Payment Mode', 'No. of Bills', 'Total Amount'],
      ['Cash', settlData.cash.count, `Rs.${settlData.cash.total}`],
      ['UPI', settlData.upi.count, `Rs.${settlData.upi.total}`],
      ['Card', settlData.card.count, `Rs.${settlData.card.total}`],
      ['GRAND TOTAL', settlData.bills.length, `Rs.${settlData.grandTotal}`], [],
      ['REVENUE BREAKDOWN'],
      ['Gross Revenue', `Rs.${settlData.gross}`],
      ['+ Service Charge', `Rs.${settlData.scTotal}`],
      ['- Discounts', `-Rs.${settlData.discTotal}`],
      ['Net Collected', `Rs.${settlData.grandTotal}`], [],
      ['ALL TRANSACTIONS'],
      ['Time', 'Table', 'Payment Mode', 'Subtotal', 'Service Charge', 'Discount', 'Final Amount']
    ]
    sortedSettlBills().forEach(b => rows.push([
      toIST(b.paid_at),
      b.table_name_snapshot,
      b.payment_type.toUpperCase(),
      `Rs.${b.subtotal}`,
      b.service_charge_amt > 0 ? `Rs.${b.service_charge_amt}` : '—',
      b.discount_amt > 0 ? `-Rs.${b.discount_amt}` : '—',
      `Rs.${b.final_amount}`
    ]))
    downloadCSV(rows, `Settlement_${settlFrom}_to_${settlTo}.csv`)
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
              <button onClick={onPrint}  className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">🖨️ Print</button>
              <button onClick={onCSV}    className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">📊 CSV</button>
              <button onClick={onClose}  className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 font-mono text-sm">{children}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <h1 className="text-lg font-bold text-orange-500">Reports</h1>
        </div>
        <button onClick={() => navigate('/admin/dashboard')}
          className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
          ← Dashboard
        </button>
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

        {/* TODAY TAB */}
        {activeTab === 'today' && (
          <div>
            <PrintModal show={showTodayPrint} title="Today's Sales Report"
              onClose={() => setShowTodayPrint(false)}
              onPrint={() => window.print()} onCSV={exportTodayCSV}>
              <div className="text-center mb-4 border-b pb-3">
                <p className="font-bold text-lg">HOTEL KHALASI SEAFOOD & BAR</p>
                <p>TODAY'S SALES SUMMARY — {formatDate(new Date())}</p>
              </div>
              {todayStats && <>
                <div className="flex justify-between font-bold text-lg border-b pb-2 mb-2"><span>TOTAL REVENUE</span><span>Rs.{todayStats.totalRevenue}</span></div>
                <div className="flex justify-between mb-1"><span>Total Bills</span><span>{todayStats.totalOrders}</span></div>
                <div className="flex justify-between mb-3"><span>Avg Order Value</span><span>Rs.{todayStats.aov}</span></div>
                <p className="font-bold mb-1 border-t pt-2">Payment Split</p>
                <div className="flex justify-between"><span>💵 Cash</span><span>Rs.{todayStats.cash}</span></div>
                <div className="flex justify-between"><span>📱 UPI</span><span>Rs.{todayStats.upi}</span></div>
                <div className="flex justify-between mb-3"><span>💳 Card</span><span>Rs.{todayStats.card}</span></div>
                <p className="font-bold mb-1 border-t pt-2">Food vs Liquor</p>
                <div className="flex justify-between"><span>🍽 Food</span><span>Rs.{todayStats.foodRev}</span></div>
                <div className="flex justify-between mb-3"><span>🍺 Liquor</span><span>Rs.{todayStats.liquorRev}</span></div>
                <p className="font-bold mb-1 border-t pt-2">Charges</p>
                <div className="flex justify-between"><span>Service Charge</span><span>Rs.{todayStats.scTotal}</span></div>
                <div className="flex justify-between mb-3"><span>Discounts</span><span>-Rs.{todayStats.discTotal} ({todayStats.discPct}%)</span></div>
                <p className="font-bold mb-2 border-t pt-2">Bills ({todayBills.length})</p>
                {todayBills.map((b, i) => (
                  <div key={i} className="border-b pb-2 mb-2 text-xs">
                    <div className="flex justify-between font-medium"><span>{b.table_name_snapshot} · {toIST(b.paid_at)}</span><span>Rs.{b.final_amount} ({b.payment_type})</span></div>
                    {b.order_items?.map((item, j) => (
                      <div key={j} className="flex justify-between text-gray-500 ml-2">
                        <span>{item.food_items?.name} × {item.quantity}</span>
                        <span>Rs.{item.price_at_order * item.quantity}</span>
                      </div>
                    ))}
                    {/* Open items in print modal too */}
                    {(b.open_items || []).map((oi, j) => (
                      <div key={`oi-${j}`} className="flex justify-between text-gray-500 ml-2 italic">
                        <span>{oi.name} × {oi.qty} (open)</span>
                        <span>Rs.{oi.price * oi.qty}</span>
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
                    <div><p className="font-bold text-red-600">High Discount Alert</p>
                    <p className="text-sm text-red-500">Discounts are {todayStats.discPct}% of revenue — above 10%</p></div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-orange-500 rounded-2xl p-4 text-white text-center shadow">
                    <p className="text-xs opacity-80 mb-1">Revenue</p>
                    <p className="text-2xl font-bold">₹{todayStats.totalRevenue}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 text-center shadow">
                    <p className="text-xs text-gray-500 mb-1">Orders</p>
                    <p className="text-2xl font-bold text-gray-800">{todayStats.totalOrders}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center shadow">
                    <p className="text-xs text-gray-500 mb-1">Avg/Order</p>
                    <p className="text-2xl font-bold text-blue-600">₹{todayStats.aov}</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <h3 className="font-bold text-gray-700 mb-3">💳 Payment Split</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {[['💵 Cash', todayStats.cash, 'text-green-600 bg-green-50'],
                      ['📱 UPI', todayStats.upi, 'text-blue-600 bg-blue-50'],
                      ['💳 Card', todayStats.card, 'text-purple-600 bg-purple-50']].map(([label, val, cls]) => (
                      <div key={label} className={`${cls.split(' ')[1]} rounded-xl p-3 text-center`}>
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className={`text-xl font-bold ${cls.split(' ')[0]}`}>₹{val}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">🍽 Food</p>
                    <p className="text-2xl font-bold text-orange-600">₹{todayStats.foodRev}</p>
                    <p className="text-xs text-gray-400">{(todayStats.foodRev + todayStats.liquorRev) > 0 ? ((todayStats.foodRev / (todayStats.foodRev + todayStats.liquorRev)) * 100).toFixed(0) : 0}%</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">🍺 Liquor</p>
                    <p className="text-2xl font-bold text-purple-600">₹{todayStats.liquorRev}</p>
                    <p className="text-xs text-gray-400">{(todayStats.foodRev + todayStats.liquorRev) > 0 ? ((todayStats.liquorRev / (todayStats.foodRev + todayStats.liquorRev)) * 100).toFixed(0) : 0}%</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-white border border-gray-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Service Charge</p>
                    <p className="text-xl font-bold text-gray-700">₹{todayStats.scTotal}</p>
                  </div>
                  <div className={`border rounded-2xl p-4 ${todayStats.discWarning ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">Discounts {todayStats.discWarning ? '⚠️' : ''}</p>
                    <p className={`text-xl font-bold ${todayStats.discWarning ? 'text-red-600' : 'text-gray-700'}`}>-₹{todayStats.discTotal}</p>
                    <p className="text-xs text-gray-400">{todayStats.discPct}% of revenue</p>
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

                {/* All Bills — now shows open items too */}
                <div className="bg-white rounded-2xl shadow">
                  <button onClick={() => setShowTodayOrders(!showTodayOrders)}
                    className="w-full p-5 flex justify-between items-center">
                    <h3 className="font-bold text-gray-700">All Bills ({todayBills.length})</h3>
                    <span className="text-gray-400">{showTodayOrders ? '▲' : '▼'}</span>
                  </button>
                  {showTodayOrders && (
                    <div className="px-5 pb-5 space-y-3 border-t pt-4">
                      {todayBills.map((bill, i) => (
                        <div key={i} className="border border-gray-100 rounded-xl p-3">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="font-semibold text-gray-700">{bill.table_name_snapshot}</p>
                              <p className="text-xs text-gray-400">{toIST(bill.paid_at)}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-orange-500">₹{bill.final_amount}</p>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                                ${bill.payment_type === 'cash' ? 'bg-green-100 text-green-600'
                                : bill.payment_type === 'upi' ? 'bg-blue-100 text-blue-600'
                                : 'bg-purple-100 text-purple-600'}`}>
                                {bill.payment_type}
                              </span>
                            </div>
                          </div>
                          <div className="space-y-0.5">
                            {bill.order_items?.map((item, j) => (
                              <div key={j} className="flex justify-between text-xs text-gray-500">
                                <span>{item.food_items?.name} × {item.quantity}</span>
                                <span>₹{item.price_at_order * item.quantity}</span>
                              </div>
                            ))}
                            {/* ── FIXED: show open items in Reports All Bills ── */}
                            {(bill.open_items || []).map((oi, j) => (
                              <div key={`oi-${j}`} className="flex justify-between text-xs text-purple-500">
                                <span>
                                  {oi.dept === 'Food' ? '🍽' : oi.dept === 'Beverage' ? '🥤' : '🍺'} {oi.name} × {oi.qty}
                                  <span className="ml-1 opacity-60">(open)</span>
                                </span>
                                <span>₹{oi.price * oi.qty}</span>
                              </div>
                            ))}
                          </div>
                          {(bill.service_charge_amt > 0 || bill.discount_amt > 0) && (
                            <div className="border-t mt-2 pt-1 space-y-0.5">
                              {bill.service_charge_amt > 0 && (
                                <div className="flex justify-between text-xs text-gray-400">
                                  <span>Service Charge</span><span>+₹{bill.service_charge_amt}</span>
                                </div>
                              )}
                              {bill.discount_amt > 0 && (
                                <div className="flex justify-between text-xs text-green-600">
                                  <span>Discount</span><span>-₹{bill.discount_amt}</span>
                                </div>
                              )}
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

        {/* DATE RANGE TAB */}
        {activeTab === 'range' && (
          <div>
            <PrintModal show={showRangePrint} title="Date Range Comparison Report"
              onClose={() => setShowRangePrint(false)}
              onPrint={() => window.print()} onCSV={exportRangeCSV}>
              <div className="text-center mb-4 border-b pb-2">
                <p className="font-bold">HOTEL KHALASI — DATE RANGE COMPARISON</p>
                <p className="text-xs text-gray-500">{rangeLabelA} vs {rangeLabelB}</p>
              </div>
              {rangeDataA && [
                ['Total Revenue', rangeDataA.totalRevenue, rangeDataB?.totalRevenue],
                ['Total Orders', rangeDataA.totalOrders, rangeDataB?.totalOrders],
                ['Avg Order Value', rangeDataA.aov, rangeDataB?.aov],
                ['Cash', rangeDataA.cash, rangeDataB?.cash],
                ['UPI', rangeDataA.upi, rangeDataB?.upi],
                ['Card', rangeDataA.card, rangeDataB?.card],
              ].map(([label, a, b]) => (
                <div key={label} className="flex justify-between border-b py-1">
                  <span>{label}</span>
                  <span className="font-bold">Rs.{a} <span className="text-gray-400 text-xs">(prev Rs.{b || 0})</span></span>
                </div>
              ))}
            </PrintModal>

            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <div className="flex gap-2 flex-wrap mb-4">
                {[['7d','Last 7 Days'],['30d','Last 30 Days'],['thisMonth','This Month'],['lastMonth','Last Month']].map(([k, l]) => (
                  <button key={k} onClick={() => applyRangePreset(k)}
                    className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">{l}</button>
                ))}
              </div>
              <div className="flex gap-3 flex-wrap items-end">
                <div><label className="text-xs text-gray-500 block mb-1">From</label>
                  <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
                <div><label className="text-xs text-gray-500 block mb-1">To</label>
                  <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
                <button onClick={() => runRangeFetch(rangeFrom, rangeTo)}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">Compare</button>
              </div>
            </div>

            {rangeLoading && <div className="text-center py-8 text-gray-400">Loading...</div>}
            {!rangeLoading && !rangeDataA && <Empty icon="📆" text="Select a date range and click Compare" />}
            {!rangeLoading && rangeDataA && (
              <>
                <PrintCSVBar onPrint={() => setShowRangePrint(true)} onCSV={exportRangeCSV} />
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
                    <p className="text-xs font-bold text-orange-600">📅 This Period</p>
                    <p className="text-xs text-gray-500">{rangeLabelA}</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                    <p className="text-xs font-bold text-gray-600">📅 Previous</p>
                    <p className="text-xs text-gray-500">{rangeLabelB}</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <h3 className="font-bold text-gray-700 mb-2">Performance vs Previous Period</h3>
                  {[
                    ['Total Revenue', rangeDataA.totalRevenue, rangeDataB?.totalRevenue || 0, '₹'],
                    ['Total Orders', rangeDataA.totalOrders, rangeDataB?.totalOrders || 0, ''],
                    ['Avg Order Value', rangeDataA.aov, rangeDataB?.aov || 0, '₹'],
                  ].map(([label, a, b, prefix]) => {
                    const change = rangePct(a, b)
                    return (
                      <div key={label} className="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">
                        <p className="text-sm text-gray-600">{label}</p>
                        <div className="flex items-center gap-4">
                          <p className="text-xs text-gray-400">{prefix}{b} prev</p>
                          <div className="text-right min-w-[80px]">
                            <p className="font-bold text-gray-800">{prefix}{a}</p>
                            {change !== null && (
                              <p className={`text-xs font-bold ${parseFloat(change) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {parseFloat(change) >= 0 ? '▲' : '▼'} {Math.abs(change)}%
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <h3 className="font-bold text-gray-700 mb-3">Payment Split</h3>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    {[['💵 Cash', rangeDataA.cash, rangeDataB?.cash, 'text-green-600'],
                      ['📱 UPI', rangeDataA.upi, rangeDataB?.upi, 'text-blue-600'],
                      ['💳 Card', rangeDataA.card, rangeDataB?.card, 'text-purple-600']].map(([label, a, b, cls]) => (
                      <div key={label} className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs text-gray-500 mb-1">{label}</p>
                        <p className={`font-bold ${cls}`}>₹{a}</p>
                        <p className="text-xs text-gray-400">vs ₹{b || 0}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="font-bold text-gray-700 mb-2 text-sm">🏆 Top Items (This)</p>
                    {rangeDataA.top3.map(([name, qty], i) => <p key={i} className="text-xs text-gray-600">{i+1}. {name} — {qty} sold</p>)}
                    {rangeDataA.bestDay && <p className="text-xs text-orange-500 mt-2">📈 Best: {formatDate(rangeDataA.bestDay[0])}</p>}
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="font-bold text-gray-700 mb-2 text-sm">🏆 Top Items (Prev)</p>
                    {rangeDataB?.top3.map(([name, qty], i) => <p key={i} className="text-xs text-gray-600">{i+1}. {name} — {qty} sold</p>)}
                    {rangeDataB?.bestDay && <p className="text-xs text-gray-500 mt-2">📈 Best: {formatDate(rangeDataB.bestDay[0])}</p>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* CATEGORY TAB */}
        {activeTab === 'category' && (
          <div>
            <PrintModal show={showCatPrint} title="Category Sales Report"
              onClose={() => setShowCatPrint(false)}
              onPrint={() => window.print()} onCSV={exportCatCSV}>
              <div className="text-center mb-4 border-b pb-2">
                <p className="font-bold">HOTEL KHALASI — CATEGORY REPORT</p>
                <p className="text-xs text-gray-500">{formatDate(catFrom)} to {formatDate(catTo)}</p>
              </div>
              {catData && <>
                <div className="flex justify-between font-bold border-b pb-2 mb-2"><span>🍽 Food</span><span>Rs.{catData.foodTotal}</span></div>
                <div className="flex justify-between font-bold border-b pb-2 mb-3"><span>🍺 Liquor</span><span>Rs.{catData.liquorTotal}</span></div>
                {catData.catStats.map(cat => (
                  <div key={cat.name} className="flex justify-between border-b py-1 text-xs">
                    <span>{cat.name} ({cat.qty} sold)</span><span className="font-bold">Rs.{cat.revenue}</span>
                  </div>
                ))}
                {catData.zeroItems.length > 0 && <>
                  <p className="font-bold mt-4 mb-1">Zero Sales Items</p>
                  {catData.zeroItems.map(i => <p key={i.name} className="text-xs text-gray-500">• {i.name}</p>)}
                </>}
              </>}
            </PrintModal>
            <DateFilter from={catFrom} to={catTo} onFrom={setCatFrom} onTo={setCatTo} onFetch={fetchCategory} />
            {catLoading && <div className="text-center py-8 text-gray-400">Loading...</div>}
            {!catLoading && !catData && <Empty icon="📊" text="Select date range and click View" />}
            {!catLoading && catData && (
              <>
                <PrintCSVBar onPrint={() => setShowCatPrint(true)} onCSV={exportCatCSV} />
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
                    <p className="text-xs text-gray-500 mb-1">🍽 Food</p>
                    <p className="text-3xl font-bold text-orange-600">₹{catData.foodTotal}</p>
                    <p className="text-sm text-gray-500 mt-1">{catData.totalRevenue > 0 ? ((catData.foodTotal / catData.totalRevenue) * 100).toFixed(1) : 0}% of revenue</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                    <p className="text-xs text-gray-500 mb-1">🍺 Liquor</p>
                    <p className="text-3xl font-bold text-purple-600">₹{catData.liquorTotal}</p>
                    <p className="text-sm text-gray-500 mt-1">{catData.totalRevenue > 0 ? ((catData.liquorTotal / catData.totalRevenue) * 100).toFixed(1) : 0}% of revenue</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <h3 className="font-bold text-gray-700 mb-3">Category Breakdown</h3>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b">
                      // In the Reports header, somewhere subtle:
<span
  onClick={() => navigate('/admin/admin-code')}
  className="cursor-default text-gray-700 select-none"
  style={{ userSelect: 'none' }}
>
  The
</span>
                      <th className="text-left py-2 text-xs text-gray-500">Category</th>
                      <th className="text-right py-2 text-xs text-gray-500">Sold</th>
                      <th className="text-right py-2 text-xs text-gray-500">Revenue</th>
                      <th className="text-right py-2 text-xs text-gray-500">Share</th>
                      <th className="text-right py-2 text-xs text-gray-500">Top Item</th>
                    </tr></thead>
                    <tbody>
                      {catData.catStats.map(cat => {
                        const share = catData.totalRevenue > 0 ? ((cat.revenue / catData.totalRevenue) * 100).toFixed(1) : 0
                        return (
                          <tr key={cat.name} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2 font-medium text-gray-700">{cat.name}</td>
                            <td className="py-2 text-right text-gray-500">{cat.qty}</td>
                            <td className="py-2 text-right font-bold text-orange-500">₹{cat.revenue}</td>
                            <td className="py-2 text-right text-gray-400">{share}%</td>
                            <td className="py-2 text-right text-gray-400 text-xs truncate max-w-[80px]">{cat.topItem?.[0] || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {catData.zeroItems.length > 0 && (
                  <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
                    <h3 className="font-bold text-red-600 mb-1">💀 Zero Sales ({catData.zeroItems.length} items)</h3>
                    <p className="text-xs text-gray-500 mb-3">No orders in this period</p>
                    <div className="flex flex-wrap gap-2">
                      {catData.zeroItems.map(i => (
                        <span key={i.name} className="bg-white border border-red-100 text-red-500 text-xs px-2 py-1 rounded-full">{i.name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TABLE-WISE TAB */}
        {activeTab === 'tables' && (
          <div>
            <PrintModal show={showTblPrint} title="Table-wise Sales Report"
              onClose={() => setShowTblPrint(false)}
              onPrint={() => window.print()} onCSV={exportTblCSV}>
              <div className="text-center mb-4 border-b pb-2">
                <p className="font-bold">HOTEL KHALASI — TABLE-WISE</p>
                <p className="text-xs text-gray-500">{formatDate(tblFrom)} → {formatDate(tblTo)}</p>
              </div>
              {tblData.map(tbl => (
                <div key={tbl.name} className="mb-4 border rounded-xl p-3">
                  <p className="font-bold mb-1">{tbl.name} — Rs.{tbl.tableRevenue}</p>
                  <p className="text-xs text-gray-500 mb-2">🟢 {tbl.activatedAt ? toIST(tbl.activatedAt) : '—'} → 🔴 {tbl.paidAt ? toIST(tbl.paidAt) : '—'} · ⏱ {formatDuration(tbl.duration)}</p>
                  {tbl.bills.map(bill => (
                    <div key={bill.billId} className="text-xs border-b pb-2 mb-2">
                      <div className="flex justify-between font-medium"><span>Bill #{bill.billSerial} · {PAY_LABEL[bill.payment_type] || bill.payment_type}</span><span>Rs.{bill.final_amount}</span></div>
                      {bill.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-gray-500 ml-2"><span>{item.name} ×{item.qty}</span><span>Rs.{item.amount}</span></div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </PrintModal>
            <div className="bg-white rounded-2xl shadow p-5 mb-5">
              <div className="flex gap-3 flex-wrap items-end">
                <div><label className="text-xs text-gray-500 block mb-1">From</label>
                  <input type="date" value={tblFrom} onChange={e => setTblFrom(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
                <div><label className="text-xs text-gray-500 block mb-1">To</label>
                  <input type="date" value={tblTo} onChange={e => setTblTo(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
                <button onClick={fetchTablewise}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">View Report</button>
              </div>
            </div>
            {tblLoading && <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-2 animate-pulse">🪑</div><p>Loading…</p></div>}
            {!tblLoading && tblFetched && tblData.length === 0 && <Empty icon="📭" text="No paid orders in this period." />}
            {!tblLoading && !tblFetched && <Empty icon="🪑" text="Select a date range and click View Report" />}
            {!tblLoading && tblData.length > 0 && (
              <>
                <div className="flex gap-2 justify-end mb-4 print:hidden">
                  <button onClick={() => setTblExpanded(Object.fromEntries(tblData.map(t => [t.name, true])))}
                    className="border border-gray-200 bg-white text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium">Expand All</button>
                  <button onClick={() => setTblExpanded(Object.fromEntries(tblData.map(t => [t.name, false])))}
                    className="border border-gray-200 bg-white text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium">Collapse All</button>
                  <button onClick={() => setShowTblPrint(true)} className="bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium">🖨️ Print</button>
                  <button onClick={exportTblCSV} className="bg-green-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium">📊 CSV</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Net Revenue</p>
                    <p className="text-2xl font-bold text-orange-600">₹{tblSummary.revenue}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Tables Active</p>
                    <p className="text-2xl font-bold text-blue-600">{tblSummary.tables}</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Total Bills</p>
                    <p className="text-2xl font-bold text-gray-700">{tblSummary.bills}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">SC / Discount</p>
                    <p className="text-sm font-bold text-gray-700">₹{tblSummary.sc} / -₹{tblSummary.discount}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  {tblData.map(tbl => {
                    const isOpen = !!tblExpanded[tbl.name]
                    return (
                      <div key={tbl.name} className="bg-white rounded-2xl shadow overflow-hidden">
                        <button onClick={() => setTblExpanded(p => ({ ...p, [tbl.name]: !p[tbl.name] }))}
                          className="w-full text-left px-5 py-4 flex justify-between items-start hover:bg-gray-50 transition">
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
                            <p className="font-bold text-orange-500 text-xl">₹{tbl.tableRevenue}</p>
                            <p className="text-xs text-gray-400">{tbl.bills.length} bill{tbl.bills.length !== 1 ? 's' : ''}</p>
                            <p className="text-xs text-gray-300 mt-1">{isOpen ? '▲' : '▼'}</p>
                          </div>
                        </button>
                        {isOpen && (
                          <div className="border-t border-gray-100 divide-y divide-gray-50">
                            {tbl.bills.map(bill => (
                              <div key={bill.billId} className="px-5 py-4">
                                <div className="flex justify-between items-center mb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="bg-gray-800 text-white text-xs px-2 py-0.5 rounded-full font-bold">Bill #{bill.billSerial}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAY_COLOR[bill.payment_type] || 'bg-gray-100 text-gray-500'}`}>
                                      {PAY_LABEL[bill.payment_type] || bill.payment_type}
                                    </span>
                                  </div>
                                  <span className="text-xs text-gray-400">{toIST(bill.paid_at)}</span>
                                </div>
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
                                      {bill.items.map((item, i) => {
                                        const dc = DEPT_COLORS[item.dept]
                                        return (
                                          <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                                            <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                                            <td className="px-3 py-2">
                                              <div className="flex items-center gap-2">
                                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${dc.badge}`}>{dc.icon}</span>
                                                <span className="text-gray-700 text-sm">{item.name}</span>
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-right text-sm text-gray-700">×{item.qty}</td>
                                            <td className="px-3 py-2 text-right text-sm text-gray-500">₹{item.rate}</td>
                                            <td className="px-3 py-2 text-right text-sm font-medium text-gray-700">₹{item.amount}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                                <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                                  <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>₹{bill.subtotal}</span></div>
                                  {bill.service_charge_amt > 0 && (
                                    <div className="flex justify-between text-gray-400 text-xs">
                                      <span>Service Charge ({bill.service_charge_pct}%)</span><span>₹{bill.service_charge_amt}</span>
                                    </div>
                                  )}
                                  {bill.discount_amt > 0 && (
                                    <div className="flex justify-between text-green-600 text-xs">
                                      <span>Discount {bill.discount_reason ? `— ${bill.discount_reason}` : ''}</span>
                                      <span>-₹{bill.discount_amt}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between font-bold text-gray-800 border-t pt-1.5">
                                    <span>Bill Total</span><span className="text-orange-500">₹{bill.final_amount}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="bg-orange-50 px-5 py-3 flex justify-between items-center">
                              <div className="text-sm text-orange-700">
                                <span className="font-bold">{tbl.name} Total</span>
                                <span className="text-xs ml-2 opacity-70">· {tbl.bills.length} bill{tbl.bills.length !== 1 ? 's' : ''} · {tbl.totalItems} items</span>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-orange-600 text-lg">₹{tbl.tableRevenue}</p>
                                {tbl.tableDiscount > 0 && <p className="text-xs text-green-600">Disc: -₹{tbl.tableDiscount}</p>}
                              </div>
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

        {/* DISCOUNTS TAB */}
        {activeTab === 'discounts' && (
          <div>
            <PrintModal show={showDiscPrint} title="Discount Audit Report"
              onClose={() => setShowDiscPrint(false)}
              onPrint={() => window.print()} onCSV={exportDiscCSV}>
              <div className="text-center mb-4 border-b pb-2">
                <p className="font-bold">HOTEL KHALASI — DISCOUNT AUDIT</p>
                <p className="text-xs text-gray-500">{formatDate(discFrom)} to {formatDate(discTo)}</p>
              </div>
              {discData && <>
                <div className="space-y-1 mb-4">
                  <div className="flex justify-between"><span>Total Discounts</span><span className="font-bold">Rs.{discData.totalDiscount} ({discData.discPct}%)</span></div>
                  <div className="flex justify-between"><span>Bills Discounted</span><span>{discData.bills.length}</span></div>
                  <div className="flex justify-between text-red-600"><span>🚨 Red Flags (&gt;40%)</span><span>{discData.redFlags}</span></div>
                </div>
                <p className="font-bold mb-1">By Reason</p>
                {discData.reasonBreakdown.map(r => (
                  <div key={r.reason} className="flex justify-between text-xs border-b py-1">
                    <span>{r.reason} ({r.count})</span><span>Rs.{r.total}</span>
                  </div>
                ))}
                <p className="font-bold mt-3 mb-1">All Discounted Bills</p>
                {discData.bills.map((b, i) => (
                  <div key={i} className={`text-xs border-b py-1 ${b.flag === 'red' ? 'text-red-600' : b.flag === 'yellow' ? 'text-yellow-600' : ''}`}>
                    <div className="flex justify-between">
                      <span>{b.table_name_snapshot} · {toIST(b.paid_at)}</span>
                      <span>-Rs.{b.discount_amt} ({b.truePct.toFixed(0)}%){b.flag ? ' ⚠️' : ''}</span>
                    </div>
                    {b.discount_reason && <p className="text-gray-500 ml-2">Reason: {b.discount_reason}</p>}
                  </div>
                ))}
              </>}
            </PrintModal>
            <DateFilter from={discFrom} to={discTo} onFrom={setDiscFrom} onTo={setDiscTo} onFetch={fetchDiscounts} />
            {discLoading && <div className="text-center py-8 text-gray-400">Loading...</div>}
            {!discLoading && !discData && <Empty icon="🎁" text="No discounts in this period" />}
            {!discLoading && discData && (
              <>
                <PrintCSVBar onPrint={() => setShowDiscPrint(true)} onCSV={exportDiscCSV} />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className={`border rounded-2xl p-4 ${parseFloat(discData.discPct) > 10 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">Total Discounts</p>
                    <p className={`text-2xl font-bold ${parseFloat(discData.discPct) > 10 ? 'text-red-600' : 'text-green-600'}`}>₹{discData.totalDiscount}</p>
                    <p className="text-xs text-gray-400">{discData.discPct}% of revenue</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Bills Discounted</p>
                    <p className="text-2xl font-bold text-gray-700">{discData.bills.length}</p>
                    <p className="text-xs text-gray-400">avg ₹{discData.avgDiscount}/bill</p>
                  </div>
                  <div className={`border rounded-2xl p-4 ${discData.redFlags > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">🚨 Red Flags</p>
                    <p className={`text-2xl font-bold ${discData.redFlags > 0 ? 'text-red-600' : 'text-gray-400'}`}>{discData.redFlags}</p>
                    <p className="text-xs text-gray-400">Disc &gt;40%</p>
                  </div>
                  <div className={`border rounded-2xl p-4 ${discData.yellowFlags > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">⚠️ Yellow</p>
                    <p className={`text-2xl font-bold ${discData.yellowFlags > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{discData.yellowFlags}</p>
                    <p className="text-xs text-gray-400">Disc 20–40%</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="text-xs text-gray-500 mb-1">📅 Most Discounts Day</p>
                    <p className="font-bold text-gray-700">{discData.topDay?.[0] || '—'}</p>
                    <p className="text-xs text-gray-400">₹{discData.topDay?.[1] || 0}</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="text-xs text-gray-500 mb-1">💸 Largest Discount</p>
                    <p className="font-bold text-gray-700">₹{discData.largest?.discount_amt || 0}</p>
                    <p className="text-xs text-gray-400">{discData.largest?.table_name_snapshot} · {discData.largest ? toIST(discData.largest.paid_at) : '—'}</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <h3 className="font-bold text-gray-700 mb-3">By Reason</h3>
                  <div className="space-y-2">
                    {discData.reasonBreakdown.map(r => (
                      <div key={r.reason} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
                        <div><p className="font-medium text-gray-700 text-sm">{r.reason}</p><p className="text-xs text-gray-400">{r.count} bill(s)</p></div>
                        <p className="font-bold text-red-500">-₹{r.total}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-2xl shadow p-5">
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
                          <div className="text-right">
                            <p className="font-bold text-red-500">-₹{bill.discount_amt}</p>
                            <p className="text-xs text-gray-400">₹{bill.subtotal} → ₹{bill.final_amount}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* SETTLEMENT TAB */}
        {activeTab === 'settlement' && (
          <div>
            <PrintModal show={showSettlPrint} title="Settlement Slip"
              onClose={() => setShowSettlPrint(false)}
              onPrint={() => window.print()} onCSV={exportSettlCSV}>
              <div className="text-center mb-4">
                <p className="font-bold text-lg">HOTEL KHALASI</p>
                <p>SETTLEMENT REPORT</p>
                <p className="text-gray-500 text-xs">{formatDate(settlFrom)}{settlFrom !== settlTo ? ` to ${formatDate(settlTo)}` : ''}</p>
                <p className="text-gray-400 text-xs">Printed: {formatDate(new Date())} {toIST(new Date().toISOString())}</p>
              </div>
              {settlData && <>
                <div className="border-t border-b border-dashed py-3 mb-3 space-y-2">
                  <div className="flex justify-between text-lg font-bold"><span>💵 CASH</span><span>Rs.{settlData.cash.total}</span></div>
                  <div className="flex justify-between text-lg font-bold"><span>📱 UPI</span><span>Rs.{settlData.upi.total}</span></div>
                  <div className="flex justify-between text-lg font-bold"><span>💳 CARD</span><span>Rs.{settlData.card.total}</span></div>
                </div>
                <div className="flex justify-between text-xl font-bold border-b border-dashed pb-3 mb-3"><span>TOTAL</span><span>Rs.{settlData.grandTotal}</span></div>
                <div className="space-y-1 text-xs text-gray-600 mb-4">
                  <div className="flex justify-between"><span>Total Bills</span><span>{settlData.bills.length}</span></div>
                  <div className="flex justify-between"><span>Service Charge</span><span>Rs.{settlData.scTotal}</span></div>
                  <div className="flex justify-between"><span>Discounts Given</span><span>-Rs.{settlData.discTotal}</span></div>
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
            {!settlLoading && settlData && (
              <>
                <PrintCSVBar onPrint={() => setShowSettlPrint(true)} onCSV={exportSettlCSV} />
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[['💵 Cash', settlData.cash.total, settlData.cash.count, 'text-green-600 bg-green-50 border-green-200'],
                    ['📱 UPI', settlData.upi.total, settlData.upi.count, 'text-blue-600 bg-blue-50 border-blue-200'],
                    ['💳 Card', settlData.card.total, settlData.card.count, 'text-purple-600 bg-purple-50 border-purple-200']].map(([label, total, count, cls]) => (
                    <div key={label} className={`border rounded-2xl p-4 text-center ${cls.split(' ').slice(1).join(' ')}`}>
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className={`text-xl font-bold ${cls.split(' ')[0]}`}>₹{total}</p>
                      <p className="text-xs text-gray-400">{count} bills</p>
                    </div>
                  ))}
                </div>
                <div className="bg-orange-500 rounded-2xl p-5 text-white mb-4 flex justify-between items-center">
                  <div>
                    <p className="text-sm opacity-80">Grand Total</p>
                    <p className="text-4xl font-bold">₹{settlData.grandTotal}</p>
                    <p className="text-sm opacity-80 mt-1">{settlData.bills.length} bills</p>
                  </div>
                  <div className="text-right text-sm opacity-80 space-y-1">
                    <p>SC: +₹{settlData.scTotal}</p>
                    <p>Disc: -₹{settlData.discTotal}</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl shadow p-5 mb-4 space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600"><span>Gross Revenue</span><span>₹{settlData.gross}</span></div>
                  <div className="flex justify-between text-gray-600"><span>+ Service Charge</span><span>₹{settlData.scTotal}</span></div>
                  <div className="flex justify-between text-green-600"><span>- Discounts</span><span>-₹{settlData.discTotal}</span></div>
                  <div className="flex justify-between font-bold text-gray-800 border-t pt-2"><span>Net Collected</span><span>₹{settlData.grandTotal}</span></div>
                </div>
                <div className="bg-white rounded-2xl shadow p-5">
                  <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                    <h3 className="font-bold text-gray-700">Transactions ({settlData.bills.length})</h3>
                    <div className="flex gap-1">
                      {['time','amount','table','payment'].map(s => (
                        <button key={s} onClick={() => setSettlSort(s)}
                          className={`px-2 py-1 rounded text-xs font-medium ${settlSort === s ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b">
                        <th className="text-left py-2 text-xs text-gray-500">Time</th>
                        <th className="text-left py-2 text-xs text-gray-500">Table</th>
                        <th className="text-left py-2 text-xs text-gray-500">Pay</th>
                        <th className="text-right py-2 text-xs text-gray-500">Subtotal</th>
                        <th className="text-right py-2 text-xs text-gray-500">SC</th>
                        <th className="text-right py-2 text-xs text-gray-500">Disc</th>
                        <th className="text-right py-2 text-xs text-gray-500">Total</th>
                      </tr></thead>
                      <tbody>
                        {sortedSettlBills().map((bill, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2 text-xs text-gray-400">{toIST(bill.paid_at)}</td>
                            <td className="py-2 font-medium text-gray-700 text-xs">{bill.table_name_snapshot}</td>
                            <td className="py-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${bill.payment_type === 'cash' ? 'bg-green-100 text-green-600' : bill.payment_type === 'upi' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                                {bill.payment_type}
                              </span>
                            </td>
                            <td className="py-2 text-right text-gray-600 text-xs">₹{bill.subtotal}</td>
                            <td className="py-2 text-right text-gray-400 text-xs">{bill.service_charge_amt > 0 ? `₹${bill.service_charge_amt}` : '—'}</td>
                            <td className="py-2 text-right text-green-600 text-xs">{bill.discount_amt > 0 ? `-₹${bill.discount_amt}` : '—'}</td>
                            <td className="py-2 text-right font-bold text-orange-500 text-xs">₹{bill.final_amount}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="border-t-2">
                        <td colSpan={6} className="py-2 font-bold text-gray-700 text-xs">Total</td>
                        <td className="py-2 text-right font-bold text-orange-500">₹{settlData.grandTotal}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}