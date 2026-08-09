import TurndownService from "turndown";

let turndown: TurndownService | undefined;

/** Convert untrusted HTML source material to compact Markdown without active/page-chrome elements. */
export function htmlToMarkdown(html: string): string {
  turndown ??= new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  turndown.remove(["head", "title", "script", "style", "noscript", "template"]);
  turndown.remove((node) => node.nodeName === "SVG");
  return turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}
