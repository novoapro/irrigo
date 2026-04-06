// UNO R4 WiFi — Pressure monitor (baseline scale fix)
// - Baseline view now ALWAYS shows at least 1 pixel when baseline > 0
// - Authoritative LED rendering (baseline while adjusting, PSI otherwise)
// - Knob sensitivity via BASELINE_STEP_PSI
// - Reliable crossing detection/logging with hysteresis
// - Guaranteed state push after baseline settles (bypass gate)
// - Initial broadcast 10s after first Wi-Fi connect
// - Non-blocking networking (send queue; only when knob idle)
// - Baseline mode toggled by knob.isPressed() (press to enter/exit)

#include <Arduino.h>
#include <Wire.h>
#include <WiFiS3.h>
#include <ArduinoHttpClient.h>
#include <time.h>
#include <Modulino.h>
#include "ArduinoGraphics.h"
#include "Arduino_LED_Matrix.h"


// ======== Network Configuration ========
const char* WIFI_SSID = "";
const char* WIFI_PASS = "";
const char* API_HOST  = "";
const int   API_PORT  = 4000;
const char* API_PATH  = "/api/heartbeats/";
const char* CONFIG_PATH = "/api/device/config/";

// ======== Display & Logging Labels ========
// Display messages
const char* WIFI_CONNECTING = "W-C";
const char* WIFI_ERROR     = "W-E";

// Sensor names for logging
const char* PRESSURE_NAME = "Pressure";
const char* SENSOR1_NAME  = "Rain Sensor";
const char* SENSOR2_NAME  = "Soil Moisture";

// JSON payload keys
const char* KEY_PRESSURE = "psi";
const char* KEY_SENSOR1  = "s1";
const char* KEY_SENSOR2  = "s2";

// ======== Hardware Configuration ========
// Pin assignments
const int PRESSURE_PIN = A0;  // Analog pressure sensor input
const int RELAY_PIN    = 8;   // Relay control output
const int SENSOR1_PIN  = 5;   // Rain sensor (LOW = closed/rain detected)
const int SENSOR2_PIN  = 4;   // Soil moisture sensor (LOW = closed/moisture detected)

// ADC Configuration
#ifndef ADC_RES_BITS
#define ADC_RES_BITS 12      // 12-bit ADC resolution
#endif
const float ADC_MAX = (1 << ADC_RES_BITS) - 1;

// Pressure Sensor Calibration
const float V_SUPPLY       = 5.0;    // Supply voltage
const float V_ZERO_PSI     = 0.50;   // Voltage at 0 PSI
const float V_FULL_SCALE   = 4.50;   // Voltage at full scale
const float PSI_FULL_SCALE = 100.0;  // Maximum PSI reading

// ======== UI / Behavior ========
#define NUM_PIXELS 8
// ======== User Interface Configuration ========
#define NUM_PIXELS 8  // Number of LED pixels in display bar

// Timing Configuration (defaults, can be overridden by server)
unsigned long SAMPLE_MS    = 60000;   // Sample interval: 1 minute
unsigned long heartbeatIntervalMs = 3600000; // Heartbeat interval: 60 minutes (synced to server)

// LED Matrix and Display Settings
const unsigned long BASELINE_BLINK_MS = 120;  // Baseline mode blink interval
const unsigned long PRESS_DEBOUNCE_MS = 30;   // Button press debounce time

// Knob Configuration
const int           KNOB_STEPS_PER_TURN   = 30;   // Physical detents per rotation
const unsigned long KNOB_DEBOUNCE_MS      = 15;   // Knob rotation debounce time
const float         BASELINE_STEP_PSI     = 5.0f; // PSI change per detent
const unsigned long BASELINE_PUSH_IDLE_MS = 300;  // Delay before pushing baseline changes

// Pressure Monitoring
const float PSI_HYST        = 0.30f; // Hysteresis band (±PSI)
float PSI_SPIKE_DELTA = 10.0f; // Minimum delta for spike detection (configurable via server)

// Network Timing
const unsigned long INITIAL_BCAST_DELAY = 10000; // Initial broadcast delay after WiFi connect
const unsigned long WIFI_RETRY_LEAD_MS  = 3000;  // Lead time for reconnection before sample
// Device config polling
const unsigned long CONFIG_POLL_MS = 30000; // How often to poll backend for config when idle


// ======== Modulino parts ========
ModulinoPixels pixels;
ModulinoKnob   knob;
ModulinoBuzzer buzzer;
ModulinoThermo tempHum;
ModulinoButtons btn;
ArduinoLEDMatrix ledMatrix;

// ======== Network ========
WiFiClient   wifi;
HttpClient   http(wifi, API_HOST, API_PORT);

// ======== Sensor State ========
// Pressure readings
float baselinePsi    = 10.0f;  // Current pressure threshold
float lastPsi        = 10.0f;  // Last pressure reading
bool  lastPsiValid   = false;  // Is last reading valid?

// Environmental readings
float lastTempF       = NAN;  // Last temperature reading (°F)
float lastHumidityPct = NAN;  // Last humidity reading (%)

// Sensor states
bool s1_eff = false;  // Effective rain sensor state
bool s2_eff = false;  // Effective moisture sensor state

// ======== Server Configuration State ========
// Guard control
bool guardEnabled = true;        // Master enable for guard system
float serverBaselinePsi = 20.0f; // Server's baseline pressure setting

// Sensor control
bool rainEnabled = false;   // Rain sensor enable
bool moistEnabled = false;  // Moisture sensor enable

// Timing configuration
unsigned long sampleIntervalMs = 60000;      // Sample interval (1 minute)
struct MatrixRenderState {
  char text[16];
  bool seg1;
  bool seg2;
  bool seg3;
};
MatrixRenderState lastMatrix = { "", false, false, false };

bool  prevBelow          = false;  // last stable relation (with hysteresis)
bool  lastSentValid      = false;
bool  lastSentValue      = false;
unsigned long lastSendMs = 0;

// When to attempt a reconnect ahead of the next sample
unsigned long nextReconnectAtMs = 0;

// ======== Sensor Control State ========
// Sensor enable flags (controlled by buttons and server)
bool sensor1Use = false;     // Rain sensor enable
bool sensor2Use = false;     // Moisture sensor enable

