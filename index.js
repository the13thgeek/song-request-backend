const express = require("express");
const wSocket = require("ws");
const app = express();
const port = 1300;

// Define song library
const songs = require('./data/stepmania.json');
let queue = [];

function findSong(query) {
    console.log('Searching for "' + query.trim() + '"');
    const words = query.toLowerCase().split(" ");
    
    return songs.find(song => {
        const title = song.title.toLowerCase();
        const artist = song.artist.toLowerCase();
        const romanizedTitle = song?.romanizedTitle?.toLowerCase() || "";
        const romanizedArtist = song?.romanizedArtist?.toLowerCase() || "";

        //console.log("Searching: " + song.title)
        
        return words.every(word =>
            title.includes(word) ||
            romanizedTitle.includes(word) ||
            artist.includes(word) ||
            romanizedArtist.includes(word)
        );

    });

}

app.use(express.json());

// Initialize websocket
const wss = new wSocket.Server({ noServer: true});

// Broadcast
function broadcast(data) {
    wss.clients.forEach(client => {
        if(client.readyState === wSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Set up endpoints
app.post('/request-song', (req, res) => {
    let requestedSong = findSong(req.query.songtitle);
    
    // If the song is found
    if(requestedSong) {

        const isDuplicate = queue.some(song => 
            song.title === requestedSong.title &&
            song.artist === requestedSong.artist
        )
        const userSongCount = queue.filter(song => song.user === req.query.user).length;
        console.log(`userSongCount:`, userSongCount);

        // Check if the song is already in queue
        if(isDuplicate) {
            res.status(200).send(`⚠️ This song is already in queue: [${requestedSong.title} / ${requestedSong.artist}]`);
            console.log(`This song is already in queue: [${requestedSong.title} / ${requestedSong.artist}]`);
        }

        // Check if user already has 3 songs in queue
        else if(userSongCount >= 3) {
            res.status(200).send(`⚠️ Only three (3) requests per user are allowed at a time, please wait and try again.`);
            console.log(`Only three (3) requests per user are allowed at a time, please wait and try again.`);
        }

        // Otherwise, proceed
        else {
            broadcast({ type: "ADD_SONG", song: { title: requestedSong.title, artist: requestedSong.artist, user: req.query.user } });
            queue.push( { title: requestedSong.title, artist: requestedSong.artist, user: req.query.user } );
            res.status(200).send(`✔️ Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`);
            console.log(`Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`);        
        }        
    } 
    // If the song is not found
    else {
        res.status(200).send(`❌ Sorry, no songs matched "${req.query.songtitle}." The song you requested may not be in the current game.`);
        console.log("No songs matched \"" + req.query.songtitle + ".\"");
    }
});

app.post('/check-song', (req, res) => {
    let requestedSong = findSong(req.query.songtitle);

    if(requestedSong) {
        res.status(200).send(`ℹ️ I found the song [${requestedSong.title} / ${requestedSong.artist}]. If this is correct, type "!req ${req.query.songtitle}" (without the quotes) to proceed.`);
    } else {
        res.status(200).send(`❌ Sorry, no songs matched "${req.query.songtitle}." This song may not be in the current game.`);
    }

});

app.post('/remove-song', (req, res) => {
    
    if(queue.length === 0) { console.log('No songs in queue to remove.'); return; }
    
    broadcast({ type: 'REMOVE_SONG' });
    let currSong = queue[0];
    queue = queue.slice(1);
    if(queue.length > 0) {
        res.status(200).send(`▶️ Request [${currSong.title}] has been played! Next song ⏩ [${queue[0].title}]`);
        console.log(`Request [${currSong.title}] has been played! Next song ⏩ [${queue[0].title}]`);
    } else {
        res.status(200).send(`▶️ Request [${currSong.title}] has been played. There are no songs in queue.`);
        console.log(`Request [${currSong.title}] has been played. There are no songs in queue.`)
    }
    
    
});

// HTTP->Websocket
const server = app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
    });
});