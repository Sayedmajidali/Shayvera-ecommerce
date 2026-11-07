import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { emailSchema, idSchema, optionalTrimmed, trimmed } from "@/lib/validation/common";
import { db, type Tx } from "@/server/platform/db";
import { logger } from "@/server/platform/logger";
import { audit } from "@/server/modules/audit/audit";
import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  OWNER_ROLE_ID,
  type Permission,
} from "@/server/modules/auth/permissions";

export type StaffActor = { id: string; ip: string | null };

/** Path the invite link sends staff to; the marker lets the email use invite wording. */
export const INVITE_REDIRECT = "/reset-password?invite=1";

/** Creates any missing built-in role (never overwrites edits). Used by seeds and tests. */
export async function ensureBuiltInRoles(client: Tx | typeof db = db) {
  for (const r of BUILT_IN_ROLES) {
    await client.adminRole.upsert({
      where: { id: r.id },
      create: { ...r, isSystem: true },
      update: {},
    });
  }
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listStaff() {
  const users = await db.user.findMany({
    where: { role: "ADMIN" },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      createdAt: true,
      adminRole: { select: { id: true, name: true } },
      accounts: { where: { providerId: "credential" }, select: { id: true } },
      sessions: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
    },
  });
  return users.map(({ accounts, sessions, ...u }) => ({
    ...u,
    // No credential yet = invitation not accepted.
    invitePending: accounts.length === 0,
    lastActiveAt: sessions[0]?.updatedAt ?? null,
  }));
}

export async function listRoles() {
  const roles = await db.adminRole.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { _count: { select: { users: true } } },
  });
  return roles.map(({ _count, ...r }) => ({
    ...r,
    permissions: r.id === OWNER_ROLE_ID ? ALL_PERMISSIONS : (r.permissions as Permission[]),
    userCount: _count.users,
  }));
}

// ───────────────────────────── Guards ─────────────────────────────

/**
 * Serialises every change that could remove an Owner, so two owners demoting each other at the same
 * time cannot leave the store without one.
 */
async function lockOwners(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff:owners'))`;
}

async function assertAnotherActiveOwner(tx: Tx, excludingUserId: string) {
  const others = await tx.user.count({
    where: {
      id: { not: excludingUserId },
      role: "ADMIN",
      status: "ACTIVE",
      adminRoleId: OWNER_ROLE_ID,
    },
  });
  if (others === 0)
    throw new AppError("INVALID_STATE", "The store must keep at least one active Owner");
}

function assertNotSelf(actor: StaffActor, userId: string) {
  if (actor.id === userId)
    throw new AppError("INVALID_STATE", "You cannot change your own staff access");
}

async function requireRole(tx: Tx, roleId: string) {
  const role = await tx.adminRole.findUnique({ where: { id: roleId } });
  if (!role) throw new AppError("VALIDATION_ERROR", "Choose a valid role");
  return role;
}

// ───────────────────────────── Staff ─────────────────────────────

export const inviteStaffSchema = z.object({
  email: emailSchema,
  name: trimmed(2, 80, "Name"),
  roleId: idSchema,
});

/**
 * Gives a person staff access. An existing customer account is promoted (keeping its password);
 * otherwise an account without a password is created and a set-password link is emailed. Either
 * way the person is told by email. No password is ever chosen by, or shown to, the inviter.
 */
export async function inviteStaff(input: z.infer<typeof inviteStaffSchema>, actor: StaffActor) {
  const { email, name, roleId } = inviteStaffSchema.parse(input);
  const result = await db.$transaction(async (tx) => {
    const role = await requireRole(tx, roleId);
    const existing = await tx.user.findUnique({ where: { email } });
    let userId: string;
    let promoted = false;
    if (existing) {
      if (existing.role === "ADMIN")
        throw new AppError("CONFLICT", "This person already has staff access");
      if (existing.status !== "ACTIVE")
        throw new AppError("INVALID_STATE", "This account is disabled. Enable it first.");
      await tx.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN", adminRoleId: role.id },
      });
      // Privilege change: make the person sign in again.
      await tx.session.deleteMany({ where: { userId: existing.id } });
      userId = existing.id;
      promoted = true;
    } else {
      userId = randomUUID();
      await tx.user.create({
        data: { id: userId, email, name, role: "ADMIN", adminRoleId: role.id, status: "ACTIVE" },
      });
    }
    await audit(
      {
        actorId: actor.id,
        action: promoted ? "staff.promote" : "staff.invite",
        entityType: "User",
        entityId: userId,
        metadata: { email, role: role.name },
        ipAddress: actor.ip,
      },
      tx,
    );
    return { userId, promoted, roleName: role.name };
  });

  if (!result.promoted) await sendInvite(email);
  else await notifyPromotion(email, name, result.roleName);
  return result;
}

