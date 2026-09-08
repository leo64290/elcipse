# Module esp32_robot

IA de pilotage a distance d'un petit robot base sur un ESP32.

## Cablage / firmware

1. Flashez `firmware/esp32_robot_controller.ino` sur l'ESP32 (Arduino IDE ou
   PlatformIO), en renseignant votre SSID/mot de passe WiFi et en adaptant
   les pins au cablage reel (capteur ultrason + pont en H moteurs).
2. Notez l'adresse IP affichee dans le moniteur serie au demarrage.
3. Dans l'UI de l'AI Lab, renseignez cette IP dans le champ "IP de l'ESP32"
   pour que les commandes soient envoyees en direct au robot. Sans IP, la
   tache tourne quand meme (mode simulation): elle calcule la commande mais
   ne l'envoie a personne, utile pour tester la logique de decision seule.

## Ce que fait l'IA

Politique de depart tres simple: en dessous d'un seuil de distance
(`obstacle_distance_cm`, 20 cm par defaut), elle tourne pour eviter
l'obstacle; au dessus, elle avance. Chaque "Bien"/"Mal" envoye depuis l'UI
ajuste ce seuil (voir `task.py: learn_from_feedback`).

## Aller plus loin

L'interface `core.task_base.Task` ne change pas si vous remplacez cette
politique a seuil par un vrai modele (reseau de neurones, RL...): gardez
`act()`, `get_state()`/`load_state()` et `learn_from_feedback()` avec la
meme signature.
