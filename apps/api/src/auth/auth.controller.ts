import { BadRequestException, Body, Controller, Get, HttpCode, Ip, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto, RefreshDto, LogoutDto, UpdateProfileDto, ChangePasswordDto, TotpCodeDto, CliExchangeDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthedUser } from './jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';
import { AuditService } from '../audit/audit.service';
import { EnvService } from '../config/env.service';
import { ACCESS_COOKIE_MAX_AGE_MS, REFRESH_COOKIE, clearAccessCookie, clearRefreshCookie, readCookie, setAccessCookie, setRefreshCookie } from './cookies';

type AuthedRequest = Request & { user?: AuthedUser };

/** CLI sign-in codes: single-use, 5-minute TTL (long enough to paste manually). */
const CLI_CODE_TTL_MS = 5 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
    private readonly env: EnvService,
  ) {}

  @Post('signup')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async signup(@Body() dto: SignupDto, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.signup(dto, ip);
    setRefreshCookie(res, result.refreshToken, 30 * 24 * 60 * 60 * 1000);
    setAccessCookie(res, result.accessToken, ACCESS_COOKIE_MAX_AGE_MS);
    return result;
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // plan req #8: rate limit login
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, ip);
    setRefreshCookie(res, result.refreshToken, 30 * 24 * 60 * 60 * 1000);
    setAccessCookie(res, result.accessToken, ACCESS_COOKIE_MAX_AGE_MS);
    return result;
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async refresh(
    @Req() req: AuthedRequest,
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    // M5: prefer the httpOnly cookie; fall back to the body value for the CLI
    // (which can't use cookies). Both are rotated server-side.
    const token = readCookie(req, REFRESH_COOKIE) ?? dto.refreshToken;
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const result = await this.auth.refresh(token, ip);
    setRefreshCookie(res, result.refreshToken, 30 * 24 * 60 * 60 * 1000);
    setAccessCookie(res, result.accessToken, ACCESS_COOKIE_MAX_AGE_MS);
    return result;
  }

  @Post('logout')
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 30 } }) // L1: throttle for consistency
  async logout(
    @Req() req: AuthedRequest,
    @Body() dto: LogoutDto,
    @CurrentUser() user?: AuthedUser,
    @Ip() ip?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const token = readCookie(req, REFRESH_COOKIE) ?? dto.refreshToken;
    if (token) await this.auth.logout(token, user?.id, ip);
    if (res) {
      clearRefreshCookie(res);
      clearAccessCookie(res);
    }
  }

  // ── Two-factor authentication (review M4) ─────────────────────────────

  /** Start 2FA setup: returns the base32 secret + otpauth:// URL. */
  @Post('totp/setup')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  totpSetup(@CurrentUser() user: AuthedUser) {
    return this.totp.startSetup(user.id, user.email);
  }

  /** Confirm a code from the authenticator app and enable 2FA. */
  @Post('totp/enable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  totpEnable(@CurrentUser() user: AuthedUser, @Body() dto: TotpCodeDto, @Ip() ip: string) {
    return this.totp.enable(user.id, dto.code, ip);
  }

  /** Disable 2FA (requires a valid current code). */
  @Post('totp/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  totpDisable(@CurrentUser() user: AuthedUser, @Body() dto: TotpCodeDto, @Ip() ip: string) {
    return this.totp.disable(user.id, dto.code, ip);
  }

  /** Is 2FA enabled? (For the account page.) */
  @Get('totp/status')
  @UseGuards(JwtAuthGuard)
  totpStatus(@CurrentUser() user: AuthedUser) {
    return this.totp.status(user.id);
  }

  // ── Browser-based CLI login (`forge login`) ───────────────────────────
  // The CLI opens /auth/cli/start here → we bounce to the web app's approve
  // page. The user signs in with ANY method (password, Google, GitHub — with
  // 2FA) and approves; the web app mints a single-use code and hands it to
  // the waiting CLI (localhost redirect or manual paste). This is what lets
  // OAuth-only accounts (passwordHash = null) use the CLI at all.

  /** Entry point opened by the CLI: validate params, then 302 to the web app. */
  @Get('cli/start')
  cliStart(@Query('port') port: string, @Query('state') state: string, @Res() res: Response) {
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535 || !/^[a-f0-9]{16,64}$/.test(state ?? '')) {
      throw new BadRequestException('Invalid CLI login parameters — run `forge login` again');
    }
    res.redirect(`${this.env.webOrigin}/cli-auth?port=${portNum}&state=${state}`);
  }

  /** Mint a single-use CLI sign-in code for the logged-in user (web approve page). */
  @Post('cli/authorize')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async cliAuthorize(@CurrentUser() user: AuthedUser) {
    const code = randomBytes(32).toString('base64url');
    await this.prisma.cliAuthCode.create({
      data: {
        codeHash: createHash('sha256').update(code).digest('hex'),
        userId: user.id,
        expiresAt: new Date(Date.now() + CLI_CODE_TTL_MS),
      },
    });
    return { code };
  }

  /** The CLI redeems the code for a real token pair. */
  @Post('cli/exchange')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async cliExchange(@Body() dto: CliExchangeDto, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const codeHash = createHash('sha256').update(dto.code).digest('hex');
    const row = await this.prisma.cliAuthCode.findUnique({
      where: { codeHash },
      include: { user: true },
    });
    if (!row || row.consumedAt || row.expiresAt < new Date()) {
      throw new UnauthorizedException('This CLI sign-in code is invalid or has expired — run `forge login` again');
    }
    await this.prisma.cliAuthCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    const tokens = await this.auth.issueTokens(row.user.id, row.user.email, 'cli', ip);
    await this.audit.record({
      action: 'USER_LOGIN',
      userId: row.user.id,
      resource: `user/${row.user.id}`,
      ip,
      meta: { device: 'cli' },
    });

    setRefreshCookie(res, tokens.refreshToken, 30 * 24 * 60 * 60 * 1000);
    setAccessCookie(res, tokens.accessToken, ACCESS_COOKIE_MAX_AGE_MS);
    return { ...tokens, user: { id: row.user.id, email: row.user.email, name: row.user.name } };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthedUser) {
    return this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() user: AuthedUser, @Body() dto: UpdateProfileDto, @Ip() ip: string) {
    return this.auth.updateProfile(user.id, dto.name, ip);
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  changePassword(
    @Req() req: AuthedRequest,
    @CurrentUser() user: AuthedUser,
    @Body() dto: ChangePasswordDto,
    @Body('refreshToken') refreshToken: string | undefined,
    @Ip() ip: string,
  ) {
    // Web sends its refresh token via the httpOnly cookie (never JS-readable);
    // the CLI may pass it in the body instead.
    const current = readCookie(req, REFRESH_COOKIE) ?? refreshToken;
    return this.auth.changePassword(user.id, dto, current, ip);
  }
}
