const express = require("express");
const wSocket = require("ws");
const { setWss } = require('./utils');
const app = express();
const port = 8080;
require('dotenv').config();

setTimeout(function() {
    console.log(`[the13thgeek] NodeJS Backend System v${process.env.GEEK_NODE_VER}`);
    console.log(`[the13thgeek] U : ${process.env.GEEKHUB_DB_USER}`);
    console.log(`[the13thgeek] P : ${process.env.GEEKHUB_DB_PASS}`);
}, 5000);

app.use(express.json());

// Adding API KEY authentication + middleware
const API_KEY = process.env.GEEK_API_KEY || "XX13XX";

app.use((req, res, next) => {
    const clientApiKey = req.headers['x-api-key'];
    if(clientApiKey !== API_KEY) {
        return res.status(403).send("Unauthorized access.");
    }
    next();
})


// HTTP->Websocket
const wss = new wSocket.Server({ noServer: true});
setWss(wss);

const server = app.listen(port, () => console.log(`Server is running and listening on port: ${port}`));

// Routing
const moduleSrs = require('./routes/srs');
const moduleTwitch = require('./routes/twitch');
const moduleGeekHub = require('./routes/geekhub');
app.use('/srs', moduleSrs);
app.use('/twitch', moduleTwitch);
app.use('/geekhub', moduleGeekHub);

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
    });
});

module.exports = app;