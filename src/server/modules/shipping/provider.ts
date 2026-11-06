import "server-only";
import { env, shippingProviderName } from "@/lib/env";
import type { ShippingProvider } from "./types";
import { ManualShippingProvider } from "./providers/manual";
import { MockShippingProvider } from "./providers/mock";
import { ShiprocketProvider } from "./providers/shiprocket/provider";

const g = globalThis as unknown as { __shippingProvider?: ShippingProvider };

/** The configured provider (one instance per process so the Shiprocket token is reused). */
export function shippingProvider(): ShippingProvider {
  if (g.__shippingProvider) return g.__shippingProvider;
  const name = shippingProviderName();
  const e = env();
  g.__shippingProvider =
    name === "shiprocket"
      ? new ShiprocketProvider({
          baseUrl: e.SHIPROCKET_BASE_URL,
          email: e.SHIPROCKET_API_EMAIL,
          password: e.SHIPROCKET_API_PASSWORD,
        })
      : name === "mock"
        ? new MockShippingProvider()
        : new ManualShippingProvider();
  return g.__shippingProvider;
}

/** Tests: replace or reset the provider. */
export function setShippingProvider(p: ShippingProvider | null) {
  g.__shippingProvider = p ?? undefined;
}
