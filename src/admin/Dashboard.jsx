import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})

const toISTDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})

const generatePin = () => String(Math.floor(1000 + Math.random() * 9000))

export default function Dashboard() {
  const [tables, setTables] = useState([])
  const [orders, setOrders] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [newOrderTables, setNewOrderTables] = useState(new Set())
  const [newOrderIds, setNewOrderIds] = useState(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false)
  const [soundReady, setSoundReady] = useState(false)
  const [sessionStart] = useState(() => new Date().toISOString())

  // Payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentTableId, setPaymentTableId] = useState(null)
  const [paymentType, setPaymentType] = useState('cash')
  const [serviceChargePct, setServiceChargePct] = useState(0)
  const [paymentLoading, setPaymentLoading] = useState(false)

  const prevOrderIds = useRef(new Set())
  const audioCtxRef = useRef(null)
  const navigate = useNavigate()

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    setSoundReady(true)
  }

  const playTingTing = useCallback(() => {
    try {
      if (!audioCtxRef.current) return
      const ctx = audioCtxRef.current
      const bell = (startTime, freq) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g)
        g.connect(ctx.destination)
        o.type = 'sine'
        o.frequency.value = freq
        g.gain.setValueAtTime(0.5, startTime)
        g.gain.exponentialRampToValueAtTime(0.001, startTime + 1.0)
        o.start(startTime)
        o.stop(startTime + 1.0)
      }
      bell(ctx.currentTime, 880)
      bell(ctx.currentTime + 0.6, 1100)
    } catch (e) {}
  }, [])

  const fetchAll = useCallback(async () => {
    const { data: tablesData } = await supabase
      .from('tables').select('*').order('created_at')
    setTables(tablesData || [])

    const { data: ordersData } = await supabase
      .from('orders')
      .select(`*, tables(table_name), order_items(quantity, price_at_order, note, food_items(name))`)
      .eq('is_paid', false)
      .order('created_at', { ascending: false })

    if (ordersData) {
      const addedOrderIds = new Set()
      const addedTableIds = new Set()
      ordersData.forEach(o => {
        if (!prevOrderIds.current.has(o.id) && o.created_at > sessionStart) {
          addedOrderIds.add(o.id)
          addedTableIds.add(o.table_id)
        }
      })
      if (addedOrderIds.size > 0) {
        setNewOrderIds(prev => new Set([...prev, ...addedOrderIds]))
        setNewOrderTables(prev => new Set([...prev, ...addedTableIds]))
        playTingTing()
      }
      prevOrderIds.current = new Set(ordersData.map(o => o.id))
      setOrders(ordersData)
    }
    setLoading(false)
  }, [sessionStart, playTingTing])

  useEffect(() => {
    fetchAll()
    const poll = setInterval(fetchAll, 4000)
    const sub = supabase.channel('db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, fetchAll)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, fetchAll)
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(sub) }
  }, [fetchAll])

  const selectTable = (table) => {
    setSelectedTable(table)
    setNewOrderTables(prev => { const n = new Set(prev); n.delete(table.id); return n })
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  // Open payment modal before clearing
  const openPaymentModal = (tableId) => {
    setPaymentTableId(tableId)
    setPaymentType('cash')
    setServiceChargePct(0)
    setShowPaymentModal(true)
  }

  // Calculate totals for payment modal
  const getTableTotal = (tableId) => {
    const tOrders = orders.filter(o => o.table_id === tableId)
    const items = tOrders.flatMap(o => o.order_items || [])
    return items.reduce((s, i) => s + i.price_at_order * i.quantity, 0)
  }

  const subtotal = paymentTableId ? getTableTotal(paymentTableId) : 0
  const serviceAmt = Math.round(subtotal * serviceChargePct / 100)
  const finalAmt = subtotal + serviceAmt

  // Save payment and clear table
  const confirmPayment = async () => {
    if (!paymentTableId) return
    setPaymentLoading(true)

    try {
      const tableOrders = orders.filter(o => o.table_id === paymentTableId)
      const tableName = tables.find(t => t.id === paymentTableId)?.table_name || ''
      const paidAt = new Date().toISOString()

      // Update all orders for this table with payment info
      for (const order of tableOrders) {
        const orderItems = order.order_items || []
        const orderSubtotal = orderItems.reduce((s, i) => s + i.price_at_order * i.quantity, 0)
        const orderServiceAmt = Math.round(orderSubtotal * serviceChargePct / 100)
        const orderFinal = orderSubtotal + orderServiceAmt

        await supabase.from('orders').update({
          payment_type: paymentType,
          is_paid: true,
          paid_at: paidAt,
          subtotal: orderSubtotal,
          service_charge_pct: serviceChargePct,
          service_charge_amt: orderServiceAmt,
          final_amount: orderFinal,
          table_name_snapshot: tableName,
          status: 'paid'
        }).eq('id', order.id)
      }

      // Update daily report
      await updateDailyReport(paymentType, finalAmt, serviceAmt)

      // Now clear the table (sessions, version increment, new PIN)
      await nukeClearTable(paymentTableId, false) // false = don't delete orders, they're kept for reports

      setShowPaymentModal(false)
      setNewOrderIds(prev => {
        const n = new Set(prev)
        tableOrders.forEach(o => n.delete(o.id))
        return n
      })
      if (selectedTable?.id === paymentTableId) setSelectedTable(null)
      setPaymentLoading(false)
      fetchAll()
    } catch (err) {
      alert('Error: ' + err.message)
      setPaymentLoading(false)
    }
  }

  const updateDailyReport = async (pType, amount, svcCharge) => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

    const { data: existing } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('report_date', today)
      .single()

    if (existing) {
      const updates = {
        total_orders: existing.total_orders + 1,
        total_revenue: existing.total_revenue + amount,
        service_charge_collected: existing.service_charge_collected + svcCharge,
        updated_at: new Date().toISOString()
      }
      if (pType === 'cash') updates.cash_revenue = existing.cash_revenue + amount
      if (pType === 'upi') updates.upi_revenue = existing.upi_revenue + amount
      if (pType === 'card') updates.card_revenue = existing.card_revenue + amount

      await supabase.from('daily_reports').update(updates).eq('id', existing.id)
    } else {
      await supabase.from('daily_reports').insert({
        report_date: today,
        total_orders: 1,
        total_revenue: amount,
        cash_revenue: pType === 'cash' ? amount : 0,
        upi_revenue: pType === 'upi' ? amount : 0,
        card_revenue: pType === 'card' ? amount : 0,
        service_charge_collected: svcCharge
      })
    }
  }

  const nukeClearTable = async (tableId, deleteOrders = true) => {
    try {
      if (deleteOrders) {
        const { data: ords } = await supabase
          .from('orders').select('id').eq('table_id', tableId)
        if (ords && ords.length > 0) {
          await supabase.from('order_items').delete().in('order_id', ords.map(o => o.id))
        }
        await supabase.from('orders').delete().eq('table_id', tableId)
      }

      await supabase.from('table_sessions').delete().eq('table_id', tableId)
      const { data: tbl } = await supabase
        .from('tables').select('session_version').eq('id', tableId).single()
      const newPin = generatePin()
      await supabase.from('tables').update({
        session_version: (tbl?.session_version || 1) + 1,
        pin: newPin
      }).eq('id', tableId)
      return true
    } catch (err) { return false }
  }

  const clearAllTables = async () => {
    setShowClearAllConfirm(false)
    setClearing(true)
    const active = tables.filter(t => orders.some(o => o.table_id === t.id))
    for (const table of active) await nukeClearTable(table.id, true)
    setNewOrderIds(new Set())
    setNewOrderTables(new Set())
    setSelectedTable(null)
    setClearing(false)
    fetchAll()
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  const tableOrders = selectedTable
    ? orders.filter(o => o.table_id === selectedTable.id)
    : []
  const allItems = tableOrders.flatMap(o => o.order_items || [])
  const groupedByOrder = tableOrders.map(o => ({ ...o, items: o.order_items || [] }))
  const grandTotal = allItems.reduce((s, i) => s + i.price_at_order * i.quantity, 0)
  const activeTables = tables.filter(t => orders.some(o => o.table_id === t.id))
  const selectedTableData = tables.find(t => t.id === selectedTable?.id)
  const currentPin = selectedTableData?.pin || '----'

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col" onClick={initAudio}>

      {!soundReady && (
        <div className="bg-orange-500 text-white text-center text-xs py-1.5 cursor-pointer font-medium">
          🔔 Tap anywhere to enable order notification sounds
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-xl font-bold text-gray-800 mb-1">💳 Payment Details</h2>
            <p className="text-sm text-gray-400 mb-5">
              {tables.find(t => t.id === paymentTableId)?.table_name}
            </p>

            {/* Payment Type */}
            <p className="text-sm font-medium text-gray-600 mb-2">Payment Method</p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {[
                { key: 'cash', label: '💵 Cash', color: 'green' },
                { key: 'upi', label: '📱 UPI', color: 'blue' },
                { key: 'card', label: '💳 Card', color: 'purple' }
              ].map(p => (
                <button key={p.key}
                  onClick={() => setPaymentType(p.key)}
                  className={`py-3 rounded-xl font-medium text-sm transition border-2
                    ${paymentType === p.key
                      ? 'border-orange-500 bg-orange-50 text-orange-600'
                      : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Service Charge */}
            <p className="text-sm font-medium text-gray-600 mb-2">Service Charge</p>
            <div className="grid grid-cols-4 gap-2 mb-5">
              {[0, 5, 10, 12].map(pct => (
                <button key={pct}
                  onClick={() => setServiceChargePct(pct)}
                  className={`py-2 rounded-xl font-medium text-sm transition border-2
                    ${serviceChargePct === pct
                      ? 'border-orange-500 bg-orange-50 text-orange-600'
                      : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                  {pct}%
                </button>
              ))}
            </div>

            {/* Bill Summary */}
            <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span>
                <span>₹{subtotal}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600">
                <span>Service Charge ({serviceChargePct}%)</span>
                <span>₹{serviceAmt}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-800 border-t pt-2">
                <span>Final Amount</span>
                <span className="text-orange-500 text-lg">₹{finalAmt}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Payment via</span>
                <span className="capitalize font-medium">{paymentType.toUpperCase()}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowPaymentModal(false)}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium">
                Cancel
              </button>
              <button onClick={confirmPayment} disabled={paymentLoading}
                className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold disabled:opacity-50">
                {paymentLoading ? '⏳ Processing...' : '✅ Confirm & Clear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Modal */}
      {showClearAllConfirm && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-xl font-bold text-red-500 mb-2">⚠️ Clear All Active Tables?</h2>
            <p className="text-gray-600 text-sm mb-4">
              This will clear orders from all {activeTables.length} active tables.
              Note: Payment data will NOT be saved for emergency clears.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowClearAllConfirm(false)}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-xl font-medium">Cancel</button>
              <button onClick={clearAllTables}
                className="flex-1 bg-red-500 text-white py-2 rounded-xl font-medium">Yes, Clear All</button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-500 hover:text-orange-500 text-2xl font-bold">☰</button>
          <span className="text-xl">🍽️</span>
          <h1 className="text-lg font-bold text-orange-500 hidden sm:block">QR Menu Dashboard</h1>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {activeTables.length > 0 && (
            <button onClick={() => setShowClearAllConfirm(true)} disabled={clearing}
              className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200 disabled:opacity-50">
              🧹 Clear All
            </button>
          )}
          <button onClick={() => navigate('/admin/reports')}
            className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">
            📊 Reports
          </button>
          <button onClick={() => navigate('/admin/menu')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
            Menu
          </button>
          <button onClick={() => navigate('/admin/tables')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
            Tables
          </button>
          <button onClick={handleLogout}
            className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200">
            Logout
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">

        {/* Sidebar */}
        <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          transition-all duration-300 bg-white shadow-lg flex-shrink-0
          fixed md:relative h-[calc(100vh-56px)] w-64
          z-20 top-14 md:top-0 overflow-hidden`}>
          <div className="w-64 h-full flex flex-col">
            <div className="p-4 border-b bg-orange-50">
              <h2 className="font-bold text-gray-700 text-sm uppercase tracking-wide">🪑 Active Tables</h2>
              <p className="text-xs text-gray-400 mt-1">{activeTables.length} table(s) with orders</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && <p className="text-xs text-gray-400 text-center py-4">Loading...</p>}
              {!loading && activeTables.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">🪑</div>
                  <p className="text-xs">No active orders yet</p>
                </div>
              )}
              {activeTables.map(table => {
                const isNew = newOrderTables.has(table.id)
                const isSelected = selectedTable?.id === table.id
                const tableOrderList = orders.filter(o => o.table_id === table.id)
                const count = tableOrderList.length
                const latest = tableOrderList[0]
                const newCount = tableOrderList.filter(o => newOrderIds.has(o.id)).length
                return (
                  <button key={table.id} onClick={() => selectTable(table)}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all border
                      ${isSelected ? 'bg-orange-500 text-white border-orange-500 shadow-md'
                        : isNew ? 'bg-yellow-400 text-yellow-900 border-yellow-500 animate-pulse'
                        : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-orange-50'}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-sm">{table.table_name}</span>
                      {newCount > 0 && !isSelected && (
                        <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">
                          {newCount} New!
                        </span>
                      )}
                    </div>
                    <div className={`flex justify-between mt-1 text-xs ${isSelected ? 'text-orange-100' : 'text-gray-400'}`}>
                      <span>{count} order(s)</span>
                      {latest && <span>{toIST(latest.created_at)}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="p-3 border-t text-center">
              <p className="text-xs text-gray-300">Auto-refreshes every 4s</p>
            </div>
          </div>
        </div>

        {sidebarOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-30 z-10 md:hidden"
            onClick={() => setSidebarOpen(false)} />
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {!selectedTable && (
            <div className="flex flex-col items-center justify-center h-full min-h-64 text-gray-400">
              <div className="text-6xl mb-4">🍽️</div>
              <h2 className="text-xl font-semibold text-gray-500 mb-2">
                {activeTables.length > 0 ? 'Select a table' : 'No active orders'}
              </h2>
              <p className="text-sm text-center text-gray-400">
                {activeTables.length > 0 ? 'Click any table from the sidebar' : 'Waiting for customers...'}
              </p>
            </div>
          )}

          {selectedTable && (
            <div className="max-w-2xl mx-auto">

              {/* Table Header */}
              <div className="bg-white rounded-2xl shadow p-5 mb-4">
                <div className="flex justify-between items-start flex-wrap gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-orange-500">{selectedTable.table_name}</h2>
                    <p className="text-sm text-gray-400 mt-1">
                      {tableOrders.length} round(s) •{' '}
                      {tableOrders.length > 0 && toISTDate(tableOrders[tableOrders.length - 1].created_at)}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-gray-500 font-medium">Table PIN:</span>
                      <span className="bg-orange-500 text-white font-bold text-xl px-4 py-1 rounded-xl tracking-widest">
                        {currentPin}
                      </span>
                      <span className="text-xs text-gray-400">Share with customer</span>
                    </div>
                  </div>
                  <button onClick={() => openPaymentModal(selectedTable.id)} disabled={clearing}
                    className="bg-green-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-600 transition disabled:opacity-50">
                    {clearing ? '⏳...' : '✅ Mark Paid & Clear'}
                  </button>
                </div>
              </div>

              {/* Order Rounds */}
              <div className="space-y-4 mb-4">
                {groupedByOrder.map((order, index) => {
                  const isNewOrder = newOrderIds.has(order.id)
                  return (
                    <div key={order.id}
                      className={`rounded-2xl shadow p-5 transition-all
                        ${isNewOrder ? 'bg-yellow-50 border-2 border-yellow-400' : 'bg-white border border-gray-100'}`}>
                      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="bg-orange-100 text-orange-600 text-xs font-bold px-3 py-1 rounded-full">
                            Round {groupedByOrder.length - index}
                          </span>
                          {isNewOrder && (
                            <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full animate-pulse">
                              🆕 New!
                            </span>
                          )}
                          {!isNewOrder && index === 0 && (
                            <span className="bg-green-100 text-green-600 text-xs font-bold px-3 py-1 rounded-full">
                              Latest ✨
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 font-medium">🕐 {toIST(order.created_at)}</span>
                      </div>
                      <div className="space-y-3">
                        {order.items.map((item, i) => (
                          <div key={i} className="py-2 border-b border-gray-50 last:border-0">
                            <div className="flex justify-between text-sm text-gray-700">
                              <span className="font-medium">{item.food_items?.name}</span>
                              <span className="text-gray-500">× {item.quantity}</span>
                            </div>
                            {item.note && item.note.trim() !== '' && (
                              <p className="text-xs text-orange-500 italic mt-1">📝 "{item.note}"</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Grand Total */}
              <div className="bg-orange-500 rounded-2xl shadow p-5 text-white mb-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-lg">Grand Total</span>
                  <span className="font-bold text-2xl">₹{grandTotal}</span>
                </div>
                <p className="text-orange-100 text-xs mb-4">
                  * Service charges will be added at payment
                </p>
                <button onClick={() => openPaymentModal(selectedTable.id)} disabled={clearing}
                  className="w-full bg-white text-orange-500 py-3 rounded-xl font-bold hover:bg-orange-50 transition text-sm disabled:opacity-50">
                  {clearing ? '⏳ Processing...' : '✅ Mark as Paid & Clear Table'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}