'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { OrgShell } from '@/components/shell/AppShell';
import { PageHeader, InlineError } from '@/components/ui';
import { useToast } from '@/components/Toast';
import TotpQr from '@/components/TotpQr';

/** Account settings: display name and password. */
export default function AccountPage() {
  const router = useRouter();
  const { user, loading, refresh } = useUser();
  const toast = useToast();

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  // Two-factor authentication (review M4)
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (user) setName(user.name ?? '');
  }, [user]);

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/totp/status')
      .then((s) => setTotpEnabled(s.enabled))
      .catch(() => {});
  }, []);

  if (loading || !user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  const saveName = async () => {
    if (!name.trim() || name.trim() === (user.name ?? '')) return;
    setSavingName(true);
    try {
      await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      await refresh();
      toast.show('Profile updated');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to update', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async () => {
    setPwError(null);
    if (newPassword.length < 10) {
      setPwError('New password must be at least 10 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match');
      return;
    }
    setChangingPw(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          refreshToken: localStorage.getItem('sf_refresh_token') ?? undefined,
        }),
      });
      toast.show('Password changed — other sessions were signed out');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPw(false);
    }
  };

  const startTotpSetup = async () => {
    setTotpError(null);
    setTotpBusy(true);
    try {
      const setup = await api<{ secret: string; otpauthUrl: string }>('/auth/totp/setup', { method: 'POST' });
      setTotpSetup(setup);
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Failed to start 2FA setup');
    } finally {
      setTotpBusy(false);
    }
  };

  const enableTotp = async () => {
    setTotpError(null);
    if (totpCode.length !== 6) {
      setTotpError('Enter the 6-digit code from your app');
      return;
    }
    setTotpBusy(true);
    try {
      await api('/auth/totp/enable', { method: 'POST', body: JSON.stringify({ code: totpCode }) });
      setTotpEnabled(true);
      setTotpSetup(null);
      setTotpCode('');
      toast.show('Two-factor authentication enabled');
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Failed to enable 2FA');
    } finally {
      setTotpBusy(false);
    }
  };

  const disableTotp = async () => {
    setTotpError(null);
    if (totpCode.length !== 6) {
      setTotpError('Enter your current 6-digit code to disable 2FA');
      return;
    }
    setTotpBusy(true);
    try {
      await api('/auth/totp/disable', { method: 'POST', body: JSON.stringify({ code: totpCode }) });
      setTotpEnabled(false);
      setTotpCode('');
      toast.show('Two-factor authentication disabled');
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Failed to disable 2FA');
    } finally {
      setTotpBusy(false);
    }
  };

  return (
    <OrgShell>
      <div className="page" style={{ maxWidth: 640 }}>
        <PageHeader title="Account" description={user.email} />

        {/* Profile */}
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-header">
            <h2>Profile</h2>
          </div>
          <div className="panel-body">
            <div className="field">
              <label className="field-label" htmlFor="acct-name">
                Display name
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="acct-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary"
                  disabled={savingName || !name.trim() || name.trim() === (user.name ?? '')}
                  onClick={saveName}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="acct-email">
                Email
              </label>
              <input id="acct-email" className="input" value={user.email} disabled />
              <p className="field-help">Email is your login identity and can't be changed.</p>
            </div>
          </div>
        </section>

        {/* Password */}
        <section className="panel">
          <div className="panel-header">
            <h2>Change password</h2>
          </div>
          <div className="panel-body">
            <div className="field">
              <label className="field-label" htmlFor="pw-current">
                Current password
              </label>
              <input
                id="pw-current"
                className="input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pw-new">
                New password
              </label>
              <input
                id="pw-new"
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="field-help">At least 10 characters.</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pw-confirm">
                Confirm new password
              </label>
              <input
                id="pw-confirm"
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <InlineError message={pwError} />
            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                disabled={changingPw || !currentPassword || !newPassword || !confirmPassword}
                onClick={changePassword}
              >
                {changingPw ? 'Changing…' : 'Change password'}
              </button>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
              Changing your password signs out all other sessions (CLI and other browsers).
            </p>
          </div>
        </section>

        {/* Two-factor authentication (review M4) */}
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-header">
            <h2>Two-factor authentication</h2>
          </div>
          <div className="panel-body">
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {totpEnabled
                ? '2FA is enabled — a code from your authenticator app is required at sign-in.'
                : 'Add a second factor (TOTP — Google Authenticator, 1Password, etc.) to your account.'}
            </p>

            {totpEnabled ? (
              <>
                <div className="field" style={{ marginTop: 14 }}>
                  <label className="field-label" htmlFor="totp-disable">
                    Current 2FA code
                  </label>
                  <input
                    id="totp-disable"
                    className="input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    style={{ letterSpacing: '0.2em' }}
                  />
                </div>
                <InlineError message={totpError} />
                <div style={{ marginTop: 12 }}>
                  <button className="btn" disabled={totpBusy} onClick={disableTotp}>
                    {totpBusy ? 'Disabling…' : 'Disable 2FA'}
                  </button>
                </div>
              </>
            ) : totpSetup ? (
              <>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <TotpQr value={totpSetup.otpauthUrl} size={176} />
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    <strong>1.</strong> Scan the QR code with your authenticator app.
                  </p>
                </div>

                <div className="notice" style={{ marginTop: 14, fontSize: 13 }}>
                  <p style={{ margin: '0 0 6px' }}>
                    <strong>2.</strong> Can't scan? Enter this secret manually:
                  </p>
                  <code
                    style={{
                      display: 'block',
                      padding: '6px 10px',
                      background: 'var(--bg-2)',
                      borderRadius: 6,
                      fontSize: 13,
                      wordBreak: 'break-all',
                      userSelect: 'all',
                    }}
                  >
                    {totpSetup.secret}
                  </code>
                  <p style={{ margin: '10px 0 0' }}>
                    <strong>3.</strong> Enter the 6-digit code the app shows to confirm and enable.
                  </p>
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label className="field-label" htmlFor="totp-enable">
                    Verification code
                  </label>
                  <input
                    id="totp-enable"
                    className="input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    style={{ letterSpacing: '0.2em' }}
                  />
                </div>
                <InlineError message={totpError} />
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" disabled={totpBusy} onClick={enableTotp}>
                    {totpBusy ? 'Verifying…' : 'Enable 2FA'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setTotpSetup(null);
                      setTotpCode('');
                      setTotpError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <InlineError message={totpError} />
                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-primary" disabled={totpBusy} onClick={startTotpSetup}>
                    {totpBusy ? 'Starting…' : 'Set up 2FA'}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </OrgShell>
  );
}
