import type { Prisma } from "@prisma/client";
import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/modules/audit/audit";
import { SOLD_STATUSES } from "@/server/modules/orders/order-status";

type AdminActor = { id: string; ip?: string | null };

// ───────────────────────────── Customers ─────────────────────────────

export async function listCustomers(
  f: { q?: string; status?: "ACTIVE" | "DISABLED"; page: number },
  pageSize = 20,
) {
  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",
    ...(f.status ? { status: f.status } : {}),
    ...(f.q
      ? {
          OR: [
            { name: { contains: f.q, mode: "insensitive" } },
            { email: { contains: f.q, mode: "insensitive" } },
            { phone: { contains: f.q } },
          ],
        }
      : {}),
  };
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    }),
  ]);
  const ids = users.map((u) => u.id);
  const spend = ids.length
    ? await db.order.groupBy({
        by: ["userId"],
        where: { userId: { in: ids }, status: { in: [...SOLD_STATUSES] } },
        _sum: { totalPaise: true },
      })
    : [];
  const spendMap = new Map(spend.map((s) => [s.userId, s._sum.totalPaise ?? 0]));
  return {
    total,
    customers: users.map((u) => ({ ...u, totalSpentPaise: spendMap.get(u.id) ?? 0 })),
    page: f.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomer(id: string) {
  const user = await db.user.findFirst({
    where: { id, role: "CUSTOMER" },
    include: {
      addresses: true,
      orders: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          totalPaise: true,
          createdAt: true,
        },
      },
      sessions: { select: { id: true } },
    },
  });
  if (!user) throw new AppError("NOT_FOUND", "Customer not found");
  return user;
}

/** Disabling an account blocks sign-in and revokes all active sessions immediately. */
export async function setCustomerStatus(
  id: string,
  status: "ACTIVE" | "DISABLED",
  actor: AdminActor,
) {
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.role !== "CUSTOMER") throw new AppError("NOT_FOUND", "Customer not found");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status } });
    if (status === "DISABLED") await tx.session.deleteMany({ where: { userId: id } });
    await audit(
      {
        actorId: actor.id,
        action: status === "DISABLED" ? "customer.disable" : "customer.enable",
        entityType: "User",
        entityId: id,
        ipAddress: actor.ip,
      },
      tx,
    );
  });
}
