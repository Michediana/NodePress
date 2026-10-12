import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";

export type LanguageOption = { code: string; name: string };

/**
 * Select con le lingue ISO 639-1. Le opzioni arrivano dal loader (`languageOptions()`):
 * i nomi da Intl.DisplayNames variano tra Node e browser e causerebbero errori di idratazione.
 */
export function LanguageSelect({
  options,
  exclude = [],
  ...props
}: React.ComponentProps<typeof NativeSelect> & { options: LanguageOption[]; exclude?: string[] }) {
  return (
    <NativeSelect {...props}>
      {options
        .filter((o) => !exclude.includes(o.code))
        .map((o) => (
          <NativeSelectOption key={o.code} value={o.code}>
            {o.name} ({o.code})
          </NativeSelectOption>
        ))}
    </NativeSelect>
  );
}
