'use strict'

const fs = require('fs')
const path = require('path')
const mc = require('minecraft-protocol')
const { FmlHandshake } = require('./handshake')
const { stripVarShortPayload } = require('./codec')
const {
  decodeChunkPacket,
  decodeMapChunkBulk,
  decodeBlockChange,
  decodeMultiBlockChange
} = require('./gtnh/chunkapi')
const { parsePacket: parseModularUIPacket, decodeSyncValue, collectSync, PACKET_NAMES: MODULARUI_PACKETS } = require('./gtnh/modularui')

/*
 * 1.7.10 的 S→C custom_payload：minecraft-data 里是 channel + i16 + data，
 * 但 Forge 实际写的是 varshort（GTNH 的注册表包 >32KB，i16 直接读成负数）。
 * 这里把该包改成 restBuffer，拿到字节后自己剥长度前缀，等价于按 varshort 解析。
 */
const GTNH_CUSTOM_PACKETS = {
  '1.7': {
    play: {
      toClient: {
        types: {
          packet_custom_payload: ['container', [
            { name: 'channel', type: 'string' },
            { name: 'data', type: 'restBuffer' }
          ]]
        }
      }
    }
  }
}

/*
 * ChunkAPI（GTNH 必装）把三个区块/方块包整包换掉了，载荷不再是原版布局。
 * 与其让 protodef 按原版结构解析出一堆错位字段，不如三个包都只取字节，
 * 再由 chunkapi.js 解码后重新 emit：
 *   map_chunk          -> 'gtnh_chunk'
 *   map_chunk_bulk     -> 'gtnh_chunk_bulk'
 *   block_change       -> 'gtnh_block_change'
 *   multi_block_change -> 'gtnh_multi_block_change'
 * 解码失败时发 'gtnh_packet_error'，不吞异常也不断线。
 */
const CHUNKAPI_PACKETS = {
  '1.7': {
    play: {
      toClient: {
        types: {
          // 注意：nmp 用 lodash.merge 合并 customPackets，数组会按下标逐项合并。
          // 直接写 container 数组只会改掉第 0 个字段，剩下 7 个原版字段还在，必然写崩。
          // 所以用「新类型 + 字符串别名」：merge 遇到字符串会整个替换掉原数组。
          gtnh_gtnh_payload: ['container', [{ name: 'payload', type: 'restBuffer' }]],
          packet_map_chunk: 'gtnh_gtnh_payload',
          packet_map_chunk_bulk: 'gtnh_gtnh_payload',
          packet_block_change: 'gtnh_gtnh_payload',
          packet_multi_block_change: 'gtnh_gtnh_payload'
        }
      }
    }
  }
}

/*
 * EndlessIDs 的 PacketBufferMixin 把 ItemStack 的序列化整个换掉了：
 *   空槽  -> writeInt(-1)
 *   有物品 -> writeInt(itemId) + byte(count) + short(damage) + nbt
 * 原版是 short(itemId)，GTNH 的 id 能到 10000+，short 装不下（也读不对）。
 * 这里直接覆盖协议根的 `slot` 类型：1.7 里所有引用 slot 的包（set_slot、
 * window_items、entity_equipment、window_click、block_place…）一起生效。
 */
const GTNH_SLOT_PACKETS = {
  '1.7': {
    types: {
      gtnh_gtnh_slot: ['container', [
        { name: 'blockId', type: 'i32' },
        {
          anon: true,
          type: ['switch', {
            compareTo: 'blockId',
            fields: { '-1': 'void' },
            default: ['container', [
              { name: 'itemCount', type: 'i8' },
              { name: 'itemDamage', type: 'i16' },
              { name: 'nbtData', type: 'compressedNbt' },
              // GTNH 实测：非空物品在 NBT 之后还有一个固定为 1 的字节，
              // 空槽（id=-1）没有。见 docs/FINDINGS.md 第十节。
              { name: 'gtnhFlag', type: 'u8' }
            ]]
          }]
        }
      ]],
      // 字符串别名：lodash.merge 遇到字符串会整段替换掉原来的数组定义
      slot: 'gtnh_gtnh_slot'
    }
  }
}

/*
 * 1.7.10 的 C04PacketPlayerPosition 线序是 x, y(脚底), stance(眼睛), z，
 * 而 minecraft-data 把第 2、3 个字段命名成了 stance、y（顺序刚好相反）。
 * 结果我们发出去的 stance 被服务器当成脚底，服务器算出的眼睛高度是 -1.62，
 * Hodgepodge 直接以 hodgepodge.disconnect.illegal_stance 踢人。
 * 这里把字段顺序和名字都改回真实语义。
 */
const GTNH_MOVEMENT_PACKETS = {
  '1.7': {
    play: {
      toServer: {
        types: {
          gtnh_position: ['container', [
            { name: 'x', type: 'f64' },
            { name: 'y', type: 'f64' },
            { name: 'stance', type: 'f64' },
            { name: 'z', type: 'f64' },
            { name: 'onGround', type: 'bool' }
          ]],
          gtnh_position_look: ['container', [
            { name: 'x', type: 'f64' },
            { name: 'y', type: 'f64' },
            { name: 'stance', type: 'f64' },
            { name: 'z', type: 'f64' },
            { name: 'yaw', type: 'f32' },
            { name: 'pitch', type: 'f32' },
            { name: 'onGround', type: 'bool' }
          ]],
          packet_position: 'gtnh_position',
          packet_position_look: 'gtnh_position_look'
        }
      }
    }
  }
}

