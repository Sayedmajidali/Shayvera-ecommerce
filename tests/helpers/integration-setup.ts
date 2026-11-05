import { afterAll, beforeEach } from "vitest";
import { loadTestEnv } from "./test-env";

loadTestEnv();

const { resetDatabase } = await import("./db");
const { db } = await import("@/lib/db");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});
