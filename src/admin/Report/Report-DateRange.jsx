import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase/client'

const toIST = (d) => new Date(d).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
})
const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const addDays = (dateStr, days) => {
  const d = new Date(dateStr); d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

const downloadCSV = (rows, filename) => {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

export default function ReportDateRange() {
  const navigate = useNavigate()
  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate, setToDate] = useState(todayIST())
  const [loading, setLoading] = useState(false)
  const [dataA, setDataA] = useState(null)
  const [dataB, setDataB] = useState(null)
  const [labelA, setLabelA] = useState('')
  const [labelB, setLabelB] = useState('')
  const [showPrintPreview, setShowPrintPreview] = useState(false)

  const toRange = (from, to) => ({
    startISO: new Date(from + 'T00:00:00+05:30').toISOString(),
    endISO: new Date(to + 'T23:59:59+05:30').toISOString(),
  })

  const fetchPeriod = async (from, to) => {
    const { startISO, endISO } = toRange(from, to)
    const { data: orders } = await supabase
      .from('orders')
      .select(`id, payment_type, paid_at, final_amount, subtotal,
        service_charge_amt, discount_amt, table_name_snapshot,
        order_items(quantity, price_at_order, food_items(name))`)
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)

    const map = {}
    orders?.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) map[key] = { ...o, order_items: [...(o.order_items || [])] }
      else map[key].order_items = [...map[key].order_items, ...(o.order_items || [])]
    })
    const bills = Object.values(map)

    const totalRevenue = bills.reduce((s, b) => s + (b.final_amount || 0), 0)
    const totalOrders = bills.length
    const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0
    const cash = bills.filter(b => b.payment_type === 'cash').reduce((s, b) => s + (b.final_amount || 0), 0)
    const upi = bills.filter(b => b.payment_type === 'upi').reduce((s, b) => s + (b.final_amount || 0), 0)
    const card = bills.filter(b => b.payment_type === 'card').reduce((s, b) => s + (b.final_amount || 0), 0)

    const itemMap = {}
    bills.forEach(b => b.order_items?.forEach(i => {
      const name = i.food_items?.name || 'Unknown'
      itemMap[name] = (itemMap[name] || 0) + i.quantity
    }))
    const top3 = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 3)

    const dayMap = {}
    bills.forEach(b => {
      const day = new Date(b.paid_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      dayMap[day] = (dayMap[day] || 0) + (b.final_amount || 0)
    })
    const bestDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0]

    return { totalRevenue, totalOrders, aov, cash, upi, card, top3, bestDay, bills }
  }

  const applyPreset = (preset) => {
    const today = todayIST()
    let from, to
    if (preset === '7d') { from = addDays(today, -6); to = today }
    else if (preset === '30d') { from = addDays(today, -29); to = today }
    else if (preset === 'thisMonth') {
      const d = new Date()
      from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; to = today
    } else if (preset === 'lastMonth') {
      const d = new Date(); d.setMonth(d.getMonth()-1)
      from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`
      const last = new Date(d.getFullYear(), d.getMonth()+1, 0)
      to = last.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    }
    setFromDate(from); setToDate(to)
    runFetch(from, to)
  }

  const runFetch = async (from, to) => {
    setLoading(true)
    const diffDays = Math.round((new Date(to) - new Date(from)) / (1000*60*60*24))
    const prevFrom = addDays(from, -(diffDays + 1))
    const prevTo = addDays(from, -1)
    const [a, b] = await Promise.all([fetchPeriod(from, to), fetchPeriod(prevFrom, prevTo)])
    setDataA(a); setDataB(b)
    setLabelA(`${formatDate(from)} → ${formatDate(to)}`)
    setLabelB(`${formatDate(prevFrom)} → ${formatDate(prevTo)}`)
    setLoading(false)
  }

  const pct = (a, b) => b === 0 ? null : (((a - b) / b) * 100).toFixed(1)

  const exportCSV = () => {
    if (!dataA) return
    const rows = [
      ['DATE RANGE COMPARISON'],
      ['Metric', labelA, labelB, '% Change'],
      ['Total Revenue', dataA.totalRevenue, dataB?.totalRevenue || 0, (pct(dataA.totalRevenue, dataB?.totalRevenue || 0) || '—') + '%'],
      ['Total Orders', dataA.totalOrders, dataB?.totalOrders || 0, (pct(dataA.totalOrders, dataB?.totalOrders || 0) || '—') + '%'],
      ['Avg Order Value', dataA.aov, dataB?.aov || 0, (pct(dataA.aov, dataB?.aov || 0) || '—') + '%'],
      ['Cash', dataA.cash, dataB?.cash || 0, ''],
      ['UPI', dataA.upi, dataB?.upi || 0, ''],
      ['Card', dataA.card, dataB?.card || 0, ''],
      [],
      ['Top Items (This Period)'],
      ...dataA.top3.map(([n, q]) => [n, q + ' sold']),
      [],
      ['Top Items (Previous Period)'],
      ...(dataB?.top3 || []).map(([n, q]) => [n, q + ' sold']),
    ]
    downloadCSV(rows, `DateRange_${fromDate}_${toDate}.csv`)
  }

  const StatRow = ({ label, a, b, prefix = '₹' }) => {
    const change = pct(a, b)
    return (
      <div className="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">
        <p className="text-sm text-gray-600">{label}</p>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-gray-400">{prefix}{b || 0} prev</p>
          </div>
          <div className="text-right min-w-[80px]">
            <p className="font-bold text-gray-800">{prefix}{a}</p>
            {change !== null && (
              <p className={`text-xs font-bold ${parseFloat(change) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {parseFloat(change) >= 0 ? '▲' : '▼'} {Math.abs(change)}%
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Print Preview */}
      {showPrintPreview && dataA && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="font-bold text-gray-800">Print Preview — Date Range</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">🖨️ Print</button>
                <button onClick={exportCSV} className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">📊 CSV</button>
                <button onClick={() => setShowPrintPreview(false)} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono text-sm">
              <div className="text-center mb-4 border-b pb-2">
                <p className="font-bold">HOTEL KHALASI SEAFOOD & BAR</p>
                <p>DATE RANGE COMPARISON</p>
                <p className="text-gray-500 text-xs">{labelA}</p>
              </div>
              <p className="font-bold mb-2">vs Previous: {labelB}</p>
              {[
                ['Total Revenue', dataA.totalRevenue, dataB?.totalRevenue],
                ['Total Orders', dataA.totalOrders, dataB?.totalOrders],
                ['Avg Order Value', dataA.aov, dataB?.aov],
                ['Cash', dataA.cash, dataB?.cash],
                ['UPI', dataA.upi, dataB?.upi],
                ['Card', dataA.card, dataB?.card],
              ].map(([label, a, b]) => (
                <div key={label} className="flex justify-between border-b py-1">
                  <span>{label}</span>
                  <span className="font-bold">Rs.{a} {b !== undefined && <span className="text-gray-400 text-xs">(prev Rs.{b || 0})</span>}</span>
                </div>
              ))}
              <p className="font-bold mt-3 mb-1">Top Items</p>
              {dataA.top3.map(([n, q], i) => <p key={i}>{i+1}. {n} — {q} sold</p>)}
              {dataA.bestDay && <p className="mt-2">Best Day: {formatDate(dataA.bestDay[0])} (Rs.{dataA.bestDay[1]})</p>}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-xl">📆</span>
          <h1 className="text-lg font-bold text-gray-800">Date Range</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          {dataA && <>
            <button onClick={() => setShowPrintPreview(true)} className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium">🖨️ Print</button>
            <button onClick={exportCSV} className="bg-green-100 text-green-600 px-3 py-1.5 rounded-lg text-xs font-medium">📊 CSV</button>
          </>}
          <button onClick={() => navigate('/admin/reports')} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium">← Reports</button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow p-5 mb-4">
          <div className="flex gap-2 flex-wrap mb-4">
            {[['7d','Last 7 Days'],['30d','Last 30 Days'],['thisMonth','This Month'],['lastMonth','Last Month']].map(([k, l]) => (
              <button key={k} onClick={() => applyPreset(k)}
                className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <div><label className="text-xs text-gray-500 block mb-1">From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
            <div><label className="text-xs text-gray-500 block mb-1">To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
            <button onClick={() => runFetch(fromDate, toDate)}
              className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
              Compare
            </button>
          </div>
        </div>

        {loading && <div className="text-center py-8 text-gray-400">Loading...</div>}

        {!loading && dataA && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
                <p className="text-xs font-bold text-orange-600">📅 This Period</p>
                <p className="text-xs text-gray-500">{labelA}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-xs font-bold text-gray-600">📅 Previous</p>
                <p className="text-xs text-gray-500">{labelB}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <h3 className="font-bold text-gray-700 mb-2">Performance vs Previous Period</h3>
              <StatRow label="Total Revenue" a={dataA.totalRevenue} b={dataB?.totalRevenue || 0} />
              <StatRow label="Total Orders" a={dataA.totalOrders} b={dataB?.totalOrders || 0} prefix="" />
              <StatRow label="Avg Order Value" a={dataA.aov} b={dataB?.aov || 0} />
            </div>

            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <h3 className="font-bold text-gray-700 mb-3">Payment Split</h3>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                {[['💵 Cash', dataA.cash, dataB?.cash, 'text-green-600'],
                  ['📱 UPI', dataA.upi, dataB?.upi, 'text-blue-600'],
                  ['💳 Card', dataA.card, dataB?.card, 'text-purple-600']].map(([label, a, b, cls]) => (
                  <div key={label} className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className={`font-bold ${cls}`}>₹{a}</p>
                    <p className="text-xs text-gray-400">vs ₹{b || 0}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white rounded-2xl shadow p-4">
                <p className="font-bold text-gray-700 mb-2 text-sm">🏆 Top Items (This)</p>
                {dataA.top3.map(([name, qty], i) => (
                  <p key={i} className="text-xs text-gray-600">{i+1}. {name} — {qty} sold</p>
                ))}
                {dataA.bestDay && (
                  <p className="text-xs text-orange-500 mt-2">📈 Best: {formatDate(dataA.bestDay[0])}</p>
                )}
              </div>
              <div className="bg-white rounded-2xl shadow p-4">
                <p className="font-bold text-gray-700 mb-2 text-sm">🏆 Top Items (Prev)</p>
                {dataB?.top3.map(([name, qty], i) => (
                  <p key={i} className="text-xs text-gray-600">{i+1}. {name} — {qty} sold</p>
                ))}
                {dataB?.bestDay && (
                  <p className="text-xs text-gray-500 mt-2">📈 Best: {formatDate(dataB.bestDay[0])}</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}