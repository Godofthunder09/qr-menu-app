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

const buildTicket = ({ department, tableName, time, items, reprint }) => {
  const line = '-'.repeat(COLS)
  const rows = items.map(i => {
    const qty = `x${i.qty}`
    const name = clip(i.name, COLS - qty.length - 1)
    return name + ' '.repeat(Math.max(1, COLS - name.length - qty.length)) + qty
  })
  return [
    ESC + '@',                         // init
    ESC + 'a' + '\x01',                // center
    ESC + '!' + '\x30',                // double height+width
    department.toUpperCase() + '\n',
    ESC + '!' + '\x00',
    (reprint ? '** REPRINT **\n' : ''),
    ESC + '!' + '\x10',                // double height
    `TABLE: ${tableName}\n`,
    ESC + '!' + '\x00',
    time + '\n',
    ESC + 'a' + '\x00',                // left
    line + '\n',
    ESC + '!' + '\x10',
    rows.join('\n') + '\n',
    ESC + '!' + '\x00',
    line + '\n',
    '\n\n\n',
    GS + 'V' + '\x41' + '\x03',        // partial cut
  ]
}

// Group items by department and print one small ticket per department.
// Returns { printed: [dept...], failed: [dept...], error }
export const printDepartmentTickets = async ({ tableName, time, items, config, reprint = false }) => {
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
      await qz.print(cfg, buildTicket({ department, tableName, time, items: deptItems, reprint })
        .map(d => ({ type: 'raw', format: 'plain', data: d })))
      printed.push(department)
    } catch (e) {
      failed.push(department)
      error = error || `${department}: ${e.message || e}`
    }
  }
  return { printed, failed, error }
}
