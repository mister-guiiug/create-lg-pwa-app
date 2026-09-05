// La configuration Prettier est une COPIE de celle du socle, et une copie
// dérive. Ce test va lire le fichier publié sur GitHub et compare.
//
// POURQUOI UNE COPIE PLUTÔT QU'UN IMPORT. Le socle vit sur GitHub Packages, qui
// exige un jeton même pour un paquet public : un générateur qui en dépendrait
// ne s'installerait pas sur un poste vierge — le seul cas où on l'appelle.
//
// Le test SAUTE sans réseau plutôt que d'échouer : il vérifie une dérive, pas
// la connectivité de la machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import configLocale from '../prettier.config.js';

const SOURCE =
  'https://raw.githubusercontent.com/mister-guiiug/dev-pwa-config/main/prettier-base.js';

test('la copie de la config Prettier n’a pas dérivé du socle', async t => {
  let source;
  try {
    const reponse = await fetch(SOURCE, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!reponse.ok)
      return t.skip(`socle injoignable : HTTP ${reponse.status}`);
    source = await reponse.text();
  } catch (cause) {
    return t.skip(`socle injoignable : ${cause.message}`);
  }

  // Le fichier du socle est un module ; on en lit les valeurs sans l'exécuter,
  // pour ne pas importer du code distant dans un test.
  for (const [cle, attendu] of Object.entries(configLocale)) {
    const valeur =
      typeof attendu === 'string' ? `'${attendu}'` : String(attendu);
    assert.ok(
      new RegExp(
        `${cle}\\s*:\\s*${valeur.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}`
      ).test(source),
      `${cle}: ${valeur} — absent de prettier-base.js du socle`
    );
  }
});
