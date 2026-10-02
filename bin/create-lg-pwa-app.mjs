#!/usr/bin/env node
/**
 * create-lg-pwa-app — une application de la famille, en une commande.
 *
 *   npx --allow-git=root github:mister-guiiug/create-lg-pwa-app miss-exemple
 *   npx --allow-git=root github:mister-guiiug/create-lg-pwa-app miss-exemple --publish
 *
 * `--allow-git=root` AVANT LE PAQUET. Depuis npm 12, `allow-git` vaut `none`
 * par défaut, et `npx github:` échoue en EALLOWGIT. `root` n'ouvre que le
 * paquet nommé, ce générateur sans dépendance ; npm 10 et 11 l'acceptent sans
 * rien changer. Placée après le paquet, l'option irait au générateur.
 *
 * POURQUOI `npx github:` ET PAS UN PAQUET PUBLIÉ. Le socle vit sur GitHub
 * Packages, qui exige un jeton **même pour un paquet public** : un
 * `npx create-lg-pwa-app` ne résoudrait rien sur un poste vierge. Tiré depuis
 * GitHub, ce générateur n'a aucune dépendance et ne touche aucun registre — il
 * marche avant que le moindre `.npmrc` n'existe.
 *
 * CE GÉNÉRATEUR NE CONTIENT AUCUN GABARIT, et c'est sa propriété principale.
 * Il tire `pwa-starter-kit`, qui est un dépôt vivant, testé et déployé. Un
 * générateur qui embarque ses gabarits est un troisième endroit où la même
 * chose vieillit — après la bibliothèque et le squelette.
 *
 * SA VALEUR EST DU CÔTÉ GITHUB. Substituer un nom prend dix lignes ; ce que
 * personne n'avait automatisé, et qui coûtait une demi-journée avec ses pièges,
 * ce sont les gestes d'après : le lockfile écrit par la bonne version de npm,
 * Pages créées puis passées en workflow par un PUT, le premier commit
 * conventionnel.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SQUELETTE,
  activerPages,
  ceQueLAccueilGarde,
  choisirPort,
  choisirRef,
  controlerTextes,
  descriptionParDefaut,
  launchJson,
  lireReponseGh,
  readme,
  remplacerPort,
  substituer,
  titreDePageParDefaut,
  titreDepuisId,
  validerId,
  validerNom,
} from './scaffold.mjs';

const DEPOT_SQUELETTE = `mister-guiiug/${SQUELETTE}`;

const args = process.argv.slice(2);
const id = args.find(a => !a.startsWith('-'));
const option = nom => {
  const i = args.indexOf(`--${nom}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const drapeau = nom => args.includes(`--${nom}`);

if (!id || drapeau('help')) {
  console.log(`
create-lg-pwa-app — une application de la famille, en une commande.

  npx --allow-git=root github:mister-guiiug/create-lg-pwa-app <id> [options]

  <id>              nom du dépôt : miss-exemple, mister-exemple

  --nom "<nom>"     nom affiché (défaut : déduit de l'id) : lettres, chiffres,
                    espaces, - . et l'apostrophe typographique ’
  --titre "…"       titre de la page, 50 caractères au moins : <title>, og:title
  --description "…" ce que fait l'app, 70 à 160 caractères : paquet, meta description, accroche (app.tagline), manifeste
  --from <ref>      branche ou étiquette du squelette (défaut : sa dernière étiquette, sinon main)
  --dir <chemin>    dossier de sortie (défaut : ./<id>)
  --publish         crée le dépôt GitHub, pousse, active Pages (exige gh)
  --no-install      n'installe pas les dépendances (donc ne construit pas)
  --no-build        installe mais ne construit pas
`);
  process.exit(id ? 0 : 1);
}

const verdict = validerId(id);
if (!verdict.ok) {
  console.error(`✖ « ${id} » : ${verdict.raison}`);
  process.exit(1);
}
if (verdict.horsConvention) {
  console.warn(
    `⚠ « ${id} » ne suit pas la convention miss-* / mister-* : le catalogue et FamilyApps s'y attendent.`
  );
}

const titre = option('nom') ?? titreDepuisId(id);
// LE NOM AFFICHÉ EST RECOPIÉ TEL QUEL dans du TypeScript, du HTML, du XML et
// du Markdown : un caractère qu'une de ces syntaxes interprète ferait naître
// une application illisible. Refusé ici, avant que rien ne soit écrit.
const verdictNom = validerNom(titre);
if (!verdictNom.ok) {
  const origine =
    option('nom') === undefined ? `nom déduit de « ${id} »` : '--nom';
  console.error(`✖ ${origine} « ${titre} » : ${verdictNom.raison}`);
  if (verdictNom.suggestion) {
    console.error(`  proposé : --nom "${verdictNom.suggestion}"`);
  }
  process.exit(1);
}
const description = option('description') ?? descriptionParDefaut(titre);
const titrePage = option('titre') ?? titreDePageParDefaut(titre);

// AVANT TOUT TÉLÉCHARGEMENT : ce que `pwa-doctor --strict` refuserait à la
// construction de l'application est refusé ici, quand rien n'est encore écrit.
const controle = controlerTextes({ titrePage, description });
for (const avertissement of controle.avertissements) {
  console.warn(`⚠ ${avertissement}`);
}
if (controle.refus.length) {
  for (const refus of controle.refus) console.error(`✖ ${refus}`);
  process.exit(1);
}
/**
 * Les étiquettes du squelette, ou rien : hors ligne, ou API indisponible, on
 * retombe sur `main` en le disant — une naissance ne doit pas dépendre d'un
 * quota d'API.
 */
