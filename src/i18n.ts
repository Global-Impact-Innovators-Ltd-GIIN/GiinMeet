import { useSyncExternalStore } from 'react';

// Phase C2a (3), multi-language interface: English, French, Kinyarwanda.
//
// One dictionary per language, one lookup path: every screen calls t()
// with a key, and the whole interface follows the language the person
// picked. Adding a language later means adding one dictionary object
// and one entry in LANGUAGES, no screen has to change. No paid
// translation service is involved, the translations live here, written
// into the app. English is the fallback for any key a language does
// not have yet, so a missing translation never shows a blank label.
//
// The choice is stored in localStorage (giin_ui_language) so it follows
// the person on this device, including guests before sign-in. It is a
// display choice only, it never changes meeting data, and it never
// changes the caption language (feature 36), which is a separate
// per-user choice.

export type UiLanguage = 'en' | 'fr' | 'rw';

export const LANGUAGES: { code: UiLanguage; label: string; nativeLabel: string }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'fr', label: 'French', nativeLabel: 'Francais' },
  { code: 'rw', label: 'Kinyarwanda', nativeLabel: 'Ikinyarwanda' },
];

const STORAGE_KEY = 'giin_ui_language';

export function getUiLanguage(): UiLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'rw') return stored;
    return 'en';
  } catch (e) {
    return 'en';
  }
}

let currentLanguage: UiLanguage =
  typeof window !== 'undefined' ? getUiLanguage() : 'en';

const listeners = new Set<() => void>();

export function setUiLanguage(lang: UiLanguage): void {
  currentLanguage = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (e) {
    // Storage is best effort, the in-memory choice still applies.
  }
  try {
    document.documentElement.setAttribute('lang', lang);
  } catch (e) {
    // Not in a browser, ignore.
  }
  listeners.forEach((fn) => fn());
}

