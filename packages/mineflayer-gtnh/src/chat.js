'use strict'

/*
 * 1.7.10 的聊天是 JSON 组件（text / translate / with / extra）。
 * 服务器发来的 translate 键多半是 GTNH 自己的（yamcore.* / dreamcraft.* / serverutilities.*），
 * minecraft-data 的语言表里没有，所以直接用整合包的 lang 渲染。
 */

function parseJSON (input) {
  if (typeof input !== 'string') return input
  const trimmed = input.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { text: input }
  try {
    return JSON.parse(trimmed)
  } catch {
    return { text: input }
  }
}

function render (component, lang) {
  if (component === null || component === undefined) return ''
  if (typeof component === 'string') return component
  if (Array.isArray(component)) return component.map((item) => render(item, lang)).join('')

  let out = ''
  if (typeof component.translate === 'string') {
    const params = (component.with ?? []).map((item) => render(item, lang))
    const template = lang ? lang.key(component.translate) : undefined
    if (template) {
      out = substitute(template, params)
    } else if (params.length) {
      out = `${component.translate}(${params.join(', ')})`
    } else {
      out = component.translate
    }
  } else if (typeof component.text === 'string') {
    out = component.text
  } else if (typeof component.score?.value === 'string') {
    out = component.score.value
  } else if (typeof component.selector === 'string') {
    out = component.selector
  }

  if (Array.isArray(component.extra)) {
    out += component.extra.map((item) => render(item, lang)).join('')
  }
  return out
}

// Minecraft 的 %s / %d / %1$s 之类，简单按顺序替换
function substitute (template, params) {
  let index = 0
  return template.replace(/%(\d+\$)?[sd]/g, (match, position) => {
    if (position) {
      const explicit = Number(position.slice(0, -1)) - 1
      return params[explicit] ?? match
    }
    const value = params[index++]
    return value === undefined ? match : value
  })
}

function formatMessage (input, lang) {
  return render(parseJSON(input), lang)
}

module.exports = { formatMessage, parseJSON, render }
