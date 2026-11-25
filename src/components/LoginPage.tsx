import { signInWithPopup } from 'firebase/auth';
import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  EyeOff,
  FileCheck2,
  Gavel,
  Handshake,
  Headphones,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Settings,
  ShieldCheck,
  TrendingUp,
  Trophy,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import type { CrmUserSession } from '../types/crm';
import { safeReadJsonResponse } from '../utils/httpHelpers';

interface LoginPageProps {
  onLoginSuccess: (
    session: CrmUserSession,
    rememberMe: boolean,
    serverMeta?: { sessionToken?: string },
  ) => void;
  disabledNotice?: string | null;
  onDismissDisabledNotice?: () => void;
}

function VanshBrandEmblem({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="vanshLeftWing" x1="8" y1="6" x2="36" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E40AF" />
          <stop offset="100%" stopColor="#0EA5E9" />
        </linearGradient>
        <linearGradient id="vanshRightWing" x1="28" y1="48" x2="58" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0284C7" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <path
        d="M6 10C12 10 18.5 11.5 22.5 19.5L32.5 41.5L26 51.5C23 48.5 19.5 41.5 14.5 29.5C11.5 22 8.5 15 6 10Z"
        fill="url(#vanshLeftWing)"
      />
      <path
        d="M58 9.5C50 8.5 42.5 12.5 37.5 22.5L25.5 47.5L32.5 52C36 47.5 40 39 45.5 27.5C49.5 19 54 13.5 58 9.5Z"
        fill="url(#vanshRightWing)"
      />
      <path
        d="M20 12C24 14 27 19.5 29.5 25.5L33 33.5L28 38.5L23.5 26.5C21.5 21 19 15.5 16 12.5L20 12Z"
        fill="#38BDF8"
        fillOpacity="0.85"
      />
    </svg>
  );
}

const FEATURE_HIGHLIGHTS = [
  { label: 'Tender Management', icon: Gavel },
  { label: 'Bid Tracking', icon: FileCheck2 },
  { label: 'OEM Management', icon: Handshake },
  { label: 'Business Analytics', icon: TrendingUp },
  { label: 'Task Management', icon: ClipboardCheck },
];

