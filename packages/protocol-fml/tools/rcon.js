'use strict'

/*
 * 极简 RCON 客户端（Source RCON 协议），用来给本地 GTNH 服务端发命令，
 * 比如给 bot 发物品、改天气、传送——测试时比手敲控制台方便。
 *
 *   node tools/rcon.js "give gtnh-bot minecraft:stone 64"
 *   node tools/rcon.js --host 127.0.0.1 --port 25575 --password xxx "time set day"
 *
 * 密码默认从 server.properties 读。
 */

const net = require('net')
const fs = require('fs')
const path = require('path')

const SERVER_DIR = 'G:/mc/GTNH2.9.0-server'

function readServerProperties (dir = SERVER_DIR) {
  const file = path.join(dir, 'server.properties')
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) out[match[1].trim()] = match[2].trim()
  }
  return out
}

const TYPE = { AUTH: 3, AUTH_RESPONSE: 2, EXEC: 2, RESPONSE: 0 }

function encode (id, type, body) {
  const payload = Buffer.from(body, 'utf8')
  const buf = Buffer.alloc(14 + payload.length)
  buf.writeInt32LE(10 + payload.length, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  payload.copy(buf, 12)
  buf.writeInt16LE(0, 12 + payload.length) // 两个 0 字节结尾
  return buf
}

function decode (buf) {
  const length = buf.readInt32LE(0)
  const id = buf.readInt32LE(4)
  const type = buf.readInt32LE(8)
  const body = buf.slice(12, 4 + length - 2).toString('utf8')
  return { id, type, body }
}

async function run (commands, options) {
  // 传字符串时当成单条命令（否则会被 for...of 按字符拆开）
  if (typeof commands === 'string') commands = [commands]
  const props = readServerProperties()
  const password = options.password ?? props['rcon.password']
  const port = Number(options.port ?? props['rcon.port'] ?? 25575)
  if (!password) throw new Error('rcon: 找不到密码（server.properties 里没有 rcon.password）')

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: options.host ?? '127.0.0.1', port })
    let buffer = Buffer.alloc(0)
    let authed = false
    const results = []
    let index = 0
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('rcon: 超时')) }, options.timeout ?? 8000)

    const next = () => {
      if (index >= commands.length) {
        clearTimeout(timer)
        socket.end()
        return resolve(results)
      }
      socket.write(encode(10 + index, TYPE.EXEC, commands[index++]))
    }

    socket.on('connect', () => socket.write(encode(1, TYPE.AUTH, password)))
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0)
        if (buffer.length < 4 + length) break
        const packet = decode(buffer)
        buffer = buffer.slice(4 + length)
        if (!authed) {
          if (packet.id === -1 || packet.type !== TYPE.AUTH_RESPONSE) {
            clearTimeout(timer)
            socket.destroy()
            return reject(new Error('rcon: 认证失败'))
          }
          authed = true
          next()
        } else {
          results.push(packet.body)
          next()
        }
      }
    })
    socket.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

function parseArgv (argv) {
  const options = {}
  const commands = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--host') options.host = argv[++i]
    else if (arg === '--port') options.port = Number(argv[++i])
    else if (arg === '--password') options.password = argv[++i]
    else if (arg === '--timeout') options.timeout = Number(argv[++i])
    else commands.push(arg)
  }
  return { options, commands }
}

module.exports = { rcon: run, readServerProperties, parseArgv }

if (require.main === module) {
  const { options, commands } = parseArgv(process.argv.slice(2))
  if (!commands.length) {
    console.error('用法: node tools/rcon.js "命令" ["命令2" ...]')
    process.exit(1)
  }
  run(commands, options).then((results) => {
    for (const line of results) if (line) console.log(line)
  }).catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
