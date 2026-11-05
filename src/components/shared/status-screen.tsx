import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Full-page message used by not-found and error boundaries. */
export function StatusScreen({
  code,
  title,
  description,
  action,
}: {
  code: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="container-page flex flex-1 flex-col items-center justify-center py-24 text-center">
      <p className="text-brand text-sm font-medium tracking-[0.2em] uppercase">{code}</p>
      <h1 className="heading-display mt-4 text-4xl sm:text-5xl">{title}</h1>
      <p className="text-muted-foreground mt-4 max-w-md">{description}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {action}
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
