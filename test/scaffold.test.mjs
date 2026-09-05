// Le cœur du générateur, éprouvé sans réseau ni GitHub.
//
// Ce qui est testé ici est ce qui peut casser EN SILENCE : une substitution
// incomplète produit une application qui se construit, se déploie, et porte le
// nom du squelette dans son manifeste, son onglet et son URL de dépôt. Rien
// n'échoue ; on s'en aperçoit en production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  SQUELETTE,
  SQUELETTE_TITRE,
  fichiersTexte,
  readme,
  substituer,
  titreDepuisId,
  validerId,
} from '../bin/scaffold.mjs';

/** Un faux squelette, à l'image du vrai sur les points qui comptent. */
function squelette(fn) {
  const racine = mkdtempSync(join(tmpdir(), 'lg-pwa-test-'));
  const fichiers = {
    'package.json': JSON.stringify(
      {
        name: SQUELETTE,
        version: '0.1.0',
        description: 'Squelette d’application PWA de la famille.',
        scripts: { preview: `vite preview --base /${SQUELETTE}/` },
      },
      null,
      2
    ),
    'src/app/links.ts': `export const APP_ID = '${SQUELETTE}';`,
    'vite.config.ts': `const APP_ID = '${SQUELETTE}';`,
    'index.html': `<title>${SQUELETTE_TITRE}</title>`,
    'docs/adr/0001-routeur.md': `# Décision\n\nValable pour ${SQUELETTE_TITRE}.`,
    'public/favicon.svg': '<svg />',
  };
  for (const [rel, contenu] of Object.entries(fichiers)) {
    const abs = join(racine, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contenu);
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
  // Et il rappelle ce qui reste à faire, dont la suppression de l'exemple.
  assert.match(texte, /supprimer.*src\/features\/home/is);
});
