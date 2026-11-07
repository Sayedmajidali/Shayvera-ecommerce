import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SettingsForm } from "@/components/admin/settings-form";
import { PickupLocationForm } from "@/components/admin/pickup-location-form";
import { getDefaultPickupLocation } from "@/server/modules/shipping/shipments";
import { loadStoreSettings } from "@/server/modules/settings/queries";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage("SETTINGS_MANAGE");
  const [s, pickup] = await Promise.all([loadStoreSettings(), getDefaultPickupLocation()]);
  return (
    <>
      <AdminPageHeader
        title="Store settings"
        description="Contact details, shipping, GST, Cash on Delivery and numbering."
      />
      <SettingsForm
        initial={{
          storeName: s.storeName,
          legalName: s.legalName ?? "",
          logoUrl: s.logoUrl ?? "",
          supportEmail: s.supportEmail,
          supportPhone: s.supportPhone ?? "",
          addressLine1: s.addressLine1 ?? "",
          addressLine2: s.addressLine2 ?? "",
          city: s.city ?? "",
          stateCode: s.stateCode,
          pincode: s.pincode ?? "",
          gstEnabled: s.gstEnabled,
          gstin: s.gstin ?? "",
          fssaiLicense: s.fssaiLicense ?? "",
          pricesIncludeTax: s.pricesIncludeTax,
          defaultTaxRateBps: s.defaultTaxRateBps,
          shippingFlatPaise: s.shippingFlatPaise,
          freeShippingThresholdPaise: s.freeShippingThresholdPaise,
          codEnabled: s.codEnabled,
          codFeePaise: s.codFeePaise,
          codMinOrderPaise: s.codMinOrderPaise,
          codMaxOrderPaise: s.codMaxOrderPaise,
          codBlockedPincodes: s.codBlockedPincodes,
          minOrderPaise: s.minOrderPaise,
          orderPrefix: s.orderPrefix,
          invoicePrefix: s.invoicePrefix,
          lowStockThreshold: s.lowStockThreshold,
          defaultPackageWeightGrams: s.defaultPackageWeightGrams,
          defaultPackageLengthMm: s.defaultPackageLengthMm,
          defaultPackageBreadthMm: s.defaultPackageBreadthMm,
          defaultPackageHeightMm: s.defaultPackageHeightMm,
          returnWindowDays: s.returnWindowDays,
        }}
      />
      <div className="mt-6">
        <PickupLocationForm
          initial={
            pickup && {
              name: pickup.name,
              contactName: pickup.contactName,
              phone: pickup.phone,
              email: pickup.email,
              line1: pickup.line1,
              line2: pickup.line2 ?? "",
              city: pickup.city,
              stateCode: pickup.stateCode,
              pincode: pickup.pincode,
            }
          }
        />
      </div>
    </>
  );
}
