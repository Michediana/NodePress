import { and, asc, eq, inArray } from "drizzle-orm";
import { localizedUrl } from "~/lib/languages";
import { db, schema } from "./db";
import { UserError } from "./forms";
import { visibleTranslation } from "./nodes";

const { menus, menuItems, menuItemTranslations, nodeTranslations: tr } = schema;

/** Voce di menu come la gestisce l'editor (struttura piatta con profondità). */
export type MenuItemInput = {
  depth: number;
  nodeId: number | null;
  url: string | null;
  newTab: boolean;
  labels: Record<string, string>;
};

export type FrontMenuItem = { label: string; href: string; newTab: boolean; external: boolean; children: FrontMenuItem[] };

export async function listMenus() {
  return db.select().from(menus).orderBy(asc(menus.name));
}

export async function getMenuWithItems(id: number) {
  const menu = await db.query.menus.findFirst({ where: eq(menus.id, id) });
  if (!menu) return null;
  const items = await db.query.menuItems.findMany({
    where: eq(menuItems.menuId, id),
    with: { translations: true },
    orderBy: [asc(menuItems.sortOrder)],
  });
  // Converte l'albero in lista piatta con profondità (ordine di visita).
  const flat: (MenuItemInput & { id: number })[] = [];
  const visit = (parentId: number | null, depth: number) => {
    for (const item of items.filter((i) => i.parentId === parentId)) {
      flat.push({
        id: item.id,
        depth,
        nodeId: item.nodeId,
        url: item.url,
        newTab: item.newTab,
        labels: Object.fromEntries(item.translations.map((x) => [x.lang, x.label])),
      });
      visit(item.id, depth + 1);
    }
  };
  visit(null, 0);
  return { menu, items: flat };
}

function normalizeLocation(location: string | null | undefined) {
  const value = (location ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return value || null;
}

export async function createMenu(name: string, location?: string | null) {
  const loc = normalizeLocation(location);
  if (loc && (await db.select().from(menus).where(eq(menus.location, loc))).length) {
    throw new UserError(`La posizione "${loc}" è già assegnata a un altro menu.`);
  }
  const [result] = await db.insert(menus).values({ name: name.trim(), location: loc });
  return result.insertId;
}

export async function updateMenu(id: number, data: { name: string; location?: string | null; items?: MenuItemInput[] }) {
  const loc = normalizeLocation(data.location);
  await db.transaction(async (tx) => {
    if (loc) {
      const [other] = await tx.select().from(menus).where(eq(menus.location, loc));
      if (other && other.id !== id) throw new UserError(`La posizione "${loc}" è già assegnata a un altro menu.`);
    }
    await tx.update(menus).set({ name: data.name.trim(), location: loc }).where(eq(menus.id, id));
    if (!data.items) return;
    await tx.delete(menuItems).where(eq(menuItems.menuId, id));
    const parents: number[] = [];
    for (const [index, item] of data.items.entries()) {
      if (!item.nodeId && !item.url) throw new UserError("Ogni voce deve puntare a un contenuto o a un URL.");
      const depth = Math.min(item.depth, parents.length);
      const [result] = await tx.insert(menuItems).values({
        menuId: id,
        parentId: depth > 0 ? parents[depth - 1] : null,
        sortOrder: index,
        nodeId: item.nodeId,
        url: item.nodeId ? null : item.url,
        newTab: item.newTab,
      });
      parents.length = depth;
      parents.push(result.insertId);
      const labels = Object.entries(item.labels).filter(([, label]) => label.trim());
      if (labels.length) {
        await tx.insert(menuItemTranslations).values(labels.map(([lang, label]) => ({ itemId: result.insertId, lang, label: label.trim() })));
      }
    }
  });
}

export async function deleteMenu(id: number) {
  await db.delete(menus).where(eq(menus.id, id));
}

/** Menu risolto per il front in una lingua; omette le voci senza traduzione. */
export async function getFrontMenu(where: { location: string } | { id: number }, lang: string, defaultLang: string) {
  const menu = await db.query.menus.findFirst({
    where: "location" in where ? eq(menus.location, where.location) : eq(menus.id, where.id),
  });
  if (!menu) return null;
  const items = await db.query.menuItems.findMany({
    where: eq(menuItems.menuId, menu.id),
    with: { translations: true },
    orderBy: [asc(menuItems.sortOrder)],
  });
  const nodeIds = items.map((i) => i.nodeId).filter((id): id is number => id !== null);
  const targets = nodeIds.length
    ? await db
        .select({ nodeId: tr.nodeId, path: tr.path, title: tr.title })
        .from(tr)
        .where(and(inArray(tr.nodeId, nodeIds), eq(tr.lang, lang), visibleTranslation()))
    : [];
  const build = (parentId: number | null): FrontMenuItem[] =>
    items
      .filter((i) => i.parentId === parentId)
      .flatMap((item) => {
        const label = item.translations.find((x) => x.lang === lang)?.label;
        if (item.nodeId) {
          const target = targets.find((x) => x.nodeId === item.nodeId);
          if (!target) return [];
          return [{ label: label || target.title, href: localizedUrl(target.path, lang, defaultLang), newTab: item.newTab, external: false, children: build(item.id) }];
        }
        if (!label || !item.url) return [];
        return [{ label, href: item.url, newTab: item.newTab, external: /^https?:\/\//.test(item.url), children: build(item.id) }];
      });
  return { name: menu.name, location: menu.location, items: build(null) };
}

/** Tutti i menu con posizione, risolti per una lingua. */
export async function getFrontMenus(lang: string, defaultLang: string) {
  const all = await db.select().from(menus);
  const result: Record<string, FrontMenuItem[]> = {};
  for (const menu of all) {
    if (!menu.location) continue;
    const resolved = await getFrontMenu({ id: menu.id }, lang, defaultLang);
    if (resolved) result[menu.location] = resolved.items;
  }
  return result;
}
