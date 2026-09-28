import { createFileRoute } from "@tanstack/react-router";
import { Arrow, Code, H1, H2, P, Shell, Table, Ul } from "@/components/md";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/docs/permissions")({
  head: () => ({
    ...seo({
      title: "Site permissions · reins",
      description:
        "How reins site permissions work: per-site deny, read-only, or full tiers enforced inside the extension, granted only by a click in the popup.",
      path: "/docs/permissions",
    }),
  }),
  component: PermissionsPage,
});

function PermissionsPage() {
  return (
    <>
      <H1>Site permissions</H1>
      <P>
        Every site gets one of three tiers: <Code>deny</Code>, <Code>read</Code> or{" "}
        <Code>full</Code>. The extension checks it before any command touches a tab, so neither the
        agent nor the daemon can skip it.
      </P>
      <P>
        The default is <Code>full</Code> everywhere. Tighten the sites you care about, or flip the
        default and grant sites back one by one.
      </P>

      <H2 id="tiers">Tiers</H2>
      <Table
        rows={[
          [
            "deny",
            "Nothing. Every command against the site fails, and its tabs appear redacted in reins tabs: tab id only, no URL or title.",
          ],
          [
            "read",
            "Reading only. snapshot, text, screenshot, console, network and wait all work. click, type, navigate, eval, and everything else that acts on the page is blocked.",
          ],
          ["full", "Everything, including navigation, interaction, eval and raw CDP."],
        ]}
      />
      <P>
        <Code>reins nav</Code> and <Code>reins open</Code> need <Code>full</Code> on both the
        current and the destination site.
      </P>

      <H2 id="rules">Rules and matching</H2>
      <Ul>
        <li>
          A rule is a bare host (<Code>github.com</Code>) or a wildcard (<Code>*.google.com</Code>)
          paired with a tier.
        </li>
        <li>
          An exact host match beats a wildcard. The longest wildcard suffix wins among wildcards.
          Anything unmatched gets the default tier.
        </li>
        <li>
          <Code>*.foo.com</Code> covers subdomains and the apex <Code>foo.com</Code>, following
          Chrome's match-pattern convention.
        </li>
        <li>
          Pages without an http(s) host (<Code>chrome://</Code> pages, <Code>about:blank</Code>) are
          governed by the default tier.
        </li>
        <li>
          Policy is stored per browser profile, so a locked-down work profile and a permissive
          scratch profile coexist naturally.
        </li>
      </Ul>

      <H2 id="granting">Granting and tightening</H2>
      <P>
        Grant access in the extension popup, under Site permissions. An agent in your shell cannot
        click it, which is the point. The CLI can only look and tighten:
      </P>
      <Shell
        lines={[
          "$ reins policy                          # default, rules, tier per open tab",
          '$ reins policy readonly "*.github.com"  # reading only, no acting',
          "$ reins policy deny mybank.com          # off limits entirely",
          "$ reins policy allow mybank.com         # always errors: grants live in the popup",
        ]}
      />

      <H2 id="blocked">What a blocked agent sees</H2>
      <P>
        A blocked command fails with <Code>policy_denied</Code> and says what to do:
      </P>
      <Shell
        lines={[
          "blocked by policy: mybank.com is read-only. Grant full access from the",
          "reins extension popup",
        ]}
      />
      <P>It exits nonzero, so agents pass the message on instead of retrying.</P>
      <Arrow href="/docs/security">How this fits the broader trust model</Arrow>
    </>
  );
}
