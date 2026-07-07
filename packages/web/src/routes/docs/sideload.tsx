import { createFileRoute } from "@tanstack/react-router";
import { CodeBlock } from "@/components/code-block";

export const Route = createFileRoute("/docs/sideload")({
  head: () => ({ meta: [{ title: "Install without the store · reins" }] }),
  component: SideloadPage,
});

function SideloadPage() {
  return (
    <article className="prose max-w-[70ch]">
      <h1>Install without the store</h1>
      <p>
        The npm package carries a full copy of the reins extension. If you cannot (or would rather
        not) install from the{" "}
        <a
          href="https://chromewebstore.google.com/detail/reins/hnjcfgochepemjndccfblpmfmlblkofo"
          target="_blank"
          rel="noreferrer"
        >
          Chrome Web Store
        </a>
        , one command stages it for Chrome's <strong>Load unpacked</strong>. No repo checkout, no
        build, no <code>reins allow</code>.
      </p>

      <h2>Install</h2>
      <CodeBlock
        code={`npm i -g @karnstack/reins
reins extension`}
      />
      <ol>
        <li>
          <code>reins extension</code> copies the bundled extension to{" "}
          <code>~/.reins/extension</code> and prints these same steps.
        </li>
        <li>
          Open <code>chrome://extensions</code> (or <code>brave://extensions</code>,{" "}
          <code>dia://extensions</code>, …).
        </li>
        <li>
          Enable <strong>Developer mode</strong> (top right).
        </li>
        <li>
          Click <strong>Load unpacked</strong> and select <code>~/.reins/extension</code>.
        </li>
        <li>
          Run <code>reins status</code>; the extension finds the daemon and connects on its own.
        </li>
      </ol>
      <p>
        There is no <code>reins allow</code> step: the sideload build pins a public key in its
        manifest, so its extension ID is identical on every machine and ships in the CLI's built-in
        allowlist.
      </p>

      <h2>Updating</h2>
      <p>Sideloaded extensions do not auto-update. After upgrading the CLI, re-stage it:</p>
      <CodeBlock code="reins extension" />
      <p>
        Then click <strong>Reload</strong> on the reins card in <code>chrome://extensions</code>.
        The path never changes, so Chrome keeps the registration.
      </p>

      <h2>Caveats</h2>
      <ul>
        <li>
          Chrome shows its usual developer-mode reminders for unpacked extensions on some platforms.
          That is inherent to sideloading; the store build has no such nag
        </li>
        <li>
          A sideloaded and a store-installed reins can coexist, but run one at a time; disable the
          other in <code>chrome://extensions</code> so two connections don't both drive your tabs
        </li>
        <li>
          Working from a source checkout instead? That flow uses a per-machine dev ID and{" "}
          <code>reins allow</code>; see{" "}
          <a
            href="https://github.com/karnstack/reins/blob/main/docs/RUNNING.md"
            target="_blank"
            rel="noreferrer"
          >
            RUNNING.md
          </a>{" "}
          on GitHub
        </li>
      </ul>
    </article>
  );
}
