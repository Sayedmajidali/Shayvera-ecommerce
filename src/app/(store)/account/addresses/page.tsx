import type { Metadata } from "next";
import { AddressBook } from "@/components/store/address-book";
import { requireUserPage } from "@/server/auth/session";
import { listAddresses } from "@/server/services/account";

export const metadata: Metadata = { title: "Addresses", robots: { index: false } };

export default async function AddressesPage() {
  const user = await requireUserPage("/account/addresses");
  const addresses = await listAddresses(user.id);
  return (
    <AddressBook
      addresses={addresses.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        phone: a.phone,
        line1: a.line1,
        line2: a.line2 ?? "",
        landmark: a.landmark ?? "",
        city: a.city,
        stateCode: a.stateCode,
        pincode: a.pincode,
        label: a.label ?? "",
        isDefault: a.isDefault,
      }))}
    />
  );
}
