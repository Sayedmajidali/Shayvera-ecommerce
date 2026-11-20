import { redirect } from "next/navigation";

/** Media coverage is presented on the About page. Keep old links working. */
export default function PressPage() {
  redirect("/about#media-coverage-heading");
}
