import { createFileRoute, Link } from "@tanstack/react-router";
import { CodeBlock } from "@/components/code-block";

export const Route = createFileRoute("/docs/permissions")({
  head: () => ({ meta: [{ title: "Site permissions · reins" }] }),
  component: PermissionsPage,
});

const TIERS: Array<{ tier: string; means: string }> = [
  {
    tier: "deny",
    means:
      "Nothing. Every command against the site fails, and its tabs appear redacted in reins tabs — tab id only, no URL or title.",
  },
  {
    tier: "read",
    means:
      "Look, don't touch: snapshot, text, screenshot, console, network, and wait work; click, type, navigate, eval, and everything else that acts on the page is blocked.",
  },
  {
    tier: "full",
    means: "Everything, including navigation, interaction, eval, and raw CDP.",
  },
];

function PermissionsPage() {
  return (
    <article className="prose max-w-[70ch]">
      <h1>Site permissions</h1>
      <p>
        Every site resolves to one of three tiers — <code>deny</code> &lt; <code>read</code> &lt;{" "}
        <code>full</code> — and the extension checks the tier before running any command against a
        tab. The check lives in the extension itself, the one place a process on your machine can't
        reach around: even a misbehaving agent (or a compromised daemon) can't skip it.
      </p>
      <p>
        The shipped default is <code>full</code> everywhere, so a fresh install behaves exactly as
        before. The policy model is opt-in hardening: tighten the sites you care about, or flip the
        default and grant sites back one by one.
      </p>

      <h2>Tiers</h2>
      <table>
        <thead>
          <tr className="border-b border-border">
            <th>Tier</th>
            <th>What the agent can do</th>
          </tr>
        </thead>
        <tbody>
          {TIERS.map((row) => (
            <tr key={row.tier} className="border-b border-border">
              <th className="align-top">
                <code>{row.tier}</code>
              </th>
              <td className="align-top">{row.means}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Navigation is checked on both ends: <code>reins nav</code> and <code>reins open</code> need{" "}
        <code>full</code> on the destination host as well as the current one, so a read-only page
        can't be steered somewhere permissive.
      </p>

      <h2>Rules and matching</h2>
      <ul>
        <li>
          A rule is a bare host (<code>github.com</code>) or a wildcard (<code>*.google.com</code>)
          paired with a tier.
        </li>
        <li>
          An exact host match beats a wildcard; the longest wildcard suffix wins among wildcards;
          anything unmatched gets the default tier.
        </li>
        <li>
          <code>*.foo.com</code> covers subdomains and the apex <code>foo.com</code>, following
          Chrome's match-pattern convention.
        </li>
        <li>
          Pages without an http(s) host — <code>chrome://</code> pages, <code>about:blank</code> —
          are governed by the default tier.
        </li>
        <li>
          Policy is stored per browser profile, so a locked-down work profile and a permissive
          scratch profile coexist naturally.
        </li>
      </ul>

      <h2>Granting and tightening</h2>
      <p>
        Grants happen only in the extension popup: click the reins icon, and the Site permissions
        section offers a tier control for the current tab, the rules list, and the default. That's
        deliberate — the popup is a user gesture, something an agent in your shell cannot perform.
        From the CLI you can inspect the policy and tighten it, never loosen it:
      </p>
      <CodeBlock
        code={[
          "reins policy                          # default, rules, tier per open tab",
          'reins policy readonly "*.github.com"  # look, don\'t touch',
          "reins policy deny mybank.com          # off limits entirely",
          "reins policy allow mybank.com         # always errors: grants live in the popup",
        ].join("\n")}
      />

      <h2>What a blocked agent sees</h2>
      <p>
        A blocked command fails with a <code>policy_denied</code> error that names the host, its
        current tier, and the remediation — for example:{" "}
        <code>
          blocked by policy: mybank.com is read-only — grant full access from the reins extension
          popup
        </code>
        . The CLI prints the message and exits nonzero, so agents relay the instruction instead of
        retrying. For how this fits the broader trust model, see{" "}
        <Link to="/docs/security">Security</Link>.
      </p>
    </article>
  );
}
