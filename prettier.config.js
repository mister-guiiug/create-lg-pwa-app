/**
 * La SEULE configuration de la famille qui ne vient pas du socle, et c'est la
 * raison d'être de ce dépôt : `@mister-guiiug/dev-pwa-config` vit sur GitHub
 * Packages, qui exige un jeton même pour un paquet public. Un générateur qui en
 * dépendrait ne s'installerait pas sur un poste vierge — c'est-à-dire dans le
 * seul cas où on l'appelle.
 *
 * Les valeurs sont recopiées de `prettier-base.js` du socle. Un test les
 * compare au fichier publié à chaque exécution : la copie est assumée, sa
 * dérive ne l'est pas.
 */
export default {
  singleQuote: true,
  tabWidth: 2,
  printWidth: 80,
  trailingComma: 'es5',
  arrowParens: 'avoid',
};
