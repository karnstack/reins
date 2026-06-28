#!/usr/bin/env node
// `reins` CLI — M0 stub. Real commands (pair/status/doctor) arrive in M1.
const [command] = process.argv.slice(2);
if (command) {
  console.log(`reins: unknown command '${command}' (CLI commands land in M1)`);
} else {
  console.log("reins CLI — commands land in M1 (pair, status, doctor)");
}
