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
    <header className="mx-auto max-w-3xl pt-12 pb-10 text-center">
      {eyebrow && (
        <p className="text-brand text-xs font-medium tracking-[0.25em] uppercase">{eyebrow}</p>
      )}
      <h1 className="heading-display mt-3 text-4xl sm:text-5xl">{title}</h1>
      {children && <div className="text-muted-foreground mt-4">{children}</div>}
    </header>
  );
}
