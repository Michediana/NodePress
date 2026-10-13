import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { ImageIcon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { embedSrc } from "~/lib/embed";
import { mediaUrl, type MediaRef } from "~/lib/media";
import { cn } from "~/lib/utils";
import { MediaPicker } from "./media-picker";
import { SectionSettingsForm, type CollectionOption } from "~/admin/components/section-settings";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import type { SectionSchema } from "~/lib/theme/sections";

export type GalleryImage = { mediaId: number; src: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    npBlocks: {
      insertImage: (attrs: { mediaId: number; src: string }) => ReturnType;
      insertGallery: (images: GalleryImage[]) => ReturnType;
      insertEmbed: (url?: string) => ReturnType;
      insertHtml: (html?: string) => ReturnType;
      insertSection: (type: string) => ReturnType;
    };
  }
}

function BlockFrame({
  selected,
  label,
  onDelete,
  children,
}: {
  selected: boolean;
  label: string;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  return (
    <NodeViewWrapper
      className={cn("not-prose my-4 rounded-lg border bg-card p-3", selected && "ring-2 ring-ring")}
      contentEditable={false}
      data-drag-handle
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        <Button type="button" variant="ghost" size="icon-xs" onClick={onDelete} aria-label={t("common.delete")}>
          <TrashIcon />
        </Button>
      </div>
      {children}
    </NodeViewWrapper>
  );
}

// --- Immagine ---

function ImageView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const [picker, setPicker] = useState(false);
  const { src, alt, caption } = node.attrs as { src: string; alt: string; caption: string };
  return (
    <BlockFrame selected={selected} label={t("editor.image")} onDelete={deleteNode}>
      <div className="flex flex-col gap-2">
        {src ? (
          <img src={src} alt={alt} className="max-h-80 w-auto self-center rounded-md" />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-md bg-muted">
            <ImageIcon className="text-muted-foreground" />
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder={t("editor.caption")}
            value={caption ?? ""}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
          />
          <Input
            placeholder={t("editor.altOverride")}
            value={alt ?? ""}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
          />
        </div>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setPicker(true)}>
          <ImageIcon data-icon="inline-start" />
          {t("editor.replaceImage")}
        </Button>
      </div>
      <MediaPicker
        open={picker}
        onOpenChange={setPicker}
        onSelect={([m]) => m && updateAttributes({ mediaId: m.id, src: mediaUrl(m.file) })}
      />
    </BlockFrame>
  );
}

export const ImageBlock = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      mediaId: { default: null },
      src: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
    };
  },
  parseHTML() {
    return [
      { tag: "figure[data-type=image]" },
      {
        tag: "img[src]",
        getAttrs: (el) => ({
          src: (el as HTMLElement).getAttribute("src"),
          alt: (el as HTMLElement).getAttribute("alt") ?? "",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      { "data-type": "image" },
      ["img", mergeAttributes({ src: HTMLAttributes.src, alt: HTMLAttributes.alt })],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  addCommands() {
    return {
      insertImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

// --- Galleria ---

function GalleryView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const [picker, setPicker] = useState(false);
  const images = (node.attrs.images ?? []) as GalleryImage[];
  const add = (media: MediaRef[]) =>
    updateAttributes({ images: [...images, ...media.map((m) => ({ mediaId: m.id, src: mediaUrl(m.file) }))] });
  return (
    <BlockFrame selected={selected} label={t("editor.gallery")} onDelete={deleteNode}>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {images.map((img, index) => (
          <div key={`${img.mediaId}-${index}`} className="relative">
            <img src={img.src} alt="" className="aspect-square w-full rounded-md object-cover" />
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              className="absolute top-1 right-1"
              aria-label={t("common.remove")}
              onClick={() => updateAttributes({ images: images.filter((_, i) => i !== index) })}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="flex aspect-square items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-muted"
          aria-label={t("editor.addImages")}
        >
          <PlusIcon />
        </button>
      </div>
      <MediaPicker open={picker} onOpenChange={setPicker} multiple onSelect={add} />
    </BlockFrame>
  );
}

export const GalleryBlock = Node.create({
  name: "gallery",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { images: { default: [] } };
  },
  parseHTML() {
    return [{ tag: "div[data-type=gallery]" }];
  },
  renderHTML() {
    return ["div", { "data-type": "gallery" }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(GalleryView);
  },
  addCommands() {
    return {
      insertGallery:
        (images) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { images } }),
    };
  },
});

// --- Embed ---

function EmbedView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const url = (node.attrs.url as string) ?? "";
  const src = url ? embedSrc(url) : null;
  return (
    <BlockFrame selected={selected} label={t("editor.embed")} onDelete={deleteNode}>
      <div className="flex flex-col gap-2">
        <Input
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => updateAttributes({ url: e.target.value })}
        />
        {url && (
          <p className="text-xs text-muted-foreground">{src ? t("editor.embedSupported") : t("editor.embedLink")}</p>
        )}
        {src && <iframe src={src} className="aspect-video w-full rounded-md" title="embed" allowFullScreen />}
      </div>
    </BlockFrame>
  );
}

export const EmbedBlock = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-type=embed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "embed", "data-url": HTMLAttributes.url }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
  addCommands() {
    return {
      insertEmbed:
        (url = "") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { url } }),
    };
  },
});

