// GTNH-PATCH：1.7.10 的 keep_alive（0x00）服务端每 2 秒发一次，客户端必须原样回显，
// 不回会在服务端超时后被踢（表现为 `end: socketClosed`，日志里看不出原因）。
// 上游 mineflayer 的 1.7.10 路径里没有这个插件，我们补一个。
module.exports = inject

function inject (bot) {
  bot._client.on('keep_alive', (packet) => {
    bot.emit('keepalive', packet.keepAliveId)
    bot._client.write('keep_alive', { keepAliveId: packet.keepAliveId })
  })
}
