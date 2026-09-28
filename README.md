# create-lg-pwa-app

Une application PWA de la famille `miss-*` / `mister-*`, en une commande.

```bash
npx github:mister-guiiug/create-lg-pwa-app miss-exemple
```

```bash
npx github:mister-guiiug/create-lg-pwa-app miss-exemple --publish
```

**Sans `--from`, l'application part de la dernière étiquette du squelette,
`v1.2.0` du 06/09/2026, et non de la pointe de `main`**, que seul
`--from main` donne.

## Pourquoi `npx github:` et pas un paquet publié

Le socle vit sur **GitHub Packages, qui exige un jeton même pour un paquet
public**. Un `npx create-lg-pwa-app` ne résoudrait donc rien sur un poste
vierge — c'est-à-dire dans le seul cas où on l'appelle.

Tiré depuis GitHub, ce générateur n'a **aucune dépendance** et démarre avant
que le moindre `.npmrc` n'existe. Son installation, elle, lit le registre npm
(`npm@10.9.8`) et GitHub Packages, par le `.npmrc` du squelette : exporter
`NODE_AUTH_TOKEN` (un jeton avec `read:packages`) avant de l'appeler, ou passer
`--no-install`. Sans jeton, elle échoue après la copie du squelette, et le
dossier `./<id>` qui reste bloque une seconde tentative tant qu'on ne l'a pas
effacé.

## Il ne contient aucun gabarit d'application

C'est sa propriété principale. Il tire
[`pwa-starter-kit`](https://github.com/mister-guiiug/pwa-starter-kit), un dépôt
vivant, testé et déployé, dont la CI vérifie à chaque commit qu'il se construit
et reste conforme au parc. Seuls le README engendré et `.claude/launch.json`
sont écrits par le générateur lui-même.

**Mais il le tire à sa dernière étiquette, pas à la pointe que cette CI
éprouve.** Sans `--from`, c'est `v1.2.0`, posée le 06/09/2026, soixante-six
commits derrière `main` au 28/09 : socle 4 et workflows `@v4`, sans
l'annulation des suppressions, la suppression de compte, la file hors ligne ni
la mesure d'audience du squelette actuel, et avec le pied de page encore dans
la coquille. `--from main` part de la pointe.

Un générateur qui embarque ses gabarits est un **troisième endroit où la même
chose vieillit**, après la bibliothèque et le squelette. Le parc en a déjà fait
l'expérience : treize dépôts ont étendu pendant des mois un préréglage Renovate
logé dans un dépôt qui n'existait pas, et rien ne l'a dit — un gabarit cassé ne
fait pas de bruit, il ne fait rien.

## Ce qu'il fait

| Étape          | Ce qu'elle règle                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Téléchargement | l'archive du squelette à sa **dernière étiquette**, `v1.2.0` depuis le 06/09/2026 (ou à la référence demandée, `--from main` pour la pointe), sans son historique                                  |
| Identité       | l'identifiant **et** le nom affiché, tableaux Markdown réalignés ; un contrôle refuse toute trace de l'identifiant, mais le nom court « Starter Kit » d'`index.html` n'est ni remplacé ni contrôlé |
| Description    | `--description` à chaque place où le squelette se décrit ; un contrôle refuse qu'une de ses phrases subsiste                                                                                       |
| README         | réécrit pour la nouvelle application : celui du squelette parle du squelette                                                                                                                       |
| `npm install`  | par **npm 10.9.8**, figé dans le générateur ; la CI de la famille, elle, tourne en npm 11 (Node 26.10.0)                                                                                           |
| Port           | le prochain port de développement libre du catalogue, dans `.claude/launch.json` et `vite.config.ts`, à l'installation seulement ; `supabase/config.toml` garde 5240                               |
| Construction   | `npm run build` (budget de poids et `pwa-doctor --strict`) sur l'application engendrée, avant toute publication                                                                                    |
| Premier commit | conventionnel, sur `main`                                                                                                                                                                          |
| `--publish`    | dépôt public, poussée, **Pages activées par un PUT**, `homepage` et sujets sur la fiche du dépôt                                                                                                   |

Les deux dernières lignes sont sa vraie valeur. Substituer un nom prend dix
lignes ; ce que personne n'avait automatisé, ce sont les gestes d'après et
leurs pièges :

- **le lockfile doit venir de la version de npm du runner** : le job
  « Lockfile in sync » de la CI famille rejoue l'installation avec elle et
  exige zéro diff. C'est npm 11 depuis le passage du parc en Node 26 (npm
  11.19.1 sur Node 26.10.0, relevé le 27/09/2026), quand le générateur installe
  encore en npm 10.9.8 ; or npm 10 retire les champs `libc` qu'écrit npm 11, et
  que le lockfile du squelette porte à `main` ;
- **Pages créées par un POST** rendent bien `build_type: workflow`, mais GitHub
  garde `source: {branch, path}` et le constructeur Jekyll reprend la main à
  chaque poussée — il republie le README rendu à la place de l'application. Le
  symptôme est un `<title>` qui vaut le nom du dépôt.

