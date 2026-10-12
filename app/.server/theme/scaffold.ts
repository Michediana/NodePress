import type { ThemeSources } from "./build";

/** Sorgenti minimi di un tema nuovo: un template per tipo e un foglio di stile. */
export function scaffoldTheme(name: string, label: string): ThemeSources {
  const manifest = {
    name,
    label,
    version: "0.1.0",
    templates: {
      default: { label: "Pagina", kinds: ["page", "item"] },
      listing: { label: "Elenco", kinds: ["listing"] },
    },
    tokens: {
      "color-bg": { type: "color", label: "Sfondo", default: "#ffffff" },
      "color-ink": { type: "color", label: "Testo", default: "#111111" },
      "font-sans": { type: "font", label: "Font", default: "system-ui, sans-serif" },
    },
  };
  const files: Record<string, string> = {
    "theme.json": JSON.stringify(manifest, null, 2) + "\n",
    "components/Layout.np": `<header class="site-header">
  <Link to={homeUrl()}>{site.siteName}</Link>
</header>
<main>{children}</main>
`,
    "templates/default.np": `<Layout>
  <h1>{page.translation.title}</h1>
  <Content />
</Layout>
`,
    "templates/listing.np": `<Layout>
  <h1>{page.translation.title}</h1>
  <ul>
    {page.listing.items.map(item => (
      <li><Link to={item.url}>{item.title}</Link></li>
    ))}
  </ul>
</Layout>
`,
    "styles/main.css": `body {
  background: var(--np-color-bg);
  color: var(--np-color-ink);
  font-family: var(--np-font-sans);
}
`,
  };
  return new Map(Object.entries(files).map(([path, content]) => [path, Buffer.from(content)]));
}
