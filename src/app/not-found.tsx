import Link from "next/link";
import { StatusScreen } from "@/components/shared/status-screen";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  // Rendered outside the store layout, so it provides its own main landmark.
  return (
    <main id="main">
      <StatusScreen
        code="404"
        title="We couldn’t find that page"
        description="The page may have moved, or the link might be incorrect. Try browsing our collections instead."
        action={
          <Button asChild>
            <Link href="/shop">Browse the shop</Link>
          </Button>
        }
      />
    </main>
  );
}
