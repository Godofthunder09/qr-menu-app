// src/customer/useOrderSummary.js
//
// Custom hook that owns ALL table_order_summary DB logic.
// Import this in MenuPage.jsx — keeps MenuPage clean.
//
// Usage:
//   const { orderSummary, loadOrderSummary, saveItemToSummary, clearSummary } = useOrderSummary()

import { useState } from 'react'
import { supabase } from '../supabase/client'

export function useOrderSummary() {
  const [orderSummary, setOrderSummary] = useState([])

  // ── Load all ordered items for this table + session ────────
  // Called on: PIN verify, page init, after every placeOrder
  const loadOrderSummary = async (tableId, sessionVersion) => {
    const { data, error } = await supabase
      .from('table_order_summary')
      .select('food_item_id, item_name, quantity, note')
      .eq('table_id', tableId)
      .eq('session_version', sessionVersion)
      .order('updated_at', { ascending: true })

    if (error) {
      console.error('[useOrderSummary] load error:', error.message)
      return
    }

    setOrderSummary(
      (data || []).map(r => ({
        id:       r.food_item_id,
        name:     r.item_name,
        quantity: r.quantity,
        note:     r.note || ''
      }))
    )
  }

  // ── Save / accumulate one cart item into summary ───────────
  // If the same food_item_id already exists for this session,
  // we ADD the new quantity on top (customer ordered again).
  // If it's new, we insert a fresh row.
  const saveItemToSummary = async (tableId, sessionVersion, item) => {
    // Check if a row already exists for this item in this session
    const { data: existing, error: fetchErr } = await supabase
      .from('table_order_summary')
      .select('id, quantity, note')
      .eq('table_id', tableId)
      .eq('session_version', sessionVersion)
      .eq('food_item_id', item.id)
      .maybeSingle()

    if (fetchErr) {
      console.error('[useOrderSummary] fetch error:', fetchErr.message)
      return
    }

    if (existing) {
      // Row exists → accumulate quantity
      const { error: updateErr } = await supabase
        .from('table_order_summary')
        .update({
          quantity:   existing.quantity + item.quantity,
          note:       item.note || existing.note || '',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)

      if (updateErr) {
        console.error('[useOrderSummary] update error:', updateErr.message)
      }
    } else {
      // No row yet → insert fresh
      const { error: insertErr } = await supabase
        .from('table_order_summary')
        .insert({
          table_id:        tableId,
          session_version: sessionVersion,
          food_item_id:    item.id,
          item_name:       item.name,
          quantity:        item.quantity,
          note:            item.note || '',
          updated_at:      new Date().toISOString()
        })

      if (insertErr) {
        console.error('[useOrderSummary] insert error:', insertErr.message)
      }
    }
  }

  // ── Save all cart items after placeOrder ───────────────────
  // Call this with the full cart array. Runs sequentially to
  // avoid race conditions on the same row.
  const saveCartToSummary = async (tableId, sessionVersion, cart) => {
    for (const item of cart) {
      await saveItemToSummary(tableId, sessionVersion, item)
    }
  }

  // ── Clear local summary state ──────────────────────────────
  // Called when table session is reset by admin
  const clearSummary = () => setOrderSummary([])

  return {
    orderSummary,
    loadOrderSummary,
    saveItemToSummary,
    saveCartToSummary,
    clearSummary
  }
}
