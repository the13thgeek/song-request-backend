/* the13thgeek: GEEKHUB ROUTING */

const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
require('dotenv').config();

// Shared DB connection pool
const dbPool = mysql.createPool({
    host: process.env.GEEKHUB_DB_ENDPOINT,
    user: process.env.GEEKHUB_DB_USER,
    password: process.env.GEEKHUB_DB_PASS,
    database: process.env.GEEKHUB_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// FUNCTIONS

// Get Player Level, Title and Progression
function getPlayerLevel(exp) {
    let playerLevels = require(`../data/levels.json`);
    let currentLevel = playerLevels[0];
    let nextLevel = null;

    for(let i = 0; i<playerLevels.length; i++) {
        if (exp < playerLevels[i].exp) {
            nextLevel = playerLevels[i];
            break;
        }
        currentLevel = playerLevels[i];
    }

    const progressLevel = nextLevel ? ((exp - currentLevel.exp) / (nextLevel.exp - currentLevel.exp)) * 100 : 100;

    return {
        level: currentLevel.level,
        title: currentLevel.title,
        progressLevel: progressLevel
    }
}

// For testing
async function test() {
    console.log('TEST activated.');
    let rows = null;
    try {
        const conn = await dbPool.getConnection();
        console.log('DB pool connected.');

        const [result] = await conn.execute("SELECT * FROM tbl_users WHERE is_active = 1");
        rows = result;

        console.log('Output: ');
        console.log(JSON.stringify(rows, null, 2));

        await conn.release();
    } catch (e) {
        console.error(`test(): ERROR: ${e.message}`);
    }
    return rows;
}

// Load user data using Twitch ID
// Register locally if user doesn't exist yet
async function getUserData(twitch_id, twitch_display_name, is_premium = false) {
    let user = null;
    const conn = await dbPool.getConnection();

    try {
        const [usrData] = await conn.execute("SELECT * FROM tbl_users WHERE twitch_id = ?", [twitch_id]);

        if(usrData.length > 0) {
            // User exists, update login
            console.log(`getUserData(): User ${twitch_id} exists.`)
            user = usrData[0];
            const [updateUser] = await conn.execute("UPDATE tbl_users SET twitch_display_name = ?, last_login = CURRENT_TIMESTAMP WHERE id = ?",[user.twitch_display_name,user.id]);
        } else {
            // User does not exist on local DB, create
            console.log(`getUserData(): User [${twitch_id},${twitch_display_name}] not locally registered.`)
            user = await registerUser(twitch_id,twitch_display_name);
        }
        await conn.release();
        
        let playerData = getPlayerLevel(user.exp);

        // Append player info to user data
        user.level = playerData.level;
        user.title = playerData.title;
        user.levelProgress = parseInt(playerData.progressLevel.toFixed());

        // Append user card data
        let cardData = await getUserCards(user.id,is_premium);
        user.isPremium = is_premium;
        user.cards = cardData.cards;
        user.card_default = cardData.default;

        //console.log(user);

    } catch(e) {
        user = null;    
        console.error(`getUserData(): ERROR: ${e.message}`);
        throw e;
    } finally {
        conn.release();
        return user;
    }
}

// Register user to local DB
async function registerUser(twitch_id,twitch_displayname) {
    let user = null;

    try {
        const conn = await dbPool.getConnection();
        // register
        const [addUser] = await conn.execute("INSERT INTO tbl_users(twitch_id, twitch_displayname) VALUES(?,?)", [twitch_id,twitch_displayname]);
        // get newly-inserted item
        const [newUser] = await conn.execute("SELECT * FROM tbl_users WHERE id = ?",[addUser.insertId])
        user = newUser[0];
        console.log(`registerUser(): Twitch ID ${twitch_id} -> ${user.id}`);
        await conn.release();
    } catch(e) {
        console.error(`registerUser(): ERROR: ${e.message}`);
    }
    return user;
}

// Get all cards issued to the user
async function getUserCards(user_id, is_premium = false) {
    console.log("getUserCards(): ");
    let user_cards = {
        cards: [],
        default: null
    };

    try {
        // Query all assigned cards
        const conn = await dbPool.getConnection();
        const [queryCards] = await conn.execute("SELECT * FROM tbl_cards c INNER JOIN tbl_user_cards uc ON c.id = uc.card_id WHERE uc.user_id = ?",[user_id]);
        user_cards.cards = queryCards;
        //console.log(user_cards.cards);

        // If cards are empty, issue their first one
        if(queryCards.length === 0) {
            // Issue a Premium Card (via Twitch)
            if(is_premium) {
                const [queryIssueCard] = await conn.execute("INSERT INTO tbl_user_cards(user_id,card_id,is_default) VALUES(?,?,?)",[user_id,2,1]);
            } else {
                const [queryIssueCard] = await conn.execute("INSERT INTO tbl_user_cards(user_id,card_id,is_default) VALUES(?,?,?)",[user_id,1,1]);
            }
            // Re-query
            const [queryCards] = await conn.execute("SELECT * FROM tbl_cards c INNER JOIN tbl_user_cards uc ON c.id = uc.card_id WHERE uc.user_id = ?",[user_id]);
            user_cards.cards = queryCards;
        } else {
            // This is for users checking in from Twitch Chat.
            // Because the Hub website does not support is_premium,
            // Premium users may have been initially issued a Standard card.
            // This is for validation
            if(is_premium) {
                // Check if user already has a Premium card issued previously.
                const [queryPremium] = await conn.execute("SELECT * FROM tbl_user_cards WHERE user_id = ? and card_id = ?",[user_id,2]);
                if(queryPremium.length === 0) {
                    // Issue a Premium card and set it to user's default
                    const [queryUntoggleCards] = await conn.execute("UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?",[user_id]);
                    const [queryIssueCard] = await conn.execute("INSERT INTO tbl_user_cards(user_id,card_id,is_default) VALUES(?,?,?)",[user_id,2,1]);

                }
            }
        }

        // Get active card
        const [queryActiveCard] = await conn.execute("SELECT * FROM tbl_cards c INNER JOIN tbl_user_cards uc ON c.id = uc.card_id WHERE uc.user_id = ? AND uc.is_default = 1",[user_id]);
        user_cards.default = queryActiveCard[0];

        await conn.release();
    } catch(e) {
        console.error(`getUserCards(): ERROR: ${e.message}`);
    }
    return user_cards;
}

// Get local user ID by Twitch ID
async function getLocalId(twitch_id) {
    let output = null;

    try {
        const conn = await dbPool.getConnection();
        const [result] = await conn.execute("SELECT id FROM tbl_users WHERE twitch_id = ?",[twitch_id]);

        if(rows.length > 0) {
            // user is registered
            output = rows[0].id;
        }
    } catch(e) {
        console.error(`getLocalId(): ERROR: ${e.message}`);
    }
    console.log(`getLocalId(): ${twitch_id} -> ${output}`);
    return output;
}

// Check if user is Premium
function isUserPremium(roles) {
    let output = false;
    if(roles.includes('VIP') || roles.includes('Subscriber')) {
        output = true;
    }
    return output;
}

// Parse string to array
function parseList(arg) {
    let output = [];
    try {
        output = JSON.parse(arg);        
    }
    catch (e) {
        console.error(`parseList(): ERROR: ${e.message}`);
    }
    return output;
}

// For EXP Ranking
async function expRanking() {
    let output = null;

    try {
        const conn = await dbPool.getConnection();
        const [rankData] = await conn.execute("SELECT * FROM tbl_users WHERE id NOT IN (1,5) AND is_active = 1 ORDER BY exp DESC, reg_date LIMIT 10");
        output = rankData;
        
        // Append level data
        for(let i = 0; i < output.length; i++) {
            let playerData = getPlayerLevel(output[i].exp);
            output[i].level = playerData.level;
            output[i].title = playerData.title;
            output[i].levelProgress = parseInt(playerData.progressLevel);
        }
        await conn.release();

    } catch(e) {
        console.error(`expRanking(): ERROR: ${e.message}`);
    }
    return output;
}

// For card gacha pulls
async function doGachaPull(is_premium) {
    let selectedCard = null;
    const conn = await dbPool.getConnection();

    try {
        let card_query = null;
        // Get all cards in active circulation
        if(is_premium) {
            console.log(`doGachaPull(): Selecting Premium cards for pull.`);
            card_query = "SELECT * FROM tbl_cards WHERE spawn_rate IS NOT NULL AND is_active = 1";
        } else {
            console.log(`doGachaPull(): Selecting Standard cards for pull.`);
            card_query = "SELECT * FROM tbl_cards WHERE spawn_rate IS NOT NULL AND is_premium = 0 AND is_active = 1";
        }
        const [activeCards] = await conn.execute(card_query);
        console.log(`doGachaPull(): ${activeCards.length} card(s) available for pulls.`);
        
        if(activeCards.length < 1) {
            throw new Error("There are no cards available for this pull.");
        }

        // Perform pull based on weight (spawn_rate)
        selectedCard = weightedRandom(activeCards);

    } catch(e) {
        console.error(`doGachaPull(): ERROR: ${e.message}`);
    } finally {
        conn.release();
    }
    return selectedCard;
}

// Gacha pull mechanic
function weightedRandom(cards) {
    // Calculate total spawn rate
    const totalRate = cards.reduce((sum, card) => sum + card.spawn_rate, 0);
    // RNG
    const random = Math.random() * totalRate;
    let cumulativeRate = 0;
    for(const card of cards) {
        cumulativeRate += card.spawn_rate;
        if(random <= cumulativeRate) {
            console.log(`doGachaPull(): Pull result -> ${card.sysname}`);
            return card; // Draw this card
        }
    }
    // Fallback
    return cards[cards.length - 1];
}

// Assign card to user
async function addCardToUser(user_id,card_id) {
    let output = false;
    const conn = await dbPool.getConnection();
    try {
        // Check if user already owns card
        const [existingCard] = await conn.execute("SELECT COUNT(*) as count FROM tbl_user_cards WHERE user_id = ? AND card_id = ?",[user_id,card_id]);
        const count = existingCard[0].count;
        if(count === 0 && card_id > 0)  { // Do not issue Card #0 (Try Again)
            // untoggle is_default to current user's cards
            const [untoggle] = await conn.execute("UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?",[user_id,])
            // add card to user
            const [issueCard] = await conn.execute("INSERT INTO tbl_user_cards(user_id,card_id,is_default) values(?,?,?)",[user_id,card_id,1]);
            output = true;
        }

    } catch(e) {
        console.error(`addCardToUser(): ERROR: ${e.message}`);
    } finally {
        conn.release();
    }
    return output;
}

// ENDPOINTS

// Testing
router.post('/test', async (req, res) => {
    console.log('ENDPOINT: /test ');
    const data = await test();
    res.status(200).json(data);
});

// Login/Registration
router.post('/usrlogin', async (req, res) => {    
    console.log('ENDPOINT: /usrlogin');
    let twitch_id = req.query.twitch_id;
    let twitch_displayname = req.query.twitch_displayname;
    const user = await getUserData(twitch_id,twitch_displayname);
    res.status(200).json(user);
});

// Login/Registration via Hub Widget
router.post('/login-widget', async (req,res)=> {
    console.log('ENDPOINT: /login-widget');
    const { twitch_id, twitch_display_name } = req.body;
    const user = await getUserData(twitch_id,twitch_display_name);
    res.status(200).json({
        exp: user.exp,
        level: user.level,
        title: user.title,
        level_progress: user.levelProgress
    });
});

// Ranking-EXP
router.post('/exp-rank', async (req, res) => {
    console.log('ENDPOINT: /exp-rank');
    const rankData = await expRanking();
    res.status(200).json(rankData);
});

// Gacha pull
router.post('/gacha', async (req, res) => {
    console.log('ENDPOINT: /gacha');
    let twitch_id = req.query.twitch_id;
    let twitch_displayname = req.query.twitch_displayname;
    let roles = parseList(req.query.roles);
    let is_premium = isUserPremium(roles);
    let user = await getUserData(twitch_id,twitch_displayname,is_premium);
    let newCard = await doGachaPull(is_premium);
    let cardIssued = await addCardToUser(user.id, newCard.id);
    let output = {
        status: "ok",
        message: `You have pulled a ${newCard.is_premium ? "Premium" : ""} [${newCard.name}] Card!`,
        output_card_name: newCard.sysname,
        card_name: user.card_default.sysname
    }

    if(cardIssued) {
        output.message += ` Congrats! Your new card will now show on your next sign-in!`;
        output.card_name = newCard.sysname;
    } else {
        output.status = "ng";
        if(newCard.sysname === 'try-again') {
            output.message = `Sorry! Try again!`;
        } else {
            output.message += ` You already have this card.`;
        }
        
    }
    
    console.log(output);

    res.status(200).json(output);

});

// Check-in
router.post('/check-in', async (req, res) => {
    console.log('ENDPOINT: /check-in');
    const { twitch_id, twitch_display_name, twitch_roles } = req.body;
    
    const is_premium = isUserPremium(twitch_roles);
    let user = await getUserData(twitch_id,twitch_display_name,is_premium);

    res.status(200).json({
        twitch_id: user.twitch_id,
        local_id: user.id,
        is_premium: is_premium,
        default_card_name: user.card_default.sysname
    });
});

// Change active card
router.post('/change-card', async (req, res) => {
    console.log('ENDPOINT: /change-card');
    let twitch_id = req.query.twitch_id;
    let twitch_displayname = req.query.twitch_displayname;
    let card_name = req.query.card_name;
    let user = await getUserData(twitch_id,twitch_displayname);
    let output = {
        success: false,
        message: "",
        data: {}
    }

    // find card in user's data
    let is_card_present = false;
    let new_active_card = null;
    for(let card of user.cards) {
        if (card_name === card.sysname) {
            is_card_present = true;
            new_active_card = card;
            break;
        }
    }

    // check if card is already active
    if(user.card_default.sysname === card_name) {
        output.success = false;
        output.message = "You're already using this card.";
    } else if(is_card_present) {
        // do DB stuff here
        // ----
        output.success = true;
        output.message = `You're now using your ${new_active_card.is_premium ? 'Premium' : ''} ${new_active_card.name} Card as your active card!`;
        output.data = new_active_card;
    } else {
        output.success = false;
        output.message = `I couldn't find this card in your Frequent Flyer membership. Please double-check and try again.`;
    }

    

    res.status(200).json(output);


});

// Get cards keyword list
router.post('/get-cards', async (req, res) => {
    console.log('ENDPOINT: /get-cards');
    let message = "";

    try {
        let twitch_id = req.query.twitch_id;
        let twitch_displayname = req.query.twitch_displayname;
        let user = await getUserData(twitch_id,twitch_displayname);
        if (user) {
            if(user.cards.length > 1) {
                let cards_list = [];
                for(let card of user.cards) {
                    cards_list.push(card.sysname);
                }
                message += `You have (${user.cards.length}) cards: [${cards_list.toString()}]. To change your active card, type !changecard <keyword> in chat!`;
            } else if(user.cards.length === 1) {
                message += `You have the [${user.cards[0].sysname}] Card. To collect more cards, try your luck at the Mystery Card Pull redeem!`;
            } else {
                message += `It looks like you're not registered to our Frequent Flyer Program yet.`;
            }
        }

    } catch(e) {
        console.error(`/get-cards: ERROR: ${e.message}`);
        message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
    } finally {
        res.status(200).send(message);
    }
});

module.exports = router;