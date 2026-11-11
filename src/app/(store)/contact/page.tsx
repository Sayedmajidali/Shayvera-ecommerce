import type { Metadata } from "next";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { ContactForm } from "@/components/store/contact-form";
import { PageIntro } from "@/components/store/page-intro";
import { stateName, telHref } from "@/lib/india";
import { siteConfig } from "@/lib/site";
import { getStoreSettings } from "@/server/modules/settings/queries";

export const metadata: Metadata = { title: "Contact us", alternates: { canonical: "/contact" } };

export default async function ContactPage() {
  const s = await getStoreSettings();
  return (
    <div className="container-page pb-10">
      <PageIntro eyebrow="We’re here to help" title="Get in touch">
        <p>Questions about an order, a product or a bulk enquiry? Send us a note.</p>
      </PageIntro>
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_320px]">
        <ContactForm />
        <aside className="space-y-6 text-sm">
          <div className="flex gap-3">
            <Mail className="text-brand size-5" aria-hidden />
            <div>
              <p className="font-medium">Email</p>
              <a
                href={`mailto:${s.supportEmail}`}
                className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                {s.supportEmail}
              </a>
            </div>
          </div>
          {siteConfig.customerCareEmail !== s.supportEmail && (
            <div className="flex gap-3">
              <Mail className="text-brand size-5" aria-hidden />
              <div>
                <p className="font-medium">Customer care</p>
                <a
                  href={`mailto:${siteConfig.customerCareEmail}`}
                  className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  {siteConfig.customerCareEmail}
                </a>
              </div>
            </div>
          )}
          {s.supportPhone && (
            <div className="flex gap-3">
              <Phone className="text-brand size-5" aria-hidden />
              <div>
                <p className="font-medium">Phone</p>
                <a
                  href={telHref(s.supportPhone)}
                  className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  {s.supportPhone}
                </a>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <Clock className="text-brand size-5" aria-hidden />
            <div>
              <p className="font-medium">Hours</p>
              <p className="text-muted-foreground">Mon–Sat, 10am – 6pm IST</p>
            </div>
          </div>
          {s.addressLine1 && (
            <div className="flex gap-3">
              <MapPin className="text-brand size-5" aria-hidden />
              <div>
                <p className="font-medium">Studio</p>
                <p className="text-muted-foreground">
                  {s.addressLine1}
                  {s.addressLine2 ? `, ${s.addressLine2}` : ""}
                  <br />
                  {s.city}, {stateName(s.stateCode)} {s.pincode}
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
