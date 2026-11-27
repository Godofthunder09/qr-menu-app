// ─────────────────────────────────────────────────────────────────────
// Department (KOT) printing
//
// A browser cannot pick a printer silently, so this uses QZ Tray
// (free desktop helper, https://qz.io) which lets the page print to a
// NAMED printer with no dialog. Install QZ Tray on the billing computer,
// keep it running, and the 5 printers are addressed by name.
//
// If QZ Tray is not running, nothing is marked as printed (it retries on
// the next poll) and the dashboard shows a red warning.
// ─────────────────────────────────────────────────────────────────────

// Keep in sync with DEPARTMENTS in MenuManager.jsx / food_items_department_check
export const DEPARTMENTS = ['Kitchen', 'Beverage', 'Liquor', 'Tandoor', 'Billing']

import { supabase } from '../supabase/client'

const CFG_KEY = 'qr_dept_printers_v1'
const PRINTED_KEY = 'qr_printed_item_ids_v1'
const QZ_SRC = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js'

export const loadPrinterConfig = () => {
  const base = {
    enabled: true,
    defaultDepartment: 'Kitchen',
    printers: Object.fromEntries(DEPARTMENTS.map(d => [d, ''])),
  }
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null')
    if (saved) return { ...base, ...saved, printers: { ...base.printers, ...(saved.printers || {}) } }
  } catch (e) {}
  return base
}

export const savePrinterConfig = (cfg) => {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch (e) {}
}

// Remember which order_items rows were already printed (survives refresh).
export const loadPrintedItemIds = () => {
  try { return new Set(JSON.parse(localStorage.getItem(PRINTED_KEY) || '[]')) }
  catch (e) { return new Set() }
}
export const savePrintedItemIds = (set) => {
  try {
    // keep the newest 2000 only
    const arr = Array.from(set).slice(-2000)
    localStorage.setItem(PRINTED_KEY, JSON.stringify(arr))
  } catch (e) {}
}

// ── QZ Tray loader / connection ──────────────────────────────────────
let qzPromise = null
const loadQz = () => {
  if (window.qz) return Promise.resolve(window.qz)
  if (qzPromise) return qzPromise
  qzPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = QZ_SRC
    s.onload = () => resolve(window.qz)
    s.onerror = () => { qzPromise = null; reject(new Error('Could not load QZ Tray script (internet needed once).')) }
    document.head.appendChild(s)
  })
  return qzPromise
}


// ── Signed printing (removes the QZ Tray "Allow" popup) ───────────────
// The certificate is public. The matching private key stays on the server
// (/api/qz-sign), which only signs for a logged-in admin.
const QZ_CERT = `-----BEGIN CERTIFICATE-----
MIIDVzCCAj+gAwIBAgIUCDqTBEi1sI+J+62CzUWixvqvjwkwDQYJKoZIhvcNAQEN
BQAwOzEVMBMGA1UEAwwMWWFzaCBRUiBNZW51MRUwEwYDVQQKDAxZYXNoIFFSIE1l
bnUxCzAJBgNVBAYTAklOMB4XDTI2MTEyNjA3NTIwNVoXDTM2MTEyMzA3NTIwNVow
OzEVMBMGA1UEAwwMWWFzaCBRUiBNZW51MRUwEwYDVQQKDAxZYXNoIFFSIE1lbnUx
CzAJBgNVBAYTAklOMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqvee
HHUT2rbY25eE/77mlmcIfZkp0VH687VTLjN+tGqrRrem7v8398m4n1xfndVsC4gF
7+FZgchIFstEqTBZPfaitZmCGzSZmVMg3HantPleCnhMG/TyzUZuf54gdi5PdWCb
MnjVGOSTyBE1n90rsI19fIDoLzlZCIAIaxKbco6JUlsvTvH3PhCM+/3d7d+xUKC7
3OLUOrzQIFwrJ3VoAlK3I4mBT3HNwmye+U4LbOIe8xQkieDe4E3tcc0gYoZvKNFf
HW8Au1K76iFqyCUS+BIUzSMyrPsL+1EWnUfAhCjjq1igsPxHFsMuXVoh7hNERIXf
f/Z09AXG0qIGlSkkxQIDAQABo1MwUTAdBgNVHQ4EFgQU/xTCjjsTK6GjwNmj/FoD
ps/9llwwHwYDVR0jBBgwFoAU/xTCjjsTK6GjwNmj/FoDps/9llwwDwYDVR0TAQH/
BAUwAwEB/zANBgkqhkiG9w0BAQ0FAAOCAQEAhwxidiBO10fFZ9SQKDdSF/U0lDGY
VQoEZ3YIm9J0i3rXe0rSnp98BW5TRsRLHaFBn5mcjkiqwtXIZqm02xjhs84k91nK
YASHGno3hU7/FmwqAhP9oKcsdXPB008HCPM0vT1NForkH1ca8wnBLiB4NgvuSEVX
HNy3x6Q/q1zYbbNLxSxqIYVC7ddBfhhQYb9C7rurKEExiHvKpcY9jCqTx5Jy+pgu
BXeYbzo+y/fHaQQvFp4oF0ZDEZ0rh12wkOVBFMRmYrtqCiK3MHm+H25lpNQEHTs2
SUj1H2kTgHMdYj9+rLQM1XFdfll0q1tOh9Ffku96CYDDRxdqMa2f1F4UAw==
-----END CERTIFICATE-----`

