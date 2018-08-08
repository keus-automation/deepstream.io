'use strict'

const ConnectionEndpoint = require('../websocket/connection-endpoint');
const C = require('../../constants/constants')

const SocketWrapper = require('./socket-wrapper')
const uws = require('uws')

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
  }

  addHTTPListeners (httpServer) {
    httpServer.on('upgrade', this._onUpgradeRequest.bind(this))
  }
  /**
   * Initialize the uws endpoint, setup callbacks etc.
   *
   * @private
   * @returns {void}
   */
  createWebsocketServer () {
    const maxMessageSize = this._getOption('maxMessageSize')
    const perMessageDeflate = this._getOption('perMessageDeflate')
    this._serverGroup = uws.native.server.group.create(perMessageDeflate, maxMessageSize)

    this._noDelay = this._getOption('noDelay')

    uws.native.server.group.onDisconnection(
      this._serverGroup,
      (external, code, message, socketWrapper) => {
        if (socketWrapper) {
          socketWrapper.close()
        }
      }
    )

    uws.native.server.group.onMessage(this._serverGroup, (message, socketWrapper) => {
      socketWrapper.onMessage(message)
    })

    uws.native.server.group.onPing(this._serverGroup, () => {})
    uws.native.server.group.onPong(this._serverGroup, () => {})
    uws.native.server.group.onConnection(this._serverGroup, this._onConnection.bind(this))

    uws.native.server.group.startAutoPing(
      this._serverGroup,
      this._getOption('heartbeatInterval'),
      messageBuilder.getMsg(C.TOPIC.CONNECTION, C.ACTIONS.PING)
    )
  }

  closeWebsocketServer () {
    if (this._serverGroup) {
      uws.native.server.group.close(this._serverGroup)
    }
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
  createWebsocketWrapper (external) {
    const address = uws.native.getAddress(external)
    const handshakeData = {
      remoteAddress: address[1],
      headers: this._upgradeRequest.headers,
      referer: this._upgradeRequest.headers.referer
    }

    this._upgradeRequest = null

    const socketWrapper = new SocketWrapper(
      external, handshakeData, this._logger, this._options, this
    )
    uws.native.setUserData(external, socketWrapper)
    return socketWrapper;
  }

  closeWebsocketWrapper (socketWrapper) {
    uws.native.clearUserData(socketWrapper._external)
  }

  /**
   * HTTP upgrade request listener
   *
   * @param {Request} request
   * @param {Socket}  socket
   *
   * @private
   * @returns {void}
   */
  _onUpgradeRequest (request, socket) {
    const requestPath = request.url.split('?')[0].split('#')[0]
    if (!this._urlPath || this._urlPath === requestPath) {
      this._handleUpgrade(request, socket)
    }
    UWSConnectionEndpoint._terminateSocket(socket, 400, 'URL not supported')
  }

  /**
   * Terminate an HTTP socket with some error code and error message
   *
   * @param {Socket}  socket
   * @param {Number}  code
   * @param {String}  name
   *
   * @private
   * @returns {void}
   */
  static _terminateSocket (socket, code, name) {
    socket.end(`HTTP/1.1 ${code}  ${name}\r\n\r\n`)
  }

  /**
   * Process websocket upgrade
   *
   * @param {Request} request
   * @param {Socket}  socket
   *
   * @private
   * @returns {void}
   */
  _handleUpgrade (request, socket) {
    const secKey = request.headers['sec-websocket-key']
    const socketHandle = socket.ssl ? socket._parent._handle : socket._handle
    const sslState = socket.ssl ? socket.ssl._external : null
    if (secKey && secKey.length === 24) {
      socket.setNoDelay(this._noDelay)
      const ticket = uws.native.transfer(
        socketHandle.fd === -1 ? socketHandle : socketHandle.fd,
        sslState
      )
      socket.on('close', () => {
        if (this._serverGroup) {
          this._upgradeRequest = request
          uws.native.upgrade(
            this._serverGroup,
            ticket, secKey,
            request.headers['sec-websocket-extensions'],
            request.headers['sec-websocket-protocol']
          )
        }
      })
    }
    socket.destroy()
  }
}
