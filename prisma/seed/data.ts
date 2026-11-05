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
    slug: "home-decor",
    name: "Home Décor",
    description: "Handcrafted vases, lamps, cushions and throws that bring warmth to every corner.",
    background: "#efe7dc",
    shapes: ["vase", "lamp", "plant"],
    colors: ["#c46f4e", "#d9c6a5", "#8a9a7b"],
    featured: true,
  },
  {
    slug: "kitchen-dining",
    name: "Kitchen & Dining",
    description: "Stoneware, serveware and kitchen tools made for slow mornings and long dinners.",
    background: "#e9ece4",
    shapes: ["mug", "teapot", "bowl"],
    colors: ["#5e7a8c", "#e4d8c4", "#b5643f"],
    featured: true,
  },
  {
    slug: "bath-wellness",
    name: "Bath & Wellness",
    description: "Small-batch soaps, plush cotton towels and calming aromatics for daily rituals.",
    background: "#efe9e4",
    shapes: ["soap", "bottle", "candle"],
    colors: ["#cfa98a", "#7d8f7a", "#e9dccb"],
    featured: true,
  },
  {
    slug: "stationery",
    name: "Stationery",
    description: "Notebooks, journals and writing instruments for unhurried thinking.",
    background: "#ebe6dd",
    shapes: ["notebook", "pen", "notebook"],
    colors: ["#3f5b54", "#b8863b", "#9c4f3c"],
    featured: true,
  },
  {
    slug: "bags-accessories",
    name: "Bags & Accessories",
    description: "Canvas totes, pouches and everyday carry built to last.",
    background: "#ece5da",
    shapes: ["tote", "pouch", "pouch"],
    colors: ["#c9b38f", "#4c5f6b", "#8a4f3a"],
    featured: false,
  },
  {
    slug: "tech-accessories",
    name: "Tech Accessories",
    description: "Considered desk accessories that keep your devices organised and charged.",
    background: "#e6e7e3",
    shapes: ["stand", "pouch", "stand"],
    colors: ["#b9a68a", "#3a3d40", "#8c8f86"],
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
  brand?: string;
  short: string;
  description: string;
  taxRateBps: number;
  hsn: string;
  featured?: boolean;
  sales?: number;
  daysAgo?: number;
  variants: SeedVariant[];
};

const v = (
  name: string,
  price: number,
  stock: number,
  color: string,
  compareAt?: number,
  option = "Colour",
): SeedVariant => ({ name, options: { [option]: name }, price, compareAt, stock, color });

