/*!
 * resolve-path
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2015-2018 Douglas Christopher Wilson
 * Copyright(c) 2023 Michael Akiliev (fork https://github.com/houd1ni/koa-send)
 * MIT Licensed
 */

import createError from 'http-errors'
import {join, normalize, isAbsolute, sep, resolve} from 'path'

/**
 * Module variables.
 * @private
 */

const UP_PATH_REGEXP = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * Resolve relative path against a root path
 *
 * @param {string} rootPath
 * @param {string} relativePath
 * @return {string}
 * @public
 */

export default (rootPath, relativePath) => {
  // root is optional, similar to root.resolve
  const arg1 = rootPath !== undefined
  const arg2 = relativePath !== undefined
  const root = arg2 ? rootPath : process.cwd()
  const path = arg2 ? relativePath : rootPath

  if (!arg1) {
    throw new TypeError('argument rootPath is required')
  }

  if (typeof root !== 'string') {
    throw new TypeError('argument rootPath must be a string')
  }

  if (path == null) {
    throw new TypeError('argument relativePath is required')
  }

  if (typeof path !== 'string') {
    throw new TypeError('argument relativePath must be a string')
  }

  // containing NULL bytes is malicious
  if (path.indexOf('\0') !== -1) {
    throw createError(400, 'Malicious Path')
  }

  // path should never be absolute
  if (isAbsolute(path)) {
    throw createError(400, 'Malicious Path')
  }

  // path outside root
  if (UP_PATH_REGEXP.test(normalize('.' + sep + path))) {
    throw createError(403)
  }

  // join the relative path
  return normalize(join(resolve(root), path))
}