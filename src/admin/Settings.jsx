import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function Settings() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [restaurantName, setRestaurantName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [footerNote, setFooterNote] = useState('')

  useEffect(() => { fetchSettings() }, [])

  const fetchSettings = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('settings').select('*').eq('id', 'main').single()
    if (error) {
      console.error('fetchSettings:', error.message)
    }
    if (data) {
      setRestaurantName(data.restaurant_name || '')
      setAddress(data.address || '')
      setPhone(data.phone || '')
      setGstNumber(data.gst_number || '')
      setFooterNote(data.footer_note || '')
    }
    setLoading(false)
  }

  const saveSettings = async () => {
    if (!restaurantName.trim()) { alert('Restaurant name is required!'); return }
    setSaving(true)

    const { error } = await supabase.from('settings').upsert({
      id: 'main',
      restaurant_name: restaurantName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      gst_number: gstNumber.trim(),
      footer_note: footerNote.trim(),
      updated_at: new Date().toISOString()
    })

    if (error) {
      alert('Error saving: ' + error.message)
    } else {
      setMessage('Settings saved! ✅')
      setTimeout(() => setMessage(''), 3000)
    }
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-orange-50">

      {/* Navbar */}
      <div className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚙️</span>
          <h1 className="text-xl font-bold text-orange-500">Restaurant Settings</h1>
        </div>
        <button onClick={() => navigate('/admin/dashboard')}
          className="bg-orange-100 text-orange-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-200">
          ← Dashboard
        </button>
      </div>

      <div className="p-6 max-w-2xl mx-auto">

        {message && (
          <div className="bg-green-100 text-green-700 px-4 py-3 rounded-xl mb-4 text-sm font-medium">
            {message}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading settings...</div>
        ) : (
          <div className="space-y-4">

            {/* Restaurant Info Card */}
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="font-bold text-gray-700 text-base mb-4 flex items-center gap-2">
                🏪 Restaurant Information
              </h2>
              <div className="space-y-4">

                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    Restaurant Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={restaurantName}
                    onChange={e => setRestaurantName(e.target.value)}
                    placeholder="e.g. The Grand Kitchen"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Appears on top of every printed receipt
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    Address
                  </label>
                  <textarea
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="e.g. Shop 4, MG Road, Pune - 411001"
                    rows={2}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="e.g. +91 98765 43210"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    GST Number <span className="text-gray-400 text-xs">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={gstNumber}
                    onChange={e => setGstNumber(e.target.value)}
                    placeholder="e.g. 27ABCDE1234F1Z5"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Printed on receipt below address
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    Receipt Footer Message
                  </label>
                  <input
                    type="text"
                    value={footerNote}
                    onChange={e => setFooterNote(e.target.value)}
                    placeholder="e.g. Thank you! Visit again!"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
              </div>
            </div>

            {/* Preview Card */}
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="font-bold text-gray-700 text-base mb-4 flex items-center gap-2">
                🧾 Receipt Preview
              </h2>
              <div className="bg-gray-50 rounded-xl p-4 font-mono text-xs text-gray-700 text-center space-y-1">
                <p className="font-bold text-sm">{restaurantName || 'Restaurant Name'}</p>
                <p className="text-gray-500">{address || 'Address'}</p>
                <p className="text-gray-500">{phone || 'Phone'}</p>
                {gstNumber && <p className="text-gray-500">GST: {gstNumber}</p>}
                <p className="border-t border-dashed border-gray-300 pt-2 text-gray-400">
                  --------------------------------
                </p>
                <p>Table: T1 &nbsp;&nbsp; Date: 14 May 2026</p>
                <p className="text-gray-400">--------------------------------</p>
                <p className="flex justify-between px-4"><span>Chicken Tikka x2</span><span>Rs.700</span></p>
                <p className="flex justify-between px-4"><span>Naan x4</span><span>Rs.160</span></p>
                <p className="text-gray-400">--------------------------------</p>
                <p className="flex justify-between px-4 font-bold"><span>TOTAL</span><span>Rs.860</span></p>
                <p className="text-gray-400">--------------------------------</p>
                <p className="text-gray-500">{footerNote || 'Thank you! Visit again!'}</p>
              </div>
            </div>

            <button
              onClick={saveSettings}
              disabled={saving}
              className="w-full bg-orange-500 text-white py-4 rounded-2xl font-bold text-lg hover:bg-orange-600 transition disabled:opacity-50">
              {saving ? '⏳ Saving...' : '💾 Save Settings'}
            </button>

          </div>
        )}
      </div>
    </div>
  )
}