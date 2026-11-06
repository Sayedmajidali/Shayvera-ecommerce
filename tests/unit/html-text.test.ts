import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  htmlToText,
  truncateWords,
} from "@/server/modules/catalog/importers/html-text";

describe("htmlToText", () => {
  it("keeps paragraph and list structure and decodes entities", () => {
    expect(
      htmlToText(
        '<p><strong data-x="1">Roasted Makhana:</strong> light &amp; crisp</p><ul><li>Low fat</li><li>High protein</li></ul><p>They&#8217;re great&nbsp;&hellip;</p>',
      ),
    ).toBe("Roasted Makhana: light & crisp\n\n• Low fat\n• High protein\n\nThey’re great …");
  });

  it("drops scripts, styles, comments and unknown tags", () => {
    expect(
      htmlToText(
        "<script>alert(1)</script><style>p{}</style><!-- x --><img src=x onerror=alert(1)>Safe <b>text</b>",
      ),
    ).toBe("Safe text");
  });

  it("never produces markup or control characters from entities", () => {
    expect(htmlToText("&lt;script&gt;x&lt;/script&gt;")).toBe("<script>x</script>"); // text, rendered escaped
    expect(decodeEntities("a&#0;b&#x1;c&#xD800;d&unknown;")).toBe("abcd&unknown;");
  });

  it("handles empty input", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText(null)).toBe("");
  });
});

describe("truncateWords", () => {
  it("cuts on a word boundary with an ellipsis", () => {
    expect(truncateWords("Crunchy sunflower seeds with a delicate nutty taste", 30)).toBe(
      "Crunchy sunflower seeds with…",
    );
    expect(truncateWords("short", 30)).toBe("short");
  });
});
