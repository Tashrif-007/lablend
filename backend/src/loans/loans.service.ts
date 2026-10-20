import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataService } from '../data/data.service';
import { looksLikeInstruction } from '../domain/guardrails';
import { availableStock, checkLoan, refuse } from '../domain/loan-rules';
import { CheckResult, Loan } from '../domain/types';

export type CreateResult = CheckResult | { ok: true; loan: Loan };

// The three tools: list_equipment, check_stock, create_loan.
@Injectable()
export class LoansService {
  constructor(private readonly store: DataService) {}

  async listEquipment(query?: string) {
    const data = await this.store.read();
    const q = query?.trim().toLowerCase();
    return data.equipment
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .map((e) => ({
        ...e,
        available: availableStock(data, e.id, e.stock),
        // Notes are shown to people but flagged when they read like an
        // instruction. They never change the limits either way.
        notesFlagged: looksLikeInstruction(e.notes),
      }));
  }

  async listLoans(studentId?: string) {
    const data = await this.store.read();
    return data.loans.filter((l) => !studentId || l.studentId === studentId);
  }

  async checkStock(input: unknown): Promise<CheckResult> {
    return checkLoan(input, await this.store.read());
  }

  // Re-checks the hard rule itself, even if checkStock was called first.
  // Saves only when approved is exactly true.
  createLoan(input: unknown, approved: unknown): Promise<CreateResult> {
    return this.store.withLock(async () => {
      const data = await this.store.read();
      const result = checkLoan(input, data);
      if (!result.ok) return result;
      if (approved !== true) {
        return refuse([{ code: 'NOT_APPROVED', reason: 'A person must approve the loan before it is saved.' }]);
      }
      const loan: Loan = {
        id: randomUUID(),
        studentId: result.proposal.studentId,
        itemId: result.proposal.itemId,
        quantity: result.proposal.quantity,
        days: result.proposal.days,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      data.loans.push(loan);
      await this.store.write(data);
      return { ok: true, loan };
    });
  }
}
