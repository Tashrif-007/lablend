import { Module } from '@nestjs/common';
import { AgentService } from './agent/agent.service';
import { AGENT, ChatAgent } from './agent/chat-agent';
import { ChatController } from './agent/chat.controller';
import { ClaudeSdkAgent } from './agent/claude-sdk';
import { LLM, OpenAiCompatibleLlm } from './agent/llm';
import { DataService } from './data/data.service';
import { LoansController } from './loans/loans.controller';
import { LoansService } from './loans/loans.service';

@Module({
  controllers: [LoansController, ChatController],
  providers: [
    DataService,
    LoansService,
    AgentService,
    { provide: LLM, useFactory: () => new OpenAiCompatibleLlm() },
    {
      // LLM_PROVIDER=claude-sdk uses the Claude Agent SDK; anything else uses
      // the OpenAI-compatible model set by LLM_BASE_URL / LLM_MODEL.
      provide: AGENT,
      inject: [AgentService, LoansService],
      useFactory: (loop: AgentService, loans: LoansService): ChatAgent =>
        process.env.LLM_PROVIDER === 'claude-sdk' ? new ClaudeSdkAgent(loans) : loop,
    },
  ],
})
export class AppModule {}
