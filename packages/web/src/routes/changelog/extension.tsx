import { createFileRoute } from "@tanstack/react-router";
import { ReleaseList } from "@/components/release-list";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/changelog/extension")({
  head: () => ({
    ...seo({
      title: "Extension changelog · reins",
      description:
        "Release notes for the reins Chrome extension, straight from the package changelog.",
      path: "/changelog/extension",
    }),
  }),
  component: ExtensionChangelogPage,
});

function ExtensionChangelogPage() {
  return <ReleaseList packageKey="extension" />;
}
