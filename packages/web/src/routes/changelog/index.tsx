import { createFileRoute } from "@tanstack/react-router";
import { ReleaseList } from "@/components/release-list";

export const Route = createFileRoute("/changelog/")({
  head: () => ({ meta: [{ title: "Changelog · reins" }] }),
  component: CliChangelogPage,
});

function CliChangelogPage() {
  return <ReleaseList packageKey="cli" />;
}
