import { docToText, walkDoc, type ContentDoc } from "./content";

export type SeoCheckResult = "good" | "ok" | "bad";

export type SeoCheck = { id: string; result: SeoCheckResult; params?: Record<string, string | number> };

export type SeoInput = {
  title: string;
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  slug: string;
  content: ContentDoc | null;
  /** Testo alternativo dei media usati nel contenuto, per id. */
  mediaAlt?: Record<number, string | undefined>;
};

const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function countOccurrences(text: string, keyword: string) {
  if (!keyword) return 0;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "gu")) ?? []).length;
}

/** Analisi SEO in stile Yoast: restituisce i controlli e un punteggio 0–100. */
export function analyzeSeo(input: SeoInput) {
  const checks: SeoCheck[] = [];
  const keyword = normalize(input.focusKeyword.trim());
  const title = input.seoTitle.trim() || input.title.trim();
  const text = normalize(docToText(input.content));
  const words = text.split(/\s+/).filter(Boolean).length;

  let firstParagraph = "";
  let headings = 0;
  let images = 0;
  let imagesWithoutAlt = 0;
  let internalLinks = 0;
  let externalLinks = 0;
  walkDoc(input.content, (node) => {
    if (!firstParagraph && node.type === "paragraph") firstParagraph = normalize(docToText(node));
    if (node.type === "heading") headings++;
    if (node.type === "image") {
      images++;
      const alt = (node.attrs?.alt as string) || input.mediaAlt?.[node.attrs?.mediaId as number];
      if (!alt) imagesWithoutAlt++;
    }
    if (node.type === "gallery") images += ((node.attrs?.images as unknown[]) ?? []).length;
    for (const mark of node.marks ?? []) {
      if (mark.type !== "link") continue;
      const href = String(mark.attrs?.href ?? "");
      if (/^https?:\/\//.test(href)) externalLinks++;
      else internalLinks++;
    }
  });

  if (!keyword) {
    checks.push({ id: "keywordMissing", result: "bad" });
  } else {
    checks.push({ id: "keywordInTitle", result: normalize(title).includes(keyword) ? "good" : "bad" });
    checks.push({ id: "keywordInDescription", result: normalize(input.seoDescription).includes(keyword) ? "good" : "bad" });
    const slugKeyword = keyword.replace(/[^a-z0-9]+/g, "-");
    checks.push({ id: "keywordInSlug", result: input.slug.includes(slugKeyword) ? "good" : "ok" });
    checks.push({ id: "keywordInIntro", result: firstParagraph.includes(keyword) ? "good" : "ok" });
    const occurrences = countOccurrences(text, keyword);
    const density = words ? (occurrences * keyword.split(/\s+/).length * 100) / words : 0;
    const densityResult: SeoCheckResult = density >= 0.5 && density <= 3 ? "good" : density > 0 && density < 4 ? "ok" : "bad";
    checks.push({ id: "keywordDensity", result: densityResult, params: { density: density.toFixed(1), count: occurrences } });
  }

  const titleLength = title.length;
  checks.push({
    id: "titleLength",
    result: titleLength >= 30 && titleLength <= 60 ? "good" : titleLength > 0 && titleLength <= 70 ? "ok" : "bad",
    params: { length: titleLength },
  });
  const descLength = input.seoDescription.trim().length;
  checks.push({
    id: "descriptionLength",
    result: descLength >= 120 && descLength <= 160 ? "good" : descLength >= 50 && descLength <= 200 ? "ok" : "bad",
    params: { length: descLength },
  });
  checks.push({ id: "contentLength", result: words >= 300 ? "good" : words >= 150 ? "ok" : "bad", params: { words } });
  checks.push({ id: "subheadings", result: headings > 0 || words < 300 ? "good" : "ok" });
  if (images === 0) checks.push({ id: "images", result: "ok" });
  else checks.push({ id: "imageAlt", result: imagesWithoutAlt === 0 ? "good" : "ok", params: { count: imagesWithoutAlt } });
  checks.push({ id: "internalLinks", result: internalLinks > 0 ? "good" : "ok" });
  checks.push({ id: "externalLinks", result: externalLinks > 0 ? "good" : "ok" });

  const points = checks.reduce((sum, c) => sum + (c.result === "good" ? 2 : c.result === "ok" ? 1 : 0), 0);
  const score = Math.round((points / (checks.length * 2)) * 100);
  const rating: SeoCheckResult = score >= 70 ? "good" : score >= 40 ? "ok" : "bad";
  return { score, rating, checks };
}
