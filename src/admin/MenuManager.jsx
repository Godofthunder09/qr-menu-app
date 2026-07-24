import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import * as XLSX from 'xlsx'

export default function MenuManager() {
  const navigate = useNavigate()

  // ── State ─────────────────────────────────────────────────
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [foodItems, setFoodItems] = useState([])
  const [filterCat, setFilterCat] = useState('all')
  const [activeTab, setActiveTab] = useState('items')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  // Category forms
  const [newCatName, setNewCatName] = useState('')
  const [newSubName, setNewSubName] = useState('')
  const [newSubParent, setNewSubParent] = useState('')
  const [editCatId, setEditCatId] = useState(null)
  const [editCatName, setEditCatName] = useState('')
  const [editSubId, setEditSubId] = useState(null)
  const [editSubName, setEditSubName] = useState('')
  const [editSubParent, setEditSubParent] = useState('')

  // Item forms
  const [newItem, setNewItem] = useState({
    name: '', price: '', category_id: '', subcategory_id: '',
    description: '', is_available: true, image_url: ''
  })
  const [editItem, setEditItem] = useState(null)

  // ── Checkbox / bulk selection ─────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  // ── Excel upload ──────────────────────────────────────────
  const [showExcelModal, setShowExcelModal] = useState(false)
  const [excelPreview, setExcelPreview] = useState([])   // parsed rows
  const [excelErrors, setExcelErrors] = useState([])
  const [excelUploading, setExcelUploading] = useState(false)
  const [excelResult, setExcelResult] = useState(null)   // { added, skipped, errors }
  const fileInputRef = useRef(null)

  // ── Message helper ────────────────────────────────────────
  const showMsg = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 5000)
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
    setCategories((cats || []).filter(c => !c.is_subcategory))
    setSubcategories((cats || []).filter(c => c.is_subcategory))
    setFoodItems(items || [])
    setSelectedIds(new Set())
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
    setNewCatName(''); showMsg('Category added ✅'); fetchAll()
  }

  const saveEditCategory = async () => {
    const name = editCatName.trim()
    if (!name) { showMsg('Enter category name', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('categories').update({ name }).eq('id', editCatId)
    setSaving(false)
    if (error) { showMsg('Error updating category: ' + error.message, 'error'); return }
    setEditCatId(null); setEditCatName(''); showMsg('Category updated ✅'); fetchAll()
  }

  const deleteCategory = async (cat) => {
    // Check food items using this category
    const { count: itemCount } = await supabase
      .from('food_items').select('id', { count: 'exact', head: true }).eq('category_id', cat.id)
    if (itemCount > 0) {
      showMsg(`❌ "${cat.name}" has ${itemCount} item(s). Remove or reassign them first.`, 'error'); return
    }
    // Check subcategories — column is parent_id (NOT parent_category_id)
    const subs = subcategories.filter(s => s.parent_id === cat.id)
    if (subs.length > 0) {
      showMsg(`❌ "${cat.name}" has ${subs.length} subcategory/ies. Delete them first.`, 'error'); return
    }
    if (!window.confirm(`Delete category "${cat.name}"?`)) return
    setSaving(true)
    const { error } = await supabase.from('categories').delete().eq('id', cat.id)
    setSaving(false)
    if (error) { showMsg('Error deleting category: ' + error.message, 'error'); return }
    showMsg('Category deleted ✅'); fetchAll()
  }

  // ── Subcategory CRUD — uses correct column `parent_id` ───
  const addSubcategory = async () => {
    const name = newSubName.trim()
    if (!name) { showMsg('Enter subcategory name', 'error'); return }
    if (!newSubParent) { showMsg('Select a parent category', 'error'); return }
    setSaving(true)
    // FIX: column is `parent_id`, NOT `parent_category_id`
    const { error } = await supabase.from('categories').insert({
      name, is_subcategory: true, parent_id: newSubParent
    })
    setSaving(false)
    if (error) { showMsg('Error adding subcategory: ' + error.message, 'error'); return }
    setNewSubName(''); setNewSubParent(''); showMsg('Subcategory added ✅'); fetchAll()
  }

  const saveEditSubcategory = async () => {
    const name = editSubName.trim()
    if (!name) { showMsg('Enter subcategory name', 'error'); return }
    if (!editSubParent) { showMsg('Select a parent category', 'error'); return }
    setSaving(true)
    // FIX: column is `parent_id`
    const { error } = await supabase.from('categories')
      .update({ name, parent_id: editSubParent }).eq('id', editSubId)
    setSaving(false)
    if (error) { showMsg('Error updating subcategory: ' + error.message, 'error'); return }
    setEditSubId(null); setEditSubName(''); setEditSubParent('')
    showMsg('Subcategory updated ✅'); fetchAll()
  }

  const deleteSubcategory = async (sub) => {
    const { count } = await supabase
      .from('food_items').select('id', { count: 'exact', head: true }).eq('subcategory_id', sub.id)
    if (count > 0) {
      showMsg(`❌ "${sub.name}" has ${count} item(s). Remove or reassign them first.`, 'error'); return
    }
    if (!window.confirm(`Delete subcategory "${sub.name}"?`)) return
    setSaving(true)
    const { error } = await supabase.from('categories').delete().eq('id', sub.id)
    setSaving(false)
    if (error) { showMsg('Error deleting subcategory: ' + error.message, 'error'); return }
    showMsg('Subcategory deleted ✅'); fetchAll()
  }

  // ── Food Item CRUD ────────────────────────────────────────
  const addFoodItem = async () => {
    const name = newItem.name.trim()
    const price = parseFloat(newItem.price)
    if (!name) { showMsg('Enter item name', 'error'); return }
    if (!price || price <= 0) { showMsg('Enter valid price', 'error'); return }
    if (!newItem.category_id) { showMsg('Select a category', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('food_items').insert({
      name, price,
      category_id: newItem.category_id,
      subcategory_id: newItem.subcategory_id || null,
      description: newItem.description.trim() || null,
      is_available: newItem.is_available,
      image_url: newItem.image_url.trim() || null,
    })
    setSaving(false)
    if (error) { showMsg('Error adding item: ' + error.message, 'error'); return }
    setNewItem({ name: '', price: '', category_id: '', subcategory_id: '', description: '', is_available: true, image_url: '' })
    showMsg(`"${name}" added ✅`); fetchAll()
  }

  const openEditItem = (item) => setEditItem({
    id: item.id, name: item.name, price: item.price,
    category_id: item.category_id || '',
    subcategory_id: item.subcategory_id || '',
    description: item.description || '',
    is_available: item.is_available,
    image_url: item.image_url || '',
  })

  const saveEditItem = async () => {
    const name = editItem.name.trim()
    const price = parseFloat(editItem.price)
    if (!name) { showMsg('Enter item name', 'error'); return }
    if (!price || price <= 0) { showMsg('Enter valid price', 'error'); return }
    if (!editItem.category_id) { showMsg('Select a category', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('food_items').update({
      name, price,
      category_id: editItem.category_id,
      subcategory_id: editItem.subcategory_id || null,
      description: editItem.description.trim() || null,
      is_available: editItem.is_available,
      image_url: editItem.image_url.trim() || null,
    }).eq('id', editItem.id)
    setSaving(false)
    if (error) { showMsg('Error updating item: ' + error.message, 'error'); return }
    setEditItem(null); showMsg(`"${name}" updated ✅`); fetchAll()
  }

  const deleteFoodItem = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?\n\nIt will be removed from the menu but kept in order history.`)) return
    setSaving(true)
    // Nullify FK references before deleting
    await supabase.from('order_items').update({ food_item_id: null }).eq('food_item_id', item.id)
    await supabase.from('table_order_summary').update({ food_item_id: null }).eq('food_item_id', item.id)
    const { error } = await supabase.from('food_items').delete().eq('id', item.id)
    setSaving(false)
    if (error) { showMsg('Error deleting item: ' + error.message, 'error'); return }
    showMsg(`"${item.name}" deleted ✅`); fetchAll()
  }

  const toggleAvailability = async (item) => {
    const { error } = await supabase.from('food_items')
      .update({ is_available: !item.is_available }).eq('id', item.id)
    if (error) { showMsg('Error: ' + error.message, 'error'); return }
    showMsg(`"${item.name}" ${!item.is_available ? 'shown ✅' : 'hidden ✅'}`)
    fetchAll()
  }

  // ── Bulk operations ───────────────────────────────────────
  const filteredItems = filterCat === 'all' ? foodItems : foodItems.filter(i => i.category_id === filterCat)
  const allFilteredIds = filteredItems.map(i => i.id)
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id))
  const someSelected = selectedIds.size > 0

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => { const n = new Set(prev); allFilteredIds.forEach(id => n.delete(id)); return n })
    } else {
      setSelectedIds(prev => new Set([...prev, ...allFilteredIds]))
    }
  }

  const bulkSetAvailable = async (available) => {
    if (selectedIds.size === 0) return
    setBulkLoading(true)
    const ids = [...selectedIds]
    const { error } = await supabase.from('food_items')
      .update({ is_available: available }).in('id', ids)
    setBulkLoading(false)
    if (error) { showMsg('Bulk update error: ' + error.message, 'error'); return }
    showMsg(`${ids.length} item(s) ${available ? 'shown' : 'hidden'} ✅`)
    fetchAll()
  }

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    const names = filteredItems.filter(i => ids.includes(i.id)).map(i => i.name).join(', ')
    if (!window.confirm(`Delete ${ids.length} item(s)?\n\n${names}\n\nThis cannot be undone.`)) return
    setBulkLoading(true)
    // Nullify FK refs
    await supabase.from('order_items').update({ food_item_id: null }).in('food_item_id', ids)
    await supabase.from('table_order_summary').update({ food_item_id: null }).in('food_item_id', ids)
    const { error } = await supabase.from('food_items').delete().in('id', ids)
    setBulkLoading(false)
    if (error) { showMsg('Bulk delete error: ' + error.message, 'error'); return }
    showMsg(`${ids.length} item(s) deleted ✅`)
    fetchAll()
  }

  // ── Excel Upload ──────────────────────────────────────────
  // Required format (columns A–E):
  //   A: Category   B: Subcategory   C: Item Name   D: Description   E: Price
  // Row 1 must be the header row with exactly these labels.

  const REQUIRED_HEADERS = ['category', 'subcategory', 'item name', 'description', 'price']

  const handleExcelFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setExcelPreview([]); setExcelErrors([]); setExcelResult(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        if (rows.length < 2) {
          setExcelErrors(['❌ File is empty or has no data rows.']); return
        }

        // Validate headers
        const headers = rows[0].map(h => String(h).trim().toLowerCase())
        const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h))
        if (missing.length > 0) {
          setExcelErrors([
            `❌ Wrong format. Missing columns: ${missing.map(h => `"${h}"`).join(', ')}`,
            '',
            'Required columns (row 1 headers, in any order):',
            '  A: Category',
            '  B: Subcategory',
            '  C: Item Name',
            '  D: Description',
            '  E: Price',
          ]); return
        }

        // Map column indices
        const ci = (name) => headers.indexOf(name)
        const catIdx  = ci('category')
        const subIdx  = ci('subcategory')
        const nameIdx = ci('item name')
        const descIdx = ci('description')
        const priceIdx = ci('price')

        const errors = []
        const parsed = []

        rows.slice(1).forEach((row, i) => {
          const rowNum = i + 2 // 1-indexed, row 1 is header
          const cat   = String(row[catIdx]  || '').trim()
          const sub   = String(row[subIdx]  || '').trim()
          const name  = String(row[nameIdx] || '').trim()
          const desc  = String(row[descIdx] || '').trim()
          const price = parseFloat(row[priceIdx])

          if (!cat && !name && !price) return // skip fully empty rows

          if (!cat)  errors.push(`Row ${rowNum}: Category is required`)
          if (!name) errors.push(`Row ${rowNum}: Item Name is required`)
          if (!price || isNaN(price) || price <= 0)
            errors.push(`Row ${rowNum}: Price must be a positive number (got "${row[priceIdx]}")`)

          if (cat && name && price > 0) {
            parsed.push({ rowNum, category: cat, subcategory: sub, name, description: desc, price })
          }
        })

        setExcelErrors(errors)
        setExcelPreview(parsed)
      } catch (err) {
        setExcelErrors(['❌ Could not read file: ' + err.message])
      }
    }
    reader.readAsBinaryString(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const uploadExcel = async () => {
    if (excelPreview.length === 0) return
    setExcelUploading(true)

    // Build lookup maps of existing categories/subcategories (lowercased)
    const catMap  = {}  // lowercase name → id
    const subMap  = {}  // `${parentId}::${lowercase name}` → id
    categories.forEach(c => { catMap[c.name.toLowerCase()] = c.id })
    subcategories.forEach(s => { subMap[`${s.parent_id}::${s.name.toLowerCase()}`] = s.id })

    let added = 0, skipped = 0
    const rowErrors = []

    for (const row of excelPreview) {
      try {
        // 1. Get or create category
        const catKey = row.category.toLowerCase()
        let catId = catMap[catKey]
        if (!catId) {
          const { data: newCat, error: catErr } = await supabase
            .from('categories').insert({ name: row.category, is_subcategory: false }).select().single()
          if (catErr) { rowErrors.push(`Row ${row.rowNum} "${row.name}": Category error — ${catErr.message}`); skipped++; continue }
          catId = newCat.id
          catMap[catKey] = catId
        }

        // 2. Get or create subcategory (if provided)
        let subId = null
        if (row.subcategory) {
          const subKey = `${catId}::${row.subcategory.toLowerCase()}`
          subId = subMap[subKey]
          if (!subId) {
            const { data: newSub, error: subErr } = await supabase
              .from('categories').insert({ name: row.subcategory, is_subcategory: true, parent_id: catId }).select().single()
            if (subErr) { rowErrors.push(`Row ${row.rowNum} "${row.name}": Subcategory error — ${subErr.message}`); skipped++; continue }
            subId = newSub.id
            subMap[subKey] = subId
          }
        }

        // 3. Insert food item (skip if same name+category already exists)
        const exists = foodItems.find(
          f => f.name.toLowerCase() === row.name.toLowerCase() && f.category_id === catId
        )
        if (exists) { skipped++; continue }

        const { error: itemErr } = await supabase.from('food_items').insert({
          name: row.name,
          price: row.price,
          category_id: catId,
          subcategory_id: subId,
          description: row.description || null,
          is_available: true,
        })
        if (itemErr) { rowErrors.push(`Row ${row.rowNum} "${row.name}": ${itemErr.message}`); skipped++; continue }
        added++
      } catch (err) {
        rowErrors.push(`Row ${row.rowNum}: Unexpected error — ${err.message}`); skipped++
      }
    }

    setExcelUploading(false)
    setExcelResult({ added, skipped, errors: rowErrors })
    if (added > 0) fetchAll()
  }

  const closeExcelModal = () => {
    setShowExcelModal(false)
    setExcelPreview([]); setExcelErrors([]); setExcelResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Download sample Excel template
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Category', 'Subcategory', 'Item Name', 'Description', 'Price'],
      ['Beverages', 'Cold Drinks', 'Cold Coffee', 'Chilled cold coffee with milk', 150],
      ['Beverages', 'Cold Drinks', 'Frappe Mocha', 'Mocha frappe with cream', 190],
      ['Beverages', 'Fresh Juices', 'Fresh Pineapple Juice', 'Freshly squeezed pineapple', 150],
      ['Starters', '', 'Paneer Tikka', 'Grilled paneer with spices', 220],
      ['Main Course', 'Veg', 'Paneer Butter Masala', 'Rich paneer curry', 280],
    ])
    ws['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 35 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Menu')
    XLSX.writeFile(wb, 'menu_template.xlsx')
  }

  // ── Derived ───────────────────────────────────────────────
  const subsForCatId = (catId) => subcategories.filter(s => s.parent_id === catId)
  const subsForNewItem  = newItem.category_id  ? subsForCatId(newItem.category_id)  : []
  const subsForEditItem = editItem?.category_id ? subsForCatId(editItem.category_id) : []

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      {/* Toast Message */}
      {msg && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium max-w-md text-center
          ${msg.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
          {msg.text}
        </div>
      )}

      {/* ── Edit Item Modal ──────────────────────────────── */}
      {editItem && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b flex justify-between items-center">
              <h2 className="font-bold text-gray-800">✏️ Edit Item</h2>
              <button onClick={() => setEditItem(null)} className="text-gray-400 text-2xl font-bold leading-none">×</button>
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
                <select value={editItem.category_id} onChange={e => setEditItem(p => ({ ...p, category_id: e.target.value, subcategory_id: '' }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option value="">Select category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {subsForEditItem.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Subcategory</label>
                  <select value={editItem.subcategory_id} onChange={e => setEditItem(p => ({ ...p, subcategory_id: e.target.value }))}
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
                  className={`w-12 h-6 rounded-full transition-colors relative ${editItem.is_available ? 'bg-green-500' : 'bg-gray-300'}`}>
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

      {/* ── Excel Upload Modal ───────────────────────────── */}
      {showExcelModal && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center">
              <div>
                <h2 className="font-bold text-gray-800 text-lg">📊 Upload Menu from Excel</h2>
                <p className="text-xs text-gray-400 mt-0.5">Add multiple items at once from a spreadsheet</p>
              </div>
              <button onClick={closeExcelModal} className="text-gray-400 text-2xl font-bold leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* Format guide */}
              {!excelResult && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-sm font-bold text-blue-700 mb-2">📋 Required Excel Format</p>
                  <p className="text-xs text-blue-600 mb-3">Row 1 must be headers, data from Row 2 onwards:</p>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full border-collapse">
                      <thead>
                        <tr className="bg-blue-100">
                          {['A: Category *', 'B: Subcategory', 'C: Item Name *', 'D: Description', 'E: Price *'].map(h => (
                            <th key={h} className="border border-blue-200 px-2 py-1 text-blue-700 text-left whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Beverages', 'Cold Drinks', 'Cold Coffee', 'Chilled with milk', '150'],
                          ['Beverages', 'Fresh Juices', 'Pineapple Juice', 'Freshly squeezed', '150'],
                          ['Starters', '', 'Paneer Tikka', 'Grilled paneer', '220'],
                        ].map((row, i) => (
                          <tr key={i} className="bg-white">
                            {row.map((cell, j) => (
                              <td key={j} className="border border-blue-100 px-2 py-1 text-blue-800">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs text-blue-600">* = required column</span>
                    <span className="text-blue-300">·</span>
                    <span className="text-xs text-blue-600">Subcategory can be blank</span>
                    <span className="text-blue-300">·</span>
                    <span className="text-xs text-blue-600">Duplicate items are skipped</span>
                  </div>
                  <button onClick={downloadTemplate}
                    className="mt-3 text-xs bg-blue-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-600">
                    ⬇️ Download Template
                  </button>
                </div>
              )}

              {/* File picker */}
              {!excelResult && (
                <div>
                  <label className="block w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-orange-400 hover:bg-orange-50 transition">
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFile} className="hidden" />
                    <div className="text-4xl mb-2">📂</div>
                    <p className="font-medium text-gray-700">Click to choose Excel file</p>
                    <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv accepted</p>
                  </label>
                </div>
              )}

              {/* Validation errors */}
              {excelErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="font-bold text-red-600 text-sm mb-2">❌ Errors found — please fix your file:</p>
                  <div className="space-y-1">
                    {excelErrors.map((e, i) => (
                      <p key={i} className="text-xs text-red-600 font-mono">{e}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview table */}
              {excelPreview.length > 0 && !excelResult && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="font-bold text-gray-700 text-sm">
                      ✅ Preview — {excelPreview.length} item(s) ready to import
                      {excelErrors.length > 0 && <span className="text-orange-500 ml-2">({excelErrors.length} row(s) with errors will be skipped)</span>}
                    </p>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Row', 'Category', 'Subcategory', 'Item Name', 'Description', 'Price'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-gray-500 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {excelPreview.map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-400">{row.rowNum}</td>
                            <td className="px-3 py-2 font-medium text-orange-600">{row.category}</td>
                            <td className="px-3 py-2 text-blue-600">{row.subcategory || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2 font-medium text-gray-800">{row.name}</td>
                            <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate">{row.description || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2 font-bold text-green-600">₹{row.price}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={uploadExcel} disabled={excelUploading}
                    className="mt-4 w-full bg-green-500 text-white py-3 rounded-xl font-bold hover:bg-green-600 disabled:opacity-50">
                    {excelUploading ? '⏳ Uploading...' : `⬆️ Import ${excelPreview.length} Item(s)`}
                  </button>
                </div>
              )}

              {/* Upload result */}
              {excelResult && (
                <div className="space-y-3">
                  <div className={`rounded-2xl p-5 text-center ${excelResult.added > 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                    <div className="text-4xl mb-2">{excelResult.added > 0 ? '✅' : '⚠️'}</div>
                    <p className="font-bold text-gray-800 text-lg">{excelResult.added > 0 ? 'Import Complete!' : 'Import Finished'}</p>
                    <div className="flex justify-center gap-6 mt-3 text-sm">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">{excelResult.added}</p>
                        <p className="text-gray-500">Added</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-yellow-600">{excelResult.skipped}</p>
                        <p className="text-gray-500">Skipped</p>
                      </div>
                    </div>
                    {excelResult.skipped > 0 && (
                      <p className="text-xs text-gray-500 mt-2">Skipped = already exists or had errors</p>
                    )}
                  </div>
                  {excelResult.errors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                      <p className="font-bold text-red-600 text-sm mb-2">Row errors:</p>
                      {excelResult.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button onClick={closeExcelModal} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-medium">Close</button>
                    <button onClick={() => { setExcelPreview([]); setExcelErrors([]); setExcelResult(null) }}
                      className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl font-bold hover:bg-orange-600">
                      Upload Another
                    </button>
                  </div>
                </div>
              )}
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
        <div className="flex gap-2">
          <button onClick={() => setShowExcelModal(true)}
            className="bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-200">
            📊 Excel Upload
          </button>
          <button onClick={() => navigate('/admin/dashboard')}
            className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-200">
            ← Dashboard
          </button>
        </div>
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
                    rows={2} placeholder="Optional..."
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
                    className={`w-12 h-6 rounded-full transition-colors relative ${newItem.is_available ? 'bg-green-500' : 'bg-gray-300'}`}>
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
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
              <button onClick={() => setFilterCat('all')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 ${filterCat === 'all' ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                All ({foodItems.length})
              </button>
              {categories.map(c => {
                const count = foodItems.filter(i => i.category_id === c.id).length
                return (
                  <button key={c.id} onClick={() => setFilterCat(c.id)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 ${filterCat === c.id ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                    {c.name} ({count})
                  </button>
                )
              })}
            </div>

            {/* ── Bulk action bar ──────────────────────── */}
            <div className="bg-white rounded-xl shadow px-4 py-3 mb-3 flex items-center gap-3 flex-wrap">
              {/* Select All checkbox */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                  className="w-4 h-4 accent-orange-500 cursor-pointer" />
                <span className="text-sm text-gray-600 font-medium">
                  {allSelected ? 'Deselect all' : `Select all (${filteredItems.length})`}
                </span>
              </label>

              {someSelected && (
                <>
                  <div className="h-4 border-l border-gray-200" />
                  <span className="text-sm font-bold text-orange-500">{selectedIds.size} selected</span>
                  <div className="h-4 border-l border-gray-200" />
                  <button onClick={() => bulkSetAvailable(true)} disabled={bulkLoading}
                    className="bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-green-200 disabled:opacity-50">
                    ✅ Show All
                  </button>
                  <button onClick={() => bulkSetAvailable(false)} disabled={bulkLoading}
                    className="bg-yellow-100 text-yellow-700 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-yellow-200 disabled:opacity-50">
                    ⛔ Hide All
                  </button>
                  <button onClick={bulkDelete} disabled={bulkLoading}
                    className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-200 disabled:opacity-50">
                    🗑️ Delete All
                  </button>
                  <button onClick={() => setSelectedIds(new Set())}
                    className="text-gray-400 text-xs underline ml-auto">
                    Clear selection
                  </button>
                </>
              )}
              {bulkLoading && <span className="text-xs text-gray-400 animate-pulse">Processing...</span>}
            </div>

            {/* Item list */}
            {filteredItems.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">🍴</div>
                <p>No items {filterCat !== 'all' ? 'in this category' : 'yet'}</p>
              </div>
            )}
            <div className="space-y-2">
              {filteredItems.map(item => {
                const isSelected = selectedIds.has(item.id)
                return (
                  <div key={item.id}
                    className={`bg-white rounded-2xl shadow p-4 flex gap-3 items-start border-l-4 transition
                      ${isSelected ? 'border-orange-500 ring-2 ring-orange-200' : item.is_available ? 'border-green-400' : 'border-gray-300 opacity-60'}`}>

                    {/* Checkbox */}
                    <div className="flex-shrink-0 pt-1">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 accent-orange-500 cursor-pointer" />
                    </div>

                    {/* Image */}
                    {item.image_url
                      ? <img src={item.image_url} alt={item.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                      : <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">🍴</div>
                    }

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <p className="font-bold text-gray-800 text-sm">{item.name}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
                              {item.category?.name || '—'}
                            </span>
                            {item.subcategory?.name && (
                              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                                {item.subcategory.name}
                              </span>
                            )}
                            <span className={`text-xs px-2 py-0.5 rounded-full ${item.is_available ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                              {item.is_available ? '✅' : '⛔'}
                            </span>
                          </div>
                          {item.description && <p className="text-xs text-gray-400 mt-1 line-clamp-1">{item.description}</p>}
                        </div>
                        <p className="font-bold text-orange-500 text-base flex-shrink-0">₹{item.price}</p>
                      </div>
                      <div className="flex gap-2 mt-2 flex-wrap">
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
                )
              })}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════ */}
        {/* TAB: CATEGORIES                                  */}
        {/* ════════════════════════════════════════════════ */}
        {!loading && activeTab === 'categories' && (
          <div className="space-y-5">

            {/* Main Categories */}
            <div className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold text-gray-700 mb-4">📂 Main Categories</h2>
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
                  // FIX: use parent_id (actual DB column)
                  const subCount  = subcategories.filter(s => s.parent_id === cat.id).length
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
                              {subCount > 0 ? ` · ${subCount} sub` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { setEditCatId(cat.id); setEditCatName(cat.name) }}
                              className="bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-200">✏️</button>
                            <button onClick={() => deleteCategory(cat)} disabled={saving}
                              className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200 disabled:opacity-50">🗑️</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Subcategories */}
            <div className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold text-gray-700 mb-4">📁 Subcategories</h2>

              {categories.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 mb-4">
                  <p className="text-xs text-yellow-700">⚠️ Add at least one main category first.</p>
                </div>
              ) : (
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

              {/* FIX: group by parent_id */}
              {categories.map(cat => {
                const subs = subcategories.filter(s => s.parent_id === cat.id)
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
                                  className="w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
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
                                  <button onClick={() => { setEditSubId(sub.id); setEditSubName(sub.name); setEditSubParent(sub.parent_id) }}
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

              {/* Orphaned subcategories */}
              {(() => {
                const orphans = subcategories.filter(s => !categories.find(c => c.id === s.parent_id))
                if (!orphans.length) return null
                return (
                  <div className="mt-4">
                    <p className="text-xs font-bold text-red-500 uppercase mb-2 px-1">⚠️ Orphaned subcategories</p>
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
                A category/subcategory with items assigned cannot be deleted. Go to <strong>Items</strong> tab, filter by that category, select all with the checkbox, and bulk-delete or reassign first.
              </p>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
