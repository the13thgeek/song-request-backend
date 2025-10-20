const db = require('../config/database');

class CardService {
  /**
   * Perform weighted random gacha pull
   */
  async performGacha(isPremium) {
    const query = isPremium
      ? 'SELECT * FROM tbl_cards WHERE spawn_rate IS NOT NULL AND is_pull = 1'
      : 'SELECT * FROM tbl_cards WHERE spawn_rate IS NOT NULL AND is_premium = 0 AND is_pull = 1';

    const cards = await db.execute(query);

    if (cards.length === 0) {
      throw new Error('No cards available for pulling');
    }

    return this.weightedRandom(cards);
  }

  /**
   * Weighted random selection algorithm
   */
  weightedRandom(cards) {
    const totalRate = cards.reduce((sum, card) => sum + card.spawn_rate, 0);
    const random = Math.random() * totalRate;
    
    let cumulativeRate = 0;
    for (const card of cards) {
      cumulativeRate += card.spawn_rate;
      if (random <= cumulativeRate) {
        return card;
      }
    }

    return cards[cards.length - 1];
  }

  /**
   * Add card to user's collection
   */
  async addCardToUser(userId, cardId) {
    // Don't issue card ID 0 (Try Again)
    if (cardId <= 0) return false;

    const existing = await db.executeOne(
      'SELECT COUNT(*) as count FROM tbl_user_cards WHERE user_id = ? AND card_id = ?',
      [userId, cardId]
    );

    if (existing.count > 0) return false;

    // Set new card as default
    await db.execute(
      'UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?',
      [userId]
    );

    await db.execute(
      'INSERT INTO tbl_user_cards(user_id, card_id, is_default) VALUES(?,?,?)',
      [userId, cardId, 1]
    );

    return true;
  }

  /**
   * Set user's active card
   */
  async setActiveCard(userId, cardId) {
    // Verify user owns the card
    const owned = await db.executeOne(
      'SELECT 1 FROM tbl_user_cards WHERE user_id = ? AND card_id = ?',
      [userId, cardId]
    );

    if (!owned) {
      throw new Error('User does not own this card');
    }

    await db.execute(
      'UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?',
      [userId]
    );

    await db.execute(
      'UPDATE tbl_user_cards SET is_default = 1 WHERE user_id = ? AND card_id = ?',
      [userId, cardId]
    );

    return true;
  }

  /**
   * Get available cards for pulling
   */
  async getAvailableCards() {
    return await db.execute(
      `SELECT id, name, catalog_no, sysname, is_premium, is_event, is_rare, is_new 
       FROM tbl_cards 
       WHERE id > 0 AND is_pull = 1 AND is_active = 1 
       ORDER BY is_premium DESC, is_new DESC, catalog_no`
    );
  }

  /**
   * Get full card catalog
   */
  async getCatalog() {
    return await db.execute(
      `SELECT *, DATE_FORMAT(created, '%b %Y') as \'release\'
       FROM tbl_cards
       WHERE id > 0 AND is_active = 1
       ORDER BY
         CASE 
           WHEN LEFT(catalog_no, 2) IN ('SP','GX','EX') THEN 1
           WHEN LEFT(catalog_no, 2) IN ('RG', 'RP') THEN 2
           ELSE 3
         END,
         is_premium DESC,
         catalog_no DESC,
         name`
    );
  }

  /**
   * Get user's card list with sysnames
   */
  async getUserCardList(userId) {
    const cards = await db.execute(
      `SELECT c.sysname, c.name, c.is_premium
       FROM tbl_cards c
       INNER JOIN tbl_user_cards uc ON c.id = uc.card_id
       WHERE uc.user_id = ?
       ORDER BY c.catalog_no`,
      [userId]
    );

    return cards.map(card => ({
      sysname: card.sysname,
      display: card.is_premium ? `Premium ${card.name}` : card.name
    }));
  }
}

module.exports = new CardService();