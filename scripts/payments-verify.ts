/**
 * Read-only check of the Razorpay keys: lists at most one payment with the configured key pair, which
 * succeeds only if the key id and secret are valid and belong together. Creates nothing.
 *
 *   npm run payments:verify
 *
 * Also reports the mode (test/live) and whether the webhook secret is set.
 */
import "dotenv/config";

async function main() {
  const gateway = process.env.PAYMENT_GATEWAY ?? "razorpay";
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (gateway !== "razorpay") throw new Error(`PAYMENT_GATEWAY is "${gateway}", not "razorpay"`);
  if (!keyId || !keySecret) throw new Error("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET first");

  const mode = keyId.startsWith("rzp_live_")
    ? "LIVE (real money)"
    : keyId.startsWith("rzp_test_")
      ? "TEST (no real money)"
      : "unknown key type";
  console.log(`Key: ${keyId.slice(0, 13)}… · mode: ${mode}`);

  const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) {
    throw new Error(
      "Razorpay rejected the keys (401). Check the key id and secret are a matching pair.",
    );
  }
  if (!res.ok)
    throw new Error(`Razorpay answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { count?: number };
  console.log(`Keys: OK (Razorpay accepted them; ${body.count ?? 0} recent payment(s) visible)`);

  console.log(
    webhookSecret && webhookSecret !== "replace-me"
      ? "Webhook secret: set — it must equal the secret in Razorpay → Settings → Webhooks"
      : "Webhook secret: NOT set — payments still work, but confirmations rely on the browser callback",
  );
}

main().catch((error) => {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const detail = cause ? ` (${cause.code ?? cause.message ?? "network error"})` : "";
  console.error(
    `Razorpay check failed: ${error instanceof Error ? error.message : String(error)}${detail}`,
  );
  process.exitCode = 1;
});
