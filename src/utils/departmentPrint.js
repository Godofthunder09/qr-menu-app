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

const connectQz = async () => {
  const qz = await loadQz()
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
