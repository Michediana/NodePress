import { Field, FieldContent, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Switch } from "~/components/ui/switch";

/** Switch che invia "on" nel form quando attivo. */
export function SwitchField({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description?: React.ReactNode;
  defaultChecked?: boolean;
}) {
  const id = `f-${name}`;
  return (
    <Field orientation="horizontal">
      <Switch id={id} name={name} value="on" defaultChecked={defaultChecked} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
    </Field>
  );
}