/** Emails a set-password link (Better Auth reset flow; the link expires in 30 minutes). */
async function sendInvite(email: string) {
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: INVITE_REDIRECT } });
  } catch (error) {
    // The account exists; the owner can resend from the staff page.
    logger.error("Failed to send staff invitation", { error });
  }
}

async function notifyPromotion(email: string, name: string, roleName: string) {
  const { sendEmail } = await import("@/server/modules/notifications/email-service");
  const { siteConfig } = await import("@/lib/site");
  await sendEmail({
    to: email,
    subject: `You now have staff access to ${siteConfig.name}`,
    template: "staff-promoted",
    text: `Hi ${name},\n\nYou have been given the ${roleName} role. Sign in with your existing password at ${siteConfig.url}/login and open ${siteConfig.url}/admin.\n\nIf you did not expect this, contact the store owner.`,
  });
}

export async function resendInvite(userId: string, actor: StaffActor) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { accounts: { where: { providerId: "credential" } } },
  });
  if (!user || user.role !== "ADMIN") throw new AppError("NOT_FOUND", "Staff member not found");
  if (user.accounts.length > 0)
    throw new AppError("INVALID_STATE", "This person has already set a password");
  await sendInvite(user.email);
  await audit({
    actorId: actor.id,
    action: "staff.invite.resend",
    entityType: "User",
    entityId: userId,
    ipAddress: actor.ip,
  });
}

export const updateStaffSchema = z
  .object({
    roleId: idSchema.optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  })
  .refine((v) => v.roleId !== undefined || v.status !== undefined, "Nothing to update");

/** Changes a staff member's role and/or enables/disables them. */
export async function updateStaff(
  userId: string,
  input: z.infer<typeof updateStaffSchema>,
  actor: StaffActor,
) {
  const data = updateStaffSchema.parse(input);
  assertNotSelf(actor, userId);
  return db.$transaction(async (tx) => {
    await lockOwners(tx);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "ADMIN") throw new AppError("NOT_FOUND", "Staff member not found");
    const role = data.roleId ? await requireRole(tx, data.roleId) : null;

    const losesOwner =
      user.adminRoleId === OWNER_ROLE_ID &&
      ((role && role.id !== OWNER_ROLE_ID) || data.status === "DISABLED");
    if (losesOwner) await assertAnotherActiveOwner(tx, userId);

    const update: Prisma.UserUpdateInput = {};
    if (role) update.adminRole = { connect: { id: role.id } };
    if (data.status) update.status = data.status;
    await tx.user.update({ where: { id: userId }, data: update });
    if (data.status === "DISABLED") await tx.session.deleteMany({ where: { userId } });

    await audit(
      {
        actorId: actor.id,
        action: "staff.update",
        entityType: "User",
        entityId: userId,
        metadata: {
          ...(role ? { fromRoleId: user.adminRoleId, toRole: role.name } : {}),
          ...(data.status ? { fromStatus: user.status, toStatus: data.status } : {}),
        },
        ipAddress: actor.ip,
      },
      tx,
    );
    return tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, status: true, adminRole: { select: { id: true, name: true } } },
    });
  });
}

