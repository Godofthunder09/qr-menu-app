import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function MenuPage() {
  const [searchParams] = useSearchParams()
  const tableId = searchParams.get('table')
  const [tableName, setTableName] = useState('')
  const [categories, setCategories] = useState([])
  const [foodItems, setFoodItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [loading, setLoading] = useState(true)
  const [placing, setPlacing] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!tableId) return
    fetchData()
  }, [tableId])

  const fetchData = async () => {
    const { data: tableData } = await supabase
      .from('tables')
      .select('*')
      .eq('id', tableId)
      .single()
    if (tableData) setTableName(tableData.table_name)

    const { data: cats } = await supabase
      .from('categories')
      .select('*')
      .order('created_at')
    setCategories(cats || [])

    const { data: items } = await supabase
      .from('food_items')
      .select('*, categories(name)')
      .eq('is_available', true)
      .order('created_at')
    setFoodItems(items || [])
    setLoading(false)
  }

  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id)
      if (existing) {
        return prev.map((c) => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
      }
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  const removeFromCart = (itemId) => {
    setCart((prev) => prev.filter((c) => c.id !== itemId))
  }

  const updateQuantity = (itemId, qty) => {
    if (qty < 1) { removeFromCart(itemId); return }
    setCart((prev) => prev.map((c) => c.id === itemId ? { ...c, quantity: qty } : c))
  }

  const getQuantityInCart = (itemId) => {
    const item = cart.find((c) => c.id === itemId)
    return item ? item.quantity : 0
  }

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)

  const filteredItems = activeCategory === 'all'
    ? foodItems
    : foodItems.filter((item) => item.category_id === activeCategory)

  const placeOrder = async () => {
    if (cart.length === 0) { alert('Add items to cart first!'); return }
    if (!tableId) { alert('Invalid table!'); return }
    setPlacing(true)

    const { data: order, error } = await supabase
      .from('orders')
      .insert({ table_id: tableId, status: 'pending' })
      .select()
      .single()

    if (error) {
      alert('Error placing order: ' + error.message)
      setPlacing(false)
      return
    }

    const orderItems = cart.map((item) => ({
      order_id: order.id,
      food_item_id: item.id,
      quantity: item.quantity,
      price_at_order: item.price,
    }))

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)

    if (itemsError) {
      alert('Error saving items: ' + itemsError.message)
      setPlacing(false)
      return
    }

    setCart([])
    setShowCart(false)
    setPlacing(false)
    navigate(`/order-confirmation?table=${tableId}&name=${tableName}`)
  }

  if (!tableId) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-3">❌</div>
          <p className="text-gray-500">Invalid QR Code. Please scan again.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-3">🍽️</div>
          <p className="text-gray-400">Loading menu...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-orange-50 pb-32">

      {/* Header */}
      <div className="bg-white shadow px-4 py-4 sticky top-0 z-10">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-orange-500">🍽️ Our Menu</h1>
            <p className="text-sm text-gray-400">{tableName}</p>
          </div>
          {totalItems > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="relative bg-orange-500 text-white px-4 py-2 rounded-full text-sm font-medium"
            >
              🛒 Cart
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {totalItems}
              </span>
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-4 py-1 rounded-full text-sm font-medium whitespace-nowrap transition
              ${activeCategory === 'all' ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-1 rounded-full text-sm font-medium whitespace-nowrap transition
                ${activeCategory === cat.id ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Food Items */}
      <div className="p-4 space-y-3">
        {filteredItems.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">🍴</div>
            <p>No items in this category</p>
          </div>
        )}

        {filteredItems.map((item) => {
          const qty = getQuantityInCart(item.id)
          return (
            <div key={item.id} className="bg-white rounded-2xl shadow p-4 flex gap-3">
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="w-20 h-20 rounded-xl object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-20 h-20 bg-orange-100 rounded-xl flex items-center justify-center text-3xl flex-shrink-0">
                  🍴
                </div>
              )}
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800">{item.name}</h3>
                {item.description && (
                  <p className="text-xs text-gray-400 mt-1">{item.description}</p>
                )}
                <p className="text-orange-500 font-bold mt-1">₹{item.price}</p>
                <div className="mt-2">
                  {qty === 0 ? (
                    <button
                      onClick={() => addToCart(item)}
                      className="bg-orange-500 text-white px-4 py-1 rounded-full text-sm font-medium hover:bg-orange-600"
                    >
                      + Add
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.id, qty - 1)}
                        className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full font-bold text-lg flex items-center justify-center"
                      >
                        −
                      </button>
                      <span className="font-semibold text-gray-700">{qty}</span>
                      <button
                        onClick={() => updateQuantity(item.id, qty + 1)}
                        className="w-7 h-7 bg-orange-500 text-white rounded-full font-bold text-lg flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Cart Drawer */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black bg-opacity-40">
          <div className="bg-white rounded-t-3xl p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">🛒 Your Order</h2>
              <button
                onClick={() => setShowCart(false)}
                className="text-gray-400 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            {cart.length === 0 && (
              <p className="text-gray-400 text-center py-8">Cart is empty!</p>
            )}

            <div className="space-y-3 mb-4">
              {cart.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-b pb-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-700">{item.name}</p>
                    <p className="text-orange-500 text-sm">₹{item.price} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full font-bold flex items-center justify-center"
                    >
                      −
                    </button>
                    <span className="font-semibold w-4 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-7 h-7 bg-orange-500 text-white rounded-full font-bold flex items-center justify-center"
                    >
                      +
                    </button>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-red-400 text-sm ml-2"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="font-bold text-gray-700 w-16 text-right">
                    ₹{item.price * item.quantity}
                  </p>
                </div>
              ))}
            </div>

            {cart.length > 0 && (
              <>
                <div className="flex justify-between font-bold text-lg text-gray-800 mb-4">
                  <span>Total</span>
                  <span>₹{totalAmount}</span>
                </div>
                <button
                  onClick={placeOrder}
                  disabled={placing}
                  className="w-full bg-orange-500 text-white py-4 rounded-2xl font-bold text-lg hover:bg-orange-600 transition disabled:opacity-50"
                >
                  {placing ? 'Placing Order...' : '🍽️ Place Order'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sticky Bottom Bar */}
      {totalItems > 0 && !showCart && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg">
          <button
            onClick={() => setShowCart(true)}
            className="w-full bg-orange-500 text-white py-4 rounded-2xl font-bold text-lg flex justify-between items-center px-6"
          >
            <span>🛒 {totalItems} items</span>
            <span>View Cart • ₹{totalAmount}</span>
          </button>
        </div>
      )}
    </div>
  )
}