import { join, resolve } from 'path';

// npm run mcp:config prints ready-to-paste MCP settings for each coding agent,
// with the absolute path to the server on this machine. The server itself is
// the same for all of them: `node <path>/backend/dist/mcp/main.js` over stdio.

const server = resolve(join(__dirname, 'main.js')).replace(/\\/g, '/');
const json = JSON.stringify({ mcpServers: { lablend: { command: 'node', args: [server] } } }, null, 2);

const sections: [string, string][] = [
  ['Claude Code', `claude mcp add lablend -- node "${server}"\n(or run \`claude\` inside projects/group-4: .mcp.json is already there)`],
  ['Codex', `codex mcp add lablend -- node "${server}"\n\nor in ~/.codex/config.toml:\n[mcp_servers.lablend]\ncommand = "node"\nargs = ["${server}"]`],
  ['Gemini CLI', `gemini mcp add lablend node "${server}"\n(or run \`gemini\` inside projects/group-4: .gemini/settings.json is already there)`],
  ['Cursor', `Open projects/group-4 as the workspace (.cursor/mcp.json is already there), or add to ~/.cursor/mcp.json:\n${json}`],
  ['Antigravity', `Agent panel → … → MCP Servers → Manage MCP Servers → View raw config, then add to mcp_config.json:\n${json}`],
  ['Any other MCP client', `command: node\nargs:    ${server}\ntransport: stdio`],
];

console.log(`LabLend MCP server: ${server}\n`);
for (const [name, text] of sections) {
  console.log(`== ${name} ==\n${text}\n`);
}
