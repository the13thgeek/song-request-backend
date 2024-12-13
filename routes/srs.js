/* the13thgeek: SONG REQUEST SYSTEM ROUTING */

const express = require('express');
const router = express.Router();
const { broadcast } = require('../utils');

// Variables
let queue = [];             // queue line for songs
let requestsOpen = false;   // not accepting requests by default
let gameData = null;        // game DB

// Functions
// Status Relay to theMainFrame
function statusRelay() {
    console.log('Mainframe Relay >>>');
    broadcast({ 
        type: "MAINFRAME_RELAY",
        srs: {
            status: true,
            message: "Mainframe relay",
            id: gameData.game_id,
            title: gameData.game_title,
            year: gameData.game_year,
            song_count: gameData.songs.length,
            requests_open: requestsOpen,
            queue_length: queue.length,
            queue: queue
        }
    });
}

// Song Search
function findSong(query) {
    console.log('Searching for "' + query.trim() + '"');
    const words = query.toLowerCase().split(" ");
        
    if(gameData && gameData.songs) {
        return gameData.songs.find(song => {
            const title = song.title.toLowerCase();
            const artist = song.artist.toLowerCase();
            const romanizedTitle = song?.romanizedTitle?.toLowerCase() || "";
            const romanizedArtist = song?.romanizedArtist?.toLowerCase() || "";
            
            return words.every(word =>
                title.includes(word) ||
                romanizedTitle.includes(word) ||
                artist.includes(word) ||
                romanizedArtist.includes(word)
            );
    
        });
    } else {
        return null;
    }
    
}

// Endpoint for status
router.post('/status', (req, res) => {    
    if(gameData) {
        console.log(`Status -> Game ID: [${gameData.game_id}] Requests: [${requestsOpen}] Queue: [${queue.length}]`);
        res.status(200).json({
            status: true,
            message: `Now playing: ${gameData.game_title} [${gameData.game_id} (${gameData.songs.length})]`,
            id: gameData.game_id,
            title: gameData.game_title,
            year: gameData.game_year,
            song_count: gameData.songs.length,
            requests_open: requestsOpen,
            queue_length: queue.length,
            queue: queue
        });
    } else {
        res.status(200).json({
            status: false,
            message: `No game initialized.`,
            id: null
        });
    }
    //res.status(200).json({ gameLibraryId: gameLibraryId, requestsOpen: requestsOpen, queueLength: queue.length, queue: queue });
});

// Endpoint for song requests from Mainframe
router.post('/request-site', (req, res) => {
    const { title, artist, user_name } = req.body;
    let requestedSong = {
        title: title,
        artist: artist
    }

    // If the song is found
    if(requestedSong) {
        const isDuplicate = queue.some(song => 
            song.title === requestedSong.title &&
            song.artist === requestedSong.artist
        )

        const userSongCount = queue.filter(song => song.user === user_name).length;
        //console.log(`userSongCount:`, userSongCount);

        // Check if the song is already in queue
        if(isDuplicate) {
            res.status(200).json({
                status: false,
                message: `⚠️ This song is already in queue: [${requestedSong.title} / ${requestedSong.artist}]`
            });
            console.log(`This song is already in queue: [${requestedSong.title} / ${requestedSong.artist}]`);
        }

        // Check if user already has 3 songs in queue
        else if(userSongCount >= 3) {
            res.status(200).json({
                status: false,
                message: `⚠️ Only three (3) requests per user are allowed at a time, please wait and try again.`
            });
            console.log(`Only three (3) requests per user are allowed at a time, please wait and try again.`);
        }

        // Otherwise, proceed
        else {
            broadcast({ type: "ADD_SONG", song: { id: requestedSong.id, title: requestedSong.title, artist: requestedSong.artist, user: user_name } });
            queue.push( { id: requestedSong.id, title: requestedSong.title, artist: requestedSong.artist, user: user_name } );
            res.status(200).json({
                status: true,
                message: `✔️ Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`
            });
            statusRelay();
            console.log(`Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`);        
        }        
    }
    
    return;    
});

