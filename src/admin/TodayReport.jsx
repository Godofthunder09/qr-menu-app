import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})

// ─────────────────────────────────────────────────────────────────────
// FIX (root cause of the "3 Mineral Water still shows after reducing
// to 1" bug):
//
// The OLD grouping key was `${table_name_snapshot}__${paid_at.substr(0,16)}`
// i.e. table name + the MINUTE the order was paid (truncated to the
// minute, seconds/millis dropped). This is NOT a unique key. Any two
// distinct `orders` rows for the same table that happen to get paid in
// the same clock-minute (e.g. two rounds billed back-to-back, or a
// retry) get silently merged into ONE display "bill", and their
// order_items arrays get CONCATENATED with `[...a, ...b]`.
//
// Concatenating item arrays is the bug: it doesn't replace/dedupe by
// food_item — it just appends. So if Round 1 had "Mineral Water x3" as
// one order_items row and Round 2 (billed in the same minute, after you
// reduced quantity down in the editor) had "Mineral Water x1" as a
// SEPARATE order_items row belonging to a SEPARATE order, the grouped
// bill showed BOTH rows: "Mineral Water x3" AND "Mineral Water x1" —
// while `final_amount` on the row that matters was computed fresh and
// correctly at print time, so the ₹ total looked right (₹30) but the
// item list still showed x3.
//
// THE FIX: never merge order_items across DIFFERENT order ids for
// display unless they share the EXACT SAME `paid_at` timestamp (full
// ISO string, not truncated to the minute). An identical-to-the-
// millisecond `paid_at` can only happen when Dashboard's
// `handlePrintAndSave` stamped the SAME `nowIST` value across every
// order in `snapshot.orderIds` in a single write-back loop — i.e. they
// are genuinely part of the same bill. Different bills (different
// print actions) will never share the exact same timestamp.
// ─────────────────────────────────────────────────────────────────────
const groupOrdersIntoBills = (orders) => {
  const map = {}
  orders.forEach(order => {
    // Exact paid_at match (not truncated to the minute) + table name.
    const key = `${order.table_name_snapshot || ''}__${order.paid_at || order.id}`
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
        discount_type: order.discount_type || 'percent',
        discount_value: order.discount_value || 0,
        discount_amt: order.discount_amt || 0,
        discount_reason: order.discount_reason || '',
        final_amount: order.final_amount || 0,
        order_items: [...(order.order_items || [])],
        open_items: [...(order.open_items_json || [])],
      }
    } else {
      map[key]._orderIds.push(order.id)
      map[key].order_items = [...map[key].order_items, ...(order.order_items || [])]
      // If genuinely-merged (same exact paid_at), sum the money fields
      // too, since each underlying orders row only carries its own
      // slice of subtotal/final_amount.
      map[key].subtotal += order.subtotal || 0
      map[key].service_charge_amt += order.service_charge_amt || 0
      map[key].discount_amt += order.discount_amt || 0
      map[key].final_amount += order.final_amount || 0
      if (order.settlement_status === 'pending') map[key].settlement_status = 'pending'
    }
  })
  return Object.values(map)
}

// ── Merge order_items by food_item_id for display (cosmetic only) ──────
// This merge is safe: it only ever runs WITHIN a single already-correct
// bill's order_items array (post the fix above), so summing quantities
// here reflects the true, current, post-edit quantity — not a stale one.
const mergeOrderItemsForDisplay = (orderItems = []) => {
  const map = {}
  orderItems.forEach((item, idx) => {
    const groupKey = item.food_item_id || item.food_items?.name || `idx-${idx}`
    if (!map[groupKey]) {
      map[groupKey] = {
        name: item.food_items?.name || 'Unknown',
        price_at_order: item.price_at_order,
        quantity: 0,
        _rowRefs: [],
      }
    }
    map[groupKey].quantity += item.quantity
    map[groupKey]._rowRefs.push({ id: item.id, quantity: item.quantity })
  })
  return Object.values(map)
}

