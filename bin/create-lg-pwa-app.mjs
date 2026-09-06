#!/usr/bin/env node
/**
 * create-lg-pwa-app — une application de la famille, en une commande.
 *
 *   npx github:mister-guiiug/create-lg-pwa-app miss-exemple
 *   npx github:mister-guiiug/create-lg-pwa-app miss-exemple --publish
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
 * Pages activées par un PUT et non un POST, le premier commit conventionnel.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  SQUELETTE,
  choisirRef,
  readme,
  substituer,
  titreDepuisId,
  validerId,
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

  npx github:mister-guiiug/create-lg-pwa-app <id> [options]

  <id>              nom du dépôt : miss-exemple, mister-exemple

  --nom "<titre>"   nom affiché (défaut : déduit de l'id)
  --description "…" description du paquet et du manifeste
  --from <ref>      branche ou étiquette du squelette (défaut : sa dernière étiquette, sinon main)
  --dir <chemin>    dossier de sortie (défaut : ./<id>)
  --publish         crée le dépôt GitHub, pousse, active Pages (exige gh)
  --no-install      n'installe pas les dépendances
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
const description =
  option('description') ?? `${titre} — application PWA de la famille.`;
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
  const { fichiers, restes } = substituer(cible, { id, titre, description });
  if (restes.length) {
    throw new Error(`le nom du squelette subsiste dans : ${restes.join(', ')}`);
  }
  writeFileSync(join(cible, 'README.md'), readme({ id, titre, description }));
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

    // PAGES : UN PUT, JAMAIS UN POST. La création par POST rend bien
    // `build_type: workflow`, mais GitHub garde `source: {branch, path}` et le
    // constructeur Jekyll reprend la main à chaque poussée — il republie le
    // README rendu à la place de l'application. Le symptôme est un `<title>`
    // qui vaut le nom du dépôt.
    console.log('· Pages en mode workflow');
    execFileSync(
      'gh',
      [
        'api',
        '-X',
        'PUT',
        `repos/mister-guiiug/${id}/pages`,
        '-f',
        'build_type=workflow',
      ],
      { stdio: 'ignore' }
    );
  }
} finally {
  rmSync(travail, { recursive: true, force: true });
}

console.log(`
✔ ${cible}

Ce qui reste, et que ce générateur ne fait pas :

  1. protéger la branche — depuis le socle :
       node scripts/apply-rulesets.mjs ${id}
     (il lit le compte, ce dépôt y est déjà)
  2. inscrire l'application dans apps-catalog.js du socle, par une PR,
     sans quoi elle n'apparaît pas chez ses sœurs
  3. remplacer public/favicon.svg puis : npm run icons
  4. supprimer src/features/home/ — la fonctionnalité d'exemple

Aucun secret n'a été posé, et c'est délibéré : un générateur qui écrit des
secrets est un générateur qui les connaît.
`);
