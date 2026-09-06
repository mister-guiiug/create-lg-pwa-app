/**
 * Le cœur PUR du générateur : ce qui se teste sans réseau, sans `git` et sans
 * `gh`.
 *
 * Tout ce qui touche au monde extérieur — téléchargement, dépôt, Pages — vit
 * dans `create-lg-pwa-app.mjs`. Cette séparation n'est pas décorative : la
 * substitution d'identité est la seule partie qui peut casser en silence, et
 * c'est donc la seule qu'il faut pouvoir éprouver à chaque commit.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Le squelette dont tout part. */
export const SQUELETTE = 'pwa-starter-kit';

/** Son nom affiché, à remplacer lui aussi. */
export const SQUELETTE_TITRE = 'PWA Starter Kit';

/** Ce qu'on ne réécrit jamais : ni binaire, ni verrou, ni historique. */
const BINAIRE =
  /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf|riv|pdf|zip|tgz|wasm|mp3|ogg|mp4|webm)$/i;
const IGNORE = new Set(['node_modules', '.git', 'dist', 'coverage']);

/**
 * Un identifiant d'application valable.
 *
 * La convention de la famille est `miss-*` / `mister-*`, et c'est elle qui
 * fait que `FamilyApps` et le catalogue s'y retrouvent. On ne l'IMPOSE pas —
 * un outil interne peut légitimement s'appeler autrement — mais on la signale,
 * parce qu'un nom hors convention se remarque des mois plus tard.
 */
export function validerId(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    return {
      ok: false,
      raison:
        'un identifiant de dépôt ne contient que des minuscules, des chiffres et des tirets, et commence par une lettre',
    };
  }
  if (id === SQUELETTE) {
    return { ok: false, raison: 'c’est le nom du squelette lui-même' };
  }
  return {
    ok: true,
    horsConvention: !/^(miss|mister)-/.test(id),
  };
}

/**
 * La référence du squelette à tirer.
 *
 * DEMANDÉE, SINON LA DERNIÈRE ÉTIQUETTE, SINON `main`. Deux naissances à une
 * semaine d'écart partaient de deux squelettes différents sans que rien ne le
 * dise autrement que par un SHA dans le premier commit. Une étiquette est une
 * version qu'on peut nommer, reproduire, et dont on sait ce qu'elle contient ;
 * `main` reste possible par `--from main`, pour qui veut la pointe.
 *
 * @param {string | null | undefined} demande  `--from`, s'il est donné.
 * @param {Array<string | { name?: string }>} etiquettes  Celles du dépôt, dans
 *   n'importe quel ordre — l'API ne promet rien sur le leur.
 * @returns {{ ref: string, origine: 'demandée' | 'étiquette' | 'défaut' }}
 */
export function choisirRef(demande, etiquettes = []) {
  if (demande) return { ref: demande, origine: 'demandée' };
  const versions = etiquettes
    .map(t => (typeof t === 'string' ? t : t?.name))
    .map(nom => {
      const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nom ?? '');
      return m
        ? { nom, cle: [Number(m[1]), Number(m[2]), Number(m[3])] }
        : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.cle[0] - a.cle[0] || b.cle[1] - a.cle[1] || b.cle[2] - a.cle[2]
    );
  return versions.length
    ? { ref: versions[0].nom, origine: 'étiquette' }
    : { ref: 'main', origine: 'défaut' };
}

/**
 * Le nom affiché, déduit de l'identifiant : `miss-exemple` → `Miss Exemple`.
 * Déductible ne veut pas dire imposé — l'option `--nom` le remplace.
 */
export function titreDepuisId(id) {
  return id
    .split('-')
    .map(mot => mot.charAt(0).toUpperCase() + mot.slice(1))
    .join(' ');
}

/** Les fichiers texte d'une arborescence, chemins relatifs. */
export function fichiersTexte(racine) {
  const out = [];
  const visiter = abs => {
    for (const entree of readdirSync(abs, { withFileTypes: true })) {
      if (IGNORE.has(entree.name)) continue;
      const chemin = join(abs, entree.name);
      if (entree.isDirectory()) visiter(chemin);
      else if (!BINAIRE.test(entree.name)) {
        out.push(relative(racine, chemin).split(sep).join('/'));
      }
    }
  };
  visiter(racine);
  return out;
}

