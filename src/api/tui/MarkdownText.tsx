import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { parseMarkdown, type Span } from "@/api/tui/markdownBlocks.js";

function Spans({ spans, needle }: { spans: Span[]; needle: string }): ReactElement {
  return (
    <>
      {spans.map((span, i) => {
        const hit =
          needle !== "" && span.text.toLowerCase().includes(needle.toLowerCase())
            ? "yellow"
            : undefined;
        if (span.code) {
          return (
            <Text key={i} color={hit ?? "cyan"}>
              {span.text}
            </Text>
          );
        }
        return (
          <Text key={i} bold={span.bold === true || hit !== undefined} color={hit}>
            {span.text}
          </Text>
        );
      })}
    </>
  );
}

/** Renders an assistant reply as terminal markdown: headings, lists, quotes, and
 * code blocks lose their raw markers; `code` and **bold** get styled. */
export function MarkdownText({
  text,
  highlight = "",
}: {
  text: string;
  highlight?: string;
}): ReactElement {
  const blocks = parseMarkdown(text);
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "code":
            return (
              <Box key={i} flexDirection="column" paddingLeft={1}>
                {block.lines.map((line, j) => (
                  <Text key={j} wrap="wrap">
                    <Text dimColor>│ </Text>
                    <Text color="cyan">{line === "" ? " " : line}</Text>
                  </Text>
                ))}
              </Box>
            );
          case "heading":
            return (
              <Text key={i} bold underline={block.level === 1} wrap="wrap">
                <Spans spans={block.spans} needle={highlight} />
              </Text>
            );
          case "bullet":
            return (
              <Text key={i} wrap="wrap">
                {"  ".repeat(block.indent)}
                <Text color="green">{block.marker} </Text>
                <Spans spans={block.spans} needle={highlight} />
              </Text>
            );
          case "quote":
            return (
              <Text key={i} italic wrap="wrap">
                <Text dimColor>│ </Text>
                <Spans spans={block.spans} needle={highlight} />
              </Text>
            );
          case "rule":
            return (
              <Text key={i} dimColor>
                ────────────
              </Text>
            );
          case "blank":
            return <Text key={i}> </Text>;
          case "text":
            return (
              <Text key={i} wrap="wrap">
                <Spans spans={block.spans} needle={highlight} />
              </Text>
            );
        }
      })}
    </Box>
  );
}
