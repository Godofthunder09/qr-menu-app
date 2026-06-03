import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

// ── Helpers ─────────────────────────────────────────────
const ADMIN_PASSWORD = 'KHALASI@999' // Change this password

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})
const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})
const toISOLocal = (dateStr, timeStr) => {
  // dateStr: YYYY-MM-DD, timeStr: HH:MM
  return new Date(`${dateStr}T${timeStr}:00+05:30`).toISOString()
}
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const toRange = (from, to) => ({
  startISO: new Date(from + 'T00:00:00+05:30').toISOString(),
  endISO: new Date(to + 'T23:59:59+05:30').toISOString(),
})
const localDate = (isoStr) => new Date(isoStr).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const localTime = (isoStr) => {
  const d = new Date(isoStr)
  const h = String(d.getHours()).padStart(2, '0') // using local is fine for input
  const m = String(d.getMinutes()).padStart(2, '0')
  // Actually we want IST hours
  const ist = new Date(isoStr).toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
  return ist.replace(',', '').trim()
}

// ── Password Gate ────────────────────────────────────────
function PasswordGate({ onUnlock }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)

  const attempt = () => {
    if (pw === ADMIN_PASSWORD) {
      onUnlock()
    } else {
      setError(true)
      setShake(true)
      setTimeout(() => setShake(false), 600)
      setPw('')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className={`bg-gray-900 border border-gray-700 rounded-3xl p-10 w-full max-w-sm shadow-2xl text-center ${shake ? 'animate-bounce' : ''}`}>
        <div className="text-5xl mb-4">🔐</div>
        <h1 className="text-2xl font-black text-white mb-1 tracking-tight">Admin Code</h1>
        <p className="text-gray-400 text-sm mb-8">Enter your admin password to continue</p>
        <input
          type="password"
          value={pw}
          onChange={e => { setPw(e.target.value); setError(false) }}
          onKeyDown={e => e.key === 'Enter' && attempt()}
          placeholder="Password"
          className={`w-full bg-gray-800 text-white text-center text-lg font-mono rounded-xl px-4 py-3 mb-3 border-2 outline-none tracking-widest
            ${error ? 'border-red-500 bg-red-950' : 'border-gray-600 focus:border-orange-500'}`}
        />
        {error && <p className="text-red-400 text-xs mb-3">❌ Wrong password</p>}
        <button
          onClick={attempt}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black py-3 rounded-xl transition text-sm tracking-wide"
        >
          UNLOCK →
        </button>
        <p className="text-gray-600 text-xs mt-6">Unauthorized access is logged.</p>
      </div>
    </div>
  )
}