async function etiquettesDuSquelette() {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${DEPOT_SQUELETTE}/tags?per_page=100`,
      { headers: { accept: 'application/vnd.github+json' } }
    );
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

const { ref, origine } = choisirRef(
  option('from'),
  await etiquettesDuSquelette()
);
const cible = resolve(option('dir') ?? id);

if (existsSync(cible)) {
  console.error(`✖ ${cible} existe déjà.`);
  process.exit(1);
}

/** Une commande, sans shell — la ligne de commande n'est pas un transport. */
function run(exe, argv, options = {}) {
  const r = spawnSync(exe, argv, { stdio: 'inherit', ...options });
  if (r.error || r.status !== 0) {
    throw new Error(
      `${exe} ${argv.join(' ')} → ${r.status ?? r.error?.message}`
    );
  }
}
const dispo = exe =>
  spawnSync(exe, ['--version'], { stdio: 'ignore' }).status === 0;

/**
 * Un appel à l'API GitHub, par `gh`, qui en porte l'authentification. `-i`
 * fait précéder le corps de la ligne de statut : c'est elle que lit
 * `activerPages`, pas le code de sortie de `gh`.
 */
function ghApi(methode, chemin, champs = {}) {
  const r = spawnSync(
    'gh',
    [
      'api',
      '-i',
      '-X',
      methode,
      chemin,
      ...Object.entries(champs).flatMap(([cle, valeur]) => [
        '-f',
        `${cle}=${valeur}`,
      ]),
    ],
    { encoding: 'utf8' }
  );
  const reponse = lireReponseGh(r.stdout ?? '');
  if (!reponse.statut) {
    throw new Error(
      `gh api -X ${methode} ${chemin} → ${r.error?.message ?? r.stderr?.trim()}`
    );
  }
  return reponse;
}

const provenance = {
  demandée: '--from',
  étiquette: 'sa dernière étiquette',
  défaut: 'aucune étiquette publiée : la pointe de main',
}[origine];
console.log(
  `\n▶ ${titre} (${id}) — depuis ${DEPOT_SQUELETTE}@${ref} (${provenance})\n`
);

// ── 1. Le squelette ────────────────────────────────────────────────────────
//
// Archive HTTPS plutôt qu'un `git clone` : l'historique du squelette n'a rien à
// faire dans une application neuve, et le premier commit doit être le sien.
const travail = mkdtempSync(join(tmpdir(), 'lg-pwa-'));
const archive = join(travail, 'squelette.tar.gz');
// Connus en cours de route, cités dans le message final : déclarés HORS du
// bloc — la première CI qui a construit l'application l'a payé d'un
// « port is not defined » à la dernière ligne.
let port = null;
let aTraduire = [];
let accueil = ceQueLAccueilGarde();
try {
  console.log('· téléchargement du squelette');
  const url = `https://codeload.github.com/${DEPOT_SQUELETTE}/tar.gz/${ref}`;
  const reponse = await fetch(url);
  if (!reponse.ok) {
    throw new Error(`${url} → HTTP ${reponse.status}`);
  }
  writeFileSync(archive, Buffer.from(await reponse.arrayBuffer()));

  // `tar` est présent sur Windows 10+, macOS et Linux. Node n'en a pas.
  //
  // LE CHEMIN EST RELATIF, ET LE DOSSIER PASSE PAR `cwd`. Un chemin Windows
  // absolu contient un deux-points, et GNU tar y lit une machine distante :
  // « Cannot connect to C: resolve failed ». `--force-local` réglerait le cas
  // de GNU tar, mais pas celui de bsdtar, livré avec Windows 10, qui ne connaît
  // pas cette option. Ne pas écrire de deux-points règle les deux.
  run('tar', ['-xzf', 'squelette.tar.gz'], { cwd: travail });
  // LE NOM DU DOSSIER EXTRAIT N'EST PAS CELUI DE LA RÉFÉRENCE. Pour une
  // branche, GitHub écrit `pwa-starter-kit-main` ; pour une étiquette `v1.0.0`,
  // il RETIRE le `v` : `pwa-starter-kit-1.0.0`. Le calculer serait parier sur
  // cette règle ; on lit le seul dossier que l'archive contient.
  const dossier = readdirSync(travail, { withFileTypes: true }).find(
    e => e.isDirectory() && e.name.startsWith(`${SQUELETTE}-`)
  );
  if (!dossier) {
    throw new Error(
      `archive inattendue : aucun dossier ${SQUELETTE}-* après extraction`
    );
  }
  const extrait = join(travail, dossier.name);
  // COPIE, PAS DÉPLACEMENT. Le dossier temporaire du système et la cible
  // peuvent vivre sur deux disques différents — cas ordinaire sous Windows,
  // où `%TEMP%` est sur `C:` et les dépôts souvent ailleurs. `rename` y échoue
  // en `EXDEV: cross-device link not permitted`.
  cpSync(extrait, cible, { recursive: true });

  // ── 2. L'identité ────────────────────────────────────────────────────────
  console.log('· substitution de l’identité');
  const { fichiers, restes, descriptions, titres } = substituer(cible, {
    id,
    titre,
    description,
    titrePage,
  });
  if (restes.length) {
    throw new Error(`le nom du squelette subsiste dans : ${restes.join(', ')}`);
  }
  // LA DESCRIPTION DU SQUELETTE NE SURVIT NULLE PART, au même titre que son
  // nom : c'est la première ligne de l'accueil et ce que lisent les moteurs.
  // Si le squelette la recopie un jour dans un fichier de plus, la naissance
  // échoue ici — plutôt qu'une application qui se présente comme lui.
  if (descriptions.restes.length) {
    throw new Error(
      `la description du squelette subsiste dans : ${descriptions.restes.join(', ')}`
    );
  }
  // Une place introuvable n'arrête rien : le squelette a pu retirer la phrase
  // à dessein. Mais il a pu aussi la déplacer, et le générateur ne la verrait
  // plus — cela se dit.
  for (const place of descriptions.manquantes) {
    console.warn(
      `⚠ description non posée — ${place} introuvable : le squelette a-t-il déplacé ce texte ?`
    );
  }
  // LE TITRE DE LA PAGE, DE MÊME : le socle le sert en h1 aux robots. Que le
  // squelette s'y présente encore ailleurs, et la naissance échoue.
  if (titres.restes.length) {
    throw new Error(
      `le titre de page du squelette subsiste dans : ${titres.restes.join(', ')}`
    );
  }
  for (const place of titres.manquantes) {
    console.warn(
      `⚠ titre de la page non posé : ${place} introuvable, le squelette a-t-il déplacé ce texte ?`
    );
  }
  aTraduire = descriptions.aTraduire;
  // Ce que l'accueil garde quand l'exemple part se LIT dans l'écran engendré :
  // l'accroche et le pied de page n'y sont que depuis pwa-starter-kit#67.
  const ecranAccueil = join(cible, 'src/features/home/HomeScreen.tsx');
  accueil = ceQueLAccueilGarde(
    existsSync(ecranAccueil) ? readFileSync(ecranAccueil, 'utf8') : ''
  );
  writeFileSync(
    join(cible, 'README.md'),
    readme({ id, titre, description, accueil })
  );
  console.log(`  ${fichiers.length} fichier(s) réécrit(s)`);

  // ── 3. Les dépendances ───────────────────────────────────────────────────
  //
  // NPM 10, PAS CELUI DU POSTE. Le job « Lockfile in sync » de la CI rejoue
  // `npm install --package-lock-only` sur Linux avec la version du runner et
  // exige zéro diff. Un lockfile écrit par npm 11 porte en plus un champ
  // `libc` que npm 10 retire : CI rouge au premier push, avec un message qui
  // parle de bindings natifs. C'est le piège le plus coûteux de la naissance
  // d'une application, et il n'a rien d'évident.
  if (!drapeau('no-install')) {
    console.log('· npm install (npm 10, la version du runner)');
    run('npx', ['--yes', 'npm@10.9.8', 'install', '--no-audit', '--no-fund'], {
      cwd: cible,
      shell: process.platform === 'win32',
    });

    // ── 3 bis. Le port de développement ──────────────────────────────────
    //
    // UNIQUE DANS LA FAMILLE. Presque toutes les apps démarraient sur le 5173
    // de Vite et se disputaient le port dès que deux tournaient côte à côte.
    // Le catalogue du socle installé sait rendre le prochain libre ; le
    // `launch.json` de l'éditeur le porte, et `vite.config.ts` aussi quand le
    // squelette lit `devPortOf`. L'inscription au catalogue le figera.
    const catalogue = await import(
      pathToFileURL(
        join(
          cible,
          'node_modules/@mister-guiiug/dev-pwa-config/apps-catalog.js'
        )
      ).href
    ).catch(() => null);
    const choix = choisirPort(catalogue);
    port = choix.port;
    mkdirSync(join(cible, '.claude'), { recursive: true });
    writeFileSync(join(cible, '.claude/launch.json'), launchJson(id, port));
    const viteConfig = join(cible, 'vite.config.ts');
    if (existsSync(viteConfig)) {
      writeFileSync(
        viteConfig,
        remplacerPort(readFileSync(viteConfig, 'utf8'), port)
      );
    }
    console.log(
      `· port de développement ${port} (${choix.origine === 'catalogue' ? 'le prochain libre du catalogue' : 'le socle installé ne connaît pas encore les ports'})`
    );

    // ── 3 ter. Construire ce qu'on engendre ──────────────────────────────
    //
    // Jusqu'ici, la preuve « une app engendrée passe doctor --strict » était
    // celle du squelette, à sa révision du moment. Ici c'est CETTE application,
    // avec son nom substitué, qui doit passer le budget de poids et le docteur
    // — avant d'être publiée, jamais après.
    if (!drapeau('no-build')) {
      console.log('· npm run build (budget de poids, pwa-doctor --strict)');
      run('npm', ['run', 'build'], {
        cwd: cible,
        shell: process.platform === 'win32',
      });
    }
  }

  // ── 4. Le premier commit ─────────────────────────────────────────────────
  //
  // LE COMMIT EST UN CONFORT, PAS LE LIVRABLE. Une machine neuve — ou un
  // runner de CI — n'a pas forcément d'identité git configurée, et `git
  // commit` y échoue en « empty ident name ». Perdre une génération réussie
  // pour cela serait absurde : on prévient, et on rend la main.
  let commitFait = false;
  if (dispo('git')) {
    try {
      console.log('· dépôt git et premier commit');
      run('git', ['init', '-q', '-b', 'main'], { cwd: cible });
      run('git', ['add', '-A'], { cwd: cible });
      run(
        'git',
        [
          'commit',
          '-q',
          '-m',
          `feat: ${titre}, depuis le squelette de la famille`,
          '-m',
          `Né de ${DEPOT_SQUELETTE}@${ref} : la composition, les décisions (docs/adr/) et la conformité au parc viennent avec. Reste le métier.`,
        ],
        { cwd: cible }
      );
      commitFait = true;
    } catch (cause) {
      console.warn(
        `⚠ premier commit impossible (${cause.message.split('\n')[0]}).\n` +
          '  L’application est complète ; configurer git puis committer à la main.'
      );
    }
  }

  // ── 5. GitHub ────────────────────────────────────────────────────────────
  if (drapeau('publish')) {
    if (!dispo('gh')) throw new Error('--publish exige la commande gh');
    if (!commitFait) {
      throw new Error(
        '--publish exige un premier commit : configurer git (user.name, user.email) et relancer'
      );
    }
    console.log('· création du dépôt et poussée');
    run(
      'gh',
      [
        'repo',
        'create',
        `mister-guiiug/${id}`,
        '--public',
        '--source=.',
        '--remote=origin',
        '--push',
        '--description',
        description,
      ],
      { cwd: cible }
    );

    // PAGES : CRÉÉES S'IL LE FAUT, PASSÉES EN WORKFLOW PAR UN PUT, RELUES. Le
    // PUT seul rend 404 sur un dépôt neuf, le POST seul laisse Jekyll
    // republier le README : `activerPages` dit pourquoi les deux, dans cet
    // ordre.
    console.log('· Pages en mode workflow');
    activerPages(ghApi, `mister-guiiug/${id}`);

    // L'adresse est connue avant le premier déploiement : elle va sur la
    // fiche du dépôt, avec les deux sujets qui rangent l'application dans la
    // famille. Un échec ici n'annule pas une naissance réussie.
    console.log('· fiche du dépôt : homepage et sujets');
    try {
      run(
        'gh',
        [
          'repo',
          'edit',
          `mister-guiiug/${id}`,
          '--homepage',
          `https://mister-guiiug.github.io/${id}/`,
          '--add-topic',
          'pwa',
          '--add-topic',
          'mister-guiiug',
        ],
        { stdio: 'ignore' }
      );
    } catch (cause) {
      console.warn(
        `⚠ fiche du dépôt non renseignée (${cause.message.split('\n')[0]}) — gh repo edit à la main.`
      );
    }
  }
} finally {
  rmSync(travail, { recursive: true, force: true });
}

