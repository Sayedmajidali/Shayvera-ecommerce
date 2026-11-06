/**
 * Converts the small, trusted-structure HTML found in product descriptions (paragraphs, line
 * breaks, lists, inline formatting) to plain text. Output is stored as text and rendered by React
 * (escaped), so no markup from the source site ever reaches the page.
 */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  rupee: "₹",
  bull: "•",
  times: "×",
  deg: "°",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      // Reject control characters and invalid code points.
      if (
        !Number.isFinite(code) ||
        code < 32 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        return "";
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html
    .replace(/<(script|style|iframe|object|template)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(ul|ol)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Shortens to at most `max` characters on a word boundary, adding an ellipsis when cut. */
export function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
