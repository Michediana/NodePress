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
    <main className="flex min-h-svh items-center justify-center bg-muted p-4">
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
