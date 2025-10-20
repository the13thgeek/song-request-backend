const express = require('express');
const router = express.Router();
const { ResponseHandler, asyncHandler } = require('../utils/ResponseHandler');
const UserService = require('../services/UserService');
const CardService = require('../services/CardService');
//const { broadcast } = require('../utils');

/**
 * POST /mainframe/login-widget
 * User login via Mainframe website Widget
 */
router.post('/login-widget', asyncHandler(async (req, res) => {
  const { twitch_id, twitch_display_name, twitch_avatar } = req.body;

  if (!twitch_id || !twitch_display_name) {
    return ResponseHandler.validationError(res, {
      twitch_id: 'Required',
      twitch_display_name: 'Required'
    });
  }

  const user = await UserService.getUserByTwitchId(
    twitch_id,
    twitch_display_name,
    twitch_avatar
  );

  await UserService.updateTimestamp(user.id, 'last_login');

  return ResponseHandler.success(res, {
    local_id: user.id,
    twitch_id: user.twitch_id,
    twitch_display_name: user.twitch_display_name,
    avatar: user.twitch_avatar,
    user_card: user.card_default,
    user_cards: user.cards,
    exp: user.exp,
    is_premium: user.is_premium,
    level: user.level,
    title: user.title,
    level_progress: user.levelProgress,
    stats: user.stats,
    achievements: user.achievements,
    sub_months: user.sub_months,
    team: user.team
  }, 'Login successful');
}));

/**
 * POST /mainframe/check-in
 * Stream check-in
 */
router.post('/check-in', asyncHandler(async (req, res) => {
  const { twitch_id, twitch_display_name, twitch_avatar, twitch_roles, checkin_count } = req.body;

  const isPremium = UserService.isPremium(twitch_roles);
  const user = await UserService.getUserByTwitchId(
    twitch_id,
    twitch_display_name,
    twitch_avatar,
    isPremium
  );

  // Award EXP
  await UserService.awardExp(user.id, isPremium, 1);

  // Update stats
  await UserService.updateStat(user.id, 'checkin_count', checkin_count, false);
  await UserService.updateTimestamp(user.id, 'last_checkin');

  // Check achievements
  const achievement = await UserService.checkAchievements(user.id, 'checkin_count');

  return ResponseHandler.success(res, {
    twitch_id: user.twitch_id,
    local_id: user.id,
    level: user.level,
    is_premium: isPremium,
    default_card_name: user.card_default.sysname,
    default_card_title: (user.card_default.is_premium ? 'Premium ' : '') + user.card_default.name,
    has_achievement: !!achievement,
    achievement
  }, 'Check-in successful');
}));

/**
 * POST /mainframe/gacha
 * Perform card gacha pull
 */
router.post('/gacha', asyncHandler(async (req, res) => {
  const { twitch_id, twitch_display_name, twitch_roles, twitch_avatar } = req.body;

  const isPremium = UserService.isPremium(twitch_roles);
  const user = await UserService.getUserByTwitchId(
    twitch_id,
    twitch_display_name,
    twitch_avatar,
    isPremium
  );

  const pulledCard = await CardService.performGacha(isPremium);
  const wasIssued = await CardService.addCardToUser(user.id, pulledCard.id);

  const response = {
    output_card_name: pulledCard.sysname,
    card_name: user.card_default.sysname
  };

  // New card successfully issued
  if (wasIssued) {
    await UserService.updateStat(user.id, 'card_gacha_pulls_success', 1, true);
    response.card_name = pulledCard.sysname;
    
    return ResponseHandler.success(res, {
      ...response,
      success: true,
      is_new: true
    }, 
      `You pulled a ${pulledCard.is_premium ? 'Premium ' : ''}[${pulledCard.name}] Card! ` +
      `It's now your active card!`
    );
  }

  // Got "Try Again" card
  if (pulledCard.sysname === 'try-again') {
    return ResponseHandler.success(res, {
      ...response,
      success: false,
      is_new: false,
      reason: 'TRY_AGAIN'
    }, 'Sorry! Try again!');
  }

  // Already owned card (duplicate)
  return ResponseHandler.success(res, {
    ...response,
    success: false,
    is_new: false,
    reason: 'DUPLICATE'
  }, 
    `You pulled a ${pulledCard.is_premium ? 'Premium ' : ''}[${pulledCard.name}] Card! ` +
    `You already have this card.`
  );
}));

/**
 * POST /mainframe/change-card
 * Change active card
 */
