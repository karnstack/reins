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
        Every site resolves to one of three tiers, in order of power: <Code>deny</Code> &lt;{" "}
        <Code>read</Code> &lt; <Code>full</Code>. The extension checks the tier before it runs any
        command against a tab. The check lives in the extension itself, the one place a process on
        your machine cannot reach around, so even a misbehaving agent (or a compromised daemon)
        cannot skip it.
      </P>
      <P>
        The shipped default is <Code>full</Code> everywhere, so a fresh install behaves exactly as
        before. The policy model is opt-in hardening: tighten the sites you care about, or flip the
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
        Navigation is checked on both ends: <Code>reins nav</Code> and <Code>reins open</Code> need{" "}
        <Code>full</Code> on the destination host as well as the current one, so a read-only page
        cannot be steered somewhere permissive.
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
        Grants happen only in the extension popup: click the reins icon, and the Site permissions
        section offers a tier control for the current tab, the rules list, and the default. That is
        deliberate. The popup is a user gesture, and an agent in your shell cannot perform one. From
        the CLI you can inspect the policy and tighten it, never loosen it:
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
        A blocked command fails with a <Code>policy_denied</Code> error. It names the host, its
        current tier, and what to do about it:
      </P>
      <Shell
        lines={[
          "blocked by policy: mybank.com is read-only. Grant full access from the",
          "reins extension popup",
        ]}
      />
      <P>
        The CLI prints the message and exits nonzero, so agents relay the instruction instead of
        retrying.
      </P>
      <Arrow href="/docs/security">How this fits the broader trust model</Arrow>
    </>
  );
}
