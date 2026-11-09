import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input bg-card placeholder:text-muted-foreground/80 hover:border-primary/30 flex h-10 w-full min-w-0 rounded-lg border px-3 py-2 text-sm shadow-xs transition-[color,border-color,box-shadow,background-color] duration-200 outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-ring/25 focus-visible:ring-[3px]",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:animate-[field-shake_320ms_ease-in-out]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
