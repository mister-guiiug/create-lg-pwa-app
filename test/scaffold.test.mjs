// Le cœur du générateur, éprouvé sans réseau ni GitHub.
//
// Ce qui est testé ici est ce qui peut casser EN SILENCE : une substitution
// incomplète produit une application qui se construit, se déploie, et porte le
// nom du squelette dans son manifeste, son onglet et son URL de dépôt. Rien
// n'échoue ; on s'en aperçoit en production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  PORT_SQUELETTE,
  SQUELETTE,
  SQUELETTE_NOM_COURT,
  SQUELETTE_TITRE,
  TITRE_MIN,
  activerPages,
  ceQueLAccueilGarde,
  choisirPort,
  choisirRef,
  controlerTextes,
  descriptionParDefaut,
  fichiersTexte,
  launchJson,
  lireReponseGh,
  rangerAppels,
  readme,
  realignerTableaux,
  remplacerPort,
  substituer,
  titreDePageParDefaut,
  titreDepuisId,
  validerId,
  validerNom,
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
    <meta name="apple-mobile-web-app-title" content="${SQUELETTE_NOM_COURT}" />
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
    'vite.config.ts': `const APP_ID = '${SQUELETTE}';
const pwa = pwaBaseOptions({
  id: APP_ID,
  name: '${SQUELETTE_TITRE}',
  shortName: '${SQUELETTE_NOM_COURT}',
});
`,
    'index.html': INDEX_HTML,
    'src/i18n/messages.ts': MESSAGES_TS,
    'docs/adr/0001-routeur.md': `# Décision\n\nValable pour ${SQUELETTE_TITRE}.\n`,
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
  // Un tiret doublé ou final ne fait ni double espace ni espace final.
  assert.equal(titreDepuisId('miss--exemple-'), 'Miss Exemple');
});

/** Les noms que le générateur accepte : ceux de la famille, et ses marges. */
const NOMS_PERMIS = [
  'Miss Devises',
  'Mister Settle',
  'L’Atelier',
  'Miss Sudoku-Express',
  'Mister J.O.',
  'Élodie Ça Va',
  'Miss 2048',
  // Un accent combinant : « é » écrit en deux points de code.
  'Miss Café',
];

