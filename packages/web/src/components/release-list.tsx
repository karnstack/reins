import type { ReactNode } from "react";
import { H2, TEXT } from "@/components/md";
import { CHANGELOGS, type ChangeType, type PackageKey } from "@/lib/changelog";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<ChangeType, string> = {
  major: "major",
  minor: "minor",
  patch: "patch",
};

/** Renders `code` spans in a changelog entry as inline code. */
function InlineCode({ text }: { text: string }) {
  const parts = text.split("`");
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static text, order never changes
      <code key={i} className="bg-foreground/8 px-1 py-0.5">
        {part}
      </code>
    ) : (
      part
    ),
  ) as ReactNode;
}

/**
 * Releases as a document: a heading per version, and each change as a line
 * that names its kind and its commit. No badges, no sticky rail.
 */
export function ReleaseList({ packageKey }: { packageKey: PackageKey }) {
  const { releases } = CHANGELOGS[packageKey];

  return (
    <>
      {releases.map((release, releaseIndex) => (
        <section key={release.version}>
          <H2 id={`${packageKey}-${release.version}`}>
            v{release.version}
            {releaseIndex === 0 && <span className="ml-2 text-muted-foreground">(latest)</span>}
          </H2>
          {release.changes.map((change, changeIndex) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: entries are static per release
              key={changeIndex}
              className={cn(TEXT, "mt-5 max-w-[68ch]")}
            >
              <p className="text-muted-foreground">
                {TYPE_LABELS[change.type]}
                {change.commit && (
                  <>
                    {" · "}
                    <a
                      href={`https://github.com/karnstack/reins/commit/${change.commit}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 hover:text-primary"
                    >
                      {change.commit}
                    </a>
                  </>
                )}
              </p>
              <p className="text-pretty">
                <InlineCode text={change.text} />
              </p>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