const LIQUOR_KEYWORDS = [
  'beer','wine','whisky','whiskey','vodka','rum','gin','tequila','brandy',
  'champagne','cocktail','scotch','bourbon','ale','lager','cider','sake','mead',
  'port','liquor','spirits','pint','draft','draught','feni','arrack','toddy','sangria'
]
const isLiquorItem = (name = '') => LIQUOR_KEYWORDS.some(k => name.toLowerCase().includes(k))

// ── Receipt HTML builder (same structure as Dashboard) ─────────────────
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
${lines.discountAmt > 0 ? `<div class="row"><span>Discount${lines.discountReason ? ` (${lines.discountReason})` : ''}</span><span>-Rs.${lines.discountAmt}</span></div>` : ''}
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

  // ── Settlement state ────────────────────────────────────────────────
  const [showSettleModal, setShowSettleModal] = useState(false)
  const [settleBill, setSettleBill] = useState(null)
  const [settleType, setSettleType] = useState('cash')
  const [splitMode, setSplitMode] = useState('cash+upi')
  const [splitAmounts, setSplitAmounts] = useState({ first: '', second: '' })
  const [splitError, setSplitError] = useState('')

  // ── Modify (discount-only) state ────────────────────────────────────
  const [modifyingBillKey, setModifyingBillKey] = useState(null)
  const [modifyingBill, setModifyingBill] = useState(null)
  const [modDiscountType, setModDiscountType] = useState('percent')
  const [modDiscountValue, setModDiscountValue] = useState('')
  const [modDiscountReason, setModDiscountReason] = useState('')
  const [modDiscountReasonError, setModDiscountReasonError] = useState(false)
  const [modSaving, setModSaving] = useState(false)

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
  }, [])

  // ── Fetch today's bills ─────────────────────────────────────────────
  const fetchTodayBills = async () => {
    setLoading(true)
    const today = todayIST()
    const startISO = new Date(today + 'T00:00:00+05:30').toISOString()
    const endISO   = new Date(today + 'T23:59:59+05:30').toISOString()
    const { data, error } = await supabase
      .from('orders')
      .select(`id, payment_type, split_payment, is_paid, paid_at, settlement_status,
        subtotal, service_charge_pct, service_charge_amt,
        discount_type, discount_value, discount_amt, discount_reason,
        final_amount, table_name_snapshot, open_items_json,
        order_items(id, food_item_id, quantity, price_at_order, food_items(name))`)
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

  // ── Compute discount preview for the Modify panel ───────────────────
  const computeModifyTotals = (bill, discType, discVal) => {
    if (!bill) return null
    const subtotal = bill.subtotal || 0
    const serviceChargeAmt = bill.service_charge_amt || 0
    const afterService = subtotal + serviceChargeAmt
    const dv = parseFloat(discVal) || 0
    const discountAmt = discType === 'percent'
      ? Math.round(afterService * dv / 100)
      : Math.min(dv, afterService)
    const finalAmount = afterService - discountAmt
    return { subtotal, serviceChargeAmt, discountAmt, finalAmount }
  }

  const modTotals = modifyingBill
    ? computeModifyTotals(modifyingBill, modDiscountType, modDiscountValue)
    : null

  // ── Open Modify panel ───────────────────────────────────────────────
  const openModify = (bill) => {
    setModifyingBillKey(bill._key)
    setModifyingBill(bill)
    setModDiscountType(bill.discount_type || 'percent')
    setModDiscountValue(bill.discount_value ? bill.discount_value.toString() : '')
    setModDiscountReason(bill.discount_reason || '')
    setModDiscountReasonError(false)
  }

  const closeModify = () => {
    setModifyingBillKey(null)
    setModifyingBill(null)
    setModDiscountType('percent')
    setModDiscountValue('')
    setModDiscountReason('')
    setModDiscountReasonError(false)
  }

  // ── Print the modified bill receipt ────────────────────────────────
  const printModifiedBill = useCallback((bill, totals, discReason) => {
    if (!bill || !totals) return

    const allItems = bill.order_items || []
    const openItems = bill.open_items || []

    const mergeForReceipt = (items) => {
      const map = {}
      items.forEach(i => {
        const name = i.food_items?.name || 'Unknown'
        if (!map[name]) map[name] = { name, price: i.price_at_order, qty: 0 }
        map[name].qty += i.quantity
      })
      return Object.values(map)
    }

    const foodMerged  = mergeForReceipt(allItems.filter(i => !isLiquorItem(i.food_items?.name)))
    const liquorMerged = mergeForReceipt(allItems.filter(i =>  isLiquorItem(i.food_items?.name)))
    const openFood    = openItems.filter(oi => oi.dept !== 'Liquor')
    const openLiquor  = openItems.filter(oi => oi.dept === 'Liquor')

    const foodSubtotal   = foodMerged.reduce((s, i) => s + i.price * i.qty, 0) + openFood.reduce((s, oi) => s + oi.price * oi.qty, 0)
    const liquorSubtotal = liquorMerged.reduce((s, i) => s + i.price * i.qty, 0) + openLiquor.reduce((s, oi) => s + oi.price * oi.qty, 0)

    const foodLines = [
      ...foodMerged.map(i => `<div class="row"><span>${i.name} x${i.qty}</span><span>Rs.${i.price * i.qty}</span></div>`),
      ...openFood.map(oi => `<div class="row"><span>${oi.name} x${oi.qty}</span><span>Rs.${oi.price * oi.qty}</span></div>`)
    ]
    const liquorLines = [
      ...liquorMerged.map(i => `<div class="row"><span>${i.name} x${i.qty}</span><span>Rs.${i.price * i.qty}</span></div>`),
      ...openLiquor.map(oi => `<div class="row"><span>${oi.name} x${oi.qty}</span><span>Rs.${oi.price * oi.qty}</span></div>`)
    ]

    const foodSection = foodLines.length > 0 ? `
      <div class="section-title">FOOD</div>
      ${foodLines.join('')}
      <div class="row bold"><span>Food Subtotal</span><span>Rs.${foodSubtotal}</span></div>
      <div class="div"></div>` : ''

    const liquorSection = liquorLines.length > 0 ? `
      <div class="section-title">LIQUOR</div>
      ${liquorLines.join('')}
      <div class="row bold"><span>Liquor Subtotal</span><span>Rs.${liquorSubtotal}</span></div>
      <div class="div"></div>` : ''

    const now = new Date()
    const html = buildHtmlReceipt({
      restaurantName: restaurant.name,
      address:        restaurant.address,
      phone:          restaurant.phone,
      gstNumber:      restaurant.gst_number,
      footerNote:     restaurant.footer_note,
      tableName:      bill.table_name_snapshot,
      date:           formatDate(now.toISOString()),
      time:           toIST(now.toISOString()),
      foodSection,
      liquorSection,
      subtotal:          totals.subtotal,
      serviceChargePct:  bill.service_charge_pct,
      serviceChargeAmt:  totals.serviceChargeAmt,
      discountAmt:       totals.discountAmt,
      discountReason:    discReason,
      finalAmount:       totals.finalAmount,
      splitInfo:         null,
    })

    const w = window.open('', '_blank', 'width=400,height=600')
    if (!w) { alert('⚠️ Pop-up blocked — allow pop-ups then try again.'); return }
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }, [restaurant])

  // ── Save discount changes + print receipt ───────────────────────────
  const handleSaveModify = async () => {
    const dv = parseFloat(modDiscountValue) || 0
    if (dv > 0 && !modDiscountReason.trim()) {
      setModDiscountReasonError(true)
      return
    }
    setModDiscountReasonError(false)
    if (!modifyingBill || !modTotals) return
    setModSaving(true)
    try {
      const newFinalAmount = modTotals.finalAmount
      const oldFinalAmount = modifyingBill.final_amount || 0
      const amtDelta = newFinalAmount - oldFinalAmount

      // Update every order row belonging to this bill.
      // NOTE: when this bill is a genuine multi-order merge (identical
      // paid_at across _orderIds), the discount is intentionally applied
      // uniformly across each underlying order row's own discount fields
      // — matching prior behavior.
      for (const orderId of modifyingBill._orderIds) {
        await supabase.from('orders').update({
          discount_type:   modDiscountType,
          discount_value:  dv,
          discount_amt:    modTotals.discountAmt,
          discount_reason: modDiscountReason.trim(),
          final_amount:    newFinalAmount,
        }).eq('id', orderId)
      }

      // Patch daily_reports if bill is already settled so totals stay accurate
      if (
        (modifyingBill.settlement_status === 'settled' || modifyingBill.settlement_status === 'day_closed')
        && Math.abs(amtDelta) > 0
      ) {
        const today = todayIST()
        const { data: dr } = await supabase
          .from('daily_reports').select('*').eq('report_date', today).single()
        if (dr) {
          const pt   = modifyingBill.payment_type
          const sp   = modifyingBill.split_payment
          const base = oldFinalAmount || 1
          await supabase.from('daily_reports').update({
            total_revenue: dr.total_revenue + amtDelta,
            cash_revenue:  dr.cash_revenue  + (sp ? Math.round(amtDelta * (sp.cash || 0) / base) : pt === 'cash' ? amtDelta : 0),
            upi_revenue:   dr.upi_revenue   + (sp ? Math.round(amtDelta * (sp.upi  || 0) / base) : pt === 'upi'  ? amtDelta : 0),
            card_revenue:  dr.card_revenue  + (sp ? Math.round(amtDelta * (sp.card || 0) / base) : pt === 'card' ? amtDelta : 0),
            updated_at: new Date().toISOString()
          }).eq('report_date', today)
        }
      }

      printModifiedBill(modifyingBill, modTotals, modDiscountReason.trim())

      closeModify()
      await fetchTodayBills()
    } catch (err) {
      alert('❌ Error: ' + err.message)
    } finally {
      setModSaving(false)
    }
  }

  // ── Settlement ──────────────────────────────────────────────────────
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
      const firstAmt  = parseFloat(splitAmounts.first)  || 0
      const secondAmt = parseFloat(splitAmounts.second) || 0
      const total = settleBill.final_amount || 0
      if (firstAmt <= 0 && secondAmt <= 0) { setSplitError('Enter amounts for both payment methods'); return }
      if (Math.abs((firstAmt + secondAmt) - total) > 1) {
        setSplitError(`Amounts must add up to ₹${total} (currently ₹${firstAmt + secondAmt})`); return
      }
      setSplitError('')
      paymentType  = firstAmt >= secondAmt ? firstMethod : secondMethod
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
    const amt     = settleBill.final_amount || 0
    const svc     = settleBill.service_charge_amt || 0
    const cashAmt = splitPayload ? (splitPayload.cash || 0) : (paymentType === 'cash' ? amt : 0)
    const upiAmt  = splitPayload ? (splitPayload.upi  || 0) : (paymentType === 'upi'  ? amt : 0)
    const cardAmt = splitPayload ? (splitPayload.card || 0) : (paymentType === 'card' ? amt : 0)

    if (existing) {
      await supabase.from('daily_reports').update({
        total_orders:         existing.total_orders + 1,
        total_revenue:        existing.total_revenue + amt,
        cash_revenue:         existing.cash_revenue  + cashAmt,
        upi_revenue:          existing.upi_revenue   + upiAmt,
        card_revenue:         existing.card_revenue  + cardAmt,
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

    setSettling(null)
    setShowSettleModal(false)
    fetchTodayBills()
  }

  // ── Close Day ───────────────────────────────────────────────────────
  const closeDay = async () => {
    const pendingBills = bills.filter(b => b.settlement_status === 'pending')
    if (pendingBills.length > 0) {
      alert(`⚠️ ${pendingBills.length} bills are still unsettled.`)
      setShowCloseDay(false)
      return
    }
    setClosingDay(true)
    const today = todayIST()
    const startISO = new Date(today + 'T00:00:00+05:30').toISOString()
    const endISO   = new Date(today + 'T23:59:59+05:30').toISOString()
    await supabase.from('orders').update({ settlement_status: 'day_closed' })
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
    setClosingDay(false)
    setShowCloseDay(false)
    alert('✅ Day closed!')
    fetchTodayBills()
  }

  const pendingBills = bills.filter(b => b.settlement_status === 'pending')
  const settledBills = bills.filter(b => b.settlement_status === 'settled' || b.settlement_status === 'day_closed')

  const handleSplitFirstChange = (val) => {
    setSplitError('')
    const v = parseFloat(val) || 0
    const total = settleBill?.final_amount || 0
    const remaining = Math.max(0, total - v)
    setSplitAmounts({ first: val, second: remaining > 0 ? String(remaining) : '' })
  }

  const PayBadge = ({ type, split }) => {
    if (split) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">🔀 Split</span>
    if (!type || type === 'pending') return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700">⏳ Pending</span>
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${type === 'cash' ? 'bg-green-100 text-green-600' : type === 'upi' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
      {type === 'cash' ? '💵 Cash' : type === 'upi' ? '📱 UPI' : '💳 Card'}
    </span>
  }

  const { firstMethod, secondMethod } = parseSplitMode(splitMode)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Settlement Modal ──────────────────────────────────────────── */}
      {showSettleModal && settleBill && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-bold text-gray-800 mb-1">💰 Settle Bill</h2>
            <p className="text-sm text-gray-400 mb-3">{settleBill.table_name_snapshot || 'Table'}</p>

            <div className="bg-gray-50 rounded-xl p-3 mb-4 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-500"><span>Subtotal</span><span>₹{settleBill.subtotal}</span></div>
              {settleBill.service_charge_amt > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Service ({settleBill.service_charge_pct}%)</span><span>+₹{settleBill.service_charge_amt}</span>
                </div>
              )}
              {settleBill.discount_amt > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount{settleBill.discount_reason ? ` (${settleBill.discount_reason})` : ''}</span>
                  <span>-₹{settleBill.discount_amt}</span>
                </div>
              )}
              <div className="border-t pt-2 flex justify-between font-bold text-gray-800">
                <span>Amount to Collect</span>
                <span className="text-orange-500 text-lg">₹{settleBill.final_amount}</span>
              </div>
            </div>

            <p className="text-sm font-medium text-gray-700 mb-2">How did they pay?</p>
            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {[
                { id: 'cash',  label: '💵 Cash' },
                { id: 'upi',   label: '📱 UPI' },
                { id: 'card',  label: '💳 Card' },
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
                    <input type="number" min="0" max={settleBill.final_amount}
                      value={splitAmounts.first} onChange={e => handleSplitFirstChange(e.target.value)}
                      placeholder="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      {secondMethod === 'cash' ? '💵 Cash' : secondMethod === 'upi' ? '📱 UPI' : '💳 Card'} ₹
                    </label>
                    <input type="number" min="0" max={settleBill.final_amount}
                      value={splitAmounts.second} onChange={e => { setSplitError(''); setSplitAmounts(p => ({ ...p, second: e.target.value })) }}
                      placeholder="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  </div>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Entered total:</span>
                  <span className={`font-bold ${Math.abs(((parseFloat(splitAmounts.first)||0) + (parseFloat(splitAmounts.second)||0)) - (settleBill.final_amount||0)) <= 1 ? 'text-green-600' : 'text-red-500'}`}>
                    ₹{(parseFloat(splitAmounts.first)||0) + (parseFloat(splitAmounts.second)||0)} / ₹{settleBill.final_amount}
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

      {/* ── Close Day Modal ───────────────────────────────────────────── */}
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

        {/* Summary Cards */}
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

        {/* ── Pending Bills ─────────────────────────────────────────────── */}
        {!loading && pendingBills.length > 0 && (
          <div className="mb-6">
            <h2 className="text-base font-bold text-red-500 mb-3">⏳ Unsettled Bills ({pendingBills.length})</h2>
            <div className="space-y-4">
              {pendingBills.map(bill => {
                const isModifying  = modifyingBillKey === bill._key
                const displayLines = mergeOrderItemsForDisplay(bill.order_items)
                const liveModTotals = isModifying
                  ? computeModifyTotals(bill, modDiscountType, modDiscountValue)
                  : null

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
                            ₹{isModifying && liveModTotals ? liveModTotals.finalAmount : bill.final_amount}
                          </p>
                          <PayBadge type={bill.payment_type} split={bill.split_payment} />
                        </div>
                      </div>

                      {/* Item list — exact DB values, read-only */}
                      <div className="space-y-1 mb-2">
                        {displayLines.map((line, i) => (
                          <div key={i} className="flex justify-between text-xs text-gray-500">
                            <span>{line.name} × {line.quantity}</span>
                            <span>₹{line.price_at_order * line.quantity}</span>
                          </div>
                        ))}
                        {(bill.open_items || []).map((oi, i) => (
                          <div key={`open-${i}`} className="flex justify-between text-xs text-purple-600">
                            <span>
                              {oi.dept === 'Food' ? '🍽' : oi.dept === 'Beverage' ? '🥤' : '🍺'} {oi.name} × {oi.qty}{' '}
                              <span className="opacity-60">(open)</span>
                            </span>
                            <span>₹{oi.price * oi.qty}</span>
                          </div>
                        ))}
                      </div>

                      {/* Subtotal / service / existing discount */}
                      <div className="border-t pt-2 space-y-0.5 mb-3">
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>Subtotal</span><span>₹{bill.subtotal}</span>
                        </div>
                        {bill.service_charge_amt > 0 && (
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>Service ({bill.service_charge_pct}%)</span><span>+₹{bill.service_charge_amt}</span>
                          </div>
                        )}
                        {bill.discount_amt > 0 && (
                          <div className="flex justify-between text-xs text-green-600">
                            <span>Discount{bill.discount_reason ? ` (${bill.discount_reason})` : ''}</span>
                            <span>-₹{bill.discount_amt}</span>
                          </div>
                        )}
                      </div>

                      {!isModifying && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => openSettle(bill)}
                            className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-orange-600">
                            💳 Settle Payment
                          </button>
                          <button onClick={() => openModify(bill)}
                            className="bg-purple-100 text-purple-600 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-purple-200">
                            🏷️ Modify
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ── Modify Panel (discount only) ──────────────────── */}
                    {isModifying && (
                      <div className="border-t bg-purple-50">
                        <div className="px-4 pt-3 pb-1">
                          <div className="bg-purple-100 border border-purple-200 rounded-xl px-3 py-2 flex items-center gap-2">
                            <span>🏷️</span>
                            <p className="text-xs text-purple-700 font-medium">
                              Discount only — item quantities are locked after printing.
                            </p>
                          </div>
                        </div>

                        <div className="px-4 py-3 space-y-3">
                          {/* Billed items read-only reference */}
                          <div>
                            <p className="text-xs font-bold text-gray-500 uppercase mb-1">🍽 Billed Items (locked)</p>
                            <div className="bg-white rounded-xl px-3 py-2 space-y-1">
                              {displayLines.map((line, i) => (
                                <div key={i} className="flex justify-between text-xs text-gray-500">
                                  <span>{line.name} × {line.quantity}</span>
                                  <span>₹{line.price_at_order * line.quantity}</span>
                                </div>
                              ))}
                              {(bill.open_items || []).map((oi, i) => (
                                <div key={`open-${i}`} className="flex justify-between text-xs text-purple-500">
                                  <span>{oi.name} × {oi.qty}</span>
                                  <span>₹{oi.price * oi.qty}</span>
                                </div>
                              ))}
                              <div className="border-t pt-1 flex justify-between text-xs font-semibold text-gray-600">
                                <span>Subtotal</span><span>₹{bill.subtotal}</span>
                              </div>
                              {bill.service_charge_amt > 0 && (
                                <div className="flex justify-between text-xs text-gray-500">
                                  <span>Service ({bill.service_charge_pct}%)</span><span>+₹{bill.service_charge_amt}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Discount controls */}
                          <div className="bg-white rounded-xl p-3 space-y-3">
                            <p className="text-xs font-bold text-gray-500 uppercase">Apply Discount</p>
                            <div className="flex items-center gap-2">
                              <select
                                value={modDiscountType}
                                onChange={e => { setModDiscountType(e.target.value); setModDiscountValue('') }}
                                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                                <option value="percent">% Percent</option>
                                <option value="flat">₹ Flat</option>
                              </select>
                              <input
                                type="number" min="0"
                                value={modDiscountValue}
                                onChange={e => { setModDiscountValue(e.target.value); setModDiscountReasonError(false) }}
                                placeholder={modDiscountType === 'percent' ? 'e.g. 10' : 'e.g. 50'}
                                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                              />
                              {liveModTotals && liveModTotals.discountAmt > 0 && (
                                <span className="text-green-600 text-sm font-bold">-₹{liveModTotals.discountAmt}</span>
                              )}
                            </div>

                            {/* Reason — mandatory when discount > 0 */}
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">
                                Reason {(parseFloat(modDiscountValue) || 0) > 0 && <span className="text-red-500">*</span>}
                              </label>
                              <input
                                type="text"
                                value={modDiscountReason}
                                onChange={e => { setModDiscountReason(e.target.value); setModDiscountReasonError(false) }}
                                placeholder="e.g. Regular customer, special offer…"
                                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 ${modDiscountReasonError ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                              />
                              {modDiscountReasonError && (
                                <p className="text-red-500 text-xs mt-1">⚠️ Reason is required to apply a discount.</p>
                              )}
                            </div>

                            {/* Live total preview */}
                            {liveModTotals && (
                              <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 space-y-1">
                                <div className="flex justify-between text-xs text-gray-500">
                                  <span>After service charge</span>
                                  <span>₹{liveModTotals.subtotal + liveModTotals.serviceChargeAmt}</span>
                                </div>
                                {liveModTotals.discountAmt > 0 && (
                                  <div className="flex justify-between text-xs text-green-600">
                                    <span>Discount</span><span>-₹{liveModTotals.discountAmt}</span>
                                  </div>
                                )}
                                <div className="border-t pt-1 flex justify-between font-bold text-gray-800">
                                  <span>New Total</span>
                                  <span className="text-orange-500 text-lg">₹{liveModTotals.finalAmount}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <button onClick={closeModify}
                              className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-medium">
                              Cancel
                            </button>
                            <button onClick={handleSaveModify} disabled={modSaving}
                              className="flex-1 bg-purple-500 text-white py-2.5 rounded-xl font-bold hover:bg-purple-600 disabled:opacity-50 flex items-center justify-center gap-2">
                              {modSaving ? '⏳ Saving...' : '🖨️ Print & Save'}
                            </button>
                          </div>
                          <p className="text-xs text-gray-400 text-center">
                            Saves discount to DB and prints updated receipt in one click
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Settled Bills ─────────────────────────────────────────────── */}
        {!loading && settledBills.length > 0 && (
          <div>
            <h2 className="text-base font-bold text-green-600 mb-3">
              ✅ Settled Bills ({settledBills.length})
              <span className="ml-2 text-xs font-normal text-gray-400">🔒 Locked after settlement</span>
            </h2>
            <div className="space-y-3">
              {settledBills.map(bill => {
                const displayLines = mergeOrderItemsForDisplay(bill.order_items)
                return (
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
                      {displayLines.map((line, i) => (
                        <div key={i} className="flex justify-between text-xs text-gray-400">
                          <span>{line.name} × {line.quantity}</span>
                          <span>₹{line.price_at_order * line.quantity}</span>
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
                        {bill.service_charge_amt > 0 && (
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>Service ({bill.service_charge_pct}%)</span><span>+₹{bill.service_charge_amt}</span>
                          </div>
                        )}
                        {bill.discount_amt > 0 && (
                          <div className="flex justify-between text-xs text-green-600">
                            <span>Discount{bill.discount_reason ? ` (${bill.discount_reason})` : ''}</span>
                            <span>-₹{bill.discount_amt}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-1 text-xs text-gray-300">
                      <span>🔒</span><span>Locked after settlement</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
