import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function MenuManager() {
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [foodItems, setFoodItems] = useState([])

  const [newCategory, setNewCategory] = useState('')
  const [newSubcategory, setNewSubcategory] = useState('')
  const [newSubcategoryParent, setNewSubcategoryParent] = useState('')

  const [itemName, setItemName] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [itemDescription, setItemDescription] = useState('')
  const [itemImage, setItemImage] = useState(null)
  const [itemCategory, setItemCategory] = useState('')
  const [itemSubcategory, setItemSubcategory] = useState('')

  const [editItem, setEditItem] = useState(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editImage, setEditImage] = useState(null)
  const [editCategory, setEditCategory] = useState('')
  const [editSubcategory, setEditSubcategory] = useState('')

  const [filterCategory, setFilterCategory] = useState('')
  const [filterSubcategory, setFilterSubcategory] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // CSV Import
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [csvPreview, setCsvPreview] = useState([])
  const [csvErrors, setCsvErrors] = useState([])
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvDone, setCsvDone] = useState(false)
  const csvFileRef = useRef(null)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('items')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  const fetchAll = async () => {
    const { data: cats } = await supabase
      .from('categories').select('*').eq('is_subcategory', false).order('created_at')
    setCategories(cats || [])

    const { data: subs } = await supabase
      .from('categories').select('*').eq('is_subcategory', true).order('created_at')
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

  // ── Categories ────────────────────────────────────────────
  const addCategory = async () => {
    if (!newCategory.trim()) return
    await supabase.from('categories').insert({ name: newCategory.trim(), is_subcategory: false })
    setNewCategory('')
    fetchAll()
    showMsg('Category added! ✅')
  }

  const addSubcategory = async () => {
    if (!newSubcategory.trim()) { alert('Enter subcategory name'); return }
    if (!newSubcategoryParent) { alert('Select a parent category'); return }
    await supabase.from('categories').insert({
      name: newSubcategory.trim(), is_subcategory: true, parent_id: newSubcategoryParent
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

  // ── Image upload ──────────────────────────────────────────
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

  // ── CSV Import ────────────────────────────────────────────
  const handleCsvFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setCsvText(ev.target.result)
      parseCsv(ev.target.result)
    }
    reader.readAsText(file)
  }

  const parseCsv = (text) => {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) {
      setCsvErrors(['CSV must have a header row and at least one data row.'])
      setCsvPreview([])
      return
    }

    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))
    const requiredCols = ['name', 'price']
    const missing = requiredCols.filter(c => !header.includes(c))
    if (missing.length > 0) {
      setCsvErrors([`Missing required columns: ${missing.join(', ')}`])
      setCsvPreview([])
      return
    }

    const nameIdx = header.indexOf('name')
    const priceIdx = header.indexOf('price')
    const descIdx = header.indexOf('description')
    const catIdx = header.indexOf('category')
    const subIdx = header.indexOf('subcategory')

    const errors = []
    const rows = []

    lines.slice(1).forEach((line, i) => {
      // Handle quoted commas
      const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(c => c.replace(/"/g, '').trim()) || line.split(',').map(c => c.trim())

      const name = cols[nameIdx] || ''
      const priceRaw = cols[priceIdx] || ''
      const description = descIdx >= 0 ? (cols[descIdx] || '') : ''
      const category = catIdx >= 0 ? (cols[catIdx] || '') : ''
      const subcategory = subIdx >= 0 ? (cols[subIdx] || '') : ''

      if (!name) { errors.push(`Row ${i + 2}: Name is empty`); return }

      const price = parseFloat(priceRaw)
      if (isNaN(price) || price <= 0) {
        errors.push(`Row ${i + 2}: Invalid price "${priceRaw}" for "${name}"`)
        return
      }

      rows.push({ name, price, description, category, subcategory })
    })

    setCsvErrors(errors)
    setCsvPreview(rows)
  }

  const importCsv = async () => {
    if (csvPreview.length === 0) return
    setCsvImporting(true)

    let imported = 0
    let skipped = 0

    for (const row of csvPreview) {
      // Find category by name
      let categoryId = null
      let subcategoryId = null

      if (row.category) {
        const cat = categories.find(c =>
          c.name.toLowerCase() === row.category.toLowerCase()
        )
        categoryId = cat?.id || null
      }

      if (row.subcategory && categoryId) {
        const sub = subcategories.find(s =>
          s.name.toLowerCase() === row.subcategory.toLowerCase() &&
          s.parent_id === categoryId
        )
        subcategoryId = sub?.id || null
      }

      const { error } = await supabase.from('food_items').insert({
        name: row.name,
        price: row.price,
        description: row.description || '',
        category_id: categoryId,
        subcategory_id: subcategoryId,
        is_available: true,
        image_url: null
      })

      if (error) skipped++
      else imported++
    }

    setCsvImporting(false)
    setCsvDone(true)
    fetchAll()
    showMsg(`✅ Imported ${imported} items! ${skipped > 0 ? `${skipped} skipped.` : ''}`)
  }

  const closeCsvModal = () => {
    setShowCsvModal(false)
    setCsvText('')
    setCsvPreview([])
    setCsvErrors([])
    setCsvDone(false)
    if (csvFileRef.current) csvFileRef.current.value = ''
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
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Price (₹)</label>
                <input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Description</label>
                <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Category</label>
                <select value={editCategory}
                  onChange={e => { setEditCategory(e.target.value); setEditSubcategory('') }}
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
                    <p className="text-xs text-gray-500">{editImage ? editImage.name : 'Click to change image'}</p>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => setEditImage(e.target.files[0])} />
                    <span className="text-xs text-orange-400 underline">Browse</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditItem(null)}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-xl font-medium">Cancel</button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 bg-orange-500 text-white py-2 rounded-xl font-medium disabled:opacity-50">
                {saving ? 'Saving...' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCsvModal && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">

            <div className="p-5 border-b">
              <h2 className="font-bold text-gray-800 text-lg">📥 Import Items from CSV</h2>
              <p className="text-xs text-gray-400 mt-1">
                Upload a CSV file to add multiple items at once
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* Format Guide */}
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <p className="text-xs font-bold text-orange-600 mb-2">📋 Required CSV Format:</p>
                <code className="text-xs text-gray-700 bg-white px-2 py-1 rounded block">
                  name,price,description,category,subcategory
                </code>
                <div className="mt-2 space-y-1 text-xs text-gray-500">
                  <p>• <strong>name</strong> and <strong>price</strong> are required</p>
                  <p>• <strong>description</strong>, <strong>category</strong>, <strong>subcategory</strong> are optional</p>
                  <p>• Category names must exactly match your existing categories</p>
                  <p>• Images can be added later by editing each item</p>
                </div>

                {/* Sample Download */}
                <button
                  onClick={() => {
                    const sample = `name,price,description,category,subcategory\nChicken Tikka,350,Grilled chicken with spices,Non-veg,Chicken\nPaneer Butter Masala,280,Rich creamy curry,Veg,\nDal Makhani,220,Slow cooked black lentils,Veg,\nNaan,40,Soft tandoor bread,Breads,\nKingfisher Beer,180,330ml chilled beer,Liquor,Beer`
                    const blob = new Blob([sample], { type: 'text/csv' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'menu_sample.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="mt-2 text-xs bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg font-medium hover:bg-orange-200">
                  ⬇️ Download Sample CSV
                </button>
              </div>

              {/* File Upload */}
              {!csvDone && (
                <div
                  className="border-2 border-dashed border-orange-300 rounded-xl p-6 text-center cursor-pointer hover:bg-orange-50 transition"
                  onClick={() => csvFileRef.current?.click()}>
                  <div className="text-4xl mb-2">📄</div>
                  <p className="text-sm text-gray-600 font-medium">Click to upload CSV file</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {csvText ? '✅ File loaded — see preview below' : 'Supports .csv files'}
                  </p>
                  <input
                    ref={csvFileRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleCsvFile}
                  />
                </div>
              )}

              {/* Errors */}
              {csvErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-red-600 mb-2">
                    ⚠️ {csvErrors.length} issue(s) found:
                  </p>
                  <div className="space-y-1">
                    {csvErrors.map((err, i) => (
                      <p key={i} className="text-xs text-red-500">{err}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview Table */}
              {csvPreview.length > 0 && !csvDone && (
                <div>
                  <p className="text-sm font-bold text-gray-700 mb-2">
                    Preview — {csvPreview.length} items ready to import
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-orange-50">
                        <tr>
                          <th className="text-left py-2 px-3 text-gray-500">Name</th>
                          <th className="text-left py-2 px-3 text-gray-500">Price</th>
                          <th className="text-left py-2 px-3 text-gray-500">Category</th>
                          <th className="text-left py-2 px-3 text-gray-500">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.map((row, i) => {
                          const catFound = row.category
                            ? categories.some(c => c.name.toLowerCase() === row.category.toLowerCase())
                            : true
                          return (
                            <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                              <td className="py-2 px-3 font-medium text-gray-700">{row.name}</td>
                              <td className="py-2 px-3 text-orange-600 font-bold">₹{row.price}</td>
                              <td className="py-2 px-3">
                                {row.category ? (
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                                    ${catFound ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                                    {catFound ? '✓' : '✗'} {row.category}
                                    {row.subcategory ? ` › ${row.subcategory}` : ''}
                                  </span>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-gray-400 truncate max-w-32">
                                {row.description || '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    ✅ Green = category found &nbsp; ❌ Red = category not found (item will be added without category)
                  </p>
                </div>
              )}

              {/* Done state */}
              {csvDone && (
                <div className="text-center py-8">
                  <div className="text-5xl mb-3">🎉</div>
                  <p className="text-lg font-bold text-green-600">Import Complete!</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {csvPreview.length} items added. Go to Food Items to add images.
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-t flex gap-3">
              <button onClick={closeCsvModal}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium">
                {csvDone ? '✅ Done' : 'Cancel'}
              </button>
              {csvPreview.length > 0 && !csvDone && (
                <button
                  onClick={importCsv}
                  disabled={csvImporting}
                  className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 disabled:opacity-50">
                  {csvImporting
                    ? `⏳ Importing...`
                    : `📥 Import ${csvPreview.length} Items`}
                </button>
              )}
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
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-bold text-gray-700">Add Food Item</h2>
                <button
                  onClick={() => { setShowCsvModal(true); setCsvDone(false) }}
                  className="bg-orange-100 text-orange-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-orange-200 flex items-center gap-2">
                  📥 Import CSV
                </button>
              </div>
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

            {/* Items List */}
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="font-bold text-gray-700 mb-4">All Food Items ({filteredItems.length})</h2>
              {filteredItems.length === 0 && <p className="text-gray-400 text-sm">No items found.</p>}
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
                        className="text-red-400 hover:text-red-600 text-xs">Delete</button>
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