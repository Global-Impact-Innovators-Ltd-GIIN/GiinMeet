import React, { useEffect, useState } from 'react';
import { FileText, FileDown, RotateCcw } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

// Phase C2a (7), notes export.
//
// After a meeting, download the summary and notes as a PDF or a Word
// document, ready to share or file away. Built on the Phase B summary
// and the Phase C1 library notes. Both files are generated on this
// device, with jsPDF for the PDF and a Word-compatible document for
// Word, free and offline, no paid service and no key.
//
// States are all explicit: loading, empty when there is nothing to
// export yet, error with a retry, and the two download buttons when
// the record is ready.
interface Props {
  meetingId: string;
  meetingTitle: string;
  meetingDate?: string;
}

interface ExportData {
  summaryText: string;
  decisions: string[];
  actionItems: string[];
  notes: string[];
  transcriptLines: { name: string; text: string; time: string }[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildWordHtml(title: string, dateText: string, data: ExportData): string {
  const section = (heading: string, body: string) =>
    body ? t('export.h2_style_font_size', { v1: escapeHtml(heading), v2: body }) : '';
  const para = (text: string) => t('export.p_style_font_size', { v1: escapeHtml(text) });
  const list = (items: string[]) =>
    items.length > 0
      ? t('export.ul_style_font_size', { v1: items.map((i) => `<li>${escapeHtml(i)}</li>`).join('') })
      : '';
  return t('export.doctype_html_html_xmlns', { v1: escapeHtml(title), v2: escapeHtml(title), v3: escapeHtml(dateText), v4: section('Summary', para(data.summaryText || 'No summary was generated for this meeting.')), v5: section('Decisions', list(data.decisions)), v6: section('Action items', list(data.actionItems)), v7: section('Notes', data.notes.map(para).join('')), v8: section('Transcript', data.transcriptLines.length > 0 ? data.transcriptLines.map((l) => para(`${l.name} (${l.time}): ${l.text}`)).join('') : para('No transcript was saved for this meeting.')) });
}

function downloadPdf(title: string, dateText: string, data: ExportData): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 18;
  const maxW = pageW - margin * 2;
  let y = 20;
  const ensureSpace = (needed: number) => {
    if (y + needed > 277) {
      doc.addPage();
      y = 20;
    }
  };
  doc.setTextColor(0, 32, 91);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(doc.splitTextToSize(title.slice(0, 160), maxW), margin, y);
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(t('export.giinmeet_meeting_notes', { v1: dateText }), margin, y);
  y += 10;
  const heading = (text: string) => {
    ensureSpace(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0, 32, 91);
    doc.text(text, margin, y);
    y += 7;
  };
  const body = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(text, maxW);
    lines.forEach((line: string) => {
      ensureSpace(6);
      doc.text(line, margin, y);
      y += 6;
    });
    y += 3;
  };
  const bullets = (items: string[]) => {
    items.forEach((item) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(30, 30, 30);
      const lines = doc.splitTextToSize(item, maxW - 6);
      lines.forEach((line: string, i: number) => {
        ensureSpace(6);
        doc.text(i === 0 ? `•  ${line}` : `    ${line}`, margin, y);
        y += 6;
      });
      y += 1;
    });
    y += 3;
  };
  heading('Summary');
  body(data.summaryText || 'No summary was generated for this meeting.');
  if (data.decisions.length > 0) {
    heading('Decisions');
    bullets(data.decisions);
  }
  if (data.actionItems.length > 0) {
    heading('Action items');
    bullets(data.actionItems);
  }
  if (data.notes.length > 0) {
    heading('Notes');
    data.notes.forEach((n) => body(n));
  }
  heading('Transcript');
  if (data.transcriptLines.length === 0) {
    body('No transcript was saved for this meeting.');
  } else {
    data.transcriptLines.forEach((l) => body(`${l.name} (${l.time}): ${l.text}`));
  }
  const safeTitle = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'meeting';
  doc.save(t('export.giinmeet_notes_pdf', { v1: safeTitle }));
}

export const NotesExport: React.FC<Props> = ({ meetingId, meetingTitle, meetingDate }) => {
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [rec, notesRes] = await Promise.all([
        giinApi.getMeetingRecord(meetingId),
        giinApi.getMeetingNotes(meetingId),
      ]);
      const summary = (rec as any)?.summary || (rec as any)?.transcript?.summary || null;
      const notesRaw: any[] = (notesRes as any)?.notes || (notesRes as any)?.items || [];
      const items: any = await giinApi.getActionItems(meetingId);
      const actionItems: string[] = (items?.ok ? items.items || [] : summary?.actionItems || []).map(
        (it: any) => (typeof it === 'string' ? it : `${it.text || ''}${it.owner && it.owner !== 'Unassigned' ? ` (${it.owner})` : ''}`),
      );
      setData({
        summaryText: summary?.summary || '',
        decisions: summary?.decisions || [],
        actionItems,
        notes: notesRaw.map((n: any) => (typeof n === 'string' ? n : n.body || '')).filter(Boolean),
        transcriptLines: ((rec as any)?.transcript?.lines || []).map((l: any) => ({
          name: l.name || 'Speaker',
          text: l.text || '',
          time: l.time || '',
        })),
      });
    } catch (e) {
      setError(t('export.unavailable'));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const dateText = meetingDate
    ? new Date(meetingDate).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  const hasContent =
    !!data && (data.summaryText || data.decisions.length > 0 || data.actionItems.length > 0 || data.notes.length > 0 || data.transcriptLines.length > 0);

  const handleWord = () => {
    if (!data) return;
    const html = buildWordHtml(meetingTitle, dateText, data);
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = meetingTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'meeting';
    a.download = t('export.giinmeet_notes_doc', { v1: safeTitle });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <FileText size={16} color="var(--color-accent)" />
        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>{t('export.title')}</h4>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('export.hint')}</p>
      {loading && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('export.loading')}</p>}
      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{error}</p>
          <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => void load()}>
            <RotateCcw size={13} /> {t('common.retry')}
          </button>
        </div>
      )}
      {!loading && !error && data && !hasContent && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('export.empty')}</p>
      )}
      {!loading && !error && data && hasContent && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="premium-btn premium-btn-primary" style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }} onClick={() => downloadPdf(meetingTitle, dateText, data)}>
            <FileDown size={14} /> {t('export.pdf')}
          </button>
          <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }} onClick={handleWord}>
            <FileDown size={14} /> {t('export.word')}
          </button>
        </div>
      )}
    </div>
  );
};
