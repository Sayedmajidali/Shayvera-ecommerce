/**
 * Local development seed. Idempotent: existing categories/products (by slug) are left untouched.
 *   npm run db:seed
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "@prisma/client";
import { storage } from "../src/server/storage";
import { categories, coupons, products, reviewTexts } from "./seed/data";
import { seedDemoOrders } from "./seed/demo-orders";
import { renderBanner, renderIllustration } from "./seed/illustrations";

const db = new PrismaClient();
const DEMO_PASSWORD = "Customer123!";

async function upsertSettings() {
  await db.storeSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      storeName: "Shayvera",
      legalName: "Shayvera Lifestyle (Demo)",
      supportEmail: "support@shayvera.example",
      supportPhone: "+91 80 4000 1234",
      addressLine1: "2nd Floor, 14 Lavelle Road",
      city: "Bengaluru",
      stateCode: "KA",
      pincode: "560001",
    },
  });
}

async function seedCategories() {
  const ids: Record<string, string> = {};
  for (const [i, c] of categories.entries()) {
    const existing = await db.category.findUnique({ where: { slug: c.slug } });
    if (existing) {
      ids[c.slug] = existing.id;
      continue;
    }
    const banner = await renderBanner(c.shapes, c.colors, c.background);
    const key = `categories/${c.slug}-${randomUUID().slice(0, 8)}.webp`;
    const stored = await storage().put(key, banner, "image/webp");
    const created = await db.category.create({
      data: {
        slug: c.slug,
        name: c.name,
        description: c.description,
        imageUrl: stored.url,
        sortOrder: i,
        isActive: true,
        isFeatured: c.featured,
        seoTitle: `${c.name} — Shop online in India`,
        seoDescription: c.description,
      },
    });
    ids[c.slug] = created.id;
  }
  return ids;
}

async function seedProducts(categoryIds: Record<string, string>) {
  let created = 0;
  for (const p of products) {
    if (await db.product.findUnique({ where: { slug: p.slug } })) continue;
    const category = categories.find((c) => c.slug === p.category)!;
    const firstColor = p.variants[0]!.color ?? category.colors[0]!;
    const imageColors = [...new Set(p.variants.map((v) => v.color ?? firstColor))];

    const images: {
      url: string;
      storageKey: string;
      alt: string;
      sortOrder: number;
      sizeBytes: number;
    }[] = [];
    const plan: { color: string; variant: 0 | 1 | 2 }[] = [
      { color: firstColor, variant: 0 },
      { color: imageColors[1] ?? firstColor, variant: imageColors[1] ? 0 : 1 },
      { color: firstColor, variant: 2 },
    ];
    for (const [idx, item] of plan.entries()) {
      const buf = await renderIllustration({
        shape: p.shape,
        color: item.color,
        background: category.background,
        variant: item.variant,
      });
      const key = `products/${p.slug}-${randomUUID().slice(0, 8)}.webp`;
      const stored = await storage().put(key, buf, "image/webp");
      images.push({
        url: stored.url,
        storageKey: key,
        alt: `${p.name}${idx === 2 ? " — detail" : ""}`,
        sortOrder: idx,
        sizeBytes: stored.sizeBytes,
      });
    }

    const createdAt = new Date(Date.now() - (p.daysAgo ?? 30) * 86_400_000);
    const activeVariantPrices = p.variants.map((v) => v.price * 100);
    await db.product.create({
      data: {
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        shortDescription: p.short,
        description: p.description,
        categoryId: categoryIds[p.category]!,
        status: "ACTIVE",
        isFeatured: p.featured ?? false,
        taxRateBps: p.taxRateBps,
        hsnCode: p.hsn,
        minPricePaise: Math.min(...activeVariantPrices),
        salesCount: p.sales ?? 0,
        seoTitle: p.name,
        seoDescription: p.short,
        createdAt,
        images: {
          create: images.map((img) => ({
            ...img,
            width: 1200,
            height: 1500,
            mimeType: "image/webp",
          })),
        },
        variants: {
          create: p.variants.map((v, i) => ({
            sku: `${p.slug
              .split("-")
              .map((w) => w.slice(0, 3))
              .join("")
              .toUpperCase()
              .slice(0, 10)}-${String(i + 1).padStart(2, "0")}`,
            name: v.name,
            options: v.options,
            pricePaise: v.price * 100,
            compareAtPricePaise: v.compareAt ? v.compareAt * 100 : null,
            isDefault: i === 0,
            sortOrder: i,
            inventory: { create: { quantityOnHand: v.stock, lowStockThreshold: 5 } },
          })),
        },
      },
    });
    created++;
  }

  // Initial stock ledger entries for any variant without history.
  const variants = await db.productVariant.findMany({
    where: { inventoryTxs: { none: {} } },
    include: { inventory: true },
  });
  if (variants.length) {
    await db.inventoryTransaction.createMany({
      data: variants.map((v) => ({
        variantId: v.id,
        delta: v.inventory?.quantityOnHand ?? 0,
        balanceAfter: v.inventory?.quantityOnHand ?? 0,
        reason: "INITIAL" as const,
        note: "Seed stock",
      })),
    });
  }
  return created;
}

async function seedCustomerAndReviews() {
  const email = "customer@shayvera.local";
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    const id = randomUUID();
    user = await db.user.create({
      data: { id, email, name: "Ananya Iyer", phone: "9845012345", emailVerified: true },
    });
    await db.account.create({
      data: {
        id: randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: await hashPassword(DEMO_PASSWORD),
      },
    });
    await db.address.create({
      data: {
        userId: id,
        label: "Home",
        fullName: "Ananya Iyer",
        phone: "9845012345",
        line1: "Flat 402, Lakeview Residency",
        line2: "8th Cross, Indiranagar",
        city: "Bengaluru",
        stateCode: "KA",
        pincode: "560038",
        isDefault: true,
      },
    });
  }

  const reviewers = [user];
  for (const [i, name] of ["Rohan Mehta", "Priya Sharma"].entries()) {
    const e = `reviewer${i + 1}@shayvera.local`;
    let r = await db.user.findUnique({ where: { email: e } });
    if (!r)
      r = await db.user.create({ data: { id: randomUUID(), email: e, name, emailVerified: true } });
    reviewers.push(r);
  }

  const featured = await db.product.findMany({ where: { isFeatured: true }, select: { id: true } });
  for (const product of featured) {
    for (const [i, reviewer] of reviewers.entries()) {
      const text = reviewTexts[i % reviewTexts.length]!;
      await db.review.upsert({
        where: { productId_userId: { productId: product.id, userId: reviewer.id } },
        update: {},
        create: {
          productId: product.id,
          userId: reviewer.id,
          ...text,
          status: "APPROVED",
          verifiedPurchase: true,
        },
      });
    }
    const agg = await db.review.aggregate({
      where: { productId: product.id, status: "APPROVED" },
      _avg: { rating: true },
      _count: true,
    });
    await db.product.update({
      where: { id: product.id },
      data: { ratingAverage: agg._avg.rating ?? 0, ratingCount: agg._count },
    });
  }
}

async function seedCoupons() {
  for (const c of coupons) {
    const { expired, ...data } = c as typeof c & { expired?: boolean };
    await db.coupon.upsert({
      where: { code: c.code },
      update: {},
      create: {
        ...data,
        isActive: true,
        startsAt: new Date(Date.now() - 30 * 86_400_000),
        expiresAt: expired
          ? new Date(Date.now() - 86_400_000)
          : new Date(Date.now() + 365 * 86_400_000),
      },
    });
  }
}

async function main() {
  await upsertSettings();
  const categoryIds = await seedCategories();
  const created = await seedProducts(categoryIds);
  await seedCustomerAndReviews();
  await seedCoupons();
  const demo = process.env.SEED_DEMO_ORDERS === "false" ? 0 : await seedDemoOrders();
  if (demo) console.log(`Created ${demo} demo orders (set SEED_DEMO_ORDERS=false to skip).`);
  console.log(
    `Seed complete: ${Object.keys(categoryIds).length} categories, ${created} new products.`,
  );
  console.log(`Demo customer: customer@shayvera.local / ${DEMO_PASSWORD}`);
  console.log(
    'Create an admin with: npm run admin:create -- --email you@example.com --name "Your Name"',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
