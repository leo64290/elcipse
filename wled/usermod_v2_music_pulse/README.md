# Music Pulse — pattern audio-réactive pour WLED

Deux effets WLED personnalisés, réactifs à la musique, empaquetés dans un seul
usermod (aucune modification du code source de WLED nécessaire) :

- **Music Pulse** (ruban 1D) — un spectre 16 bandes réparti sur le ruban,
  avec un flash sur chaque beat détecté et une teinte optionnelle qui suit la
  fréquence dominante (grave → aigu).
- **Music Pulse Matrix** (matrice 2D) — un vrai analyseur de spectre en
  barres, avec pics qui retombent lentement (peak-hold), même logique de
  flash sur les beats et de teinte par fréquence.

Le code s'appuie sur les données FFT de l'usermod officiel **audioreactive**
(16 bandes de fréquence, détection de beat, fréquence dominante). Sans
micro/usermod audioreactive actif, WLED simule un signal sonore : l'effet
reste utilisable pour prévisualiser l'animation.

## Installation

1. Copiez le dossier `usermod_v2_music_pulse/` dans le dossier `usermods/`
   de votre copie du dépôt [wled/WLED](https://github.com/wled/WLED).
2. Dans `platformio_override.ini`, ajoutez le usermod à la liste
   (avec `audioreactive`, indispensable pour la vraie réactivité audio) :

   ```ini
   [common]
   custom_usermods = audioreactive usermod_v2_music_pulse
   ```

3. Configurez `audioreactive` avec votre micro (I2S ou analogique) suivant la
   [doc officielle](https://kno.wled.ge/features/audio-reactive/), puis
   compilez et flashez comme d'habitude
   ([guide de compilation](https://kno.wled.ge/advanced/compiling-wled/)).
4. Une fois flashé, les effets **Music Pulse** et **Music Pulse Matrix**
   apparaissent dans la liste des effets WLED (icône 🔊 = audio-réactif).

## Réglages (sliders / cases à cocher)

| Contrôle | Effet | Rôle |
| :-- | :-- | :-- |
| Vitesse (Fade/Snap) | 1D + 2D | Vitesse de décroissance du flash de beat / des pics retombants. Plus haut = plus nerveux. |
| Intensité (Sensitivity) | 1D + 2D | Sensibilité/gain appliqué au niveau audio (utile si la musique est faible ou trop forte). |
| Custom 1 (Beat flash) | 1D + 2D | Force du flash déclenché à chaque beat détecté. |
| Custom 2 (Color travel) | 1D + 2D | Vitesse de défilement des couleurs dans le temps (0 = couleurs fixes par position). |
| Case 1 (Mirror) | 1D seulement | Le spectre part du centre du ruban et se reflète des deux côtés. |
| Case 2 (Beat flash) | 1D + 2D | Active/désactive le flash sur détection de beat. |
| Case 3 (Pitch color) | 1D + 2D | La couleur de base suit la note/fréquence dominante jouée. |
| Couleur 3 | 1D + 2D | Couleur utilisée pour le flash de beat (par défaut blanc si non définie). |
| Palette | 1D + 2D | Palette utilisée pour colorer les bandes de fréquence. |

## Détails techniques

- `fftResult[16]` (bandes de fréquence), `samplePeak` (détection de beat) et
  `FFT_MajorPeak` (fréquence dominante) sont lus via l'API standard
  `um_data_t` de l'usermod audioreactive (voir le bloc `DEV INFO` en haut de
  `wled00/FX.cpp` dans le dépôt WLED).
- Sans données audio disponibles, `simulateSound()` fournit un signal simulé
  — c'est le même mécanisme que celui utilisé par les effets audio du cœur
  de WLED.
- L'ID d'usermod utilisé (`USERMOD_ID_UNSPECIFIED`) est celui prévu pour les
  usermods personnalisés qui n'ont pas besoin d'un ID unique enregistré dans
  `wled00/const.h`.

Ce code a été écrit et vérifié en comparant chaque appel d'API (métadonnées
d'effet, lecture des données audio, fonctions de rendu pixel) au code source
réel du dépôt [wled/WLED](https://github.com/wled/WLED) et à l'usermod
d'exemple [`user_fx`](https://github.com/wled/WLED/tree/main/usermods/user_fx).
Non compilé/testé sur matériel réel — vérifiez le comportement à la
compilation et ajustez les valeurs par défaut à votre goût.
