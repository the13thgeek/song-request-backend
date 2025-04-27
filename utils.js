// WebSocket
const wSocket = require('ws');
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

let wss = null;

// WebSocket Setter
function setWss(webSocketServer) {
    wss = webSocketServer;
}

function getWss() {
    return wss;
}

// Broadcaster
function broadcast(data) {
    if(!wss) {
        console.error("WebSocket server is not initialized.");
        return;
    } 
    wss.clients.forEach(client => {
        if(client.readyState === wSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Message logger
function log(message, isError = false) {
    const estTime = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York', // EST/EDT
        hour12: false, 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit'
    });
    if(!isError) {
        console.log(`[${estTime}] ${message}`);
    } else {
        console.error(`[${estTime}] ${message}`);
    }
    
}

// File hash
async function hashFile(filePath) {
    try {
        const data = await fs.readFile(filePath);
        return crypto.createHash('sha256').update(data).digest("hex");

    } catch(e) {
        log(`Error hashing file ${filePath}: ${e}`, true);
        return null
    }
}

module.exports = { setWss, getWss, broadcast, log, hashFile };