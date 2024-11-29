// WebSocket
const wSocket = require('ws');
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

module.exports = { setWss, getWss, broadcast };