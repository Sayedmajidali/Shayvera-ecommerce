"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageUp, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { SITE_IMAGE_SLOTS, type SiteImages, type SiteImageSlot } from "@/lib/site-images";

/** Upload a file with progress-free fetch; returns the JSON error message on failure. */
export async function uploadImage(url: string, file: File, alt?: string) {
  const form = new FormData();
  form.append("file", file);
  if (alt) form.append("alt", alt);
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error?.message ?? "Upload failed");
  }
  return res.json();
}

function SlotCard({
  def,
  current,
}: {
  def: (typeof SITE_IMAGE_SLOTS)[number];
  current: SiteImages[SiteImageSlot];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState(current?.alt ?? "");
  const [busy, setBusy] = useState(false);
  const preview = current?.url ?? def.defaultUrl;
  const isLogo = def.slot === "logo";

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadImage(`/api/admin/site-images/${def.slot}`, file, alt);
      toast.success(`${def.label} updated`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5" data-testid={`slot-${def.slot}`}>
      <div
        className={
          isLogo || def.slot === "appIcon"
            ? "bg-muted/60 relative flex h-36 items-center justify-center overflow-hidden rounded-xl border"
            : "bg-muted/60 relative h-44 overflow-hidden rounded-xl border"
        }
      >
        {preview ? (
          <Image
            src={preview}
            alt={current?.alt || def.label}
            fill
            sizes="400px"
            // The optimiser only serves uploads (/media); built-in defaults are static files.
            unoptimized={!preview.startsWith("/media/")}
            className={isLogo || def.slot === "appIcon" ? "object-contain p-6" : "object-cover"}
          />
        ) : isLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- static SVG preview of the built-in logo
          <img src="/brand/logo-full.svg" alt="Built-in Shayvera logo" className="h-24 w-auto" />
        ) : (
          <span className="text-muted-foreground absolute inset-0 grid place-items-center px-4 text-center text-sm">
            Default: {def.defaultNote}
          </span>
        )}
        <span className="bg-background/90 absolute top-2 left-2 rounded-full px-2.5 py-0.5 text-xs font-medium">
          {current ? "Custom" : "Default"}
        </span>
      </div>
      <div>
        <h2 className="font-semibold">{def.label}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{def.where}</p>
        <p className="text-muted-foreground mt-1 text-xs">Recommended: {def.recommended}</p>
        {!current && (
          <p className="text-muted-foreground mt-1 text-xs">Default: {def.defaultNote}</p>
        )}
        {current && (
          <p className="text-muted-foreground mt-1 text-xs tabular-nums">
            Current: {current.width}×{current.height}px
          </p>
        )}
      </div>
      {!["appIcon", "shareImage"].includes(def.slot) && (
        <div className="grid gap-1.5">
          <Label htmlFor={`alt-${def.slot}`} className="text-xs">
            Description for screen readers (optional)
          </Label>
          <Input
            id={`alt-${def.slot}`}
            value={alt}
            maxLength={160}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="e.g. Bowl of roasted makhana"
          />
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          id={`file-${def.slot}`}
          aria-label={`Upload ${def.label}`}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <ImageUp />}
          {current ? "Replace" : "Upload"}
        </Button>
        {current && (
          <ConfirmButton
            title={`Reset ${def.label}?`}
            description="The uploaded image is removed and the built-in default is used again."
            confirmLabel="Reset"
            onConfirm={async () => {
              try {
                await apiFetch(`/api/admin/site-images/${def.slot}`, { method: "DELETE" });
                toast.success(`${def.label} reset to default`);
                router.refresh();
              } catch (err) {
                toast.error(err instanceof ApiClientError ? err.message : "Could not reset");
              }
            }}
            trigger={
              <Button size="sm" variant="outline">
                <RotateCcw /> Reset to default
              </Button>
            }
          />
        )}
      </div>
    </Card>
  );
}

export function SiteImagesManager({ images }: { images: SiteImages }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {SITE_IMAGE_SLOTS.map((def) => (
        <SlotCard key={def.slot} def={def} current={images[def.slot]} />
      ))}
    </div>
  );
}
