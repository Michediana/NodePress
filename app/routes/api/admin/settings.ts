import { z } from "zod";
import { authenticate, handle, methodNotAllowed, readJson } from "~/.server/api";
import { getAllSettings, setSettings } from "~/.server/settings";
import type { Route } from "./+types/settings";

const patchSchema = z
  .object({
    siteName: z.string().min(1).max(255),
    siteUrl: z.string().max(255),
    publicApi: z.boolean(),
    mediaFormat: z.enum(["webp", "avif"]),
    mediaQuality: z.number().int().min(1).max(100),
    mediaMaxSize: z.number().int().min(320).max(10000),
    robotsTxt: z.string().nullable(),
    llmsTxt: z.string().nullable(),
    ga4Id: z.string().max(64),
    gtmId: z.string().max(64),
    clarityId: z.string().max(64),
    smtp: z.object({
      host: z.string(),
      port: z.number().int(),
      secure: z.boolean(),
      user: z.string(),
      pass: z.string(),
      from: z.string(),
    }),
    consentTexts: z.record(z.string(), z.object({ title: z.string(), text: z.string(), accept: z.string(), reject: z.string() })),
  })
  .partial();

async function current() {
  const settings = await getAllSettings();
  return { ...settings, smtp: { ...settings.smtp, pass: settings.smtp.pass ? "********" : "" } };
}

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    return current();
  });

export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "PATCH") methodNotAllowed();
    await authenticate(request, "admin");
    const input = await readJson(request, patchSchema);
    if (input.smtp?.pass === "********") input.smtp.pass = (await getAllSettings()).smtp.pass;
    await setSettings(input);
    return current();
  });
