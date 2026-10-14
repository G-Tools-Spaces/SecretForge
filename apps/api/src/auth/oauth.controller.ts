import { Body, Controller, Get, HttpCode, Ip, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { setRefreshCookie } from './cookies';
import { EnvService } from '../config/env.service';
import { OAuthService, OAuthProvider } from './oauth.service';
import { OAuthExchangeDto } from './dto';

/** Only same-origin absolute paths may be used as post-login redirects. */
function safeNext(next?: string): string | undefined {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return undefined;
}

/**
 * Social sign-in endpoints. All public — the browser lands here straight from
 * the provider consent screen. See OAuthService for the flow and threat notes.
 */
@Controller('auth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly env: EnvService,
  ) {}

  /** Which social providers are configured — the login page shows buttons accordingly. */
  @Get('providers')
  providers() {
    return { google: this.oauth.isEnabled('google'), github: this.oauth.isEnabled('github') };
  }

  @Get(':provider(google|github)')
  async authorize(@Param('provider') provider: OAuthProvider, @Query('next') next: string | undefined, @Res() res: Response) {
    if (!this.oauth.isEnabled(provider)) throw new NotFoundException('This sign-in provider is not configured');
    res.redirect(await this.oauth.authorizeUrl(provider, safeNext(next)));
  }

  @Get(':provider(google|github)/callback')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async callback(
    @Param('provider') provider: OAuthProvider,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Ip() ip: string,
    @Res() res: Response,
  ) {
    const target = (query: string) => res.redirect(`${this.env.webOrigin}/auth/callback${query}`);

    if (!this.oauth.isEnabled(provider)) throw new NotFoundException('This sign-in provider is not configured');
    if (!code || !state) return target('?error=Missing sign-in response from the provider');

    let next: string | undefined;
    try {
      ({ next } = await this.oauth.consumeState(state));
      const { exchangeCode } = await this.oauth.handleCallback(provider, code, ip);
      const params = new URLSearchParams({ code: exchangeCode });
      if (next) params.set('next', next);
      return target(`?${params}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Social sign-in failed';
      return target(`?error=${encodeURIComponent(message)}`);
    }
  }

  /** Redeem the single-use code from the callback redirect for real tokens. */
  @Post('oauth/exchange')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async exchange(@Body() dto: OAuthExchangeDto, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.oauth.exchange(dto.code, ip);
    setRefreshCookie(res, result.refreshToken, 30 * 24 * 60 * 60 * 1000);
    return result;
  }
}
