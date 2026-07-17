import { createFileRoute } from "@tanstack/react-router";
import { ReleaseList } from "@/components/release-list";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/changelog/")({
  head: () => ({
    ...seo({
      title: "Changelog · reins",
      description:
        "Release notes for the reins CLI (@karnstack/reins), straight from the package changelog.",
      path: "/changelog",
    }),
  }),
  component: CliChangelogPage,
});

function CliChangelogPage() {
  return <ReleaseList packageKey="cli" />;
}
