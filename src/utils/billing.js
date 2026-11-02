// src/utils/billing.js
// Shared billing helpers, so Dashboard, TodayReport and AdminCode all
// calculate discounts the same safe way. (Fixes test case BL_04)

// Turns whatever was typed into a safe number:
//   - empty / text / negative  -> 0
//   - percent above 100        -> 100
export const sanitizeDiscountValue = (type, raw) => {
  const v = parseFloat(raw)
  if (!Number.isFinite(v) || v < 0) return 0
  if (type === 'percent' && v > 100) return 100
  return v
}

// Discount in rupees. Never negative, never more than the amount payable.
export const calcDiscountAmount = (type, raw, amountAfterService) => {
  const base = Math.max(0, amountAfterService)
  const v = sanitizeDiscountValue(type, raw)
  const amt = type === 'percent' ? Math.round((base * v) / 100) : Math.min(v, base)
  return Math.min(amt, base)
}

// For <input onChange>: stops bad values from being typed in the first place.
export const clampDiscountInput = (type, raw) => {
  if (raw === '' || raw === null || raw === undefined) return ''
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return ''
  if (n < 0) return '0'
  if (type === 'percent' && n > 100) return '100'
  return raw
}
