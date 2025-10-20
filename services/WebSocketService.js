const wSocket = require('ws');
const logger = require('../utils/Logger');

class WebSocketService {
  constructor() {
    this.wss = null;
  }

  /**
   * Initialize WebSocket server
   */
  initialize(webSocketServer) {
    this.wss = webSocketServer;
    
    // Set up connection handling
    this.wss.on('connection', (ws, request) => {
      logger.info('WebSocket client connected', {
        ip: request.socket.remoteAddress,
        totalClients: this.wss.clients.size
      });

      ws.on('close', () => {
        logger.info('WebSocket client disconnected', {
          totalClients: this.wss.clients.size
        });
      });

      ws.on('error', (error) => {
        logger.error('WebSocket client error', {
          error: error.message
        });
      });
    });

    logger.success('WebSocket server initialized');
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(data) {
    if (!this.wss) {
      logger.error('Cannot broadcast: WebSocket server not initialized');
      return false;
    }

    const message = JSON.stringify(data);
    let successCount = 0;
    let failCount = 0;

    this.wss.clients.forEach(client => {
      if (client.readyState === wSocket.OPEN) {
        try {
          client.send(message);
          successCount++;
        } catch (error) {
          failCount++;
          logger.warn('Failed to send message to client', { 
            error: error.message 
          });
        }
      }
    });

    logger.debug('WebSocket broadcast', {
      type: data.type,
      successCount,
      failCount,
      totalClients: this.wss.clients.size
    });

    return successCount > 0;
  }

  /**
   * Send message to specific client
   */
  sendToClient(client, data) {
    if (client.readyState === wSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
        logger.debug('Message sent to client', { type: data.type });
        return true;
      } catch (error) {
        logger.error('Failed to send message to client', {
          error: error.message
        });
        return false;
      }
    }
    return false;
  }

  /**
   * Get current connection status
   */
  getStatus() {
    if (!this.wss) {
      return {
        initialized: false,
        clients: 0
      };
    }

    let openConnections = 0;
    let closedConnections = 0;
    let connectingConnections = 0;

    this.wss.clients.forEach(client => {
      switch (client.readyState) {
        case wSocket.OPEN:
          openConnections++;
          break;
        case wSocket.CLOSED:
          closedConnections++;
          break;
        case wSocket.CONNECTING:
          connectingConnections++;
          break;
      }
    });

    return {
      initialized: true,
      totalClients: this.wss.clients.size,
      openConnections,
      closedConnections,
      connectingConnections
    };
  }

  /**
   * Close all connections gracefully
   */
  closeAll(code = 1000, reason = 'Server shutdown') {
    if (!this.wss) return;

    logger.info('Closing all WebSocket connections', {
      totalClients: this.wss.clients.size
    });

    this.wss.clients.forEach(client => {
      if (client.readyState === wSocket.OPEN) {
        client.close(code, reason);
      }
    });
  }
}

module.exports = new WebSocketService();