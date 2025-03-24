/**
 * Module dependencies.
 */

import { createReadStream } from 'fs'
import { stat, access } from 'fs/promises'
import { basename, extname, parse, sep } from 'path'
import resolvePath from './local-libs/resolve-path.mjs'
import createError from 'http-errors'
import assert from 'assert'
const {isArray} = Array

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (e) {
    return false
  }
}
function decode(path) {
  try {
    return decodeURIComponent(path)
  } catch (err) {
    return -1
  }
}

const time = () => {} // (label, path) => console.time(`${label}-${path}`)
const timeEnd = time // (label, path) => console.timeEnd(`${label}-${path}`)


const get_opts = (opts, path) => ({
  root: opts.root || '',
  trailingSlash: path[path.length - 1] === '/',
  path: decode(path.slice(parse(path).root.length)),
  index: opts.index,
  maxage: opts.maxage || opts.maxAge || 0,
  immutable: opts.immutable || false,
  hidden: opts.hidden || false,
  format: opts.format !== false,
  extensions: isArray(opts.extensions) ? opts.extensions : false,
  brotli: opts.brotli !== false,
  gzip: opts.gzip !== false,
  setHeaders: opts.setHeaders,
  cache: opts.cache
})
const cache_map = new Map()

/**
 * Send file at `path` with the
 * given `options` to the koa `ctx`.
 *
 * @param {Context} ctx
 * @param {String} path
 * @param {Object} [opts]
 * @return {Promise}
 * @api public
 */

export default async function send(ctx, _path, opts = {}) {
  time('part-1', _path)
  time('begin', _path)
  assert(ctx, 'koa context required')
  assert(_path, 'pathname required')

  let {
    root, trailingSlash, path, index, maxage, immutable, hidden,
    format, extensions, brotli, gzip, setHeaders, cache
  } = get_opts(opts, _path)

  const cache_obj = {}
  // if(cache) console.log(path)
  if(cache_map.has(path)) Object.assign(cache_obj, cache_map.get(path))
  else if(cache?.test(path)) cache_map.set(path, cache_obj)
  // console.log(cache_obj)
  timeEnd('begin', _path)
  if (setHeaders && typeof setHeaders !== 'function') {
    throw new TypeError('option setHeaders must be function')
  }

  if (path === -1) return ctx.throw(400, 'failed to decode')

  // index file support
  if (index && trailingSlash) path += index

  path = resolvePath(root, path)

  // hidden file support, ignore
  if (!hidden && isHidden(root, path)) return

  let encodingExt = ''
  time('_exists 1', path)
  // serve brotli file when possible otherwise gzipped file when possible
  const _exists = async (ext) => ext in cache_obj ? cache_obj[ext] : (cache_obj[ext]=await exists(path + `.${ext}`))
  if(ctx.acceptsEncodings('br', 'identity') === 'br' && brotli && await _exists('br')) {
    path = path + '.br'
    ctx.set('Content-Encoding', 'br')
    ctx.res.removeHeader('Content-Length')
    encodingExt = '.br'
  } else if(ctx.acceptsEncodings('gzip', 'identity') === 'gzip' && gzip && await _exists('gz')) {
    path = path + '.gz'
    ctx.set('Content-Encoding', 'gzip')
    ctx.res.removeHeader('Content-Length')
    encodingExt = '.gz'
  }
  timeEnd('_exists 1', path)

  time('_exists 2', path)
  if(extensions && !/\./.exec(basename(path))) {
    const list = [].concat(extensions)
    for (let i = 0; i < list.length; i++) {
      let ext = list[i]
      if(typeof ext !== 'string') {
        throw new TypeError('option extensions must be array of strings or false')
      }
      if(!/^\./.exec(ext)) ext = `.${ext}`
      if(!('exists' in cache_obj)) cache_obj.exists = {}
      const full_path = `${path}${ext}`
      if(
        full_path in cache_obj.exists[full_path]
          ? cache_obj.exists[full_path]
          : (cache_obj.exists[full_path] = await exists(full_path))
      ) {
        path = full_path
        break
      }
    }
  }
  timeEnd('_exists 2', path)

  // stat
  let stats
  try {
    // console.log(cache_obj.stats && cache_obj.stats[path])
    if(!('stats' in cache_obj)) cache_obj.stats = {}
    time('stats-', path)
    stats = cache_obj.stats[path] || (cache_obj.stats[path] = await stat(path))
    timeEnd('stats-', path)

    // Format the path to serve static file servers
    // and not require a trailing slash for directories,
    // so that you can do both `/directory` and `/directory/`
    if(stats.isDirectory())
      if(format && index) {
        path += `/${index}`
        stats = cache_obj.stats[path] || (cache_obj.stats[path] = await stat(path))
      } else {
        // timeEnd('stats')
        return
      }
  } catch (err) {
    const notfound = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR']
    if (notfound.includes(err.code)) {
      throw createError(404, err)
    }
    err.status = 500
    throw err
  }

  if (setHeaders) setHeaders(ctx.res, path, stats)

  // stream
  ctx.set('Content-Length', stats.size)
  if (!ctx.response.get('Last-Modified')) ctx.set('Last-Modified', stats.mtime.toUTCString())
  if (!ctx.response.get('Cache-Control')) {
    const directives = [`max-age=${(maxage / 1000 | 0)}`]
    if (immutable) {
      directives.push('immutable')
    }
    ctx.set('Cache-Control', directives.join(','))
  }
  if (!ctx.type) ctx.type = type(path, encodingExt)
  timeEnd('part-1', path)
  time('sending body', path)
  if(cache_obj.body)
    ctx.body = cache_obj.body
  else {
    const stream = createReadStream(path)
    let cache = Buffer.allocUnsafe(0)
    stream.on('data', (chunk) => cache = Buffer.concat([cache, chunk]))
    stream.on('end', () => cache_obj.body = cache)
    ctx.body = stream
  }
  timeEnd('sending body', path)

  return path
}

/**
 * Check if it's hidden.
 */

function isHidden(root, path) {
  path = path.substr(root.length).split(sep)
  for (let i = 0; i < path.length; i++) {
    if (path[i][0] === '.') return true
  }
  return false
}

/**
 * File type.
 */

function type(file, ext) {
  return ext !== '' ? extname(basename(file, ext)) : extname(file)
}