/** Removes staff access (the account remains as a customer account) and signs the person out. */
export async function removeStaff(userId: string, actor: StaffActor) {
  assertNotSelf(actor, userId);
  await db.$transaction(async (tx) => {
    await lockOwners(tx);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "ADMIN") throw new AppError("NOT_FOUND", "Staff member not found");
    if (user.adminRoleId === OWNER_ROLE_ID) await assertAnotherActiveOwner(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { role: "CUSTOMER", adminRoleId: null } });
    await tx.session.deleteMany({ where: { userId } });
    await audit(
      {
        actorId: actor.id,
        action: "staff.remove",
        entityType: "User",
        entityId: userId,
        metadata: { email: user.email },
        ipAddress: actor.ip,
      },
      tx,
    );
  });
}

// ───────────────────────────── Roles ─────────────────────────────

const permissionList = z
  .array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]))
  .max(ALL_PERMISSIONS.length)
  .transform((l) => [...new Set(l)]);

export const roleSchema = z.object({
  name: trimmed(2, 60, "Name"),
  description: optionalTrimmed(300),
  permissions: permissionList,
});

export const roleUpdateSchema = roleSchema.partial();

export async function createRole(input: z.infer<typeof roleSchema>, actor: StaffActor) {
  const data = roleSchema.parse(input);
  return db.$transaction(async (tx) => {
    const role = await tx.adminRole.create({ data: { ...data, isSystem: false } });
    await audit(
      {
        actorId: actor.id,
        action: "role.create",
        entityType: "AdminRole",
        entityId: role.id,
        metadata: { name: role.name, permissions: role.permissions },
        ipAddress: actor.ip,
      },
      tx,
    );
    return role;
  });
}

/**
 * Edits a role. The Owner role is fixed. Built-in roles keep their name but their permissions can
 * be adjusted. Changes apply to every holder on their next request.
 */
export async function updateRole(
  roleId: string,
  input: z.infer<typeof roleUpdateSchema>,
  actor: StaffActor,
) {
  const data = roleUpdateSchema.parse(input);
  if (roleId === OWNER_ROLE_ID)
    throw new AppError("INVALID_STATE", "The Owner role always has full access");
  return db.$transaction(async (tx) => {
    const role = await tx.adminRole.findUnique({ where: { id: roleId } });
    if (!role) throw new AppError("NOT_FOUND", "Role not found");
    if (role.isSystem && data.name !== undefined && data.name !== role.name)
      throw new AppError("INVALID_STATE", "Built-in roles cannot be renamed");
    const updated = await tx.adminRole.update({ where: { id: roleId }, data });
    await audit(
      {
        actorId: actor.id,
        action: "role.update",
        entityType: "AdminRole",
        entityId: roleId,
        metadata: { from: role.permissions, to: updated.permissions, name: updated.name },
        ipAddress: actor.ip,
      },
      tx,
    );
    return updated;
  });
}

export async function deleteRole(roleId: string, actor: StaffActor) {
  await db.$transaction(async (tx) => {
    const role = await tx.adminRole.findUnique({
      where: { id: roleId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new AppError("NOT_FOUND", "Role not found");
    if (role.isSystem) throw new AppError("INVALID_STATE", "Built-in roles cannot be deleted");
    if (role._count.users > 0)
      throw new AppError("INVALID_STATE", "Move staff off this role before deleting it");
    await tx.adminRole.delete({ where: { id: roleId } });
    await audit(
      {
        actorId: actor.id,
        action: "role.delete",
        entityType: "AdminRole",
        entityId: roleId,
        metadata: { name: role.name },
        ipAddress: actor.ip,
      },
      tx,
    );
  });
}

/** Admin activity over the last 30 days from the audit log: actions per staff member and by area. */
export async function staffActivity() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [perActor, perArea] = await Promise.all([
    db.adminAuditLog.groupBy({
      by: ["actorId"],
      where: { createdAt: { gte: since }, actorId: { not: null } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    db.adminAuditLog.groupBy({
      by: ["entityType"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { entityType: "desc" } },
      take: 8,
    }),
  ]);
  return {
    byActor: Object.fromEntries(
      perActor.map((a) => [a.actorId!, { actions: a._count._all, lastActionAt: a._max.createdAt }]),
    ) as Record<string, { actions: number; lastActionAt: Date | null }>,
    byArea: perArea.map((a) => ({ area: a.entityType, actions: a._count._all })),
  };
}
