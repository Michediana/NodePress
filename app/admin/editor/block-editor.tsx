import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  CodeXmlIcon,
  GalleryHorizontalIcon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  Redo2Icon,
  Undo2Icon,
  MonitorPlayIcon,
} from "lucide-react";
import { useState } from "react";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { ContentDoc } from "~/lib/content";
import { mediaUrl } from "~/lib/media";
import { EmbedBlock, GalleryBlock, HtmlBlock, ImageBlock } from "./extensions";
import { MediaPicker } from "./media-picker";

function ToolbarToggle({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Toggle size="sm" pressed={pressed ?? false} onPressedChange={onClick} aria-label={label} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [picker, setPicker] = useState<null | "image" | "gallery">(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      paragraph: e.isActive("paragraph"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      quote: e.isActive("blockquote"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(t("editor.linkPrompt"), previous ?? "https://");
    if (url === null) return;
    if (url === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url }).run();
  };
  return (
    <div
      className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-background p-1"
      // Mantiene il focus (e la selezione) nell'editor quando si clicca la toolbar.
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolbarToggle label={t("editor.paragraph")} pressed={state.paragraph} onClick={() => chain().setParagraph().run()}>
        <PilcrowIcon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.heading2")} pressed={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        <Heading2Icon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.heading3")} pressed={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
        <Heading3Icon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.quote")} pressed={state.quote} onClick={() => chain().toggleBlockquote().run()}>
        <QuoteIcon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.bulletList")} pressed={state.bullet} onClick={() => chain().toggleBulletList().run()}>
        <ListIcon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.orderedList")} pressed={state.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrderedIcon />
      </ToolbarToggle>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarToggle label={t("editor.bold")} pressed={state.bold} onClick={() => chain().toggleBold().run()}>
        <BoldIcon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.italic")} pressed={state.italic} onClick={() => chain().toggleItalic().run()}>
        <ItalicIcon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.link")} pressed={state.link} onClick={setLink}>
        <LinkIcon />
      </ToolbarToggle>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarToggle label={t("editor.image")} onClick={() => setPicker("image")}>
        <ImageIcon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.gallery")} onClick={() => setPicker("gallery")}>
        <GalleryHorizontalIcon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.embed")} onClick={() => chain().insertEmbed().run()}>
        <MonitorPlayIcon />
      </ToolbarToggle>
      <ToolbarToggle label={t("editor.html")} onClick={() => chain().insertHtml().run()}>
        <CodeXmlIcon />
      </ToolbarToggle>
      <div className="ml-auto flex gap-1">
        <Button type="button" variant="ghost" size="icon-sm" disabled={!state.canUndo} onClick={() => chain().undo().run()} aria-label={t("editor.undo")}>
          <Undo2Icon />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" disabled={!state.canRedo} onClick={() => chain().redo().run()} aria-label={t("editor.redo")}>
          <Redo2Icon />
        </Button>
      </div>
      <MediaPicker
        open={picker !== null}
        multiple={picker === "gallery"}
        onOpenChange={(open) => !open && setPicker(null)}
        onSelect={(media) => {
          if (picker === "gallery") {
            chain().insertGallery(media.map((m) => ({ mediaId: m.id, src: mediaUrl(m.file) }))).run();
          } else if (media[0]) {
            chain().insertImage({ mediaId: media[0].id, src: mediaUrl(media[0].file) }).run();
          }
        }}
      />
    </div>
  );
}

/** Editor a blocchi: il contenuto è JSON compatibile con `ContentDoc`. */
export function BlockEditor({ value, onChange }: { value: ContentDoc | null; onChange: (doc: ContentDoc) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        codeBlock: false,
        code: false,
        link: { openOnClick: false, autolink: true },
      }),
      Placeholder.configure({ placeholder: t("editor.placeholder") }),
      ImageBlock,
      GalleryBlock,
      EmbedBlock,
      HtmlBlock,
    ],
    content: value ?? undefined,
    editorProps: {
      attributes: { class: "prose prose-neutral dark:prose-invert max-w-none px-4 py-3" },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as ContentDoc),
  });

  return (
    <div className="np-editor overflow-hidden rounded-lg border">
      {editor ? <Toolbar editor={editor} /> : <div className="h-10 border-b" />}
      <EditorContent editor={editor} />
    </div>
  );
}
