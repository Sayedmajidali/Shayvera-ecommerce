/**
 * Read-only check of real Shiprocket credentials: logs in and asks for a serviceability quote.
 * It creates nothing in the Shiprocket account (Shiprocket has no sandbox).
 *
 *   npm run shipping:verify -- --from 560001 --to 110001 [--weight 500]
 *
 * Needs SHIPROCKET_API_EMAIL / SHIPROCKET_API_PASSWORD (an API user: Shiprocket → Settings → API).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { ShiprocketProvider } from "../src/server/modules/shipping/providers/shiprocket/provider";

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      to: { type: "string" },
      weight: { type: "string", default: "500" },
    },
  });
  const email = process.env.SHIPROCKET_API_EMAIL;
  const password = process.env.SHIPROCKET_API_PASSWORD;
  if (!email || !password)
    throw new Error("Set SHIPROCKET_API_EMAIL and SHIPROCKET_API_PASSWORD first");
  if (!/^[1-9]\d{5}$/.test(values.from ?? "") || !/^[1-9]\d{5}$/.test(values.to ?? ""))
    throw new Error("Usage: npm run shipping:verify -- --from 560001 --to 110001");
  const provider = new ShiprocketProvider({
    baseUrl: process.env.SHIPROCKET_BASE_URL ?? "https://apiv2.shiprocket.in/v1/external",
    email,
    password,
  });
  const result = await provider.checkServiceability(
    {
      originPincode: values.from!,
      destinationPincode: values.to!,
      cod: false,
      weightGrams: Number(values.weight),
      lengthMm: 200,
      breadthMm: 150,
      heightMm: 100,
      declaredValuePaise: 50_000,
    },
    { timeoutMs: 15_000 },
  );
  console.log("Login: OK");
  if (result.kind === "not_serviceable") {
    console.log(`Serviceability ${values.from} → ${values.to}: no couriers available`);
    return;
  }
  console.log(
    `Serviceability ${values.from} → ${values.to}: ${result.couriers.length} courier(s), COD ${result.codAvailable ? "available" : "not available"}, fastest ~${result.etaDays ?? "?"} day(s), recommended courier id ${result.recommendedCourierId ?? "-"}`,
  );
  for (const c of result.couriers.slice(0, 10))
    console.log(
      `  - ${c.name} (id ${c.courierId}) · ₹${((c.ratePaise ?? 0) / 100).toFixed(2)} · ${c.etaDays ?? "?"} d · COD ${c.cod ? "yes" : "no"}`,
    );
}

main().catch((error) => {
  console.error("Verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
