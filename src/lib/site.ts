/** Static brand metadata. Operational settings (contact, GST, shipping) live in StoreSettings. */
export const siteConfig = {
  name: "Shayvera",
  tagline: "Thoughtfully made everyday goods",
  description:
    "Shayvera curates thoughtfully made home, kitchen, wellness and lifestyle essentials, delivered across India.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;
