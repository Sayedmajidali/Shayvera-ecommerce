import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { BUILT_IN_ROLES, OWNER_ROLE_ID } from "@/server/modules/auth/permissions";
import { getUserFromHeaders } from "@/server/modules/auth/session";
import * as staffRoute from "@/app/api/admin/staff/route";
import * as staffIdRoute from "@/app/api/admin/staff/[id]/route";
import * as rolesRoute from "@/app/api/admin/roles/route";
import * as roleIdRoute from "@/app/api/admin/roles/[id]/route";
import * as ordersRoute from "@/app/api/admin/orders/route";
import * as productsRoute from "@/app/api/admin/products/route";
import * as statusRoute from "@/app/api/admin/orders/[id]/status/route";
import * as dashboardRoute from "@/app/api/admin/dashboard/route";
import {
  apiRequest,
  authRequest,
  createAdmin,
  params,
  registerCustomer,
  signIn,
  TEST_PASSWORD,
} from "../helpers/auth";
import { makeProduct } from "../helpers/fixtures";

type Handler = (req: Request, ctx: unknown) => Promise<Response>;

/** Creates a signed-in staff member with the given role (null = no role). */
async function staff(email: string, roleId: string | null) {
  const a = await createAdmin(email);
  await db.user.update({ where: { id: a.user.id }, data: { adminRoleId: roleId } });
  return a;
}

const call = (
  h: Handler,
  path: string,
  init: Parameters<typeof apiRequest>[1] = {},
  ctx: unknown = undefined,
) => h(apiRequest(path, init), ctx);

