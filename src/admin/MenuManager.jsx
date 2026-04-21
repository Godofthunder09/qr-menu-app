import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'

export default function MenuManager() {
  const [categories, setCategories] = useState([])
  const [foodItems, setFoodItems] = useState([])
  const [newCategory, setNewCategory] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [itemDescription, setItemDescription] = useState('')
  const [itemImage, setItemImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('items')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  const fetchCategories = async () => {
    const { data } = await supabase.from('categories').select('*').order('created_at')
    setCategories(data || [])
  }

  const fetchFoodItems = async () => {
    const { data } = await supabase
      .from('food_items')
      .select('*, categories(name)')
      .order('created_at')
    setFoodItems(data || [])
  }

  useEffect(() => {
    fetchCategories()
    fetchFoodItems()
  }, [])

  const addCategory = async () => {
    if (!newCategory.trim()) return
    const { error } = await supabase.from('categories').insert({ name: newCategory.trim() })
    if (error) {
      alert('Error adding category: ' + error.message)
      return
    }
    setNewCategory('')
    fetchCategories()
    setMessage('Category added! ✅')
    setTimeout(() => setMessage(''), 2000)
  }

  const deleteCategory = async (id) => {
    if (!window.confirm('Delete this category?')) return
    await supabase.from('categories').delete().eq('id', id)
    fetchCategories()
  }

  const uploadImage = async (file) => {
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}.${fileExt}`
    const { error } = await supabase.storage
      .from('food-images')
      .upload(fileName, file)
    if (error) {
      console.error('Image upload error:', error.message)
      return null
    }
    const { data } = supabase.storage.from('food-images').getPublicUrl(fileName)
    return data.publicUrl
  }

  const addFoodItem = async () => {
    if (!itemName.trim()) { alert('Enter food name!'); return }
    if (!itemPrice) { alert('Enter price!'); return }
    if (!selectedCategory) { alert('Select a category!'); return }

    setLoading(true)
    setMessage('')

    let imageUrl = null
    if (itemImage) {
      imageUrl = await uploadImage(itemImage)
    }

    const { error } = await supabase.from('food_items').insert({
      name: itemName.trim(),
      price: parseFloat(itemPrice),
      description: itemDescription.trim(),
      image_url: imageUrl,
      category_id: selectedCategory,
      is_available: true,
    })

    if (error) {
      alert('Error adding food item: ' + error.message)
      setLoading(false)
      return
    }

    setItemName('')
    setItemPrice('')
    setItemDescription('')
    setItemImage(null)
    setSelectedCategory('')
    setLoading(false)
    setMessage('Food item added! ✅')
    setTimeout(() => setMessage(''), 2000)
    fetchFoodItems()
  }

  const toggleAvailable = async (id, current) => {
    await supabase.from('food_items').update({ is_available: !current }).eq('id', id)
    fetchFoodItems()
  }

  const deleteFoodItem = async (id) => {
    if (!window.confirm('Delete this item?')) return
    await supabase.from('food_items').delete().eq('id', id)
    fetchFoodItems()
  }

  return (
    <div className="min-h-screen bg-orange-50">

      {/* Navbar */}
      <div className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🍽️</span>
          <h1 className="text-xl font-bold text-orange-500">Menu Manager</h1>
        </div>
        <button
          onClick={() => navigate('/admin/dashboard')}
          className="bg-orange-100 text-orange-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-200"
        >
          ← Dashboard
        </button>
      </div>

      <div className="p-6 max-w-4xl mx-auto">

        {/* Success Message */}
        {message && (
          <div className="bg-green-100 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm font-medium">
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('items')}
            className={`px-5 py-2 rounded-full font-medium text-sm transition
              ${activeTab === 'items' ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border'}`}
          >
            Food Items
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`px-5 py-2 rounded-full font-medium text-sm transition
              ${activeTab === 'categories' ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border'}`}
          >
            Categories
          </button>
        </div>

        {/* Categories Tab */}
        {activeTab === 'categories' && (
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="font-bold text-gray-700 mb-4">Add Category</h2>
            <div className="flex gap-3 mb-6">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                placeholder="e.g. Starters, Main Course, Drinks"
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                onClick={addCategory}
                className="bg-orange-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-600"
              >
                Add
              </button>
            </div>

            <h2 className="font-bold text-gray-700 mb-3">All Categories</h2>
            {categories.length === 0 && (
              <p className="text-gray-400 text-sm">No categories yet.</p>
            )}
            <div className="space-y-2">
              {categories.map((cat) => (
                <div key={cat.id} className="flex justify-between items-center bg-orange-50 px-4 py-3 rounded-lg">
                  <span className="text-gray-700 font-medium">{cat.name}</span>
                  <button
                    onClick={() => deleteCategory(cat.id)}
                    className="text-red-400 hover:text-red-600 text-sm"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Food Items Tab */}
        {activeTab === 'items' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="font-bold text-gray-700 mb-4">Add Food Item</h2>
              <div className="space-y-3">
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addFoodItem()}
                  placeholder="Food name e.g. Paneer Butter Masala"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
                <input
                  type="number"
                  value={itemPrice}
                  onChange={(e) => setItemPrice(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addFoodItem()}
                  placeholder="Price in ₹"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
                <textarea
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  placeholder="Short description (optional)"
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">Select Category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>

                {/* Image Upload */}
                <div className="border-2 border-dashed border-orange-200 rounded-lg p-4 text-center">
                  <label className="cursor-pointer">
                    <div className="text-3xl mb-1">📷</div>
                    <p className="text-sm text-gray-500 mb-2">
                      {itemImage ? itemImage.name : 'Click to upload food image (optional)'}
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setItemImage(e.target.files[0])}
                    />
                    <span className="text-xs text-orange-400 underline">Browse file</span>
                  </label>
                </div>

                <button
                  onClick={addFoodItem}
                  disabled={loading}
                  className="w-full bg-orange-500 text-white py-3 rounded-lg font-semibold hover:bg-orange-600 transition disabled:opacity-50"
                >
                  {loading ? 'Adding...' : '+ Add Food Item'}
                </button>
              </div>
            </div>

            {/* Food Items List */}
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="font-bold text-gray-700 mb-4">
                All Food Items ({foodItems.length})
              </h2>
              {foodItems.length === 0 && (
                <p className="text-gray-400 text-sm">No food items yet. Add some above!</p>
              )}
              <div className="space-y-3">
                {foodItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-4 border border-gray-100 rounded-xl p-3">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-14 h-14 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-orange-100 rounded-lg flex items-center justify-center text-2xl">
                        🍴
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="font-semibold text-gray-700">{item.name}</p>
                      <p className="text-sm text-gray-400">
                        {item.categories?.name} • ₹{item.price}
                      </p>
                      {item.description && (
                        <p className="text-xs text-gray-400 mt-1">{item.description}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <button
                        onClick={() => toggleAvailable(item.id, item.is_available)}
                        className={`text-xs px-3 py-1 rounded-full font-medium
                          ${item.is_available
                            ? 'bg-green-100 text-green-600'
                            : 'bg-red-100 text-red-400'}`}
                      >
                        {item.is_available ? '✅ Available' : '❌ Off'}
                      </button>
                      <button
                        onClick={() => deleteFoodItem(item.id)}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
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