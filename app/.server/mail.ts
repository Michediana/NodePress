import nodemailer from "nodemailer";
import { getSettings } from "./settings";

export async function isMailConfigured() {
  const { smtp } = await getSettings(["smtp"]);
  return Boolean(smtp.host && smtp.from);
}

export async function sendMail(message: { to: string; subject: string; text: string; html?: string }) {
  const { smtp, siteName } = await getSettings(["smtp", "siteName"]);
  if (!smtp.host || !smtp.from) throw new Error("SMTP non configurato.");
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  await transport.sendMail({ from: `"${siteName}" <${smtp.from}>`, ...message });
}
