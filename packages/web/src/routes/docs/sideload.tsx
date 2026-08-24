import { createFileRoute } from "@tanstack/react-router";
import { A, Code, H1, H2, Ol, P, Shell, Ul } from "@/components/md";
import { seo } from "@/lib/seo";
import { INSTALL_COMMAND } from "@/lib/site";

export const Route = createFileRoute("/docs/sideload")({
  head: () => ({
    ...seo({
      title: "Install without the store · reins",
      description:
        "Install the bundled reins extension without the Chrome Web Store: reins extension stages it for Chrome's Load unpacked, no store access required.",
      path: "/docs/sideload",
    }),
  }),
  component: SideloadPage,
});

function SideloadPage() {
  return (
    <>
      <H1>Install without the store</H1>
      <P>
        The npm package carries a full copy of the reins extension. If you cannot (or would rather
        not) install from the{" "}
        <A href="https://chromewebstore.google.com/detail/reins/hnjcfgochepemjndccfblpmfmlblkofo">
          Chrome Web Store
        </A>
        , one command stages it for Chrome's Load unpacked. No repo checkout, no build, no{" "}
        <Code>reins allow</Code>.
      </P>

      <H2 id="install">Install</H2>
      <Shell lines={[`$ ${INSTALL_COMMAND}`, "$ reins extension"]} />
      <Ol>
        <li>
          <Code>reins extension</Code> copies the bundled extension to{" "}
          <Code>~/.reins/extension</Code> and prints these same steps.
        </li>
        <li>
          Open <Code>chrome://extensions</Code> (or <Code>brave://extensions</Code>,{" "}
          <Code>dia://extensions</Code>, and so on).
        </li>
        <li>Enable Developer mode, top right.</li>
        <li>
          Click Load unpacked and select <Code>~/.reins/extension</Code>.
        </li>
        <li>
          Run <Code>reins status</Code>. The extension finds the daemon and connects on its own.
        </li>
      </Ol>
      <P>
        There is no <Code>reins allow</Code> step: the sideload build pins a public key in its
        manifest, so its extension ID is identical on every machine and ships in the CLI's built-in
        allowlist.
      </P>

      <H2 id="updating">Updating</H2>
      <P>Sideloaded extensions do not auto-update. After upgrading the CLI, re-stage it:</P>
      <Shell lines={["$ reins extension"]} />
      <P>
        Then click Reload on the reins card in <Code>chrome://extensions</Code>. The path never
        changes, so Chrome keeps the registration.
      </P>

      <H2 id="caveats">Caveats</H2>
      <Ul>
        <li>
          Chrome shows its usual developer-mode reminders for unpacked extensions on some platforms.
          That comes with sideloading. The store build does not show them.
        </li>
        <li>
          A sideloaded and a store-installed reins can coexist, but run one at a time. Disable the
          other in <Code>chrome://extensions</Code>, so two connections do not both drive your tabs.
        </li>
        <li>
          Working from a source checkout instead? That flow uses a per-machine dev ID and{" "}
          <Code>reins allow</Code>. See{" "}
          <A href="https://github.com/karnstack/reins/blob/main/docs/RUNNING.md">RUNNING.md</A> on
          GitHub.
        </li>
      </Ul>
    </>
  );
}