let securityReady = false
const setupQzSecurity = (qz) => {
  if (securityReady) return
  qz.security.setCertificatePromise((resolve) => resolve(QZ_CERT))
  qz.security.setSignatureAlgorithm('SHA512')
  qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
    supabase.auth.getSession()
      .then(({ data }) => fetch('/api/qz-sign', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Authorization: `Bearer ${data?.session?.access_token || ''}`,
        },
        body: toSign,
      }))
      .then(r => r.ok ? r.text() : r.text().then(t => { throw new Error(t || 'sign failed') }))
      .then(resolve, reject)
  })
  securityReady = true
}

const connectQz = async () => {
  const qz = await loadQz()
  setupQzSecurity(qz)
  if (!qz.websocket.isActive()) {
    try { await qz.websocket.connect({ retries: 1, delay: 1 }) }
    catch (e) { throw new Error('QZ Tray is not running on this computer.') }
  }
  return qz
}

// ── Ticket text (ESC/POS, 32 columns ~ 58mm; works fine on 80mm too) ──
const ESC = '\x1B', GS = '\x1D'
const COLS = 32
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s)

// Clean a customer note for a thermal printer and wrap it to the paper width.
const cleanNote = (n) => String(n || '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim()
const wrap = (text, width) => {
  const out = []
  let cur = ''
  text.split(' ').forEach(word => {
    while (word.length > width) {            // very long word: hard split
      if (cur) { out.push(cur); cur = '' }
      out.push(word.slice(0, width)); word = word.slice(width)
    }
    if (!cur) cur = word
    else if ((cur + ' ' + word).length <= width) cur += ' ' + word
    else { out.push(cur); cur = word }
  })
  if (cur) out.push(cur)
  return out
}

const buildTicket = ({ department, tableName, time, items, reprint, late }) => {
  const line = '-'.repeat(COLS)
  const itemBlocks = items.flatMap(i => {
    const qty = `x${i.qty}`
    const name = clip(i.name, COLS - qty.length - 1)
    const row = name + ' '.repeat(Math.max(1, COLS - name.length - qty.length))  + qty
    const note = cleanNote(i.note)
    const parts = [ESC + '!' + '\x10', row + '\n', ESC + '!' + '\x00']
    if (note) {
      parts.push(ESC + 'E' + '\x01')      // bold on
      wrap(note, COLS - 3).forEach((l, idx) => parts.push((idx === 0 ? '>> ' : '   ') + l + '\n'))
      parts.push(ESC + 'E' + '\x00')      // bold off
    }
    return parts
  })
  return [
    ESC + '@',                         // init
    ESC + 'a' + '\x01',                // center
    ESC + '!' + '\x30',                // double height+width
    department.toUpperCase() + '\n',
    ESC + '!' + '\x00',
    (reprint ? '** REPRINT **\n' : ''),
    (late ? '** LATE TICKET - placed earlier **\n' : ''),
    ESC + '!' + '\x10',                // double height
    `TABLE: ${tableName}\n`,
    ESC + '!' + '\x00',
    time + '\n',
    ESC + 'a' + '\x00',                // left
    line + '\n',
    ...itemBlocks,
    line + '\n',
    '\n\n\n',
    GS + 'V' + '\x41' + '\x03',        // partial cut
  ]
}

// Group items by department and print one small ticket per department.
// Returns { printed: [dept...], failed: [dept...], error }
export const printDepartmentTickets = async ({ tableName, time, items, config, reprint = false, late = false }) => {
  const groups = {}
  items.forEach(i => {
    const dep = DEPARTMENTS.includes(i.department) ? i.department : config.defaultDepartment
    ;(groups[dep] = groups[dep] || []).push(i)
  })

  const printed = []
  const failed = []
  let error = ''

  let qz = null
  try { qz = await connectQz() } catch (e) { error = e.message }

  for (const [department, deptItems] of Object.entries(groups)) {
    const printerName = (config.printers[department] || '').trim()
    if (!qz) { failed.push(department); continue }
    if (!printerName) {
      failed.push(department)
      error = error || `No printer name set for ${department}.`
      continue
    }
    try {
      const cfg = qz.configs.create(printerName, { encoding: 'UTF-8' })
      await qz.print(cfg, buildTicket({ department, tableName, time, items: deptItems, reprint, late })
        .map(d => ({ type: 'raw', format: 'plain', data: d })))
      printed.push(department)
    } catch (e) {
      failed.push(department)
      error = error || `${department}: ${e.message || e}`
    }
  }
  return { printed, failed, error }
}


// ── Shared "already printed" record (table kot_printed_items) ─────────
// Every order_items row is CLAIMED in the database before it is printed.
// The insert is atomic, so if two devices see the same new item only one
// wins the claim and prints. A failed print releases the claim for retry.
export const BILLING_NOTE = 'Added at billing'   // items added while billing are not sent to the kitchen
export const CATCHUP_HOURS = 24                  // orders older than this are never auto-printed
const STALE_CLAIM_MS = 60 * 1000                 // a claim that never finished is retried after 60s
const chunk = (arr, n = 150) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

const DEVICE_KEY = 'qr_kot_device_id'
export const getDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, id) }
    return id
  } catch (e) { return 'dev-unknown' }
}

