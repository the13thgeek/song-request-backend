const express = require("express");
const wSocket = require("ws");
const { setWss } = require('./utils');
const app = express();
const port = 1300;

setTimeout(function() {
    console.log("[the13thgeek] NodeJS Backend System");
}, 5000);

app.use(express.json());

// HTTP->Websocket
const wss = new wSocket.Server({ noServer: true});
setWss(wss);

const server = app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

// Routing
const moduleSrs = require('./routes/srs');
const moduleTwitch = require('./routes/twitch');
app.use('/srs', moduleSrs);
app.use('/twitch', moduleTwitch);

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
    });
});

module.exports = app;