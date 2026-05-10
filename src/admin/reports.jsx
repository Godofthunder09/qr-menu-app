import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})

const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

export default function Reports() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('daily')

  // Daily
  const [dailyDate, setDailyDate] = useState(todayIST())
  const [dailyOrders, setDailyOrders] = useState([])
  const [dailySummary, setDailySummary] = useState(null)
  const [dailyLoading, setDailyLoading] = useState(false)

  // Range
  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate, setToDate] = useState(todayIST())
  const [rangeOrders, setRangeOrders] = useState([])
  const [rangeLoading, setRangeLoading] = useState(false)

  // Items report
  const [itemsData, setItemsData] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsFrom, setItemsFrom] = useState(todayIST())
  const [itemsTo, setItemsTo] = useState(todayIST())

  useEffect(() => {
    fetchDailyReport()
  }, [dailyDate])

  const fetchDailyReport = async () => {
    setDailyLoading(true)

    const start = `${dailyDate}T00:00:00+05:30`
    const end = `${dailyDate}T23:59:59+05:30`

    const { data: ords } = await supabase
      .from('orders')
      .select(`*, order_items(quantity, price_at_order, note, food_items(name))`)
      .eq('is_paid', true)
      .gte('paid_at', start)
      .lte('paid_at', end)
      .order('paid_at', { ascending: false })

    setDailyOrders(ords || [])

    // Summary
    const total = (ords || []).reduce((s, o) => s + (o.final_amount || 0), 0)
    const cash = (ords || []).filter(o => o.payment_type === 'cash').reduce((s, o) => s + (o.final_amount || 0), 0)
    const upi = (ords || []).filter(o => o.payment_type === 'upi').reduce((s, o) => s + (o.final_amount || 0), 0)
    const card = (ords || []).filter(o => o.payment_type === 'card').reduce((s, o) => s + (o.final_amount || 0), 0)
    const svc = (ords || []).reduce((s, o) => s + (o.service_charge_amt || 0), 0)

    setDailySummary({ total, cash, upi, card, svc, count: (ords || []).length })
    setDailyLoading(false)
  }

  const fetchRangeReport = async () => {
    setRangeLoading(true)
    const start = `${fromDate}T00:00:00+05:30`
    const end = `${toDate}T23:59:59+05:30`

    const { data: ords } = await supabase
      .from('orders')
      .select(`*, order_items(quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true)
      .gte('paid_at', start)
      .lte('paid_at', end)
      .order('paid_at', { ascending: false })

    setRangeOrders(ords || [])
    setRangeLoading(false)
  }

  const fetchItemsReport = async () => {
    setItemsLoading(true)
    const start = `${itemsFrom}T00:00:00+05:30`
    const end = `${itemsTo}T23:59:59+05:30`

    const { data: ords } = await supabase
      .from('orders')
      .select(`order_items(quantity, price_at_order, food_items(name, id))`)
      .eq('is_paid', true)
      .gte('paid_at', start)
      .lte('paid_at', end)

    // Aggregate items
    const itemMap = {}
    ;(ords || []).forEach(o => {
      ;(o.order_items || []).forEach(item => {
        const name = item.food_items?.name || 'Unknown'
        if (!itemMap[name]) itemMap[name] = { name, qty: 0, revenue: 0 }
        itemMap[name].qty += item.quantity
        itemMap[name].revenue += item.price_at_order * item.quantity
      })
    })

    const sorted = Object.values(itemMap).sort((a, b) => b.qty - a.qty)
    setItemsData(sorted)
    setItemsLoading(false)
  }

  // Group range orders by date
  const groupedByDate = rangeOrders.reduce((acc, o) => {
    const date = new Date(o.paid_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    if (!acc[date]) acc[date] = []
    acc[date].push(o)
    return acc
  }, {})

  const rangeSummary = {
    total: rangeOrders.reduce((s, o) => s + (o.final_amount || 0), 0),
    cash: rangeOrders.filter(o => o.payment_type === 'cash').reduce((s, o) => s + (o.final_amount || 0), 0),
    upi: rangeOrders.filter(o => o.payment_type === 'upi').reduce((s, o) => s + (o.final_amount || 0), 0),
    card: rangeOrders.filter(o => o.payment_type === 'card').reduce((s, o) => s + (o.final_amount || 0), 0),
    svc: rangeOrders.reduce((s, o) => s + (o.service_charge_amt || 0), 0),
    count: rangeOrders.length
  }

  const printReport = () => window.print()

  const exportCSV = (data, filename) => {
    const headers = ['Table', 'Payment', 'Subtotal', 'Service Charge', 'Final Amount', 'Date', 'Time']
    const rows = data.map(o => [
      o.table_name_snapshot || '-',
      o.payment_type?.toUpperCase(),
      o.subtotal || 0,
      o.service_charge_amt || 0,
      o.final_amount || 0,
      new Date(o.paid_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      toIST(o.paid_at)
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  const paymentIcon = (type) => {
    if (type === 'cash') return '💵'
    if (type === 'upi') return '📱'
    if (type === 'card') return '💳'
    return '💰'
  }

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">

      {/* Navbar — hidden on print */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <h1 className="text-lg font-bold text-orange-500">Reports</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={printReport}
            className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">
            🖨️ Print
          </button>
          <button onClick={() => navigate('/admin/dashboard')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
            ← Dashboard
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-4xl mx-auto">

        {/* Print Header */}
        <div className="hidden print:block text-center mb-6">
          <h1 className="text-2xl font-bold">🍽️ QR Menu — Sales Report</h1>
          <p className="text-gray-500 text-sm">Generated on {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
        </div>

        {/* Tabs — hidden on print */}
        <div className="flex gap-2 mb-6 flex-wrap print:hidden">
          {[
            { key: 'daily', label: '📅 Daily Report' },
            { key: 'range', label: '📆 Date Range' },
            { key: 'items', label: '🍴 Item Sales' }
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2 rounded-full font-medium text-sm transition
                ${activeTab === tab.key ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Daily Report ── */}
        {activeTab === 'daily' && (
          <div>
            <div className="flex gap-3 mb-5 items-center flex-wrap print:hidden">
              <input type="date" value={dailyDate}
                onChange={e => setDailyDate(e.target.value)}
                max={todayIST()}
                className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <button onClick={fetchDailyReport}
                className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                Load Report
              </button>
              {dailyOrders.length > 0 && (
                <button onClick={() => exportCSV(dailyOrders, `daily-report-${dailyDate}.csv`)}
                  className="bg-green-100 text-green-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-200">
                  📥 Export CSV
                </button>
              )}
            </div>

            {dailyLoading && <p className="text-gray-400 text-center py-8">Loading...</p>}

            {!dailyLoading && dailySummary && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <div className="bg-orange-500 text-white rounded-2xl p-4">
                    <p className="text-xs text-orange-100">Total Revenue</p>
                    <p className="text-2xl font-bold">₹{dailySummary.total}</p>
                    <p className="text-xs text-orange-100 mt-1">{dailySummary.count} orders</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="text-xs text-gray-400">💵 Cash</p>
                    <p className="text-xl font-bold text-gray-700">₹{dailySummary.cash}</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="text-xs text-gray-400">📱 UPI</p>
                    <p className="text-xl font-bold text-gray-700">₹{dailySummary.upi}</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="text-xs text-gray-400">💳 Card</p>
                    <p className="text-xl font-bold text-gray-700">₹{dailySummary.card}</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow p-4 mb-5">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Service Charges Collected</span>
                    <span className="font-semibold">₹{dailySummary.svc}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600 mt-2">
                    <span>Food Revenue (excl. service)</span>
                    <span className="font-semibold">₹{dailySummary.total - dailySummary.svc}</span>
                  </div>
                </div>

                {/* Orders List */}
                {dailyOrders.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <div className="text-4xl mb-2">📭</div>
                    <p>No orders found for this date</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h3 className="font-bold text-gray-700">Order Details ({dailyOrders.length})</h3>
                    {dailyOrders.map((order, i) => (
                      <div key={order.id} className="bg-white rounded-2xl shadow p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="font-semibold text-gray-700">
                              {order.table_name_snapshot || 'Table'}
                            </span>
                            <span className="ml-2 text-xs text-gray-400">#{i + 1}</span>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-orange-500">₹{order.final_amount}</p>
                            <p className="text-xs text-gray-400">{toIST(order.paid_at)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">
                            {paymentIcon(order.payment_type)} {order.payment_type?.toUpperCase()}
                          </span>
                          {order.service_charge_pct > 0 && (
                            <span className="text-xs bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full">
                              +{order.service_charge_pct}% service
                            </span>
                          )}
                        </div>
                        <div className="space-y-1">
                          {(order.order_items || []).map((item, j) => (
                            <div key={j} className="flex justify-between text-xs text-gray-500">
                              <span>{item.food_items?.name} × {item.quantity}</span>
                              <span>₹{item.price_at_order * item.quantity}</span>
                            </div>
                          ))}
                        </div>
                        {order.service_charge_amt > 0 && (
                          <div className="flex justify-between text-xs text-blue-400 mt-1 pt-1 border-t">
                            <span>Service Charge</span>
                            <span>₹{order.service_charge_amt}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Date Range Report ── */}
        {activeTab === 'range' && (
          <div>
            <div className="bg-white rounded-2xl shadow p-4 mb-5">
              <div className="flex gap-3 flex-wrap items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From Date</label>
                  <input type="date" value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    max={todayIST()}
                    className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">To Date</label>
                  <input type="date" value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    max={todayIST()}
                    className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <button onClick={fetchRangeReport}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                  Load Report
                </button>
                {rangeOrders.length > 0 && (
                  <button onClick={() => exportCSV(rangeOrders, `range-report-${fromDate}-to-${toDate}.csv`)}
                    className="bg-green-100 text-green-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-200">
                    📥 Export CSV
                  </button>
                )}
              </div>
            </div>

            {rangeLoading && <p className="text-gray-400 text-center py-8">Loading...</p>}

            {!rangeLoading && rangeOrders.length > 0 && (
              <>
                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <div className="bg-orange-500 text-white rounded-2xl p-4">
                    <p className="text-xs text-orange-100">Total Revenue</p>
                    <p className="text-2xl font-bold">₹{rangeSummary.total}</p>
                    <p className="text-xs text-orange-100 mt-1">{rangeSummary.count} orders</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="text-xs text-gray-400">💵 Cash</p>
                    <p className="text-xl font-bold text-gray-700">₹{rangeSummary.cash}</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="text-xs text-gray-400">📱 UPI</p>
                    <p className="text-xl font-bold text-gray-700">₹{rangeSummary.upi}</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow p-4">
                    <p className="text-xs text-gray-400">💳 Card</p>
                    <p className="text-xl font-bold text-gray-700">₹{rangeSummary.card}</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow p-4 mb-5">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Total Service Charges</span>
                    <span className="font-semibold">₹{rangeSummary.svc}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600 mt-2">
                    <span>Food Revenue (excl. service)</span>
                    <span className="font-semibold">₹{rangeSummary.total - rangeSummary.svc}</span>
                  </div>
                </div>

                {/* Day by day breakdown */}
                <h3 className="font-bold text-gray-700 mb-3">Day-by-Day Breakdown</h3>
                {Object.entries(groupedByDate)
                  .sort(([a], [b]) => new Date(b) - new Date(a))
                  .map(([date, dayOrders]) => {
                    const dayTotal = dayOrders.reduce((s, o) => s + (o.final_amount || 0), 0)
                    return (
                      <div key={date} className="bg-white rounded-2xl shadow p-4 mb-3">
                        <div className="flex justify-between items-center mb-3">
                          <span className="font-bold text-gray-700">
                            {new Date(date).toLocaleDateString('en-IN', {
                              timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', weekday: 'short'
                            })}
                          </span>
                          <div className="text-right">
                            <p className="font-bold text-orange-500">₹{dayTotal}</p>
                            <p className="text-xs text-gray-400">{dayOrders.length} orders</p>
                          </div>
                        </div>
                        <div className="flex gap-3 text-xs text-gray-500">
                          <span>💵 ₹{dayOrders.filter(o => o.payment_type === 'cash').reduce((s, o) => s + (o.final_amount || 0), 0)}</span>
                          <span>📱 ₹{dayOrders.filter(o => o.payment_type === 'upi').reduce((s, o) => s + (o.final_amount || 0), 0)}</span>
                          <span>💳 ₹{dayOrders.filter(o => o.payment_type === 'card').reduce((s, o) => s + (o.final_amount || 0), 0)}</span>
                        </div>
                      </div>
                    )
                  })}
              </>
            )}

            {!rangeLoading && rangeOrders.length === 0 && fromDate && toDate && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">📭</div>
                <p>No orders in this date range</p>
              </div>
            )}
          </div>
        )}

        {/* ── Item Sales Report ── */}
        {activeTab === 'items' && (
          <div>
            <div className="bg-white rounded-2xl shadow p-4 mb-5">
              <div className="flex gap-3 flex-wrap items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From Date</label>
                  <input type="date" value={itemsFrom}
                    onChange={e => setItemsFrom(e.target.value)}
                    max={todayIST()}
                    className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">To Date</label>
                  <input type="date" value={itemsTo}
                    onChange={e => setItemsTo(e.target.value)}
                    max={todayIST()}
                    className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <button onClick={fetchItemsReport}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                  Load Report
                </button>
              </div>
            </div>

            {itemsLoading && <p className="text-gray-400 text-center py-8">Loading...</p>}

            {!itemsLoading && itemsData.length > 0 && (
              <div className="bg-white rounded-2xl shadow overflow-hidden">
                <div className="p-4 border-b">
                  <h3 className="font-bold text-gray-700">
                    Best Selling Items — {itemsData.length} items
                  </h3>
                </div>
                <div className="divide-y">
                  {itemsData.map((item, i) => {
                    const maxQty = itemsData[0].qty
                    const pct = Math.round((item.qty / maxQty) * 100)
                    return (
                      <div key={i} className="p-4">
                        <div className="flex justify-between items-center mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center
                              ${i === 0 ? 'bg-yellow-400 text-yellow-900'
                                : i === 1 ? 'bg-gray-300 text-gray-700'
                                : i === 2 ? 'bg-orange-200 text-orange-700'
                                : 'bg-gray-100 text-gray-500'}`}>
                              {i + 1}
                            </span>
                            <span className="font-medium text-gray-700">{item.name}</span>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-gray-700">{item.qty} sold</p>
                            <p className="text-xs text-orange-500">₹{item.revenue}</p>
                          </div>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                          <div className="bg-orange-500 h-1.5 rounded-full"
                            style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!itemsLoading && itemsData.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">🍴</div>
                <p>Select date range and load report</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}