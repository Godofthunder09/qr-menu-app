const NUMERIC = /^\d+(\.\d+)?$/

const NO_DISCOUNT = { ok: true, value: 0, message: '' }
const fail = (message) => ({ ok: false, value: 0, message })

// type: 'percent' | 'flat'
// raw: whatever is in the input box
// payable: the amount the discount is applied to (flat discounts must stay below it)
export function validateDiscount(type, raw, payable = 0) {
  if (raw === null || raw === undefined) return { ...NO_DISCOUNT }
  const str = String(raw).trim()
  if (str === '') return { ...NO_DISCOUNT }

  if (!NUMERIC.test(str)) return fail('Enter a valid discount number')
  const n = Number(str)
  if (!Number.isFinite(n)) return fail('Enter a valid discount number')

  if (type === 'percent') {
    if (n < 1 || n > 99) return fail('Percent discount must be between 1 and 99')
  } else {
    if (n < 1) return fail('Flat discount must be at least ₹1')
    if (n >= payable) return fail(`Flat discount must be less than the payable total (₹${payable})`)
  }

  return { ok: true, value: n, message: '' }
}

// True when this change would take the only remaining bill line down to 0.
export function isSoleItemRemoval({ liveLineCount, currentQty, delta }) {
  return liveLineCount === 1 && delta < 0 && currentQty + delta <= 0
}
