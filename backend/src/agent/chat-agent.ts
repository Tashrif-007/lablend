import { ChatReply, ChatTurn } from './agent.service';

// What the chat endpoint needs. Two backends implement it: AgentService (our
// loop over any OpenAI-compatible model) and ClaudeSdkAgent (Claude Agent SDK).
export interface ChatAgent {
  chat(history: ChatTurn[], studentId: string): Promise<ChatReply>;
}

export const AGENT = Symbol('AGENT');
