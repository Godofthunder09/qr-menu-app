import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import ReportToday      from './Report/Report-Today'
import ReportDateRange  from './Report/Report-DateRange'
import ReportCategory   from './Report/Report-Category'
import ReportDiscounts  from './Report/Report-Discounts'
import ReportSettlement from './Report/Report-Settlement'
import ReportTablewise  from './Report/Report-Tablewise'

const TABS = [
  { id: 'today',      label: '📅 Today' },
  { id: 'range',      label: '📆 Date Range' },
  { id: 'category',   label: '📊 Category' },
  { id: 'tables',     label: '🪑 Table-wise' },
  { id: 'discounts',  label: '🎁 Discounts' },
  { id: 'settlement', label: '💰 Settlement' },
]

export default function Reports() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('today')

  const renderTab = () => {
    switch (activeTab) {
      case 'today':      return <ReportToday />
      case 'range':      return <ReportDateRange />
      case 'category':   return <ReportCategory />
      case 'tables':     return <ReportTablewise />
      case 'discounts':  return <ReportDiscounts />
      case 'settlement': return <ReportSettlement />
      default:           return null
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Navbar */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <h1 className="text-lg font-bold text-orange-500">Reports</h1>
        </div>
        <button
          onClick={() => navigate('/admin/dashboard')}
          className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
          ← Dashboard
        </button>
      </div>

      <div className="p-4 md:p-6 max-w-5xl mx-auto">

        {/* Tab Bar */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 print:hidden">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap transition flex-shrink-0
                ${activeTab === tab.id
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-500 border hover:bg-orange-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Active Tab Content */}
        <div key={activeTab}>
          {renderTab()}
        </div>

      </div>
    </div>
  )
}