// Previous sensor states (for change detection)
bool sensor1Last = true;   // Last rain sensor reading
bool sensor2Last = true;   // Last moisture sensor reading
bool sensor1UsePrev = false; // Previous rain sensor enable state
bool sensor2UsePrev = false; // Previous moisture sensor enable state

// ======== Button Control State ========
bool btnLed0 = true;        // Force sample button LED
volatile bool forceSampleNow = false;  // Force sample trigger
bool forceBypassGate = false;         // Bypass update gate on force

// ======== Buzzer (non‑blocking scheduler) ========
enum BeepPattern : uint8_t { BP_NONE=0, BP_WIFI_CONNECTED, BP_WIFI_LOST };
struct BuzzerState {
  BeepPattern pat = BP_NONE;   // which pattern is active
  uint8_t     step = 0;        // step within pattern
  bool        toneOn = false;  // is tone currently on
  unsigned long nextAt = 0;    // millis() when to advance
} buzzerState;

const uint16_t BUZZ_FREQ_HZ = 2000;     // 2 kHz notification tone
const unsigned long BEEP_LONG_MS  = 500;
const unsigned long BEEP_SHORT_MS = 150;
const unsigned long BEEP_GAP_MS   = 150;

unsigned long nextSampleMs     = 0;
unsigned long nextConfigFetchMs = 0;
// unsigned long lastKnobChangeMs = 0;

long  lastKnobAbs      = 0;   // last absolute detent count (no modulo)
bool  knobAbsInited    = false;
unsigned long lastKnobEdgeMs = 0;

// Initial-connect broadcast tracking
bool           sawWifiConnected     = false;
bool           sawWifiError     = false;
unsigned long  firstConnectedAtMs   = 0;
bool           initialBroadcastDone = false;

// Baseline blink state
bool baselineBlinkOn = true;
unsigned long nextBlinkMs = 0;

// Persistent knob mode toggled by knob.isPressed()
bool knobModeActive = false;    // true: baseline setup mode; false: normal PSI display
bool lastKnobPressed = false;   // edge detection for press toggling
unsigned long lastPressChangeMs = 0;   // for PRESS_DEBOUNCE_MS

// Baseline-change push
bool           baselineDirty        = false; // true when baseline changed and we still owe a state push

// Cross logging
bool           justCrossed          = false; // set true in the exact loop cycle where relation flips

// Minimal send queue
struct PendingSend {
  bool  has = false;
  bool  relay = false;   // desired relay state (combined)
  float psi = 0;
  float baseline = 0;
  bool  bypassGate = false; // for baseline push or initial broadcast
  // Extended context
  bool  below = false;   // water pressure below baseline (stable)
  bool  s1 = false;      // effective sensor1 state (closed = true)
  bool  s2 = false;      // effective sensor2 state (closed = true)
  char  reason[32];      // optional short reason for heartbeat
} pendingSend;

// ======== Helpers ========
float readPsiOnce() {
  int raw = analogRead(PRESSURE_PIN);
  float volts = (raw * V_SUPPLY) / ADC_MAX;
  float psi = (volts - V_ZERO_PSI) * (PSI_FULL_SCALE / (V_FULL_SCALE - V_ZERO_PSI));
  if (psi < 0) psi = 0;
  if (psi > PSI_FULL_SCALE) psi = PSI_FULL_SCALE;
  return psi;
}

bool computeRelationWithHysteresis(float psi, float baseline, bool prevStableBelow) {
  if (psi < baseline - PSI_HYST) return true;
  if (psi > baseline + PSI_HYST) return false;
  return prevStableBelow;
}

bool gateAllows(bool desired, bool bypassGate) {
  if (bypassGate) return true;                 // e.g., baseline push or initial broadcast
  if (!lastSentValid) return true;             // allow first
  if (!desired && !lastSentValue) return false; // suppress false-after-false chatter
  return true;
}

// ======== Buzzer ========
inline void buzzerToneOn(unsigned long len_ms) { buzzer.tone(BUZZ_FREQ_HZ, (int)len_ms); }

inline void buzzerToneOff() { buzzer.noTone(); }

void serviceBuzzer(unsigned long now) {
  if (buzzerState.pat == BP_NONE) return;
  if (now < buzzerState.nextAt) return;

  switch (buzzerState.pat) {
    case BP_WIFI_CONNECTED:
      if (buzzerState.step == 0) {
        // Start long tone
        buzzerToneOn(BEEP_LONG_MS);
        buzzerState.toneOn = true;
        buzzerState.nextAt = now + BEEP_LONG_MS;
        buzzerState.step = 1;
      } else {
        // Stop and finish
        if (buzzerState.toneOn) { buzzerToneOff(); buzzerState.toneOn = false; }
        buzzerState.pat = BP_NONE;
      }
      break;

    case BP_WIFI_LOST:
      if (buzzerState.step == 0) {
        // Beep 1 on
        buzzerToneOn(BEEP_SHORT_MS);
        buzzerState.toneOn = true;
        buzzerState.nextAt = now + BEEP_SHORT_MS;
        buzzerState.step = 1;
      } else if (buzzerState.step == 1) {
        // Beep 1 off (gap)
        if (buzzerState.toneOn) { buzzerToneOff(); buzzerState.toneOn = false; }
        buzzerState.nextAt = now + BEEP_GAP_MS;
        buzzerState.step = 2;
      } else if (buzzerState.step == 2) {
        // Beep 2 on
        buzzerToneOn(BEEP_SHORT_MS);
        buzzerState.toneOn = true;
        buzzerState.nextAt = now + BEEP_SHORT_MS;
        buzzerState.step = 3;
      } else {
        // Beep 2 off and finish
        if (buzzerState.toneOn) { buzzerToneOff(); buzzerState.toneOn = false; }
        buzzerState.pat = BP_NONE;
      }
      break;

    default:
      // Safety: stop any sound
      if (buzzerState.toneOn) { buzzerToneOff(); buzzerState.toneOn = false; }
      buzzerState.pat = BP_NONE;
      break;
  }
}

