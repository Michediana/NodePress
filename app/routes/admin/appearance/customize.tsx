import { requirePermission } from "~/.server/auth";
import { getSiteLanguages } from "~/.server/languages";
import { getTreeOptions } from "~/.server/nodes";
import { getSetting } from "~/.server/settings";
import { bundleFor } from "~/.server/theme";
import { getBuild, listBuilds, readSources, requireTheme, samplePathForTemplate } from "~/.server/theme/store";
import { templateList } from "~/lib/theme/manifest";
import type { Route } from "./+types/customize";
import { VisualEditor } from "~/admin/visual-editor/visual-editor";

export async function loader({ params, context }: Route.LoaderArgs) {
  requirePermission(context, "themes");
  const theme = await requireTheme(params.name);
  if (!theme.draftBuildId)
    throw new Response("Il tema non ha ancora una build valida: correggilo nell'editor del codice.", { status: 409 });
  const [draft, sources, langs, active, builds] = await Promise.all([
    getBuild(theme.draftBuildId),
    readSources(theme.id),
    getSiteLanguages(),
    getSetting("activeTheme"),
    listBuilds(theme.id),
  ]);
  const data = draft!.data;

  // Sorgenti grezzi: l'editor modifica i file, non la build (che ha gli id già generati).
  const trees: Record<string, unknown> = {};
  for (const [file, content] of sources) {
    if (!/^(templates|groups)\/[^/]+\.json$/.test(file)) continue;
    try {
      trees[file] = JSON.parse(content.toString("utf8"));
    } catch {
      // JSON non valido: resta modificabile solo nell'editor del codice.
    }
  }
  let tokenValues: Record<string, string> = {};
  try {
    tokenValues = JSON.parse(sources.get("config/tokens.json")?.toString("utf8") ?? "{}");
  } catch {
    tokenValues = {};
  }

  const templates = await Promise.all(
    templateList(data.manifest).map(async (tpl) => {
      const file = `templates/${tpl.name}.json`;
      const editable = Boolean(data.trees[file] && trees[file]);
      // Gruppi inclusi dal template (tramite il layout o direttamente).
      const groups = editable
        ? Object.keys(bundleFor(data, file).trees).filter((key) => key.startsWith("groups/"))
        : [];
      const sample = await samplePathForTemplate(tpl.name, langs.defaultLang);
      return {
        name: tpl.name,
        label: tpl.label,
        file,
        editable,
        groups,
        path: sample ?? (tpl.kinds.includes("page") ? "/" : null),
      };
    }),
  );

  return {
    theme: {
      name: theme.name,
      label: theme.label,
      active: active === theme.name,
      unpublished: theme.draftBuildId !== theme.publishedBuildId,
      buildError: theme.buildError,
      publishedBuildId: theme.publishedBuildId,
    },
    templates,
    trees,
    tokens: data.manifest.tokens ?? {},
    tokenValues,
    customCss: sources.get("config/custom.css")?.toString("utf8") ?? "",
    schemas: data.schemas,
    languages: langs.codes,
    collections: (await getTreeOptions(langs.defaultLang))
      .filter((o) => o.type === "collection")
      .map((o) => ({ id: o.id, label: o.label })),
    builds: builds.filter((b) => b.publishedAt).map((b) => ({ id: b.id, publishedAt: b.publishedAt!.toISOString() })),
  };
}

export default function Customize({ loaderData }: Route.ComponentProps) {
  return <VisualEditor data={loaderData} />;
}
