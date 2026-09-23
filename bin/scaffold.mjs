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

/** Le port réservé au squelette, que le générateur ne redonne jamais. */
export const PORT_SQUELETTE = 5240;

/**
 * Le port de développement d'une application neuve.
 *
 * Le catalogue du socle porte un port UNIQUE par app (`devPort`, plage
 * 5201–5299) et sait rendre le prochain libre (`freeDevPort`). Le générateur
 * le lit dans le socle INSTALLÉ de l'application engendrée — il n'a pas de
 * dépendance à lui — et retombe sur le premier port après celui du squelette
 * quand le socle installé ne connaît pas encore les ports.
 *
 * @param {{ freeDevPort?: () => number | null, FAMILY_APPS?: Array<{ devPort?: number }> } | null} catalogue
 * @returns {{ port: number, origine: 'catalogue' | 'défaut' }}
 */
export function choisirPort(catalogue) {
  const libre = catalogue?.freeDevPort?.();
  if (Number.isInteger(libre)) return { port: libre, origine: 'catalogue' };
  return { port: PORT_SQUELETTE + 1, origine: 'défaut' };
}

/**
 * Le `.claude/launch.json` d'une application : le serveur de développement,
 * sur SON port, pour l'aperçu intégré de l'éditeur.
 */
export function launchJson(id, port) {
  return `${JSON.stringify(
    {
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
            String(port),
            '--strictPort',
          ],
          port,
        },
      ],
    },
    null,
    2
  )}\n`;
}

/**
 * Le port dans `vite.config.ts` du squelette : `devPortOf(APP_ID, 5240)` — le
 * repli 5240 est celui du squelette, et une app neuve ne doit pas le garder.
 * Sans ce motif (squelette antérieur), le fichier est rendu tel quel : le
 * `launch.json` porte alors seul le port, par `--port`.
 */
