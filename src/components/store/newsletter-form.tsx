"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function NewsletterForm({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return <p className="text-sm">Thank you — you’re on the list. Look out for our next letter.</p>;
  }

  return (
    <form
      className="flex w-full max-w-md gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        try {
          await apiFetch("/api/newsletter", { body: { email } });
          setDone(true);
        } catch (err) {
          toast.error(
            err instanceof ApiClientError
              ? (err.fields.email ?? err.message)
              : "Could not subscribe",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor={`newsletter-${tone}`} className="sr-only">
        Email address
      </label>
      <Input
        id={`newsletter-${tone}`}
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className={
          tone === "dark" ? "border-white/20 bg-white/10 text-white placeholder:text-white/60" : ""
        }
      />
      <Button type="submit" variant={tone === "dark" ? "brand" : "default"} disabled={pending}>
        {pending ? "Joining…" : "Subscribe"}
      </Button>
    </form>
  );
}
