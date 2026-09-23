// Le cœur du générateur, éprouvé sans réseau ni GitHub.
//
// Ce qui est testé ici est ce qui peut casser EN SILENCE : une substitution
// incomplète produit une application qui se construit, se déploie, et porte le
// nom du squelette dans son manifeste, son onglet et son URL de dépôt. Rien
// n'échoue ; on s'en aperçoit en production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as prettier from 'prettier';

import configPrettier from '../prettier.config.js';
import {
  A_TRADUIRE,
  PORT_SQUELETTE,
  SQUELETTE,
  SQUELETTE_TITRE,
  ceQueLAccueilGarde,
  choisirPort,
  choisirRef,
  fichiersTexte,
  launchJson,
  readme,
  realignerTableaux,
  remplacerPort,
  substituer,
  titreDepuisId,
  validerId,
} from '../bin/scaffold.mjs';

/**
 * Les phrases par lesquelles le faux squelette se décrit — de la même forme que
 * celles du vrai : une meta sur plusieurs lignes, un `tagline` coupé après sa
 * clé en français et d'une ligne en anglais, un `what` entre guillemets doubles
 * parce qu'il contient une apostrophe.
 */
const DIT_SQUELETTE = {
  meta: 'Squelette d’application PWA de la famille : la composition prête à cloner.',
  og: 'Le squelette d’application PWA de la famille miss-* / mister-*.',
  paquet: 'Squelette d’application PWA de la famille.',
  taglineFr:
    'Le squelette des applications PWA de la famille : navigation, langues, thème. Prêt à cloner.',
  whatFr:
    "Ce dépôt est le point de départ des applications de la famille. Il n'a pas de métier : il a le cadre.",
  taglineEn: 'The family skeleton, ready to clone.',
  whatEn:
    'This repository is the starting point for the family applications. It has no domain: it has the frame.',
};

/** Formaté comme Prettier le rend — le premier test le vérifie. */
const INDEX_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <!--
      Une balise en commentaire n'est pas une balise :
      <meta name="description" content="à ne pas toucher" />
    -->
    <meta
      name="description"
      content="${DIT_SQUELETTE.meta}"
    />
    <title>${SQUELETTE_TITRE}</title>
    <meta property="og:title" content="${SQUELETTE_TITRE}" />
    <meta
      property="og:description"
      content="${DIT_SQUELETTE.og}"
    />
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;

const MESSAGES_TS = `/**
 * Un commentaire qui cite \`tagline: 'x'\` ne déclenche rien.
 */
const fr = {
  app: {
    name: '${SQUELETTE_TITRE}',
    tagline:
      '${DIT_SQUELETTE.taglineFr}',
  },
  home: {
    title: 'Notes',
  },
  about: {
    title: 'À propos',
    what: "${DIT_SQUELETTE.whatFr}",
  },
};

const en: typeof fr = {
  app: {
    name: '${SQUELETTE_TITRE}',
    tagline: '${DIT_SQUELETTE.taglineEn}',
  },
  home: {
    title: 'Notes',
  },
  about: {
    title: 'About',
    what: '${DIT_SQUELETTE.whatEn}',
  },
};

export const messages = { fr, en };
export type Messages = typeof fr;
`;

function ecrire(racine, rel, contenu) {
  const abs = join(racine, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contenu);
}

