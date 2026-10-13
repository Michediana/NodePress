import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    // Pre-bundle delle dipendenze client: evita ricaricamenti a metà sessione in sviluppo.
    include: [
      "@base-ui/react/alert-dialog",
      "@base-ui/react/avatar",
      "@base-ui/react/button",
      "@base-ui/react/checkbox",
      "@base-ui/react/collapsible",
      "@base-ui/react/dialog",
      "@base-ui/react/input",
      "@base-ui/react/menu",
      "@base-ui/react/merge-props",
      "@base-ui/react/popover",
      "@base-ui/react/scroll-area",
      "@base-ui/react/select",
      "@base-ui/react/separator",
      "@base-ui/react/switch",
      "@base-ui/react/tabs",
      "@base-ui/react/toggle",
      "@base-ui/react/toggle-group",
      "@base-ui/react/tooltip",
      "@base-ui/react/use-render",
      "@tiptap/core",
      "@tiptap/extensions",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "sonner",
      "tailwind-merge",
    ],
    // Dipendenze solo server, usate dai moduli .server.
    exclude: ["sharp", "mysql2", "nodemailer", "drizzle-orm", "@tailwindcss/oxide"],
  },
});