/**
 * Substitue l'identité du squelette par celle de la nouvelle application.
 *
 * DEUX REMPLACEMENTS, PAS UN. L'identifiant technique (`pwa-starter-kit`) et le
 * nom affiché (`PWA Starter Kit`) sont deux chaînes distinctes : n'en traiter
 * qu'une laisse une application qui s'appelle correctement dans son URL et
 * « PWA Starter Kit » dans son onglet.
 *
 * @returns {{ fichiers: string[], restes: string[] }} les fichiers réécrits, et
 *   ceux où le nom du squelette subsiste — qui doivent être vides.
 */
export function substituer(racine, { id, titre, description }) {
  const fichiers = [];
  for (const rel of fichiersTexte(racine)) {
    const abs = join(racine, rel);
    const avant = readFileSync(abs, 'utf8');
    let apres = avant.split(SQUELETTE).join(id);
    apres = apres.split(SQUELETTE_TITRE).join(titre);
    if (rel === 'package.json') apres = reecrirePaquet(apres, { description });
    if (apres !== avant) {
      writeFileSync(abs, apres);
      fichiers.push(rel);
    }
  }

  const restes = fichiersTexte(racine).filter(rel =>
    readFileSync(join(racine, rel), 'utf8').includes(SQUELETTE)
  );
  return { fichiers, restes };
}

/**
 * Le `package.json` de la nouvelle application : version remise à zéro, et la
 * description du squelette remplacée — sans quoi chaque application naîtrait en
 * se décrivant comme « le squelette de la famille ».
 */
function reecrirePaquet(json, { description }) {
  const paquet = JSON.parse(json);
  paquet.version = '0.1.0';
  if (description) paquet.description = description;
  return JSON.stringify(paquet, null, 2) + '\n';
}

/**
 * Le README de la nouvelle application.
 *
 * Celui du squelette EXPLIQUE LE SQUELETTE : le garder ferait naître chaque
 * application avec une page qui parle d'autre chose, et personne ne la
 * réécrirait — c'est ainsi qu'on trouve des README de gabarit en production.
 * Les décisions (`docs/adr/`), elles, sont conservées : elles s'appliquent bien
 * à la nouvelle application.
 */
export function readme({ id, titre, description }) {
  return `# ${id}

${description}

Application PWA de la famille \`miss-*\` / \`mister-*\`, née du squelette
[\`pwa-starter-kit\`](https://github.com/mister-guiiug/pwa-starter-kit) et bâtie
sur [\`@mister-guiiug/dev-pwa-config\`](https://github.com/mister-guiiug/dev-pwa-config).

## Démarrer

\`\`\`bash
npm install
\`\`\`

\`\`\`bash
npm run dev
\`\`\`

L'installation lit le socle sur GitHub Packages : exporter \`NODE_AUTH_TOKEN\`
(un jeton avec \`read:packages\`) avant \`npm install\`.

**L'application démarre sans configuration**, sur son stockage local. C'est une
propriété à conserver : elle rend possibles le hors-ligne, les tests sans
secrets, et la page publique qu'on ouvre sans compte.

## Vérifier

\`\`\`bash
npm run build
\`\`\`

Le build enchaîne \`tsc -b\`, Vite, le budget de poids et \`pwa-doctor --strict\` :
il échoue à la moindre dette de conformité au parc.

## Ce qui reste à faire

1. remplacer \`public/favicon.svg\`, puis \`npm run icons\` ;
2. régénérer les captures du manifeste : \`npm run screenshots\` ;
3. écrire le métier dans \`src/features/\`, et **supprimer \`src/features/home/\`**,
   la fonctionnalité d'exemple — elle est là pour ça ;
4. ajuster la palette dans \`src/index.css\` et les couleurs de \`vite.config.ts\` ;
5. si l'application a un backend : poser \`VITE_SUPABASE_URL\` et
   \`VITE_SUPABASE_ANON_KEY\` en **variables** du dépôt, et appliquer
   \`supabase/\` — sinon supprimer ce dossier et les deux workflows Supabase.

## Les décisions

Héritées du squelette et valables ici : [\`docs/adr/\`](./docs/adr/README.md).
Une application qui s'en écarte le fait, et l'écrit.

## Licence

MIT — voir [LICENSE](./LICENSE).
`;
}
