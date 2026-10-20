import { createInterface } from 'readline';
import { DataService } from '../data/data.service';
import { LoansService } from '../loans/loans.service';
import { createTools } from '../tools/tools';
import { McpServer } from './mcp-server';

// Entry point: `node dist/mcp/main.js`. stdout carries only protocol messages;
// logs go to stderr.
const server = new McpServer(createTools(new LoansService(new DataService())));
const send = (r: unknown): void => {
  process.stdout.write(JSON.stringify(r) + '\n');
};

// Handle messages one at a time so replies keep the order of the requests.
let queue: Promise<void> = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  queue = queue.then(async () => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const reply = await server.handle(message);
    if (reply) send(reply);
  });
});
console.error('lablend MCP server ready on stdio');
