/** One raw-mode chunk applied to the key typed so far. */
export interface SecretInput {
  buf: string;
  /** Set when a terminator arrived: Enter / Ctrl-D end the input, Ctrl-C
   *  (or Ctrl-D on an empty line) cancels it. Later characters are dropped. */
  end?: "submit" | "cancel";
}

/** Raw-mode editing: Enter submits, DEL/backspace delete, Ctrl-C cancels,
 *  Ctrl-D ends the input (cancels when nothing was typed, like a shell). */
export function feedSecret(buf: string, chunk: string): SecretInput {
  for (const c of chunk) {
    if (c === "\r" || c === "\n") return { buf, end: "submit" };
    if (c === "\u0003") return { buf, end: "cancel" };
    if (c === "\u0004") return { buf, end: buf === "" ? "cancel" : "submit" };
    buf = c === "\u007f" || c === "\b" ? buf.slice(0, -1) : buf + c;
  }
  return { buf };
}

/**
 * Read a secret without echoing it. From a pipe (`echo "$K" | reins key set`)
 * read all of stdin; on a terminal, prompt on stderr and read in raw mode so
 * the key never lands in scrollback or shell history.
 */
export async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    let buf = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      resolve(buf);
    };
    const onData = (chunk: string) => {
      const next = feedSecret(buf, chunk);
      buf = next.buf;
      if (next.end === "submit") return done();
      if (next.end === "cancel") {
        stdin.setRawMode(false);
        process.stderr.write("\n");
        process.exit(130);
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}
