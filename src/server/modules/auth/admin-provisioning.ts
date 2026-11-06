import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { db } from "@/server/platform/db";
import { emailSchema, passwordSchema, trimmed } from "@/lib/validation/common";
import { z } from "zod";
import { BUILT_IN_ROLES, OWNER_ROLE_ID } from "@/server/modules/auth/permissions";

const inputSchema = z.object({
  email: emailSchema,
  name: trimmed(2, 80, "Name"),
  password: passwordSchema,
});

/**
 * Creates (or promotes) an Owner. Used only by the CLI bootstrap script and tests. Further staff
 * are invited from Admin → Staff (no self-registration endpoint exists).
 */
export async function provisionAdmin(input: { email: string; name: string; password: string }) {
  const { email, name, password } = inputSchema.parse(input);
  const passwordHash = await hashPassword(password);

  return db.$transaction(async (tx) => {
    // The CLI bootstraps the store, so the person always becomes an Owner.
    for (const r of BUILT_IN_ROLES)
      await tx.adminRole.upsert({
        where: { id: r.id },
        create: { ...r, isSystem: true },
        update: {},
      });
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      await tx.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN", status: "ACTIVE", name, adminRoleId: OWNER_ROLE_ID },
      });
      const credential = await tx.account.findFirst({
        where: { userId: existing.id, providerId: "credential" },
      });
      if (credential) {
        await tx.account.update({ where: { id: credential.id }, data: { password: passwordHash } });
      } else {
        await tx.account.create({
          data: {
            id: randomUUID(),
            accountId: existing.id,
            providerId: "credential",
            userId: existing.id,
            password: passwordHash,
          },
        });
      }
      // Force re-login with the new credentials.
      await tx.session.deleteMany({ where: { userId: existing.id } });
      return { id: existing.id, email, created: false };
    }
    const id = randomUUID();
    await tx.user.create({
      data: {
        id,
        email,
        name,
        role: "ADMIN",
        status: "ACTIVE",
        emailVerified: true,
        adminRoleId: OWNER_ROLE_ID,
      },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: passwordHash,
      },
    });
    return { id, email, created: true };
  });
}
