/*
 * ESP32 Remote PC Controller & Environmental Monitor
 * 
 * Hardware Connections:
 * - DHT11 Data Pin -> GPIO 14 (Internal pullup or external 10k pullup recommended)
 * - DHT22 Data Pin -> GPIO 27 (Internal pullup or external 10k pullup recommended)
 * - Power Relay Pin -> GPIO 12 (Connected to PC Power Button header pin via optocoupler/relay)
 * - Reset Relay Pin -> GPIO 13 (Connected to PC Reset Button header pin via optocoupler/relay)
 * 
 * Libraries Required:
 * 1. ArduinoJson (by Benoit Blanchon) - Install via Library Manager (v6 or v7)
 * 2. DHT sensor library (by Adafruit) - Install via Library Manager
 * 3. Adafruit Unified Sensor (by Adafruit) - Dependency for DHT library
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"
#include <WiFiManager.h> // https://github.com/tzapu/WiFiManager

// --- CONFIGURATION SETUP ---
// WiFi credentials are managed dynamically via WiFiManager captive portal.
const char* server_url = "https://pccontroll.espserver.site/data";

#define POLL_INTERVAL_MS 5000 // Send data and fetch action every 5 seconds

// --- HARDWARE CONFIGURATION ---
#define DHT11_PIN       4
#define POWER_RELAY_PIN 25
#define RESET_RELAY_PIN 25

// Set to true if using active-low relays (typical for Arduino relay modules)
// Set to false if using active-high relays or direct transistors/optocouplers
#define RELAY_ACTIVE_LOW true 

#define DHT11_TYPE DHT11

// --- INSTANTIATE SENSORS ---
DHT dht11(DHT11_PIN, DHT11_TYPE);

// --- GLOBAL VARIABLES ---
unsigned long lastPollTime = 0;
String pendingLogMsg = "";
bool bootLogSent = false;

// Helper macros for relay states
const int RELAY_ON = RELAY_ACTIVE_LOW ? LOW : HIGH;
const int RELAY_OFF = RELAY_ACTIVE_LOW ? HIGH : LOW;

void setupWiFiManager() {
  // Explicitly set WiFi to station mode
  WiFi.mode(WIFI_STA);
  delay(100);

  WiFiManager wm;
  
  // Set configuration portal timeout to 180 seconds to avoid blocking indefinitely.
  wm.setConfigPortalTimeout(180);

  Serial.println("[INFO] Attempting to connect to WiFi...");

  bool connected = false;
  
  // 1. Try stored WiFi credentials if they exist
  if (WiFi.SSID() != "") {
    Serial.println("[INFO] Trying stored WiFi credentials...");
    WiFi.begin();
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      connected = true;
    }
  }

  // 2. If not connected, try the user's default credentials (SSID: War)
  if (!connected) {
    Serial.println("\n[INFO] Disconnecting previous attempt and trying default WiFi credentials (SSID: War)...");
    WiFi.disconnect(true);
    delay(1000); // Give the radio time to settle
    
    WiFi.begin("War", "Hello2025@");
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      connected = true;
    }
  }

  // 3. If still not connected, start the captive portal AP
  if (!connected) {
    Serial.println("\n[WARN] Failed to connect to default or stored WiFi. Disconnecting and starting Captive Portal...");
    WiFi.disconnect(true);
    delay(1000); // Give the radio time to settle before WiFiManager starts AP mode
    
    if (!wm.autoConnect("ESP32_PC_Controller_AP", "password123")) {
      Serial.println("[ERROR] Failed to connect and hit configuration timeout. Restarting ESP32...");
      delay(3000);
      ESP.restart();
    }
  }

  // Connected to Wi-Fi
  Serial.println("\n[SUCCESS] WiFi Connected!");
  Serial.print("[INFO] IP Address: ");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- PC Control Node Initializing ---");

  // Configure Relays
  pinMode(POWER_RELAY_PIN, OUTPUT);
  pinMode(RESET_RELAY_PIN, OUTPUT);
  digitalWrite(POWER_RELAY_PIN, RELAY_OFF);
  digitalWrite(RESET_RELAY_PIN, RELAY_OFF);
  Serial.println("[INFO] GPIO Relay pins configured.");

  // Initialize Sensors
  dht11.begin();
  Serial.println("[INFO] DHT Sensor initialized.");

  // Connect to Wi-Fi using WiFiManager
  setupWiFiManager();
  
  pendingLogMsg = "[SYSTEM] ESP32 controller booted up and connected to WiFi.";
}

void loop() {
  // Check for serial input to reset settings
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.equalsIgnoreCase("reset")) {
      Serial.println("[SYSTEM] Reset command received. Wiping WiFi credentials...");
      WiFiManager wm;
      wm.resetSettings();
      Serial.println("[SYSTEM] Reset complete. Restarting ESP32...");
      delay(1000);
      ESP.restart();
    }
  }

  // Keep WiFi connected
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  unsigned long currentMillis = millis();
  if (currentMillis - lastPollTime >= POLL_INTERVAL_MS) {
    lastPollTime = currentMillis;
    sendDataAndCheckAction();
  }
}

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.println("[INFO] WiFi connection lost. Reconnecting to saved network...");
  
  WiFi.begin(); // ESP32 will auto-connect using last stored credentials from SDK NVS
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[SUCCESS] WiFi Connected!");
    Serial.print("[INFO] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[ERROR] WiFi Connection Failed. Retrying in loop...");
  }
}

void sendDataAndCheckAction() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  
  // Read DHT11
  float t11 = dht11.readTemperature();
  float h11 = dht11.readHumidity();

  // Create JSON Document
  // StaticJsonDocument is compatible with ArduinoJson v6
  // (In v7, JsonDocument can be used directly: JsonDocument doc;)
  StaticJsonDocument<512> doc;

  // Add Sensor Data
  JsonObject dht11Obj = doc.createNestedObject("dht11");
  if (!isnan(t11) && !isnan(h11)) {
    dht11Obj["temperature"] = t11;
    dht11Obj["humidity"] = h11;
  } else {
    dht11Obj["temperature"] = serialized("null");
    dht11Obj["humidity"] = serialized("null");
    Serial.println("[WARN] DHT11 read failed.");
  }

  // Include queued logs if any
  if (pendingLogMsg != "") {
    doc["log"] = pendingLogMsg;
    pendingLogMsg = ""; // Reset after sending
  }

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  // Send HTTP Post
  http.begin(server_url);
  http.addHeader("Content-Type", "application/json");
  
  Serial.print("[HTTP] POST payload: ");
  Serial.println(jsonPayload);

  int httpCode = http.POST(jsonPayload);

  if (httpCode > 0) {
    Serial.print("[HTTP] POST Response Code: ");
    Serial.println(httpCode);

    if (httpCode == HTTP_CODE_OK) {
      String responseBody = http.getString();
      Serial.print("[HTTP] Response payload: ");
      Serial.println(responseBody);

      parseActionResponse(responseBody);
    }
  } else {
    Serial.print("[ERROR] POST Request failed, error: ");
    Serial.println(http.errorToString(httpCode).c_str());
  }

  http.end();
}

void parseActionResponse(String responseJson) {
  StaticJsonDocument<128> doc;
  DeserializationError error = deserializeJson(doc, responseJson);

  if (error) {
    Serial.print("[ERROR] JSON deserialization failed: ");
    Serial.println(error.c_str());
    return;
  }

  const char* action = doc["action"];
  if (action == nullptr) return;

  String actionStr = String(action);
  if (actionStr == "pulse") {
    Serial.println("[ACTION] Power Button pulse triggered.");
    pendingLogMsg = "[INFO] ESP32 received Power Pulse command from server.";
    triggerRelay(POWER_RELAY_PIN, "Power Button");
  } else if (actionStr == "restart") {
    Serial.println("[ACTION] Reset Button pulse triggered.");
    pendingLogMsg = "[INFO] ESP32 received Reset Pulse command from server.";
    triggerRelay(RESET_RELAY_PIN, "Reset Button");
  }
}

void triggerRelay(int pin, String name) {
  Serial.print("[HARDWARE] Activating relay on GPIO ");
  Serial.print(pin);
  Serial.print(" (");
  Serial.print(name);
  Serial.println(")");

  // Press button (activate relay)
  digitalWrite(pin, RELAY_ON);
  
  // Hold button for 500 milliseconds
  delay(500);
  
  // Release button (deactivate relay)
  digitalWrite(pin, RELAY_OFF);
  
  Serial.println("[HARDWARE] Relay deactivated.");
  pendingLogMsg = "[SUCCESS] " + name + " relay pulse completed (500ms).";
}
