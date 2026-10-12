import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

type Common = {
  name: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: string;
};

export function TextField({
  name,
  label,
  description,
  error,
  ...props
}: Common & Omit<React.ComponentProps<typeof Input>, "name">) {
  const id = props.id ?? `f-${name}`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} name={name} aria-invalid={error ? true : undefined} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function TextareaField({
  name,
  label,
  description,
  error,
  ...props
}: Common & Omit<React.ComponentProps<typeof Textarea>, "name">) {
  const id = props.id ?? `f-${name}`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} name={name} aria-invalid={error ? true : undefined} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
