import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

/** Origine separata del pannello (es. https://admin.esempio.it), facoltativa. */
function adminUrl() {
  const value = process.env.ADMIN_URL?.trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`ADMIN_URL non è un URL valido: ${value}`);
  }
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: required("SESSION_SECRET"),
  mediaDir: path.resolve(process.env.MEDIA_DIR ?? "./storage/media"),
  isProduction: process.env.NODE_ENV === "production",
  adminUrl: adminUrl(),
};
