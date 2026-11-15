import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Mail, Lock, User, ArrowRight, Globe, Phone, ArrowLeft } from 'lucide-react';
import { giinApi, supabase, getTransparentLogo } from '../supabaseClient';

const WORLD_DIALING_CODES = [
  { code: '+93', name: 'Afghanistan', iso: 'AF' },
  { code: '+355', name: 'Albania', iso: 'AL' },
  { code: '+213', name: 'Algeria', iso: 'DZ' },
  { code: '+376', name: 'Andorra', iso: 'AD' },
  { code: '+244', name: 'Angola', iso: 'AO' },
  { code: '+297', name: 'Aruba', iso: 'AW' },
  { code: '+61', name: 'Australia', iso: 'AU' },
  { code: '+43', name: 'Austria', iso: 'AT' },
  { code: '+994', name: 'Azerbaijan', iso: 'AZ' },
  { code: '+973', name: 'Bahrain', iso: 'BH' },
  { code: '+880', name: 'Bangladesh', iso: 'BD' },
  { code: '+375', name: 'Belarus', iso: 'BY' },
  { code: '+32', name: 'Belgium', iso: 'BE' },
  { code: '+501', name: 'Belize', iso: 'BZ' },
  { code: '+229', name: 'Benin', iso: 'BJ' },
  { code: '+975', name: 'Bhutan', iso: 'BT' },
  { code: '+591', name: 'Bolivia', iso: 'BO' },
  { code: '+387', name: 'Bosnia and Herzegovina', iso: 'BA' },
  { code: '+267', name: 'Botswana', iso: 'BW' },
  { code: '+55', name: 'Brazil', iso: 'BR' },
  { code: '+673', name: 'Brunei', iso: 'BN' },
  { code: '+359', name: 'Bulgaria', iso: 'BG' },
  { code: '+226', name: 'Burkina Faso', iso: 'BF' },
  { code: '+257', name: 'Burundi', iso: 'BI' },
  { code: '+855', name: 'Cambodia', iso: 'KH' },
  { code: '+237', name: 'Cameroon', iso: 'CM' },
  { code: '+1', name: 'Canada', iso: 'CA' },
  { code: '+238', name: 'Cape Verde', iso: 'CV' },
  { code: '+236', name: 'Central African Republic', iso: 'CF' },
  { code: '+235', name: 'Chad', iso: 'TD' },
  { code: '+56', name: 'Chile', iso: 'CL' },
  { code: '+86', name: 'China', iso: 'CN' },
  { code: '+57', name: 'Colombia', iso: 'CO' },
  { code: '+269', name: 'Comoros', iso: 'KM' },
  { code: '+242', name: 'Congo (Republic)', iso: 'CG' },
  { code: '+243', name: 'Congo (Democratic Rep.)', iso: 'CD' },
  { code: '+506', name: 'Costa Rica', iso: 'CR' },
  { code: '+385', name: 'Croatia', iso: 'HR' },
  { code: '+53', name: 'Cuba', iso: 'CU' },
  { code: '+357', name: 'Cyprus', iso: 'CY' },
  { code: '+420', name: 'Czech Republic', iso: 'CZ' },
  { code: '+45', name: 'Denmark', iso: 'DK' },
  { code: '+253', name: 'Djibouti', iso: 'DJ' },
  { code: '+593', name: 'Ecuador', iso: 'EC' },
  { code: '+20', name: 'Egypt', iso: 'EG' },
  { code: '+503', name: 'El Salvador', iso: 'SV' },
  { code: '+240', name: 'Equatorial Guinea', iso: 'GQ' },
  { code: '+291', name: 'Eritrea', iso: 'ER' },
  { code: '+372', name: 'Estonia', iso: 'EE' },
  { code: '+268', name: 'Eswatini (Swaziland)', iso: 'SZ' },
  { code: '+251', name: 'Ethiopia', iso: 'ET' },
  { code: '+298', name: 'Faroe Islands', iso: 'FO' },
  { code: '+679', name: 'Fiji', iso: 'FJ' },
  { code: '+358', name: 'Finland', iso: 'FI' },
  { code: '+33', name: 'France', iso: 'FR' },
  { code: '+241', name: 'Gabon', iso: 'GA' },
  { code: '+220', name: 'Gambia', iso: 'GM' },
  { code: '+995', name: 'Georgia', iso: 'GE' },
  { code: '+49', name: 'Germany', iso: 'DE' },
  { code: '+233', name: 'Ghana', iso: 'GH' },
  { code: '+350', name: 'Gibraltar', iso: 'GI' },
  { code: '+30', name: 'Greece', iso: 'GR' },
  { code: '+299', name: 'Greenland', iso: 'GL' },
  { code: '+502', name: 'Guatemala', iso: 'GT' },
  { code: '+224', name: 'Guinea', iso: 'GN' },
  { code: '+245', name: 'Guinea-Bissau', iso: 'GW' },
  { code: '+592', name: 'Guyana', iso: 'GY' },
  { code: '+509', name: 'Haiti', iso: 'HT' },
  { code: '+504', name: 'Honduras', iso: 'HN' },
  { code: '+852', name: 'Hong Kong', iso: 'HK' },
  { code: '+36', name: 'Hungary', iso: 'HU' },
  { code: '+354', name: 'Iceland', iso: 'IS' },
  { code: '+91', name: 'India', iso: 'IN' },
  { code: '+62', name: 'Indonesia', iso: 'ID' },
  { code: '+98', name: 'Iran', iso: 'IR' },
  { code: '+964', name: 'Iraq', iso: 'IQ' },
  { code: '+353', name: 'Ireland', iso: 'IE' },
  { code: '+972', name: 'Israel', iso: 'IL' },
  { code: '+39', name: 'Italy', iso: 'IT' },
  { code: '+225', name: 'Ivory Coast', iso: 'CI' },
  { code: '+81', name: 'Japan', iso: 'JP' },
  { code: '+962', name: 'Jordan', iso: 'JO' },
  { code: '+7', name: 'Kazakhstan', iso: 'KZ' },
  { code: '+254', name: 'Kenya', iso: 'KE' },
  { code: '+686', name: 'Kiribati', iso: 'KI' },
  { code: '+965', name: 'Kuwait', iso: 'KW' },
  { code: '+996', name: 'Kyrgyzstan', iso: 'KG' },
  { code: '+856', name: 'Laos', iso: 'LA' },
  { code: '+371', name: 'Latvia', iso: 'LV' },
  { code: '+961', name: 'Lebanon', iso: 'LB' },
  { code: '+266', name: 'Lesotho', iso: 'LS' },
  { code: '+231', name: 'Liberia', iso: 'LR' },
  { code: '+218', name: 'Libya', iso: 'LY' },
  { code: '+423', name: 'Liechtenstein', iso: 'LI' },
  { code: '+370', name: 'Lithuania', iso: 'LT' },
  { code: '+352', name: 'Luxembourg', iso: 'LU' },
  { code: '+853', name: 'Macau', iso: 'MO' },
  { code: '+261', name: 'Madagascar', iso: 'MG' },
  { code: '+265', name: 'Malawi', iso: 'MW' },
  { code: '+60', name: 'Malaysia', iso: 'MY' },
  { code: '+960', name: 'Maldives', iso: 'MV' },
  { code: '+223', name: 'Mali', iso: 'ML' },
  { code: '+356', name: 'Malta', iso: 'MT' },
  { code: '+692', name: 'Marshall Islands', iso: 'MH' },
  { code: '+222', name: 'Mauritania', iso: 'MR' },
  { code: '+230', name: 'Mauritius', iso: 'MU' },
  { code: '+52', name: 'Mexico', iso: 'MX' },
  { code: '+691', name: 'Micronesia', iso: 'FM' },
  { code: '+373', name: 'Moldova', iso: 'MD' },
  { code: '+377', name: 'Monaco', iso: 'MC' },
  { code: '+212', name: 'Morocco', iso: 'MA' },
  { code: '+258', name: 'Mozambique', iso: 'MZ' },
  { code: '+95', name: 'Myanmar', iso: 'MM' },
  { code: '+264', name: 'Namibia', iso: 'NA' },
  { code: '+674', name: 'Nauru', iso: 'NR' },
  { code: '+977', name: 'Nepal', iso: 'NP' },
  { code: '+31', name: 'Netherlands', iso: 'NL' },
  { code: '+64', name: 'New Zealand', iso: 'NZ' },
  { code: '+505', name: 'Nicaragua', iso: 'NI' },
  { code: '+227', name: 'Niger', iso: 'NE' },
  { code: '+234', name: 'Nigeria', iso: 'NG' },
  { code: '+850', name: 'North Korea', iso: 'KP' },
  { code: '+389', name: 'North Macedonia', iso: 'MK' },
  { code: '+47', name: 'Norway', iso: 'NO' },
  { code: '+968', name: 'Oman', iso: 'OM' },
  { code: '+92', name: 'Pakistan', iso: 'PK' },
  { code: '+680', name: 'Palau', iso: 'PW' },
  { code: '+970', name: 'Palestine', iso: 'PS' },
  { code: '+507', name: 'Panama', iso: 'PA' },
  { code: '+675', name: 'Papua New Guinea', iso: 'PG' },
  { code: '+595', name: 'Paraguay', iso: 'PY' },
  { code: '+51', name: 'Peru', iso: 'PE' },
  { code: '+63', name: 'Philippines', iso: 'PH' },
  { code: '+48', name: 'Poland', iso: 'PL' },
  { code: '+351', name: 'Portugal', iso: 'PT' },
  { code: '+974', name: 'Qatar', iso: 'QA' },
  { code: '+40', name: 'Romania', iso: 'RO' },
  { code: '+7', name: 'Russia', iso: 'RU' },
  { code: '+250', name: 'Rwanda', iso: 'RW' },
  { code: '+685', name: 'Samoa', iso: 'WS' },
  { code: '+378', name: 'San Marino', iso: 'SM' },
  { code: '+966', name: 'Saudi Arabia', iso: 'SA' },
  { code: '+221', name: 'Senegal', iso: 'SN' },
  { code: '+381', name: 'Serbia', iso: 'RS' },
  { code: '+248', name: 'Seychelles', iso: 'SC' },
  { code: '+232', name: 'Sierra Leone', iso: 'SL' },
  { code: '+65', name: 'Singapore', iso: 'SG' },
  { code: '+421', name: 'Slovakia', iso: 'SK' },
  { code: '+386', name: 'Slovenia', iso: 'SI' },
  { code: '+677', name: 'Solomon Islands', iso: 'SB' },
  { code: '+252', name: 'Somalia', iso: 'SO' },
  { code: '+27', name: 'South Africa', iso: 'ZA' },
  { code: '+82', name: 'South Korea', iso: 'KR' },
  { code: '+211', name: 'South Sudan', iso: 'SS' },
  { code: '+34', name: 'Spain', iso: 'ES' },
  { code: '+94', name: 'Sri Lanka', iso: 'LK' },
  { code: '+249', name: 'Sudan', iso: 'SD' },
  { code: '+597', name: 'Suriname', iso: 'SR' },
  { code: '+46', name: 'Sweden', iso: 'SE' },
  { code: '+41', name: 'Switzerland', iso: 'CH' },
  { code: '+963', name: 'Syria', iso: 'SY' },
  { code: '+886', name: 'Taiwan', iso: 'TW' },
  { code: '+992', name: 'Tajikistan', iso: 'TJ' },
  { code: '+255', name: 'Tanzania', iso: 'TZ' },
  { code: '+66', name: 'Thailand', iso: 'TH' },
  { code: '+228', name: 'Togo', iso: 'TG' },
  { code: '+676', name: 'Tonga', iso: 'TO' },
  { code: '+216', name: 'Tunisia', iso: 'TN' },
  { code: '+90', name: 'Turkey', iso: 'TR' },
  { code: '+993', name: 'Turkmenistan', iso: 'TM' },
  { code: '+256', name: 'Uganda', iso: 'UG' },
  { code: '+380', name: 'Ukraine', iso: 'UA' },
  { code: '+971', name: 'United Arab Emirates', iso: 'AE' },
  { code: '+44', name: 'United Kingdom', iso: 'GB' },
  { code: '+1', name: 'United States', iso: 'US' },
  { code: '+598', name: 'Uruguay', iso: 'UY' },
  { code: '+998', name: 'Uzbekistan', iso: 'UZ' },
  { code: '+678', name: 'Vanuatu', iso: 'VU' },
  { code: '+58', name: 'Venezuela', iso: 'VE' },
  { code: '+84', name: 'Vietnam', iso: 'VN' },
  { code: '+967', name: 'Yemen', iso: 'YE' },
  { code: '+260', name: 'Zambia', iso: 'ZM' },
  { code: '+263', name: 'Zimbabwe', iso: 'ZW' }
];

