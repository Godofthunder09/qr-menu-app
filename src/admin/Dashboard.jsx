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

const LIQUOR_KEYWORDS = [
  'beer','wine','whisky','whiskey','vodka','rum','gin','tequila','brandy',
  'champagne','cocktail','mocktail','scotch','bourbon','ale','lager','cider',
  'sake','mead','port','liquor','spirits','pint','draft','draught','feni',
  'arrack','toddy','sangria'
]
const isLiquorItem = (name = '') =>
  LIQUOR_KEYWORDS.some(k => name.toLowerCase().includes(k))

const buildHtmlReceipt = (lines) => `
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:monospace;font-size:13px;width:300px;margin:0 auto;padding:10px}
  .center{text-align:center}.bold{font-weight:bold}.big{font-size:16px;font-weight:bold}
  .row{display:flex;justify-content:space-between}.div{border-top:1px dashed #000;margin:4px 0}
  .section-title{font-weight:bold;margin-top:6px}
</style></head><body>
<div class="center big">${lines.restaurantName}</div>
<div class="center">${lines.address}</div>
<div class="center">${lines.phone}</div>
<div class="div"></div>
<div class="row"><span>Table: ${lines.tableName}</span><span>${lines.date}</span></div>
<div>Time: ${lines.time}</div>
<div class="div"></div>
${lines.foodItems.length > 0 ? `
<div class="section-title">FOOD</div>
${lines.foodItems.map(i => `<div class="row"><span>${i.name} x${i.qty}</span><span>Rs.${i.total}</span></div>`).join('')}
<div class="row bold"><span>Food Subtotal</span><span>Rs.${lines.foodSubtotal}</span></div>
<div class="div"></div>` : ''}
${lines.liquorItems.length > 0 ? `
<div class="section-title">LIQUOR</div>
${lines.liquorItems.map(i => `<div class="row"><span>${i.name} x${i.qty}</span><span>Rs.${i.total}</span></div>`).join('')}
<div class="row bold"><span>Liquor Subtotal</span><span>Rs.${lines.liquorSubtotal}</span></div>
<div class="div"></div>` : ''}
<div class="row"><span>Subtotal</span><span>Rs.${lines.subtotal}</span></div>
${lines.serviceChargeAmt > 0 ? `<div class="row"><span>Service Charge (${lines.serviceChargePct}%)</span><span>Rs.${lines.serviceChargeAmt}</span></div>` : ''}
${lines.discountAmt > 0 ? `<div class="row"><span>Discount${lines.discountType === 'percent' ? ` (${lines.discountValue}%)` : ' (Flat)'}</span><span>-Rs.${lines.discountAmt}</span></div>` : ''}
<div class="div"></div>
<div class="row big"><span>TOTAL</span><span>Rs.${lines.finalAmount}</span></div>
<div class="div"></div>
<div class="center">Thank you! Visit again!</div>
</body></html>`

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

  // Bill preview modal
  const [showPreview, setShowPreview] = useState(false)
  const [payTableId, setPayTableId] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [removedItems, setRemovedItems] = useState(new Set())
  const [billPrinted, setBillPrinted] = useState(false)

  // Service charge & discount (set at print time)
  const [serviceChargePct, setServiceChargePct] = useState(0)
  const [discountType, setDiscountType] = useState('percent')
  const [discountValue, setDiscountValue] = useState('')

  const prevOrderIds = useRef(new Set())
  const audioCtxRef = useRef(null)
  const navigate = useNavigate()

  const RESTAURANT = {
    name: 'My Restaurant',
    address: '123, Main Street',
    phone: '+91 98765 43210',
  }

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    setSoundReady(true)
  }

  const playTingTing = useCallback(() => {
    try {
      if (!audioCtxRef.current) return
      const ctx = audioCtxRef.current
      const bell = (t, freq) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g); g.connect(ctx.destination)
        o.type = 'sine'; o.frequency.value = freq
        g.gain.setValueAtTime(0.5, t)
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0)
        o.start(t); o.stop(t + 1.0)
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

  // Get items excluding removed ones
  const getEffectiveItems = useCallback((tableId) => {
    const tOrders = orders.filter(o => o.table_id === tableId)
    const result = []
    tOrders.forEach(order => {
      ;(order.order_items || []).forEach((item, idx) => {
        const key = `${order.id}:${idx}`
        if (!removedItems.has(key)) {
          result.push({ ...item, _orderId: order.id, _idx: idx, _key: key })
        }
      })
    })
    return result
  }, [orders, removedItems])

  const computeTotals = useCallback((tableId) => {
    const items = getEffectiveItems(tableId)
    const foodItems = items.filter(i => !isLiquorItem(i.food_items?.name))
    const liquorItems = items.filter(i => isLiquorItem(i.food_items?.name))
    const foodSubtotal = foodItems.reduce((s, i) => s + i.price_at_order * i.quantity, 0)
    const liquorSubtotal = liquorItems.reduce((s, i) => s + i.price_at_order * i.quantity, 0)
    const subtotal = foodSubtotal + liquorSubtotal

    // Apply service charge then discount
    const serviceChargeAmt = Math.round(subtotal * serviceChargePct / 100)
    const afterService = subtotal + serviceChargeAmt
    const dv = parseFloat(discountValue) || 0
    const discountAmt = discountType === 'percent'
      ? Math.round(afterService * dv / 100)
      : Math.min(dv, afterService)
    const finalAmount = afterService - discountAmt

    return {
      items, foodItems, liquorItems,
      foodSubtotal, liquorSubtotal, subtotal,
      serviceChargeAmt, discountAmt, finalAmount
    }
  }, [getEffectiveItems, serviceChargePct, discountType, discountValue])

  const openPreview = (tableId) => {
    setPayTableId(tableId)
    setEditMode(false)
    setRemovedItems(new Set())
    setBillPrinted(false)
    setServiceChargePct(0)
    setDiscountType('percent')
    setDiscountValue('')
    setShowPreview(true)
  }

  // Print bill and save to today's report (pending settlement)
  const handlePrintAndSave = async () => {
    const tblData = tables.find(t => t.id === payTableId)
    const {
      foodItems, liquorItems,
      foodSubtotal, liquorSubtotal, subtotal,
      serviceChargeAmt, discountAmt, finalAmount
    } = computeTotals(payTableId)
    const now = new Date()
    const dv = parseFloat(discountValue) || 0

    // Print receipt
    const lines = {
      restaurantName: RESTAURANT.name,
      address: RESTAURANT.address,
      phone: RESTAURANT.phone,
      tableName: tblData?.table_name || '',
      date: toISTDate(now.toISOString()),
      time: toIST(now.toISOString()),
      foodItems: foodItems.map(i => ({
        name: i.food_items?.name, qty: i.quantity,
        total: i.price_at_order * i.quantity
      })),
      liquorItems: liquorItems.map(i => ({
        name: i.food_items?.name, qty: i.quantity,
        total: i.price_at_order * i.quantity
      })),
      foodSubtotal, liquorSubtotal, subtotal,
      serviceChargePct, serviceChargeAmt,
      discountType, discountValue: dv, discountAmt,
      finalAmount,
    }

    const w = window.open('', '_blank', 'width=400,height=600')
    w.document.write(buildHtmlReceipt(lines))
    w.document.close()
    w.focus()
    w.print()
    w.close()

    // Save to DB — mark as printed with full computed amounts, pending payment settlement only
    const tOrders = orders.filter(o => o.table_id === payTableId)
    const nowIST = now.toISOString()

    for (const order of tOrders) {
      await supabase.from('orders').update({
        is_paid: true,
        paid_at: nowIST,
        subtotal,
        service_charge_pct: serviceChargePct,
        service_charge_amt: serviceChargeAmt,
        discount_type: discountType,
        discount_value: dv,
        discount_amt: discountAmt,
        final_amount: finalAmount,
        settlement_status: 'pending',
        table_name_snapshot: tblData?.table_name || '',
        payment_type: 'pending'
      }).eq('id', order.id)
    }

    // Clear table
    await nukeClearTable(payTableId)

    setNewOrderIds(prev => {
      const n = new Set(prev)
      tOrders.forEach(o => n.delete(o.id))
      return n
    })

    setBillPrinted(true)
    setShowPreview(false)
    if (selectedTable?.id === payTableId) setSelectedTable(null)
    fetchAll()
  }

  const nukeClearTable = async (tableId) => {
    try {
      const { data: ords } = await supabase
        .from('orders').select('id').eq('table_id', tableId).eq('is_paid', false)
      if (ords && ords.length > 0) {
        await supabase.from('order_items').delete()
          .in('order_id', ords.map(o => o.id))
      }
      await supabase.from('orders').delete()
        .eq('table_id', tableId).eq('is_paid', false)
      await supabase.from('table_sessions').delete().eq('table_id', tableId)
      const { data: tbl } = await supabase
        .from('tables').select('session_version').eq('id', tableId).single()
      await supabase.from('tables').update({
        session_version: (tbl?.session_version || 1) + 1,
        pin: generatePin()
      }).eq('id', tableId)
      return true
    } catch (err) { return false }
  }

  const clearAllTables = async () => {
    setShowClearAllConfirm(false)
    setClearing(true)
    const active = tables.filter(t => orders.some(o => o.table_id === t.id))
    for (const table of active) await nukeClearTable(table.id)
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
  const tableSubtotal = allItems.reduce((s, i) => s + i.price_at_order * i.quantity, 0)
  const activeTables = tables.filter(t => orders.some(o => o.table_id === t.id))
  const selectedTableData = tables.find(t => t.id === selectedTable?.id)
  const currentPin = selectedTableData?.pin || '----'
  const previewTotals = payTableId ? computeTotals(payTableId) : null
  const previewTableName = tables.find(t => t.id === payTableId)?.table_name || ''

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col" onClick={initAudio}>

      {!soundReady && (
        <div className="bg-orange-500 text-white text-center text-xs py-1.5 cursor-pointer font-medium">
          🔔 Tap anywhere to enable order notification sounds
        </div>
      )}

      {/* Bill Preview Modal */}
      {showPreview && previewTotals && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[92vh] flex flex-col">

            {/* Header */}
            <div className="p-5 border-b">
              <div className="text-center">
                <p className="font-bold text-lg text-gray-800">{RESTAURANT.name}</p>
                <p className="text-xs text-gray-400">{RESTAURANT.address}</p>
                <p className="text-xs text-gray-400">{RESTAURANT.phone}</p>
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-3">
                <span>Table: <strong>{previewTableName}</strong></span>
                <span>{toISTDate(new Date().toISOString())} {toIST(new Date().toISOString())}</span>
              </div>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Food */}
              {previewTotals.foodItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase">🍽 Food</span>
                    <div className="flex-1 border-t border-dashed border-gray-200" />
                  </div>
                  {previewTotals.foodItems.map((item, i) => {
                    const key = item._key
                    return (
                      <div key={i} className={`flex justify-between items-center text-sm py-1 px-1 rounded
                        ${editMode && removedItems.has(key) ? 'opacity-30 line-through bg-red-50' : ''}`}>
                        <div className="flex items-center gap-2 flex-1">
                          {editMode && (
                            <button onClick={() => setRemovedItems(prev => {
                              const n = new Set(prev)
                              n.has(key) ? n.delete(key) : n.add(key)
                              return n
                            })}
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold
                                ${removedItems.has(key) ? 'border-green-500 text-green-500' : 'border-red-400 text-red-400'}`}>
                              {removedItems.has(key) ? '+' : '−'}
                            </button>
                          )}
                          <span className="text-gray-700">{item.food_items?.name}</span>
                          <span className="text-gray-400 text-xs">×{item.quantity}</span>
                        </div>
                        <span className="text-gray-700 font-medium">₹{item.price_at_order * item.quantity}</span>
                      </div>
                    )
                  })}
                  <div className="flex justify-between text-xs font-semibold text-gray-500 mt-2 pt-1 border-t border-dashed">
                    <span>Food Subtotal</span>
                    <span>₹{previewTotals.foodSubtotal}</span>
                  </div>
                </div>
              )}

              {/* Liquor */}
              {previewTotals.liquorItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase">🍺 Liquor</span>
                    <div className="flex-1 border-t border-dashed border-gray-200" />
                  </div>
                  {previewTotals.liquorItems.map((item, i) => {
                    const key = item._key
                    return (
                      <div key={i} className={`flex justify-between items-center text-sm py-1 px-1 rounded
                        ${editMode && removedItems.has(key) ? 'opacity-30 line-through bg-red-50' : ''}`}>
                        <div className="flex items-center gap-2 flex-1">
                          {editMode && (
                            <button onClick={() => setRemovedItems(prev => {
                              const n = new Set(prev)
                              n.has(key) ? n.delete(key) : n.add(key)
                              return n
                            })}
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold
                                ${removedItems.has(key) ? 'border-green-500 text-green-500' : 'border-red-400 text-red-400'}`}>
                              {removedItems.has(key) ? '+' : '−'}
                            </button>
                          )}
                          <span className="text-gray-700">{item.food_items?.name}</span>
                          <span className="text-gray-400 text-xs">×{item.quantity}</span>
                        </div>
                        <span className="text-gray-700 font-medium">₹{item.price_at_order * item.quantity}</span>
                      </div>
                    )
                  })}
                  <div className="flex justify-between text-xs font-semibold text-gray-500 mt-2 pt-1 border-t border-dashed">
                    <span>Liquor Subtotal</span>
                    <span>₹{previewTotals.liquorSubtotal}</span>
                  </div>
                </div>
              )}

              {/* Service Charge & Discount */}
              {!editMode && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                  <p className="text-xs font-bold text-gray-500 uppercase">Charges & Discount</p>

                  {/* Service Charge */}
                  <div className="flex justify-between items-center text-sm text-gray-600">
                    <span>Service Charge</span>
                    <div className="flex items-center gap-2">
                      <select value={serviceChargePct}
                        onChange={e => setServiceChargePct(Number(e.target.value))}
                        className="border rounded px-2 py-0.5 text-xs">
                        <option value={0}>0%</option>
                        <option value={5}>5%</option>
                        <option value={10}>10%</option>
                        <option value={12}>12%</option>
                        <option value={18}>18%</option>
                      </select>
                      {previewTotals.serviceChargeAmt > 0 && (
                        <span className="text-xs font-medium text-gray-700">+₹{previewTotals.serviceChargeAmt}</span>
                      )}
                    </div>
                  </div>

                  {/* Discount */}
                  <div className="flex justify-between items-center text-sm text-gray-600">
                    <span>Discount</span>
                    <div className="flex items-center gap-2">
                      <select value={discountType}
                        onChange={e => { setDiscountType(e.target.value); setDiscountValue('') }}
                        className="border rounded px-2 py-0.5 text-xs">
                        <option value="percent">%</option>
                        <option value="flat">₹ flat</option>
                      </select>
                      <input type="number" min="0" value={discountValue}
                        onChange={e => setDiscountValue(e.target.value)}
                        placeholder="0"
                        className="border rounded px-2 py-0.5 text-xs w-16 text-right" />
                      {previewTotals.discountAmt > 0 && (
                        <span className="text-green-600 text-xs font-medium">-₹{previewTotals.discountAmt}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Total */}
              <div className="bg-gray-50 rounded-xl p-3">
                {!editMode && (
                  <>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Subtotal</span>
                      <span>₹{previewTotals.subtotal}</span>
                    </div>
                    {previewTotals.serviceChargeAmt > 0 && (
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Service ({serviceChargePct}%)</span>
                        <span>+₹{previewTotals.serviceChargeAmt}</span>
                      </div>
                    )}
                    {previewTotals.discountAmt > 0 && (
                      <div className="flex justify-between text-xs text-green-600 mb-1">
                        <span>Discount</span>
                        <span>-₹{previewTotals.discountAmt}</span>
                      </div>
                    )}
                    <div className="border-t border-dashed border-gray-200 my-1" />
                  </>
                )}
                <div className="flex justify-between font-bold text-gray-800 text-base">
                  <span>Final Total</span>
                  <span className="text-orange-500 text-xl">₹{previewTotals.finalAmount}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1 text-center">
                  Payment method collected in Today's Report
                </p>
              </div>

              {editMode && (
                <p className="text-xs text-center text-red-400 italic">
                  Tap − to remove items from bill
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="p-4 border-t space-y-2">
              {editMode ? (
                <div className="flex gap-3">
                  <button onClick={() => setEditMode(false)}
                    className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold">
                    ✅ Done Editing
                  </button>
                  <button onClick={() => { setRemovedItems(new Set()); setEditMode(false) }}
                    className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl text-sm font-medium">
                    Reset
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button onClick={handlePrintAndSave} disabled={clearing}
                    className="flex-1 bg-green-500 text-white py-3 rounded-xl font-bold hover:bg-green-600 disabled:opacity-50">
                    🖨️ Print & Save Bill
                  </button>
                  <button onClick={() => setEditMode(true)}
                    className="flex-1 bg-blue-100 text-blue-600 py-3 rounded-xl font-bold hover:bg-blue-200">
                    ✏️ Edit
                  </button>
                </div>
              )}
              {!editMode && (
                <button onClick={() => setShowPreview(false)}
                  className="w-full bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-medium">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirm */}
      {showClearAllConfirm && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-xl font-bold text-red-500 mb-2">⚠️ Clear All Active Tables?</h2>
            <p className="text-gray-600 text-sm mb-4">
              This will clear all {activeTables.length} active tables without printing bills.
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
          <button onClick={() => navigate('/admin/today-report')}
            className="bg-green-100 text-green-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-200">
            📋 Today's Report
          </button>
          <button onClick={() => navigate('/admin/reports')}
            className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">
            📊 Reports
          </button>
          <button onClick={() => navigate('/admin/menu')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">Menu</button>
          <button onClick={() => navigate('/admin/tables')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">Tables</button>
          <button onClick={handleLogout}
            className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200">Logout</button>
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
                const tList = orders.filter(o => o.table_id === table.id)
                const newCount = tList.filter(o => newOrderIds.has(o.id)).length
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
                      <span>{tList.length} order(s)</span>
                      {tList[0] && <span>{toIST(tList[0].created_at)}</span>}
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
                    </div>
                  </div>
                  <button onClick={() => openPreview(selectedTable.id)} disabled={clearing || tableOrders.length === 0}
                    className="bg-green-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-600 transition disabled:opacity-50">
                    🖨️ Print Bill & Clear
                  </button>
                </div>
              </div>

              <div className="space-y-4 mb-4">
                {groupedByOrder.map((order, index) => {
                  const isNewOrder = newOrderIds.has(order.id)
                  return (
                    <div key={order.id}
                      className={`rounded-2xl shadow p-5
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
                        <span className="text-xs text-gray-400">🕐 {toIST(order.created_at)}</span>
                      </div>
                      <div className="space-y-2">
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

              <div className="bg-orange-500 rounded-2xl shadow p-5 text-white mb-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-lg">Subtotal</span>
                  <span className="font-bold text-2xl">₹{tableSubtotal}</span>
                </div>
                <p className="text-orange-100 text-xs mb-4">
                  * Charges, discount & payment method set when printing bill
                </p>
                <button onClick={() => openPreview(selectedTable.id)}
                  disabled={clearing || tableOrders.length === 0}
                  className="w-full bg-white text-orange-500 py-3 rounded-xl font-bold hover:bg-orange-50 transition text-sm disabled:opacity-50">
                  🖨️ Print Bill & Clear Table
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}