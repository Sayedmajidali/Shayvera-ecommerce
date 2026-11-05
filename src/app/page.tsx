import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  await db.$queryRaw`SELECT 1`;
  return (
    <main className="container-page flex flex-1 flex-col items-center justify-center py-24 text-center">
      <p className="text-brand text-sm font-medium tracking-[0.2em] uppercase">Shayvera</p>
      <h1 className="heading-display mt-4 text-5xl">Foundation ready</h1>
      <p className="text-muted-foreground mt-4">Database connection verified.</p>
    </main>
  );
}
