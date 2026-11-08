// One shared rule for participant avatar initials across GiinMeet.
//
// The old inline pattern `name.split(' ').map(n => n[0]).join('')` treated
// every space-separated word as a name word, so "Rocky (test guest)"
// rendered as "R(G" — the "(" from "(test" became an initial. It also
// returned a different wrong answer per call site (some capped at 2 chars,
// some not) and used a different fallback letter each time.
//
// Rules:
// - Parenthetical parts ("(test guest)", "(Host)") are notes, not a name:
//   they are stripped before parsing. An unclosed "(" cuts the rest.
// - Split on whitespace and hyphens; a single name ("Mensah") shows its
//   first letter only ("M"); first + surname shows first + last ("MS").
// - Bare middle initials ("Q.") and name suffixes ("Jr", "Sr", "II", "III")
//   are skipped when picking the surname token.
// - Never emits punctuation as an initial; always uppercase.
// - Empty, missing or unparseable names fall back to "?" — never a broken string.

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function getParticipantInitials(name?: string | null): string {
  if (!name) return '?';

  // Drop parenthetical notes entirely; an unclosed "(" cuts the rest.
  let cleaned = name.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const openParen = cleaned.indexOf('(');
  if (openParen !== -1) cleaned = cleaned.slice(0, openParen);

  const tokens = cleaned
    .split(/[\s\-–—]+/)
    .map((token) => token.replace(/[^A-Za-zÀ-ÿ']/g, '').replace(/'+$/, ''))
    .filter((token, index) => {
      if (token.length === 0) return false;
      const lower = token.toLowerCase();
      if (NAME_SUFFIXES.has(lower)) return false;
      // Bare middle initial ("Q.") — but keep it when it is the only token
      // (a first name given as a single letter is still a name).
      if (token.length === 1 && index !== 0) return false;
      return true;
    });

  if (tokens.length === 0) return '?';
  const first = tokens[0][0].toUpperCase();
  if (tokens.length === 1) return first;
  const last = tokens[tokens.length - 1][0].toUpperCase();
  return first + last;
}
