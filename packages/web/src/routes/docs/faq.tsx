import { createFileRoute } from "@tanstack/react-router";
import { A, H1, H2, P } from "@/components/md";
import { seo } from "@/lib/seo";

const FAQS = [
  {
    id: "remote",
    question: "Is anything ever sent to a remote server?",
    answer:
      "Nothing reins reads goes anywhere. The extension talks to exactly one thing: the reins daemon on 127.0.0.1 on your machine. There is no analytics, no telemetry, and no remote code. Your browser still reaches the internet the way it always did, because reins drives the browser you already use rather than replacing it.",
  },
  {
    id: "browsers",
    question: "Which browsers work?",
    answer:
      "Any Chromium browser that supports Manifest V3 extensions. Chrome, Brave, Edge, Arc and Dia are all known to work. Install the extension in each browser you want agents to reach; one daemon serves them all.",
  },
  {
    id: "agents",
    question: "Which agents work?",
    answer:
      "Anything with a shell: Claude Code, Cursor, Codex, GitHub Copilot, Gemini CLI, and plain scripts. Agents with skill support learn the commands via npx skills add karnstack/reins; everything else can read reins help.",
  },
  {
    id: "banner",
    question: 'Why does Chrome show an "is being debugged" banner?',
    answer:
      "reins executes commands through chrome.debugger, the same Chrome DevTools Protocol that powers DevTools. Chrome shows its native banner whenever a debugger is attached. That is deliberate transparency: you always know when an agent is acting on a tab.",
  },
  {
    id: "daemon",
    question: "Do I need to run or configure the daemon?",
    answer:
      "No. Any reins command starts the daemon on demand, and the extension finds it on its own through localhost port discovery. reins kill stops it; reins status shows what is connected.",
  },
  {
    id: "mcp",
    question: "How is this different from an MCP browser server?",
    answer:
      "There is nothing to register per agent. reins is a plain CLI, so any tool that can run shell commands can drive the browser. And it drives your real, logged-in profile rather than a separate automation browser.",
  },
  {
    id: "stop",
    question: "How do I stop an agent while it is running?",
    answer:
      "Click the reins toolbar icon and press Disconnect. The connection is cut at once. reins kill stops the daemon entirely.",
  },
  {
    id: "store",
    question: "Can I install the extension without the Chrome Web Store?",
    answer:
      "Yes. reins extension stages the bundled extension for Chrome's Load unpacked, with no reins allow step. The npm package carries a full copy, so it works with no store access at all. The docs page Install without the store has the walkthrough.",
  },
  {
    id: "dev-builds",
    question: "Does reins work with unpacked dev builds of the extension?",
    answer:
      "Yes. Load the unpacked extension, then allow its ID once with reins allow <extension-id>. Store-installed extensions are allowlisted automatically.",
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
        Quick answers about how reins works. Anything missing? Ask on{" "}
        <A href="https://github.com/karnstack/reins/issues">GitHub</A>.
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
