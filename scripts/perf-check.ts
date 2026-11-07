/**
 * Performance check for the admin dashboards, reports and storefront listing at realistic volume.
 *
 *   PERF_DATABASE_URL=postgresql://…/shayvera_perf npm run perf:check [-- --orders 20000]
 *
 * Uses its OWN database (never DATABASE_URL): applies migrations, seeds synthetic data once (a year of
 * orders with items, payments, shipments, refunds and invoices), then times each query function
 * (median of 5 runs) against a budget. Exits 1 if any budget is exceeded. Re-runs reuse the data.
 */
import { execSync } from "node:child_process";

const url = process.env.PERF_DATABASE_URL;
if (!url) {
  console.error("Set PERF_DATABASE_URL to a separate, disposable database.");
  process.exit(2);
}
if (url === process.env.DATABASE_URL) {
  console.error("PERF_DATABASE_URL must not be the application database.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
const ordersArg = process.argv.indexOf("--orders");
const ORDERS = ordersArg > 0 ? Number(process.argv[ordersArg + 1]) : 20_000;
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS ?? 500);

async function main() {
  execSync("npx prisma migrate deploy", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: url },
  });
  const { db } = await import("@/server/platform/db");

  // Postgres runs one statement per prepared query: split each block.
  const run = async (sql: string) => {
    for (const stmt of sql
      .split(/;\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean))
      await db.$executeRawUnsafe(stmt);
  };
  const existing = await db.order.count();
  if (existing < ORDERS) {
    console.log(`Seeding ${ORDERS} orders…`);
    const t0 = Date.now();
    await run(`
      INSERT INTO "Category" (id, name, slug, "updatedAt")
      VALUES ('perf-cat', 'Perf nuts', 'perf-nuts', now()) ON CONFLICT DO NOTHING;
      INSERT INTO "Product" (id, name, slug, description, "categoryId", status, "minPricePaise", "updatedAt", "salesCount")
      SELECT 'perf-p' || g, 'Perf product ' || g, 'perf-product-' || g, 'Synthetic product', 'perf-cat', 'ACTIVE', 20000 + g * 100, now(), g
      FROM generate_series(1, 60) g ON CONFLICT DO NOTHING;
      INSERT INTO "ProductVariant" (id, "productId", sku, name, "pricePaise", "updatedAt", "isDefault")
      SELECT 'perf-v' || g, 'perf-p' || ((g - 1) / 2 + 1), 'PERF-' || g, CASE WHEN g % 2 = 0 THEN '500 g' ELSE '250 g' END,
             20000 + g * 100, now(), g % 2 = 1
      FROM generate_series(1, 120) g ON CONFLICT DO NOTHING;
      INSERT INTO "Inventory" ("variantId", "quantityOnHand", "updatedAt")
      SELECT 'perf-v' || g, 100 + g, now() FROM generate_series(1, 120) g ON CONFLICT DO NOTHING;
    `);
    // A year of orders; ~8 % cancelled/unpaid, the rest across the fulfilment statuses.
    await run(`
      INSERT INTO "Order" (id, "orderNumber", email, phone, status, "paymentMethod", "paymentStatus",
        "shippingAddress", "billingAddress", "shippingStateCode", "subtotalPaise", "shippingPaise", "taxPaise",
        "cgstPaise", "sgstPaise", "igstPaise", "totalPaise", "idempotencyKey", "placedAt", "createdAt", "updatedAt",
        "couponCode", "couponDiscountPaise", "requiresAttention")
      SELECT 'perf-o' || g, 'PRF' || lpad(g::text, 8, '0'), 'buyer' || g || '@perf.invalid', '98765' || lpad((g % 100000)::text, 5, '0'),
        (ARRAY['DELIVERED','DELIVERED','DELIVERED','SHIPPED','CONFIRMED','PROCESSING','READY_TO_SHIP','OUT_FOR_DELIVERY','CANCELLED','PENDING','RETURNED','REFUNDED'])[1 + g % 12]::"OrderStatus",
        (CASE WHEN g % 3 = 0 THEN 'COD' ELSE 'RAZORPAY' END)::"PaymentMethod",
        (CASE WHEN g % 12 = 9 THEN 'PENDING' ELSE 'PAID' END)::"PaymentStatus",
        jsonb_build_object('fullName', 'Buyer ' || g, 'city', 'Bengaluru', 'stateCode', 'KA', 'pincode', '560001', 'line1', 'MG Road', 'phone', '9876543210'),
        jsonb_build_object('fullName', 'Buyer ' || g, 'city', 'Bengaluru', 'stateCode', 'KA', 'pincode', '560001', 'line1', 'MG Road', 'phone', '9876543210'),
        (ARRAY['KA','KA','MH','TN','DL','KL'])[1 + g % 6], 60000, 9900, 9153, 4576, 4577, 0, 69900,
        'perf-idem-' || g, now() - (g % 365) * interval '1 day' - (g % 1440) * interval '1 minute',
        now() - (g % 365) * interval '1 day', now(),
        CASE WHEN g % 10 = 0 THEN 'WELCOME10' END, CASE WHEN g % 10 = 0 THEN 5000 ELSE 0 END, g % 997 = 0
      FROM generate_series(${existing + 1}, ${ORDERS}) g;
      INSERT INTO "OrderItem" (id, "orderId", "productId", "variantId", "productName", "productSlug", "variantName", sku,
        "unitPricePaise", quantity, "lineSubtotalPaise", "lineTotalPaise", "hsnCode", "taxRateBps")
      SELECT 'perf-i' || g || '-' || k, 'perf-o' || g, 'perf-p' || (1 + (g + k) % 60), 'perf-v' || (1 + (g + k) % 120),
        'Perf product ' || (1 + (g + k) % 60), 'perf-product-' || (1 + (g + k) % 60), '250 g', 'PERF-' || (1 + (g + k) % 120),
        30000, 1, 30000, 30000, '0801', 500
      FROM generate_series(${existing + 1}, ${ORDERS}) g, generate_series(1, 2) k;
      INSERT INTO "Payment" (id, "orderId", method, status, "amountPaise", "capturedAt", "razorpayOrderId", "razorpayPaymentId", "createdAt", "updatedAt")
      SELECT 'perf-pay' || g, 'perf-o' || g, 'RAZORPAY', 'CAPTURED', 69900, now() - (g % 365) * interval '1 day',
        'order_perf' || g, 'pay_perf' || g, now() - (g % 365) * interval '1 day', now()
      FROM generate_series(${existing + 1}, ${ORDERS}) g WHERE g % 3 <> 0;
      INSERT INTO "Shipment" (id, "orderId", carrier, status, provider, reference, "trackingNumber", "updatedAt", "createdAt")
      SELECT 'perf-s' || g, 'perf-o' || g, 'Perf Courier',
        (ARRAY['DELIVERED','IN_TRANSIT','OUT_FOR_DELIVERY','AWB_ASSIGNED','PICKUP_SCHEDULED','RTO_INITIATED'])[1 + g % 6]::"ShipmentStatus",
        'shiprocket', 'PRF' || lpad(g::text, 8, '0') || '-1', 'AWBPERF' || g, now() - (g % 365) * interval '1 day', now() - (g % 365) * interval '1 day'
      FROM generate_series(${existing + 1}, ${ORDERS}) g WHERE g % 12 IN (0, 1, 2, 3, 7);
      INSERT INTO "Refund" (id, "orderId", "amountPaise", reason, status, method, "processedAt", "createdAt", "updatedAt")
      SELECT 'perf-r' || g, 'perf-o' || g, 69900, 'Synthetic', 'PROCESSED', 'MANUAL', now() - (g % 365) * interval '1 day',
        now() - (g % 365) * interval '1 day', now()
      FROM generate_series(${existing + 1}, ${ORDERS}) g WHERE g % 12 = 11;
      INSERT INTO "Invoice" (id, "orderId", "invoiceNumber", "financialYear", snapshot, "issuedAt")
      SELECT 'perf-inv' || g, 'perf-o' || g, 'PINV/' || g, '2026-27',
        jsonb_build_object('documentTitle', 'Tax Invoice', 'orderNumber', 'PRF' || lpad(g::text, 8, '0'),
          'buyer', jsonb_build_object('name', 'Buyer ' || g),
          'placeOfSupply', jsonb_build_object('stateCode', 'KA', 'stateName', 'Karnataka'), 'supplyType', 'INTRA_STATE',
          'lines', jsonb_build_array(jsonb_build_object('hsn', '0801', 'quantity', 2, 'taxableValuePaise', 57143, 'cgstPaise', 1428, 'sgstPaise', 1429, 'igstPaise', 0)),
          'totals', jsonb_build_object('taxableValuePaise', 60747, 'cgstPaise', 4576, 'sgstPaise', 4577, 'igstPaise', 0, 'taxPaise', 9153, 'grandTotalPaise', 69900)),
        now() - (g % 365) * interval '1 day'
      FROM generate_series(${existing + 1}, ${ORDERS}) g WHERE g % 12 IN (0, 1, 2);
      ANALYZE;
    `);
    console.log(`Seeded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  const { getDashboardStats, getOperationalAlerts } =
    await import("@/server/modules/analytics/dashboard");
  const { getSalesReport, getGstRegister, reportRangeSchema } =
    await import("@/server/modules/analytics/reports");
  const { listOrdersAdmin } = await import("@/server/modules/orders/admin-orders");
  const { getShipmentsDashboard } = await import("@/server/modules/shipping/dashboard");
  const { getPaymentsDashboard } = await import("@/server/modules/payments/dashboard");
  const { listProducts, productListParamsSchema } =
    await import("@/server/modules/catalog/queries");
  const { listInvoices } = await import("@/server/modules/invoices/invoices");
  const { ALL_PERMISSIONS } = await import("@/server/modules/auth/permissions");

  const year = reportRangeSchema.parse({ from: undefined, to: undefined });
  const fullYear = reportRangeSchema.parse({
    from: new Date(Date.now() - 364 * 86_400_000).toISOString().slice(0, 10),
  });
  const cases: [string, () => Promise<unknown>][] = [
    ["Dashboard figures (90 days)", () => getDashboardStats("90d")],
    ["Dashboard alerts (all queues)", () => getOperationalAlerts([...ALL_PERMISSIONS])],
    ["Sales report (30 days)", () => getSalesReport(year)],
    ["Sales report (365 days)", () => getSalesReport(fullYear)],
    ["GST register (365 days)", () => getGstRegister(fullYear)],
    ["Orders list, page 1", () => listOrdersAdmin({ page: 1 })],
    ["Orders list, page 500", () => listOrdersAdmin({ page: 500 })],
    ["Orders list, search by number", () => listOrdersAdmin({ page: 1, q: "PRF00012345" })],
    ["Orders list, status filter", () => listOrdersAdmin({ page: 1, status: "SHIPPED" })],
    ["Shipments dashboard", () => getShipmentsDashboard({})],
    ["Payments dashboard", () => getPaymentsDashboard({})],
    ["Invoices list", () => listInvoices({ page: 1 })],
    ["Shop listing (featured)", () => listProducts(productListParamsSchema.parse({}))],
    [
      "Shop listing (price, page 3)",
      () => listProducts(productListParamsSchema.parse({ sort: "price-asc", page: "3" })),
    ],
  ];

  const orders = await db.order.count();
  console.log(
    `\nVolume: ${orders} orders · ${await db.orderItem.count()} items · ${await db.shipment.count()} shipments · ${await db.invoice.count()} invoices`,
  );
  console.log(`Budget: ${BUDGET_MS} ms per call (median of 5, after one warm-up)\n`);
  let failed = 0;
  for (const [name, fn] of cases) {
    await fn();
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await fn();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[2]!;
    const ok = median <= BUDGET_MS;
    if (!ok) failed++;
    console.log(
      `${ok ? "✓" : "✗"} ${name.padEnd(34)} ${median.toFixed(0).padStart(5)} ms  (max ${times[4]!.toFixed(0)} ms)`,
    );
  }
  await db.$disconnect();
  if (failed) {
    console.error(`\n${failed} check(s) over budget`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
