import { useEffect, useState } from 'react'
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

export default function ReportSettlement() {
  const navigate = useNavigate()
  const [fromDate, setFromDate] = useState(todayIST())
  const [toDate, setToDate] = useState(todayIST())
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [sortBy, setSortBy] = useState('time')
  const [showPrintPreview, setShowPrintPreview] = useState(false)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    setLoading(true)
    const startISO = new Date(fromDate + 'T00:00:00+05:30').toISOString()
    const endISO = new Date(toDate + 'T23:59:59+05:30').toISOString()
    const { data: orders } = await supabase
      .from('orders')
      .select('id, payment_type, paid_at, table_name_snapshot, subtotal, service_charge_amt, discount_amt, final_amount')
      .eq('is_paid', true).gte('paid_at', startISO).lte('paid_at', endISO)
      .order('paid_at', { ascending: false })

    if (!orders || orders.length === 0) { setData(null); setLoading(false); return }

    const map = {}
    orders.forEach(o => {
      const key = `${o.table_name_snapshot}__${o.paid_at?.substring(0, 16)}`
      if (!map[key]) map[key] = { ...o }
    })
    const bills = Object.values(map)

    const cash = bills.filter(b => b.payment_type === 'cash')
    const upi = bills.filter(b => b.payment_type === 'upi')
    const card = bills.filter(b => b.payment_type === 'card')

    setData({
      bills,
      cash: { total: cash.reduce((s, b) => s + (b.final_amount || 0), 0), count: cash.length },
      upi: { total: upi.reduce((s, b) => s + (b.final_amount || 0), 0), count: upi.length },
      card: { total: card.reduce((s, b) => s + (b.final_amount || 0), 0), count: card.length },
      grandTotal: bills.reduce((s, b) => s + (b.final_amount || 0), 0),
      gross: bills.reduce((s, b) => s + (b.subtotal || 0), 0),
      scTotal: bills.reduce((s, b) => s + (b.service_charge_amt || 0), 0),
      discTotal: bills.reduce((s, b) => s + (b.discount_amt || 0), 0),
    })
    setLoading(false)
  }

  const sortedBills = () => {
    if (!data) return []
    const b = [...data.bills]
    if (sortBy === 'time') return b.sort((a, c) => new Date(c.paid_at) - new Date(a.paid_at))
    if (sortBy === 'amount') return b.sort((a, c) => c.final_amount - a.final_amount)
    if (sortBy === 'table') return b.sort((a, c) => (a.table_name_snapshot || '').localeCompare(c.table_name_snapshot || ''))
    if (sortBy === 'payment') return b.sort((a, c) => (a.payment_type || '').localeCompare(c.payment_type || ''))
    return b
  }

  const exportCSV = () => {
    if (!data) return
    const rows = [
      ['SETTLEMENT REPORT', `${formatDate(fromDate)} to ${formatDate(toDate)}`],
      [],
      ['Cash Total', data.cash.total, data.cash.count + ' bills'],
      ['UPI Total', data.upi.total, data.upi.count + ' bills'],
      ['Card Total', data.card.total, data.card.count + ' bills'],
      ['Grand Total', data.grandTotal, data.bills.length + ' bills'],
      [],
      ['Gross Revenue', data.gross],
      ['Service Charge', data.scTotal],
      ['Discounts', data.discTotal],
      ['Net Collected', data.grandTotal],
      [],
      ['Table', 'Date', 'Time', 'Payment', 'Subtotal', 'SC', 'Discount', 'Final']
    ]
    sortedBills().forEach(b => rows.push([
      b.table_name_snapshot, formatDate(b.paid_at), toIST(b.paid_at),
      b.payment_type, b.subtotal, b.service_charge_amt, b.discount_amt, b.final_amount
    ]))
    downloadCSV(rows, `Settlement_${fromDate}_${toDate}.csv`)
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Print Preview — Settlement Slip */}
      {showPrintPreview && data && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="font-bold text-gray-800">Settlement Slip</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">🖨️ Print</button>
                <button onClick={exportCSV} className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">📊 CSV</button>
                <button onClick={() => setShowPrintPreview(false)} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono text-sm">
              <div className="text-center mb-4">
                <p className="font-bold text-lg">HOTEL KHALASI</p>
                <p>SETTLEMENT REPORT</p>
                <p className="text-gray-500 text-xs">{formatDate(fromDate)}{fromDate !== toDate ? ` to ${formatDate(toDate)}` : ''}</p>
                <p className="text-gray-400 text-xs">Printed: {formatDate(new Date())} {toIST(new Date().toISOString())}</p>
              </div>
              <div className="border-t border-b border-dashed py-3 mb-3 space-y-2">
                <div className="flex justify-between text-lg font-bold">
                  <span>💵 CASH</span><span>Rs.{data.cash.total}</span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span>📱 UPI</span><span>Rs.{data.upi.total}</span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span>💳 CARD</span><span>Rs.{data.card.total}</span>
                </div>
              </div>
              <div className="flex justify-between text-xl font-bold border-b border-dashed pb-3 mb-3">
                <span>TOTAL</span><span>Rs.{data.grandTotal}</span>
              </div>
              <div className="space-y-1 text-xs text-gray-600 mb-4">
                <div className="flex justify-between"><span>Total Bills</span><span>{data.bills.length}</span></div>
                <div className="flex justify-between"><span>Service Charge</span><span>Rs.{data.scTotal}</span></div>
                <div className="flex justify-between"><span>Discounts Given</span><span>-Rs.{data.discTotal}</span></div>
              </div>
              <div className="border-t border-dashed pt-4 text-xs text-gray-400 space-y-3">
                <div className="flex justify-between">
                  <span>Cash in Drawer:</span><span>_______________</span>
                </div>
                <div className="flex justify-between">
                  <span>Authorized By:</span><span>_______________</span>
                </div>
                <div className="flex justify-between">
                  <span>Signature:</span><span>_______________</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-xl">💰</span>
          <h1 className="text-lg font-bold text-gray-800">Settlement</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
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
        {!loading && !data && <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-2">💰</div><p>No transactions found</p></div>}

        {!loading && data && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[['💵 Cash', data.cash.total, data.cash.count, 'text-green-600 bg-green-50 border-green-200'],
                ['📱 UPI', data.upi.total, data.upi.count, 'text-blue-600 bg-blue-50 border-blue-200'],
                ['💳 Card', data.card.total, data.card.count, 'text-purple-600 bg-purple-50 border-purple-200']].map(([label, total, count, cls]) => (
                <div key={label} className={`border rounded-2xl p-4 text-center ${cls.split(' ').slice(1).join(' ')}`}>
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-xl font-bold ${cls.split(' ')[0]}`}>₹{total}</p>
                  <p className="text-xs text-gray-400">{count} bills</p>
                </div>
              ))}
            </div>

            <div className="bg-orange-500 rounded-2xl p-5 text-white mb-4 flex justify-between items-center">
              <div>
                <p className="text-sm opacity-80">Grand Total</p>
                <p className="text-4xl font-bold">₹{data.grandTotal}</p>
                <p className="text-sm opacity-80 mt-1">{data.bills.length} bills</p>
              </div>
              <div className="text-right text-sm opacity-80 space-y-1">
                <p>SC: +₹{data.scTotal}</p>
                <p>Disc: -₹{data.discTotal}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow p-5 mb-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600"><span>Gross Revenue</span><span>₹{data.gross}</span></div>
              <div className="flex justify-between text-gray-600"><span>+ Service Charge</span><span>₹{data.scTotal}</span></div>
              <div className="flex justify-between text-green-600"><span>- Discounts</span><span>-₹{data.discTotal}</span></div>
              <div className="flex justify-between font-bold text-gray-800 border-t pt-2"><span>Net Collected</span><span>₹{data.grandTotal}</span></div>
            </div>

            <div className="bg-white rounded-2xl shadow p-5">
              <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                <h3 className="font-bold text-gray-700">Transactions ({data.bills.length})</h3>
                <div className="flex gap-1">
                  {['time','amount','table','payment'].map(s => (
                    <button key={s} onClick={() => setSortBy(s)}
                      className={`px-2 py-1 rounded text-xs font-medium ${sortBy === s ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b">
                    <th className="text-left py-2 text-xs text-gray-500">Time</th>
                    <th className="text-left py-2 text-xs text-gray-500">Table</th>
                    <th className="text-left py-2 text-xs text-gray-500">Pay</th>
                    <th className="text-right py-2 text-xs text-gray-500">Subtotal</th>
                    <th className="text-right py-2 text-xs text-gray-500">SC</th>
                    <th className="text-right py-2 text-xs text-gray-500">Disc</th>
                    <th className="text-right py-2 text-xs text-gray-500">Total</th>
                  </tr></thead>
                  <tbody>
                    {sortedBills().map((bill, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 text-xs text-gray-400">{toIST(bill.paid_at)}</td>
                        <td className="py-2 font-medium text-gray-700 text-xs">{bill.table_name_snapshot}</td>
                        <td className="py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full
                            ${bill.payment_type === 'cash' ? 'bg-green-100 text-green-600'
                              : bill.payment_type === 'upi' ? 'bg-blue-100 text-blue-600'
                              : 'bg-purple-100 text-purple-600'}`}>
                            {bill.payment_type}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-600 text-xs">₹{bill.subtotal}</td>
                        <td className="py-2 text-right text-gray-400 text-xs">{bill.service_charge_amt > 0 ? `₹${bill.service_charge_amt}` : '—'}</td>
                        <td className="py-2 text-right text-green-600 text-xs">{bill.discount_amt > 0 ? `-₹${bill.discount_amt}` : '—'}</td>
                        <td className="py-2 text-right font-bold text-orange-500 text-xs">₹{bill.final_amount}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2">
                    <td colSpan={6} className="py-2 font-bold text-gray-700 text-xs">Total</td>
                    <td className="py-2 text-right font-bold text-orange-500">₹{data.grandTotal}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}