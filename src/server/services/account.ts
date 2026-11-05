import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AddressInput } from "@/lib/validation/account";

export async function updateProfile(userId: string, data: { name: string; phone: string | null }) {
  return db.user.update({
    where: { id: userId },
    data: { name: data.name, phone: data.phone },
    select: { id: true, name: true, email: true, phone: true },
  });
}

export async function listAddresses(userId: string) {
  return db.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

const MAX_ADDRESSES = 20;

export async function createAddress(userId: string, input: AddressInput) {
  return db.$transaction(async (tx) => {
    const count = await tx.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES) {
      throw new AppError("BUSINESS_RULE", `You can save up to ${MAX_ADDRESSES} addresses`);
    }
    const makeDefault = input.isDefault || count === 0;
    if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    return tx.address.create({ data: { ...input, userId, isDefault: makeDefault } });
  });
}

/** Ownership is enforced by including userId in every lookup — other users' ids return 404. */
export async function updateAddress(userId: string, id: string, input: AddressInput) {
  return db.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError("NOT_FOUND", "Address not found");
    if (input.isDefault)
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    return tx.address.update({
      where: { id },
      data: { ...input, isDefault: input.isDefault || existing.isDefault },
    });
  });
}

export async function deleteAddress(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError("NOT_FOUND", "Address not found");
    await tx.address.delete({ where: { id } });
    if (existing.isDefault) {
      const next = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}
