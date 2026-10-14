import { Body, Controller, Get, HttpCode, Ip, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto, RefreshDto, LogoutDto, UpdateProfileDto, ChangePasswordDto, TotpCodeDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthedUser } from './jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';
import { REFRESH_COOKIE, clearRefreshCookie, readCookie, setRefreshCookie } from './cookies';

type AuthedRequest = Request & { user?: AuthedUser };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
  ) {}

  @Post('signup')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async signup(@Body() dto: SignupDto, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.signup(dto, ip);
    setRefreshCookie(res, result.refreshToken, 30 * 24 * 60 * 60 * 1000);
    return result;
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // plan req #8: rate limit login
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, ip);
    setRefreshCookie(res, result.refreshToken, 30 * 24 * 60 * 60 * 1000);
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
    const result = await this.auth.refresh(token, ip);
    setRefreshCookie(res, result.refreshToken, 30 * 24 * 60 * 60 * 1000);
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
    await this.auth.logout(token, user?.id, ip);
    if (res) clearRefreshCookie(res);
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
    @CurrentUser() user: AuthedUser,
    @Body() dto: ChangePasswordDto,
    @Body('refreshToken') refreshToken: string | undefined,
    @Ip() ip: string,
  ) {
    return this.auth.changePassword(user.id, dto, refreshToken, ip);
  }
}
