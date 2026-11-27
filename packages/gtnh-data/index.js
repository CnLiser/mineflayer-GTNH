'use strict'

/*
 * gtnh-data —— GTNH 的数据覆盖层。
 *
 * 几块东西：
 *   1. ModRegistry：服务器运行时分配的 block/item id 表（来自 FML ModIdData 抓取）；
 *   2. Lang：整合包 jar 里的 en_US / zh_CN 语言文件，用来把注册名变成人话；
 *   3. FEATURES_1_7_10：minecraft-data 对 1.7.10 一律返回 false 的 feature 表；
 *   4. RecipeBook / ModRecipes / GtRecipes：矿辞、原版配方、各 mod 配方、GT 机器配方；
 *   5. TConstructData：熔炼温度与流体、熔炉燃料、工具/弓/箭材料。
 *
 * 用法：
 *   const { ModRegistry, Lang } = require('gtnh-data')
 *   const reg = ModRegistry.fromObject(require('./data/raw/local-fml-registry.json'))
 *   reg.blockName(11298)            // 'ProjRed|Exploration:projectred.exploration.lily'
 */

const fs = require('fs')
const path = require('path')
const { ModRegistry } = require('./src/registry')
const { Lang } = require('./src/lang')
const { RecipeBook, loadRecipeBook, WILDCARD, DATA_DIR } = require('./src/recipes')
const { TConstructData, loadTConstruct, T_CONSTRUCT_FILE } = require('./src/tconstruct')
const { GtRecipes, loadGtRecipes, DATA_FILE: GT_RECIPES_FILE } = require('./src/gt-recipes')
const { ModRecipes, loadModRecipes, MOD_RECIPES_FILE } = require('./src/mod-recipes')
const { EntityTypes, loadEntities, ENTITIES_FILE } = require('./src/entities')
const { toolFor: harvestToolFor, needs: needsTool, toolCounts: harvestToolCounts, HARVEST_FILE } = require('./src/harvest')
const { gtToolKind, gtToolName, gtToolsOfKind, GT_TOOLS_FILE } = require('./src/gt-tools')
const { Quests, loadQuests, QUESTS_FILE } = require('./src/quests')
const {
  FEATURES_1_7_10,
  GTNH_FEATURES,
  GTNH_OVERRIDES,
  supports,
  supportsVanilla,
  featureValue,
  listFeatures
} = require('./src/features')

function loadRegistryFile (file) {
  return ModRegistry.fromJSON(fs.readFileSync(file, 'utf8'))
}

function loadLang (dir = path.join(__dirname, 'data', 'raw', 'gtnh-2.9.0', 'lang')) {
  const read = (name) => {
    const file = path.join(dir, name)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  }
  return new Lang({ en: read('en_US.json'), zh: read('zh_CN.json') })
}

module.exports = {
  ModRegistry,
  Lang,
  loadRegistryFile,
  loadLang,
  RecipeBook,
  loadRecipeBook,
  WILDCARD,
  RECIPES_DIR: DATA_DIR,
  GtRecipes,
  loadGtRecipes,
  GT_RECIPES_FILE,
  ModRecipes,
  loadModRecipes,
  MOD_RECIPES_FILE,
  FEATURES_1_7_10,
  GTNH_FEATURES,
  GTNH_OVERRIDES,
  supports,
  supportsVanilla,
  featureValue,
  listFeatures,
  TConstructData,
  loadTConstruct,
  T_CONSTRUCT_FILE,
  EntityTypes,
  loadEntities,
  ENTITIES_FILE,
  harvestToolFor,
  needsTool,
  harvestToolCounts,
  HARVEST_FILE,
  gtToolKind,
  gtToolName,
  gtToolsOfKind,
  Quests,
  loadQuests,
  QUESTS_FILE,
  GT_TOOLS_FILE
}