router.post('/change-card', asyncHandler(async (req, res) => {
  const { twitch_id, twitch_display_name, twitch_avatar, new_card_name } = req.body;

  const user = await UserService.getUserByTwitchId(
    twitch_id,
    twitch_display_name,
    twitch_avatar
  );

  if (user.card_default.sysname === new_card_name) {
    return ResponseHandler.error(res, "You're already using this card.", 400);
  }

  const userCard = user.cards.find(card => card.sysname === new_card_name);

  if (!userCard) {
    return ResponseHandler.error(res, 
      "Card not found in your collection. Type !getcards to see available cards.", 
      404
    );
  }

  await CardService.setActiveCard(user.id, userCard.card_id);

  return ResponseHandler.success(res, { new_card: userCard.sysname },
    `You are now using your ${userCard.is_premium ? 'Premium ' : ''}${userCard.name} Card!`
  );
}));

/**
 * POST /mainframe/get-cards
 * Get user's card list
 */
router.post('/get-cards', asyncHandler(async (req, res) => {
  const { twitch_id, twitch_display_name, twitch_avatar } = req.body;

  const user = await UserService.getUserByTwitchId(
    twitch_id,
    twitch_display_name,
    twitch_avatar
  );

  if (user.cards.length === 0) {
    return ResponseHandler.success(res, { cards: [] },
      "You're not registered in the Frequent Flyer Program yet."
    );
  }

  if (user.cards.length === 1) {
    return ResponseHandler.success(res, { cards: user.cards },
      `You have the [${user.cards[0].sysname}] Card. Collect more via Mystery Card Pull!`
    );
  }

  const cardList = user.cards.map(card => card.sysname);
  return ResponseHandler.success(res, { cards: user.cards },
    `You have (${user.cards.length}) cards: [${cardList.join(', ')}]. ` +
    `Use !setcard <keyword> to change your active card!`
  );
}));

/**
 * POST /mainframe/get-available-cards
 * Get available cards for pulling
 */
router.post('/get-available-cards', asyncHandler(async (req, res) => {
  const cards = await CardService.getAvailableCards();
  return ResponseHandler.success(res, { cards }, 'Available cards retrieved');
}));

/**
 * POST /mainframe/catalog
 * Get card catalog
 */
router.post('/catalog', asyncHandler(async (req, res) => {
  const catalog = await CardService.getCatalog();
  return ResponseHandler.success(res, { catalog }, 'Catalog retrieved');
}));

/**
 * POST /mainframe/user-profile
 * Get user profile by ID
 */
router.post('/user-profile', asyncHandler(async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return ResponseHandler.validationError(res, { user_id: 'Required' });
  }

  const user = await UserService.getUserById(user_id);

  if (!user) {
    return ResponseHandler.notFound(res, 'User');
  }

  return ResponseHandler.success(res, user, 'Profile retrieved');
}));

/**
 * POST /mainframe/send-action
 * Generic action handler (EXP, stats, achievements)
 */
router.post('/send-action', asyncHandler(async (req, res) => {
  const { 
    twitch_id, twitch_display_name, twitch_roles, twitch_avatar,
    exp, stat_name, value, increment 
  } = req.body;

  const isPremium = UserService.isPremium(twitch_roles);
  const user = await UserService.getUserByTwitchId(
    twitch_id,
    twitch_display_name,
    twitch_avatar
  );

  // Award EXP if provided
  if (exp) {
    await UserService.awardExp(user.id, isPremium, exp);
  }

  // Update stats and check achievements
  const achievements = [];
  
  if (stat_name && stat_name.length > 0) {
    for (let i = 0; i < stat_name.length; i++) {
      // Handle sub_months separately
      if (stat_name[i] === 'sub_months') {
        await db.execute(
          'UPDATE tbl_users SET sub_months = ? WHERE id = ?',
          [value[i], user.id]
        );
      } else {
        await UserService.updateStat(user.id, stat_name[i], value[i], increment[i]);
        const ach = await UserService.checkAchievements(user.id, stat_name[i]);
        if (ach) achievements.push(ach);
      }
    }
  }

  const message = achievements.length > 0
    ? `Congrats! You earned: ${achievements.join(', ')}`
    : 'Action completed';

  return ResponseHandler.success(res, {
    has_achievement: achievements.length > 0,
    achievements: achievements.join(', ')
  }, message);
}));

/**
 * POST /mainframe/ranking
 * Get leaderboard rankings
 */
router.post('/ranking', asyncHandler(async (req, res) => {
  const { rank_type, items_to_show = 5 } = req.body;

  const validTypes = ['exp', 'spender', 'redeems', 'checkins_last', 'checkins', 'achievements'];
  
  if (!validTypes.includes(rank_type)) {
    return ResponseHandler.validationError(res, {
      rank_type: `Must be one of: ${validTypes.join(', ')}`
    });
  }

  const RankingService = require('../services/RankingService');
  const rankings = await RankingService.getRanking(rank_type, items_to_show);

  return ResponseHandler.success(res, rankings, 'Rankings retrieved');
}));

module.exports = router;