## La description

Le squelette se décrit à cinq places : `package.json`, la meta `description`
et `og:description` d'`index.html` (plus `twitter:description` si elle
existe), et dans chaque dictionnaire de `src/i18n/messages.ts`, `app.tagline`
— le sous-titre d'« À propos » et, depuis pwa-starter-kit#67, la première
ligne de l'accueil — et `about.what`. Laissées telles quelles, elles font
naître chaque application en se présentant comme le squelette, **auprès des
moteurs d'abord** : la meta description est aussi ce que le socle sert aux
robots sans JavaScript et ce qu'il met dans les données structurées.

Depuis `v1.2.0`, le squelette se décrit aussi dans le `<title>` et l'`og:title`
d'`index.html` (« … - squelette d'application web installable »), dans
`content/pages/creer-une-pwa-avec-react-et-vite.md` et dans
`public/og-image.jpg`, que le générateur ne touche pas : une application
engendrée depuis `main` s'y présente encore comme le squelette.

Le générateur ne connaît pas ces phrases, qui changent d'une étiquette du
squelette à l'autre : il réécrit ce qui **occupe ces places**, retient ce
qu'il a retiré, et **échoue** si l'une de ces phrases subsiste ailleurs. Une
place introuvable n'arrête rien — le squelette a pu la retirer — mais elle
s'annonce. Les deux formes réécrites suivent la mise en page de Prettier :
la première CI de l'application joue `prettier --check`.

**L'anglais reçoit la phrase française**, avec un commentaire
`// TODO traduire` au-dessus. Garder la phrase du squelette, c'est la
laisser mentir dans l'autre langue ; mettre le marqueur dans la chaîne,
c'est l'afficher sur l'accueil et le donner aux moteurs. Une phrase juste
dans la mauvaise langue ne dit rien de faux, et se retrouve par une recherche.

**L'exemple part, l'accroche reste.** Le README engendré et le message final
disent de remplacer la fonctionnalité d'exemple de `src/features/home/` —
mais pas de supprimer l'écran entier quand il porte l'accroche et le pied de
page de la famille. Le générateur le LIT dans l'écran engendré, sans supposer
de version du squelette : à `v1.2.0`, l'accueil n'avait ni l'une ni l'autre.

## Ce qu'il ne fait pas, et pourquoi

- **Poser un secret.** Un générateur qui écrit des secrets est un générateur
  qui les connaît. Il imprime ce qui reste à poser, et, pour une application
  qui prendra un projet Supabase, la liste de ce qui manque en silence
  (variables, secrets, table `keep_alive`, adresse de retour du lien, hook de
  rôle). Il y manque encore les lignes `build-env` de `deploy.yml` que
  `PARAMETRAGE.md` du socle exige : `pwa-deploy.yml` n'injecte que ce qu'on
  lui passe, et sans elles le site publié reste en local.
- **Protéger la branche.** Cela vit dans le socle
  (`node scripts/apply-rulesets.mjs <id>`), qui lit le compte : le dépôt neuf y
  est déjà.
- **Inscrire l'application au catalogue.** C'est une pull request sur le socle,
  donc une relecture — et sans elle, l'application n'apparaît pas chez ses
  sœurs.

## Options

```
<id>              nom du dépôt : miss-exemple, mister-exemple
--nom "<titre>"   nom affiché (défaut : déduit de l'id)
--description "…" ce que fait l'app : paquet, meta description, accroche de l'accueil
--from <ref>      branche ou étiquette du squelette (défaut : sa dernière étiquette, sinon main)
--dir <chemin>    dossier de sortie (défaut : ./<id>)
--publish         crée le dépôt GitHub, pousse, active Pages (exige gh)
--no-install      n'installe pas les dépendances (donc ne construit pas)
--no-build        installe mais ne construit pas
```

Un identifiant hors convention `miss-*` / `mister-*` est **accepté mais
signalé** : un outil interne a le droit de s'appeler autrement, ce qui coûte
c'est de ne pas le savoir.

## Vérifier

```bash
npm test
```

Les tests éprouvent la substitution sur un faux squelette — c'est ce qui peut
casser **en silence** : une substitution incomplète produit une application qui
se construit, se déploie, et porte le nom du squelette dans son manifeste. Rien
n'échoue ; on s'en aperçoit en production.

La CI y ajoute le seul test que les tests unitaires ne peuvent pas faire :
engendrer depuis le squelette **réel**, et vérifier l'accord entre les deux
dépôts. Elle engendre depuis sa dernière étiquette, que l'application installe,
construit et passe à son propre `format:check` ; puis depuis la **pointe de
`main`**, dont l'arbre passe Prettier lui aussi — ce qui a été ajouté au
squelette depuis l'étiquette n'est éprouvé nulle part ailleurs.

## Licence

MIT — voir [LICENSE](./LICENSE).
