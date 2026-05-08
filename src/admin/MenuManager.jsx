import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function MenuManager() {
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [foodItems, setFoodItems] = useState([])

  // Add form
  const [newCategory, setNewCategory] = useState('')
  const [newSubcategory, setNewSubcategory] = useState('')
  const [newSubcategoryParent, setNewSubcategoryParent] = useState('')

  // Food item form
  const [itemName, setItemName] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [itemDescription, setItemDescription] = useState('')
  const [itemImage, setItemImage] = useState(null)
  const [itemCategory, setItemCategory] = useState('')
  const [itemSubcategory, setItemSubcategory] = useState('')

  // Edit form
  const [editItem, setEditItem] = useState(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editImage, setEditImage] = useState(null)
  const [editCategory, setEditCategory] = useState('')
  const [editSubcategory, setEditSubcategory] = useState('')

  // Search/Filter
  const [filterCategory, setFilterCategory] = useState('')
  const [filterSubcategory, setFilterSubcategory] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('items')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  const fetchAll = async () => {
    const { data: cats } = await supabase
      .from('categories')
      .select('*')
      .eq('is_subcategory', false)
      .order('created_at')
    setCategories(cats || [])

    const { data: subs } = await supabase
      .from('categories')
      .select('*')
      .eq('is_subcategory', true)
      .order('created_at')
    setSubcategories(subs || [])

    const { data: items } = await supabase
      .from('food_items')
      .select('*, categories!food_items_category_id_fkey(name), subcategory:categories!food_items_subcategory_id_fkey(name)')
      .order('created_at')
    setFoodItems(items || [])
  }

  useEffect(() => { fetchAll() }, [])

  const showMsg = (msg) => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 2500)
  }

  // ── Categories ───────────────────────────────────────────
  const addCategory = async () => {
    if (!newCategory.trim()) return
    await supabase.from('categories').insert({
      name: newCategory.trim(),
      is_subcategory: false
    })
    setNewCategory('')
    fetchAll()
    showMsg('Category added! ✅')
  }

  const addSubcategory = async () => {
    if (!newSubcategory.trim()) { alert('Enter subcategory name'); return }
    if (!newSubcategoryParent) { alert('Select a parent category'); return }
    await supabase.from('categories').insert({
      name: newSubcategory.trim(),
      is_subcategory: true,
      parent_id: newSubcategoryParent
    })
    setNewSubcategory('')
    setNewSubcategoryParent('')
    fetchAll()
    showMsg('Subcategory added! ✅')
  }

  const deleteCategory = async (id) => {
    if (!window.confirm('Delete this category? Items in it will lose their category.')) return
    await supabase.from('categories').delete().eq('id', id)
    fetchAll()
  }

  // ── Image upload ─────────────────────────────────────────
  const uploadImage = async (file) => {
    const ext = file.name.split('.').pop()
    const fileName = `${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('food-images').upload(fileName, file)
    if (error) return null
    const { data } = supabase.storage.from('food-images').getPublicUrl(fileName)
    return data.publicUrl
  }

  // ── Add food item ─────────────────────────────────────────
  const addFoodItem = async () => {
    if (!itemName.trim()) { alert('Enter food name!'); return }
    if (!itemPrice) { alert('Enter price!'); return }
    if (!itemCategory) { alert('Select a category!'); return }
    setLoading(true)

    let imageUrl = null
    if (itemImage) imageUrl = await uploadImage(itemImage)

    await supabase.from('food_items').insert({
      name: itemName.trim(),
      price: parseFloat(itemPrice),
      description: itemDescription.trim(),
      image_url: imageUrl,
      category_id: itemCategory,
      subcategory_id: itemSubcategory || null,
      is_available: true
    })

    setItemName(''); setItemPrice(''); setItemDescription('')
    setItemImage(null); setItemCategory(''); setItemSubcategory('')
    setLoading(false)
    fetchAll()
    showMsg('Food item added! ✅')
  }

  // ── Edit food item ────────────────────────────────────────
  const openEdit = (item) => {
    setEditItem(item)
    setEditName(item.name)
    setEditPrice(item.price)
    setEditDescription(item.description || '')
    setEditImage(null)
    setEditCategory(item.category_id || '')
    setEditSubcategory(item.subcategory_id || '')
  }

  const saveEdit = async () => {
    if (!editName.trim()) { alert('Enter food name!'); return }
    if (!editPrice) { alert('Enter price!'); return }
    setSaving(true)

    let imageUrl = editItem.image_url
    if (editImage) imageUrl = await uploadImage(editImage)

    await supabase.from('food_items').update({
      name: editName.trim(),
      price: parseFloat(editPrice),
      description: editDescription.trim(),
      image_url: imageUrl,
      category_id: editCategory || null,
      subcategory_id: editSubcategory || null
    }).eq('id', editItem.id)

    setEditItem(null)
    setSaving(false)
    fetchAll()
    showMsg('Food item updated! ✅')
  }

  const toggleAvailable = async (id, current) => {
    await supabase.from('food_items').update({ is_available: !current }).eq('id', id)
    fetchAll()
  }

  const deleteFoodItem = async (id) => {
    if (!window.confirm('Delete this item?')) return
    await supabase.from('food_items').delete().eq('id', id)
    fetchAll()
  }

  // ── Filter logic ──────────────────────────────────────────
  const filteredSubcategories = filterCategory
    ? subcategories.filter(s => s.parent_id === filterCategory)
    : subcategories

  const editFilteredSubcategories = editCategory
    ? subcategories.filter(s => s.parent_id === editCategory)
    : subcategories

  const addFilteredSubcategories = itemCategory
    ? subcategories.filter(s => s.parent_id === itemCategory)
    : subcategories

  const filteredItems = foodItems.filter(item => {
    const matchCat = filterCategory ? item.category_id === filterCategory : true
    const matchSub = filterSubcategory ? item.subcategory_id === filterSubcategory : true
    const matchSearch = searchQuery.trim()
      ? item.name.toLowerCase().includes(searchQuery.toLowerCase())
      : true
    return matchCat && matchSub && matchSearch
  })

  return (
    <div className="min-h-screen bg-orange-50">

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-bold text-gray-800 text-lg mb-4">✏️ Edit Food Item</h2>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Name</label>
                <input type="text" value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Price (₹)</label>
                <input type="number" value={editPrice}
                  onChange={e => setEditPrice(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Description</label>
                <textarea value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Category</label>
                <select value={editCategory} onChange={e => { setEditCategory(e.target.value); setEditSubcategory('') }}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option value="">Select Category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {editFilteredSubcategories.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Subcategory (optional)</label>
                  <select value={editSubcategory} onChange={e => setEditSubcategory(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                    <option value="">No Subcategory</option>
                    {editFilteredSubcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Change Image (optional)</label>
                {editItem.image_url && (
                  <img src={editItem.image_url} alt="current"
                    className="w-20 h-20 rounded-xl object-cover mb-2" />
                )}
                <div className="border-2 border-dashed border-orange-200 rounded-lg p-3 text-center">
                  <label className="cursor-pointer">
                    <p className="text-xs text-gray-500">
                      {editImage ? editImage.name : 'Click to change image'}
                    </p>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => setEditImage(e.target.files[0])} />
                    <span className="text-xs text-orange-400 underline">Browse</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditItem(null)}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-xl font-medium">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 bg-orange-500 text-white py-2 rounded-xl font-medium disabled:opacity-50">
                {saving ? 'Saving...' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <div className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🍽️</span>
          <h1 className="text-xl font-bold text-orange-500">Menu Manager</h1>
        </div>
        <button onClick={() => navigate('/admin/dashboard')}
          className="bg-orange-100 text-orange-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-200">
          ← Dashboard
        </button>
      </div>

      <div className="p-6 max-w-4xl mx-auto">

        {message && (
          <div className="bg-green-100 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm font-medium">
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['items', 'categories', 'subcategories'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-full font-medium text-sm transition capitalize
                ${activeTab === tab ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border'}`}>
              {tab === 'items' ? 'Food Items' : tab === 'categories' ? 'Categories' : 'Sub-Categories'}
            </button>
          ))}
        </div>

        {/* ── Categories Tab ── */}
        {activeTab === 'categories' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="font-bold text-gray-700 mb-4">Add Category</h2>
            <div className="flex gap-3 mb-6">
              <input type="text" value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
                placeholder="e.g. Starters, Main Course, Drinks"
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <button onClick={addCategory}
                className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                Add
              </button>
            </div>
            <h2 className="font-bold text-gray-700 mb-3">All Categories ({categories.length})</h2>
            {categories.length === 0 && <p className="text-gray-400 text-sm">No categories yet.</p>}
            <div className="space-y-2">
              {categories.map(cat => (
                <div key={cat.id} className="flex justify-between items-center bg-orange-50 px-4 py-3 rounded-lg">
                  <div>
                    <span className="text-gray-700 font-medium">{cat.name}</span>
                    <span className="text-xs text-gray-400 ml-2">
                      ({subcategories.filter(s => s.parent_id === cat.id).length} subcategories)
                    </span>
                  </div>
                  <button onClick={() => deleteCategory(cat.id)}
                    className="text-red-400 hover:text-red-600 text-sm">Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Subcategories Tab ── */}
        {activeTab === 'subcategories' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="font-bold text-gray-700 mb-4">Add Sub-Category</h2>
            <div className="space-y-3 mb-6">
              <select value={newSubcategoryParent}
                onChange={e => setNewSubcategoryParent(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                <option value="">Select Parent Category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex gap-3">
                <input type="text" value={newSubcategory}
                  onChange={e => setNewSubcategory(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addSubcategory()}
                  placeholder="e.g. Chicken, Veg, Sea Food"
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <button onClick={addSubcategory}
                  className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
                  Add
                </button>
              </div>
            </div>

            <h2 className="font-bold text-gray-700 mb-3">All Sub-Categories ({subcategories.length})</h2>
            {categories.map(cat => {
              const subs = subcategories.filter(s => s.parent_id === cat.id)
              if (subs.length === 0) return null
              return (
                <div key={cat.id} className="mb-4">
                  <p className="text-xs font-bold text-orange-500 uppercase mb-2">{cat.name}</p>
                  <div className="space-y-2">
                    {subs.map(sub => (
                      <div key={sub.id} className="flex justify-between items-center bg-orange-50 px-4 py-2 rounded-lg">
                        <span className="text-gray-700 text-sm">{sub.name}</span>
                        <button onClick={() => deleteCategory(sub.id)}
                          className="text-red-400 hover:text-red-600 text-xs">Delete</button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Food Items Tab ── */}
        {activeTab === 'items' && (
          <div className="space-y-6">

            {/* Add Form */}
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="font-bold text-gray-700 mb-4">Add Food Item</h2>
              <div className="space-y-3">
                <input type="text" value={itemName}
                  onChange={e => setItemName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addFoodItem()}
                  placeholder="Food name e.g. Paneer Butter Masala"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <input type="number" value={itemPrice}
                  onChange={e => setItemPrice(e.target.value)}
                  placeholder="Price in ₹"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <textarea value={itemDescription}
                  onChange={e => setItemDescription(e.target.value)}
                  placeholder="Short description (optional)"
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <select value={itemCategory}
                  onChange={e => { setItemCategory(e.target.value); setItemSubcategory('') }}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option value="">Select Category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {addFilteredSubcategories.length > 0 && (
                  <select value={itemSubcategory} onChange={e => setItemSubcategory(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                    <option value="">No Subcategory (optional)</option>
                    {addFilteredSubcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                <div className="border-2 border-dashed border-orange-200 rounded-lg p-4 text-center">
                  <label className="cursor-pointer">
                    <div className="text-3xl mb-1">📷</div>
                    <p className="text-sm text-gray-500 mb-2">
                      {itemImage ? itemImage.name : 'Click to upload food image (optional)'}
                    </p>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => setItemImage(e.target.files[0])} />
                    <span className="text-xs text-orange-400 underline">Browse file</span>
                  </label>
                </div>
                <button onClick={addFoodItem} disabled={loading}
                  className="w-full bg-orange-500 text-white py-3 rounded-lg font-semibold hover:bg-orange-600 transition disabled:opacity-50">
                  {loading ? 'Adding...' : '+ Add Food Item'}
                </button>
              </div>
            </div>

            {/* Search & Filter */}
            <div className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold text-gray-700 mb-3">🔍 Search & Filter</h2>
              <div className="space-y-3">
                <input type="text" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by item name..."
                  className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-orange-50" />
                <div className="flex gap-3 flex-wrap">
                  <select value={filterCategory}
                    onChange={e => { setFilterCategory(e.target.value); setFilterSubcategory('') }}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                    <option value="">All Categories</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {filteredSubcategories.length > 0 && (
                    <select value={filterSubcategory}
                      onChange={e => setFilterSubcategory(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                      <option value="">All Subcategories</option>
                      {filteredSubcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                  {(filterCategory || filterSubcategory || searchQuery) && (
                    <button
                      onClick={() => { setFilterCategory(''); setFilterSubcategory(''); setSearchQuery('') }}
                      className="bg-gray-100 text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">
                      ✕ Clear
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  Showing {filteredItems.length} of {foodItems.length} items
                </p>
              </div>
            </div>

            {/* Food Items List */}
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="font-bold text-gray-700 mb-4">
                All Food Items ({filteredItems.length})
              </h2>
              {filteredItems.length === 0 && (
                <p className="text-gray-400 text-sm">No items found.</p>
              )}
              <div className="space-y-3">
                {filteredItems.map(item => (
                  <div key={item.id} className="flex items-center gap-4 border border-gray-100 rounded-xl p-3">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name}
                        className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 bg-orange-100 rounded-lg flex items-center justify-center text-2xl flex-shrink-0">🍴</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-700">{item.name}</p>
                      <p className="text-sm text-gray-400">
                        {item.categories?.name}
                        {item.subcategory?.name && ` › ${item.subcategory.name}`}
                        {' • '}₹{item.price}
                      </p>
                      {item.description && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{item.description}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <button onClick={() => toggleAvailable(item.id, item.is_available)}
                        className={`text-xs px-3 py-1 rounded-full font-medium
                          ${item.is_available ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-400'}`}>
                        {item.is_available ? '✅ Listed' : '❌ Delisted'}
                      </button>
                      <button onClick={() => openEdit(item)}
                        className="text-xs bg-orange-100 text-orange-600 px-3 py-1 rounded-full font-medium hover:bg-orange-200">
                        ✏️ Edit
                      </button>
                      <button onClick={() => deleteFoodItem(item.id)}
                        className="text-red-400 hover:text-red-600 text-xs">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}