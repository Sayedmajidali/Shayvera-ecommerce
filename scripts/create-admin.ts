/**
 * Provision an administrator account.
 *
 *   npm run admin:create -- --email owner@example.com --name "Store Owner"
 *
 * The password is read from the ADMIN_PASSWORD env var or prompted interactively (hidden).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { provisionAdmin } from "../src/server/modules/auth/admin-provisioning";
import { db } from "../src/server/platform/db";

async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const rlAny = rl as unknown as {
    _writeToOutput: (s: string) => void;
    output: NodeJS.WriteStream;
  };
  rlAny._writeToOutput = (s: string) => {
    if (s.includes(question)) rlAny.output.write(s);
    else rlAny.output.write("*");
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" } },
  });
  if (!values.email || !values.name) {
    console.error('Usage: npm run admin:create -- --email you@example.com --name "Your Name"');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD ?? (await promptHidden("Admin password: "));
  const result = await provisionAdmin({ email: values.email, name: values.name, password });
  console.log(
    result.created ? `Created admin ${result.email}` : `Promoted/updated admin ${result.email}`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
