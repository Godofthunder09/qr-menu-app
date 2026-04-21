import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function Dashboard() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        tables(table_name),
        order_items(
          quantity,
          price_at_order,
          food_items(name)
        )
      `)
      .order('created_at', { ascending: false })

    if (!error) setOrders(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()

    // Live real-time updates
    const subscription = supabase
      .channel('orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
      .subscribe()

    return () => supabase.removeChannel(subscription)
  }, [])

  const updateStatus = async (orderId, status) => {
    await supabase.from('orders').update({ status }).eq('id', orderId)
    fetchOrders()
  }

  const clearTable = async (tableId) => {
    const confirmed = window.confirm('Clear this table? This will delete all orders for it.')
    if (!confirmed) return
    await supabase.from('orders').delete().eq('table_id', tableId)
    fetchOrders()
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  const statusColor = (status) => {
    if (status === 'pending') return 'bg-yellow-100 text-yellow-700'
    if (status === 'preparing') return 'bg-blue-100 text-blue-700'
    if (status === 'served') return 'bg-green-100 text-green-700'
    if (status === 'paid') return 'bg-gray-100 text-gray-500'
    return ''
  }

  return (
    <div className="min-h-screen bg-orange-50">

      {/* Navbar */}
      <div className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🍽️</span>
          <h1 className="text-xl font-bold text-orange-500">QR Menu — Dashboard</h1>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/admin/menu')}
            className="bg-orange-100 text-orange-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-200"
          >
            Menu Manager
          </button>
          <button
            onClick={() => navigate('/admin/tables')}
            className="bg-orange-100 text-orange-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-200"
          >
            Tables
          </button>
          <button
            onClick={handleLogout}
            className="bg-red-100 text-red-500 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-200"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Orders */}
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          Live Orders {orders.length > 0 && `(${orders.length})`}
        </h2>

        {loading && <p className="text-gray-400">Loading orders...</p>}

        {!loading && orders.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-3">🪑</div>
            <p>No orders yet. Waiting for customers...</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map((order) => (
            <div key={order.id} className="bg-white rounded-2xl shadow p-5">

              {/* Table + Time */}
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-lg text-orange-500">
                  {order.tables?.table_name || 'Unknown Table'}
                </h3>
                <span className="text-xs text-gray-400">
                  {new Date(order.created_at).toLocaleTimeString()}
                </span>
              </div>

              {/* Status Badge */}
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusColor(order.status)}`}>
                {order.status?.toUpperCase()}
              </span>

              {/* Items */}
              <div className="mt-3 space-y-1">
                {order.order_items?.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm text-gray-600">
                    <span>{item.food_items?.name} x{item.quantity}</span>
                    <span>₹{item.price_at_order * item.quantity}</span>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="border-t mt-3 pt-3 flex justify-between font-bold text-gray-700">
                <span>Total</span>
                <span>₹{order.order_items?.reduce((sum, i) => sum + i.price_at_order * i.quantity, 0)}</span>
              </div>

              {/* Status Buttons */}
              <div className="flex gap-2 mt-4 flex-wrap">
                {['pending', 'preparing', 'served', 'paid'].map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(order.id, s)}
                    className={`text-xs px-3 py-1 rounded-full border font-medium transition
                      ${order.status === s
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'text-gray-500 border-gray-300 hover:border-orange-400'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Clear Table */}
              <button
                onClick={() => clearTable(order.table_id)}
                className="mt-3 w-full text-xs text-red-400 hover:text-red-600 underline"
              >
                Clear Table
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}