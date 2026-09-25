// Minimal, dependency-free Markdown renderer for chat replies.
// Supports: paragraphs, **bold**, *italic*, `inline code`, fenced code blocks,
// unordered lists (- or *), ordered lists (1. 2.), blockquotes (>), links,
// headings (#–###), and horizontal rules (---).
// Escapes HTML in input first, then re-introduces markup from our own tokens.

const ESCAPE_MAP = {
  "&": "&",
  "<": "<",
  ">": ">",
  '"': "\"",
  "'": "'",
};

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

export function renderMarkdown(src) {
  if (!src) return "";
  const text = String(src).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      const escaped = escapeHtml(buf.join("\n"));
      out.push(
        `<pre class="md-code" data-lang="${escapeHtml(lang)}"><code>${escaped}</code></pre>`
      );
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*---\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (
        i < lines.length &&
        (/^\s*[-*]\s+/.test(lines[i]) || (buf.length && /^\s{2,}/.test(lines[i])))
      ) {
        if (/^\s*[-*]\s+/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        } else {
          buf.push(lines[i].trim());
        }
        i++;
      }
      out.push(`<ul>${buf.map((s) => `<li>${inline(s)}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (
        i < lines.length &&
        (/^\s*\d+\.\s+/.test(lines[i]) || (buf.length && /^\s{2,}/.test(lines[i])))
      ) {
        if (/^\s*\d+\.\s+/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        } else {
          buf.push(lines[i].trim());
        }
        i++;
      }
      out.push(`<ol>${buf.map((s) => `<li>${inline(s)}</li>`).join("")}</ol>`);
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-block lines
    const buf = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*---\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  return out.join("\n");
}

function inline(s) {
  let x = escapeHtml(s);
  // Inline code first to protect its content from other replacements.
  x = x.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Bold
  x = x.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  x = x.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // Italic
  x = x.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  x = x.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  // Links: [text](url)
  x = x.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const safeUrl = /^(https?:|mailto:|#|\/)/i.test(u) ? u : "#";
    return `<a href="${safeUrl}" target="_blank" rel="noreferrer noopener">${t}</a>`;
  });
  return x;
}

// Streamed-token friendly variant: callers feed chunks and we re-render.
// Returns HTML for the accumulated text so far.
export function renderStreamedMarkdown(src) {
  return renderMarkdown(src);
}
