# Polititia — Feuille de route

> Document de référence des évolutions de la plateforme, établi le 17 novembre 2026, jour du lancement public.
> Il a été construit selon un double diamant : explorer les besoins, définir les problèmes, imaginer un maximum
> de cas d'usage, puis ne garder que ceux qui servent la **compréhension des enjeux** et le **contrôle citoyen**
> sans trahir la méthode du site.
>
> Verdicts : ✅ retenu · 🔁 retenu sous une autre forme · ⏸ plus tard · ❌ écarté.
> Risque : 🟢 sûr · 🟡 sûr avec garde-fous · 🟠 exposé · 🔴 écarté.

## Sommaire

1. [En bref](#1-en-bref)
2. [Ce qui guide les choix](#2-ce-qui-guide-les-choix)
3. [Diamant 1 : le problème](#3-diamant-1--le-problème)
4. [Diamant 2 : les solutions](#4-diamant-2--les-solutions)
5. [Évaluation des cas retenus](#5-évaluation-des-cas-retenus)
6. [Feuille de route](#6-feuille-de-route)
7. [Charte des fonctions rédigées par IA](#7-charte-des-fonctions-rédigées-par-ia)
8. [Sources de données](#8-sources-de-données)
9. [Mesurer le succès](#9-mesurer-le-succès)
10. [Décisions à prendre](#10-décisions-à-prendre)
11. [Historique](#11-historique)

---

## 1. En bref

Polititia montre aujourd'hui ce que les députés **disent** en séance et le confronte à ce qu'ils **votent**.
L'étape suivante consiste à mettre **le texte de loi au centre** : savoir ce qui va être débattu, ce qui est en jeu,
qui a dit et voté quoi, et ce que devient la loi après le vote. Le travail du député (initiatives, amendements,
questions, participation) et le rapport de force parlementaire viennent ensuite. Les synthèses rédigées par IA
arrivent en dernier, une fois le socle factuel en place, et sous des règles strictes.

| Phase | Contenu | Risque |
| --- | --- | --- |
| 0. Socle de données | Amendements, agenda, questions, le dossier législatif comme pivot | — |
| 1. Le texte au centre | Fiche texte, agenda et mémoire du sujet, suivre un texte, pédagogie, journal des corrections | 🟢 |
| 2. Qui fait quoi | Activité du député, contrôle du gouvernement, sujets et attention par période, application des lois, indicateurs de procédure, scrutins en clair, circonscription, participation, déontologie | 🟢 🟡 |
| 3. Synthèses et mise en regard | Parole face aux votes (étendue), éclairages sourcés, contexte d'un texte, synthèse de l'activité d'un député | 🟡 🟠 |

Ce qui est écarté, et pourquoi (détail au § 5.5) : le fact-checking « vrai / faux » (remplacé par des éclairages
sourcés, sans verdict), toute note ou tout classement de députés, l'activité des collaborateurs, la recherche web
ouverte pour contextualiser un texte.

---

## 2. Ce qui guide les choix

### 2.1 La charte existante

Ces règles sont déjà publiques (pages Méthode et Qui sommes-nous). Toute évolution doit les respecter.

1. Uniquement des sources officielles ; chaque chiffre renvoie à sa source.
2. Les mêmes règles pour tous les députés et tous les groupes.
3. Une méthode automatique n'est publiée que si sa précision, mesurée à la main, atteint au moins 85 %.
4. Pas de classement « meilleurs » ou « pires » députés : on montre ce qui est dit et voté, pas un jugement.
5. Pas de score de sentiment ni d'étiquette psychologique.
6. Les limites de chaque mesure sont écrites sur la page Méthode.
7. Le compte rendu officiel fait foi ; les erreurs signalées sont corrigées sous 48 heures.

### 2.2 Critères d'évaluation

Chaque cas d'usage est noté de 1 à 5 sur six critères.

| Critère | Question posée |
| --- | --- |
| **C** Compréhension | Un citoyen non initié comprend-il mieux un enjeu après l'avoir vu ? |
| **K** Contrôle | Peut-on demander des comptes grâce à lui (à un député, un groupe, le gouvernement) ? |
| **F** Fiabilité | Repose-t-il sur des données officielles, mesurables, vérifiables par n'importe qui ? |
| **N** Neutralité | Résiste-t-il aux accusations de parti pris, de diffamation ou d'antiparlementarisme ? |
| **R** Réalisabilité | Les données existent-elles, et l'effort est-il raisonnable pour une petite équipe ? |
| **D** Différenciation | Apporte-t-il plus que NosDéputés, Datan, La Fabrique de la loi, Légifrance ou le site de l'Assemblée ? |

Classes de risque :

- 🟢 **Sûr** : F et N valent au moins 4. Données officielles, aucun jugement.
- 🟡 **Sûr avec garde-fous** : F ou N vaut 3 ; une règle explicite, écrite sur la page Méthode, ramène le risque à un niveau acceptable.
- 🟠 **Exposé** : le cas dépend d'une génération de texte ou d'un cadrage éditorial. Il n'est lancé qu'avec les conditions du § 7.
- 🔴 **Écarté** : le risque ou le coût l'emporte sur la valeur, ou le cas contredit la charte.

---

## 3. Diamant 1 : le problème

### 3.1 Découvrir : qui, et à quel moment

| Public | Ce qu'il cherche | Ce qui le bloque aujourd'hui |
| --- | --- | --- |
| Électeur occasionnel | Comprendre un texte dont parle l'actualité ; savoir ce que fait son député | Intitulés illisibles, aucune vue d'ensemble d'un texte |
| Journaliste (PQR, national) | Angles locaux, chiffres sourcés, rapidement | Données éparpillées entre Assemblée, Sénat et Légifrance |
| Association, ONG, syndicat, fédération professionnelle | Savoir quand un texte passe, qui le soutient, ce qui a été modifié | L'agenda est découvert trop tard pour agir |
| Enseignant, étudiant | Comprendre la fabrique de la loi sur un cas réel | Le parcours d'un texte reste abstrait |
| Élu, collaborateur | Vérifier comment il est présenté, corriger une erreur | Pas de canal de réponse visible |
| Chercheur, data-journaliste | Réutiliser des données propres et documentées | Les données dérivées ne sont pas publiées |

Les moments qui comptent : **avant** un débat (le texte est inscrit à l'ordre du jour), **pendant** (polémique,
49.3, nuit d'amendements), **juste après** le vote, **des mois après** (la loi s'applique-t-elle ?), et **avant
une élection** (le bilan).

### 3.2 Découvrir : les frictions

| # | Friction |
| --- | --- |
| F1 | On découvre un texte quand il est déjà voté : l'agenda n'est pas visible du grand public. |
| F2 | Les intitulés des scrutins sont illisibles (« l'amendement n° 39 de M. X à l'article 2 »). |
| F3 | On ne sait pas ce qu'un texte change concrètement par rapport au droit existant. |
| F4 | On ne sait pas où en est un texte : navette, CMP, Conseil constitutionnel, décrets. |
| F5 | Les médias retiennent les clashs, pas les arguments de chaque camp. |
| F6 | Difficile de distinguer le travail parlementaire réel de la communication. |
| F7 | Les chiffres de présence circulent sans contexte et nourrissent l'antiparlementarisme. |
| F8 | On ne sait pas qui ralentit un débat, ni comment : obstruction ou droit d'amendement ? |
| F9 | Les affirmations faites en séance ne sont jamais confrontées aux faits. |
| F10 | Après le vote, personne ne vérifie que la loi est appliquée (décrets). |
| F11 | Aucune mémoire : le même sujet a été débattu deux ans plus tôt, et personne ne s'en souvient. |
| F12 | Méfiance envers les outils qui se disent neutres : qui est derrière, avec quelle méthode ? |
| F13 | Le gouvernement aussi doit rendre des comptes (questions restées sans réponse, 49.3). |
| F14 | Mon député parle-t-il de ma circonscription ? |

### 3.3 Définir : six questions

| # | Comment pourrions-nous… | Frictions |
| --- | --- | --- |
| Q1 | …permettre à chacun de savoir ce qui va être décidé, assez tôt pour s'en saisir ? | F1, F11 |
| Q2 | …rendre un texte compréhensible (enjeux, arguments, issue, suites) sans prendre parti ? | F2, F3, F4, F5, F10 |
| Q3 | …donner une image fidèle et complète du travail d'un député, sans le noter ? | F6, F7, F14 |
| Q4 | …rendre visibles les rapports de force et les procédures, sans juger leur légitimité ? | F8, F13 |
| Q5 | …confronter la parole aux faits de façon vérifiable et difficilement contestable ? | F9 |
| Q6 | …rendre l'outil lui-même contrôlable ? | F12 |

---

## 4. Diamant 2 : les solutions

### 4.1 Développer : 63 cas d'usage, critiqués un par un

Les cas 62 et 63 ont été ajoutés après la première version (§ 4.2.1).

#### Q1. Anticiper ce qui va être décidé

| # | Cas d'usage | Critique | Verdict |
| --- | --- | --- | --- |
| 1 | Agenda de la séance publique des semaines à venir (ordre du jour fixé par la Conférence des présidents) | Donnée officielle et simple. Condition de tout le reste : on ne contrôle pas ce qu'on découvre après coup. | ✅ R3 |
| 2 | Agenda des commissions (auditions, examen des textes, rapporteurs nommés) | Utile aux associations et aux journalistes ; moins lisible pour le grand public. | ✅ R3, second niveau |
| 3 | Pour chaque texte inscrit, la mémoire du sujet : débats, scrutins et textes antérieurs sur le même thème, XVIe législature comprise | Exploite ce que Polititia sait déjà faire (thèmes, extraits). Sources internes et officielles. | ✅ R3 |
| 4 | Recherche web approfondie automatique (« deep search ») sur chaque texte | Choisir les sources est un choix éditorial ; hallucinations ; résultat non reproductible ; coûteux. | ❌ remplacé par 5 |
| 5 | Synthèse de contexte à partir d'un corpus fermé de sources institutionnelles (exposé des motifs, étude d'impact, avis du Conseil d'État, rapport de commission) | Très forte valeur de compréhension. La génération de texte doit être encadrée. | 🔁 R5 |
| 6 | Alerte « un texte qui vous intéresse arrive en séance » (par texte ou par thème) | Prolonge « Suivre mon député ». Aucun risque éditorial. | ✅ R4 |
| 7 | Export calendrier (ICS) | Confort pour les journalistes ; faible coût, faible impact. | ⏸ |
| 8 | Prédire l'issue d'un vote | Spéculatif ; peut influencer ; les erreurs seraient très visibles. | ❌ |
| 9 | « Ce que ce texte change pour vous » (simulateur individuel) | Impossible à faire juste sans expertise texte par texte. Une erreur devient de la désinformation. | ❌ |
| 10 | Pétitions de l'Assemblée et consultations ouvertes sur le même sujet | Donne un levier d'action ; secondaire. | ⏸ |

#### Q2. Comprendre un texte

| # | Cas d'usage | Critique | Verdict |
| --- | --- | --- | --- |
| 11 | Fiche texte unique : parcours (dépôt, commission, séance, Sénat, CMP, Conseil constitutionnel, promulgation), procédure, issue | Pivot de tout le reste. Données 100 % officielles, déjà téléchargées. | ✅ R1 |
| 12 | Qui a voté quoi : vote sur l'ensemble et scrutins clés du texte, par groupe et par député | Déjà calculé par scrutin ; il manque la vue par texte. | ✅ R1 |
| 13 | Ce que chaque groupe en a dit : explication de vote de chaque groupe, extraits sourcés | L'atout propre de Polititia. Exige une règle de sélection identique pour tous les groupes. | ✅ R1 |
| 14 | Scrutins en clair : l'objet de l'amendement (exposé sommaire de son auteur) et l'article visé à la place de « amendement n° 39 » | Lève un obstacle majeur (F2). L'exposé sommaire est l'argument de l'auteur : il doit lui être attribué. | 🔁 R16 |
| 15 | Avant / après : les articles de code modifiés par la loi (Légifrance) | Forte valeur, mais versions consolidées difficiles à aligner. | ⏸ |
| 16 | Résumé IA du texte | Même risque et même corpus que le cas 5 : fusionné. | 🔁 R5 |
| 17 | Glossaire contextuel (49.3, CMP, navette, niche, temps législatif programmé, irrecevabilité…) | Faible coût, forte compréhension, aucun risque. | ✅ R14 |
| 18 | « Comment se fait une loi », illustré par le parcours réel du texte consulté | Pédagogie concrète, utile aux enseignants. | ✅ R14 |
| 19 | Après le vote : décision du Conseil constitutionnel (censures), promulgation au Journal officiel, décrets d'application attendus et publiés | Contrôle de l'exécutif, données officielles (Légifrance). | ✅ R2 |
| 20 | La position du Sénat sur le même texte (data.senat.fr) | Complète la navette ; seconde source, autre format. | ⏸ |
| 21 | Arguments pour et contre générés par IA | Faux équilibre ; risque d'inventer des arguments que personne n'a tenus. Le cas 13 donne les arguments réellement prononcés. | ❌ |
| 22 | Version facile à lire et à comprendre (FALC), ou audio | Utile, mais demande une relecture humaine par texte. | ⏸ |

#### Q3. Le travail d'un député

| # | Cas d'usage | Critique | Verdict |
| --- | --- | --- | --- |
| 23 | Initiatives : propositions de loi déposées et cosignées, et leur sort | Factuel, dans les dossiers législatifs. | ✅ R6 |
| 24 | Amendements déposés et adoptés, texte par texte | Factuel. Compter récompense le volume : montrer le sort, signaler les séries. | ✅ R6 |
| 25 | Questions écrites et orales, avec ou sans réponse du gouvernement | Factuel ; sert aussi au contrôle du gouvernement. | ✅ R6, R11 |
| 26 | Fonctions : commissions, rapporteur, présidence, gouvernement, changements de groupe | Indispensable pour lire n'importe quel chiffre d'activité. | ✅ R6 |
| 27 | Synthèse IA « engagement et initiatives » | Un portrait est toujours un cadrage. Faisable sous gabarit strict. | 🔁 R7 |
| 28 | Participation aux scrutins, y compris par délégation | Le champ `parDelegation` existe dans chaque scrutin. Sujet sensible (F7). | ✅ R8 |
| 29 | Présence en commission | Contrôle réel, mais la donnée doit d'abord être validée. | 🔁 R8 |
| 30 | Activité des collaborateurs | Aucune activité publique attribuable : les collaborateurs ne votent pas et ne siègent pas. Salariés de droit privé : traitement de données personnelles injustifiable. | ❌ |
| 31 | Score global d'assiduité, classement des députés | Contraire à la charte. Un indicateur publié devient un objectif (loi de Goodhart) : questions et amendements gonflés. | ❌ |
| 32 | « Sa circonscription dans ses interventions » : mentions des communes de la circonscription en séance et dans les questions | Angle local inédit, la table des communes existe déjà. | ✅ R9 |
| 33 | Réseau des cosignatures entre groupes | Montre le travail transpartisan ; secondaire. | ⏸ |
| 34 | Liens vers les déclarations HATVP et le registre des déports | Transparence officielle ; liens seulement, sans interprétation. | ✅ R15 |
| 35 | Frais de mandat | Non publics. | ❌ |
| 36 | Promesses de campagne comparées aux votes | Programmes non structurés ; l'interprétation serait forcément partisane. | ❌ |
| 37 | Bilan de législature téléchargeable (PDF) par député | Demandé avant une élection, donc sensible. À décider hors période électorale. | ⏸ |
| 38 | « Écrire à mon député » (modèle de message) | Peut devenir un outil de spam ou de harcèlement ; peu différenciant. | ⏸ |

#### Q4. Rapports de force et procédures

| # | Cas d'usage | Critique | Verdict |
| --- | --- | --- | --- |
| 39 | Classer les textes par « obstruction » | Le mot est un jugement : l'obstruction des uns est le droit d'amendement des autres. | 🔁 R10 |
| 40 | Scrutins publics demandés par un groupe sur ses propres amendements | Indicateur factuel : chaque scrutin indique son demandeur et l'amendement visé. | ✅ R10 |
| 41 | Amendements de série (quasi identiques, déposés par le même groupe) | Mesurable par similarité de texte ; seuil à publier. | ✅ R10 |
| 42 | Rappels au règlement, suspensions de séance, motions de procédure (rejet préalable, renvoi en commission) | Lisibles dans les comptes rendus et les scrutins. | ✅ R10 |
| 43 | Outils du gouvernement et de la majorité : procédure accélérée, 49.3, vote bloqué, seconde délibération, temps législatif programmé, irrecevabilités | Sans eux, R10 ne montrerait qu'un camp. La symétrie est indispensable. | ✅ R10, R11 |
| 44 | Questions écrites : délai de réponse par ministère, part restée sans réponse dans le délai du Règlement | Contrôle de l'exécutif, données officielles. | ✅ R11 |
| 45 | Amendements identiques déposés par des groupes différents | Peut signaler une origine commune, mais ne doit jamais l'imputer. | ⏸ |
| 46 | Croisement avec le répertoire des représentants d'intérêts | Imputation d'influence, risque de diffamation. | ❌ |
| 47 | Coalitions de vote, texte par texte | Intéressant ; Datan propose déjà une approche proche. | ⏸ |
| 63 | Sujets et attention par période : ce qui est déposé, inscrit, débattu et questionné, thème par thème, gouvernement et parlementaires | Les 29 thèmes et leur rattachement existent déjà. Un camembert à 29 parts serait illisible ; le budget écrase l'automne ; un dépôt ne dit rien de l'importance d'un texte. | ✅ R18 |

#### Q5. La parole face aux faits

| # | Cas d'usage | Critique | Verdict |
| --- | --- | --- | --- |
| 48 | Fact-checking IA de toutes les interventions | Volume énorme, hallucinations, exposition juridique (diffamation), parti pris perçu, non reproductible. | ❌ |
| 49 | Fact-checking éditorial humain, avec verdict | C'est un métier de journaliste : équipe dédiée, code de déontologie, autre exposition juridique. La forme sans verdict est le cas 62. | ❌ |
| 50 | Mettre en regard les affirmations sur des votes (« vous avez voté contre… ») et le scrutin correspondant | Vérifiable par les données de l'Assemblée seules. On montre le scrutin, on ne prononce pas de verdict. | 🔁 R12 |
| 51 | Mettre en regard les chiffres officiels cités (INSEE, budget) et leur source | Utile, mais demande une relecture humaine pour chaque chiffre. | 🔁 R17 |
| 52 | Afficher les vérifications publiées par des médias de fact-checking signataires d'un code reconnu (format ClaimReview) | On cite au lieu de juger, mais la couverture des médias est inégale entre partis. | 🔁 R17 |
| 53 | Écart entre annonce et vote, étendu aux votes sur des articles et des amendements | Prolonge une mesure existante, précise à 98 %. | ✅ R12 |
| 54 | Indice de « probité » ou de « sincérité » | La probité (intégrité, conflits d'intérêts) ne se mesure pas dans un discours. Diffamatoire. | ❌ |
| 62 | Éclairages sourcés : sous une affirmation factuelle, les sources qui l'éclairent (données officielles, synthèses scientifiques, enquêtes de presse, réponse de l'intéressé), toutes citées, sans verdict ni commentaire | On cite au lieu de juger. Mais choisir les affirmations reste un acte éditorial, compter les sources trompe, et les désaccords tiennent souvent aux définitions. | 🔁 R17 |

#### Q6. Un outil lui-même contrôlable

| # | Cas d'usage | Critique | Verdict |
| --- | --- | --- | --- |
| 55 | Journal public des corrections | Preuve de sérieux, coût faible. | ✅ R13 |
| 56 | Droit de réponse vérifié pour les élus (lien de connexion envoyé à leur adresse @assemblee-nationale.fr) | Réutilise le lien magique existant ; désamorce les conflits. | ✅ R13 |
| 57 | Exports CSV et API des données dérivées, sous Licence Ouverte | Permet de vérifier Polititia ; sert la presse et la recherche. | ✅ R13 |
| 58 | Date de mise à jour et version de méthode sur chaque chiffre | Indispensable dès qu'un chiffre est cité ailleurs. | ✅ R13 |
| 59 | Comité de relecture pluraliste pour les fonctions rédigées par IA | Garde-fou de R5 et R7. | ✅ § 7 |
| 60 | Quiz « Qui a dit ? » | Choisir les citations est un choix éditorial ; transforme le débat en jeu. | ❌ |
| 61 | « Quel député vote comme moi ? » | Forte demande avant la présidentielle, mais le choix des questions oriente le résultat. | ⏸ |

### 4.2 Les six idées de départ, passées au crible

| Idée de départ | Ce qui est gardé | Ce qui change | Verdict |
| --- | --- | --- | --- |
| Classer les textes selon les obstructions, en lien avec les scrutins publics demandés sur ses propres amendements | Le classement des textes, et l'indicateur « scrutins demandés sur ses propres amendements », calculable avec les données actuelles : 8 876 des 8 906 scrutins publics de la législature indiquent leur demandeur, et leur objet nomme l'amendement visé | Le mot « obstruction » disparaît. On montre des indicateurs bruts, rapportés au nombre de sièges, avec les outils du gouvernement à côté de ceux de l'opposition. Les textes se trient indicateur par indicateur, sans score composite. | 🟡 R10 |
| Agenda des textes à venir, avec une recherche de contexte systématique | L'agenda et la mémoire interne : débats, scrutins et dossiers antérieurs | L'agenda vient du jeu de données « Agenda » de l'Assemblée (l'équivalent du feuilleton), pas du JORF : le Journal officiel publie les lois une fois promulguées, il sert donc à l'après-vote. La recherche web ouverte est remplacée par un corpus fermé de sources institutionnelles. | 🟢 R3 + 🟠 R5 |
| Garder ce contexte sur chaque texte, avec la décision et qui a voté pour ou contre | Tout | Devient la fiche texte, page pivot du site, prolongée par l'après-vote (Conseil constitutionnel, promulgation, décrets). | 🟢 R1 + R2 |
| Résumé IA neutre de l'engagement et des initiatives de chaque député | L'objectif | D'abord les faits bruts (R6), puis une synthèse rédigée par gabarit fixe, sans IA générative ; une IA ne viendrait qu'ensuite, pour la seule formulation. | 🟢 R6 → 🟠 R7 |
| Fact-checking de chaque intervention pour évaluer la probité des discours | La confrontation de la parole aux faits | Pas de verdict « vrai / faux » ni de note de « probité ». Deux formes : les affirmations sur des votes mises en regard du scrutin réel (R12), et des éclairages sourcés sans verdict (R17, voir § 4.2.1). | 🔴 sous sa forme initiale → 🟡 R12 + 🟠 R17 |
| Assiduité de chaque membre, en recoupant ses participations, celles de ses collaborateurs, aux votes et en commission | Votes et commissions | Les collaborateurs sont exclus (aucune activité publique, données personnelles). Pas de score global ni de classement. La présence en commission est validée (§ 6.1). | 🟡 R8 |

#### 4.2.1 Idées ajoutées après la première version (17 novembre 2026)

| Idée | Ce qui est gardé | Ce qui change | Verdict |
| --- | --- | --- | --- |
| Éclairer ce qui est dit par des études scientifiques et par la concordance de sources journalistiques, toutes citées, y compris celles qui contredisent, sans commentaire ni prise de position | Citer plutôt que juger ; montrer toutes les sources, y compris les démentis | Les affirmations éclairées sont choisies par une règle publique, indépendante de leur contenu. Les sources sont classées par nature, jamais comptées : cinq articles qui reprennent une même enquête ne sont qu'une source. Seules les synthèses scientifiques comptent, pas une étude isolée. La presse vient d'un panel de médias de toutes sensibilités, fixé à l'avance sur des critères de qualité, sans étiquette gauche ou droite. Quand les sources n'emploient pas les mêmes termes (arme ou composant, licence ou livraison), une alerte le signale en citant les mots de chacune et la définition officielle s'il y en a une. Travail éditorial humain, piloté sur une dizaine de cas. | 🟠 R17 |
| Catégoriser les textes et montrer par période, en camembert, les sujets qui occupent le gouvernement et les parlementaires | La vue par période, la distinction entre gouvernement et parlementaires, la lecture en un coup d'œil | Quatre angles plutôt qu'un : ce qui est déposé, inscrit à l'ordre du jour, débattu, et demandé au gouvernement. Des barres triées plutôt qu'un camembert à 29 parts ; un anneau à 6 parts plus « autres » seulement pour l'accueil et les cartes de partage. Le budget est montré à part. | 🟢 R18 |

### 4.3 Livrer : les 18 cas retenus

| Réf. | Cas retenu | Issu de | Risque | Phase |
| --- | --- | --- | --- | --- |
| R1 | Fiche texte : parcours, votes, ce que chaque groupe en a dit | 11, 12, 13 | 🟢 | 1 |
| R2 | Après le vote : Conseil constitutionnel, promulgation, application | 19 | 🟢 | 1 (étapes), 2 (décrets) |
| R3 | Agenda et mémoire du sujet | 1, 2, 3 | 🟢 | 1 |
| R4 | Suivre un texte ou un thème | 6 | 🟢 | 1 |
| R5 | Contexte et enjeux d'un texte, à partir d'un corpus fermé | 5, 16 | 🟠 | 3 |
| R6 | Activité parlementaire du député | 23 à 26 | 🟢 | 2 |
| R7 | Synthèse de l'activité d'un député | 27 | 🟠 | 3 |
| R8 | Participation aux scrutins et en commission | 28, 29 | 🟡 | 2 |
| R9 | Sa circonscription dans ses interventions | 32 | 🟢 | 2 |
| R10 | Indicateurs de procédure par texte | 39 à 43 | 🟡 | 2 |
| R11 | Contrôle du gouvernement | 43, 44 | 🟢 | 2 |
| R12 | Parole face aux votes, étendue | 50, 53 | 🟡 | 3 |
| R13 | Confiance : corrections, droit de réponse, datation, exports | 55 à 58 | 🟢 | 1 |
| R14 | Pédagogie : glossaire et parcours d'un texte | 17, 18 | 🟢 | 1 |
| R15 | Déontologie : liens HATVP et registre des déports | 34 | 🟢 | 2 |
| R16 | Scrutins en clair | 14 | 🟡 | 2 |
| R17 | Éclairages sourcés, sans verdict | 51, 52, 62 | 🟠 | 3 |
| R18 | Sujets et attention par période | 63 | 🟢 | 2 |

---

## 5. Évaluation des cas retenus

### 5.1 Notes

Notes données pour le cas tel qu'il sera construit, garde-fous compris.

| Réf. | Cas | C | K | F | N | R | D | Total /30 | Risque |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| R1 | Fiche texte | 5 | 4 | 5 | 5 | 4 | 4 | **27** | 🟢 |
| R3 | Agenda et mémoire du sujet | 5 | 4 | 5 | 5 | 4 | 4 | **27** | 🟢 |
| R2 | Après le vote | 4 | 5 | 5 | 5 | 3 | 4 | **26** | 🟢 |
| R18 | Sujets et attention par période | 5 | 4 | 5 | 4 | 4 | 4 | **26** | 🟢 |
| R4 | Suivre un texte ou un thème | 3 | 4 | 5 | 5 | 5 | 3 | **25** | 🟢 |
| R9 | Sa circonscription | 4 | 4 | 4 | 4 | 4 | 5 | **25** | 🟢 |
| R11 | Contrôle du gouvernement | 3 | 5 | 5 | 4 | 4 | 4 | **25** | 🟢 |
| R6 | Activité du député | 4 | 5 | 5 | 4 | 4 | 2 | **24** | 🟢 |
| R13 | Confiance | 2 | 4 | 5 | 5 | 5 | 3 | **24** | 🟢 |
| R14 | Pédagogie | 5 | 2 | 5 | 5 | 5 | 2 | **24** | 🟢 |
| R16 | Scrutins en clair | 5 | 3 | 4 | 3 | 4 | 4 | **23** | 🟡 |
| R10 | Indicateurs de procédure | 4 | 4 | 4 | 3 | 3 | 5 | **23** | 🟡 |
| R12 | Parole face aux votes | 4 | 5 | 4 | 3 | 2 | 5 | **23** | 🟡 |
| R15 | Déontologie | 2 | 4 | 5 | 4 | 5 | 1 | **21** | 🟢 |
| R5 | Contexte d'un texte | 5 | 3 | 3 | 3 | 2 | 5 | **21** | 🟠 |
| R8 | Participation | 3 | 5 | 4 | 3 | 3 | 2 | **20** | 🟡 |
| R17 | Éclairages sourcés | 4 | 4 | 3 | 2 | 2 | 5 | **20** | 🟠 |
| R7 | Synthèse du député | 4 | 3 | 3 | 2 | 3 | 4 | **19** | 🟠 |

### 5.2 🟢 Sûrs et peu critiquables

Ces cas ne reposent que sur des données officielles et ne portent aucun jugement. Ils peuvent être livrés dès que
les données sont intégrées.

**R1. Fiche texte.**
Pourquoi c'est sûr : dossiers législatifs, scrutins et comptes rendus, déjà téléchargés et déjà maîtrisés par le pipeline.
- *« Vos extraits favorisent tel groupe. »* La sélection suit une règle fixe, publiée : l'explication de vote de chaque groupe (le Règlement attribue un orateur par groupe), dans un ordre fixe, avec une longueur plafonnée identique. À défaut, l'intervention du groupe en discussion générale ; à défaut, la mention « aucune prise de parole ».
- *« Ce texte a été adopté au 49.3, il n'y a pas eu de vote. »* La fiche montre la procédure et le scrutin sur la motion de censure qui en découle.

**R2. Après le vote.**
Pourquoi c'est sûr : dates et décisions officielles (les étapes CC-SAISIE, CC-CONCLUSION et PROM-PUB figurent déjà dans les dossiers ; Légifrance pour les décrets).
- *« Vous comptez mal les décrets attendus. »* On reprend l'échéancier d'application publié sur Légifrance tel quel, sans recalcul.

**R3. Agenda et mémoire du sujet.**
Pourquoi c'est sûr : l'ordre du jour est officiel ; la mémoire ne puise que dans le corpus de Polititia.
- *« L'ordre du jour a changé. »* Chaque point indique son état publié (confirmé, éventuel) et la date de mise à jour des données, avec la mention « susceptible d'évoluer » ; rafraîchissement quotidien. La date de la Conférence des présidents n'est presque jamais publiée dans les données : elle n'est affichée que lorsqu'elle existe.
- *« Le rapprochement entre ces textes est arbitraire. »* Chaque lien dit pourquoi il est là : même dossier, même thème du lexique, même code modifié.

**R4. Suivre un texte ou un thème.** Aucun contenu éditorial ; reprend les règles de désabonnement existantes.

**R6. Activité parlementaire du député.**
Pourquoi c'est sûr : des comptes de documents officiels.
- *« Compter récompense le volume et pénalise les présidents de commission ou les anciens ministres. »* Pas de classement ; le sort des textes et des amendements est montré (adoptés sur déposés) ; les fonctions sont affichées en tête de fiche ; les amendements de série sont signalés ; la médiane de l'hémicycle sert seulement de repère.
- *« NosDéputés le fait déjà. »* C'est vrai en partie ; la vue reste nécessaire pour R7 et pour une fiche complète.

**R9. Sa circonscription dans ses interventions.**
- *« Faux positifs (communes nommées Vertus, Mars, Saint-Denis…). »* Correspondance exacte avec majuscule, désambiguïsation par le département, liste d'exclusion, précision mesurée sur un échantillon d'au moins 100 mentions : publication à partir de 85 %.
- *« Vous suggérez qu'un député doit parler de sa circonscription. »* Un député représente la Nation entière : la page le dit, et aucun « taux de mention » n'est comparé entre députés.

**R11. Contrôle du gouvernement.**
Pourquoi c'est sûr : données officielles, et la critique vise aussi l'exécutif, ce qui équilibre l'ensemble.
- *« Une question sans réponse n'est pas toujours la faute du ministère. »* Les statuts officiels (retirée, caduque, signalée) sont distingués ; le délai suit la règle du Règlement (art. 135 : un mois, prolongeable d'un mois) ; les changements de gouvernement sont indiqués.

**R13. Confiance.**
- *« Le droit de réponse sert à faire pression. »* La réponse est publiée à côté de la donnée ; la donnée ne change que si elle est factuellement fausse, et la correction est inscrite au journal public.

**R14. Pédagogie.** Définitions reprises des fiches officielles de l'Assemblée, citées.

**R15. Déontologie.** Liens vers les documents officiels, sans aucune interprétation.

**R18. Sujets et attention par période.**
Pourquoi c'est sûr : des comptes de données officielles, classés par les 29 thèmes publics du lexique, dont la précision est déjà mesurée (98,9 %).
- *« Votre classement thématique est arbitraire. »* Le lexique est public ; chaque part est cliquable et mène à la liste des textes ou des interventions qu'elle compte.
- *« Le budget écrase tout. »* D'octobre à décembre, le PLF et le PLFSS occupent l'essentiel du temps de séance : le budget est montré à part, et on peut l'exclure.
- *« Vous suggérez que le gouvernement confisque l'ordre du jour. »* On montre côte à côte ce que déposent les députés et ce que dépose le gouvernement. Le cadre de l'article 48 de la Constitution (deux semaines sur quatre réservées au gouvernement, une au contrôle, un jour par mois aux groupes d'opposition et minoritaires) est expliqué dans le glossaire (R14), sans commentaire.
- *« Un texte déposé n'est pas un texte important. »* La vue le dit : sur la législature, 2 118 propositions de loi ordinaires ont été déposées contre 73 projets de loi ordinaires, et la plupart des propositions ne sont jamais débattues. C'est justement l'écart que la vue rend visible.

### 5.3 🟡 Sûrs avec garde-fous

**R8. Participation aux scrutins et en commission.**
Risques : antiparlementarisme ; la présence en séance n'est pas publique (la page Méthode le dit déjà) ; la donnée de commission n'est pas encore validée.
Garde-fous :
- Ni score global, ni classement, ni le mot « absentéisme ».
- Les scrutins solennels sont distingués des scrutins ordinaires ; les votes par délégation sont affichés ; les causes officielles (membre du gouvernement, présidence de séance) sont exclues du calcul.
- Présence en commission publiée seulement après validation, avec une concordance d'au moins 95 % avec les comptes rendus de commission. Le seuil est plus haut que la règle générale, car le sujet est sensible. Le spike 0.5 a mesuré plus de 99,9 % (§ 6.1).
- Encadré « Ce que ce chiffre ne dit pas » : mission, maladie, travail en circonscription, délégation.
- Collaborateurs exclus.

**R10. Indicateurs de procédure par texte.**
Risques : lecture partisane ; tentation de désigner un « groupe obstructeur ».
Garde-fous :
- Intitulé « Comment le texte a été débattu ». Le mot « obstruction » n'est jamais employé.
- Les indicateurs de l'opposition (amendements, séries, scrutins demandés, rappels au règlement, motions) et ceux du gouvernement et de la majorité (procédure accélérée, 49.3, vote bloqué, seconde délibération, temps législatif programmé, irrecevabilités) sont toujours affichés ensemble.
- Chiffres rapportés au nombre de sièges du groupe.
- Les textes se trient par un indicateur choisi par le visiteur ; il n'y a pas de score composite.
- L'indicateur « scrutins demandés sur ses propres amendements » n'est publié qu'après vérification sur un échantillon : la correspondance entre le demandeur et l'auteur de l'amendement doit être juste dans au moins 95 % des cas.

**R12. Parole face aux votes, étendue.**
Risques : détection erronée d'une affirmation ; image de tribunal.
Garde-fous :
- On montre, on ne juge pas : ni « vrai », ni « faux ». La phrase, le scrutin et le résultat par groupe sont affichés côte à côte.
- Seules les affirmations dont la correspondance avec un scrutin est univoque (même texte, même groupe visé) sont retenues.
- Précision mesurée d'au moins 90 % avant publication.
- Droit de réponse de l'élu (R13).

**R16. Scrutins en clair.**
Risque : l'exposé sommaire est l'argument de l'auteur, présenté à un endroit qui se veut neutre.
Garde-fous : mention « selon son auteur » ; sort de l'amendement et, quand la donnée existe, avis de la commission et du gouvernement ; aucune reformulation par IA sans relecture.

### 5.4 🟠 Exposés : seulement aux conditions du § 7

**R5. Contexte et enjeux d'un texte.**
Risques :
- Hallucination.
- Cadrage : ce qu'on choisit de dire est déjà un choix.
- **Biais structurel** : un projet de loi arrive avec une étude d'impact et un avis du Conseil d'État, une proposition de loi non. Le contexte d'un texte du gouvernement reprendrait donc surtout le cadrage du gouvernement, et celui d'un texte de l'opposition serait plus pauvre.

Garde-fous :
- Chaque information est attribuée à son origine : « selon le Gouvernement (étude d'impact) », « selon la commission (rapport) », « selon les auteurs (exposé des motifs) ».
- Les arguments des groupes viennent de R1 (prononcés et cités), jamais générés.
- Corpus fermé, une source par phrase, vérification automatique puis relecture humaine avant toute première publication.

Conditions de lancement : 30 textes de test dont autant de propositions que de projets, aucune phrase sans appui dans sa source sur cet échantillon, audit par le comité pluraliste.

**R7. Synthèse de l'activité d'un député.**
Risques : un portrait est toujours un jugement ; longueurs inégales ; hallucination ; sensibilité en période électorale.
Garde-fous, en deux temps :
- **R7a**, synthèse par gabarit, sans IA générative : des phrases fixes remplies par les données de R6 (« Depuis juillet 2024, X est intervenu 143 fois en séance, surtout sur la santé (38 %) et l'agriculture (21 %). Il a déposé 4 propositions de loi, dont 1 adoptée… »). Zéro hallucination possible, même forme pour les 577 députés.
- **R7b**, éventuellement : une IA reformule le gabarit pour le rendre plus fluide, sans rien y ajouter. Une vérification automatique s'assure que chaque nombre et chaque nom figurent dans les données, et une liste publique d'adjectifs interdits (actif, discret, engagé, combatif…) s'applique.

Pas de lancement dans les semaines qui précèdent un scrutin national.

**R17. Éclairages sourcés, sans verdict.**
Principe : sous une affirmation factuelle prononcée en séance, afficher les sources qui l'éclairent, y compris celles qui la contredisent, sans verdict ni commentaire.
Risques :
- **La sélection** : avec plus de 77 000 interventions, choisir lesquelles éclairer est l'acte éditorial principal. Si on éclaire surtout le gouvernement, ou surtout un camp, c'est une prise de position, même avec des sources impeccables.
- **Le comptage** : plusieurs médias reprennent souvent une même enquête ou une même dépêche. Afficher cinq articles donne l'illusion de cinq sources. À l'inverse, une étude face à un démenti suggère un équilibre qui n'existe pas forcément.
- **Les définitions** : beaucoup de désaccords portent sur les mots. Sur les exportations d'armement, par exemple : arme ou composant, bien à double usage, licence accordée ou livraison effectuée, matériel destiné à la réexportation. Deux sources contraires peuvent être exactes chacune dans ses termes. Les juxtaposer sans le montrer induit en erreur ; l'expliquer avec nos mots, c'est déjà commenter.
- **Les études** : une étude isolée se trouve pour presque toute thèse.
- **Le droit** : placer le nom d'un élu à côté d'articles qui le contredisent peut se lire comme une insinuation.
- **Le coût** : c'est un travail éditorial humain, qui ne s'automatise pas de façon fiable.

Garde-fous :
- Seulement des affirmations factuelles vérifiables : pas d'opinion, pas de prévision.
- **Règle de sélection publique, indépendante du contenu**. Par exemple : les affirmations contestées dans l'hémicycle même (les comptes rendus notent les interruptions comme « C'est faux ! », déjà extraites dans les apartés), ou celles déjà traitées par un média de vérification signataire d'un code reconnu (IFCN, EFCSN).
- **Les sources sont classées par nature, dans cet ordre** :
  1. données officielles primaires, par exemple le rapport annuel du gouvernement au Parlement sur les exportations d'armement, ou les réponses des ministres aux questions écrites ;
  2. évaluations institutionnelles : Cour des comptes, autorités indépendantes ;
  3. synthèses scientifiques : méta-analyses, expertises collectives (Inserm, GIEC…), statistiques publiques ;
  4. articles des médias du panel (ci-dessous), avec leur source d'origine, les reprises étant regroupées sous elle ;
  5. réponse de la personne ou du ministère concerné.
- **Un panel de médias fixé à l'avance**, et non choisi affirmation par affirmation :
  - une dizaine de médias retenus sur des critères vérifiables : charte de déontologie publiée, politique de correction et médiateur, certification Journalism Trust Initiative (RSF), code IFCN ou EFCSN pour les cellules de vérification ;
  - le comité pluraliste s'assure que les grandes sensibilités éditoriales y sont représentées ; la composition et les critères sont publiés sur la page Méthode et revus au plus une fois par an ;
  - pour chaque éclairage, tout le panel est interrogé, et tout ce qui est trouvé est affiché. Un média qui n'a rien publié est mentionné (« pas d'article trouvé »), sans que l'on fabrique de contrepoint pour équilibrer ;
  - aucune étiquette « gauche » ou « droite » n'est affichée : chaque média contesterait sa case, l'axe gauche-droite écrase d'autres sensibilités, et étiqueter ferait d'un fait une opinion de camp. Le lecteur compare lui-même. Des faits sur chaque média (propriétaire, charte) peuvent être liés depuis la page Méthode.
- Ni verdict, ni comptage, ni code couleur. Chaque source est datée.
- **Alerte « termes différents »** : quand les sources n'emploient pas les mêmes mots pour la même chose, une mention le signale.
  - Elle est rédigée comme un constat (« Les sources n'emploient pas les mêmes termes »), suivi des mots exacts de chacune entre guillemets (par exemple « armes » et « composants »). Elle ne dit jamais que « le désaccord porte sur la définition » : ce serait une interprétation, qui pourrait minimiser une vraie contradiction.
  - Quand une définition officielle existe, elle est citée et liée : le Code de la défense pour les matériels de guerre, le règlement européen pour les biens à double usage.
  - Elle est posée par un humain, éventuellement sur suggestion d'une IA, avec la même règle pour tous les camps.
- Compteur public des éclairages par groupe et pour le gouvernement, rapporté au temps de parole.
- Relecture par le comité pluraliste avant publication ; droit de réponse (R13).
- Si une IA aide à trouver des sources, la charte du § 7 s'applique ; le choix final reste humain.

Conditions de lancement : un pilote d'une dizaine de cas, choisis par la règle publique et portant sur des groupes variés, relu par le comité. Un partenariat est envisageable avec une rédaction de vérification ou avec l'équipe de l'USI. Pas de lancement dans les semaines qui précèdent un scrutin national.

### 5.5 🔴 Écartés

| # | Cas | Raison principale |
| --- | --- | --- |
| 4 | Recherche web ouverte pour contextualiser | Choisir les sources est un choix éditorial invisible ; non reproductible. |
| 8 | Prédire l'issue d'un vote | Spéculatif, peut influencer. |
| 9 | Simulateur « ce que ça change pour vous » | Impossible à faire juste à grande échelle. |
| 21 | Arguments pour et contre générés par IA | Faux équilibre ; arguments inventés. |
| 30 | Activité des collaborateurs | Pas d'activité publique ; données personnelles de salariés. |
| 31 | Score ou classement d'assiduité | Contraire à la charte ; effet Goodhart. |
| 35 | Frais de mandat | Non publics. |
| 36 | Promesses de campagne et votes | Interprétation partisane inévitable. |
| 46 | Croisement avec les représentants d'intérêts | Imputation, diffamation. |
| 48, 49 | Fact-checking automatique ou éditorial, avec verdict | Exposition juridique, volume, parti pris perçu, autre métier. Remplacé par R17, sans verdict. |
| 54 | Indice de « probité » | Non mesurable dans un discours ; diffamatoire. |
| 60 | Quiz « Qui a dit ? » | Sélection éditoriale, ludification du débat. |

---

## 6. Feuille de route

### 6.0 Calendrier et contraintes

- **Novembre 2026** : lancement public. L'automne est la saison budgétaire (PLF, PLFSS) : l'agenda a de la valeur tout de suite.
- **Printemps 2027** : élection présidentielle. Il est recommandé de livrer avant les phases 1 et 2, qui sont factuelles, et de lancer les cas 🟠 après le scrutin.
- Les phases suivent l'ordre des dépendances ; les trimestres sont indicatifs.
- Effort : **S** (quelques jours), **M** (une à deux semaines), **L** (plus de deux semaines).

### Phase 0. Socle de données (T4 2026)

Prérequis de tout le reste.

- [ ] **0.1 Amendements** (`loi/amendements_div_legis/Amendements.json.zip`, environ 365 Mo compressés) : auteur, cosignataires, groupe, texte et article visés, sort, date, premier paragraphe de l'exposé sommaire. Agréger dans `build_analytics_db.py` sans stocker les dispositifs complets : `analytics.sqlite` est reconstruite et publiée par la CI. **L**
- [x] **0.2 Agenda** (`vp/reunions/Agenda.json.zip`, environ 9 Mo). Fait le 17 novembre 2026.
  - `build_agenda_db.py` écrit `analysis_outputs/agenda.sqlite` (schéma `agenda_schema.sql`) en quelques secondes, en lisant directement l'archive. La base contient les séances et réunions de commission avec leur état, les points de l'ordre du jour et le dossier visé par chacun, ainsi que les présences en commission (présent, excusé, absent).
  - Volume au 17 novembre 2026 : 8 367 réunions, 6 531 points, 3 298 liens vers un dossier, 193 148 présences. La base pèse 26 Mo, 4,4 Mo compressée.
  - `.github/workflows/refresh-agenda.yml` la reconstruit chaque jour et la publie sur la release `data` (`agenda.sqlite.gz`), après un contrôle de volume.
  - Tests : `tests/test_build_agenda_db.py`.
  - Le serveur ne la lit pas encore : R3 décidera comment Render récupère le fichier quotidien, par un téléchargement au démarrage puis à intervalle régulier, ou par un redéploiement quotidien.
  - Constats :
    - Le jeu annonce aussi les séances du Sénat : 160 sur 1 166. On filtre les séances de l'Assemblée par `organ_type = 'ASSEMBLEE'`.
    - 629 des 634 séances passées de l'Assemblée se rattachent à leurs interventions dans `analytics.sqlite` (`report_ref = session_uid`). Les 5 autres n'ont aucune intervention extraite, comme la séance d'ouverture du 18 juillet 2024.
    - 32 doublons dans les listes de présence de la source ; ils sont ignorés.
    - 71 organes, surtout des missions d'information, sont absents du référentiel AMO : leur nom reste vide.
    - La date de la Conférence des présidents n'est presque jamais publiée.
    - Le code de nature des points (`ODJPR`, `ODJAN`, `ODJSN`) est conservé tel quel, sans interprétation.
- [ ] **0.3 Questions** (`questions/questions_ecrites`, `questions_gouvernement`, `questions_orales_sans_debat`) : auteur, ministère, dates de question et de réponse, statut. **M**
- [ ] **0.4 Le dossier comme pivot** : table `dossiers` (uid, titre, projet ou proposition, auteurs et cosignataires, procédure accélérée, étapes datées, CMP, saisine et décision du Conseil constitutionnel, promulgation), reliée aux interventions (`speeches.bill_number`), aux scrutins (`votes.dossier_title` vers l'uid) et aux amendements. **M**
- [x] **0.5 Spike : présence en commission.** Fait le 17 novembre 2026. **Verdict : feu vert pour le volet commissions de R8**, dans le périmètre ci-dessous. Détail au § 6.1.
- [x] **0.6 Spike : XVIe législature.** Fait le 17 novembre 2026. **Verdict : intégrer une mémoire légère, séparée de la base principale**, et non la XVIe entière. Détail au § 6.2.
- [ ] **0.7 Documentation** : page Méthode (§ Limites : amendements et questions entrent dans le périmètre) et README (pipeline). **S**

*Fait quand* : la base contient dossiers, amendements, agenda et questions ; des tests Python couvrent les jointures (un scrutin vers son dossier, un amendement vers son auteur et son groupe) ; le taux de couverture de chaque jointure est mesuré et publié sur la page Méthode.

#### 6.1 Résultats du spike 0.5 : présence en commission

Source : `Agenda.json.zip` téléchargé le 17 novembre 2026, comparé aux comptes rendus officiels
(`https://www.assemblee-nationale.fr/dyn/opendata/<compteRenduRef>.html`, rubrique « Membres présents ou excusés »).
Script reproductible : [`scripts/spike_commission_presence.py`](scripts/spike_commission_presence.py) (`uv run python scripts/spike_commission_presence.py . <dossier_cache> 50`).

- **La donnée existe.** Chaque réunion de commission porte `participants.participantsInternes`. Chaque membre de l'organe y figure avec l'une de trois valeurs : `présent`, `absent` ou `excusé`. Les listes couvrent tous les membres, pas seulement les présents : seules 10 listes sur 3 577 ne contiennent que des présents, et elles comptent de 70 à 74 noms pour une commission permanente.
- **Couverture** des 5 914 réunions tenues (confirmées et passées) :

  | Type d'organe | Réunions | Avec liste |
  | --- | --: | --: |
  | Commissions permanentes | 1 806 | 1 802 (99,8 %) |
  | Commissions d'enquête | 833 | 817 (98 %) |
  | Groupes d'amitié | 444 | 441 |
  | Délégations | 140 | 137 |
  | Commissions spéciales | 83 | 71 |
  | CMP | 55 | 54 |
  | Missions d'information | 1 245 | **0** |
  | Organes absents du référentiel AMO | 931 | 39 |

- **Concordance avec les comptes rendus**, sur 50 réunions tirées au hasard (graine fixe). 47 ont pu être comparées : 2 comptes rendus n'ont pas de liste, et un troisième la met sous une forme que l'analyseur ne lit pas.
  - 912 « présent » sur 912 se retrouvent dans la liste des présents du compte rendu. Le seul écart apparent tient au nom suivi du département dans le référentiel AMO (« Alexandra Martin (Alpes-Maritimes) »).
  - 297 « excusé » sur 300 se retrouvent parmi les excusés du compte rendu ; aucun des 1 202 « absent » n'y figure. La distinction entre absent et excusé est donc fiable.
  - 2 vrais désaccords sur environ 2 400 statuts, tous deux dans la même réunion (Affaires étrangères, 21 janvier 2026) : un membre noté absent, l'autre excusé, alors que le compte rendu les cite présents.
  - Au total, 45 réunions sur 47 concordent exactement, et plus de 99,9 % des statuts. Le seuil de 95 % fixé au § 5.3 est franchi.
- **Conséquences pour R8** :
  - Publier la présence dans les commissions permanentes, les commissions d'enquête, les commissions spéciales, les délégations et les CMP.
  - Ne rien afficher pour les missions d'information, qui ne publient pas de liste : le dire sur la page Méthode.
  - Toujours distinguer « excusé » d'« absent ».
  - Ajouter un lien vers le compte rendu de chaque réunion, pour vérification.
  - Les deux sources viennent des services de l'Assemblée : leur concordance prouve la cohérence de la donnée publiée, pas la réalité de la présence physique. La page Méthode le dira.

#### 6.2 Résultats du spike 0.6 : XVIe législature

- **Données** : débats (archive de 57,5 Mo, 605 séances, 328 Mo une fois décompressée) et scrutins (10,1 Mo, 4 106 scrutins) téléchargés depuis `repository/16`. Les dossiers législatifs de la XVIe (9,1 Mo) existent aussi. Le référentiel AMO déjà utilisé contient les mandats et les groupes de la XVIe : pas de second téléchargement.
- **Extraction** : `extract_speeches.py` fonctionne sans modification. En 6 minutes, il produit 73 136 interventions (contre 77 128 pour la XVIIe), toutes rattachées à un député (`acteur_id`), dont 85 % portent un numéro de texte (contre 86,4 %), ainsi que 140 894 apartés.
- **Anomalie de la source** : une séance (`CRSANR5L16S2021O1N144`, 24 interventions) est datée du 1er février 2021. Il faut l'écarter, ou la corriger à partir de son contenu.
- **Volume** : le corpus est de la même taille que celui de la XVIIe (15,1 millions de mots contre 15,6). Intégrer la XVIe entière doublerait donc à peu près `analytics.sqlite` (428 Mo aujourd'hui), dont l'essentiel vient des expressions par député et par mois (environ 230 Mo). La reconstruction en CI et le déploiement sur Render en pâtiraient.
- **Code qui suppose la XVIIe** :
  - `reference_data.py` : filtres `legislature == "17"` sur les groupes, les sièges et les dossiers ; `DOCUMENT_NUMBER_RE` en `L17` ; gouvernement à partir de 2024.
  - `GROUP_CODES` ne connaît pas les groupes de 2022 (RE, LFI-NUPES, LR, Écolo-NUPES, GDR-NUPES…).
  - `asides.CAMPS` décrit les alliances de juin 2024 ; celles de 2022 sont différentes.
  - `build_analytics_db.py` : `LEGISLATURE_START` et le découpage des sessions.
  - Côté serveur : `press.ts` (`VTANR5L17V…`) et `outreach.ts`.
- **Recommandation pour R3** : une **mémoire légère** de la XVIe, dans une table séparée. Elle garderait les dossiers, les votes sur l'ensemble et les scrutins clés avec leurs résultats par groupe, et les extraits rattachés aux thèmes. Elle laisserait de côté les expressions, le style, les apartés et le palmarès. Ordre de grandeur : quelques dizaines de Mo (les extraits thématiques de la XVIIe pèsent environ 36 Mo). Le pipeline prend la législature en paramètre, et les codes de groupe ainsi que les camps de 2022 sont ajoutés. Effort : **M**. Les fiches de la XVIe restent en lecture seule, sans comparaison directe des groupes entre législatures, puisque les groupes ont changé.

#### 6.3 Constats annexes des spikes

- **Agenda (R3)** : le 17 novembre 2026, le jeu Agenda contenait 28 séances à venir, jusqu'au 3 décembre 2026, soit environ deux semaines et demie d'avance. Sur leurs 148 points à l'ordre du jour, 133 (90 %) renvoient directement à leur dossier législatif (`dossiersLegislatifsRefs`) ; les autres sont surtout des questions au gouvernement. Le jeu contient aussi 122 réunions de commission à venir.
- **Scrutins (R10)** : 8 876 des 8 906 scrutins de la XVIIe indiquent leur demandeur ; 74 sont des scrutins solennels et 23 des motions de censure.
- **Déontologie (R15)** : le référentiel AMO déjà téléchargé contient un dossier `deport/`. Le registre des déports est donc disponible en données ouvertes, et pas seulement sous forme de liens.

### Phase 1. Le texte au centre (T4 2026 - T1 2027)

**R1. Fiche texte** (`/texte/<uid>`, nouvel onglet « Textes »). **L**
- Contenu : titre et auteurs, type, frise du parcours réel, procédure (accélérée, 49.3, CMP), issue ; vote sur l'ensemble par groupe et par député ; scrutins clés du texte ; ce que chaque groupe en a dit (règle du § 5.2) ; positions annoncées confrontées aux votes ; étapes après le vote (Conseil constitutionnel, promulgation) ; carte de partage (le générateur d'images OG existe déjà).
- *Fait quand* : tous les textes adoptés de la législature ont une fiche ; chaque élément renvoie à sa source ; la règle de sélection des prises de parole figure sur la page Méthode.

**R3. Agenda et mémoire du sujet** (`/agenda`, plus un bloc « Cette semaine à l'Assemblée » sur l'accueil). **M**
- Contenu : les points de l'ordre du jour, chacun relié à sa fiche texte ; la mémoire du sujet (débats antérieurs par thème, scrutins, textes liés avec la raison du lien) ; l'état de chaque point, la date de mise à jour et la mention « susceptible d'évoluer ».
- Données : `agenda.sqlite` (0.2). Reste à décider comment Render récupère le fichier publié chaque jour.
- *Fait quand* : rafraîchi chaque jour ; tous les points de l'ordre du jour de la séance publique sont reliés à leur dossier, quand il existe.

**R4. Suivre un texte ou un thème.** **S-M**
- Étendre `follows` à trois types : député, dossier, thème. Événements d'alerte : inscription à l'ordre du jour, vote, CMP, décision du Conseil constitutionnel, promulgation. Mêmes règles de désabonnement en un clic.

**R14. Pédagogie.** **S**
- Page `/glossaire`, infobulles dans les fiches, frise « comment se fait une loi » appliquée au texte consulté.

**R13. Confiance.** **M**
- Journal public `/corrections` (date, élément corrigé, avant / après, origine du signalement).
- Droit de réponse : un élu se connecte par lien envoyé à son adresse `@assemblee-nationale.fr` ; sa réponse est publiée à côté de la donnée.
- Mention « Données à jour au … » et version de méthode sur chaque vue ; export CSV de chaque vue.

### Phase 2. Qui fait quoi (T1 - T2 2027, l'essentiel avant la présidentielle)

**R6. Activité parlementaire du député.** **M**
- Bloc « Ses initiatives » sur la fiche député : fonctions et changements de groupe en tête ; propositions de loi déposées et cosignées avec leur sort ; amendements déposés et adoptés par texte, séries signalées ; questions et réponses ; rapports.

**R11. Contrôle du gouvernement** (vue « Gouvernement »). **M**
- Questions écrites par ministère : délai médian de réponse, part restée sans réponse dans le délai du Règlement, statuts distingués.
- Par gouvernement : recours au 49.3, à la procédure accélérée, aux ordonnances.

**R2. Application des lois.** **M**
- Échéanciers d'application et décrets publiés (Légifrance, API PISTE de la DILA, sur inscription) ; détail des articles censurés par le Conseil constitutionnel.

**R10. Indicateurs de procédure par texte.** **L**
- Bloc « Comment le texte a été débattu » sur la fiche texte, plus une liste des textes triable par indicateur. Garde-fous du § 5.3. Échantillon de vérification de la correspondance entre demandeur et auteur avant publication.

**R16. Scrutins en clair.** **M**
- Objet de l'amendement (attribué à son auteur), article visé, sort, avis quand la donnée existe, partout où un scrutin est cité (fiches, alertes, partages).

**R9. Sa circonscription dans ses interventions.** **M**
- Échantillon de vérification d'au moins 100 mentions ; seuil de 85 % ; mention « un député représente la Nation entière ».

**R8. Participation.** **M**
- Scrutins : solennels et ordinaires, délégations.
- Commissions : le spike 0.5 est concluant (§ 6.1). On publie les commissions permanentes, les commissions d'enquête, les commissions spéciales, les délégations et les CMP, avec trois statuts (présent, excusé, absent) et un lien vers le compte rendu. Les missions d'information sont exclues, faute de liste.
- Garde-fous du § 5.3.

**R15. Déontologie.** **S**
- Liens vers la déclaration d'intérêts et d'activités (HATVP) et vers le registre des déports.

**R18. Sujets et attention par période** (vue « De quoi parle l'Assemblée », dans l'onglet Assemblée, avec un résumé sur l'accueil). **M**
- Pour la période choisie, la part de chacun des 29 thèmes selon quatre angles :
  1. **déposé** : propositions de loi des députés (par groupe) et projets de loi du gouvernement ;
  2. **inscrit** à l'ordre du jour, à partir d'`agenda.sqlite`. Les codes de nature des points (`ODJPR`, `ODJAN`, `ODJSN`) ne seront interprétés qu'une fois leur sens confirmé ;
  3. **débattu** : part du temps de parole en séance, déjà calculée ;
  4. **demandé au gouvernement** : questions écrites et questions au gouvernement, après l'étape 0.3.
- Vue principale : l'écart entre ce qui est déposé et ce qui est débattu, thème par thème.
- Forme :
  - barres horizontales triées par part, avec un repère pour la période précédente ;
  - paires de barres « déposé / débattu » ;
  - un anneau à 6 parts plus « autres », seulement pour l'accueil et les cartes de partage ;
  - pas de camembert à 29 parts : les parts sous 3 % y sont invisibles, et deux camemberts se comparent mal.
- Le budget (PLF, PLFSS) est montré à part, et on peut l'exclure.
- Un texte rattaché à plusieurs thèmes compte dans chacun ; la vue précise alors que les parts ne totalisent pas 100 %.
- Les thèmes des questions reposent sur la densité de mots-clés : précision mesurée à 91,9 % au lieu de 100 % pour le rattachement par le texte débattu. La page Méthode le dira.
- Données : thèmes et rattachements (existants), dossiers (0.4), agenda (0.2), questions (0.3). Les angles « déposé » et « débattu » peuvent sortir avant les deux autres.
- *Fait quand* : chaque part mène à la liste des textes ou des interventions qu'elle compte, et la méthode figure sur la page Méthode.

### Phase 3. Synthèses et mise en regard (S2 2027, après la présidentielle)

Prérequis : charte IA publiée (§ 7), comité de relecture constitué, échantillons de vérification prêts.

**R12. Parole face aux votes, étendue.** **L**
- Annonces confrontées aux votes sur des articles et des amendements ; affirmations sur des votes (« vous avez voté contre… ») mises en regard du scrutin. Seuil de 90 %.

**R5. Contexte et enjeux d'un texte.** **L**
- Bloc « Contexte » de la fiche texte. Conditions de lancement du § 5.4.

**R7. Synthèse de l'activité d'un député.** **M** (R7a), **L** (R7b)
- R7a d'abord. R7b seulement si R7a ne suffit pas et si l'audit est concluant.

**R17. Éclairages sourcés, sans verdict.** **L**, travail éditorial continu
- Bloc « Éclairages » sous l'intervention concernée, et sur la fiche texte.
- D'abord un pilote d'une dizaine de cas, aux conditions du § 5.4. La sélection n'est pas automatisée.
- *Fait quand* : la règle de sélection, la hiérarchie des sources, le panel de médias avec ses critères et le compteur par groupe sont publiés sur la page Méthode ; chaque éclairage a été relu par le comité et proposé en droit de réponse.

### Backlog ⏸

| # | Cas | Condition pour le reprendre |
| --- | --- | --- |
| 7 | Export calendrier (ICS) | Demande des journalistes après R3 |
| 10 | Pétitions et consultations liées | Après R3, si les données des pétitions sont exploitables |
| 15 | Avant / après des articles de code | Après R2, en s'appuyant sur les versions consolidées de Légifrance |
| 20 | Position du Sénat | Après R1 ; intégration de data.senat.fr |
| 22 | Version FALC ou audio | Partenaire spécialisé pour la relecture |
| 33 | Réseau des cosignatures | Après R6 |
| 37 | Bilan PDF par député | Décision hors période électorale |
| 38 | « Écrire à mon député » | Protection anti-abus éprouvée |
| 45 | Amendements identiques entre groupes | Après R10 ; strictement factuel |
| 47 | Coalitions de vote par texte | Après R1 |
| 61 | « Quel député vote comme moi ? » | Méthode de choix des questions publiée et non éditoriale (par exemple tous les votes clés d'une période) |

---

## 7. Charte des fonctions rédigées par IA

S'applique à R5, R7b, à toute reformulation automatique et, pour R17, à toute aide automatique à la recherche de sources. Elle sera publiée sur la page Méthode avant le premier lancement.

1. **Corpus fermé** : seules les sources listées sont utilisées, sans web ouvert.
2. **Une source par phrase** : une phrase sans source n'est pas publiée.
3. **Vérification** : chaque phrase est comparée automatiquement au passage cité, puis relue par un humain avant la première publication ; un échantillon est relu à chaque mise à jour.
4. **Gabarit identique** pour tous les textes ou tous les députés : même structure, longueur comparable, ordre fixe.
5. **Vocabulaire** : liste publique d'adjectifs évaluatifs interdits ; on n'écrit « défend » ou « s'oppose » que s'il existe un vote ou une annonce citée.
6. **Attribution par origine** : Gouvernement, commission, auteurs, groupes.
7. **Mention visible** : « Rédigé automatiquement à partir de … le … », version, historique conservé.
8. **Évaluation publiée** : taux de phrases appuyées par leur source et résultat de l'audit pluraliste, sur la page Méthode, avant la mise en ligne.
9. **Calendrier** : pas de nouvelle fonction rédigée par IA dans les huit semaines qui précèdent un scrutin national.
10. **Génération figée** : modèle et paramètres consignés, texte généré une fois et mis en cache, jamais à la volée pour chaque visiteur (coût et reproductibilité).

---

## 8. Sources de données

| Source | Contenu | Statut | Sert à |
| --- | --- | --- | --- |
| Assemblée : comptes rendus (Syceron) | Débats en séance publique | ✅ utilisé | Tout |
| Assemblée : AMO | Députés, groupes, organes, mandats | ✅ utilisé | Tout |
| Assemblée : scrutins | Votes nominatifs, demandeur, délégations, mises au point | ✅ utilisé | R1, R8, R10, R12 |
| Assemblée : dossiers législatifs | Étapes, documents, auteurs | ✅ en partie | R1, R2, R6 |
| Assemblée : amendements | Auteur, sort, exposé sommaire | ⬜ à intégrer (0.1) | R6, R10, R16 |
| Assemblée : agenda (réunions) | Ordre du jour, réunions de commission, présences en commission | ✅ intégré (0.2) : `agenda.sqlite`, rafraîchi chaque jour | R3, R8 |
| Assemblée : questions écrites, au gouvernement, orales sans débat | Questions et réponses | ⬜ à intégrer (0.3) | R6, R9, R11 |
| Assemblée : XVIe législature | Débats, scrutins et dossiers 2022-2024 | ⬜ mémoire légère recommandée (§ 6.2) | R3 |
| Assemblée : registre des déports (dans AMO, dossier `deport/`) | Déports déclarés par les députés | ⬜ à intégrer | R15 |
| Légifrance (API PISTE, DILA) | JORF, textes consolidés, échéanciers d'application, décisions du Conseil constitutionnel | ⬜ à intégrer | R2, 15 |
| Sénat (data.senat.fr) | Dossiers et scrutins du Sénat | ⏸ | 20 |
| HATVP (open data) | Déclarations d'intérêts et d'activités | ⬜ liens | R15 |
| Vie-publique.fr (DILA) | Fiches explicatives | ⬜ liens ; conditions de réutilisation à vérifier | R5, R14 |
| Fact Check Tools (ClaimReview) | Vérifications publiées par des médias | ⏸ phase 3 | R17 |
| Rapports officiels thématiques (rapport au Parlement sur les exportations d'armement, Cour des comptes, expertises collectives…) | Sources primaires et synthèses pour les éclairages | ⬜ au cas par cas | R17 |
| Panel de médias (une dizaine, critères de qualité publiés) | Articles pour les éclairages | ⬜ à constituer avec le comité | R17 |
| Textes de définition officiels (Code de la défense, règlements européens…) | Définitions citées par l'alerte « termes différents » | ⬜ au cas par cas | R17 |

Les jeux de l'Assemblée sont sous Licence Ouverte ; leur présence a été vérifiée le 17 novembre 2026 sous
`https://data.assemblee-nationale.fr/static/openData/repository/17/`.

---

## 9. Mesurer le succès

Mesures côté serveur uniquement, sans traceur, dans l'esprit des `campaign_visits` existantes.

| Objectif | Mesure |
| --- | --- |
| Compréhension | Fiches textes consultées par semaine ; part des visites de l'agenda qui ouvrent une fiche texte |
| Contrôle | Suivis de textes et de thèmes créés ; alertes envoyées ; désabonnements |
| Qualité | Signalements d'erreur pour 1 000 vues ; délai de correction (cible : moins de 48 heures) ; précision de chaque mesure sur son échantillon |
| Confiance | Droits de réponse reçus et traités ; aucune contestation publique laissée sans réponse ; répartition des éclairages sourcés par groupe, comparée au temps de parole |
| Réutilisation | Téléchargements d'exports ; reprises dans la presse |

---

## 10. Décisions à prendre

1. **Quota** : les fiches textes et l'agenda comptent-ils dans les 10 analyses gratuites ? Recommandation : non, ce sont des pages publiques, indexables et partageables.
2. **XVIe législature** : valider la mémoire légère recommandée par le spike 0.6 (§ 6.2), plutôt qu'une intégration complète qui doublerait la base.
3. **IA de la phase 3** : fournisseur, budget, hébergement.
4. **Comité de relecture pluraliste** : qui, combien, à quel rythme ?
5. **Période électorale** : faut-il geler les nouveautés avant la présidentielle, et pendant combien de temps ?
6. **Sénat** : à quelle phase ?
7. **Noms** : onglet « Textes » ; « Comment le texte a été débattu » pour R10 ; « De quoi parle l'Assemblée » pour R18.
8. **Éclairages sourcés (R17)** : quelle règle de sélection (affirmations contestées en séance, déjà traitées par un média de vérification, autre) ? Avec quel partenaire éditorial ? Quels médias dans le panel, et faut-il lier des faits sur chacun (propriétaire, charte) ?
9. **Forme de R18 sur l'accueil** : anneau à 6 parts ou barres ?

---

## 11. Historique

| Date | Changement |
| --- | --- |
| 2026-11-17 | Création : double diamant, 61 cas d'usage, 16 retenus, phases 0 à 3. |
| 2026-11-17 | Spikes 0.5 (présence en commission : feu vert) et 0.6 (XVIe législature : mémoire légère) ; constats sur l'agenda et le registre des déports (§ 6.1 à 6.3). |
| 2026-11-17 | 0.2 fait : `agenda.sqlite` et son rafraîchissement quotidien. |
| 2026-11-17 | Ajouts après discussion : éclairages sourcés sans verdict (R17, 🟠, phase 3), qui remplacent le fact-checking ; sujets et attention par période (R18, 🟢, phase 2). 63 cas d'usage, 18 retenus. |
| 2026-11-17 | R17 précisé : panel de médias de toutes sensibilités, fixé à l'avance sur des critères de qualité, sans étiquette gauche ou droite ; alerte « termes différents » rédigée comme un constat, avec la définition officielle quand elle existe. |
