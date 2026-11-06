import { z } from "zod";
import { HttpError, httpJson } from "@/server/platform/http";

/**
 * Minimal authenticated client for the Shiprocket external API
 * (https://apiv2.shiprocket.in/v1/external, official Postman collection, read 2026-11-06).
 *
 * - `POST /auth/login {email, password}` returns a JWT valid for 10 days. It is cached in memory and
 *   refreshed an hour before `exp`; concurrent callers share one login; a 401 triggers one re-login.
 * - Credentials are those of a dedicated **API user** (Shiprocket → Settings → API). They are never
 *   logged: the HTTP helper does not log bodies or headers.
 * - Shiprocket has no sandbox: valid credentials act on the real account.
 */
export type ShiprocketConfig = {
  baseUrl: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
};

const loginResponse = z.object({ token: z.string().min(20) });

function jwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class ShiprocketClient {
  private token: { value: string; refreshAt: number } | null = null;
  private loginInFlight: Promise<string> | null = null;

  constructor(private readonly cfg: ShiprocketConfig) {}

  private async login(): Promise<string> {
    const body = await httpJson(
      {
        method: "POST",
        url: `${this.cfg.baseUrl}/auth/login`,
        json: { email: this.cfg.email, password: this.cfg.password },
        provider: "shiprocket",
        operation: "auth",
        timeoutMs: 10_000,
      },
      this.cfg.fetchImpl,
    );
    const { token } = loginResponse.parse(body);
    const exp = jwtExpiryMs(token) ?? Date.now() + 9 * 86_400_000;
    this.token = { value: token, refreshAt: exp - 60 * 60_000 };
    return token;
  }

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.refreshAt) return this.token.value;
    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  /** Authenticated JSON request; re-authenticates once on 401. */
  async request<T>(r: {
    method?: "GET" | "POST";
    path: string;
    query?: Record<string, string | number>;
    json?: unknown;
    operation: string;
    timeoutMs?: number;
    idempotent?: boolean;
  }): Promise<T> {
    const qs = r.query
      ? `?${new URLSearchParams(Object.entries(r.query).map(([k, v]) => [k, String(v)]))}`
      : "";
    const send = async (token: string) =>
      httpJson<T>(
        {
          method: r.method ?? "GET",
          url: `${this.cfg.baseUrl}${r.path}${qs}`,
          headers: { Authorization: `Bearer ${token}` },
          json: r.json,
          provider: "shiprocket",
          operation: r.operation,
          timeoutMs: r.timeoutMs,
          idempotent: r.idempotent,
        },
        this.cfg.fetchImpl,
      );
    try {
      return await send(await this.getToken());
    } catch (error) {
      if (error instanceof HttpError && error.status === 401)
        return send(await this.getToken(true));
      throw error;
    }
  }
}
