import React, { useEffect, useState } from 'react';
import { Award, Download, RotateCcw } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

// Phase C2a (5), attendance certificates.
//
// After a training session or class, every attendee automatically gets
// a certificate with their name, the topic and the date, built from the
// Phase C1 attendance events (feature 34) plus the Phase 1 attendance
// rows. The certificate is a branded PDF, drawn on this device with
// jsPDF, free and offline, no provider and no key. Downloading one
// also registers it in the library (feature 28), so certificates are
// downloadable from the library afterwards too.
//
// States are all explicit: loading, empty when no attendance was
// recorded, error with a retry, and the attendee list when ready.
interface Props {
  meetingId: string;
  meetingTitle: string;
  meetingDate?: string;
}

interface Attendee {
  name: string;
  joinedAt?: string | null;
}

export function downloadCertificatePdf(
  attendeeName: string,
  meetingTitle: string,
  meetingDate: string,
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 297;
  const pageH = 210;
  // Gold double border, the GiinMeet premium frame.
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(1.2);
  doc.rect(10, 10, pageW - 20, pageH - 20);
  doc.setLineWidth(0.4);
  doc.rect(13, 13, pageW - 26, pageH - 26);
  // Brand and heading.
  doc.setTextColor(0, 32, 91);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('GIINMEET', pageW / 2, 34, { align: 'center' });
  doc.setFontSize(13);
  doc.setTextColor(90, 90, 90);
  doc.setFont('helvetica', 'normal');
  doc.text('Certificate of Attendance', pageW / 2, 46, { align: 'center' });
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.6);
  doc.line(pageW / 2 - 30, 52, pageW / 2 + 30, 52);
  // Body.
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(12);
  doc.text('This certificate is awarded to', pageW / 2, 72, { align: 'center' });
  doc.setTextColor(11, 15, 25);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text(attendeeName.slice(0, 60), pageW / 2, 92, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);
  doc.text('for attending', pageW / 2, 108, { align: 'center' });
  doc.setTextColor(0, 32, 91);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const topicLines = doc.splitTextToSize(meetingTitle.slice(0, 160), 220);
  doc.text(topicLines, pageW / 2, 122, { align: 'center' });
  const topicHeight = topicLines.length * 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);
  doc.text(`on ${meetingDate}`, pageW / 2, 122 + topicHeight + 8, { align: 'center' });
  // Sign-off.
  doc.setFontSize(11);
  doc.text('GiinMeet', pageW / 2, 178, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('Issued from the recorded attendance of this meeting.', pageW / 2, 186, { align: 'center' });
  const safeName = attendeeName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'attendee';
  doc.save(`GiinMeet-Certificate-${safeName}.pdf`);
}

export const CertificatesPanel: React.FC<Props> = ({ meetingId, meetingTitle, meetingDate }) => {
  const [attendees, setAttendees] = useState<Attendee[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [when, setWhen] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    const result: any = await giinApi.getCertificateAttendees(meetingId);
    setLoading(false);
    if (result?.ok) {
      setAttendees(result.attendees || []);
      const raw = result.meeting?.time || meetingDate || '';
      const d = raw ? new Date(raw) : null;
      setWhen(d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) : '');
    } else if (result?.reason === 'NOT_CONFIGURED') {
      setError('Certificates need the Phase C1 and Phase C2a database setup. Run giinmeet_phaseC1.sql, then giinmeet_phaseC2a.sql, in the Supabase SQL Editor first.');
    } else {
      setError(result?.message || t('cert.unavailable'));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const handleDownload = async (a: Attendee) => {
    const dateText = when || new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    downloadCertificatePdf(a.name, meetingTitle, dateText);
    // Register in the library, best effort: the PDF is already in the
    // person's downloads even if the register call fails.
    const res: any = await giinApi.registerCertificateFile(meetingId, `Certificate, ${a.name}`);
    if (res?.ok) setSavedNote(t('cert.registered'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Award size={16} color="var(--color-accent)" />
        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>{t('cert.title')}</h4>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('cert.hint')}</p>
      {loading && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('cert.loading')}</p>}
      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{error}</p>
          <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => void load()}>
            <RotateCcw size={13} /> {t('common.retry')}
          </button>
        </div>
      )}
      {!loading && !error && attendees && attendees.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('cert.noAttendance')}</p>
      )}
      {!loading && !error && attendees && attendees.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {attendees.map((a) => (
            <div
              key={a.name}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.5rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}
            >
              <span style={{ flex: '1 1 140px', minWidth: 0, fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
              {when && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{when}</span>}
              <button
                type="button"
                className="premium-btn premium-btn-secondary"
                style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }}
                onClick={() => void handleDownload(a)}
              >
                <Download size={13} /> {t('cert.download')}
              </button>
            </div>
          ))}
          {savedNote && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{savedNote}</p>}
        </div>
      )}
    </div>
  );
};
