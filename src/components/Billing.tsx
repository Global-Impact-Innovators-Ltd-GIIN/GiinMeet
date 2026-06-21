import React, { useState } from 'react';
import { 
  Check, CreditCard, ChevronRight, ArrowLeft, ShieldCheck, 
  Sparkles, Gift, Info
} from 'lucide-react';

interface BillingProps {
  isPremium: boolean;
  onUpgradeSuccess: () => void;
  onDowngrade: () => void;
}

export const Billing: React.FC<BillingProps> = ({ 
  isPremium, 
  onUpgradeSuccess,
  onDowngrade
}) => {
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'pro' | 'enterprise'>('pro');
  const [checkoutStep, setCheckoutStep] = useState<1 | 2 | 3 | 4>(1);
  
  // Checkout Form State
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'paypal' | 'googlepay'>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCVV, setCardCVV] = useState('');
  const [cardName, setCardName] = useState('');
  const [formError, setFormError] = useState('');

  const plans = [
    {
      id: 'free',
      name: 'Free Plan',
      price: '$0',
      period: 'forever',
      description: 'Core tools for small personal calls.',
      features: [
        'Up to 40 minutes per meeting',
        'Up to 100 participants',
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
        'Up to 300 participants',
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
        'Up to 1000 participants room size',
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

  const handleStartCheckout = (planId: 'pro' | 'enterprise') => {
    setSelectedPlan(planId);
    setCheckoutStep(1);
    setShowCheckoutModal(true);
  };

  const handleNextStep = () => {
    if (checkoutStep === 1) {
      setCheckoutStep(2);
    } else if (checkoutStep === 2) {
      // Validate details
      if (paymentMethod === 'card') {
        if (!cardNumber || !cardExpiry || !cardCVV || !cardName) {
          setFormError('Please fill in all credit card details.');
          return;
        }
        if (cardNumber.replace(/\s/g, '').length < 16) {
          setFormError('Card number must be 16 digits.');
          return;
        }
        if (cardCVV.length < 3) {
          setFormError('CVV must be 3 or 4 digits.');
          return;
        }
      }
      setFormError('');
      setCheckoutStep(3);
    } else if (checkoutStep === 3) {
      // Complete payment
      onUpgradeSuccess();
      setCheckoutStep(4);
    }
  };

  const handlePrevStep = () => {
    if (checkoutStep > 1) {
      setCheckoutStep((checkoutStep - 1) as any);
    }
  };

  const handleCloseCheckout = () => {
    setShowCheckoutModal(false);
    // Reset wizard
    setCheckoutStep(1);
    setCardNumber('');
    setCardExpiry('');
    setCardCVV('');
    setCardName('');
    setFormError('');
  };

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
                onClick={() => handleStartCheckout(plan.id as any)}
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

      {/* Multi-step Payment Modal */}
      {showCheckoutModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(6px)'
        }}>
          <div className="glass-panel" style={{
            width: '500px',
            backgroundColor: 'var(--bg-card)',
            padding: '2.5rem',
            animation: 'pop-in var(--transition-normal)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            
            {/* Modal Header */}
            {checkoutStep < 4 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {checkoutStep > 1 && (
                    <button 
                      onClick={handlePrevStep}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-main)' }}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                  <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)' }}>
                    Checkout - {selectedPlan === 'pro' ? 'Pro Plan' : 'Enterprise Plan'}
                  </h3>
                </div>
                <button 
                  onClick={handleCloseCheckout}
                  style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  &times;
                </button>
              </div>
            )}

            {/* Steps Visualizer */}
            {checkoutStep < 4 && (
              <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '2rem' }}>
                {[1, 2, 3].map((step) => (
                  <div 
                    key={step} 
                    style={{ 
                      flex: 1, 
                      height: '4px', 
                      borderRadius: '2px',
                      backgroundColor: checkoutStep >= step ? 'var(--color-primary)' : 'var(--border-color)' 
                    }} 
                  />
                ))}
              </div>
            )}

            {/* Step 1: Select payment method */}
            {checkoutStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h4 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)' }}>Select Payment Method</h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div 
                    onClick={() => setPaymentMethod('card')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      border: paymentMethod === 'card' ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                      backgroundColor: 'var(--bg-card)'
                    }}
                  >
                    <CreditCard size={20} color="var(--color-secondary)" />
                    <span style={{ fontWeight: 600, flex: 1 }}>Credit / Debit Card</span>
                    <input type="radio" checked={paymentMethod === 'card'} readOnly />
                  </div>

                  <div 
                    onClick={() => setPaymentMethod('paypal')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      border: paymentMethod === 'paypal' ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                      backgroundColor: 'var(--bg-card)'
                    }}
                  >
                    <span style={{ fontWeight: 800, color: '#003087', fontSize: '1.1rem' }}>PayPal</span>
                    <span style={{ flex: 1 }} />
                    <input type="radio" checked={paymentMethod === 'paypal'} readOnly />
                  </div>

                  <div 
                    onClick={() => setPaymentMethod('googlepay')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      border: paymentMethod === 'googlepay' ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                      backgroundColor: 'var(--bg-card)'
                    }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Google Pay / Apple Pay</span>
                    <span style={{ flex: 1 }} />
                    <input type="radio" checked={paymentMethod === 'googlepay'} readOnly />
                  </div>
                </div>

                <button onClick={handleNextStep} className="premium-btn premium-btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                  <span>Continue</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {/* Step 2: Enter Details */}
            {checkoutStep === 2 && (
              <div>
                {paymentMethod === 'card' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <h4 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)' }}>Enter Card Details</h4>
                    
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>Cardholder Name</label>
                      <input 
                        type="text" 
                        className="premium-input" 
                        placeholder="e.g. Sofia Brant"
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>Card Number</label>
                      <input 
                        type="text" 
                        className="premium-input" 
                        placeholder="xxxx xxxx xxxx xxxx"
                        maxLength={19}
                        value={cardNumber}
                        onChange={(e) => {
                          // formatting space after 4 digits
                          const v = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
                          const matches = v.match(/\d{4,16}/g);
                          const match = matches && matches[0] || '';
                          const parts = [];
                          for (let i = 0, len = match.length; i < len; i += 4) {
                            parts.push(match.substring(i, i + 4));
                          }
                          if (parts.length > 0) {
                            setCardNumber(parts.join(' '));
                          } else {
                            setCardNumber(v);
                          }
                        }}
                        required
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>Expiry Date</label>
                        <input 
                          type="text" 
                          className="premium-input" 
                          placeholder="MM/YY"
                          maxLength={5}
                          value={cardExpiry}
                          onChange={(e) => {
                            let v = e.target.value.replace(/[^0-9]/g, '');
                            if (v.length >= 2) {
                              setCardExpiry(v.substring(0, 2) + '/' + v.substring(2, 4));
                            } else {
                              setCardExpiry(v);
                            }
                          }}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>CVV</label>
                        <input 
                          type="password" 
                          className="premium-input" 
                          placeholder="123"
                          maxLength={4}
                          value={cardCVV}
                          onChange={(e) => setCardCVV(e.target.value.replace(/[^0-9]/g, ''))}
                          required
                        />
                      </div>
                    </div>

                    {formError && (
                      <p style={{ color: '#EF4444', fontSize: '0.8rem' }}>{formError}</p>
                    )}

                    <button onClick={handleNextStep} className="premium-btn premium-btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                      <span>Review Details</span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                    <ShieldCheck size={48} color="var(--color-secondary)" style={{ margin: '0 auto 1.5rem' }} />
                    <h4 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Authorize Payment Gateway</h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                      Click below to simulate login credentials authorization popup window securely.
                    </p>
                    <button onClick={handleNextStep} className="premium-btn premium-btn-primary" style={{ width: '100%' }}>
                      Authorize & Review
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Review summary */}
            {checkoutStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h4 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)' }}>Order Summary</h4>
                
                <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-app)' }}>
                  <div className="flex-between" style={{ marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Subscription</span>
                    <span style={{ fontWeight: 600 }}>GIIN MEET {selectedPlan === 'pro' ? 'Pro' : 'Enterprise'}</span>
                  </div>
                  <div className="flex-between" style={{ marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Billing Cycle</span>
                    <span>Monthly</span>
                  </div>
                  <div className="flex-between" style={{ marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Payment Method</span>
                    <span style={{ textTransform: 'capitalize' }}>{paymentMethod}</span>
                  </div>
                  <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: '0.75rem 0' }} />
                  <div className="flex-between" style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    <span>Total Cost</span>
                    <span style={{ color: 'var(--color-primary)' }}>{selectedPlan === 'pro' ? '$9.99' : '$19.99'} / mo</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <Info size={16} style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                  <span>By clicking "Complete Payment" you agree to our Terms of Service. You can cancel at any time.</span>
                </div>

                <button 
                  onClick={handleNextStep} 
                  className="premium-btn premium-btn-accent" 
                  style={{ width: '100%', padding: '1rem', justifyContent: 'center' }}
                >
                  <ShieldCheck size={20} />
                  <span>Complete Payment & Activate Pro</span>
                </button>
              </div>
            )}

            {/* Step 4: Congratulations Success Modal */}
            {checkoutStep === 4 && (
              <div style={{ textAlign: 'center', padding: '1rem 0', animation: 'float 3s ease-in-out infinite' }}>
                <div style={{
                  position: 'relative',
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(250, 189, 2, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1.5rem'
                }}>
                  <Sparkles size={40} color="var(--color-accent)" />
                  {/* Absolute positioning sparkles */}
                  <span style={{ position: 'absolute', top: '10px', right: '10px', animation: 'pulse-ring 1s infinite' }}><Gift size={14} color="var(--color-accent)" /></span>
                </div>

                <h3 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-heading)', fontWeight: 800, color: 'var(--color-primary)', marginBottom: '0.5rem' }}>
                  Congratulations!
                </h3>
                <p style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '1rem' }}>
                  You are now a GIIN MEET Pro Member.
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '2rem', maxWidth: '360px', margin: '0 auto 2rem' }}>
                  Your account has been upgraded instantly. All premium limits have been removed. Explore virtualizing your calls!
                </p>

                <button 
                  onClick={handleCloseCheckout}
                  className="premium-btn premium-btn-primary" 
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  Start Hosting Pro Meetings
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
