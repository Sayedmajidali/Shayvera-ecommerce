/** Static brand metadata. Operational settings (contact, GST, FSSAI, shipping) live in StoreSettings. */
export const siteConfig = {
  name: "Shayvera Food",
  shortName: "Shayvera",
  tagline: "Rooted in Trust, Crafted with Care",
  /** Customer care mailbox, listed on the Contact page next to the support email (Admin → Settings). */
  customerCareEmail: "customercare@shayvera.in",
  instagram: { handle: "@shayverafood", url: "https://www.instagram.com/shayverafood/" },
  description:
    "Shayvera Food brings honest, everyday food back to Indian kitchens — spices and masalas, dry fruits, nuts and roasted makhana, carefully selected and hygienically packed.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;
