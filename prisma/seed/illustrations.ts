/**
 * Generates studio-style product illustrations (SVG → WebP via sharp) for local seed data.
 * These are placeholders for real photography: admins replace them through the dashboard.
 */
import sharp from "sharp";

export type Shape =
  | "mug"
  | "vase"
  | "candle"
  | "bowl"
  | "bottle"
  | "notebook"
  | "tote"
  | "lamp"
  | "plant"
  | "cushion"
  | "towel"
  | "soap"
  | "pen"
  | "stand"
  | "pouch"
  | "plate"
  | "teapot"
  | "board"
  | "diffuser"
  | "throw"
  | "jar"
  | "standup"
  | "heap"
  | "makhana"
  | "giftbox";

const W = 1200;
const H = 1500;

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amt * 255);
  const g = clamp(((n >> 8) & 255) + amt * 255);
  const b = clamp((n & 255) + amt * 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function objectSvg(shape: Shape, c: string): string {
  const d = shade(c, -0.12);
  const l = shade(c, 0.12);
  switch (shape) {
    case "mug":
      return `<path d="M760 760 q120 0 120 110 t-120 110" fill="none" stroke="${d}" stroke-width="40"/>
        <rect x="420" y="700" width="360" height="400" rx="40" fill="url(#g)"/>
        <ellipse cx="600" cy="700" rx="180" ry="34" fill="${d}"/><ellipse cx="600" cy="700" rx="160" ry="24" fill="${shade(c, -0.25)}"/>`;
    case "vase":
      return `<path d="M520 560 h160 q-10 80 60 160 q120 140 40 330 q-30 60 -120 60 h-120 q-90 0 -120 -60 q-80 -190 40 -330 q70 -80 60 -160z" fill="url(#g)"/>
        <ellipse cx="600" cy="560" rx="80" ry="16" fill="${d}"/>`;
    case "candle":
      return `<rect x="440" y="760" width="320" height="340" rx="28" fill="url(#g)"/>
        <ellipse cx="600" cy="760" rx="160" ry="30" fill="${l}"/>
        <rect x="594" y="700" width="12" height="60" rx="6" fill="#3a3330"/>
        <path d="M600 610 q34 50 0 90 q-34 -40 0 -90z" fill="#f2b45a"/>`;
    case "bowl":
      return `<path d="M330 820 h540 q-20 260 -270 260 q-250 0 -270 -260z" fill="url(#g)"/>
        <ellipse cx="600" cy="820" rx="270" ry="44" fill="${d}"/><ellipse cx="600" cy="820" rx="246" ry="32" fill="${shade(c, -0.2)}"/>`;
    case "bottle":
      return `<rect x="555" y="470" width="90" height="90" rx="16" fill="#2f2a27"/>
        <path d="M540 560 h120 v80 q100 30 100 120 v300 q0 40 -40 40 h-240 q-40 0 -40 -40 v-300 q0 -90 100 -120z" fill="url(#g)"/>
        <rect x="470" y="800" width="260" height="160" rx="10" fill="${l}" opacity="0.85"/>`;
    case "notebook":
      return `<g transform="rotate(-6 600 850)"><rect x="400" y="560" width="400" height="540" rx="16" fill="url(#g)"/>
        <rect x="400" y="560" width="40" height="540" rx="10" fill="${d}"/>
        <rect x="720" y="560" width="22" height="540" fill="${shade(c, -0.3)}" opacity="0.5"/>
        <rect x="500" y="680" width="200" height="16" rx="8" fill="${l}"/><rect x="500" y="712" width="140" height="12" rx="6" fill="${l}"/></g>`;
    case "tote":
      return `<path d="M500 640 q0 -140 100 -140 q100 0 100 140" fill="none" stroke="${d}" stroke-width="22"/>
        <path d="M400 640 h400 l40 460 h-480z" fill="url(#g)"/>
        <rect x="400" y="640" width="400" height="30" fill="${d}" opacity="0.5"/>`;
    case "lamp":
      return `<path d="M470 520 h260 l80 220 h-420z" fill="url(#g)"/>
        <rect x="588" y="740" width="24" height="280" fill="#3a3330"/>
        <ellipse cx="600" cy="1060" rx="140" ry="36" fill="${d}"/><rect x="460" y="1030" width="280" height="30" rx="14" fill="${d}"/>`;
    case "plant":
      return `<path d="M600 760 q-180 -80 -170 -300 q140 60 170 300z" fill="#5f7d5a"/>
        <path d="M600 760 q190 -100 160 -320 q-150 80 -160 320z" fill="#6f8f68"/>
        <path d="M600 760 q-20 -200 40 -380 q60 170 -40 380z" fill="#4f6b4b"/>
        <path d="M440 760 h320 l-40 340 h-240z" fill="url(#g)"/><rect x="430" y="740" width="340" height="50" rx="12" fill="${d}"/>`;
    case "cushion":
      return `<path d="M360 640 q240 -60 480 0 q40 220 0 440 q-240 60 -480 0 q-40 -220 0 -440z" fill="url(#g)"/>
        <path d="M400 860 q200 -30 400 0" stroke="${d}" stroke-width="8" fill="none" opacity="0.5"/>`;
    case "towel":
      return `<rect x="380" y="900" width="440" height="100" rx="20" fill="${d}"/>
        <rect x="380" y="820" width="440" height="100" rx="20" fill="url(#g)"/>
        <rect x="380" y="740" width="440" height="100" rx="20" fill="${l}"/>
        <rect x="380" y="790" width="440" height="10" fill="${d}" opacity="0.4"/>`;
    case "soap":
      return `<rect x="360" y="900" width="480" height="60" rx="30" fill="#d9cfc2"/>
        <rect x="430" y="760" width="340" height="170" rx="60" fill="url(#g)"/>
        <ellipse cx="600" cy="790" rx="120" ry="18" fill="${l}" opacity="0.7"/>`;
    case "pen":
      return `<g transform="rotate(-28 600 850)"><rect x="300" y="820" width="560" height="56" rx="28" fill="url(#g)"/>
        <path d="M860 820 l100 28 l-100 28z" fill="#c9a86a"/><rect x="380" y="812" width="160" height="12" rx="6" fill="#c9a86a"/></g>`;
    case "stand":
      return `<path d="M420 1080 l120 -420 h40 l-60 420z" fill="url(#g)"/>
        <rect x="380" y="1060" width="420" height="40" rx="18" fill="${d}"/>
        <rect x="520" y="520" width="240" height="420" rx="30" fill="#2c2a2e" transform="rotate(14 640 730)"/>`;
    case "pouch":
      return `<path d="M380 700 h440 q30 0 30 30 v300 q0 50 -50 50 h-400 q-50 0 -50 -50 v-300 q0 -30 30 -30z" fill="url(#g)"/>
        <rect x="380" y="700" width="440" height="30" fill="${d}"/><circle cx="790" cy="715" r="14" fill="#c9a86a"/>`;
    case "plate":
      return `<ellipse cx="600" cy="880" rx="320" ry="130" fill="${d}"/>
        <ellipse cx="600" cy="866" rx="310" ry="122" fill="url(#g)"/>
        <ellipse cx="600" cy="866" rx="200" ry="76" fill="${l}" opacity="0.6"/>`;
    case "teapot":
      return `<path d="M760 820 q120 -40 140 -160" fill="none" stroke="${d}" stroke-width="34" stroke-linecap="round"/>
        <path d="M450 760 q-90 20 -90 120 q0 60 70 80" fill="none" stroke="${d}" stroke-width="30"/>
        <ellipse cx="600" cy="880" rx="200" ry="190" fill="url(#g)"/>
        <ellipse cx="600" cy="700" rx="110" ry="26" fill="${d}"/><circle cx="600" cy="670" r="22" fill="${d}"/>`;
    case "board":
      return `<g transform="rotate(-8 600 850)"><rect x="340" y="700" width="520" height="320" rx="60" fill="url(#g)"/>
        <rect x="860" y="820" width="120" height="70" rx="35" fill="url(#g)"/><circle cx="930" cy="855" r="16" fill="${d}"/></g>`;
    case "diffuser":
      return `<line x1="560" y1="760" x2="470" y2="460" stroke="#6d5a46" stroke-width="10"/>
        <line x1="600" y1="760" x2="610" y2="430" stroke="#6d5a46" stroke-width="10"/>
        <line x1="640" y1="760" x2="740" y2="470" stroke="#6d5a46" stroke-width="10"/>
        <path d="M520 760 h160 q90 50 90 170 v120 q0 50 -50 50 h-240 q-50 0 -50 -50 v-120 q0 -120 90 -170z" fill="url(#g)" opacity="0.92"/>`;
    case "jar":
      // Glass spice jar with wooden lid; contents in the product colour.
      return `<rect x="430" y="560" width="340" height="80" rx="18" fill="#a8774f"/>
        <rect x="430" y="600" width="340" height="12" fill="#8c603d"/>
        <path d="M440 650 h320 v380 q0 60 -60 60 h-200 q-60 0 -60 -60z" fill="#f4efe6" opacity="0.55" stroke="#d9cfc0" stroke-width="6"/>
        <path d="M452 740 h296 v290 q0 48 -48 48 h-200 q-48 0 -48 -48z" fill="url(#g)"/>
        <path d="M452 740 q74 -26 148 0 t148 0" fill="${l}" opacity="0.5"/>
        <rect x="490" y="830" width="220" height="140" rx="10" fill="#fbf8f2"/>
        <rect x="520" y="870" width="160" height="14" rx="7" fill="${d}"/><rect x="545" y="900" width="110" height="10" rx="5" fill="${d}" opacity="0.6"/>`;
    case "standup":
      // Kraft stand-up pouch with a window showing the contents.
      return `<path d="M410 560 h380 l20 520 q0 20 -20 20 h-380 q-20 0 -20 -20z" fill="#c9a77c"/>
        <rect x="410" y="560" width="380" height="40" fill="#b8956a"/>
        <rect x="430" y="616" width="340" height="6" rx="3" fill="#a5835a"/>
        <rect x="470" y="700" width="260" height="230" rx="110" fill="url(#g)"/>
        <rect x="470" y="700" width="260" height="230" rx="110" fill="none" stroke="#f3eadb" stroke-width="8"/>
        <rect x="490" y="960" width="220" height="16" rx="8" fill="#3a2f27" opacity="0.8"/><rect x="530" y="990" width="140" height="10" rx="5" fill="#3a2f27" opacity="0.5"/>`;
    case "heap": {
      // Bowl heaped with nuts / dry fruits.
      const pts = Array.from({ length: 26 }, (_, i) => {
        const row = Math.floor(i / 7);
        const x = 390 + (i % 7) * 70 + (row % 2) * 35;
        const y = 790 - row * 52 - (Math.abs(3 - (i % 7)) < 2 ? 20 : 0);
        return `<ellipse cx="${x}" cy="${y}" rx="44" ry="30" transform="rotate(${((i * 37) % 70) - 35} ${x} ${y})" fill="${i % 3 === 0 ? d : i % 3 === 1 ? c : l}"/>`;
      }).join("");
      return `${pts}<path d="M320 800 h560 q-20 260 -280 260 q-260 0 -280 -260z" fill="#e7ddcd"/>
        <ellipse cx="600" cy="800" rx="280" ry="30" fill="#d9ccb7" opacity="0.6"/>`;
    }
    case "makhana": {
      // Bowl of roasted fox nuts with seasoning flecks.
      const puffs = Array.from({ length: 22 }, (_, i) => {
        const row = Math.floor(i / 6);
        const x = 400 + (i % 6) * 80 + (row % 2) * 40;
        const y = 790 - row * 58;
        return `<circle cx="${x}" cy="${y}" r="40" fill="#f6efe2" stroke="#e2d4bd" stroke-width="5"/><circle cx="${x - 10}" cy="${y - 8}" r="6" fill="${c}" opacity="0.8"/><circle cx="${x + 12}" cy="${y + 6}" r="4" fill="${d}" opacity="0.7"/>`;
      }).join("");
      return `${puffs}<path d="M320 800 h560 q-20 260 -280 260 q-260 0 -280 -260z" fill="url(#g)"/>
        <ellipse cx="600" cy="800" rx="280" ry="30" fill="${d}" opacity="0.35"/>`;
    }
    case "giftbox":
      return `<rect x="380" y="700" width="440" height="380" rx="14" fill="url(#g)"/>
        <rect x="360" y="640" width="480" height="90" rx="14" fill="${d}"/>
        <rect x="575" y="640" width="50" height="440" fill="#d9b25f"/>
        <rect x="360" y="670" width="480" height="30" fill="#d9b25f" opacity="0.9"/>
        <path d="M600 640 q-120 -120 -150 -40 q-10 40 150 40z" fill="#d9b25f"/><path d="M600 640 q120 -120 150 -40 q10 40 -150 40z" fill="#c9a24f"/>`;
    case "throw":
      return `<path d="M360 700 h480 v360 q-240 60 -480 0z" fill="url(#g)"/>
        <g stroke="${d}" stroke-width="6" opacity="0.5">${Array.from({ length: 8 }, (_, i) => `<line x1="${400 + i * 56}" y1="700" x2="${400 + i * 56}" y2="1070"/>`).join("")}</g>
        <g stroke="${d}" stroke-width="4">${Array.from({ length: 16 }, (_, i) => `<line x1="${370 + i * 30}" y1="1066" x2="${370 + i * 30}" y2="1110"/>`).join("")}</g>`;
  }
}

export type IllustrationOptions = {
  shape: Shape;
  color: string;
  background: string;
  variant?: 0 | 1 | 2;
};

export function illustrationSvg({
  shape,
  color,
  background,
  variant = 0,
}: IllustrationOptions): string {
  const bgDark = shade(background, -0.06);
  const pedestal = shade(background, -0.1);
  const scale = variant === 2 ? 1.25 : 1;
  const tx = (W - W * scale) / 2;
  const ty = (H - H * scale) / 2 + (variant === 2 ? 60 : 0);
  const backdrop =
    variant === 1
      ? `<circle cx="600" cy="640" r="380" fill="${bgDark}"/>`
      : `<path d="M240 1500 V560 a360 360 0 0 1 720 0 V1500z" fill="${bgDark}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${shade(color, 0.08)}"/><stop offset="1" stop-color="${shade(color, -0.1)}"/>
    </linearGradient>
    <radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${background}"/>
  ${variant === 2 ? "" : backdrop}
  ${variant === 2 ? "" : `<rect x="0" y="1180" width="${W}" height="320" fill="${pedestal}"/>`}
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <ellipse cx="600" cy="1110" rx="340" ry="46" fill="url(#s)"/>
    ${objectSvg(shape, color)}
  </g>
</svg>`;
}

export async function renderIllustration(opts: IllustrationOptions): Promise<Buffer> {
  return sharp(Buffer.from(illustrationSvg(opts)))
    .webp({ quality: 82 })
    .toBuffer();
}

/** Wide banner artwork for categories / hero. */
export async function renderBanner(
  shapes: Shape[],
  colors: string[],
  background: string,
): Promise<Buffer> {
  const bw = 1600;
  const bh = 1000;
  const items = shapes
    .slice(0, 3)
    .map((s, i) => {
      const x = [-180, 220, 620][i]!;
      const y = [40, -40, 60][i]!;
      const sc = [0.78, 0.92, 0.72][i]!;
      return `<g transform="translate(${x} ${y}) scale(${sc})"><ellipse cx="600" cy="1110" rx="340" ry="46" fill="url(#s)"/>${objectSvg(s, colors[i % colors.length]!)}</g>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(colors[0]!, 0.08)}"/><stop offset="1" stop-color="${shade(colors[0]!, -0.1)}"/></linearGradient>
  <radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.2"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
  <rect width="${bw}" height="${bh}" fill="${background}"/>
  <circle cx="1180" cy="380" r="420" fill="${shade(background, -0.05)}"/>
  <rect x="0" y="820" width="${bw}" height="180" fill="${shade(background, -0.08)}"/>
  <g transform="translate(200 -20) scale(0.9)">${items}</g>
</svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
}
