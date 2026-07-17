import { createFileRoute } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { seo } from "@/lib/seo";

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

const FAQS = [
  {
    question: "Is anything ever sent to a remote server?",
    answer:
      "No. The extension talks to exactly one thing: the reins daemon on 127.0.0.1 on your machine. There is no analytics, no telemetry, and no remote code. Nothing leaves your computer.",
  },
  {
    question: "Which browsers work?",
    answer:
      "Any Chromium browser that supports Manifest V3 extensions: Chrome, Brave, Edge, Arc, and Dia are all known to work. Install the extension in each browser you want agents to reach; one daemon serves them all.",
  },
  {
    question: "Which agents work?",
    answer:
      "Anything with a shell: Claude Code, Cursor, Codex, GitHub Copilot, Gemini CLI, and plain scripts. Agents with skill support learn the commands via npx skills add karnstack/reins; everything else can read reins help.",
  },
  {
    question: 'Why does Chrome show an "is being debugged" banner?',
    answer:
      "reins executes commands through chrome.debugger, the same Chrome DevTools Protocol that powers DevTools. Chrome shows its native banner whenever a debugger is attached. That is deliberate transparency: you always know when an agent is acting on a tab.",
  },
  {
    question: "Do I need to run or configure the daemon?",
    answer:
      "No. Any reins command starts the daemon on demand, and the extension finds it on its own through localhost port discovery. reins kill stops it; reins status shows what is connected.",
  },
  {
    question: "How is this different from an MCP browser server?",
    answer:
      "There is nothing to register per agent. reins is a plain CLI, so any tool that can run shell commands can drive the browser. And it drives your real, logged-in profile rather than a separate automation browser.",
  },
  {
    question: "How do I stop an agent mid-flight?",
    answer:
      "Click the reins toolbar icon and hit Disconnect; the connection is severed instantly. reins kill stops the daemon entirely.",
  },
  {
    question: "Can I install the extension without the Chrome Web Store?",
    answer:
      "Yes. reins extension stages the bundled extension for Chrome's Load unpacked, with no reins allow step. The npm package carries a full copy, so it works with no store access at all. The docs page Install without the store has the walkthrough.",
  },
  {
    question: "Does reins work with unpacked dev builds of the extension?",
    answer:
      "Yes. Load the unpacked extension, then allow its ID once with reins allow <extension-id>. Store-installed extensions are allowlisted automatically.",
  },
];

function FaqPage() {
  return (
    <article className="prose max-w-[70ch]">
      <h1>FAQ</h1>
      <p>
        Quick answers about how reins works. Anything missing? Ask on{" "}
        <a href="https://github.com/karnstack/reins/issues" target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </p>
      <Accordion type="single" collapsible className="mt-8 w-full">
        {FAQS.map((faq) => (
          <AccordionItem key={faq.question} value={faq.question}>
            <AccordionTrigger className="py-5 text-left text-base hover:no-underline hover:[&>svg]:text-foreground">
              {faq.question}
            </AccordionTrigger>
            <AccordionContent className="max-w-[60ch] text-base/7 text-muted-foreground sm:text-sm/6">
              {faq.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </article>
  );
}
