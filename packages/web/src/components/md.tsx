import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The page is a document, and this file is its whole vocabulary.
 *
 * Everything reins.tech draws is one of these: a heading with its `#`
 * showing, a paragraph capped at a measure, a `*` list, a `$` transcript, a
 * two-column table, a rule. The mocks are the only things on the site not in
 * here, and they are pictures.
 *
 * One size of text, `text-base/7 sm:text-sm/7`, and it is the only size the
 * page has apart from the markers. A README has one size too.
 */

/** The one column every page sits in. */
export function Column({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[52rem] px-6", className)}>{children}</div>;
}

/** The text size everything uses. Named once so nothing drifts. */
export const TEXT = "text-base/7 sm:text-sm/7";

/** The block at the top of a page: who, what, when. */
export function Meta({ lines }: { lines: string[] }) {
  return (
    <div className={cn(TEXT, "tracking-wide text-muted-foreground uppercase")}>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

/** A heading's `#`. Read by nobody; it is the one ornament on the page. */
function Marker({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mr-2 text-muted-foreground select-none">
      {children}
    </span>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return (
    <h1 className={cn(TEXT, "font-semibold tracking-wide text-balance uppercase")}>
      <Marker>#</Marker>
      {children}
    </h1>
  );
}

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className={cn(TEXT, "mt-12 scroll-mt-8 font-semibold tracking-wide text-balance uppercase")}
    >
      <Marker>##</Marker>
      {children}
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className={cn(TEXT, "mt-8 scroll-mt-8 font-semibold tracking-wide text-balance")}>
      <Marker>###</Marker>
      {children}
    </h3>
  );
}

export function P({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <p className={cn(TEXT, "mt-5 max-w-[68ch] text-pretty", muted && "text-muted-foreground")}>
      {children}
    </p>
  );
}

/** `*` list. Children are `<li>`. The marker hangs in the gutter. */
export function Ul({ children }: { children: ReactNode }) {
  return (
    <ul
      className={cn(
        TEXT,
        "mt-5 max-w-[68ch] list-['*'] pl-5 text-pretty marker:text-muted-foreground [&>li]:mt-2 [&>li]:pl-1",
      )}
    >
      {children}
    </ul>
  );
}

/** `1.` list. Children are `<li>`. */
export function Ol({ children }: { children: ReactNode }) {
  return (
    <ol
      className={cn(
        TEXT,
        "mt-5 max-w-[68ch] list-decimal pl-6 text-pretty tabular-nums marker:text-muted-foreground [&>li]:mt-2 [&>li]:pl-1",
      )}
    >
      {children}
    </ol>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="underline underline-offset-4 hover:text-primary"
    >
      {children}
    </a>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="bg-foreground/8 px-1 py-0.5">{children}</code>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="bg-foreground/8 px-1 py-0.5">{children}</kbd>;
}

/**
 * A block of text as typed.
 *
 * `label` is read to a screen reader in place of the block, for a diagram
 * drawn in box characters, which is a picture to a reader who cannot see it.
 */
export function Pre({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <pre
      // A labelled block is a picture drawn in box characters, so it takes
      // the image role and is announced as its label rather than read out
      // one rule character at a time.
      {...(label ? { role: "img" as const, "aria-label": label } : {})}
      className={cn(
        "mt-5 overflow-x-auto border border-border p-4 text-sm/6 whitespace-pre",
        className,
      )}
    >
      {children}
    </pre>
  );
}

/** A transcript. Lines beginning with `$` are prompts; the rest is output. */
export function Shell({ lines }: { lines: string[] }) {
  return (
    <Pre>
      {lines.map((line, i) => (
        // Lines repeat in a transcript (blank ones, at least), so the index
        // is the only key that is honest.
        // biome-ignore lint/suspicious/noArrayIndexKey: transcript lines are not unique
        <span key={i} className="block">
          {line === "" ? (
            // An empty block has no height, so a blank line in the transcript
            // would vanish. A space under `whitespace-pre` keeps the line.
            " "
          ) : line.startsWith("$") ? (
            <>
              <span className="text-primary">$</span>
              {line.slice(1)}
            </>
          ) : (
            <span className="text-muted-foreground">{line}</span>
          )}
        </span>
      ))}
    </Pre>
  );
}

/** Two columns, key and value. A real table so it reflows and reads aloud. */
export function Table({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className={cn(TEXT, "mt-5 w-full border-collapse")}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t border-border last:border-b">
            <th
              scope="row"
              className="w-44 py-1.5 pr-4 text-left align-top font-normal whitespace-nowrap text-muted-foreground"
            >
              {k}
            </th>
            <td className="py-1.5 align-top">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** `---`. A section boundary, and the only one the page draws. */
export function Rule() {
  return (
    <p aria-hidden="true" className={cn(TEXT, "mt-12 text-muted-foreground select-none")}>
      ---
    </p>
  );
}

/** `-> Somewhere`. A link that stands on its own line. */
export function Arrow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className={cn(TEXT, "mt-5")}>
      <span aria-hidden="true" className="mr-2 text-muted-foreground">
        &rarr;
      </span>
      <A href={href}>{children}</A>
    </p>
  );
}

/** A point worth pulling out of the flow, without being a warning. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <blockquote className="mt-5 max-w-[68ch] border-l-2 border-border pl-4">
      <p className={cn(TEXT, "font-semibold")}>{title}</p>
      {children}
    </blockquote>
  );
}
