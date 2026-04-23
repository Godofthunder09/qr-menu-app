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
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [zoomedImage, setZoomedImage] = useState(null)
  const [canOrder, setCanOrder] = useState(false)
  const [orderedItems, setOrderedItems] = useState([])
  const [phase, setPhase] = useState('welcome')
  const navigate = useNavigate()

  // Welcome animation
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('logo'), 2000)
    const t2 = setTimeout(() => setPhase('menu'), 4000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    if (!tableId) return
    fetchData()
  }, [tableId])

  // Poll every 8 seconds to check if table was cleared
  useEffect(() => {
    if (!tableId) return
    const interval = setInterval(async () => {
      const { data: activeOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('table_id', tableId)

      if (!activeOrders || activeOrders.length === 0) {
        const mySessionId = localStorage.getItem(`session_${tableId}`)
        if (mySessionId) {
          await supabase
            .from('table_sessions')
            .delete()
            .eq('session_id', mySessionId)
          localStorage.removeItem(`session_${tableId}`)
          localStorage.removeItem(`orders_${tableId}`)
        }
        setOrderedItems([])
        setCart([])
        await checkOrderEligibility()
      }
    }, 8000)
    return () => clearInterval(interval)
  }, [tableId])

  const checkOrderEligibility = async () => {
    const { data: sessions } = await supabase
      .from('table_sessions')
      .select('*')
      .eq('table_id', tableId)

    const mySessionId = localStorage.getItem(`session_${tableId}`)

    if (!sessions || sessions.length === 0) {
      // No session — this is the first device
      const newSessionId = `session_${Date.now()}_${Math.random()}`
      localStorage.setItem(`session_${tableId}`, newSessionId)
      await supabase.from('table_sessions').insert({
        table_id: tableId,
        session_id: newSessionId
      })
      setCanOrder(true)
    } else if (mySessionId && sessions.some(s => s.session_id === mySessionId)) {
      // This device owns the session
      setCanOrder(true)
    } else {
      // Another device has session — view only
      setCanOrder(false)
    }
  }

  const fetchData = async () => {
    const { data: tableData } = await supabase
      .from('tables').select('*').eq('id', tableId).single()
    if (tableData) setTableName(tableData.table_name)

    const { data: activeOrders } = await supabase
      .from('orders').select('id').eq('table_id', tableId)

    const hasActiveOrders = activeOrders && activeOrders.length > 0

    if (!hasActiveOrders) {
      const mySessionId = localStorage.getItem(`session_${tableId}`)
      if (mySessionId) {
        await supabase.from('table_sessions').delete().eq('session_id', mySessionId)
        localStorage.removeItem(`session_${tableId}`)
      }
      localStorage.removeItem(`orders_${tableId}`)
      setOrderedItems([])
    } else {
      const stored = localStorage.getItem(`orders_${tableId}`)
      if (stored) setOrderedItems(JSON.parse(stored))
    }

    await checkOrderEligibility()

    const { data: cats } = await supabase
      .from('categories').select('*').order('created_at')
    setCategories(cats || [])

    const { data: items } = await supabase
      .from('food_items').select('*, categories(name)')
      .eq('is_available', true).order('created_at')
    setFoodItems(items || [])

    setLoading(false)
  }

  const saveOrderHistory = (items) => {
    const key = `orders_${tableId}`
    const existing = JSON.parse(localStorage.getItem(key) || '[]')
    const merged = [...existing, ...items]
    localStorage.setItem(key, JSON.stringify(merged))
    setOrderedItems(merged)
  }

  const handleSearch = (query) => {
    setSearchQuery(query)
    if (query.trim().length < 2) { setSuggestions([]); return }
    const filtered = foodItems.filter(item =>
      item.name.toLowerCase().includes(query.toLowerCase())
    )
    setSuggestions(filtered.slice(0, 5))
  }

  const addToCart = (item) => {
    if (!canOrder) return
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id)
      if (existing) return prev.map((c) => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
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

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)

  const filteredItems = searchQuery.trim()
    ? foodItems.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : activeCategory === 'all'
      ? foodItems
      : foodItems.filter((item) => item.category_id === activeCategory)

  const placeOrder = async () => {
    if (cart.length === 0) { alert('Add items to cart first!'); return }
    if (!tableId) { alert('Invalid table!'); return }
    setPlacing(true)

    const { data: order, error } = await supabase
      .from('orders')
      .insert({ table_id: tableId, status: 'pending' })
      .select().single()

    if (error) { alert('Error: ' + error.message); setPlacing(false); return }

    const orderItems = cart.map((item) => ({
      order_id: order.id,
      food_item_id: item.id,
      quantity: item.quantity,
      price_at_order: item.price,
    }))

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems)
    if (itemsError) { alert('Error: ' + itemsError.message); setPlacing(false); return }

    saveOrderHistory(cart.map(i => ({ name: i.name, quantity: i.quantity })))
    setCart([])
    setShowCart(false)
    setPlacing(false)
    navigate(`/order-confirmation?table=${tableId}&name=${tableName}`)
  }

  // Welcome Screen
  if (phase === 'welcome') {
    return (
      <div className="min-h-screen bg-orange-500 flex items-center justify-center">
        <div className="text-center animate-pulse">
          <div className="text-6xl mb-4">👋</div>
          <h1 className="text-3xl font-bold text-white">Welcome!</h1>
          <p className="text-orange-100 mt-2 text-lg">Please wait a moment...</p>
        </div>
      </div>
    )
  }

  // Logo Screen
  if (phase === 'logo') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-8xl mb-4">🍽️</div>
          <h1 className="text-4xl font-bold text-orange-500">QR Menu</h1>
          <p className="text-gray-400 mt-2">Loading your experience...</p>
        </div>
      </div>
    )
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

      {/* Zoom Image Modal */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-50 bg-black bg-opacity-80 flex items-center justify-center p-4"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-lg w-full">
            <img
              src={zoomedImage}
              alt="Food"
              className="w-full rounded-2xl object-contain max-h-96"
            />
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-2 right-2 bg-white text-gray-700 rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg"
            >×</button>
            <p className="text-white text-center text-xs mt-2 opacity-60">Tap anywhere to close</p>
          </div>
        </div>
      )}

      {/* View Only Banner */}
      {!canOrder && (
        <div className="bg-yellow-400 text-yellow-900 text-center text-sm py-3 font-medium px-4">
          👀 View only mode — Ask your group member to place the order
        </div>
      )}

      {/* Header */}
      <div className="bg-white shadow px-4 py-4 sticky top-0 z-10">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h1 className="text-xl font-bold text-orange-500">🍽️ Our Menu</h1>
            <p className="text-sm text-gray-400">{tableName}</p>
          </div>
          {canOrder && totalItems > 0 && (
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

        {/* Search Bar */}
        <div className="relative mb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="🔍 Search food items..."
            className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50"
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg z-20 mt-1">
              {suggestions.map((item) => (
                <div
                  key={item.id}
                  onClick={() => { setSearchQuery(item.name); setSuggestions([]) }}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-orange-50 cursor-pointer flex items-center gap-2"
                >
                  <span>🍴</span> {item.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category Tabs */}
        {!searchQuery && (
          <div className="flex gap-2 overflow-x-auto pb-1">
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
        )}
      </div>

      {/* Previously Ordered */}
      {orderedItems.length > 0 && (
        <div className="mx-4 mt-4 bg-green-50 border border-green-200 rounded-2xl p-4">
          <p className="text-green-700 font-semibold text-sm mb-2">✅ Your Previous Orders</p>
          <div className="space-y-1">
            {orderedItems.map((item, i) => (
              <p key={i} className="text-green-600 text-xs">• {item.name} x{item.quantity}</p>
            ))}
          </div>
        </div>
      )}

      {/* Food Items */}
      <div className="p-4 space-y-3">
        {filteredItems.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">🍴</div>
            <p>No items found</p>
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
                  onClick={() => setZoomedImage(item.image_url)}
                  className="w-20 h-20 rounded-xl object-cover flex-shrink-0 cursor-pointer hover:opacity-90 active:scale-95 transition"
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

                {canOrder ? (
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
                        >−</button>
                        <span className="font-semibold text-gray-700">{qty}</span>
                        <button
                          onClick={() => updateQuantity(item.id, qty + 1)}
                          className="w-7 h-7 bg-orange-500 text-white rounded-full font-bold text-lg flex items-center justify-center"
                        >+</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-300 mt-2 italic">View only</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Cart Drawer */}
      {showCart && canOrder && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black bg-opacity-40">
          <div className="bg-white rounded-t-3xl p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">🛒 Your Order</h2>
              <button onClick={() => setShowCart(false)} className="text-gray-400 text-2xl font-bold">×</button>
            </div>

            {cart.length === 0 && (
              <p className="text-gray-400 text-center py-8">Cart is empty!</p>
            )}

            <div className="space-y-3 mb-4">
              {cart.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-b pb-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-700">{item.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full font-bold flex items-center justify-center"
                    >−</button>
                    <span className="font-semibold w-4 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-7 h-7 bg-orange-500 text-white rounded-full font-bold flex items-center justify-center"
                    >+</button>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-red-400 text-sm ml-2"
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>

            {cart.length > 0 && (
              <button
                onClick={placeOrder}
                disabled={placing}
                className="w-full bg-orange-500 text-white py-4 rounded-2xl font-bold text-lg hover:bg-orange-600 transition disabled:opacity-50"
              >
                {placing ? 'Placing Order...' : '🍽️ Place Order'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sticky Bottom Bar */}
      {totalItems > 0 && !showCart && canOrder && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg">
          <button
            onClick={() => setShowCart(true)}
            className="w-full bg-orange-500 text-white py-4 rounded-2xl font-bold text-lg flex justify-between items-center px-6"
          >
            <span>🛒 {totalItems} items selected</span>
            <span>View Cart →</span>
          </button>
        </div>
      )}
    </div>
  )
}