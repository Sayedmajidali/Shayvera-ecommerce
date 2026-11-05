/** Client-side JSON helper for our API envelope. Throws ApiClientError with field errors. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error;
    const fields =
      err?.details && typeof err.details === "object"
        ? (err.details as Record<string, string>)
        : {};
    throw new ApiClientError(
      err?.message ?? "Something went wrong",
      err?.code ?? "UNKNOWN",
      res.status,
      fields,
    );
  }
  return (json as { data: T }).data;
}
