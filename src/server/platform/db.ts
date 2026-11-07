import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * Single PrismaClient per process. In development, Next.js hot reloading re-evaluates
 * modules, so the instance is cached on globalThis to avoid exhausting connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Db = typeof db;
export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