// ======== UI ========
void drawOnLEDMatrix(const char* text, bool seg1 /*=false*/, bool seg2 /*=false*/, bool seg3 /*=false*/){
  if (!text) return; // defensive

  // Check whether both text and footer segment flags are unchanged
  bool sameText = (lastMatrix.text[0] != '\0' && strncmp(text, lastMatrix.text, sizeof(lastMatrix.text)) == 0);
  bool sameSegs = (seg1 == lastMatrix.seg1) && (seg2 == lastMatrix.seg2) && (seg3 == lastMatrix.seg3);
  if (sameText && sameSegs) return; // no change → skip redraw

  // Render
  ledMatrix.clear();
  ledMatrix.beginDraw();
  ledMatrix.stroke(0xFFFFFFFF);
  ledMatrix.textFont(Font_4x6);
  ledMatrix.beginText(0, 1, 0xFFFFFF);
  ledMatrix.println(text);
  ledMatrix.endText();

  // Optional footer segments: three short lines on the last row (y=7),
  // with a single-pixel gap (dot) between them at x=3 and x=7
  if (seg1 || seg2 || seg3) {
    const int y = 7; // bottom row on 12x8 matrix
    if (seg1) { ledMatrix.line(0, y, 2, y); }   // segment 1: x=0..2
    // x=3 acts as the middle dot/gap between segment 1 and 2
    if (seg2) { ledMatrix.line(4, y, 7, y); }   // segment 2: x=4..7
    // x=7 acts as the middle dot/gap between segment 2 and 3
    if (seg3) { ledMatrix.line(9, y, 11, y); }  // segment 3: x=9..11
  }

  ledMatrix.endDraw();

  // Cache current render state
  strncpy(lastMatrix.text, text, sizeof(lastMatrix.text) - 1);
  lastMatrix.text[sizeof(lastMatrix.text) - 1] = '\0';
  lastMatrix.seg1 = seg1;
  lastMatrix.seg2 = seg2;
  lastMatrix.seg3 = seg3;
}

// Show baseline as a bar (also reversed, gradient green→orange→red)
void drawBaselineBar(float baselinePsi) {
  float pct = constrain(baselinePsi / PSI_FULL_SCALE * 100.0f, 0.0f, 100.0f);
  int lit = (int)ceil((pct / 100.0f) * NUM_PIXELS);
  if (pct == 0.0f) lit = 0;
  pixels.clear();

  for (int i = NUM_PIXELS - 1; i >= 0; --i) {
    int idxFromEnd = (NUM_PIXELS - 1) - i;
    if (idxFromEnd < lit) {
      // gradient: same as PSI bar
      float ratio = (float)idxFromEnd / (NUM_PIXELS - 1);
      uint8_t r, g;
      if (ratio < 0.5f) {
        r = (uint8_t)(ratio * 2.0f * 255);
        g = 200;
      } else {
        r = 255;
        g = (uint8_t)((1.0f - (ratio - 0.5f) * 2.0f) * 255);
      }
      pixels.set(i, r, g, 0);
    }
  }
  pixels.show();
}

// Show live PSI as a bar (reversed, gradient green→orange→red)
void drawPsiBar(float psi) {
  float pct = constrain(psi / PSI_FULL_SCALE * 100.0f, 0.0f, 100.0f);
  int lit = (int)((pct / 100.0f) * NUM_PIXELS + 0.5f);
  pixels.clear();

  for (int i = NUM_PIXELS - 1; i >= 0; --i) {
    int idxFromEnd = (NUM_PIXELS - 1) - i;
    if (idxFromEnd < lit) {
      // gradient: 0.0 -> green, 0.5 -> orange, 1.0 -> red
      float ratio = (float)idxFromEnd / (NUM_PIXELS - 1);
      uint8_t r, g;
      if (ratio < 0.5f) {
        // green → orange: red rises 0→255, green stays 255
        r = (uint8_t)(ratio * 2.0f * 255);
        g = 200;
      } else {
        // orange → red: red stays 255, green falls 255→0
        r = 255;
        g = (uint8_t)((1.0f - (ratio - 0.5f) * 2.0f) * 255);
      }
      pixels.set(i, r, g, 0);
    }
  }
  pixels.show();
}

void handleUIChanges(unsigned long time, bool knobActive, bool s1Active, bool s2Active){
  if (knobActive) {
    if (time >= nextBlinkMs) {
      baselineBlinkOn = !baselineBlinkOn;
      nextBlinkMs = time + BASELINE_BLINK_MS;
    }
    if (baselineBlinkOn) {
      drawBaselineBar(baselinePsi);
    } else {
      pixels.clear();
      pixels.show();
    }
    char baselineText[16];
    snprintf(baselineText, sizeof(baselineText), "%.0f", baselinePsi);
    drawOnLEDMatrix(baselineText, false, false, false);
  } else {
    drawPsiBar(lastPsi); // show live PSI when idle
    
    char pressureText[16];
    snprintf(pressureText, sizeof(pressureText), "%.0f", lastPsi);
    drawOnLEDMatrix(pressureText, s1Active, true, s2Active);
  }
}

void handleButtons() {
  static bool lastA = false; // button 0: force sample
  static bool lastB = false; // button 1: toggle sensor1Use
  static bool lastC = false; // button 2: toggle sensor2Use

  // Keep LEDs reflecting the current usage toggles
  btn.setLeds(btnLed0, sensor1Use, sensor2Use);
  btn.update();

  bool a = btn.isPressed(0);
  bool b = btn.isPressed(1);
  bool c = btn.isPressed(2);

  // Button A: set a flag to force a sample & immediate send; core logic will run in handleSamplingAndEvents()
  if (a && !lastA) {
    Serial.println("[Button] A Pressed -> Requesting forced sample");
    forceSampleNow  = true;
    forceBypassGate = true;  // match previous behavior of bypassing gate on forced sample
  }

  // Button B: toggle using sensor 1; update LEDs and server config
  if (b && !lastB) {
    sensor1Use = !sensor1Use;
    Serial.print("[Button] B "); Serial.print(sensor1Use ? "USE " : "BYPASS "); Serial.println(SENSOR1_NAME);
    btn.setLeds(btnLed0, sensor1Use, sensor2Use);
    postDeviceConfigOnce(); // Sync change to server
  }

  // Button C: toggle using sensor 2; update LEDs and server config
  if (c && !lastC) {
    sensor2Use = !sensor2Use;
    Serial.print("[Button] C "); Serial.print(sensor2Use ? "USE " : "BYPASS "); Serial.println(SENSOR2_NAME);
    btn.setLeds(btnLed0, sensor1Use, sensor2Use);
    postDeviceConfigOnce(); // Sync change to server
  }

  lastA = a; lastB = b; lastC = c;
}