export function remplacerPort(viteConfig, port) {
  return viteConfig.replace(
    /devPortOf\(\s*APP_ID\s*,\s*5240\s*\)/,
    `devPortOf(APP_ID, ${port})`
  );
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
 * LA DESCRIPTION, ELLE, N'EST PAS UNE CHAÎNE À REMPLACER : c'est une PLACE. Le
 * squelette se décrit dans `package.json`, dans les balises meta d'`index.html`
 * et dans deux phrases de chaque dictionnaire, et ces textes changent d'une
 * étiquette à l'autre. Le générateur ne les connaît donc pas : il réécrit ce qui
 * occupe ces places, retient ce qu'il a retiré, puis vérifie que rien de ce
 * qu'il a retiré ne subsiste ailleurs.
 *
 * @returns {{
 *   fichiers: string[],
 *   restes: string[],
 *   descriptions: { restes: string[], manquantes: string[], aTraduire: string[] },
 * }} les fichiers réécrits ; ceux où le nom du squelette subsiste — qui doivent
 *   être vides ; et pour la description : les fichiers où un texte du squelette
 *   subsiste (vides eux aussi), les places attendues et introuvables, les
 *   phrases recopiées du français dans une autre langue.
 */
export function substituer(racine, { id, titre, description }) {
  const fichiers = [];
  const anciennes = [];
  const manquantes = [];
  const aTraduire = [];
  // Une meta description tient sur une ligne, une chaîne de dictionnaire aussi.
  const phrase = description?.replace(/\s+/g, ' ').trim();
  const vus = new Set();
  for (const rel of fichiersTexte(racine)) {
    const abs = join(racine, rel);
    const avant = readFileSync(abs, 'utf8');
    let apres = avant.split(SQUELETTE).join(id);
    apres = apres.split(SQUELETTE_TITRE).join(titre);
    // UN NOM D'UNE AUTRE LONGUEUR DÉSALIGNE LE TABLEAU QUI LE CITE, et
    // `prettier --check` refuse le fichier : l'ADR 0012 du squelette a fait
    // naître toute application engendrée depuis `main` avec une CI rouge.
    // Seuls les tableaux que la substitution a touchés sont réalignés.
    if (rel.endsWith('.md') && apres !== avant) {
      apres = realignerTableaux(
        apres,
        tableau => tableau.includes(id) || tableau.includes(titre)
      );
    }
    const reecrire =
      rel === 'package.json' ? reecrirePaquet : phrase && DESCRIPTIONS[rel];
    if (reecrire) {
      vus.add(rel);
      const r = reecrire(apres, rel === 'package.json' ? description : phrase);
      apres = r.texte;
      anciennes.push(...r.anciennes);
      manquantes.push(...r.manquantes.map(m => `${rel} : ${m}`));
      aTraduire.push(...(r.aTraduire ?? []).map(m => `${rel} : ${m}`));
    }
    if (apres !== avant) {
      writeFileSync(abs, apres);
      fichiers.push(rel);
    }
  }
  if (phrase) {
    for (const rel of Object.keys(DESCRIPTIONS)) {
      if (!vus.has(rel)) manquantes.push(`${rel} : fichier absent`);
    }
  }

  // LE README EST ÉCARTÉ du second contrôle : `readme()` le remplace en entier
  // juste après, et une phrase du squelette qu'il citerait disparaîtrait avec.
  // Un ancien texte que la nouvelle description CONTIENT n'est pas cherché :
  // on le trouverait partout où elle vient d'être écrite.
  const retirees = anciennes.filter(
    a => a && !phrase?.includes(a) && !description?.includes(a)
  );
  const restes = [];
  const restesDescription = [];
  for (const rel of fichiersTexte(racine)) {
    const texte = readFileSync(join(racine, rel), 'utf8');
    if (texte.includes(SQUELETTE)) restes.push(rel);
    if (rel !== 'README.md' && retirees.some(a => texte.includes(a))) {
      restesDescription.push(rel);
    }
  }
  return {
    fichiers,
    restes,
    descriptions: { restes: restesDescription, manquantes, aTraduire },
  };
}

/**
 * Le `package.json` de la nouvelle application : version remise à zéro, et la
 * description du squelette remplacée — sans quoi chaque application naîtrait en
 * se décrivant comme « le squelette de la famille ».
 */
function reecrirePaquet(json, description) {
  const paquet = JSON.parse(json);
  const anciennes = [];
  paquet.version = '0.1.0';
  if (description) {
    anciennes.push(paquet.description);
    paquet.description = description;
  }
  return {
    texte: JSON.stringify(paquet, null, 2) + '\n',
    anciennes,
    manquantes: [],
  };
}

/**
 * Les autres places où le squelette se décrit, et qui les réécrit.
 *
 * Pourquoi elles comptent autant que le paquet : la meta description est celle
 * que lisent les moteurs, celle que le socle sert aux robots sans JavaScript et
 * celle de ses données structurées ; `app.tagline` est la première ligne de
 * l'accueil, sous le nom de l'application, et le sous-titre d'« À propos ».
 */
const DESCRIPTIONS = {
  'index.html': reecrireMeta,
  'src/i18n/messages.ts': reecrireDictionnaires,
};

// ── Écrire comme Prettier ──────────────────────────────────────────────────
//
// L'APPLICATION ENGENDRÉE PASSE `prettier --check` À SA PREMIÈRE CI. Une phrase
// remplacée change la longueur de sa ligne, et Prettier la range autrement :
// sur une ligne ou sur deux, entre guillemets simples ou doubles. Garder
// l'ancienne mise en page avec le nouveau texte, c'est un premier push rouge.
// Les deux formes que le générateur écrit suivent donc les règles de Prettier
// avec la configuration du socle (`prettier.config.js` en est la copie
// vérifiée) ; les tests confrontent le résultat à Prettier lui-même.

/** `printWidth` et `tabWidth` du socle. */
const LARGEUR = 80;
const TABULATION = 2;

/**
 * La largeur d'un texte telle que Prettier la compte : un émoji ou un
 * idéogramme vaut deux colonnes, un accent combinant ou un caractère de
 * contrôle aucune.
 */
function largeur(texte) {
  let n = 0;
  for (const c of texte.replace(/\p{RGI_Emoji}/gv, '  ')) {
    if (SANS_LARGEUR.test(c)) continue;
    n += DOUBLE_LARGEUR.test(c) ? 2 : 1;
  }
  return n;
}
const SANS_LARGEUR = /[\p{Cc}\u0300-\u036f]/u;
const DOUBLE_LARGEUR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;

const compter = (texte, c) => texte.split(c).length - 1;

/**
 * Une chaîne TypeScript : guillemets simples (`singleQuote`), doubles si le
 * texte contient plus d'apostrophes droites que de guillemets.
 */
function chaineTs(texte) {
  const q = compter(texte, "'") > compter(texte, '"') ? '"' : "'";
  return q + texte.replaceAll('\\', '\\\\').replaceAll(q, `\\${q}`) + q;
}

/**
 * `cle: 'valeur',` sur une ligne si elle tient, sinon la valeur à la ligne
 * suivante. Jamais coupée derrière une clé de moins de `tabWidth + 3`
 * caractères : Prettier juge que le retour n'y gagnerait rien, et `what:`
 * reste sur sa ligne même à cent dix colonnes.
 */
function proprieteTs(indent, cle, texte, fin) {
  const valeur = chaineTs(texte);
  const uneLigne = `${indent}${cle}: ${valeur}${fin}`;
  if (cle.length < TABULATION + 3 || largeur(uneLigne) <= LARGEUR) {
    return uneLigne;
  }
  return `${indent}${cle}:\n${indent}${' '.repeat(TABULATION)}${valeur}${fin}`;
}

/**
 * Une valeur d'attribut HTML : guillemets doubles, simples si le texte contient
 * plus de guillemets que d'apostrophes — Prettier fait ce choix lui-même et
 * réécrit `&quot;` / `&apos;` en conséquence ; `&amp;`, `&lt;`, `&gt;` restent.
 */
function attributHtml(texte) {
  const echappe = texte
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return compter(texte, '"') > compter(texte, "'")
    ? `'${echappe.replaceAll("'", '&apos;')}'`
    : `"${echappe.replaceAll('"', '&quot;')}"`;
}

/** Une balise sur une ligne si elle tient, sinon un attribut par ligne. */
function baliseMeta(indent, attributs) {
  const uneLigne = `${indent}<meta ${attributs.join(' ')} />`;
  if (largeur(uneLigne) <= LARGEUR) return uneLigne;
  const suite = `${indent}${' '.repeat(TABULATION)}`;
  return [
    `${indent}<meta`,
    ...attributs.map(a => suite + a),
    `${indent}/>`,
  ].join('\n');
}

const ENTITES = {
  quot: '"',
  apos: "'",
  '#39': "'",
  amp: '&',
  lt: '<',
  gt: '>',
};
const decoderHtml = texte =>
  texte.replace(/&(quot|apos|#39|amp|lt|gt);/g, (_, e) => ENTITES[e]);

const CLOTURE = /^[ \t]*(`{3,}|~{3,})/;
const RANGEE = /^([ \t]*)\|.*\|[ \t]*$/;
const DELIMITEUR = /^[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/;

/** Les cellules d'une rangée : coupées aux `|` non échappés, rognées. */
const cellules = ligne =>
  ligne
    .trim()
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map(c => c.trim());

/**
 * Les tableaux Markdown d'un texte, alignés comme Prettier les aligne : chaque
 * colonne à la largeur de sa plus longue cellule (trois au moins), comptée en
 * colonnes ; la ligne de séparation en tirets, avec les deux-points de
 * l'alignement ; une cellule centrée met l'espace impair à droite.
 *
 * Un tableau garde l'indentation de sa ligne — celui de l'ADR 0012 vit dans
 * une liste. Un bloc de code n'est jamais touché : Prettier ne le formate pas.
 * Un tableau dont une rangée n'a pas le nombre de cellules de l'en-tête est
 * laissé tel quel, plutôt que deviné.
 *
 * @param {string} markdown
 * @param {(tableau: string) => boolean} [retenir]  Les tableaux à réaligner,
 *   selon leur texte ; tous par défaut.
 */
export function realignerTableaux(markdown, retenir = () => true) {
  const lignes = markdown.split('\n');
  let bloc = null;
  for (let i = 0; i < lignes.length; i++) {
    const cloture = CLOTURE.exec(lignes[i]);
    if (bloc) {
      const fin = cloture?.[1];
      if (
        fin?.[0] === bloc[0] &&
        fin.length >= bloc.length &&
        lignes[i].trim() === fin
      ) {
        bloc = null;
      }
      continue;
    }
    if (cloture) {
      bloc = cloture[1];
      continue;
    }

    const indent = RANGEE.exec(lignes[i])?.[1];
    if (indent === undefined || !DELIMITEUR.test(lignes[i + 1] ?? '')) continue;
    let fin = i + 2;
    while (fin < lignes.length && RANGEE.exec(lignes[fin])?.[1] === indent) {
      fin += 1;
    }
    const tableau = lignes.slice(i, fin);
    const saut = fin - 1;
    const [entete, separateur, ...corps] = tableau.map(cellules);
    const rangees = [entete, ...corps];
    if (
      !retenir(tableau.join('\n')) ||
      separateur.length !== entete.length ||
      corps.some(r => r.length !== entete.length)
    ) {
      i = saut;
      continue;
    }

    const alignements = separateur.map(s =>
      s.startsWith(':') && s.endsWith(':')
        ? 'centre'
        : s.endsWith(':')
          ? 'droite'
          : s.startsWith(':')
            ? 'gauche'
            : null
    );
    const largeurs = entete.map((_, c) =>
      Math.max(3, ...rangees.map(r => largeur(r[c])))
    );
    const ecrire = r =>
      `${indent}| ${r
        .map((texte, c) => {
          const espaces = largeurs[c] - largeur(texte);
          const avant =
            alignements[c] === 'droite'
              ? espaces
              : alignements[c] === 'centre'
                ? Math.floor(espaces / 2)
                : 0;
          return ' '.repeat(avant) + texte + ' '.repeat(espaces - avant);
        })
        .join(' | ')} |`;
    const tirets = largeurs.map((l, c) => {
      const a = alignements[c];
      const debut = a === 'gauche' || a === 'centre' ? ':' : '-';
      const bout = a === 'droite' || a === 'centre' ? ':' : '-';
      return debut + '-'.repeat(l - 2) + bout;
    });
    lignes.splice(
      i,
      tableau.length,
      ecrire(entete),
      `${indent}| ${tirets.join(' | ')} |`,
      ...corps.map(ecrire)
    );
    i = saut;
  }
  return lignes.join('\n');
}

// ── Les places ─────────────────────────────────────────────────────────────

/** Les balises qui portent la description d'une page. */
const META_DESCRIPTION = new Set([
  'description',
  'og:description',
  'twitter:description',
]);

/**
 * Celles dont l'absence se signale. Pas `twitter:description` : le squelette
 * n'en porte pas — `twitter:card` retombe sur `og:description` —, et un
 * avertissement qui sonne à chaque naissance n'avertit plus de rien.
 */
const META_ATTENDUES = ['description', 'og:description'];

/**
 * Les balises meta d'`index.html`. Une balise en commentaire n'est pas une
 * balise : l'alternative consomme les commentaires d'abord et les rend tels
 * quels.
 */
function reecrireMeta(html, phrase) {
  const anciennes = [];
  const trouvees = new Set();
  const texte = html.replace(
    /<!--[\s\S]*?-->|^([ \t]*)<meta\b([^>]*)>/gim,
    (balise, indent, interieur) => {
      if (indent === undefined) return balise;
      const attributs = [
        ...interieur
          .replace(/\/\s*$/, '')
          .matchAll(/([^\s=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g),
      ].map(([brut, nom, valeur]) => ({
        brut,
        nom: nom.toLowerCase(),
        valeur: valeur?.replace(/^["']|["']$/g, ''),
      }));
      const cle = attributs
        .find(a => a.nom === 'name' || a.nom === 'property')
        ?.valeur?.toLowerCase();
      const contenu = attributs.find(a => a.nom === 'content');
      if (!META_DESCRIPTION.has(cle) || !contenu) return balise;
      trouvees.add(cle);
      anciennes.push(decoderHtml(contenu.valeur ?? ''));
      contenu.brut = `content=${attributHtml(phrase)}`;
      return baliseMeta(
        indent,
        attributs.map(a => a.brut)
      );
    }
  );
  return {
    texte,
    anciennes,
    manquantes: META_ATTENDUES.filter(c => !trouvees.has(c)).map(
      c => `<meta ${c}>`
    ),
  };
}

/** Dans chaque dictionnaire, les deux phrases qui disent ce qu'est l'app. */
const PHRASES = [
  ['app', 'tagline'],
  ['about', 'what'],
];

/** Posé au-dessus d'une phrase recopiée dans une autre langue que le français. */
export const A_TRADUIRE =
  '// TODO traduire : create-lg-pwa-app a recopié ici la description française.';

/**
 * `app.tagline` et `about.what`, dans chaque dictionnaire de
 * `src/i18n/messages.ts`.
 *
 * L'INDENTATION EST UNE STRUCTURE FIABLE ICI, parce que la CI du squelette
 * exige Prettier : un dictionnaire est un `const <locale> … = {` fermé par `};`
 * en colonne zéro, ses sections sont à deux espaces, leurs clés à quatre. Un
 * `tagline:` dans un commentaire ou dans un objet imbriqué n'a pas cette forme.
 *
 * L'ANGLAIS REÇOIT LE TEXTE FRANÇAIS, marqué d'un commentaire. Les deux autres
 * choix sont pires : garder la phrase du squelette, c'est la laisser mentir
 * dans l'autre langue — celle qu'un navigateur sans préférence, ou un robot,
 * obtient souvent ; mettre le marqueur DANS la chaîne, c'est l'afficher sur
 * l'accueil et le donner à lire aux moteurs. Une phrase juste dans la mauvaise
 * langue se voit, se cherche (`TODO traduire`) et ne dit rien de faux.
 */
function reecrireDictionnaires(source, phrase) {
  const anciennes = [];
  const manquantes = [];
  const aTraduire = [];
  let dictionnaires = 0;
  const texte = source.replace(
    /^(const (\w+)\b[^=\n]*= \{\n)([\s\S]*?)^\};$/gm,
    (tout, entete, locale, corps) => {
      if (!/^ {2}app: \{$/m.test(corps)) return tout;
      dictionnaires += 1;
      for (const [section, cle] of PHRASES) {
        const chemin = `${locale}.${section}.${cle}`;
        let trouvee = false;
        corps = corps.replace(
          new RegExp(String.raw`^ {2}${section}: \{\n[\s\S]*?^ {2}\},?$`, 'm'),
          bloc =>
            bloc.replace(
              new RegExp(
                String.raw`^( {4})${cle}:\s*(['"])((?:\\.|(?!\2)[^\\\n])*)\2(,?)$`,
                'm'
              ),
              (_, indent, _q, brut, fin) => {
                trouvee = true;
                anciennes.push(brut.replace(/\\(.)/g, '$1'));
                const ligne = proprieteTs(indent, cle, phrase, fin);
                if (locale === 'fr') return ligne;
                aTraduire.push(chemin);
                return `${indent}${A_TRADUIRE}\n${ligne}`;
              }
            )
        );
        if (!trouvee) manquantes.push(chemin);
      }
      return `${entete}${corps}};`;
    }
  );
  if (!dictionnaires) manquantes.push('aucun dictionnaire');
  return { texte, anciennes, manquantes, aTraduire };
}

