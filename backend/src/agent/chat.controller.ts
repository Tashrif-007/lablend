import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, ServiceUnavailableException } from '@nestjs/common';
import { ChatReply, ChatTurn } from './agent.service';
import { AGENT, ChatAgent } from './chat-agent';
import { ChatUnavailable } from './llm';
import { activePromptVersion } from './prompt';

@Controller()
export class ChatController {
  constructor(@Inject(AGENT) private readonly agent: ChatAgent) {}

  // Which backend and prompt the chat uses, for the UI. Never shows a key.
  @Get('chat/status')
  status() {
    const sdk = process.env.LLM_PROVIDER === 'claude-sdk';
    return {
      provider: sdk ? 'claude-sdk' : 'openai-compatible',
      model: (sdk ? process.env.CLAUDE_MODEL : process.env.LLM_MODEL) || null,
      configured: sdk || Boolean(process.env.LLM_BASE_URL && process.env.LLM_MODEL),
      promptVersion: activePromptVersion(),
    };
  }

  @Post('chat')
  @HttpCode(200)
  async chat(@Body() body: { messages?: unknown; studentId?: unknown } | undefined): Promise<ChatReply> {
    const { messages, studentId } = body ?? {};
    if (typeof studentId !== 'string' || !studentId.trim()) throw new BadRequestException('studentId is required.');
    const valid =
      Array.isArray(messages) &&
      messages.length > 0 &&
      messages.every((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string') &&
      messages[messages.length - 1].role === 'user';
    if (!valid) throw new BadRequestException('messages must be a list of { role, content } ending with a user message.');
    try {
      return await this.agent.chat(messages as ChatTurn[], studentId.trim());
    } catch (err) {
      if (err instanceof ChatUnavailable) throw new ServiceUnavailableException(err.message);
      throw new ServiceUnavailableException('The chat agent could not reach the model. Try again.');
    }
  }
}
