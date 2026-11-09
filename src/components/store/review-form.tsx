"use client";

import { lazy, Suspense, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, Loader2, PenLine, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

// React Bits PeekRating — loaded when the form is opened.
const PeekRating = lazy(() => import("@/components/react-bits/peek-rating"));

const LABELS = ["Poor", "Fair", "Good", "Very good", "Excellent"];

type Existing = { rating: number; title: string | null; body: string; status: string } | null;

/** Plain 1–5 star radio group, used until PeekRating has loaded. */
function PlainStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex gap-1">
      {LABELS.map((label, i) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={value === i + 1}
          aria-label={label}
          onClick={() => onChange(i + 1)}
          className="text-brand p-0.5"
        >
          <Star className={cn("size-7", i < value ? "fill-current" : "fill-none")} />
        </button>
      ))}
    </div>
  );
}

/**
 * "Write a review": signed-in customers rate (React Bits PeekRating) and describe a product.
 * Reviews are moderated — submissions are published once staff approve them.
 */
export function ReviewForm({
  slug,
  signedIn,
  existing,
}: {
  slug: string;
  signedIn: boolean;
  existing: Existing;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!signedIn) {
    return (
      <p className="text-muted-foreground text-sm">
        <Link
          href={`/login?next=${encodeURIComponent(`${pathname}#reviews`)}`}
          className="text-primary link-draw font-medium"
        >
          Sign in
        </Link>{" "}
        to write a review.
      </p>
    );
  }
  if (sent) {
    return (
      <p role="status" className="text-success flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="size-4" aria-hidden /> Thank you! Your review will appear once it’s
        approved.
      </p>
    );
  }
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setOpen(true)}>
          <PenLine /> {existing ? "Edit your review" : "Write a review"}
        </Button>
        {existing?.status === "PENDING" && (
          <span className="text-muted-foreground text-sm">Your review is awaiting approval.</span>
        )}
      </div>
    );
  }

  return (
    <form
      className="bg-card grid max-w-xl gap-5 rounded-2xl border p-6"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const next: Record<string, string> = {};
        if (rating < 1) next.rating = "Choose a rating";
        if (body.trim().length < 10) next.body = "Tell us a little more (at least 10 characters)";
        setErrors(next);
        if (Object.keys(next).length) return;
        setPending(true);
        try {
          await apiFetch(`/api/products/${encodeURIComponent(slug)}/reviews`, {
            body: { rating, title, body },
          });
          setSent(true);
        } catch (err) {
          if (err instanceof ApiClientError) setErrors({ ...err.fields, form: err.message });
          else setErrors({ form: "Could not send your review. Please try again." });
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid gap-2">
        <p className="text-sm font-medium" id="review-rating-label">
          Your rating
        </p>
        <Suspense fallback={<PlainStars value={rating} onChange={setRating} />}>
          <PeekRating
            value={rating}
            onChange={setRating}
            labels={LABELS}
            ariaLabel="Your rating"
            size={30}
            activeColor="#cc6824"
            idleColor="#d8d6cc"
            tipColor="#0c764e"
            tipTextColor="#ffffff"
          />
        </Suspense>
        <FieldError message={errors.rating} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="review-title">Title (optional)</Label>
        <Input
          id="review-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Fresh and full of flavour"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="review-body">Your review</Label>
        <Textarea
          id="review-body"
          value={body}
          maxLength={2000}
          rows={4}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={!!errors.body}
          placeholder="How did you use it? What did you like?"
        />
        <FieldError message={errors.body} />
      </div>
      <FieldError message={errors.form} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Submit review
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Reviews are checked by our team before they’re published.
      </p>
    </form>
  );
}