/** Un faux squelette, à l'image du vrai sur les points qui comptent. */
function squelette(fn) {
  const racine = mkdtempSync(join(tmpdir(), 'lg-pwa-test-'));
  const fichiers = {
    'package.json': JSON.stringify(
      {
        name: SQUELETTE,
        version: '0.1.0',
        description: DIT_SQUELETTE.paquet,
        scripts: { preview: `vite preview --base /${SQUELETTE}/` },
      },
      null,
      2
    ),
    'src/app/links.ts': `export const APP_ID = '${SQUELETTE}';`,
    'vite.config.ts': `const APP_ID = '${SQUELETTE}';`,
    'index.html': INDEX_HTML,
    'src/i18n/messages.ts': MESSAGES_TS,
    'docs/adr/0001-routeur.md': `# Décision\n\nValable pour ${SQUELETTE_TITRE}.`,
    'public/favicon.svg': '<svg />',
  };
  for (const [rel, contenu] of Object.entries(fichiers)) {
    ecrire(racine, rel, contenu);
  }
  try {
    return fn(racine);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
}

test('un identifiant se valide, et la convention se signale sans s’imposer', () => {
  assert.equal(validerId('miss-exemple').ok, true);
  assert.equal(validerId('miss-exemple').horsConvention, false);

  // Hors convention : accepté, mais signalé. Un outil interne a le droit de
  // s'appeler autrement ; ce qui coûte, c'est de ne pas le savoir.
  assert.equal(validerId('outil-interne').ok, true);
  assert.equal(validerId('outil-interne').horsConvention, true);

  assert.equal(validerId('Miss-Exemple').ok, false);
  assert.equal(validerId('miss exemple').ok, false);
  assert.equal(validerId('9-vies').ok, false);
  assert.equal(validerId(SQUELETTE).ok, false, 'le squelette lui-même');
});

test('le nom affiché se déduit de l’identifiant', () => {
  assert.equal(titreDepuisId('miss-exemple'), 'Miss Exemple');
  assert.equal(titreDepuisId('mister-cim10'), 'Mister Cim10');
});

test('la substitution ne laisse AUCUNE trace du squelette', () => {
  squelette(racine => {
    const { restes } = substituer(racine, {
      id: 'miss-exemple',
      titre: 'Miss Exemple',
      description: 'Une application d’exemple.',
    });

    // La garantie centrale : zéro reste. Le générateur échoue si elle tombe,
    // plutôt que de livrer une application à moitié renommée.
    assert.deepEqual(restes, []);

    const lu = rel => readFileSync(join(racine, rel), 'utf8');
    assert.match(lu('src/app/links.ts'), /'miss-exemple'/);
    assert.match(lu('vite.config.ts'), /'miss-exemple'/);
    assert.match(lu('package.json'), /"name": "miss-exemple"/);
  });
});

test('les DEUX identités sont traitées : l’identifiant et le nom affiché', () => {
  squelette(racine => {
    substituer(racine, {
      id: 'miss-exemple',
      titre: 'Miss Exemple',
      description: 'x',
    });

    // N'en traiter qu'une laisse une application correctement nommée dans son
    // URL et « PWA Starter Kit » dans son onglet.
    const html = readFileSync(join(racine, 'index.html'), 'utf8');
    assert.equal(html.includes(SQUELETTE_TITRE), false);
    assert.match(html, /<title>Miss Exemple<\/title>/);

    const adr = readFileSync(join(racine, 'docs/adr/0001-routeur.md'), 'utf8');
    assert.match(adr, /Miss Exemple/);
  });
});

test('le paquet naît en 0.1.0, avec SA description', () => {
  squelette(racine => {
    substituer(racine, {
      id: 'miss-exemple',
      titre: 'Miss Exemple',
      description: 'Une application d’exemple.',
    });
    const paquet = JSON.parse(
      readFileSync(join(racine, 'package.json'), 'utf8')
    );

    assert.equal(paquet.version, '0.1.0');
    // Sans cela, chaque application naîtrait en se décrivant comme « le
    // squelette de la famille » — et personne ne relit une description.
    assert.equal(paquet.description, 'Une application d’exemple.');
  });
});

test('les fichiers binaires ne sont jamais réécrits', () => {
  squelette(racine => {
    const listes = fichiersTexte(racine);
    assert.equal(
      listes.includes('public/favicon.svg'),
      true,
      'le SVG est du texte, et porte le nom du squelette'
    );
    assert.equal(
      listes.some(f => /\.(png|woff2)$/.test(f)),
      false
    );
  });
});

test('le README rendu parle de la nouvelle application, pas du squelette', () => {
  const texte = readme({
    id: 'miss-exemple',
    titre: 'Miss Exemple',
    description: 'Une application d’exemple.',
  });

  assert.match(texte, /^# miss-exemple/);
  assert.match(texte, /Une application d’exemple\./);
  // Le squelette n'est cité que comme ORIGINE, une fois, en lien.
  assert.match(texte, /pwa-starter-kit/);
  assert.doesNotMatch(texte, /squelette des applications PWA/);
  // Et il rappelle ce qui reste à faire, dont la suppression de l'exemple et
  // l'anglais de la description, que le générateur n'écrit pas.
  assert.match(texte, /supprimer.*src\/features\/home/is);
  assert.match(texte, /traduire l'anglais, marqué\s+`TODO traduire`/);
});

/** L'écran d'accueil du squelette depuis pwa-starter-kit#67, réduit à ce qui compte. */
const ACCUEIL_AVEC_ACCROCHE = `/**
 * Fait pour être supprimé — sauf sa première ligne, \`app.tagline\`, et sa
 * dernière : le pied de page (\`AppFooter\` le prend au catalogue).
 */
export function HomeScreen() {
  const { t } = useI18n();
  return (
    <>
      <p>{t('app.tagline')}</p>
      <h2>{t('home.title')}</h2>
      <AppFooter repoUrl={REPO_URL} issues className="mt-8" />
    </>
  );
}
`;

test('l’accueil garde ce que son écran porte vraiment : ni plus, ni moins', () => {
  assert.deepEqual(ceQueLAccueilGarde(ACCUEIL_AVEC_ACCROCHE), {
    accroche: true,
    piedDePage: true,
  });
  // `v1.2.0` : ni accroche ni pied de page — la coquille rendait ce dernier.
  // Les nommer dans un COMMENTAIRE ne compte pas : seuls l'appel et l'élément.
  assert.deepEqual(
    ceQueLAccueilGarde(
      "// `app.tagline` et `AppFooter` : ailleurs.\nreturn <h1>{t('home.title')}</h1>;"
    ),
    { accroche: false, piedDePage: false }
  );
  // Un écran absent : rien à garder, et rien n'est inventé.
  assert.deepEqual(ceQueLAccueilGarde(), {
    accroche: false,
    piedDePage: false,
  });
});

test('le README garde l’accroche et le pied de page quand l’accueil les porte', async () => {
  const pour = accueil =>
    readme({
      id: 'miss-exemple',
      titre: 'Miss Exemple',
      description: 'Une application d’exemple.',
      accueil,
    });

  const avec = pour({ accroche: true, piedDePage: true });
  // Plus de « supprimer src/features/home/ » : l'écran part avec sa phrase.
  assert.doesNotMatch(avec, /supprimer `src\/features\/home\/`/);
  assert.match(avec, /remplacer l'exemple de\s+`src\/features\/home\/`/);
  assert.match(avec, /l'accroche `app\.tagline`/);
  assert.match(avec, /pied de page de la famille/);

  // Une seule des deux : seule celle-là est nommée.
  const accrocheSeule = pour({ accroche: true, piedDePage: false });
  assert.match(accrocheSeule, /l'accroche `app\.tagline`/);
  assert.doesNotMatch(accrocheSeule, /pied de page/);

  // Rien à garder (`v1.2.0`) : l'exemple se supprime, comme avant.
  assert.match(
    pour({ accroche: false, piedDePage: false }),
    /\*\*supprimer `src\/features\/home\/`\*\*/
  );

  // Les quatre formes passent le `format:check` de l'application engendrée.
  for (const accroche of [true, false]) {
    for (const piedDePage of [true, false]) {
      const texte = pour({ accroche, piedDePage });
      assert.equal(
        texte,
        await prettier.format(texte, MARKDOWN),
        JSON.stringify({ accroche, piedDePage })
      );
    }
  }
});

test('le port : le prochain libre du catalogue, sinon celui qui suit le squelette', () => {
  assert.deepEqual(choisirPort({ freeDevPort: () => 5209 }), {
    port: 5209,
    origine: 'catalogue',
  });
  // Un socle installé antérieur aux ports : jamais 5240, qui est au squelette.
  assert.deepEqual(choisirPort(null), {
    port: PORT_SQUELETTE + 1,
    origine: 'défaut',
  });
  assert.deepEqual(choisirPort({ freeDevPort: () => null }), {
    port: 5241,
    origine: 'défaut',
  });
});

test('launch.json et vite.config portent le même port, et 5240 ne survit pas', () => {
  const launch = JSON.parse(launchJson('miss-exemple', 5209));
  assert.equal(launch.configurations[0].port, 5209);
  assert.deepEqual(launch.configurations[0].runtimeArgs.slice(-3), [
    '--port',
    '5209',
    '--strictPort',
  ]);
  assert.equal(
    remplacerPort('const DEV_PORT = devPortOf(APP_ID, 5240);', 5209),
    'const DEV_PORT = devPortOf(APP_ID, 5209);'
  );
  // Un squelette sans le motif : rendu tel quel, le launch.json porte le port.
  assert.equal(remplacerPort('export default {}', 5209), 'export default {}');
});

test('la référence : demandée, sinon la dernière étiquette, sinon main', () => {
  // `--from` l'emporte toujours, étiquettes ou pas.
  assert.deepEqual(choisirRef('main', [{ name: 'v1.0.0' }]), {
    ref: 'main',
    origine: 'demandée',
  });
  // L'API ne promet aucun ordre : la plus haute version est choisie, pas la
  // première rendue — et `v1.10.0` passe avant `v1.9.0`.
  assert.deepEqual(
    choisirRef(null, [{ name: 'v1.9.0' }, { name: 'v1.10.0' }, 'v0.9.9']),
    { ref: 'v1.10.0', origine: 'étiquette' }
  );
  // Une étiquette qui n'est pas une version n'est pas un point de départ.
  assert.deepEqual(choisirRef(undefined, [{ name: 'jalon-1' }, {}]), {
    ref: 'main',
    origine: 'défaut',
  });
  assert.deepEqual(choisirRef(undefined, []), {
    ref: 'main',
    origine: 'défaut',
  });
});

// ── La description ────────────────────────────────────────────────────────

/** Engendre depuis le faux squelette, et rend ce que ces tests relisent. */
function engendrer(description, preparer = () => {}) {
  return squelette(racine => {
    preparer(racine);
    const resultat = substituer(racine, {
      id: 'miss-exemple',
      titre: 'Miss Exemple',
      description,
    });
    const lire = rel =>
      existsSync(join(racine, rel))
        ? readFileSync(join(racine, rel), 'utf8')
        : null;
    return {
      ...resultat,
      html: lire('index.html'),
      ts: lire('src/i18n/messages.ts'),
    };
  });
}

/** La valeur d'une balise meta, décodée comme un navigateur la lit. */
function meta(html, cle) {
  const m = new RegExp(
    String.raw`<meta\s+(?:name|property)="${cle}"\s+content=(?:"([^"]*)"|'([^']*)')\s*/>`
  ).exec(html.replace(/<!--[\s\S]*?-->/g, ''));
  return (m?.[1] ?? m?.[2])?.replace(
    /&(quot|apos|amp|lt|gt);/g,
    (_, e) => ({ quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' })[e]
  );
}

/** Les valeurs d'une clé de dictionnaire, dans l'ordre du fichier (fr, en). */
function phrases(ts, cle) {
  return [
    ...ts.matchAll(
      new RegExp(String.raw`^ {4}${cle}:\s*(['"](?:\\.|[^\\\n])*?['"]),$`, 'gm')
    ),
  ].map(m => runInNewContext(m[1]));
}

test('la description prend la place de celle du squelette, partout où il se décrit', () => {
  const d = 'Une application d’exemple, pour éprouver le générateur.';
  const r = engendrer(d);

  // Ce que lisent les moteurs et les réseaux…
  assert.equal(meta(r.html, 'description'), d);
  assert.equal(meta(r.html, 'og:description'), d);
  // …et la première ligne de l'accueil, puis « À propos », dans les deux langues.
  assert.deepEqual(phrases(r.ts, 'tagline'), [d, d]);
  assert.deepEqual(phrases(r.ts, 'what'), [d, d]);

  // Le garde n'a rien à dire : rien de retiré ne subsiste, aucune place ne manque.
  assert.deepEqual(r.descriptions.restes, []);
  assert.deepEqual(r.descriptions.manquantes, []);
  for (const texte of Object.values(DIT_SQUELETTE)) {
    assert.equal(r.html.includes(texte) || r.ts.includes(texte), false, texte);
  }

  // Ce qui n'est pas une place n'est pas touché.
  assert.match(r.html, /content="à ne pas toucher"/);
  assert.match(r.ts, /name: 'Miss Exemple'/);
  assert.match(r.ts, /title: 'Notes'/);
});

test('l’anglais reçoit la phrase française, marquée à traduire HORS de la chaîne', () => {
  const d = 'Une application d’exemple.';
  const r = engendrer(d);

  const lignes = r.ts.split('\n');
  const marquees = lignes.flatMap((l, i) =>
    l.trim() === A_TRADUIRE ? [lignes[i + 1].trim()] : []
  );
  // Une marque au-dessus de chaque phrase anglaise, aucune en français.
  assert.deepEqual(marquees, [`tagline: '${d}',`, `what: '${d}',`]);
  assert.ok(r.ts.indexOf(A_TRADUIRE) > r.ts.indexOf('const en'));
  // Dans la chaîne, le marqueur s'afficherait sur l'accueil et partirait aux
  // moteurs : la phrase reste celle qu'on a demandée.
  assert.deepEqual(phrases(r.ts, 'tagline'), [d, d]);
  assert.deepEqual(r.descriptions.aTraduire, [
    'src/i18n/messages.ts : en.app.tagline',
    'src/i18n/messages.ts : en.about.what',
  ]);
});

test('la mise en page est celle de Prettier, quelle que soit la phrase', async () => {
  const html = { ...configPrettier, parser: 'html' };
  const ts = { ...configPrettier, parser: 'typescript' };
  // Le départ est conforme, comme le vrai squelette que sa CI formate : ce qui
  // suit mesure la réécriture, pas le décor.
  assert.equal(await prettier.format(INDEX_HTML, html), INDEX_HTML);
  assert.equal(await prettier.format(MESSAGES_TS, ts), MESSAGES_TS);

  const x = n => 'x'.repeat(n);
  const emoji = String.fromCodePoint(0x1f389);
  const ideogramme = String.fromCodePoint(0x65e5);
  const accent = 'e' + String.fromCodePoint(0x301);
  const epreuves = [
    'Court.',
    // Les seuils : `description` tient sur une ligne jusqu'à 38 caractères,
    // `og:description` jusqu'à 31, `tagline` jusqu'à 64 ; `what` toujours.
    x(31),
    x(32),
    x(38),
    x(39),
    x(64),
    x(65),
    // Prettier compte en COLONNES : un émoji ou un idéogramme en vaut deux, un
    // accent combinant aucune.
    x(62) + emoji,
    x(63) + emoji,
    x(62) + ideogramme,
    x(63) + ideogramme,
    x(63) + accent,
    x(64) + accent,
    // Les guillemets : chacun prend ceux qu'il aura le moins à échapper.
    "L'application d'essai de la famille.",
    'Il dit "oui" et l’autre "non".',
    'Il dit "oui" et l\'autre "non".',
    'Autant de \' que de ".',
    'A & B <c>, et un \\ au milieu.',
    // Une entité écrite en toutes lettres doit s'afficher telle quelle, pas
    // être décodée par le navigateur.
    'Pour R&D : écrire &amp; en toutes lettres.',
    'Une description qui prend son temps, bien plus longue qu’une ligne, parce que certaines applications ont besoin de deux phrases.',
  ];
  for (const d of epreuves) {
    const r = engendrer(d);
    assert.equal(r.html, await prettier.format(r.html, html), `« ${d} »`);
    assert.equal(r.ts, await prettier.format(r.ts, ts), `« ${d} »`);
    // Et le texte relu est celui demandé : l'échappement ne l'a pas abîmé.
    assert.equal(meta(r.html, 'description'), d);
    assert.equal(meta(r.html, 'og:description'), d);
    assert.deepEqual(phrases(r.ts, 'tagline'), [d, d]);
    assert.deepEqual(phrases(r.ts, 'what'), [d, d]);
  }
});

test('une description sur plusieurs lignes est ramenée à une', () => {
  const r = engendrer('  Une application\n  sur deux lignes.  ');
  const d = 'Une application sur deux lignes.';
  assert.equal(meta(r.html, 'description'), d);
  assert.deepEqual(phrases(r.ts, 'what'), [d, d]);
});

test('le garde : une phrase du squelette qui subsiste ailleurs est signalée', () => {
  const r = engendrer('Une application d’exemple.', racine => {
    // Le jour où le squelette recopie sa description dans un fichier que le
    // générateur ne réécrit pas, c'est ici qu'elle apparaît.
    ecrire(racine, 'public/llms.txt', `${DIT_SQUELETTE.taglineFr}\n`);
    ecrire(
      racine,
      'src/features/about/Intro.tsx',
      `export const intro = ${JSON.stringify(DIT_SQUELETTE.paquet)};\n`
    );
    // Le README, lui, est remplacé en entier par `readme()` juste après.
    ecrire(racine, 'README.md', `${DIT_SQUELETTE.whatFr}\n`);
  });
  assert.deepEqual(r.descriptions.restes.sort(), [
    'public/llms.txt',
    'src/features/about/Intro.tsx',
  ]);

  // Une description qui CONTIENT une ancienne phrase ne se dénonce pas elle-même.
  const reprise = engendrer(`${DIT_SQUELETTE.taglineEn} Pour de vrai.`);
  assert.deepEqual(reprise.descriptions.restes, []);
});

test('une place introuvable est signalée, et rien n’est inventé', () => {
  const r = engendrer('Une application d’exemple.', racine => {
    // Le squelette a renommé une clé et retiré une balise.
    ecrire(
      racine,
      'src/i18n/messages.ts',
      MESSAGES_TS.replace(
        `    what: '${DIT_SQUELETTE.whatEn}'`,
        `    body: '${DIT_SQUELETTE.whatEn}'`
      )
    );
    ecrire(
      racine,
      'index.html',
      INDEX_HTML.replace(/ {4}<meta\n {6}property="og:description"[^>]*>\n/, '')
    );
  });
  assert.deepEqual(r.descriptions.manquantes.sort(), [
    'index.html : <meta og:description>',
    'src/i18n/messages.ts : en.about.what',
  ]);
  assert.doesNotMatch(r.html, /og:description/);
  // La phrase déplacée n'a pas été retirée, le garde ne la connaît donc pas :
  // c'est l'avertissement qui la signale, et la CI du générateur qui rougit.
  assert.deepEqual(r.descriptions.restes, []);

  const sans = engendrer('Une application d’exemple.', racine =>
    rmSync(join(racine, 'src/i18n/messages.ts'))
  );
  assert.deepEqual(sans.descriptions.manquantes, [
    'src/i18n/messages.ts : fichier absent',
  ]);
});

// ── Les tableaux Markdown ─────────────────────────────────────────────────

const MARKDOWN = { ...configPrettier, parser: 'markdown' };

/**
 * Un ADR à l'image du 0012 du squelette : un tableau DANS une liste, dont des
 * cellules citent l'identifiant et le nom, avec les trois alignements ; un bloc
 * de code qui ressemble à un tableau ; un tableau qui ne cite rien.
 */
const ADR_BROUILLON = `# Mesure

La prose ne s'aligne pas : ${SQUELETTE_TITRE} peut changer de longueur ici.

1. Le relevé :

   | ce qui était à prouver | relevé | n |
   | :- | :-: | -: |
   | \`app_name\` présent | \`app_name: "${SQUELETTE}"\` | 1 |
   | le refus | seul \`dwc_consent:/${SQUELETTE}/\` garde le choix | 22 |
   | le nom | ${SQUELETTE_TITRE} ${String.fromCodePoint(0x1f389)} | 333 |

2. Un bloc de code n'est pas un tableau :

   \`\`\`text
   | ${SQUELETTE} | x |
   | --- | --- |
   \`\`\`

| sans le nom | x |
| - | - |
| a \\| b | y |
`;

test('un nom d’une autre longueur ne désaligne aucun tableau', async () => {
  // Le départ est tel que la CI du squelette le formate.
  const adr = await prettier.format(ADR_BROUILLON, MARKDOWN);
  const code = adr.slice(adr.indexOf('```text'), adr.lastIndexOf('```'));

  for (const [id, titre] of [
    ['miss-x', 'Miss X'],
    [
      'mister-une-application-au-nom-long',
      'Mister Une Application Au Nom Long',
    ],
  ]) {
    const lu = squelette(racine => {
      ecrire(racine, 'docs/adr/0012-mesure.md', adr);
      substituer(racine, { id, titre, description: 'x' });
      return readFileSync(join(racine, 'docs/adr/0012-mesure.md'), 'utf8');
    });

    assert.equal(lu, await prettier.format(lu, MARKDOWN), id);
    assert.match(lu, new RegExp(`app_name: "${id}"`));
    // Le bloc de code reçoit le nom, sans être réaligné : Prettier n'y touche
    // pas, et ce n'est pas un tableau.
    assert.ok(lu.includes(code.split(SQUELETTE).join(id)), id);
  }
});

test('realignerTableaux aligne comme Prettier', async () => {
  const emoji = String.fromCodePoint(0x1f389);
  const ideogrammes = String.fromCodePoint(0x65e5, 0x672c);
  const accent = 'e' + String.fromCodePoint(0x301);
  const brouillons = [
    // Les quatre alignements, et un centrage à espace impair.
    '| g | c | d | n |\n| :- | :-: | -: | - |\n| a | bb | ccc | dddd |\n| une cellule longue | x | y | z |\n',
    // Trois colonnes au moins, même pour une lettre.
    '| a | b |\n| - | - |\n| x | y |\n',
    // Dans une liste, le tableau garde l'indentation de sa ligne.
    '1. Premier point :\n\n   | ce qui | relevé |\n   | - | - |\n   | un | `app_name: "miss-x"` |\n',
    // Des colonnes, pas des caractères.
    `| a | b |\n| - | - |\n| ${emoji}${emoji} | ${ideogrammes} |\n| é | ${accent} |\n`,
    // Un \\| échappé reste dans sa cellule.
    '| a | b |\n| - | - |\n| x \\| y | z |\n',
    '| titre |\n| :-: |\n| abcd |\n| a |\n',
  ];
  for (const b of brouillons) {
    assert.equal(realignerTableaux(b), await prettier.format(b, MARKDOWN), b);
  }
});

test('realignerTableaux ne touche ni un bloc de code, ni ce qu’il ne comprend pas', () => {
  for (const intact of [
    '```\n| a | b |\n| - | - |\n```\n',
    '~~~~md\n| a | b |\n| - | - |\n~~~\n| c | d |\n~~~~\n',
    // Une rangée d'une cellule de moins : rien n'est deviné.
    '| a | b |\n| - | - |\n| x |\n',
  ]) {
    assert.equal(realignerTableaux(intact), intact);
  }
  // Un tableau que le filtre écarte reste tel qu'il est, même mal aligné.
  const compact = '| a | b |\n| - | - |\n| x | y |\n';
  assert.equal(
    realignerTableaux(compact, () => false),
    compact
  );
});
