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
#include <SocketIOclient.h>

// --- CONFIGURATION SETUP ---
// WiFi credentials are managed dynamically via WiFiManager captive portal.
const char* socket_host = "pccontroll.espserver.site";
const int socket_port = 443;
const char* socket_path = "/socket.io/?EIO=4";

// --- HARDWARE CONFIGURATION ---
#define DHT11_PIN       4
#define POWER_RELAY_PIN 25
#define RESET_RELAY_PIN 25

// Set to true if using active-low relays (typical for Arduino relay modules)
// Set to false if using active-high relays or direct transistors/optocouplers
#define RELAY_ACTIVE_LOW true 

#define DHT11_TYPE DHT11

// --- INSTANTIATE SENSORS & SOCKET.IO ---
DHT dht11(DHT11_PIN, DHT11_TYPE);
SocketIOclient socketIO;

// --- GLOBAL VARIABLES ---
unsigned long lastPollTime = 0;
String pendingLogMsg = "";
bool bootLogSent = false;
bool deviceOnline = false;
#define POLL_INTERVAL_MS 5000

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

  // Connect to Socket.IO Server
  Serial.print("[IOc] Connecting to Socket.IO server at wss://");
  Serial.println(socket_host);
  socketIO.beginSSL(socket_host, socket_port, socket_path);
  socketIO.onEvent(socketIOEvent);
  
  pendingLogMsg = "[SYSTEM] ESP32 controller booted up and connected to WiFi.";
}

void loop() {
  // Service Socket.IO events
  socketIO.loop();

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
    sendSensorData();
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

void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  float t11 = dht11.readTemperature();
  float h11 = dht11.readHumidity();

  StaticJsonDocument<256> doc;
  JsonObject dht11Obj = doc.createNestedObject("dht11");
  if (!isnan(t11) && !isnan(h11)) {
    dht11Obj["temperature"] = t11;
    dht11Obj["humidity"] = h11;
  } else {
    dht11Obj["temperature"] = serialized("null");
    dht11Obj["humidity"] = serialized("null");
  }
  doc["ssid"] = WiFi.SSID();

  // If there is a pending log message, send it as a log event
  if (pendingLogMsg != "") {
    sendESP32Log(pendingLogMsg);
    pendingLogMsg = "";
  }

  String jsonPayload;
  serializeJson(doc, jsonPayload);
  
  String msg = "[\"sensorUpdate\"," + jsonPayload + "]";
  socketIO.sendEVENT(msg);
  Serial.print("[IOc] Sent sensorUpdate: ");
  Serial.println(msg);
}

void sendESP32Status() {
  StaticJsonDocument<128> doc;
  doc["status"] = "Online";
  doc["ssid"] = WiFi.SSID();
  
  String jsonPayload;
  serializeJson(doc, jsonPayload);
  
  String msg = "[\"esp32Status\"," + jsonPayload + "]";
  socketIO.sendEVENT(msg);
  Serial.print("[IOc] Sent esp32Status: ");
  Serial.println(msg);
}

void sendESP32Log(String logMsg) {
  String msg = "[\"esp32Log\",\"" + logMsg + "\"]";
  socketIO.sendEVENT(msg);
  Serial.print("[IOc] Sent esp32Log: ");
  Serial.println(msg);
}

void handleAction(String command) {
  if (command == "pulse") {
    Serial.println("[ACTION] Power Button pulse triggered.");
    sendESP32Log("[INFO] ESP32 received Power Pulse command from server.");
    triggerRelay(POWER_RELAY_PIN, "Power Button");
  } else if (command == "restart") {
    Serial.println("[ACTION] Reset Button pulse triggered.");
    sendESP32Log("[INFO] ESP32 received Reset Pulse command from server.");
    triggerRelay(RESET_RELAY_PIN, "Reset Button");
  }
}

void socketIOEvent(socketIOmessageType_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case sIOtype_DISCONNECT:
      Serial.println("[IOc] Disconnected!");
      deviceOnline = false;
      break;
    case sIOtype_CONNECT:
      Serial.println("[IOc] Connected!");
      socketIO.send(sIOtype_CONNECT, "/");
      deviceOnline = true;
      sendESP32Status();
      break;
    case sIOtype_EVENT: {
      String payloadStr = (char*)payload;
      Serial.print("[IOc] Event: ");
      Serial.println(payloadStr);

      DynamicJsonDocument doc(512);
      DeserializationError error = deserializeJson(doc, payloadStr);
      if (error) {
        Serial.print("[ERROR] Deserialization failed: ");
        Serial.println(error.c_str());
        return;
      }

      String eventName = doc[0];
      if (eventName == "action") {
        JsonObject data = doc[1];
        String command = data["command"];
        handleAction(command);
      }
      break;
    }
    case sIOtype_ACK:
    case sIOtype_ERROR:
    case sIOtype_BINARY_EVENT:
    case sIOtype_BINARY_ACK:
      break;
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
  
  // Hold button for 1 second (1000ms)
  delay(1000);
  
  // Release button (deactivate relay)
  digitalWrite(pin, RELAY_OFF);
  
  Serial.println("[HARDWARE] Relay deactivated.");
  sendESP32Log("[SUCCESS] " + name + " relay pulse completed (1s).");
}
