import { ArrowLeftIcon, ExternalLinkIcon, GripVerticalIcon, LinkIcon, IndentIcon, OutdentIcon, PlusIcon, SaveIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { Form, Link, redirect, useNavigation, useSubmit } from "react-router";
import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { handleUserErrors, parse } from "~/.server/forms";
import { getSiteLanguages } from "~/.server/languages";
import { deleteMenu, getMenuWithItems, updateMenu } from "~/.server/menus";
import { getTreeOptions } from "~/.server/nodes";
import { db, schema } from "~/.server/db";
import { eq } from "drizzle-orm";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { useActionToast } from "~/admin/feedback";
import { IconLabel } from "~/admin/components/icon-label";
import { nodeIcon } from "~/admin/components/node-icon";
import { t } from "~/admin/i18n";
import { LanguageLabel } from "~/components/language-flag";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/edit";

export async function loader({ params, context }: Route.LoaderArgs) {
  requirePermission(context, "menus");
  const result = await getMenuWithItems(Number(params.id));
  if (!result) throw new Response("Menu non trovato", { status: 404 });
  const langs = await getSiteLanguages();
  const pages = await getTreeOptions(langs.defaultLang);
  // Anche gli elementi dei raccoglitori possono essere collegati.
  const items = await db.query.nodes.findMany({
    where: eq(schema.nodes.type, "item"),
    with: { translations: { columns: { lang: true, title: true, path: true } } },
    limit: 500,
  });
  const targets = [
    ...pages.map((p) => ({ id: p.id, label: p.label, type: p.type, path: p.path, depth: p.depth, langs: p.langs })),
    ...items.map((i) => {
      const tr = i.translations.find((x) => x.lang === langs.defaultLang) ?? i.translations[0];
      return { id: i.id, label: tr ? `${tr.title} (${tr.path})` : `#${i.id}`, type: i.type, path: tr?.path, depth: 0, langs: i.translations.map((x) => x.lang) };
    }),
  ];
  return { ...result, langs, targets };
}

const itemSchema = z.object({
  depth: z.number().int().min(0).max(5),
  nodeId: z.number().int().nullable(),
  url: z.string().trim().max(1000).nullable(),
  newTab: z.boolean(),
  labels: z.record(z.string(), z.string().max(255)),
});

const saveSchema = z.object({
  name: z.string().trim().min(1).max(255),
  location: z.string().max(64).optional(),
  items: z.string().transform((v) => JSON.parse(v) as unknown).pipe(z.array(itemSchema)),
});

export async function action({ request, params, context }: Route.ActionArgs) {
  requirePermission(context, "menus");
  const id = Number(params.id);
  const form = await request.formData();
  return handleUserErrors(async () => {
    if (form.get("intent") === "delete") {
      await deleteMenu(id);
      throw redirect("/admin/menus");
    }
    const input = parse(saveSchema, Object.fromEntries(form));
    await updateMenu(id, input);
    return { message: t("common.saved") };
  });
}

type EditorItem = {
  key: string;
  depth: number;
  kind: "node" | "url";
  nodeId: number | null;
  url: string;
  newTab: boolean;
  labels: Record<string, string>;
};

let keySeq = 0;
// Chiavi per le voci aggiunte nel browser (quelle iniziali usano l'indice, stabile tra server e client).
const newKey = () => `new-${++keySeq}`;

export default function EditMenu({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const { menu, langs, targets } = loaderData;
  const kinds = [
    { value: "node", label: <IconLabel icon={LinkIcon}>{t("menus.internal")}</IconLabel> },
    { value: "url", label: <IconLabel icon={ExternalLinkIcon}>{t("menus.external")}</IconLabel> },
  ];
  const targetItems = targets.map((target) => ({
    value: target.id,
    depth: target.depth,
    label: <IconLabel icon={nodeIcon(target.type, target.path)}>{target.label}</IconLabel>,
  }));
  const navigation = useNavigation();
  const submit = useSubmit();
  const [items, setItems] = useState<EditorItem[]>(() =>
    loaderData.items.map((item, index) => ({
      key: `item-${index}`,
      depth: item.depth,
      kind: item.nodeId ? "node" : "url",
      nodeId: item.nodeId,
      url: item.url ?? "",
      newTab: item.newTab,
      labels: item.labels,
    })),
  );
  const [dragKey, setDragKey] = useState<string | null>(null);

  const update = (key: string, patch: Partial<EditorItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const move = (from: number, to: number) =>
    setItems((list) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // La profondità non può superare quella della voce precedente + 1.
      return next.map((item, i) => ({ ...item, depth: i === 0 ? 0 : Math.min(item.depth, next[i - 1].depth + 1) }));
    });

  const indent = (index: number, delta: number) =>
    setItems((list) =>
      list.map((item, i) => {
        if (i !== index) return item;
        const max = i === 0 ? 0 : list[i - 1].depth + 1;
        return { ...item, depth: Math.max(0, Math.min(max, item.depth + delta)) };
      }),
    );

  const serialized = JSON.stringify(
    items.map((i) => ({
      depth: i.depth,
      nodeId: i.kind === "node" ? i.nodeId : null,
      url: i.kind === "url" ? i.url : null,
      newTab: i.newTab,
      labels: i.labels,
    })),
  );

  return (
    <Form method="post" className="flex flex-col gap-6">
      <input type="hidden" name="items" value={serialized} />
      <PageHeader
        title={menu.name}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link to="/admin/menus" />}>
              <ArrowLeftIcon data-icon="inline-start" />
              {t("common.back")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirm(t("menus.confirmDelete")) && submit({ intent: "delete" }, { method: "post" })}
            >
              <TrashIcon data-icon="inline-start" />
              {t("common.delete")}
            </Button>
            <Button type="submit" name="intent" value="save" disabled={navigation.state !== "idle"}>
              {navigation.state !== "idle" ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
              {t("common.save")}
            </Button>
          </>
        }
      />
      <Card>
        <CardContent>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <TextField name="name" label={t("menus.name")} defaultValue={menu.name} required />
            <TextField name="location" label={t("menus.location")} defaultValue={menu.location ?? ""} description={t("menus.locationHelp")} />
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("menus.items")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items.length === 0 && <p className="text-sm text-muted-foreground">{t("menus.noItems")}</p>}
          {items.map((item, index) => (
            <div
              key={item.key}
              draggable
              onDragStart={() => setDragKey(item.key)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = items.findIndex((i) => i.key === dragKey);
                if (from >= 0 && from !== index) move(from, index);
                setDragKey(null);
              }}
              className={cn("flex gap-2 rounded-lg border bg-card p-3", dragKey === item.key && "opacity-50")}
              style={{ marginLeft: item.depth * 32 }}
            >
              <GripVerticalIcon className="mt-2 size-4 shrink-0 cursor-grab text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
                  <Select
                    value={item.kind}
                    onValueChange={(kind) => kind && update(item.key, { kind: kind as EditorItem["kind"] })}
                    items={kinds}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {kinds.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {item.kind === "node" ? (
                    <Select
                      value={item.nodeId ?? null}
                      onValueChange={(nodeId) => update(item.key, { nodeId })}
                      items={targetItems}
                    >
                      <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder={t("menus.chooseContent")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {targetItems.map((o) => (
                            <SelectItem key={o.value} value={o.value} style={{ paddingLeft: `${0.375 + o.depth * 0.75}rem` }}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input placeholder="https://" value={item.url} onChange={(e) => update(item.key, { url: e.target.value })} />
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {langs.codes.map((code) => (
                    <Field key={code}>
                      <FieldLabel className="text-xs">
                        <LanguageLabel code={code} />
                      </FieldLabel>
                      <Input
                        placeholder={item.kind === "node" ? t("menus.labelFromTitle") : t("menus.labelRequired")}
                        value={item.labels[code] ?? ""}
                        onChange={(e) => update(item.key, { labels: { ...item.labels, [code]: e.target.value } })}
                      />
                    </Field>
                  ))}
                </div>
                <Field orientation="horizontal">
                  <Switch id={`tab-${item.key}`} checked={item.newTab} onCheckedChange={(checked) => update(item.key, { newTab: checked })} />
                  <FieldLabel htmlFor={`tab-${item.key}`}>{t("menus.newTab")}</FieldLabel>
                </Field>
              </div>
              <div className="flex flex-col gap-1">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => indent(index, -1)} disabled={item.depth === 0} aria-label={t("menus.outdent")}>
                  <OutdentIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => indent(index, 1)} disabled={index === 0} aria-label={t("menus.indent")}>
                  <IndentIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                  aria-label={t("common.remove")}
                >
                  <TrashIcon />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              setItems((list) => [...list, { key: newKey(), depth: 0, kind: "node", nodeId: null, url: "", newTab: false, labels: {} }])
            }
          >
            <PlusIcon data-icon="inline-start" />
            {t("menus.addItem")}
          </Button>
        </CardContent>
      </Card>
    </Form>
  );
}
