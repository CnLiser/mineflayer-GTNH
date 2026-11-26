'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { loadTConstruct, TConstructData } = require('../index')

test('tconstruct：数据总量', () => {
  const t = loadTConstruct()
  const s = t.summary()
  assert.strictEqual(s.materials, 184)
  assert.strictEqual(s.bowMaterials, 180)
  assert.strictEqual(s.arrowMaterials, 180)
  assert.strictEqual(s.fuels, 4)
  assert.strictEqual(s.melting, 956)
})

test('tconstruct：材料按名字与 id 查（Manyullyn）', () => {
  const t = loadTConstruct()
  const byName = t.material('manyullyn')
  assert.ok(byName)
  assert.strictEqual(byName.name, 'Manyullyn')
  assert.strictEqual(byName.harvestLevel, 9)
  assert.strictEqual(byName.durability, 900)
  const byId = t.material(byName.id)
  assert.strictEqual(byId.name, 'Manyullyn')
  // 大小写不敏感
  assert.strictEqual(t.material('Manyullyn').name, 'Manyullyn')
  // 不存在
  assert.strictEqual(t.material('no_such_material'), null)
})

test('tconstruct：toolSpeed 把 ×100 的整数还原成直观值', () => {
  const t = loadTConstruct()
  assert.strictEqual(t.toolSpeed('wood'), 1.5)
  assert.strictEqual(t.toolSpeed('manyullyn'), 9)
  assert.strictEqual(t.toolSpeed('cobalt'), 11)
})

test('tconstruct：熔炉燃料', () => {
  const t = loadTConstruct()
  assert.deepStrictEqual(t.fuel('lava'), { fluid: 'lava', power: 1300, duration: 80 })
  assert.strictEqual(t.isFuel('lava'), true)
  assert.strictEqual(t.isFuel('water'), false)
  assert.strictEqual(t.fuel('water'), null)
  assert.ok(t.fuels().some((f) => f.fluid === 'pyrotheum'))
})

test('tconstruct：熔炼配方与温度', () => {
  const t = loadTConstruct()
  const m = t.meltingFor(3034, 4019) // 铝矿
  assert.ok(m)
  assert.strictEqual(m.temp, 400)
  assert.strictEqual(m.fluid, 'aluminum.molten')
  assert.strictEqual(m.amount, 144)
  assert.strictEqual(t.temperatureFor(3034, 4019), 400)
  // 熔岩 1300 能熔，水不能（不是燃料）
  assert.strictEqual(t.canMeltWith('lava', 3034, 4019), true)
  assert.strictEqual(t.canMeltWith('water', 3034, 4019), false)
})

test('tconstruct：温度越高越难熔（存在 > 熔岩 1300 的配方）', () => {
  const t = loadTConstruct()
  const m = t.meltingFor(3034, 4019)
  assert.ok(m)
  // 全表温度区间检查
  const temps = Object.values(t._melting).map((x) => x.temp)
  assert.ok(temps.every((x) => typeof x === 'number' && x > 0))
  assert.ok(Math.max(...temps) > 1300, '至少有一种熔不动的配方温度高于熔岩')
})

test('tconstruct：弓/箭材料按材料 id 索引', () => {
  const t = loadTConstruct()
  const bow = t.bowMaterial('wood')
  assert.ok(bow)
  assert.strictEqual(typeof bow.drawSpeed, 'number')
  const arrow = t.arrowMaterial('wood')
  assert.ok(arrow)
  assert.strictEqual(typeof arrow.mass, 'number')
})

test('tconstruct：可以从文件独立构造（不污染单例）', () => {
  const t = loadTConstruct()
  const doc = JSON.parse(JSON.stringify(t.doc))
  const other = new TConstructData(doc)
  assert.deepStrictEqual(other.summary(), t.summary())
  assert.strictEqual(other.material('manyullyn').durability, t.material('manyullyn').durability)
})
