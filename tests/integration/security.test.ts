import { describe, expect, it } from "vitest";
import * as mediaRoute from "@/app/media/[...key]/route";
import * as webhookRoute from "@/app/api/webhooks/razorpay/route";
import * as profileRoute from "@/app/api/account/profile/route";
import { authRequest, apiRequest, registerCustomer } from "../helpers/auth";

describe("security controls", () => {
  it("enforces password complexity on the server, not just in the UI", async () => {
    const res = await authRequest("/sign-up/email", {
      email: "weakpw@example.com",
      password: "passwordonly",
      name: "Weak",
    });
    expect(res.status).toBe(400);
  });

  it("does not serve files outside the media root", async () => {
    for (const key of [
      ["..", "..", ".env"],
      ["..", "package.json"],
      ["products", "..", "..", ".env"],
    ]) {
      const res = await mediaRoute.GET(new Request("http://localhost:3000/media/x"), {
        params: Promise.resolve({ key }),
      });
      expect(res.status).toBe(404);
    }
  });

  it("rejects oversized webhook bodies before verifying", async () => {
    const res = await webhookRoute.POST(
      new Request("http://localhost:3000/api/webhooks/razorpay", {
        method: "POST",
        headers: { "content-length": String(10 * 1024 * 1024) },
        body: "{}",
      }),
    );
    expect(res.status).toBe(413);
  });

  it("rejects oversized JSON bodies and malformed JSON", async () => {
    const { cookie } = await registerCustomer("big@example.com");
    const big = await profileRoute.PATCH(
      apiRequest("/api/account/profile", {
        method: "PATCH",
        cookie,
        body: { name: "x".repeat(70_000) },
      }),
      undefined,
    );
    expect(big.status).toBe(413);
    const bad = await profileRoute.PATCH(
      new Request("http://localhost:3000/api/account/profile", {
        method: "PATCH",
        headers: { origin: "http://localhost:3000", cookie, "content-type": "application/json" },
        body: "{not json",
      }),
      undefined,
    );
    expect(bad.status).toBe(400);
  });

  it("requires an Origin/Referer on cookie-authenticated mutations", async () => {
    const { cookie } = await registerCustomer("noorigin@example.com");
    const res = await profileRoute.PATCH(
      new Request("http://localhost:3000/api/account/profile", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "No Origin" }),
      }),
      undefined,
    );
    expect(res.status).toBe(403);
  });

  it("never leaks internal error details", async () => {
    const res = await profileRoute.PATCH(
      apiRequest("/api/account/profile", { method: "PATCH", body: { name: "x" } }),
      undefined,
    );
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/stack|prisma|at \//i);
  });
});
