import { eq } from "drizzle-orm";
import { CopyIcon, TrashIcon } from "lucide-react";
import { useSubmit } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { createApiKey, deleteApiKey, listOwnThemeKeys } from "~/.server/api-keys";
import { getUser, hashPassword, verifyPassword } from "~/.server/auth";
import { db, schema } from "~/.server/db";
import { formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "~/components/ui/item";
import { can } from "~/lib/roles";
import type { Route } from "./+types/profile";

export async function loader({ context }: Route.LoaderArgs) {
  const user = getUser(context);
  // Gli sviluppatori tema gestiscono qui le proprie key per la CLI (scope theme).
  const themeKeys = can(user, "themes.code") ? await listOwnThemeKeys(user.id) : null;
  return { user, themeKeys };
}

const profileSchema = z.object({ name: z.string().trim().min(1).max(255), email: z.email().trim().toLowerCase() });
const passwordSchema = z.object({ current: z.string(), password: z.string().min(8).max(200), confirm: z.string() });
const themeKeySchema = z.object({ name: z.string().trim().min(1).max(255) });

export async function action({ request, context }: Route.ActionArgs) {
  const user = getUser(context);
  const form = formToObject(await request.formData());
  return handleUserErrors(async () => {
    if (form.intent === "createThemeKey" || form.intent === "deleteThemeKey") {
      if (!can(user, "themes.code")) throw new UserError(t("errors.forbidden"), 403);
      if (form.intent === "deleteThemeKey") {
        if (!(await deleteApiKey(Number(form.id), user.id))) throw new UserError(t("apiKeys.notFound"), 404);
        return { message: t("apiKeys.revoked") };
      }
      const input = parse(themeKeySchema, form);
      return { key: await createApiKey(input.name, "theme", user.id) };
    }
    if (form.intent === "password") {
      const input = parse(passwordSchema, form);
      if (input.password !== input.confirm) throw new UserError(t("reset.mismatch"));
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
      if (!(await verifyPassword(input.current, row.passwordHash))) throw new UserError(t("profile.wrongPassword"));
      await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(input.password) })
        .where(eq(schema.users.id, user.id));
      return { message: t("profile.passwordChanged") };
    }
    const input = parse(profileSchema, form);
    const [taken] = await db.select().from(schema.users).where(eq(schema.users.email, input.email));
    if (taken && taken.id !== user.id) throw new UserError(t("users.emailTaken"));
    await db.update(schema.users).set(input).where(eq(schema.users.id, user.id));
    return { message: t("common.saved") };
  });
}

export default function Profile({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const { user, themeKeys } = loaderData;
  const newKey = (actionData && "key" in actionData ? actionData.key : null) ?? null;
  return (
    <>
      <PageHeader title={t("nav.profile")} />
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <SettingsCard title={t("profile.data")} intent="profile">
          <TextField name="name" label={t("users.name")} defaultValue={user.name} required />
          <TextField name="email" type="email" label={t("users.email")} defaultValue={user.email} required />
        </SettingsCard>
        <SettingsCard title={t("profile.changePassword")} intent="password">
          <TextField
            name="current"
            type="password"
            label={t("profile.currentPassword")}
            autoComplete="current-password"
            required
          />
          <TextField
            name="password"
            type="password"
            label={t("users.newPassword")}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <TextField
            name="confirm"
            type="password"
            label={t("users.confirmPassword")}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </SettingsCard>
        {themeKeys && <ThemeKeys keys={themeKeys} newKey={newKey} />}
      </div>
    </>
  );
}

type ThemeKey = NonNullable<Route.ComponentProps["loaderData"]["themeKeys"]>[number];

/** Key con scope theme per la CLI `np theme pull/push/watch`, gestite da chi le usa. */
function ThemeKeys({ keys, newKey }: { keys: ThemeKey[]; newKey: string | null }) {
  const submit = useSubmit();
  return (
    <div className="lg:col-span-2">
      <SettingsCard
        title={t("profile.themeKeys")}
        description={t("profile.themeKeysHelp")}
        intent="createThemeKey"
        submitLabel={t("apiKeys.create")}
      >
        {newKey && (
          <InputGroup>
            <InputGroupInput
              readOnly
              value={newKey}
              className="font-mono text-xs"
              aria-label={t("apiKeys.createdTitle")}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={t("common.copy")}
                onClick={() => navigator.clipboard.writeText(newKey).then(() => toast.success(t("common.copied")))}
              >
                <CopyIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )}
        {keys.map((key) => (
          <Item key={key.id} variant="outline" size="sm">
            <ItemContent>
              <ItemTitle>{key.name}</ItemTitle>
              <ItemDescription className="font-mono text-xs">
                np_{key.prefix}_… · {t("apiKeys.lastUsed")}:{" "}
                {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("it") : t("apiKeys.never")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("apiKeys.revoke")}
                onClick={() =>
                  confirm(t("apiKeys.confirmRevoke")) &&
                  submit({ intent: "deleteThemeKey", id: String(key.id) }, { method: "post" })
                }
              >
                <TrashIcon />
              </Button>
            </ItemActions>
          </Item>
        ))}
        <TextField name="name" label={t("apiKeys.name")} placeholder={t("profile.themeKeyPlaceholder")} required />
      </SettingsCard>
    </div>
  );
}
