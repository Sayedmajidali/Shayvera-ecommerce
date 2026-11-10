/** Re-mounted on every admin navigation: a gentle fade so page changes feel smooth. */
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="admin-page-enter">{children}</div>;
}
