import { PageIntro } from "@/components/store/page-intro";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** Shown under the title as "Last updated …"; omit to hide the line. */
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container-page pb-10">
      <PageIntro eyebrow="Policies" title={title}>
        {updated && <p className="text-sm">Last updated {updated}</p>}
      </PageIntro>
      <article className="prose-store mx-auto max-w-2xl">
        {children}
      </article>
    </div>
  );
}
