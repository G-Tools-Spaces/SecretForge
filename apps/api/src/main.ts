import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as dotenv from 'dotenv';
import { AppModule } from './app.module';
import { EnvService } from './config/env.service';

// Load .env before anything reads process.env.
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const env = app.get(EnvService);

  // Security headers. The API is JSON-only; CORS is restricted to the web origin.
  app.use(helmet());
  app.enableCors({
    origin: env.webOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // Global DTO validation: reject unknown/ill-typed payloads.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Trust the reverse proxy (Caddy/Nginx) so req.ip is the real client IP
  // for rate limiting and audit logs.
  app.set('trust proxy', 1);

  app.enableShutdownHooks();
  await app.listen(env.port);
  console.log(`SecretForge API listening on :${env.port} (${env.nodeEnv})`);
}

bootstrap().catch((err) => {
  console.error('Failed to start SecretForge API:', err.message);
  process.exit(1);
});
