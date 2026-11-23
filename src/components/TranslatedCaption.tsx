// Phase C1 (36), one translated caption line.
//
// A final caption line, shown in the viewer's ONE chosen language.
// When the line is already in that language (or the viewer chose no
// captions), it renders as-is and no provider call is made. Otherwise
// it asks /api/translate once and shows the original text while the
// translation loads, so a slow provider never leaves a blank line.
// Results are cached in this tab (same text, same language pair), so
// re-renders and scrolls never re-translate. Interim lines are never
// sent here: they show untranslated in the live caption bar.
// When translation is not set up, the line stays in the spoken
// language and reports once through onNoKey, so the panel can say so.
import React, { useEffect, useRef, useState } from 'react';
import { giinApi } from '../supabaseClient';

const cache = new Map<string, string>();

export default function TranslatedCaption({
  text,
  sourceLang,
  targetLang,
  meetingId,
  onNoKey,
}: {
  text: string;
  sourceLang: 'en' | 'fr';
  targetLang: 'none' | 'en' | 'fr' | 'rw';
  meetingId: string;
  onNoKey?: () => void;
}) {
  const [shown, setShown] = useState(text);
  const noKeyReported = useRef(false);
  useEffect(() => {
    if (targetLang === 'none' || sourceLang === targetLang) {
      setShown(text);
      return;
    }
    const key = `${sourceLang}|${targetLang}|${text}`;
    const cached = cache.get(key);
    if (cached) {
      setShown(cached);
      return;
    }
    let cancelled = false;
    setShown(text);
    (async () => {
      const res: any = await giinApi.translateCaption(text, sourceLang, targetLang, meetingId);
      if (cancelled) return;
      if (res?.ok && typeof res.translatedText === 'string' && res.translatedText) {
        cache.set(key, res.translatedText);
        setShown(res.translatedText);
      } else if (res?.reason === 'NO_TRANSLATE_KEY') {
        if (!noKeyReported.current) {
          noKeyReported.current = true;
          onNoKey?.();
        }
        setShown(text);
      } else {
        setShown(text);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, sourceLang, targetLang, meetingId]);
  return <>{shown}</>;
}
