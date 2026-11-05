export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <main className="bg-muted/40 min-h-dvh py-8 print:bg-white print:py-0">{children}</main>;
}
