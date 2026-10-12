import { LanguageFlag } from "~/components/language-flag";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";

export type LanguageOption = { code: string; name: string };

/**
 * Select con le lingue ISO 639-1. Le opzioni arrivano dal loader (`languageOptions()`):
 * i nomi da Intl.DisplayNames variano tra Node e browser e causerebbero errori di idratazione.
 */
export function LanguageSelect({
  options,
  exclude = [],
  id,
  className,
  defaultValue,
  ...props
}: React.ComponentProps<typeof Select<string>> & { options: LanguageOption[]; exclude?: string[]; className?: string }) {
  const items = options
    .filter((o) => !exclude.includes(o.code))
    .map((o) => ({
      value: o.code,
      label: (
        <>
          <LanguageFlag code={o.code} />
          {o.name} ({o.code})
        </>
      ),
    }));
  return (
    // come una select nativa: senza valore esplicito si parte dalla prima opzione
    <Select items={items} defaultValue={defaultValue ?? items[0]?.value} {...props}>
      <SelectTrigger id={id} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
