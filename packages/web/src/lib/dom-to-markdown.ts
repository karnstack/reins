/* Serializes rendered docs prose back to markdown for "Copy as Markdown".
   Covers the elements the docs pages actually use (headings, paragraphs,
   lists, tables, code, blockquotes); anything unknown falls back to its
   inline text. */

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function escapeCell(text: string): string {
  return collapse(text).replace(/\|/g, "\\|");
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const kids = () => Array.from(node.childNodes).map(inline).join("");
  switch (node.tagName) {
    case "BUTTON":
      return "";
    case "CODE":
      return `\`${node.textContent ?? ""}\``;
    case "STRONG":
    case "B":
      return `**${kids()}**`;
    case "EM":
    case "I":
      return `*${kids()}*`;
    case "A": {
      const href = node.getAttribute("href") ?? "";
      const abs = /^[a-z]+:/.test(href) ? href : new URL(href, window.location.origin).href;
      return `[${kids()}](${abs})`;
    }
    case "BR":
      return "\n";
    default:
      return kids();
  }
}

function inlineOf(el: Element): string {
  return collapse(Array.from(el.childNodes).map(inline).join(""));
}

function listToMd(el: Element, ordered: boolean, indent: string): string {
  const items: string[] = [];
  let n = 1;
  for (const li of el.children) {
    if (li.tagName !== "LI") continue;
    const marker = ordered ? `${n}.` : "-";
    n += 1;
    const own: Node[] = [];
    const nested: Element[] = [];
    for (const child of li.childNodes) {
      if (child instanceof Element && (child.tagName === "UL" || child.tagName === "OL")) {
        nested.push(child);
      } else {
        own.push(child);
      }
    }
    items.push(`${indent}${marker} ${collapse(own.map(inline).join(""))}`);
    for (const sub of nested) {
      items.push(listToMd(sub, sub.tagName === "OL", `${indent}  `));
    }
  }
  return items.join("\n");
}

function tableToMd(el: Element): string {
  const rows = Array.from(el.querySelectorAll("tr"));
  if (rows.length === 0) return "";
  const cellsOf = (tr: Element) =>
    Array.from(tr.children)
      .filter((c) => c.tagName === "TH" || c.tagName === "TD")
      .map((c) => escapeCell(inlineOf(c)));
  const [head, ...body] = rows;
  if (!head) return "";
  const headCells = cellsOf(head);
  const lines = [
    `| ${headCells.join(" | ")} |`,
    `| ${headCells.map(() => "---").join(" | ")} |`,
    ...body.map((tr) => `| ${cellsOf(tr).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function blockToMd(el: Element): string {
  if (!(el instanceof HTMLElement)) return "";
  switch (el.tagName) {
    case "H1":
      return `# ${inlineOf(el)}`;
    case "H2":
      return `## ${inlineOf(el)}`;
    case "H3":
      return `### ${inlineOf(el)}`;
    case "H4":
      return `#### ${inlineOf(el)}`;
    case "P":
      return inlineOf(el);
    case "PRE":
      return `\`\`\`\n${(el.innerText ?? "").replace(/\n$/, "")}\n\`\`\``;
    case "UL":
      return listToMd(el, false, "");
    case "OL":
      return listToMd(el, true, "");
    case "TABLE":
      return tableToMd(el);
    case "BLOCKQUOTE":
      return Array.from(el.children)
        .map((c) => `> ${blockToMd(c)}`)
        .join("\n>\n");
    case "HR":
      return "---";
    case "BUTTON":
    case "NAV":
      return "";
    default: {
      // Containers (div/section/figure): a wrapped code block serializes as
      // its <pre>; anything else recurses into block children.
      const pre = el.querySelector(":scope > pre, :scope > div > pre");
      if (pre) return blockToMd(pre);
      if (el.children.length > 0) {
        return Array.from(el.children).map(blockToMd).filter(Boolean).join("\n\n");
      }
      return inlineOf(el);
    }
  }
}

export function domToMarkdown(root: HTMLElement): string {
  const blocks = Array.from(root.children).map(blockToMd).filter(Boolean);
  return `${blocks.join("\n\n")}\n`;
}