// Endpoint for song requests
router.post('/request-song', (req, res) => {
    const { song_title, user_name } = req.body;
    let requestedSong = findSong(song_title);

    // Check first if requests are open
    if(!requestsOpen) {
        console.log("Requests are not currently open.");
        res.status(200).json({
            status: false,
            message: "Requests are not currently open."
        });
        return;
    }

    // Check if song library is defined
    if(!gameData) {
        console.log("Please set Game ID to take requests.");
        res.status(200).json({
            status: false,
            message: "Please set Game ID to take requests."
        });
        return;
    }
    
    // If the song is found
    if(requestedSong) {
        const isDuplicate = queue.some(song => 
            song.title === requestedSong.title &&
            song.artist === requestedSong.artist
        )

        const userSongCount = queue.filter(song => song.user === req.query.user).length;
        //console.log(`userSongCount:`, userSongCount);

        // Check if the song is already in queue
        if(isDuplicate) {
            res.status(200).json({
                status: false,
                message: `⚠️ This song is already in queue: [${requestedSong.title} / ${requestedSong.artist}]`
            });
            console.log(`This song is already in queue: [${requestedSong.title} / ${requestedSong.artist}]`);
        }

        // Check if user already has 3 songs in queue
        else if(userSongCount >= 3) {
            res.status(200).json({
                status: false,
                message: `⚠️ Only three (3) requests per user are allowed at a time, please wait and try again.`
            });
            console.log(`Only three (3) requests per user are allowed at a time, please wait and try again.`);
        }

        // Otherwise, proceed
        else {
            broadcast({ type: "ADD_SONG", song: { id: requestedSong.id, title: requestedSong.title, artist: requestedSong.artist, user: user_name } });
            queue.push( { id: requestedSong.id, title: requestedSong.title, artist: requestedSong.artist, user: user_name } );
            res.status(200).json({
                status: true,
                message: `✔️ Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`
            });
            statusRelay();
            console.log(`Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`);        
        }        
    } 
    // If the song is not found
    else {
        res.status(200).json({
            status: false,
            message: `❌ Sorry, no songs matched "${song_title}." The song you requested may not be in the current game.`
        });
        console.log("No songs matched \"" + song_title + ".\"");
    }
});

// Endpoint for initializing game song library
router.post('/init-game', (req, res) => {
    const { game_id } = req.body;

    try {
        gameData = require(`../data/${game_id}.json`);
        console.log("Game ID: " + gameData.game_id);
        console.log(`Game [${game_id} (${gameData.songs.length})] initialized. Requests are currently ${requestsOpen ? "ON" : "OFF"}.`);
        statusRelay();
        res.status(200).json({
            status: true,
            message: `Game [${game_id} (${gameData.songs.length})] initialized.`,
            id: gameData.game_id,
            title: gameData.game_title,
            year: gameData.game_year,
            song_count: gameData.songs.length,
            requests_open: requestsOpen
        });
    } catch(error) {
        console.log("Error: " + error);
        res.status(200).json({
            status: false,
            message: `Unable to initialize game [${game_id}].`
        });
    }
});

// Endpoint for enabling/disabling requests
router.post('/request-status', (req, res) => {
    const { toggle } = req.body;

    if(toggle.trim().toLowerCase() === 'on') {
        if(!gameData) {
            console.log("Please set Game ID before opening requests.");
            res.status(200).json({
                status: false,
                message: "Please initialize game before opening requests.",
                requests_open: false
            });
            return;
        }
        requestsOpen = true;
        broadcast({ type: 'REQUEST_MODE_ON' });
        statusRelay();
        console.log("Requests are now open.");
        res.status(200).json({
            status: true,
            message: "Requests are now open.",
            requests_open: true
        });
    } else {
        requestsOpen = false;
        broadcast({ type: 'REQUEST_MODE_OFF' });
        statusRelay();
        console.log("Requests are now closed.");
        res.status(200).json({
            status: true,
            message: "Requests are now closed.",
            requests_open: false
        });
    }
    return;
});

// Endpoint for checking song availability
router.post('/check-song', (req, res) => {
    const { song_title } = req.body;
    let requestedSong = findSong(song_title);
    let output = {
        status: false,
        message: ""
    }

    if(requestedSong) {
        output.status = true;
        output.message = `ℹ️ I found the song [${requestedSong.title} / ${requestedSong.artist}]. If this is correct, type "!req ${song_title}" (without the quotes) to proceed.`;
        console.log(`Result: [${requestedSong.title} / ${requestedSong.artist}]`);
    } else {
        output.status = false;
        output.message = `❌ Sorry, no songs matched "${song_title}." This song may not be in the current game.`;
        console.log('Result: No matches found.');
    }
    res.status(200).json(output);
});

// Endpoint for removing played song in front of the queue
router.post('/remove-song', (req, res) => {    
    if(queue.length === 0) { 
        res.status(200).json({
            status: false,
            message: 'Requests queue is empty.'
        });
        console.log('No songs in queue to remove.');
        return;
    }
    
    broadcast({ type: 'REMOVE_SONG' });    
    let currSong = queue[0];
    queue = queue.slice(1);
    statusRelay();
    if(queue.length > 0) {
        res.status(200).json({
            status: true,
            message: `▶️ Request [${currSong.title}] has been played! Next song ⏩ [${queue[0].title}]`
        });
        console.log(`Request [${currSong.title}] has been played! Next song ⏩ [${queue[0].title}]`);
    } else {
        res.status(200).json({
            status: true,
            message: `▶️ Request [${currSong.title}] has been played. There are no songs in queue.`
        });
        console.log(`Request [${currSong.title}] has been played. There are no songs in queue.`)
    }    
});

module.exports = router;