"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

type Img = {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
};

export function ImagesManager({
  productId,
  images,
  productName,
}: {
  productId: string;
  images: Img[];
  productName: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("file", file);
      form.set("alt", productName);
      const res = await fetch(`/api/admin/products/${productId}/images`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(`${file.name}: ${body?.error?.message ?? "Upload failed"}`);
      }
    }
    setUploading(false);
    if (input.current) input.current.value = "";
    router.refresh();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const order = images.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j]!, order[index]!];
    try {
      await apiFetch(`/api/admin/products/${productId}/images`, {
        method: "PATCH",
        body: { order },
      });
      router.refresh();
    } catch {
      toast.error("Could not reorder images");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Images</CardTitle>
          <CardDescription className="mt-1">
            JPG, PNG, WebP or AVIF · min 200×200 · max 5 MB. The first image is the cover.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} Upload
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          hidden
          aria-label="Upload product images"
          data-testid="image-upload-input"
          onChange={(e) => upload(e.target.files)}
        />
      </CardHeader>
      <CardContent>
        {images.length === 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="text-muted-foreground hover:bg-accent flex w-full flex-col items-center justify-center rounded-xl border border-dashed py-12 text-sm"
          >
            <ImagePlus className="mb-2 size-6" /> Add the first image
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {images.map((img, i) => (
              <li key={img.id} className="bg-card overflow-hidden rounded-xl border">
                <div className="bg-muted relative aspect-[4/5]">
                  <Image src={img.url} alt={img.alt} fill sizes="200px" className="object-cover" />
                  {i === 0 && (
                    <span className="bg-primary text-primary-foreground absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-medium">
                      Cover
                    </span>
                  )}
                </div>
                <div className="grid gap-2 p-2">
                  <Input
                    defaultValue={img.alt}
                    aria-label="Alt text"
                    placeholder="Alt text"
                    className="h-8 text-xs"
                    onBlur={async (e) => {
                      if (e.target.value === img.alt) return;
                      try {
                        await apiFetch(`/api/admin/images/${img.id}`, {
                          method: "PATCH",
                          body: { alt: e.target.value },
                        });
                        toast.success("Alt text saved");
                      } catch (err) {
                        toast.error(
                          err instanceof ApiClientError ? err.message : "Could not save alt text",
                        );
                      }
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-[11px]">
                      {img.width}×{img.height} ·{" "}
                      {img.sizeBytes ? Math.round(img.sizeBytes / 1024) : "?"} KB
                    </span>
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label="Move earlier"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={i === images.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label="Move later"
                      >
                        <ArrowDown />
                      </Button>
                      <ConfirmButton
                        title="Delete this image?"
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          await apiFetch(`/api/admin/images/${img.id}`, { method: "DELETE" });
                          toast.success("Image deleted");
                          router.refresh();
                        }}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Delete image">
                            <Trash2 />
                          </Button>
                        }
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
