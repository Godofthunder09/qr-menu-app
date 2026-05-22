import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase/client'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})
const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

const LIQUOR_KEYWORDS = ['beer','wine','whisky','whiskey','vodka','rum','gin','tequila','brandy','champagne','scotch','bourbon','ale','lager','cider','feni','arrack','toddy','sangria','kingfisher','bacardi','liit','long island','shot','peg']
const isLiquor = (name = '') => LIQUOR_KEYWORDS.some(k => name.toLowerCase().includes(k))

const downloadCSV = (rows, filename) => {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

export default function ReportToday() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [bills, setBills] = useState([])
  const [stats, setStats] = useState(null)
  const [showOrders, setShowOrders] = useState(false)
  const [showPrintPreview, setShowPrintPreview] = useState(false)

  useEffect(() => { fetchToday() }, [])

  const fetchToday = async () => {
    setLoading(true)
    const today = todayIST()
    const startISO = new Date(today + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(today + 'T23:59:59+05:30').toISOString()
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`id, payment_type, paid_at, final_amount, subtotal,
        service_charge_amt, discount_amt, table_name_snapshot,
        order_items(quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error(error.message)

    const map = {}
    orders?.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) map[key] = { ...o, order_items: [...(o.order_items || [])] }
      else map[key].order_items = [...map[key].order_items, ...(o.order_items || [])]
    })
    const grouped = Object.values(map)
    setBills(grouped)
    computeStats(grouped)
    setLoading(false)
  }

  const computeStats = (bills) => {
    if (!bills.length) { setStats(null); return }
    const totalRevenue = bills.reduce((s, b) => s + (b.final_amount || 0), 0)
    const totalOrders = bills.length
    const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0
    const cash = bills.filter(b => b.payment_type === 'cash').reduce((s, b) => s + (b.final_amount || 0), 0)
    const upi = bills.filter(b => b.payment_type === 'upi').reduce((s, b) => s + (b.final_amount || 0), 0)
    const card = bills.filter(b => b.payment_type === 'card').reduce((s, b) => s + (b.final_amount || 0), 0)
    const scTotal = bills.reduce((s, b) => s + (b.service_charge_amt || 0), 0)
    const discTotal = bills.reduce((s, b) => s + (b.discount_amt || 0), 0)
    const discPct = totalRevenue > 0 ? ((discTotal / totalRevenue) * 100).toFixed(1) : 0

    // Hourly
    const hourMap = {}
    bills.forEach(b => {
      const hr = new Date(b.paid_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })
      hourMap[hr] = (hourMap[hr] || 0) + 1
    })
    const hours = Object.entries(hourMap).sort((a, b) => b[1] - a[1])
    const busiestHour = hours[0] ? `${hours[0][0]}:00 (${hours[0][1]} orders)` : '—'
    const quietestHour = hours.length > 1 ? `${hours[hours.length - 1][0]}:00 (${hours[hours.length - 1][1]} orders)` : '—'

    // Top item
    const itemMap = {}
    bills.forEach(b => b.order_items?.forEach(i => {
      const name = i.food_items?.name || 'Unknown'
      itemMap[name] = (itemMap[name] || 0) + i.quantity
    }))
    const topItem = Object.entries(itemMap).sort((a, b) => b[1] - a[1])[0]

    // Food vs Liquor
    let foodRev = 0, liquorRev = 0
    bills.forEach(b => b.order_items?.forEach(i => {
      const rev = i.price_at_order * i.quantity
      if (isLiquor(i.food_items?.name)) liquorRev += rev
      else foodRev += rev
    }))

    setStats({
      totalRevenue, totalOrders, aov, cash, upi, card,
      scTotal, discTotal, discPct,
      busiestHour, quietestHour,
      topItem: topItem ? `${topItem[0]} (${topItem[1]} sold)` : '—',
      discWarning: parseFloat(discPct) > 10,
      foodRev, liquorRev
    })
  }

  const exportCSV = () => {
    if (!bills.length) return
    const rows = [
      ['TODAY REPORT', formatDate(new Date())],
      [],
      ['Total Revenue', stats.totalRevenue],
      ['Total Orders', stats.totalOrders],
      ['Avg Order Value', stats.aov],
      ['Cash', stats.cash], ['UPI', stats.upi], ['Card', stats.card],
      ['Service Charge', stats.scTotal], ['Discounts', stats.discTotal],
      ['Food Revenue', stats.foodRev], ['Liquor Revenue', stats.liquorRev],
      [],
      ['Table', 'Time', 'Payment', 'Subtotal', 'SC', 'Discount', 'Final', 'Items']
    ]
    bills.forEach(b => rows.push([
      b.table_name_snapshot, toIST(b.paid_at), b.payment_type,
      b.subtotal, b.service_charge_amt, b.discount_amt, b.final_amount,
      b.order_items?.map(i => `${i.food_items?.name} x${i.quantity}`).join(' | ')
    ]))
    downloadCSV(rows, `Today_${todayIST()}.csv`)
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Print Preview */}
      {showPrintPreview && stats && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="font-bold text-gray-800">Print Preview — Today</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">🖨️ Print</button>
                <button onClick={exportCSV} className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">📊 CSV</button>
                <button onClick={() => setShowPrintPreview(false)} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono text-sm">
              <div className="text-center mb-4 border-b pb-3">
                <p className="font-bold text-lg">HOTEL KHALASI SEAFOOD & BAR</p>
                <p>TODAY'S SALES SUMMARY</p>
                <p className="text-gray-500 text-xs">{formatDate(new Date())}</p>
              </div>
              <div className="space-y-1 mb-4">
                <div className="flex justify-between font-bold text-lg border-b pb-2">
                  <span>TOTAL REVENUE</span><span>Rs.{stats.totalRevenue}</span>
                </div>
                <div className="flex justify-between"><span>Total Orders</span><span>{stats.totalOrders}</span></div>
                <div className="flex justify-between"><span>Avg Order Value</span><span>Rs.{stats.aov}</span></div>
              </div>
              <div className="mb-4 border-t pt-3">
                <p className="font-bold mb-1">Payment Split</p>
                <div className="flex justify-between"><span>💵 Cash</span><span>Rs.{stats.cash}</span></div>
                <div className="flex justify-between"><span>📱 UPI</span><span>Rs.{stats.upi}</span></div>
                <div className="flex justify-between"><span>💳 Card</span><span>Rs.{stats.card}</span></div>
              </div>
              <div className="mb-4 border-t pt-3">
                <p className="font-bold mb-1">Food vs Liquor</p>
                <div className="flex justify-between"><span>🍽 Food</span><span>Rs.{stats.foodRev}</span></div>
                <div className="flex justify-between"><span>🍺 Liquor</span><span>Rs.{stats.liquorRev}</span></div>
              </div>
              <div className="mb-4 border-t pt-3">
                <p className="font-bold mb-1">Charges</p>
                <div className="flex justify-between"><span>Service Charge</span><span>Rs.{stats.scTotal}</span></div>
                <div className="flex justify-between"><span>Discounts Given</span><span>-Rs.{stats.discTotal} ({stats.discPct}%)</span></div>
              </div>
              <div className="border-t pt-3">
                <p className="font-bold mb-2">Bills ({bills.length})</p>
                {bills.map((b, i) => (
                  <div key={i} className="border-b pb-1 mb-1 text-xs">
                    <div className="flex justify-between"><span>{b.table_name_snapshot} · {toIST(b.paid_at)}</span><span>Rs.{b.final_amount} ({b.payment_type})</span></div>
                    {b.order_items?.map((item, j) => (
                      <div key={j} className="flex justify-between text-gray-500 ml-2">
                        <span>{item.food_items?.name} × {item.quantity}</span>
                        <span>Rs.{item.price_at_order * item.quantity}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-xl">📅</span>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Today</h1>
            <p className="text-xs text-gray-400">{formatDate(new Date())}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={fetchToday} className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium">🔄 Refresh</button>
          {stats && <>
            <button onClick={() => setShowPrintPreview(true)} className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium">🖨️ Print</button>
            <button onClick={exportCSV} className="bg-green-100 text-green-600 px-3 py-1.5 rounded-lg text-xs font-medium">📊 CSV</button>
          </>}
          <button onClick={() => navigate('/admin/reports')} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium">← Reports</button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        {loading && <div className="text-center py-16 text-gray-400">Loading...</div>}
        {!loading && !stats && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-lg font-medium">No orders today yet.</p>
          </div>
        )}

        {!loading && stats && (
          <>
            {stats.discWarning && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-bold text-red-600">High Discount Alert</p>
                  <p className="text-sm text-red-500">Discounts are {stats.discPct}% of today's revenue — above 10% threshold</p>
                </div>
              </div>
            )}

            {/* Hero 3 numbers */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-orange-500 rounded-2xl p-4 text-white text-center shadow">
                <p className="text-xs opacity-80 mb-1">Revenue</p>
                <p className="text-2xl font-bold">₹{stats.totalRevenue}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-4 text-center shadow">
                <p className="text-xs text-gray-500 mb-1">Orders</p>
                <p className="text-2xl font-bold text-gray-800">{stats.totalOrders}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center shadow">
                <p className="text-xs text-gray-500 mb-1">Avg/Order</p>
                <p className="text-2xl font-bold text-blue-600">₹{stats.aov}</p>
              </div>
            </div>

            {/* Payment split */}
            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <h3 className="font-bold text-gray-700 mb-3">💳 Payment Split</h3>
              <div className="grid grid-cols-3 gap-3">
                {[['💵 Cash', stats.cash, 'text-green-600 bg-green-50'],
                  ['📱 UPI', stats.upi, 'text-blue-600 bg-blue-50'],
                  ['💳 Card', stats.card, 'text-purple-600 bg-purple-50']].map(([label, val, cls]) => (
                  <div key={label} className={`${cls.split(' ')[1]} rounded-xl p-3 text-center`}>
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className={`text-xl font-bold ${cls.split(' ')[0]}`}>₹{val}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Food vs Liquor */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">🍽 Food Revenue</p>
                <p className="text-2xl font-bold text-orange-600">₹{stats.foodRev}</p>
                <p className="text-xs text-gray-400">
                  {(stats.foodRev + stats.liquorRev) > 0 ? ((stats.foodRev / (stats.foodRev + stats.liquorRev)) * 100).toFixed(0) : 0}% of items revenue
                </p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">🍺 Liquor Revenue</p>
                <p className="text-2xl font-bold text-purple-600">₹{stats.liquorRev}</p>
                <p className="text-xs text-gray-400">
                  {(stats.foodRev + stats.liquorRev) > 0 ? ((stats.liquorRev / (stats.foodRev + stats.liquorRev)) * 100).toFixed(0) : 0}% of items revenue
                </p>
              </div>
            </div>

            {/* Insights grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">Service Charge</p>
                <p className="text-xl font-bold text-gray-700">₹{stats.scTotal}</p>
              </div>
              <div className={`border rounded-2xl p-4 ${stats.discWarning ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                <p className="text-xs text-gray-500 mb-1">Discounts {stats.discWarning ? '⚠️' : ''}</p>
                <p className={`text-xl font-bold ${stats.discWarning ? 'text-red-600' : 'text-gray-700'}`}>-₹{stats.discTotal}</p>
                <p className="text-xs text-gray-400">{stats.discPct}% of revenue</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">🏆 Top Item</p>
                <p className="text-sm font-bold text-orange-600 leading-tight">{stats.topItem}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">⏰ Busiest Hour</p>
                <p className="text-sm font-bold text-gray-700">{stats.busiestHour}</p>
                <p className="text-xs text-gray-400 mt-1">Quiet: {stats.quietestHour}</p>
              </div>
            </div>

            {/* Collapsible order list */}
            <div className="bg-white rounded-2xl shadow">
              <button onClick={() => setShowOrders(!showOrders)}
                className="w-full p-5 flex justify-between items-center">
                <h3 className="font-bold text-gray-700">All Bills ({bills.length})</h3>
                <span className="text-gray-400">{showOrders ? '▲' : '▼'}</span>
              </button>
              {showOrders && (
                <div className="px-5 pb-5 space-y-3 border-t pt-4">
                  {bills.map((bill, i) => (
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}