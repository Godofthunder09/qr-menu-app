import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})

const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})

const todayIST = () => new Date().toLocaleDateString('en-CA', {
  timeZone: 'Asia/Kolkata'
})

const ORDER_SELECT = `
  id, payment_type, is_paid, paid_at,
  subtotal, service_charge_pct, service_charge_amt,
  discount_type, discount_value, discount_amt,
  final_amount, table_name_snapshot,
  order_items(quantity, price_at_order, food_items(name))
`

export default function Reports() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('today')
  const [loading, setLoading] = useState(false)

  const [todayOrders, setTodayOrders] = useState([])
  const [todayReport, setTodayReport] = useState(null)

  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate, setToDate] = useState(todayIST())
  const [rangeOrders, setRangeOrders] = useState([])
  const [rangeReport, setRangeReport] = useState(null)

  const [itemStats, setItemStats] = useState([])
  const [itemFromDate, setItemFromDate] = useState(todayIST())
  const [itemToDate, setItemToDate] = useState(todayIST())

  const [settlFromDate, setSettlFromDate] = useState(todayIST())
  const [settlToDate, setSettlToDate] = useState(todayIST())
  const [settlData, setSettlData] = useState(null)

  useEffect(() => { fetchToday() }, [])

  const buildSummary = (orders) => {
    const totalRevenue = orders.reduce((s, o) => s + (o.final_amount || 0), 0)
    const cashRev = orders.filter(o => o.payment_type === 'cash')
      .reduce((s, o) => s + (o.final_amount || 0), 0)
    const upiRev = orders.filter(o => o.payment_type === 'upi')
      .reduce((s, o) => s + (o.final_amount || 0), 0)
    const cardRev = orders.filter(o => o.payment_type === 'card')
      .reduce((s, o) => s + (o.final_amount || 0), 0)
    const scTotal = orders.reduce((s, o) => s + (o.service_charge_amt || 0), 0)
    const discountTotal = orders.reduce((s, o) => s + (o.discount_amt || 0), 0)
    return {
      totalRevenue, cashRev, upiRev, cardRev,
      scTotal, discountTotal, totalOrders: orders.length
    }
  }

  const toRange = (from, to) => ({
    startISO: new Date(from + 'T00:00:00+05:30').toISOString(),
    endISO: new Date(to + 'T23:59:59+05:30').toISOString(),
  })

  const fetchToday = async () => {
    setLoading(true)
    const today = todayIST()
    const { startISO, endISO } = toRange(today, today)

    const { data: orders, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    if (error) console.error('fetchToday:', error.message)
    const list = orders || []
    setTodayOrders(list)
    setTodayReport(list.length > 0 ? buildSummary(list) : null)
    setLoading(false)
  }

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
    const list = orders || []
    setRangeOrders(list)
    setRangeReport(list.length > 0 ? buildSummary(list) : null)
    setLoading(false)
  }

  const fetchItemStats = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(itemFromDate, itemToDate)

    const { data: orders, error: ordErr } = await supabase
      .from('orders').select('id')
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)

    if (ordErr) console.error('fetchItemStats:', ordErr.message)

    if (!orders || orders.length === 0) {
      setItemStats([])
      setLoading(false)
      return
    }

    const { data: items, error: itemErr } = await supabase
      .from('order_items')
      .select('quantity, price_at_order, food_items(name)')
      .in('order_id', orders.map(o => o.id))

    if (itemErr) console.error('fetchItemStats items:', itemErr.message)

    const map = {}
    items?.forEach(i => {
      const name = i.food_items?.name || 'Unknown'
      if (!map[name]) map[name] = { name, qty: 0, revenue: 0 }
      map[name].qty += i.quantity
      map[name].revenue += i.price_at_order * i.quantity
    })

    setItemStats(Object.values(map).sort((a, b) => b.qty - a.qty))
    setLoading(false)
  }

  const fetchSettlement = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(settlFromDate, settlToDate)

    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, payment_type, paid_at, table_name_snapshot,
        subtotal, service_charge_pct, service_charge_amt,
        discount_type, discount_value, discount_amt,
        final_amount
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

    const cash = orders.filter(o => o.payment_type === 'cash')
    const upi = orders.filter(o => o.payment_type === 'upi')
    const card = orders.filter(o => o.payment_type === 'card')

    setSettlData({
      orders,
      cash: { count: cash.length, total: cash.reduce((s, o) => s + (o.final_amount || 0), 0) },
      upi: { count: upi.length, total: upi.reduce((s, o) => s + (o.final_amount || 0), 0) },
      card: { count: card.length, total: card.reduce((s, o) => s + (o.final_amount || 0), 0) },
      grandTotal: orders.reduce((s, o) => s + (o.final_amount || 0), 0),
      serviceTotal: orders.reduce((s, o) => s + (o.service_charge_amt || 0), 0),
      discountTotal: orders.reduce((s, o) => s + (o.discount_amt || 0), 0)
    })
    setLoading(false)
  }

  const printReport = () => window.print()

  const PayBadge = ({ type }) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
      ${type === 'cash' ? 'bg-green-100 text-green-600'
        : type === 'upi' ? 'bg-blue-100 text-blue-600'
        : 'bg-purple-100 text-purple-600'}`}>
      {type === 'cash' ? '💵 Cash' : type === 'upi' ? '📱 UPI' : '💳 Card'}
    </span>
  )

  const ReportSummary = ({ data }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
        <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
        <p className="text-2xl font-bold text-orange-600">₹{data.totalRevenue}</p>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
        <p className="text-xs text-gray-500 mb-1">Total Orders</p>
        <p className="text-2xl font-bold text-blue-600">{data.totalOrders}</p>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
        <p className="text-xs text-gray-500 mb-1">Service Charge</p>
        <p className="text-2xl font-bold text-gray-600">₹{data.scTotal}</p>
        {data.discountTotal > 0 && (
          <p className="text-xs text-green-600 mt-1">Discount: -₹{data.discountTotal}</p>
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

  const OrderCard = ({ order, showDate = false }) => (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-700">
            {order.table_name_snapshot || 'Table'}
          </span>
          <PayBadge type={order.payment_type} />
        </div>
        <div className="text-right">
          <p className="font-bold text-orange-500">₹{order.final_amount}</p>
          <p className="text-xs text-gray-400">
            {showDate ? `${formatDate(order.paid_at)} ` : ''}{toIST(order.paid_at)}
          </p>
        </div>
      </div>

      <div className="space-y-1 mb-2">
        {order.order_items?.map((item, j) => (
          <div key={j} className="flex justify-between text-xs text-gray-500">
            <span>{item.food_items?.name} × {item.quantity}</span>
            <span>₹{item.price_at_order * item.quantity}</span>
          </div>
        ))}
      </div>

      <div className="border-t pt-2 space-y-0.5">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Subtotal</span>
          <span>₹{order.subtotal || 0}</span>
        </div>
        {order.service_charge_amt > 0 && (
          <div className="flex justify-between text-xs text-gray-400">
            <span>Service ({order.service_charge_pct}%)</span>
            <span>₹{order.service_charge_amt}</span>
          </div>
        )}
        {order.discount_amt > 0 && (
          <div className="flex justify-between text-xs text-green-600">
            <span>
              Discount
              {order.discount_type === 'percent'
                ? ` (${order.discount_value}%)`
                : ` (₹${order.discount_value} flat)`}
            </span>
            <span>-₹{order.discount_amt}</span>
          </div>
        )}
        <div className="flex justify-between text-xs font-bold text-gray-700 pt-1 border-t">
          <span>Final</span>
          <span className="text-orange-500">₹{order.final_amount}</span>
        </div>
      </div>
    </div>
  )

  const DateRangeFilter = ({ from, to, onFrom, onTo, onFetch, btnText = 'View Report' }) => (
    <div className="bg-white rounded-2xl shadow p-5 mb-4">
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="text-xs text-gray-500 block mb-1">From</label>
          <input type="date" value={from} onChange={e => onFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">To</label>
          <input type="date" value={to} onChange={e => onTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        </div>
        <button onClick={onFetch}
          className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
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
                ${activeTab === tab.id
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-500 border hover:bg-orange-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {loading && <div className="text-center py-8 text-gray-400">Loading...</div>}

        {/* ── Today ── */}
        {activeTab === 'today' && !loading && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-700">
                📅 Today — {formatDate(new Date())}
              </h2>
              <button onClick={fetchToday}
                className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
                🔄 Refresh
              </button>
            </div>

            {!todayReport
              ? <EmptyState icon="📭" text="No paid orders today yet." />
              : <>
                  <ReportSummary data={todayReport} />
                  <div className="bg-white rounded-2xl shadow p-5">
                    <h3 className="font-bold text-gray-700 mb-3">
                      Order Details ({todayOrders.length})
                    </h3>
                    <div className="space-y-3">
                      {todayOrders.map(order => (
                        <OrderCard key={order.id} order={order} showDate={false} />
                      ))}
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* ── Date Range ── */}
        {activeTab === 'range' && !loading && (
          <div>
            <DateRangeFilter
              from={fromDate} to={toDate}
              onFrom={setFromDate} onTo={setToDate}
              onFetch={fetchRange} btnText="View Report"
            />
            {!rangeReport
              ? <EmptyState icon="📊" text="Select a date range and click View Report" />
              : <>
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
                        <OrderCard key={order.id} order={order} showDate={true} />
                      ))}
                    </div>
                  </div>
                </>
            }
          </div>
        )}

        {/* ── Item Stats ── */}
        {activeTab === 'items' && !loading && (
          <div>
            <DateRangeFilter
              from={itemFromDate} to={itemToDate}
              onFrom={setItemFromDate} onTo={setItemToDate}
              onFetch={fetchItemStats} btnText="View Items"
            />
            {itemStats.length === 0
              ? <EmptyState icon="🍴" text="Select date range and click View Items" />
              : <div className="bg-white rounded-2xl shadow p-5">
                  <h3 className="font-bold text-gray-700 mb-4">
                    🏆 Best Sellers ({itemStats.length} items)
                  </h3>
                  <div className="space-y-3">
                    {itemStats.map((item, index) => (
                      <div key={item.name} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
                        <span className="text-lg font-bold w-8 text-center">
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
            }
          </div>
        )}

        {/* ── Settlement ── */}
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

                  <div className="bg-white rounded-2xl shadow p-5 mb-4 space-y-2 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Total Service Charges Collected</span>
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
                          {settlData.orders.map(order => (
                            <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2 text-xs text-gray-400">
                                {formatDate(order.paid_at)}<br />{toIST(order.paid_at)}
                              </td>
                              <td className="py-2 font-medium text-gray-700">
                                {order.table_name_snapshot || 'Table'}
                              </td>
                              <td className="py-2">
                                <PayBadge type={order.payment_type} />
                              </td>
                              <td className="py-2 text-right text-gray-600">
                                ₹{order.subtotal || 0}
                              </td>
                              <td className="py-2 text-right text-gray-400">
                                {order.service_charge_amt > 0 ? `₹${order.service_charge_amt}` : '—'}
                              </td>
                              <td className="py-2 text-right text-green-600">
                                {order.discount_amt > 0 ? `-₹${order.discount_amt}` : '—'}
                              </td>
                              <td className="py-2 text-right font-bold text-orange-500">
                                ₹{order.final_amount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-200">
                            <td colSpan={6} className="py-2 font-bold text-gray-700">
                              Grand Total
                            </td>
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