interface AuthProps {
  onAuthSuccess: (user: { id: string; email: string; name: string; workspaceName: string; domain: string }) => void;
  // Set when the user arrived via the reset link in their email: show the
  // new-password form instead of sign-in.
  initialMode?: 'recover';
  onPasswordResetDone?: () => void;
  // Phase 3 (Feature 4) — shared workspace brand, passed from App
  // (which loads it from the server on start). The sign-in screen
  // previously hardcoded the default logo / "Welcome to GiinMeet" and
  // never showed a custom brand at all.
  brandName?: string;
  brandSlogan?: string;
  logoUrl?: string;
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess, initialMode, onPasswordResetDone, brandName: brandNameProp, brandSlogan: brandSloganProp, logoUrl: logoUrlProp }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [authMode, setAuthMode] = useState<'email' | 'phone'>('email');

  // Password reset states. The reset email is sent by Supabase
  // (resetPasswordForEmail); delivery depends on email sending being
  // configured in the Supabase dashboard — the UI says so honestly when
  // the mail does not arrive.
  // 'expired' = the reset link was already used, or it expired: Supabase
  // redirects back with error=access_denied & error_code=otp_expired in
  // the hash. Detect it up front so the user gets a clear message and a
  // way to request a new link instead of a silent sign-in screen.
  const [resetView, setResetView] = useState<'none' | 'request' | 'sent' | 'recover' | 'expired'>(() => {
    const hash = window.location.hash;
    if (hash.includes('error_code=otp_expired') || hash.includes('error=access_denied')) return 'expired';
    return initialMode === 'recover' ? 'recover' : 'none';
  });
  const [resetDone, setResetDone] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // A recovery link lands here with type=recovery in the hash (Supabase
  // also fires PASSWORD_RECOVERY, which App turns into initialMode).
  // An expired or already-used link lands with error=access_denied &
  // error_code=otp_expired instead — show the expired card, not the
  // new-password form (there is no session to set a password with).
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('error_code=otp_expired') || hash.includes('error=access_denied')) {
      setResetView('expired');
    } else if (hash.includes('type=recovery')) {
      setResetView('recover');
    }
  }, []);

  // Translate raw Supabase auth errors into plain language. Raw messages
  // ("Auth session missing!", "Email rate limit exceeded") mean nothing
  // to a user and must never reach the screen.
  const friendlyAuthError = (err: any, fallback: string) => {
    const msg = String(err?.message || '');
    if (/rate limit|too many|once every/i.test(msg)) {
      return 'Too many requests — please wait a few minutes and try again.';
    }
    if (/session missing|no session|Auth session/i.test(msg)) {
      return 'This reset link is no longer valid. Request a new link below.';
    }
    // OTP: a code that expired or is wrong (Supabase: "Token has expired
    // or is invalid"). Must come before the reset-link check below.
    if (/token has expired|code.*expired|expired.*code|invalid.*(token|code|otp)|otp.*invalid/i.test(msg)) {
      return 'That code has expired or is wrong. Request a new code and try again.';
    }
    if (/phone.*provider|provider.*not|not configured|not enabled/i.test(msg)) {
      return "Phone sign-in isn't set up for this project yet — try signing in with email instead.";
    }
    if (/invalid phone|phone.*invalid|not a valid phone/i.test(msg)) {
      return "That phone number doesn't look right. Check it and try again.";
    }
    // Email OTP: the code is only sent to an EXISTING account
    // (shouldCreateUser: false). Supabase: "User not found". Route the
    // user to sign-up instead of inventing a code that will never arrive.
    if (/user not found|no user|user.*does not exist|signups not allowed/i.test(msg)) {
      return "We couldn't send a code to this email. Make sure it is the email you signed up with — or create an account with Sign up below.";
    }
    if (/invalid.*email|email.*invalid/i.test(msg)) {
      return "That email address doesn't look right. Check it and try again.";
    }
    if (/email.*otp.*disabled|otp.*disabled|email.*not enabled/i.test(msg)) {
      return "Email codes aren't turned on for this project yet — sign in with your password instead.";
    }
    if (/expired|invalid.*link|link.*invalid|otp_expired/i.test(msg)) {
      return 'This reset link has expired or was already used. Request a new one below.';
    }
    if (/network|fetch failed|Failed to fetch|network request failed/i.test(msg)) {
      return 'Could not reach the server. Check your connection and try again.';
    }
    if (/invalid login credentials|invalid.*credentials|wrong password|incorrect password/i.test(msg)) {
      return 'That email or password is not right. Check them and try again.';
    }
    return fallback;
  };

  // Input states
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  
  // Phone OTP states
  const [phone, setPhone] = useState('');
  // Rwanda-first default: GiinMeet's users are in Rwanda. The US +1
  // default forced every Rwandan user to change the country code first.
  const [countryCode, setCountryCode] = useState('+250');
  const [otpSent, setOtpSent] = useState(false);
  // Email OTP states — same 6-box entry and resend rules as phone OTP.
  // emailCodeMode = the email tab is in "sign in with a code" mode;
  // emailOtpSent = the code was sent and the boxes are showing.
  // Email codes are for EXISTING accounts only (see signInWithEmailCode);
  // a new user registers with a password through the normal sign-up.
  const [emailCodeMode, setEmailCodeMode] = useState(false);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState<string[]>(['', '', '', '', '', '']);
  const [resendTimer, setResendTimer] = useState(60);
  const [validationError, setValidationError] = useState('');

  // General state
  const [isLoading, setIsLoading] = useState(false);
  const [workspaceDiscovery, setWorkspaceDiscovery] = useState<{ domain: string; name: string; isPersonal?: boolean } | null>(null);
  const [customWorkspaceName, setCustomWorkspaceName] = useState('');

  // Transparent logo loading state (only used when App passes no
  // brand: the passed logo is already the resolved shared/custom logo).
  const [fallbackLogo, setFallbackLogo] = useState('/logo.png');
  useEffect(() => {
    if (!logoUrlProp) getTransparentLogo('/logo.png').then(url => setFallbackLogo(url));
  }, [logoUrlProp]);
  const logoUrl = logoUrlProp || fallbackLogo;
  const displayBrandName = brandNameProp || 'GiinMeet';
  const displayBrandSlogan = brandSloganProp || 'Connect, Collaborate, Virtualize';

  // Refs for the 6 OTP input boxes
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Timer countdown hook for Resend link
  useEffect(() => {
    let interval: any;
    if ((otpSent || emailOtpSent) && resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [otpSent, emailOtpSent, resendTimer]);

  // Auto discover email workspace domain
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEmail = e.target.value;
    setEmail(inputEmail);
    setValidationError('');

    if (inputEmail.includes('@')) {
      const domain = inputEmail.split('@')[1];
      const domainParts = domain.split('.');
      if (domainParts.length >= 2) {
        const lowerDomain = domain.toLowerCase();
        const isPersonalDomain = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(lowerDomain);
        if (!isPersonalDomain) {
          const companyName = domainParts[0].charAt(0).toUpperCase() + domainParts[0].slice(1);
          setWorkspaceDiscovery({
            domain,
            name: `${companyName} Workspace Directory`,
            isPersonal: false
          });
        } else {
          setWorkspaceDiscovery({
            domain,
            name: 'Personal Workspace',
            isPersonal: true
          });
        }
      } else {
        setWorkspaceDiscovery(null);
      }
    } else {
      setWorkspaceDiscovery(null);
    }
  };

  // Full E.164 number for Supabase. Rwandan numbers are typed with a
  // leading 0 (0788...) but E.164 must not have it (+250788..., never
  // +2500788...) — strip it here so the code actually arrives.
  const fullPhoneNumber = () => `${countryCode} ${phone.trim().replace(/^0+/, '')}`;

  // Dispatch SMS verification code through real Supabase phone auth. The code
  // is sent by Supabase/Twilio as configured in the dashboard — it is never
  // generated here and never shown on screen.
  const handleSendOTP = async () => {
    if (!phone) return;
    setIsLoading(true);
    setValidationError('');

    try {
      const workspaceArg = customWorkspaceName.trim() || 'Personal Workspace';
      await giinApi.signInWithPhone(fullPhoneNumber(), workspaceArg);

      setOtpSent(true);
      setResendTimer(60);

      // Focus the first OTP grid box after render
      setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 100);
    } catch (err: any) {
      console.error('Error sending verification code:', err);
      setValidationError(friendlyAuthError(err, 'Failed to send the verification code. Phone sign-in may not be set up yet — try signing in with email instead.'));
    } finally {
      setIsLoading(false);
    }
  };

  // Re-send SMS verification code
  const handleResendCode = async () => {
    setOtpCode(['', '', '', '', '', '']);
    setValidationError('');
    await handleSendOTP();
  };

  // Verify OTP submission
  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const enteredCode = otpCode.join('');
    if (enteredCode.length < 6) {
      setValidationError('Please enter all 6 digits of the code.');
      return;
    }

    setIsLoading(true);
    setValidationError('');

    try {
      const workspaceArg = customWorkspaceName.trim() || 'Personal Workspace';
      const { data } = await giinApi.verifyOTP(fullPhoneNumber(), enteredCode, name || undefined, workspaceArg);
      
      if (data.user) {
        onAuthSuccess({
          id: data.user.id,
          email: data.user.email,
          name: name || data.user.name,
          workspaceName: data.user.workspaceName,
          domain: data.user.domain
        });
      } else {
        setValidationError('Invalid verification code. Please check the code and try again.');
      }
    } catch (err: any) {
      console.error('Error verifying OTP:', err);
      const msg = String(err?.message || '');
      if (/expired|invalid/i.test(msg)) {
        // The code is dead — let the user request a fresh one immediately
        // instead of waiting out the resend countdown, and clear the
        // stale code from the boxes.
        setResendTimer(0);
        setOtpCode(['', '', '', '', '', '']);
      }
      setValidationError(friendlyAuthError(err, 'OTP verification failed. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  // Email OTP: send a 6-digit sign-in code to an EXISTING account's email.
  // The code is generated and verified by Supabase and delivered by the
  // project's configured email sender. It is never generated here and
  // never shown on screen.
  const handleSendEmailCode = async () => {
    const targetEmail = email.trim();
    if (!targetEmail) {
      setValidationError('Enter the email address for your account.');
      return;
    }
    setIsLoading(true);
    setValidationError('');
    try {
      const workspaceArg = customWorkspaceName.trim() || 'Personal Workspace';
      await giinApi.signInWithEmailCode(targetEmail, workspaceArg);
      setOtpCode(['', '', '', '', '', '']);
      setEmailOtpSent(true);
      setResendTimer(60);
      // Focus the first OTP grid box after render
      setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 100);
    } catch (err: any) {
      console.error('Error sending email verification code:', err);
      setValidationError(friendlyAuthError(err, 'Could not send the sign-in code. Email sending may not be set up for this project yet — sign in with your password instead.'));
    } finally {
      setIsLoading(false);
    }
  };

  // Re-send the email sign-in code
  const handleResendEmailCode = async () => {
    setOtpCode(['', '', '', '', '', '']);
    setValidationError('');
    await handleSendEmailCode();
  };

  // Verify the email OTP submission
  const handleVerifyEmailCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const enteredCode = otpCode.join('');
    if (enteredCode.length < 6) {
      setValidationError('Please enter all 6 digits of the code.');
      return;
    }
    setIsLoading(true);
    setValidationError('');
    try {
      const workspaceArg = customWorkspaceName.trim() || 'Personal Workspace';
      const { data } = await giinApi.verifyEmailCode(email.trim(), enteredCode, name || undefined, workspaceArg);
      if (data.user) {
        onAuthSuccess({
          id: data.user.id,
          email: data.user.email,
          name: name || data.user.name,
          workspaceName: data.user.workspaceName,
          domain: data.user.domain
        });
      } else {
        setValidationError('Invalid verification code. Please check the code and try again.');
      }
    } catch (err: any) {
      console.error('Error verifying email code:', err);
      const msg = String(err?.message || '');
      if (/expired|invalid/i.test(msg)) {
        // The code is dead — let the user request a fresh one immediately
        // instead of waiting out the resend countdown, and clear the
        // stale code from the boxes.
        setResendTimer(0);
        setOtpCode(['', '', '', '', '', '']);
      }
      setValidationError(friendlyAuthError(err, 'Email code verification failed. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  // Standard Email submit logic
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    if (!password) {
      setValidationError('Please enter your password.');
      return;
    }

    setIsLoading(true);
    setValidationError('');
    try {
      const workspaceArg = workspaceDiscovery?.isPersonal ? (customWorkspaceName.trim() || 'Personal Workspace') : undefined;
      if (isLogin) {
        const { data } = await giinApi.signIn(email, password, workspaceArg);
        if (data.user) {
          onAuthSuccess({
            id: data.user.id,
            email: data.user.email,
            name: data.user.name || email.split('@')[0],
            workspaceName: data.user.workspaceName,
            domain: data.user.domain
          });
        }
      } else {
        const { data } = await giinApi.signUp(email, password, name || email.split('@')[0], workspaceArg);
        if (data.user) {
          onAuthSuccess({
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            workspaceName: data.user.workspaceName,
            domain: data.user.domain
          });
        }
      }
    } catch (err: any) {
      console.error(err);
      setValidationError(friendlyAuthError(err, 'Sign-in failed. Please check your email and password and try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  // Google sign-in through real Supabase OAuth. Google must be enabled in the
  // Supabase dashboard (Authentication > Providers > Google); when it is not,
  // this fails with a clear message instead of inventing a signed-in session.
  const handleGoogleSSO = async () => {
    setIsLoading(true);
    setValidationError('');
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No redirect URL returned from Supabase OAuth.');
      }
    } catch (err: any) {
      console.error('[Auth] Google sign-in failed:', err);
      setValidationError(
        err?.message || 'Google sign-in failed. Google may not be enabled for this project yet — use email sign-in instead.'
      );
      setIsLoading(false);
    }
  };

  // Password reset: request the email, then set a new password from the link.
  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) {
      setValidationError('Enter the email address for your account.');
      return;
    }
    setIsLoading(true);
    setValidationError('');
    try {
      await giinApi.requestPasswordReset(resetEmail.trim());
      setResetView('sent');
    } catch (err: any) {
      setValidationError(friendlyAuthError(err, 'Could not send the reset email. Email sending may not be set up for this project yet — contact the administrator.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setValidationError('Choose a password of at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError('The two passwords do not match.');
      return;
    }
    setIsLoading(true);
    setValidationError('');
    try {
      await giinApi.updatePassword(newPassword);
      const { data: { user } } = await supabase.auth.getUser();
      // Show the success state first so the user sees the password
      // actually changed, then sign them straight in (or, if there is
      // somehow no session, hand them back to sign-in).
      setResetDone(true);
      setTimeout(() => {
        if (onPasswordResetDone) onPasswordResetDone();
        if (user) {
          onAuthSuccess({
            id: user.id,
            email: user.email || '',
            name: user.user_metadata?.name || user.email?.split('@')[0] || 'Giin User',
            workspaceName: user.user_metadata?.workspace_name || 'Personal Workspace',
            domain: (user.email?.split('@')[1] || 'personal'),
          });
        }
      }, 1200);
    } catch (err: any) {
      setValidationError(friendlyAuthError(err, 'Could not set the new password. The reset link may have expired — request a new one below.'));
    } finally {
      setIsLoading(false);
    }
  };

  // OTP inputs keyboard navigation
  const handleOtpChange = (index: number, value: string) => {
    if (value && !/^\d+$/.test(value)) return;

    const newOtp = [...otpCode];
    newOtp[index] = value;
    setOtpCode(newOtp);

    // Shift focus forward if code input filled
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!otpCode[index] && index > 0) {
        const newOtp = [...otpCode];
        newOtp[index - 1] = '';
        setOtpCode(newOtp);
        otpRefs.current[index - 1]?.focus();
      }
    }
  };

  // Paste a full 6-digit code from the SMS: distribute the digits across
  // the boxes instead of dropping all but the first digit.
  const handleOtpPaste = (startIndex: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!text) return;
    e.preventDefault();
    const next = [...otpCode];
    for (let i = 0; i < text.length && startIndex + i < 6; i++) {
      next[startIndex + i] = text[i];
    }
    setOtpCode(next);
    otpRefs.current[Math.min(startIndex + text.length, 5)]?.focus();
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--color-primary) 0%, #0B0F19 100%)',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Decorative background grid */}
      <div style={{
        position: 'absolute',
        width: '120%',
        height: '120%',
        backgroundImage: 'radial-gradient(rgba(112, 130, 190, 0.15) 1px, transparent 1px)',
        backgroundSize: '30px 30px',
        transform: 'rotate(-5deg)',
        zIndex: 1,
        pointerEvents: 'none'
      }} />

      <div className="glass-panel" style={{
        width: '460px',
        backgroundColor: 'rgba(18, 24, 38, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '2.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        color: 'white',
        zIndex: 10,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        animation: 'pop-in var(--transition-normal)'
      }}>
        {/* Branding header */}
        <div style={{ textAlign: 'center' }}>
          <img 
            src={logoUrl} 
            alt="GiinMeet Logo" 
            style={{
              width: '112px',
              height: '112px',
              objectFit: 'contain',
              borderRadius: '8px',
              margin: '0 auto 0.75rem',
              display: 'block',
            }} 
          />
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'white', fontFamily: 'var(--font-heading)' }}>
            Welcome to {displayBrandName}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.15rem' }}>
            {displayBrandSlogan}
          </p>
        </div>

        {/* Auth Mode Tabs (Only visible when entering credentials, not in OTP entry view) */}
        {!otpSent && !emailCodeMode && resetView === 'none' && (
          <div style={{
            display: 'flex',
            backgroundColor: '#090D16',
            padding: '3px',
            borderRadius: '8px',
            border: '1px solid #1E293B'
          }}>
            <button
              type="button"
              onClick={() => setAuthMode('email')}
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: authMode === 'email' ? 'var(--color-primary)' : 'transparent',
                color: authMode === 'email' ? 'white' : 'var(--text-muted)',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.8rem',
                transition: 'all 0.2s'
              }}
            >
              Email Address
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('phone')}
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: authMode === 'phone' ? 'var(--color-primary)' : 'transparent',
                color: authMode === 'phone' ? 'white' : 'var(--text-muted)',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.8rem',
                transition: 'all 0.2s'
              }}
            >
              Phone Number
            </button>
          </div>
        )}

        {/* Password reset views */}
        {resetView === 'request' && (
          <form onSubmit={handleRequestReset} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', margin: '0 0 0.25rem' }}>Reset your password</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Enter the email for your account and we will send you a link to choose a new password.
              </p>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="email"
                  className="premium-input"
                  placeholder="you@company.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                  required
                />
              </div>
            </div>
            {validationError && <div style={{ color: '#EF4444', fontSize: '0.8rem' }}>{validationError}</div>}
            <button type="submit" disabled={isLoading} className="premium-btn premium-btn-accent" style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontWeight: 700 }}>
              {isLoading ? <span>Sending…</span> : <span>Send Reset Link</span>}
            </button>
            <button type="button" onClick={() => { setResetView('none'); setValidationError(''); }} style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}>
              Back to sign in
            </button>
          </form>
        )}

        {resetView === 'sent' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', margin: 0 }}>Check your email</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              If an account exists for <strong style={{ color: 'white' }}>{resetEmail}</strong>, a password-reset link is on its way.
              Open it and choose a new password. If nothing arrives within a few minutes, check spam — and note that delivery
              needs email sending configured in the Supabase dashboard; if it is not set up, no email can arrive.
            </p>
            <button type="button" onClick={() => { setResetView('request'); setValidationError(''); }} style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}>
              Send to a different email
            </button>
            <button type="button" onClick={() => { setResetView('none'); setValidationError(''); }} style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}>
              Back to sign in
            </button>
          </div>
        )}

        {resetView === 'expired' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', margin: 0 }}>This reset link has expired</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Reset links work once and only for a short time. This one was already used, or too much time has passed.
              Request a fresh link and it will work.
            </p>
            <button type="button" onClick={() => { setResetView('request'); setValidationError(''); }} className="premium-btn premium-btn-accent" style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontWeight: 700 }}>
              Request a new reset link
            </button>
            <button type="button" onClick={() => { setResetView('none'); setValidationError(''); if (onPasswordResetDone) onPasswordResetDone(); }} style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}>
              Back to sign in
            </button>
          </div>
        )}

        {resetView === 'recover' && resetDone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', margin: 0 }}>Password updated</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Your password has been changed. Signing you in…
            </p>
          </div>
        )}

        {resetView === 'recover' && !resetDone && (
          <form onSubmit={handleSetNewPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', margin: '0 0 0.25rem' }}>Choose a new password</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                You opened the reset link — set your new password below.
              </p>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                New Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  className="premium-input"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                  required
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Confirm New Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  className="premium-input"
                  placeholder="Repeat the new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                  required
                />
              </div>
            </div>
            {validationError && <div style={{ color: '#EF4444', fontSize: '0.8rem' }}>{validationError}</div>}
            <button type="submit" disabled={isLoading} className="premium-btn premium-btn-accent" style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontWeight: 700 }}>
              {isLoading ? <span>Saving…</span> : <span>Set New Password</span>}
            </button>
            <button type="button" onClick={() => { setResetView('request'); setValidationError(''); }} style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}>
              Request a new reset link
            </button>
            <button type="button" onClick={() => { setResetView('none'); setValidationError(''); if (onPasswordResetDone) onPasswordResetDone(); }} style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}>
              Back to sign in
            </button>
          </form>
        )}

        {/* Email form gateway */}
        {authMode === 'email' && resetView === 'none' && !emailCodeMode && (
          <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {!isLogin && (
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Full Name
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    className="premium-input" 
                    placeholder="e.g. Sofia Brant"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Email Address (Work or Personal)
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="email" 
                  className="premium-input" 
                  placeholder="you@company.com or you@gmail.com"
                  value={email}
                  onChange={handleEmailChange}
                  style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                  required
                />
              </div>
              
              {workspaceDiscovery && (
                <div style={{
                  marginTop: '0.4rem',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '6px',
                  backgroundColor: workspaceDiscovery.isPersonal ? 'rgba(112, 130, 190, 0.15)' : 'rgba(250, 189, 2, 0.12)',
                  border: workspaceDiscovery.isPersonal ? '1px solid rgba(112, 130, 190, 0.3)' : '1px solid rgba(250, 189, 2, 0.3)',
                  color: workspaceDiscovery.isPersonal ? 'white' : 'var(--color-accent)',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  animation: 'pop-in 0.25s ease'
                }}>
                  <Sparkles size={11} color={workspaceDiscovery.isPersonal ? 'var(--color-secondary)' : 'var(--color-accent)'} />
                  <span>
                    {workspaceDiscovery.isPersonal 
                      ? 'Personal Account: Routing to your GIIN Personal space'
                      : `Domain Recognized: Routing to ${workspaceDiscovery.name}`
                    }
                  </span>
                </div>
              )}

              {workspaceDiscovery?.isPersonal && (
                <div style={{ marginTop: '0.6rem', animation: 'slide-in 0.2s ease' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    Custom Workspace Name (Optional)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Globe size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input 
                      type="text" 
                      className="premium-input" 
                      placeholder="e.g. My Study Group, Hleo's Dev Team"
                      value={customWorkspaceName}
                      onChange={(e) => setCustomWorkspaceName(e.target.value)}
                      style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Secret Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="password" 
                  className="premium-input" 
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setValidationError(''); }}
                  style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                  required
                />
              </div>
              {isLogin && (
                <div style={{ textAlign: 'right', marginTop: '0.4rem' }}>
                  <button
                    type="button"
                    onClick={() => { setResetEmail(email); setResetView('request'); setValidationError(''); }}
                    style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>

            {validationError && <div style={{ color: '#EF4444', fontSize: '0.8rem', fontWeight: 600 }}>{validationError}</div>}
            <button 
              type="submit" 
              disabled={isLoading}
              className="premium-btn premium-btn-accent" 
              style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontWeight: 700, marginTop: '0.5rem' }}
            >
              {isLoading ? (
                <span>Authenticating Workspace...</span>
              ) : (
                <>
                  <span>{isLogin ? 'Sign In' : 'Register Securely'}</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            {isLogin && (
              <button
                type="button"
                onClick={() => { setEmailCodeMode(true); setOtpCode(['', '', '', '', '', '']); setValidationError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, alignSelf: 'center' }}
              >
                Sign in with an email code instead
              </button>
            )}
          </form>
        )}

        {/* Email code sign-in (existing accounts only — a new user registers with a password) */}
        {authMode === 'email' && resetView === 'none' && emailCodeMode && isLogin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <button
              type="button"
              onClick={() => { setEmailCodeMode(false); setEmailOtpSent(false); setValidationError(''); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                fontSize: '0.8rem',
                padding: 0,
                alignSelf: 'flex-start'
              }}
            >
              <ArrowLeft size={14} />
              <span>Back to password sign-in</span>
            </button>

            {!emailOtpSent ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', margin: '0 0 0.25rem' }}>Sign in with an email code</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                    We will send a 6-digit code to your email. It works for the account you already have — if you don't have one yet, create it with Sign up below.
                  </p>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    Email Address
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="email"
                      className="premium-input"
                      placeholder="you@company.com"
                      value={email}
                      onChange={handleEmailChange}
                      style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                      required
                    />
                  </div>
                </div>
                {validationError && <div style={{ color: '#EF4444', fontSize: '0.8rem' }}>{validationError}</div>}
                <button
                  type="button"
                  onClick={handleSendEmailCode}
                  disabled={isLoading || !email.trim()}
                  className="premium-btn premium-btn-accent"
                  style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontWeight: 700 }}
                >
                  {isLoading ? <span>Sending Code...</span> : <span>Send Email Code</span>}
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerifyEmailCode} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  A 6-digit code was sent to <strong style={{ color: 'white' }}>{email}</strong>
                </span>

                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <input
                      key={idx}
                      type="text"
                      maxLength={1}
                      ref={el => { otpRefs.current[idx] = el; }}
                      value={otpCode[idx]}
                      onChange={e => handleOtpChange(idx, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(idx, e)}
                      onPaste={e => handleOtpPaste(idx, e)}
                      style={{
                        width: '44px',
                        height: '48px',
                        backgroundColor: '#090D16',
                        border: '2px solid #1E293B',
                        borderRadius: '8px',
                        color: 'white',
                        textAlign: 'center',
                        fontSize: '1.3rem',
                        fontWeight: 800,
                        outline: 'none',
                        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
                        borderColor: validationError ? '#EF4444' : '#1E293B'
                      }}
                    />
                  ))}
                </div>

                {validationError && (
                  <span style={{ color: '#EF4444', fontSize: '0.75rem', fontWeight: 600 }}>
                    {validationError}
                  </span>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="premium-btn premium-btn-accent"
                  style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontWeight: 700 }}
                >
                  {isLoading ? <span>Verifying Code...</span> : <span>Verify & Sign In</span>}
                </button>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {resendTimer > 0 ? (
                    <span>Resend code in <strong style={{ color: 'white' }}>{resendTimer}s</strong></span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendEmailCode}
                      disabled={isLoading}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-accent)',
                        cursor: isLoading ? 'wait' : 'pointer',
                        fontWeight: 700,
                        padding: 0
                      }}
                    >
                      {isLoading ? 'Sending…' : 'Resend Email Code'}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => { setEmailOtpSent(false); setOtpCode(['', '', '', '', '', '']); setValidationError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Send to a different email
                </button>
              </form>
            )}
          </div>
        )}

        {/* Phone form gateway */}
        {authMode === 'phone' && resetView === 'none' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {otpSent && (
              <button 
                type="button" 
                onClick={() => { setOtpSent(false); setValidationError(''); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.8rem',
                  padding: 0,
                  alignSelf: 'flex-start'
                }}
              >
                <ArrowLeft size={14} />
                <span>Change Phone Number</span>
              </button>
            )}

            {!otpSent ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {!isLogin && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                      Full Name
                    </label>
                    <div style={{ position: 'relative' }}>
                      <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input 
                        type="text" 
                        className="premium-input" 
                        placeholder="e.g. Sofia Brant"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                        required
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    Phone Number
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <select
                      value={countryCode}
                      onChange={e => setCountryCode(e.target.value)}
                      style={{
                        width: '110px',
                        backgroundColor: '#090D16',
                        border: '1px solid #1E293B',
                        borderRadius: '6px',
                        color: 'white',
                        padding: '0.5rem',
                        fontSize: '0.8rem',
                        outline: 'none'
                      }}
                    >
                      {WORLD_DIALING_CODES.map(c => (
                        <option key={c.iso} value={c.code}>
                          {c.code} ({c.name})
                        </option>
                      ))}
                    </select>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Phone size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input 
                        type="tel" 
                        className="premium-input" 
                        placeholder="788 123 456"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                        required
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    Workspace Name (Optional)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Globe size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input 
                      type="text" 
                      className="premium-input" 
                      placeholder="e.g. My Study Group, Hleo's Dev Team"
                      value={customWorkspaceName}
                      onChange={(e) => setCustomWorkspaceName(e.target.value)}
                      style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                    />
                  </div>
                </div>

                <button 
                  type="button"
                  onClick={handleSendOTP}
                  disabled={isLoading || !phone}
                  className="premium-btn premium-btn-accent" 
                  style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontWeight: 700, marginTop: '0.5rem' }}
                >
                  {isLoading ? <span>Sending Code...</span> : <span>Send Verification Code</span>}
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerifyOTP} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  A 6-digit code was sent to <strong style={{ color: 'white' }}>{countryCode} {phone}</strong>
                </span>

                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <input
                      key={idx}
                      type="text"
                      maxLength={1}
                      ref={el => { otpRefs.current[idx] = el; }}
                      value={otpCode[idx]}
                      onChange={e => handleOtpChange(idx, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(idx, e)}
                      onPaste={e => handleOtpPaste(idx, e)}
                      style={{
                        width: '44px',
                        height: '48px',
                        backgroundColor: '#090D16',
                        border: '2px solid #1E293B',
                        borderRadius: '8px',
                        color: 'white',
                        textAlign: 'center',
                        fontSize: '1.3rem',
                        fontWeight: 800,
                        outline: 'none',
                        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
                        borderColor: validationError ? '#EF4444' : '#1E293B'
                      }}
                    />
                  ))}
                </div>

                {validationError && (
                  <span style={{ color: '#EF4444', fontSize: '0.75rem', fontWeight: 600 }}>
                    {validationError}
                  </span>
                )}

                <button 
                  type="submit"
                  disabled={isLoading}
                  className="premium-btn premium-btn-accent" 
                  style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontWeight: 700 }}
                >
                  {isLoading ? <span>Verifying OTP...</span> : <span>Verify & Authenticate</span>}
                </button>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {resendTimer > 0 ? (
                    <span>Resend code in <strong style={{ color: 'white' }}>{resendTimer}s</strong></span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendCode}
                      disabled={isLoading}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-accent)',
                        cursor: isLoading ? 'wait' : 'pointer',
                        fontWeight: 700,
                        padding: 0
                      }}
                    >
                      {isLoading ? 'Sending…' : 'Resend Verification SMS'}
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        )}

        {/* Divider */}
        {!otpSent && !emailCodeMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#1E293B' }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>OR ENTER WITH SSO</span>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#1E293B' }} />
          </div>
        )}

        {/* SSO Button (Hidden in OTP verification code entry view) */}
        {!otpSent && !emailCodeMode && resetView === 'none' && (
          <button 
            onClick={handleGoogleSSO}
            disabled={isLoading}
            className="premium-btn premium-btn-secondary" 
            style={{ 
              width: '100%', 
              borderColor: '#1E293B', 
              color: 'white', 
              justifyContent: 'center', 
              textTransform: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '8px',
              padding: '0.65rem 1rem',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
              {isLogin ? 'Sign in with Google' : 'Sign up with Google'}
            </span>
          </button>
        )}

        {/* Toggle between Register/Login */}
        {!otpSent && !emailCodeMode && resetView === 'none' && (
          <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {isLogin ? (
              <span>
                Don't have an enterprise account?{' '}
                <button 
                  onClick={() => { setIsLogin(false); setValidationError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
                >
                  Sign Up
                </button>
              </span>
            ) : (
              <span>
                Already registered your workspace?{' '}
                <button 
                  onClick={() => { setIsLogin(true); setValidationError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
                >
                  Sign In
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
