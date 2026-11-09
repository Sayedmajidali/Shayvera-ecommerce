export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="text-destructive animate-in slide-in-from-top-1 text-xs duration-200"
    >
      {message}
    </p>
  );
}
