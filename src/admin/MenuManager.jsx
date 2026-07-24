import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function MenuManager() {
  const navigate = useNavigate()

  // ── Categories ────────────────────────────────────────────
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [newCatName, setNewCatName] = useState('')
  const [newSubName, setNewSubName] = useState('')
  const [newSubParent, setNewSubParent] = useState('')
  const [editCatId, setEditCatId] = useState(null)
  const [editCatName, setEditCatName] = useState('')
  const [editSubId, setEditSubId] = useState(null)
  const [editSubName, setEditSubName] = useState('')
  const [editSubParent, setEditSubParent] = useState('')

  // ── Food Items ────────────────────────────────────────────
  const [foodItems, setFoodItems] = useState([])
  const [filterCat, setFilterCat] = useState('all')

  // Add item form
  const [newItem, setNewItem] = useState({
    name: '', price: '', category_id: '', subcategory_id: '',
    description: '', is_available: true, image_url: ''
  })

  // Edit item form
  const [editItem, setEditItem] = useState(null)

  // ── UI state ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('items')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Message system — shows success/error with colour
  const [msg, setMsg] = useState(null) // { text, type: 'success'|'error' }
  const showMsg = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  // ── Fetch ─────────────────────────────────────────────────
  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)
    const [{ data: cats }, { data: items }] = await Promise.all([
      supabase.from('categories').select('*').order('created_at'),
      supabase.from('food_items')
        .select(`*, category:categories!food_items_category_id_fkey(id,name),
                     subcategory:categories!food_items_subcategory_id_fkey(id,name)`)
        .order('created_at'),
    ])
    const mainCats = (cats || []).filter(c => !c.is_subcategory)
    const subCats  = (cats || []).filter(c =>  c.is_subcategory)
    setCategories(mainCats)
    setSubcategories(subCats)
    setFoodItems(items || [])
    setLoading(false)
  }

  // ── Category CRUD ─────────────────────────────────────────
  const addCategory = async () => {
    const name = newCatName.trim()
    if (!name) { showMsg('Enter category name', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('categories').insert({ name, is_subcategory: false })
    setSaving(false)
    if (error) { showMsg('Error adding category: ' + error.message, 'error'); return }
    setNewCatName('')
    showMsg('Category added ✅')
    fetchAll()
  }

  const saveEditCategory = async () => {
    const name = editCatName.trim()
    if (!name) { showMsg('Enter category name', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('categories').update({ name }).eq('id', editCatId)
    setSaving(false)
    if (error) { showMsg('Error updating category: ' + error.message, 'error'); return }
    setEditCatId(null); setEditCatName('')
    showMsg('Category updated ✅')
    fetchAll()
  }

  // FIX: check if any food items use this category before deleting
  const deleteCategory = async (cat) => {
    // Count items using this category
    const { count, error: countErr } = await supabase
      .from('food_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', cat.id)
    if (countErr) { showMsg('Error checking items: ' + countErr.message, 'error'); return }
    if (count > 0) {
      showMsg(
        `❌ Cannot delete "${cat.name}" — ${count} item(s) still use this category. Remove or reassign those items first.`,
        'error'
      )
      return
    }
    // Also check subcategories referencing this parent
    const usedBySubs = subcategories.filter(s => s.parent_category_id === cat.id)
    if (usedBySubs.length > 0) {
      showMsg(
        `❌ Cannot delete "${cat.name}" — ${usedBySubs.length} subcategory/ies belong to it. Delete them first.`,
        'error'
      )
      return
    }
    if (!window.confirm(`Delete category "${cat.name}"?`)) return
    setSaving(true)
    const { error } = await supabase.from('categories').delete().eq('id', cat.id)
    setSaving(false)
    if (error) { showMsg('Error deleting category: ' + error.message, 'error'); return }
    showMsg('Category deleted ✅')
    fetchAll()
  }

  // ── Subcategory CRUD ──────────────────────────────────────
  const addSubcategory = async () => {
    const name = newSubName.trim()
    if (!name) { showMsg('Enter subcategory name', 'error'); return }
    if (!newSubParent) { showMsg('Select a parent category', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('categories').insert({
      name, is_subcategory: true, parent_category_id: newSubParent
    })
    setSaving(false)
    if (error) { showMsg('Error adding subcategory: ' + error.message, 'error'); return }
    setNewSubName(''); setNewSubParent('')
    showMsg('Subcategory added ✅')
    fetchAll()
  }

  const saveEditSubcategory = async () => {
    const name = editSubName.trim()
    if (!name) { showMsg('Enter subcategory name', 'error'); return }
    if (!editSubParent) { showMsg('Select a parent category', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('categories')
      .update({ name, parent_category_id: editSubParent }).eq('id', editSubId)
    setSaving(false)
    if (error) { showMsg('Error updating subcategory: ' + error.message, 'error'); return }
    setEditSubId(null); setEditSubName(''); setEditSubParent('')
    showMsg('Subcategory updated ✅')
    fetchAll()
  }

  // FIX: check if any food items use this subcategory before deleting
  const deleteSubcategory = async (sub) => {
    const { count, error: countErr } = await supabase
      .from('food_items')
      .select('id', { count: 'exact', head: true })
      .eq('subcategory_id', sub.id)
    if (countErr) { showMsg('Error checking items: ' + countErr.message, 'error'); return }
    if (count > 0) {
      showMsg(
        `❌ Cannot delete "${sub.name}" — ${count} item(s) still use this subcategory. Remove or reassign those items first.`,
        'error'
      )
      return
    }
    if (!window.confirm(`Delete subcategory "${sub.name}"?`)) return
    setSaving(true)
    const { error } = await supabase.from('categories').delete().eq('id', sub.id)
    setSaving(false)
    if (error) { showMsg('Error deleting subcategory: ' + error.message, 'error'); return }
    showMsg('Subcategory deleted ✅')
    fetchAll()
  }

  // ── Food Item CRUD ────────────────────────────────────────
  const addFoodItem = async () => {
    const name = newItem.name.trim()
    const price = parseFloat(newItem.price)
    if (!name) { showMsg('Enter item name', 'error'); return }
    if (!price || price <= 0) { showMsg('Enter valid price', 'error'); return }
    if (!newItem.category_id) { showMsg('Select a category', 'error'); return }

    setSaving(true)
    const payload = {
      name,
      price,
      category_id: newItem.category_id,
      // FIX: send null not empty string — empty string fails UUID FK constraint
      subcategory_id: newItem.subcategory_id || null,
      description: newItem.description.trim() || null,
      is_available: newItem.is_available,
      image_url: newItem.image_url.trim() || null,
    }
    const { error } = await supabase.from('food_items').insert(payload)
    setSaving(false)
    if (error) { showMsg('Error adding item: ' + error.message, 'error'); return }
    setNewItem({ name: '', price: '', category_id: '', subcategory_id: '', description: '', is_available: true, image_url: '' })
    showMsg(`"${name}" added ✅`)
    fetchAll()
  }

  const openEditItem = (item) => {
    setEditItem({
      id: item.id, name: item.name, price: item.price,
      category_id: item.category_id || '',
      subcategory_id: item.subcategory_id || '',
      description: item.description || '',
      is_available: item.is_available,
      image_url: item.image_url || '',
    })
  }

  const saveEditItem = async () => {
    const name = editItem.name.trim()
    const price = parseFloat(editItem.price)
    if (!name) { showMsg('Enter item name', 'error'); return }
    if (!price || price <= 0) { showMsg('Enter valid price', 'error'); return }
    if (!editItem.category_id) { showMsg('Select a category', 'error'); return }

    setSaving(true)
    const payload = {
      name,
      price,
      category_id: editItem.category_id,
      // FIX: send null not empty string
      subcategory_id: editItem.subcategory_id || null,
      description: editItem.description.trim() || null,
      is_available: editItem.is_available,
      image_url: editItem.image_url.trim() || null,
    }
    const { error } = await supabase.from('food_items').update(payload).eq('id', editItem.id)
    setSaving(false)
    if (error) { showMsg('Error updating item: ' + error.message, 'error'); return }
    setEditItem(null)
    showMsg(`"${name}" updated ✅`)
    fetchAll()
  }

  const toggleAvailability = async (item) => {
    const { error } = await supabase.from('food_items')
      .update({ is_available: !item.is_available }).eq('id', item.id)
    if (error) { showMsg('Error updating availability: ' + error.message, 'error'); return }
    showMsg(`"${item.name}" ${!item.is_available ? 'enabled' : 'disabled'} ✅`)
    fetchAll()
  }

  const deleteFoodItem = async (item) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    setSaving(true)
    const { error } = await supabase.from('food_items').delete().eq('id', item.id)
    setSaving(false)
    if (error) { showMsg('Error deleting item: ' + error.message, 'error'); return }
    showMsg(`"${item.name}" deleted ✅`)
    fetchAll()
  }

  // ── Derived ───────────────────────────────────────────────
  const filteredItems = filterCat === 'all'
    ? foodItems
    : foodItems.filter(i => i.category_id === filterCat)

  const subsForCategory = (catId) => subcategories.filter(s => s.parent_category_id === catId)
  const subsForNewItem  = newItem.category_id ? subsForCategory(newItem.category_id) : []
  const subsForEditItem = editItem?.category_id ? subsForCategory(editItem.category_id) : []

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      {/* Message Toast */}
      {msg && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium max-w-sm text-center transition-all
          ${msg.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
          {msg.text}
        </div>
      )}

      {/* Edit Item Modal */}
      {editItem && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b flex justify-between items-center">
              <h2 className="font-bold text-gray-800">✏️ Edit Item</h2>
              <button onClick={() => setEditItem(null)} className="text-gray-400 text-2xl font-bold">×</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Item Name *</label>
                <input type="text" value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Price (₹) *</label>
                <input type="number" min="0" value={editItem.price} onChange={e => setEditItem(p => ({ ...p, price: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Category *</label>
                <select value={editItem.category_id}
                  onChange={e => setEditItem(p => ({ ...p, category_id: e.target.value, subcategory_id: '' }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option value="">Select category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {subsForEditItem.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Subcategory</label>
                  <select value={editItem.subcategory_id}
                    onChange={e => setEditItem(p => ({ ...p, subcategory_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                    <option value="">None</option>
                    {subsForEditItem.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Description</label>
                <textarea value={editItem.description} onChange={e => setEditItem(p => ({ ...p, description: e.target.value }))}
                  rows={2} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Image URL</label>
                <input type="text" value={editItem.image_url} onChange={e => setEditItem(p => ({ ...p, image_url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 font-medium">Available</label>
                <button onClick={() => setEditItem(p => ({ ...p, is_available: !p.is_available }))}
                  className={`w-12 h-6 rounded-full transition ${editItem.is_available ? 'bg-green-500' : 'bg-gray-300'} relative`}>
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${editItem.is_available ? 'left-6' : 'left-0.5'}`} />
                </button>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditItem(null)} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-medium text-sm">Cancel</button>
                <button onClick={saveEditItem} disabled={saving}
                  className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-orange-600 disabled:opacity-50">
                  {saving ? 'Saving...' : '💾 Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-xl">🍽️</span>
          <h1 className="text-lg font-bold text-orange-500">Menu Manager</h1>
        </div>
        <button onClick={() => navigate('/admin/dashboard')}
          className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
          ← Dashboard
        </button>
      </div>

      <div className="p-4 max-w-3xl mx-auto">

        {/* Tabs */}
        <div className="flex gap-0 rounded-xl overflow-hidden border border-gray-200 mb-5">
          {[
            { id: 'items',      label: `🍴 Items (${foodItems.length})` },
            { id: 'categories', label: `📂 Categories (${categories.length})` },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-sm font-semibold transition
                ${activeTab === tab.id ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 hover:bg-orange-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {loading && <div className="text-center py-12 text-gray-400">Loading...</div>}

        {/* ════════════════════════════════════════════════ */}
        {/* TAB: FOOD ITEMS                                  */}
        {/* ════════════════════════════════════════════════ */}
        {!loading && activeTab === 'items' && (
          <div>
            {/* Add Item Form */}
            <div className="bg-white rounded-2xl shadow p-5 mb-5">
              <h2 className="font-bold text-gray-700 mb-4">➕ Add New Item</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Item Name *</label>
                    <input type="text" value={newItem.name}
                      onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Paneer Butter Masala"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Price (₹) *</label>
                    <input type="number" min="0" value={newItem.price}
                      onChange={e => setNewItem(p => ({ ...p, price: e.target.value }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Category *</label>
                    <select value={newItem.category_id}
                      onChange={e => setNewItem(p => ({ ...p, category_id: e.target.value, subcategory_id: '' }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                      <option value="">Select category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Subcategory</label>
                    <select value={newItem.subcategory_id}
                      onChange={e => setNewItem(p => ({ ...p, subcategory_id: e.target.value }))}
                      disabled={subsForNewItem.length === 0}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-400">
                      <option value="">None</option>
                      {subsForNewItem.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Description</label>
                  <textarea value={newItem.description}
                    onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))}
                    rows={2} placeholder="Optional description..."
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Image URL</label>
                  <input type="text" value={newItem.image_url}
                    onChange={e => setNewItem(p => ({ ...p, image_url: e.target.value }))}
                    placeholder="https://..."
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-700 font-medium">Available on menu</label>
                  <button onClick={() => setNewItem(p => ({ ...p, is_available: !p.is_available }))}
                    className={`w-12 h-6 rounded-full transition ${newItem.is_available ? 'bg-green-500' : 'bg-gray-300'} relative`}>
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${newItem.is_available ? 'left-6' : 'left-0.5'}`} />
                  </button>
                </div>
                <button onClick={addFoodItem} disabled={saving}
                  className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 disabled:opacity-50">
                  {saving ? 'Adding...' : '➕ Add Item'}
                </button>
              </div>
            </div>

            {/* Filter bar */}
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
              <button onClick={() => setFilterCat('all')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${filterCat === 'all' ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                All ({foodItems.length})
              </button>
              {categories.map(c => {
                const count = foodItems.filter(i => i.category_id === c.id).length
                return (
                  <button key={c.id} onClick={() => setFilterCat(c.id)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${filterCat === c.id ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                    {c.name} ({count})
                  </button>
                )
              })}
            </div>

            {/* Item list */}
            {filteredItems.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">🍴</div>
                <p>No items {filterCat !== 'all' ? 'in this category' : 'yet'}</p>
              </div>
            )}
            <div className="space-y-3">
              {filteredItems.map(item => (
                <div key={item.id}
                  className={`bg-white rounded-2xl shadow p-4 flex gap-4 items-start border-l-4 transition
                    ${item.is_available ? 'border-green-400' : 'border-gray-300 opacity-60'}`}>
                  {item.image_url
                    ? <img src={item.image_url} alt={item.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                    : <div className="w-16 h-16 bg-orange-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">🍴</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-bold text-gray-800">{item.name}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
                            {item.category?.name || 'No category'}
                          </span>
                          {item.subcategory?.name && (
                            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                              {item.subcategory.name}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${item.is_available ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                            {item.is_available ? '✅ Available' : '⛔ Hidden'}
                          </span>
                        </div>
                        {item.description && <p className="text-xs text-gray-400 mt-1 line-clamp-1">{item.description}</p>}
                      </div>
                      <p className="font-bold text-orange-500 text-lg flex-shrink-0">₹{item.price}</p>
                    </div>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button onClick={() => openEditItem(item)}
                        className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">
                        ✏️ Edit
                      </button>
                      <button onClick={() => toggleAvailability(item)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium ${item.is_available ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}>
                        {item.is_available ? '⛔ Hide' : '✅ Show'}
                      </button>
                      <button onClick={() => deleteFoodItem(item)}
                        className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200">
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════ */}
        {/* TAB: CATEGORIES                                  */}
        {/* ════════════════════════════════════════════════ */}
        {!loading && activeTab === 'categories' && (
          <div className="space-y-5">

            {/* ── Main Categories ─────────────────────── */}
            <div className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold text-gray-700 mb-4">📂 Main Categories</h2>

              {/* Add */}
              <div className="flex gap-2 mb-5">
                <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                  placeholder="New category name..."
                  onKeyDown={e => e.key === 'Enter' && addCategory()}
                  className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <button onClick={addCategory} disabled={saving}
                  className="bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-50">
                  {saving ? '...' : '+ Add'}
                </button>
              </div>

              {categories.length === 0 && (
                <div className="text-center py-6 text-gray-400 text-sm">No categories yet</div>
              )}

              <div className="space-y-2">
                {categories.map(cat => {
                  const itemCount = foodItems.filter(i => i.category_id === cat.id).length
                  const subCount  = subcategories.filter(s => s.parent_category_id === cat.id).length
                  const isEditing = editCatId === cat.id
                  return (
                    <div key={cat.id} className="border border-gray-100 rounded-xl overflow-hidden">
                      {isEditing ? (
                        <div className="p-3 bg-orange-50 flex gap-2">
                          <input type="text" value={editCatName} onChange={e => setEditCatName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveEditCategory()}
                            className="flex-1 border border-orange-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                          <button onClick={saveEditCategory} disabled={saving} className="bg-orange-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50">Save</button>
                          <button onClick={() => { setEditCatId(null); setEditCatName('') }} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-xs">Cancel</button>
                        </div>
                      ) : (
                        <div className="p-3 flex justify-between items-center">
                          <div>
                            <p className="font-semibold text-gray-800">{cat.name}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {itemCount} item{itemCount !== 1 ? 's' : ''}
                              {subCount > 0 ? ` · ${subCount} subcategory/ies` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { setEditCatId(cat.id); setEditCatName(cat.name) }}
                              className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">
                              ✏️
                            </button>
                            <button onClick={() => deleteCategory(cat)}
                              disabled={saving}
                              className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200 disabled:opacity-50">
                              🗑️
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Subcategories ────────────────────────── */}
            <div className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold text-gray-700 mb-4">📁 Subcategories</h2>

              {categories.length === 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 mb-4">
                  <p className="text-xs text-yellow-700">⚠️ Add at least one main category first before adding subcategories.</p>
                </div>
              )}

              {/* Add */}
              {categories.length > 0 && (
                <div className="space-y-2 mb-5">
                  <input type="text" value={newSubName} onChange={e => setNewSubName(e.target.value)}
                    placeholder="New subcategory name..."
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  <div className="flex gap-2">
                    <select value={newSubParent} onChange={e => setNewSubParent(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                      <option value="">Select parent category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button onClick={addSubcategory} disabled={saving}
                      className="bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-50">
                      {saving ? '...' : '+ Add'}
                    </button>
                  </div>
                </div>
              )}

              {subcategories.length === 0 && (
                <div className="text-center py-6 text-gray-400 text-sm">No subcategories yet</div>
              )}

              {/* Group by parent */}
              {categories.map(cat => {
                const subs = subcategories.filter(s => s.parent_category_id === cat.id)
                if (subs.length === 0) return null
                return (
                  <div key={cat.id} className="mb-4">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-2 px-1">📂 {cat.name}</p>
                    <div className="space-y-2">
                      {subs.map(sub => {
                        const itemCount = foodItems.filter(i => i.subcategory_id === sub.id).length
                        const isEditing = editSubId === sub.id
                        return (
                          <div key={sub.id} className="border border-gray-100 rounded-xl overflow-hidden ml-3">
                            {isEditing ? (
                              <div className="p-3 bg-blue-50 space-y-2">
                                <input type="text" value={editSubName} onChange={e => setEditSubName(e.target.value)}
                                  className="w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                                <div className="flex gap-2">
                                  <select value={editSubParent} onChange={e => setEditSubParent(e.target.value)}
                                    className="flex-1 border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                  <button onClick={saveEditSubcategory} disabled={saving} className="bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50">Save</button>
                                  <button onClick={() => { setEditSubId(null); setEditSubName(''); setEditSubParent('') }} className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-xs">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="p-3 flex justify-between items-center">
                                <div>
                                  <p className="font-medium text-gray-700 text-sm">↳ {sub.name}</p>
                                  <p className="text-xs text-gray-400 mt-0.5">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => { setEditSubId(sub.id); setEditSubName(sub.name); setEditSubParent(sub.parent_category_id) }}
                                    className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">✏️</button>
                                  <button onClick={() => deleteSubcategory(sub)} disabled={saving}
                                    className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200 disabled:opacity-50">🗑️</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* Orphaned subcategories (no parent match) */}
              {(() => {
                const orphans = subcategories.filter(s => !categories.find(c => c.id === s.parent_category_id))
                if (!orphans.length) return null
                return (
                  <div className="mt-4">
                    <p className="text-xs font-bold text-red-500 uppercase mb-2 px-1">⚠️ Orphaned (parent deleted)</p>
                    <div className="space-y-2">
                      {orphans.map(sub => (
                        <div key={sub.id} className="border border-red-100 rounded-xl p-3 flex justify-between items-center bg-red-50 ml-3">
                          <p className="text-sm text-red-600">{sub.name}</p>
                          <button onClick={() => deleteSubcategory(sub)} disabled={saving}
                            className="bg-red-200 text-red-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-300 disabled:opacity-50">🗑️ Delete</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
              <p className="text-xs text-blue-700 font-medium mb-1">ℹ️ Why can't I delete a category?</p>
              <p className="text-xs text-blue-600">
                A category or subcategory cannot be deleted if any menu items are still assigned to it.
                Go to the <strong>Items</strong> tab, filter by that category, and either delete or reassign those items first.
              </p>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
