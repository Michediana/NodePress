import { Logo } from "~/admin/components/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export function AuthCard({
  title,
  description,
  children,
  wide,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <Logo className="size-9" />
        NodePress
      </div>
      <Card className={wide ? "w-full max-w-lg" : "w-full max-w-sm"}>
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
