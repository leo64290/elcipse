#include "wled.h"

// for information how FX metadata strings work see https://kno.wled.ge/interfaces/json-api/#effect-metadata
//
// "Music Pulse" - a pair of audio-reactive WLED effects (1D strip + 2D matrix)
// driven by the official "audioreactive" usermod's FFT data (fftResult[16],
// dominant frequency, beat/peak detection). Works without a microphone too:
// WLED falls back to a simulated audio signal so the effect can be previewed.
//
// - Music Pulse (1D): a 16-band spectrum spread across the strip, optionally
//   mirrored from the center, that flashes on detected beats and can tint
//   itself by the dominant pitch.
// - Music Pulse Matrix (2D): a classic spectrum-analyzer bar graph with
//   falling peak-hold caps, same beat flash / pitch tint options.

// paletteBlend: 0 - wrap when moving, 1 - always wrap, 2 - never wrap, 3 - none (undefined)
#define PALETTE_SOLID_WRAP   (paletteBlend == 1 || paletteBlend == 3)

// a constant needed for the pitch->color mapping (assumes 22kHz sampling, same as core WLED)
#define MP_MAX_FREQ_LOG10 4.04238f // log10(11025), i.e. log10(sample frequency / 2)

// static effect, used if an effect fails to initialize
static void mode_static(void) {
  SEGMENT.fill(SEGCOLOR(0));
}

#define FX_FALLBACK_STATIC { mode_static(); return; }

constexpr uint8_t MP_NUM_BANDS = 16; // matches audioreactive's fftResult[] size - do not change

/////////////////////////////
//  Shared audio handling  //
/////////////////////////////

// Values shared by both the 1D and 2D Music Pulse effects, derived once per
// frame from the audioreactive usermod's data (or simulated data as fallback).
struct MusicPulseData {
  uint8_t *fftResult;   // 16 frequency bands, 0-255 each, low to high
  float    gain;         // sensitivity multiplier applied to fftResult
  uint8_t  pitchHue;      // palette offset derived from the dominant frequency
  uint8_t  flash;         // current beat-flash brightness (0-255), decays over time
  uint32_t flashColor;    // color used for the beat flash
};

static MusicPulseData getMusicPulseData() {
  um_data_t *um_data;
  if (!UsermodManager::getUMData(&um_data, USERMOD_ID_AUDIOREACTIVE)) {
    um_data = simulateSound(SEGMENT.soundSim); // no mic / usermod disabled - fake it so the FX is still previewable
  }

  MusicPulseData d;
  d.fftResult             =  (uint8_t*) um_data->u_data[2];
  uint8_t samplePeak       = *(uint8_t*) um_data->u_data[3];
  float   FFT_MajorPeak    = *(float*)   um_data->u_data[4];

  // "Sensitivity" slider: 0.5x (quiet room, boost weak signal) .. 3.5x (loud, tame clipping)
  d.gain = 0.5f + (SEGMENT.intensity / 255.0f) * 3.0f;

  // "Pitch color" checkbox: shift the base palette index by the dominant note's frequency
  d.pitchHue = 0;
  if (SEGMENT.check3 && FFT_MajorPeak > 1.0f) {
    float logF = log10f(FFT_MajorPeak);
    d.pitchHue = (uint8_t)constrain((logF - 1.78f) * 255.0f / (MP_MAX_FREQ_LOG10 - 1.78f), 0.0f, 255.0f);
  }

  // "Beat flash" checkbox: on a detected beat, flash toward the 3rd color and let it decay.
  // Brightness/duration of the flash persists across frames in SEGENV.aux0.
  uint8_t flash = SEGENV.aux0 & 0xFF;
  if (SEGMENT.check2 && samplePeak) {
    flash = 40 + SEGMENT.custom1; // "Beat flash" slider sets how strong the flash is
  } else {
    uint8_t flashDecay = 6 + (SEGMENT.speed >> 3); // higher "Fade/Snap" = quicker flash decay
    flash = (flash > flashDecay) ? flash - flashDecay : 0;
  }
  SEGENV.aux0 = flash;
  d.flash = flash;
  d.flashColor = SEGCOLOR(2) ? SEGCOLOR(2) : WHITE;

  return d;
}

//////////////////////////////////
//  Music Pulse - 1D strip mode //
//////////////////////////////////

