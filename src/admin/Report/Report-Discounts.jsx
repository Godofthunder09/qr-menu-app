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

const downloadCSV = (rows, filename) => {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

export default function ReportDiscounts() {
  const navigate = useNavigate()
  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate, setToDate] = useState(todayIST())
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [showPrintPreview, setShowPrintPreview] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    const startISO = new Date(fromDate + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(toDate + 'T23:59:59+05:30').toISOString()
    const { data: orders } = await supabase
      .from('orders')
      .select('id, payment_type, paid_at, table_name_snapshot, subtotal, service_charge_amt, discount_type, discount_value, discount_amt, final_amount, discount_reason')
      .eq('is_paid', true).gt('discount_amt', 0)
      .gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    if (!orders || orders.length === 0) { setData(null); setLoading(false); return }

    const map = {}
    orders.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) map[key] = { ...o }
    })
    const bills = Object.values(map)

    const totalDiscount = bills.reduce((s, b) => s + (b.discount_amt || 0), 0)
    const grossRevenue = bills.reduce((s, b) => s + (b.subtotal || 0), 0)
    const avgDiscount = bills.length > 0 ? Math.round(totalDiscount / bills.length) : 0
    const discPct = grossRevenue > 0 ? ((totalDiscount / grossRevenue) * 100).toFixed(1) : 0

    const dayMap = {}
    bills.forEach(b => {
      const day = new Date(b.paid_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' })
      dayMap[day] = (dayMap[day] || 0) + (b.discount_amt || 0)
    })
    const topDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0]
    const largest = bills.reduce((max, b) => (b.discount_amt > max.discount_amt ? b : max), bills[0])

    const reasonMap = {}
    bills.forEach(b => {
      const r = b.discount_reason?.trim() || 'No reason given'
      if (!reasonMap[r]) reasonMap[r] = { reason: r, count: 0, total: 0 }
      reasonMap[r].count += 1; reasonMap[r].total += b.discount_amt || 0
    })

    const flaggedBills = bills.map(b => {
      const truePct = b.subtotal > 0 ? (b.discount_amt / b.subtotal) * 100 : 0
      return { ...b, truePct, flag: truePct >= 40 ? 'red' : truePct >= 20 ? 'yellow' : null }
    })

    setData({
      bills: flaggedBills, totalDiscount, grossRevenue, avgDiscount, discPct, topDay, largest,
      reasonBreakdown: Object.values(reasonMap).sort((a, b) => b.total - a.total),
      redFlags: flaggedBills.filter(b => b.flag === 'red').length,
      yellowFlags: flaggedBills.filter(b => b.flag === 'yellow').length
    })
    setLoading(false)
  }

  const exportCSV = () => {
    if (!data) return
    const rows = [
      ['DISCOUNT REPORT', `${formatDate(fromDate)} to ${formatDate(toDate)}`],
      [],
      ['Total Discounts', data.totalDiscount],
      ['Discount % of Revenue', data.discPct + '%'],
      ['Avg Discount/Bill', data.avgDiscount],
      ['Red Flag Bills (>40%)', data.redFlags],
      ['Yellow Flag Bills (20-40%)', data.yellowFlags],
      [],
      ['Table', 'Date', 'Time', 'Subtotal', 'Discount', 'Disc%', 'Final', 'Payment', 'Reason', 'Flag']
    ]
    data.bills.forEach(b => rows.push([
      b.table_name_snapshot, formatDate(b.paid_at), toIST(b.paid_at),
      b.subtotal, b.discount_amt, b.truePct.toFixed(1) + '%',
      b.final_amount, b.payment_type, b.discount_reason || '', b.flag || 'ok'
    ]))
    downloadCSV(rows, `Discounts_${fromDate}_${toDate}.csv`)
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Print Preview */}
      {showPrintPreview && data && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="font-bold text-gray-800">Print Preview — Discounts</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">🖨️ Print</button>
                <button onClick={exportCSV} className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">📊 CSV</button>
                <button onClick={() => setShowPrintPreview(false)} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono text-sm">
              <div className="text-center mb-4 border-b pb-2">
                <p className="font-bold">HOTEL KHALASI — DISCOUNT AUDIT</p>
                <p className="text-xs text-gray-500">{formatDate(fromDate)} to {formatDate(toDate)}</p>
              </div>
              <div className="space-y-1 mb-4">
                <div className="flex justify-between"><span>Total Discounts</span><span className="font-bold">Rs.{data.totalDiscount} ({data.discPct}%)</span></div>
                <div className="flex justify-between"><span>Bills Discounted</span><span>{data.bills.length}</span></div>
                <div className="flex justify-between"><span>Avg/Bill</span><span>Rs.{data.avgDiscount}</span></div>
                <div className="flex justify-between text-red-600"><span>🚨 Red Flags ({'>'}40%)</span><span>{data.redFlags}</span></div>
                <div className="flex justify-between text-yellow-600"><span>⚠️ Yellow Flags (20-40%)</span><span>{data.yellowFlags}</span></div>
              </div>
              <p className="font-bold mb-1">By Reason</p>
              {data.reasonBreakdown.map(r => (
                <div key={r.reason} className="flex justify-between text-xs border-b py-1">
                  <span>{r.reason} ({r.count})</span><span>Rs.{r.total}</span>
                </div>
              ))}
              <p className="font-bold mt-3 mb-1">All Discounted Bills</p>
              {data.bills.map((b, i) => (
                <div key={i} className={`text-xs border-b py-1 ${b.flag === 'red' ? 'text-red-600' : b.flag === 'yellow' ? 'text-yellow-600' : ''}`}>
                  <div className="flex justify-between">
                    <span>{b.table_name_snapshot} · {toIST(b.paid_at)}</span>
                    <span>-Rs.{b.discount_amt} ({b.truePct.toFixed(0)}%){b.flag ? ' ⚠️' : ''}</span>
                  </div>
                  {b.discount_reason && <p className="text-gray-500 ml-2">Reason: {b.discount_reason}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎁</span>
          <h1 className="text-lg font-bold text-gray-800">Discounts</h1>
        </div>
        <div className="flex gap-2">
          {data && <>
            <button onClick={() => setShowPrintPreview(true)} className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium">🖨️ Print</button>
            <button onClick={exportCSV} className="bg-green-100 text-green-600 px-3 py-1.5 rounded-lg text-xs font-medium">📊 CSV</button>
          </>}
          <button onClick={() => navigate('/admin/reports')} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium">← Reports</button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow p-5 mb-4">
          <div className="flex gap-3 flex-wrap items-end">
            <div><label className="text-xs text-gray-500 block mb-1">From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
            <div><label className="text-xs text-gray-500 block mb-1">To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" /></div>
            <button onClick={fetchData} className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">View</button>
          </div>
        </div>

        {loading && <div className="text-center py-8 text-gray-400">Loading...</div>}
        {!loading && !data && <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-2">🎁</div><p>No discounts in this period</p></div>}

        {!loading && data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className={`border rounded-2xl p-4 ${parseFloat(data.discPct) > 10 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <p className="text-xs text-gray-500 mb-1">Total Discounts</p>
                <p className={`text-2xl font-bold ${parseFloat(data.discPct) > 10 ? 'text-red-600' : 'text-green-600'}`}>₹{data.totalDiscount}</p>
                <p className="text-xs text-gray-400">{data.discPct}% of revenue</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">Bills Discounted</p>
                <p className="text-2xl font-bold text-gray-700">{data.bills.length}</p>
                <p className="text-xs text-gray-400">avg ₹{data.avgDiscount}/bill</p>
              </div>
              <div className={`border rounded-2xl p-4 ${data.redFlags > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                <p className="text-xs text-gray-500 mb-1">🚨 Red Flags</p>
                <p className={`text-2xl font-bold ${data.redFlags > 0 ? 'text-red-600' : 'text-gray-400'}`}>{data.redFlags}</p>
                <p className="text-xs text-gray-400">Disc {'>'}40%</p>
              </div>
              <div className={`border rounded-2xl p-4 ${data.yellowFlags > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-200'}`}>
                <p className="text-xs text-gray-500 mb-1">⚠️ Yellow</p>
                <p className={`text-2xl font-bold ${data.yellowFlags > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{data.yellowFlags}</p>
                <p className="text-xs text-gray-400">Disc 20–40%</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white rounded-2xl shadow p-4">
                <p className="text-xs text-gray-500 mb-1">📅 Most Discounts Day</p>
                <p className="font-bold text-gray-700">{data.topDay?.[0] || '—'}</p>
                <p className="text-xs text-gray-400">₹{data.topDay?.[1] || 0} discounted</p>
              </div>
              <div className="bg-white rounded-2xl shadow p-4">
                <p className="text-xs text-gray-500 mb-1">💸 Largest Discount</p>
                <p className="font-bold text-gray-700">₹{data.largest?.discount_amt || 0}</p>
                <p className="text-xs text-gray-400">{data.largest?.table_name_snapshot} · {data.largest ? toIST(data.largest.paid_at) : '—'}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <h3 className="font-bold text-gray-700 mb-3">By Reason</h3>
              <div className="space-y-2">
                {data.reasonBreakdown.map(r => (
                  <div key={r.reason} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
                    <div><p className="font-medium text-gray-700 text-sm">{r.reason}</p><p className="text-xs text-gray-400">{r.count} bill(s)</p></div>
                    <p className="font-bold text-red-500">-₹{r.total}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow p-5">
              <h3 className="font-bold text-gray-700 mb-3">All Discounted Bills</h3>
              <div className="space-y-2">
                {data.bills.map((bill, i) => (
                  <div key={i} className={`rounded-xl p-3 border ${bill.flag === 'red' ? 'bg-red-50 border-red-200' : bill.flag === 'yellow' ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-100'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-700 text-sm">{bill.table_name_snapshot}</p>
                          {bill.flag === 'red' && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">🚨 {bill.truePct.toFixed(0)}%</span>}
                          {bill.flag === 'yellow' && <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full">⚠️ {bill.truePct.toFixed(0)}%</span>}
                        </div>
                        <p className="text-xs text-gray-400">{formatDate(bill.paid_at)} · {toIST(bill.paid_at)}</p>
                        {bill.discount_reason && <p className="text-xs text-gray-500 mt-0.5">📝 {bill.discount_reason}</p>}
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-red-500">-₹{bill.discount_amt}</p>
                        <p className="text-xs text-gray-400">₹{bill.subtotal} → ₹{bill.final_amount}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}