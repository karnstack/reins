import { useRouter } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BookOpen,
  Clipboard,
  Download,
  FileText,
  GitCompare,
  HelpCircle,
  History,
  Layers,
  Lock,
  Moon,
  Shield,
  Terminal,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { GitHubIcon, NpmIcon, XIcon } from "@/components/icons";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { type DocResult, searchDocs } from "@/lib/pagefind";
import { INSTALL_COMMAND, NPM_URL, REPO_URL, X_URL } from "@/lib/site";

interface Action {
  id: string;
  label: string;
  keywords?: string;
  icon: ReactNode;
  run: () => void;
}

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PAGES: Array<{ id: string; label: string; to: string; keywords?: string; icon: ReactNode }> =
  [
    {
      id: "docs",
      label: "Getting started",
      to: "/docs",
      keywords: "docs overview install",
      icon: <BookOpen />,
    },
    {
      id: "sideload",
      label: "Install without the store",
      to: "/docs/sideload",
      keywords: "unpacked load",
      icon: <Download />,
    },
    {
      id: "commands",
      label: "Commands",
      to: "/docs/commands",
      keywords: "cli reference snapshot click type eval cdp",
      icon: <Terminal />,
    },
    {
      id: "permissions",
      label: "Site permissions",
      to: "/docs/permissions",
      keywords: "policy deny readonly tiers",
      icon: <Shield />,
    },
    {
      id: "architecture",
      label: "Architecture",
      to: "/docs/architecture",
      keywords: "daemon extension websocket",
      icon: <Layers />,
    },
    {
      id: "security",
      label: "Security",
      to: "/docs/security",
      keywords: "threat model localhost",
      icon: <Lock />,
    },
    {
      id: "comparison",
      label: "How it compares",
      to: "/docs/comparison",
      keywords: "vs alternatives cdp mcp",
      icon: <GitCompare />,
    },
    { id: "faq", label: "FAQ", to: "/docs/faq", keywords: "questions", icon: <HelpCircle /> },
    {
      id: "changelog",
      label: "Changelog",
      to: "/changelog",
      keywords: "releases versions notes",
      icon: <History />,
    },
    {
      id: "privacy",
      label: "Privacy",
      to: "/privacy",
      keywords: "policy data telemetry",
      icon: <FileText />,
    },
  ];

function matches(query: string, ...text: Array<string | undefined>) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return text.join(" ").toLowerCase().includes(q);
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocResult[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // Reset when the dialog closes so it reopens clean.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setLoading(false);
    }
  }, [open]);

  // Debounced full-text search; stale responses are dropped by request id.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      searchDocs(q).then((r) => {
        if (reqId.current === id) {
          setResults(r);
          setLoading(false);
        }
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [query, open]);

  const close = () => onOpenChange(false);
  const go = (to: string) => {
    close();
    router.navigate({ to } as never);
  };
  const openExternal = (url: string) => {
    close();
    window.open(url, "_blank", "noreferrer");
  };

  const actions: Action[] = [
    {
      id: "theme",
      label: "Toggle theme",
      keywords: "dark light mode appearance",
      icon: <Moon />,
      run: () => {
        const el = document.documentElement;
        const dark = el.classList.contains("dark");
        el.classList.toggle("dark", !dark);
        try {
          localStorage.setItem("theme", dark ? "light" : "dark");
        } catch {
          /* storage blocked — theme still flips this session */
        }
        close();
      },
    },
    {
      id: "copy-install",
      label: "Copy install command",
      keywords: `npm install ${INSTALL_COMMAND}`,
      icon: <Clipboard />,
      run: () => {
        navigator.clipboard?.writeText(INSTALL_COMMAND).catch(() => {});
        close();
      },
    },
  ];

  const links: Action[] = [
    {
      id: "github",
      label: "GitHub repository",
      keywords: "source code",
      icon: <GitHubIcon className="size-4" />,
      run: () => openExternal(REPO_URL),
    },
    {
      id: "npm",
      label: "npm package",
      keywords: "install package",
      icon: <NpmIcon className="size-4" />,
      run: () => openExternal(NPM_URL),
    },
    {
      id: "x",
      label: "Karn on X",
      keywords: "twitter gyankarn",
      icon: <XIcon className="size-4" />,
      run: () => openExternal(X_URL),
    },
  ];

  const q = query.trim();
  const showResults = q.length > 0;
  const filteredPages = PAGES.filter((p) => matches(q, p.label, p.keywords));
  const filteredActions = actions.filter((a) => matches(q, a.label, a.keywords));
  const filteredLinks = links.filter((l) => matches(q, l.label, l.keywords));
  const nothing =
    filteredPages.length === 0 &&
    filteredActions.length === 0 &&
    filteredLinks.length === 0 &&
    results.length === 0 &&
    !loading;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search docs or jump to…" />
      <CommandList>
        {nothing ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No results.</p>
        ) : null}

        {filteredPages.length > 0 ? (
          <CommandGroup heading="Pages">
            {filteredPages.map((p) => (
              <CommandItem key={p.id} value={`page-${p.id}`} onSelect={() => go(p.to)}>
                {p.icon}
                <span className="flex-1">{p.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredActions.length > 0 ? (
          <CommandGroup heading="Actions">
            {filteredActions.map((a) => (
              <CommandItem key={a.id} value={`action-${a.id}`} onSelect={a.run}>
                {a.icon}
                <span className="flex-1">{a.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredLinks.length > 0 ? (
          <CommandGroup heading="Links">
            {filteredLinks.map((l) => (
              <CommandItem key={l.id} value={`link-${l.id}`} onSelect={l.run}>
                {l.icon}
                <span className="flex-1">{l.label}</span>
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {showResults && (loading || results.length > 0) ? (
          <>
            {filteredPages.length + filteredActions.length + filteredLinks.length > 0 ? (
              <CommandSeparator />
            ) : null}
            <CommandGroup heading="Documentation">
              {loading && results.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">Searching…</p>
              ) : null}
              {results.map((r) => (
                <CommandItem key={r.url} value={`doc-${r.url}`} onSelect={() => go(r.url)}>
                  <FileText className="mt-0.5 size-4 shrink-0 self-start" aria-hidden="true" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                    <p
                      className="line-clamp-1 text-sm text-muted-foreground [&_mark]:rounded-sm [&_mark]:bg-primary/15 [&_mark]:text-foreground"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: Pagefind excerpt from our own prerendered docs
                      dangerouslySetInnerHTML={{ __html: r.excerpt }}
                    />
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CommandShortcut className="ml-0">↵</CommandShortcut> to select
          </span>
          <span className="flex items-center gap-1">
            <CommandShortcut className="ml-0">esc</CommandShortcut> to close
          </span>
        </div>
      </CommandList>
    </CommandDialog>
  );
}
