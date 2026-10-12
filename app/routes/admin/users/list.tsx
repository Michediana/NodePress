import { UserPlusIcon } from "lucide-react";
import { Link } from "react-router";
import { requirePermission } from "~/.server/auth";
import { listUsers } from "~/.server/users";
import { PageHeader } from "~/admin/components/page-header";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import type { Route } from "./+types/list";

export async function loader({ context }: Route.LoaderArgs) {
  requirePermission(context, "users");
  return { users: await listUsers() };
}

export default function UserList({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader
        title={t("nav.users")}
        description={t("users.description")}
        actions={
          <Button nativeButton={false} render={<Link to="/admin/users/new" />}>
            <UserPlusIcon data-icon="inline-start" />
            {t("users.new")}
          </Button>
        }
      />
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t("users.name")}</TableHead>
                <TableHead>{t("users.email")}</TableHead>
                <TableHead>{t("users.role")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loaderData.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="pl-4">
                    <Link to={`/admin/users/${user.id}`} className="font-medium hover:underline">
                      {user.name}
                    </Link>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>{t(`roles.${user.role}`)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
