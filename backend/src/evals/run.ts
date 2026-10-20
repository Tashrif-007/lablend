import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AgentService } from '../agent/agent.service';
import { ClaudeSdkAgent } from '../agent/claude-sdk';
import { loadEnv } from '../agent/env';
import { OpenAiCompatibleLlm } from '../agent/llm';
import { isPromptVersion, PROMPT_VERSIONS, PromptVersion } from '../agent/prompt';
import { AgentFactory, EvalRun, runEvals, toMarkdown } from './runner';

// npm run eval [-- --prompts v1,v2] [--provider claude-sdk]
// Runs the five cases with each prompt version against the model set in .env
// and writes evals/results/latest.md and latest.json in the group folder.

const root = join(__dirname, '..', '..', '..');

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const versions = (flag('--prompts')?.split(',') ?? PROMPT_VERSIONS).filter(isPromptVersion) as PromptVersion[];
  const provider = flag('--provider') ?? process.env.LLM_PROVIDER;

  let backend: string;
  let makeAgent: AgentFactory;
  if (provider === 'claude-sdk') {
    backend = `Claude Agent SDK${process.env.CLAUDE_MODEL ? ` (${process.env.CLAUDE_MODEL})` : ''}`;
    makeAgent = (loans) => new ClaudeSdkAgent(loans);
  } else if (process.env.LLM_BASE_URL && process.env.LLM_MODEL) {
    backend = `${process.env.LLM_MODEL} at ${process.env.LLM_BASE_URL}`;
    makeAgent = (loans) => new AgentService(new OpenAiCompatibleLlm(), loans);
  } else {
    console.error('No model set. Put LLM_PROVIDER=claude-sdk, or LLM_BASE_URL and LLM_MODEL, in .env (see .env.example).');
    process.exitCode = 1;
    return;
  }

  const dataFile = process.env.DATA_FILE ?? join(root, 'data.json');
  const runs: EvalRun[] = [];
  for (const promptVersion of versions) {
    console.log(`\nPrompt ${promptVersion} · ${backend}`);
    const run = await runEvals({
      dataFile,
      promptVersion,
      backend,
      makeAgent,
      onConversation: (id, r) => console.log(`  ${r.failures.length ? 'FAIL' : 'pass'}  ${id}. ${r.label}${r.failures.length ? `: ${r.failures.join('; ')}` : ''}`),
    });
    console.log(`  ${run.passed}/${run.total} cases, ${run.conversationsPassed}/${run.conversationsTotal} conversations`);
    runs.push(run);
  }

  const out = join(root, 'evals', 'results');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'latest.md'), toMarkdown(runs));
  writeFileSync(join(out, 'latest.json'), JSON.stringify(runs, null, 2) + '\n');
  console.log(`\nWrote ${join(out, 'latest.md')}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