static void mode_musicpulse(void) {
  if (SEGLEN <= 1) FX_FALLBACK_STATIC;
  MusicPulseData d = getMusicPulseData();

  bool mirror = SEGMENT.check1;
  unsigned half = mirror ? (SEGLEN + 1) / 2 : SEGLEN;
  uint8_t drift = (uint8_t)((strip.now >> 5) * (1 + (SEGMENT.custom2 >> 5))); // "Color travel"

  for (unsigned i = 0; i < half; i++) {
    unsigned band = (i * MP_NUM_BANDS) / half;
    if (band >= MP_NUM_BANDS) band = MP_NUM_BANDS - 1;

    uint8_t bri = (uint8_t)constrain(d.fftResult[band] * d.gain, 0.0f, 255.0f);
    uint8_t colorIdx = d.pitchHue + (uint8_t)((i * 255) / half) + drift;
    uint32_t col = SEGMENT.color_from_palette(colorIdx, false, PALETTE_SOLID_WRAP, 0, bri);

    if (d.flash > 0) col = color_blend(col, d.flashColor, d.flash);

    SEGMENT.setPixelColor(i, col);
    if (mirror) SEGMENT.setPixelColor(SEGLEN - 1 - i, col);
  }
}
static const char _data_FX_MODE_MUSICPULSE[] PROGMEM = "Music Pulse@Fade/Snap,Sensitivity,Beat flash,Color travel,,Mirror,Beat flash,Pitch color;,,Flash;!;1f;sx=128,ix=140,c1=80,c2=0,o1=0,o2=1,o3=1";

/////////////////////////////////////
//  Music Pulse Matrix - 2D mode   //
/////////////////////////////////////

static void mode_musicpulse_matrix(void) {
  if (!strip.isMatrix || !SEGMENT.is2D()) FX_FALLBACK_STATIC;
  MusicPulseData d = getMusicPulseData();

  const uint16_t cols = SEG_W;
  const uint16_t rows = SEG_H;

  if (!SEGENV.allocateData(cols)) FX_FALLBACK_STATIC; // one falling peak-hold cap per column
  uint8_t *peakCap = SEGENV.data;
  if (SEGENV.call == 0) memset(peakCap, 0, cols);

  uint8_t capDecay = 1 + (SEGMENT.speed >> 4); // higher "Fade/Snap" = faster falling caps

  SEGMENT.fill(BLACK);

  for (uint16_t x = 0; x < cols; x++) {
    unsigned band = (x * MP_NUM_BANDS) / cols;
    if (band >= MP_NUM_BANDS) band = MP_NUM_BANDS - 1;
    uint8_t level = (uint8_t)constrain(d.fftResult[band] * d.gain, 0.0f, 255.0f);

    if (level > peakCap[x]) peakCap[x] = level;
    else peakCap[x] = (peakCap[x] > capDecay) ? peakCap[x] - capDecay : 0;

    uint16_t litRows = (level * rows) / 255;
    uint8_t colorIdx = d.pitchHue + (uint8_t)((x * 255) / cols);

    for (uint16_t y = 0; y < litRows; y++) {
      uint8_t bri = 80 + ((uint32_t)(y + 1) * 175) / rows; // brighter toward the top of the lit bar
      uint32_t col = SEGMENT.color_from_palette(colorIdx, false, PALETTE_SOLID_WRAP, 0, bri);
      if (d.flash > 0) col = color_blend(col, d.flashColor, d.flash >> 1);
      SEGMENT.setPixelColorXY(x, rows - 1 - y, col);
    }

    if (peakCap[x] > 4) { // falling peak-hold cap dot above the bar
      uint16_t capRow = (peakCap[x] * (rows - 1)) / 255;
      SEGMENT.setPixelColorXY(x, rows - 1 - capRow, SEGMENT.color_from_palette(colorIdx, false, PALETTE_SOLID_WRAP, 0, 255));
    }
  }
}
static const char _data_FX_MODE_MUSICPULSE_MATRIX[] PROGMEM = "Music Pulse Matrix@Fade/Snap,Sensitivity,Beat flash,Color travel,,,Beat flash,Pitch color;,,Flash;!;2f;sx=128,ix=140,c1=80,o2=1,o3=1";

/////////////////////
//  UserMod Class  //
/////////////////////

class MusicPulseUsermod : public Usermod {
 public:
  void setup() override {
    strip.addEffect(255, &mode_musicpulse, _data_FX_MODE_MUSICPULSE);
    strip.addEffect(255, &mode_musicpulse_matrix, _data_FX_MODE_MUSICPULSE_MATRIX);
  }
  void loop() override {} // nothing to do in the loop
  uint16_t getId() override { return USERMOD_ID_UNSPECIFIED; }
};

static MusicPulseUsermod music_pulse_usermod;
REGISTER_USERMOD(music_pulse_usermod);