// Returns the ids from `ids` that are already claimed/printed by ANY device.
export const fetchPrintedIds = async (ids) => {
  const done = new Set()
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  for (const part of chunk(ids)) {
    // free claims that were never finished (device crashed / closed mid-print)
    await supabase.from('kot_printed_items').delete()
      .in('order_item_id', part).eq('status', 'claiming').lt('claimed_at', cutoff)
    const { data, error } = await supabase.from('kot_printed_items')
      .select('order_item_id').in('order_item_id', part)
    if (error) throw new Error(error.message)
    ;(data || []).forEach(r => done.add(r.order_item_id))
  }
  return done
}

// Atomically claims items. Returns the set of ids THIS device won.
export const claimItems = async (ids) => {
  const won = new Set()
  const device = getDeviceId()
  for (const part of chunk(ids)) {
    const rows = part.map(id => ({ order_item_id: id, status: 'claiming', claimed_by: device }))
    const { data, error } = await supabase.from('kot_printed_items')
      .upsert(rows, { onConflict: 'order_item_id', ignoreDuplicates: true })
      .select('order_item_id')
    if (error) throw new Error(error.message)
    ;(data || []).forEach(r => won.add(r.order_item_id))
  }
  return won
}

export const markItemsPrinted = async (ids) => {
  for (const part of chunk(ids)) {
    await supabase.from('kot_printed_items')
      .update({ status: 'printed', printed_at: new Date().toISOString() })
      .in('order_item_id', part)
  }
}

export const releaseClaims = async (ids) => {
  for (const part of chunk(ids)) {
    await supabase.from('kot_printed_items').delete().in('order_item_id', part).eq('status', 'claiming')
  }
}


// ── Customer bill -> Billing printer (ESC/POS, silent) ────────────────
// Used by "Print Bill & Clear". Returns { ok, notConfigured, error }.
// If no Billing printer name is set, or QZ Tray is unavailable, the caller
// falls back to the normal browser print window.
const money = (n) => {
  const v = Number(n) || 0
  return 'Rs.' + (Number.isInteger(v) ? String(v) : v.toFixed(2))
}
const lr = (left, right) => {
  const l = clip(left, Math.max(1, COLS - right.length - 1))
  return l + ' '.repeat(Math.max(1, COLS - l.length - right.length)) + right
}
const center = (t) => {
  const s = clip(String(t || ''), COLS)
  return ' '.repeat(Math.floor((COLS - s.length) / 2)) + s
}

