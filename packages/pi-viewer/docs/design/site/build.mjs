#!/usr/bin/env node
// Render docs/design/DESIGN.md to docs/design/site/index.html.
//
// Self-contained on purpose: the design document is a documentation artifact for one
// operator, so a browser without a dev server must never be the only way to read it. Node
// built-ins plus the file system, no npm package, no bundler.
//
// Usage: node docs/design/site/build.mjs
// Output: docs/design/site/index.html (committed next to this script)

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = resolve(HERE, "..", "DESIGN.md");
const DIAGRAM = resolve(HERE, "architecture.svg");
const OUT = resolve(HERE, "index.html");

/* ---------------------------------------------------------------- markdown */

const escapeHtml = (text) =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

const slugify = (text) =>
	text
		.toLowerCase()
		.replace(/`/g, "")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-");

/** Inline spans: code first, so a token's own asterisks stay literal. */
const inline = (text) => {
	const holes = [];
	let out = text.replace(/`([^`]+)`/g, (_, code) => {
		holes.push(`<code>${escapeHtml(code)}</code>`);
		return `\u0000${holes.length - 1}\u0000`;
	});
	out = escapeHtml(out)
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)]|$)/g, "$1<em>$2</em>")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
	return out.replace(/\u0000(\d+)\u0000/g, (_, index) => holes[Number(index)]);
};

const splitRow = (line) =>
	line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());

/**
 * A cell that holds nothing but a colour gets a swatch, so a token table can be read by eye as
 * well as by value. Composited alphas (rgb(... / 0.1)) show as the colour over the page plane.
 */