export const products: SeedProduct[] = [
  // ── Home Décor ──
  {
    slug: "terracotta-bud-vase",
    name: "Terracotta Bud Vase",
    category: "home-decor",
    shape: "vase",
    brand: "Shayvera Studio",
    short: "Hand-thrown terracotta vase with a soft matte finish.",
    description:
      "Thrown by hand in Khurja and finished with a breathable matte glaze, this bud vase is sized for a single stem or a small cluster of dried grasses. Each piece carries subtle variations in tone — a mark of the maker's hand.\n\nHeight 22 cm · Opening 3 cm · Wipe clean with a damp cloth.",
    taxRateBps: 1200,
    hsn: "6913",
    featured: true,
    sales: 142,
    daysAgo: 40,
    variants: [
      v("Clay", 1290, 34, "#c46f4e", 1590),
      v("Sand", 1290, 18, "#d8c3a2", 1590),
      v("Charcoal", 1390, 0, "#4a4542"),
    ],
  },
  {
    slug: "arc-table-lamp",
    name: "Arc Table Lamp",
    category: "home-decor",
    shape: "lamp",
    brand: "Shayvera Studio",
    short: "Linen-shade table lamp with a solid mango-wood base.",
    description:
      "A softly diffused glow for bedside tables and reading corners. The tapered linen shade sits on a turned mango-wood base with a braided fabric cord.\n\nHeight 46 cm · E27 holder (bulb not included) · 1.8 m cord with inline switch.",
    taxRateBps: 1800,
    hsn: "9405",
    featured: true,
    sales: 64,
    daysAgo: 12,
    variants: [
      v("Oat Linen", 3490, 12, "#e2d6c0", 3990),
      v("Rust Linen", 3490, 7, "#b5643f", 3990),
    ],
  },
  {
    slug: "monstera-ceramic-planter",
    name: "Ceramic Planter with Drainage",
    category: "home-decor",
    shape: "plant",
    short: "Speckled stoneware planter with a matching saucer.",
    description:
      "Speckled stoneware planter with a drainage hole and a matching saucer, ideal for indoor plants up to 15 cm pot size.\n\nDiameter 16 cm · Height 15 cm.",
    taxRateBps: 1200,
    hsn: "6912",
    sales: 98,
    daysAgo: 70,
    variants: [v("Ivory Speckle", 1490, 25, "#e8dfd0"), v("Moss", 1490, 4, "#7c8f6b")],
  },
  {
    slug: "handloom-cushion-cover",
    name: "Handloom Cotton Cushion Cover",
    category: "home-decor",
    shape: "cushion",
    short: "Textured handloom cotton with a concealed zip.",
    description:
      "Woven on handlooms in Panipat from 100% cotton yarn, with a subtle slub texture and a concealed YKK zip. Insert not included.\n\nMachine wash cold, gentle cycle.",
    taxRateBps: 1200,
    hsn: "6304",
    sales: 210,
    daysAgo: 90,
    variants: [
      {
        name: "Sage / 40 × 40 cm",
        options: { Colour: "Sage", Size: "40 × 40 cm" },
        price: 790,
        stock: 40,
        color: "#9aa58a",
      },
      {
        name: "Sage / 50 × 50 cm",
        options: { Colour: "Sage", Size: "50 × 50 cm" },
        price: 990,
        stock: 22,
        color: "#9aa58a",
      },
      {
        name: "Terracotta / 40 × 40 cm",
        options: { Colour: "Terracotta", Size: "40 × 40 cm" },
        price: 790,
        stock: 31,
        color: "#c27453",
      },
      {
        name: "Terracotta / 50 × 50 cm",
        options: { Colour: "Terracotta", Size: "50 × 50 cm" },
        price: 990,
        stock: 3,
        color: "#c27453",
      },
    ],
  },
  {
    slug: "waffle-knit-throw",
    name: "Waffle Knit Throw",
    category: "home-decor",
    shape: "throw",
    short: "Lightweight cotton throw with hand-knotted tassels.",
    description:
      "A breathable waffle-knit cotton throw for the sofa or the foot of the bed, finished with hand-knotted tassels.\n\n130 × 170 cm · 100% cotton.",
    taxRateBps: 1200,
    hsn: "6301",
    featured: true,
    sales: 77,
    daysAgo: 5,
    variants: [v("Natural", 2490, 15, "#e5dccb", 2990), v("Indigo", 2490, 9, "#3f5873", 2990)],
  },
  {
    slug: "reed-diffuser-vetiver",
    name: "Reed Diffuser — Vetiver & Cedar",
    category: "home-decor",
    shape: "diffuser",
    short: "Earthy vetiver and cedar in a reusable glass vessel.",
    description:
      "A grounding blend of vetiver, cedarwood and a hint of cardamom. Lasts 8–10 weeks with 8 rattan reeds.\n\n200 ml · Alcohol-free base.",
    taxRateBps: 1800,
    hsn: "3307",
    sales: 120,
    daysAgo: 20,
    variants: [v("200 ml", 1190, 50, "#c9b38f", undefined, "Size")],
  },
  // ── Kitchen & Dining ──
  {
    slug: "stoneware-coffee-mug",
    name: "Stoneware Coffee Mug",
    category: "kitchen-dining",
    shape: "mug",
    brand: "Shayvera Studio",
    short: "Reactive-glaze stoneware mug, 350 ml.",
    description:
      "Our best-selling everyday mug: reactive glaze means no two are alike. Comfortable loop handle and a wide base that won't tip.\n\n350 ml · Microwave and dishwasher safe · Lead-free glaze.",
    taxRateBps: 1200,
    hsn: "6912",
    featured: true,
    sales: 486,
    daysAgo: 120,
    variants: [
      v("Ocean", 590, 120, "#5e7a8c", 690),
      v("Oat", 590, 85, "#e4d8c4", 690),
      v("Rust", 590, 60, "#b5643f", 690),
    ],
  },
  {
    slug: "glazed-ceramic-teapot",
    name: "Glazed Ceramic Teapot",
    category: "kitchen-dining",
    shape: "teapot",
    short: "Stoneware teapot with stainless steel infuser, 900 ml.",
    description:
      "Brews four generous cups. The removable stainless steel infuser makes loose-leaf chai and green tea effortless.\n\n900 ml · Dishwasher safe (infuser hand wash).",
    taxRateBps: 1200,
    hsn: "6912",
    sales: 88,
    daysAgo: 60,
    variants: [v("Celadon", 1890, 20, "#a6bba8", 2290), v("Ink", 1890, 11, "#33424f", 2290)],
  },
  {
    slug: "handmade-serving-bowl",
    name: "Handmade Serving Bowl",
    category: "kitchen-dining",
    shape: "bowl",
    short: "Wide stoneware bowl for salads, pasta and dal.",
    description:
      "A generous serving bowl with a raw clay foot and glossy interior glaze.\n\nDiameter 26 cm · Dishwasher safe.",
    taxRateBps: 1200,
    hsn: "6912",
    sales: 156,
    daysAgo: 35,
    variants: [v("Speckled White", 1490, 28, "#ebe3d6"), v("Sea Green", 1590, 16, "#7aa59a")],
  },
  {
    slug: "dinner-plate-set",
    name: "Dinner Plate Set of 4",
    category: "kitchen-dining",
    shape: "plate",
    short: "Matte stoneware dinner plates, 27 cm.",
    description:
      "A set of four matte-glazed stoneware plates with a subtly raised rim.\n\n27 cm · Microwave and dishwasher safe.",
    taxRateBps: 1200,
    hsn: "6912",
    featured: true,
    sales: 64,
    daysAgo: 8,
    variants: [v("Sand", 2990, 14, "#dcc9ab", 3490), v("Slate", 2990, 9, "#6b737a", 3490)],
  },
  {
    slug: "acacia-cutting-board",
    name: "Acacia Wood Cutting Board",
    category: "kitchen-dining",
    shape: "board",
    short: "End-finished acacia board with a juice groove.",
    description:
      "Cut from a single piece of sustainably sourced acacia, finished with food-safe mineral oil.\n\nLarge 40 × 25 cm · Hand wash, oil monthly.",
    taxRateBps: 1200,
    hsn: "4419",
    sales: 132,
    daysAgo: 80,
    variants: [
      { name: "Medium", options: { Size: "Medium" }, price: 1290, stock: 30, color: "#a7744a" },
      { name: "Large", options: { Size: "Large" }, price: 1690, stock: 18, color: "#9a6a43" },
    ],
  },
  {
    slug: "copper-water-bottle",
    name: "Pure Copper Water Bottle",
    category: "kitchen-dining",
    shape: "bottle",
    short: "Leak-proof hammered copper bottle, 950 ml.",
    description:
      "Seamless, hammered pure-copper bottle with a leak-proof cap. Traditionally used to store water overnight.\n\n950 ml · Clean with lemon and salt.",
    taxRateBps: 1200,
    hsn: "7418",
    sales: 301,
    daysAgo: 150,
    variants: [v("Hammered", 1190, 70, "#b8734a", 1490)],
  },
  // ── Bath & Wellness ──
  {
    slug: "sandalwood-soap-bar",
    name: "Cold-Process Soap — Sandalwood",
    category: "bath-wellness",
    shape: "soap",
    short: "Handmade with cold-pressed oils and Mysore sandalwood.",
    description:
      "A creamy, slow-cured cold-process bar with cold-pressed coconut and olive oils and a touch of sandalwood. No SLS or parabens.\n\n120 g.",
    taxRateBps: 1800,
    hsn: "3401",
    featured: true,
    sales: 520,
    daysAgo: 100,
    variants: [
      {
        name: "Single bar",
        options: { Pack: "Single bar" },
        price: 349,
        stock: 200,
        color: "#cfa98a",
      },
      {
        name: "Pack of 3",
        options: { Pack: "Pack of 3" },
        price: 949,
        compareAt: 1047,
        stock: 80,
        color: "#cfa98a",
      },
    ],
  },
  {
    slug: "turkish-cotton-towel",
    name: "Turkish Cotton Bath Towel",
    category: "bath-wellness",
    shape: "towel",
    short: "Plush 600 GSM towel that dries quickly.",
    description:
      "Woven from long-staple cotton for a plush yet quick-drying feel.\n\n70 × 140 cm · 600 GSM · Machine wash warm.",
    taxRateBps: 1200,
    hsn: "6302",
    sales: 190,
    daysAgo: 55,
    variants: [
      v("Stone", 1290, 40, "#cbbfae", 1490),
      v("Sage", 1290, 22, "#9aa58a", 1490),
      v("Clay", 1290, 0, "#c27453", 1490),
    ],
  },
  {
    slug: "soy-candle-monsoon",
    name: "Soy Wax Candle — Monsoon",
    category: "bath-wellness",
    shape: "candle",
    short: "Petrichor, vetiver and green tea. 45-hour burn.",
    description:
      "Hand-poured natural soy wax with a cotton wick, scented like the first rain: petrichor, vetiver and green tea.\n\n200 g · Approx. 45-hour burn.",
    taxRateBps: 1800,
    hsn: "3406",
    featured: true,
    sales: 340,
    daysAgo: 3,
    variants: [v("200 g", 990, 60, "#e9dccb", 1190, "Size")],
  },
  {
    slug: "body-oil-kumkumadi",
    name: "Kumkumadi Body Oil",
    category: "bath-wellness",
    shape: "bottle",
    short: "Ayurvedic blend with saffron and sesame oil.",
    description:
      "A traditional Ayurvedic blend of saffron, sesame and sandalwood oils for a nourishing glow.\n\n100 ml · For external use only.",
    taxRateBps: 1800,
    hsn: "3304",
    sales: 75,
    daysAgo: 25,
    variants: [v("100 ml", 1490, 26, "#c28a3c", undefined, "Size")],
  },
  // ── Stationery ──
  {
    slug: "linen-hardcover-notebook",
    name: "Linen Hardcover Notebook",
    category: "stationery",
    shape: "notebook",
    brand: "Shayvera Paper",
    short: "A5 dotted notebook, 192 pages of 100 GSM paper.",
    description:
      "Lay-flat binding, linen cover and 100 GSM acid-free paper that handles fountain pens beautifully.\n\nA5 · 192 pages · Dotted.",
    taxRateBps: 1200,
    hsn: "4820",
    featured: true,
    sales: 410,
    daysAgo: 30,
    variants: [
      v("Forest", 690, 90, "#3f5b54"),
      v("Ochre", 690, 64, "#b8863b"),
      v("Brick", 690, 2, "#9c4f3c"),
    ],
  },
  {
    slug: "brass-fountain-pen",
    name: "Brass Fountain Pen",
    category: "stationery",
    shape: "pen",
    brand: "Shayvera Paper",
    short: "Solid brass body, medium steel nib.",
    description:
      "A weighty solid-brass pen that develops a patina over time. Takes standard international cartridges; converter included.\n\nMedium steel nib.",
    taxRateBps: 1800,
    hsn: "9608",
    sales: 58,
    daysAgo: 15,
    variants: [v("Raw Brass", 2490, 12, "#b89a5a", 2890), v("Black", 2490, 8, "#2f2e2c", 2890)],
  },
  {
    slug: "undated-planner",
    name: "Undated Weekly Planner",
    category: "stationery",
    shape: "notebook",
    short: "52 undated weeks with monthly overviews.",
    description:
      "Plan at your own pace: 52 undated weekly spreads, monthly overviews and notes pages.\n\nB5 · 160 pages.",
    taxRateBps: 1200,
    hsn: "4820",
    sales: 145,
    daysAgo: 2,
    variants: [v("Sand", 890, 45, "#cdb894"), v("Navy", 890, 30, "#2f3e55")],
  },
  // ── Bags & Accessories ──
  {
    slug: "canvas-market-tote",
    name: "Waxed Canvas Market Tote",
    category: "bags-accessories",
    shape: "tote",
    short: "Water-resistant waxed canvas with leather handles.",
    description:
      "Roomy enough for groceries or a laptop, with an interior zip pocket and vegetable-tanned leather handles.\n\n40 × 38 × 14 cm.",
    taxRateBps: 1200,
    hsn: "4202",
    featured: true,
    sales: 220,
    daysAgo: 45,
    variants: [v("Natural", 1790, 30, "#c9b38f", 2190), v("Olive", 1790, 18, "#6f7350", 2190)],
  },
  {
    slug: "zip-pouch-trio",
    name: "Canvas Zip Pouch Trio",
    category: "bags-accessories",
    shape: "pouch",
    short: "Three nesting pouches for travel and desk.",
    description:
      "Three nesting cotton-canvas pouches with brass zips — for cables, cosmetics and stationery.",
    taxRateBps: 1200,
    hsn: "4202",
    sales: 133,
    daysAgo: 65,
    variants: [v("Slate", 990, 40, "#4c5f6b"), v("Rust", 990, 26, "#8a4f3a")],
  },
  {
    slug: "leather-card-wallet",
    name: "Leather Card Wallet",
    category: "bags-accessories",
    shape: "pouch",
    short: "Slim vegetable-tanned leather, holds 6 cards.",
    description:
      "A minimal card wallet in full-grain, vegetable-tanned leather that ages beautifully.",
    taxRateBps: 1200,
    hsn: "4202",
    sales: 88,
    daysAgo: 18,
    variants: [v("Tan", 1290, 25, "#a8703f", 1490), v("Black", 1290, 14, "#2c2a28", 1490)],
  },
  // ── Tech Accessories ──
  {
    slug: "walnut-phone-stand",
    name: "Walnut Phone Stand",
    category: "tech-accessories",
    shape: "stand",
    short: "Solid walnut stand for phones and small tablets.",
    description:
      "Hand-finished solid walnut with a felt base. Works in portrait or landscape, with or without a case.",
    taxRateBps: 1800,
    hsn: "4421",
    featured: true,
    sales: 160,
    daysAgo: 10,
    variants: [v("Walnut", 1490, 33, "#7a5233"), v("Ash", 1490, 20, "#c8b394")],
  },
  {
    slug: "felt-cable-organiser",
    name: "Felt Cable Organiser",
    category: "tech-accessories",
    shape: "pouch",
    short: "Wool-felt roll with elastic loops for cables and chargers.",
    description:
      "Keep chargers, cables and earbuds tidy in a soft wool-felt roll with elastic loops and a leather tie.",
    taxRateBps: 1800,
    hsn: "6307",
    sales: 95,
    daysAgo: 28,
    variants: [v("Charcoal", 890, 50, "#3a3d40"), v("Grey", 890, 0, "#8c8f86")],
  },
  {
    slug: "laptop-sleeve-felt",
    name: "Wool Felt Laptop Sleeve",
    category: "tech-accessories",
    shape: "pouch",
    short: "Protective 5 mm wool-felt sleeve with leather strap.",
    description: "Dense 5 mm wool felt protects your laptop from bumps and scratches.",
    taxRateBps: 1800,
    hsn: "4202",
    sales: 70,
    daysAgo: 6,
    variants: [
      { name: '13"', options: { Size: '13"' }, price: 1990, stock: 16, color: "#8c8f86" },
      { name: '15"', options: { Size: '15"' }, price: 2290, stock: 10, color: "#8c8f86" },
    ],
  },
];

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

export const reviewTexts = [
  {
    rating: 5,
    title: "Beautiful quality",
    body: "Even better in person. Packaging was thoughtful and it arrived in two days.",
  },
  {
    rating: 4,
    title: "Lovely, slightly smaller than expected",
    body: "Great finish and colour. Check the dimensions before ordering.",
  },
  {
    rating: 5,
    title: "Gifted it, they loved it",
    body: "Bought this as a housewarming gift — it was a hit. Will order again.",
  },
];
