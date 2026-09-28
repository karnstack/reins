import { createFileRoute } from "@tanstack/react-router";
import { A, H1, H2, P } from "@/components/md";
import { seo } from "@/lib/seo";

const FAQS = [
  {
    id: "remote",
    question: "Is anything ever sent to a remote server?",
    answer:
      "Not by default. The extension talks only to the reins daemon on 127.0.0.1. No analytics, no telemetry, no remote code. The one opt-in exception is reins do: once you save a TypeSafe key, it sends page state to TypeSafe while a run is working. The security page lists exactly what.",
  },
  {
    id: "browsers",
    question: "Which browsers work?",
    answer:
      "Any Chromium browser with Manifest V3 extensions: Chrome, Brave, Edge, Arc, Dia. Install the extension in each one; one daemon serves them all.",
  },
  {
    id: "agents",
    question: "Which agents work?",
    answer:
      "Anything with a shell: Claude Code, Cursor, Codex, Copilot, Gemini CLI, plain scripts. Teach it with npx skills add karnstack/reins, or point it at reins help.",
  },
  {
    id: "banner",
    question: 'Why does Chrome show an "is being debugged" banner?',
    answer:
      "reins drives tabs through chrome.debugger, the same protocol DevTools uses, and Chrome shows that banner whenever a debugger is attached. It is how you know an agent is acting.",
  },
  {
    id: "daemon",
    question: "Do I need to run or configure the daemon?",
    answer:
      "No. Any reins command starts it, and the extension finds it on its own. reins status shows what is connected; reins kill stops it.",
  },
  {
    id: "update",
    question: "How do I update reins?",
    answer:
      "Run npm i -g @karnstack/reins@latest. The next command restarts the daemon on the new version, or run reins restart. The Web Store extension updates itself.",
  },
  {
    id: "mcp",
    question: "How is this different from an MCP browser server?",
    answer:
      "Nothing to register per agent. reins is a plain CLI, so anything that runs shell commands can use it, and it drives your real logged-in browser rather than a separate one.",
  },
  {
    id: "stop",
    question: "How do I stop an agent while it is running?",
    answer:
      "Click the reins toolbar icon and press Disconnect. reins kill stops the daemon entirely.",
  },
  {
    id: "store",
    question: "Can I install the extension without the Chrome Web Store?",
    answer:
      "Yes. reins extension stages the copy bundled in the npm package for Chrome's Load unpacked. See Install without the store.",
  },
  {
    id: "dev-builds",
    question: "Does reins work with unpacked dev builds of the extension?",
    answer: "Yes. Load the unpacked build, then run reins allow <extension-id> once.",
  },
];

export const Route = createFileRoute("/docs/faq")({
  head: () => ({
    ...seo({
      title: "FAQ · reins",
      description:
        "Answers to common questions about reins: supported browsers and agents, the local-only daemon, Chrome's debugging banner, and installing without the store.",
      path: "/docs/faq",
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }),
      },
    ],
  }),
  component: FaqPage,
});

/** Headings and answers, the way a README does it. No accordion to open. */
function FaqPage() {
  return (
    <>
      <H1>FAQ</H1>
      <P>
        Missing something? Ask on <A href="https://github.com/karnstack/reins/issues">GitHub</A>.
      </P>
      {FAQS.map((faq) => (
        <div key={faq.id}>
          <H2 id={faq.id}>{faq.question}</H2>
          <P>{faq.answer}</P>
        </div>
      ))}
    </>
  );
}
