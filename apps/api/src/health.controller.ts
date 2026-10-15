import { Controller, Get, Head } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

// Lightweight liveness probe for uptime pings (e.g. Render free tier keep-alive).
// No auth, no DB access, so it stays cheap and never leaks data.
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }

  @Head()
  head() {
    return;
  }
}
