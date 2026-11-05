"use client";

import { useEffect } from "react";
import { StatusScreen } from "@/components/shared/status-screen";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      code="Something went wrong"
      title="We hit an unexpected snag"
      description={`Please try again. If the problem continues, contact support${error.digest ? ` and mention reference ${error.digest}` : ""}.`}
      action={<Button onClick={() => reset()}>Try again</Button>}
    />
  );
}
