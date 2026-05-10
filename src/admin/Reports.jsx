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
  const [activeTab, setActiveTab] = useState('today')
  const [loading, setLoading] = useState(false)

  // Today data
  const [todayOrders, setTodayOrders] = useState([])
  const [todayReport, setTodayReport] = useState(null)

  // Date range
  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate, setToDate] = useState(todayIST())
  const [rangeOrders, setRangeOrders] = useState([])
  const [rangeReport, setRangeReport] = useState(null)

  // Item report
  const [itemStats, setItemStats] = useState([])
  const [itemFromDate, setItemFromDate] = useState(todayIST())
  const [itemToDate, setItemToDate] = useState(todayIST())

  // Settlement
  const [settlFromDate, setSettlFromDate] = useState(todayIST())
  const [settlToDate, setSettlToDate] = useState(todayIST())
  const [settlData, setSettlData] = useState(null)

  useEffect(() => { fetchToday() }, [])

  // ── Today ────────────────────────────────────────────────
  const fetchToday = async () => {
    setLoading(true)
    const today = todayIST()

    const startISO = new Date(today + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(today + 'T23:59:59+05:30').toISOString()

    const { data: orders } = await supabase
      .from('orders')
      .select(`*, order_items(quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    setTodayOrders(orders || [])

    if (orders && orders.length > 0) {
      const totalRevenue = orders.reduce((s, o) => s + (o.final_amount || 0), 0)
      const cashRev = orders.filter(o => o.payment_type === 'cash').reduce((s, o) => s + (o.final_amount || 0), 0)
      const upiRev = orders.filter(o => o.payment_type === 'upi').reduce((s, o) => s + (o.final_amount || 0), 0)
      const cardRev = orders.filter(o => o.payment_type === 'card').reduce((s, o) => s + (o.final_amount || 0), 0)
      const scTotal = orders.reduce((s, o) => s + (o.service_charge_amt || 0), 0)
      setTodayReport({ totalRevenue, cashRev, upiRev, cardRev, scTotal, totalOrders: orders.length })
    } else {
      setTodayReport(null)
    }
    setLoading(false)
  }

  // ── Date Range ───────────────────────────────────────────
  const fetchRange = async () => {
    setLoading(true)
    const startISO = new Date(fromDate + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(toDate + 'T23:59:59+05:30').toISOString()

    const { data: orders } = await supabase
      .from('orders')
      .select(`*, order_items(quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    setRangeOrders(orders || [])

    if (orders && orders.length > 0) {
      const totalRevenue = orders.reduce((s, o) => s + (o.final_amount || 0), 0)
      const cashRev = orders.filter(o => o.payment_type === 'cash').reduce((s, o) => s + (o.final_amount || 0), 0)
      const upiRev = orders.filter(o => o.payment_type === 'upi').reduce((s, o) => s + (o.final_amount || 0), 0)
      const cardRev = orders.filter(o => o.payment_type === 'card').reduce((s, o) => s + (o.final_amount || 0), 0)
      const scTotal = orders.reduce((s, o) => s + (o.service_charge_amt || 0), 0)
      setRangeReport({ totalRevenue, cashRev, upiRev, cardRev, scTotal, totalOrders: orders.length })
    } else {
      setRangeReport(null)
    }
    setLoading(false)
  }

  // ── Item Stats ───────────────────────────────────────────
  const fetchItemStats = async () => {
    setLoading(true)
    const startISO = new Date(itemFromDate + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(itemToDate + 'T23:59:59+05:30').toISOString()

    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)

    if (!orders || orders.length === 0) { setItemStats([]); setLoading(false); return }

    const orderIds = orders.map(o => o.id)
    const { data: items } = await supabase
      .from('order_items')
      .select('quantity, price_at_order, food_items(name)')
      .in('order_id', orderIds)

    const map = {}
    items?.forEach(i => {
      const name = i.food_items?.name || 'Unknown'
      if (!map[name]) map[name] = { name, qty: 0, revenue: 0 }
      map[name].qty += i.quantity
      map[name].revenue += i.price_at_order * i.quantity
    })

    const sorted = Object.values(map).sort((a, b) => b.qty - a.qty)
    setItemStats(sorted)
    setLoading(false)
  }

  // ── Settlement ───────────────────────────────────────────
  const fetchSettlement = async () => {
    setLoading(true)
    const startISO = new Date(settlFromDate + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(settlToDate + 'T23:59:59+05:30').toISOString()

    const { data: orders } = await supabase
      .from('orders')
      .select('payment_type, final_amount, subtotal, service_charge_amt, paid_at, table_name_snapshot')
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    if (!orders) { setSettlData(null); setLoading(false); return }

    const cash = orders.filter(o => o.payment_type === 'cash')
    const upi = orders.filter(o => o.payment_type === 'upi')
    const card = orders.filter(o => o.payment_type === 'card')

    setSettlData({
      orders,
      cash: { count: cash.length, total: cash.reduce((s, o) => s + (o.final_amount || 0), 0) },
      upi: { count: upi.length, total: upi.reduce((s, o) => s + (o.final_amount || 0), 0) },
      card: { count: card.length, total: card.reduce((s, o) => s + (o.final_amount || 0), 0) },
      grandTotal: orders.reduce((s, o) => s + (o.final_amount || 0), 0),
      serviceTotal: orders.reduce((s, o) => s + (o.service_charge_amt || 0), 0)
    })
    setLoading(false)
  }

  // ── Print ────────────────────────────────────────────────
  const printReport = () => window.print()

  const SummaryCard = ({ label, value, color = 'orange', sub }) => (
    <div className={`bg-${color}-50 border border-${color}-200 rounded-2xl p-4`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold text-${color}-600`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )

  const ReportSummary = ({ data }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <SummaryCard label="Total Revenue" value={`₹${data.totalRevenue}`} color="orange" />
      <SummaryCard label="Total Orders" value={data.totalOrders} color="blue" />
      <SummaryCard label="Service Charge" value={`₹${data.scTotal}`} color="gray" />
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
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

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Navbar */}
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

      <div className="p-4 md:p-6 max-w-5xl mx-auto">

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 print:hidden">
          {[
            { id: 'today', label: '📅 Today' },
            { id: 'range', label: '📆 Date Range' },
            { id: 'items', label: '🍴 Items' },
            { id: 'settlement', label: '💰 Settlement' }
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap transition
                ${activeTab === tab.id ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border hover:bg-orange-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center py-8 text-gray-400">
            <p>Loading report data...</p>
          </div>
        )}

        {/* ── Today Tab ── */}
        {activeTab === 'today' && !loading && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-700">
                📅 Today's Report — {formatDate(new Date())}
              </h2>
              <button onClick={fetchToday}
                className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium">
                🔄 Refresh
              </button>
            </div>

            {!todayReport && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">📭</div>
                <p>No paid orders today yet.</p>
              </div>
            )}

            {todayReport && (
              <>
                <ReportSummary data={todayReport} />
                <div className="bg-white rounded-2xl shadow p-5">
                  <h3 className="font-bold text-gray-700 mb-3">Order Details</h3>
                  <div className="space-y-3">
                    {todayOrders.map((order, i) => (
                      <div key={order.id} className="border border-gray-100 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="font-semibold text-gray-700">
                              {order.table_name_snapshot || 'Table'}
                            </span>
                            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium
                              ${order.payment_type === 'cash' ? 'bg-green-100 text-green-600'
                                : order.payment_type === 'upi' ? 'bg-blue-100 text-blue-600'
                                : 'bg-purple-100 text-purple-600'}`}>
                              {order.payment_type === 'cash' ? '💵 Cash'
                                : order.payment_type === 'upi' ? '📱 UPI' : '💳 Card'}
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-orange-500">₹{order.final_amount}</p>
                            <p className="text-xs text-gray-400">{toIST(order.paid_at)}</p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {order.order_items?.map((item, j) => (
                            <div key={j} className="flex justify-between text-xs text-gray-500">
                              <span>{item.food_items?.name} × {item.quantity}</span>
                              <span>₹{item.price_at_order * item.quantity}</span>
                            </div>
                          ))}
                        </div>
                        {order.service_charge_amt > 0 && (
                          <div className="flex justify-between text-xs text-gray-400 mt-1 border-t pt-1">
                            <span>Service charge ({order.service_charge_pct}%)</span>
                            <span>₹{order.service_charge_amt}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Date Range Tab ── */}
        {activeTab === 'range' && !loading && (
          <div>
            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <h3 className="font-bold text-gray-700 mb-3">Select Date Range</h3>
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
                <button onClick={fetchRange}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                  View Report
                </button>
              </div>
            </div>

            {!rangeReport && rangeOrders.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">📊</div>
                <p>Select a date range and click View Report</p>
              </div>
            )}

            {rangeReport && (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold text-gray-700">
                    {formatDate(fromDate)} → {formatDate(toDate)}
                  </h2>
                </div>
                <ReportSummary data={rangeReport} />
                <div className="bg-white rounded-2xl shadow p-5">
                  <h3 className="font-bold text-gray-700 mb-3">
                    All Orders ({rangeOrders.length})
                  </h3>
                  <div className="space-y-3">
                    {rangeOrders.map(order => (
                      <div key={order.id} className="border border-gray-100 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="font-semibold text-gray-700">{order.table_name_snapshot || 'Table'}</span>
                            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium
                              ${order.payment_type === 'cash' ? 'bg-green-100 text-green-600'
                                : order.payment_type === 'upi' ? 'bg-blue-100 text-blue-600'
                                : 'bg-purple-100 text-purple-600'}`}>
                              {order.payment_type === 'cash' ? '💵 Cash'
                                : order.payment_type === 'upi' ? '📱 UPI' : '💳 Card'}
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-orange-500">₹{order.final_amount}</p>
                            <p className="text-xs text-gray-400">{formatDate(order.paid_at)} {toIST(order.paid_at)}</p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {order.order_items?.map((item, j) => (
                            <div key={j} className="flex justify-between text-xs text-gray-500">
                              <span>{item.food_items?.name} × {item.quantity}</span>
                              <span>₹{item.price_at_order * item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Item Stats Tab ── */}
        {activeTab === 'items' && !loading && (
          <div>
            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <h3 className="font-bold text-gray-700 mb-3">Item Sales Report</h3>
              <div className="flex gap-3 flex-wrap items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From</label>
                  <input type="date" value={itemFromDate} onChange={e => setItemFromDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">To</label>
                  <input type="date" value={itemToDate} onChange={e => setItemToDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <button onClick={fetchItemStats}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                  View Items
                </button>
              </div>
            </div>

            {itemStats.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">🍴</div>
                <p>Select date range and click View Items</p>
              </div>
            )}

            {itemStats.length > 0 && (
              <div className="bg-white rounded-2xl shadow p-5">
                <h3 className="font-bold text-gray-700 mb-4">
                  🏆 Best Sellers ({itemStats.length} items)
                </h3>
                <div className="space-y-3">
                  {itemStats.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
                      <span className={`text-lg font-bold w-8 text-center
                        ${index === 0 ? 'text-yellow-500' : index === 1 ? 'text-gray-400' : index === 2 ? 'text-orange-400' : 'text-gray-300'}`}>
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                      </span>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-700">{item.name}</p>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                          <div className="bg-orange-400 h-1.5 rounded-full"
                            style={{ width: `${Math.min((item.qty / itemStats[0].qty) * 100, 100)}%` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-orange-500">{item.qty} sold</p>
                        <p className="text-xs text-gray-400">₹{item.revenue}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Settlement Tab ── */}
        {activeTab === 'settlement' && !loading && (
          <div>
            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <h3 className="font-bold text-gray-700 mb-3">Settlement Report</h3>
              <div className="flex gap-3 flex-wrap items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From</label>
                  <input type="date" value={settlFromDate} onChange={e => setSettlFromDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">To</label>
                  <input type="date" value={settlToDate} onChange={e => setSettlToDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <button onClick={fetchSettlement}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                  View Settlement
                </button>
              </div>
            </div>

            {!settlData && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">💰</div>
                <p>Select date range and click View Settlement</p>
              </div>
            )}

            {settlData && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 col-span-2 md:col-span-1">
                    <p className="text-xs text-gray-500 mb-1">Grand Total</p>
                    <p className="text-3xl font-bold text-orange-600">₹{settlData.grandTotal}</p>
                    <p className="text-xs text-gray-400 mt-1">{settlData.orders.length} transactions</p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">💵 Cash</p>
                    <p className="text-2xl font-bold text-green-600">₹{settlData.cash.total}</p>
                    <p className="text-xs text-gray-400">{settlData.cash.count} orders</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">📱 UPI</p>
                    <p className="text-2xl font-bold text-blue-600">₹{settlData.upi.total}</p>
                    <p className="text-xs text-gray-400">{settlData.upi.count} orders</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 mb-1">💳 Card</p>
                    <p className="text-2xl font-bold text-purple-600">₹{settlData.card.total}</p>
                    <p className="text-xs text-gray-400">{settlData.card.count} orders</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow p-5 mb-4">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-gray-600">Total Service Charges Collected</span>
                    <span className="font-bold text-gray-700">₹{settlData.serviceTotal}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Net (excl. service charge)</span>
                    <span className="font-bold text-gray-700">₹{settlData.grandTotal - settlData.serviceTotal}</span>
                  </div>
                </div>

                {/* Transaction List */}
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
                          <th className="text-right py-2 text-xs text-gray-500">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {settlData.orders.map(order => (
                          <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2 text-xs text-gray-400">
                              {formatDate(order.paid_at)}<br />{toIST(order.paid_at)}
                            </td>
                            <td className="py-2 font-medium text-gray-700">
                              {order.table_name_snapshot || 'Table'}
                            </td>
                            <td className="py-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                                ${order.payment_type === 'cash' ? 'bg-green-100 text-green-600'
                                  : order.payment_type === 'upi' ? 'bg-blue-100 text-blue-600'
                                  : 'bg-purple-100 text-purple-600'}`}>
                                {order.payment_type === 'cash' ? '💵 Cash'
                                  : order.payment_type === 'upi' ? '📱 UPI' : '💳 Card'}
                              </span>
                            </td>
                            <td className="py-2 text-right text-gray-600">₹{order.subtotal}</td>
                            <td className="py-2 text-right text-gray-400">₹{order.service_charge_amt}</td>
                            <td className="py-2 text-right font-bold text-orange-500">₹{order.final_amount}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-200">
                          <td colSpan={5} className="py-2 font-bold text-gray-700">Grand Total</td>
                          <td className="py-2 text-right font-bold text-orange-500 text-lg">
                            ₹{settlData.grandTotal}
                          </td>
                        </tr>
                      </tfoot>
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
<<<<<<< HEAD:src/admin/reports.jsx
}
=======
}
>>>>>>> 1bd1516eca3b0cacced50d5a5e0ffacddec7ee2b:src/admin/Reports.jsx
