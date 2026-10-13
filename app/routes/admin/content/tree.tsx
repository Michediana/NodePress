import { ArrowDownIcon, ArrowUpIcon, FilePlusIcon, FolderIcon, ListIcon, MoreHorizontalIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Link, useSubmit } from "react-router";
import { getUser } from "~/.server/auth";
import { handleUserErrors, UserError } from "~/.server/forms";
import { getSiteLanguages } from "~/.server/languages";
import { canEditNode, deleteNode, getNodeForUser, getTree, moveNode, type TreeNode } from "~/.server/nodes";
import { nodeIcon } from "~/admin/components/node-icon";
import { PageHeader } from "~/admin/components/page-header";
import { TranslationBadges } from "~/admin/components/translation-badges";
import { useActionToast } from "~/admin/feedback";
import { confirmDialog } from "~/admin/components/dialogs";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { can } from "~/lib/roles";
import type { Route } from "./+types/tree";

export async function loader({ context }: Route.LoaderArgs) {
  const user = getUser(context);
  const [tree, langs] = await Promise.all([getTree(), getSiteLanguages()]);
  const mark = (list: TreeNode[]): (TreeNode & { editable: boolean })[] =>
    list.map((n) => ({ ...n, editable: canEditNode(user, n), children: mark(n.children) }));
  return { tree: mark(tree), langs, canManage: can(user.role, "content.any") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = getUser(context);
  const form = await request.formData();
  const id = Number(form.get("id"));
  return handleUserErrors(async () => {
    await getNodeForUser(user, id);
    const intent = form.get("intent");
    if (intent === "up" || intent === "down") {
      if (!can(user.role, "content.any")) throw new UserError(t("errors.forbidden"), 403);
      await moveNode(id, intent);
      return { ok: true };
    }
    if (intent === "delete") {
      await deleteNode(id);
      return { message: t("content.deleted") };
    }
    throw new UserError("Azione non valida.");
  });
}

type Row = TreeNode & { editable: boolean; children: Row[] };

function TreeRow({ node, depth, langs, canManage, isFirst, isLast }: { node: Row; depth: number; langs: { codes: string[]; defaultLang: string }; canManage: boolean; isFirst: boolean; isLast: boolean }) {
  const submit = useSubmit();
  const main = node.translations.find((x) => x.lang === langs.defaultLang) ?? node.translations[0];
  const Icon = nodeIcon(node.type, main?.path);
  const act = (intent: string) => submit({ id: String(node.id), intent }, { method: "post" });
  return (
    <>
      <div className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50">
        <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: depth * 24 }}>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col">
            {node.editable ? (
              <Link to={`/admin/content/${node.id}`} className="truncate font-medium hover:underline">
                {main?.title ?? t("content.untitled")}
              </Link>
            ) : (
              <span className="truncate font-medium">{main?.title ?? t("content.untitled")}</span>
            )}
            <span className="truncate text-xs text-muted-foreground">{main?.path ?? "—"}</span>
          </div>
          {node.type === "collection" && (
            <Badge variant="secondary" render={<Link to={`/admin/content/${node.id}/items`} />}>
              <ListIcon data-icon="inline-start" />
              {t("content.itemsCount", { count: node.itemCount })}
            </Badge>
          )}
        </div>
        <TranslationBadges nodeId={node.id} langs={langs.codes} translations={node.translations} />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("common.actions")} />}>
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {node.type === "page" && (
                <DropdownMenuItem render={<Link to={`/admin/content/new?parent=${node.id}`} />}>
                  <PlusIcon />
                  {t("content.addChild")}
                </DropdownMenuItem>
              )}
              {node.type === "collection" && (
                <DropdownMenuItem render={<Link to={`/admin/content/new?type=item&parent=${node.id}`} />}>
                  <PlusIcon />
                  {t("content.addItem")}
                </DropdownMenuItem>
              )}
              {canManage && (
                <>
                  <DropdownMenuItem disabled={isFirst} onClick={() => act("up")}>
                    <ArrowUpIcon />
                    {t("common.moveUp")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isLast} onClick={() => act("down")}>
                    <ArrowDownIcon />
                    {t("common.moveDown")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuGroup>
            {node.editable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={async () => {
                      if (await confirmDialog({ description: t("content.confirmDelete"), confirmLabel: t("common.delete"), destructive: true }))
                        act("delete");
                    }}
                  >
                    <TrashIcon />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {node.children.map((child, i) => (
        <TreeRow key={child.id} node={child as Row} depth={depth + 1} langs={langs} canManage={canManage} isFirst={i === 0} isLast={i === node.children.length - 1} />
      ))}
    </>
  );
}

export default function ContentTree({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const { tree, langs, canManage } = loaderData;
  return (
    <>
      <PageHeader
        title={t("nav.content")}
        description={t("content.treeDescription")}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link to="/admin/content/new?type=collection" />}>
              <FolderIcon data-icon="inline-start" />
              {t("content.newCollection")}
            </Button>
            <Button nativeButton={false} render={<Link to="/admin/content/new" />}>
              <FilePlusIcon data-icon="inline-start" />
              {t("content.newPage")}
            </Button>
          </>
        }
      />
      {tree.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("content.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("content.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link to="/admin/content/new" />}>
              <FilePlusIcon data-icon="inline-start" />
              {t("content.newPage")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            {tree.map((node, i) => (
              <TreeRow key={node.id} node={node as Row} depth={0} langs={langs} canManage={canManage} isFirst={i === 0} isLast={i === tree.length - 1} />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
