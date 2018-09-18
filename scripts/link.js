#!/usr/bin/env node
const AsyncTaskGroup = require('async-task-group')
const exec = require('exec')
const huey = require('huey')
const path = require('path')
const fs = require('saxon/sync')

// Number of processed packages
let progress = 0

// Look for a "/packages/" directory in each ancestor.
function getPackageDir(file) {
  const roots = ['/', process.env.HOME]
  for (let dir = file, ret; dir = path.dirname(dir), ret = dir + '/packages/'; ) {
    if (fs.isDir(ret)) return ret
    if (roots.includes(dir)) return null
  }
}

// Directories containing other linked packages
const packages = function() {
  let names = [ process.cwd() ]
  if (process.env.USING) {
    names.push(...process.env.USING.split(',')) 
  }
  return names.map(name => {
    let pkg
    if (path.isAbsolute(name)) {
      pkg = name + '/.'
    } else try {
      pkg = require.resolve(name)
    } catch(e) {}

    if (pkg && (pkg = getPackageDir(pkg))) {
      console.log(huey.pale_green('using:'), pkg)
      return fs.list(pkg)
        .map(name => pkg + name)
        .filter(fs.isDir)
    }

    throw Error('Unknown package dir: ' + name)
  })
}()

const links = [].concat(...packages)
const linkNames = links.map(link => path.basename(link))

// Package queue
const reactPackages = packages[0]
const queue = new AsyncTaskGroup(1, initPackage)
queue.concat(reactPackages)

function initPackage(pkg) {
  console.log(huey.yellow('>>'), pkg)

  let metaStr = fs.read(pkg + '/package.json')
  let meta = JSON.parse(metaStr)

  let deps = meta.dependencies
  if (deps) localize(deps, pkg)

  deps = meta.devDependencies
  if (deps) localize(deps, pkg)

  let space = /\s*$/.exec(metaStr)
  space = space ? space[0] : ''

  metaStr = JSON.stringify(meta, null, 2) + space
  fs.write(pkg + '/package.json', metaStr)
  console.log(huey.coal(metaStr))

  let counted = false
  let countRE = /total (\d+)/

  // Install dependencies
  fs.remove(pkg + '/node_modules', true)
  return exec.async('pnpm install', {
    cwd: pkg,
    listener(err, data) {
      if (err) return console.error(err)
      if (counted) return

      const count = countRE.exec(data)
      if (count) {
        counted = true
        console.log(
          path.basename(pkg) + ':',
          huey.cyan(count[1] + ' dependencies to install')
        )
      }
    }
  }).then(() => {
    let n = ++progress
    let len = reactPackages.length
    let prct = (100 * n / len).toFixed(1)
    console.log(
      path.basename(pkg) + ':',
      huey.green(n), `/ ${len}`, huey.gray(`(${prct}%)`)
    )

    return exec.async('deps link -g -f', { cwd: pkg })
  })
}

function localize(deps, pkg) {
  for (let key in deps) {
    let i = linkNames.indexOf(key)
    if (i != -1) {
      deps[key] = 'file:' + path.relative(pkg, links[i])
    }
  }
}