// Les textes par défaut passent les règles du parc, mais ne disent rien de
// l'application : le message final le rappelle.
const generiques = {
  titre: 'le titre par défaut est vrai mais générique',
  description: 'la description par défaut est vraie mais générique',
  'titre description':
    'le titre et la description par défaut sont vrais mais génériques',
}[
  [!option('titre') && 'titre', !option('description') && 'description']
    .filter(Boolean)
    .join(' ')
];

console.log(`
✔ ${cible}${port ? `  (port de développement : ${port})` : ''}

Ce qui reste, et que ce générateur ne fait pas :

  1. protéger la branche — depuis le socle :
       node scripts/apply-rulesets.mjs ${id}
     (il lit le compte, ce dépôt y est déjà)
  2. inscrire l'application dans apps-catalog.js du socle, par une PR,
     sans quoi elle n'apparaît pas chez ses sœurs${port ? ` — avec devPort: ${port}` : ''}
  3. remplacer public/favicon.svg puis : npm run icons
  4. ${
    accueil.accroche || accueil.piedDePage
      ? `remplacer l'exemple de src/features/home/, en gardant sur l'accueil\n     ${[
          accueil.accroche && "l'accroche (app.tagline)",
          accueil.piedDePage && 'le pied de page',
        ]
          .filter(Boolean)
          .join(' et ')} — le README dit pourquoi`
      : "supprimer src/features/home/ — la fonctionnalité d'exemple"
  }
  5. relire le titre de la page et la description : index.html (<title>,
     og:title, meta) et src/i18n/messages.ts (app.tagline, about.what)${
       generiques
         ? `\n     ; ${generiques} : y dire ce que fait l'application`
         : ''
     }${
       aTraduire.length
         ? `\n     — l'anglais porte le texte français, marqué « TODO traduire »`
         : ''
     }

Si l'application prend un projet Supabase, et seulement alors — chaque
pièce manque en silence (PARAMETRAGE.md du socle) :

  · VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY en VARIABLES du dépôt
    (gh variable set), SUPABASE_PROJECT_ID aussi ;
  · SUPABASE_ACCESS_TOKEN et SUPABASE_DB_PASSWORD en secrets, par le
    propriétaire ;
  · la table keep_alive (supabase/keep-alive.sql), sinon le ping répond 404
    et le projet Free s'endort au 7ᵉ jour ;
  · côté projet : site_url et la liste d'URL de retour (localhost:3000 seul
    à la création), et le hook « Custom Access Token » pour les rôles.

Aucun secret n'a été posé, et c'est délibéré : un générateur qui écrit des
secrets est un générateur qui les connaît.
`);
