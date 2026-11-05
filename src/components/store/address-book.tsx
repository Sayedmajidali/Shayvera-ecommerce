"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import {
  AddressFields,
  AddressFormActions,
  emptyAddress,
  type AddressValues,
} from "@/components/store/address-form";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { stateName } from "@/lib/india";

export type SavedAddress = AddressValues & { id: string; isDefault: boolean };

export function AddressBook({ addresses }: { addresses: SavedAddress[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SavedAddress | "new" | null>(null);
  const [value, setValue] = useState<AddressValues>(emptyAddress);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const open = (a: SavedAddress | "new") => {
    setEditing(a);
    setErrors({});
    setValue(
      a === "new"
        ? { ...emptyAddress, isDefault: addresses.length === 0 }
        : { ...a, label: a.label ?? "", line2: a.line2 ?? "", landmark: a.landmark ?? "" },
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const isNew = editing === "new";
      await apiFetch(
        isNew ? "/api/account/addresses" : `/api/account/addresses/${(editing as SavedAddress).id}`,
        {
          method: isNew ? "POST" : "PUT",
          body: value,
        },
      );
      toast.success("Address saved");
      setEditing(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not save address");
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiFetch(`/api/account/addresses/${id}`, { method: "DELETE" });
      toast.success("Address removed");
      router.refresh();
    } catch {
      toast.error("Could not remove address");
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Saved addresses</h2>
        <Button onClick={() => open("new")} size="sm">
          <Plus /> Add address
        </Button>
      </div>
      {addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No saved addresses"
          description="Save an address for faster checkout."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {addresses.map((a) => (
            <div key={a.id} className="bg-card flex flex-col rounded-2xl border p-5">
              <div className="flex items-center gap-2">
                <p className="font-medium">{a.fullName}</p>
                {a.label && <Badge variant="secondary">{a.label}</Badge>}
                {a.isDefault && <Badge variant="brand">Default</Badge>}
              </div>
              <p className="text-muted-foreground mt-2 flex-1 text-sm leading-6">
                {a.line1}
                {a.line2 && `, ${a.line2}`}
                {a.landmark && `, near ${a.landmark}`}
                <br />
                {a.city}, {stateName(a.stateCode)} {a.pincode}
                <br />
                Phone: {a.phone}
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => open(a)}>
                  <Pencil /> Edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Trash2 /> Remove
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove this address?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This can’t be undone. Past orders are not affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => remove(a.id)}>
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add address" : "Edit address"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-6" noValidate>
            <AddressFields value={value} onChange={setValue} errors={errors} showDefault />
            <AddressFormActions pending={pending} onCancel={() => setEditing(null)} />
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
