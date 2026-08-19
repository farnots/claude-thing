// L'interface en français.
//
// Same keys as en.js, checked by test/i18n.test.js. Two rules govern the
// wording, both of them about a 800×480 panel with fixed type sizes:
//
//   1. In a chip, a tile badge or a pill, the French stays inside the English
//      character budget — ALLOW → AUTORISER fits because the same chip already
//      draws PRESS AGAIN, but PRESS AGAIN → ENCORE rather than APPUYEZ ENCORE.
//   2. Capitals carry their accents (TERMINÉ, not TERMINE): the caps are in the
//      string, not in a CSS transform, so nothing upper-cases them later and
//      strips them.

export var fr = {
  // ---- partagé ----
  'common.turnDialForMore': ' · tournez pour voir plus',
  'common.session': 'session',
  'common.back': 'retour',
  'common.preset4': 'préréglage 4',
  'common.pressDial': 'appuyez',
  'common.hookTimedOut': 'HOOK EXPIRÉ — RÉPONDEZ DANS LE TERMINAL',

  // ---- barres de titre ----
  'bar.sessions': 'SESSIONS',
  'bar.session': 'SESSION',
  'bar.queue': 'FILE',
  'bar.usage': 'QUOTAS',
  'bar.bluetooth': 'BLUETOOTH',

  // ---- hors #app ----
  'chrome.daemonOffline': 'DAEMON HORS LIGNE — VÉRIFIEZ LE CONNECTEUR MAC',

  // ---- unités ----
  'unit.minutes': '{m} min',
  'unit.hoursMinutes': '{h} h {m}',
  'unit.seconds': '{s} s',

  // ---- état, mode, effort ----
  'state.IDLE': 'INACTIF',
  'state.ENDED': 'TERMINÉ',
  'state.WORKING': 'EN COURS',
  'state.ATTENTION': 'ATTENTION',
  'state.DONE': 'FINI',

  'mode.PLAN': 'PLAN',
  'mode.BYPASS': 'BYPASS',
  'mode.EDITS': 'ÉDITION',
  'mode.AUTO': 'AUTO',
  'mode.MANUAL': 'MANUEL',

  // Kept to the English width: these sit on the tile's 13px spec line, the one
  // that already forced ultrathink down to ULTRA.
  'effort.LOW': 'FAIBLE',
  'effort.MEDIUM': 'MOYEN',
  'effort.HIGH': 'HAUT',
  'effort.XHIGH': 'XHAUT',
  'effort.MAX': 'MAX',
  'effort.ULTRA': 'ULTRA',

  // ---- écran de repos ----
  'ambient.needsYou.one': '{n} SESSION ATTEND',
  'ambient.needsYou.other': '{n} SESSIONS ATTENDENT',
  'ambient.nothingBlocked': 'RIEN EN ATTENTE',
  'ambient.caption': '{working} EN COURS · {resting} AU REPOS',
  'ambient.tokensOut': '{tokens} tokens en sortie',
  'ambient.hintAnswer': 'appuyez sur la molette pour répondre',
  'ambient.hintSessions': 'appuyez sur la molette pour les sessions',
  'ambient.session': 'SESSION',
  'ambient.resetDue': 'RÉINIT. DUE',
  'ambient.noReading': 'PAS DE LECTURE',

  // ---- liste des sessions ----
  'list.empty': 'AUCUNE SESSION — LANCEZ CLAUDE SUR VOTRE MAC',
  'list.context': 'CONTEXTE',
  'list.needsAnswer': 'attend votre réponse',
  'list.finishedAgo': 'terminé il y a {d}',
  'list.working': 'en cours…',

  // ---- détail d'une session ----
  'detail.loading': 'CHARGEMENT…',
  'detail.contextUsed': 'contexte utilisé',
  'detail.toolWorking': '{tool} — en cours',
  'detail.noTool': 'aucun outil actif',
  'detail.tokensOut': 'tokens sortie',
  'detail.tokensIn': 'tokens entrée',
  'detail.cacheRead': 'cache lu',
  'detail.state': 'état',

  // ---- file d'attente ----
  'queue.empty.title': 'RIEN NE VOUS ATTEND',
  'queue.empty.sub': 'permissions et questions arrivent ici',
  'queue.moreWaiting': '{n} autres en attente',
  'queue.lastOne': 'la dernière',
  'queue.hint.review': 'molette déplace · appui modifie ou envoie · retour revient',
  'queue.hint.multi': 'appui coche · préréglage 4 pour finir',
  'queue.hint.single': 'molette déplace · appui répond · retour ferme',
  'queue.hint.next': 'tournez ou glissez pour la suivante',
  'queue.waitingOnYou': '{n} en attente',
  'queue.showing': ' · {n} affichés',
  'queue.permission': 'DEMANDE DE PERMISSION',
  'queue.permissionDestructive': 'DEMANDE DE PERMISSION · DESTRUCTIF',
  'queue.question': 'QUESTION',
  'queue.questionReview': 'QUESTION · RELECTURE',
  'queue.questionOf': 'QUESTION · {at} SUR {total}',
  'queue.questionParts': 'QUESTION · {total} PARTIES',
  'queue.rowPermission': 'PERMISSION',
  'queue.timedOutOpen': 'EXPIRÉ — TOUJOURS OUVERT DANS LE TERMINAL',
  'queue.questionsHint': '{n} questions · appuyez',
  'queue.optionsHint.one': '{n} option · appuyez',
  'queue.optionsHint.other': '{n} options · appuyez',
  'queue.answer': 'RÉPONDRE',
  'queue.allow': 'AUTORISER',
  'queue.deny': 'REFUSER',
  'queue.pressAgain': 'ENCORE',
  'queue.cannotUndo': 'irréversible',
  'queue.pressTwice': 'deux appuis · destructif',
  'queue.done': 'FINI',
  'queue.selected': '{n} cochés · préréglage 4',
  'queue.submit': 'ENVOYER',
  'queue.sendsAll': 'envoie les {n} réponses',
  'queue.none': 'aucune',
  'queue.checkAnswers': 'vérifiez vos réponses avant l’envoi',
  'queue.inTerminal': 'dans le terminal',
  'queue.waiting': 'depuis {d}',

  // ---- écran de permission ----
  'ask.dismiss': 'IGNORER',
  'ask.skip': 'PASSER',
  'ask.leftMinutes': 'reste {m} min',
  'ask.leftSeconds': 'reste {s} s',

  // ---- bluetooth ----
  'bt.DISCONNECT': 'DÉCONNECTER',
  'bt.CONNECT': 'CONNECTER',
  'bt.FORGET': 'OUBLIER',
  'bt.CANCEL': 'ANNULER',
  'bt.pairingMode': 'MODE APPAIRAGE',
  'bt.discoverable': 'VISIBLE',
  // The pill's other face. "MASQUÉ" rather than "INACTIF": it is the opposite of
  // VISIBLE, and it fits the pill at the same width.
  'bt.off': 'MASQUÉ',
  'bt.empty.title': 'AUCUN APPAREIL APPAIRÉ',
  'bt.empty.sub': 'activez le mode appairage pour ajouter votre téléphone',
  'bt.hint': 'molette déplace · appui pour les actions · retour quitte',
  'bt.working': 'EN COURS…',
  'bt.connected': 'CONNECTÉ',
  'bt.paired': 'APPAIRÉ',
  'bt.pairingRequest': 'DEMANDE D’APPAIRAGE',
  'bt.pairingNote': 'confirmez ce code sur votre téléphone — acceptation automatique',
  'bt.backDismisses': 'retour pour fermer',

  // ---- quotas ----
  'usage.reading': 'LECTURE EN COURS…',
  'usage.stale': 'PÉRIMÉ',
  'usage.staleSuffix': ' · périmé',
  'usage.fromClaude': 'via claude /usage',
  // Claude Code's own words for these two. "Skills" has no settled French name
  // in the product, so translating only one of the pair would read as a mistake.
  'usage.skills': 'SKILLS',
  'usage.subagents': 'SOUS-AGENTS',
  'usage.pctOfUsage': '% du total',
  'usage.moodOut': 'QUOTA ÉPUISÉ',
  'usage.moodLow': 'BIENTÔT ÉPUISÉ',
  'usage.moodClear': 'TOUT VA BIEN',

  // ---- réponse en cours d'envoi ----
  'inflight.typing': 'SAISIE SUR LE MAC',
  'inflight.sending': 'ENVOI AU MAC',
  'inflight.backToUndo': '{label} · RETOUR POUR ANNULER',
  'inflight.answered': 'RÉPONDU',
  'inflight.allow': 'AUTORISÉ',
  'inflight.deny': 'REFUSÉ',

  // ---- toasts ----
  'toast.spriteOn': 'MASCOTTE ON',
  'toast.spriteOff': 'MASCOTTE OFF',
  'toast.dismissed': 'IGNORÉ',
  'toast.pairingModeOn': 'MODE APPAIRAGE ON',
  'toast.pairingModeOff': 'MODE APPAIRAGE OFF',
  'toast.failed': 'ÉCHEC',
  'toast.connected': 'CONNECTÉ',
  'toast.waitingForPhone': 'ATTENTE DU TÉLÉPHONE',
  'toast.connectSent': 'CONNEXION ENVOYÉE',
  'toast.connectFailed': 'ÉCHEC DE CONNEXION',
  'toast.disconnected': 'DÉCONNECTÉ',
  'toast.forgotten': 'OUBLIÉ',
  'toast.sendFailed': 'ÉCHEC DE L’ENVOI',
  'toast.alreadyAnswered': 'DÉJÀ RÉPONDU',
  'toast.answerThisFirst': 'RÉPONDEZ D’ABORD À CELLE-CI',
  'toast.restored': 'RESTAURÉ',
  'toast.leftForTerminal': 'LAISSÉ AU TERMINAL',
  'toast.needsYou': 'ON VOUS ATTEND',
  'toast.paired': 'APPAIRÉ',
  'toast.pairingCancelled': 'APPAIRAGE ANNULÉ',

  'toast.answeredOnMac': 'RÉPONDU SUR LE MAC',
  'toast.focusedPress': 'FENÊTRE ACTIVE — TAPEZ {n} SUR LE MAC',
  'toast.focusedAnswer': 'FENÊTRE ACTIVE — RÉPONDEZ SUR LE MAC',
  'toast.gone': 'DISPARU — RÉPONDEZ DANS LE TERMINAL',
  'toast.dialogChanged': 'DIALOGUE MODIFIÉ — RÉPONDEZ SUR LE MAC',
  'toast.copyMode': 'PANNEAU TMUX EN MODE COPIE — TAPEZ q',
  'toast.automationDenied': 'AUTORISEZ L’AUTOMATISATION DANS LES RÉGLAGES MAC',
  'toast.backgroundAgent': 'AGENT EN ARRIÈRE-PLAN — AUCUNE FENÊTRE',
  'toast.noTerminalWindow': 'AUCUNE FENÊTRE DE TERMINAL TROUVÉE',
  'toast.couldNotAnswer': 'RÉPONSE IMPOSSIBLE',

  'resolution.allow': 'AUTORISÉ',
  'resolution.deny': 'REFUSÉ',
  'resolution.answered': 'RÉPONDU',
  'resolution.interrupted': 'INTERROMPU',
};
