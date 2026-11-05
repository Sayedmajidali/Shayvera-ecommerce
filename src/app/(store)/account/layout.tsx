import { AccountNav } from "@/components/store/account-nav";
import { requireUserPage } from "@/server/auth/session";

export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  const user = await requireUserPage("/account");
  return (
    <div className="container-page py-10">
      <header className="mb-10">
        <p className="text-muted-foreground text-sm">My account</p>
        <h1 className="heading-display mt-1 text-4xl">Hello, {user.name.split(" ")[0]}</h1>
      </header>
      <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
        <AccountNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
