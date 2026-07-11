import { createFileRoute } from "@tanstack/react-router";
import { ReleaseList } from "@/components/release-list";

export const Route = createFileRoute("/changelog/extension")({
  head: () => ({ meta: [{ title: "Extension changelog · reins" }] }),
  component: ExtensionChangelogPage,
});

function ExtensionChangelogPage() {
  return <ReleaseList packageKey="extension" />;
}
