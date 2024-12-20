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

// MAINFRAME GLOBALS
let exp_standard = 1.0;
let exp_premium = 1.15;
let exp_global = 1.0;

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

// Load user data by local ID
async function getUserDataById(user_id) {
    let user = null;

    if(!user_id) return null;

    console.log(`getUserDataById(): ID: ${user_id}`);
    const conn = await dbPool.getConnection();

    try {        
        const [userData] = await conn.execute("SELECT * FROM tbl_users WHERE id = ?", [user_id]);

        if(userData.length > 0) {
            user = userData[0];
        }
        conn.release();
        
        let playerData = getPlayerLevel(user.exp);

        // Append player info to user data
        user.level = playerData.level;
        user.title = playerData.title;
        user.levelProgress = parseInt(playerData.progressLevel.toFixed());

        // Append user card data
        let cardData = await getUserCards(user.id);
        //user.isPremium = is_premium;
        user.cards = cardData.cards;
        user.card_default = cardData.default;
        user.stats = await getUserStats(user.id);
        user.achievements = await getUserAchievements(user.id);

    } catch(e) {
        user = null;    
        console.error(`getUserData(): ERROR: ${e.message}`);
        throw e;
    }
    return user;
}

// Perform action
// Update stats, issue EXP, check for achievements


// Load user data using Twitch ID
// Register locally if user doesn't exist yet
async function getUserData(twitch_id, twitch_display_name, twitch_avatar, is_premium = false) {
    let user = null;

    if( !twitch_id || !twitch_display_name) {
        console.log(`getUserData(): Invalid user data. BYPASS`);
        return user;
    }

    console.log(`getUserData(): TID: ${twitch_id}, TDN: ${twitch_display_name}, TA: ${twitch_avatar} IP: ${is_premium}`);
    const conn = await dbPool.getConnection();

    try {
        const [usrData] = await conn.execute("SELECT * FROM tbl_users WHERE twitch_id = ?", [twitch_id]);

        if(usrData.length > 0) {
            // User exists, update login
            console.log(`getUserData(): User ${twitch_id} exists.`)
            user = usrData[0];
            const [updateUser] = await conn.execute("UPDATE tbl_users SET twitch_display_name = ?, twitch_avatar = ?, last_login = CURRENT_TIMESTAMP WHERE id = ?",[twitch_display_name,twitch_avatar,user.id]);
        } else {
            // User does not exist on local DB, create
            console.log(`getUserData(): User [${twitch_id},${twitch_display_name}] not locally registered.`)
            user = await registerUser(twitch_id,twitch_display_name,twitch_avatar);
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

        // Append stats/achievements
        user.stats = await getUserStats(user.id);
        user.achievements = await getUserAchievements(user.id);

        //console.log(user);

    } catch(e) {
        user = null;    
        console.error(`getUserData(): ERROR: ${e.message}`);
        throw e;
    } finally {
        conn.release();
        console.log(`getUserData(): Return [${user.id}]`);
        return user;
    }
}

// Register user to local DB
async function registerUser(twitch_id,twitch_display_name,twitch_avatar) {
    let user = null;

    try {
        const conn = await dbPool.getConnection();
        // register
        const [addUser] = await conn.execute("INSERT INTO tbl_users(twitch_id, twitch_display_name, twitch_avatar) VALUES(?,?,?)", [twitch_id,twitch_display_name,twitch_avatar]);
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
        console.log("getUserCards(): " + queryCards.length);

        await conn.release();
    } catch(e) {
        console.error(`getUserCards(): ERROR: ${e.message}`);
        throw e;
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
    if(roles) {
        if(roles.includes('VIP') || roles.includes('Subscriber') || roles.includes('Moderator')) {
            output = true;
        }
    }
    return output;
}

// For Rankings
async function getRanking(rank_type,items_to_show) {
    let output = null;
    let query = "";

    items_to_show = items_to_show || 5;

    switch(rank_type) {
        case 'exp':
            query = `SELECT id, twitch_display_name, twitch_avatar, exp, exp as 'value' FROM tbl_users WHERE id NOT IN (1,2) AND is_active = 1 ORDER BY exp DESC, last_login LIMIT ${items_to_show}`;
            break;
        case 'spender':
            query = `select u.id AS 'id',u.twitch_display_name AS 'twitch_display_name', u.twitch_avatar as 'twitch_avatar', u.exp as 'exp', s.stat_value AS 'value' from tbl_users u join tbl_user_stats s where u.id = s.user_id and s.stat_key = 'points_spend' and u.id NOT IN (1,2) order by stat_value desc LIMIT ${items_to_show}`;
            break;
        case 'redeems':
            query = `select u.id AS 'id',u.twitch_display_name AS 'twitch_display_name', u.twitch_avatar as 'twitch_avatar', u.exp as 'exp', s.stat_value AS 'value' from tbl_users u join tbl_user_stats s where u.id = s.user_id and s.stat_key = 'redeems_count' and u.id NOT IN (1,2) order by stat_value desc LIMIT ${items_to_show}`;
            break;
        case 'checkins':
            query = `select u.id AS 'id',u.twitch_display_name AS 'twitch_display_name', u.twitch_avatar as 'twitch_avatar', u.exp as 'exp', s.stat_value AS 'value' from tbl_users u join tbl_user_stats s where u.id = s.user_id and s.stat_key = 'checkin_count' and u.id NOT IN (1,2) order by stat_value desc LIMIT ${items_to_show}`;
            break;
        default:
            break;
    }

    if(!query) { return null;} 

    try {
        const conn = await dbPool.getConnection();
        const [rankData] = await conn.execute(query);
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
        console.error(`getRanking(): ERROR: ${e.message}`);
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
        throw e;
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
        throw e;
    } finally {
        conn.release();
    }
    return output;
}

// Change user's active card
async function setActiveCard(user_id,card_id) {
    console.log(`setActiveCard(${user_id}->${card_id})`);
    let output = false;
    const conn = await dbPool.getConnection();

    try {
        // untoggle is_default to current user's cards
        const [untoggle] = await conn.execute("UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?",[user_id,])
        // set default card to specified card_id
        const [issueCard] = await conn.execute("UPDATE tbl_user_cards SET is_default = 1 WHERE user_id = ? AND card_id = ?",[user_id,card_id]);
        output = true;
    } catch(e) {
        console.error(`setActiveCard(): ERROR: ${e.message}`);
        throw e;
    } finally {
        conn.release();
    }
    return output;
}

// Issue EXP to user
async function setExp(user_id,is_premium,exp) {
    console.log("setExp():");
    let output = false;
    let issued_exp = 0;

    // Calculate EXP based on user level
    if(is_premium) {
        issued_exp = exp * exp_premium;
    } else {
        issued_exp = exp * exp_standard;
    }

    // Add global EXP multipliers
    issued_exp = issued_exp * exp_global;
    //console.log(`setExp(): U#${user_id} ->E+ ${issued_exp}`);

    try {
        const conn = await dbPool.getConnection();
        const [setExpUser] = await conn.execute("UPDATE tbl_users SET exp = (exp + ?) WHERE id = ?",[issued_exp,user_id]);
        await conn.release();
        output = true;
    } catch(e) {
        output = false;
        console.error(`setExp(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Stats Collection
async function setStats(user_id,stat_name,value,increment) {
    console.log(`setStats(): U#${user_id} SN:${stat_name}`);
    let output = false;
    try {
        const conn = await dbPool.getConnection();
        let query = "";
        if(increment) {
            query = "INSERT INTO tbl_user_stats(user_id,stat_key,stat_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stat_value = stat_value + ?";
        } else {
            query = "INSERT INTO tbl_user_stats(user_id,stat_key,stat_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stat_value = ?";
        }
        const [setStatData] = await conn.execute(query,[user_id,stat_name,value,value]);
        output = true;
        await conn.release();
    } catch(e) {
        output = false;
        console.error(`setStats(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Get user stats
async function getUserStats(user_id) {
    console.log(`getUserStats(): U#${user_id}`);
    let output = null;
    try {
        const conn = await dbPool.getConnection();
        const [userStatQ] = await conn.execute("SELECT * FROM tbl_user_stats WHERE user_id = ?",[user_id]);

        let stats = {};
        userStatQ.forEach(row => {
            stats[row.stat_key] = row.stat_value;
        });
        await conn.release();
        output = stats;
    } catch(e) {
        output = false;
        console.error(`getUserStats(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

async function getUserAchievements(user_id) {
    console.log(`getUserAchievements(): U#${user_id}`);
    let output = null;

    try {
        const conn = await dbPool.getConnection();
        const [achievementList] = await conn.execute("SELECT a.name AS achievement_name, a.tier AS achievement_tier, a.description AS `description`, ua.achieved_at FROM tbl_user_achievements ua JOIN tbl_achievements a ON ua.achievement_id = a.id WHERE ua.user_id = ? ORDER BY ua.achieved_at DESC, a.name, a.tier DESC",[user_id]);
        output = achievementList;
        await conn.release();
    } catch(e) {
        output = false;
        console.error(`getUserAchievements(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Achievement checking/awarding
async function checkAchievements(user_id,stat_name) {
    console.log("checkAchievements():");
    let output = null;

    try {
        const conn = await dbPool.getConnection();
        const [checkQuery] = await conn.execute(
            `SELECT a.id, a.name, a.tier
            FROM tbl_achievements a
            LEFT JOIN tbl_user_achievements ua 
                ON a.id = ua.achievement_id AND ua.user_id = ?
            WHERE a.stat_key = ?
                AND a.threshold <= (
                    SELECT stat_value 
                    FROM tbl_user_stats 
                    WHERE user_id = ? AND stat_key = ?
                )
            AND ua.achievement_id IS NULL`,
            [user_id,stat_name,user_id,stat_name]);
        
        if(checkQuery.length > 0) {
            let achList = [];
            // Award to user            
            for(let item of checkQuery) {
                const [addAchievement] = await conn.execute(`INSERT INTO tbl_user_achievements(user_id,achievement_id) VALUES(?,?)`,[user_id,item.id]);
                achList.push(item.name + ' ' + item.tier);
            }

            output = achList.join(", ");
        }
        await conn.release();
    }
    catch(e) {
        output = null;
        console.error(`setStats(): ERROR: ${e.message}`);
        throw e;
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
// router.post('/usrlogin', async (req, res) => {    
//     console.log('ENDPOINT: /usrlogin');
//     let twitch_id = req.query.twitch_id;
//     let twitch_displayname = req.query.twitch_displayname;
//     const user = await getUserData(twitch_id,twitch_displayname);
//     res.status(200).json(user);
// });

// Login/Registration via Hub Widget
router.post('/login-widget', async (req,res)=> {
    console.log('ENDPOINT: /login-widget');
    const { twitch_id, twitch_display_name, twitch_avatar } = req.body;
    const user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
    //const stats = await getUserStats(user.id);
    res.status(200).json({
        local_id: user.id,
        avatar: user.twitch_avatar,
        user_card: user.card_default,
        user_cards: user.cards,
        exp: user.exp,
        level: user.level,
        title: user.title,
        level_progress: user.levelProgress,
        stats: user.stats,
        achievements: user.achievements
    });
});

// Ranking
router.post('/ranking', async (req, res) => {
    console.log('ENDPOINT: /ranking');
    const { rank_type, items_to_show } = req.body;

    const rankData = await getRanking(rank_type, items_to_show);
    res.status(200).json(rankData);
});

// Gacha pull
router.post('/gacha', async (req, res) => {
    console.log('ENDPOINT: /gacha');
    let output = {
        status: false,
        message: "",
        output_card_name: null,
        card_name: null
    };

    try {
        const { twitch_id, twitch_display_name, twitch_roles, twitch_avatar } = req.body;
        const is_premium = isUserPremium(twitch_roles);
        let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar,is_premium);
        let newCard = await doGachaPull(is_premium);
        let cardIssued = await addCardToUser(user.id, newCard.id);

        // update stats
        let stats_q = await setStats(user.id,'card_gacha_pulls',1,true);

        output = {
            status: true,
            message: `You have pulled a ${newCard.is_premium ? "Premium" : ""} [${newCard.name}] Card!`,
            output_card_name: newCard.sysname,
            card_name: user.card_default.sysname
        }

        if(cardIssued) {
            let stats_q = await setStats(user.id,'card_gacha_pulls_success',1,true);
            output.message += ` Congrats! Your new card will now show on your next sign-in!`;
            output.card_name = newCard.sysname;
        } else {
            output.status = false;
            if(newCard.sysname === 'try-again') {
                output.message = `Sorry! Try again!`;
            } else {
                output.message += ` You already have this card.`;
            }
        }        
    } catch(e) {
        console.error(`/gacha: ERROR: ${e.message}`);
        output.status = false;
        output.message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        output.output_card_name = null,
        output.card_name = null;
    }
    res.status(200).json(output);
});

// Check-in
router.post('/check-in', async (req, res) => {
    console.log('ENDPOINT: /check-in');
    const { twitch_id, twitch_display_name, twitch_avatar, twitch_roles, checkin_count } = req.body;
    const is_premium = isUserPremium(twitch_roles);
    let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar,is_premium);
    let has_achievement = false;
    let achievement = null;

    // issue EXP
    let exp_q = await setExp(user.id,is_premium,1);
    // update stats
    let stats_q = await setStats(user.id,'checkin_count',checkin_count,false);
    // Check/award achievements
    achievement = await checkAchievements(user.id,'checkin_count');
    if(achievement) { 
        has_achievement = true;
    }

    res.status(200).json({
        twitch_id: user.twitch_id,
        local_id: user.id,
        level: user.level,
        is_premium: is_premium,
        default_card_name: user.card_default.sysname,
        has_achievement: has_achievement,
        achievement: achievement
    });
});

// Retrieve user profile by ID
router.post('/user-profile', async (req, res) => {
    const { user_id } = req.body;
    let user = await getUserDataById(user_id);

    res.status(200).json(user);
});

// Get user's stats by ID 
router.post('/user-stats', async (req, res) => {
    const { user_id } = req.body;
    let user_stats_result = await getUserStats(user_id);    
    res.status(200).json(user_stats_result);
});

// Change active card via theMainframe
router.post('/change-card-site', async (req, res)=> {
    console.log('ENDPOINT: /change-card-site');
    const { user_id, card_id } = req.body;
    let output = {
        status: false,
        message: "",
    }

    // find card in user's data
    let user = await getUserCards(user_id);
    let is_card_present = false;
    let new_active_card = null;

    for(let card of user.cards) {
        if(card.card_id === card_id) {
            is_card_present = true;
            new_active_card = card;
        }
    }

    if(is_card_present) {
        if(setActiveCard(user_id,card_id)) {
            output.status = true;
            output.message = `You are now using your ${new_active_card.is_premium ? 'Premium ' : ''}${new_active_card.name} Card as your active card!`;
            output.new_card = new_active_card.sysname;
        } else {
            output.message = `Sorry, something went wrong. Please inform the streamer right away.`;
        }
    } else {
        output.status = false;
        output.message = `I couldn't find this card in your Frequent Flyer membership. Please double-check and try again.`;
    }

    res.status(200).json(output);

});

// Change active card
router.post('/change-card', async (req, res) => {
    console.log('ENDPOINT: /change-card');
    const { twitch_id, twitch_display_name, twitch_avatar, new_card_name } = req.body;
    let output = {
        status: false,
        message: "",
    }

    try {
        let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
        let is_card_present = false;
        let new_active_card = null;

        //console.log(user.cards);

        // find card in user's data
        for(let card of user.cards) {
            console.log(`Checking ${new_card_name} -> ${card.sysname}`);
            if (new_card_name === card.sysname) {
                console.log(`Card found.`);
                is_card_present = true;
                new_active_card = card;
                console.log(new_active_card);
                break;
            }
        }
        if(user.card_default.sysname === new_card_name) {
            output.status = false;
            output.message = "You're already using this card :)";
        } else if(is_card_present) {
            if(setActiveCard(user.id,new_active_card.card_id)) {
                output.status = true;
                output.message = `You are now using your ${new_active_card.is_premium ? 'Premium ' : ''}${new_active_card.name} Card as your active card!`;
                output.new_card = new_active_card.sysname;
            } else {
                output.message = `Sorry, something went wrong. Please inform the streamer right away.`;
            }
        } else {
            output.status = false;
            output.message = `I couldn't find this card in your Frequent Flyer membership. Type !getcards and try again.`;
        }
        
    } catch(e) {
        console.error(`/change-card: ERROR: ${e.message}`);
        output.message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        output.status = false;
    }
    res.status(200).json(output);
});

// Get cards keyword list
router.post('/get-cards', async (req, res) => {
    console.log('ENDPOINT: /get-cards');
    const { twitch_id, twitch_display_name, twitch_avatar } = req.body;
    let message = "";
    let status = false;

    try {
        let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
        if (user) {
            if(user.cards.length > 1) {
                let cards_list = [];
                for(let card of user.cards) {
                    cards_list.push(card.sysname);
                }
                message += `You have (${user.cards.length}) cards: [${cards_list.toString()}]. To change your active card, type !setcard <keyword> in chat!`;
            } else if(user.cards.length === 1) {
                message += `You have the [${user.cards[0].sysname}] Card. To collect more cards, try your luck at the Mystery Card Pull redeem!`;
            } else {
                message += `It looks like you're not registered to our Frequent Flyer Program yet.`;
            }
        }
        status = true;

    } catch(e) {
        console.error(`/get-cards: ERROR: ${e.message}`);
        message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        status = false;
    } finally {
        res.status(200).json({
            status: status,
            message: message
        });
    }
});

// // Issue EXP
// router.post('/exp', async (req,res) => {
//     console.log('ENDPOINT: /exp');
//     const { twitch_id, twitch_display_name, twitch_avatar, twitch_roles, exp } = req.body;
//     const is_premium = isUserPremium(twitch_roles);
//     let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar,is_premium);
//     let result = false;

//     if(user) {
//         result = await setExp(user.id,is_premium,exp);
//     }

//     if(result) {
//         res.status(200).json({ status: result, message: 'EXP updated.' });
//     } else {
//         res.status(200).json({ status: result, message: 'EXP error.' });
//     }
// });

// Perform action
// Merged /exp and /stat-update
// Also returns achievements if any
router.post('/send-action', async (req,res) => {
    console.log(`ENDPOINT: /send-action`);
    console.log(req.body);
    const { twitch_id, twitch_display_name, twitch_roles, twitch_avatar, exp, stat_name, value, increment } = req.body;
    const is_premium = isUserPremium(twitch_roles);
    let output = {
        status: false,
        message: '',
        has_achievement: false,
        achievement: ''
    };

    try {
        let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
        if(user) {
            if(exp) {
                result_exp = await setExp(user.id,is_premium,exp);
                console.log('EXP issued');
            }
            if(stat_name && stat_name.length > 0) {
                let achList = [];
                for(let i = 0; i<stat_name.length; i++) {
                    result_stats = await setStats(user.id,stat_name[i],value[i],increment[i]);
                    let ach = await checkAchievements(user.id,stat_name[i]);
                    if(ach) {
                        achList.push(ach);
                    }
                }
                output.achievement = achList.join(", ");
                console.log('STAT update');
            }
            output.status = true;
        }

        if(output.achievement) {
            output.message = `Congrats! You have earned these achievements: ${output.achievement}`;
            output.has_achievement = true;            
        } else {
            output.message = `Stat [${stat_name}] updated.`;
        }

    } catch(e) {
        console.error(`/send-action: ERROR: ${e.message}`);
        output.message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        output.status = false;
    }
    
    res.status(200).json(output);
});

// // Update stats
// router.post('/stat-update', async (req,res) => {
//     console.log('ENDPOINT: /stat-update');
//     //console.log(req.body);
//     const { twitch_id, twitch_display_name, twitch_avatar, stat_name, value, increment } = req.body;
//     let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
//     let result = false;
//     let has_achievement = false;
//     let message = "";
    
//     // Update Stats
//     if(user) {
//         result = await setStats(user.id,stat_name,value,increment);
//     }

//     if(result) {
//         // Check and issue achievements
//         let achievements = await checkAchievements(user.id,stat_name);
        
//         if(achievements) {
//             let ach_list = [];
//             for(let ach of achievements) {
//                 ach_list.push(`${ach.name} ${ach.tier}`);
//             }
//             message = `Congrats! You have earned these achievements! ${ach_list.toString()}`;
//             has_achievement = true;
//         } else {
//             message = `Stat [${stat_name}] updated.`;
//         }
        
//         res.status(200).json({ 
//             status: result, 
//             message: message,
//             has_achievement: has_achievement,
//             achievements: achievements
//          });
//     } else {
//         res.status(200).json({ status: result, message: 'Stat error.' });
//     }
// });

module.exports = router;