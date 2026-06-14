// src/customer/useOrderSummary.js
// Handles ALL read/write logic for table_order_summary table.
// Place this file at: src/customer/useOrderSummary.js

import { useState } from 'react'
import { supabase } from '../supabase/client'

export function useOrderSummary() {
  const [orderSummary, setOrderSummary] = useState([])

  // Load all items ordered this session for this table
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

  // Save one item — accumulates quantity if already ordered
  const saveItemToSummary = async (tableId, sessionVersion, item) => {
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
      const { error } = await supabase
        .from('table_order_summary')
        .update({
          quantity:   existing.quantity + item.quantity,
          note:       item.note || existing.note || '',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
      if (error) console.error('[useOrderSummary] update error:', error.message)
    } else {
      const { error } = await supabase
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
      if (error) console.error('[useOrderSummary] insert error:', error.message)
    }
  }

  // Save entire cart — runs sequentially to avoid race conditions
  const saveCartToSummary = async (tableId, sessionVersion, cart) => {
    for (const item of cart) {
      await saveItemToSummary(tableId, sessionVersion, item)
    }
  }

  // Clear local state (called when table session resets)
  const clearSummary = () => setOrderSummary([])

  return { orderSummary, loadOrderSummary, saveCartToSummary, clearSummary }
}
