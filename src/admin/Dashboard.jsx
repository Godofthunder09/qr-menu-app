import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

const toIST = (dateStr) => {
  return new Date(dateStr).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}

const toISTDate = (dateStr) => {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

export default function Dashboard() {
  const [tables, setTables] = useState([])
  const [orders, setOrders] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [newOrderTables, setNewOrderTables] = useState(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const prevOrderIds = useRef(new Set())
  const navigate = useNavigate()

  const fetchAll = async () => {
    const { data: tablesData } = await supabase
      .from('tables').select('*').order('created_at')
    setTables(tablesData || [])

    const { data: ordersData } = await supabase
      .from('orders')
      .select(`*, tables(table_name), order_items(quantity, price_at_order, food_items(name))`)
      .order('created_at', { ascending: false })

    if (ordersData) {
      const addedTableIds = new Set()
      ordersData.forEach(o => {
        if (!prevOrderIds.current.has(o.id) && prevOrderIds.current.size > 0) {
          addedTableIds.add(o.table_id)
        }
      })
      if (addedTableIds.size > 0) {
        setNewOrderTables(prev => new Set([...prev, ...addedTableIds]))
      }
      prevOrderIds.current = new Set(ordersData.map(o => o.id))
      setOrders(ordersData)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()

    const pollInterval = setInterval(() => {
      fetchAll()
    }, 5000)

    const subscription = supabase
      .channel('dashboard-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => fetchAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_items' }, () => fetchAll())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, () => fetchAll())
      .subscribe()

    return () => {
      clearInterval(pollInterval)
      supabase.removeChannel(subscription)
    }
  }, [])

  const selectTable = (table) => {
    setSelectedTable(table)
    setNewOrderTables(prev => {
      const next = new Set(prev)
      next.delete(table.id)
      return next
    })
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  const clearTable = async (tableId) => {
    if (!window.confirm('Clear all orders for this table?')) return
    setClearing(true)

    try {
      // Step 1 — Get all order IDs
      const { data: tableOrdersData, error: fetchError } = await supabase
        .from('orders')
        .select('id')
        .eq('table_id', tableId)

      if (fetchError) {
        alert('Error fetching orders: ' + fetchError.message)
        setClearing(false)
        return
      }

      // Step 2 — Delete order_items first
      if (tableOrdersData && tableOrdersData.length > 0) {
        const orderIds = tableOrdersData.map(o => o.id)

        const { error: itemsError } = await supabase
          .from('order_items')
          .delete()
          .in('order_id', orderIds)

        if (itemsError) {
          alert('Error deleting items: ' + itemsError.message)
          setClearing(false)
          return
        }

        // Step 3 — Delete orders
        const { error: ordersError } = await supabase
          .from('orders')
          .delete()
          .eq('table_id', tableId)

        if (ordersError) {
          alert('Error deleting orders: ' + ordersError.message)
          setClearing(false)
          return
        }
      }

      // Step 4 — Delete ALL sessions for this table
      // This allows next customer to get fresh order rights
      const { error: sessionError } = await supabase
        .from('table_sessions')
        .delete()
        .eq('table_id', tableId)

      if (sessionError) {
        console.error('Session delete error:', sessionError.message)
      }

      if (selectedTable?.id === tableId) setSelectedTable(null)
      setClearing(false)
      fetchAll()

    } catch (err) {
      alert('Unexpected error: ' + err.message)
      setClearing(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  const tableOrders = selectedTable
    ? orders.filter(o => o.table_id === selectedTable.id)
    : []

  const allItems = tableOrders.flatMap(o =>
    (o.order_items || []).map(i => ({ ...i, orderId: o.id, createdAt: o.created_at }))
  )

  const groupedByOrder = tableOrders.map(order => ({
    ...order,
    items: order.order_items || []
  }))

  const grandTotal = allItems.reduce((sum, i) => sum + i.price_at_order * i.quantity, 0)

  const activeTables = tables.filter(t => orders.some(o => o.table_id === t.id))

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">

      {/* Top Navbar */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-500 hover:text-orange-500 text-2xl font-bold"
          >
            ☰
          </button>
          <span className="text-xl">🍽️</span>
          <h1 className="text-lg font-bold text-orange-500 hidden sm:block">
            QR Menu Dashboard
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/admin/menu')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200"
          >
            Menu
          </button>
          <button
            onClick={() => navigate('/admin/tables')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200"
          >
            Tables
          </button>
          <button
            onClick={handleLogout}
            className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">

        {/* Sidebar */}
        <div className={`
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          transition-all duration-300
          bg-white shadow-lg flex-shrink-0
          fixed md:relative
          h-[calc(100vh-56px)] w-64
          z-20 top-14 md:top-0
          overflow-hidden
        `}>
          <div className="w-64 h-full flex flex-col">

            {/* Sidebar Header */}
            <div className="p-4 border-b bg-orange-50">
              <h2 className="font-bold text-gray-700 text-sm uppercase tracking-wide">
                🪑 Active Tables
              </h2>
              <p className="text-xs text-gray-400 mt-1">
                {activeTables.length} table(s) with orders
              </p>
            </div>

            {/* Table List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && (
                <p className="text-xs text-gray-400 text-center py-4">Loading...</p>
              )}

              {!loading && activeTables.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">🪑</div>
                  <p className="text-xs">No active orders yet</p>
                </div>
              )}

              {activeTables.map((table) => {
                const isNew = newOrderTables.has(table.id)
                const isSelected = selectedTable?.id === table.id
                const tableOrderCount = orders.filter(o => o.table_id === table.id).length
                const latestOrder = orders.find(o => o.table_id === table.id)

                return (
                  <button
                    key={table.id}
                    onClick={() => selectTable(table)}
                    className={`
                      w-full text-left px-4 py-3 rounded-xl transition-all border
                      ${isSelected
                        ? 'bg-orange-500 text-white border-orange-500 shadow-md'
                        : isNew
                          ? 'bg-yellow-400 text-yellow-900 border-yellow-400 animate-pulse'
                          : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-orange-50 hover:border-orange-200'}
                    `}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-sm">{table.table_name}</span>
                      {isNew && !isSelected && (
                        <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">
                          New!
                        </span>
                      )}
                    </div>
                    <div className={`flex justify-between mt-1 text-xs ${isSelected ? 'text-orange-100' : 'text-gray-400'}`}>
                      <span>{tableOrderCount} order(s)</span>
                      {latestOrder && (
                        <span>{toIST(latestOrder.created_at)}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Sidebar Footer */}
            <div className="p-3 border-t text-center">
              <p className="text-xs text-gray-300">Auto-refreshes every 5s</p>
            </div>
          </div>
        </div>

        {/* Mobile Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-30 z-10 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
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
                {activeTables.length > 0
                  ? 'Click any table from the sidebar to view orders'
                  : 'Waiting for customers to place orders...'}
              </p>
            </div>
          )}

          {selectedTable && (
            <div className="max-w-2xl mx-auto">

              {/* Table Header */}
              <div className="bg-white rounded-2xl shadow p-5 mb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold text-orange-500">
                      {selectedTable.table_name}
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">
                      {tableOrders.length} order round(s) •{' '}
                      {tableOrders.length > 0 && toISTDate(tableOrders[tableOrders.length - 1].created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => clearTable(selectedTable.id)}
                    disabled={clearing}
                    className="bg-red-100 text-red-500 px-4 py-2 rounded-xl text-sm font-medium hover:bg-red-200 transition disabled:opacity-50"
                  >
                    {clearing ? '⏳ Clearing...' : '🗑️ Clear Table'}
                  </button>
                </div>
              </div>

              {/* Order Rounds */}
              <div className="space-y-4 mb-4">
                {groupedByOrder.map((order, index) => (
                  <div
                    key={order.id}
                    className={`bg-white rounded-2xl shadow p-5 ${index === 0 ? 'border-2 border-orange-400' : 'border border-gray-100'}`}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <span className="bg-orange-100 text-orange-600 text-xs font-bold px-3 py-1 rounded-full">
                          Round {groupedByOrder.length - index}
                        </span>
                        {index === 0 && (
                          <span className="bg-green-100 text-green-600 text-xs font-bold px-3 py-1 rounded-full">
                            Latest ✨
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 font-medium">
                        🕐 {toIST(order.created_at)}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {order.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm text-gray-700 py-1 border-b border-gray-50 last:border-0">
                          <span className="font-medium">{item.food_items?.name}</span>
                          <span className="text-gray-500">× {item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Grand Total */}
              <div className="bg-orange-500 rounded-2xl shadow p-5 text-white">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-lg">Grand Total</span>
                  <span className="font-bold text-2xl">₹{grandTotal}</span>
                </div>
                <p className="text-orange-100 text-xs mb-4">
                  * Final bill may include service charges & taxes
                </p>
                <button
                  onClick={() => clearTable(selectedTable.id)}
                  disabled={clearing}
                  className="w-full bg-white text-orange-500 py-3 rounded-xl font-bold hover:bg-orange-50 transition text-sm disabled:opacity-50"
                >
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