// --- HTML libero ---

function HtmlView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  return (
    <BlockFrame selected={selected} label={t("editor.html")} onDelete={deleteNode}>
      <Textarea
        className="font-mono text-xs"
        rows={6}
        placeholder="<div>…</div>"
        value={(node.attrs.html as string) ?? ""}
        onChange={(e) => updateAttributes({ html: e.target.value })}
      />
    </BlockFrame>
  );
}

export const HtmlBlock = Node.create({
  name: "html",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { html: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-type=html]" }];
  },
  renderHTML() {
    return ["div", { "data-type": "html" }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(HtmlView);
  },
  addCommands() {
    return {
      insertHtml:
        (html = "") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { html } }),
    };
  },
});

// --- Sezione del tema ---

type SectionOptions = { schemas: SectionSchema[]; collections: CollectionOption[] };

function SectionView({ node, updateAttributes, deleteNode, selected, extension }: ReactNodeViewProps) {
  const { schemas, collections } = extension.options as SectionOptions;
  const attrs = node.attrs as { section: string; settings: Record<string, unknown>; previews: Record<string, string> };
  const schema = schemas.find((s) => s.name === attrs.section);
  const items = schemas.map((s) => ({ value: s.name, label: s.label }));
  return (
    <BlockFrame
      selected={selected}
      label={schema ? `${t("editor.section")} · ${schema.label}` : t("editor.section")}
      onDelete={deleteNode}
    >
      <div className="flex flex-col gap-4">
        <Select
          value={attrs.section}
          // Cambiando tipo le impostazioni ripartono dai default del nuovo schema.
          onValueChange={(next) => updateAttributes({ section: next, settings: {}, previews: {} })}
          items={items}
        >
          <SelectTrigger className="w-full" aria-label={t("editor.sectionType")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {schema ? (
          <>
            {schema.description && <p className="text-xs text-muted-foreground">{schema.description}</p>}
            <SectionSettingsForm
              schema={schema}
              value={attrs.settings ?? {}}
              onChange={(settings) => updateAttributes({ settings })}
              collections={collections}
              previews={attrs.previews ?? {}}
              onPreviewsChange={(previews) => updateAttributes({ previews })}
            />
          </>
        ) : (
          <p className="text-sm text-destructive">{t("editor.sectionMissing", { type: attrs.section })}</p>
        )}
      </div>
    </BlockFrame>
  );
}

/** Blocco "Sezione": inserisce nel contenuto una sezione del tema attivo, con le sue impostazioni. */
export const SectionBlock = Node.create<SectionOptions>({
  name: "section",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { schemas: [], collections: [] };
  },
  addAttributes() {
    return {
      // Id stabile: collega i dati calcolati sul server (es. elementi di un raccoglitore).
      id: { default: null },
      section: { default: "" },
      settings: { default: {} },
      // Anteprime dei media per il pannello (id → URL); il front non le usa.
      previews: { default: {} },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-type=section]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "section", "data-section": HTMLAttributes.section })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SectionView);
  },
  addCommands() {
    return {
      insertSection:
        (type) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { id: `s-${Math.random().toString(36).slice(2, 10)}`, section: type, settings: {}, previews: {} },
          }),
    };
  },
});
