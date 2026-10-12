import { useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "~/components/ui/input-group";
import { slugify } from "~/lib/slug";

/** Hook: slug derivato dal titolo finché l'utente non lo modifica a mano. */
export function useAutoSlug(initialTitle: string, initialSlug: string, auto: boolean) {
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [touched, setTouched] = useState(!auto);
  return {
    title,
    slug,
    setTitle(value: string) {
      setTitle(value);
      if (!touched) setSlug(slugify(value));
    },
    setSlug(value: string) {
      setTouched(true);
      setSlug(value);
    },
  };
}

export function SlugInput({
  prefix,
  ...props
}: { prefix: string } & React.ComponentProps<typeof InputGroupInput>) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText className="max-w-48 truncate">{prefix}</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput {...props} />
    </InputGroup>
  );
}
