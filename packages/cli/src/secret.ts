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
      for (const c of chunk) {
        if (c === "\r" || c === "\n") return done();
        if (c === "\u0003") {
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        buf = c === "\u007f" ? buf.slice(0, -1) : buf + c;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}
