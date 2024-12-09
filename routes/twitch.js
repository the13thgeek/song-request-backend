/* the13thgeek: TWITCH INTEGRATION ROUTING */

const express = require('express');
const router = express.Router();

// FUNCTIONS

// Fetch Live Data
async function getLiveData() {
    let requestUrl = `https://api.twitch.tv/helix/streams?user_login=xerenite`;
    let output = null;

    try {
        let response = await fetch(requestUrl, {
            headers: {
              'Authorization': `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
              'Client-Id': `${process.env.TWITCH_CLIENT_ID}`
            }
        });
        let data = await response.json();
        contents = data.data[0];

        if(contents) {
            // resize thumbnails
            contents.thumbnail_url = thumbnailResize(contents.thumbnail_url,640,360);
            output = contents;
        }
        
    } catch (e) {
        console.error('Error: ',e);
    }

    return output;
}

// For Twitch output thumbnail resizing
function thumbnailResize(url, width, height) {
    if (typeof url === 'undefined') {
      console.error('URL is undefined');
      console.error(width + 'x' + height);
      return;
    }

    return url
    .replace(/%\{width\}|\{width\}/g, width)
    .replace(/%\{height\}|\{height\}/g, height);    
}

// ENDPOINTS
// Grab live data
router.post('/live-data', async (req, res) => {    
    console.log('ENDPOINT: /live-data ');
    const liveData = await getLiveData();
    res.status(200).json(liveData);
});

module.exports = router;