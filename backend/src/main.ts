import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadEnv } from './agent/env';
import { AppModule } from './app.module';

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');

  // Serve the built React app so `npm start` runs the whole thing on one port.
  const ui = join(process.cwd(), '..', 'frontend', 'dist');
  if (existsSync(ui)) app.useStaticAssets(ui);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