/**
 * Ce que l'écran d'accueil engendré demande de garder quand l'exemple part.
 *
 * L'exemple des notes est fait pour disparaître, mais depuis
 * pwa-starter-kit#67 `HomeScreen` s'ouvre sur l'accroche (`app.tagline`) — la
 * seule phrase qu'un moteur associe à la page, et que personne ne remarque
 * quand elle manque — et se ferme sur le pied de page de la famille. Avant
 * (`v1.2.0`), il n'avait ni l'une ni l'autre : le pied de page était rendu par
 * la coquille. Le générateur LIT l'écran engendré plutôt que de supposer une
 * version du squelette, et le README comme le message final disent ce qu'il
 * contient vraiment.
 *
 * @param {string} [source]  Le texte de `src/features/home/HomeScreen.tsx`.
 * @returns {{ accroche: boolean, piedDePage: boolean }}
 */
export function ceQueLAccueilGarde(source = '') {
  return {
    accroche: /\bt\(\s*['"]app\.tagline['"]\s*\)/.test(source),
    piedDePage: /<AppFooter\b/.test(source),
  };
}

/**
 * Le README de la nouvelle application.
 *
 * Celui du squelette EXPLIQUE LE SQUELETTE : le garder ferait naître chaque
 * application avec une page qui parle d'autre chose, et personne ne la
 * réécrirait — c'est ainsi qu'on trouve des README de gabarit en production.
 * Les décisions (`docs/adr/`), elles, sont conservées : elles s'appliquent bien
 * à la nouvelle application.
 *
 * « Supprimer l'exemple » ne se dit tel quel que si l'accueil n'a rien à
 * garder : voir `ceQueLAccueilGarde`.
 */
export function readme({
  id,
  titre,
  description,
  accueil = ceQueLAccueilGarde(),
}) {
  const garde = [
    accueil.accroche &&
      `   - sa première ligne, l'accroche \`app.tagline\` : la seule phrase que les
     moteurs associent à la page ;`,
    accueil.piedDePage &&
      `   - sa dernière, le pied de page de la famille, que la règle veut sur
     l'accueil et que \`pwa-doctor --strict\` contrôle ;`,
  ].filter(Boolean);
  const exemple = garde.length
    ? `3. écrire le métier dans \`src/features/\`, et **remplacer l'exemple de
   \`src/features/home/\`** — il est là pour ça. L'accueil, lui, garde :
${garde.join('\n')}`
    : `3. écrire le métier dans \`src/features/\`, et **supprimer \`src/features/home/\`**,
   la fonctionnalité d'exemple — elle est là pour ça ;`;
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
${exemple}
4. ajuster la palette dans \`src/index.css\` et les couleurs de \`vite.config.ts\` ;
5. si l'application a un backend : poser \`VITE_SUPABASE_URL\` et
   \`VITE_SUPABASE_ANON_KEY\` en **variables** du dépôt, et appliquer
   \`supabase/\` — sinon supprimer ce dossier et les deux workflows Supabase ;
6. relire la description — la meta d'\`index.html\`, \`app.tagline\` et
   \`about.what\` de \`src/i18n/messages.ts\` — et traduire l'anglais, marqué
   \`TODO traduire\`.

## Les décisions

Héritées du squelette et valables ici : [\`docs/adr/\`](./docs/adr/README.md).
Une application qui s'en écarte le fait, et l'écrit.

## Licence

MIT — voir [LICENSE](./LICENSE).
`;
}
