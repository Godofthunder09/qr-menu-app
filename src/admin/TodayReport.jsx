import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})

// Only take open_items from FIRST order row — never merge
const groupOrdersIntoBills = (orders) => {
  const map = {}
  orders.forEach(order => {
    const minuteKey = order.paid_at ? order.paid_at.substring(0, 16) : order.id
    const key = `${order.table_name_snapshot || ''}__${minuteKey}`
    if (!map[key]) {
      map[key] = {
        _orderIds: [order.id], _key: key,
        payment_type: order.payment_type,
        split_payment: order.split_payment || null,
        settlement_status: order.settlement_status,
        paid_at: order.paid_at,
        table_name_snapshot: order.table_name_snapshot,
        subtotal: order.subtotal || 0,
        service_charge_pct: order.service_charge_pct || 0,
        service_charge_amt: order.service_charge_amt || 0,
        discount_type: order.discount_type,
        discount_value: order.discount_value || 0,
        discount_amt: order.discount_amt || 0,
        final_amount: order.final_amount || 0,
        order_items: [...(order.order_items || [])],
        open_items: [...(order.open_items_json || [])],
      }
    } else {
      map[key]._orderIds.push(order.id)
      map[key].order_items = [...map[key].order_items, ...(order.order_items || [])]
      if (order.settlement_status === 'pending') map[key].settlement_status = 'pending'
    }
  })
  return Object.values(map)
}

const LIQUOR_KEYWORDS = [
  'beer','wine','whisky','whiskey','vodka','rum','gin','tequila','brandy',
  'champagne','cocktail','scotch','bourbon','ale','lager','cider','sake','mead',
  'port','liquor','spirits','pint','draft','draught','feni','arrack','toddy','sangria'
]
const isLiquorItem = (name = '') => LIQUOR_KEYWORDS.some(k => name.toLowerCase().includes(k))

const buildHtmlReceipt = (lines) => `
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:monospace;font-size:13px;width:300px;margin:0 auto;padding:10px}
  .center{text-align:center}.bold{font-weight:bold}.big{font-size:16px;font-weight:bold}
  .row{display:flex;justify-content:space-between}.div{border-top:1px dashed #000;margin:4px 0}
  .section-title{font-weight:bold;margin-top:6px}
  @media print{body{margin:0;padding:0}}
</style></head><body>
<div class="center big">${lines.restaurantName}</div>
<div class="center">${lines.address}</div>
<div class="center">${lines.phone}</div>
${lines.gstNumber ? `<div class="center">GST: ${lines.gstNumber}</div>` : ''}
<div class="div"></div>
<div class="row"><span>Table: ${lines.tableName}</span><span>${lines.date}</span></div>
<div>Time: ${lines.time}</div>
<div class="div"></div>
${lines.foodSection}
${lines.liquorSection}
<div class="row"><span>Subtotal</span><span>Rs.${lines.subtotal}</span></div>
${lines.serviceChargeAmt > 0 ? `<div class="row"><span>Service (${lines.serviceChargePct}%)</span><span>Rs.${lines.serviceChargeAmt}</span></div>` : ''}
${lines.discountAmt > 0 ? `<div class="row"><span>Discount</span><span>-Rs.${lines.discountAmt}</span></div>` : ''}
<div class="div"></div>
<div class="row big"><span>TOTAL</span><span>Rs.${lines.finalAmount}</span></div>
${lines.splitInfo ? `<div class="div"></div><div class="center" style="font-size:11px">Payment: ${lines.splitInfo}</div>` : ''}
<div class="div"></div>
<div class="center">${lines.footerNote}</div>
</body></html>`

