// GTNH-PATCH: 这个 fork 只服务 1.7.10（GTNH 用的版本）
const testedVersions = ['1.7.10']
module.exports = {
  testedVersions,
  latestSupportedVersion: testedVersions[testedVersions.length - 1],
  oldestSupportedVersion: testedVersions[0]
}