test('un nom affiché ne porte que des caractères inertes à toutes ses places', () => {
  for (const nom of NOMS_PERMIS) {
    assert.deepEqual(validerNom(nom), { ok: true }, nom);
  }
  // L'apostrophe droite, seul cas réel : le refus propose la typographique.
  const apostrophe = validerNom("L'Atelier");
  assert.equal(apostrophe.ok, false);
  assert.match(apostrophe.raison, /« ' »/);
  assert.equal(apostrophe.suggestion, 'L’Atelier');
  for (const nom of [
    'Il dit "oui"',
    'R&D',
    'Miss <b>',
    'Miss A|B',
    'Miss *Star*',
    'Miss _Star_',
    'Miss [X]',
    'Miss A\\B',
    'Miss `x`',
    'Miss ${x}',
    // Une espace insécable : seule l'espace ordinaire est permise.
    'Miss\u00a0X',
    'Miss\nX',
  ]) {
    const v = validerNom(nom);
    assert.equal(v.ok, false, nom);
    // Aucune proposition quand l'apostrophe n'est pas en cause.
    assert.equal(v.suggestion, undefined, nom);
  }
  for (const nom of ['', ' ', ' Miss X', 'Miss X ', 'Miss  X', '-', '’']) {
    assert.equal(validerNom(nom).ok, false, JSON.stringify(nom));
  }
});

test('la ligne de commande refuse le nom AVANT tout téléchargement', () => {
  const dossier = join(mkdtempSync(join(tmpdir(), 'lg-pwa-nom-')), 'app');
  try {
    const r = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../bin/create-lg-pwa-app.mjs', import.meta.url)),
        'miss-essai',
        '--nom',
        "L'Atelier",
        '--no-install',
        '--dir',
        dossier,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /--nom « L'Atelier »/);
    assert.match(r.stderr, /proposé : --nom "L’Atelier"/);
    // Rien n'est écrit : le refus précède le téléchargement du squelette.
    assert.equal(existsSync(dossier), false);
  } finally {
    rmSync(dirname(dossier), { recursive: true, force: true });
  }
});

test('le nom déduit d’un identifiant valable est toujours permis', () => {
  for (const id of [
    'miss-exemple',
    'mister-a1',
    'x',
    'miss-2048',
    'miss--x-',
  ]) {
    assert.equal(validerId(id).ok, true, id);
    assert.deepEqual(validerNom(titreDepuisId(id)), { ok: true }, id);
  }
});

test('un nom permis donne des fichiers que Prettier lit et laisse tels quels', async () => {
  const formats = {
    'index.html': { ...configPrettier, parser: 'html' },
    'src/i18n/messages.ts': { ...configPrettier, parser: 'typescript' },
    'vite.config.ts': { ...configPrettier, parser: 'typescript' },
    'docs/adr/0001-routeur.md': { ...configPrettier, parser: 'markdown' },
  };
  for (const nom of NOMS_PERMIS) {
    const fichiers = squelette(racine => {
      substituer(racine, {
        id: 'miss-exemple',
        titre: nom,
        description: 'x',
        titrePage: titreDePageParDefaut(nom),
      });
      return Object.fromEntries(
        Object.keys(formats).map(rel => [
          rel,
          readFileSync(join(racine, rel), 'utf8'),
        ])
      );
    });
    for (const [rel, texte] of Object.entries(fichiers)) {
      // Un nom qui casserait la syntaxe ferait échouer `format` lui-même.
      assert.equal(
        texte,
        await prettier.format(texte, formats[rel]),
        `${nom} : ${rel}`
      );
      assert.ok(texte.includes(nom), `${nom} : ${rel}`);
    }
  }
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

test('le nom court aussi : c’est lui qu’on lit sous l’icône installée', () => {
  squelette(racine => {
    const { restes } = substituer(racine, {
      id: 'miss-exemple',
      titre: 'Miss Exemple',
      description: 'x',
    });

    // « Starter Kit » n'est pas « PWA Starter Kit » : le remplacement du nom
    // affiché le laissait passer. Android l'affichait sous l'icône (le
    // `short_name` du manifeste, tiré de `shortName`), iOS aussi
    // (`apple-mobile-web-app-title`). Relevé le 02/10/2026 sur miss-devises.
    const lu = rel => readFileSync(join(racine, rel), 'utf8');
    assert.match(lu('vite.config.ts'), /shortName: 'Miss Exemple'/);
    assert.match(lu('vite.config.ts'), /name: 'Miss Exemple'/);
    assert.match(
      lu('index.html'),
      /<meta name="apple-mobile-web-app-title" content="Miss Exemple" \/>/
    );
    for (const rel of fichiersTexte(racine)) {
      assert.equal(lu(rel).includes(SQUELETTE_NOM_COURT), false, rel);
    }
    assert.deepEqual(restes, []);
  });
});

test('la balise du nom court est rangée comme Prettier la range', async () => {
  const html = { ...configPrettier, parser: 'html' };
  // Derrière quatre espaces, la balise tient sur une ligne jusqu'à un nom de
  // 23 colonnes ; au-delà, un attribut par ligne. La CI l'a relevé sur la
  // naissance au nom long, rouge à `prettier --check`.
  const noms = [
    'Miss X',
    'Miss Devises',
    'x'.repeat(23),
    'x'.repeat(24),
    'Mister Une Application Au Nom Vraiment Long',
    // Échappée dans la balise. La ligne de commande refuse ce nom en amont
    // (`validerNom`) ; la balise reste échappée par sûreté, et un guillemet ou
    // un chevron casseraient de toute façon `og:title`, touché à l'état brut.
    'R&D Labo',
  ];
  for (const nom of noms) {
    // Le titre de page par défaut, comme la ligne de commande : sans lui,
    // `og:title` garderait le nom brut, et c'est sa ligne qui déborderait.
    const lu = squelette(racine => {
      substituer(racine, {
        id: 'miss-exemple',
        titre: nom,
        description: 'x',
        titrePage: titreDePageParDefaut(nom),
      });
      return readFileSync(join(racine, 'index.html'), 'utf8');
    });
    assert.equal(lu, await prettier.format(lu, html), `« ${nom} »`);
    // Et le nom relu est celui demandé : l'échappement ne l'a pas abîmé.
    assert.equal(meta(lu, 'apple-mobile-web-app-title'), nom);
  }
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

test('launch.json sort tel que Prettier le range : la première CI le relit', async () => {
  // L'application le relit par `prettier --check .`, avec la configuration du
  // socle, dont `prettier.config.js` est la copie vérifiée. `filepath` fait
  // choisir l'analyseur par le nom du fichier, comme cette commande.
  const options = { ...configPrettier, filepath: '.claude/launch.json' };
  for (const [id, port] of [
    ['miss-x', 5201],
    ['miss-devises', 5213],
    // Un nom qui déborde de la ligne : Prettier ne coupe pas une chaîne.
    ['mister-une-application-au-nom-assez-long-pour-deborder-la-ligne', 5299],
    // Le plus large des ports : le tableau tient encore sur sa ligne.
    ['miss-exemple', 65535],
  ]) {
    const texte = launchJson(id, port);
    assert.ok(
      await prettier.check(texte, options),
      `${id}, ${port} :\n${texte}`
    );
    assert.deepEqual(JSON.parse(texte), {
      version: '0.0.1',
      configurations: [
        {
          name: id,
          runtimeExecutable: 'npm',
          runtimeArgs: [
            'run',
            'dev',
            '--',
            '--port',
            `${port}`,
            '--strictPort',
          ],
          port,
        },
      ],
    });
  }
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

// ── GitHub Pages ──────────────────────────────────────────────────────────

/**
 * Ce que `gh api -i` écrit, relevé le 01/10/2026 et réduit à deux en-têtes :
 * la ligne de statut finit par `\n`, les en-têtes par `\r\n`.
 */
const GH_404 =
  'HTTP/2.0 404 Not Found\n' +
  'Access-Control-Allow-Origin: *\r\n' +
  "Content-Security-Policy: default-src 'none'\r\n" +
  '\r\n' +
  '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/pages/pages#get-a-apiname-pages-site","status":"404"}';
const GH_200 =
  'HTTP/2.0 200 OK\n' +
  'Access-Control-Allow-Origin: *\r\n' +
  'Cache-Control: private, max-age=60, s-maxage=60\r\n' +
  '\r\n' +
  '{"url":"https://api.github.com/repos/mister-guiiug/miss-devises/pages","status":null,"html_url":"https://mister-guiiug.github.io/miss-devises/","build_type":"workflow","source":{"branch":"main","path":"/"}}';

test('une réponse de gh api -i se lit par sa ligne de statut', () => {
  const absent = lireReponseGh(GH_404);
  assert.equal(absent.statut, 404);
  assert.equal(absent.corps.message, 'Not Found');

  const site = lireReponseGh(GH_200);
  assert.equal(site.statut, 200);
  assert.equal(site.corps.build_type, 'workflow');

  // Un PUT réussi répond sans corps.
  assert.deepEqual(
    lireReponseGh(
      'HTTP/2.0 204 No Content\nAccess-Control-Allow-Origin: *\r\n\r\n'
    ),
    { statut: 204, corps: null }
  );
  // `gh` a échoué avant l'API (pas de session, pas de réseau) : aucun statut.
  assert.deepEqual(lireReponseGh(''), { statut: 0, corps: null });
});

/**
 * Une fausse API GitHub : elle rend les réponses données, dans l'ordre, et
 * garde les appels reçus. Un appel de trop est une erreur.
 */
function fausseApi(...reponses) {
  const appels = [];
  const api = (methode, chemin, champs) => {
    appels.push(
      [methode, chemin, champs && JSON.stringify(champs)]
        .filter(Boolean)
        .join(' ')
    );
    const reponse = reponses.shift();
    if (!reponse) throw new Error(`appel inattendu : ${methode} ${chemin}`);
    return reponse;
  };
  return { api, appels };
}

const DEPOT = 'mister-guiiug/miss-exemple';
const SITE = `repos/${DEPOT}/pages`;
const EN_WORKFLOW = `${SITE} {"build_type":"workflow"}`;
const SOURCE = { branch: 'main', path: '/' };

test('Pages sur un dépôt neuf : créées, passées en workflow, relues', () => {
  // La séquence de miss-devises, le 01/10/2026 : pas de site, le POST le crée
  // en gardant `source`, le PUT le passe en workflow, la relecture le confirme.
  const { api, appels } = fausseApi(
    { statut: 404, corps: { message: 'Not Found' } },
    { statut: 201, corps: { build_type: 'workflow', source: SOURCE } },
    { statut: 204, corps: null },
    { statut: 200, corps: { build_type: 'workflow', source: SOURCE } }
  );
  activerPages(api, DEPOT);
  assert.deepEqual(appels, [
    `GET ${SITE}`,
    `POST ${EN_WORKFLOW}`,
    `PUT ${EN_WORKFLOW}`,
    `GET ${SITE}`,
  ]);
});

test('Pages déjà là, ou nées entre-temps : le PUT suffit', () => {
  const existant = fausseApi(
    { statut: 200, corps: { build_type: 'legacy', source: SOURCE } },
    { statut: 204, corps: null },
    { statut: 200, corps: { build_type: 'workflow', source: SOURCE } }
  );
  activerPages(existant.api, DEPOT);
  assert.deepEqual(existant.appels, [
    `GET ${SITE}`,
    `PUT ${EN_WORKFLOW}`,
    `GET ${SITE}`,
  ]);

  // Le site est né entre la lecture et la création : 409, puis le PUT.
  const course = fausseApi(
    { statut: 404, corps: null },
    { statut: 409, corps: { message: 'GitHub Pages is already enabled.' } },
    { statut: 204, corps: null },
    { statut: 200, corps: { build_type: 'workflow' } }
  );
  activerPages(course.api, DEPOT);
  assert.deepEqual(course.appels, [
    `GET ${SITE}`,
    `POST ${EN_WORKFLOW}`,
    `PUT ${EN_WORKFLOW}`,
    `GET ${SITE}`,
  ]);
});

test('Pages : un échec se dit, et un site relu hors workflow aussi', () => {
  const activer =
    (...reponses) =>
    () =>
      activerPages(fausseApi(...reponses).api, DEPOT);
  assert.throws(
    activer({ statut: 403, corps: { message: 'Must have admin rights' } }),
    /lecture : HTTP 403 \(Must have admin rights\)/
  );
  assert.throws(
    activer(
      { statut: 404, corps: null },
      { statut: 422, corps: { message: 'Validation Failed' } }
    ),
    /création : HTTP 422/
  );
  assert.throws(
    activer({ statut: 200, corps: {} }, { statut: 400, corps: null }),
    /passage en workflow : HTTP 400/
  );
  // Le PUT a répondu, mais le site relu n'est pas en workflow : Jekyll
  // publierait le README. Le message dit comment reprendre à la main.
  assert.throws(
    activer(
      { statut: 200, corps: {} },
      { statut: 204, corps: null },
      { statut: 200, corps: { build_type: 'legacy' } }
    ),
    /build_type vaut « legacy ».*gh api -X PUT repos\/mister-guiiug\/miss-exemple\/pages -f build_type=workflow/
  );
});

// ── Le titre de la page, et les règles SEO du parc ────────────────────────

const TIRETS_LONGS = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

test('les textes par défaut passent les règles SEO du parc, pour tout nom', () => {
  for (const nom of ['A', 'Miss X', 'Miss Essai Naissance', 'x'.repeat(70)]) {
    const titrePage = titreDePageParDefaut(nom);
    const description = descriptionParDefaut(nom);
    assert.deepEqual(
      controlerTextes({ titrePage, description }),
      { refus: [], avertissements: [] },
      nom
    );
    // Aucun ne se présente comme le squelette, ni ne porte de tiret long.
    const textes = `${titrePage} ${description}`;
    assert.doesNotMatch(textes, /squelette/);
    assert.doesNotMatch(textes, TIRETS_LONGS);
    assert.ok(titrePage.startsWith(nom) && description.startsWith(nom), nom);
  }
});

test('ce que pwa-doctor --strict refuserait est refusé avant la naissance', () => {
  const courts = controlerTextes({
    titrePage: 'x'.repeat(TITRE_MIN - 1),
    description: 'x'.repeat(DESCRIPTION_MIN - 1),
  });
  assert.equal(courts.refus.length, 2);
  assert.match(courts.refus[0], /--titre : 49 caractères.*seo-title-length/);
  assert.match(
    courts.refus[1],
    /--description : 69 caractères.*seo-description-length/
  );

  // Les seuils eux-mêmes passent. Les espaces se comptent resserrées, comme
  // le contenu servi les montre : soixante colonnes peuvent en faire 39.
  assert.deepEqual(
    controlerTextes({
      titrePage: 'x'.repeat(TITRE_MIN),
      description: 'x'.repeat(DESCRIPTION_MIN),
    }),
    { refus: [], avertissements: [] }
  );
  assert.match(
    controlerTextes({
      titrePage: 'x  '.repeat(20),
      description: 'x'.repeat(DESCRIPTION_MIN),
    }).refus.join(),
    /--titre : 39 caractères/
  );

  // Le reste s'annonce sans arrêter : un tiret long dans le titre, une
  // description que les moteurs tronqueraient.
  const cadratin = String.fromCharCode(0x2014);
  const averti = controlerTextes({
    titrePage: `Miss X ${cadratin} ${'x'.repeat(TITRE_MIN)}`,
    description: 'x'.repeat(DESCRIPTION_MAX + 1),
  });
  assert.deepEqual(averti.refus, []);
  assert.equal(averti.avertissements.length, 2);
  assert.match(averti.avertissements[0], /le parc écrit « - »/);
  assert.match(averti.avertissements[1], /161 caractères/);
});

/**
 * L'`index.html` du squelette depuis pwa-starter-kit#72 : le titre allongé
 * pour Bing, 76 colonnes, et sa copie `og:title` sur plusieurs lignes. Une
 * balise `<title>` en commentaire n'est pas une place.
 */
const INDEX_HTML_TITRE = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <!-- <title>${SQUELETTE_TITRE}, en commentaire</title> -->
    <title>${SQUELETTE_TITRE} - squelette d'application web installable</title>
    <meta
      property="og:title"
      content="${SQUELETTE_TITRE} - squelette d'application web installable"
    />
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;

/** Engendre depuis le faux squelette avec un nom, et un titre de page s'il est donné. */
function naitre({ titre, titrePage, preparer = () => {} }) {
  return squelette(racine => {
    preparer(racine);
    const resultat = substituer(racine, {
      id: 'miss-exemple',
      titre,
      description: 'Une application d’exemple.',
      titrePage,
    });
    const lire = rel =>
      existsSync(join(racine, rel))
        ? readFileSync(join(racine, rel), 'utf8')
        : null;
    return {
      ...resultat,
      html: lire('index.html'),
      spec: lire('e2e/smoke.spec.ts'),
    };
  });
}

/** Le titre comme un navigateur le lit : espaces resserrées, entités décodées. */
function titreLu(html) {
  return /<title>([\s\S]*?)<\/title>/
    .exec(html.replace(/<!--[\s\S]*?-->/g, ''))?.[1]
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&(amp|lt|gt);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>' })[e]);
}

test('le titre de la page prend ses places, rangé comme Prettier le range', async () => {
  const html = { ...configPrettier, parser: 'html' };
  // Le départ est conforme, comme le vrai squelette que sa CI formate.
  assert.equal(await prettier.format(INDEX_HTML_TITRE, html), INDEX_HTML_TITRE);

  const x = n => 'x'.repeat(n);
  const emoji = String.fromCodePoint(0x1f389);
  const epreuves = [
    // Le seuil : 61 caractères tiennent derrière quatre espaces, 62 non.
    x(61),
    x(62),
    titreDePageParDefaut('Miss X'),
    'Miss Devises - convertisseur euro avec billets et pièces',
    // Replié mot à mot, sur deux lignes ou davantage.
    'Mister Une Application Au Nom Vraiment Long - suivi des tâches de la maison',
    `Mister Une Application Au Nom Vraiment Long - ${'mot '.repeat(40).trim()}`,
    // Ce qui s'échappe compte pour ce qui s'écrit : `&amp;` vaut cinq colonnes.
    'Mister & Miss Koh - suivi de Koh-Lanta sans spoiler, saison après saison',
    'Les balises <title> et leurs copies, pour une application de la famille',
    `${x(55)} ${emoji}${emoji}`,
    // Un mot plus large que la ligne reste entier.
    `Miss X - ${x(90)} fin`,
  ];
  for (const titrePage of epreuves) {
    const r = naitre({
      titre: 'Miss X',
      titrePage,
      preparer: racine => ecrire(racine, 'index.html', INDEX_HTML_TITRE),
    });
    assert.equal(r.html, await prettier.format(r.html, html), titrePage);
    assert.equal(titreLu(r.html), titrePage);
    assert.equal(meta(r.html, 'og:title'), titrePage);
    assert.match(r.html, /<!-- <title>Miss X, en commentaire<\/title> -->/);
    assert.deepEqual(r.titres, { restes: [], manquantes: [] });
  }
});

test('le titre du squelette ne survit nulle part, et une place absente se dit', () => {
  const titrePage = titreDePageParDefaut('Miss X');
  // Le squelette recopie un jour son titre ailleurs : la naissance le voit.
  const recopie = naitre({
    titre: 'Miss X',
    titrePage,
    preparer: racine => {
      ecrire(racine, 'index.html', INDEX_HTML_TITRE);
      ecrire(
        racine,
        'public/llms.txt',
        `# ${SQUELETTE_TITRE} - squelette d'application web installable\n`
      );
    },
  });
  assert.deepEqual(recopie.titres.restes, ['public/llms.txt']);

  // `v1.2.0` : le titre n'était que le nom. Il est remplacé, et le nom, qui
  // est partout ailleurs, n'est pas pris pour un reste.
  const ancien = naitre({ titre: 'Miss X', titrePage });
  assert.deepEqual(ancien.titres, { restes: [], manquantes: [] });
  assert.equal(titreLu(ancien.html), titrePage);
  assert.equal(meta(ancien.html, 'og:title'), titrePage);

  // Ni `<title>` ni `og:title` : rien n'est inventé, et cela se dit.
  const sans = naitre({
    titre: 'Miss X',
    titrePage,
    preparer: racine =>
      ecrire(
        racine,
        'index.html',
        '<!doctype html>\n<html><head></head></html>\n'
      ),
  });
  assert.deepEqual(sans.titres.manquantes, [
    'index.html : <title>',
    'index.html : <meta og:title>',
  ]);

  // Sans titre de page demandé, `substituer` fait ce qu'il faisait.
  const inchange = naitre({ titre: 'Miss X' });
  assert.match(inchange.html, /<title>Miss X<\/title>/);
  assert.deepEqual(inchange.titres, { restes: [], manquantes: [] });
});

/**
 * Un test de bout en bout à l'image de `e2e/smoke.spec.ts` du squelette, rangé
 * par Prettier avec son nom : l'appel ouvert sur trois lignes, et une requête
 * qui tient sur une.
 */
const SMOKE_SPEC = `import { expect, test } from '@playwright/test';

test.describe('@critical le cadre', () => {
  test("l'accueil s'ouvre et porte le nom de l'app", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      '${SQUELETTE_TITRE}'
    );
    const nom = page.getByText('${SQUELETTE_TITRE}');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Notes');
  });
});
`;

test('un appel qui porte le nom tient sur sa ligne, ou non, comme Prettier le décide', async () => {
  const ts = { ...configPrettier, parser: 'typescript' };
  // Le départ est conforme, comme le vrai squelette que sa CI formate.
  assert.equal(await prettier.format(SMOKE_SPEC, ts), SMOKE_SPEC);

  // « Miss X » referme l'appel, une centaine de caractères ouvre la requête.
  for (const titre of [
    'X',
    'Miss X',
    'Miss Xy',
    'Miss Essai Naissance',
    'Mister Une Application Au Nom Vraiment Long',
    'x'.repeat(60),
  ]) {
    const r = naitre({
      titre,
      preparer: racine => ecrire(racine, 'e2e/smoke.spec.ts', SMOKE_SPEC),
    });
    assert.equal(r.spec, await prettier.format(r.spec, ts), titre);
    assert.equal(r.spec.split(`'${titre}'`).length - 1, 2, titre);
  }
});

test('rangerAppels ne touche que les appels à une seule chaîne qui porte le nom', () => {
  for (const intact of [
    // Deux arguments : la règle n'est plus la même, rien n'est deviné.
    "    foo('Miss X', 1);",
    "    foo(\n      'Miss X',\n      'autre'\n    );",
    // Une chaîne qui ne porte pas le nom reste telle que le squelette l'a.
    "    await expect(page.getByRole('heading', { level: 1 })).toHaveText(\n      'Notes'\n    );",
    // Un nom dans un commentaire ou une propriété n'est pas un appel.
    "    // voir toHaveText('Miss X')\n    name: 'Miss X',",
  ]) {
    assert.equal(rangerAppels(intact, 'Miss X'), intact);
  }
});
