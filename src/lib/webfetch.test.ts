import { describe, expect, it } from "vitest";
import { fetchPageText, htmlToText } from "@/lib/webfetch.js";

function stubPage(body: string, contentType = "text/html"): typeof fetch {
  return (async () =>
    new Response(body, { headers: { "content-type": contentType } })) as typeof fetch;
}

describe("lib webfetch", () => {
  it("strips pages to readable text", () => {
    expect(htmlToText("<script>evil()</script><h1>Hi</h1><p>a&nbsp;b &amp; c</p>")).toBe(
      "Hi a b & c",
    );
  });

  it("fetches pages as capped text without network", async () => {
    const text = await fetchPageText("https://example.com/docs", stubPage("<h1>Hello web</h1>"));
    expect(text).toContain("Hello web");
    expect(
      await fetchPageText("https://example.com/t.txt", stubPage("plain ok", "text/plain")),
    ).toBe("plain ok");
  });

  it("rejects non-http urls and reports failures", async () => {
    expect(await fetchPageText("gopher://x", stubPage(""))).toContain("http(s) only");
    expect(await fetchPageText("not a url", stubPage(""))).toContain("http(s) URL");
    expect(
      await fetchPageText(
        "https://example.com/404",
        (async () => new Response("no", { status: 404 })) as typeof fetch,
      ),
    ).toContain("404");
  });
});