const buildBill = (b) => {
  const line = '-'.repeat(COLS)
  const out = [ESC + '@', ESC + 'a' + '\x01', ESC + '!' + '\x30']
  wrap(cleanNote(b.restaurantName || ''), 16).forEach(l => out.push(l + '\n'))   // double width = 16 cols
  out.push(ESC + '!' + '\x00')
  if (b.address) wrap(cleanNote(b.address), COLS).forEach(l => out.push(l + '\n'))
  if (b.phone) out.push(cleanNote(b.phone) + '\n')
  if (b.gstNumber) out.push('GST: ' + cleanNote(b.gstNumber) + '\n')
  out.push(ESC + 'a' + '\x00', line + '\n')
  out.push(lr('Table: ' + b.tableName, b.date) + '\n', 'Time: ' + b.time + '\n', line + '\n')

  const section = (title, items, subLabel, subValue) => {
    if (!items || items.length === 0) return
    out.push(ESC + 'E' + '\x01', title + '\n', ESC + 'E' + '\x00')
    items.forEach(i => out.push(lr(`${i.name} x${i.qty}`, money(i.total)) + '\n'))
    out.push(ESC + 'E' + '\x01', lr(subLabel, money(subValue)) + '\n', ESC + 'E' + '\x00', line + '\n')
  }
  section('FOOD', b.foodItems, 'Food Subtotal', b.foodSubtotal)
  section('LIQUOR', b.liquorItems, 'Liquor Subtotal', b.liquorSubtotal)

  out.push(lr('Subtotal', money(b.subtotal)) + '\n')
  if (b.serviceChargeAmt > 0) out.push(lr(`Service (${b.serviceChargePct}%)`, money(b.serviceChargeAmt)) + '\n')
  if (b.discountAmt > 0) {
    out.push(lr(`Discount${b.discountType === 'percent' ? ` (${b.discountValue}%)` : ' (Flat)'}`, '-' + money(b.discountAmt)) + '\n')
    if (b.discountReason) wrap('Reason: ' + cleanNote(b.discountReason), COLS).forEach(l => out.push(l + '\n'))
  }
  out.push(line + '\n', ESC + '!' + '\x10', lr('TOTAL', money(b.finalAmount)) + '\n', ESC + '!' + '\x00', line + '\n')
  out.push(ESC + 'a' + '\x01')
  wrap(cleanNote(b.footerNote || 'Thank you! Visit again!'), COLS).forEach(l => out.push(l + '\n'))
  out.push('\n\n\n', GS + 'V' + '\x41' + '\x03')
  return out
}

export const printBill = async ({ bill, config }) => {
  const printerName = ((config && config.printers && config.printers.Billing) || '').trim()
  if (!printerName) return { ok: false, notConfigured: true, error: 'No Billing printer name set.' }
  try {
    const qz = await connectQz()
    const cfg = qz.configs.create(printerName, { encoding: 'UTF-8' })
    await qz.print(cfg, buildBill(bill).map(d => ({ type: 'raw', format: 'plain', data: d })))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) }
  }
}


// ── Heartbeat: tells the customer page whether a kitchen ticket can print ──
// Every open Dashboard calls sendHeartbeat every ~8 seconds. If no Dashboard
// has reported in the last 25 seconds (laptop off, tab closed, no internet),
// the customer page refuses orders instead of saying "successful".
let _qzCheck = { at: 0, ok: true, detail: '' }
export const checkPrinters = async (config) => {
  const names = DEPARTMENTS.filter(d => d !== 'Billing')
    .map(d => ((config.printers && config.printers[d]) || '').trim()).filter(Boolean)
  if (names.length === 0) return { ok: false, detail: 'No printer name is set in Printers.' }
  try {
    const qz = await connectQz()
    for (const n of [...new Set(names)]) {
      const found = await qz.printers.find(n)
      if (!found || (Array.isArray(found) && found.length === 0)) throw new Error(`Printer "${n}" not found in Windows.`)
    }
    return { ok: true, detail: '' }
  } catch (e) {
    return { ok: false, detail: (e && e.message) || String(e) }
  }
}

export const sendHeartbeat = async (config) => {
  const enabled = !!config.enabled
  let ok = true, detail = ''
  if (enabled) {
    // healthy -> re-check every 60s (saves signing calls); unhealthy -> re-check every beat
    if (!_qzCheck.ok || Date.now() - _qzCheck.at > 60000) {
      const r = await checkPrinters(config)
      _qzCheck = { at: Date.now(), ok: r.ok, detail: r.detail }
    }
    ok = _qzCheck.ok; detail = _qzCheck.detail
  }
  await supabase.rpc('kot_beat', { p_device: getDeviceId(), p_enabled: enabled, p_qz_ok: ok, p_detail: detail })
  return { enabled, ok, detail }
}
