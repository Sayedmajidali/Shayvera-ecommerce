import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SiteImagesManager } from "@/components/admin/site-images-manager";
import { requireAdminPage } from "@/server/modules/auth/session";
import { getSiteImages } from "@/server/modules/settings/site-images";

export const metadata: Metadata = { title: "Site images" };

export default async function SiteImagesPage() {
  await requireAdminPage("SETTINGS_MANAGE");
  const images = await getSiteImages();
  return (
    <>
      <AdminPageHeader
        title="Site images"
        description="Replace the logo, home page photos, banners, icons and placeholders. JPG, PNG, WebP or AVIF; images are checked, cleaned of hidden data and optimised automatically. Product photos are managed on each product, category photos under Categories."
      />
      <SiteImagesManager images={images} />
    </>
  );
}