// ── Main AdminCode Component ─────────────────────────────
export default function AdminCode() {
  const navigate = useNavigate()
  const [unlocked, setUnlocked] = useState(false)

  // Filters
  const [filterFrom, setFilterFrom] = useState(todayIST())
  const [filterTo, setFilterTo] = useState(todayIST())
  const [filterTable, setFilterTable] = useState('')
  const [filterPayment, setFilterPayment] = useState('all')

  // Data
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(false)
  const [allFoodItems, setAllFoodItems] = useState([])

  // Selected bill for editing
  const [editingBill, setEditingBill] = useState(null)
  const [saving, setSaving] = useState(false)

  // Edit fields
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editTable, setEditTable] = useState('')
  const [editPayment, setEditPayment] = useState('cash')
  const [editSettlement, setEditSettlement] = useState('settled')
  const [editItems, setEditItems] = useState([]) // { id?, name, price, qty, isOpen, dept, _key }
  const [editServicePct, setEditServicePct] = useState(0)
  const [editDiscType, setEditDiscType] = useState('percent')
  const [editDiscValue, setEditDiscValue] = useState('')
  const [editDiscReason, setEditDiscReason] = useState('')
  const [menuSearch, setMenuSearch] = useState('')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showAddOpen, setShowAddOpen] = useState(false)
  const [openName, setOpenName] = useState('')
  const [openPrice, setOpenPrice] = useState('')
  const [openQty, setOpenQty] = useState(1)
  const [openDept, setOpenDept] = useState('Food')

  // Computed totals
  const computeTotals = () => {
    const subtotal = editItems.reduce((s, i) => s + i.price * i.qty, 0)
    const svcAmt = Math.round(subtotal * (parseFloat(editServicePct) || 0) / 100)
    const afterSvc = subtotal + svcAmt
    const dv = parseFloat(editDiscValue) || 0
    const discAmt = editDiscType === 'percent'
      ? Math.round(afterSvc * dv / 100)
      : Math.min(dv, afterSvc)
    const finalAmount = afterSvc - discAmt
    return { subtotal, svcAmt, discAmt, finalAmount }
  }

  const totals = computeTotals()

  useEffect(() => {
    if (unlocked) {
      fetchBills()
      supabase.from('food_items').select('id, name, price, is_available')
        .eq('is_available', true).order('name')
        .then(({ data }) => setAllFoodItems(data || []))
    }
  }, [unlocked])

  const fetchBills = async () => {
    setLoading(true)
    const { startISO, endISO } = toRange(filterFrom, filterTo)
    const { data: orders } = await supabase
      .from('orders')
      .select(`id, payment_type, is_paid, paid_at, settlement_status,
        subtotal, service_charge_pct, service_charge_amt,
        discount_type, discount_value, discount_amt, discount_reason,
        final_amount, table_name_snapshot, open_items_json, created_at,
        order_items(id, quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true)
      .gte('paid_at', startISO)
      .lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    // Group by table+minute
    const map = {}
    orders?.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) {
        map[key] = {
          _key: key,
          _orderIds: [o.id],
          _rawOrders: [o],
          payment_type: o.payment_type,
          settlement_status: o.settlement_status,
          paid_at: o.paid_at,
          created_at: o.created_at,
          table_name_snapshot: o.table_name_snapshot,
          subtotal: o.subtotal || 0,
          service_charge_pct: o.service_charge_pct || 0,
          service_charge_amt: o.service_charge_amt || 0,
          discount_type: o.discount_type || 'percent',
          discount_value: o.discount_value || 0,
          discount_amt: o.discount_amt || 0,
          discount_reason: o.discount_reason || '',
          final_amount: o.final_amount || 0,
          order_items: [...(o.order_items || [])],
          open_items: [...(o.open_items_json || [])],
        }
      } else {
        map[key]._orderIds.push(o.id)
        map[key]._rawOrders.push(o)
        map[key].order_items = [...map[key].order_items, ...(o.order_items || [])]
      }
    })

    let result = Object.values(map)
    if (filterTable.trim()) result = result.filter(b => b.table_name_snapshot?.toLowerCase().includes(filterTable.toLowerCase()))
    if (filterPayment !== 'all') result = result.filter(b => b.payment_type === filterPayment)
    setBills(result)
    setLoading(false)
  }

  const openEdit = (bill) => {
    setEditingBill(bill)
    setEditDate(localDate(bill.paid_at))
    // Get IST time string HH:MM
    const istTime = new Date(bill.paid_at).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false
    })
    setEditTime(istTime.replace(',', '').trim())
    setEditTable(bill.table_name_snapshot || '')
    setEditPayment(bill.payment_type || 'cash')
    setEditSettlement(bill.settlement_status || 'settled')
    setEditServicePct(bill.service_charge_pct || 0)
    setEditDiscType(bill.discount_type || 'percent')
    setEditDiscValue(bill.discount_value?.toString() || '')
    setEditDiscReason(bill.discount_reason || '')
    // Build edit items from order_items + open_items
    const items = []
    bill.order_items?.forEach((oi, idx) => {
      items.push({
        _key: `order:${idx}`,
        _orderItemId: oi.id,
        name: oi.food_items?.name || 'Unknown',
        price: oi.price_at_order,
        qty: oi.quantity,
        isOpen: false,
        dept: 'Kitchen',
      })
    })
    bill.open_items?.forEach((oi, idx) => {
      items.push({
        _key: `open:${idx}`,
        name: oi.name,
        price: oi.price,
        qty: oi.qty,
        isOpen: true,
        dept: oi.dept || 'Food',
      })
    })
    setEditItems(items)
    setMenuSearch('')
    setShowAddMenu(false)
    setShowAddOpen(false)
    setOpenName(''); setOpenPrice(''); setOpenQty(1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const closeEdit = () => {
    setEditingBill(null)
    setEditItems([])
  }

  const updateItemField = (key, field, val) => {
    setEditItems(prev => prev.map(i => i._key === key ? { ...i, [field]: val } : i))
  }

  const removeItem = (key) => {
    setEditItems(prev => prev.filter(i => i._key !== key))
  }

  const addMenuItemToEdit = (fi) => {
    const existing = editItems.find(i => i.name === fi.name && !i.isOpen)
    if (existing) {
      setEditItems(prev => prev.map(i => i._key === existing._key ? { ...i, qty: i.qty + 1 } : i))
    } else {
      setEditItems(prev => [...prev, {
        _key: `new:${Date.now()}`,
        name: fi.name,
        price: fi.price,
        qty: 1,
        isOpen: false,
        dept: 'Kitchen',
        _isNew: true,
        _foodItemId: fi.id,
      }])
    }
  }

  const addOpenItemToEdit = () => {
    if (!openName.trim() || !openPrice || parseFloat(openPrice) <= 0) return
    setEditItems(prev => [...prev, {
      _key: `open-new:${Date.now()}`,
      name: openName.trim(),
      price: parseFloat(openPrice),
      qty: openQty,
      isOpen: true,
      dept: openDept,
      _isNew: true,
    }])
    setOpenName(''); setOpenPrice(''); setOpenQty(1); setShowAddOpen(false)
  }

  const handleSave = async () => {
    if (!editingBill) return
    setSaving(true)
    try {
      const newPaidAt = toISOLocal(editDate, editTime)
      const { subtotal, svcAmt, discAmt, finalAmount } = computeTotals()
      const dv = parseFloat(editDiscValue) || 0

      // Split items
      const openItems = editItems.filter(i => i.isOpen).map(i => ({
        name: i.name, price: i.price, qty: i.qty, dept: i.dept, total: i.price * i.qty
      }))

      // Update all orders in this bill group
      for (const orderId of editingBill._orderIds) {
        await supabase.from('orders').update({
          paid_at: newPaidAt,
          table_name_snapshot: editTable,
          payment_type: editPayment,
          settlement_status: editSettlement,
          subtotal,
          service_charge_pct: parseFloat(editServicePct) || 0,
          service_charge_amt: svcAmt,
          discount_type: editDiscType,
          discount_value: dv,
          discount_amt: discAmt,
          discount_reason: editDiscReason.trim(),
          final_amount: finalAmount,
          open_items_json: openItems,
        }).eq('id', orderId)
      }

      // Handle order_items: delete removed, insert new
      // Collect IDs of kept order_items
      const keptIds = editItems
        .filter(i => !i.isOpen && i._orderItemId)
        .map(i => i._orderItemId)

      // Get all original order_item IDs
      const originalIds = editingBill.order_items
        .filter(oi => oi.id)
        .map(oi => oi.id)

      // Delete removed items
      const toDelete = originalIds.filter(id => !keptIds.includes(id))
      if (toDelete.length > 0) {
        await supabase.from('order_items').delete().in('id', toDelete)
      }

      // Update prices/qty for existing items
      for (const item of editItems.filter(i => !i.isOpen && i._orderItemId)) {
        await supabase.from('order_items').update({
          quantity: item.qty,
          price_at_order: item.price,
        }).eq('id', item._orderItemId)
      }

      // Insert new menu items
      const newMenuItems = editItems.filter(i => !i.isOpen && i._isNew && i._foodItemId)
      if (newMenuItems.length > 0) {
        await supabase.from('order_items').insert(newMenuItems.map(i => ({
          order_id: editingBill._orderIds[0],
          food_item_id: i._foodItemId,
          quantity: i.qty,
          price_at_order: i.price,
          note: 'Admin Code edit',
        })))
      }

      alert('✅ Bill updated successfully! Changes will reflect in all Reports.')
      closeEdit()
      fetchBills()
    } catch (err) {
      alert('❌ Error saving: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteBill = async (bill) => {
    if (!window.confirm(`⚠️ PERMANENTLY DELETE this bill for ${bill.table_name_snapshot}?\n\nThis CANNOT be undone!`)) return
    try {
      for (const orderId of bill._orderIds) {
        await supabase.from('order_items').delete().eq('order_id', orderId)
        await supabase.from('orders').delete().eq('id', orderId)
      }
      alert('🗑️ Bill deleted.')
      fetchBills()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />

  const filteredMenu = allFoodItems.filter(f => f.name.toLowerCase().includes(menuSearch.toLowerCase()))

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-xl">🛠️</span>
          <div>
            <h1 className="text-base font-black text-orange-400 tracking-tight">Admin Code</h1>
            <p className="text-xs text-gray-500">Full bill control panel</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/admin/reports')} className="bg-gray-800 text-gray-300 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-700">📊 Reports</button>
          <button onClick={() => navigate('/admin/dashboard')} className="bg-gray-800 text-gray-300 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-700">← Dashboard</button>
          <button onClick={() => setUnlocked(false)} className="bg-red-900 text-red-300 px-3 py-1.5 rounded-lg text-xs hover:bg-red-800">🔒 Lock</button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-6">

        {/* ── EDIT PANEL ── */}
        {editingBill && (
          <div className="bg-gray-900 border border-orange-500 rounded-3xl p-5 mb-6 shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="text-lg font-black text-orange-400">✏️ Editing Bill</h2>
                <p className="text-xs text-gray-400">{editingBill.table_name_snapshot} · Original: {formatDate(editingBill.paid_at)} {toIST(editingBill.paid_at)}</p>
              </div>
              <button onClick={closeEdit} className="bg-gray-800 text-gray-400 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-700">✕ Cancel</button>
            </div>

            {/* ── SECTION 1: Bill Meta ── */}
            <div className="bg-gray-800 rounded-2xl p-4 mb-4">
              <p className="text-xs font-bold text-gray-400 uppercase mb-3">📋 Bill Details of khalasi</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Date</label>
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Time (IST, 24h)</label>
                  <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Table Name</label>
                  <input type="text" value={editTable} onChange={e => setEditTable(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Payment Method</label>
                  <select value={editPayment} onChange={e => setEditPayment(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
                    <option value="cash">💵 Cash</option>
                    <option value="upi">📱 UPI</option>
                    <option value="card">💳 Card</option>
                    <option value="pending">⏳ Pending</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Settlement Status</label>
                  <select value={editSettlement} onChange={e => setEditSettlement(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
                    <option value="settled">✅ Settled</option>
                    <option value="pending">⏳ Pending</option>
                    <option value="day_closed">🌙 Day Closed</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── SECTION 2: Items ── */}
            <div className="bg-gray-800 rounded-2xl p-4 mb-4">
              <p className="text-xs font-bold text-gray-400 uppercase mb-3">🛒 Items ({editItems.length})</p>
              <div className="space-y-2 mb-3">
                {editItems.map(item => (
                  <div key={item._key} className={`flex items-center gap-2 p-3 rounded-xl border ${item.isOpen ? 'bg-purple-950 border-purple-700' : 'bg-gray-700 border-gray-600'}`}>
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => updateItemField(item._key, 'name', e.target.value)}
                        className="w-full bg-transparent text-white text-sm font-medium focus:outline-none border-b border-gray-600 focus:border-orange-500 pb-0.5 mb-1"
                      />
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-gray-400">₹</span>
                        <input
                          type="number"
                          min="0"
                          value={item.price}
                          onChange={e => updateItemField(item._key, 'price', parseFloat(e.target.value) || 0)}
                          className="w-20 bg-gray-600 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                        <span className="text-xs text-gray-400">× qty</span>
                        <input
                          type="number"
                          min="1"
                          value={item.qty}
                          onChange={e => updateItemField(item._key, 'qty', parseInt(e.target.value) || 1)}
                          className="w-14 bg-gray-600 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                        <span className="text-xs text-orange-400 font-bold ml-auto">= ₹{item.price * item.qty}</span>
                        {item.isOpen && (
                          <select value={item.dept} onChange={e => updateItemField(item._key, 'dept', e.target.value)}
                            className="bg-gray-600 text-white text-xs rounded px-1 py-1 focus:outline-none ml-1">
                            <option>Food</option>
                            <option>Beverage</option>
                            <option>Liquor</option>
                          </select>
                        )}
                      </div>
                    </div>
                    <button onClick={() => removeItem(item._key)}
                      className="text-red-400 hover:text-red-300 text-lg px-1 flex-shrink-0">×</button>
                  </div>
                ))}
                {editItems.length === 0 && (
                  <p className="text-center text-gray-500 text-sm py-4">No items. Add some below.</p>
                )}
              </div>

              {/* Add from menu */}
              <button onClick={() => { setShowAddMenu(!showAddMenu); setShowAddOpen(false) }}
                className="mr-2 mb-2 bg-orange-900 text-orange-300 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-800">
                {showAddMenu ? '✕ Close Menu' : '➕ Add Menu Item'}
              </button>
              <button onClick={() => { setShowAddOpen(!showAddOpen); setShowAddMenu(false) }}
                className="mb-2 bg-purple-900 text-purple-300 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-purple-800">
                {showAddOpen ? '✕ Close' : '🆕 Add Open Item'}
              </button>

              {showAddMenu && (
                <div className="bg-gray-700 rounded-xl p-3 mt-2">
                  <input type="text" value={menuSearch} onChange={e => setMenuSearch(e.target.value)}
                    placeholder="🔍 Search menu..."
                    className="w-full bg-gray-600 text-white rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-orange-500" />
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {filteredMenu.map(fi => (
                      <button key={fi.id} onClick={() => addMenuItemToEdit(fi)}
                        className="w-full flex justify-between items-center px-3 py-2 rounded-lg hover:bg-gray-600 text-left">
                        <span className="text-sm text-white">{fi.name}</span>
                        <span className="text-xs text-orange-400 font-bold">₹{fi.price} + Add</span>
                      </button>
                    ))}
                    {filteredMenu.length === 0 && <p className="text-xs text-gray-500 text-center py-2">No results</p>}
                  </div>
                </div>
              )}

              {showAddOpen && (
                <div className="bg-purple-900 border border-purple-700 rounded-xl p-3 mt-2 space-y-2">
                  <div className="flex gap-2">
                    {['Food', 'Beverage', 'Liquor'].map(d => (
                      <button key={d} onClick={() => setOpenDept(d)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border-2 transition ${openDept === d ? 'bg-purple-500 text-white border-transparent' : 'bg-transparent border-purple-700 text-purple-300'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                  <input type="text" value={openName} onChange={e => setOpenName(e.target.value)}
                    placeholder="Item name *"
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
                  <div className="flex gap-2">
                    <input type="number" min="1" value={openPrice} onChange={e => setOpenPrice(e.target.value)}
                      placeholder="Price ₹"
                      className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
                    <input type="number" min="1" value={openQty} onChange={e => setOpenQty(parseInt(e.target.value) || 1)}
                      placeholder="Qty"
                      className="w-20 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
                  </div>
                  <button onClick={addOpenItemToEdit}
                    className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-lg text-sm font-bold">
                    ✅ Add Open Item
                  </button>
                </div>
              )}
            </div>

            {/* ── SECTION 3: Charges ── */}
            <div className="bg-gray-800 rounded-2xl p-4 mb-4">
              <p className="text-xs font-bold text-gray-400 uppercase mb-3">💰 Charges & Discount</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Service Charge %</label>
                  <select value={editServicePct} onChange={e => setEditServicePct(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
                    <option value={0}>0%</option>
                    <option value={5}>5%</option>
                    <option value={10}>10%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Discount Type</label>
                  <select value={editDiscType} onChange={e => setEditDiscType(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
                    <option value="percent">% Percent</option>
                    <option value="flat">₹ Flat</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Discount Value</label>
                  <input type="number" min="0" value={editDiscValue} onChange={e => setEditDiscValue(e.target.value)}
                    placeholder="0"
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Discount Reason</label>
                <input type="text" value={editDiscReason} onChange={e => setEditDiscReason(e.target.value)}
                  placeholder="Reason for discount..."
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
              </div>
            </div>

            {/* ── SECTION 4: Live Totals ── */}
            <div className="bg-gray-800 rounded-2xl p-4 mb-5">
              <p className="text-xs font-bold text-gray-400 uppercase mb-3">🧮 Live Calculated Totals</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-300"><span>Subtotal</span><span>₹{totals.subtotal}</span></div>
                {totals.svcAmt > 0 && <div className="flex justify-between text-gray-300"><span>Service Charge ({editServicePct}%)</span><span>+₹{totals.svcAmt}</span></div>}
                {totals.discAmt > 0 && <div className="flex justify-between text-green-400"><span>Discount</span><span>-₹{totals.discAmt}</span></div>}
                <div className="border-t border-gray-600 pt-2 flex justify-between font-black text-lg">
                  <span className="text-white">Final Amount</span>
                  <span className="text-orange-400">₹{totals.finalAmount}</span>
                </div>
              </div>
            </div>

            {/* ── Save Button ── */}
            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl font-black text-sm tracking-wide disabled:opacity-50 transition">
                {saving ? '⏳ Saving...' : '💾 SAVE ALL CHANGES → Reports Updated'}
              </button>
              <button onClick={closeEdit} className="bg-gray-800 text-gray-400 px-5 rounded-xl text-sm hover:bg-gray-700">Cancel</button>
            </div>
          </div>
        )}

        {/* ── FILTERS ── */}
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 mb-5">
          <p className="text-xs font-bold text-gray-400 uppercase mb-3">🔍 Filter Bills</p>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">From</label>
              <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
                className="bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">To</label>
              <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
                className="bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Table</label>
              <input type="text" value={filterTable} onChange={e => setFilterTable(e.target.value)}
                placeholder="Any table"
                className="bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 w-32" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Payment</label>
              <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}
                className="bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <button onClick={fetchBills}
              className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg text-sm font-bold transition">
              Load Bills
            </button>
          </div>
        </div>

        {/* ── BILLS LIST ── */}
        {loading && <div className="text-center py-12 text-gray-500">Loading bills...</div>}
        {!loading && bills.length === 0 && (
          <div className="text-center py-16 text-gray-600">
            <div className="text-5xl mb-3">📭</div>
            <p>No bills found for this filter. Try different dates.</p>
          </div>
        )}
        {!loading && bills.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">{bills.length} bill(s) found</p>
            {bills.map(bill => (
              <div key={bill._key} className={`bg-gray-900 border rounded-2xl p-4 transition
                ${editingBill?._key === bill._key ? 'border-orange-500 shadow-orange-900 shadow-lg' : 'border-gray-700 hover:border-gray-500'}`}>
                <div className="flex justify-between items-start flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-black text-white text-base">{bill.table_name_snapshot}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold
                        ${bill.payment_type === 'cash' ? 'bg-green-900 text-green-300'
                          : bill.payment_type === 'upi' ? 'bg-blue-900 text-blue-300'
                          : bill.payment_type === 'card' ? 'bg-purple-900 text-purple-300'
                          : 'bg-yellow-900 text-yellow-300'}`}>
                        {bill.payment_type}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full
                        ${bill.settlement_status === 'settled' || bill.settlement_status === 'day_closed'
                          ? 'bg-green-900 text-green-400'
                          : 'bg-yellow-900 text-yellow-400'}`}>
                        {bill.settlement_status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{formatDate(bill.paid_at)} · {toIST(bill.paid_at)}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {bill.order_items?.length || 0} menu item(s) · {bill.open_items?.length || 0} open item(s)
                    </p>
                    {bill.discount_amt > 0 && (
                      <p className="text-xs text-green-400 mt-0.5">Disc: -₹{bill.discount_amt} · {bill.discount_reason || 'no reason'}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-orange-400">₹{bill.final_amount}</p>
                    <p className="text-xs text-gray-500">subtotal ₹{bill.subtotal}</p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => openEdit(bill)}
                        className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition">
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDeleteBill(bill)}
                        className="bg-red-900 hover:bg-red-800 text-red-300 px-3 py-2 rounded-xl text-xs font-bold transition">
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
                {/* Item preview */}
                <div className="mt-3 pt-3 border-t border-gray-800 flex flex-wrap gap-1.5">
                  {bill.order_items?.slice(0, 5).map((oi, i) => (
                    <span key={i} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">
                      {oi.food_items?.name} ×{oi.quantity}
                    </span>
                  ))}
                  {bill.open_items?.slice(0, 3).map((oi, i) => (
                    <span key={`oi-${i}`} className="text-xs bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full">
                      {oi.name} ×{oi.qty}
                    </span>
                  ))}
                  {(bill.order_items?.length || 0) > 5 && (
                    <span className="text-xs text-gray-500">+{bill.order_items.length - 5} more</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

//Yash
