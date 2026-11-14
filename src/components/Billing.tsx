import React, { useState } from 'react';
import {
  Check, Sparkles, Info
} from 'lucide-react';

interface BillingProps {
  isPremium: boolean;
  onDowngrade: () => void;
}

// Paid upgrades are NOT live yet: there is no payment processor connected, so
// this screen never collects card details. The plans below are shown for
// reference only, and the upgrade buttons explain that Pro is coming soon.
export const Billing: React.FC<BillingProps> = ({
  isPremium,
  onDowngrade
}) => {
  const [showComingSoon, setShowComingSoon] = useState(false);

  const plans = [
    {
      id: 'free',
      name: 'Free Plan',
      price: '$0',
      period: 'forever',
      description: 'Core tools for small personal calls.',
      features: [
        'Up to 40 minutes per meeting',
        'Up to 50 participants per room',
        'Standard layout grid options',
        'Live in-meeting text chat',
      ],
      isPopular: false,
      buttonText: 'Current Plan',
      disabled: true
    },
    {
      id: 'pro',
      name: 'Pro Plan',
      price: '$9.99',
      period: 'month',
      description: 'Enhanced features for growing startup teams.',
      features: [
        'Unlimited meeting duration (up to 24h)',
        'Up to 100 participants per room',
        'Custom virtual backgrounds & canvas sharing',
        'Full meeting history log retrieval',
        'Premium customer support bot replies',
        'Confetti & Sparkles celebration',
      ],
      isPopular: true,
      buttonText: 'Upgrade to Pro',
      disabled: false
    },
    {
      id: 'enterprise',
      name: 'Enterprise Plan',
      price: '$19.99',
      period: 'month',
      description: 'Next-generation features for large operations.',
      features: [
        'Everything in Pro plan',
        'Up to 250 participants per room',
        'Dedicated virtualization servers (Ultra-HD)',
        'Custom integrations API token',
        '24/7 Priority support hotline assistance',
        'SSO & SAML Security credentials',
      ],
      isPopular: false,
      buttonText: 'Upgrade to Enterprise',
      disabled: false
    }
  ];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '2.5rem',
      paddingBottom: '3rem',
      animation: 'slide-in var(--transition-normal)'
    }}>

      {/* Title Header */}
      <div style={{ textAlign: 'center' }}>
        <span className="badge badge-premium" style={{ marginBottom: '1rem' }}>Pricing Tiers</span>
        <h1 style={{ fontSize: '2.5rem', fontFamily: 'var(--font-heading)', fontWeight: 800, marginBottom: '0.5rem' }}>
          Upgrade to GIIN MEET Pro
        </h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: '600px', margin: '0 auto', fontSize: '1.05rem' }}>
          Select the tier that fits your collaboration flow and experience virtualization at its peak.
        </p>
      </div>

      {/* Pro upgrade coming soon */}
      {showComingSoon && (
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'flex-start',
          maxWidth: '640px',
          margin: '0 auto',
          padding: '1rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'rgba(250, 189, 2, 0.08)',
          border: '1px solid rgba(250, 189, 2, 0.4)',
          color: 'var(--text-main)',
          fontSize: '0.9rem',
          lineHeight: 1.5
        }}>
          <Sparkles size={20} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
          <div>
            <strong>Pro upgrade coming soon.</strong> Paid plans are not available yet — no payment
            method is connected, so no card details are collected and nothing is charged.
            You can keep using the Free plan for now.
          </div>
          <button
            onClick={() => setShowComingSoon(false)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem', flexShrink: 0 }}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* Subscription Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '2rem',
        alignItems: 'stretch'
      }}>
        {plans.map((plan) => (
          <div
            key={plan.id}
            className="glass-panel"
            style={{
              padding: '2.5rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              border: plan.isPopular ? '2px solid var(--color-accent)' : '1px solid var(--border-color)',
              position: 'relative',
              backgroundColor: plan.isPopular ? 'rgba(var(--color-primary-rgb), 0.03)' : 'var(--bg-card)',
              transition: 'transform var(--transition-normal)'
            }}
          >
            {plan.isPopular && (
              <span style={{
                position: 'absolute',
                top: '-14px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'var(--color-accent)',
                color: 'black',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase'
              }}>
                Most Popular
              </span>
            )}

            <div>
              <h3 style={{ fontSize: '1.4rem', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>
                {plan.name}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', minHeight: '40px', marginBottom: '1.5rem' }}>
                {plan.description}
              </p>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem', marginBottom: '2rem' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-main)' }}>{plan.price}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>/ {plan.period}</span>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', marginBottom: '2rem' }} />

              <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', listStyle: 'none', padding: 0, marginBottom: '2.5rem' }}>
                {plan.features.map((feat, idx) => (
                  <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <Check size={16} color="var(--color-secondary)" style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            {isPremium && plan.id !== 'free' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  color: '#10B981',
                  textAlign: 'center',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}>
                  Active Subscription
                </div>
                <button
                  onClick={onDowngrade}
                  className="premium-btn premium-btn-secondary"
                  style={{ width: '100%', padding: '0.5rem' }}
                >
                  Cancel Plan
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowComingSoon(true)}
                disabled={plan.disabled}
                className={`premium-btn ${plan.isPopular ? 'premium-btn-accent' : 'premium-btn-primary'}`}
                style={{ width: '100%', opacity: plan.disabled ? 0.6 : 1, cursor: plan.disabled ? 'not-allowed' : 'pointer' }}
              >
                {plan.buttonText}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Note: no payment is taken on this screen */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '640px', margin: '0 auto' }}>
        <Info size={16} style={{ flexShrink: 0, marginTop: '0.15rem' }} />
        <span>Paid upgrades are coming soon. This screen does not collect payment details and does not charge anything.</span>
      </div>
    </div>
  );
};
