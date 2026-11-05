import { Logo } from "@/components/store/logo";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="container-page flex justify-center py-16">
      <div className="w-full max-w-md">
        <div className="bg-card shadow-soft rounded-3xl border p-8 sm:p-10">
          <Logo className="text-xl" />
          <h1 className="heading-display mt-6 text-3xl">{title}</h1>
          {description && <p className="text-muted-foreground mt-2 text-sm">{description}</p>}
          <div className="mt-8">{children}</div>
        </div>
        {footer && <div className="text-muted-foreground mt-6 text-center text-sm">{footer}</div>}
      </div>
    </div>
  );
}
