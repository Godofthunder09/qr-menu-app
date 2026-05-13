import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})

export default function TodayReport() {
  const navigate = useNavigate()
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(true)
  const [settling, setSettling] = useState(null)
  const [showCloseDay, setShowCloseDay] = useState(false)
  const [closingDay, setClosingDay] = useState(false)
  const [summary, setSummary] = useState(null)

  // Settlement modal — payment type only
  const [showSettleModal, setShowSettleModal] = useState(false)
  const [settleOrderId, setSettleOrderId] = useState(null)
  const [settleTableName, setSettleTableName] = useState('')
  const [settleFinalAmount, setSettleFinalAmount] = useState(0)
  const [settleType, setSettleType] = useState('cash')

  // For display inside modal
  const [settleSubtotal, setSettleSubtotal] = useState(0)
  const [settleServiceChargePct, setSettleServiceChargePct] = useState(0)
  const [settleServiceChargeAmt, setSettleServiceChargeAmt] = useState(0)
  const [settleDiscountAmt, setSettleDiscountAmt] = useState(0)

  useEffect(() => { fetchTodayBills() }, [])

  const fetchTodayBills = async () => {
    setLoading(true)
    const today = todayIST()
    const startISO = new Date(today + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(today + 'T23:59:59+05:30').toISOString()

    const { data, error } = await supabase
      .from('orders')
      .select(`
        id, payment_type, is_paid, paid_at, settlement_status,
        subtotal, service_charge_pct, service_charge_amt,
        discount_type, discount_value, discount_amt,
        final_amount, table_name_snapshot,
        order_items(quantity, price_at_order, food_items(name))
      `)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    if (error) console.error('fetchTodayBills:', error.message)

    const list = data || []
    setBills(list)

    const settled = list.filter(b => b.settlement_status === 'settled')
    const pending = list.filter(b => b.settlement_status === 'pending')
    const totalRevenue = settled.reduce((s, b) => s + (b.final_amount || 0), 0)
    const cashRev = settled.filter(b => b.payment_type === 'cash').reduce((s, b) => s + (b.final_amount || 0), 0)
    const upiRev = settled.filter(b => b.payment_type === 'upi').reduce((s, b) => s + (b.final_amount || 0), 0)
    const cardRev = settled.filter(b => b.payment_type === 'card').reduce((s, b) => s + (b.final_amount || 0), 0)
    setSummary({ totalRevenue, cashRev, upiRev, cardRev, settled: settled.length, pending: pending.length, total: list.length })
    setLoading(false)
  }

  // Open settle modal — amounts are read-only (already fixed at print time)
  const openSettle = (bill) => {
    setSettleOrderId(bill.id)
    setSettleTableName(bill.table_name_snapshot || 'Table')
    setSettleSubtotal(bill.subtotal || 0)
    setSettleServiceChargePct(bill.service_charge_pct || 0)
    setSettleServiceChargeAmt(bill.service_charge_amt || 0)
    setSettleDiscountAmt(bill.discount_amt || 0)
    setSettleFinalAmount(bill.final_amount || bill.subtotal || 0)
    setSettleType('cash')
    setShowSettleModal(true)
  }

  // Confirm settlement — only update payment_type and status
  const confirmSettle = async () => {
    if (!settleOrderId) return
    setSettling(settleOrderId)

    await supabase.from('orders').update({
      payment_type: settleType,
      settlement_status: 'settled',
    }).eq('id', settleOrderId)

    // Update daily_reports
    const today = todayIST()
    const { data: existing } = await supabase
      .from('daily_reports').select('*').eq('report_date', today).single()

    if (existing) {
      await supabase.from('daily_reports').update({
        total_orders: existing.total_orders + 1,
        total_revenue: existing.total_revenue + settleFinalAmount,
        cash_revenue: existing.cash_revenue + (settleType === 'cash' ? settleFinalAmount : 0),
        upi_revenue: existing.upi_revenue + (settleType === 'upi' ? settleFinalAmount : 0),
        card_revenue: existing.card_revenue + (settleType === 'card' ? settleFinalAmount : 0),
        service_charge_total: existing.service_charge_total + settleServiceChargeAmt,
        updated_at: new Date().toISOString()
      }).eq('report_date', today)
    } else {
      await supabase.from('daily_reports').insert({
        report_date: today,
        total_orders: 1,
        total_revenue: settleFinalAmount,
        cash_revenue: settleType === 'cash' ? settleFinalAmount : 0,
        upi_revenue: settleType === 'upi' ? settleFinalAmount : 0,
        card_revenue: settleType === 'card' ? settleFinalAmount : 0,
        service_charge_total: settleServiceChargeAmt
      })
    }

    setSettling(null)
    setShowSettleModal(false)
    fetchTodayBills()
  }

  // Close the day — all settled bills finalized
  const closeDay = async () => {
    const pendingBills = bills.filter(b => b.settlement_status === 'pending')
    if (pendingBills.length > 0) {
      alert(`⚠️ ${pendingBills.length} bills are still unsettled. Please settle all bills before closing the day.`)
      setShowCloseDay(false)
      return
    }

    setClosingDay(true)
    const today = todayIST()
    const startISO = new Date(today + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(today + 'T23:59:59+05:30').toISOString()

    await supabase.from('orders')
      .update({ settlement_status: 'day_closed' })
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)

    setClosingDay(false)
    setShowCloseDay(false)
    alert('✅ Day closed successfully! All bills saved to Reports.')
    fetchTodayBills()
  }

  const pendingBills = bills.filter(b => b.settlement_status === 'pending')
  const settledBills = bills.filter(b => b.settlement_status === 'settled' || b.settlement_status === 'day_closed')

  const PayBadge = ({ type }) => {
    if (!type || type === 'pending') return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700">
        ⏳ Pending
      </span>
    )
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium
        ${type === 'cash' ? 'bg-green-100 text-green-600'
          : type === 'upi' ? 'bg-blue-100 text-blue-600'
          : 'bg-purple-100 text-purple-600'}`}>
        {type === 'cash' ? '💵 Cash' : type === 'upi' ? '📱 UPI' : '💳 Card'}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Settlement Modal — payment type selection only */}
      {showSettleModal && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-bold text-gray-800 mb-1">💰 Settle Bill</h2>
            <p className="text-sm text-gray-400 mb-4">{settleTableName}</p>

            {/* Bill breakdown — read only */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Bill Subtotal</span>
                <span>₹{settleSubtotal}</span>
              </div>
              {settleServiceChargeAmt > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Service Charge ({settleServiceChargePct}%)</span>
                  <span>+₹{settleServiceChargeAmt}</span>
                </div>
              )}
              {settleDiscountAmt > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount</span>
                  <span>-₹{settleDiscountAmt}</span>
                </div>
              )}
              <div className="border-t pt-2 flex justify-between font-bold text-gray-800">
                <span>Amount to Collect</span>
                <span className="text-orange-500 text-lg">₹{settleFinalAmount}</span>
              </div>
            </div>

            {/* Payment Type */}
            <p className="text-sm font-medium text-gray-700 mb-2">How did they pay?</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { id: 'cash', label: '💵 Cash' },
                { id: 'upi', label: '📱 UPI' },
                { id: 'card', label: '💳 Card' }
              ].map(p => (
                <button key={p.id} onClick={() => setSettleType(p.id)}
                  className={`py-3 rounded-xl text-sm font-semibold border-2 transition
                    ${settleType === p.id
                      ? 'border-orange-500 bg-orange-50 text-orange-600'
                      : 'border-gray-200 text-gray-500 hover:border-orange-300'}`}>
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowSettleModal(false)}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium">
                Cancel
              </button>
              <button onClick={confirmSettle} disabled={!!settling}
                className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 disabled:opacity-50">
                {settling ? '⏳...' : '✅ Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Day Modal */}
      {showCloseDay && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">🌙 Close the Day?</h2>
            <p className="text-gray-500 text-sm mb-4">
              This will finalize all of today's settled bills and save them permanently to Reports.
            </p>

            {pendingBills.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                <p className="text-red-600 text-sm font-medium">
                  ⚠️ {pendingBills.length} bill(s) still unsettled!
                  Please settle them first.
                </p>
              </div>
            )}

            {summary && (
              <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Bills</span>
                  <span className="font-bold">{summary.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Revenue</span>
                  <span className="font-bold text-orange-500">₹{summary.totalRevenue}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>💵 Cash</span>
                  <span className="font-bold">₹{summary.cashRev}</span>
                </div>
                <div className="flex justify-between text-blue-600">
                  <span>📱 UPI</span>
                  <span className="font-bold">₹{summary.upiRev}</span>
                </div>
                <div className="flex justify-between text-purple-600">
                  <span>💳 Card</span>
                  <span className="font-bold">₹{summary.cardRev}</span>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setShowCloseDay(false)}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium">
                Cancel
              </button>
              <button onClick={closeDay} disabled={closingDay || pendingBills.length > 0}
                className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold disabled:opacity-50">
                {closingDay ? '⏳ Closing...' : '🌙 Close Day'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-xl">📋</span>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Today's Report</h1>
            <p className="text-xs text-gray-400">
              {new Date().toLocaleDateString('en-IN', {
                timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric'
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setShowCloseDay(true)}
            className="bg-orange-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-600">
            🌙 Close Day
          </button>
          <button onClick={() => navigate('/admin/reports')}
            className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">
            📊 Reports
          </button>
          <button onClick={() => navigate('/admin/dashboard')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
            ← Dashboard
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-3xl mx-auto">

        {/* Summary Cards */}
        {summary && summary.total > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">Total Bills</p>
              <p className="text-2xl font-bold text-gray-700">{summary.total}</p>
              <p className="text-xs text-gray-400 mt-1">
                {summary.settled} settled · {summary.pending} pending
              </p>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">Settled Revenue</p>
              <p className="text-2xl font-bold text-orange-600">₹{summary.totalRevenue}</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">💵 Cash</p>
              <p className="text-2xl font-bold text-green-600">₹{summary.cashRev}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">📱 UPI + 💳 Card</p>
              <p className="text-2xl font-bold text-blue-600">
                ₹{summary.upiRev + summary.cardRev}
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        )}

        {!loading && bills.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-lg font-medium">No bills printed today yet.</p>
            <p className="text-sm mt-1">Bills appear here after printing from the Dashboard.</p>
          </div>
        )}

        {/* Pending Bills */}
        {!loading && pendingBills.length > 0 && (
          <div className="mb-6">
            <h2 className="text-base font-bold text-red-500 mb-3 flex items-center gap-2">
              ⏳ Unsettled Bills ({pendingBills.length})
            </h2>
            <div className="space-y-3">
              {pendingBills.map(bill => (
                <div key={bill.id}
                  className="bg-white border-2 border-yellow-300 rounded-2xl p-4 shadow-sm">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-bold text-gray-800 text-lg">
                        {bill.table_name_snapshot || 'Table'}
                      </p>
                      <p className="text-xs text-gray-400">{toIST(bill.paid_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-orange-500">₹{bill.final_amount}</p>
                      <PayBadge type={bill.payment_type} />
                    </div>
                  </div>

                  <div className="space-y-1 mb-2">
                    {bill.order_items?.map((item, i) => (
                      <div key={i} className="flex justify-between text-xs text-gray-500">
                        <span>{item.food_items?.name} × {item.quantity}</span>
                        <span>₹{item.price_at_order * item.quantity}</span>
                      </div>
                    ))}
                  </div>

                  {(bill.service_charge_amt > 0 || bill.discount_amt > 0) && (
                    <div className="border-t mt-2 pt-2 space-y-0.5 mb-2">
                      {bill.service_charge_amt > 0 && (
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>Service ({bill.service_charge_pct}%)</span>
                          <span>+₹{bill.service_charge_amt}</span>
                        </div>
                      )}
                      {bill.discount_amt > 0 && (
                        <div className="flex justify-between text-xs text-green-600">
                          <span>Discount</span>
                          <span>-₹{bill.discount_amt}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs font-bold text-gray-700 pt-1">
                        <span>Total</span>
                        <span>₹{bill.final_amount}</span>
                      </div>
                    </div>
                  )}

                  <button onClick={() => openSettle(bill)}
                    className="w-full bg-orange-500 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-orange-600">
                    💳 Select Payment Method
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Settled Bills */}
        {!loading && settledBills.length > 0 && (
          <div>
            <h2 className="text-base font-bold text-green-600 mb-3 flex items-center gap-2">
              ✅ Settled Bills ({settledBills.length})
            </h2>
            <div className="space-y-3">
              {settledBills.map(bill => (
                <div key={bill.id}
                  className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm opacity-90">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-bold text-gray-700">
                        {bill.table_name_snapshot || 'Table'}
                      </p>
                      <p className="text-xs text-gray-400">{toIST(bill.paid_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-gray-700">₹{bill.final_amount}</p>
                      <PayBadge type={bill.payment_type} />
                    </div>
                  </div>

                  <div className="space-y-1">
                    {bill.order_items?.map((item, i) => (
                      <div key={i} className="flex justify-between text-xs text-gray-400">
                        <span>{item.food_items?.name} × {item.quantity}</span>
                        <span>₹{item.price_at_order * item.quantity}</span>
                      </div>
                    ))}
                  </div>

                  {(bill.service_charge_amt > 0 || bill.discount_amt > 0) && (
                    <div className="border-t mt-2 pt-2 space-y-0.5">
                      {bill.service_charge_amt > 0 && (
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>Service ({bill.service_charge_pct}%)</span>
                          <span>+₹{bill.service_charge_amt}</span>
                        </div>
                      )}
                      {bill.discount_amt > 0 && (
                        <div className="flex justify-between text-xs text-green-600">
                          <span>Discount</span>
                          <span>-₹{bill.discount_amt}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}