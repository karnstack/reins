import { useEffect, useRef, useState } from "react";
import { Output, Prompt, Terminal } from "@/components/terminal";
import { prefersReducedMotion } from "@/lib/motion";

export interface TermLine {
  kind: "prompt" | "output";
  text: string;
}

export function prompt(text: string): TermLine {
  return { kind: "prompt", text };
}

export function output(text: string): TermLine {
  return { kind: "output", text };
}

const CHAR_MS = 22;
const PROMPT_PAUSE_MS = 450;
const OUTPUT_PAUSE_MS = 260;

function Caret() {
  return (
    <span
      aria-hidden="true"
      className="ml-px inline-block h-[1.05em] w-[0.55ch] translate-y-[0.18em] bg-neutral-300 [animation:terminal-caret_1s_step-end_infinite]"
    />
  );
}

function renderLine(line: TermLine, key: number) {
  return line.kind === "prompt" ? (
    <Prompt key={key}>{line.text}</Prompt>
  ) : (
    <Output key={key}>{line.text}</Output>
  );
}

/**
 * A Terminal that types its prompts out character by character. The full
 * transcript is laid out invisibly underneath so the box never changes size
 * while typing. Renders instantly when `play` is false or the user prefers
 * reduced motion.
 */
export function AnimatedTerminal({
  title,
  lines,
  play = true,
  startDelay = 0,
  onDone,
  className,
}: {
  title: string;
  lines: TermLine[];
  play?: boolean;
  startDelay?: number;
  onDone?: () => void;
  className?: string;
}) {
  const [instant] = useState(() => !play || prefersReducedMotion());
  const [pos, setPos] = useState(() => ({ line: instant ? lines.length : 0, char: 0 }));
  const done = pos.line >= lines.length;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (done) {
      onDoneRef.current?.();
      return;
    }
    const current = lines[pos.line];
    if (!current) return;
    const atStart = pos.line === 0 && pos.char === 0;
    let ms: number;
    let next: { line: number; char: number };
    if (current.kind === "output") {
      ms = OUTPUT_PAUSE_MS;
      next = { line: pos.line + 1, char: 0 };
    } else if (pos.char < current.text.length) {
      ms = CHAR_MS;
      next = { line: pos.line, char: pos.char + 1 };
    } else {
      ms = PROMPT_PAUSE_MS;
      next = { line: pos.line + 1, char: 0 };
    }
    const t = window.setTimeout(() => setPos(next), ms + (atStart ? startDelay : 0));
    return () => window.clearTimeout(t);
  }, [pos, done, lines, startDelay]);

  const current = lines[pos.line];

  return (
    <Terminal title={title} className={className}>
      <div className="relative">
        <div className="invisible" aria-hidden="true">
          {lines.map(renderLine)}
        </div>
        <p className="sr-only">{lines.map((l) => l.text).join("\n")}</p>
        <div aria-hidden="true" className="absolute inset-0">
          {lines.slice(0, pos.line).map(renderLine)}
          {!done && current?.kind === "prompt" ? (
            <Prompt>
              {current.text.slice(0, pos.char)}
              <Caret />
            </Prompt>
          ) : null}
        </div>
      </div>
    </Terminal>
  );
}