// ======== WIFI ========
inline bool wifiReady() { 
  return WiFi.status() == WL_CONNECTED; 
}

void enqueueWifiConnectedPattern() { // single long beep
  buzzerState.pat  = BP_WIFI_CONNECTED;
  buzzerState.step = 0;
  buzzerState.toneOn = false;
  buzzerState.nextAt = 0; // start asap
}

void enqueueWifiLostPattern() { // two short beeps
  buzzerState.pat  = BP_WIFI_LOST;
  buzzerState.step = 0;
  buzzerState.toneOn = false;
  buzzerState.nextAt = 0; // start asap
}

void planWifiReconnectBeforeNextSample(unsigned long now) {
  // Plan a reconnect slightly before the next scheduled sample time
  unsigned long lead = WIFI_RETRY_LEAD_MS;
  unsigned long target = (nextSampleMs > lead) ? (nextSampleMs - lead) : now;
  if (nextReconnectAtMs == 0 || target < nextReconnectAtMs) {
    nextReconnectAtMs = target;
    Serial.print("[WiFi] planned reconnect at "); Serial.println(nextReconnectAtMs);
  }
}

bool connectWiFiBlocking(unsigned long attemptMs = 6000) {
  Serial.print("[WiFi] connecting to "); Serial.println(WIFI_SSID);
  unsigned long start = millis();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int anim = 0;
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < attemptMs) {
    delay(100);
    // Animate 3-segment footer while connecting
    bool seg1 = anim >= 0;
    bool seg2 = anim >= 1;
    bool seg3 = anim >= 2;
    drawOnLEDMatrix(WIFI_CONNECTING, seg1, seg2, seg3);
    anim = (anim + 1) % 3;
  }
  if (WiFi.status() == WL_CONNECTED) {
    // On success, show all 3 segments lit as confirmation
    drawOnLEDMatrix(WIFI_CONNECTING, true, true, true);
    return true;
  }
  drawOnLEDMatrix(WIFI_ERROR, false, false, false);
  Serial.println("[WiFi] failed (timeout)");
  return false;
}

void serviceWifiReconnect(unsigned long now) {
  if (wifiReady()) return;                 // nothing to do if already connected
  if (nextReconnectAtMs == 0) return;      // nothing planned
  if (now < nextReconnectAtMs) return;     // not yet time

  Serial.println("[WiFi] reconnecting ahead of sample...");
  (void)connectWiFiBlocking();              // handles W-C/W-E drawing while attempting
  nextReconnectAtMs = 0;                   // consume plan
  // Update status/buzzer transitions consistently for both initial and later reconnects
  noteWifiTransition();
}

bool noteWifiTransition() {
  if (wifiReady()) {
    if (!sawWifiConnected) {
      sawWifiConnected   = true;
      firstConnectedAtMs = millis();
      initialBroadcastDone = false;
      sawWifiError = false; // clear any prior error flag
      enqueueWifiConnectedPattern();
    }
    return true;
  } else {
    if (!sawWifiError) {
      sawWifiError = true;
      sawWifiConnected = false;
      enqueueWifiLostPattern();
      drawOnLEDMatrix(WIFI_ERROR, false, false, false);
    }
    return false;
  }
}

void renderWifiStatus(uint8_t wifiStatus, unsigned long now) {
  switch (wifiStatus) {
    case WL_CONNECT_FAILED:
    case WL_NO_SSID_AVAIL:
    case WL_CONNECTION_LOST:
      // Hard error states
      drawOnLEDMatrix(WIFI_ERROR, false, false, false);
      return;

    case WL_IDLE_STATUS:
    case WL_DISCONNECTED:
    default: {
      drawOnLEDMatrix(WIFI_CONNECTING, false, false, false);
      return;
    }
  }
}

// ======== KNOB ========
void handleKnob(unsigned long now) {
  long absCount = knob.get();

  if (!knobAbsInited) {
    lastKnobAbs = absCount;
    knobAbsInited = true;
    return;
  }

  // If not in baseline mode, ignore knob movement (no-op) and resync counter
  if (!knobModeActive) {
    lastKnobAbs = absCount;
    return;
  }

  long diff = absCount - lastKnobAbs;
  if (diff != 0 && (now - lastKnobEdgeMs) >= KNOB_DEBOUNCE_MS) {
    lastKnobAbs = absCount;
    lastKnobEdgeMs = now;

    float oldBaseline = baselinePsi;
    baselinePsi = constrain(baselinePsi + diff * BASELINE_STEP_PSI, 0.0f, PSI_FULL_SCALE);
    baselineDirty = true; // schedule a state push once knob rests

    // Immediate visual feedback while turning
    drawBaselineBar(baselinePsi);

    // If this *immediately* flips the stable relation, mark crossing now
    bool newStableBelow = computeRelationWithHysteresis(lastPsi, baselinePsi, prevBelow);
    if (newStableBelow != prevBelow) {
      justCrossed = true;         // ensure crossing gets logged once
      prevBelow   = newStableBelow;
    }

    Serial.print("[Knob] baseline PSI ");
    Serial.print(oldBaseline,1);
    Serial.print(" → ");
    Serial.println(baselinePsi,1);
  }
}

void handleKnobPress() {
  bool pressed = knob.isPressed();
  unsigned long now = millis();

  if (pressed != lastKnobPressed && (now - lastPressChangeMs) >= PRESS_DEBOUNCE_MS) {
    lastPressChangeMs = now;
    if (pressed && !lastKnobPressed) {
      knobModeActive = !knobModeActive;    // toggle mode
      Serial.print("[Bar] mode → ");
      Serial.println(knobModeActive ? "BASELINE SETUP" : "PSI");
      
      // When exiting baseline mode, update server if changes were made
      if (!knobModeActive && baselineDirty) {
        postDeviceConfigOnce();
        baselineDirty = false;
      }
    }
    lastKnobPressed = pressed;
  }
}

