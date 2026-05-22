import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase/client'

const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
})
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

const LIQUOR_KEYWORDS = ['beer','wine','whisky','whiskey','vodka','rum','gin','tequila','brandy','champagne','scotch','bourbon','ale','lager','cider','feni','arrack','toddy','sangria','kingfisher','bacardi','liit','long island','shot','peg']
const isLiquor = (name = '') => LIQUOR_KEYWORDS.some(k => name.toLowerCase().includes(k))

const downloadCSV = (rows, filename) => {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

export default function ReportCategory() {
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

    const { data: items } = await supabase
      .from('order_items')
      .select('quantity, price_at_order, food_items(name, category_id), orders!inner(is_paid, paid_at)')
      .eq('orders.is_paid', true)
      .gte('orders.paid_at', startISO).lte('orders.paid_at', endISO)

    const { data: allFoodItems } = await supabase
      .from('food_items').select('name, category_id, is_available')

    const { data: cats } = await supabase
      .from('categories').select('id, name').eq('is_subcategory', false)

    const catMap = {}
    cats?.forEach(c => { catMap[c.id] = c.name })

    const catRevMap = {}
    let foodTotal = 0, liquorTotal = 0

    items?.forEach(i => {
      const name = i.food_items?.name || 'Unknown'
      const catId = i.food_items?.category_id
      const catName = catId ? (catMap[catId] || 'Uncategorized') : 'Uncategorized'
      const rev = i.price_at_order * i.quantity
      if (!catRevMap[catName]) catRevMap[catName] = { name: catName, qty: 0, revenue: 0, items: {} }
      catRevMap[catName].qty += i.quantity
      catRevMap[catName].revenue += rev
      catRevMap[catName].items[name] = (catRevMap[catName].items[name] || 0) + i.quantity
      if (isLiquor(name)) liquorTotal += rev
      else foodTotal += rev
    })

    const soldNames = new Set(items?.map(i => i.food_items?.name) || [])
    const zeroItems = allFoodItems?.filter(fi => !soldNames.has(fi.name) && fi.is_available) || []

    const catStats = Object.values(catRevMap)
      .map(c => ({ ...c, topItem: Object.entries(c.items).sort((a, b) => b[1] - a[1])[0] }))
      .sort((a, b) => b.revenue - a.revenue)

    setData({ catStats, foodTotal, liquorTotal, zeroItems, totalRevenue: foodTotal + liquorTotal })
    setLoading(false)
  }

  const exportCSV = () => {
    if (!data) return
    const total = data.totalRevenue
    const rows = [
      ['CATEGORY REPORT', `${formatDate(fromDate)} to ${formatDate(toDate)}`],
      [],
      ['Food Revenue', data.foodTotal, total > 0 ? ((data.foodTotal/total)*100).toFixed(1) + '%' : ''],
      ['Liquor Revenue', data.liquorTotal, total > 0 ? ((data.liquorTotal/total)*100).toFixed(1) + '%' : ''],
      [],
      ['Category', 'Items Sold', 'Revenue', '% of Total', 'Top Item'],
    ]
    data.catStats.forEach(c => {
      const share = total > 0 ? ((c.revenue / total) * 100).toFixed(1) : 0
      rows.push([c.name, c.qty, c.revenue, share + '%', c.topItem ? `${c.topItem[0]} (${c.topItem[1]})` : '—'])
    })
    rows.push([], ['--- ZERO SALES ITEMS (this period) ---'])
    data.zeroItems.forEach(i => rows.push([i.name]))
    downloadCSV(rows, `Category_${fromDate}_${toDate}.csv`)
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Print Preview */}
      {showPrintPreview && data && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="font-bold text-gray-800">Print Preview — Category</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">🖨️ Print</button>
                <button onClick={exportCSV} className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold">📊 CSV</button>
                <button onClick={() => setShowPrintPreview(false)} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-sm">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono text-sm">
              <div className="text-center mb-4 border-b pb-2">
                <p className="font-bold">HOTEL KHALASI SEAFOOD & BAR</p>
                <p>CATEGORY REPORT</p>
                <p className="text-xs text-gray-500">{formatDate(fromDate)} to {formatDate(toDate)}</p>
              </div>
              <div className="flex justify-between font-bold border-b pb-2 mb-2">
                <span>🍽 Food</span><span>Rs.{data.foodTotal} ({data.totalRevenue > 0 ? ((data.foodTotal/data.totalRevenue)*100).toFixed(0) : 0}%)</span>
              </div>
              <div className="flex justify-between font-bold border-b pb-2 mb-3">
                <span>🍺 Liquor</span><span>Rs.{data.liquorTotal} ({data.totalRevenue > 0 ? ((data.liquorTotal/data.totalRevenue)*100).toFixed(0) : 0}%)</span>
              </div>
              {data.catStats.map(cat => (
                <div key={cat.name} className="flex justify-between border-b py-1 text-xs">
                  <span>{cat.name} ({cat.qty} sold)</span>
                  <span className="font-bold">Rs.{cat.revenue}</span>
                </div>
              ))}
              {data.zeroItems.length > 0 && (
                <>
                  <p className="font-bold mt-4 mb-1">Zero Sales Items</p>
                  {data.zeroItems.map(i => <p key={i.name} className="text-xs text-gray-500">• {i.name}</p>)}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <h1 className="text-lg font-bold text-gray-800">Category</h1>
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
        {!loading && !data && <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-2">📊</div><p>Select date range and click View</p></div>}

        {!loading && data && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
                <p className="text-xs text-gray-500 mb-1">🍽 Food</p>
                <p className="text-3xl font-bold text-orange-600">₹{data.foodTotal}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {data.totalRevenue > 0 ? ((data.foodTotal / data.totalRevenue) * 100).toFixed(1) : 0}% of revenue
                </p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                <p className="text-xs text-gray-500 mb-1">🍺 Liquor</p>
                <p className="text-3xl font-bold text-purple-600">₹{data.liquorTotal}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {data.totalRevenue > 0 ? ((data.liquorTotal / data.totalRevenue) * 100).toFixed(1) : 0}% of revenue
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow p-5 mb-4">
              <h3 className="font-bold text-gray-700 mb-3">Category Breakdown</h3>
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2 text-xs text-gray-500">Category</th>
                  <th className="text-right py-2 text-xs text-gray-500">Sold</th>
                  <th className="text-right py-2 text-xs text-gray-500">Revenue</th>
                  <th className="text-right py-2 text-xs text-gray-500">Share</th>
                  <th className="text-right py-2 text-xs text-gray-500">Top Item</th>
                </tr></thead>
                <tbody>
                  {data.catStats.map(cat => {
                    const share = data.totalRevenue > 0 ? ((cat.revenue / data.totalRevenue) * 100).toFixed(1) : 0
                    return (
                      <tr key={cat.name} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 font-medium text-gray-700">{cat.name}</td>
                        <td className="py-2 text-right text-gray-500">{cat.qty}</td>
                        <td className="py-2 text-right font-bold text-orange-500">₹{cat.revenue}</td>
                        <td className="py-2 text-right text-gray-400">{share}%</td>
                        <td className="py-2 text-right text-gray-400 text-xs max-w-[80px] truncate">{cat.topItem?.[0] || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {data.zeroItems.length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
                <h3 className="font-bold text-red-600 mb-1">💀 Zero Sales ({data.zeroItems.length} items)</h3>
                <p className="text-xs text-gray-500 mb-3">No orders in this period — consider removing from menu</p>
                <div className="flex flex-wrap gap-2">
                  {data.zeroItems.map(i => (
                    <span key={i.name} className="bg-white border border-red-100 text-red-500 text-xs px-2 py-1 rounded-full">{i.name}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}