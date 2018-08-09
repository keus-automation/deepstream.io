'use strict'

const ConnectionEndpoint = require('../websocket/connection-endpoint');
const C = require('../../constants/constants')

const SocketWrapper = require('./socket-wrapper')
const Server = require('uws').Server

const messageBuilder = require('../message-builder')

/**
 * This is the frontmost class of deepstream's message pipeline. It receives
 * connections and authentication requests, authenticates sockets and
 * forwards messages it receives from authenticated sockets.
 *
 * @constructor
 *
 * @extends events.EventEmitter
 *
 * @param {Object} options the extended default options
 * @param {Function} readyCallback will be invoked once both the ws is ready
 */
module.exports = class UWSConnectionEndpoint extends ConnectionEndpoint {
  constructor (options) {
    super(options)
    this.description = 'µWebSocket Connection Endpoint'
    this.onMessages = this.onMessages.bind(this);
  }

  /**
   * Initialize the uws endpoint, setup callbacks etc.
   *
   * @private
   * @returns {void}
   */
  createWebsocketServer () {
    const wss = new Server({
      server: this._httpServer,
      noDelay: this._getOption('noDelay'),
      perMessageDeflate: this._getOption('perMessageDeflate'),
      maxPayload: this._getOption('maxMessageSize')
    });

    wss.on('connection', this._onConnection.bind(this))
    wss.startAutoPing(
      this._getOption('heartbeatInterval'),
      messageBuilder.getMsg(C.TOPIC.CONNECTION, C.ACTIONS.PING)
    )

    return wss
  }

  closeWebsocketServer () {
    this.websocketServer.close()
  }

  /**
   * Receives a connected socket, wraps it in a SocketWrapper, sends a connection ack to the user
   * and subscribes to authentication messages.
   * @param {Websocket} socket
   *
   * @param {WebSocket} external    uws native websocket
   *
   * @private
   * @returns {void}
   */
  createWebsocketWrapper (websocket, upgradeReq) {
    const handshakeData = {
      remoteAddress: websocket._socket.remoteAddress,
      headers: upgradeReq.headers,
      referer: upgradeReq.headers.referer
    }
    const socketWrapper = new SocketWrapper(
      websocket, handshakeData, this._logger, this._options, this
    )
    return socketWrapper;
  }

  closeWebsocketWrapper (socketWrapper) {
    // socketWrapper.terminate()
  }
}