// ======== REPORTING ========
void queueSend(bool relay, float psi, float baseline, bool bypassGate=false, bool below=false, bool s1=false, bool s2=false, const char* reason = "") {
  pendingSend.relay = relay;
  pendingSend.psi = psi;
  pendingSend.baseline = baseline;
  pendingSend.bypassGate = bypassGate;
  pendingSend.below = below;
  pendingSend.s1 = s1;
  pendingSend.s2 = s2;
  // copy reason safely (truncate if needed)
  if (reason && reason[0] != '\0') {
    strncpy(pendingSend.reason, reason, sizeof(pendingSend.reason) - 1);
    pendingSend.reason[sizeof(pendingSend.reason) - 1] = '\0';
  } else {
    pendingSend.reason[0] = '\0';
  }
  pendingSend.has = true;
}

bool postHeartBeatOnce(bool value, float psi, float baseline, bool below, bool s1, bool s2, const char* reason = "") {
  if (!wifiReady()) {
    Serial.println("[HTTP] skip: Wi-Fi not connected");
    return false;
  }

  Serial.print("Sending HEARTBEAT -  Reason: ");
  Serial.println(reason);

  IPAddress ip = WiFi.localIP();
  char ipStr[32];
  snprintf(ipStr, sizeof(ipStr), "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]);

  float tempOut = isnan(lastTempF) ? 0.0f : lastTempF;
  float humidityOut = isnan(lastHumidityPct) ? 0.0f : lastHumidityPct;

  char connectedSensors[64];
  size_t csLen = 0;
  csLen += snprintf(connectedSensors + csLen,
                    (csLen < sizeof(connectedSensors)) ? sizeof(connectedSensors) - csLen : 0,
                    "[\"PRESSURE\"");
  if (sensor1Use && csLen < sizeof(connectedSensors) - 1) {
    csLen += snprintf(connectedSensors + csLen,
                      sizeof(connectedSensors) - csLen,
                      ",\"RAIN\"");
  }
  if (sensor2Use && csLen < sizeof(connectedSensors) - 1) {
    csLen += snprintf(connectedSensors + csLen,
                      sizeof(connectedSensors) - csLen,
                      ",\"SOIL\"");
  }
  if (csLen < sizeof(connectedSensors) - 1) {
    connectedSensors[csLen++] = ']';
    connectedSensors[csLen] = '\0';
  } else {
    connectedSensors[sizeof(connectedSensors) - 2] = ']';
    connectedSensors[sizeof(connectedSensors) - 1] = '\0';
  }

  char timestamp[32];
  time_t now = WiFi.getTime();
  if (now == 0) {
    now = millis() / 1000;
  }
  struct tm* utc = gmtime(&now);
  if (utc) {
    snprintf(timestamp, sizeof(timestamp), "%04d-%02d-%02dT%02d:%02d:%02dZ",
             utc->tm_year + 1900,
             utc->tm_mon + 1,
             utc->tm_mday,
             utc->tm_hour,
             utc->tm_min,
             utc->tm_sec);
  } else {
    snprintf(timestamp, sizeof(timestamp), "1970-01-01T00:00:00Z");
  }

  // include optional reason field; enlarge buffer to accommodate
  char body[512];
  int n = snprintf(body, sizeof(body),
                   "{\"guard\":%s,\"sensors\":{\"waterPsi\":%.2f,\"rain\":%s,\"soil\":%s},"
                   "\"device\":{\"ip\":\"%s\",\"tempF\":%.2f,\"humidity\":%.2f,"
                   "\"baselinePsi\":%.2f,\"connectedSensors\":%s},"
                   "\"timestamp\":\"%s\",\"reason\":\"%s\"}",
                   value ? "true" : "false",
                   psi,
                   s1 ? "true" : "false",
                   s2 ? "true" : "false",
                   ipStr,
                   tempOut,
                   humidityOut,
                   baseline,
                   connectedSensors,
                   timestamp,
                   (reason ? reason : ""));
  if (n <= 0 || n >= (int)sizeof(body)) {
    Serial.println("[HTTP] json build error");
    return false;
  }

  http.beginRequest();
  http.post(API_PATH);
  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("Content-Length", n);
  http.beginBody();
  http.write((const uint8_t*)body, n);
  http.endRequest();

  int code = http.responseStatusCode();
  String response = http.responseBody();

  bool ok = (code < 300);
  if (ok) {
    lastSentValid = true;
    lastSentValue = value;
    lastSendMs    = millis();
    Serial.print("[HTTP] OK "); Serial.println(code);
  } else {
    Serial.print("[HTTP] FAIL "); Serial.println(code);
  }
  return ok;
}

// Helper: extract a raw JSON value (number/boolean/string) for a key inside config
static String getJsonValueInConfig(const String &resp, const char *key, int configStart) {
  String keyP = String("\"") + key + String("\":");
  int pos = resp.indexOf(keyP, configStart);
  if (pos == -1) return String("");
  int vStart = pos + keyP.length();
  // skip whitespace
  while (vStart < resp.length() && (resp.charAt(vStart) == ' ' || resp.charAt(vStart) == '\n' || resp.charAt(vStart) == '\r' || resp.charAt(vStart) == '\t')) vStart++;
  if (vStart >= resp.length()) return String("");
  // If value is a quoted string
  if (resp.charAt(vStart) == '"') {
    int vEnd = resp.indexOf('"', vStart + 1);
    if (vEnd == -1) vEnd = resp.length();
    return resp.substring(vStart + 1, vEnd);
  }
  // Otherwise number or boolean — read until comma or closing brace
  int vEnd = vStart;
  while (vEnd < resp.length()) {
    char c = resp.charAt(vEnd);
    if (c == ',' || c == '}' || c == '\n' || c == '\r') break;
    vEnd++;
  }
  String out = resp.substring(vStart, vEnd);
  out.trim();
  // Remove leading colon if present (defensive)
  if (out.startsWith(":")) {
    out = out.substring(1);
    out.trim();
  }
  return out;
}

// Parse server response and apply configuration; returns true if config object found
static bool parseServerConfig(const String &response) {
  int configStart = response.indexOf("\"config\":{");
  if (configStart == -1) return false;

  bool configChanged = false;

  // baselineDefault - only apply if we're not in baseline adjustment mode
  String v = getJsonValueInConfig(response, "baselineDefault", configStart);
  if (v.length() > 0) {
    float newServerBaseline = v.toFloat();
    if (fabs(newServerBaseline - serverBaselinePsi) > 0.001f) {
      serverBaselinePsi = newServerBaseline;
      configChanged = true;
    }
    // Only apply server baseline if we're not actively adjusting it
    if (!knobModeActive && !baselineDirty) {
      if (fabs(baselinePsi - serverBaselinePsi) > 0.001f) {
        baselinePsi = serverBaselinePsi;
        // baseline change is logically a config change (already recorded above)
      }
    }
  }

  // rainEnabled (server preference)
  v = getJsonValueInConfig(response, "rainEnabled", configStart);
  if (v.length() > 0) {
    bool newRain = (v == "true");
    if (newRain != rainEnabled) {
      rainEnabled = newRain;
      configChanged = true;
    }
    // Only change actual device usage if the user hasn't locally overridden
    if (sensor1Use == sensor1UsePrev) {
      sensor1Use = rainEnabled;
    }
  }

  // moistEnabled (server preference)
  v = getJsonValueInConfig(response, "moistEnabled", configStart);
  if (v.length() > 0) {
    bool newMoist = (v == "true");
    if (newMoist != moistEnabled) {
      moistEnabled = newMoist;
      configChanged = true;
    }
    if (sensor2Use == sensor2UsePrev) {
      sensor2Use = moistEnabled;
    }
  }

  // guardEnabled
  v = getJsonValueInConfig(response, "guardEnabled", configStart);
  if (v.length() > 0) {
    bool newGuard = (v == "true");
    if (newGuard != guardEnabled) {
      guardEnabled = newGuard;
      configChanged = true;
    }
  }

  // PSI spike delta threshold
  v = getJsonValueInConfig(response, "psiSpikeDelta", configStart);
  if (v.length() > 0) {
    float newSpikeDelta = v.toFloat();
    if (fabs(newSpikeDelta - PSI_SPIKE_DELTA) > 0.001f) {
      PSI_SPIKE_DELTA = newSpikeDelta;
      configChanged = true;
    }
  }

  // Timing configuration
  v = getJsonValueInConfig(response, "heartbeatIntervalMs", configStart);
  if (v.length() > 0) {
    unsigned long newHb = (unsigned long)v.toFloat();
    if (newHb != heartbeatIntervalMs) {
      heartbeatIntervalMs = newHb;
      configChanged = true;
    }
  }

  bool forceHeartbeat = false;
  v = getJsonValueInConfig(response, "forceHeartbeat", configStart);
  if (v.length() > 0) {
    forceHeartbeat = (v == "true");
  }

  v = getJsonValueInConfig(response, "sampleIntervalMs", configStart);
  if (v.length() > 0) {
    unsigned long newSample = (unsigned long)v.toFloat();
    if (newSample != sampleIntervalMs) {
      sampleIntervalMs = newSample;
      SAMPLE_MS = sampleIntervalMs;
      configChanged = true;
    }
  }

  // ensure LEDs reflect current (possibly updated) state
  btn.setLeds(btnLed0, sensor1Use, sensor2Use);

  // If any config field changed on the server side, force a heartbeat so server receives
  // the device's current state and the guard system can react immediately.
  if (configChanged || forceHeartbeat) {
    Serial.println("[CONFIG] Updated from server (change detected)");
    Serial.print(" baseline="); Serial.println(serverBaselinePsi);
    Serial.print(" guardEnabled="); Serial.println(guardEnabled ? "true" : "false");
    Serial.print(" heartbeatIntervalMs="); Serial.println(heartbeatIntervalMs);
    Serial.print(" sampleIntervalMs="); Serial.println(sampleIntervalMs);
    Serial.print(" psiSpikeDelta="); Serial.println(PSI_SPIKE_DELTA);
    Serial.print(" forceHeartbeat="); Serial.println(forceHeartbeat);

  // Compute an immediate send using the device's current measured state
  bool isBelowNow = computeRelationWithHysteresis(lastPsi, baselinePsi, prevBelow);
  // Read raw hardware detection to include in heartbeat payload
  bool s1_hw_now = (digitalRead(SENSOR1_PIN) == HIGH);
  bool s2_hw_now = (digitalRead(SENSOR2_PIN) == HIGH);
  bool s1_eff_now = sensor1Use ? s1_hw_now : false;
  bool s2_eff_now = sensor2Use ? s2_hw_now : false;
  bool relayDesiredNow = guardEnabled ? (isBelowNow || s1_eff_now || s2_eff_now) : false;
  // Queue a single bypass send to report device's current state back to server (send raw sensed values)
  queueSend(relayDesiredNow, lastPsi, baselinePsi, true, isBelowNow, s1_hw_now, s2_hw_now, forceHeartbeat ? "forced-heartbeat" : "config-change");

    // Update prev snapshot so we don't treat server-applied activation as a local change
    sensor1UsePrev = sensor1Use;
    sensor2UsePrev = sensor2Use;
  }

  return true;
}

void handleSamplingAndEvents(unsigned long now) {
  // If Wi‑Fi is down or an error was seen, notify a reconnect plan
  if (!wifiReady() || sawWifiError) {
    planWifiReconnectBeforeNextSample(now);
  }
  // Core sampling entry: either periodic (time-based) or forced (button-triggered)
  bool forced = forceSampleNow;
  if (!forced) {
    if (now < nextSampleMs) return;
    nextSampleMs = now + SAMPLE_MS;
  } else {
    // consume the force once; allow immediate run
    forceSampleNow = false;
  }

  float psi = readPsiOnce();
  float prevPsiSample = lastPsi;
  bool  hadPrevPsi    = lastPsiValid;
  lastPsi = psi;
  lastPsiValid = true;
  // Sample temperature & humidity alongside pressure
  float t = (tempHum.getTemperature() * 1.8f) + 32.0f;
  float h = tempHum.getHumidity();
  if (!isnan(t)) lastTempF = t;
  if (!isnan(h)) lastHumidityPct = h;

  // Read digital sensors: these are the raw detection values (what's actually being sensed)
  bool s1_hw = (digitalRead(SENSOR1_PIN) == HIGH);
  bool s2_hw = (digitalRead(SENSOR2_PIN) == HIGH);
  // Effective sensor values used for guard logic (consider bypass)
  bool s1_eff = sensor1Use ? s1_hw : false;
  bool s2_eff = sensor2Use ? s2_hw : false;

  // Snapshot previous detection state so we can detect changes in what's being sensed
  bool prevS1Detected = sensor1Last;
  bool prevS2Detected = sensor2Last;

  // If the user toggled either sensor's activation via buttons, force a send
  bool activationChanged = (sensor1Use != sensor1UsePrev) || (sensor2Use != sensor2UsePrev);
  if (activationChanged) {
    Serial.println("[ButtonOverride] sensor activation toggled -> forcing send");
  }

  bool isBelow = computeRelationWithHysteresis(psi, baselinePsi, prevBelow);

  // Detect change in actual sensor detection (closed/open) — compare raw/hardware values
  bool sensorDetectionChanged = (s1_hw != prevS1Detected) || (s2_hw != prevS2Detected);
  if (sensorDetectionChanged) {
    Serial.println("[SensorChange] sensor detection state changed -> forcing send");
  }

  // Update previous detection snapshot after comparing (store raw detected values)
  sensor1Last = s1_hw;
  sensor2Last = s2_hw;
  // Update global effective sensor state so updateRelay() and other code see current values
  ::s1_eff = s1_eff;
  ::s2_eff = s2_eff;

  bool sendNow   = false;
  bool sendValue = isBelow;
  bool spikeTriggered = false;

  // If any sensor's detection changed (opened/closed), force a send so server and guard can react
  if (sensorDetectionChanged) {
    sendNow = true;
    sendValue = isBelow;
  }

  // Unified, authoritative logging of current reading + whether a crossing happened this cycle
  Serial.print("[SAMPLE] ");
  Serial.print(KEY_PRESSURE); Serial.print("="); Serial.print(psi, 2);
  Serial.print(" baseline=");          Serial.print(baselinePsi, 2);
  Serial.print(" tempF=");             Serial.print(lastTempF, 2);
  Serial.print(" hum%=");              Serial.print(lastHumidityPct, 2);
  Serial.print(" ip=");               Serial.print(WiFi.localIP());
  Serial.print(" "); Serial.print(SENSOR1_NAME); Serial.print("="); Serial.print(s1_eff ? "closed" : "open");
  Serial.print(" "); Serial.print(SENSOR2_NAME); Serial.print("="); Serial.println(s2_eff ? "closed" : "open");


  if (hadPrevPsi) {
    float delta = psi - prevPsiSample;
    if (delta < 0.0f) delta = -delta;
    if (delta >= PSI_SPIKE_DELTA) {
      spikeTriggered = true;
      Serial.print("[Spike] PSI delta detected (prev=");
      Serial.print(prevPsiSample, 2);
      Serial.print(" curr=");
      Serial.print(psi, 2);
      Serial.print(" delta=");
      Serial.print(delta, 2);
      Serial.print(" >= ");
      Serial.print(PSI_SPIKE_DELTA, 2);
      Serial.println(")");
    }
  }

  bool immediateSend = forced || spikeTriggered;

  if (immediateSend) {
    sendNow = true;            // button-requested sample always sends
    sendValue = isBelow;
  }

  // Detect crossing strictly from PSI evolution (baseline-caused crossings handled in handleKnob)
  if (isBelow != prevBelow) {
    justCrossed = true;
    prevBelow   = isBelow;
  }

  if (justCrossed) {
    sendNow   = true;
    sendValue = isBelow;
  }

  // Heartbeat
  bool heartbeatDue = false;
  if (!forced && lastSentValid && (now - lastSendMs > heartbeatIntervalMs)) {
    sendNow   = true;
    sendValue = lastSentValue;
    heartbeatDue = true;
    Serial.println("[Heartbeat] queued");
  }

  // Force a send whenever sensor activation flags changed via buttons
  if (activationChanged) {
    sendNow   = true;
    sendValue = isBelow; // desired below/above state; relayDesired will also include s1_eff & s2_eff
  }

  if (sendNow) {
    // If guard is disabled, force relay to false regardless of sensor states
    bool relayDesired = guardEnabled ? (sendValue || s1_eff || s2_eff) : false;
    bool bypassGate = false;
    if (forced) {
      bypassGate = forceBypassGate;
    } else if (spikeTriggered) {
      bypassGate = true; // ensure spike-triggered updates are not suppressed
    }

    // Determine a concise reason for this heartbeat
    const char* hbReason = "";
    if (spikeTriggered) hbReason = "spike";
    else if (forced) hbReason = "manual";
    else if (sensorDetectionChanged) hbReason = "sensor-change";
    else if (activationChanged) hbReason = "activation-change";
    else if (justCrossed) hbReason = "crossing";
    else if (heartbeatDue) hbReason = "heartbeat";

    // Send raw detected sensor values in payload, use effective values only for relay decision
    queueSend(relayDesired, psi, baselinePsi, bypassGate, isBelow, s1_hw, s2_hw, hbReason);
    if (forced) forceBypassGate = false; // reset one-shot bypass after use
  }

  // Update activation snapshot after evaluating this cycle
  sensor1UsePrev = sensor1Use;
  sensor2UsePrev = sensor2Use;

  // reset one-shot crossing flag for next loop
  justCrossed = false;
}

void updateRelay(bool value){
  // If guard system is disabled, always keep relay LOW regardless of other conditions
  if (!guardEnabled) {
    digitalWrite(RELAY_PIN, LOW);
    return;
  }
  
  // Only proceed with activation logic if guard system is enabled
  bool shouldActivate = value; // Start with requested value
  
  // Check sensor states - activate relay if ANY sensor is detecting (closed)
  if (guardEnabled) {
    if ((rainEnabled && sensor1Use && s1_eff) ||    // Rain detected
        (moistEnabled && sensor2Use && s2_eff)) {    // Moisture detected
      shouldActivate = true;
    }
  }
  
  digitalWrite(RELAY_PIN, shouldActivate ? HIGH : LOW);
}

void serviceNetwork(bool knobActive, unsigned long now) {
  if (knobActive) return;
  if (!wifiReady()) return;

  // Periodically poll backend for config when idle
  if (now >= nextConfigFetchMs) {
    nextConfigFetchMs = now + CONFIG_POLL_MS;      
    // Only attempt when UI is idle (already ensured by knobActive check)
    (void)fetchDeviceConfigOnce();
  }

  if (!pendingSend.has) return;
  PendingSend ps = pendingSend;
  pendingSend.has = false;

  // Once queued, always attempt to send (no additional gating here)
  updateRelay(ps.relay);
  if (!postHeartBeatOnce(ps.relay, ps.psi, ps.baseline, ps.below, ps.s1, ps.s2, ps.reason)) {
    // requeue on failure
    pendingSend = ps;
    Serial.println("[HTTP] requeue after failure");
  }
}

// Post local config changes to server
bool postDeviceConfigOnce() {
  if (!wifiReady()) return false;

  IPAddress ip = WiFi.localIP();
  char ipStr[32];
  snprintf(ipStr, sizeof(ipStr), "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]);

  // Build path: /api/device/config/<ip>
  char path[128];
  int pn = snprintf(path, sizeof(path), "%s%s", CONFIG_PATH, ipStr);
  if (pn <= 0 || pn >= (int)sizeof(path)) return false;

  // Build config JSON body
  char body[256];
  int n = snprintf(body, sizeof(body),
                  "{\"baselineDefault\":%.2f,\"rainEnabled\":%s,\"moistEnabled\":%s,\"psiSpikeDelta\":%.1f,"
                  "\"guardEnabled\":%s,\"sampleIntervalMs\":%lu,\"heartbeatIntervalMs\":%lu}",
                  baselinePsi,
                  sensor1Use ? "true" : "false",
                  sensor2Use ? "true" : "false",
                  PSI_SPIKE_DELTA,
                  guardEnabled ? "true" : "false",
                  sampleIntervalMs,
                  heartbeatIntervalMs);
  if (n <= 0 || n >= (int)sizeof(body)) return false;

  http.beginRequest();
  http.put(path);
  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("Content-Length", n);
  http.beginBody();
  http.write((const uint8_t*)body, n);
  http.endRequest();

  int code = http.responseStatusCode();
  if (code < 300) {
    Serial.println("[Config] Successfully updated server config");
    return true;
  }
  Serial.print("[Config] Failed to update server config: "); Serial.println(code);
  return false;
}

// Fetch device config directly from backend (useful when config changed via frontend)
bool fetchDeviceConfigOnce() {
  if (!wifiReady()) return false;

  IPAddress ip = WiFi.localIP();
  char ipStr[32];
  snprintf(ipStr, sizeof(ipStr), "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]);

  // Build path: /api/device/config/<ip>
  char path[128];
  int pn = snprintf(path, sizeof(path), "%s%s", CONFIG_PATH, ipStr);
  if (pn <= 0 || pn >= (int)sizeof(path)) return false;

  http.beginRequest();
  http.get(path);
  http.endRequest();

  int code = http.responseStatusCode();
  String body = http.responseBody();

  if(code == 204){
    Serial.println("Config does not exist in the server. Pushing defaults.");
    postDeviceConfigOnce();
    return true;
  }
  
  if (code < 300 && body.length() > 0) {
    Serial.print("[HTTP] Config fetch OK "); Serial.println(code);
    // Backend returns { data: <config> } — normalize to { "config": <config> } for parser
    String normalized = body;
    int dataPos = normalized.indexOf("\"data\":");
    if (dataPos != -1) {
      normalized.replace("\"data\":", "\"config\":");
    }
    parseServerConfig(normalized);
    return true;
  }

  
  Serial.print("[HTTP] Config fetch FAIL "); Serial.println(code);
  return false;
}

// ======== MAIN PROGRAM ========
void setup() {
  Serial.begin(115200);
  Wire.begin();
  Modulino.begin();
  ledMatrix.begin();
  // Show Wi-Fi connecting screen at setup
  renderWifiStatus(WL_DISCONNECTED, millis());
  
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(SENSOR1_PIN, INPUT_PULLUP);
  pinMode(SENSOR2_PIN, INPUT_PULLUP);
  analogReadResolution(ADC_RES_BITS);

  pixels.begin(); pixels.clear(); pixels.show();
  knob.begin(); delay(20);
  buzzer.begin();
  tempHum.begin();
  btn.begin();
  btnLed0 = true;

  lastKnobAbs = knob.get();
  knobAbsInited = true;
  baselinePsi = 0.0f;
  nextBlinkMs = millis() + BASELINE_BLINK_MS;

  lastPsi   = readPsiOnce();
  lastPsiValid = true;
  prevBelow = computeRelationWithHysteresis(lastPsi, baselinePsi, false);

  wifi.setTimeout(300);
  // Plan and execute initial connection through the same reconnect service path
  nextReconnectAtMs = millis();
  serviceWifiReconnect(nextReconnectAtMs);
  nextSampleMs = millis();
}

void loop() {
  unsigned long now = millis();

  handleKnob(now);
  handleKnobPress();
  handleButtons();
  bool knobActive = knobModeActive;
  noteWifiTransition();
  bool connected = wifiReady();

  if (connected) {
    handleSamplingAndEvents(now);
    handleUIChanges(now, knobActive, sensor1Use, sensor2Use);
  } else {
    // Reflect Wi‑Fi state and plan a reconnect slightly before next sample
    renderWifiStatus(WiFi.status(), now);
    planWifiReconnectBeforeNextSample(now);
  }

  // Drive buzzer scheduler every loop
  serviceBuzzer(now);

  //Network I/O only when UI idle
  serviceWifiReconnect(now);
  serviceNetwork(knobActive, now);

  // Breather
  delay(2);
}
