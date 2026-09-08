# Module shape_outliner

Detourage de formes dans une image, pense pour preparer des masques de
video mapping.

## Ce que fait l'IA (v1)

Detection de contours classique (OpenCV: flou -> Canny -> findContours),
avec un filtre sur l'aire minimale des formes retenues. Ces seuils sont la
"base" apprise: chaque "Mal" les ajuste (voir `task.py: learn_from_feedback`).
Precisez dans le champ note si "il en manque" (l'IA devient plus sensible)
ou si "trop de bruit" (l'IA devient moins sensible); sans precision, un
"Mal" est traite par defaut comme trop de bruit detecte.

## Aller plus loin

Pour du vrai apprentissage (segmentation par reseau de neurones, type SAM
ou un modele entraine maison sur vos formes), remplacez le corps de
`act()` en gardant la meme signature (`observation` avec `image_base64` en
entree, `shapes` + `preview_base64` en sortie) — le reste de l'environnement
(UI, feedback, bases) continue de fonctionner sans changement.
