export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="animate-fade-up mx-auto max-w-3xl pt-12 pb-10 text-center">
      {eyebrow && (
        <p className="text-brand inline-flex items-center gap-2 text-xs font-semibold tracking-[0.25em] uppercase">
          <span className="bg-leaf h-px w-6" aria-hidden />
          {eyebrow}
          <span className="bg-leaf h-px w-6" aria-hidden />
        </p>
      )}
      <h1 className="heading-display mt-3 text-4xl sm:text-5xl">{title}</h1>
      {children && <div className="text-muted-foreground mt-4">{children}</div>}
    </header>
  );
}
