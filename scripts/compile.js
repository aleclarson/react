
var chalk = require('chalk');

// Read arguments from the command line.
var minimist = require('minimist');
var args = minimist(process.argv.slice(2));

// Create argument-derived variables.
var only = args.only ? new RegExp(args.only) : /.*/;

// Empty line at beginning.
console.log('');

/**
 * 1. Find & import 'babel-core'
 */

var babelPath = require('resolve').resolvePath('babel-core');
if (!babelPath) {
  console.warn(chalk.gray('Failed to find \'babel-core\' from: ') + process.cwd());
  process.exit();
}

var babel = require(babelPath);
console.log(chalk.yellow('Loaded \'babel-core\' from:\n  ') + babelPath);
console.log('');

/**
 * 2. Read every source directory
 */

var fs = require('fsx');
var path = require('path');

var pkgRoot = path.resolve(__dirname, '..');
var sourceRoot = path.resolve(pkgRoot, 'src');
var ignored = /(__tests__|__mocks__)/;

// Crawl a directory recursively.
function crawl(dir, files) {
  var children = fs.readDir(dir);
  for (var child of children) {
    child = path.join(dir, child);
    if (ignored.test(child)) {
      continue;
    }
    if (child.endsWith('.js')) {
      only.test(child) && files.push(child);
    }
    else if (fs.isDir(child)) {
      crawl(child, files);
    }
  }
  return files;
}

var sourceFiles = crawl(sourceRoot, []);

console.log('');
console.log(chalk.yellow('Source files: ') + sourceFiles.length);
console.log('');

/**
 * 3. Map the filename of every source file to its destination(s)
 */

// For a given source file, find its destination(s).
function findTargets(filename) {
  var targets = [];
  for (var targetRoot of targetRoots) {
    var target = path.join(targetRoot, filename);
    if (fs.isFile(target)) targets.push(target);
  }
  return targets;
}

var buildRoot = path.resolve(pkgRoot, 'build');
var targetRoots = [
  path.resolve(buildRoot, 'packages', 'react', 'lib'),
  path.resolve(buildRoot, 'packages', 'react-dom', 'lib'),
  path.resolve(buildRoot, 'modules'),
];

var targetMap = Object.create(null);
sourceFiles = sourceFiles.filter(function(file) {
  var filename = path.basename(file);
  var targets = findTargets(filename);
  if (targets.length) {
    file = path.relative(sourceRoot, file);
    targetMap[file] = targets;
    return true;
  }
});

/**
 * 4. Transform every source file
 */

var moduleMap = require('./babel/module-map');
var rewriteModules = require('fbjs-scripts/babel-6/rewrite-modules');
var devExpressionWithCodes = require('./error-codes/dev-expression-with-codes');

var config = {
  extends: path.resolve(pkgRoot, '.babelrc'),
  plugins: [
    devExpressionWithCodes,
    [rewriteModules, {map: moduleMap}],
  ],
};

// Save the MD5 hash of every source file.
var crypto = require('crypto');
var hashesPath = path.join(buildRoot, 'hashes.json');
var hashes = fs.isFile(hashesPath) ? require(hashesPath) : {};

if (!args.debug && !args.dry && sourceFiles.length > 10) {
  var ProgressBar = require('progress');
  var progress = new ProgressBar(':bar', {
    total: sourceFiles.length,
    width: 50,
  });
}

var now = require('performance-now');
var startTime = now();

// Removes `@providesModule` from the header of a file.
function stripProvidesModule(code) {
  return code.replace(/\r?\n \* \@providesModule (\S+)(?=\r?\n)/, '');
}

// Transform every changed source file!
Object.keys(targetMap).forEach(file => {
  progress && progress.tick();

  var sourceCode = fs.readFile(path.join(sourceRoot, file));
  var hash = crypto.createHash('md5').update(sourceCode).digest("hex");

  if (hash === hashes[file]) {
    if (args.debug && args.only) {
      console.log(chalk.gray('Unchanged: ') + file);
    }
    return;
  }

  // The source file has been changed.
  hashes[file] = hash;

  if (args.debug || args.dry) {
    console.log(chalk.green('Changed: ') + file);
  }

  var result = babel.transform(sourceCode, config);
  result.code = stripProvidesModule(result.code);

  // Dry runs are useful for:
  //   - debugging transforms
  //   - measuring performance
  //   - previewing side effects
  if (args.dry) return;

  var targets = targetMap[file];
  for (var target of targets) {
    args.debug && console.log(chalk.gray('Overwriting: ') + path.relative(pkgRoot, target));
    fs.writeDir(path.dirname(target));
    fs.writeFile(target, result.code);
  }
});

console.log('');
console.log(chalk.yellow('Elapsed time: ') + (now() - startTime).toFixed(2) + 'ms');
console.log('');

// Persist the hash map.
if (!args.dry) {
  args.debug && console.log(chalk.gray('Saving content hashes:\n  ') + hashesPath + '\n');
  fs.writeFile(hashesPath, JSON.stringify(hashes, null, 2));
}