const PURE_COLOUR = /^(#[0-9a-fA-F]{3,8}|rgb\([^)]*\)|hsl\([^)]*\))$/;
const colourCell = (cell) => {
	const value = cell.replace(/`/g, "").trim();
	return PURE_COLOUR.test(value) && !value.includes("var(") ? value : null;
};

/** A GFM pipe table: header row, delimiter row, body rows. */
const table = (lines) => {
	const [head, , ...body] = lines;
	const columns = splitRow(head);
	const align = splitRow(lines[1]).map((cell) =>
		/^:-+:$/.test(cell) ? "center" : /^-+:$/.test(cell) ? "right" : "",
	);
	const th = columns
		.map((cell, index) =>
			`<th${align[index] ? ` class="align-${align[index]}"` : ""}>${inline(cell)}</th>`,
		)
		.join("");
	const trs = body
		.map((row) => {
			const cells = splitRow(row);
			const tds = columns
				.map((_, index) => {
					const cell = cells[index] ?? "";
					const colour = colourCell(cell);
					const swatch = colour
						? `<span class="swatch" style="background:${escapeHtml(colour)}" aria-hidden="true"></span>`
						: "";
					return `<td${align[index] ? ` class="align-${align[index]}"` : ""}>${swatch}${inline(cell)}</td>`;
				})
				.join("");
			return `<tr>${tds}</tr>`;
		})
		.join("\n");
	return `<div class="scroll"><table><thead><tr>${th}</tr></thead><tbody>\n${trs}\n</tbody></table></div>`;
};

/** Ordered and unordered lists, one nesting level, which is all this document uses. */
const list = (lines) => {
	const ordered = /^\d+\.\s/.test(lines[0]);
	const items = [];
	for (const line of lines) {
		const nested = /^\s{2,}([-*]|\d+\.)\s+/.test(line);
		const text = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
		if (nested && items.length > 0) {
			items[items.length - 1].children.push(text);
			continue;
		}
		items.push({ text, children: [] });
	}
	const tag = ordered ? "ol" : "ul";
	const body = items
		.map((item) => {
			const nested = item.children.length
				? `\n${tag === "ol" ? "ol" : "ul"}>${item.children.length}</${tag}>`
				: "";
			return `<li>${inline(item.text)}${nested ? `<${tag}>${item.children.map((child) => `<li>${inline(child)}</li>`).join("")}</${tag}>` : ""}</li>`;
		})
		.join("\n");
	return `<${tag}>\n${body}\n</${tag}>`;
};

const render = (markdown, diagram) => {
	const lines = markdown.split("\n");
	const html = [];
	const toc = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];

		if (line.startsWith("```")) {
			const language = line.slice(3).trim();
			const body = [];
			index += 1;
			while (index < lines.length && !lines[index].startsWith("```")) {
				body.push(lines[index]);
				index += 1;
			}
			index += 1;
			html.push(
				`<div class="scroll"><pre${language ? ` data-lang="${escapeHtml(language)}"` : ""}><code>${escapeHtml(body.join("\n"))}</code></pre></div>`,
			);
			continue;
		}

		if (line.trim() === "<!-- diagram: architecture -->") {
			html.push(
				`<figure class="diagram"><div class="diagram-frame">${diagram}</div><figcaption>Data flow: tmux panes to the browser. The only write is the send endpoint into a pane.</figcaption></figure>`,
			);
			index += 1;
			continue;
		}

		if (line.startsWith("|")) {
			const block = [];
			while (index < lines.length && lines[index].startsWith("|")) {
				block.push(lines[index]);
				index += 1;
			}
			html.push(table(block));
			continue;
		}

		if (/^([-*]|\d+\.)\s/.test(line)) {
			const block = [];
			while (index < lines.length && (/^\s*([-*]|\d+\.)\s/.test(lines[index]) || lines[index].trim() === "")) {
				if (lines[index].trim() !== "") block.push(lines[index]);
				index += 1;
			}
			html.push(list(block));
			continue;
		}

		const heading = /^(#{1,4})\s+(.*)$/.exec(line);
		if (heading) {
			const level = heading[1].length;
			const text = heading[2].trim();
			index += 1;
			// The page header carries the title; the document's own h1 would repeat it.
			if (level === 1) continue;
			const slug = slugify(text);
			html.push(`<h${level} id="${slug}">${inline(text)}</h${level}>`);
			if (level === 2) toc.push({ slug, text: text.replace(/^\d+\.\s+/, "") });
			continue;
		}

		if (line.trim() === "") {
			index += 1;
			continue;
		}

		const paragraph = [];
		while (
			index < lines.length &&
			lines[index].trim() !== "" &&
			!lines[index].startsWith("#") &&
			!lines[index].startsWith("|") &&
			!lines[index].startsWith("```") &&
			!lines[index].startsWith("<!--") &&
			!/^([-*]|\d+\.)\s/.test(lines[index])
		) {
			paragraph.push(lines[index]);
			index += 1;
		}
		html.push(`<p>${inline(paragraph.join(" "))}</p>`);
	}

	return { body: html.join("\n\n"), toc };
};

/* ------------------------------------------------------------------- page */

const CSS = `
:root {
  --canvas: #f4f4f5;
  --surface: #ffffff;
  --raised: #ffffff;
  --control: #efeff1;
  --ink: #18181b;
  --muted: #5f5f68;
  --faint: #94949c;
  --border: rgb(15 15 20 / 0.11);
  --hair: rgb(15 15 20 / 0.07);
  --accent: #4f46e5;
  --accent-ink: #4338ca;
  --code-bg: #f4f4f5;
  --shadow: 0 10px 30px -12px rgb(15 15 20 / 0.22), 0 0 0 1px rgb(15 15 20 / 0.06);
}
[data-theme="dark"] {
  --canvas: #0d0d0d;
  --surface: #151515;
  --raised: #1e1e1e;
  --control: #262626;
  --ink: #ececef;
  --muted: #a0a0a8;
  --faint: #6a6a72;
  --border: rgb(255 255 255 / 0.12);
  --hair: rgb(255 255 255 / 0.08);
  --accent: #818cf8;
  --accent-ink: #a5b4fc;
  --code-bg: #1e1e1e;
  --shadow: 0 18px 44px -12px rgb(0 0 0 / 0.72), 0 0 0 1px rgb(255 255 255 / 0.08);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --canvas: #0d0d0d;
    --surface: #151515;
    --raised: #1e1e1e;
    --control: #262626;
    --ink: #ececef;
    --muted: #a0a0a8;
    --faint: #6a6a72;
    --border: rgb(255 255 255 / 0.12);
    --hair: rgb(255 255 255 / 0.08);
    --accent: #818cf8;
    --accent-ink: #a5b4fc;
    --code-bg: #1e1e1e;
    --shadow: 0 18px 44px -12px rgb(0 0 0 / 0.72), 0 0 0 1px rgb(255 255 255 / 0.08);
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font: 15px/1.65 "Figtree", system-ui, -apple-system, "Segoe UI", sans-serif;
  text-rendering: optimizeLegibility;
}
.wrap {
  max-width: 62rem;
  margin: 0 auto;
  padding: 40px 24px 96px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 32px;
}
.page { min-width: 0; }
header.doc { margin-bottom: 32px; }
.eyebrow {
  font: 500 11px/1 "Geist Mono", ui-monospace, SFMono-Regular, monospace;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 12px;
}
h1 { font-size: 30px; line-height: 1.2; letter-spacing: -0.015em; margin: 0 0 12px; font-weight: 600; }
.lede { font-size: 16px; line-height: 1.6; color: var(--muted); margin: 0 0 16px; max-width: 46rem; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font: 11px/1 "Geist Mono", monospace; color: var(--muted); }
.meta span { white-space: nowrap; }
h2 {
  font-size: 21px; line-height: 1.3; letter-spacing: -0.01em; font-weight: 600;
  margin: 48px 0 14px; padding-top: 20px; border-top: 1px solid var(--hair);
  scroll-margin-top: 16px;
}
h3 { font-size: 16px; line-height: 1.4; font-weight: 600; margin: 32px 0 10px; scroll-margin-top: 16px; }
h4 { font-size: 14px; font-weight: 600; margin: 24px 0 8px; color: var(--muted); }
p { margin: 0 0 14px; max-width: 46rem; }
a { color: var(--accent-ink); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
a:hover { border-bottom-color: var(--accent); }
code {
  font: 12px/1.5 "Geist Mono", ui-monospace, SFMono-Regular, monospace;
  background: var(--code-bg);
  border: 1px solid var(--hair);
  border-radius: 6px;
  padding: 1px 5px;
  color: var(--ink);
  overflow-wrap: break-word;
}
pre {
  margin: 0 0 16px; padding: 12px 14px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 10px;
}
pre code { background: none; border: 0; padding: 0; font-size: 12px; line-height: 1.6; white-space: pre; }
ul, ol { margin: 0 0 16px; padding-left: 20px; max-width: 46rem; }
li { margin: 0 0 6px; }
li > ul, li > ol { margin: 6px 0 0; }
strong { font-weight: 600; }
.scroll { overflow-x: auto; margin: 0 0 20px; border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; background: var(--surface); }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--hair); vertical-align: top; }
th { font-weight: 600; font-size: 12px; letter-spacing: 0.01em; color: var(--muted); background: var(--raised); white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
td code, th code { font-size: 11.5px; white-space: nowrap; overflow-wrap: normal; }
.swatch {
  display: inline-block; width: 11px; height: 11px; border-radius: 3px;
  margin-right: 6px; vertical-align: -1px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 22%, transparent);
}
.align-right { text-align: right; }
.align-center { text-align: center; }
figure.diagram { margin: 8px 0 28px; }
.diagram-frame {
  overflow-x: auto; background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px; box-shadow: var(--shadow);
}
.diagram-frame svg { display: block; min-width: 640px; height: auto; color: var(--faint); }
figcaption { font-size: 12px; color: var(--muted); margin-top: 8px; }
.diagram-frame .lane { fill: transparent; }
.diagram-frame .lane-bg { fill: var(--raised); stroke: var(--hair); }
.diagram-frame .node { fill: var(--surface); stroke: var(--border); }
.diagram-frame .api { fill: var(--ink); font: 500 12px "Geist Mono", monospace; }
.diagram-frame .node-label { fill: var(--ink); font: 500 12px "Figtree", sans-serif; }
.diagram-frame .note { fill: var(--muted); font: 11px "Geist Mono", monospace; }
.diagram-frame .lane-label { fill: var(--accent-ink); font: 500 10px "Geist Mono", monospace; letter-spacing: 0.06em; text-transform: uppercase; }
.diagram-frame .rule { stroke: var(--hair); }
.diagram-frame .edge { stroke: var(--border); stroke-width: 1.5; marker-end: url(#ar); }
.diagram-frame .write { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 3; fill: none; marker-end: url(#ar); }
nav.toc { margin: 0; }
nav.toc p.label {
  font: 500 10px/1 "Geist Mono", monospace; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--muted); margin: 0 0 10px;
}
nav.toc ol { list-style: none; padding: 0; margin: 0; counter-reset: toc; max-width: none; }
nav.toc li { margin: 0; counter-increment: toc; }
nav.toc a {
  display: block; padding: 5px 0 5px 28px; font-size: 12.5px; color: var(--muted);
  border: 0; border-left: 1px solid var(--hair); position: relative;
}
nav.toc a::before {
  content: counter(toc) "."; position: absolute; left: 6px;
  font: 11px "Geist Mono", monospace; color: var(--muted);
}
nav.toc a:hover { color: var(--ink); border-left-color: var(--accent); }
.theme-toggle {
  position: fixed; top: 12px; right: 12px; z-index: 10;
  font: 11px/1 "Geist Mono", monospace; color: var(--muted);
  background: var(--raised); border: 1px solid var(--border); border-radius: 8px;
  padding: 7px 10px; cursor: pointer;
}
.theme-toggle:hover { color: var(--ink); }
.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
footer.doc {
  margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--hair);
  font: 11px/1.6 "Geist Mono", monospace; color: var(--muted);
}
@media (min-width: 1000px) {
  .wrap { grid-template-columns: 200px minmax(0, 1fr); align-items: start; padding: 48px 32px 112px; }
  nav.toc { position: sticky; top: 24px; }
}
@media (max-width: 480px) {
  body { font-size: 14px; }
  .wrap { padding: 32px 16px 72px; gap: 24px; }
  h1 { font-size: 24px; }
  h2 { font-size: 19px; }
  .theme-toggle { top: 8px; right: 8px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

const THEME_SCRIPT = `
(function () {
  var key = "pi-viewer-design-theme";
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem(key); } catch (error) { stored = null; }
  if (stored === "dark" || stored === "light") root.dataset.theme = stored;
  var button = document.querySelector(".theme-toggle");
  function current() {
    if (root.dataset.theme === "dark" || root.dataset.theme === "light") return root.dataset.theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function paint() { button.textContent = current() === "dark" ? "Light" : "Dark"; }
  button.addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem(key, next); } catch (error) {}
    paint();
  });
  paint();
})();
`;

const main = async () => {
	const [markdown, diagram] = await Promise.all([
		readFile(DESIGN, "utf8"),
		readFile(DIAGRAM, "utf8"),
	]);
	const { body, toc } = render(markdown, diagram.trim());

	const tocHtml = toc
		.map((entry) => `<li><a href="#${entry.slug}">${escapeHtml(entry.text.replace(/`/g, ""))}</a></li>`)
		.join("\n");

	const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pi viewer — design document</title>
<meta name="description" content="The design document of the pi viewer: purpose, principles, palettes, tokens, components, states, performance and decisions.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
</head>
<body>
<button class="theme-toggle" type="button" aria-label="Switch colour theme">Dark</button>
<div class="wrap">
<nav class="toc" aria-label="Contents">
<p class="label">Contents</p>
<ol>
${tocHtml}
</ol>
</nav>
<main class="page">
<header class="doc">
<p class="eyebrow">pi viewer · design document</p>
<h1>pi viewer — design document</h1>
<p class="lede">How the viewer looks, how it is built, and why each rule exists. Every claim cites the file that carries it.</p>
<p class="meta"><span>version 2</span><span>2026-11-26</span><span>5 palettes</span><span>12 sections</span></p>
</header>
${body}
<footer class="doc">Rendered from docs/design/DESIGN.md by docs/design/site/build.mjs · no build dependency</footer>
</main>
</div>
<script>${THEME_SCRIPT}</script>
</body>
</html>
`;

	await writeFile(OUT, page, "utf8");
	console.log(`wrote ${OUT} (${page.length} bytes, ${toc.length} sections)`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
