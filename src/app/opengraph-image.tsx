import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site";

export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default social sharing image (product pages override it with their own photo). */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#faf7f2",
        color: "#2a2520",
      }}
    >
      <div style={{ display: "flex", fontSize: 40, letterSpacing: -1 }}>
        Shayvera<span style={{ color: "#b5643f" }}>.</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -2, maxWidth: 900 }}>
          Everyday objects, made with care.
        </div>
        <div style={{ fontSize: 30, marginTop: 24, color: "#6b6258" }}>
          Home · Kitchen · Wellness · Stationery — delivered across India
        </div>
      </div>
      <div
        style={{ display: "flex", height: 12, width: 220, borderRadius: 6, background: "#b5643f" }}
      />
    </div>,
    size,
  );
}
