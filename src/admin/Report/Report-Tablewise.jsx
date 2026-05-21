import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase/client'

// ── Helpers ───────────────────────────────────────────────
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
  if (mins < 60) return `${mins} Min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ── Department classification (mirrors Reports.jsx) ───────
const LIQUOR_KEYWORDS = [
  'beer','wine','whisky','whiskey','vodka','rum','gin','tequila','brandy',
  'champagne','scotch','bourbon','ale','lager','cider','sake','mead','port',
  'liquor','spirits','pint','draft','draught','feni','arrack','toddy','sangria',
  'kingfisher','corona','budweiser','heineken','bacardi','smirnoff','absolut',
  'jack daniel','jameson','old monk','mcdownell','royal stag','imperial blue',
  'teachers','blenders','black dog','black label','red label','green label',
  'shot','peg','quarter','half bottle','full bottle','liit','long island',
]
const BEVERAGE_KEYWORDS = [
  'mocktail','juice','lassi','shake','smoothie','soda','water','mineral water',
  'cold drink','soft drink','tea','coffee','lemonade','buttermilk','chaas',
  'nimbu pani','coconut water','virgin','cold coffee','milkshake','frappe',
  'pepsi','coke','cola','sprite','limca','maaza','frooti','thums up','7up',
  'cold bev','bev','beverage','drink','mojito','cooler','squash','iced tea',
]
const BAKERY_KEYWORDS = [
  'bread','bun','naan','roti','paratha','chapati','puri','bhatura','kulcha',
  'bread basket','garlic bread','toast','sandwich','burger','pizza','pasta',
  'cake','pastry','muffin','cookie','biscuit','croissant','waffle','pancake',
  'dessert','ice cream','gulab jamun','halwa','kheer','pudding','brownie',
  'rasgulla','jalebi','ladoo','barfi','mithai','sweet',
]
const getDepartment = (name = '') => {
  const l = name.toLowerCase()
  if (LIQUOR_KEYWORDS.some(k => l.includes(k))) return 'Liquor'
  if (BEVERAGE_KEYWORDS.some(k => l.includes(k))) return 'Beverage'
  if (BAKERY_KEYWORDS.some(k => l.includes(k))) return 'Bakery'
  return 'Kitchen'
}
const DEPT_COLORS = {
  Kitchen:  { badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-400', icon: '🍳' },
  Bakery:   { badge: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-400', icon: '🥖' },
  Beverage: { badge: 'bg-blue-100   text-blue-700',   dot: 'bg-blue-400',   icon: '🥤' },
  Liquor:   { badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-400', icon: '🍺' },
}

const PAY_LABEL = { cash: '💵 Cash', upi: '📱 UPI / Online', card: '💳 Card' }
const PAY_COLOR = {
  cash: 'bg-green-100 text-green-700',
  upi:  'bg-blue-100  text-blue-700',
  card: 'bg-purple-100 text-purple-700',
}

// ── CSV helper ────────────────────────────────────────────
const downloadCSV = (rows, filename) => {
  const csv = rows.map(r =>
    r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ── Data fetching ─────────────────────────────────────────
const ORDER_SELECT = `
  id, payment_type, is_paid, created_at, paid_at,
  subtotal, service_charge_pct, service_charge_amt,
  discount_type, discount_value, discount_amt, discount_reason,
  final_amount, table_name_snapshot, table_id,
  order_items(quantity, price_at_order, food_items(name))
