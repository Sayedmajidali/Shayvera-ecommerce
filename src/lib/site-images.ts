/**
 * Storefront image slots that staff can replace in Admin → Site images. Client-safe catalogue:
 * every slot has a built-in default (or none), so the store always renders without uploads.
 */
export const SITE_IMAGE_SLOTS = [
  {
    slot: "logo",
    defaultNote: "Shayvera lotus logo",
    label: "Logo",
    where: "Header, footer and sign-in pages (shown about 40px tall).",
    recommended: "PNG or WebP with a transparent background, at least 400px wide.",
    defaultUrl: null, // the built-in lotus mark + wordmark
    minDimension: 48,
  },
  {
    slot: "heroPrimary",
    defaultNote: "Photo of your first featured product",
    label: "Home hero — main photo",
    where: "Large arched photo at the top of the home page.",
    recommended: "Portrait, about 1200×1500px.",
    defaultUrl: null, // first featured product photo
    minDimension: 400,
  },
  {
    slot: "heroSecondary",
    defaultNote: "Photo of your second featured product",
    label: "Home hero — round photo",
    where: "Smaller round photo beside the main hero photo.",
    recommended: "Square, at least 800×800px.",
    defaultUrl: null, // second featured product photo
    minDimension: 300,
  },
  {
    slot: "promoBanner",
    defaultNote: "Deep-green brand gradient",
    label: "Offer banner background",
    where: "Background of the “10% off your first order” banner (darkened for legibility).",
    recommended: "Landscape, about 2000×800px.",
    defaultUrl: null, // brand gradient
    minDimension: 400,
  },
  {
    slot: "aboutBanner",
    defaultNote: "No banner (text only)",
    label: "About page banner",
    where: "Wide photo below the About page title.",
    recommended: "Landscape, about 2000×900px.",
    defaultUrl: null, // no banner
    minDimension: 400,
  },
  {
    slot: "productPlaceholder",
    defaultNote: "Soft lotus tile",
    label: "Product photo placeholder",
    where: "Shown for products that have no photos yet.",
    recommended: "Portrait 4:5, about 1000×1250px.",
    defaultUrl: "/brand/placeholder.svg",
    minDimension: 200,
  },
  {
    slot: "shareImage",
    defaultNote: "Shayvera logo on ivory",
    label: "Link preview image",
    where: "Shown when a store link is shared on WhatsApp, Facebook, X and others.",
    recommended: "1200×630px.",
    defaultUrl: "/brand/og-default.png",
    minDimension: 200,
  },
  {
    slot: "appIcon",
    defaultNote: "Lotus mark",
    label: "Browser tab & app icon",
    where: "Browser tabs, bookmarks and phone home screens.",
    recommended: "Square PNG, 512×512px.",
    defaultUrl: "/brand/icon.png",
    minDimension: 48,
  },
  {
    slot: "certFssai",
    defaultNote: "FSSAI logo",
    label: "Certification — FSSAI",
    where: "Certifications section on the home and About pages (shown round, about 110px).",
    recommended: "The official logo from your certificate; square PNG, at least 300×300px.",
    defaultUrl: "/brand/certs/fssai.png",
    minDimension: 100,
  },
  {
    slot: "certGmp",
    defaultNote: "GMP seal",
    label: "Certification — GMP Certified",
    where: "Certifications section on the home and About pages (shown round, about 110px).",
    recommended: "The official logo from your certificate; square PNG, at least 300×300px.",
    defaultUrl: "/brand/certs/gmp.svg",
    minDimension: 100,
  },
  {
    slot: "certHalal",
    defaultNote: "Halal logo",
    label: "Certification — Halal Certified",
    where: "Certifications section on the home and About pages (shown round, about 110px).",
    recommended: "The official logo from your certificate; square PNG, at least 300×300px.",
    defaultUrl: "/brand/certs/halal.png",
    minDimension: 100,
  },
  {
    slot: "certRqc",
    defaultNote: "RQC Certified badge",
    label: "Certification — RQC Certified",
    where: "Certifications section on the home and About pages (shown round, about 110px).",
    recommended: "The official logo from your certificate; square PNG, at least 300×300px.",
    defaultUrl: "/brand/certs/rqc.png",
    minDimension: 100,
  },
  {
    slot: "certIso",
    defaultNote: "ISO logo",
    label: "Certification — ISO Certified",
    where: "Certifications section on the home and About pages (shown round, about 110px).",
    recommended: "The official logo from your certificate; square PNG, at least 300×300px.",
    defaultUrl: "/brand/certs/iso.png",
    minDimension: 100,
  },
  {
    slot: "certUkasl",
    defaultNote: "UKASL logo",
    label: "Certification — UKASL Certified",
    where: "Certifications section on the home and About pages (shown round, about 110px).",
    recommended: "The official logo from your certificate; square PNG, at least 300×300px.",
    defaultUrl: "/brand/certs/ukasl.png",
    minDimension: 100,
  },
  {
    slot: "certLabTested",
    defaultNote: "Lab Tested badge",
    label: "Certification — Lab Tested",
    where: "Certifications section on the home and About pages (shown round, about 110px).",
    recommended: "The official logo from your certificate; square PNG, at least 300×300px.",
    defaultUrl: "/brand/certs/lab-tested.png",
    minDimension: 100,
  },
  {
    slot: "certMsme",
    defaultNote: "MSME Registered badge",
    label: "Certification — MSME Registered",
    where: "Certifications section on the home and About pages (shown round, about 110px).",
    recommended: "The official logo from your certificate; square PNG, at least 300×300px.",
    defaultUrl: "/brand/certs/msme.png",
    minDimension: 100,
  },
] as const;

export type SiteImageSlot = (typeof SITE_IMAGE_SLOTS)[number]["slot"];
export const SITE_IMAGE_SLOT_KEYS = SITE_IMAGE_SLOTS.map((s) => s.slot) as SiteImageSlot[];

export function isSiteImageSlot(v: string): v is SiteImageSlot {
  return (SITE_IMAGE_SLOT_KEYS as string[]).includes(v);
}

export type SiteImageValue = { url: string; width: number; height: number; alt: string };
export type SiteImages = Partial<Record<SiteImageSlot, SiteImageValue>>;

/** Stable public address of a slot's current image (redirects to the upload or the default). */
export const siteImageHref = (slot: SiteImageSlot) => `/site-image/${slot}`;

/** Certifications shown in the storefront's Certifications section (each logo is a site image slot). */
export const CERTIFICATIONS = [
  { slot: "certFssai", name: "FSSAI" },
  { slot: "certIso", name: "ISO Certified" },
  { slot: "certGmp", name: "GMP Certified" },
  { slot: "certHalal", name: "Halal Certified" },
  { slot: "certRqc", name: "RQC Certified" },
  { slot: "certUkasl", name: "UKASL Certified" },
  { slot: "certLabTested", name: "Lab Tested" },
  { slot: "certMsme", name: "MSME Registered" },
] as const satisfies readonly { slot: SiteImageSlot; name: string }[];
