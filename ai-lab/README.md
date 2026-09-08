# AI Lab

Environnement local pour creer et entrainer plusieurs IA independantes, une
par tache (piloter un robot ESP32, detourer des formes pour du mapping
video, et n'importe quel autre module ajoute plus tard), avec:

- un seul endroit pour lister/lancer toutes ces IA (une interface web
  locale),
- une boucle de feedback "bien / mal" pour chaque decision prise par une IA,
- un registre de "bases" (parametres/checkpoints appris) par tache, pour
  reprendre un entrainement deja fait au lieu de repartir de zero.

Ce n'est pas un projet pour une seule IA: c'est le socle commun sur lequel
brancher chaque nouvelle tache.

## Demarrage rapide (sur votre PC)

```bash
cd ai-lab
./run.sh
```

Puis ouvrez http://127.0.0.1:8000 — deux modules d'exemple sont deja
branches: `esp32_robot` (pilotage robot) et `shape_outliner` (detourage de
formes). Choisissez une tache, faites-la agir, notez le resultat "Bien" ou
"Mal", et regardez le panneau "Bases" a droite pour sauvegarder ou changer
l'etat appris.

`run.sh` cree un environnement virtuel Python, installe `requirements.txt`
et lance le serveur (`uvicorn`, rechargement automatique en developpement).

## Comment ca marche

```
ai-lab/
  core/            interface commune Task, feedback, registre de bases
  tasks/           un dossier par IA/tache (module independant)
  server/          API + interface web qui pilote n'importe quelle tache
  models_store/    bases sauvegardees (fichiers JSON/binaires par tache)
  data/            base sqlite avec l'historique des samples et du feedback
```

Chaque tache est une classe qui herite de `core.task_base.Task` et
implemente:

- `act(observation) -> Sample` : prend une observation, decide d'une
  action,
- `get_state()` / `load_state()` : serialise/recharge les parametres
  appris (= une "base"),
- `learn_from_feedback(sample, rating, note)` : ajuste ces parametres a
  partir d'un retour "good"/"bad" envoye depuis l'UI.

Le reste de l'environnement (API, UI, sauvegarde des bases, historique du
feedback) est generique et ne connait rien du contenu specifique d'une
tache: il appelle juste ces quatre methodes.

## Ajouter une nouvelle IA/tache

1. Creez `tasks/mon_module/task.py` avec une classe qui herite de `Task`
   (voir `tasks/shape_outliner/task.py` pour un exemple court, ou
   `tasks/esp32_robot/task.py` pour un exemple qui parle a du materiel).
2. Enregistrez-la dans `core/registry.py` (`TASK_CLASSES`).
3. C'est tout: elle apparait automatiquement dans l'UI, peut recevoir du
   feedback, et peut sauvegarder/charger des bases. Si sa forme
   d'observation ne correspond a aucun formulaire dedie dans
   `server/static/app.js`, l'UI retombe sur un formulaire JSON brut — ca
   marche tout de suite, meme sans toucher au frontend.

## Recuperer une base deja entrainee

Dans le panneau "Bases" de l'UI (pour la tache concernee): "Importer" un
fichier de base existant (recupere d'un autre poste, d'une tache proche,
ou d'un entrainement precedent), puis "Activer" pour que la tache
l'utilise immediatement. "Sauvegarder l'etat courant" fige l'apprentissage
en cours dans une nouvelle base, pour y revenir plus tard ou la partager.

## Limites assumees de la v1

Les deux modules d'exemple utilisent des politiques simples (seuils
ajustes par le feedback), pas de reseau de neurones entraine par descente
de gradient. C'est volontaire: l'objectif de cette premiere version est
l'environnement (registre de taches, feedback, bases reutilisables) plutot
qu'un algorithme d'apprentissage precis pour un cas particulier. Chaque
module peut etre remplace par un vrai modele ML plus tard sans changer
l'interface `Task`, ni l'UI, ni l'API.
