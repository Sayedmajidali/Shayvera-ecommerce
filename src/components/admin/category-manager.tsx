"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FieldError } from "@/components/shared/field-error";
import { StatusBadge } from "@/components/admin/status-badge";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  isFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  productCount: number;
};

type FormState = Omit<AdminCategory, "id" | "productCount">;
const empty: FormState = {
  name: "",
  slug: "",
  description: "",
  sortOrder: 0,
  isActive: true,
  isFeatured: false,
  seoTitle: "",
  seoDescription: "",
};

export function CategoryManager({ categories }: { categories: AdminCategory[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminCategory | "new" | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const open = (c: AdminCategory | "new") => {
    setEditing(c);
    setErrors({});
    setForm(
      c === "new"
        ? empty
        : {
            ...c,
            description: c.description ?? "",
            seoTitle: c.seoTitle ?? "",
            seoDescription: c.seoDescription ?? "",
          },
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const isNew = editing === "new";
      await apiFetch(
        isNew ? "/api/admin/categories" : `/api/admin/categories/${(editing as AdminCategory).id}`,
        {
          method: isNew ? "POST" : "PUT",
          body: { ...form, slug: form.slug || undefined },
        },
      );
      toast.success(isNew ? "Category created" : "Category updated");
      setEditing(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not save category");
    } finally {
      setPending(false);
    }
  };

  const remove = async (c: AdminCategory) => {
    try {
      await apiFetch(`/api/admin/categories/${c.id}`, { method: "DELETE" });
      toast.success("Category deleted");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not delete category");
    }
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => open("new")}>
          <Plus /> New category
        </Button>
      </div>
      <Card className="gap-0 py-0">
        {categories.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={FolderTree} title="No categories yet" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead className="text-right">Order</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.name}
                    {c.isFeatured && <span className="text-brand ml-2 text-xs">Featured</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.isActive ? "ACTIVE" : "DRAFT"} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.productCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.sortOrder}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => open(c)}
                        aria-label={`Edit ${c.name}`}
                      >
                        <Pencil />
                      </Button>
                      <ConfirmButton
                        title={`Delete “${c.name}”?`}
                        description="Categories that still contain products cannot be deleted."
                        confirmLabel="Delete"
                        onConfirm={() => remove(c)}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`}>
                            <Trash2 />
                          </Button>
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New category" : "Edit category"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="c-name">Name</Label>
                <Input
                  id="c-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  aria-invalid={!!errors.name}
                />
                <FieldError message={errors.name} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-slug">Slug</Label>
                <Input
                  id="c-slug"
                  value={form.slug}
                  placeholder="auto-generated"
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  aria-invalid={!!errors.slug}
                />
                <FieldError message={errors.slug} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-desc">Description</Label>
              <Textarea
                id="c-desc"
                rows={3}
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="c-order">Sort order</Label>
                <Input
                  id="c-order"
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                />
              </div>
              <div className="flex items-center gap-2 self-end pb-2">
                <Switch
                  id="c-active"
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                />
                <Label htmlFor="c-active">Active</Label>
              </div>
              <div className="flex items-center gap-2 self-end pb-2">
                <Switch
                  id="c-featured"
                  checked={form.isFeatured}
                  onCheckedChange={(v) => setForm({ ...form, isFeatured: v })}
                />
                <Label htmlFor="c-featured">Featured</Label>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-seo-title">SEO title</Label>
              <Input
                id="c-seo-title"
                maxLength={70}
                value={form.seoTitle ?? ""}
                onChange={(e) => setForm({ ...form, seoTitle: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-seo-desc">SEO description</Label>
              <Textarea
                id="c-seo-desc"
                maxLength={160}
                rows={2}
                value={form.seoDescription ?? ""}
                onChange={(e) => setForm({ ...form, seoDescription: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save category"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