/*
 * 登录包（S01PacketJoinGame）在 GTNH 上多一个 int 维度 id：
 * Hodgepodge 的 MixinS01PacketJoinGame_FixDimensionID 在 write 末尾追加 writeInt(dimensionID)，
 * 读端「还剩 >=4 字节才读」，所以原版服可能没有。
 * minecraft-data 的定义少了这 4 字节 → 每帧报
 *   `Chunk size is 17 but only 13 was read`，mineflayer 的状态机偶尔因此卡在登录、不触发 spawn。
 * 这里在末尾补一个 restBuffer 风格的 dimensionId（0 或 4 字节），由上层解码。
 */
const GTNH_LOGIN_PACKETS = {
  '1.7': {
    play: {
      toClient: {
        types: {
          gtnh_login: ['container', [
            { name: 'entityId', type: 'i32' },
            { name: 'gameMode', type: 'u8' },
            { name: 'dimension', type: 'i8' },
            { name: 'difficulty', type: 'u8' },
            { name: 'maxPlayers', type: 'u8' },
            { name: 'levelType', type: 'string' },
            { name: 'dimensionId', type: 'restBuffer' } // 0 或 4 字节，见上方注释
          ]],
          packet_login: 'gtnh_login'
        }
      }
    }
  }
}

/*
 * 方块实体数据包（S35）在 GTNH 上多 **1 个字节**：
 *   position_isi + action(u8) + 多的那个 u8 + i16 nbtLen + gzip
 * minecraft-data 定义为 position_isi + action + compressedNbt，于是 nbtLen 被读成 0 →
 * `zlib decompress failed: unexpected end of file`，所有 TE 数据都拿不到
 * （TiC 水龙头 direction / 冶炼炉液体 / 箱子自定义名等）。
 */
const GTNH_TE_PACKETS = {
  '1.7': {
    play: {
      toClient: {
        types: {
          gtnh_tile_entity_data: ['container', [
            { name: 'location', type: 'position_isi' },
            { name: 'action', type: 'u8' },
            { name: 'extra', type: 'u8' },
            { name: 'nbtData', type: 'compressedNbt' }
          ]],
          packet_tile_entity_data: 'gtnh_tile_entity_data'
        }
      }
    }
  }
}

/**
 * 实体生成包：EndlessIDs 把 `S0F spawn_entity_living` 的 **type 从 u8 加宽成 i16**。
 *
 * 证据：`endlessids-mc1.7.10-1.7.4.jar :: …/mixin/mixins/common/entity/vanilla/S0FPacketSpawnMobMixin.class`
 *   writeType  = PacketBuffer.writeShort(type & 32767)
 *   readType   = readShort() & 32767
 * 按 u8 读会整体错位 1 字节：实测 x/y/z 变成 34078720 这种天文数字，所有 mob 都是
 * "unknown"、`entitySpawn` 里 position 全错。抓包帧 `0f ef01 0041 00000317 …`：
 *   id=varint 239、type=short 0x0041=65(Bat)、x=791/32=24.7 ✓
 */
const GTNH_ENTITY_PACKETS = {
  '1.7': {
    play: {
      toClient: {
        types: {
          gtnh_spawn_entity_living: ['container', [
            { name: 'entityId', type: 'varint' },
            { name: 'type', type: 'i16' }, // ← 原版是 u8
            { name: 'x', type: 'i32' },
            { name: 'y', type: 'i32' },
            { name: 'z', type: 'i32' },
            { name: 'yaw', type: 'i8' },
            { name: 'pitch', type: 'i8' },
            { name: 'headPitch', type: 'i8' },
            { name: 'velocity', type: 'vec3i16' },
            { name: 'metadata', type: 'entityMetadata' }
          ]],
          packet_spawn_entity_living: 'gtnh_spawn_entity_living'
        }
      }
    }
  }
}

function mergeCustomPackets (...sources) {
  const out = { '1.7': { types: {}, play: { toClient: { types: {} }, toServer: { types: {} } } } }
  for (const src of sources) {
    if (!src) continue
    const root = src['1.7']?.types ?? {}
    const toClient = src['1.7']?.play?.toClient?.types ?? {}
    const toServer = src['1.7']?.play?.toServer?.types ?? {}
    Object.assign(out['1.7'].types, root)
    Object.assign(out['1.7'].play.toClient.types, toClient)
    Object.assign(out['1.7'].play.toServer.types, toServer)
  }
  return out
}

/*
 * 建一个带 FML 握手的 1.7.10 客户端。
 * 关键点：
 *   - 握手包 serverHost 末尾必须带 \0FML\0，否则 Forge 服直接拒绝；
 *   - custom_payload 的长度字段是 varshort，要在 emit 之前剥掉；
 *   - ChunkAPI 的区块/方块包要自己解码（chunkapi: false 可关掉）。
 */
