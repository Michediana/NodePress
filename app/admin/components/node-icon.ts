import { FileIcon, FileTextIcon, FolderIcon, HomeIcon } from "lucide-react";

/** Icona di un contenuto, coerente tra albero e select: home, raccoglitore, elemento o pagina. */
export function nodeIcon(type: string, path?: string) {
  if (path === "/") return HomeIcon;
  if (type === "collection") return FolderIcon;
  if (type === "item") return FileTextIcon;
  return FileIcon;
}
