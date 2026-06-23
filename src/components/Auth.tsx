import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Mail, Lock, User, ArrowRight, Globe, Phone, ArrowLeft } from 'lucide-react';
import { mockAuth, supabase, getTransparentLogo } from '../supabaseClient';
import { generate6DigitOTP, sendTwilioSMS, sendResendEmail } from '../services/authIntegration';

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
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [authMode, setAuthMode] = useState<'email' | 'phone'>('email');

  // Input states
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  
  // Phone OTP states
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState<string[]>(['', '', '', '', '', '']);
  const [resendTimer, setResendTimer] = useState(60);
  const [validationError, setValidationError] = useState('');

  // General state
  const [isLoading, setIsLoading] = useState(false);
  const [workspaceDiscovery, setWorkspaceDiscovery] = useState<{ domain: string; name: string; isPersonal?: boolean } | null>(null);
  const [customWorkspaceName, setCustomWorkspaceName] = useState('');

  // Simulated Alert Overlay State
  const [otpNotification, setOtpNotification] = useState<{ destination: string; code: string; channel: string } | null>(null);

  // Transparent logo loading state
  const [logoUrl, setLogoUrl] = useState('/logo.png');
  useEffect(() => {
    getTransparentLogo('/logo.png').then(url => setLogoUrl(url));
  }, []);

  // Refs for the 6 OTP input boxes
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Listen for the custom window event from the auth integration service
  useEffect(() => {
    const handleOtpEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      setOtpNotification(customEvent.detail);
      
      // Auto-clear notification alert after 10 seconds
      const timer = setTimeout(() => {
        setOtpNotification(null);
      }, 10000);
      return () => clearTimeout(timer);
    };

    window.addEventListener('giin_otp_delivered', handleOtpEvent);
    return () => {
      window.removeEventListener('giin_otp_delivered', handleOtpEvent);
    };
  }, []);

  // Timer countdown hook for Resend link
  useEffect(() => {
    let interval: any;
    if (otpSent && resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [otpSent, resendTimer]);

  // Auto discover email workspace domain
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEmail = e.target.value;
    setEmail(inputEmail);

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

  // Dispatch SMS verification code
  const handleSendOTP = async () => {
    if (!phone) return;
    setIsLoading(true);
    setValidationError('');
    
    try {
      const code = generate6DigitOTP();
      const destination = `${countryCode} ${phone}`;
      
      // Dispatch verification code via Twilio
      await sendTwilioSMS(destination, code);
      
      setOtpSent(true);
      setResendTimer(60);
      
      // Focus the first OTP grid box after render
      setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 100);
    } catch (err) {
      console.error('Error generating verification code:', err);
      setValidationError('Failed to generate verification code. Please try again.');
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
      const { data } = await mockAuth.verifyOTP(`${countryCode} ${phone}`, enteredCode, name || undefined, workspaceArg);
      
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
    } catch (err) {
      console.error('Error verifying OTP:', err);
      setValidationError('OTP verification failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Standard Email submit logic
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    try {
      const workspaceArg = workspaceDiscovery?.isPersonal ? (customWorkspaceName.trim() || 'Personal Workspace') : undefined;
      if (isLogin) {
        const { data } = await mockAuth.signIn(email, workspaceArg);
        if (data.user) {
          // Trigger a simulated Resend API notification email upon login success
          await sendResendEmail(data.user.email, 'Logged in to your workspace successfully!');
          
          onAuthSuccess({
            id: data.user.id,
            email: data.user.email,
            name: data.user.name || email.split('@')[0],
            workspaceName: data.user.workspaceName,
            domain: data.user.domain
          });
        }
      } else {
        const { data } = await mockAuth.signUp(email, name || email.split('@')[0], workspaceArg);
        if (data.user) {
          // Trigger a simulated Resend welcome email upon registration
          await sendResendEmail(data.user.email, 'Welcome to GIIN MEET! Verify your corporate profile');

          onAuthSuccess({
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            workspaceName: data.user.workspaceName,
            domain: data.user.domain
          });
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Google SSO simulated gateway
  const handleGoogleSSO = async () => {
    setIsLoading(true);
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
      console.warn('[Auth] Real Google OAuth redirect failed, falling back to simulated session.', err.message);
      // High-fidelity fallback
      setTimeout(() => {
        const targetEmail = email.trim() || 'sofia.brant@gmail.com';
        const domain = targetEmail.split('@')[1] || 'gmail.com';
        const defaultName = targetEmail.split('@')[0].split('.').map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(' ');
        const isPersonalDomain = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(domain.toLowerCase());
        
        const workspace = isPersonalDomain 
          ? (customWorkspaceName.trim() || 'Personal Workspace')
          : `${domain.split('.')[0].toUpperCase()} Enterprise Workspace`;

        sendResendEmail(targetEmail, 'Welcome to GIIN MEET! Signed up via Google SSO');

        onAuthSuccess({
          id: 'mock-google-id-' + Math.random().toString(36).substr(2, 5),
          email: targetEmail,
          name: name || defaultName,
          workspaceName: workspace,
          domain: domain
        });
        setIsLoading(false);
      }, 1200);
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
      {/* Sliding OTP API Notification Banner */}
      {otpNotification && (
        <div style={{
          position: 'absolute',
          top: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '90%',
          maxWidth: '400px',
          backgroundColor: '#0F172A',
          border: '1.5px solid var(--color-accent)',
          borderRadius: '12px',
          padding: '1rem',
          boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.7)',
          zIndex: 9999,
          color: 'white',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          borderLeft: '5px solid var(--color-accent)',
          animation: 'slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                backgroundColor: 'rgba(250, 189, 2, 0.15)',
                color: 'var(--color-accent)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '0.7rem',
                fontWeight: 700
              }}>
                {otpNotification.channel} API
              </span>
              <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>Incoming Message</span>
            </div>
            <button 
              onClick={() => setOtpNotification(null)}
              style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '1rem' }}
            >
              &times;
            </button>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#E2E8F0', lineHeight: 1.4 }}>
            Your 6-digit verification code is <strong style={{ color: 'var(--color-accent)', fontSize: '1.1rem', letterSpacing: '0.05em' }}>{otpNotification.code}</strong>. Valid for 5 minutes.
          </div>
          
          {authMode === 'phone' && otpSent && (
            <button 
              onClick={() => {
                const digits = otpNotification.code.split('');
                setOtpCode(digits);
                setOtpNotification(null);
                setTimeout(() => otpRefs.current[5]?.focus(), 50);
              }}
              style={{
                alignSelf: 'flex-end',
                padding: '0.35rem 0.8rem',
                borderRadius: '6px',
                backgroundColor: 'var(--color-accent)',
                color: 'black',
                border: 'none',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Autofill Verification Code
            </button>
          )}
        </div>
      )}

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
            alt="GIIN MEET Logo" 
            style={{
              width: '64px',
              height: '64px',
              objectFit: 'contain',
              borderRadius: '8px',
              margin: '0 auto 0.75rem',
              display: 'block',
              filter: 'brightness(0) invert(1)'
            }} 
          />
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'white', fontFamily: 'var(--font-heading)' }}>
            Welcome to GIIN MEET
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.15rem' }}>
            Next-Generation Corporate Virtualization Hub
          </p>
        </div>

        {/* Auth Mode Tabs (Only visible when entering credentials, not in OTP entry view) */}
        {!otpSent && (
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

        {/* Email form gateway */}
        {authMode === 'email' && (
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
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                  required
                />
              </div>
            </div>

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
          </form>
        )}

        {/* Phone form gateway */}
        {authMode === 'phone' && (
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
                        placeholder="(555) 019-2834"
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
                  {isLoading ? <span>Generating Code...</span> : <span>Send Verification Code</span>}
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
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-accent)',
                        cursor: 'pointer',
                        fontWeight: 700,
                        padding: 0
                      }}
                    >
                      Resend Verification SMS
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        )}

        {/* Divider */}
        {!otpSent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#1E293B' }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>OR ENTER WITH SSO</span>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#1E293B' }} />
          </div>
        )}

        {/* SSO Button (Hidden in OTP verification code entry view) */}
        {!otpSent && (
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
        {!otpSent && (
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
