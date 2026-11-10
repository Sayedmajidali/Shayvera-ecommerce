/**
 * DEMO catalog for local development, themed on Shayvera Food' product range
 * (spices & masalas, dry fruits, nuts, roasted makhana).
 * Product names, prices, stock, GST rates and HSN codes are PLACEHOLDERS — replace them with the
 * business's real catalog in Admin → Products, and have tax codes reviewed by an accountant.
 */
import type { Shape } from "./illustrations";

export type SeedCategory = {
  slug: string;
  name: string;
  description: string;
  background: string;
  shapes: Shape[];
  colors: string[];
  featured: boolean;
};

export const categories: SeedCategory[] = [
  {
    slug: "whole-spices",
    name: "Whole Spices",
    description:
      "Cardamom, pepper, cloves, cinnamon and cumin — carefully selected for aroma and flavour.",
    background: "#f1e8d8",
    shapes: ["jar", "heap", "jar"],
    colors: ["#7f9a5a", "#3b2f2a", "#8a4b2a"],
    featured: true,
  },
  {
    slug: "masalas",
    name: "Masalas & Powders",
    description: "Everyday ground spices and blends for authentic Indian cooking.",
    background: "#f3e6d6",
    shapes: ["jar", "standup", "jar"],
    colors: ["#d9a227", "#b8321f", "#6b3e26"],
    featured: true,
  },
  {
    slug: "dry-fruits",
    name: "Dry Fruits",
    description: "Raisins, dates, figs and apricots — naturally sweet and hygienically packed.",
    background: "#efe4d8",
    shapes: ["heap", "standup", "heap"],
    colors: ["#5b3a2e", "#8a5a44", "#d18a3c"],
    featured: true,
  },
  {
    slug: "nuts",
    name: "Nuts",
    description: "Almonds, cashews, walnuts and pistachios for snacking, sweets and cooking.",
    background: "#ece4d6",
    shapes: ["heap", "standup", "heap"],
    colors: ["#c49a6c", "#e9d7b0", "#8b5e3c"],
    featured: true,
  },
  {
    slug: "roasted-makhana",
    name: "Roasted Makhana",
    description: "Light, crunchy fox nuts roasted and seasoned — a better everyday snack.",
    background: "#efe3d5",
    shapes: ["makhana", "standup", "makhana"],
    colors: ["#b8321f", "#7f9a5a", "#d9a227"],
    featured: false,
  },
  {
    slug: "gift-boxes",
    name: "Gift Boxes",
    description: "Festive boxes of nuts and dry fruits for family, friends and colleagues.",
    background: "#efe6da",
    shapes: ["giftbox", "heap", "giftbox"],
    colors: ["#6b2f2a", "#c49a6c", "#2f4a3a"],
    featured: false,
  },
];

export type SeedVariant = {
  name: string;
  options: Record<string, string>;
  price: number; // rupees
  compareAt?: number;
  stock: number;
  color?: string;
};

export type SeedProduct = {
  slug: string;
  name: string;
  category: string;
  shape: Shape;
  short: string;
  description: string;
  ingredients: string;
  shelfLife: string;
  storage: string;
  taxRateBps: number;
  hsn: string;
  featured?: boolean;
  sales?: number;
  daysAgo?: number;
  color: string;
  variants: SeedVariant[];
};

const w = (weight: string, price: number, stock: number, compareAt?: number): SeedVariant => ({
  name: weight,
  options: { Weight: weight },
  price,
  compareAt,
  stock,
});

const DRY = "Store in a cool, dry place away from direct sunlight. Keep airtight after opening.";
const BRAND = "Shayvera Food";

