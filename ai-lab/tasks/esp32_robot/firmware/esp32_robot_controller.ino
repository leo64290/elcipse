/*
 * Firmware minimal pour un petit robot a base d'ESP32, pilote a distance
 * par l'IA Python du module esp32_robot (ai-lab/tasks/esp32_robot).
 *
 * Expose en HTTP sur le reseau local:
 *   GET /sensors            -> {"distance_cm": <float>}
 *   GET /command?cmd=<cmd>  -> "OK"  (cmd = forward|back|left|right|stop)
 *
 * Adaptez PIN_TRIG/PIN_ECHO et les pins moteur a votre cablage.
 */

#include <WiFi.h>
#include <WebServer.h>

const char *WIFI_SSID = "VOTRE_SSID";
const char *WIFI_PASSWORD = "VOTRE_MOT_DE_PASSE";

const int PIN_TRIG = 5;
const int PIN_ECHO = 18;

const int PIN_MOTOR_LEFT_FWD = 25;
const int PIN_MOTOR_LEFT_BWD = 26;
const int PIN_MOTOR_RIGHT_FWD = 27;
const int PIN_MOTOR_RIGHT_BWD = 14;

WebServer server(80);

float readDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long durationUs = pulseIn(PIN_ECHO, HIGH, 30000);
  if (durationUs == 0) {
    return 999.0;
  }
  return durationUs / 58.0;
}

void stopMotors() {
  digitalWrite(PIN_MOTOR_LEFT_FWD, LOW);
  digitalWrite(PIN_MOTOR_LEFT_BWD, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_FWD, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_BWD, LOW);
}

void applyCommand(const String &cmd) {
  stopMotors();
  if (cmd == "forward") {
    digitalWrite(PIN_MOTOR_LEFT_FWD, HIGH);
    digitalWrite(PIN_MOTOR_RIGHT_FWD, HIGH);
  } else if (cmd == "back") {
    digitalWrite(PIN_MOTOR_LEFT_BWD, HIGH);
    digitalWrite(PIN_MOTOR_RIGHT_BWD, HIGH);
  } else if (cmd == "left") {
    digitalWrite(PIN_MOTOR_RIGHT_FWD, HIGH);
  } else if (cmd == "right") {
    digitalWrite(PIN_MOTOR_LEFT_FWD, HIGH);
  }
  // "stop" ou commande inconnue -> moteurs deja coupes par stopMotors().
}

void handleSensors() {
  float distanceCm = readDistanceCm();
  String json = "{\"distance_cm\": " + String(distanceCm, 1) + "}";
  server.send(200, "application/json", json);
}

void handleCommand() {
  if (!server.hasArg("cmd")) {
    server.send(400, "text/plain", "missing cmd");
    return;
  }
  applyCommand(server.arg("cmd"));
  server.send(200, "text/plain", "OK");
}

void setup() {
  Serial.begin(115200);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_MOTOR_LEFT_FWD, OUTPUT);
  pinMode(PIN_MOTOR_LEFT_BWD, OUTPUT);
  pinMode(PIN_MOTOR_RIGHT_FWD, OUTPUT);
  pinMode(PIN_MOTOR_RIGHT_BWD, OUTPUT);
  stopMotors();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  server.on("/sensors", handleSensors);
  server.on("/command", handleCommand);
  server.begin();
}

void loop() {
  server.handleClient();
}
