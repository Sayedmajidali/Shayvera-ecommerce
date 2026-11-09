"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const Stepper = lazy(() => import("@/components/react-bits/stepper"));
const Step = lazy(() =>
  import("@/components/react-bits/stepper").then((m) => ({ default: m.Step })),
);

const STEPS = [
  { title: "Address", target: "checkout-address", also: ["checkout-contact"] },
  { title: "Payment", target: "checkout-payment", also: [] as string[] },
  { title: "Review", target: "checkout-review", also: [] as string[] },
];

/**
 * Checkout progress (React Bits Stepper as an indicator; the form itself stays on one page).
 * The current step follows where the shopper is working — the section they focus or scroll to —
 * and clicking a step scrolls to that section.
 */
export function CheckoutProgress() {
  const [step, setStep] = useState(1);

  useEffect(() => {
    const index = (el: Element | null) => {
      const section = el?.closest<HTMLElement>("[data-checkout-step]");
      return section ? Number(section.dataset.checkoutStep) : 0;
    };
    const onFocus = (e: FocusEvent) => {
      const i = index(e.target as Element);
      if (i) setStep(i);
    };
    document.addEventListener("focusin", onFocus);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setStep(index(top.target));
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    // The sticky order summary is always on screen, so only focus (not scrolling) selects "Review".
    document.querySelectorAll("[data-checkout-step]:not(aside)").forEach((el) => io.observe(el));
    return () => {
      document.removeEventListener("focusin", onFocus);
      io.disconnect();
    };
  }, []);

  const goTo = (n: number) => {
    const s = STEPS[n - 1];
    if (!s) return;
    const el = document.getElementById(s.target);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({
      preventScroll: true,
    });
    setStep(n);
  };

  const plain = (
    <ol className="flex items-center gap-3 text-sm" aria-label="Checkout progress">
      {STEPS.map((s, i) => (
        <li
          key={s.title}
          aria-current={step === i + 1 ? "step" : undefined}
          className={cn(
            "flex items-center gap-2",
            step === i + 1 ? "font-semibold" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full border text-xs",
              step > i + 1 && "bg-primary text-primary-foreground border-primary",
              step === i + 1 && "border-primary text-primary",
            )}
          >
            {i + 1}
          </span>
          {s.title}
        </li>
      ))}
    </ol>
  );

  return (
    <nav aria-label="Checkout progress" className="mb-8" data-testid="checkout-progress">
      <Suspense fallback={plain}>
        <Stepper
          step={step}
          onStepChange={goTo}
          showFooter={false}
          frame={false}
          width="100%"
          theme="light"
          accentColor="#0c764e"
          transition="none"
          className="max-w-xl"
          // Upcoming steps: darker than the component's default grey for WCAG AA contrast.
          style={{ "--stepper-muted": "rgba(39, 39, 42, 0.72)" } as React.CSSProperties}
        >
          {STEPS.map((s) => (
            <Step key={s.title} title={s.title} />
          ))}
        </Stepper>
      </Suspense>
    </nav>
  );
}
