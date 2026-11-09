// Grocery Camouflage Items Database

const GROCERY_ITEMS = [
  // Daily Staples & Dals (Ration)
  'Aashirvaad Aata', 'Basmati Rice', 'Toor Dal', 'Moong Dal', 'Chana Dal',
  'Urad Dal', 'Masoor Dal', 'Rajma', 'Chole', 'Kala Chana',
  'Poha', 'Sooji', 'Besan', 'Maida', 'Dalia', 'Sabudana',
  'Tata Salt', 'Sugar', 'Jaggery',

  // Cooking Oils & Ghee
  'Mustard Oil', 'Refined Oil', 'Fortune Sunflower Oil',
  'Desi Ghee', 'Groundnut Oil',

  // Spices & Masalas (Masaledani)
  'Haldi Powder', 'Lal Mirch Powder', 'Dhaniya Powder',
  'Garam Masala', 'Jeera', 'Rai',
  'Hing', 'Ajwain', 'Kasuri Methi', 'Kali Mirch',
  'Elaichi', 'Laung', 'Tej Patta',
  'Chaat Masala', 'Maggi Masala-e-Magic', 'Kitchen King Masala',

  // Vegetables & Daily Sabzi
  'Aaloo', 'Pyaaz', 'Tamatar', 'Adrak',
  'Lehsun', 'Hari Mirch', 'Dhaniya Patta',
  'Pudina', 'Nimbu', 'Bhindi', 'Gobi',
  'Patta Gobi', 'Shimla Mirch', 'Karela',
  'Lauki', 'Baingan', 'Palak', 'Matar',
  'Gajar', 'Mooli', 'Kaddu', 'Sweet Potato',

  // Fruits
  'Kela', 'Seb', 'Aam', 'Santra',
  'Anaar', 'Papita', 'Angoor', 'Amrood',
  'Mausambi', 'Chikoo', 'Watermelon',

  // Dairy & Bakery
  'Amul Doodh', 'Amul Taaza Milk', 'Amul Butter', 'Paneer',
  'Dahi', 'Amul Cheese Slices', 'Amul Fresh Cream',
  'Brown Bread', 'White Bread', 'Pav', 'Rusk',
  'Eggs',

  // Tea, Coffee & Breakfast
  'Tata Tea Gold', 'Red Label Chai', 'Taj Mahal Tea', 'Nescafe Coffee',
  'Bru Instant Coffee', 'Bournvita', 'Horlicks', 'Corn Flakes',
  'Oats',

  // Biscuits & Snacks
  'Parle-G', 'Good Day Cookies', 'Marie Gold', 'Monaco', 'Bourbon',
  'Haldiram Bhujia', 'Moong Dal Namkeen', 'Kurkure', 'Lays Chips',
  'Maggi Noodles', 'Knorr Soup', 'Chings Schezwan Chutney', 'Kissan Tomato Ketchup',

  // Household & Cleaning Essentials
  'Surf Excel', 'Vim Dishwash Bar', 'Lizol Floor Cleaner',
  'Harpic Toilet Cleaner', 'Colin Glass Cleaner', 'Dettol Handwash Refill',
  'Lifebuoy Soap', 'Dove Soap', 'Colgate Toothpaste',
  'Toothbrush', 'Head & Shoulders Shampoo', 'Clinic Plus Shampoo',
  'Coconut Hair Oil', 'Good Knight Liquid Refill', 'Odonil Air Freshener',
  'Pooja Agarbatti', 'Kapoor', 'Garbage Bags', 'Scotch Brite Scrub Pad',
  'Jhadu', 'Pocha', 'Matchbox', 'Tissue Paper Box'
];

function getRandomGroceryItem() {
  const existingItems = new Set(
    (state.messages || [])
      .map(m => (m.fakeText || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const available = GROCERY_ITEMS.filter(item => !existingItems.has(item.toLowerCase()));
  const pool = available.length > 0 ? available : GROCERY_ITEMS;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