export function subscribeUiLanguage(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCurrentUiLanguage(): UiLanguage {
  return currentLanguage;
}

type Dict = Record<string, string>;

const en: Dict = {
  'nav.dashboard': 'Dashboard',
  'nav.teams': 'Teams',
  'nav.chats': 'Chat Center',
  'nav.contacts': 'Contacts',
  'nav.library': 'Library',
  'nav.schedule': 'Schedule',
  'nav.help': 'Help and Support',
  'nav.settings': 'Settings',
  'nav.billing': 'Billing',
  'common.search': 'Search',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.loading': 'Loading...',
  'common.retry': 'Try again',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.continue': 'Continue',
  'common.join': 'Join',
  'common.rejoin': 'Rejoin',
  'common.leave': 'Leave',
  'common.language': 'Language',
  'common.meetings': 'Meetings',
  'common.agenda': 'Agenda',
  'common.notes': 'Notes',
  'common.summary': 'Summary',
  'common.certificate': 'Certificate',
  'common.certificates': 'Certificates',
  'common.download': 'Download',
  'dash.welcome': 'Welcome back',
  'dash.personalRoom': 'Your personal room',
  'dash.personalRoomHint': 'One link, always the same. Share it once, anyone with it can join your room.',
  'dash.newMeeting': 'New Meeting',
  'dash.scheduleMeeting': 'Schedule Meeting',
  'dash.joinMeeting': 'Join Meeting',
  'dash.recentMeetings': 'Recent meetings',
  'dash.recentMeetingsHint': 'Jump back in with one tap. The usual join checks still apply.',
  'dash.library': 'Recordings and notes library',
  'dash.libraryHint': 'Transcripts, summaries, notes and files from your meetings, all searchable in one place.',
  'dash.upcoming': 'Up next',
  'dash.coming': 'Coming up',
  'dash.past': 'Past meetings',
  'dash.noMeetings': 'No meetings yet. Start or schedule your first meeting and it will show up here.',
  'dash.noUpcoming': 'Nothing scheduled. Your next meeting will show up here with its prep brief.',
  'dash.noPast': 'No past meetings yet.',
  'room.mute': 'Mute',
  'room.unmute': 'Unmute',
  'room.videoOn': 'Camera on',
  'room.videoOff': 'Camera off',
  'room.shareScreen': 'Share screen',
  'room.stopShare': 'Stop sharing',
  'room.chat': 'Chat',
  'room.participants': 'Participants',
  'room.leave': 'Leave',
  'room.layout': 'Layout',
  'room.layoutGrid': 'Grid',
  'room.layoutSpeaker': 'Speaker',
  'room.layoutSide': 'Side by side',
  'room.layoutFocus': 'Focus',
  'room.focusOn': 'Focus mode on, only the speaker is shown',
  'room.focusOff': 'Focus mode off',
  'room.agenda': 'Agenda',
  'room.invite': 'Invite and Info',
  'room.joinLink': 'Meeting join link',
  'room.shortLink': 'Short link',
  'room.shortLinkHint': 'A short link for this meeting. It opens the same join checks, passcode and waiting room still apply.',
  'room.scanToJoin': 'Scan to join',
  'room.scanHint': 'Point your phone camera at the code to join this meeting, no typing needed.',
  'room.qrUnavailable': 'The QR code could not be drawn on this device. Copy the link instead.',
  'room.shortLinkUnavailable': 'Short links need the Phase C2a database setup. Run giinmeet_phaseC2a.sql in the Supabase SQL Editor first.',
  'prejoin.title': 'Check your setup before you join',
  'prejoin.joinNow': 'Join now',
  'prejoin.joinWithoutDevices': 'Join without camera and microphone',
  'prejoin.displayName': 'Your name',
  'brief.title': 'Meeting prep brief',
  'brief.agenda': 'Agenda',
  'brief.coming': 'Who is coming',
  'brief.openItems': 'Open action items from the last meeting',
  'brief.noAgenda': 'No agenda saved for this meeting yet. The host can set one in the meeting room.',
  'brief.noAttendees': 'No attendee list yet. People who joined the last meeting will show up here.',
  'brief.noOpenItems': 'No open action items from the last meeting. Everything is done.',
  'brief.loading': 'Putting your brief together...',
  'brief.unavailable': 'The prep brief could not be loaded right now.',
  'cert.title': 'Attendance certificates',
  'cert.hint': 'Every attendee gets a certificate with their name, the topic and the date. Download one below.',
  'cert.noAttendance': 'No attendance was recorded for this meeting, so no certificates can be issued yet.',
  'cert.loading': 'Loading attendance...',
  'cert.unavailable': 'Certificates could not be loaded right now.',
  'cert.download': 'Download certificate',
  'cert.registered': 'Saved to your library.',
  'export.title': 'Download notes',
  'export.hint': 'Take the summary and notes with you as a PDF or a Word document, ready to share or file away.',
  'export.pdf': 'Download PDF',
  'export.word': 'Download Word',
  'export.loading': 'Loading the meeting record...',
  'export.empty': 'There is no summary or notes for this meeting yet, so there is nothing to download.',
  'export.unavailable': 'The notes could not be loaded right now.',
  'library.title': 'Library',
  'library.hint': 'Everything your meetings produce, in one home: recordings, notes, transcripts, shared files and attendance certificates.',
  'library.certificates': 'Attendance certificates',
  'library.noCertificates': 'No certificates yet. They appear here after a meeting with recorded attendance.',
  'library.recentFiles': 'Recent files',
  'library.noFiles': 'No files in your library yet.',
  'library.loading': 'Loading your library...',
  'library.unavailable': 'The library could not be loaded right now.',
  'schedule.title': 'Schedule',
  'schedule.hint': 'All your meetings, past and coming, in one clear view. One tap to join or rejoin.',
  'agenda.timerStartsIn': 'starts in',
  'agenda.timerLeft': 'left',
  'agenda.timerDone': 'Done',
  'agenda.timerLive': 'Now',
  'agenda.duration': 'Minutes',
  'agenda.addItem': 'Add item',
  'agenda.empty': 'No agenda items yet.',
};

const fr: Dict = {
  'nav.dashboard': 'Tableau de bord',
  'nav.teams': 'Equipes',
  'nav.chats': 'Messages',
  'nav.contacts': 'Contacts',
  'nav.library': 'Bibliotheque',
  'nav.schedule': 'Agenda',
  'nav.help': 'Aide et support',
  'nav.settings': 'Parametres',
  'nav.billing': 'Facturation',
  'common.search': 'Rechercher',
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.copy': 'Copier',
  'common.copied': 'Copie',
  'common.loading': 'Chargement...',
  'common.retry': 'Reessayer',
  'common.close': 'Fermer',
  'common.back': 'Retour',
  'common.continue': 'Continuer',
  'common.join': 'Rejoindre',
  'common.rejoin': 'Rejoindre',
  'common.leave': 'Quitter',
  'common.language': 'Langue',
  'common.meetings': 'Reunions',
  'common.agenda': 'Ordre du jour',
  'common.notes': 'Notes',
  'common.summary': 'Resume',
  'common.certificate': 'Certificat',
  'common.certificates': 'Certificats',
  'common.download': 'Telecharger',
  'dash.welcome': 'Bon retour',
  'dash.personalRoom': 'Votre salle personnelle',
  'dash.personalRoomHint': 'Un seul lien, toujours le meme. Partagez-le une fois, toute personne qui l’a peut rejoindre votre salle.',
  'dash.newMeeting': 'Nouvelle reunion',
  'dash.scheduleMeeting': 'Planifier une reunion',
  'dash.joinMeeting': 'Rejoindre une reunion',
  'dash.recentMeetings': 'Reunions recentes',
  'dash.recentMeetingsHint': 'Reprenez en un geste. Les controles habituels s’appliquent toujours.',
  'dash.library': 'Bibliotheque des enregistrements et notes',
  'dash.libraryHint': 'Transcriptions, resumes, notes et fichiers de vos reunions, tous consultables au meme endroit.',
  'dash.upcoming': 'Prochaine reunion',
  'dash.coming': 'A venir',
  'dash.past': 'Reunions passees',
  'dash.noMeetings': 'Aucune reunion pour le moment. Lancez ou planifiez votre premiere reunion, elle apparaitra ici.',
  'dash.noUpcoming': 'Rien de prevu. Votre prochaine reunion apparaitra ici avec sa fiche de preparation.',
  'dash.noPast': 'Aucune reunion passee pour le moment.',
  'room.mute': 'Couper le micro',
  'room.unmute': 'Activer le micro',
  'room.videoOn': 'Camera activee',
  'room.videoOff': 'Camera coupee',
  'room.shareScreen': 'Partager l’ecran',
  'room.stopShare': 'Arreter le partage',
  'room.chat': 'Discussion',
  'room.participants': 'Participants',
  'room.leave': 'Quitter',
  'room.layout': 'Affichage',
  'room.layoutGrid': 'Grille',
  'room.layoutSpeaker': 'Orateur',
  'room.layoutSide': 'Cote a cote',
  'room.layoutFocus': 'Concentration',
  'room.focusOn': 'Mode concentration active, seul l’orateur est affiche',
  'room.focusOff': 'Mode concentration desactive',
  'room.agenda': 'Ordre du jour',
  'room.invite': 'Invitation et infos',
  'room.joinLink': 'Lien pour rejoindre la reunion',
  'room.shortLink': 'Lien court',
  'room.shortLinkHint': 'Un lien court pour cette reunion. Il ouvre les memes controles, le code et la salle d’attente s’appliquent toujours.',
  'room.scanToJoin': 'Scannez pour rejoindre',
  'room.scanHint': 'Pointez l’appareil photo de votre telephone vers le code pour rejoindre cette reunion, sans rien taper.',
  'room.qrUnavailable': 'Le code QR n’a pas pu etre dessine sur cet appareil. Copiez le lien a la place.',
  'room.shortLinkUnavailable': 'Les liens courts necessitent la configuration de la base de donnees Phase C2a. Executez giinmeet_phaseC2a.sql dans l’editeur SQL de Supabase.',
  'prejoin.title': 'Verifiez votre materiel avant de rejoindre',
  'prejoin.joinNow': 'Rejoindre maintenant',
  'prejoin.joinWithoutDevices': 'Rejoindre sans camera ni microphone',
  'prejoin.displayName': 'Votre nom',
  'brief.title': 'Fiche de preparation de la reunion',
  'brief.agenda': 'Ordre du jour',
  'brief.coming': 'Qui vient',
  'brief.openItems': 'Actions ouvertes de la derniere reunion',
  'brief.noAgenda': 'Aucun ordre du jour enregistre pour cette reunion. L’hote peut en definir un dans la salle de reunion.',
  'brief.noAttendees': 'Pas encore de liste de participants. Les personnes qui ont rejoint la derniere reunion apparaitront ici.',
  'brief.noOpenItems': 'Aucune action ouverte de la derniere reunion. Tout est termine.',
  'brief.loading': 'Preparation de votre fiche...',
  'brief.unavailable': 'La fiche de preparation n’a pas pu etre chargee pour le moment.',
  'cert.title': 'Certificats de presence',
  'cert.hint': 'Chaque participant recoit un certificat avec son nom, le sujet et la date. Telechargez-en un ci-dessous.',
  'cert.noAttendance': 'Aucune presence n’a ete enregistree pour cette reunion, aucun certificat ne peut etre delivre pour le moment.',
  'cert.loading': 'Chargement des presences...',
  'cert.unavailable': 'Les certificats n’ont pas pu etre charges pour le moment.',
  'cert.download': 'Telecharger le certificat',
  'cert.registered': 'Enregistre dans votre bibliotheque.',
  'export.title': 'Telecharger les notes',
  'export.hint': 'Emportez le resume et les notes en PDF ou en document Word, prets a partager ou a classer.',
  'export.pdf': 'Telecharger le PDF',
  'export.word': 'Telecharger le Word',
  'export.loading': 'Chargement du compte rendu...',
  'export.empty': 'Il n’y a pas encore de resume ni de notes pour cette reunion, donc rien a telecharger.',
  'export.unavailable': 'Les notes n’ont pas pu etre chargees pour le moment.',
  'library.title': 'Bibliotheque',
  'library.hint': 'Tout ce que vos reunions produisent, au meme endroit : enregistrements, notes, transcriptions, fichiers partages et certificats de presence.',
  'library.certificates': 'Certificats de presence',
  'library.noCertificates': 'Aucun certificat pour le moment. Ils apparaissent ici apres une reunion avec des presences enregistrees.',
  'library.recentFiles': 'Fichiers recents',
  'library.noFiles': 'Aucun fichier dans votre bibliotheque pour le moment.',
  'library.loading': 'Chargement de votre bibliotheque...',
  'library.unavailable': 'La bibliotheque n’a pas pu etre chargee pour le moment.',
  'schedule.title': 'Agenda',
  'schedule.hint': 'Toutes vos reunions, passees et a venir, dans une seule vue claire. Un geste pour rejoindre ou revenir.',
  'agenda.timerStartsIn': 'commence dans',
  'agenda.timerLeft': 'restantes',
  'agenda.timerDone': 'Termine',
  'agenda.timerLive': 'En cours',
  'agenda.duration': 'Minutes',
  'agenda.addItem': 'Ajouter un point',
  'agenda.empty': 'Aucun point a l’ordre du jour pour le moment.',
};

const rw: Dict = {
  'nav.dashboard': 'Ahabanza',
  'nav.teams': 'Amakipe',
  'nav.chats': 'Ibiganiro',
  'nav.contacts': 'Abo muhurira',
  'nav.library': 'Isomero',
  'nav.schedule': 'Gahunda',
  'nav.help': 'Ubufasha',
  'nav.settings': 'Igenamiterere',
  'nav.billing': 'Kwishyura',
  'common.search': 'Shakisha',
  'common.cancel': 'Hagarika',
  'common.save': 'Bika',
  'common.copy': 'Koporora',
  'common.copied': 'Byakopowe',
  'common.loading': 'Bitegereje...',
  'common.retry': 'Gerageza nanone',
  'common.close': 'Funga',
  'common.back': 'Subira inyuma',
  'common.continue': 'Komeza',
  'common.join': 'Injira',
  'common.rejoin': 'Injira nanone',
  'common.leave': 'Sohoka',
  'common.language': 'Ururimi',
  'common.meetings': 'Inama',
  'common.agenda': 'Ingingo',
  'common.notes': 'Amanota',
  'common.summary': 'Incamake',
  'common.certificate': 'Impamyabumenyi',
  'common.certificates': 'Impamyabumenyi',
  'common.download': 'Manura',
  'dash.welcome': 'Murakaza neza',
  'dash.personalRoom': 'Icyumba cyawe',
  'dash.personalRoomHint': 'Link imwe, ihora ari imwe. Uyisangize rimwe, uwo ari we wese uyifite yinjira mu cyumba cyawe.',
  'dash.newMeeting': 'Inama nshya',
  'dash.scheduleMeeting': 'Teganya inama',
  'dash.joinMeeting': 'Injira mu nama',
  'dash.recentMeetings': 'Inama ziheruka',
  'dash.recentMeetingsHint': 'Subira mu nama ukanda rimwe. Igenzura risanzwe riracyakora.',
  'dash.library': 'Isomero ry’ibyafashwe n’amanota',
  'dash.libraryHint': 'Inyandiko, incamake, amanota n’amadosiye y’inama zawe, byose ahantu hamwe.',
  'dash.upcoming': 'Ikurikira',
  'dash.coming': 'Ziteganyijwe',
  'dash.past': 'Inama zarangiye',
  'dash.noMeetings': 'Nta nama irashyirwaho. Tangira cyangwa uteganye inama yawe ya mbere, izagaragara hano.',
  'dash.noUpcoming': 'Nta nama iteganyijwe. Inama yawe ikurikira izagaragara hano hamwe n’inyandiko yayo yo kwitegura.',
  'dash.noPast': 'Nta nama irarangira.',
  'room.mute': 'Ceceka',
  'room.unmute': 'Vuga',
  'room.videoOn': 'Kamera iri gukora',
  'room.videoOff': 'Kamera yazimye',
  'room.shareScreen': 'Sangiza ecran',
  'room.stopShare': 'Hagarika gusangiza',
  'room.chat': 'Ubutumwa',
  'room.participants': 'Abitabiriye',
  'room.leave': 'Sohoka',
  'room.layout': 'Imiterere',
  'room.layoutGrid': 'Urutonde',
  'room.layoutSpeaker': 'Uvuga',
  'room.layoutSide': 'Obokoresha',
  'room.layoutFocus': 'Kwibanda',
  'room.focusOn': 'Uburyo bwo kwibanda burakora, uvuga wenyine ni we ugaragara',
  'room.focusOff': 'Uburyo bwo kwibanda bwazimye',
  'room.agenda': 'Ingingo',
  'room.invite': 'Ubutumire n’amakuru',
  'room.joinLink': 'Link yo kwinjira mu nama',
  'room.shortLink': 'Link ngufi',
  'room.shortLinkHint': 'Link ngufi y’iyi nama. Ifungura igenzura rimwe, code n’icyumba cyo gutegereza biracyakora.',
  'room.scanToJoin': 'Sikana winjire',
  'room.scanHint': 'Erekana kamera ya telefone yawe kuri iyi code winjire mu nama, nta kwandika.',
  'room.qrUnavailable': 'Code QR ntiyabashije gukorwa kuri iki gikoresho. Koporora link aho.',
  'room.shortLinkUnavailable': 'Link ngufi zikeneye igenamiterere rya Phase C2a. Koresha giinmeet_phaseC2a.sql muri Supabase SQL Editor.',
  'prejoin.title': 'Genuzura ibikoresho byawe mbere yo kwinjira',
  'prejoin.joinNow': 'Injira nonaha',
  'prejoin.joinWithoutDevices': 'Injira nta kamera na mikoro',
  'prejoin.displayName': 'Izina ryawe',
  'brief.title': 'Inyandiko yo kwitegura inama',
  'brief.agenda': 'Ingingo',
  'brief.coming': 'Abazaza',
  'brief.openItems': 'Ibikenewe gukorwa byasigaye mu nama iheruka',
  'brief.noAgenda': 'Nta ngingo zateganyijwe kuri iyi nama. Nyir’inama ashobora kuzishyiraho mu cyumba cy’inama.',
  'brief.noAttendees': 'Nta rutonde rw’abazaza. Abinjiye mu nama iheruka bazagaragara hano.',
  'brief.noOpenItems': 'Nta bikeneye gukorwa byasigaye mu nama iheruka. Byose byarangiye.',
  'brief.loading': 'Tegura inyandiko yawe...',
  'brief.unavailable': 'Inyandiko yo kwitegura ntiyabashije kuboneka ubu.',
  'cert.title': 'Impamyabumenyi zo kwitabira',
  'cert.hint': 'Buri witabiriye ahabwa impamyabumenyi ifite izina rye, ingingo n’itariki. Manura imwe hano hepfo.',
  'cert.noAttendance': 'Nta witabiriye wanditswe muri iyi nama, nta mpamyabumenyi ishobora gutangwa ubu.',
  'cert.loading': 'Bireba abitabiriye...',
  'cert.unavailable': 'Impamyabumenyi ntizabashije kuboneka ubu.',
  'cert.download': 'Manura impamyabumenyi',
  'cert.registered': 'Byabitswe mu isomero ryawe.',
  'export.title': 'Manura amanota',
  'export.hint': 'Fata incamake n’amanota nk’inyandiko ya PDF cyangwa Word, witeguye gusangiza cyangwa kubika.',
  'export.pdf': 'Manura PDF',
  'export.word': 'Manura Word',
  'export.loading': 'Bireba inyandiko y’inama...',
  'export.empty': 'Nta ncamake cyangwa amanota kuri iyi nama, nta cyo kumanura.',
  'export.unavailable': 'Amanota ntiyabashije kuboneka ubu.',
  'library.title': 'Isomero',
  'library.hint': 'Ibyo inama zawe zose zitanga, ahantu hamwe: ibyafashwe, amanota, inyandiko, amadosiye yasangiwe n’impamyabumenyi zo kwitabira.',
  'library.certificates': 'Impamyabumenyi zo kwitabira',
  'library.noCertificates': 'Nta mpamyabumenyi. Zizagaragara hano nyuma y’inama ifite abitabiriye banditswe.',
  'library.recentFiles': 'Amadosiye aheruka',
  'library.noFiles': 'Nta dosiye mu isomero ryawe.',
  'library.loading': 'Bireba isomero ryawe...',
  'library.unavailable': 'Isomero ntiryabashije kuboneka ubu.',
  'schedule.title': 'Gahunda',
  'schedule.hint': 'Inama zawe zose, zarangiye n’ziteganyijwe, ahantu hamwe. Kanda rimwe winjire cyangwa usubiremo.',
  'agenda.timerStartsIn': 'itangira mu',
  'agenda.timerLeft': 'bisigaye',
  'agenda.timerDone': 'Byarangiye',
  'agenda.timerLive': 'Ubu',
  'agenda.duration': 'Iminota',
  'agenda.addItem': 'Ongeraho ingingo',
  'agenda.empty': 'Nta ngingo zateganyijwe.',
};

const DICTS: Record<UiLanguage, Dict> = { en, fr, rw };

/** Translate one key. Falls back to English, then to the key itself. */
export function t(key: string): string {
  const dict = DICTS[currentLanguage] || en;
  if (dict[key]) return dict[key];
  if (en[key]) return en[key];
  return key;
}

/** React hook: the current UI language, re-rendering the caller when
 *  the person picks another language, so the entire interface changes
 *  at once. */
export function useUiLanguage(): { lang: UiLanguage; setLang: (lang: UiLanguage) => void } {
  const lang = useSyncExternalStore(subscribeUiLanguage, getCurrentUiLanguage, () => 'en' as UiLanguage);
  return { lang, setLang: setUiLanguage };
}
