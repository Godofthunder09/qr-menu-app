import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function Dashboard() {
  const [tables, setTables] = useState([])
  const [orders, setOrders] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [newOrderTables, setNewOrderTables] = useState(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [loading, setLoading] = useState(true)
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
      // Detect new orders
      const newIds = new Set(ordersData.map(o => o.id))
      const addedTableIds = new Set()
      ordersData.forEach(o => {
        if (!prevOrderIds.current.has(o.id) && prevOrderIds.current.size > 0) {
          addedTableIds.add(o.table_id)
        }
      })
      if (addedTableIds.size > 0) {
        setNewOrderTables(prev => new Set([...prev, ...addedTableIds]))
      }
      prevOrderIds.current = newIds
      setOrders(ordersData)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    const subscription = supabase
      .channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchAll)
      .subscribe()
    return () => supabase.removeChannel(subscription)
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
    const tableOrders = orders.filter(o => o.table_id === tableId)
    for (const order of tableOrders) {
      await supabase.from('order_items').delete().eq('order_id', order.id)
      await supabase.from('orders').delete().eq('id', order.id)
    }
    if (selectedTable?.id === tableId) setSelectedTable(null)
    fetchAll()
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  // Get orders for selected table
  const tableOrders = selectedTable
    ? orders.filter(o => o.table_id === selectedTable.id)
    : []

  // Get all items across all orders for selected table
  const allItems = tableOrders.flatMap(o =>
    (o.order_items || []).map(i => ({ ...i, orderId: o.id, createdAt: o.created_at }))
  )

  // Group items by order
  const groupedByOrder = tableOrders.map(order => ({
    ...order,
    items: order.order_items || []
  }))

  const grandTotal = allItems.reduce((sum, i) => sum + i.price_at_order * i.quantity, 0)

  // Tables that have active orders
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
          <h1 className="text-lg font-bold text-orange-500 hidden sm:block">QR Menu Dashboard</h1>
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
          ${sidebarOpen ? 'w-64' : 'w-0'}
          transition-all duration-300 overflow-hidden
          bg-white shadow-lg flex-shrink-0
          fixed md:relative h-full md:h-auto z-20
          top-0 md:top-auto
        `}>
          <div className="w-64 h-full flex flex-col">
            <div className="p-4 border-b">
              <h2 className="font-bold text-gray-700 text-sm uppercase tracking-wide">
                Active Tables
              </h2>
              <p className="text-xs text-gray-400 mt-1">{activeTables.length} table(s) with orders</p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {activeTables.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">🪑</div>
                  <p className="text-xs">No active orders</p>
                </div>
              )}

              {activeTables.map((table) => {
                const isNew = newOrderTables.has(table.id)
                const isSelected = selectedTable?.id === table.id
                const tableOrderCount = orders.filter(o => o.table_id === table.id).length

                return (
                  <button
                    key={table.id}
                    onClick={() => selectTable(table)}
                    className={`
                      w-full text-left px-4 py-3 rounded-xl mb-2 transition-all
                      ${isSelected
                        ? 'bg-orange-500 text-white'
                        : isNew
                          ? 'bg-yellow-400 text-yellow-900 animate-pulse'
                          : 'bg-gray-50 text-gray-700 hover:bg-orange-50'}
                    `}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-sm">{table.table_name}</span>
                      {isNew && !isSelected && (
                        <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full">
                          New!
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 ${isSelected ? 'text-orange-100' : 'text-gray-400'}`}>
                      {tableOrderCount} order(s)
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-30 z-10 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">

          {/* No table selected */}
          {!selectedTable && (
            <div className="flex flex-col items-center justify-center h-full min-h-64 text-gray-400">
              <div className="text-6xl mb-4">🍽️</div>
              <h2 className="text-xl font-semibold text-gray-500 mb-2">
                {activeTables.length > 0 ? 'Select a table' : 'No active orders'}
              </h2>
              <p className="text-sm text-center">
                {activeTables.length > 0
                  ? 'Click a table from the sidebar to see orders'
                  : 'Waiting for customers to place orders...'}
              </p>
            </div>
          )}

          {/* Table Orders */}
          {selectedTable && (
            <div className="max-w-2xl mx-auto">

              {/* Table Header */}
              <div className="bg-white rounded-2xl shadow p-5 mb-4 flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-orange-500">{selectedTable.table_name}</h2>
                  <p className="text-sm text-gray-400">{tableOrders.length} order round(s)</p>
                </div>
                <button
                  onClick={() => clearTable(selectedTable.id)}
                  className="bg-red-100 text-red-500 px-4 py-2 rounded-xl text-sm font-medium hover:bg-red-200 transition"
                >
                  🗑️ Clear Table
                </button>
              </div>

              {/* Orders by Round */}
              <div className="space-y-4 mb-4">
                {groupedByOrder.map((order, index) => (
                  <div
                    key={order.id}
                    className={`bg-white rounded-2xl shadow p-5 ${index === 0 ? 'border-2 border-orange-400' : ''}`}
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
                      <span className="text-xs text-gray-400">
                        {new Date(order.created_at).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {order.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm text-gray-700">
                          <span>{item.food_items?.name} × {item.quantity}</span>
                          <span className="text-gray-400">₹{item.price_at_order * item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Grand Total */}
              <div className="bg-orange-500 rounded-2xl shadow p-5 text-white">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-lg">Grand Total</span>
                  <span className="font-bold text-2xl">₹{grandTotal}</span>
                </div>
                <p className="text-orange-100 text-xs">
                  * Final bill may include service charges
                </p>
                <button
                  onClick={() => clearTable(selectedTable.id)}
                  className="mt-4 w-full bg-white text-orange-500 py-3 rounded-xl font-bold hover:bg-orange-50 transition"
                >
                  ✅ Mark as Paid & Clear Table
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}