export function LoginPage({
  onLoginSuccess,
  disabledNotice = null,
  onDismissDisabledNotice,
}: LoginPageProps) {
  const [authView, setAuthView] = useState<'login' | 'setup' | 'reset' | 'signup'>('login');
  const [needsInitialSetup, setNeedsInitialSetup] = useState(false);
  const [bootstrapChecked, setBootstrapChecked] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [disabledModalMessage, setDisabledModalMessage] = useState<string | null>(
    disabledNotice ?? null,
  );

  // First-time Company & Owner Setup state
  const [setupCompanyName, setSetupCompanyName] = useState('');
  const [setupGstin, setSetupGstin] = useState('');
  const [setupUdyamNumber, setSetupUdyamNumber] = useState('');
  const [setupUsername, setSetupUsername] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState('');

  useEffect(() => {
    if (disabledNotice) {
      setDisabledModalMessage(disabledNotice);
    }
  }, [disabledNotice]);

  useEffect(() => {
    let cancelled = false;
    const checkBootstrap = async () => {
      try {
        const res = await fetch('/api/auth/bootstrap-status');
        const parsed = await safeReadJsonResponse<{ ok?: boolean; needsSetup?: boolean }>(res);
        if (!cancelled && parsed.ok && parsed.data?.ok) {
          const needed = Boolean(parsed.data.needsSetup);
          setNeedsInitialSetup(needed);
          if (needed) {
            setAuthView('setup');
          }
        }
      } catch {
        // Non-fatal: keep login screen accessible
      } finally {
        if (!cancelled) setBootstrapChecked(true);
      }
    };
    void checkBootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismissDisabledModal = () => {
    setDisabledModalMessage(null);
    onDismissDisabledNotice?.();
  };

  // Forgot Password / Reset Password flow (server identifier -> email OTP or Google -> New Password)
  const [resetMode, setResetMode] = useState<'request' | 'verify_otp' | 'set_password'>('request');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetTargetUser, setResetTargetUser] = useState<{
    userId: string;
    username: string;
    maskedEmail: string;
  } | null>(null);
  const [resetAuthMethod, setResetAuthMethod] = useState<'otp' | 'google'>('otp');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  const [resetError, setResetError] = useState('');
  const [smtpUnconfiguredNotice, setSmtpUnconfiguredNotice] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [verifiedToken, setVerifiedToken] = useState('');
  const [googleIdToken, setGoogleIdToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Create New Workspace / Team Member flow
  const [signupStep, setSignupStep] = useState<'email' | 'verify_otp' | 'credentials' | 'success'>('email');
  const [signupWorkspaceMode, setSignupWorkspaceMode] = useState<'new_company' | 'join_invite'>('new_company');
  const [signupCompanyName, setSignupCompanyName] = useState('');
  const [signupInviteCode, setSignupInviteCode] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupOtp, setSignupOtp] = useState('');
  const [signupOtpToken, setSignupOtpToken] = useState('');
  const [signupVerifiedToken, setSignupVerifiedToken] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [signupNotice, setSignupNotice] = useState('');
  const [createdUsernameLabel, setCreatedUsernameLabel] = useState('');

  useEffect(() => {
    if (authView !== 'signup' || signupStep !== 'success') return;
    const timer = window.setTimeout(() => {
      setAuthView('login');
      setSignupStep('email');
      if (createdUsernameLabel) {
        setUsername(createdUsernameLabel);
      }
      setPassword('');
      setSuccessMsg(
        `Successful ID Creation! You can now log in with your User ID "${createdUsernameLabel}" and password.`,
      );
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [authView, signupStep, createdUsernameLabel]);

  const handleSetupAdminSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCompany = setupCompanyName.trim();
    const cleanUsername = setupUsername.trim();
    const cleanEmail = setupEmail.trim().toLowerCase();

    if (cleanCompany.length < 2) {
      setSetupError('Please enter your Company / Firm Legal Name.');
      return;
    }
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(cleanUsername)) {
      setSetupError(
        'Owner User ID must be 3 to 40 characters (letters, numbers, "_", ".", or "-").',
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setSetupError('Please enter a valid Owner Email ID.');
      return;
    }
    if (setupPassword.length < 8) {
      setSetupError('Owner password must be at least 8 characters.');
      return;
    }
    if (setupPassword !== setupConfirmPassword) {
      setSetupError('Password and Confirm Password do not match.');
      return;
    }

    setSetupLoading(true);
    setSetupError('');
    try {
      const res = await fetch('/api/auth/setup-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: cleanCompany,
          gstin: setupGstin.trim().toUpperCase(),
          udyamNumber: setupUdyamNumber.trim().toUpperCase(),
          username: cleanUsername,
          email: cleanEmail,
          password: setupPassword,
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        sessionToken?: string;
        user?: CrmUserSession;
        error?: string;
      }>(res);
      const data = parsed.data;
      if (!res.ok || !data?.ok || !data.user) {
        setSetupError(
          data?.error || parsed.errorMessage || 'Could not initialize company workspace.',
        );
        return;
      }
      setNeedsInitialSetup(false);
      onLoginSuccess(data.user, true, { sessionToken: data.sessionToken });
    } catch {
      setSetupError('Unable to reach authentication server. Please retry.');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleGoogleContinue = async (options?: {
    companyName?: string;
    inviteCode?: string;
  }) => {
    setGoogleSubmitting(true);
    setErrorMsg('');
    setSetupError('');
    setSignupError('');
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const firebaseIdToken = await credential.user.getIdToken();
      const res = await fetch('/api/auth/firebase-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firebaseIdToken,
          ...(options?.companyName?.trim() ? { companyName: options.companyName.trim() } : {}),
          ...(options?.inviteCode?.trim() ? { inviteCode: options.inviteCode.trim() } : {}),
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        code?: string;
        sessionToken?: string;
        user?: CrmUserSession;
        error?: string;
      }>(res);
      const data = parsed.data;
      if (res.status === 403 && data?.code === 'ACCOUNT_DISABLED') {
        setDisabledModalMessage(
          data.error ||
            'Your CRM ID has been disabled by your Company Administrator. Please contact your administrator to regain access.',
        );
        return;
      }
      if (!res.ok || !data?.ok || !data.user) {
        setErrorMsg(
          data?.error || parsed.errorMessage || 'Google authentication failed. Please try again.',
        );
        return;
      }
      setNeedsInitialSetup(false);
      onLoginSuccess(data.user, rememberMe, { sessionToken: data.sessionToken });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.',
      );
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedUser = username.trim();
    if (!trimmedUser) {
      setErrorMsg('Please enter your User ID or Email ID.');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your Password.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmedUser,
          identifier: trimmedUser,
          password,
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        code?: string;
        username?: string;
        user?: CrmUserSession;
        sessionToken?: string;
        error?: string;
      }>(res);
      const data = parsed.data;

      if (res.status === 403 || data?.code === 'ACCOUNT_DISABLED') {
        setDisabledModalMessage(
          data?.error ||
            'Your CRM ID has been disabled by your Company Administrator. Please contact your administrator to regain access.',
        );
        return;
      }

      if (!res.ok || !data?.ok || !data.user) {
        setErrorMsg(
          data?.error ||
            parsed.errorMessage ||
            'Invalid User ID or password. Please check your credentials and try again.',
        );
        return;
      }

      if (data.user.isEnabled === false) {
        setDisabledModalMessage(
          'Your CRM ID has been disabled by your Company Administrator. Please contact your administrator to regain access.',
        );
        return;
      }

      onLoginSuccess(data.user, rememberMe, {
        sessionToken: data.sessionToken,
      });
    } catch {
      setErrorMsg('Unable to reach authentication server. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  const openForgotPasswordFlow = () => {
    const initialId = username.trim();
    setAuthView('reset');
    setResetMode('request');
    setResetIdentifier(initialId);
    setResetTargetUser(null);
    setResetAuthMethod('otp');
    setErrorMsg('');
    setSuccessMsg('');
    setResetError('');
    setResetNotice('');
    setSmtpUnconfiguredNotice(false);
    setOtpInput('');
    setOtpToken('');
    setVerifiedToken('');
    setGoogleIdToken('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

  const openCreateUserFlow = () => {
    setAuthView('signup');
    setSignupStep('email');
    setSignupWorkspaceMode('new_company');
    setSignupCompanyName('');
    setSignupInviteCode('');
    setSignupEmail('');
    setSignupOtp('');
    setSignupOtpToken('');
    setSignupVerifiedToken('');
    setSignupUsername('');
    setSignupPassword('');
    setSignupConfirmPassword('');
    setSignupError('');
    setSignupNotice('');
    setCreatedUsernameLabel('');
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleSendResetEmail = async () => {
    const identifier = resetIdentifier.trim();
    if (!identifier) {
      setResetError('Please enter your User ID or registered Gmail address first.');
      return;
    }

    setResetLoading(true);
    setResetError('');
    setResetNotice('');
    setSmtpUnconfiguredNotice(false);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        emailSent?: boolean;
        providerConfigured?: boolean;
        userId?: string;
        username?: string;
        maskedEmail?: string;
        otpToken?: string;
        message?: string;
        error?: string;
      }>(res);
      const data = parsed.data;

      if (!res.ok || !data?.ok) {
        setResetError(
          data?.error ||
            parsed.errorMessage ||
            `Could not find an account matching "${identifier}".`,
        );
        return;
      }

      const maskedEmail = data.maskedEmail || 'your registered email';
      const resolvedUsername = data.username || identifier;
      const resolvedUserId = data.userId || '';
      setResetTargetUser({
        userId: resolvedUserId,
        username: resolvedUsername,
        maskedEmail,
      });

      if (data.otpToken) {
        setOtpToken(data.otpToken);
      }
      if (data.emailSent) {
        setResetAuthMethod('otp');
        setOtpInput('');
        setVerifiedToken('');
        setResetNotice(data.message || `6-digit reset code sent to ${maskedEmail}.`);
        setResetMode('verify_otp');
      } else {
        setSmtpUnconfiguredNotice(true);
        setResetNotice(
          data.message ||
            `Email gateway is not configured yet. Verify via Google (${maskedEmail}) below to reset immediately.`,
        );
      }
    } catch {
      setResetError('Network error while contacting password reset service.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleVerifyResetCode = async (e: FormEvent) => {
    e.preventDefault();
    const cleanedOtp = otpInput.trim();
    const maskedEmail = resetTargetUser?.maskedEmail || 'your registered email';
    if (!/^\d{6}$/.test(cleanedOtp)) {
      setResetError(`Please enter the 6-digit verification code sent to ${maskedEmail}.`);
      return;
    }

    setResetLoading(true);
    setResetError('');
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp: cleanedOtp,
          otpToken,
          userId: resetTargetUser?.userId,
          identifier: resetTargetUser?.username || resetIdentifier.trim(),
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        verifiedToken?: string;
        userId?: string;
        username?: string;
        maskedEmail?: string;
        message?: string;
        error?: string;
      }>(res);
      const data = parsed.data;
      if (!res.ok || !data?.ok) {
        setResetError(
          data?.error ||
            parsed.errorMessage ||
            'Invalid 6-digit verification code. Please try again.',
        );
        return;
      }
      setVerifiedToken(data.verifiedToken || '');
      if (data.userId && data.username && data.maskedEmail) {
        setResetTargetUser({
          userId: data.userId,
          username: data.username,
          maskedEmail: data.maskedEmail,
        });
      }
      setResetAuthMethod('otp');
      setResetNotice(
        data.message || 'Verification code confirmed. Enter your new password below.',
      );
      setResetMode('set_password');
    } catch {
      setResetError('Network error while verifying reset code.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleVerifyGoogleForReset = async () => {
    const identifier = resetIdentifier.trim();
    if (!resetTargetUser?.userId && !identifier) {
      setResetError('Enter your User ID or registered Gmail address first.');
      return;
    }

    setResetLoading(true);
    setResetError('');
    setResetNotice('');
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const idToken = await credential.user.getIdToken();
      const res = await fetch('/api/auth/reset/verify-google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: resetTargetUser?.userId,
          identifier: resetTargetUser?.username || identifier,
          firebaseIdToken: idToken,
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        verifiedToken?: string;
        userId?: string;
        username?: string;
        maskedEmail?: string;
        message?: string;
        error?: string;
      }>(res);
      const data = parsed.data;
      if (!res.ok || !data?.ok || !data.verifiedToken) {
        setResetError(
          data?.error ||
            parsed.errorMessage ||
            'Signed-in Google account does not match the registered email for this CRM account.',
        );
        return;
      }
      setResetTargetUser({
        userId: data.userId || resetTargetUser?.userId || '',
        username: data.username || resetTargetUser?.username || identifier,
        maskedEmail: data.maskedEmail || resetTargetUser?.maskedEmail || 'verified Google account',
      });
      setGoogleIdToken(idToken);
      setVerifiedToken(data.verifiedToken);
      setResetAuthMethod('google');
      setResetNotice(
        data.message || 'Google ownership verified. Enter your new CRM password below.',
      );
      setResetMode('set_password');
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : 'Google Sign-In verification cancelled or failed.',
      );
    } finally {
      setResetLoading(false);
    }
  };

  const handleConfirmResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setResetError('');
    const maskedEmail = resetTargetUser?.maskedEmail || 'your registered email';
    if (resetAuthMethod === 'otp' && !verifiedToken && otpInput.trim().length !== 6) {
      setResetError(`Please enter the 6-digit verification code sent to ${maskedEmail}.`);
      return;
    }
    if (newPassword.length < 8) {
      setResetError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setResetError('New password and Confirm Password do not match.');
      return;
    }

    setResetLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          resetAuthMethod === 'google'
            ? {
                mode: 'google',
                userId: resetTargetUser?.userId,
                identifier: resetTargetUser?.username || resetIdentifier.trim(),
                firebaseIdToken: googleIdToken,
                verifiedToken,
                newPassword,
              }
            : {
                mode: 'otp',
                userId: resetTargetUser?.userId,
                identifier: resetTargetUser?.username || resetIdentifier.trim(),
                otp: otpInput.trim(),
                otpToken,
                verifiedToken,
                newPassword,
              },
        ),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        username?: string;
        user?: CrmUserSession;
        message?: string;
        error?: string;
      }>(res);
      const data = parsed.data;
      if (!res.ok || !data?.ok) {
        setResetError(data?.error || parsed.errorMessage || 'Could not reset password.');
        return;
      }

      const finalUsername = data.username || resetTargetUser?.username || resetIdentifier.trim();
      setAuthView('login');
      setResetMode('request');
      setResetTargetUser(null);
      setOtpInput('');
      setOtpToken('');
      setVerifiedToken('');
      setGoogleIdToken('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPassword('');
      setUsername(finalUsername);
      setSuccessMsg(
        data.message ||
          `Password updated successfully for ${finalUsername}! Please log in with your new password.`,
      );
    } catch {
      setResetError('Network error while saving new password.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleSendSignupOtp = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = signupEmail.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setSignupError('Please enter a valid email address.');
      return;
    }

    setSignupLoading(true);
    setSignupError('');
    setSignupNotice('');
    try {
      const res = await fetch('/api/auth/signup/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        otpToken?: string;
        recipient?: string;
        message?: string;
        error?: string;
      }>(res);
      const data = parsed.data;
      if (!res.ok || !data?.ok) {
        setSignupError(
          data?.error ||
            parsed.errorMessage ||
            `Could not send verification OTP to ${cleanEmail}.`,
        );
        return;
      }
      setSignupEmail(cleanEmail);
      setSignupOtpToken(data.otpToken || '');
      setSignupOtp('');
      setSignupNotice(data.message || `6-digit verification OTP sent to ${cleanEmail}.`);
      setSignupStep('verify_otp');
    } catch {
      setSignupError('Network error while sending email verification OTP.');
    } finally {
      setSignupLoading(false);
    }
  };

  const handleVerifySignupOtp = async (e: FormEvent) => {
    e.preventDefault();
    const cleanedOtp = signupOtp.trim();
    if (!/^\d{6}$/.test(cleanedOtp)) {
      setSignupError(`Please enter the 6-digit OTP sent to ${signupEmail}.`);
      return;
    }

    setSignupLoading(true);
    setSignupError('');
    try {
      const res = await fetch('/api/auth/signup/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: signupEmail,
          otp: cleanedOtp,
          otpToken: signupOtpToken,
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        verifiedToken?: string;
        message?: string;
        error?: string;
      }>(res);
      const data = parsed.data;
      if (!res.ok || !data?.ok || !data.verifiedToken) {
        setSignupError(
          data?.error ||
            parsed.errorMessage ||
            'Invalid 6-digit OTP. Please check your email inbox.',
        );
        return;
      }
      setSignupVerifiedToken(data.verifiedToken);
      setSignupNotice(
        data.message || 'Email verified successfully! Choose your User ID and Password below.',
      );
      setSignupStep('credentials');
    } catch {
      setSignupError('Network error while verifying email OTP.');
    } finally {
      setSignupLoading(false);
    }
  };

  const handleCompleteSignup = async (e: FormEvent) => {
    e.preventDefault();
    const cleanUsername = signupUsername.trim();
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(cleanUsername)) {
      setSignupError(
        'User ID must be 3 to 40 characters and contain only letters, numbers, "_", ".", or "-".',
      );
      return;
    }
    if (signupWorkspaceMode === 'new_company' && signupCompanyName.trim().length < 2) {
      setSignupError('Please enter your Company / Organization Name.');
      return;
    }
    if (signupWorkspaceMode === 'join_invite' && !signupInviteCode.trim()) {
      setSignupError('Please enter the Team Invite Code issued by your Company Admin.');
      return;
    }
    if (signupPassword.length < 8) {
      setSignupError('Password must be at least 8 characters.');
      return;
    }
    if (signupPassword !== signupConfirmPassword) {
      setSignupError('Password and Confirm Password do not match.');
      return;
    }

    setSignupLoading(true);
    setSignupError('');
    try {
      const res = await fetch('/api/auth/signup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: signupEmail,
          username: cleanUsername,
          password: signupPassword,
          verifiedToken: signupVerifiedToken,
          ...(signupWorkspaceMode === 'new_company'
            ? { companyName: signupCompanyName.trim() }
            : { inviteCode: signupInviteCode.trim() }),
        }),
      });
      const parsed = await safeReadJsonResponse<{
        ok?: boolean;
        user?: CrmUserSession;
        message?: string;
        error?: string;
      }>(res);
      const data = parsed.data;
      if (!res.ok || !data?.ok || !data.user) {
        setSignupError(data?.error || parsed.errorMessage || 'Could not create user account.');
        return;
      }

      setCreatedUsernameLabel(data.user.username);
      setSignupNotice(
        data.message || 'Successful Account Creation! Returning to the Login screen...',
      );
      setSignupStep('success');
    } catch (err) {
      setSignupError(
        err instanceof Error ? err.message : 'Network error while creating user account.',
      );
    } finally {
      setSignupLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#082056] text-slate-900 overflow-x-hidden relative">
      {/* Corporate Atmospheric Sky & Glass Tower Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(115deg, #061844 0%, #0A2A6C 38%, #1553B8 68%, #63B3ED 100%)',
          }}
        />
        {/* Subtle Architectural Glass Facade Geometry */}
        <svg
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 w-full h-full opacity-25"
        >
          <defs>
            <linearGradient id="towerGlass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#0F172A" stopOpacity="0.2" />
            </linearGradient>
            <pattern id="glassGrid" width="38" height="28" patternUnits="userSpaceOnUse">
              <path
                d="M 38 0 L 0 0 0 28"
                fill="none"
                stroke="#DBEAFE"
                strokeWidth="0.9"
                strokeOpacity="0.45"
              />
            </pattern>
          </defs>
          {/* Main angled modern corporate office building */}
          <polygon points="620,860 830,90 955,155 955,860" fill="url(#towerGlass)" />
          <polygon points="620,860 830,90 955,155 955,860" fill="url(#glassGrid)" />
          <polygon points="955,155 1135,235 1135,860 955,860" fill="#1E3A8A" fillOpacity="0.42" />
          <polygon points="955,155 1135,235 1135,860 955,860" fill="url(#glassGrid)" />
          {/* Secondary glass tower */}
          <polygon points="485,860 590,260 660,295 660,860" fill="#1D4ED8" fillOpacity="0.3" />
          <polygon points="485,860 590,260 660,295 660,860" fill="url(#glassGrid)" />
        </svg>
        {/* Left radial navy depth scrim for crisp typography contrast */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 18% 42%, rgba(6, 22, 66, 0.88) 0%, rgba(8, 30, 82, 0.58) 50%, rgba(14, 58, 138, 0.12) 100%)',
          }}
        />
      </div>

      {/* Top Brand Header Strip */}
      <header className="relative z-10 w-full bg-gradient-to-r from-white via-[#F1F6FE] to-[#D8E8FC] border-b border-blue-200/70">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <VanshBrandEmblem className="h-9 w-11 shrink-0" />
            <div>
              <p className="font-display text-lg sm:text-2xl font-extrabold tracking-tight leading-none text-[#0B1E47]">
                Vansh Tender <span className="text-[#1665D8]">Software</span>
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="h-px w-8 bg-slate-400/70" aria-hidden="true" />
                <span className="text-[11px] font-semibold tracking-wider text-slate-600">
                  Manage · Track · Win
                </span>
                <span className="h-px w-8 bg-slate-400/70" aria-hidden="true" />
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2.5 text-[#0E3175]">
            <TrendingUp className="h-6 w-6 text-[#1665D8] shrink-0" aria-hidden="true" />
            <div className="text-right leading-tight">
              <p className="text-sm font-bold italic tracking-tight">
                Smarter Tender Management
              </p>
              <p className="text-xs font-semibold italic text-[#1E40AF]">
                for a Stronger Business
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Split */}
      <main className="relative z-10 flex-1 flex items-center">
        <div className="max-w-[1380px] w-full mx-auto px-4 sm:px-8 py-8 lg:py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Left Hero & Laptop Showcase */}
          <section className="lg:col-span-7 space-y-6 text-white">
            <div className="space-y-2 max-w-2xl">
              <p className="font-display text-xl sm:text-2xl font-semibold text-blue-100">
                Welcome to
              </p>
              <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight leading-[1.1] text-white">
                Vansh Tender <span className="text-[#38BDF8]">Software</span>
              </h1>
              <p className="text-sm sm:text-lg italic text-blue-100/95 font-medium">
                Your Complete Tender &amp; Business Management Solution
              </p>
              <div className="pt-2">
                <div className="h-1 w-14 rounded-full bg-[#38BDF8]" />
              </div>
            </div>

            {/* 5 Feature Highlights */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-0 sm:divide-x sm:divide-white/20 rounded-xl bg-[#071B4B]/55 backdrop-blur-sm border border-white/15 p-3">
              {FEATURE_HIGHLIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex flex-col items-center justify-center text-center px-2 py-2 gap-1.5"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 border border-white/15 text-[#7DD3FC]">
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-medium leading-tight text-blue-50">
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Interactive-Style Laptop CRM Showcase */}
            <div className="hidden sm:block max-w-[650px] pt-1">
              <div className="rounded-t-2xl border-[7px] border-[#1E293B] bg-[#F8FAFC] shadow-[0_24px_60px_rgba(3,10,32,0.55)] overflow-hidden">
                {/* Laptop Screen Interior */}
                <div className="grid grid-cols-12 min-h-[268px] text-slate-900">
                  {/* Mini Sidebar */}
                  <div className="col-span-3 bg-[#0C2154] text-slate-200 p-3 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-1.5 pb-2 border-b border-white/10">
                        <VanshBrandEmblem className="h-5 w-5 shrink-0" />
                        <div className="leading-none">
                          <p className="text-[11px] font-bold text-white">Vansh</p>
                          <p className="text-[9px] text-blue-300">Tender Software</p>
                        </div>
                      </div>
                      <ul className="space-y-1 text-[10px]">
                        <li className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-[#1665D8] text-white font-semibold">
                          <LayoutDashboard className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>Dashboard</span>
                        </li>
                        <li className="flex items-center gap-1.5 px-2 py-1 text-blue-100/80">
                          <FileCheck2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>Tenders</span>
                        </li>
                        <li className="flex items-center gap-1.5 px-2 py-1 text-blue-100/80">
                          <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>OEMs &amp; MAF</span>
                        </li>
                        <li className="flex items-center gap-1.5 px-2 py-1 text-blue-100/80">
                          <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>Reports</span>
                        </li>
                        <li className="flex items-center gap-1.5 px-2 py-1 text-blue-100/80">
                          <ClipboardCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>EMD &amp; BG</span>
                        </li>
                        <li className="flex items-center gap-1.5 px-2 py-1 text-blue-100/80">
                          <Settings className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>Settings</span>
                        </li>
                      </ul>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 pt-2 border-t border-white/10 text-[10px] text-blue-200/80">
                      <LogOut className="h-3 w-3" aria-hidden="true" />
                      <span>Logout</span>
                    </div>
                  </div>

                  {/* Mini Main Workspace */}
                  <div className="col-span-9 p-3.5 space-y-3 bg-[#F4F7FC]">
                    {/* 4 Mini KPI Tiles */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="rounded-lg bg-white border border-slate-200/80 p-2 text-center shadow-xs">
                        <div className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                          <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
                        </div>
                        <p className="text-[9px] text-slate-500 font-medium">Total Tenders</p>
                        <p className="font-mono-num text-sm font-bold text-slate-900">125</p>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200/80 p-2 text-center shadow-xs">
                        <div className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                          <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                        </div>
                        <p className="text-[9px] text-slate-500 font-medium">Won Tenders</p>
                        <p className="font-mono-num text-sm font-bold text-slate-900">48</p>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200/80 p-2 text-center shadow-xs">
                        <div className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        </div>
                        <p className="text-[9px] text-slate-500 font-medium">Pending Bids</p>
                        <p className="font-mono-num text-sm font-bold text-slate-900">32</p>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200/80 p-2 text-center shadow-xs">
                        <div className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </div>
                        <p className="text-[9px] text-slate-500 font-medium">Success Rate</p>
                        <p className="font-mono-num text-sm font-bold text-slate-900">85%</p>
                      </div>
                    </div>

                    {/* Chart + Recent Activities */}
                    <div className="grid grid-cols-12 gap-2.5">
                      <div className="col-span-7 rounded-lg bg-white border border-slate-200/80 p-2.5">
                        <p className="text-[10px] font-bold text-slate-800 mb-1">
                          Tender Analytics
                        </p>
                        <svg viewBox="0 0 220 92" className="w-full h-[84px]" aria-hidden="true">
                          <defs>
                            <linearGradient id="miniAreaFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#2563EB" stopOpacity="0.28" />
                              <stop offset="100%" stopColor="#2563EB" stopOpacity="0.02" />
                            </linearGradient>
                          </defs>
                          <g stroke="#E2E8F0" strokeWidth="0.7">
                            <line x1="22" y1="14" x2="212" y2="14" />
                            <line x1="22" y1="34" x2="212" y2="34" />
                            <line x1="22" y1="54" x2="212" y2="54" />
                            <line x1="22" y1="74" x2="212" y2="74" />
                          </g>
                          <g fill="#64748B" fontSize="7" fontFamily="monospace">
                            <text x="4" y="16">100</text>
                            <text x="8" y="36">75</text>
                            <text x="8" y="56">50</text>
                            <text x="8" y="76">25</text>
                            <text x="26" y="88">Jan</text>
                            <text x="60" y="88">Feb</text>
                            <text x="95" y="88">Mar</text>
                            <text x="130" y="88">Apr</text>
                            <text x="165" y="88">May</text>
                            <text x="198" y="88">Jun</text>
                          </g>
                          <polygon
                            points="30,66 64,58 98,42 134,47 168,31 206,16 206,74 30,74"
                            fill="url(#miniAreaFill)"
                          />
                          <polyline
                            fill="none"
                            stroke="#1D4ED8"
                            strokeWidth="2"
                            points="30,66 64,58 98,42 134,47 168,31 206,16"
                          />
                          {[
                            [30, 66],
                            [64, 58],
                            [98, 42],
                            [134, 47],
                            [168, 31],
                            [206, 16],
                          ].map(([cx, cy], idx) => (
                            <circle key={idx} cx={cx} cy={cy} r="2.5" fill="#1D4ED8" stroke="#FFFFFF" strokeWidth="1" />
                          ))}
                        </svg>
                      </div>

                      <div className="col-span-5 rounded-lg bg-white border border-slate-200/80 p-2.5 space-y-2">
                        <p className="text-[10px] font-bold text-slate-800">Recent Activities</p>
                        <div className="space-y-2 text-[9px]">
                          <div className="flex items-start gap-1.5">
                            <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-blue-600 shrink-0" />
                            <div className="leading-tight">
                              <p className="font-semibold text-slate-800">New tender added</p>
                              <p className="text-slate-400">2 mins ago</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-1.5">
                            <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-emerald-600 shrink-0" />
                            <div className="leading-tight">
                              <p className="font-semibold text-slate-800">Bid submitted</p>
                              <p className="text-slate-400">10 mins ago</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-1.5">
                            <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-indigo-600 shrink-0" />
                            <div className="leading-tight">
                              <p className="font-semibold text-slate-800">MAF verified</p>
                              <p className="text-slate-400">1 hour ago</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Laptop Metallic Base */}
              <div className="mx-auto h-3.5 w-[104%] -ml-[2%] rounded-b-xl bg-gradient-to-b from-slate-200 via-slate-300 to-slate-400 shadow-lg flex items-center justify-center">
                <div className="h-1 w-16 rounded-full bg-slate-500/40" />
              </div>
            </div>
          </section>

          {/* Right Elevated Login / Password Reset Card */}
          <section className="lg:col-span-5 flex justify-center lg:justify-end">
            <div className="w-full max-w-[430px] rounded-2xl bg-white border border-slate-200/90 shadow-[0_24px_60px_rgba(4,16,52,0.42)] p-7 sm:p-9">
              {/* Card Brand Header */}
              <div className="flex flex-col items-center text-center pb-5 border-b border-blue-100">
                <VanshBrandEmblem className="h-12 w-14 mb-2" />
                <p className="font-display text-2xl font-extrabold tracking-tight text-[#0B1E47]">
                  Vansh Tender <span className="text-[#1665D8]">Software</span>
                </p>
              </div>

              {authView === 'setup' ? (
                <div className="pt-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      First-Time Workspace Setup
                    </span>
                    <button
                      type="button"
                      onClick={() => setAuthView('login')}
                      className="text-xs font-medium text-[#1665D8] hover:underline cursor-pointer"
                    >
                      Already configured? Sign In
                    </button>
                  </div>

                  <div className="text-center">
                    <h2 className="font-display text-lg font-bold text-[#0B1E47]">
                      Register Your Company &amp; Owner
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Create the primary Workspace Owner account with zero default passwords
                    </p>
                  </div>

                  {setupError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
                    >
                      {setupError}
                    </div>
                  )}

                  <form onSubmit={handleSetupAdminSubmit} className="space-y-3">
                    <div>
                      <label htmlFor="setup-company-name" className="block text-xs font-medium text-slate-700 mb-1">
                        Company / Firm Name *
                      </label>
                      <input
                        id="setup-company-name"
                        type="text"
                        required
                        autoFocus
                        value={setupCompanyName}
                        onChange={(e) => setSetupCompanyName(e.target.value)}
                        placeholder="e.g. Apex Infra & Tech Systems Pvt. Ltd."
                        className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] px-3.5 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label htmlFor="setup-gstin" className="block text-[11px] font-medium text-slate-700 mb-1">
                          GSTIN (Optional)
                        </label>
                        <input
                          id="setup-gstin"
                          type="text"
                          value={setupGstin}
                          onChange={(e) => setSetupGstin(e.target.value)}
                          placeholder="07AAACA1234A1Z5"
                          className="font-mono-num w-full rounded-lg border border-slate-300 bg-[#F8FAFC] px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                        />
                      </div>
                      <div>
                        <label htmlFor="setup-udyam" className="block text-[11px] font-medium text-slate-700 mb-1">
                          Udyam / MSME (Opt.)
                        </label>
                        <input
                          id="setup-udyam"
                          type="text"
                          value={setupUdyamNumber}
                          onChange={(e) => setSetupUdyamNumber(e.target.value)}
                          placeholder="UDYAM-DL-01-..."
                          className="font-mono-num w-full rounded-lg border border-slate-300 bg-[#F8FAFC] px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label htmlFor="setup-username" className="block text-xs font-medium text-slate-700 mb-1">
                          Owner User ID *
                        </label>
                        <input
                          id="setup-username"
                          type="text"
                          required
                          value={setupUsername}
                          onChange={(e) => setSetupUsername(e.target.value)}
                          placeholder="e.g. OwnerAdmin"
                          className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                        />
                      </div>
                      <div>
                        <label htmlFor="setup-email" className="block text-xs font-medium text-slate-700 mb-1">
                          Owner Email *
                        </label>
                        <input
                          id="setup-email"
                          type="email"
                          required
                          value={setupEmail}
                          onChange={(e) => setSetupEmail(e.target.value)}
                          placeholder="owner@company.in"
                          className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="setup-password" className="block text-xs font-medium text-slate-700 mb-1">
                        Password (min 8 characters) *
                      </label>
                      <div className="relative">
                        <Lock
                          className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3 top-1/2 -translate-y-1/2"
                          aria-hidden="true"
                        />
                        <input
                          id="setup-password"
                          type={showSetupPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          value={setupPassword}
                          onChange={(e) => setSetupPassword(e.target.value)}
                          placeholder="Strong password (8+ chars)"
                          className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-9 pr-9 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSetupPassword((prev) => !prev)}
                          aria-label={showSetupPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-800"
                        >
                          {showSetupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="setup-confirm-password" className="block text-xs font-medium text-slate-700 mb-1">
                        Confirm Password *
                      </label>
                      <input
                        id="setup-confirm-password"
                        type={showSetupPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={setupConfirmPassword}
                        onChange={(e) => setSetupConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] px-3.5 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={setupLoading}
                      data-testid="setup-admin-submit-btn"
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#0F5BD8] to-[#0A46AD] hover:from-[#0C4EC0] hover:to-[#083B94] disabled:opacity-60 text-white text-sm font-semibold shadow-sm cursor-pointer"
                    >
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      <span>{setupLoading ? 'Creating Workspace...' : 'Create Company & Owner Account'}</span>
                    </button>
                  </form>

                  <button
                    type="button"
                    onClick={() => void handleGoogleContinue()}
                    disabled={googleSubmitting}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-60 text-slate-800 text-xs font-semibold cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    <span>{googleSubmitting ? 'Connecting Google...' : 'Or Start Workspace with Google'}</span>
                  </button>
                </div>
              ) : authView === 'login' ? (
                <>
                  <div className="pt-5 pb-4 text-center">
                    <h2 className="font-display text-xl font-bold text-[#0B1E47]">
                      Login to Your Account
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      {!bootstrapChecked
                        ? 'Checking workspace status...'
                        : 'Enter your User ID or work email credentials to continue'}
                    </p>
                  </div>

                  {needsInitialSetup && (
                    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-900 flex items-center justify-between gap-2">
                      <span>No workspace owner exists yet.</span>
                      <button
                        type="button"
                        onClick={() => setAuthView('setup')}
                        className="font-semibold text-[#0F5BD8] hover:underline shrink-0 cursor-pointer"
                      >
                        Run First-Time Setup
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {successMsg && (
                      <div
                        role="status"
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800"
                      >
                        {successMsg}
                      </div>
                    )}

                    {errorMsg && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
                      >
                        {errorMsg}
                      </div>
                    )}

                    <div>
                      <label htmlFor="login-username" className="sr-only">
                        User ID / Email ID
                      </label>
                      <div className="relative">
                        <User
                          className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                          aria-hidden="true"
                        />
                        <input
                          id="login-username"
                          type="text"
                          autoComplete="username"
                          autoFocus
                          value={username}
                          onChange={(e) => {
                            setUsername(e.target.value);
                            if (errorMsg) setErrorMsg('');
                          }}
                          placeholder="User ID / Work Email"
                          className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8] focus:border-[#1665D8]"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="login-password" className="sr-only">
                        Password
                      </label>
                      <div className="relative">
                        <Lock
                          className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                          aria-hidden="true"
                        />
                        <input
                          id="login-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            if (errorMsg) setErrorMsg('');
                          }}
                          placeholder="Password"
                          className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-10 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8] focus:border-[#1665D8]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-800"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-0.5">
                      <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-[#1665D8] focus:ring-[#1665D8]"
                        />
                        <span>Remember Me</span>
                      </label>

                      <button
                        type="button"
                        onClick={openForgotPasswordFlow}
                        className="font-medium text-[#1665D8] hover:text-[#0E4AB3] hover:underline cursor-pointer"
                      >
                        Forgot Password?
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || googleSubmitting}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#0F5BD8] to-[#0A46AD] hover:from-[#0C4EC0] hover:to-[#083B94] disabled:opacity-60 text-white text-sm font-semibold shadow-md shadow-blue-900/20 transition-all cursor-pointer"
                    >
                      <ArrowRightCircle className="h-4 w-4" aria-hidden="true" />
                      <span>{submitting ? 'Signing In...' : 'Login'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleGoogleContinue()}
                      disabled={submitting || googleSubmitting}
                      data-testid="google-sso-login-btn"
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                      <span>{googleSubmitting ? 'Signing in with Google...' : 'Continue with Google'}</span>
                    </button>
                  </form>

                  <div className="flex items-center gap-3 my-4">
                    <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      NEW WORKSPACE OR INVITE?
                    </span>
                    <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                  </div>

                  <button
                    type="button"
                    onClick={openCreateUserFlow}
                    data-testid="open-create-user-btn"
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100/80 text-[#0F49B8] text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                  >
                    <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Register Company / Join Team</span>
                  </button>

                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-[#F8FAFC] px-4 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                      <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800">
                        Isolated &amp; Encrypted Access
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Company-isolated workspaces · Bcrypt &amp; signed session auth
                      </p>
                    </div>
                  </div>
                </>
              ) : authView === 'signup' ? (
                <div className="pt-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setAuthView('login')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#1665D8] hover:underline cursor-pointer"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Back to Login</span>
                    </button>
                    <span className="text-[11px] font-semibold text-blue-700">
                      Workspace Onboarding
                    </span>
                  </div>

                  <div className="text-center">
                    <h2 className="font-display text-lg font-bold text-[#0B1E47]">
                      Create New CRM User
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      {signupStep === 'email'
                        ? 'Verify your Gmail address to create an isolated workspace'
                        : signupStep === 'verify_otp'
                          ? `Enter the 6-digit OTP sent to ${signupEmail}`
                          : signupStep === 'credentials'
                            ? `Verified: ${signupEmail}`
                            : 'Your new CRM account is ready'}
                    </p>
                  </div>

                  {signupError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
                    >
                      {signupError}
                    </div>
                  )}

                  {signupNotice && signupStep !== 'success' && (
                    <div
                      role="status"
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs font-medium text-blue-900"
                    >
                      {signupNotice}
                    </div>
                  )}

                  {signupStep === 'email' && (
                    <form onSubmit={handleSendSignupOtp} className="space-y-3.5">
                      <div>
                        <label
                          htmlFor="signup-email"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Your Gmail Address *
                        </label>
                        <div className="relative">
                          <Mail
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="signup-email"
                            type="email"
                            required
                            autoFocus
                            value={signupEmail}
                            onChange={(e) => {
                              setSignupEmail(e.target.value);
                              if (signupError) setSignupError('');
                            }}
                            placeholder="yourname@gmail.com"
                            className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          OTP will be emailed directly to this Gmail address only.
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={signupLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#0F5BD8] to-[#0A46AD] hover:from-[#0C4EC0] hover:to-[#083B94] disabled:opacity-60 text-white text-sm font-semibold shadow-sm cursor-pointer"
                      >
                        <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{signupLoading ? 'Sending OTP...' : 'Send Verification OTP'}</span>
                      </button>
                    </form>
                  )}

                  {signupStep === 'verify_otp' && (
                    <form onSubmit={handleVerifySignupOtp} className="space-y-3.5">
                      <div>
                        <label
                          htmlFor="signup-otp"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          6-Digit Gmail Verification OTP
                        </label>
                        <div className="relative">
                          <KeyRound
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="signup-otp"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            required
                            autoFocus
                            value={signupOtp}
                            onChange={(e) => {
                              setSignupOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                              if (signupError) setSignupError('');
                            }}
                            placeholder="Enter 6-digit OTP"
                            className="font-mono-num w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm tracking-widest text-slate-900 placeholder:tracking-normal focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={signupLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#0F5BD8] to-[#0A46AD] hover:from-[#0C4EC0] hover:to-[#083B94] disabled:opacity-60 text-white text-sm font-semibold shadow-sm cursor-pointer"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>{signupLoading ? 'Verifying OTP...' : 'Verify OTP'}</span>
                      </button>

                      <div className="flex items-center justify-between text-xs pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSignupStep('email');
                            setSignupError('');
                            setSignupNotice('');
                          }}
                          className="text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
                        >
                          Change Gmail
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSendSignupOtp()}
                          disabled={signupLoading}
                          className="font-medium text-[#1665D8] hover:underline cursor-pointer"
                        >
                          Resend OTP
                        </button>
                      </div>
                    </form>
                  )}

                  {signupStep === 'credentials' && (
                    <form onSubmit={handleCompleteSignup} className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
                        <button
                          type="button"
                          onClick={() => setSignupWorkspaceMode('new_company')}
                          className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                            signupWorkspaceMode === 'new_company'
                              ? 'bg-white text-[#0B1E47] shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          New Company
                        </button>
                        <button
                          type="button"
                          onClick={() => setSignupWorkspaceMode('join_invite')}
                          className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                            signupWorkspaceMode === 'join_invite'
                              ? 'bg-white text-[#0B1E47] shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Join via Invite
                        </button>
                      </div>

                      {signupWorkspaceMode === 'new_company' ? (
                        <div>
                          <label
                            htmlFor="signup-company-name"
                            className="block text-xs font-medium text-slate-700 mb-1"
                          >
                            Company / Organization Name *
                          </label>
                          <input
                            id="signup-company-name"
                            type="text"
                            required
                            value={signupCompanyName}
                            onChange={(e) => {
                              setSignupCompanyName(e.target.value);
                              if (signupError) setSignupError('');
                            }}
                            placeholder="e.g. Bharat Tech Solutions"
                            className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] px-3.5 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                      ) : (
                        <div>
                          <label
                            htmlFor="signup-invite-code"
                            className="block text-xs font-medium text-slate-700 mb-1"
                          >
                            Team Invite Code *
                          </label>
                          <input
                            id="signup-invite-code"
                            type="text"
                            required
                            value={signupInviteCode}
                            onChange={(e) => {
                              setSignupInviteCode(e.target.value);
                              if (signupError) setSignupError('');
                            }}
                            placeholder="Paste invite code from your admin"
                            className="font-mono-num w-full rounded-lg border border-slate-300 bg-[#F8FAFC] px-3.5 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="signup-username"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Create User ID *
                        </label>
                        <div className="relative">
                          <User
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="signup-username"
                            type="text"
                            required
                            autoFocus
                            value={signupUsername}
                            onChange={(e) => {
                              setSignupUsername(e.target.value);
                              if (signupError) setSignupError('');
                            }}
                            placeholder="e.g. RohanOps or Priya.Sales"
                            className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="signup-password"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Create Password (min 8 characters) *
                        </label>
                        <div className="relative">
                          <Lock
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="signup-password"
                            type={showSignupPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            value={signupPassword}
                            onChange={(e) => {
                              setSignupPassword(e.target.value);
                              if (signupError) setSignupError('');
                            }}
                            placeholder="Enter password (8+ chars)"
                            className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-10 py-2.5 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSignupPassword((prev) => !prev)}
                            aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-800"
                          >
                            {showSignupPassword ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="signup-confirm-password"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Confirm Password *
                        </label>
                        <div className="relative">
                          <Lock
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="signup-confirm-password"
                            type={showSignupPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            value={signupConfirmPassword}
                            onChange={(e) => {
                              setSignupConfirmPassword(e.target.value);
                              if (signupError) setSignupError('');
                            }}
                            placeholder="Re-enter password"
                            className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={signupLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#0F5BD8] to-[#0A46AD] hover:from-[#0C4EC0] hover:to-[#083B94] disabled:opacity-60 text-white text-sm font-semibold shadow-sm cursor-pointer"
                      >
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                        <span>{signupLoading ? 'Creating Account...' : 'Complete Registration'}</span>
                      </button>
                    </form>
                  )}

                  {signupStep === 'success' && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center space-y-3">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-emerald-900">
                          Successful ID Creation
                        </p>
                        <p className="text-xs text-emerald-800">
                          User ID <span className="font-mono-num font-bold">{createdUsernameLabel}</span> linked to{' '}
                          <span className="font-semibold">{signupEmail}</span>. Redirecting to Login...
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthView('login');
                          setSignupStep('email');
                          if (createdUsernameLabel) setUsername(createdUsernameLabel);
                          setPassword('');
                          setSuccessMsg(
                            `Successful ID Creation! Log in with "${createdUsernameLabel}" and your new password.`,
                          );
                        }}
                        className="w-full py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        Go to Login Screen Now
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="pt-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setAuthView('login')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#1665D8] hover:underline cursor-pointer"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Back to Login</span>
                    </button>
                    <span className="text-[11px] font-medium text-slate-400">
                      {resetTargetUser ? `Account: ${resetTargetUser.username}` : 'Account Recovery'}
                    </span>
                  </div>

                  <div className="text-center">
                    <h2 className="font-display text-lg font-bold text-[#0B1E47]">
                      Reset CRM Password
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      {resetTargetUser?.maskedEmail ? (
                        <>
                          Verification mail target:{' '}
                          <span className="font-semibold text-slate-700">
                            {resetTargetUser.maskedEmail}
                          </span>
                        </>
                      ) : (
                        'Enter your User ID or registered email to verify ownership'
                      )}
                    </p>
                  </div>

                  {resetError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
                    >
                      {resetError}
                    </div>
                  )}

                  {resetNotice && (
                    <div
                      role="status"
                      className={`rounded-lg border px-3.5 py-2.5 text-xs font-medium ${
                        smtpUnconfiguredNotice
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-blue-200 bg-blue-50 text-blue-900'
                      }`}
                    >
                      {resetNotice}
                    </div>
                  )}

                  {resetMode === 'request' && (
                    <div className="space-y-3">
                      <div>
                        <label
                          htmlFor="reset-identifier"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          User ID or Registered Email ID *
                        </label>
                        <div className="relative">
                          <User
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="reset-identifier"
                            type="text"
                            autoFocus
                            value={resetIdentifier}
                            onChange={(e) => {
                              setResetIdentifier(e.target.value);
                              setResetTargetUser(null);
                              if (resetError) setResetError('');
                            }}
                            placeholder="Enter User ID or registered email"
                            className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleSendResetEmail()}
                        disabled={resetLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#0F5BD8] to-[#0A46AD] hover:from-[#0C4EC0] hover:to-[#083B94] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold shadow-sm cursor-pointer"
                      >
                        <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>
                          {resetLoading
                            ? 'Sending Reset Code...'
                            : resetTargetUser?.maskedEmail
                              ? `Send Reset Code to ${resetTargetUser.maskedEmail}`
                              : 'Send Reset Code'}
                        </span>
                      </button>

                      {resetIdentifier.trim().length > 0 && (
                        <>
                          <div className="flex items-center gap-3">
                            <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                            <span className="text-[11px] font-semibold text-slate-400 uppercase">
                              OR VERIFY INSTANTLY
                            </span>
                            <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                          </div>

                          <button
                            type="button"
                            onClick={() => void handleVerifyGoogleForReset()}
                            disabled={resetLoading}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-60 text-slate-800 text-xs font-semibold cursor-pointer"
                          >
                            <ShieldCheck
                              className="h-4 w-4 text-emerald-600 shrink-0"
                              aria-hidden="true"
                            />
                            <span>
                              {resetTargetUser?.maskedEmail
                                ? `Verify with Google (${resetTargetUser.maskedEmail})`
                                : 'Verify Ownership with Google'}
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {resetMode === 'verify_otp' && (
                    <form onSubmit={handleVerifyResetCode} className="space-y-3.5">
                      <div>
                        <label
                          htmlFor="reset-otp"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          6-Digit Verification Code (Check{' '}
                          {resetTargetUser?.maskedEmail || 'your registered email'})
                        </label>
                        <div className="relative">
                          <KeyRound
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="reset-otp"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            required
                            autoFocus
                            value={otpInput}
                            onChange={(e) => {
                              setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                              if (resetError) setResetError('');
                            }}
                            placeholder="Enter 6-digit code"
                            className="font-mono-num w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm tracking-widest text-slate-900 placeholder:tracking-normal focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={resetLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#0F5BD8] to-[#0A46AD] hover:from-[#0C4EC0] hover:to-[#083B94] disabled:opacity-60 text-white text-sm font-semibold shadow-sm cursor-pointer"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>{resetLoading ? 'Verifying Code...' : 'Verify Code'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleSendResetEmail()}
                        disabled={resetLoading}
                        className="w-full text-center text-xs font-medium text-[#1665D8] hover:underline cursor-pointer"
                      >
                        Resend Verification Code to {resetTargetUser?.maskedEmail || 'your email'}
                      </button>
                    </form>
                  )}

                  {resetMode === 'set_password' && (
                    <form onSubmit={handleConfirmResetPassword} className="space-y-3.5">
                      <div>
                        <label
                          htmlFor="reset-new-password"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          New Password (min 8 characters)
                        </label>
                        <div className="relative">
                          <Lock
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="reset-new-password"
                            type={showNewPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            autoFocus
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Enter new password (8+ chars)"
                            className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-10 py-2.5 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword((prev) => !prev)}
                            aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-800"
                          >
                            {showNewPassword ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="reset-confirm-password"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Confirm Password
                        </label>
                        <div className="relative">
                          <Lock
                            className="h-4 w-4 text-[#1E3A8A]/70 absolute left-3.5 top-1/2 -translate-y-1/2"
                            aria-hidden="true"
                          />
                          <input
                            id="reset-confirm-password"
                            type={showNewPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            placeholder="Re-enter new password"
                            className="w-full rounded-lg border border-slate-300 bg-[#F8FAFC] pl-10 pr-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1665D8]"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={resetLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#0F5BD8] to-[#0A46AD] hover:from-[#0C4EC0] hover:to-[#083B94] disabled:opacity-60 text-white text-sm font-semibold shadow-sm cursor-pointer"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>{resetLoading ? 'Saving Password...' : 'Save Password'}</span>
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Bottom Corporate Footer Strip */}
      <footer className="relative z-10 w-full bg-[#061844] border-t border-white/15 text-blue-100 text-xs">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span>© 2026 Vansh Tender Software. All Rights Reserved.</span>
            <span className="hidden sm:inline text-white/25" aria-hidden="true">
              |
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[#38BDF8]" aria-hidden="true" />
              <span>Trusted by Professionals</span>
            </span>
            <span className="hidden sm:inline text-white/25" aria-hidden="true">
              |
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Headphones className="h-3.5 w-3.5 text-[#38BDF8]" aria-hidden="true" />
              <span>Support: +91-98765-43210</span>
            </span>
          </div>

          <div className="font-display font-bold italic text-sm text-white tracking-tight">
            <span className="border-b-2 border-[#38BDF8] pb-0.5">
              Bid Smart. Grow Bigger.
            </span>
          </div>
        </div>
      </footer>

      {disabledModalMessage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-disabled-title"
          data-testid="account-disabled-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-3 bg-red-50 px-5 py-4 border-b border-red-100">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3
                    id="account-disabled-title"
                    className="font-display text-base font-bold text-slate-900"
                  >
                    Account Access Disabled
                  </h3>
                  <p className="text-xs text-red-700 font-medium">
                    Blocked by Primary Administrator
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDismissDisabledModal}
                aria-label="Close account disabled notice"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-red-100/70 hover:text-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">{disabledModalMessage}</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                Only <span className="font-semibold text-slate-800">your Company Administrator</span> can re-enable this CRM user ID from Workspace Settings.
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleDismissDisabledModal}
                  data-testid="dismiss-disabled-modal-btn"
                  className="px-4 py-2 rounded-lg bg-[#0F5BD8] hover:bg-[#0A46AD] text-white text-xs font-semibold cursor-pointer"
                >
                  Understood / Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