describe("built-in roles", () => {
  it("match the migration that seeds them in every environment", () => {
    const dir = "prisma/migrations";
    const file = readdirSync(dir).find((d) => d.endsWith("_admin_roles"));
    const sql = readFileSync(`${dir}/${file}/migration.sql`, "utf8");
    for (const r of BUILT_IN_ROLES) {
      const m = sql.match(new RegExp(`'${r.id}', '${r.name}',[^\\n]*\\n\\s*ARRAY\\[([^\\]]*)\\]`));
      expect(m, r.name).toBeTruthy();
      const seeded = m![1]!.split(",").map((p) => p.trim().replace(/'/g, ""));
      expect([...seeded].sort(), r.name).toEqual([...r.permissions].sort());
    }
  });

  it("are present after reset and the Owner always has every permission", async () => {
    expect(await db.adminRole.count({ where: { isSystem: true } })).toBe(5);
    await db.adminRole.update({ where: { id: OWNER_ROLE_ID }, data: { permissions: [] } });
    const { cookie } = await createAdmin("owner@test.local");
    const u = await getUserFromHeaders(new Headers({ cookie }));
    expect(u?.adminRole?.name).toBe("Owner");
    expect(u?.permissions).toContain("ADMINS_MANAGE");
  });
});

describe("permission enforcement", () => {
  const routeFiles = import.meta.glob<Record<string, unknown>>("/src/app/api/admin/**/route.ts", {
    eager: true,
  });

  it("every admin API handler rejects signed-out users and staff without a role", async () => {
    const { cookie } = await staff("norole@test.local", null);
    const fakeCtx = params({ id: "x" });
    let checked = 0;
    for (const [file, mod] of Object.entries(routeFiles)) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const h = mod[method] as Handler | undefined;
        if (!h) continue;
        const path = file.replace("/src/app", "").replace("/route.ts", "").replace("[id]", "x");
        const anon = await call(
          h,
          path,
          { method, body: method === "GET" ? undefined : {} },
          fakeCtx,
        );
        expect(anon.status, `${method} ${path} (anonymous)`).toBe(401);
        const res = await call(
          h,
          path,
          { method, cookie, body: method === "GET" ? undefined : {} },
          fakeCtx,
        );
        expect(res.status, `${method} ${path} (no role)`).toBe(403);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(40);
  });

  it("customers get 403 from staff management", async () => {
    const { cookie } = await registerCustomer("cust@test.local");
    expect((await call(staffRoute.GET as Handler, "/api/admin/staff", { cookie })).status).toBe(
      403,
    );
  });

  it("scopes each role to its sections", async () => {
    await makeProduct();
    const catalog = await staff("catalog@test.local", "role_catalog");
    expect(
      (await call(productsRoute.GET as Handler, "/api/admin/products", { cookie: catalog.cookie }))
        .status,
    ).toBe(200);
    expect(
      (await call(ordersRoute.GET as Handler, "/api/admin/orders", { cookie: catalog.cookie }))
        .status,
    ).toBe(403);
    expect(
      (await call(staffRoute.GET as Handler, "/api/admin/staff", { cookie: catalog.cookie }))
        .status,
    ).toBe(403);

    const support = await staff("support@test.local", "role_support");
    expect(
      (await call(ordersRoute.GET as Handler, "/api/admin/orders", { cookie: support.cookie }))
        .status,
    ).toBe(200);
    expect(
      (await call(productsRoute.GET as Handler, "/api/admin/products", { cookie: support.cookie }))
        .status,
    ).toBe(403);
  });

  it("applies role edits on the next request without re-login", async () => {
    const s = await staff("edit@test.local", "role_catalog");
    expect(
      (await call(dashboardRoute.GET as Handler, "/api/admin/dashboard", { cookie: s.cookie }))
        .status,
    ).toBe(200);
    await db.adminRole.update({
      where: { id: "role_catalog" },
      data: { permissions: ["CATALOG_MANAGE"] },
    });
    expect(
      (await call(dashboardRoute.GET as Handler, "/api/admin/dashboard", { cookie: s.cookie }))
        .status,
    ).toBe(403);
  });

  it("requires refund permission to cancel a paid online order", async () => {
    const ops = await staff("ops@test.local", "role_operations");
    const order = await db.order.create({
      data: {
        orderNumber: "SHV99990001",
        email: "b@example.com",
        phone: "9845012345",
        status: "CONFIRMED",
        paymentMethod: "RAZORPAY",
        paymentStatus: "PAID",
        subtotalPaise: 10_000,
        totalPaise: 10_000,
        shippingAddress: {},
        billingAddress: {},
        shippingStateCode: "KA",
        idempotencyKey: "rbac-test-order",
      },
    });
    const res = await statusRoute.POST(
      apiRequest(`/api/admin/orders/${order.id}/status`, {
        method: "POST",
        cookie: ops.cookie,
        body: { status: "CANCELLED", note: "test" },
      }),
      params({ id: order.id }),
    );
    expect(res.status).toBe(403);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "CONFIRMED",
    );
  });
});

describe("staff management", () => {
  it("invites a new person who sets their own password and gets the chosen role", async () => {
    const owner = await createAdmin("owner@test.local");
    const res = await call(staffRoute.POST as Handler, "/api/admin/staff", {
      method: "POST",
      cookie: owner.cookie,
      body: { email: "New.Staff@Example.com", name: "New Staff", roleId: "role_support" },
    });
    expect(res.status).toBe(201);
    const user = await db.user.findUniqueOrThrow({
      where: { email: "new.staff@example.com" },
      include: { accounts: true },
    });
    expect(user).toMatchObject({ role: "ADMIN", adminRoleId: "role_support" });
    expect(user.accounts).toHaveLength(0); // no password chosen by anyone else
    expect((await signIn("new.staff@example.com", TEST_PASSWORD)).res.ok).toBe(false);

    const email = await db.outboundEmail.findFirstOrThrow({ where: { template: "staff-invite" } });
    const token = email.text.match(/reset-password\/([^?\s]+)/)?.[1];
    expect(token).toBeTruthy();
    expect((await authRequest("/reset-password", { newPassword: "Staff1pass!", token })).ok).toBe(
      true,
    );
    const { cookie } = await signIn("new.staff@example.com", "Staff1pass!");
    const me = await getUserFromHeaders(new Headers({ cookie }));
    expect(me?.adminRole?.name).toBe("Support");
    expect(await db.adminAuditLog.count({ where: { action: "staff.invite" } })).toBe(1);
  });

  it("promotes an existing customer, signs them out and notifies them", async () => {
    const owner = await createAdmin("owner@test.local");
    const cust = await registerCustomer("shopper@test.local");
    const res = await call(staffRoute.POST as Handler, "/api/admin/staff", {
      method: "POST",
      cookie: owner.cookie,
      body: { email: "shopper@test.local", name: "Shopper", roleId: "role_catalog" },
    });
    expect(res.status).toBe(201);
    expect(await getUserFromHeaders(new Headers({ cookie: cust.cookie }))).toBeNull();
    expect(await db.outboundEmail.count({ where: { template: "staff-promoted" } })).toBe(1);
    const again = await call(staffRoute.POST as Handler, "/api/admin/staff", {
      method: "POST",
      cookie: owner.cookie,
      body: { email: "shopper@test.local", name: "Shopper", roleId: "role_catalog" },
    });
    expect(again.status).toBe(409);
  });

  it("prevents self-edits and losing the last active Owner", async () => {
    const a = await createAdmin("a@test.local");
    const b = await createAdmin("b@test.local");
    const patch = (cookie: string, id: string, body: unknown) =>
      staffIdRoute.PATCH(
        apiRequest(`/api/admin/staff/${id}`, { method: "PATCH", cookie, body }),
        params({ id }),
      );
    expect((await patch(a.cookie, a.user.id, { roleId: "role_support" })).status).toBe(409);
    expect((await patch(a.cookie, b.user.id, { roleId: "role_support" })).status).toBe(200);
    // b is no longer an Owner; a is the last one and cannot be demoted by anyone.
    const c = await createAdmin("c@test.local");
    await db.user.update({ where: { id: c.user.id }, data: { adminRoleId: "role_operations" } });
    await db.adminRole.update({
      where: { id: "role_operations" },
      data: { permissions: ["ADMINS_MANAGE"] },
    });
    const res = await patch(c.cookie, a.user.id, { status: "DISABLED" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/at least one active Owner/);
    const del = await staffIdRoute.DELETE(
      apiRequest(`/api/admin/staff/${a.user.id}`, { method: "DELETE", cookie: c.cookie }),
      params({ id: a.user.id }),
    );
    expect(del.status).toBe(409);
  });

  it("two owners demoting each other at once cannot both succeed", async () => {
    const a = await createAdmin("a@test.local");
    const b = await createAdmin("b@test.local");
    const [r1, r2] = await Promise.all([
      staffIdRoute.PATCH(
        apiRequest(`/api/admin/staff/${b.user.id}`, {
          method: "PATCH",
          cookie: a.cookie,
          body: { roleId: "role_support" },
        }),
        params({ id: b.user.id }),
      ),
      staffIdRoute.PATCH(
        apiRequest(`/api/admin/staff/${a.user.id}`, {
          method: "PATCH",
          cookie: b.cookie,
          body: { roleId: "role_support" },
        }),
        params({ id: a.user.id }),
      ),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await db.user.count({ where: { adminRoleId: OWNER_ROLE_ID } })).toBe(1);
  });

  it("disabling staff signs them out and blocks sign-in; removing keeps a customer account", async () => {
    const owner = await createAdmin("owner@test.local");
    const s = await staff("s@test.local", "role_support");
    await staffIdRoute.PATCH(
      apiRequest(`/api/admin/staff/${s.user.id}`, {
        method: "PATCH",
        cookie: owner.cookie,
        body: { status: "DISABLED" },
      }),
      params({ id: s.user.id }),
    );
    expect(await getUserFromHeaders(new Headers({ cookie: s.cookie }))).toBeNull();
    expect((await signIn("s@test.local")).res.ok).toBe(false);

    const t = await staff("t@test.local", "role_support");
    const del = await staffIdRoute.DELETE(
      apiRequest(`/api/admin/staff/${t.user.id}`, { method: "DELETE", cookie: owner.cookie }),
      params({ id: t.user.id }),
    );
    expect(del.status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id: t.user.id } })).toMatchObject({
      role: "CUSTOMER",
      adminRoleId: null,
    });
  });

  it("protects built-in roles and roles in use", async () => {
    const owner = await createAdmin("owner@test.local");
    const patchRole = (id: string, body: unknown) =>
      roleIdRoute.PATCH(
        apiRequest(`/api/admin/roles/${id}`, { method: "PATCH", cookie: owner.cookie, body }),
        params({ id }),
      );
    expect((await patchRole(OWNER_ROLE_ID, { permissions: [] })).status).toBe(409);
    expect((await patchRole("role_support", { name: "Helpdesk" })).status).toBe(409);
    expect((await patchRole("role_support", { permissions: ["ORDERS_VIEW"] })).status).toBe(200);

    const created = await call(rolesRoute.POST as Handler, "/api/admin/roles", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Packer", permissions: ["ORDERS_VIEW", "SHIPPING_MANAGE", "ORDERS_VIEW"] },
    });
    expect(created.status).toBe(201);
    const role = (await created.json()).data;
    expect(role.permissions).toEqual(["ORDERS_VIEW", "SHIPPING_MANAGE"]);
    const bad = await call(rolesRoute.POST as Handler, "/api/admin/roles", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Bad", permissions: ["SUPERUSER"] },
    });
    expect(bad.status).toBe(400);

    await staff("p@test.local", role.id);
    const delRole = (id: string) =>
      roleIdRoute.DELETE(
        apiRequest(`/api/admin/roles/${id}`, { method: "DELETE", cookie: owner.cookie }),
        params({ id }),
      );
    expect((await delRole(role.id)).status).toBe(409);
    expect((await delRole("role_support")).status).toBe(409);
  });
});
