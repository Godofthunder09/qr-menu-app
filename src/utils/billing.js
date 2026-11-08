// src/utils/billing.js
// Shared billing helpers, so Dashboard, TodayReport and AdminCode all
// calculate discounts the same safe way.
//
// RULES
//   - A percentage discount can never be more than 100%.
//   - A flat discount can never be more than the amount payable.
//   - Negative, empty or non-numeric input counts as 0.

export const MAX_DISCOUNT_PERCENT = 100

// maxFlat (optional) = the amount payable, used as the ceiling for a flat discount.
export const sanitizeDiscountValue = (type, raw, maxFlat) => {
  const v = parseFloat(raw)
  if (!Number.isFinite(v) || v < 0) return 0
  if (type === 'percent') return Math.min(v, MAX_DISCOUNT_PERCENT)
  return maxFlat === undefined ? v : Math.min(v, Math.max(0, maxFlat))
}

// Discount in rupees. Never negative, never more than the amount payable.
export const calcDiscountAmount = (type, raw, amountAfterService) => {
  const base = Math.max(0, amountAfterService)
  const v = sanitizeDiscountValue(type, raw, base)
  const amt = type === 'percent' ? Math.round((base * v) / 100) : v
  return Math.min(amt, base)
}

// For <input onChange>: stops bad values from being typed in the first place.
export const clampDiscountInput = (type, raw, maxFlat) => {
  if (raw === '' || raw === null || raw === undefined) return ''
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return ''
  if (n < 0) return '0'
  if (type === 'percent' && n > MAX_DISCOUNT_PERCENT) return String(MAX_DISCOUNT_PERCENT)
  if (type !== 'percent' && maxFlat !== undefined && n > Math.max(0, maxFlat)) return String(Math.max(0, maxFlat))
  return raw
}
