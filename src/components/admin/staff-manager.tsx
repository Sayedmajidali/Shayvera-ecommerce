"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Pencil, Plus, ShieldCheck, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

type RoleOption = { id: string; name: string };

export type StaffRow = {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  adminRole: RoleOption | null;
  invitePending: boolean;
  lastActiveAt: string | null;
  createdAt: string;
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

export function StaffManager({
  staff,
  roles,
  currentUserId,
}: {
  staff: StaffRow[];
  roles: RoleOption[];
  currentUserId: string;
}) {
  const { busy, run } = useAction();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", roleId: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const res = await apiFetch<{ promoted: boolean }>("/api/admin/staff", { body: form });
      toast.success(
        res.promoted
          ? "Existing account given staff access; they were notified by email"
          : "Invitation sent",
      );
      setInviteOpen(false);
      setForm({ name: "", email: "", roleId: "" });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not invite");
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="staff-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="staff-heading" className="text-lg font-semibold">
          Staff
        </h2>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus /> Invite staff
        </Button>
      </div>
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((s) => {
              const self = s.id === currentUserId;
              return (
                <TableRow key={s.id} data-testid={`staff-${s.email}`}>
                  <TableCell>
                    <p className="font-medium">
                      {s.name} {self && <span className="text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-muted-foreground text-xs">{s.email}</p>
                  </TableCell>
                  <TableCell>
                    {self ? (
                      <span className="text-sm">{s.adminRole?.name ?? "No role"}</span>
                    ) : (
                      <Select
                        value={s.adminRole?.id ?? ""}
                        disabled={busy !== null}
                        onValueChange={(roleId) =>
                          run(
                            `role-${s.id}`,
                            () =>
                              apiFetch(`/api/admin/staff/${s.id}`, {
                                method: "PATCH",
                                body: { roleId },
                              }),
                            "Role updated",
                          )
                        }
                      >
                        <SelectTrigger className="w-40" aria-label={`Role for ${s.name}`}>
                          <SelectValue placeholder="No role" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.status === "DISABLED" ? (
                      <Badge variant="destructive">Disabled</Badge>
                    ) : s.invitePending ? (
                      <Badge variant="warning">Invite pending</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {fmt(s.lastActiveAt)}
                  </TableCell>
                  <TableCell>
                    {!self && (
                      <div className="flex justify-end gap-1">
                        {s.invitePending && s.status === "ACTIVE" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                              run(
                                `invite-${s.id}`,
                                () =>
                                  apiFetch(`/api/admin/staff/${s.id}/invite`, {
                                    method: "POST",
                                    body: {},
                                  }),
                                "Invitation re-sent",
                              )
                            }
                          >
                            <Mail /> Resend
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            run(
                              `status-${s.id}`,
                              () =>
                                apiFetch(`/api/admin/staff/${s.id}`, {
                                  method: "PATCH",
                                  body: { status: s.status === "ACTIVE" ? "DISABLED" : "ACTIVE" },
                                }),
                              s.status === "ACTIVE"
                                ? "Staff member disabled"
                                : "Staff member enabled",
                            )
                          }
                        >
                          <Lock /> {s.status === "ACTIVE" ? "Disable" : "Enable"}
                        </Button>
                        <ConfirmButton
                          title={`Remove staff access for ${s.name}?`}
                          description="They will be signed out. Their account stays as a normal customer account."
                          confirmLabel="Remove access"
                          onConfirm={() =>
                            void run(
                              `remove-${s.id}`,
                              () => apiFetch(`/api/admin/staff/${s.id}`, { method: "DELETE" }),
                              "Staff access removed",
                            )
                          }
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy !== null}
                              aria-label={`Remove ${s.name}`}
                            >
                              <UserMinus />
                            </Button>
                          }
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite staff</DialogTitle>
            <DialogDescription>
              They’ll get an email to set their own password. If the email already has a customer
              account, that account is given staff access instead.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={invite} className="grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="staff-name">Name</Label>
              <Input
                id="staff-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                aria-invalid={!!errors.name}
              />
              <FieldError message={errors.name} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="staff-email">Email</Label>
              <Input
                id="staff-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                aria-invalid={!!errors.email}
              />
              <FieldError message={errors.email} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="staff-role">Role</Label>
              <Select value={form.roleId} onValueChange={(roleId) => setForm({ ...form, roleId })}>
                <SelectTrigger id="staff-role" aria-invalid={!!errors.roleId}>
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.roleId} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !form.roleId}>
                Send invitation
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ───────────────────────────── Roles ─────────────────────────────

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
};

type CatalogueEntry = { key: string; group: string; label: string };

export function RoleManager({
  roles,
  catalogue,
}: {
  roles: RoleRow[];
  catalogue: CatalogueEntry[];
}) {
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [form, setForm] = useState({ name: "", description: "", permissions: [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const router = useRouter();
  const groups = [...new Set(catalogue.map((c) => c.group))];
  const labelOf = (k: string) => catalogue.find((c) => c.key === k)?.label ?? k;

  const open = (r: RoleRow | "new") => {
    setEditing(r);
    setErrors({});
    setForm(
      r === "new"
        ? { name: "", description: "", permissions: ["DASHBOARD_VIEW"] }
        : { name: r.name, description: r.description ?? "", permissions: [...r.permissions] },
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const isNew = editing === "new";
    try {
      await apiFetch(isNew ? "/api/admin/roles" : `/api/admin/roles/${(editing as RoleRow).id}`, {
        method: isNew ? "POST" : "PATCH",
        body: form,
      });
      toast.success("Role saved");
      setEditing(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not save role");
    }
  };

  const toggle = (key: string, on: boolean) =>
    setForm((f) => ({
      ...f,
      permissions: on ? [...f.permissions, key] : f.permissions.filter((p) => p !== key),
    }));

  return (
    <section aria-labelledby="roles-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="roles-heading" className="text-lg font-semibold">
          Roles
        </h2>
        <Button variant="outline" onClick={() => open("new")}>
          <Plus /> New role
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((r) => {
          const owner = r.id === "role_owner";
          return (
            <Card key={r.id} className="gap-3 p-5" data-testid={`role-${r.name}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    <ShieldCheck className="text-brand size-4" aria-hidden /> {r.name}
                    {r.isSystem && <Badge variant="secondary">Built-in</Badge>}
                  </p>
                  {r.description && (
                    <p className="text-muted-foreground mt-1 text-sm">{r.description}</p>
                  )}
                  <p className="text-muted-foreground mt-1 text-xs">
                    {r.userCount} {r.userCount === 1 ? "person" : "people"}
                  </p>
                </div>
                {!owner && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => open(r)}
                      aria-label={`Edit ${r.name}`}
                    >
                      <Pencil />
                    </Button>
                    {!r.isSystem && (
                      <ConfirmButton
                        title={`Delete the ${r.name} role?`}
                        description="Roles can only be deleted when nobody has them."
                        confirmLabel="Delete role"
                        onConfirm={() =>
                          void run(
                            `del-${r.id}`,
                            () => apiFetch(`/api/admin/roles/${r.id}`, { method: "DELETE" }),
                            "Role deleted",
                          )
                        }
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={busy !== null}
                            aria-label={`Delete ${r.name}`}
                          >
                            <Trash2 />
                          </Button>
                        }
                      />
                    )}
                  </div>
                )}
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {owner ? (
                  <li>
                    <Badge variant="brand">Everything</Badge>
                  </li>
                ) : (
                  r.permissions.map((p) => (
                    <li key={p}>
                      <Badge variant="outline">{labelOf(p)}</Badge>
                    </li>
                  ))
                )}
              </ul>
            </Card>
          );
        })}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New role" : `Edit ${form.name}`}</DialogTitle>
            <DialogDescription>
              Staff with this role get exactly these permissions.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={form.name}
                disabled={editing !== "new" && editing?.isSystem}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                aria-invalid={!!errors.name}
              />
              <FieldError message={errors.name} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-desc">Description</Label>
              <Textarea
                id="role-desc"
                rows={2}
                maxLength={300}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <fieldset className="grid gap-4">
              <legend className="mb-2 text-sm font-medium">Permissions</legend>
              {groups.map((g) => (
                <div key={g} className="grid gap-2">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {g}
                  </p>
                  {catalogue
                    .filter((c) => c.group === g)
                    .map((c) => (
                      <label key={c.key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.permissions.includes(c.key)}
                          onCheckedChange={(v) => toggle(c.key, v === true)}
                        />
                        {c.label}
                      </label>
                    ))}
                </div>
              ))}
              <FieldError message={errors.permissions} />
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save role</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
