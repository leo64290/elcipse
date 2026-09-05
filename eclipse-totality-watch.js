/*
 * Eclipse Totality Watch — Phase 1 MVP
 *
 * Detects the real local start/end of a total solar eclipse (contact 2 / contact 3)
 * from ambient camera luminance, compares it to the prediction already computed by
 * computeLocalVisibility() in eclipses-solaires.html, and (if window.EclipseSync is
 * present) submits the residual for cross-device robust aggregation.
 *
 * No build step, no bundler: plain script, attaches window.EclipseTotalityWatch.
 * Depends on nothing else being loaded first except the DOM.
 */
(function (global) {
  'use strict';

  // ---- Tunables ----
  var SAMPLE_RATE_HZ = 4;
  var BASELINE_WINDOW_SEC = 45;
  var CONTACT2_DROP_RATIO = 0.10;   // luma must fall below 10% of rolling baseline
  var CONTACT3_RISE_RATIO = 0.30;   // and rise back above 30% of baseline to end
  var SUSTAIN_SAMPLES = 3;          // ~0.75s sustained, rejects single-frame spikes
  var ARM_MARGIN_SEC = 90;          // detector only "counts" inside [begin-90s, end+90s]
  var MAX_RESIDUAL_SEC = 180;       // residuals outside this are dropped, never submitted
  var AUTOSTART_LEAD_SEC = 60;      // camera auto-starts 60s before predicted totality
  var NOTIFY_LEAD_SEC = 300;        // local notification 5 min before, nudge to open app
  var CROP_FRACTION = 0.5;          // sample the central 50% of the frame only

  // ---- error-budget priors (seconds, 1-sigma), combined in quadrature per observation ----
  var DETECTION_BASE_SIGMA_SEC = 0.2;  // residual luminance-threshold + interpolation noise
  var UNSYNCED_CLOCK_SIGMA_SEC = 3.0;  // conservative prior when clock-offset measurement failed
  var AUTO_EXPOSURE_SIGMA_SEC = 0.6;   // extra uncertainty when camera AE/AWB couldn't be locked

  // ---- small stats helpers ----
  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function mad(arr, med) {
    if (!arr.length) return 0;
    var devs = arr.map(function (x) { return Math.abs(x - med); });
    return median(devs) * 1.4826; // scaled to be comparable to a standard deviation
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  // Combines independent 1-sigma error components (some may be null/unknown, and are
  // skipped) into a single quadrature-sum sigma. Returns null only if every component
  // was null, i.e. nothing at all is known about this observation's uncertainty.
  function combineSigma(components) {
    var sumSq = 0, any = false;
    for (var i = 0; i < components.length; i++) {
      var c = components[i];
      if (typeof c === 'number' && isFinite(c)) { sumSq += c * c; any = true; }
    }
    return any ? Math.sqrt(sumSq) : null;
  }

  // Linear-interpolates the timestamp (ms) at which luma crossed `threshold` between
  // two consecutive samples, instead of reporting the time of the *confirmation*
  // sample (SUSTAIN_SAMPLES later): this removes both the sample-period quantization
  // error and the ~SUSTAIN_SAMPLES/SAMPLE_RATE_HZ systematic detection-lag bias that a
  // naive "now" timestamp would bake into every single contact time.
  function interpolateCrossing(prev, cur, threshold, fallbackT) {
    if (!prev || prev.luma === cur.luma) return fallbackT;
    var frac = (prev.luma - threshold) / (prev.luma - cur.luma);
    if (!isFinite(frac) || frac < 0 || frac > 1) return fallbackT;
    return prev.t + frac * (cur.t - prev.t);
  }

  /**
   * Combine many independent residual observations (seconds, observed - predicted)
   * into one robust "collective correction", discarding statistical outliers
   * (joke/bad-faith submissions or gross detector errors) via sigma-clipping on MAD,
   * then taking a weighted median over the survivors — weighted by inverse-variance
   * (1/sigma^2) when `sigmaField` is supplied and present on a record, so a
   * tripod-mounted, exposure-locked, clock-synced observation counts for more than a
   * shaky handheld one with an unknown clock offset. Runs entirely client-side over
   * whatever the local Firestore cache already has.
   */
  function computeCollectiveCorrection(observations, field, sigmaField) {
    var rows = observations
      .map(function (o) {
        var sigma = sigmaField && typeof o[sigmaField] === 'number' && o[sigmaField] > 0 ? o[sigmaField] : null;
        return { v: o[field], w: sigma ? 1 / (sigma * sigma) : 1 };
      })
      .filter(function (r) { return typeof r.v === 'number' && isFinite(r.v); });
    if (!rows.length) return null;

    var vals = rows.map(function (r) { return r.v; });
    var med = median(vals);
    var m = mad(vals, med);
    var survivors = rows;
    if (m > 0) {
      survivors = rows.filter(function (r) { return Math.abs(r.v - med) <= 3 * m; });
      if (!survivors.length) survivors = rows; // degenerate case: keep everything
    }
    return {
      correctionSec: weightedMedian(survivors),
      sampleCount: vals.length,
      keptCount: survivors.length,
      mad: m
    };
  }

  function weightedMedian(rows) {
    var sorted = rows.slice().sort(function (a, b) { return a.v - b.v; });
    var total = sorted.reduce(function (s, r) { return s + r.w; }, 0);
    var acc = 0;
    for (var i = 0; i < sorted.length; i++) {
      acc += sorted[i].w;
      if (acc >= total / 2) return sorted[i].v;
    }
    return sorted[sorted.length - 1].v;
  }

  // ---- Camera luminance detector ----
  function TotalityDetector(onEvent) {
    this.onEvent = onEvent; // (type: 'contact2'|'contact3', when: Date) => void
    this.samples = [];      // {t: ms epoch, luma: number}
    this.lastSample = null; // most recent sample regardless of state, for crossing interpolation
    this.crossingCandidate = null; // interpolated ms timestamp of the in-progress threshold crossing
    this.exposureLocked = false;   // true once applyConstraints({exposureMode:'manual'}) is confirmed
    this.video = null;
    this.stream = null;
    this.timer = null;
    this.state = 'partial'; // 'partial' -> 'total' -> 'partial'
    this.sustainCount = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 32;
    this.canvas.height = 32;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  TotalityDetector.prototype.start = function () {
    var self = this;
    if (this.stream) return Promise.resolve();
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    }).then(function (stream) {
      self.stream = stream;
      self._tryLockExposure();
      self.video = document.createElement('video');
      self.video.setAttribute('playsinline', '');
      self.video.muted = true;
      self.video.srcObject = stream;
      return self.video.play();
    }).then(function () {
      self.timer = setInterval(function () { self._sample(); }, 1000 / SAMPLE_RATE_HZ);
    });
  };

  // Best-effort: locks exposure/white-balance so the camera stops actively fighting
  // the real darkness of totality (auto-exposure otherwise ramps ISO/shutter up over
  // 1-2s in a device-dependent way, smearing and delaying the luminance drop). Silently
  // no-ops where unsupported (most mobile browsers as of writing don't expose manual
  // exposureMode via getUserMedia) — self.exposureLocked stays false and that fact is
  // folded into the submitted observation's error budget instead of pretending it works.
  TotalityDetector.prototype._tryLockExposure = function () {
    this.exposureLocked = false;
    var self = this;
    try {
      var track = this.stream.getVideoTracks()[0];
      if (!track || typeof track.getCapabilities !== 'function') return;
      var caps = track.getCapabilities();
      var advanced = [];
      if (caps.exposureMode && caps.exposureMode.indexOf('manual') !== -1) advanced.push({ exposureMode: 'manual' });
      if (caps.whiteBalanceMode && caps.whiteBalanceMode.indexOf('manual') !== -1) advanced.push({ whiteBalanceMode: 'manual' });
      if (!advanced.length) return;
      track.applyConstraints({ advanced: advanced }).then(function () {
        var settings = track.getSettings ? track.getSettings() : {};
        self.exposureLocked = settings.exposureMode === 'manual';
      }).catch(function () { /* constraint rejected: stays auto-exposure */ });
    } catch (e) { /* getCapabilities/applyConstraints unsupported on this device/browser */ }
  };

  TotalityDetector.prototype.stop = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null;
    }
    this.video = null;
  };

  TotalityDetector.prototype._sample = function () {
    if (!this.video || this.video.readyState < 2) return;
    var vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return;

    var cropW = vw * CROP_FRACTION, cropH = vh * CROP_FRACTION;
    var sx = (vw - cropW) / 2, sy = (vh - cropH) / 2;
    var w = this.canvas.width, h = this.canvas.height;
    this.ctx.drawImage(this.video, sx, sy, cropW, cropH, 0, 0, w, h);

    var data;
    try {
      data = this.ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return; // e.g. canvas tainted / not ready yet
    }

    var sum = 0, n = w * h;
    for (var i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    var luma = sum / n;
    var now = Date.now();

    this.samples.push({ t: now, luma: luma });
    var cutoff = now - BASELINE_WINDOW_SEC * 1000;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();

    // baseline excludes the sample just pushed: otherwise, right as luma starts
    // dropping, the very sample being tested against the threshold also pulls its own
    // comparison baseline down a little (self-referential contamination).
    var baselineSamples = this.samples.length > 1 ? this.samples.slice(0, -1) : this.samples;
    var baseline = median(baselineSamples.map(function (s) { return s.luma; }));

    var prev = this.lastSample;
    this.lastSample = { t: now, luma: luma };
    if (!baseline) return;

    if (this.state === 'partial') {
      var thresh2 = baseline * CONTACT2_DROP_RATIO;
      if (luma < thresh2) {
        if (this.sustainCount === 0) this.crossingCandidate = interpolateCrossing(prev, this.lastSample, thresh2, now);
        this.sustainCount++;
        if (this.sustainCount >= SUSTAIN_SAMPLES) {
          this.state = 'total';
          this.sustainCount = 0;
          var when2 = this.crossingCandidate != null ? this.crossingCandidate : now;
          this.crossingCandidate = null;
          this.onEvent('contact2', new Date(when2));
        }
      } else {
        this.sustainCount = 0;
        this.crossingCandidate = null;
      }
    } else {
      var thresh3 = baseline * CONTACT3_RISE_RATIO;
      if (luma > thresh3) {
        if (this.sustainCount === 0) this.crossingCandidate = interpolateCrossing(prev, this.lastSample, thresh3, now);
        this.sustainCount++;
        if (this.sustainCount >= SUSTAIN_SAMPLES) {
          this.state = 'partial';
          this.sustainCount = 0;
          var when3 = this.crossingCandidate != null ? this.crossingCandidate : now;
          this.crossingCandidate = null;
          this.onEvent('contact3', new Date(when3));
        }
      } else {
        this.sustainCount = 0;
        this.crossingCandidate = null;
      }
    }
  };

  // ---- Scheduler: arms the detector around the locally predicted totality window ----
  var active = null; // holds the single currently-armed watcher, or null

  function disarm() {
    if (!active) return;
    if (active.timerHandle) clearTimeout(active.timerHandle);
    if (active.stopTimerHandle) clearTimeout(active.stopTimerHandle);
    if (active.detector) active.detector.stop();
    document.removeEventListener('visibilitychange', active.onVisibilityChange);
    active = null;
  }

  /**
   * ctx = {
   *   eclipseId: string,
   *   lat, lon: number,
   *   totalBegin, totalEnd: Date   // from computeLocalVisibility()'s total_begin/total_end
   *   predictedObscuration: number | undefined
   *   gpsAccuracyM, gpsAltitudeM: number | null   // from the Geolocation API, when available
   *   positionSigmaBeginSec, positionSigmaEndSec: number | null // see estimatePositionSigmaSec()
   *   locationSource: 'gps' | 'search'
   * }
   */
  function arm(ctx) {
    disarm();
    if (!ctx || !ctx.totalBegin || !ctx.totalEnd) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;

    active = {
      ctx: ctx,
      timerHandle: null,
      stopTimerHandle: null,
      detector: null,
      notified: false,
      clockOffset: null, // {offsetSec, uncertaintySec, rttMs} once measureClock() resolves
      onVisibilityChange: function () {
        if (document.visibilityState === 'visible') scheduleNext();
      }
    };
    document.addEventListener('visibilitychange', active.onVisibilityChange);
    scheduleNext();

    function scheduleNext() {
      if (!active) return;
      if (active.timerHandle) { clearTimeout(active.timerHandle); active.timerHandle = null; }

      var now = Date.now();
      var startAt = ctx.totalBegin.getTime() - AUTOSTART_LEAD_SEC * 1000;
      var armEnd = ctx.totalEnd.getTime() + ARM_MARGIN_SEC * 1000;

      if (now >= armEnd) { disarm(); return; }

      maybeScheduleNotification(now);

      if (active.detector) return; // capture already running
      if (now >= startAt) {
        startCapture();
      } else {
        active.timerHandle = setTimeout(startCapture, startAt - now);
      }
    }

    function maybeScheduleNotification(now) {
      if (active.notified) return;
      var plugins = global.Capacitor && global.Capacitor.Plugins;
      if (!plugins || !plugins.LocalNotifications) return;
      var notifyAt = ctx.totalBegin.getTime() - NOTIFY_LEAD_SEC * 1000;
      if (notifyAt <= now) return;
      active.notified = true;
      plugins.LocalNotifications.schedule({
        notifications: [{
          id: 1,
          title: 'Totalité imminente',
          body: "Ouvre l'app pour aider à affiner la position de la lune.",
          schedule: { at: new Date(notifyAt) }
        }]
      }).catch(function (e) { console.warn('[totality-watch] notif schedule failed', e); });
    }

    // Measures device clock error against Firestore server time (see
    // EclipseSync.measureClockOffset in eclipses-solaires.html). Triggered from
    // startCapture rather than arm() so the round trip happens close to the actual
    // observation — both to avoid wasted writes from casual browsing, and because
    // network RTT right before totality (when everyone's phone is on the same cell
    // tower at once) is the most representative uncertainty estimate anyway.
    function measureClock() {
      var session = active;
      if (!(global.EclipseSync && typeof global.EclipseSync.measureClockOffset === 'function')) return;
      global.EclipseSync.measureClockOffset(ctx.eclipseId).then(function (result) {
        if (active === session) active.clockOffset = result; // result may be null: left unsynced
      }).catch(function () { /* left as null: submission flags clock-unsynced */ });
    }

    function startCapture() {
      if (!active || active.detector) return;
      measureClock();
      var armStart = ctx.totalBegin.getTime() - ARM_MARGIN_SEC * 1000;
      var armEnd = ctx.totalEnd.getTime() + ARM_MARGIN_SEC * 1000;
      var observed = {};

      var det = new TotalityDetector(function (type, when) {
        var t = when.getTime();
        if (t < armStart || t > armEnd) return; // outside the armed window: ignored, not submitted
        if (type === 'contact2') observed.begin = when;
        if (type === 'contact3') { observed.end = when; finish(); }
      });

      active.detector = det;
      det.start().catch(function (e) {
        console.warn('[totality-watch] camera start failed', e);
        if (active && active.detector === det) active.detector = null;
      });

      active.stopTimerHandle = setTimeout(function () {
        if (active && active.detector === det) { det.stop(); active.detector = null; finish(); }
      }, Math.max(5000, armEnd - Date.now()));

      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        det.stop();
        submitIfValid();
      }

      function submitIfValid() {
        var offset = active && active.clockOffset; // {offsetSec, uncertaintySec} | null
        var offsetMs = offset ? offset.offsetSec * 1000 : 0;
        var correctedBegin = observed.begin ? new Date(observed.begin.getTime() - offsetMs) : null;
        var correctedEnd = observed.end ? new Date(observed.end.getTime() - offsetMs) : null;

        var residualBegin = correctedBegin
          ? (correctedBegin.getTime() - ctx.totalBegin.getTime()) / 1000 : null;
        var residualEnd = correctedEnd
          ? (correctedEnd.getTime() - ctx.totalEnd.getTime()) / 1000 : null;

        if (residualBegin === null && residualEnd === null) return;
        if ((residualBegin !== null && Math.abs(residualBegin) > MAX_RESIDUAL_SEC) ||
            (residualEnd !== null && Math.abs(residualEnd) > MAX_RESIDUAL_SEC)) {
          return; // implausible vs. prediction: rejected locally, never leaves the device
        }

        if (!global.EclipseSync || typeof global.EclipseSync.submitObservation !== 'function') return;

        var exposureLocked = !!det.exposureLocked;
        var clockSigma = offset ? offset.uncertaintySec : UNSYNCED_CLOCK_SIGMA_SEC;
        var exposureSigma = exposureLocked ? 0 : AUTO_EXPOSURE_SIGMA_SEC;
        var sigmaBegin = combineSigma([DETECTION_BASE_SIGMA_SEC, clockSigma, exposureSigma, ctx.positionSigmaBeginSec]);
        var sigmaEnd = combineSigma([DETECTION_BASE_SIGMA_SEC, clockSigma, exposureSigma, ctx.positionSigmaEndSec]);

        var qualityFlags = [];
        if (!(observed.begin && observed.end)) qualityFlags.push('single-contact-only');
        if (!offset) qualityFlags.push('clock-unsynced');
        if (!exposureLocked) qualityFlags.push('auto-exposure');
        if (ctx.locationSource === 'search') qualityFlags.push('location-not-gps');

        global.EclipseSync.submitObservation({
          eclipseId: ctx.eclipseId,
          lat: ctx.lat,
          lon: ctx.lon,
          predictedBeginUtc: ctx.totalBegin.toISOString(),
          predictedEndUtc: ctx.totalEnd.toISOString(),
          observedBeginUtc: correctedBegin ? correctedBegin.toISOString() : null,
          observedEndUtc: correctedEnd ? correctedEnd.toISOString() : null,
          residualBeginSec: residualBegin,
          residualEndSec: residualEnd,
          sigmaBeginSec: sigmaBegin != null ? round2(sigmaBegin) : null,
          sigmaEndSec: sigmaEnd != null ? round2(sigmaEnd) : null,
          clockOffsetSec: offset ? round2(offset.offsetSec) : null,
          clockOffsetUncertaintySec: offset ? round2(offset.uncertaintySec) : null,
          gpsAccuracyM: typeof ctx.gpsAccuracyM === 'number' ? round2(ctx.gpsAccuracyM) : null,
          gpsAltitudeM: typeof ctx.gpsAltitudeM === 'number' ? round2(ctx.gpsAltitudeM) : null,
          exposureLocked: exposureLocked,
          obscurationPredicted: typeof ctx.predictedObscuration === 'number' ? ctx.predictedObscuration : null,
          qualityFlags: qualityFlags
        }).catch(function (e) { console.warn('[totality-watch] submit failed', e); });
      }
    }
  }

  global.EclipseTotalityWatch = {
    arm: arm,
    disarm: disarm,
    computeCollectiveCorrection: computeCollectiveCorrection,
    // Underscore-prefixed: not part of the app's real API, exposed only so
    // tests/totality-watch.test.js can exercise the crossing-interpolation and
    // error-budget math directly instead of re-implementing it to check it.
    _internal: {
      TotalityDetector: TotalityDetector,
      interpolateCrossing: interpolateCrossing,
      combineSigma: combineSigma,
      median: median,
      mad: mad
    }
  };
})(window);
