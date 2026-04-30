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
  const [showCustomize, setShowCustomize] = useState(false)
  const [customNote, setCustomNote] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [itemNotes, setItemNotes] = useState({})
  const navigate = useNavigate()

  const KEY_VERSION = `v_${tableId}`
  const KEY_SESSION = `s_${tableId}`
  const KEY_ORDERS  = `o_${tableId}`

  const getVersion = () => parseInt(localStorage.getItem(KEY_VERSION) || '0')
  const getSession = () => localStorage.getItem(KEY_SESSION)

  const wipeAll = () => {
    localStorage.removeItem(KEY_VERSION)
    localStorage.removeItem(KEY_SESSION)
    localStorage.removeItem(KEY_ORDERS)
    setOrderedItems([])
    setCart([])
    setCanOrder(false)
  }

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('logo'), 2000)
    const t2 = setTimeout(() => setPhase('menu'), 4000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    if (!tableId || phase !== 'menu') return
    init()
  }, [tableId, phase])

  useEffect(() => {
    if (!tableId) return
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [tableId])

  const init = async () => {
    setLoading(true)
    const { data: tbl } = await supabase
      .from('tables').select('*').eq('id', tableId).single()
    if (!tbl) { setLoading(false); return }
    setTableName(tbl.table_name)

    const dbVersion = tbl.session_version || 1
    const myVersion = getVersion()
    if (dbVersion !== myVersion) wipeAll()

    const { data: cats } = await supabase
      .from('categories').select('*').order('created_at')
    setCategories(cats || [])

    const { data: items } = await supabase
      .from('food_items').select('*, categories(name)')
      .eq('is_available', true).order('created_at')
    setFoodItems(items || [])

    await determineSession(dbVersion)
    setLoading(false)
  }

  const determineSession = async (dbVersion) => {
    const { data: sessions } = await supabase
      .from('table_sessions').select('*').eq('table_id', tableId)

    const mySession = getSession()
    const iAmOwner = mySession && sessions?.some(s => s.session_id === mySession)

    if (!sessions || sessions.length === 0) {
      const newSess = `s_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
      const { error } = await supabase.from('table_sessions').insert({
        table_id: tableId, session_id: newSess
      })
      if (!error) {
        localStorage.setItem(KEY_SESSION, newSess)
        localStorage.setItem(KEY_VERSION, dbVersion.toString())
        setCanOrder(true)
        const { data: activeOrders } = await supabase
          .from('orders').select('id').eq('table_id', tableId)
        if (activeOrders && activeOrders.length > 0) {
          const stored = localStorage.getItem(KEY_ORDERS)
          if (stored) setOrderedItems(JSON.parse(stored))
        } else {
          localStorage.removeItem(KEY_ORDERS)
        }
      }
    } else if (iAmOwner) {
      localStorage.setItem(KEY_VERSION, dbVersion.toString())
      setCanOrder(true)
      const { data: activeOrders } = await supabase
        .from('orders').select('id').eq('table_id', tableId)
      if (activeOrders && activeOrders.length > 0) {
        const stored = localStorage.getItem(KEY_ORDERS)
        if (stored) setOrderedItems(JSON.parse(stored))
      } else {
        localStorage.removeItem(KEY_ORDERS)
        setOrderedItems([])
      }
    } else {
      setCanOrder(false)
    }
  }

  const poll = async () => {
    if (!tableId) return
    const { data: tbl } = await supabase
      .from('tables').select('session_version').eq('id', tableId).single()
    if (!tbl) return

    const dbVersion = tbl.session_version || 1
    const myVersion = getVersion()

    if (dbVersion !== myVersion) {
      wipeAll()
      await determineSession(dbVersion)
      return
    }

    const mySession = getSession()
    if (!mySession) return

    const { data: sessions } = await supabase
      .from('table_sessions').select('session_id').eq('table_id', tableId)

    const iAmOwner = sessions?.some(s => s.session_id === mySession)

    if (!iAmOwner && canOrder) {
      localStorage.removeItem(KEY_SESSION)
      setCanOrder(false)
      setOrderedItems([])
      localStorage.removeItem(KEY_ORDERS)
    } else if (!sessions || sessions.length === 0) {
      await determineSession(dbVersion)
    }
  }

  const saveHistory = (items) => {
    const prev = JSON.parse(localStorage.getItem(KEY_ORDERS) || '[]')
    const merged = [...prev, ...items]
    localStorage.setItem(KEY_ORDERS, JSON.stringify(merged))
    setOrderedItems(merged)
  }

  const handleSearch = (q) => {
    setSearchQuery(q)
    if (q.trim().length < 2) { setSuggestions([]); return }
    setSuggestions(foodItems.filter(i =>
      i.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5))
  }

  const addToCart = (item) => {
    if (!canOrder) return
    setCart(prev => {
      const ex = prev.find(c => c.id === item.id)
      if (ex) return prev.map(c => c.id === item.id ? {...c, quantity: c.quantity + 1} : c)
      return [...prev, {...item, quantity: 1}]
    })
  }

  const removeFromCart = (id) => setCart(prev => prev.filter(c => c.id !== id))

  const updateQty = (id, qty) => {
    if (qty < 1) { removeFromCart(id); return }
    setCart(prev => prev.map(c => c.id === id ? {...c, quantity: qty} : c))
  }

  const openCustomize = (item) => {
    setSelectedItem(item)
    setCustomNote(itemNotes[item.id] || '')
    setShowCustomize(true)
  }

  const saveCustomNote = () => {
    if (selectedItem) {
      setItemNotes(prev => ({...prev, [selectedItem.id]: customNote}))
    }
    setShowCustomize(false)
    setCustomNote('')
    setSelectedItem(null)
  }

  const getQty = (id) => cart.find(c => c.id === id)?.quantity || 0
  const totalItems = cart.reduce((s, i) => s + i.quantity, 0)

  const filtered = searchQuery.trim()
    ? foodItems.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : activeCategory === 'all'
      ? foodItems
      : foodItems.filter(i => i.category_id === activeCategory)

  const placeOrder = async () => {
    if (!cart.length) { alert('Add items first!'); return }
    setPlacing(true)

    const { data: order, error } = await supabase
      .from('orders')
      .insert({ table_id: tableId, status: 'pending' })
      .select().single()

    if (error) { alert('Error: ' + error.message); setPlacing(false); return }

    const { error: e2 } = await supabase.from('order_items').insert(
      cart.map(i => ({
        order_id: order.id,
        food_item_id: i.id,
        quantity: i.quantity,
        price_at_order: i.price,
        note: itemNotes[i.id] || null
      }))
    )

    if (e2) { alert('Error: ' + e2.message); setPlacing(false); return }

    saveHistory(cart.map(i => ({
      name: i.name,
      quantity: i.quantity,
      note: itemNotes[i.id] || null
    })))

    setCart([])
    setItemNotes({})
    setShowCart(false)
    setPlacing(false)
    navigate(`/order-confirmation?table=${tableId}&name=${tableName}`)
  }

  if (phase === 'welcome') return (
    <div className="min-h-screen bg-orange-500 flex items-center justify-center">
      <div className="text-center animate-pulse">
        <div className="text-6xl mb-4">👋</div>
        <h1 className="text-3xl font-bold text-white">Welcome!</h1>
        <p className="text-orange-100 mt-2">Please wait a moment...</p>
      </div>
    </div>
  )

  if (phase === 'logo') return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl mb-4">🍽️</div>
        <h1 className="text-4xl font-bold text-orange-500">QR Menu</h1>
        <p className="text-gray-400 mt-2">Loading your experience...</p>
      </div>
    </div>
  )

  if (!tableId) return (
    <div className="min-h-screen bg-orange-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-3">❌</div>
        <p className="text-gray-500">Invalid QR Code.</p>
      </div>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-orange-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-3">🍽️</div>
        <p className="text-gray-400">Loading menu...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-orange-50 pb-32">

      {/* Customize Modal */}
      {showCustomize && selectedItem && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-end justify-center">
          <div className="bg-white rounded-t-3xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-bold text-gray-800 mb-1">
              ✏️ Customize — {selectedItem.name}
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              Add special instructions (e.g. less spicy, no onion, extra sauce)
            </p>
            <textarea
              value={customNote}
              onChange={e => setCustomNote(e.target.value)}
              placeholder="e.g. No onion, extra spicy, less oil..."
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowCustomize(false); setSelectedItem(null) }}
                className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-200">
                Cancel
              </button>
              <button
                onClick={saveCustomNote}
                className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-semibold hover:bg-orange-600">
                Save Note ✅
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoom Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-80 flex items-center justify-center p-4"
          onClick={() => setZoomedImage(null)}>
          <div className="relative max-w-lg w-full">
            <img src={zoomedImage} alt="zoom"
              className="w-full rounded-2xl object-contain max-h-96" />
            <button onClick={() => setZoomedImage(null)}
              className="absolute top-2 right-2 bg-white rounded-full w-8 h-8 flex items-center justify-center font-bold">×</button>
          </div>
        </div>
      )}

      {/* View Only Banner */}
      {!canOrder && (
        <div className="bg-yellow-400 text-yellow-900 text-center text-sm py-3 font-medium px-4">
          👀 View only — Ask your group member to place the order
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
            <button onClick={() => setShowCart(true)}
              className="relative bg-orange-500 text-white px-4 py-2 rounded-full text-sm font-medium">
              🛒 Cart
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {totalItems}
              </span>
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <input type="text" value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            placeholder="🔍 Search food items..."
            className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50" />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 bg-white border rounded-xl shadow-lg z-20 mt-1">
              {suggestions.map(item => (
                <div key={item.id}
                  onClick={() => { setSearchQuery(item.name); setSuggestions([]) }}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-orange-50 cursor-pointer flex gap-2">
                  🍴 {item.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category Tabs */}
        {!searchQuery && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setActiveCategory('all')}
              className={`px-4 py-1 rounded-full text-sm font-medium whitespace-nowrap
                ${activeCategory === 'all' ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
              All
            </button>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                className={`px-4 py-1 rounded-full text-sm font-medium whitespace-nowrap
                  ${activeCategory === cat.id ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Previous Orders */}
      {canOrder && orderedItems.length > 0 && (
        <div className="mx-4 mt-4 bg-green-50 border border-green-200 rounded-2xl p-4">
          <p className="text-green-700 font-semibold text-sm mb-2">✅ Your Orders This Session</p>
          {orderedItems.map((item, i) => (
            <div key={i} className="text-green-600 text-xs">
              • {item.name} ×{item.quantity}
              {item.note && <span className="text-gray-400 italic"> — {item.note}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Food Items */}
      <div className="p-4 space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">🍴</div>
            <p>No items found</p>
          </div>
        )}

        {filtered.map(item => {
          const qty = getQty(item.id)
          const note = itemNotes[item.id]
          return (
            <div key={item.id} className="bg-white rounded-2xl shadow p-4 flex gap-3">
              {item.image_url
                ? <img src={item.image_url} alt={item.name}
                    onClick={() => setZoomedImage(item.image_url)}
                    className="w-20 h-20 rounded-xl object-cover flex-shrink-0 cursor-pointer hover:opacity-90" />
                : <div className="w-20 h-20 bg-orange-100 rounded-xl flex items-center justify-center text-3xl flex-shrink-0">🍴</div>
              }
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800">{item.name}</h3>
                {item.description && (
                  <p className="text-xs text-gray-400 mt-1">{item.description}</p>
                )}
                <p className="text-orange-500 font-bold mt-1">₹{item.price}</p>

                {/* Custom note display */}
                {note && canOrder && (
                  <p className="text-xs text-blue-500 mt-1 italic">📝 {note}</p>
                )}

                {canOrder ? (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {qty === 0
                      ? <button onClick={() => addToCart(item)}
                          className="bg-orange-500 text-white px-4 py-1 rounded-full text-sm font-medium">
                          + Add
                        </button>
                      : <div className="flex items-center gap-2">
                          <button onClick={() => updateQty(item.id, qty - 1)}
                            className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full font-bold flex items-center justify-center">−</button>
                          <span className="font-semibold">{qty}</span>
                          <button onClick={() => updateQty(item.id, qty + 1)}
                            className="w-7 h-7 bg-orange-500 text-white rounded-full font-bold flex items-center justify-center">+</button>
                        </div>
                    }
                    {/* Customize button */}
                    {qty > 0 && (
                      <button onClick={() => openCustomize(item)}
                        className="text-xs text-blue-500 border border-blue-200 px-2 py-1 rounded-full hover:bg-blue-50">
                        ✏️ Customize
                      </button>
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
              <h2 className="text-lg font-bold">🛒 Your Order</h2>
              <button onClick={() => setShowCart(false)}
                className="text-gray-400 text-2xl font-bold">×</button>
            </div>

            <div className="space-y-3 mb-4">
              {cart.map(item => (
                <div key={item.id} className="border-b pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="font-medium text-gray-700">{item.name}</p>
                      {itemNotes[item.id] && (
                        <p className="text-xs text-blue-500 italic mt-0.5">📝 {itemNotes[item.id]}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(item.id, item.quantity - 1)}
                        className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full font-bold flex items-center justify-center">−</button>
                      <span className="font-semibold w-4 text-center">{item.quantity}</span>
                      <button onClick={() => updateQty(item.id, item.quantity + 1)}
                        className="w-7 h-7 bg-orange-500 text-white rounded-full font-bold flex items-center justify-center">+</button>
                      <button onClick={() => removeFromCart(item.id)}
                        className="text-red-400 text-sm ml-1">✕</button>
                    </div>
                  </div>
                  <button onClick={() => openCustomize(item)}
                    className="text-xs text-blue-500 mt-1 underline">
                    ✏️ {itemNotes[item.id] ? 'Edit note' : 'Add special note'}
                  </button>
                </div>
              ))}
            </div>

            {cart.length > 0 && (
              <button onClick={placeOrder} disabled={placing}
                className="w-full bg-orange-500 text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50">
                {placing ? 'Placing...' : '🍽️ Place Order'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom Bar */}
      {totalItems > 0 && !showCart && canOrder && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg">
          <button onClick={() => setShowCart(true)}
            className="w-full bg-orange-500 text-white py-4 rounded-2xl font-bold text-lg flex justify-between px-6">
            <span>🛒 {totalItems} items</span>
            <span>View Cart →</span>
          </button>
        </div>
      )}
    </div>
  )
}