export const products: SeedProduct[] = [
  // ── Whole spices ──
  {
    slug: "green-cardamom",
    name: "Green Cardamom (Elaichi)",
    category: "whole-spices",
    shape: "jar",
    color: "#7f9a5a",
    short: "Bold, aromatic green pods for chai, biryani and sweets.",
    description:
      "Plump green cardamom pods selected for their deep aroma. Crush a pod into your chai, add whole to biryani and pulao, or grind fresh for kheer and mithai.",
    ingredients: "Green cardamom (100%)",
    shelfLife: "12 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0908",
    featured: true,
    sales: 310,
    daysAgo: 60,
    variants: [w("50 g", 249, 60, 299), w("100 g", 469, 40, 549)],
  },
  {
    slug: "black-pepper-whole",
    name: "Black Pepper Whole",
    category: "whole-spices",
    shape: "heap",
    color: "#3b2f2a",
    short: "Bold, pungent peppercorns — grind fresh for the best flavour.",
    description:
      "Whole black peppercorns with a sharp, warming bite. Use whole in tempering or grind fresh over dals, eggs and salads.",
    ingredients: "Black pepper (100%)",
    shelfLife: "18 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0904",
    sales: 205,
    daysAgo: 80,
    variants: [w("100 g", 159, 80), w("250 g", 369, 45, 399)],
  },
  {
    slug: "cloves-laung",
    name: "Cloves (Laung)",
    category: "whole-spices",
    shape: "jar",
    color: "#5a3424",
    short: "Intensely aromatic whole cloves for garam masala and rice.",
    description:
      "Whole cloves with a rich, warm aroma — essential for garam masala, pulao and festive cooking.",
    ingredients: "Cloves (100%)",
    shelfLife: "18 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0907",
    sales: 120,
    daysAgo: 50,
    variants: [w("50 g", 129, 50), w("100 g", 239, 30)],
  },
  {
    slug: "cinnamon-sticks",
    name: "Cinnamon Sticks (Dalchini)",
    category: "whole-spices",
    shape: "jar",
    color: "#8a4b2a",
    short: "Sweet, woody cinnamon sticks for curries, chai and baking.",
    description: "Fragrant cinnamon sticks for slow-cooked curries, spiced tea and baking.",
    ingredients: "Cinnamon (100%)",
    shelfLife: "18 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0906",
    sales: 98,
    daysAgo: 35,
    variants: [w("50 g", 99, 70), w("100 g", 179, 0)],
  },
  {
    slug: "cumin-seeds",
    name: "Cumin Seeds (Jeera)",
    category: "whole-spices",
    shape: "heap",
    color: "#8c6a3f",
    short: "Earthy cumin for tadka, jeera rice and raitas.",
    description:
      "Cleaned, aromatic cumin seeds — the base of countless tadkas, jeera rice and roasted cumin raita.",
    ingredients: "Cumin seeds (100%)",
    shelfLife: "12 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0909",
    featured: true,
    sales: 260,
    daysAgo: 90,
    variants: [w("100 g", 89, 120), w("250 g", 199, 70, 219)],
  },
  // ── Masalas & powders ──
  {
    slug: "turmeric-powder",
    name: "Turmeric Powder (Haldi)",
    category: "masalas",
    shape: "jar",
    color: "#d9a227",
    short: "Bright, earthy turmeric for everyday cooking.",
    description:
      "Finely ground turmeric with a bright colour and earthy aroma — for dals, sabzis and haldi doodh.",
    ingredients: "Turmeric (100%)",
    shelfLife: "12 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0910",
    featured: true,
    sales: 420,
    daysAgo: 100,
    variants: [w("200 g", 79, 150), w("500 g", 179, 90, 199)],
  },
  {
    slug: "kashmiri-red-chilli-powder",
    name: "Kashmiri Red Chilli Powder",
    category: "masalas",
    shape: "jar",
    color: "#b8321f",
    short: "Rich colour with gentle heat.",
    description: "Kashmiri chilli powder gives curries a deep red colour with mild, rounded heat.",
    ingredients: "Kashmiri red chilli (100%)",
    shelfLife: "12 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0904",
    sales: 300,
    daysAgo: 70,
    variants: [w("100 g", 99, 100), w("200 g", 189, 60)],
  },
  {
    slug: "coriander-powder",
    name: "Coriander Powder (Dhaniya)",
    category: "masalas",
    shape: "standup",
    color: "#9b8a4e",
    short: "Fresh, citrusy coriander powder.",
    description:
      "Freshly ground coriander seed with a citrusy, nutty aroma for curries and chutneys.",
    ingredients: "Coriander seeds (100%)",
    shelfLife: "9 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0909",
    sales: 190,
    daysAgo: 40,
    variants: [w("200 g", 69, 110), w("500 g", 159, 50)],
  },
  {
    slug: "garam-masala",
    name: "Garam Masala",
    category: "masalas",
    shape: "jar",
    color: "#6b3e26",
    short: "A warm, aromatic blend of whole spices, freshly ground.",
    description:
      "Our garam masala blends cardamom, cloves, cinnamon, pepper and cumin for a warm, balanced finish to curries and dals.",
    ingredients:
      "Coriander, cumin, black pepper, cinnamon, cloves, green cardamom, bay leaf, nutmeg",
    shelfLife: "9 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0910",
    featured: true,
    sales: 350,
    daysAgo: 8,
    variants: [w("100 g", 109, 90, 129), w("200 g", 199, 40)],
  },
  {
    slug: "chole-masala",
    name: "Chole Masala",
    category: "masalas",
    shape: "standup",
    color: "#7a3b22",
    short: "Tangy, spiced blend for Punjabi-style chole.",
    description:
      "A tangy, aromatic blend with dried mango and pomegranate notes for rich, dark chole.",
    ingredients:
      "Coriander, cumin, dry mango, red chilli, black pepper, dried pomegranate seeds, cloves, cinnamon, salt",
    shelfLife: "9 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0910",
    sales: 140,
    daysAgo: 4,
    variants: [w("100 g", 89, 70)],
  },
  // ── Dry fruits ──
  {
    slug: "golden-raisins",
    name: "Golden Raisins (Kishmish)",
    category: "dry-fruits",
    shape: "heap",
    color: "#c98a2e",
    short: "Plump, naturally sweet golden raisins.",
    description: "Seedless golden raisins for kheer, pulao, baking or a quick snack.",
    ingredients: "Raisins (100%)",
    shelfLife: "9 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0806",
    sales: 230,
    daysAgo: 55,
    variants: [w("250 g", 149, 90), w("500 g", 279, 50, 299)],
  },
  {
    slug: "anjeer-dried-figs",
    name: "Anjeer (Dried Figs)",
    category: "dry-fruits",
    shape: "heap",
    color: "#8a5a44",
    short: "Soft, chewy dried figs rich in natural sweetness.",
    description:
      "Soft dried figs — enjoy soaked overnight, in milkshakes or chopped into desserts.",
    ingredients: "Dried figs (100%)",
    shelfLife: "9 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0804",
    featured: true,
    sales: 160,
    daysAgo: 20,
    variants: [w("250 g", 449, 40, 499), w("500 g", 849, 20)],
  },
  {
    slug: "dates-premium",
    name: "Premium Dates (Khajoor)",
    category: "dry-fruits",
    shape: "heap",
    color: "#4a2a1e",
    short: "Soft, caramel-sweet dates.",
    description:
      "Soft, caramel-like dates for an instant energy boost or naturally sweet desserts.",
    ingredients: "Dates (100%). May contain pits.",
    shelfLife: "6 months from packing",
    storage: "Store in a cool, dry place. Refrigerate after opening for longer freshness.",
    taxRateBps: 500,
    hsn: "0804",
    sales: 180,
    daysAgo: 30,
    variants: [w("500 g", 349, 60)],
  },
  {
    slug: "dried-apricots",
    name: "Dried Apricots (Khubani)",
    category: "dry-fruits",
    shape: "standup",
    color: "#d18a3c",
    short: "Tangy-sweet dried apricots.",
    description:
      "Naturally tangy-sweet apricots — great for snacking, trail mixes and khubani ka meetha.",
    ingredients: "Dried apricots (100%)",
    shelfLife: "9 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0813",
    sales: 75,
    daysAgo: 2,
    variants: [w("250 g", 299, 35)],
  },
  // ── Nuts ──
  {
    slug: "california-almonds",
    name: "California Almonds (Badam)",
    category: "nuts",
    shape: "heap",
    color: "#c49a6c",
    short: "Crunchy, wholesome almonds for every day.",
    description:
      "Whole California almonds — soak overnight for the morning, roast for snacking or slice into desserts.",
    ingredients: "Almonds (100%)",
    shelfLife: "9 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0802",
    featured: true,
    sales: 520,
    daysAgo: 120,
    variants: [w("250 g", 299, 120, 349), w("500 g", 579, 80, 649), w("1 kg", 1099, 40, 1249)],
  },
  {
    slug: "cashews-w320",
    name: "Cashews W320 (Kaju)",
    category: "nuts",
    shape: "heap",
    color: "#e9d7b0",
    short: "Creamy, whole cashew kernels.",
    description: "Whole W320 cashew kernels — rich and creamy for snacking, gravies and sweets.",
    ingredients: "Cashew kernels (100%)",
    shelfLife: "6 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0801",
    featured: true,
    sales: 480,
    daysAgo: 95,
    variants: [w("250 g", 349, 100, 399), w("500 g", 679, 60)],
  },
  {
    slug: "walnut-kernels",
    name: "Walnut Kernels (Akhrot)",
    category: "nuts",
    shape: "standup",
    color: "#8b5e3c",
    short: "Light halves with a mild, buttery taste.",
    description: "Light-coloured walnut halves for breakfast bowls, baking and snacking.",
    ingredients: "Walnut kernels (100%)",
    shelfLife: "6 months from packing",
    storage: "Store in a cool, dry place. Refrigerate after opening.",
    taxRateBps: 500,
    hsn: "0802",
    sales: 210,
    daysAgo: 45,
    variants: [w("250 g", 449, 50, 499), w("500 g", 869, 3)],
  },
  {
    slug: "salted-pistachios",
    name: "Roasted Salted Pistachios",
    category: "nuts",
    shape: "heap",
    color: "#9cae5c",
    short: "In-shell pistachios, roasted and lightly salted.",
    description: "Roasted in-shell pistachios with a light sprinkle of salt — a satisfying snack.",
    ingredients: "Pistachios, iodised salt",
    shelfLife: "6 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0802",
    sales: 190,
    daysAgo: 12,
    variants: [w("200 g", 399, 45)],
  },
  // ── Roasted makhana ──
  {
    slug: "makhana-himalayan-salt-pepper",
    name: "Roasted Makhana — Himalayan Salt & Pepper",
    category: "roasted-makhana",
    shape: "makhana",
    color: "#5a4a3a",
    short: "Crunchy fox nuts with pink salt and cracked pepper.",
    description:
      "Roasted makhana seasoned simply with Himalayan pink salt and cracked black pepper.",
    ingredients: "Fox nuts (makhana), rice bran oil, Himalayan pink salt, black pepper",
    shelfLife: "6 months from packing",
    storage: "Store in a cool, dry place. Reseal or transfer to an airtight jar after opening.",
    taxRateBps: 500,
    hsn: "2008",
    featured: true,
    sales: 380,
    daysAgo: 15,
    variants: [w("75 g", 129, 120), w("Pack of 3 × 75 g", 349, 60, 387)],
  },
  {
    slug: "makhana-peri-peri",
    name: "Roasted Makhana — Peri Peri",
    category: "roasted-makhana",
    shape: "makhana",
    color: "#b8321f",
    short: "Tangy, spicy peri peri makhana.",
    description: "Roasted makhana tossed in a tangy, spicy peri peri seasoning.",
    ingredients:
      "Fox nuts (makhana), rice bran oil, peri peri seasoning (chilli, garlic, onion, salt, citric acid, oregano)",
    shelfLife: "6 months from packing",
    storage: "Store in a cool, dry place. Reseal or transfer to an airtight jar after opening.",
    taxRateBps: 500,
    hsn: "2008",
    sales: 290,
    daysAgo: 6,
    variants: [w("75 g", 129, 90), w("Pack of 3 × 75 g", 349, 40, 387)],
  },
  {
    slug: "makhana-pudina",
    name: "Roasted Makhana — Pudina",
    category: "roasted-makhana",
    shape: "makhana",
    color: "#5f8f5a",
    short: "Cool, tangy mint makhana.",
    description: "Roasted makhana with a refreshing mint and chaat masala seasoning.",
    ingredients: "Fox nuts (makhana), rice bran oil, mint, black salt, dry mango, cumin, salt",
    shelfLife: "6 months from packing",
    storage: "Store in a cool, dry place. Reseal or transfer to an airtight jar after opening.",
    taxRateBps: 500,
    hsn: "2008",
    sales: 150,
    daysAgo: 3,
    variants: [w("75 g", 129, 0)],
  },
  {
    slug: "raw-makhana",
    name: "Raw Makhana (Phool Makhana)",
    category: "roasted-makhana",
    shape: "standup",
    color: "#f3ece0",
    short: "Large, unroasted fox nuts for cooking and roasting at home.",
    description:
      "Large, unroasted phool makhana — roast in ghee at home or use in kheer and curries.",
    ingredients: "Fox nuts (makhana) (100%)",
    shelfLife: "9 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0813",
    sales: 170,
    daysAgo: 50,
    variants: [w("100 g", 179, 70), w("250 g", 419, 30, 449)],
  },
  // ── Gift boxes ──
  {
    slug: "festive-dry-fruit-gift-box",
    name: "Festive Dry Fruit Gift Box",
    category: "gift-boxes",
    shape: "giftbox",
    color: "#6b2f2a",
    short: "Almonds, cashews, raisins and anjeer in a festive box.",
    description:
      "A festive box with four compartments — almonds, cashews, golden raisins and anjeer — ready to gift.",
    ingredients: "Almonds, cashews, raisins, dried figs",
    shelfLife: "6 months from packing",
    storage: DRY,
    taxRateBps: 500,
    hsn: "0813",
    featured: true,
    sales: 95,
    daysAgo: 10,
    variants: [w("400 g", 899, 25, 999), w("800 g", 1699, 12, 1899)],
  },
];

export const BRAND_NAME = BRAND;

export const coupons = [
  {
    code: "WELCOME10",
    description: "10% off your first order (max ₹500)",
    type: "PERCENTAGE" as const,
    value: 1000,
    minOrderPaise: 99900,
    maxDiscountPaise: 50000,
    usageLimitPerUser: 1,
  },
  {
    code: "FLAT200",
    description: "₹200 off orders above ₹1,999",
    type: "FIXED" as const,
    value: 20000,
    minOrderPaise: 199900,
  },
  {
    code: "EXPIRED50",
    description: "Expired demo coupon",
    type: "PERCENTAGE" as const,
    value: 5000,
    minOrderPaise: 0,
    expired: true,
  },
];

/** Demo reviews for local development only — remove before launch. */
export const reviewTexts = [
  {
    rating: 5,
    title: "Fresh and aromatic",
    body: "You can smell the difference as soon as you open the pack. Will order again.",
  },
  {
    rating: 4,
    title: "Good quality, well packed",
    body: "Neatly sealed and fresh. Would love a bigger pack size.",
  },
  {
    rating: 5,
    title: "Our new kitchen staple",
    body: "Clean, consistent quality — exactly what we want to cook with at home.",
  },
];
