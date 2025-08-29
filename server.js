// server.js
// This server acts as the central hub for communication.
// It serves the web dashboard and relays messages between the dashboard and the ESP8266.

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

// Serve the static HTML file for the dashboard
app.use(express.static('public'));

let relayState = false; // Keep track of the relay's last known state on the server
let lastSensorData = {}; // Keep track of the last sensor data

// Handle WebSocket connections
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // Send the current state to the newly connected client
    socket.emit('relay-state-update', relayState);
    socket.emit('update-sensor-data', lastSensorData); // Send last known sensor data

    // Listen for control commands from the web dashboard
    socket.on('control-relay', (newState) => {
        relayState = newState;
        console.log(`Received command from web: Turn relay ${relayState ? 'ON' : 'OFF'}`);

        // Broadcast the new state to ALL connected clients (including the ESP8266)
        io.emit('relay-state-update', relayState);
    });

    // Listen for sensor data from the ESP8266
    socket.on('sensor-data', (data) => {
        try {
            // The data is coming in as a stringified JSON, so we parse it.
            const sensorReadings = JSON.parse(data);
            lastSensorData = sensorReadings;
            console.log('Received sensor data from ESP8266:', lastSensorData);
            
            // Broadcast the new data to all web clients (but not back to the ESP)
            socket.broadcast.emit('update-sensor-data', lastSensorData);
        } catch (e) {
            console.error("Error parsing sensor data from ESP8266:", e);
        }
    });

    // Listen for status reports from the ESP8266 (optional but good for sync)
    socket.on('esp-status-report', (espReportedState) => {
        relayState = espReportedState;
        console.log(`ESP8266 reports state is now: ${relayState ? 'ON' : 'OFF'}`);
        // Broadcast this confirmed state to all web clients
        socket.broadcast.emit('relay-state-update', relayState);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

server.listen(port, () => {
    console.log(`Server is running!`);
    console.log(`Open your browser to http://<YOUR_SERVER_IP>:${port}`);
});