export default function TodayReport() {
  const navigate = useNavigate()
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(true)
  const [settling, setSettling] = useState(null)
  const [showCloseDay, setShowCloseDay] = useState(false)
  const [closingDay, setClosingDay] = useState(false)
  const [summary, setSummary] = useState(null)
  const [restaurant, setRestaurant] = useState({
    name: 'My Restaurant', address: '', phone: '', gst_number: '', footer_note: 'Thank you! Visit again!'
  })
  const [allFoodItems, setAllFoodItems] = useState([])

  // Settlement
  const [showSettleModal, setShowSettleModal] = useState(false)
  const [settleBill, setSettleBill] = useState(null)
  const [settleType, setSettleType] = useState('cash')
  // Split payment
  const [splitMode, setSplitMode] = useState('cash+upi')
  const [splitAmounts, setSplitAmounts] = useState({ first: '', second: '' })
  const [splitError, setSplitError] = useState('')

  // Edit state
  const [editingBillKey, setEditingBillKey] = useState(null)
  const [editingBill, setEditingBill] = useState(null)
  const [editRemovedItemKeys, setEditRemovedItemKeys] = useState(new Set())
  const [editManualItems, setEditManualItems] = useState([])
  const [editMenuSearch, setEditMenuSearch] = useState('')
  const [showEditOpenForm, setShowEditOpenForm] = useState(false)
  const [editOpenDept, setEditOpenDept] = useState('Food')
  const [editOpenName, setEditOpenName] = useState('')
  const [editOpenPrice, setEditOpenPrice] = useState('')
  const [editOpenQty, setEditOpenQty] = useState(1)

  // Reprint
  const [showReprintPreview, setShowReprintPreview] = useState(false)
  const [reprintServicePct, setReprintServicePct] = useState(0)
  const [reprintDiscount, setReprintDiscount] = useState({ type: 'percent', value: '', reason: '' })
  const [reprintDiscountError, setReprintDiscountError] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchTodayBills() }, [])

  useEffect(() => {
    supabase.from('settings').select('*').eq('id', 'main').single()
      .then(({ data }) => {
        if (data) setRestaurant({
          name: data.restaurant_name || 'My Restaurant',
          address: data.address || '',
          phone: data.phone || '',
          gst_number: data.gst_number || '',
          footer_note: data.footer_note || 'Thank you! Visit again!'
        })
      })
    supabase.from('food_items').select('id, name, price, is_available')
      .eq('is_available', true).order('name')
      .then(({ data }) => setAllFoodItems(data || []))
  }, [])

  const fetchTodayBills = async () => {
    setLoading(true)
    const today = todayIST()
    const startISO = new Date(today + 'T00:00:00+05:30').toISOString()
    const endISO   = new Date(today + 'T23:59:59+05:30').toISOString()
    const { data, error } = await supabase
      .from('orders')
      .select(`id, payment_type, split_payment, is_paid, paid_at, settlement_status,
        subtotal, service_charge_pct, service_charge_amt,
        discount_type, discount_value, discount_amt,
        final_amount, table_name_snapshot, open_items_json,
        order_items(id, quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true)
      .gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })
    if (error) console.error('fetchTodayBills:', error.message)
    const grouped = groupOrdersIntoBills(data || [])
    setBills(grouped)
    const settled = grouped.filter(b => b.settlement_status !== 'pending')
    const pending  = grouped.filter(b => b.settlement_status === 'pending')
    const totalRevenue = settled.reduce((s, b) => s + (b.final_amount || 0), 0)
    const cashRev = settled.reduce((s, b) => {
      if (b.split_payment) return s + (b.split_payment.cash || 0)
      return s + (b.payment_type === 'cash' ? b.final_amount || 0 : 0)
    }, 0)
    const upiRev = settled.reduce((s, b) => {
      if (b.split_payment) return s + (b.split_payment.upi || 0)
      return s + (b.payment_type === 'upi' ? b.final_amount || 0 : 0)
    }, 0)
    const cardRev = settled.reduce((s, b) => {
      if (b.split_payment) return s + (b.split_payment.card || 0)
      return s + (b.payment_type === 'card' ? b.final_amount || 0 : 0)
    }, 0)
    setSummary({ totalRevenue, cashRev, upiRev, cardRev, settled: settled.length, pending: pending.length, total: grouped.length })
    setLoading(false)
  }

  // ── Settlement ──────────────────────────────────────────────────────────
  const openSettle = (bill) => {
    setSettleBill(bill)
    setSettleType('cash')
    setSplitMode('cash+upi')
    setSplitAmounts({ first: '', second: '' })
    setSplitError('')
    setShowSettleModal(true)
  }

  const parseSplitMode = (mode) => {
    const parts = mode.split('+')
    return { firstMethod: parts[0], secondMethod: parts[1] }
  }

  const confirmSettle = async () => {
    if (!settleBill) return

    let paymentType = settleType
    let splitPayload = null

    if (settleType === 'split') {
      const { firstMethod, secondMethod } = parseSplitMode(splitMode)
      const firstAmt = parseFloat(splitAmounts.first) || 0
      const secondAmt = parseFloat(splitAmounts.second) || 0
      const total = settleBill.final_amount || 0

      if (firstAmt <= 0 && secondAmt <= 0) {
        setSplitError('Enter amounts for both payment methods'); return
      }
      if (Math.abs((firstAmt + secondAmt) - total) > 1) {
        setSplitError(`Amounts must add up to ₹${total} (currently ₹${firstAmt + secondAmt})`); return
      }
      setSplitError('')
      paymentType = firstAmt >= secondAmt ? firstMethod : secondMethod
      splitPayload = { [firstMethod]: firstAmt, [secondMethod]: secondAmt }
    }

    setSettling(settleBill._key)
    for (const orderId of settleBill._orderIds) {
      await supabase.from('orders').update({
        payment_type: paymentType,
        settlement_status: 'settled',
        ...(splitPayload ? { split_payment: splitPayload } : {})
      }).eq('id', orderId)
    }

    const today = todayIST()
    const { data: existing } = await supabase.from('daily_reports').select('*').eq('report_date', today).single()
    const amt = settleBill.final_amount || 0
    const svc = settleBill.service_charge_amt || 0

    const cashAmt = splitPayload ? (splitPayload.cash || 0) : (paymentType === 'cash' ? amt : 0)
    const upiAmt  = splitPayload ? (splitPayload.upi  || 0) : (paymentType === 'upi'  ? amt : 0)
    const cardAmt = splitPayload ? (splitPayload.card || 0) : (paymentType === 'card' ? amt : 0)

    if (existing) {
      await supabase.from('daily_reports').update({
        total_orders: existing.total_orders + 1,
        total_revenue: existing.total_revenue + amt,
        cash_revenue: existing.cash_revenue + cashAmt,
        upi_revenue:  existing.upi_revenue  + upiAmt,
        card_revenue: existing.card_revenue + cardAmt,
        service_charge_total: existing.service_charge_total + svc,
        updated_at: new Date().toISOString()
      }).eq('report_date', today)
    } else {
      await supabase.from('daily_reports').insert({
        report_date: today, total_orders: 1, total_revenue: amt,
        cash_revenue: cashAmt, upi_revenue: upiAmt, card_revenue: cardAmt,
        service_charge_total: svc
      })
    }

    setSettling(null); setShowSettleModal(false); fetchTodayBills()
  }

  // ── Edit helpers ─────────────────────────────────────────────────────────
  const openEdit = (bill) => {
    setEditingBillKey(bill._key); setEditingBill(bill)
    setEditRemovedItemKeys(new Set()); setEditManualItems([])
    setEditMenuSearch(''); setShowEditOpenForm(false)
    setEditOpenName(''); setEditOpenPrice(''); setEditOpenQty(1)
  }

  const closeEdit = () => {
    setEditingBillKey(null); setEditingBill(null)
    setEditRemovedItemKeys(new Set()); setEditManualItems([])
    setShowEditOpenForm(false)
  }

  const toggleEditRemove = (key) => {
    setEditRemovedItemKeys(prev => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
    })
  }

  const addEditMenuItem = (fi) => {
    setEditManualItems(prev => {
      const existing = prev.find(m => m.foodItemId === fi.id)
      if (existing) return prev.map(m => m.foodItemId === fi.id ? { ...m, qty: m.qty + 1 } : m)
      return [...prev, { tempId: Date.now() + Math.random(), foodItemId: fi.id, name: fi.name, price: fi.price, qty: 1 }]
    })
  }

  const changeEditMenuQty = (foodItemId, delta) => {
    setEditManualItems(prev =>
      prev.map(m => m.foodItemId === foodItemId ? { ...m, qty: m.qty + delta } : m).filter(m => m.qty > 0)
    )
  }

  const addEditOpenItem = () => {
    if (!editOpenName.trim()) { alert('Enter item name'); return }
    if (!editOpenPrice || parseFloat(editOpenPrice) <= 0) { alert('Enter valid price'); return }
    setEditManualItems(prev => [...prev, {
      tempId: Date.now() + Math.random(), foodItemId: null,
      name: editOpenName.trim(), price: parseFloat(editOpenPrice),
      qty: editOpenQty, isOpen: true, dept: editOpenDept
    }])
    setEditOpenName(''); setEditOpenPrice(''); setEditOpenQty(1); setShowEditOpenForm(false)
  }

  const computeCurrentTotals = (bill, removedKeys, manualItems, svcPct, discType, discVal) => {
    if (!bill) return null
    const effectiveItems = (bill.order_items || [])
      .map((item, idx) => ({ ...item, _stableKey: `item:${idx}` }))
      .filter(item => !removedKeys.has(item._stableKey))
    const existingOpenAsItems = (bill.open_items || []).map(oi => ({
      food_items: { name: oi.name }, price_at_order: oi.price, quantity: oi.qty
    }))
    const newManualAsItems = manualItems.map(mi => ({
      food_items: { name: mi.name }, price_at_order: mi.price, quantity: mi.qty
    }))
    const all = [...effectiveItems, ...existingOpenAsItems, ...newManualAsItems]
    const foodItems   = all.filter(i => !isLiquorItem(i.food_items?.name))
    const liquorItems = all.filter(i =>  isLiquorItem(i.food_items?.name))
    const foodSubtotal   = foodItems.reduce((s, i)   => s + i.price_at_order * i.quantity, 0)
    const liquorSubtotal = liquorItems.reduce((s, i) => s + i.price_at_order * i.quantity, 0)
    const subtotal = foodSubtotal + liquorSubtotal
    const serviceChargeAmt = Math.round(subtotal * (svcPct || 0) / 100)
    const afterService = subtotal + serviceChargeAmt
    const dv = parseFloat(discVal) || 0
    const discountAmt = discType === 'percent'
      ? Math.round(afterService * dv / 100) : Math.min(dv, afterService)
    const finalAmount = afterService - discountAmt
    return { foodItems, liquorItems, foodSubtotal, liquorSubtotal, subtotal, serviceChargeAmt, discountAmt, finalAmount }
  }

  const editTotals = editingBill
    ? computeCurrentTotals(editingBill, editRemovedItemKeys, editManualItems,
        editingBill.service_charge_pct, editingBill.discount_type,
        editingBill.discount_value?.toString() || '')
    : null

  const openReprintPreview = (bill) => {
    setReprintServicePct(bill.service_charge_pct || 0)
    setReprintDiscount({ type: bill.discount_type || 'percent', value: bill.discount_value?.toString() || '', reason: '' })
    setReprintDiscountError(false)
    setShowReprintPreview(true)
  }

  const reprintTotals = showReprintPreview && editingBill
    ? computeCurrentTotals(editingBill, editRemovedItemKeys, editManualItems,
        reprintServicePct, reprintDiscount.type, reprintDiscount.value)
    : null

  const handleReprintAndSave = async () => {
    const dv = parseFloat(reprintDiscount.value) || 0
    if (dv > 0 && !reprintDiscount.reason.trim()) { setReprintDiscountError(true); return }
    setReprintDiscountError(false)
    if (!editingBill || !reprintTotals) { alert('Error: No bill loaded.'); return }
    setSaving(true)
    try {
      const totals = reprintTotals
      const foodSection = totals.foodItems.length > 0 ? `
<div class="section-title">FOOD</div>
${totals.foodItems.map(i => `<div class="row"><span>${i.food_items?.name || 'Item'} x${i.quantity}</span><span>Rs.${i.price_at_order * i.quantity}</span></div>`).join('')}
<div class="row bold"><span>Food Subtotal</span><span>Rs.${totals.foodSubtotal}</span></div>
<div class="div"></div>` : ''
      const liquorSection = totals.liquorItems.length > 0 ? `
<div class="section-title">LIQUOR</div>
${totals.liquorItems.map(i => `<div class="row"><span>${i.food_items?.name || 'Item'} x${i.quantity}</span><span>Rs.${i.price_at_order * i.quantity}</span></div>`).join('')}
<div class="row bold"><span>Liquor Subtotal</span><span>Rs.${totals.liquorSubtotal}</span></div>
<div class="div"></div>` : ''
      const lines = {
        restaurantName: restaurant.name, address: restaurant.address,
        phone: restaurant.phone, gstNumber: restaurant.gst_number,
        footerNote: restaurant.footer_note,
        tableName: editingBill.table_name_snapshot || '',
        date: formatDate(editingBill.paid_at), time: toIST(editingBill.paid_at),
        foodSection, liquorSection,
        subtotal: totals.subtotal, serviceChargePct: reprintServicePct,
        serviceChargeAmt: totals.serviceChargeAmt, discountAmt: totals.discountAmt,
        finalAmount: totals.finalAmount,
        splitInfo: null,
      }
      const w = window.open('', '_blank', 'width=400,height=600')
      if (w) { w.document.write(buildHtmlReceipt(lines)); w.document.close(); w.focus(); setTimeout(() => { w.print(); w.close() }, 300) }

      // ── FIX: Persist removed items to order_items in DB ──────────────────
      // editRemovedItemKeys contains keys like "item:0", "item:1" — these map
      // directly to the index of editingBill.order_items array.
      // We use the row `id` (now fetched in fetchTodayBills) to delete precisely.
      if (editRemovedItemKeys.size > 0) {
        for (const key of editRemovedItemKeys) {
          // key format: "item:N"
          const idx = parseInt(key.split(':')[1], 10)
          const item = editingBill.order_items?.[idx]
          if (!item?.id) continue
          await supabase.from('order_items').delete().eq('id', item.id)
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // Insert newly added menu items
      const newMenuItems = editManualItems.filter(m => m.foodItemId)
      if (newMenuItems.length > 0) {
        await supabase.from('order_items').insert(newMenuItems.map(mi => ({
          order_id: editingBill._orderIds[0], food_item_id: mi.foodItemId,
          quantity: mi.qty, price_at_order: mi.price, note: "Added at Today's Report"
        })))
      }

      // Append new open items to open_items_json
      const newOpenItems = editManualItems.filter(m => m.isOpen)
        .map(mi => ({ name: mi.name, price: mi.price, qty: mi.qty, dept: mi.dept, total: mi.price * mi.qty }))
      const updatedOpenItems = [...(editingBill.open_items || []), ...newOpenItems]

      // Update orders row with new totals
      for (const orderId of editingBill._orderIds) {
        await supabase.from('orders').update({
          subtotal: totals.subtotal, service_charge_pct: reprintServicePct,
          service_charge_amt: totals.serviceChargeAmt,
          discount_type: reprintDiscount.type, discount_value: dv,
          discount_amt: totals.discountAmt, discount_reason: reprintDiscount.reason.trim(),
          final_amount: totals.finalAmount, open_items_json: updatedOpenItems,
        }).eq('id', orderId)
      }

      closeEdit(); setShowReprintPreview(false); fetchTodayBills()
      alert('✅ Bill updated and reprinted!')
    } catch (err) { alert('❌ Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const closeDay = async () => {
    const pendingBills = bills.filter(b => b.settlement_status === 'pending')
    if (pendingBills.length > 0) { alert(`⚠️ ${pendingBills.length} bills are still unsettled.`); setShowCloseDay(false); return }
    setClosingDay(true)
    const today = todayIST()
    const startISO = new Date(today + 'T00:00:00+05:30').toISOString()
    const endISO   = new Date(today + 'T23:59:59+05:30').toISOString()
    await supabase.from('orders').update({ settlement_status: 'day_closed' })
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
    setClosingDay(false); setShowCloseDay(false)
    alert('✅ Day closed!'); fetchTodayBills()
  }

  const pendingBills  = bills.filter(b => b.settlement_status === 'pending')
  const settledBills  = bills.filter(b => b.settlement_status === 'settled' || b.settlement_status === 'day_closed')
  const filteredEditMenuItems = allFoodItems.filter(f => f.name.toLowerCase().includes(editMenuSearch.toLowerCase()))
  const reprintDv = parseFloat(reprintDiscount.value) || 0

  const handleSplitFirstChange = (val) => {
    setSplitError('')
    const v = parseFloat(val) || 0
    const total = settleBill?.final_amount || 0
    const remaining = Math.max(0, total - v)
    setSplitAmounts({ first: val, second: remaining > 0 ? String(remaining) : '' })
  }

  const PayBadge = ({ type, split }) => {
    if (split) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">
          🔀 Split
        </span>
      )
    }
    if (!type || type === 'pending') return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700">⏳ Pending</span>
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${type === 'cash' ? 'bg-green-100 text-green-600' : type === 'upi' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
      {type === 'cash' ? '💵 Cash' : type === 'upi' ? '📱 UPI' : '💳 Card'}
    </span>
  }

  const { firstMethod, secondMethod } = parseSplitMode(splitMode)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Settlement Modal ──────────────────────────────────────────────── */}
      {showSettleModal && settleBill && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-bold text-gray-800 mb-1">💰 Settle Bill</h2>
            <p className="text-sm text-gray-400 mb-3">{settleBill.table_name_snapshot || 'Table'}</p>

            <div className="bg-gray-50 rounded-xl p-3 mb-4 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-500"><span>Subtotal</span><span>₹{settleBill.subtotal}</span></div>
              {settleBill.service_charge_amt > 0 && (
                <div className="flex justify-between text-sm text-gray-500"><span>Service ({settleBill.service_charge_pct}%)</span><span>+₹{settleBill.service_charge_amt}</span></div>
              )}
              {settleBill.discount_amt > 0 && (
                <div className="flex justify-between text-sm text-green-600"><span>Discount</span><span>-₹{settleBill.discount_amt}</span></div>
              )}
              <div className="border-t pt-2 flex justify-between font-bold text-gray-800">
                <span>Amount to Collect</span>
                <span className="text-orange-500 text-lg">₹{settleBill.final_amount}</span>
              </div>
            </div>

            <p className="text-sm font-medium text-gray-700 mb-2">How did they pay?</p>

            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {[
                { id: 'cash', label: '💵 Cash' },
                { id: 'upi',  label: '📱 UPI' },
                { id: 'card', label: '💳 Card' },
                { id: 'split', label: '🔀 Split' },
              ].map(p => (
                <button key={p.id} onClick={() => { setSettleType(p.id); setSplitError('') }}
                  className={`py-2.5 rounded-xl text-xs font-semibold border-2 transition
                    ${settleType === p.id ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-gray-200 text-gray-500 hover:border-orange-300'}`}>
                  {p.label}
                </button>
              ))}
            </div>

            {settleType === 'split' && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 mb-4 space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">Choose payment combination</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'cash+upi',  label: '💵+📱' },
                      { id: 'cash+card', label: '💵+💳' },
                      { id: 'upi+card',  label: '📱+💳' },
                    ].map(m => (
                      <button key={m.id} onClick={() => { setSplitMode(m.id); setSplitAmounts({ first: '', second: '' }); setSplitError('') }}
                        className={`py-2 rounded-lg text-xs font-bold border-2 transition
                          ${splitMode === m.id ? 'border-indigo-500 bg-indigo-100 text-indigo-700' : 'border-gray-200 bg-white text-gray-500 hover:border-indigo-300'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      {firstMethod === 'cash' ? '💵 Cash' : firstMethod === 'upi' ? '📱 UPI' : '💳 Card'} ₹
                    </label>
                    <input
                      type="number" min="0" max={settleBill.final_amount}
                      value={splitAmounts.first}
                      onChange={e => handleSplitFirstChange(e.target.value)}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      {secondMethod === 'cash' ? '💵 Cash' : secondMethod === 'upi' ? '📱 UPI' : '💳 Card'} ₹
                    </label>
                    <input
                      type="number" min="0" max={settleBill.final_amount}
                      value={splitAmounts.second}
                      onChange={e => { setSplitError(''); setSplitAmounts(p => ({ ...p, second: e.target.value })) }}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Entered total:</span>
                  <span className={`font-bold ${Math.abs(((parseFloat(splitAmounts.first)||0) + (parseFloat(splitAmounts.second)||0)) - (settleBill.final_amount||0)) <= 1 ? 'text-green-600' : 'text-red-500'}`}>
                    ₹{(parseFloat(splitAmounts.first)||0) + (parseFloat(splitAmounts.second)||0)}
                    {' '}/ ₹{settleBill.final_amount}
                  </span>
                </div>

                {splitError && <p className="text-red-500 text-xs">⚠️ {splitError}</p>}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setShowSettleModal(false)} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium">Cancel</button>
              <button onClick={confirmSettle} disabled={!!settling}
                className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 disabled:opacity-50">
                {settling ? '⏳...' : '✅ Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reprint Preview Modal ──────────────────────────────────────────── */}
      {showReprintPreview && editingBill && reprintTotals && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[92vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <div>
                <h2 className="font-bold text-gray-800">🖨️ Reprint Preview</h2>
                <p className="text-xs text-gray-400">{editingBill.table_name_snapshot} · {toIST(editingBill.paid_at)}</p>
              </div>
              <button onClick={() => setShowReprintPreview(false)} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {reprintTotals.foodItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase">🍽 Food</span>
                    <div className="flex-1 border-t border-dashed border-gray-200" />
                  </div>
                  {reprintTotals.foodItems.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{item.food_items?.name}</span>
                        <span className="bg-orange-100 text-orange-600 text-xs px-1.5 py-0.5 rounded-full">×{item.quantity}</span>
                      </div>
                      <span className="text-gray-700 font-medium">₹{item.price_at_order * item.quantity}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-semibold text-gray-500 mt-1 pt-1 border-t border-dashed">
                    <span>Food Subtotal</span><span>₹{reprintTotals.foodSubtotal}</span>
                  </div>
                </div>
              )}
              {reprintTotals.liquorItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase">🍺 Liquor</span>
                    <div className="flex-1 border-t border-dashed border-gray-200" />
                  </div>
                  {reprintTotals.liquorItems.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{item.food_items?.name}</span>
                        <span className="bg-blue-100 text-blue-600 text-xs px-1.5 py-0.5 rounded-full">×{item.quantity}</span>
                      </div>
                      <span className="text-gray-700 font-medium">₹{item.price_at_order * item.quantity}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-semibold text-gray-500 mt-1 pt-1 border-t border-dashed">
                    <span>Liquor Subtotal</span><span>₹{reprintTotals.liquorSubtotal}</span>
                  </div>
                </div>
              )}
              <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase">Adjust Charges</p>
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <span>Service Charge</span>
                  <div className="flex items-center gap-2">
                    <select value={reprintServicePct} onChange={e => setReprintServicePct(Number(e.target.value))} className="border rounded px-2 py-0.5 text-xs">
                      <option value={0}>0%</option><option value={5}>5%</option>
                      <option value={10}>10%</option><option value={12}>12%</option><option value={18}>18%</option>
                    </select>
                    {reprintTotals.serviceChargeAmt > 0 && <span className="text-xs font-medium text-gray-700">+₹{reprintTotals.serviceChargeAmt}</span>}
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <span>Discount</span>
                  <div className="flex items-center gap-2">
                    <select value={reprintDiscount.type} onChange={e => setReprintDiscount(p => ({ ...p, type: e.target.value, value: '' }))} className="border rounded px-2 py-0.5 text-xs">
                      <option value="percent">%</option><option value="flat">₹ flat</option>
                    </select>
                    <input type="number" min="0" value={reprintDiscount.value}
                      onChange={e => { setReprintDiscount(p => ({ ...p, value: e.target.value })); setReprintDiscountError(false) }}
                      placeholder="0" className="border rounded px-2 py-0.5 text-xs w-16 text-right" />
                    {reprintTotals.discountAmt > 0 && <span className="text-green-600 text-xs font-medium">-₹{reprintTotals.discountAmt}</span>}
                  </div>
                </div>
                {reprintDv > 0 && (
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Discount Reason *</label>
                    <input type="text" value={reprintDiscount.reason}
                      onChange={e => { setReprintDiscount(p => ({ ...p, reason: e.target.value })); setReprintDiscountError(false) }}
                      placeholder="Reason..."
                      className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 ${reprintDiscountError ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} />
                    {reprintDiscountError && <p className="text-red-500 text-xs mt-1">⚠️ Reason required</p>}
                  </div>
                )}
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Subtotal</span><span>₹{reprintTotals.subtotal}</span></div>
                {reprintTotals.serviceChargeAmt > 0 && <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Service ({reprintServicePct}%)</span><span>+₹{reprintTotals.serviceChargeAmt}</span></div>}
                {reprintTotals.discountAmt > 0 && <div className="flex justify-between text-xs text-green-600 mb-1"><span>Discount</span><span>-₹{reprintTotals.discountAmt}</span></div>}
                <div className="border-t border-dashed my-1" />
                <div className="flex justify-between font-bold text-gray-800 text-base">
                  <span>Final Total</span>
                  <span className="text-orange-500 text-xl">₹{reprintTotals.finalAmount}</span>
                </div>
              </div>
            </div>
            <div className="p-4 border-t space-y-2">
              <button onClick={handleReprintAndSave} disabled={saving}
                className="w-full bg-green-500 text-white py-3 rounded-xl font-bold hover:bg-green-600 disabled:opacity-50">
                {saving ? '⏳ Saving...' : '🖨️ Save Changes & Reprint'}
              </button>
              <button onClick={() => setShowReprintPreview(false)}
                className="w-full bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-medium">
                ← Back to Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Close Day Modal ───────────────────────────────────────────────── */}
      {showCloseDay && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">🌙 Close the Day?</h2>
            <p className="text-gray-500 text-sm mb-4">Finalize all settled bills and save to Reports.</p>
            {pendingBills.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                <p className="text-red-600 text-sm font-medium">⚠️ {pendingBills.length} bill(s) still unsettled!</p>
              </div>
            )}
            {summary && (
              <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Total Bills</span><span className="font-bold">{summary.total}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Total Revenue</span><span className="font-bold text-orange-500">₹{summary.totalRevenue}</span></div>
                <div className="flex justify-between text-green-600"><span>💵 Cash</span><span className="font-bold">₹{summary.cashRev}</span></div>
                <div className="flex justify-between text-blue-600"><span>📱 UPI</span><span className="font-bold">₹{summary.upiRev}</span></div>
                <div className="flex justify-between text-purple-600"><span>💳 Card</span><span className="font-bold">₹{summary.cardRev}</span></div>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setShowCloseDay(false)} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium">Cancel</button>
              <button onClick={closeDay} disabled={closingDay || pendingBills.length > 0}
                className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold disabled:opacity-50">
                {closingDay ? '⏳ Closing...' : '🌙 Close Day'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-xl">📋</span>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Today's Report</h1>
            <p className="text-xs text-gray-400">
              {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setShowCloseDay(true)} className="bg-orange-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-600">🌙 Close Day</button>
          <button onClick={() => navigate('/admin/reports')} className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">📊 Reports</button>
          <button onClick={() => navigate('/admin/dashboard')} className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">← Dashboard</button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        {summary && summary.total > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">Total Bills</p>
              <p className="text-2xl font-bold text-gray-700">{summary.total}</p>
              <p className="text-xs text-gray-400 mt-1">{summary.settled} settled · {summary.pending} pending</p>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">Settled Revenue</p>
              <p className="text-2xl font-bold text-orange-600">₹{summary.totalRevenue}</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">💵 Cash</p>
              <p className="text-2xl font-bold text-green-600">₹{summary.cashRev}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">📱 UPI + 💳 Card</p>
              <p className="text-2xl font-bold text-blue-600">₹{summary.upiRev + summary.cardRev}</p>
            </div>
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-400">Loading...</div>}
        {!loading && bills.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-lg font-medium">No bills printed today yet.</p>
          </div>
        )}

        {/* Pending Bills */}
        {!loading && pendingBills.length > 0 && (
          <div className="mb-6">
            <h2 className="text-base font-bold text-red-500 mb-3">⏳ Unsettled Bills ({pendingBills.length})</h2>
            <div className="space-y-4">
              {pendingBills.map(bill => {
                const isEditing = editingBillKey === bill._key
                return (
                  <div key={bill._key} className="bg-white border-2 border-yellow-300 rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-bold text-gray-800 text-lg">{bill.table_name_snapshot || 'Table'}</p>
                          <p className="text-xs text-gray-400">{toIST(bill.paid_at)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-orange-500">
                            {isEditing && editTotals ? `₹${editTotals.finalAmount}` : `₹${bill.final_amount}`}
                          </p>
                          <PayBadge type={bill.payment_type} split={bill.split_payment} />
                        </div>
                      </div>

                      <div className="space-y-1 mb-2">
                        {bill.order_items?.map((item, i) => {
                          const key = `item:${i}`
                          const isRemoved = isEditing && editRemovedItemKeys.has(key)
                          return (
                            <div key={i} className={`flex justify-between text-xs ${isRemoved ? 'line-through opacity-40 text-red-400' : 'text-gray-500'}`}>
                              <span>{item.food_items?.name} × {item.quantity}</span>
                              <span>₹{item.price_at_order * item.quantity}</span>
                            </div>
                          )
                        })}
                        {(bill.open_items || []).map((oi, i) => (
                          <div key={`open-${i}`} className="flex justify-between text-xs text-purple-600">
                            <span>{oi.dept === 'Food' ? '🍽' : oi.dept === 'Beverage' ? '🥤' : '🍺'} {oi.name} × {oi.qty} <span className="opacity-60">(open)</span></span>
                            <span>₹{oi.price * oi.qty}</span>
                          </div>
                        ))}
                        {isEditing && editManualItems.map(mi => (
                          <div key={mi.tempId} className="flex justify-between text-xs text-green-600 font-medium">
                            <span>+ {mi.name} × {mi.qty}</span>
                            <span>₹{mi.price * mi.qty}</span>
                          </div>
                        ))}
                      </div>

                      {(bill.service_charge_amt > 0 || bill.discount_amt > 0) && !isEditing && (
                        <div className="border-t pt-2 space-y-0.5 mb-3">
                          {bill.service_charge_amt > 0 && (
                            <div className="flex justify-between text-xs text-gray-400">
                              <span>Service ({bill.service_charge_pct}%)</span><span>+₹{bill.service_charge_amt}</span>
                            </div>
                          )}
                          {bill.discount_amt > 0 && (
                            <div className="flex justify-between text-xs text-green-600">
                              <span>Discount</span><span>-₹{bill.discount_amt}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {!isEditing && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => openSettle(bill)}
                            className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-orange-600">
                            💳 Settle Payment
                          </button>
                          <button onClick={() => openEdit(bill)}
                            className="bg-blue-100 text-blue-600 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-200">
                            ✏️ Edit Bill
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Edit Panel */}
                    {isEditing && (
                      <div className="border-t bg-blue-50">
                        <div className="px-4 pt-3 pb-2">
                          <div className="bg-blue-100 border border-blue-200 rounded-xl px-3 py-2 flex items-center gap-2">
                            <span>✏️</span>
                            <p className="text-xs text-blue-700 font-medium">2nd & Last Chance — After reprinting, bill will be locked on settlement.</p>
                          </div>
                        </div>

                        {bill.order_items?.length > 0 && (
                          <div className="px-4 py-3 border-b border-blue-100">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">🗑 Remove Items</p>
                            <div className="space-y-1.5">
                              {bill.order_items.map((item, i) => {
                                const key = `item:${i}`
                                const isRemoved = editRemovedItemKeys.has(key)
                                return (
                                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-xl border ${isRemoved ? 'bg-red-50 border-red-100 opacity-60' : 'bg-white border-gray-100'}`}>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm text-gray-700 ${isRemoved ? 'line-through' : ''}`}>{item.food_items?.name}</span>
                                      <span className="text-xs text-gray-400">×{item.quantity}</span>
                                      <span className="text-xs font-medium text-orange-500">₹{item.price_at_order * item.quantity}</span>
                                    </div>
                                    <button onClick={() => toggleEditRemove(key)}
                                      className={`text-xs px-3 py-1 rounded-full font-medium ${isRemoved ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-red-100 text-red-500 hover:bg-red-200'}`}>
                                      {isRemoved ? '↩ Restore' : '✕ Remove'}
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        <div className="px-4 py-3 border-b border-blue-100">
                          <p className="text-xs font-bold text-gray-500 uppercase mb-2">➕ Add from Menu</p>
                          <input type="text" value={editMenuSearch} onChange={e => setEditMenuSearch(e.target.value)}
                            placeholder="🔍 Search menu..."
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                          {editManualItems.filter(m => m.foodItemId).length > 0 && (
                            <div className="mb-2 space-y-1">
                              <p className="text-xs text-green-600 font-medium">✅ Added:</p>
                              {editManualItems.filter(m => m.foodItemId).map(mi => (
                                <div key={mi.tempId} className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                                  <div>
                                    <p className="text-sm font-medium text-gray-700">{mi.name}</p>
                                    <p className="text-xs text-gray-400">₹{mi.price} × {mi.qty} = ₹{mi.price * mi.qty}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => changeEditMenuQty(mi.foodItemId, -1)} className="w-7 h-7 rounded-full bg-red-100 text-red-500 font-bold flex items-center justify-center">−</button>
                                    <span className="font-bold text-gray-700 w-4 text-center">{mi.qty}</span>
                                    <button onClick={() => changeEditMenuQty(mi.foodItemId, 1)} className="w-7 h-7 rounded-full bg-green-100 text-green-600 font-bold flex items-center justify-center">+</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="max-h-36 overflow-y-auto space-y-1">
                            {filteredEditMenuItems.map(fi => {
                              const added = editManualItems.find(m => m.foodItemId === fi.id)
                              return (
                                <button key={fi.id} onClick={() => addEditMenuItem(fi)}
                                  className="w-full flex justify-between items-center px-3 py-2 rounded-lg hover:bg-orange-50 border border-transparent hover:border-orange-200 text-left">
                                  <span className="text-sm text-gray-700">{fi.name}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-orange-500 font-bold">₹{fi.price}</span>
                                    {added ? <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">×{added.qty}</span>
                                      : <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">+ Add</span>}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className="px-4 py-3 border-b border-blue-100">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold text-gray-500 uppercase">🆕 Open Item</p>
                            <button onClick={() => setShowEditOpenForm(!showEditOpenForm)}
                              className="text-xs bg-orange-500 text-white px-3 py-1 rounded-full">
                              {showEditOpenForm ? '✕ Cancel' : '+ Open'}
                            </button>
                          </div>
                          {showEditOpenForm && (
                            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-3">
                              <div className="flex gap-2">
                                {[{ id: 'Food', icon: '🍽' }, { id: 'Beverage', icon: '🥤' }, { id: 'Liquor', icon: '🍺' }].map(d => (
                                  <button key={d.id} onClick={() => setEditOpenDept(d.id)}
                                    className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition ${editOpenDept === d.id ? 'bg-orange-500 text-white border-transparent' : 'bg-white border-gray-200 text-gray-500'}`}>
                                    {d.icon} {d.id}
                                  </button>
                                ))}
                              </div>
                              <input type="text" value={editOpenName} onChange={e => setEditOpenName(e.target.value)}
                                placeholder="Item name *"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                              <div className="grid grid-cols-2 gap-2">
                                <input type="number" min="1" value={editOpenPrice} onChange={e => setEditOpenPrice(e.target.value)}
                                  placeholder="Price ₹ *"
                                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                                <div className="flex items-center gap-2">
                                  <button onClick={() => setEditOpenQty(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-full bg-gray-200 font-bold flex items-center justify-center">−</button>
                                  <span className="font-bold text-gray-700 w-4 text-center">{editOpenQty}</span>
                                  <button onClick={() => setEditOpenQty(q => q + 1)} className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 font-bold flex items-center justify-center">+</button>
                                </div>
                              </div>
                              <button onClick={addEditOpenItem} className="w-full bg-orange-500 text-white py-2 rounded-xl font-bold hover:bg-orange-600">✅ Add to Bill</button>
                            </div>
                          )}
                          {editManualItems.filter(m => m.isOpen).length > 0 && (
                            <div className="mt-2 space-y-1">
                              {editManualItems.filter(m => m.isOpen).map(mi => (
                                <div key={mi.tempId} className="flex items-center justify-between bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
                                  <div>
                                    <p className="text-sm font-medium text-gray-700">{mi.name}</p>
                                    <p className="text-xs text-gray-400">₹{mi.price} × {mi.qty} = ₹{mi.price * mi.qty}</p>
                                  </div>
                                  <button onClick={() => setEditManualItems(prev => prev.filter(m => m.tempId !== mi.tempId))}
                                    className="text-xs bg-red-100 text-red-500 px-2 py-1 rounded-full">✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="px-4 py-3 space-y-2">
                          {editTotals && (
                            <div className="bg-white rounded-xl px-4 py-3 flex justify-between items-center border border-gray-100 mb-2">
                              <span className="text-sm text-gray-600">Updated Total</span>
                              <span className="text-xl font-bold text-orange-500">₹{editTotals.finalAmount}</span>
                            </div>
                          )}
                          <button onClick={() => openReprintPreview(bill)}
                            className="w-full bg-green-500 text-white py-2.5 rounded-xl font-bold hover:bg-green-600">
                            🖨️ Preview & Reprint
                          </button>
                          <button onClick={closeEdit} className="w-full bg-gray-100 text-gray-600 py-2 rounded-xl text-sm font-medium">Cancel Edits</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Settled Bills */}
        {!loading && settledBills.length > 0 && (
          <div>
            <h2 className="text-base font-bold text-green-600 mb-3">
              ✅ Settled Bills ({settledBills.length})
              <span className="ml-2 text-xs font-normal text-gray-400">🔒 Locked after settlement</span>
            </h2>
            <div className="space-y-3">
              {settledBills.map(bill => (
                <div key={bill._key} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm opacity-90">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-bold text-gray-700">{bill.table_name_snapshot || 'Table'}</p>
                      <p className="text-xs text-gray-400">{toIST(bill.paid_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-gray-700">₹{bill.final_amount}</p>
                      <PayBadge type={bill.payment_type} split={bill.split_payment} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    {bill.order_items?.map((item, i) => (
                      <div key={i} className="flex justify-between text-xs text-gray-400">
                        <span>{item.food_items?.name} × {item.quantity}</span>
                        <span>₹{item.price_at_order * item.quantity}</span>
                      </div>
                    ))}
                    {(bill.open_items || []).map((oi, i) => (
                      <div key={`open-${i}`} className="flex justify-between text-xs text-purple-400">
                        <span>{oi.dept === 'Food' ? '🍽' : oi.dept === 'Beverage' ? '🥤' : '🍺'} {oi.name} × {oi.qty} <span className="opacity-60">(open)</span></span>
                        <span>₹{oi.price * oi.qty}</span>
                      </div>
                    ))}
                  </div>
                  {bill.split_payment && (
                    <div className="mt-2 bg-indigo-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-indigo-600 font-medium mb-1">🔀 Split Payment</p>
                      {Object.entries(bill.split_payment).filter(([, v]) => v > 0).map(([method, amt]) => (
                        <div key={method} className="flex justify-between text-xs text-indigo-500">
                          <span>{method === 'cash' ? '💵 Cash' : method === 'upi' ? '📱 UPI' : '💳 Card'}</span>
                          <span>₹{amt}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(bill.service_charge_amt > 0 || bill.discount_amt > 0) && (
                    <div className="border-t mt-2 pt-2 space-y-0.5">
                      {bill.service_charge_amt > 0 && <div className="flex justify-between text-xs text-gray-400"><span>Service ({bill.service_charge_pct}%)</span><span>+₹{bill.service_charge_amt}</span></div>}
                      {bill.discount_amt > 0 && <div className="flex justify-between text-xs text-green-600"><span>Discount</span><span>-₹{bill.discount_amt}</span></div>}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1 text-xs text-gray-300"><span>🔒</span><span>Locked after settlement</span></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
