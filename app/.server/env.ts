import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: required("SESSION_SECRET"),
  mediaDir: path.resolve(process.env.MEDIA_DIR ?? "./storage/media"),
  isProduction: process.env.NODE_ENV === "production",
};
