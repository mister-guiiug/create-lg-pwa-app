# create-lg-pwa-app

Une application PWA de la famille `miss-*` / `mister-*`, en une commande.

```bash
npx github:mister-guiiug/create-lg-pwa-app miss-exemple
```

```bash
npx github:mister-guiiug/create-lg-pwa-app miss-exemple --publish
```

## Pourquoi `npx github:` et pas un paquet publié

Le socle vit sur **GitHub Packages, qui exige un jeton même pour un paquet
public**. Un `npx create-lg-pwa-app` ne résoudrait donc rien sur un poste
vierge — c'est-à-dire dans le seul cas où on l'appelle.

Tiré depuis GitHub, ce générateur n'a **aucune dépendance** et ne touche aucun
registre. Il marche avant que le moindre `.npmrc` n'existe.

## Il ne contient aucun gabarit

C'est sa propriété principale. Il tire
[`pwa-starter-kit`](https://github.com/mister-guiiug/pwa-starter-kit), un dépôt
vivant, testé et déployé, dont la CI vérifie à chaque commit qu'il se construit
et reste conforme au parc.

Un générateur qui embarque ses gabarits est un **troisième endroit où la même
chose vieillit**, après la bibliothèque et le squelette. Le parc en a déjà fait
l'expérience : treize dépôts ont étendu pendant des mois un préréglage Renovate
logé dans un dépôt qui n'existait pas, et rien ne l'a dit — un gabarit cassé ne
fait pas de bruit, il ne fait rien.

## Ce qu'il fait

| Étape          | Ce qu'elle règle                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Téléchargement | l'archive du squelette à sa **dernière étiquette** (ou à la référence demandée), sans son historique |
| Identité       | l'identifiant **et** le nom affiché ; un contrôle refuse la moindre trace restante                   |
| README         | réécrit pour la nouvelle application — celui du squelette parle du squelette                         |
| `npm install`  | par **npm 10**, la version du runner                                                                 |
| Premier commit | conventionnel, sur `main`                                                                            |
| `--publish`    | dépôt public, poussée, et **Pages activées par un PUT**                                              |

Les deux dernières lignes sont sa vraie valeur. Substituer un nom prend dix
lignes ; ce que personne n'avait automatisé, ce sont les gestes d'après et
leurs pièges :

- **un lockfile écrit par npm 11** porte un champ `libc` que npm 10 retire. Le
  job « Lockfile in sync » de la CI famille rejoue l'installation avec la
  version du runner et exige zéro diff : CI rouge au premier push, avec un
  message qui parle de bindings natifs ;
- **Pages créées par un POST** rendent bien `build_type: workflow`, mais GitHub
  garde `source: {branch, path}` et le constructeur Jekyll reprend la main à
  chaque poussée — il republie le README rendu à la place de l'application. Le
  symptôme est un `<title>` qui vaut le nom du dépôt.

## Ce qu'il ne fait pas, et pourquoi

- **Poser un secret.** Un générateur qui écrit des secrets est un générateur
  qui les connaît. Il imprime ce qui reste à poser.
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
--description "…" description du paquet et du manifeste
--from <ref>      branche ou étiquette du squelette (défaut : sa dernière étiquette, sinon main)
--dir <chemin>    dossier de sortie (défaut : ./<id>)
--publish         crée le dépôt GitHub, pousse, active Pages (exige gh)
--no-install      n'installe pas les dépendances
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
dépôts.

## Licence

MIT — voir [LICENSE](./LICENSE).
