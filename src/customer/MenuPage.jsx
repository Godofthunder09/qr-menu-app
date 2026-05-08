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
  const [phase, setPhase] = useState('welcome')
  const [pinPhase, setPinPhase] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinVerified, setPinVerified] = useState(false)
  const [tableVersion, setTableVersion] = useState(null)
  const [noteItem, setNoteItem] = useState(null)
  const [noteText, setNoteText] = useState('')
  const navigate = useNavigate()

  const SESSION_KEY = `pin_session_${tableId}`

  // Welcome animation
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('logo'), 2000)
    const t2 = setTimeout(() => {
      setPhase('ready')
    }, 4000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    if (phase === 'ready' && tableId) init()
  }, [phase, tableId])

  // Poll every 5s to detect session clear
  useEffect(() => {
    if (!tableId || !pinVerified) return
    const t = setInterval(checkSessionValid, 5000)
    return () => clearInterval(t)
  }, [tableId, pinVerified])

  const init = async () => {
    setLoading(true)

    const { data: tbl } = await supabase
      .from('tables').select('*').eq('id', tableId).single()

    if (!tbl) {
      setLoading(false)
      setPinPhase(true)
      return
    }

    setTableName(tbl.table_name)
    setTableVersion(tbl.session_version)

    // Check if this device has a valid session
    const saved = localStorage.getItem(SESSION_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.version === tbl.session_version) {
        setPinVerified(true)
        setPinPhase(false)
      } else {
        localStorage.removeItem(SESSION_KEY)
        setPinVerified(false)
        setPinPhase(true)
      }
    } else {
      setPinPhase(true)
    }

    // ✅ FIX 1: Only fetch top-level categories (exclude subcategories)
    const { data: cats } = await supabase
      .from('categories')
      .select('*')
      .eq('is_subcategory', false)
      .order('created_at')
    setCategories(cats || [])

    // ✅ FIX 2: Use explicit FK hints to match MenuManager's insert structure
    const { data: items } = await supabase
      .from('food_items')
      .select('*, categories!food_items_category_id_fkey(name), subcategory:categories!food_items_subcategory_id_fkey(name)')
      .eq('is_available', true)
      .order('created_at')
    setFoodItems(items || [])

    setLoading(false)
  }

  const checkSessionValid = async () => {
    const { data: tbl } = await supabase
      .from('tables').select('session_version').eq('id', tableId).single()
    if (!tbl) return

    const saved = localStorage.getItem(SESSION_KEY)
    if (!saved) {
      setPinVerified(false)
      setPinPhase(true)
      return
    }

    const parsed = JSON.parse(saved)
    if (parsed.version !== tbl.session_version) {
      localStorage.removeItem(SESSION_KEY)
      setCart([])
      setPinVerified(false)
      setPinInput('')
      setPinError('')
      setPinPhase(true)
    }
  }

  const verifyPin = async () => {
    if (pinInput.length !== 4) {
      setPinError('Please enter 4 digit PIN')
      return
    }

    const { data: tbl } = await supabase
      .from('tables').select('*').eq('id', tableId).single()

    if (!tbl) {
      setPinError('Table not found. Please scan again.')
      return
    }

    if (pinInput === tbl.pin) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        version: tbl.session_version,
        tableId,
        enteredAt: new Date().toISOString()
      }))
      setTableVersion(tbl.session_version)
      setPinVerified(true)
      setPinPhase(false)
      setPinError('')
    } else {
      setPinError('Wrong PIN. Please ask your waiter.')
      setPinInput('')
    }
  }

  const handleSearch = (q) => {
    setSearchQuery(q)
    if (q.trim().length < 2) { setSuggestions([]); return }
    setSuggestions(
      foodItems.filter(i =>
        i.name.toLowerCase().includes(q.toLowerCase())
      ).slice(0, 5)
    )
  }

  const addToCart = (item, note = '') => {
    setCart(prev => {
      const ex = prev.find(c => c.id === item.id)
      if (ex) return prev.map(c =>
        c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { ...item, quantity: 1, note }]
    })
  }

  const removeFromCart = (id) =>
    setCart(prev => prev.filter(c => c.id !== id))

  const updateQty = (id, qty) => {
    if (qty < 1) { removeFromCart(id); return }
    setCart(prev => prev.map(c => c.id === id ? { ...c, quantity: qty } : c))
  }

  const updateNote = (id, note) =>
    setCart(prev => prev.map(c => c.id === id ? { ...c, note } : c))

  const getQty = (id) => cart.find(c => c.id === id)?.quantity || 0
  const totalItems = cart.reduce((s, i) => s + i.quantity, 0)

  const filtered = searchQuery.trim()
    ? foodItems.filter(i =>
        i.name.toLowerCase().includes(searchQuery.toLowerCase()))
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
        note: i.note || ''
      }))
    )

    if (e2) { alert('Error: ' + e2.message); setPlacing(false); return }

    setCart([])
    setShowCart(false)
    setPlacing(false)
    navigate(`/order-confirmation?table=${tableId}&name=${tableName}`)
  }

  // ── Screens ──────────────────────────────────────────────

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
        <p className="text-gray-400">Loading...</p>
      </div>
    </div>
  )

  // ── PIN Entry Screen ─────────────────────────────────────
  if (pinPhase && !pinVerified) return (
    <div className="min-h-screen bg-orange-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">🔐</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Enter Table PIN</h1>
        <p className="text-gray-400 text-sm mb-6">
          Ask your waiter for the 4-digit PIN for <span className="font-semibold text-orange-500">{tableName}</span>
        </p>

        {/* PIN Input Boxes */}
        <div className="flex justify-center gap-3 mb-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i}
              className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold
                ${pinInput.length > i
                  ? 'border-orange-500 bg-orange-50 text-orange-600'
                  : 'border-gray-200 bg-gray-50 text-gray-300'}`}>
              {pinInput[i] ? '●' : '○'}
            </div>
          ))}
        </div>

        {pinError && (
          <p className="text-red-500 text-sm mb-4 font-medium">{pinError}</p>
        )}

        {/* Number Pad */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n}
              onClick={() => {
                if (pinInput.length < 4) setPinInput(prev => prev + n)
              }}
              className="bg-gray-100 hover:bg-orange-100 text-gray-800 font-bold text-xl py-4 rounded-xl transition">
              {n}
            </button>
          ))}
          <button
            onClick={() => setPinInput(prev => prev.slice(0, -1))}
            className="bg-gray-100 hover:bg-red-100 text-gray-600 font-bold py-4 rounded-xl transition text-sm">
            ⌫
          </button>
          <button
            onClick={() => {
              if (pinInput.length < 4) setPinInput(prev => prev + '0')
            }}
            className="bg-gray-100 hover:bg-orange-100 text-gray-800 font-bold text-xl py-4 rounded-xl transition">
            0
          </button>
          <button
            onClick={verifyPin}
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition text-sm">
            ✓ OK
          </button>
        </div>

        <p className="text-xs text-gray-300">
          🍽️ QR Menu System
        </p>
      </div>
    </div>
  )

  // ── Main Menu UI ─────────────────────────────────────────
  return (
    <div className="min-h-screen bg-orange-50 pb-32">

      {/* Zoom Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-80 flex items-center justify-center p-4"
          onClick={() => setZoomedImage(null)}>
          <div className="relative max-w-lg w-full">
            <img src={zoomedImage} alt="zoom"
              className="w-full rounded-2xl object-contain max-h-96" />
            <button onClick={() => setZoomedImage(null)}
              className="absolute top-2 right-2 bg-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg">×</button>
            <p className="text-white text-center text-xs mt-2 opacity-60">Tap to close</p>
          </div>
        </div>
      )}

      {/* Customization Modal */}
      {noteItem && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-gray-800 mb-1">📝 Customize Order</h3>
            <p className="text-sm text-orange-500 font-medium mb-3">{noteItem.name}</p>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="e.g. Less spicy, no onion, extra sauce..."
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => { setNoteItem(null); setNoteText('') }}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-xl font-medium text-sm">
                Cancel
              </button>
              <button onClick={() => {
                const inCart = cart.find(c => c.id === noteItem.id)
                if (inCart) updateNote(noteItem.id, noteText)
                else addToCart(noteItem, noteText)
                setNoteItem(null)
                setNoteText('')
              }}
                className="flex-1 bg-orange-500 text-white py-2 rounded-xl font-medium text-sm">
                {cart.find(c => c.id === noteItem.id) ? 'Update Note' : 'Add to Cart'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white shadow px-4 py-4 sticky top-0 z-10">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h1 className="text-xl font-bold text-orange-500">🍽️ Our Menu</h1>
            <p className="text-sm text-gray-400">{tableName}</p>
          </div>
          {totalItems > 0 && (
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
          const cartItem = cart.find(c => c.id === item.id)
          return (
            <div key={item.id} className="bg-white rounded-2xl shadow p-4 flex gap-3">
              {item.image_url
                ? <img src={item.image_url} alt={item.name}
                    onClick={() => setZoomedImage(item.image_url)}
                    className="w-20 h-20 rounded-xl object-cover flex-shrink-0 cursor-pointer hover:opacity-90 transition" />
                : <div className="w-20 h-20 bg-orange-100 rounded-xl flex items-center justify-center text-3xl flex-shrink-0">🍴</div>
              }
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800">{item.name}</h3>
                {item.description && (
                  <p className="text-xs text-gray-400 mt-1">{item.description}</p>
                )}
                <p className="text-orange-500 font-bold mt-1">₹{item.price}</p>

                {cartItem?.note && (
                  <p className="text-xs text-orange-400 italic mt-1">📝 "{cartItem.note}"</p>
                )}

                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {qty === 0 ? (
                    <>
                      <button onClick={() => addToCart(item)}
                        className="bg-orange-500 text-white px-4 py-1 rounded-full text-sm font-medium hover:bg-orange-600">
                        + Add
                      </button>
                      <button onClick={() => { setNoteItem(item); setNoteText('') }}
                        className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-xs font-medium">
                        📝 Customize
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQty(item.id, qty - 1)}
                          className="w-7 h-7 bg-orange-100 text-orange-600 rounded-full font-bold flex items-center justify-center">−</button>
                        <span className="font-semibold">{qty}</span>
                        <button onClick={() => updateQty(item.id, qty + 1)}
                          className="w-7 h-7 bg-orange-500 text-white rounded-full font-bold flex items-center justify-center">+</button>
                      </div>
                      <button onClick={() => { setNoteItem(item); setNoteText(cartItem?.note || '') }}
                        className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-xs font-medium">
                        📝 {cartItem?.note ? 'Edit Note' : 'Add Note'}
                      </button>
                    </>
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
          <div className="bg-white rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
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
                      {item.note && (
                        <p className="text-xs text-orange-500 italic mt-0.5">📝 "{item.note}"</p>
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
                  <button onClick={() => {
                    setNoteItem(item)
                    setNoteText(item.note || '')
                    setShowCart(false)
                  }}
                    className="mt-1 text-xs text-orange-400 underline">
                    {item.note ? '✏️ Edit customization' : '📝 Add customization'}
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
      {totalItems > 0 && !showCart && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg">
          <button onClick={() => setShowCart(true)}
            className="w-full bg-orange-500 text-white py-4 rounded-2xl flex justify-between px-6 font-bold text-lg">
            <span>🛒 {totalItems} items</span>
            <span>View Cart →</span>
          </button>
        </div>
      )}
    </div>
  )
}