function createFmlClient (options = {}) {
  const host = options.host
  if (!host) throw new Error('createFmlClient: 需要 host')

  const chunkapi = options.chunkapi !== false
  const slots = options.gtnhSlots !== false
  const packets = mergeCustomPackets(
    options.customPackets ?? GTNH_CUSTOM_PACKETS,
    chunkapi ? CHUNKAPI_PACKETS : null,
    slots ? GTNH_SLOT_PACKETS : null,
    GTNH_MOVEMENT_PACKETS,
    GTNH_LOGIN_PACKETS,
    GTNH_ENTITY_PACKETS,
    GTNH_TE_PACKETS
  )

  const client = mc.createClient({
    ...options,
    // pluginChannels 会按 vanilla 插件通道的协议去解 FML 的载荷，1.7 上全是噪音
    validateChannelProtocol: false,
    // protodef 默认会把每次解析失败的完整堆栈打到控制台；GTNH 上 entity_metadata
    // 等包偶发解析失败，噪音会把真正有用的输出淹掉。需要排查时传 hideErrors:false。
    hideErrors: options.hideErrors ?? true,
    version: options.version ?? '1.7.10',
    auth: options.auth ?? 'offline',
    fakeHost: options.fakeHost ?? `${host}\u0000FML\u0000`,
    customPackets: packets
  })

  const emit = client.emit.bind(client)
  client.emit = function (event, ...args) {
    // GTNH 的维度 id 是 int（Hodgepodge 追加在登录包末尾），这里还原到 dimension
    if (event === 'login' && args[0] && Buffer.isBuffer(args[0].dimensionId) && args[0].dimensionId.length >= 4) {
      args[0].dimension = args[0].dimensionId.readInt32BE(0)
    }
    if (event === 'custom_payload' && args[0] && Buffer.isBuffer(args[0].data)) {
      const channel = args[0].channel
      args[0] = { channel, data: stripVarShortPayload(args[0].data) }
      // ModularUI2：GT 机器的 GUI 走这个通道，顺手解出来再发一个结构化事件
      if (channel === 'modularui2') {
        try {
          emit('gtnh_mui2', parseModularUIPacket(args[0].data))
        } catch (error) {
          emit('gtnh_packet_error', { packet: 'modularui2', error, raw: args[0].data })
        }
      }
    } else if (chunkapi && args[0] && Buffer.isBuffer(args[0].payload)) {
      const decoded = decodeChunkApiPacket(event, args[0].payload)
      if (decoded) {
        if (decoded.error) {
          emit('gtnh_packet_error', { packet: event, error: decoded.error, raw: args[0].payload })
        } else {
          emit(decoded.name, decoded.value)
        }
        return true // 原事件不再往下发：它的字段已经不是原版语义了
      }
    }
    return emit(event, ...args)
  }

  const fml = new FmlHandshake(client, {
    mods: resolveMods(options),
    channels: options.channels,
    log: options.log
  })
  fml.attach()
  client.fml = fml
  return client
}

// FML 握手必须原样回声服务器的 mod 列表，否则会被 Mod rejections 踢掉。
// options.mods 没给时，从 data/raw/*-modlist.json（tools/ping.js 落盘）里按 host:port 找一份。
function resolveMods (options) {
  if (Array.isArray(options.mods) && options.mods.length > 0) return options.mods
  const dir = path.join(__dirname, '..', 'data', 'raw')
  const files = ['local-server-modlist.json', 'server-modlist.json']
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (!Array.isArray(data.mods) || data.mods.length === 0) continue
      if (options.host && data.host && data.host !== options.host) continue
      if (options.port && data.port && String(data.port) !== String(options.port)) continue
      return data.mods
    } catch (e) { /* 文件不存在就试下一个 */ }
  }
  return []
}

function decodeChunkApiPacket (event, payload) {
  const table = {
    map_chunk: ['gtnh_chunk', decodeChunkPacket],
    map_chunk_bulk: ['gtnh_chunk_bulk', decodeMapChunkBulk],
    block_change: ['gtnh_block_change', decodeBlockChange],
    multi_block_change: ['gtnh_multi_block_change', decodeMultiBlockChange]
  }
  const entry = table[event]
  if (!entry) return undefined
  try {
    return { name: entry[0], value: entry[1](payload) }
  } catch (error) {
    return { name: entry[0], error }
  }
}

module.exports = {
  createFmlClient,
  parseModularUIPacket,
  decodeSyncValue,
  collectSync,
  MODULARUI_PACKETS,
  FmlHandshake,
  GTNH_CUSTOM_PACKETS,
  CHUNKAPI_PACKETS,
  GTNH_SLOT_PACKETS,
  GTNH_MOVEMENT_PACKETS,
  GTNH_LOGIN_PACKETS,
  GTNH_ENTITY_PACKETS,
  GTNH_TE_PACKETS,
  mergeCustomPackets,
  decodeChunkApiPacket
}
