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
  'champagne','cocktail','scotch','bourbon','ale','lager','cider','sake','mead',
  'port','liquor','spirits','pint','draft','draught','feni','arrack','toddy','sangria'
]
const isLiquorItem = (name = '') => LIQUOR_KEYWORDS.some(k => name.toLowerCase().includes(k))

const mergeItems = (items) => {
  const map = {}
  items.forEach(item => {
    const name = item.food_items?.name || item.name || 'Unknown'
    if (map[name]) {
      map[name].quantity += item.quantity
      map[name].total += item.price_at_order * item.quantity
    } else {
      map[name] = { ...item, quantity: item.quantity, total: item.price_at_order * item.quantity }
    }
  })
  return Object.values(map)
}

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
${lines.serviceChargeAmt > 0 ? `<div class="row"><span>Service (${lines.serviceChargePct}%)</span><span>Rs.${lines.serviceChargeAmt}</span></div>` : ''}
${lines.discountAmt > 0 ? `<div class="row"><span>Discount${lines.discountType === 'percent' ? ` (${lines.discountValue}%)` : ' (Flat)'}</span><span>-Rs.${lines.discountAmt}</span></div>` : ''}
${lines.discountAmt > 0 && lines.discountReason ? `<div class="center" style="font-size:11px;color:#666">Reason: ${lines.discountReason}</div>` : ''}
<div class="div"></div>
<div class="row big"><span>TOTAL</span><span>Rs.${lines.finalAmount}</span></div>
<div class="div"></div>
<div class="center">${lines.footerNote || 'Thank you! Visit again!'}</div>
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
  const [saving, setSaving] = useState(false)

  const [restaurant, setRestaurant] = useState({
    name: 'My Restaurant', address: '', phone: '',
    gst_number: '', footer_note: 'Thank you! Visit again!'
  })

  const [showPreview, setShowPreview] = useState(false)
  const [payTableId, setPayTableId] = useState(null)
  const [serviceChargePct, setServiceChargePct] = useState(0)
  const [discountType, setDiscountType] = useState('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [discountReasonError, setDiscountReasonError] = useState(false)

  const [showItemEditor, setShowItemEditor] = useState(false)
  const [allFoodItems, setAllFoodItems] = useState([])
  const [menuSearch, setMenuSearch] = useState('')

  // ── itemQtyOverrides — keyed by the REAL order_items row id ─────────
  const [itemQtyOverrides, setItemQtyOverrides] = useState({})

  const [manualItems, setManualItems] = useState([])
  const [showOpenForm, setShowOpenForm] = useState(false)
  const [openDept, setOpenDept] = useState('Food')
  const [openName, setOpenName] = useState('')
  const [openPrice, setOpenPrice] = useState('')
  const [openQty, setOpenQty] = useState(1)

  // ── Frozen billing snapshot ──────────────────────────────────────────
  const billingSnapshotRef = useRef({ tableId: null, items: [] })

  const prevOrderIds = useRef(new Set())
  const audioCtxRef = useRef(null)
  const navigate = useNavigate()

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

  useEffect(() => {
    supabase.from('food_items').select('id, name, price, is_available')
      .eq('is_available', true).order('name')
      .then(({ data }) => setAllFoodItems(data || []))
  }, [])

  const initAudio = () => {
    if (!audioCtxRef.current)
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    setSoundReady(true)
  }

  const playTingTing = useCallback(() => {
    try {
      if (!audioCtxRef.current) return
      const ctx = audioCtxRef.current
      const bell = (t, freq) => {
        const o = ctx.createOscillator(); const g = ctx.createGain()
        o.connect(g); g.connect(ctx.destination)
        o.type = 'sine'; o.frequency.value = freq
        g.gain.setValueAtTime(0.5, t)
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0)
        o.start(t); o.stop(t + 1.0)
      }
      bell(ctx.currentTime, 880); bell(ctx.currentTime + 0.6, 1100)
    } catch (e) {}
  }, [])

  const fetchAll = useCallback(async () => {
    const { data: tablesData } = await supabase.from('tables').select('*').order('created_at')
    setTables(tablesData || [])
    const { data: ordersData } = await supabase
      .from('orders')
      .select(`*, tables(table_name), order_items(id, food_item_id, quantity, price_at_order, note, food_items(name))`)
      .eq('is_paid', false).order('created_at', { ascending: false })
    if (ordersData) {
      const addedOrderIds = new Set(); const addedTableIds = new Set()
      ordersData.forEach(o => {
        if (!prevOrderIds.current.has(o.id) && o.created_at > sessionStart) {
          addedOrderIds.add(o.id); addedTableIds.add(o.table_id)
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

  // ── Build a frozen, row-id-keyed snapshot for a table ────────────────
  // FIX: rows whose current DB quantity is already 0 are skipped. A row
  // can legitimately sit at quantity 0 now (see handlePrintAndSave below
  // — we update quantity to 0 instead of deleting, so a failed delete
  // can never leave a "ghost" row with stale quantity behind). A 0-qty
  // row is effectively already removed and shouldn't reappear in the
  // item editor as if it still had stock to reduce.
  const buildSnapshot = (tableId) => {
    const tOrders = orders.filter(o => o.table_id === tableId)
    const rows = []
    tOrders.forEach(order => {
      ;(order.order_items || []).forEach(item => {
        if ((item.quantity || 0) <= 0) return
        rows.push({
          rowId: item.id,
          orderId: order.id,
          food_items: item.food_items,
          price_at_order: item.price_at_order,
          originalQty: item.quantity,
          note: item.note,
        })
      })
    })
    return { tableId, items: rows, orderIds: tOrders.map(o => o.id) }
  }

  const selectTable = (table) => {
    setSelectedTable(table)
    setNewOrderTables(prev => { const n = new Set(prev); n.delete(table.id); return n })
    setItemQtyOverrides({})
    setManualItems([])
    setShowItemEditor(false); setShowOpenForm(false)
    setMenuSearch('')
    billingSnapshotRef.current = buildSnapshot(table.id)
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  const manualAsOrderItems = manualItems.map(mi => ({
    food_items: { name: mi.name },
    price_at_order: mi.price,
    quantity: mi.qty,
    _key: `manual:${mi.tempId}`,
    _isManual: true
  }))

  const getEffectiveItems = useCallback((tableId) => {
    const snapshot = billingSnapshotRef.current.tableId === tableId
      ? billingSnapshotRef.current
      : buildSnapshot(tableId)
    const result = []
    snapshot.items.forEach(row => {
      const key = `row:${row.rowId}`
      const effectiveQty = itemQtyOverrides.hasOwnProperty(key)
        ? itemQtyOverrides[key]
        : row.originalQty
      if (effectiveQty > 0) {
        result.push({
          food_items: row.food_items,
          price_at_order: row.price_at_order,
          quantity: effectiveQty,
          _rowId: row.rowId,
          _orderId: row.orderId,
          _key: key,
          _originalQty: row.originalQty,
        })
      }
    })
    manualAsOrderItems.forEach(mi => result.push(mi))
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemQtyOverrides, manualAsOrderItems])

  const computeTotals = useCallback((tableId) => {
    const items = getEffectiveItems(tableId)
    const rawFoodItems = items.filter(i => !isLiquorItem(i.food_items?.name))
    const rawLiquorItems = items.filter(i => isLiquorItem(i.food_items?.name))
    const foodItems = mergeItems(rawFoodItems)
    const liquorItems = mergeItems(rawLiquorItems)
    const foodSubtotal = foodItems.reduce((s, i) => s + i.total, 0)
    const liquorSubtotal = liquorItems.reduce((s, i) => s + i.total, 0)
    const subtotal = foodSubtotal + liquorSubtotal
    const serviceChargeAmt = Math.round(subtotal * serviceChargePct / 100)
    const afterService = subtotal + serviceChargeAmt
    const dv = parseFloat(discountValue) || 0
    const discountAmt = discountType === 'percent'
      ? Math.round(afterService * dv / 100) : Math.min(dv, afterService)
    const finalAmount = afterService - discountAmt
    return {
      items, rawFoodItems, rawLiquorItems, foodItems, liquorItems,
      foodSubtotal, liquorSubtotal, subtotal, serviceChargeAmt, discountAmt, finalAmount
    }
  }, [getEffectiveItems, serviceChargePct, discountType, discountValue])

  const openPreview = (tableId) => {
    if (billingSnapshotRef.current.tableId !== tableId) {
      billingSnapshotRef.current = buildSnapshot(tableId)
    }
    setPayTableId(tableId)
    setServiceChargePct(0); setDiscountType('percent')
    setDiscountValue(''); setDiscountReason(''); setDiscountReasonError(false)
    setShowPreview(true)
  }

  const setItemQty = (rowId, originalQty, delta) => {
    const key = `row:${rowId}`
    setItemQtyOverrides(prev => {
      const currentQty = prev.hasOwnProperty(key) ? prev[key] : originalQty
      const newQty = Math.max(0, Math.min(originalQty, currentQty + delta))
      const updated = { ...prev }
      if (newQty === originalQty) {
        delete updated[key]
      } else {
        updated[key] = newQty
      }
      return updated
    })
  }

  const addMenuItemToOrder = (foodItem) => {
    setManualItems(prev => {
      const existing = prev.find(m => m.foodItemId === foodItem.id)
      if (existing) return prev.map(m => m.foodItemId === foodItem.id ? { ...m, qty: m.qty + 1 } : m)
      return [...prev, { tempId: Date.now() + Math.random(), foodItemId: foodItem.id, name: foodItem.name, price: foodItem.price, qty: 1 }]
    })
  }

  const changeMenuItemQty = (foodItemId, delta) => {
    setManualItems(prev =>
      prev.map(m => m.foodItemId === foodItemId ? { ...m, qty: m.qty + delta } : m).filter(m => m.qty > 0)
    )
  }

  const addOpenItem = () => {
    if (!openName.trim()) { alert('Enter item name'); return }
    if (!openPrice || parseFloat(openPrice) <= 0) { alert('Enter valid price'); return }
    setManualItems(prev => [...prev, {
      tempId: Date.now() + Math.random(), foodItemId: null,
      name: openName.trim(), price: parseFloat(openPrice),
      qty: openQty, isOpen: true, dept: openDept
    }])
    setOpenName(''); setOpenPrice(''); setOpenQty(1); setShowOpenForm(false)
  }

  // ── handlePrintAndSave — FIXED write-back verification ───────────────
  // ROOT CAUSE of "Classic LIIT × 4" still showing in DB reads (Reports /
  // Today's Report) after reducing to 2 in the editor, while the money
  // fields (subtotal/final_amount) were correct:
  //
  // The previous verification only checked that the UPDATE matched a row
  // at all (`updatedRows.length === 0` as the sole failure condition). It
  // never checked that the row it got back actually carried the NEW
  // quantity. Supabase/PostgREST can return success with a matched row
  // whose value didn't change the way you expect in edge cases (e.g. a
  // stale closure value, a trigger normalizing/rejecting the value, a
  // concurrent write racing it) — and none of those show up as a thrown
  // error or an empty result set. So the function sailed past STEP 1,
  // printed the receipt, and wrote the (correct) computed totals to
  // `orders` in STEP 2 — leaving `order_items.quantity` permanently out
  // of sync with `orders.subtotal` / `orders.final_amount`.
  //
  // FIX:
  //   1. Every order_items write now checks the RETURNED quantity value,
  //      not just row presence — `updatedRows[0].quantity !== newQty` is
  //      now itself a failure condition.
  //   2. As a second, independent safety net, we re-SELECT every touched
  //      row after the update loop completes and confirm the persisted
  //      quantity matches what we intended, before allowing anything to
  //      print or save. This guards against any write that reports
  //      "success" with the right shape but wrong value, or gets quietly
  //      reverted between the UPDATE and here.
  //   3. If ANY item fails either check, we STOP — no receipt is printed,
  //      no order is marked paid — exactly as before, just with a
  //      verification step that can no longer be fooled by a partially
  //      "successful-looking" write.
  const handlePrintAndSave = async () => {
    const dv = parseFloat(discountValue) || 0
    if (dv > 0 && !discountReason.trim()) { setDiscountReasonError(true); return }
    setDiscountReasonError(false)

    const tblData = tables.find(t => t.id === payTableId)
    const {
      foodItems, liquorItems, foodSubtotal, liquorSubtotal,
      subtotal, serviceChargeAmt, discountAmt, finalAmount
    } = computeTotals(payTableId)

    const snapshot = billingSnapshotRef.current.tableId === payTableId
      ? billingSnapshotRef.current
      : buildSnapshot(payTableId)

    setSaving(true)

    // ── STEP 1: Persist itemQtyOverrides into real order_items rows ────
    // This must succeed BEFORE we print anything or touch `orders`, so
    // that a partial failure never results in a printed/saved bill whose
    // totals don't match its item rows.
    //
    // DIAGNOSTIC UPGRADE: every failure is now classified into ONE of
    // exactly 3 plain-language reasons, and that reason is shown right
    // inside the popup — no browser console needed:
    //
    //   Reason A — "Database rejected the change"
    //     Supabase itself returned an error (network drop, permissions,
    //     server-side rule). The `error.message` is included verbatim.
    //
    //   Reason B — "This item's record could not be found"
    //     The UPDATE ran but matched ZERO rows — the row id this screen
    //     was holding no longer exists in the database. Usually means
    //     this bill was already modified/printed elsewhere (a second
    //     browser tab, or the table was cleared) while this screen was
    //     still open with old data.
    //
    //   Reason C — "Change was sent but did not save correctly"
    //     The UPDATE matched the row, but when we immediately re-checked
    //     it, the value wasn't what we asked for. Something else wrote
    //     to this row at nearly the same time.
    if (Object.keys(itemQtyOverrides).length > 0) {
      const failedItems = []
      const writtenRowIds = []

      for (const row of snapshot.items) {
        const key = `row:${row.rowId}`
        if (!itemQtyOverrides.hasOwnProperty(key)) continue
        const newQty = itemQtyOverrides[key]
        if (!row.rowId) continue

        // Always UPDATE — never DELETE — so a blocked write can't leave
        // an invisible "should have been removed" row with stale qty.
        const { data: updatedRows, error } = await supabase
          .from('order_items')
          .update({ quantity: newQty })
          .eq('id', row.rowId)
          .select('id, quantity')

        const itemName = row.food_items?.name || 'Unknown item'
        let auditStatus = 'success'
        let auditReason = ''

        if (error) {
          // Reason A
          auditStatus = 'failed'
          auditReason = `Database rejected the change (${error.message || 'unknown error'})`
        } else if (!updatedRows || updatedRows.length === 0) {
          // Reason B
          auditStatus = 'failed'
          auditReason = `This item's record could not be found — it may have been changed in another tab/session. Please refresh and try again.`
        } else if (updatedRows[0].quantity !== newQty) {
          // Reason C
          auditStatus = 'failed'
          auditReason = `Change was sent but did not save correctly (tried to set ${newQty}, database still shows ${updatedRows[0].quantity}). Something else may be editing this bill at the same time.`
        }

        // ── NEW: log this attempt to item_quantity_audit ──────────────
        // One row per attempt, success or failure, with table name,
        // item name, before/after quantity, and an exact timestamp.
        // Never blocks the billing flow — if the audit write itself
        // fails, we swallow that error (it's a diagnostic aid, not a
        // correctness requirement) and continue with the normal logic.
        try {
          await supabase.from('item_quantity_audit').insert({
            table_name: tblData?.table_name || 'Unknown',
            order_id: row.orderId,
            order_item_id: row.rowId,
            item_name: itemName,
            original_qty: row.originalQty,
            new_qty: newQty,
            status: auditStatus,
            fail_reason: auditReason,
          })
        } catch (auditErr) {
          // Diagnostic logging must never break the actual billing flow.
        }

        if (auditStatus === 'failed') {
          failedItems.push({ name: itemName, reason: auditReason })
        } else {
          writtenRowIds.push({ id: row.rowId, expectedQty: newQty, name: itemName })
        }
      }

      if (failedItems.length > 0) {
        setSaving(false)
        const detail = failedItems
          .map(f => `• ${f.name}\n   → ${f.reason}`)
          .join('\n\n')
        alert(
          `⚠️ Could not save the following item(s):\n\n${detail}\n\n` +
          `Nothing was printed or saved, so your totals and item list stay in sync.`
        )
        return
      }

      // ── STEP 1b: Independent read-back verification ──────────────────
      // Second safety net: re-fetch every row we just wrote and confirm
      // what's actually persisted in the DB matches what we intended.
      // This catches any write that reported "success" with the right
      // shape but the wrong value, or got reverted between the UPDATE
      // and now (e.g. by a concurrent process). This is a 4th check —
      // "looked fine a moment ago, but isn't anymore" — reported with
      // its own plain-language reason (Reason D).
      if (writtenRowIds.length > 0) {
        const { data: verifyRows, error: verifyError } = await supabase
          .from('order_items')
          .select('id, quantity')
          .in('id', writtenRowIds.map(r => r.id))

        if (verifyError) {
          setSaving(false)
          alert(
            `⚠️ Could not double-check the saved quantities.\n\n` +
            `Reason: ${verifyError.message}\n\n` +
            `Nothing was printed or saved. Please try again.`
          )
          return
        }

        const verifyMap = {}
        ;(verifyRows || []).forEach(r => { verifyMap[r.id] = r.quantity })

        const mismatches = writtenRowIds.filter(
          r => verifyMap[r.id] !== r.expectedQty
        )

        if (mismatches.length > 0) {
          setSaving(false)

          // ── NEW: log the read-back mismatch too, so this 4th outcome
          // ("looked fine right after saving, but wasn't a moment later")
          // shows up in item_quantity_audit exactly like the other 3.
          for (const m of mismatches) {
            try {
              await supabase.from('item_quantity_audit').insert({
                table_name: tblData?.table_name || 'Unknown',
                order_id: snapshot.items.find(i => i.rowId === m.id)?.orderId || null,
                order_item_id: m.id,
                item_name: m.name,
                original_qty: snapshot.items.find(i => i.rowId === m.id)?.originalQty ?? null,
                new_qty: m.expectedQty,
                status: 'failed',
                fail_reason: `Read-back mismatch: saved as ${verifyMap[m.id]}, expected ${m.expectedQty}. Likely another tab/session changed this bill at the same moment.`,
              })
            } catch (auditErr) {
              // Diagnostic logging must never break the actual billing flow.
            }
          }

          const detail = mismatches
            .map(m => `• ${m.name}\n   → Saved as ${verifyMap[m.id]}, but expected ${m.expectedQty}. Likely another tab/session changed this bill at the same moment.`)
            .join('\n\n')
          alert(
            `⚠️ Double-check found a mismatch for:\n\n${detail}\n\n` +
            `Nothing was printed or saved, so your totals and item list stay in sync.`
          )
          return
        }
      }
    }

    // ── STEP 2: Now that item quantities are confirmed persisted, build
    // and print the receipt, and write the order totals. ───────────────
    const now = new Date()
    const lines = {
      restaurantName: restaurant.name, address: restaurant.address,
      phone: restaurant.phone, gstNumber: restaurant.gst_number,
      footerNote: restaurant.footer_note, tableName: tblData?.table_name || '',
      date: toISTDate(now.toISOString()), time: toIST(now.toISOString()),
      foodItems: foodItems.map(i => ({ name: i.food_items?.name || i.name, qty: i.quantity, total: i.total })),
      liquorItems: liquorItems.map(i => ({ name: i.food_items?.name || i.name, qty: i.quantity, total: i.total })),
      foodSubtotal, liquorSubtotal, subtotal, serviceChargePct, serviceChargeAmt,
      discountType, discountValue: dv, discountAmt,
      discountReason: discountReason.trim(), finalAmount,
    }

    const w = window.open('', '_blank', 'width=400,height=600')
    w.document.write(buildHtmlReceipt(lines))
    w.document.close(); w.focus(); w.print(); w.close()

    const nowIST = now.toISOString()

    // Insert any newly added menu items
    const menuOnlyItems = manualItems.filter(mi => mi.foodItemId)
    if (menuOnlyItems.length > 0 && snapshot.orderIds.length > 0) {
      const rows = menuOnlyItems.map(mi => ({
        order_id: snapshot.orderIds[0],
        food_item_id: mi.foodItemId,
        quantity: mi.qty,
        price_at_order: mi.price,
        note: 'Added at billing'
      }))
      await supabase.from('order_items').insert(rows)
    }

    const openOnlyItems = manualItems.filter(mi => mi.isOpen)
    const openItemsJson = openOnlyItems.map(mi => ({
      name: mi.name, price: mi.price, qty: mi.qty, dept: mi.dept,
      total: mi.price * mi.qty
    }))

    for (const orderId of snapshot.orderIds) {
      await supabase.from('orders').update({
        is_paid: true, paid_at: nowIST, subtotal,
        service_charge_pct: serviceChargePct, service_charge_amt: serviceChargeAmt,
        discount_type: discountType, discount_value: dv, discount_amt: discountAmt,
        discount_reason: discountReason.trim(), final_amount: finalAmount,
        settlement_status: 'pending',
        table_name_snapshot: tblData?.table_name || '',
        payment_type: 'pending',
        open_items_json: openItemsJson
      }).eq('id', orderId)
    }

    await nukeClearTable(payTableId, snapshot.orderIds)
    setNewOrderIds(prev => { const n = new Set(prev); snapshot.orderIds.forEach(id => n.delete(id)); return n })
    setItemQtyOverrides({}); setManualItems([])
    setShowItemEditor(false); setShowPreview(false)
    billingSnapshotRef.current = { tableId: null, items: [] }
    if (selectedTable?.id === payTableId) setSelectedTable(null)
    setSaving(false)
    fetchAll()
  }

  const nukeClearTable = async (tableId, settledOrderIds = []) => {
    try {
      const { data: ords } = await supabase
        .from('orders').select('id').eq('table_id', tableId).eq('is_paid', false)
      const allUnpaidIds = (ords || []).map(o => o.id)
      const toDelete = allUnpaidIds.filter(id => !settledOrderIds.includes(id))

      if (toDelete.length > 0) {
        await supabase.from('order_items').delete().in('order_id', toDelete)
        await supabase.from('orders').delete().in('id', toDelete)
      }

      const remainingUnpaid = allUnpaidIds.length - toDelete.length
      if (remainingUnpaid === 0) {
        await supabase.from('table_sessions').delete().eq('table_id', tableId)
        await supabase.from('table_order_summary').delete().eq('table_id', tableId)
        const { data: tbl } = await supabase
          .from('tables').select('session_version').eq('id', tableId).single()
        await supabase.from('tables').update({
          session_version: (tbl?.session_version || 1) + 1,
          pin: generatePin()
        }).eq('id', tableId)
      }
      return true
    } catch (err) { return false }
  }

  const clearAllTables = async () => {
    setShowClearAllConfirm(false); setClearing(true)
    const active = tables.filter(t => orders.some(o => o.table_id === t.id))
    for (const table of active) await nukeClearTable(table.id, [])
    setNewOrderIds(new Set()); setNewOrderTables(new Set())
    setSelectedTable(null); setClearing(false); fetchAll()
  }

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/') }

  const liveSnapshot = selectedTable && billingSnapshotRef.current.tableId === selectedTable.id
    ? billingSnapshotRef.current
    : (selectedTable ? buildSnapshot(selectedTable.id) : { tableId: null, items: [], orderIds: [] })

  const tableOrders = selectedTable ? orders.filter(o => o.table_id === selectedTable.id) : []
  const allOrderItems = liveSnapshot.items
  const editorTotals = selectedTable ? computeTotals(selectedTable.id) : null
  const displaySubtotal = editorTotals ? editorTotals.subtotal : 0
  const groupedByOrder = tableOrders.map(o => ({
    ...o,
    items: liveSnapshot.items.filter(row => row.orderId === o.id),
  }))
  const activeTables = tables.filter(t => orders.some(o => o.table_id === t.id))
  const selectedTableData = tables.find(t => t.id === selectedTable?.id)
  const currentPin = selectedTableData?.pin || '----'
  const previewTotals = payTableId ? computeTotals(payTableId) : null
  const previewTableName = tables.find(t => t.id === payTableId)?.table_name || ''
  const dv = parseFloat(discountValue) || 0
  const filteredMenuItems = allFoodItems.filter(f => f.name.toLowerCase().includes(menuSearch.toLowerCase()))
  const modifiedCount = Object.keys(itemQtyOverrides).length

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col" onClick={initAudio}>

      {!soundReady && (
        <div className="bg-orange-500 text-white text-center text-xs py-1.5 cursor-pointer font-medium">
          🔔 Tap anywhere to enable order notification sounds
        </div>
      )}

      {/* ── Bill Preview Modal ───────────────────────────── */}
      {showPreview && previewTotals && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[92vh] flex flex-col">
            <div className="p-5 border-b">
              <div className="text-center">
                <p className="font-bold text-lg text-gray-800">{restaurant.name}</p>
                <p className="text-xs text-gray-400">{restaurant.address}</p>
                <p className="text-xs text-gray-400">{restaurant.phone}</p>
                {restaurant.gst_number && <p className="text-xs text-gray-400">GST: {restaurant.gst_number}</p>}
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-3">
                <span>Table: <strong>{previewTableName}</strong></span>
                <span>{toISTDate(new Date().toISOString())} {toIST(new Date().toISOString())}</span>
              </div>
              {modifiedCount > 0 && (
                <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-1.5">
                  <p className="text-xs text-yellow-700 text-center">⚠️ {modifiedCount} item(s) quantity adjusted</p>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {previewTotals.foodItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase">🍽 Food</span>
                    <div className="flex-1 border-t border-dashed border-gray-200" />
                  </div>
                  {previewTotals.foodItems.map((item, i) => (
                    <div key={i} className="flex justify-between items-center text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{item.food_items?.name || item.name}</span>
                        <span className="bg-orange-100 text-orange-600 text-xs font-bold px-1.5 py-0.5 rounded-full">×{item.quantity}</span>
                      </div>
                      <span className="text-gray-700 font-medium">₹{item.total}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-semibold text-gray-500 mt-2 pt-1 border-t border-dashed">
                    <span>Food Subtotal</span><span>₹{previewTotals.foodSubtotal}</span>
                  </div>
                </div>
              )}

              {previewTotals.liquorItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase">🍺 Liquor</span>
                    <div className="flex-1 border-t border-dashed border-gray-200" />
                  </div>
                  {previewTotals.liquorItems.map((item, i) => (
                    <div key={i} className="flex justify-between items-center text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{item.food_items?.name || item.name}</span>
                        <span className="bg-blue-100 text-blue-600 text-xs font-bold px-1.5 py-0.5 rounded-full">×{item.quantity}</span>
                      </div>
                      <span className="text-gray-700 font-medium">₹{item.total}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-semibold text-gray-500 mt-2 pt-1 border-t border-dashed">
                    <span>Liquor Subtotal</span><span>₹{previewTotals.liquorSubtotal}</span>
                  </div>
                </div>
              )}

              <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase">Charges & Discount</p>
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <span>Service Charge</span>
                  <div className="flex items-center gap-2">
                    <select value={serviceChargePct} onChange={e => setServiceChargePct(Number(e.target.value))}
                      className="border rounded px-2 py-0.5 text-xs">
                      <option value={0}>0%</option><option value={5}>5%</option>
                      <option value={10}>10%</option><option value={12}>12%</option><option value={18}>18%</option>
                    </select>
                    {previewTotals.serviceChargeAmt > 0 && <span className="text-xs font-medium text-gray-700">+₹{previewTotals.serviceChargeAmt}</span>}
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <span>Discount</span>
                  <div className="flex items-center gap-2">
                    <select value={discountType} onChange={e => { setDiscountType(e.target.value); setDiscountValue(''); setDiscountReason('') }}
                      className="border rounded px-2 py-0.5 text-xs">
                      <option value="percent">%</option><option value="flat">₹ flat</option>
                    </select>
                    <input type="number" min="0" value={discountValue}
                      onChange={e => { setDiscountValue(e.target.value); setDiscountReasonError(false) }}
                      placeholder="0" className="border rounded px-2 py-0.5 text-xs w-16 text-right" />
                    {previewTotals.discountAmt > 0 && <span className="text-green-600 text-xs font-medium">-₹{previewTotals.discountAmt}</span>}
                  </div>
                </div>
                {dv > 0 && (
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Discount Reason <span className="text-red-500">*</span></label>
                    <input type="text" value={discountReason}
                      onChange={e => { setDiscountReason(e.target.value); setDiscountReasonError(false) }}
                      placeholder="e.g. Regular customer..."
                      className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 ${discountReasonError ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} />
                    {discountReasonError && <p className="text-red-500 text-xs mt-1">⚠️ Reason required</p>}
                  </div>
                )}
              </div>

              <div className="bg-gray-50 rounded-xl p-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Subtotal</span><span>₹{previewTotals.subtotal}</span>
                </div>
                {previewTotals.serviceChargeAmt > 0 && (
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Service ({serviceChargePct}%)</span><span>+₹{previewTotals.serviceChargeAmt}</span>
                  </div>
                )}
                {previewTotals.discountAmt > 0 && (
                  <div className="flex justify-between text-xs text-green-600 mb-1">
                    <span>Discount {discountReason ? `(${discountReason})` : ''}</span><span>-₹{previewTotals.discountAmt}</span>
                  </div>
                )}
                <div className="border-t border-dashed border-gray-200 my-1" />
                <div className="flex justify-between font-bold text-gray-800 text-base">
                  <span>Final Total</span>
                  <span className="text-orange-500 text-xl">₹{previewTotals.finalAmount}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1 text-center">Payment method settled in Today's Report</p>
              </div>
            </div>

            <div className="p-4 border-t space-y-2">
              <button onClick={handlePrintAndSave} disabled={clearing || saving}
                className="w-full bg-green-500 text-white py-3 rounded-xl font-bold hover:bg-green-600 disabled:opacity-50">
                {saving ? '⏳ Saving…' : '🖨️ Print & Save Bill'}
              </button>
              <button onClick={() => setShowPreview(false)} disabled={saving}
                className="w-full bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50">
                ← Back to Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearAllConfirm && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-xl font-bold text-red-500 mb-2">⚠️ Clear All Active Tables?</h2>
            <p className="text-gray-600 text-sm mb-4">This will clear all {activeTables.length} active tables.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowClearAllConfirm(false)} className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-xl font-medium">Cancel</button>
              <button onClick={clearAllTables} className="flex-1 bg-red-500 text-white py-2 rounded-xl font-medium">Yes, Clear All</button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-500 hover:text-orange-500 text-2xl font-bold">☰</button>
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
          <button onClick={() => navigate('/admin/today-report')} className="bg-green-100 text-green-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-200">📋 Today's Report</button>
          <button onClick={() => navigate('/admin/reports')} className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">📊 Reports</button>
          <button onClick={() => navigate('/admin/menu')} className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">Menu</button>
          <button onClick={() => navigate('/admin/tables')} className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">Tables</button>
          <button onClick={() => navigate('/admin/settings')} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-200">⚙️ Settings</button>
          <button onClick={handleLogout} className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200">Logout</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-all duration-300 bg-white shadow-lg flex-shrink-0 fixed md:relative h-[calc(100vh-56px)] w-64 z-20 top-14 md:top-0 overflow-hidden`}>
          <div className="w-64 h-full flex flex-col">
            <div className="p-4 border-b bg-orange-50">
              <h2 className="font-bold text-gray-700 text-sm uppercase tracking-wide">🪑 Active Tables</h2>
              <p className="text-xs text-gray-400 mt-1">{activeTables.length} table(s) with orders</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && <p className="text-xs text-gray-400 text-center py-4">Loading...</p>}
              {!loading && activeTables.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">🪑</div><p className="text-xs">No active orders yet</p>
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
                        <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">{newCount} New!</span>
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
            <div className="p-3 border-t text-center"><p className="text-xs text-gray-300">Auto-refreshes every 4s</p></div>
          </div>
        </div>

        {sidebarOpen && <div className="fixed inset-0 bg-black bg-opacity-30 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Main content */}
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
              {/* Table header */}
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
                      <span className="bg-orange-500 text-white font-bold text-xl px-4 py-1 rounded-xl tracking-widest">{currentPin}</span>
                    </div>
                  </div>
                  <button onClick={() => openPreview(selectedTable.id)}
                    disabled={clearing || tableOrders.length === 0}
                    className="bg-green-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-600 transition disabled:opacity-50">
                    🖨️ Print Bill & Clear
                  </button>
                </div>
              </div>

              {/* ── Item Editor Panel ──────────────────────── */}
              <div className="bg-white rounded-2xl shadow mb-4 overflow-hidden">
                <button onClick={() => setShowItemEditor(!showItemEditor)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">✏️</span>
                    <div className="text-left">
                      <p className="font-bold text-gray-700 text-sm">Add / Remove Items</p>
                      <p className="text-xs text-gray-400">
                        {manualItems.length > 0 ? `${manualItems.length} item(s) added` : 'Modify bill before printing'}
                        {modifiedCount > 0 ? ` · ${modifiedCount} qty adjusted` : ''}
                      </p>
                    </div>
                  </div>
                  <span className={`text-gray-400 transition-transform ${showItemEditor ? 'rotate-180' : ''}`}>▼</span>
                </button>

                {showItemEditor && (
                  <div className="border-t">

                    {allOrderItems.length > 0 && (
                      <div className="px-5 py-4 border-b">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold text-gray-500 uppercase">🗑 Adjust Item Quantities</p>
                          {modifiedCount > 0 && (
                            <button
                              onClick={() => setItemQtyOverrides({})}
                              className="text-xs text-red-400 hover:text-red-600 underline">
                              Reset All
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mb-3">
                          Use − to reduce quantity. Set to 0 to remove from bill completely.
                        </p>
                        <div className="space-y-2">
                          {allOrderItems.map((row) => {
                            const key = `row:${row.rowId}`
                            const originalQty = row.originalQty
                            const effectiveQty = itemQtyOverrides.hasOwnProperty(key)
                              ? itemQtyOverrides[key]
                              : originalQty
                            const isFullyRemoved = effectiveQty === 0
                            const isReduced = effectiveQty < originalQty && effectiveQty > 0

                            return (
                              <div key={row.rowId}
                                className={`flex items-center justify-between px-3 py-3 rounded-xl border transition
                                  ${isFullyRemoved
                                    ? 'bg-red-50 border-red-200'
                                    : isReduced
                                      ? 'bg-yellow-50 border-yellow-200'
                                      : 'bg-gray-50 border-gray-100'}`}>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-sm font-medium text-gray-700 ${isFullyRemoved ? 'line-through text-gray-400' : ''}`}>
                                      {row.food_items?.name}
                                    </span>
                                    {isFullyRemoved && (
                                      <span className="text-xs bg-red-100 text-red-500 px-2 py-0.5 rounded-full font-medium">Removed</span>
                                    )}
                                    {isReduced && (
                                      <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full font-medium">
                                        {originalQty} → {effectiveQty}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-400 mt-0.5">
                                    ₹{row.price_at_order} × {effectiveQty} = ₹{row.price_at_order * effectiveQty}
                                    {isReduced && (
                                      <span className="ml-1 text-red-400 line-through">
                                        (was ₹{row.price_at_order * originalQty})
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                                  <button
                                    onClick={() => setItemQty(row.rowId, originalQty, -1)}
                                    disabled={effectiveQty === 0}
                                    className="w-8 h-8 rounded-full bg-red-100 text-red-500 font-bold flex items-center justify-center hover:bg-red-200 disabled:opacity-30 disabled:cursor-not-allowed text-lg">
                                    −
                                  </button>
                                  <span className={`font-bold w-6 text-center text-sm ${isFullyRemoved ? 'text-red-400' : isReduced ? 'text-yellow-600' : 'text-gray-700'}`}>
                                    {effectiveQty}
                                  </span>
                                  <button
                                    onClick={() => setItemQty(row.rowId, originalQty, +1)}
                                    disabled={effectiveQty === originalQty}
                                    className="w-8 h-8 rounded-full bg-green-100 text-green-600 font-bold flex items-center justify-center hover:bg-green-200 disabled:opacity-30 disabled:cursor-not-allowed text-lg">
                                    +
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {modifiedCount > 0 && (
                          <div className="mt-3 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2">
                            <p className="text-xs text-orange-700 font-medium">
                              ✏️ {Object.values(itemQtyOverrides).filter(q => q === 0).length} item(s) fully removed,{' '}
                              {Object.values(itemQtyOverrides).filter(q => q > 0).length} item(s) qty reduced
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Add from menu */}
                    <div className="px-5 py-4 border-b">
                      <p className="text-xs font-bold text-gray-500 uppercase mb-3">➕ Add from Menu</p>
                      <input type="text" value={menuSearch} onChange={e => setMenuSearch(e.target.value)}
                        placeholder="🔍 Search menu item..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                      {manualItems.filter(m => m.foodItemId).length > 0 && (
                        <div className="mb-3 space-y-1.5">
                          <p className="text-xs text-green-600 font-medium">✅ Added:</p>
                          {manualItems.filter(m => m.foodItemId).map(mi => (
                            <div key={mi.tempId} className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                              <div>
                                <p className="text-sm font-medium text-gray-700">{mi.name}</p>
                                <p className="text-xs text-gray-400">₹{mi.price} × {mi.qty} = ₹{mi.price * mi.qty}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button onClick={() => changeMenuItemQty(mi.foodItemId, -1)} className="w-7 h-7 rounded-full bg-red-100 text-red-500 font-bold flex items-center justify-center hover:bg-red-200">−</button>
                                <span className="font-bold text-gray-700 w-4 text-center">{mi.qty}</span>
                                <button onClick={() => changeMenuItemQty(mi.foodItemId, 1)} className="w-7 h-7 rounded-full bg-green-100 text-green-600 font-bold flex items-center justify-center hover:bg-green-200">+</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {filteredMenuItems.length === 0 && <p className="text-center text-gray-400 text-xs py-2">No items found</p>}
                        {filteredMenuItems.map(fi => {
                          const added = manualItems.find(m => m.foodItemId === fi.id)
                          return (
                            <button key={fi.id} onClick={() => addMenuItemToOrder(fi)}
                              className="w-full flex justify-between items-center px-3 py-2 rounded-lg hover:bg-orange-50 border border-transparent hover:border-orange-200 transition text-left">
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

                    {/* Add Open Item */}
                    <div className="px-5 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-bold text-gray-500 uppercase">🆕 Add Open Item (Not in Menu)</p>
                        <button onClick={() => setShowOpenForm(!showOpenForm)}
                          className="text-xs bg-orange-500 text-white px-3 py-1 rounded-full hover:bg-orange-600">
                          {showOpenForm ? '✕ Cancel' : '+ Open Item'}
                        </button>
                      </div>
                      {showOpenForm && (
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
                          <div>
                            <p className="text-xs text-gray-500 mb-1.5 font-medium">Category</p>
                            <div className="flex gap-2">
                              {[{ id: 'Food', icon: '🍽', color: 'bg-orange-500 text-white' },
                                { id: 'Beverage', icon: '🥤', color: 'bg-blue-500 text-white' },
                                { id: 'Liquor', icon: '🍺', color: 'bg-purple-500 text-white' }].map(d => (
                                <button key={d.id} onClick={() => setOpenDept(d.id)}
                                  className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition ${openDept === d.id ? d.color + ' border-transparent' : 'bg-white border-gray-200 text-gray-500 hover:border-orange-300'}`}>
                                  {d.icon} {d.id}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Item Name *</label>
                            <input type="text" value={openName} onChange={e => setOpenName(e.target.value)}
                              placeholder="e.g. Special Cocktail, Mineral Water..."
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Price (₹) *</label>
                              <input type="number" min="1" value={openPrice} onChange={e => setOpenPrice(e.target.value)}
                                placeholder="0"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Quantity</label>
                              <div className="flex items-center gap-2">
                                <button onClick={() => setOpenQty(q => Math.max(1, q - 1))}
                                  className="w-9 h-9 rounded-full bg-gray-200 text-gray-600 font-bold flex items-center justify-center hover:bg-gray-300">−</button>
                                <span className="font-bold text-gray-700 text-lg w-6 text-center">{openQty}</span>
                                <button onClick={() => setOpenQty(q => q + 1)}
                                  className="w-9 h-9 rounded-full bg-orange-100 text-orange-600 font-bold flex items-center justify-center hover:bg-orange-200">+</button>
                              </div>
                            </div>
                          </div>
                          {openPrice && parseFloat(openPrice) > 0 && (
                            <div className="bg-white rounded-lg px-3 py-2 flex justify-between text-sm">
                              <span className="text-gray-600">{openName || 'Item'} × {openQty}</span>
                              <span className="font-bold text-orange-500">₹{(parseFloat(openPrice) * openQty).toFixed(0)}</span>
                            </div>
                          )}
                          <button onClick={addOpenItem}
                            className="w-full bg-orange-500 text-white py-2.5 rounded-xl font-bold hover:bg-orange-600">
                            ✅ Add to Bill
                          </button>
                        </div>
                      )}
                      {manualItems.filter(m => m.isOpen).length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          <p className="text-xs text-purple-600 font-medium">🆕 Open Items Added:</p>
                          {manualItems.filter(m => m.isOpen).map(mi => (
                            <div key={mi.tempId} className="flex items-center justify-between bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-purple-100 text-purple-600">
                                    {mi.dept === 'Food' ? '🍽' : mi.dept === 'Beverage' ? '🥤' : '🍺'} {mi.dept}
                                  </span>
                                  <p className="text-sm font-medium text-gray-700">{mi.name}</p>
                                </div>
                                <p className="text-xs text-gray-400 mt-0.5">₹{mi.price} × {mi.qty} = ₹{mi.price * mi.qty}</p>
                              </div>
                              <button onClick={() => setManualItems(prev => prev.filter(m => m.tempId !== mi.tempId))}
                                className="text-xs bg-red-100 text-red-500 px-2 py-1 rounded-full hover:bg-red-200">✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Order rounds display ── */}
              <div className="space-y-4 mb-4">
                {groupedByOrder.map((order, index) => {
                  const isNewOrder = newOrderIds.has(order.id)
                  return (
                    <div key={order.id}
                      className={`rounded-2xl shadow p-5 ${isNewOrder ? 'bg-yellow-50 border-2 border-yellow-400' : 'bg-white border border-gray-100'}`}>
                      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="bg-orange-100 text-orange-600 text-xs font-bold px-3 py-1 rounded-full">Round {groupedByOrder.length - index}</span>
                          {isNewOrder && <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full animate-pulse">🆕 New!</span>}
                          {!isNewOrder && index === 0 && <span className="bg-green-100 text-green-600 text-xs font-bold px-3 py-1 rounded-full">Latest ✨</span>}
                        </div>
                        <span className="text-xs text-gray-400">🕐 {toIST(order.created_at)}</span>
                      </div>
                      <div className="space-y-2">
                        {order.items.map((row) => {
                          const key = `row:${row.rowId}`
                          const originalQty = row.originalQty
                          const effectiveQty = itemQtyOverrides.hasOwnProperty(key)
                            ? itemQtyOverrides[key]
                            : originalQty
                          const isFullyRemoved = effectiveQty === 0
                          const isReduced = effectiveQty < originalQty && effectiveQty > 0

                          return (
                            <div key={row.rowId} className={`py-2 border-b border-gray-50 last:border-0 ${isFullyRemoved ? 'opacity-40' : ''}`}>
                              <div className="flex justify-between text-sm text-gray-700">
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium ${isFullyRemoved ? 'line-through text-gray-400' : ''}`}>
                                    {row.food_items?.name}
                                  </span>
                                  {isFullyRemoved && (
                                    <span className="text-xs bg-red-100 text-red-400 px-1.5 py-0.5 rounded-full">removed</span>
                                  )}
                                  {isReduced && (
                                    <span className="text-xs bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded-full">
                                      {originalQty}→{effectiveQty}
                                    </span>
                                  )}
                                </div>
                                <span className={`${isFullyRemoved ? 'text-gray-300 line-through' : isReduced ? 'text-yellow-600' : 'text-gray-500'}`}>
                                  × {isFullyRemoved ? originalQty : effectiveQty}
                                </span>
                              </div>
                              {row.note && row.note.trim() !== '' && (
                                <p className="text-xs text-orange-500 italic mt-1">📝 "{row.note}"</p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Subtotal bar */}
              <div className="bg-orange-500 rounded-2xl shadow p-5 text-white mb-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-lg">Subtotal</span>
                  <span className="font-bold text-2xl">₹{displaySubtotal}</span>
                </div>
                {(modifiedCount > 0 || manualItems.length > 0) && (
                  <p className="text-orange-100 text-xs mb-2">
                    {modifiedCount > 0 ? `${modifiedCount} item(s) qty adjusted · ` : ''}
                    {manualItems.length > 0 ? `${manualItems.length} item(s) added` : ''}
                  </p>
                )}
                <p className="text-orange-100 text-xs mb-4">* Charges, discount & payment method set when printing bill</p>
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