`

/*
  For each table we want:
   - table name
   - activated_at  → earliest created_at among its orders in range
   - paid_at       → latest paid_at
   - duration      → diff of the two
   - bills         → sorted by paid_at ASC (serial)
   - per-bill: serial bill no within this table, items, totals
   - table totals
*/
const buildTableGroups = (orders) => {
  // group by table_name_snapshot
  const map = {}
  orders.forEach(o => {
    const key = o.table_name_snapshot || 'Unknown'
    if (!map[key]) map[key] = { name: key, orders: [] }
    map[key].orders.push(o)
  })

  return Object.values(map).map(tbl => {
    // Sort orders by paid_at ascending for serial numbering
    const sorted = [...tbl.orders].sort(
      (a, b) => new Date(a.paid_at) - new Date(b.paid_at)
    )

    // activated_at = earliest created_at
    const activatedAt = tbl.orders.reduce((min, o) =>
      !min || new Date(o.created_at) < new Date(min) ? o.created_at : min
    , null)

    // paid_at = latest paid_at
    const paidAt = tbl.orders.reduce((max, o) =>
      !max || new Date(o.paid_at) > new Date(max) ? o.paid_at : max
    , null)

    const duration = diffMinutes(activatedAt, paidAt)

    // Merge order_items per order into bills
    const bills = sorted.map((o, idx) => ({
      billSerial: idx + 1,
      billId:     o.id,
      payment_type: o.payment_type,
      paid_at:    o.paid_at,
      created_at: o.created_at,
      subtotal:   o.subtotal || 0,
      service_charge_pct: o.service_charge_pct || 0,
      service_charge_amt: o.service_charge_amt || 0,
      discount_amt: o.discount_amt || 0,
      discount_type: o.discount_type,
      discount_value: o.discount_value || 0,
      discount_reason: o.discount_reason || '',
      final_amount: o.final_amount || 0,
      items: (o.order_items || []).map(i => ({
        name:    i.food_items?.name || 'Unknown',
        qty:     i.quantity,
        rate:    i.price_at_order,
        amount:  i.price_at_order * i.quantity,
        dept:    getDepartment(i.food_items?.name),
      })),
    }))

    const tableRevenue   = bills.reduce((s, b) => s + b.final_amount, 0)
    const tableSubtotal  = bills.reduce((s, b) => s + b.subtotal, 0)
    const tableDiscount  = bills.reduce((s, b) => s + b.discount_amt, 0)
    const tableSC        = bills.reduce((s, b) => s + b.service_charge_amt, 0)
    const totalItems     = bills.reduce((s, b) =>
      s + b.items.reduce((x, i) => x + i.qty, 0), 0)

    return {
      name: tbl.name,
      activatedAt,
      paidAt,
      duration,
      bills,
      tableRevenue,
      tableSubtotal,
      tableDiscount,
      tableSC,
      totalItems,
    }
  }).sort((a, b) => {
    // Sort tables by name (natural sort: T.No 1, T.No 2 …)
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
}

// ── Main Component ────────────────────────────────────────
export default function ReportTablewise() {
  const navigate = useNavigate()
  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate,   setToDate]   = useState(todayIST())
  const [loading,  setLoading]  = useState(false)
  const [tables,   setTables]   = useState([])
  const [fetched,  setFetched]  = useState(false)
  const [expanded, setExpanded] = useState({})   // tableName → bool
  const [showPrint, setShowPrint] = useState(false)

  const toggleTable = (name) =>
    setExpanded(p => ({ ...p, [name]: !p[name] }))

  const fetchReport = useCallback(async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(fromDate, toDate)
    const { data: orders, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: true })

    if (error) console.error('ReportTablewise fetch:', error.message)
    const grp = buildTableGroups(orders || [])
    setTables(grp)
    setFetched(true)
    setLoading(false)
    // Expand all by default
    const exp = {}
    grp.forEach(t => { exp[t.name] = true })
    setExpanded(exp)
  }, [fromDate, toDate])

  // Summary totals across all tables
  const summary = tables.reduce((s, t) => ({
    revenue:   s.revenue   + t.tableRevenue,
    subtotal:  s.subtotal  + t.tableSubtotal,
    discount:  s.discount  + t.tableDiscount,
    sc:        s.sc        + t.tableSC,
    bills:     s.bills     + t.bills.length,
    tables:    s.tables    + 1,
  }), { revenue: 0, subtotal: 0, discount: 0, sc: 0, bills: 0, tables: 0 })

  // CSV export
  const handleExportCSV = () => {
    const rows = [
      ['TABLE-WISE SALES REPORT'],
      [`Period: ${formatDate(fromDate)} → ${formatDate(toDate)}`],
      [],
      ['Summary'],
      ['Tables', 'Total Bills', 'Gross Amount', 'Discount', 'Service Charge', 'Net Revenue'],
      [summary.tables, summary.bills, summary.subtotal, summary.discount, summary.sc, summary.revenue],
      [],
    ]
    tables.forEach(tbl => {
      rows.push([`Table: ${tbl.name}`])
      rows.push([
        `Activated: ${tbl.activatedAt ? toIST(tbl.activatedAt) : '—'}`,
        `Paid: ${tbl.paidAt ? toIST(tbl.paidAt) : '—'}`,
        `Duration: ${formatDuration(tbl.duration)}`,
        `Bills: ${tbl.bills.length}`,
        `Net: ₹${tbl.tableRevenue}`,
      ])
      tbl.bills.forEach(bill => {
        rows.push([`  Bill #${bill.billSerial}`, PAY_LABEL[bill.payment_type] || bill.payment_type, toIST(bill.paid_at), `Net: ₹${bill.final_amount}`])
        rows.push(['  Sr', 'Item', 'Qty', 'Rate', 'Amount', 'Dept'])
        bill.items.forEach((item, i) => {
          rows.push([`  ${i + 1}`, item.name, item.qty, item.rate, item.amount, item.dept])
        })
        if (bill.service_charge_amt > 0)
          rows.push(['  ', 'Service Charge', '', '', bill.service_charge_amt, ''])
        if (bill.discount_amt > 0)
          rows.push(['  ', `Discount (${bill.discount_reason || 'No reason'})`, '', '', -bill.discount_amt, ''])
        rows.push(['  ', 'TOTAL', '', '', bill.final_amount, ''])
        rows.push([])
      })
      rows.push([`  Table Total`, '', '', '', '', `₹${tbl.tableRevenue}`])
      rows.push([])
    })
    downloadCSV(rows, `TableWise_${fromDate}_to_${toDate}.csv`)
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Print Modal ─────────────────────────────── */}
      {showPrint && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b flex justify-between items-center">
              <div>
                <h2 className="font-bold text-gray-800">🖨️ Print Preview — Table-wise</h2>
                <p className="text-xs text-gray-400">{formatDate(fromDate)} → {formatDate(toDate)}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => window.print()}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-600">
                  🖨️ Print
                </button>
                <button onClick={handleExportCSV}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-600">
                  📊 CSV
                </button>
                <button onClick={() => setShowPrint(false)}
                  className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm">✕</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 text-sm" id="print-content">
              {/* Header */}
              <div className="text-center mb-5 border-b pb-3">
                <p className="font-bold text-xl tracking-wide">HOTEL KHALASI SEAFOOD &amp; BAR</p>
                <p className="text-sm text-gray-500 uppercase tracking-widest mt-0.5">Table-wise Sales Report</p>
                <p className="text-xs text-gray-400 mt-1">{formatDate(fromDate)} → {formatDate(toDate)}</p>
                <p className="text-xs text-gray-400">Printed: {formatDate(new Date())} {toIST(new Date().toISOString())}</p>
              </div>

              {/* Summary */}
              <div className="mb-5 border rounded-xl p-4">
                <p className="font-bold text-sm mb-2 border-b pb-1">Summary</p>
                <div className="grid grid-cols-3 gap-y-1 text-xs">
                  <div className="flex justify-between col-span-3 border-b pb-1 mb-1">
                    <span className="font-medium">Tables Active</span><span className="font-bold">{summary.tables}</span>
                  </div>
                  <div className="flex justify-between"><span>Total Bills</span><span className="font-bold">{summary.bills}</span></div>
                  <div className="flex justify-between"><span>Gross</span><span className="font-bold">Rs.{summary.subtotal}</span></div>
                  <div className="flex justify-between"><span>SC</span><span>Rs.{summary.sc}</span></div>
                  <div className="flex justify-between"><span>Discount</span><span>-Rs.{summary.discount}</span></div>
                  <div className="flex justify-between col-span-2"><span className="font-bold">Net Revenue</span><span className="font-bold text-orange-600">Rs.{summary.revenue}</span></div>
                </div>
              </div>

              {/* Per Table */}
              {tables.map(tbl => (
                <div key={tbl.name} className="mb-6 border rounded-xl overflow-hidden">
                  {/* Table header */}
                  <div className="bg-gray-100 px-4 py-2 flex justify-between items-center">
                    <p className="font-bold text-sm">{tbl.name}</p>
                    <p className="text-xs text-gray-500 font-medium">Net: Rs.{tbl.tableRevenue} · {tbl.bills.length} bill(s)</p>
                  </div>
                  <div className="px-4 py-2 bg-gray-50 flex gap-4 text-xs text-gray-500 border-b">
                    <span>🟢 In: {tbl.activatedAt ? toIST(tbl.activatedAt) : '—'}</span>
                    <span>🔴 Out: {tbl.paidAt ? toIST(tbl.paidAt) : '—'}</span>
                    <span>⏱ {formatDuration(tbl.duration)}</span>
                  </div>

                  {/* Bills */}
                  {tbl.bills.map(bill => (
                    <div key={bill.billId} className="px-4 py-3 border-b last:border-0">
                      <div className="flex justify-between items-center mb-2">
                        <p className="font-semibold text-xs">Bill #{bill.billSerial} · {PAY_LABEL[bill.payment_type] || bill.payment_type}</p>
                        <p className="text-xs text-gray-400">{toIST(bill.paid_at)}</p>
                      </div>
                      <table className="w-full text-xs mb-2">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-0.5 text-gray-400 font-medium">Sr</th>
                            <th className="text-left py-0.5 text-gray-400 font-medium">Particulars</th>
                            <th className="text-right py-0.5 text-gray-400 font-medium">Qty</th>
                            <th className="text-right py-0.5 text-gray-400 font-medium">Rate</th>
                            <th className="text-right py-0.5 text-gray-400 font-medium">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bill.items.map((item, i) => (
                            <tr key={i} className="border-b border-gray-50">
                              <td className="py-0.5 text-gray-400">{i + 1}</td>
                              <td className="py-0.5">{item.name}</td>
                              <td className="py-0.5 text-right">{item.qty}</td>
                              <td className="py-0.5 text-right">{item.rate}</td>
                              <td className="py-0.5 text-right">Rs.{item.amount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="space-y-0.5 text-xs">
                        <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>Rs.{bill.subtotal}</span></div>
                        {bill.service_charge_amt > 0 && (
                          <div className="flex justify-between text-gray-400"><span>SC ({bill.service_charge_pct}%)</span><span>Rs.{bill.service_charge_amt}</span></div>
                        )}
                        {bill.discount_amt > 0 && (
                          <div className="flex justify-between text-green-600"><span>Discount</span><span>-Rs.{bill.discount_amt}</span></div>
                        )}
                        <div className="flex justify-between font-bold border-t pt-0.5"><span>Total</span><span>Rs.{bill.final_amount}</span></div>
                      </div>
                    </div>
                  ))}

                  {/* Table footer */}
                  <div className="bg-orange-50 px-4 py-2 flex justify-between text-xs font-bold text-orange-700">
                    <span>Table Total ({tbl.bills.length} bills)</span>
                    <span>Rs.{tbl.tableRevenue}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Navbar ──────────────────────────────────── */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-xl">🪑</span>
          <h1 className="text-lg font-bold text-orange-500">Table-wise Report</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/admin/reports')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
            ← Reports
          </button>
          <button onClick={() => navigate('/admin/dashboard')}
            className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-200">
            Dashboard
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-5xl mx-auto">

        {/* ── Filter Bar ──────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow p-5 mb-5 print:hidden">
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <button onClick={fetchReport}
              className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
              View Report
            </button>
          </div>
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-2 animate-pulse">🪑</div>
            <p>Loading table-wise data…</p>
          </div>
        )}

        {!loading && fetched && tables.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-2">📭</div>
            <p>No paid orders found for this period.</p>
          </div>
        )}

        {!loading && tables.length > 0 && (
          <>
            {/* ── Action Bar ──────────────────────────── */}
            <div className="flex gap-2 justify-end mb-4 print:hidden">
              <button
                onClick={() => setExpanded(Object.fromEntries(tables.map(t => [t.name, true])))}
                className="border border-gray-200 bg-white text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50">
                Expand All
              </button>
              <button
                onClick={() => setExpanded(Object.fromEntries(tables.map(t => [t.name, false])))}
                className="border border-gray-200 bg-white text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50">
                Collapse All
              </button>
              <button onClick={() => setShowPrint(true)}
                className="bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-600">
                🖨️ Print Preview
              </button>
              <button onClick={handleExportCSV}
                className="bg-green-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-green-600">
                📊 Export CSV
              </button>
            </div>

            {/* ── Summary Strip ───────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">Net Revenue</p>
                <p className="text-2xl font-bold text-orange-600">₹{summary.revenue}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">Tables Active</p>
                <p className="text-2xl font-bold text-blue-600">{summary.tables}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">Total Bills</p>
                <p className="text-2xl font-bold text-gray-700">{summary.bills}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-2">Deductions</p>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-gray-500">Service Charge</span><span className="font-bold">₹{summary.sc}</span></div>
                  <div className="flex justify-between"><span className="text-green-600">Discounts</span><span className="font-bold text-green-600">-₹{summary.discount}</span></div>
                </div>
              </div>
            </div>

            {/* ── Table Cards ─────────────────────────── */}
            <div className="space-y-4">
              {tables.map(tbl => {
                const isOpen = !!expanded[tbl.name]
                return (
                  <div key={tbl.name} className="bg-white rounded-2xl shadow overflow-hidden">

                    {/* Table Header — always visible */}
                    <button
                      onClick={() => toggleTable(tbl.name)}
                      className="w-full text-left px-5 py-4 flex justify-between items-start hover:bg-gray-50 transition">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm flex-shrink-0">
                          🪑
                        </div>
                        <div>
                          <p className="font-bold text-gray-800 text-base">{tbl.name}</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              🟢 {tbl.activatedAt ? toIST(tbl.activatedAt) : '—'}
                            </span>
                            <span className="text-xs text-gray-400">→</span>
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              🔴 {tbl.paidAt ? toIST(tbl.paidAt) : '—'}
                            </span>
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                              ⏱ {formatDuration(tbl.duration)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <p className="font-bold text-orange-500 text-xl">₹{tbl.tableRevenue}</p>
                        <p className="text-xs text-gray-400">{tbl.bills.length} bill{tbl.bills.length !== 1 ? 's' : ''}</p>
                        <p className="text-xs text-gray-300 mt-1">{isOpen ? '▲ collapse' : '▼ expand'}</p>
                      </div>
                    </button>

                    {/* Bills Detail — collapsible */}
                    {isOpen && (
                      <div className="border-t border-gray-100 divide-y divide-gray-50">
                        {tbl.bills.map(bill => (
                          <div key={bill.billId} className="px-5 py-4">
                            {/* Bill header */}
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2">
                                <span className="bg-gray-800 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                                  Bill #{bill.billSerial}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAY_COLOR[bill.payment_type] || 'bg-gray-100 text-gray-500'}`}>
                                  {PAY_LABEL[bill.payment_type] || bill.payment_type}
                                </span>
                              </div>
                              <span className="text-xs text-gray-400">{toIST(bill.paid_at)}</span>
                            </div>

                            {/* Items table */}
                            <div className="rounded-xl border border-gray-100 overflow-hidden mb-3">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="text-left px-3 py-2 text-xs text-gray-400 font-medium w-8">Sr</th>
                                    <th className="text-left px-3 py-2 text-xs text-gray-400 font-medium">Particulars</th>
                                    <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium w-12">Qty</th>
                                    <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium w-16">Rate</th>
                                    <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium w-20">Amount</th>
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
                                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${dc.badge}`}>
                                              {dc.icon}
                                            </span>
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

                            {/* Bill totals */}
                            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                              <div className="flex justify-between text-gray-500">
                                <span>Subtotal</span>
                                <span>₹{bill.subtotal}</span>
                              </div>
                              {bill.service_charge_amt > 0 && (
                                <div className="flex justify-between text-gray-400 text-xs">
                                  <span>Service Charge ({bill.service_charge_pct}%)</span>
                                  <span>₹{bill.service_charge_amt}</span>
                                </div>
                              )}
                              {bill.discount_amt > 0 && (
                                <div className="flex justify-between text-green-600 text-xs">
                                  <span>
                                    Discount
                                    {bill.discount_type === 'percent'
                                      ? ` (${bill.discount_value}%)`
                                      : ` (₹${bill.discount_value} flat)`}
                                    {bill.discount_reason ? ` — ${bill.discount_reason}` : ''}
                                  </span>
                                  <span>-₹{bill.discount_amt}</span>
                                </div>
                              )}
                              <div className="flex justify-between font-bold text-gray-800 border-t pt-1.5">
                                <span>Bill Total</span>
                                <span className="text-orange-500">₹{bill.final_amount}</span>
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* Table total footer */}
                        <div className="bg-orange-50 px-5 py-3 flex justify-between items-center">
                          <div className="text-sm text-orange-700">
                            <span className="font-bold">{tbl.name} Total</span>
                            <span className="text-xs ml-2 opacity-70">· {tbl.bills.length} bill{tbl.bills.length !== 1 ? 's' : ''} · {tbl.totalItems} items</span>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-orange-600 text-lg">₹{tbl.tableRevenue}</p>
                            {tbl.tableDiscount > 0 && (
                              <p className="text-xs text-green-600">Disc: -₹{tbl.tableDiscount}</p>
                            )}
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

        {!fetched && !loading && (
          <div className="text-center py-16 text-gray-300">
            <div className="text-6xl mb-3">🪑</div>
            <p className="text-gray-400">Select a date range and click <strong>View Report</strong></p>
          </div>
        )}
      </div>
    </div>
  )
}