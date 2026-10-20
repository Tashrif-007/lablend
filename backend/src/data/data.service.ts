import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { LabData } from '../domain/types';

// data.json (in the group folder, whatever the working directory) is read
// here and written only by LoansService.createLoan, which runs inside
// withLock so a check and its write cannot interleave.
@Injectable()
export class DataService {
  private readonly file = process.env.DATA_FILE ?? join(__dirname, '..', '..', '..', 'data.json');
  private queue: Promise<unknown> = Promise.resolve();

  async read(): Promise<LabData> {
    const raw = await fs.readFile(this.file, 'utf8');
    return JSON.parse(raw) as LabData;
  }

  async write(data: LabData): Promise<void> {
    const tmp = join(dirname(this.file), `.data.json.${process.pid}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
    await fs.rename(tmp, this.file);
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
