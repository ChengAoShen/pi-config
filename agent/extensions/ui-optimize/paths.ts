import { realpathSync } from "node:fs";

export function getCodingAgentRoot(): string {
  const cli = process.argv[1];
  if (!cli) return "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent";

  try {
    const realCli = realpathSync(cli);
    const marker = "/@earendil-works/pi-coding-agent/dist/";
    const index = realCli.indexOf(marker);
    if (index >= 0) return realCli.slice(0, index + "/@earendil-works/pi-coding-agent".length);
  } catch {
    // Ignore and fall back to the Homebrew/global install path below.
  }

  return "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent";
}
