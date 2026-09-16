import type { PluginTheme } from "@getpaseo/plugin";
import { Fragment, type ReactNode, useMemo } from "react";
import { Linking, Platform, Text, View } from "react-native";

// Small dependency-free markdown renderer. `react-native-markdown-display` (the maintained
// RN option) does not bundle: Paseo's plugin compiler builds the client target with esbuild
// `platform: "neutral"`, which defaults `mainFields` to empty, and that package only ships a
// plain `main` field with no `exports` map, so esbuild can't resolve it (reproduced directly
// against `compilePlugin`'s esbuild options — resolution succeeds under `platform: "node"`,
// fails under `"neutral"`; filed as a bd issue in the paseo repo with the concrete fix).
// bd descriptions are short structured text (headings, lists, emphasis, code, links), not
// full CommonMark documents, so this narrow subset is what's actually needed either way.

const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "hr" }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "ul"; text: string }
  | { kind: "ol"; index: number; text: string }
  | { kind: "paragraph"; text: string };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^```/;
const QUOTE_RE = /^>\s?(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^(\d+)\.\s+(.*)$/;

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      flushParagraph();
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE_RE.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (HR_RE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "hr" });
      continue;
    }
    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: "quote", text: quote[1] });
      continue;
    }
    const ul = UL_RE.exec(line);
    if (ul) {
      flushParagraph();
      blocks.push({ kind: "ul", text: ul[1] });
      continue;
    }
    const ol = OL_RE.exec(line);
    if (ol) {
      flushParagraph();
      blocks.push({ kind: "ol", index: Number(ol[1]), text: ol[2] });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

type Span = { kind: "text" | "bold" | "italic" | "code"; text: string } | { kind: "link"; text: string; href: string };

// bold(**/__) | code(`) | link([]()) | italic(*/_), tried in that order per position.
const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\[(.+?)\]\((\S+?)\)|\*(.+?)\*|_(.+?)_/g;

function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let lastIndex = 0;
  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null = INLINE_RE.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) spans.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    const [, bold1, bold2, code, linkText, linkHref, italic1, italic2] = match;
    if (bold1 !== undefined || bold2 !== undefined) spans.push({ kind: "bold", text: (bold1 ?? bold2) as string });
    else if (code !== undefined) spans.push({ kind: "code", text: code });
    else if (linkText !== undefined) spans.push({ kind: "link", text: linkText, href: linkHref });
    else spans.push({ kind: "italic", text: (italic1 ?? italic2) as string });
    lastIndex = match.index + match[0].length;
    match = INLINE_RE.exec(text);
  }
  if (lastIndex < text.length) spans.push({ kind: "text", text: text.slice(lastIndex) });
  return spans;
}

function InlineText({ text, theme, style }: { text: string; theme: PluginTheme; style: object }) {
  const spans = useMemo(() => parseInline(text), [text]);
  return (
    <Text style={style}>
      {spans.map((span, index) => {
        const key = `${index}-${span.text}`;
        if (span.kind === "bold") return <Text key={key} style={{ fontWeight: "600" }}>{span.text}</Text>;
        if (span.kind === "italic") return <Text key={key} style={{ fontStyle: "italic" }}>{span.text}</Text>;
        if (span.kind === "code") {
          return (
            <Text
              key={key}
              style={{ fontFamily: MONO_FONT, fontSize: 12, backgroundColor: theme.colors.surface2, color: theme.colors.foreground }}
            >
              {` ${span.text} `}
            </Text>
          );
        }
        if (span.kind === "link") {
          return (
            <Text
              key={key}
              style={{ color: theme.colors.accent, textDecorationLine: "underline" }}
              onPress={() => Linking.openURL(span.href)}
            >
              {span.text}
            </Text>
          );
        }
        return <Fragment key={key}>{span.text}</Fragment>;
      })}
    </Text>
  );
}

export function MarkdownText({ content, theme }: { content: string; theme: PluginTheme }): ReactNode {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const bodyStyle = { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 };
  const mutedStyle = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 };

  return (
    <View style={{ gap: 6 }}>
      {blocks.map((block, index) => {
        const key = `${index}-${block.kind}`;
        switch (block.kind) {
          case "heading":
            return (
              <InlineText
                key={key}
                text={block.text}
                theme={theme}
                style={{ color: theme.colors.foreground, fontSize: block.level <= 2 ? 15 : 13, fontWeight: "600" }}
              />
            );
          case "hr":
            return <View key={key} style={{ height: 1, backgroundColor: theme.colors.border }} />;
          case "quote":
            return (
              <View key={key} style={{ borderLeftWidth: 2, borderColor: theme.colors.border, paddingLeft: 8 }}>
                <InlineText text={block.text} theme={theme} style={{ ...mutedStyle, fontStyle: "italic" }} />
              </View>
            );
          case "code":
            return (
              <View key={key} style={{ backgroundColor: theme.colors.surface2, borderRadius: 6, padding: 8 }}>
                <Text style={{ color: theme.colors.foreground, fontFamily: MONO_FONT, fontSize: 12 }}>{block.text}</Text>
              </View>
            );
          case "ul":
            return (
              <View key={key} style={{ flexDirection: "row", gap: 6 }}>
                <Text style={mutedStyle}>{"\u2022"}</Text>
                <InlineText text={block.text} theme={theme} style={{ ...bodyStyle, flex: 1 }} />
              </View>
            );
          case "ol":
            return (
              <View key={key} style={{ flexDirection: "row", gap: 6 }}>
                <Text style={mutedStyle}>{block.index}.</Text>
                <InlineText text={block.text} theme={theme} style={{ ...bodyStyle, flex: 1 }} />
              </View>
            );
          case "paragraph":
            return <InlineText key={key} text={block.text} theme={theme} style={bodyStyle} />;
        }
      })}
    </View>
  );
}
